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
  /** 监听器注册总次数（按注册次数计）：O(1) 维护，避免 size getter 每次遍历整表求和 */
  private _totalCount = 0

  constructor(options: SubscriptionManagerOptions) {
    this._maxSubscribers = options.maxSubscribers ?? 50
    this._storeName = options.storeName
    this._onLimit = options.onLimit ?? 'evict-oldest'
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
        // 生产环境移除详细日志
        if (!isProduction()) {
          console.error('[GeomStore] Error in state listener:', error)
        }
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
