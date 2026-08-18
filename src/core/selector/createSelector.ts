/**
 * GeomStore v1.0 - 选择器创建
 *
 * 提供创建记忆化选择器的功能，支持缓存和性能优化
 *
 * @since 1.0.0
 */

import type { Selector, SelectorOptions, SelectorCacheItem, SelectorResult } from '../../types/selector'
import { shallowEqual } from '../utils/helpers'

/**
 * 选择器工厂类
 *
 * 管理选择器的执行、缓存和缓存策略
 *
 * @class SelectorFactory
 * @template S - 状态类型
 * @template R - 返回值类型
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const factory = new SelectorFactory(
 *   (state) => state.value * 2,
 *   {
 *     cache: true,
 *     cacheSize: 10,
 *     cacheTTL: 5000,
 *     equalityFn: shallowEqual
 *   }
 * )
 *
 * // 执行选择器
 * const result = factory.execute({ value: 10 })
 * console.log(result) // 20
 * ```
 */
export class SelectorFactory<S extends Record<string, unknown> = Record<string, unknown>, R = unknown> {
  /**
   * 选择器函数
   * @private
   * @type {Selector<S, R>}
   */
  private selector: Selector<S, R>

  /**
   * 当前缓存
   * @private
   * @type {SelectorCacheItem<R> | null}
   */
  private cache: SelectorCacheItem<R> | null = null

  /**
   * 缓存选项
   * @private
   * @type {Required<SelectorOptions>}
   */
  private options: Required<SelectorOptions>

  /**
   * 缓存历史记录
   * @private
   * @type {SelectorCacheItem<R>[]}
   */
  private cacheHistory: SelectorCacheItem<R>[] = []

  /**
   * 创建选择器工厂实例
   *
   * @param {Selector<S, R>} selector - 选择器函数
   * @param {SelectorOptions} [options={}] - 缓存选项
   *
   * @example
   * ```typescript
   * const factory = new SelectorFactory(
   *   (state) => state.user.name,
   *   {
   *     cache: true,
   *     cacheSize: 10,
   *     cacheTTL: 5000
   *   }
   * )
   * ```
   */
  constructor(selector: Selector<S, R>, options: SelectorOptions = {}) {
    this.selector = selector
    this.options = {
      cache: options.cache ?? true,
      cacheSize: options.cacheSize ?? 10,
      cacheTTL: options.cacheTTL ?? 5000,
      equalityFn: options.equalityFn ?? shallowEqual,
    }
  }

  /**
   * 执行选择器
   *
   * 根据缓存配置决定是使用缓存还是重新计算
   *
   * @param {S} state - 状态对象
   * @returns {R} 选择器结果
   *
   * @example
   * ```typescript
   * const factory = new SelectorFactory((s) => s.value * 2)
   * const result1 = factory.execute({ value: 10 })
   * const result2 = factory.execute({ value: 10 })
   * // 第二次执行会使用缓存
   * ```
   */
  execute(state: S): R {
    // 检查缓存：最近一条优先，其次回溯缓存历史（cacheSize 条目均参与命中，
    // 修复此前仅命中单条缓存导致交替状态输入时每次都 miss、cacheSize 形同虚设的问题）
    if (this.options.cache) {
      const hit = this.findCacheHit(state)
      if (hit) {
        return hit.value
      }
    }

    // 执行选择器
    const value = this.selector(state)

    // 更新缓存
    if (this.options.cache) {
      this.updateCache(state, value)
    }

    return value
  }

  /**
   * 判断缓存条目是否命中（状态相等且未过期）
   *
   * @private
   */
  private isCacheHit(item: SelectorCacheItem<R>, state: S, now: number): boolean {
    const stateEqual = this.options.equalityFn ? this.options.equalityFn(item.state, state) : item.state === state
    return stateEqual && item.timestamp + this.options.cacheTTL > now
  }

  /**
   * 查找命中的缓存条目：最近一条优先，其次回溯 cacheHistory（最新在后），
   * 命中历史条目时将其提升为当前缓存（LRU 语义）
   *
   * @private
   * @returns 命中的缓存条目；未命中返回 null
   */
  private findCacheHit(state: S): SelectorCacheItem<R> | null {
    const now = Date.now()

    if (this.cache && this.isCacheHit(this.cache, state, now)) {
      return this.cache
    }

    for (let i = this.cacheHistory.length - 1; i >= 0; i--) {
      if (this.isCacheHit(this.cacheHistory[i], state, now)) {
        const hit = this.cacheHistory[i]
        this.cache = hit
        this.cacheHistory.splice(i, 1)
        this.cacheHistory.push(hit)
        return hit
      }
    }

    return null
  }

  /**
   * 更新缓存
   *
   * @private
   * @param {S} state - 状态对象
   * @param {R} value - 计算结果
   */
  private updateCache(state: S, value: R): void {
    const cacheItem: SelectorCacheItem<R> = {
      value,
      timestamp: Date.now(),
      state,
    }

    // 更新当前缓存
    this.cache = cacheItem

    // 更新缓存历史
    this.cacheHistory.push(cacheItem)

    // 限制缓存历史大小
    if (this.cacheHistory.length > this.options.cacheSize) {
      this.cacheHistory.shift()
    }
  }

  /**
   * 清除缓存
   *
   * 清除所有缓存，下次执行会重新计算
   *
   * @example
   * ```typescript
   * factory.clearCache()
   * const result = factory.execute(state)
   * // 这次会重新计算，不使用缓存
   * ```
   */
  clearCache(): void {
    this.cache = null
    this.cacheHistory = []
  }

  /**
   * 获取缓存状态
   *
   * @returns {{hasCache: boolean, cacheSize: number, cacheHit?: SelectorCacheItem<R>}} 缓存状态信息
   *
   * @example
   * ```typescript
   * const status = factory.getCacheStatus()
   * console.log('Has cache:', status.hasCache)
   * console.log('Cache size:', status.cacheSize)
   * console.log('Last cache hit:', status.cacheHit)
   * ```
   */
  getCacheStatus(): {
    hasCache: boolean
    cacheSize: number
    cacheHit?: SelectorCacheItem<R>
  } {
    return {
      hasCache: this.cache !== null,
      cacheSize: this.cacheHistory.length,
      cacheHit: this.cache || undefined,
    }
  }

  /**
   * 创建带有缓存结果的选择器
   *
   * 返回的选择器会返回一个对象，包含值和是否来自缓存的信息
   *
   * @returns {Selector<S, SelectorResult<R>>} 包含缓存信息的选择器
   *
   * @example
   * ```typescript
   * const factory = new SelectorFactory((s) => s.value)
   * const resultSelector = factory.withCacheResult()
   *
   * const result1 = resultSelector(state)
   * console.log(result1.value, result1.fromCache) // 10, false
   *
   * const result2 = resultSelector(state)
   * console.log(result2.value, result2.fromCache) // 10, true
   * ```
   */
  withCacheResult(): Selector<S, SelectorResult<R>> {
    return (state: S) => {
      // 与 execute 共用同一套命中查找（含 cacheHistory），保证 fromCache 标记一致
      if (this.options.cache) {
        const hit = this.findCacheHit(state)
        if (hit) {
          return { value: hit.value, fromCache: true }
        }
      }

      const value = this.selector(state)
      if (this.options.cache) {
        this.updateCache(state, value)
      }
      return { value, fromCache: false }
    }
  }
}

/**
 * 创建选择器
 *
 * 创建一个可缓存的选择器，用于从状态中派生数据
 *
 * @template S - 状态类型
 * @template R - 返回值类型
 * @param {Selector<S, R>} selectorFn - 选择器函数
 * @param {SelectorOptions} [options] - 缓存选项
 * @returns {Selector<S, R>} 选择器函数
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * // 基础选择器
 * const doubleValue = createSelector(
 *   (state) => state.value * 2
 * )
 *
 * // 带选项的选择器
 * const cachedSelector = createSelector(
 *   (state) => state.user.name,
 *   {
 *     cache: true,
 *     cacheTTL: 10000,
 *     equalityFn: (a, b) => a === b
 *   }
 * )
 *
 * // 使用
 * const result = doubleValue({ value: 10 })
 * console.log(result) // 20
 * ```
 */
export function createSelector<S extends Record<string, unknown>, R>(selectorFn: Selector<S, R>, options?: SelectorOptions): Selector<S, R> {
  const factory = new SelectorFactory(selectorFn, options)

  // Object.assign 附加 factory 对象（用于测试和高级用法），避免 any 断言
  const selector = Object.assign((state: S): R => factory.execute(state), { factory })

  return selector
}

/**
 * 创建记忆化选择器
 *
 * 创建一个启用的缓存的选择器，默认缓存
 *
 * @template S - 状态类型
 * @template R - 返回值类型
 * @param {Selector<S, R>} selectorFn - 选择器函数
 * @param {(a: unknown, b: unknown) => boolean} [equalityFn] - 自定义相等性函数
 * @returns {Selector<S, R>} 记忆化选择器
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const memoizedSelector = createMemoizedSelector(
 *   (state) => state.user.name,
 *   (a, b) => a === b
 * )
 *
 * // 相同输入只会计算一次
 * memoizedSelector(state) // 计算并缓存
 * memoizedSelector(state) // 使用缓存
 * ```
 */
export function createMemoizedSelector<S extends Record<string, unknown>, R>(
  selectorFn: Selector<S, R>,
  equalityFn?: (a: unknown, b: unknown) => boolean,
): Selector<S, R> {
  return createSelector(selectorFn, {
    cache: true,
    equalityFn,
  })
}

/**
 * 创建参数化选择器
 *
 * 创建一个接受参数的选择器，支持对不同参数的缓存
 *
 * @template S - 状态类型
 * @template P - 参数类型
 * @template R - 返回值类型
 * @param {(state: S, params: P) => R} selectorFn - 接受参数的选择器函数
 * @param {object} [options] - 缓存配置选项
 * @param {number} [options.ttl=5000] - 缓存生存时间（毫秒）
 * @param {number} [options.maxEntries=1000] - 单个 state 下原始类型参数的缓存条目上限
 * @returns {(state: S) => (params: P) => R} 参数化选择器工厂
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const getUserById = createParametricSelector(
 *   (state, userId) => state.users[userId],
 *   { ttl: 10000 } // 自定义缓存有效期
 * )
 *
 * const getState = (state) => state
 * const getUser = getUserById(getState)
 *
 * // 使用不同的参数
 * const user1 = getUser('user1')
 * const user2 = getUser('user2')
 * // 每个参数独立缓存
 * ```
 */
export function createParametricSelector<S extends Record<string, unknown>, P, R>(
  selectorFn: (state: S, params: P) => R,
  options: { ttl?: number; maxEntries?: number } = {},
): (state: S) => (params: P) => R {
  const { ttl = 5000, maxEntries = 1000 } = options

  // 使用 WeakMap 缓存，避免内存泄漏
  // 外层 WeakMap: state object -> 内层缓存
  // 对于对象参数使用 WeakMap，原始类型使用 Map
  const stateCache = new WeakMap<
    object,
    {
      objectParamsCache: WeakMap<object, { value: R; timestamp: number }>
      primitiveParamsCache: Map<string | number | boolean | symbol | null | undefined, { value: R; timestamp: number }>
    }
  >()

  /**
   * 原始类型参数缓存写入前的维护：清理过期条目，
   * 超容量时淘汰最早插入条目（Map 保持插入顺序），
   * 避免高基数参数场景下 Map 无界增长
   */
  const maintainPrimitiveCache = (cacheMap: Map<string | number | boolean | symbol | null | undefined, { value: R; timestamp: number }>, now: number): void => {
    if (ttl > 0) {
      for (const [key, entry] of cacheMap) {
        if (entry.timestamp + ttl <= now) {
          cacheMap.delete(key)
        }
      }
    }
    for (const key of cacheMap.keys()) {
      if (cacheMap.size < maxEntries) {
        break
      }
      cacheMap.delete(key)
    }
  }

  return (state: S) => {
    return (params: P): R => {
      const now = Date.now()

      // 获取或创建 state 对应的缓存
      let cache = stateCache.get(state as object)
      if (!cache) {
        cache = {
          objectParamsCache: new WeakMap(),
          primitiveParamsCache: new Map(),
        }
        stateCache.set(state as object, cache)
      }

      // 根据参数类型选择不同的缓存策略
      const isObjectParam = typeof params === 'object' && params !== null

      if (isObjectParam) {
        // 对象参数：使用 WeakMap 避免内存泄漏
        const cached = cache.objectParamsCache.get(params as object)
        if (cached && cached.timestamp + ttl > now) {
          return cached.value
        }

        // 执行选择器
        const value = selectorFn(state, params)

        // 存入缓存
        cache.objectParamsCache.set(params as object, { value, timestamp: now })

        return value
      } else {
        // 原始类型参数：使用普通 Map
        const cacheKey = params as string | number | boolean | symbol | null | undefined
        const cached = cache.primitiveParamsCache.get(cacheKey)
        if (cached && cached.timestamp + ttl > now) {
          return cached.value
        }

        // 执行选择器
        const value = selectorFn(state, params)

        // 存入缓存（写入前维护容量与过期条目）
        maintainPrimitiveCache(cache.primitiveParamsCache, now)
        cache.primitiveParamsCache.set(cacheKey, { value, timestamp: now })

        return value
      }
    }
  }
}

/**
 * 创建组合选择器
 *
 * 从多个选择器组合成一个对象，便于批量获取派生状态
 *
 * @template S - 状态类型
 * @template R - 返回结构类型（默认从选择器映射推断）
 * @param {[K in keyof R]?: Selector<S, R[K]>} selectors - 选择器映射
 * @returns {Selector<S, R>} 组合选择器
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * // 也可显式指定状态类型：createStructuredSelector<AppState>({ ... })
 * const selector = createStructuredSelector({
 *   userName: (state) => state.user.name,
 *   userEmail: (state) => state.user.email,
 *   userAge: (state) => state.user.age
 * })
 *
 * const result = selector(state)
 * console.log(result) // { userName: '...', userEmail: '...', userAge: ... }
 * ```
 */
export function createStructuredSelector<S extends Record<string, unknown>, R extends Record<string, unknown> = Record<string, unknown>>(selectors: {
  [K in keyof R]?: Selector<S, R[K]>
}): Selector<S, R> {
  return (state: S) => {
    const result: Record<string, unknown> = {}

    for (const [key, selector] of Object.entries(selectors)) {
      if (typeof selector === 'function') {
        result[key] = selector(state)
      }
    }

    return result as unknown as R
  }
}
