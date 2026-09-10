/**
 * GeomStore - 选择器类型定义
 */

import type { State } from './store.js'

/**
 * 选择器函数类型
 *
 * 约束用 `State`（即 `object`）而非 `Record<string, unknown>`：与 Store 的状态约束口径保持一致，
 * 使**未声明索引签名的业务 interface**（如 `interface OrderState { … }`）可直接作为状态类型；
 * 后者只接受带索引签名的类型，会把这类 interface 拒之门外。
 * 默认值仍为 `Record<string, unknown>`，既有写法行为不变。
 */
export type Selector<S extends State = Record<string, unknown>, R = unknown> = (state: S) => R

/**
 * 选择器选项
 */
export interface SelectorOptions {
  /** 是否启用缓存 */
  cache?: boolean
  /** 缓存大小 */
  cacheSize?: number
  /** 缓存过期时间（毫秒） */
  cacheTTL?: number
  /** 比较函数 */
  equalityFn?: (a: unknown, b: unknown) => boolean
}

/**
 * 选择器缓存项
 */
export interface SelectorCacheItem<R> {
  /** 缓存的值 */
  value: R
  /** 缓存的时间戳 */
  timestamp: number
  /** 缓存的state引用 */
  state: unknown
  /**
   * 缓存条目对应的状态版本号（来自 Store 的变更计数）。
   * 有值时命中判定退化为 O(1) 整数比较，无需 deepEqual 全树比较；
   * 为 undefined 表示状态无版本标记（普通对象），回退到 equalityFn 比较。
   */
  version?: number
}

/**
 * 组合选择器参数
 */
export interface SelectorComposerInput<
  S extends State = Record<string, unknown>,
  T extends readonly Selector<S, unknown>[] = readonly Selector<S, unknown>[],
> {
  /** 选择器数组 */
  selectors: [...T]
  /**
   * 组合函数
   *
   * 参数刻意保持 any[]：元组 mapped type 在严格泛型下推断失效
   * （combiner 实参类型由调用方泛型推断保证，见 compose.ts）
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  combiner: (...results: any[]) => unknown
}

/**
 * 参数化选择器
 */
export type ParametricSelector<S extends State, P, R> = (state: S, params: P) => R

/**
 * 选择器结果类型
 */
export type SelectorResult<R> = {
  value: R
  fromCache: boolean
}
