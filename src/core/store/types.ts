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
 *
 * 形状与 `SubscriptionManager` 的公开面**逐项一致**（含 `add` 返回的注册句柄）：
 * 早先这里把 `add` 写成返回 `void`、`delete` 写成只接受监听器，方法双变性让这个
 * `implements` 照样编译通过，但按接口编程的调用方拿不到句柄，只能走
 * `delete(listener)` 这条「退最早一份注册」的路径——同一函数注册 N 次时它会退掉
 * 不是它要退的那一份，正是实现侧已裁定为误用面并修掉的写法（见
 * SubscriptionManager.createSubscribeFunction 的句柄幂等说明）。
 */
export interface SubscriptionManagerInterface<S extends State = State> {
  /**
   * 添加监听器，返回该次注册的句柄
   *
   * 句柄是 `delete` 的第二参：同一监听器注册 N 次时只有句柄能指明退哪一份。
   */
  add(listener: StateListener<S>, options?: { readOnly?: boolean }): object
  /**
   * 移除监听器
   *
   * 传 `registration` 时只移除该次注册；不传时移除该监听器**最早**的一份注册
   * （不是「全部」，也不是「刚 add 的那一份」），故与 `add` 的返回值不配对。
   */
  delete(listener: StateListener<S>, registration?: object): boolean
  /** 清空所有监听器 */
  clear(): void
  /** 监听器数量（按注册次数计） */
  readonly size: number
  /** 是否存在可写（非只读）监听器：决定通知载荷是否需要深拷贝隔离 */
  hasWritableListeners(): boolean
  /**
   * 通知所有监听器
   *
   * @param cloneOnNotify true=由本方法按注册可写性拷贝载荷；false=调用方已处置载荷，
   *   本方法保持零拷贝（缺省 true）
   */
  notify(state: S, cloneOnNotify?: boolean): void
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
