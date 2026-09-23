/**
 * Store 配置接口的共享基座与状态归一化别名（编译期断言）— #421
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - `StoreConfig`（免泛型推断）与 `StoreOptions`（显式泛型）的非差异选项
 *   由同一个 `StoreOptionsBase` 声明：两者都能按基座形状取值，且基座的键集合就是那 7 项
 *   （新增选项只需改一处，不会再各自漂移）
 * - `ResolvedState<S>` 即此前逐字复制三遍的归一化表达式：对象字面量与工厂函数两种
 *   `state` 写法都归一到同一个 S
 * - 两个配置接口的差异成员（actions / getters / cacheKeys）保持原语义
 * - 免泛型裸写法取的是 `S` 的**默认值** `Record<string, unknown>`，而 `ConfigState` 的
 *   退化兜底要显式写 `StoreConfig<unknown>` 才走得到（两条分别锁，见文件末尾两节，#R6-112）
 *
 * @file tests/types/store-config-base.typecheck.ts
 */

import type { ResolvedState, StoreConfig, StoreOptions, StoreOptionsBase } from '@/types/store.js'

/**
 * 双向精确类型相等断言（与 `tests/types/integration-types.typecheck.ts` 同口径）：
 * 「可赋值」式断言在结果被漂成 `any`、或形状塌成 `object` 时都会被白送，需要
 * 「就是这个类型」时用本 helper。
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

interface CounterState {
  count: number
}

// ==================== 共享基座：两个配置接口都满足 ====================

const configAsBase: StoreOptionsBase<CounterState> = null as unknown as StoreConfig<CounterState>
const optionsAsBase: StoreOptionsBase<CounterState> = null as unknown as StoreOptions<CounterState>
void [configAsBase, optionsAsBase]

// 基座的键集合恰为共享的 7 项（基座多写/漏写成员都会在这两条双向断言里失败）
type SharedKeys = keyof StoreOptionsBase<CounterState>
type ExpectedSharedKeys = 'name' | 'state' | 'enableCache' | 'cacheConfig' | 'stateProtection' | 'subscription' | 'notify'
const _baseKeys: ExpectedSharedKeys[] = null as unknown as SharedKeys[]
const _expected: SharedKeys[] = null as unknown as ExpectedSharedKeys[]
void [_baseKeys, _expected]

// actions 属差异成员，不在共享基座内
// @ts-expect-error 'actions' 不是 StoreOptionsBase 的键
const _notShared: SharedKeys = 'actions'
void _notShared

// 共享选项在两个接口上都只需书写一次（编译期即证明不存在第二份声明）
// 显式标注以启用「多余属性检查」：spread 进来的属性不参与 EPC，键名拼错
// （如 cacheConifg）会静默穿过下面两条赋值，「共享选项只写一次」的锁即失效
const sharedOnly: StoreOptionsBase<CounterState> = {
  name: 'base-shared',
  enableCache: true,
  cacheConfig: { capacity: 10, ttl: 1000, trackAccessTime: false, enableStats: true },
  stateProtection: { enabled: true, deep: false, productionHandler: 'silent' as const },
  subscription: { maxSubscribers: 5, onLimit: 'throw' as const },
  notify: { clone: false, onlyOnChange: true, async: true },
}
const inferredForm: StoreConfig<CounterState> = { ...sharedOnly, state: (): CounterState => ({ count: 1 }), cacheKeys: ['count'] }
const explicitForm: StoreOptions<CounterState> = { ...sharedOnly, state: { count: 1 }, cacheKeys: ['count'] }
void [inferredForm, explicitForm]

// ==================== ResolvedState：两种 state 写法归一到同一形状 ====================

type FromLiteral = ResolvedState<CounterState>
type FromFactory = ResolvedState<() => CounterState>

const _fromLiteral: FromLiteral = { count: 1 }
const _fromFactory: FromFactory = { count: 2 }
// 交叉断言：两种写法的归一结果必须互为可赋值（同一类型）
const _same1: FromFactory = null as unknown as FromLiteral
const _same2: FromLiteral = null as unknown as FromFactory
void [_fromLiteral, _fromFactory, _same1, _same2]

// 归一失败（S = unknown 的裸配置）时退回 State，仍可按键索引的是 getter 侧的兜底形状
type Unresolved = ResolvedState<unknown>
const _unresolved: Unresolved = {}
// 负向锁定：`{}` 对 object / Record<string, unknown> / unknown / any 都成立，正向赋值锁不住任何东西；
// 兜底一旦被漂成可键索引形状（如 Record<string, unknown>），下面这条 @ts-expect-error 会因
// 「未命中诊断」而编译失败，真正钉死「退回的是 State（= object）」
// @ts-expect-error object 没有隐式字符串索引签名，不可赋给 Record<string, unknown>
const _unresolvedNotIndexable: Record<string, unknown> = null as unknown as Unresolved
void [_unresolved, _unresolvedNotIndexable]

// cacheKeys 仍精确到归一后状态的键
const _cacheOk: StoreConfig<CounterState>['cacheKeys'] = ['count']
void _cacheOk
// @ts-expect-error 拼错的状态键
const _cacheBad: StoreConfig<CounterState>['cacheKeys'] = ['cont']
void _cacheBad
// 工厂写法下 cacheKeys 同样按归一后的状态取键
const _cacheFromFactory: StoreConfig<() => CounterState>['cacheKeys'] = ['count']
void _cacheFromFactory

// ==================== 免泛型裸写法（S 取默认 Record<string, unknown>）====================
// 头部宣称锁定的是 StoreConfig 的「免泛型推断」，上面各条都显式写了类型参数，
// 裸写法（零类型参数）此前无人覆盖。本节钉的是 `StoreConfig` 的 **S 默认值**本身：
// 默认值即 `Record<string, unknown>`（#R5-326 特意从 `unknown` 改过来），裸写法的
// `cacheKeys` 因此接受任意字符串键（见下面的 `_bareAllowsCacheKeys`）。
// ⚠️ 旧注释在这里多 claim 了一件事，而它其实没被本节覆盖：`bareForm` **不**经过
// `ConfigState` 的退化兜底分支——`satisfies StoreConfig` 用的是 S 的默认值，
// `ConfigState<Record<string, unknown>>` 归一**成功**，压根不走 `types/store.ts` 里
// `: Record<string, unknown>` 那一支。要走兜底得显式写退化输入，见本节末尾的
// `_degenerateGetterReadsByKey` / `_degenerateGetterArgExact`（#R6-112 补上）。
const bareForm = {
  ...sharedOnly,
  state: { count: 1 },
  getters: {
    double: (state: Record<string, unknown>) => Number(state.count) * 2,
  },
} satisfies StoreConfig
void bareForm

// 裸写法的 `S` 默认值已取 `Record<string, unknown>`（配套 R5-326 的归一化），
// 因此 `cacheKeys` 接受任意字符串键——这条正向断言锁住该口径：
// 谁把默认值改回 `unknown`，`ResolvedState<unknown>` 就退化成 `object`、`keyof` 为空、
// `cacheKeys` 变 `never[]`，本行随即报 TS2322（此前这里挂的是 `@ts-expect-error`，
// 记录的是「退化输入拒绝一切键」的旧行为，已被更可用的归一化取代）。
const _bareAllowsCacheKeys: StoreConfig = { state: { count: 1 }, cacheKeys: ['count'] }
void _bareAllowsCacheKeys

// ==================== ConfigState 的退化兜底（S 真的归一失败时）====================
// 上面 `bareForm` 走的是默认值、不是兜底，故这里以显式退化输入 `StoreConfig<unknown>` 钉住
// `ConfigState` 与 `ResolvedState` 刻意分叉的那一处：归一失败时 getter 的 state 形参退回
// `Record<string, unknown>`（**可按键读**），而 `ResolvedState` 那一侧退回 `State`（= `object`，
// 见上文 `_unresolvedNotIndexable` 的反例）。兜底若被漂成 `object`，下面那条按键读值立即报错。
const _degenerateGetterReadsByKey: StoreConfig<unknown>['getters'] = {
  double: (state) => Number(state.count) * 2,
}
void _degenerateGetterReadsByKey
// 形状精确断言：可赋值写法在 `any` / 索引签名漂成 `unknown` 时都会白过，故逐字取 Equal。
// 先取 `StoreConfig<unknown>['getters']` 的值类型再摘第 0 个形参，即 `ConfigState<unknown>`
type DegenerateGetters = StoreConfig<unknown>['getters']
type GetterArg = Parameters<NonNullable<DegenerateGetters>[string]>[0]
const _degenerateGetterArgExact: Equal<GetterArg, Record<string, unknown>> = true
void _degenerateGetterArgExact
// 反例：兜底漂成 `State`（= `object`）时，上面那条按键读值与下面这条精确断言同时报错
const _getterArgNotBareObject: Equal<GetterArg, object> = false
void _getterArgNotBareObject

export {}
