/**
 * GeomStore - 微信小程序企业级方案：离线状态管理
 *
 * 自 wechat-enterprise.ts 拆出。在离线时缓存操作，网络恢复后自动同步；
 * 超过重试上限的操作落盘死信队列并回调通知，避免企业场景离线订单/表单静默丢失。
 */

import type { Store, State } from '../../types/store.js'
import { isPlainObject } from '../../core/utils/helpers.js'
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
 * 校验一条待同步操作的结构是否完整（用于加载与同步循环的入口拦截）。
 *
 * 存储中的队列可能被外部写坏（null、字符串、缺 retryCount 的对象等）：
 * 这类条目会让 syncQueue 的 `action.retryCount++` 抛 TypeError，
 * 整个队列（含其后的合法操作）永久得不到同步且不会进死信。
 */
function isValidOfflineAction(value: unknown): value is OfflineAction {
  if (!isPlainObject(value)) return false
  const candidate = value as Partial<OfflineAction>
  return typeof candidate.type === 'string' && typeof candidate.retryCount === 'number'
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
   *
   * 契约：失败不外抛。在线执行失败时与离线同样入队，返回 `null` 即
   * 「本次未执行、已交由队列重放」。此前是「入队 + 抛错」并存：调用方拿到
   * rejection 自行重试、队列稍后又会重放同一操作，非幂等操作（下单/提交表单）
   * 会被执行两次，故把重放职责收敛给队列这一个入口。
   *
   * 重放按 `(type, payload)` 经 `store.dispatch` 组装（见 executeAction），
   * 传入的 `action` 闭包本身不会被重放：payload 必须完整描述该 action 的参数
   */
  async execute<T>(type: string, action: () => Promise<T>, payload?: unknown): Promise<T | null> {
    if (this.isOnline) {
      try {
        return await action()
      } catch (error) {
        // 原始错误（网络/HTTP/业务错误）在此记日志后由队列接管，排障信息不被吞
        logger.error('OfflineManager', `操作执行失败，已转交离线队列重放: ${type}`, error)
      }
    }

    // dispose 之后 saveQueue 一律短路返回（该存储键已由接管的新实例持有，旧实例落盘
    // 会覆写新实例的队列），此时入队的条目既不会落盘也永远不会被 syncQueue 执行，
    // 只留在内存里让 getQueueLength 报出「有待同步操作」——正是本模块要防的静默丢失（#354）。
    // 返回值仍是 null（与「未执行、交由队列重放」的既有契约一致），但改告警说明这条
    // 操作不会被重放；在线分支的 action 已在上面正常执行，不受本守卫影响
    if (this.disposed) {
      logger.warn('OfflineManager', `实例已释放，操作未入队也不会落盘（进程重启即丢失）: ${type}`)
      return null
    }

    if (!this.isOnline) {
      logger.log('OfflineManager', `操作已缓存（离线）: ${type}`)
    }
    this.enqueue(type, payload)
    return null
  }

  /**
   * 同步离线队列（公开方法供外部调用）
   * syncing 互斥保证并发触发时队列不会被重复执行
   */
  async syncQueue(): Promise<void> {
    // 已释放实例不得再发起同步：其落盘会覆写共享键上新实例的队列（dispose 后账号可能已切换）
    if (this.disposed || this.syncing || this.actionQueue.length === 0) return

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
        // dispose 后立即停止本轮：已释放实例不得再执行任何操作，
        // 其 finally 的落盘会抹掉新实例（同键）刚持久化的操作
        if (this.disposed) break

        const action = this.syncPending[this.syncNextIndex]
        // 循环入口再次校验：loadQueue 之外的途径（外部替换数组、并发写入）
        // 混入的损坏条目不能拖垮整个队列（retryCount++ 会抛 TypeError）
        if (!isValidOfflineAction(action)) {
          logger.warn('OfflineManager', `丢弃损坏的离线操作条目: ${this.queueKey}`)
          continue
        }

        const success = await this.tryExecuteAction(action)
        // 执行期间被 dispose：本轮就此停止，剩余项（含当前项）在 finally 回填但不落盘
        if (this.disposed) break

        if (!success) {
          action.retryCount++
          if (action.retryCount < this.maxRetryCount) {
            failedActions.push(action)
          } else {
            // 超过重试上限：不再静默丢弃，落盘死信队列并回调通知，
            // 避免企业场景离线订单/表单直接丢失且无感知
            logger.error('OfflineManager', `操作重试次数超过限制，移入死信队列: ${action.type}`)
            if (this.appendDeadLetter(action)) {
              this.onDrop?.(action)
            } else {
              // 死信落盘失败（配额满等）：不得丢弃——队列落盘会覆盖磁盘副本，
              // 操作会同时从内存与存储消失。保留在队列中等待后续重试
              logger.warn('OfflineManager', `死信落盘失败，操作保留在离线队列: ${action.type}`)
              failedActions.push(action)
            }
          }
        }
      }

      // 读 this.syncFailed 而非局部 failedActions（与下方 finally 同口径）：
      // 同步途中 clearQueue 会把字段重绑为新数组，此时 failedActions 已是脱管副本，
      // 按它计数会告诉用户「N 个操作同步失败」，而这几条恰恰已被用户清掉、不会被保留
      if (this.syncFailed.length > 0) {
        wx.showToast({ title: `${this.syncFailed.length}个操作同步失败`, icon: 'none' })
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
      // 先落定同步状态再落盘：syncFailed/syncPending 此刻已并入 actionQueue，
      // 若仍处于 syncing，saveQueue 的联合视图会把失败段再拼一次，
      // 同一操作在磁盘上出现两份，重启恢复后被重复执行
      this.syncPending = []
      this.syncFailed = []
      this.syncNextIndex = 0
      this.syncing = false
      // 已释放实例不再落盘（saveQueue 内部同样有守卫，双重防御）：
      // dispose 后账号可能已切换、共享键已由新实例接管，旧实例的联合视图
      // 会覆写新实例刚持久化的操作，造成内存与磁盘分叉、重启丢操作
      if (!this.disposed) {
        // saveQueue 内部尽力而为（storage.set 不外抛），但失败必须可见：
        // 未同步成功的操作此刻只活在内存里，进程被杀即丢失磁盘副本
        if (!this.saveQueue()) {
          logger.warn('OfflineManager', `同步后队列落盘失败，未同步操作仅存于内存: ${this.queueKey}`)
        }
      }
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
   *
   * 已释放实例（dispose 之后）一律拒绝：该存储键可能已由接管的新实例持有（同 store 名
   * 即同 queueKey，正是 saveQueue/syncQueue 加守卫的场景），旧实例的一次 clearQueue
   * 会删掉新实例已持久化的队列，而新实例内存仍持有它们——重启即静默丢失
   */
  clearQueue(): void {
    if (this.disposed) {
      logger.warn('OfflineManager', `实例已释放，忽略 clearQueue（存储键已由后续实例接管）: ${this.queueKey}`)
      return
    }
    this.actionQueue = []
    this.syncPending = []
    this.syncFailed = []
    storage.remove(this.queueKey)
  }

  /**
   * 获取队列长度
   *
   * 口径（#352）：只统计 `actionQueue`，同步在途期间为 0——syncQueue 会把整批快照
   * 移到 syncPending/syncFailed，此时确有操作待完成但不计入本返回值。
   * 刻意不改：库内唯一的「有待同步」门禁（wechat-enterprise 的 App.onShow）另有
   * `syncInFlight` 与 syncQueue 内部的 `syncing` 互斥兜底，把在途段计入这里反而会让
   * onShow 在网络回调触发的同步期间空跑一次 showLoading/hideLoading，
   * 两次加载态抢同一个全局 toast（见该处注释）。需要「含在途」视图请自行判定
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
    // 落盘失败必须告警：storage 层只记了「写入失败」，看不出后果——
    // 操作此刻仅存内存，小程序进程被杀即永久丢失，违背本模块的 at-least-once 契约
    if (!this.saveQueue()) {
      logger.warn('OfflineManager', `队列落盘失败，操作仅存于内存（进程被杀即丢失）: ${type}`)
    }
  }

  /**
   * 尝试执行单个操作
   */
  private async tryExecuteAction(action: OfflineAction): Promise<boolean> {
    try {
      await this.executeAction(action)
      logger.log('OfflineManager', `同步成功: ${action.type}`)
      return true
    } catch (error) {
      // 重放失败原因必须可见：execute() 只记了首次失败，此后每次重试的失败原因
      // （未知 action、业务拒绝、永久 4xx）若被吞掉，排障就只剩一条计数 toast
      // 与重试耗尽后的死信日志
      logger.warn('OfflineManager', `同步执行失败: ${action.type}`, error)
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
   *
   * @returns 队列当前是否与存储一致。已释放实例不再持有该存储键（由接管的新实例
   *   负责落盘），按一致处理，避免调用方对「无需落盘」误报丢失
   */
  private saveQueue(): boolean {
    // 已释放实例禁止再落盘：dispose 后账号可能已切换，同键已由新实例接管，
    // 旧实例的在途同步（或 dispose 后的 enqueue）落盘会覆写新实例的队列，
    // 磁盘丢失操作而新实例内存仍持有——重启即永久丢失
    if (this.disposed) return true
    const view = this.syncing ? [...this.syncFailed, ...this.syncPending.slice(this.syncNextIndex), ...this.actionQueue] : this.actionQueue
    return storage.set(this.queueKey, view)
  }

  /**
   * 追加操作到死信队列（持久化，供业务层后续人工处理或上报）
   */
  private appendDeadLetter(action: OfflineAction): boolean {
    const deadLetters = this.getDeadLetters()
    deadLetters.push(action)
    // 超限时淘汰最旧条目，保护 storage 容量。
    // 被淘汰的是「同步失败且业务层尚未处理」的操作——正是本模块要防的静默丢失，
    // 且不会触发 onDrop（回调语义是「刚进死信」，补发通知会让业务层重复处理），
    // 所以条数必须落到日志里供告警系统采集
    if (deadLetters.length > OfflineManager.MAX_DEAD_LETTERS) {
      const evicted = deadLetters.length - OfflineManager.MAX_DEAD_LETTERS
      logger.warn('OfflineManager', `死信队列超过上限 ${OfflineManager.MAX_DEAD_LETTERS}，淘汰最旧 ${evicted} 条未处理操作: ${this.deadLetterKey}`)
      deadLetters.splice(0, evicted)
    }
    // 返回落盘结果：调用方据此决定能否安全地从队列移除该操作
    return storage.set(this.deadLetterKey, deadLetters)
  }

  /**
   * 获取死信队列中超过重试上限被丢弃的操作
   *
   * 与 loadQueue 同口径做结构校验后再返回（#353）：死信键同样可被外部写坏
   * （null、字符串、缺 type/retryCount 的对象），此前原样吐给业务层会让人工补发/
   * 上报逻辑读到畸形条目。被过滤掉的条数会告警，便于发现存储被改坏
   */
  getDeadLetters(): OfflineAction[] {
    const saved = storage.get<OfflineAction[]>(this.deadLetterKey)
    if (!Array.isArray(saved)) return []
    const valid = saved.filter(isValidOfflineAction)
    if (valid.length !== saved.length) {
      logger.warn('OfflineManager', `死信队列包含损坏条目，已过滤 ${saved.length - valid.length} 条: ${this.deadLetterKey}`)
    }
    return valid
  }

  /**
   * 清空死信队列（业务层确认已处理丢失操作后调用）
   *
   * 与 clearQueue 同口径拒绝已释放实例：死信键由 queueKey 派生，实例释放后
   * 同 store 名的新实例会继续往里追加，旧实例的一次清空会抹掉新实例记录的死信
   */
  clearDeadLetters(): void {
    if (this.disposed) {
      logger.warn('OfflineManager', `实例已释放，忽略 clearDeadLetters（存储键已由后续实例接管）: ${this.deadLetterKey}`)
      return
    }
    storage.remove(this.deadLetterKey)
  }

  /**
   * 从存储加载队列
   */
  private loadQueue(): void {
    const saved = storage.get<unknown>(this.queueKey)
    if (Array.isArray(saved)) {
      // 逐项校验并丢弃损坏条目（null/字符串/缺 retryCount 等）：
      // 这类条目会让 syncQueue 在 retryCount++ 处抛 TypeError 永久卡死整个队列
      const valid = saved.filter(isValidOfflineAction)
      if (valid.length !== saved.length) {
        logger.warn('OfflineManager', `离线队列包含损坏条目，已丢弃 ${saved.length - valid.length} 条: ${this.queueKey}`)
        // 同步清理磁盘副本，避免损坏条目在每次启动时反复出现；
        // 全部损坏时直接删键（与下方非数组数据同口径），不留空数组
        if (valid.length > 0) {
          storage.set(this.queueKey, valid)
        } else {
          storage.remove(this.queueKey)
        }
      }
      this.actionQueue = valid
    } else if (saved !== null) {
      // 形状校验失败（损坏的 JSON / 非数组数据）：清理而非保留，
      // 否则 syncQueue 会按字符迭代字符串并静默清空队列，离线操作丢失
      logger.warn('OfflineManager', `离线队列数据损坏，已清空: ${this.queueKey}`)
      storage.remove(this.queueKey)
    }
  }
}
