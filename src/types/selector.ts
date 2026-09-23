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
  cache?: boolean
  /**
   * 缓存历史条数（默认 10，历史条目同样参与命中判定，不只比对最近一条）。
   *
   * 归一化口径：`Number.isFinite(v) ? Math.max(1, v) : 10`——0 / 负数被夹到 1，
   * `NaN`/`Infinity`/未提供回到 10（不夹会让 history 无界增长或刚 push 就被 shift 掉）。
   */
  cacheSize?: number
  /**
   * 缓存生存时间，毫秒（默认 5000）。
   *
   * 本类型只是 `number`，取值守卫在实现侧：`src/extras/selector/createSelector.ts` 的
   * `SelectorFactory` 用 `typeof v === 'number' && v > 0 ? v : 5000` 归一化，
   * 拦掉三类静默劣化——`NaN`（判据 `timestamp + NaN <= now` 恒假 → 永不过期，
   * 就地变异后仍返回陈旧值）、`0`/负数（写入即过期 → 等价于关缓存，却仍照旧付快照克隆
   * 与 push 成本，且不报错）、未类型化调用方传进来的字符串（`timestamp + '60000'` 变成拼接，
   * 判定同样恒假）。
   *
   * 与 `cacheSize` 的差别是**有意的**：`Infinity` 在这里是合法配置（= 不按时间过期，
   * 版本化状态的失效凭证仍是版本号），而 `cacheSize` 的 `Infinity` 会让历史无界增长，
   * 所以只有 `cacheSize` 夹上限。别把两者强行统一成同一个函数。
   */
  cacheTTL?: number
  /**
   * 比较函数（默认 `deepEqual`；显式传 falsy 视同未提供，同样回退 `deepEqual`）。
   *
   * 比较的是**输入状态**（缓存键），不是选择器结果：实现里是
   * `equalityFn(item.state, state)`（`createSelector.ts` 的 `isCacheHit`），
   * 且仅在状态无版本标记（非 Store 状态、直接传普通对象）时才被调用。
   * 形参不能写成 `(a: S, b: S)`：本类型不带 `S` 泛型、`createSelector(selectorFn, options?)`
   * 的 options 位点也不随 `S` 实例化，要标注具体状态得先在实现层把泛型透传下来。
   * 于是候选只剩 `unknown` 与 `any` 两档，而 `unknown` 那一档下面这条会把它否掉。
   *
   * 但 `unknown` 形参在 `strictFunctionTypes` 下会**拒掉调用方按具体状态标注的比较器**：
   * `{ equalityFn: (x: OrderState, y: OrderState) => x.id === y.id }` 实测报
   * `TS2322: Type 'unknown' is not assignable to type 'OrderState'`（属性式函数按逆变比较）。
   * 与 `AsyncActions`（R5-316）同一处方：形参取 `any` 让这类写法可赋——`any` 在这里只出现在
   * **逆变的形参位**，返回值仍是 `boolean`，不会把错误结果放过去；实现侧传进来的本来就是
   * `unknown`（缓存条目存的 state 与调用方给的 state），因此内部调用点不因它失去检查。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  equalityFn?: (a: any, b: any) => boolean
  /**
   * 状态**无版本标记**时用什么作为缓存失效凭证（默认 `true` = 缓存内容快照）。
   *
   * - `true`：写缓存时深拷贝一份状态，命中判定用 `equalityFn(快照, 当前状态)` 比内容。
   *   任何深比较器（`deepEqual`、lodash `isEqual`、`(a,b)=>deepEqual(a,b)` 包装）都只有
   *   这一种正确形态——若缓存活引用，两个实参会是同一个对象，深比较恒等，
   *   就地变异看不见，TTL 内会持续返回陈旧值。
   * - `false`：缓存**活引用**，命中判定退化为 `equalityFn(原引用, 当前引用)`。
   *   仅当 `equalityFn` 是引用相等（`(a, b) => a === b`）时才该这么用：此时快照会与
   *   活引用永不相等，缓存变成永远命不中。换来的收益是省下一次整树克隆，
   *   代价是**前提被违反时（同一对象就地改过）会返回陈旧值**。
   *
   * 状态带版本号（Store 的 `_mutationCount`）时本选项不参与判定：版本号已是失效凭证，
   * 既不克隆也不用 `equalityFn`。
   */
  snapshotState?: boolean
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
   *
   * 判「有没有值」一律写 `version !== undefined`，**不要写 `if (item.version)`**：
   * `0` 是合法版本号（Store 的 `_mutationCount` 从 0 起算），真值判断会把首版状态误判成
   * 「无版本」而退回昂贵的 deepEqual 路径。现有消费方（`createSelector.isCacheHit`、
   * `parametricSelector` 的 stateCache 命中校验）都按 `!== undefined` 写。
   */
  version?: number
}

/**
 * 组合选择器参数
 *
 * `R` 是组合结果的类型：`combiner` 的返回值即它，所以「combiner 返回了别的东西」
 * （拼错的属性名等）会在调用处显形，而不是被 `combine` 里的 `as R` 静默吞掉。
 *
 * `SelectorComposer.combine` 的入参已写成 `SelectorComposerInput<S, T, R>`，`R` 由 `combiner`
 * 的返回类型反推，实现里的 `as R` / `as unknown as T` 两处断言都已删除。两个连带后果：
 * - 显式给 `R`（`combine<S, R>(...)`）而 combiner 返回别的东西 → 现在编译失败（此前被断言吞掉）；
 * - 两参数写法 `SelectorComposerInput<S, T>` 的 `R` 仍取默认 `unknown`，行为不变
 *   （该默认由 `tests/types/selector-combiner-result.typecheck.ts` 断言锁着）。
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
 *
 * 泛型默认值与同族的 `Selector`（`S = Record<string, unknown>`）、`SelectorComposerInput` 对齐：
 * 此前 `S`/`P`/`R` 全部必填，未typed 场景要写满 `ParametricSelector<Record<string, unknown>, unknown, unknown>`，
 * 与公开面上其它选择器类型的口径不一致。补默认值只是放宽「可省略」，显式传参的既有用法不受影响。
 */
export type ParametricSelector<S extends State = Record<string, unknown>, P = unknown, R = unknown> = (state: S, params: P) => R

/**
 * 选择器结果类型
 */
export type SelectorResult<R> = {
  value: R
  fromCache: boolean
}
