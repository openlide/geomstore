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
      // cacheSize 归一化：0 或负数会让刚 push 的条目立即被 shift 掉，this.cache 随之脱离
      // history（getCacheStatus 报出 hasCache:true 与 cacheSize:0 并存的矛盾状态）；
      // NaN 使 `length > NaN` 恒为 false，history 变成无界增长。口径与 LRUCache 的容量守卫一致
      cacheSize: Number.isFinite(options.cacheSize) ? Math.max(1, options.cacheSize as number) : 10,
      // cacheTTL 的取值守卫与 cacheSize 同一口径，但放行 Infinity（= 不按时间过期，
      // 只由版本号 / equalityFn 失效；对版本化状态是安全且有用的配置，例如常驻派生值）：
      // `NaN` 会让 `timestamp + NaN <= now` 恒为 false（条目永不过期，就地变异后仍返回陈旧值），
      // `0` / 负数则让每条缓存在写入即刻过期（静默退化成「不缓存」，却仍每次付克隆快照与 push 的成本）
      cacheTTL: typeof options.cacheTTL === 'number' && options.cacheTTL > 0 ? options.cacheTTL : 5000,
      // 默认 deepEqual 而非引用/浅比较：Store 状态是就地变异的同一对象
      // （getState 返回活动引用、setState/$patch 原地写入），引用比较或浅比较
      // 会在状态已变化时误判相等，TTL 内返回陈旧值。
      // 显式传入 falsy（false/0/''）视同未提供，统一回退默认
      equalityFn: options.equalityFn || deepEqual,
      // 无版本号状态的失效凭证，默认缓存内容快照（详见 SelectorOptions.snapshotState）。
      // 不用「equalityFn 是否恰好等于内置 deepEqual」的函数引用身份来推断：传 lodash
      // isEqual、`(a, b) => deepEqual(a, b)` 包装、或另一份模块副本（ESM/CJS 双实例）的
      // deepEqual 时都会被判成「身份比较」，于是缓存活引用，而 equalityFn 的两个实参
      // 是同一个对象、深比较恒等，就地变异看不见 → TTL 内持续返回陈旧值
      snapshotState: options.snapshotState ?? true,
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
    return this.resolve(state).value
  }

  /**
   * 缓存解析协议：命中查找（当前条目 + 历史回溯）→ 未命中则计算并写入缓存
   *
   * execute 与 withCacheResult 共用本方法，两者的差异只在返回包装。此前两处各写一遍
   * 「findCacheHit → selector → updateCache」，同一套协议要同步维护两份就会漂移
   * （findCacheHit 抽出之前两者就分叉过一次：withCacheResult 只查当前条目，
   * 命中 history 时 execute 判命中而它判未命中）。
   *
   * @private
   */
  private resolve(state: S): SelectorResult<R> {
    // 检查缓存：最近一条优先，其次回溯缓存历史（cacheSize 条目均参与命中，
    // 修复此前仅命中单条缓存导致交替状态输入时每次都 miss、cacheSize 形同虚设的问题）
    if (this.options.cache) {
      const hit = this.findCacheHit(state)
      if (hit) {
        return { value: hit.value, fromCache: true }
      }
    }

    // 执行选择器
    const value = this.selector(state)

    // 更新缓存
    if (this.options.cache) {
      this.updateCache(state, value)
    }

    return { value, fromCache: false }
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
    // 版本化条目 vs 无版本输入（普通对象）：二者没有可比的失效凭证
    // （版本不等价于内容相等），一律 miss；版本化条目仅可被版本化输入命中
    if (item.version !== undefined) {
      return false
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

    // 版本化场景：同一状态身份的版本号单调递增，历史条目的版本号必然小于当前值，
    // 回溯不可能命中（当前 cache 未命中说明版本已变或已过期），直接判定 miss。
    // 该结论依赖两条不变量，改动 stateVersion 侧时需一并复核：
    // (1) 版本号读自 Store 的 `_mutationCount`，只增不减；
    // (2) `defineStateVersion` 的 getter 只随状态对象的诞生装上（createStore / $replaceState
    //     换的是**新对象**），不会重置到复用对象上、也不重复 defineProperty。
    // 若将来出现「计数被重置后重新装载」（例如状态对象池复用），此处会跳过历史里仍然新鲜、
    // 身份相同的条目：表现为一次多余的重新计算，**不会返回错值**（未命中即重算）。
    // 回归用例见 tests/unit/r5-extras-selector-cache.test.ts 的「版本回退」条。
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
    // 缓存里放内容快照还是活引用，由 `snapshotState` 显式声明（口径见 SelectorOptions）：
    // - 快照：`equalityFn(快照, 当前状态)` 比内容，就地变异能被感知，任何深比较器都成立；
    // - 活引用：只有 `equalityFn` 是引用相等时才有意义——若仍存快照，克隆体与当前
    //   活引用永不相等 → 永远 miss。
    // 判据不再依赖「equalityFn 是否恰好是内置 deepEqual」这一函数身份：自定义深比较器
    // 走活引用路径会静默返回陈旧值。
    const version = getStateVersion(state)
    // 有版本号：命中判定改用版本比较，内容快照无用于事，不必克隆整棵状态树
    const stateForCache = version === undefined && this.options.snapshotState ? clone(state) : state
    const cacheItem: SelectorCacheItem<R> = {
      value,
      timestamp: Date.now(),
      state: stateForCache,
      version,
    }

    // 更新当前缓存
    this.cache = cacheItem

    // 写入前剔除历史里已过期的条目（读取侧本就按同一判据判 miss，留着它们只会白占槽位）：
    // 不剔的话多状态交替时过期条目会把仍有效的条目挤出 cacheSize（命中率下降），
    // 且过期条目的状态快照与结果值继续被强引用（内存驻留）。倒序遍历，splice 不影响未检查的下标
    const writtenAt = cacheItem.timestamp
    for (let i = this.cacheHistory.length - 1; i >= 0; i--) {
      if (this.cacheHistory[i].timestamp + this.options.cacheTTL <= writtenAt) {
        this.cacheHistory.splice(i, 1)
      }
    }

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
   * `cacheHit` 的口径要说明白：它返回的是 **当前缓存条目**（`this.cache`，即最近一次写入
   * 或因命中历史而被提升为当前的那条），与 `hasCache` 同源同值，**不是**「最近一次
   * 命中的那条」。命中查找走 findCacheHit，它可能返回 cacheHistory 里的任意一条，
   * 而本方法不记录那次查找的结果。字段名沿用 cacheHit 以保持既有公开面不变
   * （改名是当前缓存语义的破坏性变更，不属本轮 low），需要真正的「最近命中」请比较
   * `getCacheStatus().cacheHit` 与调用前后的 `cacheSize`/timestamp 自行推断
   *
   * @returns {{hasCache: boolean, cacheSize: number, cacheHit?: SelectorCacheItem<R>}} 缓存状态信息
   *
   * @example
   * ```typescript
   * const status = factory.getCacheStatus()
   * console.log('Has cache:', status.hasCache)
   * console.log('Cache size:', status.cacheSize)
   * console.log('Current cache entry:', status.cacheHit)
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
    // 与 execute 共用 resolve（含 cacheHistory 回溯），保证 fromCache 标记与
    // execute 的命中判定同口径，不再各写一份协议
    return (state: S) => this.resolve(state)
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
 * 让状态树产生新的纯对象。
 *
 * 会被克隆的类型要分两种看法看（口径与 `core/utils/clone.ts`、`core/utils/equality.ts` 一致）：
 * - 纯对象 / 数组 / Date / RegExp：克隆出的副本在 `deepEqual` 下与源可分辨，快照路径正常。
 * - **Map / Set**：实例本身会被重建，但**键也被深克隆**，键的引用身份随之改变；
 *   而 `deepEqual` 的 Map 分支按键的 SameValueZero（引用）匹配。于是状态里存在
 *   **对象键 Map** 时 `deepEqual(clone(state), state)` 恒为 false——风险方向与上面那条相反，
 *   不是返回陈旧值，而是无版本号的快照路径上**每次调用都判 miss**：每次都付一次整树克隆
 *   + 一次整树深比较（比 `cache: false` 更贵），且没有任何诊断信息。
 *   规避：Map/Set 只用原始值、或跨比较保持同一引用的值作键；做不到就传带版本号的
 *   Store 状态（命中判定走 O(1) 整数比较，压根不克隆）或 `snapshotState: false`
 *   （须同时把 `equalityFn` 换成引用相等，见下方性能口径）。
 *
 * 性能口径：Store 状态自带版本号，命中判定走 O(1) 整数比较，不克隆状态；上述快照
 * 只在「状态无版本标记（直接传入普通对象）+ `snapshotState` 为真（默认）」的回退路径上
 * 发生——每次 miss 深克隆整棵状态树，且 `cacheHistory` 最多驻留 `cacheSize`（默认 10）份
 * 完整快照，每次命中还要深比较整棵树，即每次 `execute` 均为 O(状态规模)。大状态 + 普通对象
 * 输入时需自控成本，三条出口：`snapshotState: false`（改缓存活引用、只比身份，
 * 代价是感知不到就地变异，**`equalityFn` 必须是引用相等**）、`cache: false`（彻底不缓存，
 * 每次重算）、或传入带版本号的 Store 状态（走 O(1) 版本比较）。
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
 *     // 引用相等的比较器必须同时关掉内容快照，否则克隆体与活引用永不相等 → 永不命中
 *     equalityFn: (a, b) => a === b,
 *     snapshotState: false
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
 * 等价于 `createSelector(selectorFn, { cache: true, equalityFn })`——默认就开缓存，
 * 不传 `equalityFn` 时用内置 `deepEqual` 比较**输入状态**。
 *
 * 本工厂**不暴露 `snapshotState`**：无版本号的普通对象状态一律缓存内容快照，于是传入
 * 引用相等比较器（`(a, b) => a === b`）得到的是「永不命中」的缓存——命中判定是
 * `equalityFn(克隆体, 当前状态)`，两者永不相等，memo 静默失效（不返回错值）。
 * 要「只比引用、免整树克隆」请改用 `createSelector(selectorFn, { cache: true, equalityFn, snapshotState: false })`。
 *
 * @template S - 状态类型
 * @template R - 返回值类型
 * @param {Selector<S, R>} selectorFn - 选择器函数
 * @param {(a: any, b: any) => boolean} [equalityFn] - 自定义相等性函数；形参取 `any` 的理由见 `SelectorOptions.equalityFn`
 * @returns {Selector<S, R>} 记忆化选择器
 *
 * @example
 * ```typescript
 * // 默认深比较：内容变了才重算，就地变异也能感知
 * const memoizedName = createMemoizedSelector((state) => state.user.name)
 *
 * memoizedName(state) // 首次：计算并缓存
 * memoizedName(state) // 再次：命中缓存
 *
 * // 想按引用相等命中并省掉克隆 —— 本工厂没有该出口，走 createSelector 显式声明
 * const byRef = createSelector((state) => state.user.name, {
 *   cache: true,
 *   equalityFn: (a, b) => a === b,
 *   snapshotState: false,
 * })
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMemoizedSelector<S extends State, R>(selectorFn: Selector<S, R>, equalityFn?: (a: any, b: any) => boolean): Selector<S, R> {
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
 * ⚠️ 参数类型把每个键都声明为**可选**（部分映射是受支持的公开用法），实现则按运行期的
 * `Object.entries` 遍历，且只处理 `typeof === 'function'` 的项：非函数值（`undefined` /
 * `null` / 手滑写成的字面量）被**静默跳过**，结果对象里根本没有那个键。而返回值被断言成
 * 完整的 `R`，所以「R 里声明为必填、映射里省略或放了非函数」这种组合不会报错，只表现为
 * 读出来是 `undefined`。需要这种不匹配可见时：把返回类型显式写成 `Partial<...>`，
 * 或保证映射与 `R` 的键一一对应。
 * 之所以不改成强制完整映射（`{ [K in keyof R]: Selector<S, R[K]> }`）或对缺项告警：
 * 前者是公开类型的破坏性收紧，后者会把合法的稀疏映射变成日志噪音源（每个非函数项一次）
 *
 * @template S - 状态类型
 * @template R - 返回结构类型（默认从选择器映射推断）
 * @param {[K in keyof R]?: Selector<S, R[K]>} selectors - 选择器映射（非函数项被跳过，见上）
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
        const value = selector(state)

        if (key === '__proto__') {
          // 只有 __proto__ 需要 DefineOwnProperty 语义：选择器映射用计算属性写法
          // （{['__proto__']: fn}）可产生自有 __proto__ 键，result[key] = … 走 [[Set]]
          // 会触发 Object.prototype 的 __proto__ setter——该项被静默丢弃且 result 原型被换掉
          Object.defineProperty(result, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          })
        } else {
          // 其余键走普通赋值：本循环对映射的每个键跑一次，完整描述符要付 DefineOwnProperty
          // 的慢路径开销，在这些键上 [[Set]] 语义完全等价（SelectorComposer.createObjectSelector
          // 同口径，两处都是按键遍历的热路径）
          result[key] = value
        }
      }
    }

    return result as unknown as R
  }
}
