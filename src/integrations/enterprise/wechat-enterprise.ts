/**
 * GeomStore v1.0 - 微信小程序企业级方案
 *
 * 包含：
 * - 多账号隔离（持久化 key 与登出清理 key 统一为 store name）
 * - Store 管理器（账号切换 / LRU 清理）
 * - 热更新状态恢复
 * - 离线操作队列（支持 dispose 释放网络监听、syncQueue 互斥）
 * - 后台/前台状态同步（App.prototype 仅包装一次，多实例共享注册表）
 */

import { createStore } from '../../core/store/index'
import type { Store, State } from '../../types/store'
import { persistencePlugin } from '../../plugins/builtin'

// ==================== wx API 模块级类型声明 ====================

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
interface WxApi {
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
const DEFAULT_MAX_STORES = 5

/** 默认备份过期时间（1小时） */
const BACKUP_EXPIRY_MS = 60 * 60 * 1000

/** 默认最大非活跃时间（5分钟） */
const DEFAULT_MAX_INACTIVE_MS = 5 * 60 * 1000

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRY = 3

/** 默认防抖延迟 */
const DEFAULT_DEBOUNCE_MS = 500

/** 日志前缀 */
const LOG_PREFIX = '[GeomStore]'

/** 当前登录用户 ID 的存储键 */
const CURRENT_USER_KEY = 'current_user_id'

// ==================== 工具函数 ====================

/**
 * 统一日志输出
 */
const logger = {
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
const storage = {
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

// ==================== 1. 多账号隔离 Store 工厂 ====================

export interface UserInfo {
  id?: string | number
  name?: string
  avatar?: string
  [key: string]: unknown
}

export interface UserPreferences {
  theme?: string
  language?: string
  [key: string]: unknown
}

export interface UserState extends State {
  userInfo: UserInfo | null
  preferences: UserPreferences
  lastSyncTime: number | null
}

export interface UserStoreConfig {
  userId: string
  initialState?: Partial<UserState>
}

/**
 * 从服务端拉取用户信息
 * 使用 wx.request（微信小程序网络 API），避免依赖 Node/DOM 的 fetch；
 * wx.request 在任意 HTTP 状态码下都会触发 success，非 2xx 视为请求失败
 */
function requestUserInfo(): Promise<UserInfo> {
  return new Promise<UserInfo>((resolve, reject) => {
    wx.request({
      url: '/api/user/sync',
      success: (res) => {
        const r = res as { statusCode?: number; data?: { userInfo?: UserInfo } }
        if (r.statusCode !== undefined && (r.statusCode < 200 || r.statusCode >= 300)) {
          reject(new Error(`sync failed with status ${r.statusCode}`))
          return
        }
        resolve(r.data?.userInfo as UserInfo)
      },
      fail: reject,
    })
  })
}

/**
 * 创建用户隔离的 Store
 *
 * 每个用户拥有独立的 Store 实例与持久化键（store name 即 `user-store-${userId}`），
 * 登出时 StoreManager 按同一键清理持久化数据，保证键的写入与删除一致
 */
export function createUserStore(config: UserStoreConfig): Store<UserState> {
  const { userId, initialState = {} } = config

  const store = createStore<UserState>({
    name: `user-store-${userId}`,
    state: {
      userInfo: null,
      preferences: {},
      lastSyncTime: null,
      ...initialState,
    },
    actions: {
      // 推荐写法：通过 $patch 更新状态（而非直接变异 this.state），
      // 保证订阅通知、快照与缓存刷新行为一致
      setUserInfo(userInfo: UserInfo) {
        this.$patch({ userInfo, lastSyncTime: Date.now() })
      },
      updatePreferences(key: string, value: unknown) {
        this.$patch({
          preferences: { ...this.state.preferences, [key]: value },
        })
      },
      async syncWithServer() {
        // 先请求后写入：请求失败（reject）时不污染状态
        const userInfo = await requestUserInfo()
        this.$patch({ userInfo, lastSyncTime: Date.now() })
      },
    },
    enableCache: true,
    cacheKeys: ['userInfo', 'preferences'],
  })

  // 用户隔离的持久化：直接复用 store name 作为存储键（本身已含 userId），
  // 使 StoreManager.logout 删除的键与持久化写入的键完全一致
  store.use(
    persistencePlugin<UserState>({
      key: (name: string) => name,
      filter: (state: UserState) => ({
        userInfo: state.userInfo,
        preferences: state.preferences,
      }),
      debounce: DEFAULT_DEBOUNCE_MS,
    }),
  )

  return store
}

// ==================== 2. Store 管理器（处理账号切换） ====================

export class StoreManager {
  private stores: Map<string, Store<UserState>> = new Map()
  private currentUserId: string | null = null
  private readonly maxStores: number

  constructor(maxStores: number = DEFAULT_MAX_STORES) {
    this.maxStores = maxStores
  }

  /**
   * 获取或创建用户 Store
   */
  getUserStore(userId: string): Store<UserState> {
    const existingStore = this.stores.get(userId)
    if (existingStore) {
      // 命中即刷新插入顺序：Map 迭代序即淘汰顺序，不刷新则高频使用的账号
      // 会被当作最旧淘汰（FIFO 而非注释宣称的 LRU）
      this.stores.delete(userId)
      this.stores.set(userId, existingStore)
      return existingStore
    }

    this.cleanupOldestStore(userId)

    const store = createUserStore({ userId })
    this.stores.set(userId, store)
    this.currentUserId = userId

    return store
  }

  /**
   * 切换用户
   */
  switchUser(userId: string): Store<UserState> {
    const newStore = this.getUserStore(userId)
    this.currentUserId = userId
    logger.log('StoreManager', `切换到用户: ${userId}`)
    return newStore
  }

  /**
   * 登出当前用户
   * 持久化键与 createUserStore 的存储键一致（均为 `user-store-${userId}`）
   */
  logout(): void {
    if (!this.currentUserId) return

    const store = this.stores.get(this.currentUserId)
    store?.destroy()
    this.stores.delete(this.currentUserId)

    storage.remove(`user-store-${this.currentUserId}`)
    storage.remove(CURRENT_USER_KEY)

    this.currentUserId = null
    logger.log('StoreManager', '用户已登出')
  }

  /**
   * 获取当前用户的 Store
   */
  getCurrentStore(): Store<UserState> | null {
    return this.currentUserId ? (this.stores.get(this.currentUserId) ?? null) : null
  }

  /**
   * 清理所有 Store
   */
  clearAll(): void {
    this.stores.forEach((store) => store.destroy())
    this.stores.clear()
    this.currentUserId = null
  }

  /**
   * LRU 清理最早的 Store
   */
  private cleanupOldestStore(excludeUserId: string): void {
    if (this.stores.size < this.maxStores) return

    // 跳过排除用户与当前活跃用户找到最久未使用的 Store：
    // - 若 LRU 头部恰好是排除用户时不清理，会导致 stores 超限，需继续向后查找
    // - currentUserId 的 store 被淘汰会让 getCurrentStore() 返回 null、
    //   页面订阅被 destroy 静默清除，因此也必须排除
    let oldestKey: string | undefined
    for (const key of this.stores.keys()) {
      if (key !== excludeUserId && key !== this.currentUserId) {
        oldestKey = key
        break
      }
    }

    if (oldestKey) {
      this.stores.get(oldestKey)?.destroy()
      this.stores.delete(oldestKey)
      logger.log('StoreManager', `清理旧用户 store: ${oldestKey}`)
    }
  }
}

// 全局 StoreManager 实例
export const storeManager = new StoreManager()

// ==================== 3. 热更新处理 ====================

export interface BackupData {
  timestamp: number
  state: unknown
  version: string
}

export interface HotUpdateConfig<S extends State = State> {
  store: Store<S>
  backupKey?: string
  onBeforeUpdate?: () => void
}

const DEFAULT_BACKUP_KEY = 'store_backup_before_update'
const CURRENT_VERSION = '1.0.0'

/** 待更新重启标记键：确认更新时写入，用于区分「更新后首启」与「普通重启」 */
function pendingLaunchKey(backupKey: string): string {
  return `${backupKey}__pending_update_launch`
}

/**
 * 备份当前状态
 */
function backupState<S extends State = State>(store: Store<S>, backupKey: string): void {
  const backupData: BackupData = {
    timestamp: Date.now(),
    state: store.$snapshot(),
    version: CURRENT_VERSION,
  }
  // 写入失败（配额满等）必须抛错：调用方据此跳过标记写入与 applyUpdate，
  // 避免重启后凭空执行一次无源恢复
  if (!storage.set(backupKey, backupData)) {
    throw new Error(`[HotUpdate] 备份写入 storage 失败: ${backupKey}`)
  }
}

/**
 * 初始化热更新处理
 * 在小程序更新时自动备份和恢复状态
 */
/** 热更新当前保护的 store 配置：重复调用（账号切换）时切换保护目标 */
let hotUpdateRegistration: { store: Store<State>; backupKey: string; onBeforeUpdate?: () => void } | null = null
/** 已安装监听的 updateManager 实例：真实环境为全局单例（幂等安装防止监听累积），
 *  测试环境的每个 mock 实例各自安装 */
let hotUpdateManagerInstalled: unknown = null

export function initHotUpdate<S extends State = State>(config: HotUpdateConfig<S>): void {
  const { store, backupKey, onBeforeUpdate } = config
  // 默认按 store 名派生备份键：多账号/多 Store 实例并存时热更新备份互不覆盖
  const resolvedBackupKey = backupKey ?? `${DEFAULT_BACKUP_KEY}_${store.name}`
  hotUpdateRegistration = { store: store as unknown as Store<State>, backupKey: resolvedBackupKey, onBeforeUpdate }

  const updateManager = wx.getUpdateManager()
  // onUpdateReady 是累加式注册且无对应 off API：按 manager 实例幂等安装，
  // 否则每次 login 重新调用都会累积一个监听（多弹窗、多份备份、标记竞态）
  if (hotUpdateManagerInstalled === updateManager) return
  hotUpdateManagerInstalled = updateManager

  updateManager.onUpdateReady(() => {
    logger.log('HotUpdate', '新版本准备就绪')

    const registration = hotUpdateRegistration
    if (!registration) return
    // store 已被外部销毁（LRU 淘汰/logout）时 $snapshot 会抛错，
    // 异常发生在 wx 回调内无人捕获——跳过已销毁 store
    if (registration.store.destroyed) {
      logger.warn('HotUpdate', `store "${registration.store.name}" 已销毁，跳过备份`)
      return
    }

    wx.showModal({
      title: '更新提示',
      content: '新版本已准备好，是否重启应用？',
      success: (res) => {
        if (!res.confirm) return
        // 备份必须在用户确认时进行而非 onUpdateReady 时：弹窗期间业务仍在运行
        // （in-flight 请求回调照常 $patch 并经持久化插件落盘），若备份取自弹窗前，
        // 重启后恢复会把「备份点之前弹窗期间已持久化的变更」整体回滚。
        // 确认时刻的内存状态 ≥ 此刻任何已持久化数据；残余窗口仅剩
        // 「确认到进程终止之间」最后一段（受防抖落盘时机影响，无法完全消除）
        try {
          backupState(registration.store, registration.backupKey)
          registration.onBeforeUpdate?.()
        } catch (error) {
          logger.error('HotUpdate', '备份状态失败:', error)
          // 备份失败不阻断更新，但标记不能写：否则重启后会凭空执行一次无源恢复
          return
        }
        // 先写待更新重启标记再 applyUpdate：重启后凭标记区分「更新后首启」与
        // 「拒绝更新后的普通重启」，避免普通重启把备份点之后的持久化变更回滚。
        // 标记写入失败（storage.set 已尽力而为，仅配额满等异常）不阻断更新：
        // 损失的只是恢复语义
        storage.set(pendingLaunchKey(registration.backupKey), true)
        updateManager.applyUpdate()
      },
    })
  })

  updateManager.onUpdateFailed(() => {
    logger.error('HotUpdate', '更新失败')
    // 更新未生效时必须清理标记与备份：残留标记会让之后的普通冷启动被误判为
    // 「更新后首启」，把用户继续使用期间的持久化变更回滚到旧备份点
    if (hotUpdateRegistration) {
      storage.remove(pendingLaunchKey(hotUpdateRegistration.backupKey))
      storage.remove(hotUpdateRegistration.backupKey)
    }
    wx.showToast({ title: '更新失败，请重试', icon: 'none' })
  })
}

/**
 * 从热更新备份恢复状态
 */
export function restoreFromHotUpdate<S extends State = State>(store: Store<S>, backupKey?: string): boolean {
  // 默认按 store 名派生备份键，与 initHotUpdate 保持一致
  const resolvedBackupKey = backupKey ?? `${DEFAULT_BACKUP_KEY}_${store.name}`
  const markerKey = pendingLaunchKey(resolvedBackupKey)
  const backup = storage.get<BackupData>(resolvedBackupKey)
  if (!backup) {
    // 备份不存在时顺带清理可能残留的孤儿标记
    storage.remove(markerKey)
    return false
  }

  const backupAge = Date.now() - backup.timestamp

  // 备份超过过期时间，清理并返回
  if (backupAge > BACKUP_EXPIRY_MS) {
    logger.warn('HotUpdate', '备份数据已过期（超过1小时）')
    storage.remove(resolvedBackupKey)
    storage.remove(markerKey)
    return false
  }

  // 仅更新确认后的首次启动才恢复：用户在弹窗中拒绝更新后继续使用，
  // 期间的变更已持久化，普通冷启动时恢复会把状态回滚到备份点，
  // 备份点之后的所有变更静默丢失
  if (!storage.get<boolean>(markerKey)) {
    logger.log('HotUpdate', '存在备份但非更新后首启，跳过恢复')
    return false
  }

  try {
    store.$restore(backup.state as S)
    storage.remove(resolvedBackupKey)
    storage.remove(markerKey)
    logger.log('HotUpdate', `状态已从备份恢复（版本: ${backup.version}）`)
    return true
  } catch (error) {
    logger.error('HotUpdate', '恢复状态失败:', error)
    return false
  }
}

// ==================== 4. 离线状态管理 ====================

export interface OfflineAction {
  id: string
  type: string
  payload: unknown
  timestamp: number
  retryCount: number
}

const DEFAULT_QUEUE_KEY = 'offline_action_queue'

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

/**
 * 离线状态管理器
 * 在离线时缓存操作，网络恢复后自动同步
 *
 * 生命周期：不再使用时调用 dispose() 释放网络监听，
 * 避免账号切换等场景下旧实例监听泄漏
 */
export class OfflineManager<S extends State = State> {
  private store: Store<S>
  private actionQueue: OfflineAction[] = []
  private isOnline = true
  /** 同步互斥标志：防止网络恢复回调与手动 syncQueue 并发重复执行队列 */
  private syncing = false
  /** 同步进行中的队列中间状态：saveQueue 落盘时据此拼接完整联合视图。
   *  同步期间 enqueue 会触发 saveQueue，若只写 this.actionQueue，
   *  磁盘会被「仅剩新项」的队列覆写——进程恰在此窗口被杀时，
   *  未处理的旧操作永久丢失（at-least-once 被破坏）。syncQueue 结束后归空。 */
  private syncPending: OfflineAction[] = []
  private syncFailed: OfflineAction[] = []
  private syncNextIndex = 0
  private disposed = false
  /** 网络监听回调引用，dispose 时用于精确移除。参数类型同时兼容 wx.on/offNetworkStatusChange 两种签名 */
  private networkHandler: ((res: { isConnected?: boolean; errMsg?: string }) => void) | null = null
  private readonly maxRetryCount: number
  private readonly queueKey: string
  private readonly deadLetterKey: string
  /** 死信队列容量上限：长期不处理死信时防止小程序 storage（10MB）被无界挤占 */
  private static readonly MAX_DEAD_LETTERS = 500
  /** 死信回调：操作超过重试上限被移入死信队列时通知调用方（业务层兜底/告警） */
  private readonly onDrop: ((action: OfflineAction) => void) | undefined

  constructor(store: Store<S>, queueKey?: string, maxRetryCount: number = DEFAULT_MAX_RETRY, onDrop?: (action: OfflineAction) => void) {
    this.store = store
    // 默认按 store 名派生存储键：多账号/多 Store 实例并存时共用固定键
    // 会导致离线队列与死信队列互相串扰（账号 A 的操作被账号 B 加载/同步）
    this.queueKey = queueKey ?? `${DEFAULT_QUEUE_KEY}_${store.name}`
    this.maxRetryCount = maxRetryCount
    this.deadLetterKey = `${this.queueKey}_dead_letter`
    this.onDrop = onDrop
    this.loadQueue()
    this.initNetworkListener()
  }

  /**
   * 执行操作（支持离线缓存）
   */
  async execute<T>(type: string, action: () => Promise<T>, payload?: unknown): Promise<T | null> {
    if (this.isOnline) {
      try {
        return await action()
      } catch (error) {
        this.enqueue(type, payload)
        // 保留原始错误（网络/HTTP/业务错误）作为 cause，排障不被吞
        const wrapped = new Error(`操作执行失败，已加入离线队列: ${type}`)
        ;(wrapped as Error & { cause?: unknown }).cause = error
        throw wrapped
      }
    }

    this.enqueue(type, payload)
    logger.log('OfflineManager', `操作已缓存（离线）: ${type}`)
    return null
  }

  /**
   * 同步离线队列（公开方法供外部调用）
   * syncing 互斥保证并发触发时队列不会被重复执行
   */
  async syncQueue(): Promise<void> {
    if (this.syncing || this.actionQueue.length === 0) return

    this.syncing = true
    const failedActions: OfflineAction[] = []
    // 快照-清空模式：先取走当前队列，同步期间新入队的操作保留在 this.actionQueue，
    // 结束后合并回填。三份中间状态同步到实例字段，供 saveQueue 拼接联合视图落盘
    this.syncPending = this.actionQueue
    this.actionQueue = []
    this.syncFailed = failedActions
    this.syncNextIndex = 0

    try {
      for (; this.syncNextIndex < this.syncPending.length; this.syncNextIndex++) {
        const action = this.syncPending[this.syncNextIndex]
        const success = await this.tryExecuteAction(action)
        if (!success) {
          action.retryCount++
          if (action.retryCount < this.maxRetryCount) {
            failedActions.push(action)
          } else {
            // 超过重试上限：不再静默丢弃，落盘死信队列并回调通知，
            // 避免企业场景离线订单/表单直接丢失且无感知
            logger.error('OfflineManager', `操作重试次数超过限制，移入死信队列: ${action.type}`)
            this.appendDeadLetter(action)
            this.onDrop?.(action)
          }
        }
      }

      if (failedActions.length > 0) {
        wx.showToast({ title: `${failedActions.length}个操作同步失败`, icon: 'none' })
      }
    } finally {
      // 回填必须覆盖循环未迭代到的剩余项：中途异常（死信落盘配额满、
      // onDrop 用户回调抛错）时，剩余项既不在 failedActions 也不在已清空的
      // this.actionQueue——遗漏会让残缺队列落盘覆盖磁盘完整旧队列，丢失成为永久。
      // 含当前项（at-least-once：异常中的操作重新入队重试，可能重复进死信，可接受）
      this.actionQueue = [...failedActions, ...this.syncPending.slice(this.syncNextIndex), ...this.actionQueue]
      // saveQueue 内部已尽力而为（storage.set 不外抛），此处无需再兜底
      this.saveQueue()
      this.syncPending = []
      this.syncFailed = []
      this.syncNextIndex = 0
      this.syncing = false
    }
  }

  /**
   * 清空队列
   */
  clearQueue(): void {
    this.actionQueue = []
    storage.remove(this.queueKey)
  }

  /**
   * 获取队列长度
   */
  getQueueLength(): number {
    return this.actionQueue.length
  }

  /**
   * 释放资源：移除网络状态监听
   * 账号切换/登出重建 OfflineManager 前必须先调用，否则旧实例监听泄漏
   */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.networkHandler) {
      wx.offNetworkStatusChange?.(this.networkHandler)
      this.networkHandler = null
    }
  }

  /**
   * 添加操作到队列
   */
  private enqueue(type: string, payload: unknown): void {
    this.actionQueue.push({
      id: generateId(),
      type,
      payload,
      timestamp: Date.now(),
      retryCount: 0,
    })
    this.saveQueue()
  }

  /**
   * 尝试执行单个操作
   */
  private async tryExecuteAction(action: OfflineAction): Promise<boolean> {
    try {
      await this.executeAction(action)
      logger.log('OfflineManager', `同步成功: ${action.type}`)
      return true
    } catch {
      return false
    }
  }

  /**
   * 执行具体操作（可被子类重写）
   */
  protected async executeAction(action: OfflineAction): Promise<void> {
    const actionName = action.type
    // hasOwnProperty 校验：`in` 会命中原型链（如 'toString'），
    // 导致对非自有 action 发起无意义的 dispatch
    const actions = this.store.actions as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(actions, actionName)) {
      // 未知 action 必须抛错进入重试→死信路径：静默返回会让 tryExecuteAction
      // 视为成功并将操作移出队列，离线操作无感知丢失（不进死信、不触发 onDrop）
      throw new Error(`[OfflineManager] Unknown queued action "${actionName}"`)
    }
    await this.store.dispatch(actionName, action.payload)
  }

  /**
   * 初始化网络监听
   * 保存回调引用，供 dispose 精确移除
   */
  private initNetworkListener(): void {
    this.networkHandler = (res) => {
      if (this.disposed) return

      const wasOffline = !this.isOnline
      this.isOnline = res.isConnected === true

      if (wasOffline && this.isOnline) {
        logger.log('OfflineManager', '网络已恢复，开始同步')
        // 浮动 promise：onDrop 回调抛错等异常会沿 syncQueue 传播，
        // 网络回调内无人接住会成为 unhandled rejection
        this.syncQueue().catch((error) => {
          logger.error('OfflineManager', '网络恢复自动同步失败:', error)
        })
      }
    }
    wx.onNetworkStatusChange(this.networkHandler)

    wx.getNetworkType({
      success: (res) => {
        if (!this.disposed) {
          this.isOnline = res.networkType !== 'none'
        }
      },
    })
  }

  /**
   * 保存队列到存储
   *
   * 同步进行中时队列被拆为「已失败待重试 + 未处理剩余（含当前执行项）+ 新入队」三段，
   * 必须落盘完整联合视图：否则磁盘被仅含新项的队列覆写，
   * 进程在同步窗口内被杀会让未处理旧操作永久丢失（at-least-once）
   */
  private saveQueue(): void {
    const view = this.syncing
      ? [...this.syncFailed, ...this.syncPending.slice(this.syncNextIndex), ...this.actionQueue]
      : this.actionQueue
    storage.set(this.queueKey, view)
  }

  /**
   * 追加操作到死信队列（持久化，供业务层后续人工处理或上报）
   */
  private appendDeadLetter(action: OfflineAction): void {
    const deadLetters = this.getDeadLetters()
    deadLetters.push(action)
    // 超限时淘汰最旧条目，保护 storage 容量
    if (deadLetters.length > OfflineManager.MAX_DEAD_LETTERS) {
      deadLetters.splice(0, deadLetters.length - OfflineManager.MAX_DEAD_LETTERS)
    }
    storage.set(this.deadLetterKey, deadLetters)
  }

  /**
   * 获取死信队列中超过重试上限被丢弃的操作
   */
  getDeadLetters(): OfflineAction[] {
    const saved = storage.get<OfflineAction[]>(this.deadLetterKey)
    return Array.isArray(saved) ? saved : []
  }

  /**
   * 清空死信队列（业务层确认已处理丢失操作后调用）
   */
  clearDeadLetters(): void {
    storage.remove(this.deadLetterKey)
  }

  /**
   * 从存储加载队列
   */
  private loadQueue(): void {
    const saved = storage.get<OfflineAction[]>(this.queueKey)
    if (Array.isArray(saved)) {
      this.actionQueue = saved
    } else if (saved !== null) {
      // 形状校验失败（损坏的 JSON / 非数组数据）：清理而非保留，
      // 否则 syncQueue 会按字符迭代字符串并静默清空队列，离线操作丢失
      logger.warn('OfflineManager', `离线队列数据损坏，已清空: ${this.queueKey}`)
      storage.remove(this.queueKey)
    }
  }
}

// ==================== 5. 后台/前台状态同步 ====================

export interface BackgroundSyncConfig<S extends State = State> {
  store: Store<S>
  maxInactiveTime?: number
  onForeground?: () => void
  onBackground?: () => void
}

/**
 * 单个后台同步注册项
 */
interface BackgroundSyncHandler {
  store: Store<State>
  maxInactiveTime: number
  onForeground?: () => void
  onBackground?: () => void
  lastActiveTime: number
}

/** 模块级注册表：多次 initBackgroundSync 共享同一份生命周期包装 */
const backgroundSyncHandlers: BackgroundSyncHandler[] = []

/** 已安装的全局 App 构造器包装函数引用，用于检测是否需要重新安装 */
let installedAppWrapper: ((this: unknown, options?: Record<string, unknown>) => unknown) | null = null

/**
 * 包装全局 App 构造函数以拦截 options.onShow / options.onHide（仅安装一次）
 *
 * 微信小程序中用户生命周期回调通过 App({ onShow, onHide }) 的 options 注册，
 * 框架直接调用 options 上的回调；修改 App.prototype 既不会触发包装、也链不到用户回调。
 * 故改为替换全局 App 为包装函数：先包装 options 回调再调用原始 App，
 * 包装函数遍历注册表执行各 Store 的时效性检查，避免重复初始化时包装层层叠加。
 *
 * 注意：必须在 App(options) 被调用之前完成 initBackgroundSync（如在 app.js 顶层
 * import 后立即初始化），否则无法拦截已创建的 App 实例注册的回调。
 */
function installAppLifecycleHooks(): void {
  const globalObj = globalThis as { App?: (this: unknown, options?: Record<string, unknown>) => unknown }
  const originalApp = globalObj.App
  if (typeof originalApp !== 'function') return

  const runForegroundChecks = (): void => {
    const now = Date.now()

    for (const handler of [...backgroundSyncHandlers]) {
      // 防御：Store 被外部直接销毁而未注销时，跳过并自清理，
      // 避免 dispatch 因 destroyed 检查抛错中断 App.onShow 生命周期
      if (handler.store.destroyed) {
        const index = backgroundSyncHandlers.indexOf(handler)
        if (index !== -1) {
          backgroundSyncHandlers.splice(index, 1)
        }
        continue
      }

      const inactiveDuration = now - handler.lastActiveTime
      if (inactiveDuration > handler.maxInactiveTime) {
        logger.log('BackgroundSync', `非活跃时间过长(${inactiveDuration}ms)，刷新状态`)
        if ('refreshData' in handler.store.actions) {
          try {
            // 异步 action 的 rejection 不会被同步 try/catch 捕获，
            // 显式接住避免 unhandled rejection
            Promise.resolve(handler.store.dispatch('refreshData')).catch((error) => {
              logger.error('BackgroundSync', '刷新状态失败:', error)
            })
          } catch (error) {
            // 单个 store 刷新失败不应沿 App.onShow 传播：
            // 否则后续 handler 被跳过、用户自己的 onShow 回调不再执行
            logger.error('BackgroundSync', '刷新状态失败:', error)
          }
        }
      }
      handler.lastActiveTime = now
      try {
        handler.onForeground?.()
      } catch (error) {
        logger.error('BackgroundSync', 'onForeground 回调执行失败:', error)
      }
    }
  }

  const runBackgroundChecks = (): void => {
    for (const handler of [...backgroundSyncHandlers]) {
      handler.lastActiveTime = Date.now()
      try {
        handler.onBackground?.()
      } catch (error) {
        logger.error('BackgroundSync', 'onBackground 回调执行失败:', error)
      }
    }
  }

  const wrappedApp = function (this: unknown, options: Record<string, unknown> = {}): unknown {
    const userOnShow = options.onShow as ((this: unknown, ...args: unknown[]) => void) | undefined
    const userOnHide = options.onHide as ((this: unknown, ...args: unknown[]) => void) | undefined

    // 先执行时效性检查再调用用户回调，保证切前台时状态刷新优先
    options.onShow = function (this: unknown, ...args: unknown[]): void {
      runForegroundChecks()
      userOnShow?.apply(this, args)
    }
    options.onHide = function (this: unknown, ...args: unknown[]): void {
      runBackgroundChecks()
      userOnHide?.apply(this, args)
    }
    return originalApp.call(this, options)
  }

  // 保持原型链，使 instanceof / new 语义不受影响（基础库可能以构造器形式使用 App）
  try {
    Object.setPrototypeOf(wrappedApp, originalApp)
    ;(wrappedApp as { prototype?: unknown }).prototype = (originalApp as { prototype?: unknown }).prototype
  } catch {
    // setPrototypeOf 失败（极少见）时忽略，仅丢失静态属性继承
  }

  globalObj.App = wrappedApp
  installedAppWrapper = wrappedApp
}

/**
 * 注销指定 Store 的后台同步处理器
 *
 * 账号切换/登出时应调用，避免已销毁 Store 的处理器残留在注册表中，
 * 导致下次 onShow 触发 dispatch 抛错中断生命周期。
 */
export function unregisterBackgroundSync<S extends State = State>(store: Store<S>): void {
  const target = store as unknown as Store<State>
  const index = backgroundSyncHandlers.findIndex((handler) => handler.store === target)
  if (index !== -1) {
    backgroundSyncHandlers.splice(index, 1)
  }
}

/**
 * 初始化后台/前台状态同步
 * 在小程序从后台返回前台时检查状态时效性
 *
 * 多次调用不会重复包装全局 App：
 * 若全局 App 仍为本模块安装的包装函数，则仅注册新的处理器；
 * 若全局 App 已被外部替换（如测试重置），则重新安装并重置注册表
 */
export function initBackgroundSync<S extends State = State>(config: BackgroundSyncConfig<S>): void {
  const { store, maxInactiveTime = DEFAULT_MAX_INACTIVE_MS, onForeground, onBackground } = config

  const globalObj = globalThis as { App?: unknown }
  if (typeof globalObj.App !== 'function') return

  if (globalObj.App !== installedAppWrapper) {
    backgroundSyncHandlers.length = 0
    installAppLifecycleHooks()
  }

  // 幂等注册：同一 Store 重复 init 时替换旧处理器，避免重复刷新
  unregisterBackgroundSync(store)

  backgroundSyncHandlers.push({
    store: store as unknown as Store<State>,
    maxInactiveTime,
    onForeground,
    onBackground,
    lastActiveTime: Date.now(),
  })
}

// ==================== 6. 完整示例：App.ts 集成 ====================

export interface EnterpriseAppConfig {
  maxInactiveTime?: number
}

/**
 * 示例：在 App.ts 中使用以上所有功能
 * 账号切换/登出时自动 dispose 旧的 OfflineManager，避免监听泄漏
 */
export function createEnterpriseApp(config: EnterpriseAppConfig = {}) {
  const { maxInactiveTime = 10 * 60 * 1000 } = config

  // 获取当前用户ID
  const currentUserId = storage.get<string>(CURRENT_USER_KEY)
  const store = currentUserId ? storeManager.getUserStore(currentUserId) : null

  // 离线管理器实例（延迟初始化）
  let offlineManager: OfflineManager<UserState> | null = null

  return {
    globalData: {
      storeManager,
      store,
      offlineManager: null as OfflineManager<UserState> | null,
    },

    onLaunch() {
      if (!store) return

      // 1. 初始化热更新处理
      initHotUpdate({
        store,
        onBeforeUpdate: () => logger.log('App', '准备更新，状态已备份'),
      })

      // 2. 尝试从热更新备份恢复
      restoreFromHotUpdate(store)

      // 3. 初始化后台/前台同步
      initBackgroundSync({ store, maxInactiveTime })

      // 4. 初始化离线管理
      offlineManager = new OfflineManager(store)
      this.globalData.offlineManager = offlineManager
    },

    onShow() {
      if (offlineManager && offlineManager.getQueueLength() > 0) {
        wx.showLoading({ title: '同步中...' })
        // syncQueue 可 reject（onDrop 回调抛错等），finally 前必须接住，
        // 避免 unhandled rejection；hideLoading 在成功与失败时都要执行
        offlineManager
          .syncQueue()
          .catch((error) => logger.error('App', '离线队列同步失败:', error))
          .finally(() => wx.hideLoading())
      }
    },

    login(userId: string) {
      storage.set(CURRENT_USER_KEY, userId)
      const previousStore = this.globalData.store
      const newStore = storeManager.switchUser(userId)
      this.globalData.store = newStore

      // 账号切换：注销旧 Store 的后台同步处理器，为新 Store 重新注册
      if (previousStore && previousStore !== newStore) {
        unregisterBackgroundSync(previousStore)
      }
      initBackgroundSync({ store: newStore, maxInactiveTime })
      // 热更新保护切换到新 store：监听幂等安装（不累积），保护目标切换。
      // 首次登录（previousStore 为 null，onLaunch 因无 store 未注册）也必须注册
      if (previousStore !== newStore) {
        initHotUpdate({ store: newStore })
      }

      // 重新初始化离线管理器：先释放旧实例的网络监听，防止泄漏
      offlineManager?.dispose()
      offlineManager = new OfflineManager(newStore)
      this.globalData.offlineManager = offlineManager

      return newStore
    },

    logout() {
      // 先注销后台同步处理器，避免已销毁 Store 残留在注册表
      const currentStore = this.globalData.store
      if (currentStore) {
        unregisterBackgroundSync(currentStore)
      }

      offlineManager?.dispose()
      storeManager.logout()
      this.globalData.store = null
      this.globalData.offlineManager = null
      offlineManager = null
      storage.remove(CURRENT_USER_KEY)
    },

    getStore(): Store<UserState> | null {
      return this.globalData.store
    },

    getOfflineManager(): OfflineManager<UserState> | null {
      return this.globalData.offlineManager
    },
  }
}
