/**
 * GeomStore - 微信小程序企业级方案的运行环境底座
 *
 * 自 wechat-enterprise.ts 拆出：wx API 最小类型声明、模块级常量、统一 logger 与 storage 工具。
 */

/**
 * 微信小程序 wx API 最小类型声明（仅覆盖本模块用到的 API）
 *
 * 项目不依赖 miniprogram-api-typings，这里采用模块级 ambient 声明，
 * 不向全局类型空间注入 wx，避免与下游项目的微信官方类型包冲突；
 * 运行时 wx 由小程序宿主环境提供（测试环境由 tests/setup.js mock）。
 */
interface WxRequestOptions {
  url: string
  method?: string
  data?: unknown
  success?: (res: { statusCode: number; data: unknown }) => void
  fail?: (err: unknown) => void
}

/** 热更新管理器（wx.getUpdateManager 返回值） */
interface WxUpdateManager {
  onUpdateReady(callback: () => void): void
  onUpdateFailed(callback: () => void): void
  applyUpdate(): void
}

/** 本模块用到的 wx API 子集 */
export interface WxApi {
  // 同步存储
  getStorageSync(key: string): unknown
  setStorageSync(key: string, value: unknown): void
  removeStorageSync(key: string): void
  // 网络
  request(options: WxRequestOptions): void
  onNetworkStatusChange(callback: (res: { isConnected: boolean }) => void): void
  offNetworkStatusChange?(callback: (res: { isConnected: boolean }) => void): void
  getNetworkType(options: { success?: (res: { networkType: string }) => void }): void
  // 热更新
  getUpdateManager(): WxUpdateManager
  // UI 反馈
  showModal(options: { title?: string; content?: string; success?: (res: { confirm: boolean }) => void }): void
  showToast(options: { title: string; icon?: string }): void
  showLoading(options: { title: string }): void
  hideLoading(): void
}

declare const wx: WxApi

// ==================== 常量定义 ====================

/** 默认最大 Store 数量 */
export const DEFAULT_MAX_STORES = 5

/** 默认备份过期时间（1小时） */
export const BACKUP_EXPIRY_MS = 60 * 60 * 1000

/** 默认最大非活跃时间（5分钟） */
export const DEFAULT_MAX_INACTIVE_MS = 5 * 60 * 1000

/** 默认最大重试次数 */
export const DEFAULT_MAX_RETRY = 3

/** 默认防抖延迟 */
export const DEFAULT_DEBOUNCE_MS = 500

/** 日志前缀 */
const LOG_PREFIX = '[GeomStore]'

/** 当前登录用户 ID 的存储键 */
export const CURRENT_USER_KEY = 'current_user_id'

// ==================== 工具函数 ====================

/**
 * 统一日志输出
 */
export const logger = {
  log: (tag: string, message: string, ...args: unknown[]) => {
    console.log(`${LOG_PREFIX}[${tag}] ${message}`, ...args)
  },
  warn: (tag: string, message: string, ...args: unknown[]) => {
    console.warn(`${LOG_PREFIX}[${tag}] ${message}`, ...args)
  },
  error: (tag: string, message: string, ...args: unknown[]) => {
    console.error(`${LOG_PREFIX}[${tag}] ${message}`, ...args)
  },
}

/**
 * 存储工具
 */
export const storage = {
  get: <T>(key: string): T | null => {
    try {
      const value = wx.getStorageSync(key)
      if (!value) return null
      if (typeof value !== 'string') return value as T
      // 兼容非 JSON 字符串（如 login 时存储的纯 userId）
      try {
        const parsed = JSON.parse(value)
        // 纯数字/布尔字符串（如 "1001"）保持字符串语义，
        // 避免 "1001" 被解析为 number 1001 导致 userId 类型混淆、多账号隔离失效
        if (typeof parsed === 'number' || typeof parsed === 'boolean') {
          return value as T
        }
        return parsed as T
      } catch {
        return value as T
      }
    } catch {
      return null
    }
  },
  // set/remove 尽力而为（配额满等存储异常仅记日志不外抛）：
  // 队列落盘、标记写入、登出清理等调用点众多，逐点兜底易遗漏，
  // 统一在工具层收敛。需要感知失败的关键路径（热更新备份）
  // 用返回值判断，保持「备份失败不写标记」的既有契约
  set: (key: string, value: unknown): boolean => {
    try {
      wx.setStorageSync(key, typeof value === 'string' ? value : JSON.stringify(value))
      return true
    } catch (error) {
      logger.error('Storage', `写入 storage 失败: ${key}`, error)
      return false
    }
  },
  remove: (key: string): void => {
    try {
      wx.removeStorageSync(key)
    } catch (error) {
      logger.error('Storage', `删除 storage 失败: ${key}`, error)
    }
  },
}
