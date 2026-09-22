/**
 * Store 内部类型定义
 *
 * 此模块定义 Store 内部使用的类型。
 *
 * 可见性口径：`InternalStateProtectionConfig` / `ProxyCache` /
 * `SubscriptionManagerInterface` / `BatchManagerInterface` 由 `core/store/index.js`
 * 的 barrel 再导出（该 barrel 自述「供高级用户使用」），但该子路径**不在 package.json 的
 * exports 映射**里，消费者从包名只能拿到 `./core`（`src/core/index.ts`，未含这四个类型）。
 * 因此它们对包外仍是内部件：形状可能随重构变动，不承诺语义稳定，破坏性调整不必升主版本。
 * 原注释笼统写「不对外暴露」，与 barrel 的实际再导出不一致，故按上述口径更正。
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
  /** 获取缓存的 Proxy；未命中返回 undefined（`unknown` 已含 undefined，无需并集；调用方需显式判 `!== undefined`） */
  get(target: object): unknown
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
 *
 * 无类型参数：批量语义与状态类型无关（BatchManager 只调度通知时机）
 */
export interface BatchManagerInterface {
  /** 开始批量更新 */
  start(): void
  /** 结束批量更新 */
  end(): void
  /** 是否在批量更新中 */
  readonly isInBatch: boolean
}
