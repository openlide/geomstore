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
 *
 * 泛型默认值与同族的 `Selector`（`S = Record<string, unknown>`）、`SelectorComposerInput` 对齐：
 * 此前 `S`/`P`/`R` 全部必填，未typed 场景要写满 `ParametricSelector<Record<string, unknown>, unknown, unknown>`，
 * 与公开面上其它选择器类型的口径不一致。补默认值只是放宽「可省略」，显式传参的既有用法不受影响。
 */
export type ParametricSelector<S extends State = Record<string, unknown>, P = unknown, R = unknown> = (state: S, params: P) => R;
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
     *
     * 判「有没有值」一律写 `version !== undefined`，**不要写 `if (item.version)`**：
     * `0` 是合法版本号（Store 的 `_mutationCount` 从 0 起算），真值判断会把首版状态误判成
     * 「无版本」而退回昂贵的 deepEqual 路径。现有消费方（`createSelector.isCacheHit`、
     * `parametricSelector` 的 stateCache 命中校验）都按 `!== undefined` 写。
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
     *     (s) => s.taxRate,
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
     * pipe / createDerived 共用的管道实现
     *
     * 两个公开入口只有重载签名不同、运行期行为逐字相同，故各自委托到这里：
     * 此前 createDerived 写作 `pipe(...(selectors as [never]))`，那个断言把重载契约整个丢掉
     * （`[never]` 可赋给任意 rest 形参，连第一个参数不是「接受 state 的选择器」都查不出来，
     * 错误只在运行期暴露）。改为共用实现后两侧都只面对自己的 rest 类型，无需断言。
     *
     * @private
     */
    private static runPipe;
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
     *   (item: number) => item * 2
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
     * 对状态的**每个自有可枚举字符串键**应用选择器，返回同键名的对象。
     *
     * ⚠️ `K` 必须是 `keyof S` 中除 Symbol 外的全部键（即 `K = Extract<keyof S, string>`），
     * 不能只填其中一部分：实现的键集来自运行期的 `Object.keys(state)`，与类型参数无关。
     * 把 `K` 声明成子集（如 `createObjectSelector<S, 'a', R>((key: 'a') => ...)`）会让
     * `keySelector` 收到它声明域之外的键、返回对象多出 `Record<K, R>` 之外的键——类型不会报错，
     * 只表现为结果比预期多键。之所以不把签名改成 `(key: keyof S) => Selector<S, R>`
     * （`keyof S` / `keyof S & string` / `Extract<keyof S, string>` 三种写法均已实测）：
     * 键参数的类型一旦依赖 `S`，`(key) => (s: MyState) => s[key]` 这一最常见写法就会因
     * 循环推断把 `S` 退回约束 `object`、`key` 退化成 `never` 而直接编译失败，
     * 为了一个不产生错误数据的宽松性牺牲全部调用点的类型推断不值得。
     * 确实只想派生固定子集时请改用 {@link SelectorComposer#combine}（键集由 selectors 显式列出）
     *
     * @template S - 状态类型
     * @template K - 键类型，须为 `keyof S` 的非 Symbol 全部键（见上）
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
 *
 * `R` 是组合结果的类型，与 `SelectorComposer.combine<S, R>` 的 `R` 同一个：
 * 由 `combiner` 的返回类型直接给出，`combine` 侧不再需要 `as R` 断言
 * （该断言此前把「combiner 返回了别的东西」——例如拼错的属性名——静默当成 `R`）。
 * 默认 `unknown` 保持既有两参数写法 `SelectorComposerInput<S, T>` 的行为不变。
 *
 * 组合器实现见 `src/extras/selector/selectorComposer.ts`（`SelectorComposer.combine<S, R>`）。
 */
export interface SelectorComposerInput<S extends State = Record<string, unknown>, T extends readonly Selector<S, unknown>[] = readonly Selector<S, unknown>[], R = unknown> {
    /** 选择器数组 */
    selectors: [...T];
    /**
     * 组合函数
     *
     * 参数刻意保持 `any[]`（实测改 `unknown[]` 即破功）：调用方的 combiner 普遍写成
     * `(base: number, tax: number) => number` 这类**具体形参**，参数逆变下
     * `(a: number) => …` 不满足 `(a: unknown) => …`，直接编译失败；
     * 且 `combine` 内部是 `combiner(...results)` 的透传调用，形参类型由调用方泛型推断保证。
     * 返回值不再是 `unknown` 而是 `R`，见上方类型参数说明。
     */
    combiner: (...results: any[]) => R;
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
     * 缓存解析协议：命中查找（当前条目 + 历史回溯）→ 未命中则计算并写入缓存
     *
     * execute 与 withCacheResult 共用本方法，两者的差异只在返回包装。此前两处各写一遍
     * 「findCacheHit → selector → updateCache」，同一套协议要同步维护两份就会漂移
     * （findCacheHit 抽出之前两者就分叉过一次：withCacheResult 只查当前条目，
     * 命中 history 时 execute 判命中而它判未命中）。
     *
     * @private
     */
    private resolve;
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
 *
 * 默认值与生效条件都归一化在 `src/extras/selector/createSelector.ts` 的 `SelectorFactory` 构造函数
 * （`cache: options.cache ?? true` 之后才用到 cacheSize/cacheTTL，见 `resolve()` 的两处
 * `if (this.options.cache)`）；本类型只声明形状，故把口径抄在这里以免只读契约的人拿不到默认值。
 */
export interface SelectorOptions {
    /**
     * 是否启用缓存（默认 `true`）。
     * `cacheSize` / `cacheTTL` / `equalityFn` 都只在 `cache` 为真时才被读取。
     */
    cache?: boolean;
    /**
     * 缓存历史条数（默认 10，历史条目同样参与命中判定，不只比对最近一条）。
     *
     * 归一化口径：`Number.isFinite(v) ? Math.max(1, v) : 10`——0 / 负数被夹到 1，
     * `NaN`/`Infinity`/未提供回到 10（不夹会让 history 无界增长或刚 push 就被 shift 掉）。
     */
    cacheSize?: number;
    /**
     * 缓存生存时间，毫秒（默认 5000）。
     *
     * 只做了 `?? 5000` 的缺省兜底，**不校验取值**：`<= 0` 会让每条缓存立即过期（等价于关缓存，
     * 但不报错）；`NaN` 使过期判定 `timestamp + ttl <= now` 恒为 false，即永不过期。
     * 需要这两类输入被拒绝请在选项归一化处补校验（属 `src/extras`，见本轮待办）。
     */
    cacheTTL?: number;
    /**
     * 比较函数（默认 `deepEqual`；显式传 falsy 视同未提供，同样回退 `deepEqual`）。
     *
     * 比较的是**输入状态**（缓存键），不是选择器结果：实现里是
     * `equalityFn(item.state, state)`（`createSelector.ts` 的 `isCacheHit`），
     * 且仅在状态无版本标记（非 Store 状态、直接传普通对象）时才被调用。
     * 形参保持 `unknown` 是必需的：本类型不带 `S` 泛型、`createSelector(selectorFn, options?)`
     * 的 options 位点也不随 `S` 实例化，写成 `(a: S, b: S)` 要先在实现层把泛型透传下来。
     */
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
 * 参数缓存两侧的形状**不对称**（有意保留，调用侧需知悉）：
 * - 原始类型参数走 Map：受 `maxEntries` 约束，写入接近上限时清扫过期项并按插入序淘汰。
 * - 对象参数走 WeakMap：过期条目只在读取侧按 TTL 判 miss（随后覆写），**没有后台清扫**，
 *   也**不受 `maxEntries` 约束**（该上限只作用于上面那条 Map）。因此对象的条目只在
 *   「参数对象自身被 GC」时释放——长寿命的参数对象会一直带着它最后一次算出的 value 与 timestamp。
 * - 复用同一个参数对象、原地改它的内容：WeakMap 的键引用不变，TTL 内命中的是改内容**之前**
 *   的结果（失效凭证只有 state 侧的版本/快照，参数侧没有）。规避：每次传新对象，
 *   或把参与派生的值作为原始类型参数传入。
 *
 * 不给对象侧补容量上限的原因：WeakMap 既无 size 也无法迭代，要计数就得另存一份键列表，
 * 那会把弱引用换成强引用、反而造成本要避免的泄漏。
 *
 * @example
 * ```typescript
 * const getUserById = createParametricSelector(
 *   (state, userId) => state.users[userId],
 *   { ttl: 10000 } // 自定义缓存有效期
 * )
 *
 * const getUser = getUserById(store.state)
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
 * 性能口径：Store 状态自带版本号，命中判定走 O(1) 整数比较，不克隆状态；上述快照
 * 只在「状态无版本标记（直接传入普通对象）+ 默认 deepEqual」的回退路径上发生——
 * 每次 miss 深克隆整棵状态树，且 `cacheHistory` 最多驻留 `cacheSize`（默认 10）份完整
 * 快照，每次命中还要深比较整棵树，即每次 `execute` 均为 O(状态规模)。大状态 + 普通对象
 * 输入时需自控成本，两条免克隆出口：传 `equalityFn: (a, b) => a === b`（改为比较引用，
 * 代价是感知不到就地变异）、或 `cache: false`（彻底不缓存，每次重算）。
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
export declare function createStructuredSelector<S extends State, R extends object = Record<string, unknown>>(selectors: {
    [K in keyof R]?: Selector<S, R[K]>;
}): Selector<S, R>;
```
