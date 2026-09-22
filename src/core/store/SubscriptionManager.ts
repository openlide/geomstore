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
 * 订阅者被驱逐时交给宿主的信息
 *
 * @see SubscriptionManagerOptions.onSubscriberEvicted
 */
export interface SubscriberEvictionInfo<S extends State = State> {
  /** 被驱逐的那一次注册所属的监听器（该监听器可能仍有其它注册存活） */
  listener: StateListener<S>
  /** 触发门禁的上限（`size` 已达该值才驱逐） */
  maxSubscribers: number
  /** 驱逐完成后、新注册写入前的注册总数 */
  size: number
}

/**
 * 订阅管理器配置
 *
 * 带类型参数只为 `onSubscriberEvicted` 的载荷能保住监听器的状态形状：
 * 回调形参按逆变比较，写成非通用的 `SubscriberEvictionInfo<State>` 会让
 * `SubscriptionManager<S>` 内部无法安全接收宿主为具体 S 提供的处理器。
 * 默认 `State`，不带参数的既有写法（如 `const o: SubscriptionManagerOptions`）不变
 */
export interface SubscriptionManagerOptions<S extends State = State> {
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
  /**
   * 订阅者被驱逐时的上报通道（可选）
   *
   * 与 `onListenerError` 同一诉求：`evict-oldest` 是默认策略，而在库口径里生产环境必须
   * 静默（不得写控制台），于是被驱逐的那一份订阅从此收不到任何状态更新、且没有任何
   * 指标入口，线上表现为「订阅莫名失效」而无法定位。由宿主接入（与 `onListenerError`
   * 同样走 Store 的 hooks.onError）即可同时保住静默与可观测性——该接线在 Store 侧尚未
   * 落地，故不配置时行为与既有一致（仅开发模式打印，且已带上被驱逐监听器的标识）
   */
  onSubscriberEvicted?: (info: SubscriberEvictionInfo<S>) => void
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
  private readonly _onSubscriberEvicted?: (info: SubscriberEvictionInfo<S>) => void
  /** 监听器注册总次数（按注册次数计）：O(1) 维护，避免 size getter 每次遍历整表求和 */
  private _totalCount = 0

  constructor(options: SubscriptionManagerOptions<S>) {
    this._maxSubscribers = options.maxSubscribers ?? 50
    this._storeName = options.storeName
    this._onLimit = options.onLimit ?? 'evict-oldest'
    this._onListenerError = options.onListenerError
    this._onSubscriberEvicted = options.onSubscriberEvicted
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
   * 上限门禁对**每一次注册**生效，包含同一监听器的重复注册：`size` 计的是注册次数，
   * 重复注册同样占额度、同样让 notify 多跑一遍回调。把它免检等于留下
   * 「循环订阅同一函数」这条无界增长路径（每次 `subscribe` 都产出新句柄，
   * 只要不退订就永久持有），maxSubscribers 作为泄漏护栏的目的在该路径上完全失效。
   * 达上限时按 onLimit 策略处理：
   * - evict-oldest：警告（开发模式）+ 上报宿主 + 驱逐一份最早注册
   *  （本次是重复注册时让位的是该监听器自己最早的那一份，不牵连其他监听器）
   * - throw：抛出错误，避免订阅者无声丢失状态更新
   *
   * 由此 `size <= maxSubscribers` 是常态不变量；唯一例外是 `maxSubscribers <= 0`
   * 配 evict-oldest——此时在册监听器为零、无可驱逐对象，首个订阅仍会成功
   *（该配置本身即「一个订阅者都不许注册」，不额外做拒绝）
   *
   * @param options.readOnly 标记为只读订阅（仅读取状态、不修改），可让 Store 在仅有只读订阅时跳过深拷贝
   */
  add(listener: StateListener<S>, options?: { readOnly?: boolean }): object {
    const registration = {}
    const readOnly = options?.readOnly ?? false
    if (this._totalCount >= this._maxSubscribers) {
      this._enforceLimit(listener)
    }
    const existing = this._listeners.get(listener)
    if (existing !== undefined) {
      existing.registrations.set(registration, readOnly)
    } else {
      this._listeners.set(listener, { registrations: new Map([[registration, readOnly]]) })
    }
    this._totalCount += 1
    if (!readOnly) {
      this._writableCount += 1
    }
    return registration
  }

  /**
   * 达到上限时按 onLimit 策略腾出额度（`add` 的任一路径都会走到）
   *
   * 驱逐对象优先取「本次要重复注册的那个监听器」自己最早的一份注册：
   * 重复订阅占的是额度，但不该由别的监听器买单。在册监听器按插入序排列，
   * 直接取全局最旧会让首个订阅者替后来的重复订阅丢名额。
   * 其余情况（新监听器）驱逐全局最旧的一份注册。
   *
   * 以「一份注册」为单位而非整条监听器：被驱逐的监听器可能注册了 N 份，
   * 整条删除会让用户仍持有的其余退订句柄全部变成静默 no-op，
   * 也与本类「注册 N 次通知 N 次、退订只减一」的计数语义不一致
   *
   * @private
   */
  private _enforceLimit(listener: StateListener<S>): void {
    if (this._onLimit === 'throw') {
      throw new Error(
        `[GeomStore][${this._storeName}] Subscriber limit reached (${this._maxSubscribers}). Unsubscribe unused listeners or increase maxSubscribers.`,
      )
    }
    const selfDuplicated = this._listeners.has(listener)
    const evicted = selfDuplicated ? listener : this._listeners.keys().next().value
    if (!isProduction()) {
      // 带上被驱逐者的可读标识：只报「达到上限」的日志在现场毫无定位价值，
      // 谁丢了更新才是需要回答的问题
      console.warn(
        `[GeomStore][${this._storeName}] 订阅者数量已达到上限(${this._maxSubscribers})${
          evicted === undefined
            ? ''
            : selfDuplicated
              ? `，本次重复订阅改由该监听器自己最早的一份注册让位`
              : `，已驱逐最早的监听器 ${evicted.name || '(匿名函数)'} 的一份注册`
        }`,
      )
    }
    if (evicted !== undefined) {
      this.delete(evicted)
      this._reportEviction(evicted)
    }
  }

  /**
   * 把驱逐事件交给宿主上报通道；通道自身抛错不得反噬注册流程
   *
   * @private
   */
  private _reportEviction(listener: StateListener<S>): void {
    const reporter = this._onSubscriberEvicted
    if (!reporter) {
      return
    }
    try {
      reporter({ listener, maxSubscribers: this._maxSubscribers, size: this._totalCount })
    } catch (reportError) {
      if (!isProduction()) {
        console.error('[GeomStore] Error in subscriber eviction reporter:', reportError)
      }
    }
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
   * 优化与职责边界（载荷分配）：
   * - 无监听器时直接返回，省去空轮的克隆
   * - cloneOnNotify=true（默认）：可写注册各得一份独立深拷贝，只读注册共用一份
   *  ⇒ 监听器之间的引用隔离由**本方法**负责
   * - cloneOnNotify=false：本方法一次都不拷贝，全部回调共享调用方传入的那个对象
   *  ⇒ 隔离责任在**调用方**：仅当「先执行的可写回调改不动这个载荷」时才安全
   *  （库内 `Store._notifyListeners` 目前一律传 false 并自备一份克隆，所以公开
   *  `store.subscribe(fn)` 路径上的监听器互改仍可见，须由该调用点改传 true 才闭环）
   *
   * @param cloneOnNotify 载荷的拷贝归属：true=由本方法按注册可写性拷贝；
   * false=调用方已处置载荷，本方法保持零拷贝
   */
  notify(state: S, cloneOnNotify: boolean = true): void {
    // 无订阅者时直接返回：避免高频 setState 下零订阅场景仍执行深拷贝（cloneOnNotify=true 时尤为明显）
    if (this._listeners.size === 0) {
      return
    }
    // 零拷贝的前提是「没有可写订阅者」：此时载荷被所有回调共享，
    // 任一可写回调就地修改载荷即直接改到活状态，且其他监听器同时看到半成品。
    // 本类做不到「既不拷贝又隔离」，故只对调用方发信号：`Store._notifyListeners`
    // 自备克隆后同样传 false，因此「存在可写订阅者」的每一轮 dispatch 都会打出此行
    // （dev-only），它指的正是上面那条未闭环的边界，改法见 notify 文档与台账 R5-122
    if (!cloneOnNotify && this._writableCount > 0 && !isProduction()) {
      console.warn(`[GeomStore][${this._storeName}] cloneOnNotify=false 与可写订阅者共存：监听器可修改共享载荷，存在数据污染风险`)
    }
    // 载荷按「注册的可写性」分配，而不是整轮共用一份：
    // 单次克隆只隔离了「载荷 ↔ 活状态」，没有隔离监听器彼此——先执行的可写回调
    // 就地改入参，同一轮里后面的监听器就会读到被改过的中间态。
    // 只读订阅不改载荷，继续共用一份，避免按订阅数等比例放大深拷贝开销；
    // 份数由 maxSubscribers 封顶（见 add 的门禁），不会因重复注册而无界扩张
    const hasReadOnlyRegistration = this._writableCount < this._totalCount
    const sharedPayload: S = cloneOnNotify && hasReadOnlyRegistration ? deepCloneState(state) : state
    // 按注册次数展开：重复注册的监听器每次通知收到多次回调
    //
    // 快照语义是有意选择（与 Redux 的 listeners 快照一致）：本轮派发的对象是
    // 「进入 notify 时在册的注册」，派发过程中才失效的监听器（回调内退订自己、
    // 或本轮 add 触发 evict-oldest 把最旧注册挤掉）仍会被投递最后一次更新。
    // 不逐个复核在册状态有两点代价：一是热路径上每个回调都要回查 _listeners 及其
    // registrations 子 Map；二是「失效发生在第 k 个回调之前还是之后」取决于回调内部
    // 行为，复核只会让同一轮通知里各监听器看到的变更集合更不可预期。
    // 依赖退订立即生效的调用方需在回调内自行判定（如比对自持的存活标记）
    // 两条平行数组而非槽位对象：零拷贝档（Store 主路径）每次 dispatch 都要走这里，
    // 逐个监听器再包一层对象只是白付分配开销
    const listeners: Array<StateListener<S>> = []
    const payloads: S[] = []
    this._listeners.forEach((entry, listener) => {
      for (const readOnly of entry.registrations.values()) {
        listeners.push(listener)
        payloads.push(cloneOnNotify && !readOnly ? deepCloneState(state) : sharedPayload)
      }
    })

    for (let i = 0; i < listeners.length; i++) {
      try {
        listeners[i](payloads[i])
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
