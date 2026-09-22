/**
 * 选择器泛型默认值 + Store 选项成员类型的可命名性（编译期断言）— #413 / #422
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - `ParametricSelector` 的三个类型参数都有默认值，与 `Selector` / `SelectorComposerInput`
 *   同口径；显式传参的既有用法逐字不变（#413）
 * - `SubscriptionOptions` / `NotifyOptions` / `ActionsWithThis` 是 `StoreOptionsBase` /
 *   `StoreOptions` 的成员类型，导出后消费者才能命名它们写共享默认值或做转发包装（#422）
 * - 导出的形状与被引用处严格同形（Equal 双向），避免「导出了一份漂白的副本」
 *
 * @file tests/types/selector-generic-defaults.typecheck.ts
 */

import type { ActionsWithThis, Getters, NotifyOptions, State, StoreOptions, SubscriptionOptions } from '@/types/store.js'
import type { ParametricSelector, Selector, SelectorOptions } from '@/types/selector.js'

/** 双向精确类型相等（仅「可赋值」不够：逆变会把窄形状白送） */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

interface ItemsState extends State {
  items: string[]
  count: number
}

// ==================== #413：ParametricSelector 的泛型默认值 ====================

// 裸写即可：此前必须写满三个类型参数
// （`ParametricSelector<Record<string, unknown>, unknown, unknown>`），与同族其它类型的默认口径不一致
const bareSelector: ParametricSelector = (state, params) => [state, params]
void bareSelector

// 默认值逐个锁定：S 与 `Selector` 同为 `Record<string, unknown>`，P/R 为 unknown
const _bareDefaults: Equal<ParametricSelector, (state: Record<string, unknown>, params: unknown) => unknown> = true
void _bareDefaults
const _sameSDefault: Equal<Parameters<ParametricSelector>[0], Parameters<Selector>[0]> = true
void _sameSDefault

// 只省略尾部参数同样合法
const partialDefaults: ParametricSelector<ItemsState, number> = (state, index) => state.items[index]
void partialDefaults

// 显式传满三个参数的既有用法不受影响，且仍精确
const explicit: ParametricSelector<ItemsState, number, string> = (state, index) => state.items[index]
const _explicitResult: string = explicit({ items: ['a'], count: 0 }, 0)
void _explicitResult

// 默认值不放宽约束：S 仍须 `extends State`
// @ts-expect-error number 不满足 State（= object）约束
type _BadStateParam = ParametricSelector<number, string, string>

// ==================== #422：Store 选项成员类型可命名 ====================

// 共享默认值 / 包装器转发：消费者需要能写出这两个选项类型
const sharedSubscription: SubscriptionOptions = { maxSubscribers: 16, onLimit: 'throw' }
const sharedNotify: NotifyOptions = { clone: false, onlyOnChange: true, async: true }
const forwarded: StoreOptions<ItemsState> = { subscription: sharedSubscription, notify: sharedNotify }
void forwarded

// 导出的是同一形状而不是漂白的副本
const _memberShapes: [Equal<NonNullable<StoreOptions['subscription']>, SubscriptionOptions>, Equal<NonNullable<StoreOptions['notify']>, NotifyOptions>] = [
  true,
  true,
]
void _memberShapes

// `ActionsWithThis`：`StoreOptions.actions` 的类型。导出后调用方可在字面量之外单独声明这组 action，
// `this` 仍由 ThisType 注入（state / $patch 精确到 S）
type CountActions = { bump(): void }
const ctxActions: ActionsWithThis<ItemsState, CountActions> = {
  bump() {
    this.$patch({ count: this.state.count + 1 })
  },
}
const _actionsShape: Equal<NonNullable<StoreOptions<ItemsState, CountActions>['actions']>, ActionsWithThis<ItemsState, CountActions>> = true
void [_actionsShape, ctxActions]

// ==================== SelectorOptions 未被本轮改动（#412 的落点记录） ====================

// equalityFn 比较的是**输入状态**（`createSelector.ts` 里是 `equalityFn(item.state, state)`），
// 不是选择器结果 R：故本类型刻意不带 R 泛型（#412 报告给的 `SelectorOptions<R>` 会把契约标错）
const options: SelectorOptions = { cache: true, cacheSize: 20, cacheTTL: 1000, equalityFn: (a, b) => a === b }
// 形参位是 `any` 而不是 `unknown`：`unknown` 在 `strictFunctionTypes` 下会因逆变拒掉
// 调用方按具体状态标注的比较器（`(a: MyState, b: MyState) => boolean`），等于「除内置 deepEqual
// 之外全都写不出来」。放宽只在逆变位，返回位仍是 `boolean`——同文件
// `selector-equalityfn-variance.typecheck.ts` 锁住这两侧，别把形参"收紧"回 unknown。
const _equalityParams: Equal<NonNullable<SelectorOptions['equalityFn']>, (a: any, b: any) => boolean> = true
void [options, _equalityParams]

// 锁定 `Getters` 的真实形状：索引签名的单元格类型必须是 `(state: S) => unknown`。
// （此前写的是 `Equal<_GettersOf<ItemsState>, Getters<ItemsState>>`，别名展开后两侧同义反复，
// 永远为 true，锁不住任何东西；S 被漂白或单元格返回值放宽时这条断言现在会失败）
const _gettersShape: Equal<Getters<ItemsState>['k'], (state: ItemsState) => unknown> = true
void _gettersShape
