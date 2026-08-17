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
  private readonly _listeners: Set<StateListener<S>> = new Set()
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
   * 获取监听器数量
   */
  get size(): number {
    return this._listeners.size
  }

  /**
   * 添加监听器
   *
   * 达到上限时按 onLimit 策略处理：
   * - evict-oldest：警告并驱逐最早的订阅者（默认）
   * - throw：抛出错误，避免订阅者无声丢失状态更新
   */
  add(listener: StateListener<S>): void {
    if (this._listeners.size >= this._maxSubscribers) {
      if (this._onLimit === 'throw') {
        throw new Error(
          `[GeomStore][${this._storeName}] Subscriber limit reached (${this._maxSubscribers}). Unsubscribe unused listeners or increase maxSubscribers.`,
        )
      }
      console.warn(`[GeomStore][${this._storeName}] 订阅者数量已达到上限(${this._maxSubscribers})`)
      const firstListener = this._listeners.values().next().value
      if (firstListener) {
        this._listeners.delete(firstListener)
      }
    }

    this._listeners.add(listener)
  }

  /**
   * 移除监听器
   */
  delete(listener: StateListener<S>): boolean {
    return this._listeners.delete(listener)
  }

  /**
   * 清空所有监听器
   */
  clear(): void {
    this._listeners.clear()
  }

  /**
   * 通知所有监听器
   *
   * 优化：
   * - 使用数组遍历比 Set.forEach 更快
   * - cloneOnNotify=true（默认）：创建状态深拷贝避免引用共享问题
   * - cloneOnNotify=false：零拷贝模式，调用方（Store）负责传入只读保护后的状态
   */
  notify(state: S): void {
    const listeners = [...this._listeners]
    // 默认创建状态深拷贝，确保监听器接收完全独立的副本
    const currentState = this._cloneOnNotify ? deepCloneState(state) : state

    for (let i = 0; i < listeners.length; i++) {
      try {
        listeners[i](currentState as S)
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
export function createSubscribeFunction<S extends State>(manager: SubscriptionManager<S>): (listener: StateListener<S>) => () => void {
  return (listener: StateListener<S>): (() => void) => {
    manager.add(listener)
    return () => {
      manager.delete(listener)
    }
  }
}
