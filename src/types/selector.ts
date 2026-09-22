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
 *
 * `R` 是组合结果的类型，与 `SelectorComposer.combine<S, R>` 的 `R` 同一个：
 * 由 `combiner` 的返回类型直接给出，`combine` 侧不再需要 `as R` 断言
 * （该断言此前把「combiner 返回了别的东西」——例如拼错的属性名——静默当成 `R`）。
 * 默认 `unknown` 保持既有两参数写法 `SelectorComposerInput<S, T>` 的行为不变。
 */
export interface SelectorComposerInput<
  S extends State = Record<string, unknown>,
  T extends readonly Selector<S, unknown>[] = readonly Selector<S, unknown>[],
  R = unknown,
> {
  /** 选择器数组 */
  selectors: [...T]
  /**
   * 组合函数
   *
   * 参数刻意保持 `any[]`（实测改 `unknown[]` 即破功）：调用方的 combiner 普遍写成
   * `(base: number, tax: number) => number` 这类**具体形参**，参数逆变下
   * `(a: number) => …` 不满足 `(a: unknown) => …`，直接编译失败；
   * 且 `combine` 内部是 `combiner(...results)` 的透传调用，形参类型由调用方泛型推断保证。
   * 返回值不再是 `unknown` 而是 `R`，见上方类型参数说明。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  combiner: (...results: any[]) => R
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
