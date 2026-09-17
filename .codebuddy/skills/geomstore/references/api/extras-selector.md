# `./extras/selector` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.5.1`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`./extras/selector`
> - 类型声明：`./dist/extras/selector.d.ts`
> - 返回索引：[`index.md`](./index.md)

### `AsyncRetrySelectorOptions`

```ts
/** 异步重试选择器选项 */
export interface AsyncRetrySelectorOptions extends RetrySelectorOptions {
    /**
     * 重试间延迟（毫秒）或按重试序号的退避函数（attempt 从 1 开始）。
     * 默认 0（立即重试）；同步重试选择器无法承载延迟，需要延迟请用本异步变体
     */
    delay?: number | ((attempt: number) => number);
}
```

### `ParametricSelector`

```ts
/**
 * 参数化选择器
 */
export type ParametricSelector<S extends State, P, R> = (state: S, params: P) => R;
```

### `RetrySelectorOptions`

```ts
/** 同步重试选择器选项 */
export interface RetrySelectorOptions {
    /**
     * 重试次数（不含首次执行，总尝试次数 = retries + 1），默认 3。
     * 仅适用于依赖外部可变状态的 selector——纯函数对相同输入重试必然得到相同结果
     */
    retries?: number;
    /** 是否对该错误继续重试（attempt 为重试序号，从 1 开始） */
    shouldRetry?: (error: Error, attempt: number) => boolean;
}
```

### `Selector`

```ts
/**
 * 选择器函数类型
 *
 * 约束用 `State`（即 `object`）而非 `Record<string, unknown>`：与 Store 的状态约束口径保持一致，
 * 使**未声明索引签名的业务 interface**（如 `interface OrderState { … }`）可直接作为状态类型；
 * 后者只接受带索引签名的类型，会把这类 interface 拒之门外。
 * 默认值仍为 `Record<string, unknown>`，既有写法行为不变。
 */
export type Selector<S extends State = Record<string, unknown>, R = unknown> = (state: S) => R;
```

### `SelectorCacheItem`

```ts
/**
 * 选择器缓存项
 */
export interface SelectorCacheItem<R> {
    /** 缓存的值 */
    value: R;
    /** 缓存的时间戳 */
    timestamp: number;
    /** 缓存的state引用 */
    state: unknown;
    /**
     * 缓存条目对应的状态版本号（来自 Store 的变更计数）。
     * 有值时命中判定退化为 O(1) 整数比较，无需 deepEqual 全树比较；
     * 为 undefined 表示状态无版本标记（普通对象），回退到 equalityFn 比较。
     */
    version?: number;
}
```

### `SelectorComposer`

```ts
/**
 * 选择器组合器类
 *
 * 提供静态方法用于组合、管道和创建高级选择器
 *
 * @class SelectorComposer
 *
 * @example
 * ```typescript
 * // 组合多个选择器
 * const selector = SelectorComposer.combine({
 *   selectors: [
 *     (s) => s.value,
 *     (s) => s.multiplier
 *   ],
 *   combiner: (value, multiplier) => value * multiplier
 * })
 *
 * const result = selector(state) // value * multiplier
 * ```
 */
export declare class SelectorComposer {
    /**
     * 组合多个选择器
     *
     * 将多个选择器的结果组合成单个值
     *
     * @template S - 状态类型
     * @template R - 返回值类型
     * @param {SelectorComposerInput<S>} input - 选择器和组合器配置
     * @returns {Selector<S, R>} 组合后的选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.combine({
     *   selectors: [
     *     (s) => s.base,
     *     (s) => s.taxRate
     *     (s) => s.shipping
     *   ],
     *   combiner: (base, tax, shipping) => base * (1 + tax) + shipping
     * })
     *
     * const total = selector({ base: 100, taxRate: 0.1, shipping: 10 })
     * // 100 * 1.1 + 10 = 120
     * ```
     */
    static combine<S extends State, R = unknown, T extends readonly Selector<S, unknown>[] = readonly Selector<S, unknown>[]>(input: SelectorComposerInput<S, T>): Selector<S, R>;
    /**
     * 管道操作
     *
     * 将一个选择器的结果作为下一个选择器的输入
     *
     * @template S - 状态类型
     * @template T1 - 第一个选择器的返回类型
     * @template T2 - 第二个选择器的返回类型
     * @template T3 - 第三个选择器的返回类型（可选）
     * @param {Selector<S, T1>} selector1 - 第一个选择器
     * @param {(input: T1) => T2} selector2 - 第二个选择器
     * @param {(input: T2) => T3} selector3 - 第三个选择器（可选）
     * @returns {Selector<S, T4 | T3 | T2 | T1>} 管道选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.pipe(
     *   (s) => s.user,
     *   (user) => user.profile,
     *   (profile) => profile.avatar
     * )
     *
     * const avatar = selector(state)
     * // 相当于: state.user.profile.avatar
     * ```
     */
    static pipe<S extends State, T1, T2, T3, T4>(selector1: Selector<S, T1>, selector2: (input: T1) => T2, selector3: (input: T2) => T3, selector4: (input: T3) => T4): Selector<S, T4>;
    static pipe<S extends State, T1, T2, T3>(selector1: Selector<S, T1>, selector2: (input: T1) => T2, selector3: (input: T2) => T3): Selector<S, T3>;
    static pipe<S extends State, T1, T2>(selector1: Selector<S, T1>, selector2: (input: T1) => T2): Selector<S, T2>;
    static pipe<S extends State, T1>(selector1: Selector<S, T1>): Selector<S, T1>;
    /**
     * 创建派生选择器
     *
     * 通过管道操作创建派生选择器，pipe的别名
     *
     * @template S - 状态类型
     * @template R1 - 第一个返回类型
     * @template R2 - 第二个返回类型
     * @template R3 - 第三个返回类型（可选）
     * @param {Selector<S, R1>} selector1 - 第一个选择器
     * @param {(input: R1) => R2} selector2 - 第二个选择器
     * @param {(input: R2) => R3} selector3 - 第三个选择器（可选）
     * @returns {Selector<S, R3 | R2 | R1>} 派生选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createDerived(
     *   (s) => s.items,
     *   (items) => items.filter(i => i.active),
     *   (activeItems) => activeItems.length
     * )
     *
     * const count = selector(state)
     * // 计算活跃项目数量
     * ```
     */
    static createDerived<S extends State, R1, R2, R3>(selector1: Selector<S, R1>, selector2: (input: R1) => R2, selector3: (input: R2) => R3): Selector<S, R3>;
    static createDerived<S extends State, R1, R2>(selector1: Selector<S, R1>, selector2: (input: R1) => R2): Selector<S, R2>;
    /**
     * 创建数组选择器
     *
     * 对数组的每个元素应用选择器
     *
     * @template T - 数组元素类型
     * @template R - 返回元素类型
     * @param {(item: T) => R} itemSelector - 元素选择器
     * @returns {(array: T[]) => R[]} 数组选择器（输入为数组，不满足 Selector 的对象约束，故用函数类型）
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createArraySelector(
     *   (item) => item.value * 2
     * )
     *
     * const doubled = selector([1, 2, 3])
     * console.log(doubled) // [2, 4, 6]
     * ```
     */
    static createArraySelector<T, R>(itemSelector: (item: T) => R): (array: T[]) => R[];
    /**
     * 创建对象选择器
     *
     * 对对象的每个键应用选择器
     *
     * @template S - 状态类型
     * @template K - 键类型
     * @template R - 值类型
     * @param {(key: K) => Selector<S, R>} keySelector - 键选择器工厂
     * @returns {Selector<S, Record<K, R>>} 对象选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createObjectSelector(
     *   (key) => (s) => s[key].toUpperCase()
     * )
     *
     * const result = selector({ name: 'alice', city: 'beijing' })
     * console.log(result) // { name: 'ALICE', city: 'BEIJING' }
     * ```
     */
    static createObjectSelector<S extends State, K extends keyof S, R>(keySelector: (key: K) => Selector<S, R>): Selector<S, Record<K, R>>;
    /**
     * 创建条件选择器
     *
     * 根据条件选择执行哪个选择器
     *
     * @template S - 状态类型
     * @template R - 返回值类型
     * @param {(state: S) => boolean} condition - 条件函数
     * @param {Selector<S, R>} trueSelector - 条件为true时执行的选择器
     * @param {Selector<S, R>} falseSelector - 条件为false时执行的选择器
     * @returns {Selector<S, R>} 条件选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createConditionalSelector(
     *   (s) => s.userType === 'admin',
     *   (s) => s.adminPermissions,
     *   (s) => s.userPermissions
     * )
     *
     * const permissions = selector({ userType: 'admin', adminPermissions: [...], userPermissions: [...] })
     * // 返回 adminPermissions
     * ```
     */
    static createConditionalSelector<S extends State, R>(condition: (state: S) => boolean, trueSelector: Selector<S, R>, falseSelector: Selector<S, R>): Selector<S, R>;
    /**
     * 创建默认值选择器
     *
     * 选择器失败或返回undefined时使用默认值
     *
     * @template S - 状态类型
     * @template R - 返回值类型
     * @param {Selector<S, R>} selector - 原始选择器
     * @param {R} defaultValue - 默认值
     * @returns {Selector<S, R>} 带默认值的选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createDefaultSelector(
     *   (s) => s.optionalField,
     *   'N/A'
     * )
     *
     * const value1 = selector({ optionalField: 'exists' })
     * console.log(value1) // 'exists'
     *
     * const value2 = selector({ optionalField: undefined })
     * console.log(value2) // 'N/A'
     * ```
     */
    static createDefaultSelector<S extends State, R>(selector: Selector<S, R>, defaultValue: R): Selector<S, R>;
    static createRetrySelector<S extends State, R>(selector: Selector<S, R>, options?: RetrySelectorOptions): Selector<S, R>;
    static createRetrySelectorAsync<S extends State, R>(selector: Selector<S, R>, options?: AsyncRetrySelectorOptions): (state: S) => Promise<R>;
    /**
     * 创建防抖选择器
     *
     * 延迟执行选择器，在延迟期间多次调用只执行最后一次
     *
     * @template S - 状态类型
     * @template R - 返回值类型
     * @param {Selector<S, R>} selector - 原始选择器
     * @param {number} [delay=300] - 防抖延迟（毫秒）
     * @returns {Selector<S, Promise<R>>} 防抖选择器（返回Promise）
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createDebouncedSelector(
     *   (s) => s.value * 2,
     *   300
     * )
     *
     * // 多次调用在300ms内只有最后一次会执行
     * selector(state)
     * selector(state)
     * selector(state)
     * // 只执行一次
     * ```
     */
    static createDebouncedSelector<S extends State, R>(selector: Selector<S, R>, delay?: number): Selector<S, Promise<R>>;
    /**
     * 创建节流选择器
     *
     * 限制选择器执行频率，在指定间隔内只执行一次
     *
     * @template S - 状态类型
     * @template R - 返回值类型
     * @param {Selector<S, R>} selector - 原始选择器
     * @param {number} [interval=300] - 节流间隔（毫秒）
     * @returns {Selector<S, R>} 节流选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createThrottledSelector(
     *   (s) => s.value * 2,
     *   300
     * )
     *
     * // 在300ms内多次调用只执行一次
     * selector(state)
     * selector(state)
     * selector(state)
     * // 第一次执行，后两次返回缓存值
     * ```
     */
    static createThrottledSelector<S extends State, R>(selector: Selector<S, R>, interval?: number): Selector<S, R>;
}
```

### `SelectorComposerInput`

```ts
/**
 * 组合选择器参数
 */
export interface SelectorComposerInput<S extends State = Record<string, unknown>, T extends readonly Selector<S, unknown>[] = readonly Selector<S, unknown>[]> {
    /** 选择器数组 */
    selectors: [...T];
    /**
     * 组合函数
     *
     * 参数刻意保持 any[]：元组 mapped type 在严格泛型下推断失效
     * （combiner 实参类型由调用方泛型推断保证，见 compose.ts）
     */
    combiner: (...results: any[]) => unknown;
}
```

### `SelectorFactory`

```ts
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
export declare class SelectorFactory<S extends State = Record<string, unknown>, R = unknown> {
    /**
     * 选择器函数
     * @private
     * @type {Selector<S, R>}
     */
    private selector;
    /**
     * 当前缓存
     * @private
     * @type {SelectorCacheItem<R> | null}
     */
    private cache;
    /**
     * 缓存选项
     * @private
     * @type {Required<SelectorOptions>}
     */
    private options;
    /**
     * 缓存历史记录
     * @private
     * @type {SelectorCacheItem<R>[]}
     */
    private cacheHistory;
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
    constructor(selector: Selector<S, R>, options?: SelectorOptions);
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
    execute(state: S): R;
    /**
     * 判断缓存条目是否命中（状态相等且未过期）
     *
     * @private
     */
    private isCacheHit;
    /**
     * 查找命中的缓存条目：最近一条优先，其次回溯 cacheHistory（最新在后），
     * 命中历史条目时将其提升为当前缓存（LRU 语义）
     *
     * @private
     * @returns 命中的缓存条目；未命中返回 null
     */
    private findCacheHit;
    /**
     * 更新缓存
     *
     * @private
     * @param {S} state - 状态对象
     * @param {R} value - 计算结果
     */
    private updateCache;
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
    clearCache(): void;
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
        hasCache: boolean;
        cacheSize: number;
        cacheHit?: SelectorCacheItem<R>;
    };
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
    withCacheResult(): Selector<S, SelectorResult<R>>;
}
```

### `SelectorOptions`

```ts
/**
 * 选择器选项
 */
export interface SelectorOptions {
    /** 是否启用缓存 */
    cache?: boolean;
    /** 缓存大小 */
    cacheSize?: number;
    /** 缓存过期时间（毫秒） */
    cacheTTL?: number;
    /** 比较函数 */
    equalityFn?: (a: unknown, b: unknown) => boolean;
}
```

### `SelectorResult`

```ts
/**
 * 选择器结果类型
 */
export type SelectorResult<R> = {
    value: R;
    fromCache: boolean;
};
```

### `createMemoizedSelector`

```ts
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
export declare function createMemoizedSelector<S extends State, R>(selectorFn: Selector<S, R>, equalityFn?: (a: unknown, b: unknown) => boolean): Selector<S, R>;
```

### `createParametricSelector`

```ts
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
 * @param {number} [options.ttl=5000] - 缓存生存时间（毫秒）。除 TTL 外，每次调用还会用
 *   deepEqual 校验 state 内容快照：Store 状态就地变异（引用不变）时立即作废该 state 下的
 *   全部参数缓存，不会在 TTL 内返回陈旧值
 * @param {number} [options.maxEntries=1000] - 单个 state 下原始类型参数的缓存条目上限
 * @returns {(state: S) => (params: P) => R} 参数化选择器工厂
 *
 * 限制：与 createSelector 相同——校验所用的 state 快照由 clone（deepCloneState）生成，
 * 它对不可克隆对象（类实例、Promise、WeakMap/WeakSet 等）保留原引用，因此这类对象被
 * 就地变异时校验会因引用相等判定「未变化」，TTL 内返回陈旧值。规避：用 setState/$patch
 * 整体替换该字段。
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
export declare function createParametricSelector<S extends State, P, R>(selectorFn: (state: S, params: P) => R, options?: {
    ttl?: number;
    maxEntries?: number;
}): (state: S) => (params: P) => R;
```

### `createSelector`

```ts
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
export declare function createSelector<S extends State, R>(selectorFn: Selector<S, R>, options?: SelectorOptions): Selector<S, R>;
```

### `createStructuredSelector`

```ts
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
export declare function createStructuredSelector<S extends State, R extends object = Record<string, unknown>>(selectors: {
    [K in keyof R]?: Selector<S, R[K]>;
}): Selector<S, R>;
```
