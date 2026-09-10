/**
 * Store 内部类型定义
 *
 * 此模块定义 Store 内部使用的类型，不对外暴露
 */

import type { State, StateListener, StateProtectionOptions } from '../../types/store.js'

/**
 * 状态保护配置（内部使用，包含所有默认值）
 */
export type InternalStateProtectionConfig = Required<StateProtectionOptions>

/**
 * Proxy 缓存接口
 *
 * 基于 WeakMap 实现，不支持 clear()（WeakMap 无法枚举）。
 * 如需清空缓存，请通过 createProxyCache() 重新创建实例。
 */
export interface ProxyCache {
  /** 获取缓存的 Proxy */
  get(target: object): unknown | undefined
  /** 设置 Proxy 缓存 */
  set(target: object, proxy: unknown): void
  /** 删除 Proxy 缓存 */
  delete(target: object): boolean
}

/**
 * 订阅管理器接口
 */
export interface SubscriptionManagerInterface<S extends State = State> {
  /** 添加监听器 */
  add(listener: StateListener<S>): void
  /** 移除监听器 */
  delete(listener: StateListener<S>): boolean
  /** 清空所有监听器 */
  clear(): void
  /** 获取监听器数量 */
  readonly size: number
  /** 通知所有监听器 */
  notify(state: S): void
}

/**
 * 批量更新管理器接口
 */
export interface BatchManagerInterface<_S extends State = State> {
  /** 开始批量更新 */
  start(): void
  /** 结束批量更新 */
  end(): void
  /** 是否在批量更新中 */
  readonly isInBatch: boolean
}

