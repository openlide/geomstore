/**
 * SubscriptionManager - 订阅管理器模块
 *
 * 职责：
 * - 管理状态监听器的添加和移除
 * - 通知监听器状态变化
 * - 控制最大订阅者数量
 *
 * @module SubscriptionManager
 */

import type { State, StateListener, SubscriberLimitPolicy } from '../../types/store.js'
import type { SubscriptionManagerInterface } from './types.js'
import { deepCloneState, isProduction } from './utils.js'

/**
 * 订阅管理器配置
 */
export interface SubscriptionManagerOptions {
  /** 最大订阅者数量 */
  maxSubscribers?: number
  /** Store 名称（用于日志） */
  storeName: string
  /** 订阅者达到上限时的策略（默认 'evict-oldest'） */
  onLimit?: SubscriberLimitPolicy
  /**
   * 监听器抛错的上报通道（可选）
   *
   * 存在的理由：本类的契约是「一个坏订阅者不得影响其余监听器」，因此回调异常必须被吞掉；
   * 而吞掉在生产环境（控制台静默）会让某个订阅者从此无声漏掉全部状态更新，线上无从定位。
   * 由宿主（Store）接 onError 钩子即可让监控插件收集，既保留静默口径又有上报入口。
   * 不配置时行为与既有一致（仅开发模式打印）
   */
  onListenerError?: (error: unknown) => void
}

/**
 * 订阅管理器
 *
 * 负责管理状态监听器的生命周期
 */
export class SubscriptionManager<S extends State = State> implements SubscriptionManagerInterface<S> {
  /**
   * 监听器 → 各次注册的可写标记：同一函数注册 N 次通知 N 次，任一份退订只减一（Redux/Vuex 同语义）。
   *
   * 以「注册 → readOnly」映射而非条目级标记：readOnly 是每次注册的属性，
   * 同一函数先以只读、后以可写注册时，若把标记闩在条目上，可写注册会被当成只读，
   * 通知将跳过深拷贝并把受保护的活动状态交给可写回调
   */
  private readonly _listeners: Map<StateListener<S>, { registrations: Map<object, boolean> }> = new Map()
  /** 可写（非只读）监听器注册总次数：仅当存在可写订阅者时才需深拷贝做引用隔离 */
  private _writableCount = 0
  private readonly _maxSubscribers: number
  private readonly _storeName: string
  private readonly _onLimit: SubscriberLimitPolicy
  private readonly _onListenerError?: (error: unknown) => void
  /** 监听器注册总次数（按注册次数计）：O(1) 维护，避免 size getter 每次遍历整表求和 */
  private _totalCount = 0

  constructor(options: SubscriptionManagerOptions) {
    this._maxSubscribers = options.maxSubscribers ?? 50
    this._storeName = options.storeName
    this._onLimit = options.onLimit ?? 'evict-oldest'
    this._onListenerError = options.onListenerError
  }

  /**
   * 获取监听器数量（按注册次数计）
   */
  get size(): number {
    return this._totalCount
  }

  /**
   * 是否存在可写（非只读）监听器
   *
   * 仅当存在可写订阅者时才需要深拷贝状态做引用隔离；纯只读订阅（页面/组件绑定）
   * 不会修改载荷，可直接复用只读保护 Proxy（零拷贝），省去整棵状态树的深拷贝开销。
   */
  hasWritableListeners(): boolean {
    return this._writableCount > 0
  }

  /**
   * 添加监听器
   *
   * 已有监听器的重复订阅仅递增计数，不参与上限判定与驱逐——否则达到上限时
   * 重复订阅会先驱逐一个无辜的最旧监听器。新监听器达到上限时按 onLimit 策略处理：
   * - evict-oldest：警告并驱逐最早的订阅者（默认）
   * - throw：抛出错误，避免订阅者无声丢失状态更新
   *
   * 上限是对「新增订阅」的门禁，不是 size 的硬保证：重复注册免检，
   * 因而 size（按注册次数计）可高于 maxSubscribers；此时新订阅仍会驱逐一份名额，
   * 总量维持在被重复注册抬到的水平而不再增长。需要硬上限请按 size 自行校验
   *
   * @param options.readOnly 标记为只读订阅（仅读取状态、不修改），可让 Store 在仅有只读订阅时跳过深拷贝
   */
  add(listener: StateListener<S>, options?: { readOnly?: boolean }): object {
    const registration = {}
    const readOnly = options?.readOnly ?? false
    const existing = this._listeners.get(listener)
    if (existing !== undefined) {
      existing.registrations.set(registration, readOnly)
      this._totalCount += 1
      if (!readOnly) {
        this._writableCount += 1
      }
      return registration
    }
    if (this.size >= this._maxSubscribers) {
      if (this._onLimit === 'throw') {
        throw new Error(
          `[GeomStore][${this._storeName}] Subscriber limit reached (${this._maxSubscribers}). Unsubscribe unused listeners or increase maxSubscribers.`,
        )
      }
      if (!isProduction()) {
        console.warn(`[GeomStore][${this._storeName}] 订阅者数量已达到上限(${this._maxSubscribers})`)
      }
      const firstListener = this._listeners.keys().next().value
      if (firstListener !== undefined) {
        // 按注册次数递减而非整条删除：被驱逐的监听器可能注册了 N 份，
        // 整条删除会让用户仍持有的 N 个退订句柄全部变成静默 no-op，
        // 也与本类 add/delete 的「注册 N 次通知 N 次、退订只减一」计数语义不一致。
        // 驱逐一份即腾出新订阅者所需的额度
        this.delete(firstListener)
      }
    }

    this._listeners.set(listener, { registrations: new Map([[registration, readOnly]]) })
    this._totalCount += 1
    if (!readOnly) {
      this._writableCount += 1
    }
    return registration
  }

  /**
   * 移除监听器：存在多份注册时只减一，最后一次调用才真正移除。
   * 传入注册句柄时只移除该次注册；被驱逐的注册句柄与其余注册互不影响。
   */
  delete(listener: StateListener<S>, registration?: object): boolean {
    const entry = this._listeners.get(listener)
    if (entry === undefined) {
      return false
    }
    const token = registration ?? entry.registrations.keys().next().value
    if (token === undefined || !entry.registrations.has(token)) {
      return false
    }
    const readOnly = entry.registrations.get(token) === true
    entry.registrations.delete(token)
    this._totalCount -= 1
    if (!readOnly) {
      this._writableCount -= 1
    }
    if (entry.registrations.size === 0) {
      this._listeners.delete(listener)
    }
    return true
  }

  /**
   * 清空所有监听器
   */
  clear(): void {
    this._listeners.clear()
    this._writableCount = 0
    this._totalCount = 0
  }

  /**
   * 通知所有监听器
   *
   * 优化：
   * - 使用数组遍历比 Map.forEach 更快
   * - cloneOnNotify=true（默认）：创建状态深拷贝避免引用共享问题
   * - cloneOnNotify=false：零拷贝模式，调用方（Store）负责传入只读保护后的状态
   *
   * @param cloneOnNotify 是否深拷贝载荷。Store 据此在「仅只读订阅」场景下传 false 跳过深拷贝
   */
  notify(state: S, cloneOnNotify: boolean = true): void {
    // 无订阅者时直接返回：避免高频 setState 下零订阅场景仍执行深拷贝（cloneOnNotify=true 时尤为明显）
    if (this._listeners.size === 0) {
      return
    }
    // 零拷贝的前提是「没有可写订阅者」：此时载荷被所有回调共享，
    // 任一可写回调就地修改载荷即直接改到活状态，且其他监听器同时看到半成品。
    // Store 侧按 hasWritableListeners() 传值不会触发，此告警只为兜住 notify() 的
    // 直接调用方与将来的新调用点——违规只存在于类型层面，运行时此前毫无信号
    if (!cloneOnNotify && this._writableCount > 0 && !isProduction()) {
      console.warn(`[GeomStore][${this._storeName}] cloneOnNotify=false 与可写订阅者共存：监听器可修改共享载荷，存在数据污染风险`)
    }
    // 仅在循环前克隆一次，避免对每个监听器重复深拷贝整棵状态树
    // （cloneOnNotify=true 默认开启，单次克隆已能保证监听器间的引用隔离）
    const payload = cloneOnNotify ? deepCloneState(state) : state
    // 按注册次数展开：重复注册的监听器每次通知收到多次回调
    //
    // 快照语义是有意选择（与 Redux 的 listeners 快照一致）：本轮派发的对象是
    // 「进入 notify 时在册的注册」，派发过程中才失效的监听器（回调内退订自己、
    // 或本轮 add 触发 evict-oldest 把最旧注册挤掉）仍会被投递最后一次更新。
    // 不逐个复核在册状态有两点代价：一是热路径上每个回调都要回查 _listeners 及其
    // registrations 子 Map；二是「失效发生在第 k 个回调之前还是之后」取决于回调内部
    // 行为，复核只会让同一轮通知里各监听器看到的变更集合更不可预期。
    // 依赖退订立即生效的调用方需在回调内自行判定（如比对自持的存活标记）
    const listeners: Array<(state: S) => void> = []
    this._listeners.forEach((entry, listener) => {
      for (let i = 0; i < entry.registrations.size; i++) {
        listeners.push(listener)
      }
    })

    for (let i = 0; i < listeners.length; i++) {
      try {
        listeners[i](payload as S)
      } catch (error) {
        // 契约：单个监听器抛错不得中断其余监听器（异常必须被吞掉），但吞掉不等于丢失——
        // 开发期打印定位来源，生产期走宿主注入的上报通道（Store 接到 hooks 的 onError），
        // 否则一个持续抛错的订阅者会无声漏掉后续全部更新且无任何指标入口
        if (!isProduction()) {
          console.error('[GeomStore] Error in state listener:', error)
        }
        this._reportListenerError(error)
      }
    }
  }

  /**
   * 把监听器异常交给宿主注入的上报通道；通道自身抛错不得反噬 notify 流程
   *
   * @private
   */
  private _reportListenerError(error: unknown): void {
    const reporter = this._onListenerError
    if (!reporter) {
      return
    }
    try {
      reporter(error)
    } catch (reportError) {
      if (!isProduction()) {
        console.error('[GeomStore] Error in listener error reporter:', reportError)
      }
    }
  }
}

/**
 * 创建订阅函数返回值
 * 返回一个取消订阅的函数
 *
 * 句柄幂等：同一句柄重复调用只退订一次，不会误删同一回调的其他注册。
 * （此前按回调身份直接 delete，旧句柄的重复调用会额外扣减仍存活的注册计数，
 * 导致其他退订句柄持有的订阅凭空失效。）
 */
export function createSubscribeFunction<S extends State>(
  manager: SubscriptionManager<S>,
): (listener: StateListener<S>, options?: { readOnly?: boolean }) => () => void {
  return (listener: StateListener<S>, options?: { readOnly?: boolean }): (() => void) => {
    const registration = manager.add(listener, options)
    let consumed = false
    return () => {
      if (consumed) {
        return
      }
      consumed = true
      manager.delete(listener, registration)
    }
  }
}
