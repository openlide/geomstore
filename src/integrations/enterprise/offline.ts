/**
 * GeomStore - 微信小程序企业级方案：离线状态管理
 *
 * 自 wechat-enterprise.ts 拆出。在离线时缓存操作，网络恢复后自动同步；
 * 超过重试上限的操作落盘死信队列并回调通知，避免企业场景离线订单/表单静默丢失。
 */

import type { Store, State } from '../../types/store.js'
import { storage, logger, DEFAULT_MAX_RETRY, type WxApi } from './env.js'

// 本模块直接调用 wx（网络状态/UI 反馈），故保留模块级 ambient 声明
declare const wx: WxApi

/**
 * 一条被离线缓存的待同步操作
 */
export interface OfflineAction {
  /** 唯一标识（时间戳 + 随机串） */
  id: string
  /** Action 名称，同步时经 `store.dispatch` 执行 */
  type: string
  /** 执行时透传给 Action 的载荷 */
  payload: unknown
  /** 入队时间戳 */
  timestamp: number
  /** 已失败次数；达到 `maxRetryCount` 后移入死信队列并触发 `onDrop` */
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
      // onDrop 用户回调抛错）时，剩余项既不在失败段也不在已清空的
      // this.actionQueue——遗漏会让残缺队列落盘覆盖磁盘完整旧队列，丢失成为永久。
      // 含当前项（at-least-once：异常中的操作重新入队重试，可能重复进死信，可接受）
      //
      // 读 this.syncFailed 而非局部 failedActions：两者初始为同一数组引用，但
      // clearQueue 在同步进行中会把字段重绑为新的空数组，若仍读局部变量，
      // 已被用户清空的操作会在此复活并经 saveQueue 落盘——清空被静默撤销。
      // 改读字段后与 saveQueue 拼接联合视图的口径也一致
      this.actionQueue = [...this.syncFailed, ...this.syncPending.slice(this.syncNextIndex), ...this.actionQueue]
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
   *
   * 同步进行中调用同样生效：syncQueue 采用快照-清空模式，队列分散在
   * actionQueue（同步期间新入队）、syncPending（本轮待同步快照）、syncFailed（失败段）
   * 三段，其 finally 会把三段拼回 actionQueue 并落盘。只清 actionQueue 会让
   * 已「清空」的操作在同步结束时复活继续同步，故三段一并置空——
   * syncPending 清空后循环条件立即为假、同步停止；清空之后新入队的操作
   * 仍进 actionQueue，不受影响
   */
  clearQueue(): void {
    this.actionQueue = []
    this.syncPending = []
    this.syncFailed = []
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
    const view = this.syncing ? [...this.syncFailed, ...this.syncPending.slice(this.syncNextIndex), ...this.actionQueue] : this.actionQueue
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
