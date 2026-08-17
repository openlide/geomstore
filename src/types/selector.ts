/**
 * GeomStore v1.0 - 选择器类型定义
 */

/**
 * 选择器函数类型
 */
export type Selector<S extends Record<string, unknown> = Record<string, unknown>, R = unknown> = (state: S) => R

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
}

/**
 * 组合选择器参数
 */
export interface SelectorComposerInput<
  S extends Record<string, unknown> = Record<string, unknown>,
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
export type ParametricSelector<S extends Record<string, unknown>, P, R> = (state: S, params: P) => R

/**
 * 选择器结果类型
 */
export type SelectorResult<R> = {
  value: R
  fromCache: boolean
}
