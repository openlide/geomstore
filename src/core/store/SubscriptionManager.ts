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

import type { State, StateListener, SubscriberLimitPolicy } from '../../types/store'
import type { SubscriptionManagerInterface } from './types'
import { deepCloneState, isProduction } from './utils'

/**
 * 订阅管理器配置
 */
export interface SubscriptionManagerOptions {
  /** 最大订阅者数量 */
  maxSubscribers?: number
  /** Store 名称（用于日志） */
  storeName: string
  /** 通知时是否深拷贝状态（默认 true；关闭时由调用方传入只读保护后的状态） */
  cloneOnNotify?: boolean
  /** 订阅者达到上限时的策略（默认 'evict-oldest'） */
  onLimit?: SubscriberLimitPolicy
}

/**
 * 订阅管理器
 *
 * 负责管理状态监听器的生命周期
 */
export class SubscriptionManager<S extends State = State> implements SubscriptionManagerInterface<S> {
  /** 监听器 → 注册信息：同一函数注册 N 次通知 N 次，任一份退订只减一（Redux/Vuex 同语义） */
  private readonly _listeners: Map<StateListener<S>, { count: number; readOnly: boolean }> = new Map()
  /** 可写（非只读）监听器注册总次数：仅当存在可写订阅者时才需深拷贝做引用隔离 */
  private _writableCount = 0
  private readonly _maxSubscribers: number
  private readonly _storeName: string
  private readonly _cloneOnNotify: boolean
  private readonly _onLimit: SubscriberLimitPolicy

  constructor(options: SubscriptionManagerOptions) {
    this._maxSubscribers = options.maxSubscribers ?? 50
    this._storeName = options.storeName
    this._cloneOnNotify = options.cloneOnNotify ?? true
    this._onLimit = options.onLimit ?? 'evict-oldest'
  }

  /**
   * 获取监听器数量（按注册次数计）
   */
  get size(): number {
    let total = 0
    this._listeners.forEach((entry) => {
      total += entry.count
    })
    return total
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
   * @param options.readOnly 标记为只读订阅（仅读取状态、不修改），可让 Store 在仅有只读订阅时跳过深拷贝
   */
  add(listener: StateListener<S>, options?: { readOnly?: boolean }): void {
    const existing = this._listeners.get(listener)
    if (existing !== undefined) {
      existing.count += 1
      return
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

    const readOnly = options?.readOnly ?? false
    this._listeners.set(listener, { count: 1, readOnly })
    if (!readOnly) {
      this._writableCount += 1
    }
  }

  /**
   * 移除监听器：存在多份注册时只减一，最后一次调用才真正移除
   */
  delete(listener: StateListener<S>): boolean {
    const entry = this._listeners.get(listener)
    if (entry === undefined) {
      return false
    }
    if (entry.count <= 1) {
      this._listeners.delete(listener)
      if (!entry.readOnly) {
        this._writableCount -= 1
      }
    } else {
      entry.count -= 1
    }
    return true
  }

  /**
   * 清空所有监听器
   */
  clear(): void {
    this._listeners.clear()
    this._writableCount = 0
  }

  /**
   * 通知所有监听器
   *
   * 优化：
   * - 使用数组遍历比 Map.forEach 更快
   * - cloneOnNotify=true（默认）：创建状态深拷贝避免引用共享问题
   * - cloneOnNotify=false：零拷贝模式，调用方（Store）负责传入只读保护后的状态
   *
   * @param cloneOnNotify 可选覆盖，缺省沿用构造配置。Store 据此在「仅只读订阅」场景下跳过深拷贝
   */
  notify(state: S, cloneOnNotify: boolean = this._cloneOnNotify): void {
    // 无订阅者时直接返回：避免高频 setState 下零订阅场景仍执行深拷贝（cloneOnNotify=true 时尤为明显）
    if (this._listeners.size === 0) {
      return
    }
    // 仅在循环前克隆一次，避免对每个监听器重复深拷贝整棵状态树
    // （cloneOnNotify=true 默认开启，单次克隆已能保证监听器间的引用隔离）
    const payload = cloneOnNotify ? deepCloneState(state) : state
    // 按注册次数展开：重复注册的监听器每次通知收到多次回调
    const listeners: Array<(state: S) => void> = []
    this._listeners.forEach((entry, listener) => {
      for (let i = 0; i < entry.count; i++) {
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
 */
export function createSubscribeFunction<S extends State>(manager: SubscriptionManager<S>): (listener: StateListener<S>, options?: { readOnly?: boolean }) => () => void {
  return (listener: StateListener<S>, options?: { readOnly?: boolean }): (() => void) => {
    manager.add(listener, options)
    return () => {
      manager.delete(listener)
    }
  }
}
