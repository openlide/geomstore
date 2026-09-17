/**
 * GeomStore - 选择器创建
 *
 * 提供创建记忆化选择器的功能，支持缓存和性能优化
 *
 */

import type { Selector, SelectorOptions, SelectorCacheItem, SelectorResult } from '../../types/selector.js'
import type { State } from '../../types/store.js'
import { deepEqual, clone } from '../../core/utils/helpers.js'
import { getStateVersion } from '../../core/store/stateVersion.js'

/**
 * 选择器工厂类
 *
 * 管理选择器的执行、缓存和缓存策略
 *
 * @class SelectorFactory
 * @template S - 状态类型
 * @template R - 返回值类型
 *
 * @example
 * ```typescript
 * const factory = new SelectorFactory(
 *   (state) => state.value * 2,
 *   {
 *     cache: true,
 *     cacheSize: 10,
 *     cacheTTL: 5000,
 *     equalityFn: deepEqual
 *   }
 * )
 *
 * // 执行选择器
 * const result = factory.execute({ value: 10 })
 * console.log(result) // 20
 * ```
 */
export class SelectorFactory<S extends State = Record<string, unknown>, R = unknown> {
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
      // 默认 deepEqual 而非引用/浅比较：Store 状态是就地变异的同一对象
      // （getState 返回活动引用、setState/$patch 原地写入），引用比较或浅比较
      // 会在状态已变化时误判相等，TTL 内返回陈旧值。
      // 显式传入 falsy（false/0/''）视同未提供，统一回退默认
      equalityFn: options.equalityFn || deepEqual,
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
  private isCacheHit(item: SelectorCacheItem<R>, state: S, now: number, stateVersion: number | undefined): boolean {
    // TTL 判定先行：比状态比较便宜，过期条目无需再比较
    if (item.timestamp + this.options.cacheTTL <= now) {
      return false
    }
    // 版本号由各 Store 独立计数；版本化条目保留原状态引用，须同时校验身份与版本。
    if (item.version !== undefined && stateVersion !== undefined) {
      return item.state === state && item.version === stateVersion
    }
    // 回退：状态无版本标记（非 Store 状态，如直接传入的普通对象），沿用 equalityFn 比较
    // equalityFn 在构造期已归一化（未提供时回退默认 deepEqual），类型上恒为函数，无需 falsy 兜底分支
    return this.options.equalityFn(item.state, state)
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
    // 版本号只读取一次，供全部候选条目比较复用（O(1)）
    const stateVersion = getStateVersion(state)

    if (this.cache && this.isCacheHit(this.cache, state, now, stateVersion)) {
      return this.cache
    }

    // 版本化场景：版本号单调递增，历史条目的版本号必然小于当前值，回溯不可能命中
    // （当前 cache 未命中说明版本已变或已过期），直接判定 miss。
    // 此处仍保留向 cacheHistory 写入，使 getCacheStatus().cacheSize 语义不变。
    // 只有同一状态对象的版本变化才能跳过历史；跨 Store 时仍需搜索其他身份的条目。
    if (stateVersion !== undefined && this.cache?.version !== undefined && this.cache.state === state) {
      return null
    }

    for (let i = this.cacheHistory.length - 1; i >= 0; i--) {
      if (this.isCacheHit(this.cacheHistory[i], state, now, stateVersion)) {
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
    // 仅深比较（默认 equalityFn = deepEqual）时缓存状态快照，其余情况缓存活动引用：
    // - deepEqual 需快照才能在状态就地变异时感知变化——否则 deepEqual(同引用, 同引用) 永远相等，
    //   无法检测变异，TTL 内返回陈旧值；
    // - 引用相等 (a === b) 场景下若仍 clone，则「克隆体」与当前「活引用」永不等 → 永远 miss，
    //   故直接缓存活引用，使同一引用命中、不同引用（含变异后的新对象）正确 miss。
    const version = getStateVersion(state)
    // 有版本号：命中判定改用版本比较，不再依赖内容快照，故无需克隆整棵状态树；
    // 无版本号（普通对象）时仍需快照，否则就地变异无法被 deepEqual 感知
    const stateForCache = version === undefined && this.options.equalityFn === deepEqual ? clone(state) : state
    const cacheItem: SelectorCacheItem<R> = {
      value,
      timestamp: Date.now(),
      state: stateForCache,
      version,
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
 * 限制：缓存对状态的比较基于 `clone(state)` 快照，而 clone（即 deepCloneState）对
 * 不可克隆对象（类实例、Promise、WeakMap/WeakSet 等）保留原引用而非拷贝。因此若
 * state 里放了类实例并就地修改其字段，快照与活状态共享同一实例，比较会因引用相等
 * 判定「未变化」，TTL 内返回陈旧值。规避：用 setState/$patch 整体替换该字段，
 * 让状态树产生新的纯对象。纯对象/数组/Date/RegExp/Map/Set 会被正确深拷贝，不受影响。
 *
 * @template S - 状态类型
 * @template R - 返回值类型
 * @param {Selector<S, R>} selectorFn - 选择器函数
 * @param {SelectorOptions} [options] - 缓存选项
 * @returns {Selector<S, R>} 选择器函数
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
export function createSelector<S extends State, R>(selectorFn: Selector<S, R>, options?: SelectorOptions): Selector<S, R> {
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
export function createMemoizedSelector<S extends State, R>(selectorFn: Selector<S, R>, equalityFn?: (a: unknown, b: unknown) => boolean): Selector<S, R> {
  return createSelector(selectorFn, {
    cache: true,
    equalityFn,
  })
}

// 参数化选择器已拆至 ./parametricSelector.js；此处再导出以保持既有导入路径不变
export { createParametricSelector } from './parametricSelector.js'

/**
 * 创建组合选择器
 *
 * 从多个选择器组合成一个对象，便于批量获取派生状态
 *
 * @template S - 状态类型
 * @template R - 返回结构类型（默认从选择器映射推断）
 * @param {[K in keyof R]?: Selector<S, R[K]>} selectors - 选择器映射
 * @returns {Selector<S, R>} 组合选择器
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
export function createStructuredSelector<S extends State, R extends object = Record<string, unknown>>(selectors: {
  [K in keyof R]?: Selector<S, R[K]>
}): Selector<S, R> {
  return (state: S) => {
    const result: Record<string, unknown> = {}

    for (const [key, selector] of Object.entries(selectors)) {
      if (typeof selector === 'function') {
        // 以 DefineOwnProperty 语义写入：选择器映射用计算属性写法（{['__proto__']: fn}）
        // 可产生自有 __proto__ 键，result[key] = … 走 [[Set]] 会触发 Object.prototype 的
        // __proto__ setter——该项被静默丢弃且 result 原型被换掉
        Object.defineProperty(result, key, {
          value: selector(state),
          writable: true,
          enumerable: true,
          configurable: true,
        })
      }
    }

    return result as unknown as R
  }
}
