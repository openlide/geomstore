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
 * 该字符串是否必须套「引号信封」才能被 `storage.get` 读回同一个值（true = 必须加）。
 *
 * get 的解码规则是：`JSON.parse` 抛错 → 返回原文；解析出 number/boolean → 返回原文
 * （见 get 的「不完全对称」契约）；其余 → 返回解析值。故只有「本身就是一段合法 JSON，
 * 且解析结果是对象/数组/字符串/null」的文本原样存会被读成**另一种值**：
 * `'null'` 读回 `null`（键看起来不存在）、`'"abc"'` 读回 `abc`（引号丢失）、
 * `'{"a":1}'` 读回对象（类型漂移）。这类字符串必须套一层引号信封（`JSON.stringify`），
 * 读侧解析出的就是字符串本身，闭环成立
 *
 * 其余字符串（普通 userId、路径、自然语言文案……）`JSON.parse` 直接抛错或解析出
 * number/boolean，原样存取已经无损，因此**不**加信封：既有的存储键格式不变，
 * 宿主/旧版本直接 `wx.getStorageSync` 读到的仍是裸文本
 */
function needsQuoteEnvelope(value: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return false
  }
  return typeof parsed !== 'number' && typeof parsed !== 'boolean'
}

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
  /**
   * 读取并解码 storage 值。
   *
   * 与 set 对 number/boolean 原始值不严格对称（契约）：历史格式只有「字符串原样存」
   * 一种写法，无法区分 login 写入的裸 userId "1001" 与 JSON 化的数字 1001，
   * 若把前者解析为 number 会造成 Map/storage 键类型漂移、多账号隔离失效，
   * 故解析出 number/boolean 时按原始字符串返回。调用方对这两类原始值
   * 只可依赖存在性、或与之对应的**字符串形式**（`=== 'true'`、`=== '0'`）；
   * 真值判定只在「写入值本身为真」时成立——存 `false`/`0` 会读回非空字符串
   * `"false"`/`"0"`（真值为真），与宿主直接返回原始值的非字符串分支（`typeof value !== 'string'`
   * 原样返回 `false`/`0`）结果相反。要表达「关/否」请删键而非写 falsy 值：
   * 库内热更新标记正是按「写入 true、缺席即 null」使用，故不受此限。
   * 另外 `<T>` 对这两类原始值不保型。
   *
   * 字符串侧的往返闭环由 set 侧负责（见 needsQuoteEnvelope）：会被本函数读成另一种值的
   * 字符串（`'null'` / `'"abc"'` / `'{"a":1}'` 这类合法 JSON 文本）在写入时套了引号信封，
   * 因此「对象/数组/字符串」三类值经 set→get 往返类型无损。**唯一的例外是本工具改造前
   * 写下的裸形态**：那种存储值在平台层面与「真的存了 null」无法区分，读回仍是解析值，
   * 直到该键被下一次 set 覆盖才自愈（`current_user_id` 的下次写入点即登录）
   *
   * 缺失键语义（#330）：wx.getStorageSync 对不存在的键返回 `''`（不抛错、不返回
   * undefined），因此「存了空串」与「键不存在」在平台层面不可区分，两者一律返回 null。
   * 这里用显式判空而非 `!value`：`!value` 会把外部写入的原始 `0` / `false` 也当成缺失，
   * 而本工具对这两类值按原始字符串返回（见上文契约），判定口径必须一致
   */
  get: <T>(key: string): T | null => {
    try {
      const value = wx.getStorageSync(key)
      if (value === '' || value === undefined || value === null) return null
      if (typeof value !== 'string') return value as T
      // 兼容非 JSON 字符串（如 login 时存储的纯 userId）
      try {
        const parsed = JSON.parse(value)
        // 纯数字/布尔字符串（如 "1001"）保持字符串语义，
        // 避免 "1001" 被解析为 number 1001 导致 userId 类型混淆、多账号隔离失效。
        // set 写入的字符串不会走到这里：它要么解析失败（原文返回），要么带引号信封
        // （解析结果是 string，直接返回解析值），落进本分支的只有数字/布尔本身与裸历史值
        if (typeof parsed === 'number' || typeof parsed === 'boolean') {
          return value as T
        }
        return parsed as T
      } catch {
        return value as T
      }
    } catch (error) {
      // 与 set/remove 同口径记日志：静默转 null 会让调用方无法区分
      // 「存储坏了」与「没有值」，登录态与账号隔离状态可能被无声丢弃
      logger.error('Storage', `读取 storage 失败: ${key}`, error)
      return null
    }
  },
  // set/remove 尽力而为（配额满等存储异常仅记日志不外抛）：
  // 队列落盘、标记写入、登出清理等调用点众多，逐点兜底易遗漏，
  // 统一在工具层收敛。需要感知失败的关键路径（热更新备份）
  // 用返回值判断，保持「备份失败不写标记」的既有契约
  set: (key: string, value: unknown): boolean => {
    try {
      // 字符串按 needsQuoteEnvelope 的判定决定是否加引号信封（读写闭环），其余值一律 JSON.stringify。
      // JSON.stringify 对 undefined/函数/symbol 不抛错而是返回 undefined：
      // 直接透传给 setStorageSync 在小程序端要么报错要么静默丢值，
      // 而函数照常返回 true 会谎报写入成功（热更新备份等路径依赖返回值判失败）。
      // lib.es5 把 JSON.stringify 的返回类型声明为 string，运行时契约与声明不符，
      // 故此处显式放宽为 string | undefined——不标注的话下一行的判定读起来像死代码
      const serialized: string | undefined = typeof value === 'string' && !needsQuoteEnvelope(value) ? value : JSON.stringify(value)
      if (serialized === undefined) {
        logger.error('Storage', `值不可序列化（undefined/函数/symbol），拒绝写入: ${key}`)
        return false
      }
      wx.setStorageSync(key, serialized)
      return true
    } catch (error) {
      logger.error('Storage', `写入 storage 失败: ${key}`, error)
      return false
    }
  },
  /**
   * 删除键，返回 `removeStorageSync` 是否**未抛错**（与 set 同口径的布尔结果）。
   *
   * 此前返回 void：登出与会话清理路径（StoreManager.logout、热更新标记清理）
   * 连「删除有没有失败」都无从得知。
   *
   * 边界（勿把该返回值当「键已消失」的证明）：wx.removeStorageSync 对不存在的键
   * 同样幂等不抛错，所以 false 只对应抛错类故障（配额/权限异常等），true 涵盖
   * 「删掉了」与「本来就没有」两种情况。读取核验也补不上这个缺口——缺失键与存了
   * 空串在平台层不可区分（见 get 的缺失键语义），get 返回 null 同样证明不了删除生效。
   * 结论：本布尔值是「删除调用未被平台拒绝」的信号，用于让清理路径留痕，
   * 不构成数据已不可读的证明
   */
  remove: (key: string): boolean => {
    try {
      wx.removeStorageSync(key)
      return true
    } catch (error) {
      logger.error('Storage', `删除 storage 失败: ${key}`, error)
      return false
    }
  },
}
