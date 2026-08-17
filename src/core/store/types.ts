/**
 * Store 内部类型定义
 *
 * 此模块定义 Store 内部使用的类型，不对外暴露
 */

import type { State, StateListener, StateProtectionOptions } from '../../types/store'

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

/**
 * Action 执行器接口
 */

export interface ActionExecutorInterface<
  _S extends State = State,
  A extends Record<string, (...args: unknown[]) => unknown> = Record<string, (...args: unknown[]) => unknown>,
> {
  /** 执行 action */
  execute(actionName: string, ...args: unknown[]): unknown
  /** 初始化 actions */
  initialize(actions: A, withInternalAccess: <T>(fn: () => T) => T): void
}

/**
 * Getter 执行器接口
 */
export interface GetterExecutorInterface<S extends State = State, G extends Record<string, (state: S) => unknown> = Record<string, (state: S) => unknown>> {
  /** 执行 getter */
  execute(getterName: string): unknown
  /** 初始化 getters */
  initialize(getters: G): void
}

/**
 * StateProxy 上下文接口
 * 用于在 StateProxy 模块中访问 Store 的必要方法
 */
export interface StateProxyContext {
  /** 检查是否内部访问 */
  isInternalAccess: boolean
  /** 状态保护配置 */
  stateProtection: InternalStateProtectionConfig
  /** 状态保护启用标志 */
  stateProtectionEnabled: boolean
  /** 处理非法修改 */
  handleIllegalMutation(path: string, value: unknown, operation?: string): boolean
  /** 使 Proxy 缓存失效 */
  invalidateProxyCache(obj?: object): void
}

/**
 * 状态管理器上下文接口
 */
export interface StateManagerContext<S extends State = State> {
  /** 获取内部状态 */
  getInternalState(): S
  /** 设置内部状态 */
  setInternalState(state: S): void
  /** 内部访问执行 */
  withInternalAccess<T>(fn: () => T): T
  /** 通知监听器 */
  notifyListeners(): void
  /** 更新缓存 */
  updateCache<K extends keyof S>(key: K, value: S[K]): void
  /** 检查是否在 dispatch 中 */
  readonly isDispatching: boolean
  /** 获取 Proxy 缓存 */
  getProxyCache(): ProxyCache
}
