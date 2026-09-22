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
   * 只做了 `?? 5000` 的缺省兜底，**不校验取值**：`<= 0` 会让每条缓存立即过期（等价于关缓存，
   * 但不报错）；`NaN` 使过期判定 `timestamp + ttl <= now` 恒为 false，即永不过期。
   * 需要这两类输入被拒绝请在选项归一化处补校验（属 `src/extras`，见本轮待办）。
   */
  cacheTTL?: number
  /**
   * 比较函数（默认 `deepEqual`；显式传 falsy 视同未提供，同样回退 `deepEqual`）。
   *
   * 比较的是**输入状态**（缓存键），不是选择器结果：实现里是
   * `equalityFn(item.state, state)`（`createSelector.ts` 的 `isCacheHit`），
   * 且仅在状态无版本标记（非 Store 状态、直接传普通对象）时才被调用。
   * 形参保持 `unknown` 是必需的：本类型不带 `S` 泛型、`createSelector(selectorFn, options?)`
   * 的 options 位点也不随 `S` 实例化，写成 `(a: S, b: S)` 要先在实现层把泛型透传下来。
   */
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
 * `R` 是组合结果的类型，与 `SelectorComposer.combine<S, R>` 的 `R` 同一个：
 * 由 `combiner` 的返回类型直接给出，`combine` 侧不再需要 `as R` 断言
 * （该断言此前把「combiner 返回了别的东西」——例如拼错的属性名——静默当成 `R`）。
 * 默认 `unknown` 保持既有两参数写法 `SelectorComposerInput<S, T>` 的行为不变。
 *
 * 组合器实现见 `src/extras/selector/selectorComposer.ts`（`SelectorComposer.combine<S, R>`）。
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
