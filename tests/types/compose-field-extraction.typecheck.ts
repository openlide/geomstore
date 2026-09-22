/**
 * 组合类型面回归（G4-types-tests medium p1 #392 / #394 / #395 / #396，编译期断言）
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时，仅由 `pnpm typecheck:tests` 校验。
 *
 * 锁定行为：
 * - #395 `ExtractStates` / `ExtractActions` / `ExtractGetters` 收敛到同一个 `ExtractField` 后，
 *   三者的提取精度与「末位 store 未声明 getters 不塌成 never」的守卫（#393）都不退化
 * - #396 `StoreLike.actions` 复用 `Actions`：字面量 action 集合仍满足约束，
 *   `ExtractActions` 的结果仍逐字精确（键存在性与签名都不放宽）
 * - #394 `StoreTreeNode.store` / `ComposedStore.stores` 不再是 `any`：
 *   成员名误用与「未判空就用根节点 store」都会被检查出来
 *
 * @file tests/types/compose-field-extraction.typecheck.ts
 */

import { composeStore, createStore, createStoreTree } from '@/index.js'
import type { Actions, State, Store } from '@/types/store.js'
import type { ComposedStore, ExtractActions, ExtractGetters, ExtractStates, StoreLike, StoreTreeNode } from '@/types/compose.js'

/**
 * 双向精确类型相等断言（与 tests/types/integration-types.typecheck.ts 同口径）
 *
 * 「可赋值」断言在这里会被 `never` / `any` / 索引签名白送，故凡是声称「逐字精确」的地方都用 Equal。
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

interface UserState {
  id: number
  name: string
}
interface CartState {
  items: string[]
}

const userStore = createStore({
  name: 'user',
  state: (): UserState => ({ id: 1, name: 'Ada' }),
  actions: {
    rename(name: string): void {
      void name
    },
  },
  getters: {
    // 具体状态形参：既检验 StoreLike 约束的放宽，也检验 #396 的 Actions 复用
    displayName(state: UserState): string {
      return `${state.id}:${state.name}`
    },
  },
})
const cartStore = createStore({
  name: 'cart',
  state: (): CartState => ({ items: [] }),
  actions: {
    addItem(item: string): void {
      void item
    },
  },
})

// ==================== #395 / #396：三个 Extract* 的精度不退化 ====================

const composed = composeStore([userStore, cartStore])

// 状态：交叉（两个成员的键都在，且类型精确）——文档口径为「交叉」而非「联合」（#392）
const _id: number = composed.getState().id
const _items: string[] = composed.getState().items
// @ts-expect-error 交叉而非任一：不存在的键必须被拒
const _missingState = composed.getState().nope

// Actions：交叉且保留形参签名
const _rename: (name: string) => void = composed.actions.rename
const _addItem: (item: string) => void = composed.actions.addItem
// @ts-expect-error 未声明的 action 不可用
composed.actions.unknownAction()
// @ts-expect-error 形参类型未被放宽为 any
composed.actions.rename(1)

// Getters：末位 store 未声明 getters 时不塌成 never（#393 的守卫在 ExtractField 里保留）
const _displayName: string = composed.getters.displayName({ id: 1, name: 'x' })
// 签名精确（state 形参仍是 UserState，未被放宽为 any/object）
const _displayNameFn: (state: UserState) => string = composed.getters.displayName
type ComposedGetters = typeof composed.getters
const _gettersNotNever: [ComposedGetters] extends [never] ? false : true = true

// 三个 Extract* 的**精确**结果（#R5-342）。
//
// 此前这里写的是「`ExtractStates` 与 `typeof composed.getState()` 互相可赋值」，两点问题：
// 1. 两侧同源于 `ExtractStates<[typeof userStore, typeof cartStore]>`（composeStore 的返回类型
//    就是用它标注的），提取器内部精度退化会同步移动两侧 ⇒ 恒真；
// 2. 注释称「手写交叉结果」，但文件里根本没有手写期望类型。
// 现在改成：期望类型由本文件逐键手写，并用 Equal 比对（`可赋值` 在 never / any / 索引签名下都会白过）。
type ExtractedState = ReturnType<typeof composed.getState>
const _stateRoundTrip: ExtractedState = null as unknown as ExtractStates<[typeof userStore, typeof cartStore]>
const _stateRoundTripBack: ExtractStates<[typeof userStore, typeof cartStore]> = null as unknown as ExtractedState

const _stateKeysExact: Equal<keyof ExtractedState, 'id' | 'name' | 'items'> = true
const _stateIdExact: Equal<ExtractedState['id'], number> = true
const _stateNameExact: Equal<ExtractedState['name'], string> = true
const _stateItemsExact: Equal<ExtractedState['items'], string[]> = true

// Actions 别名同样按名断言（此前 `ExtractActions` / `ExtractGetters` 在文件里从未被按名引用，
// 只经 composeStore 的派生成员间接覆盖，别名层的行为等于没验）
type ExtractedActions = ExtractActions<[typeof userStore, typeof cartStore]>
const _actionsKeysExact: Equal<keyof ExtractedActions, 'rename' | 'addItem'> = true
const _actionsUnionIsNever: [ExtractedActions] extends [never] ? true : false = false
const _renameSigExact: Equal<ExtractedActions['rename'], (name: string) => void> = true
const _addItemSigExact: Equal<ExtractedActions['addItem'], (item: string) => void> = true

type ExtractedGetters = ExtractGetters<[typeof userStore, typeof cartStore]>
// 键集合的精确断言在这里不成立，也不是提取器的问题：`cartStore` 没声明 getters，其 `G` 落到
// `createStore` 的默认值 `Getters<{ items: string[] }>`（即 `{[K: string]: (state: S) => unknown}`，
// 带字符串索引签名），交叉后 `keyof ExtractedGetters` 必然含 `string`。
// ⇒ 已声明键的**签名**仍可精确锁定（下一行），但「未知 getter 名被拒」要等 src 侧
//   给无 getters 的 store 推断出精确空对象类型后才谈得上（本轮记为 NEEDS-MAIN）。
const _displayNameSigExact: Equal<ExtractedGetters['displayName'], (state: UserState) => string> = true

// #395 关键回归：`any` 成员必须原样穿过 undefined 守卫。
// `undefined extends any` 为 true，若守卫不区分 any，元组里出现 `let store: any`
// （测试里极常见，见 tests/unit/core/compose/composeStore.test.ts）时
// 整个交叉会塌成 Record<never, never>，下面两次取值都会变成编译错误。
declare const anyStore: any
const composedFromAny = composeStore([anyStore, anyStore])
const _anyStateName: string = composedFromAny.getState().name
const _anyActionCall = composedFromAny.actions.someAction('x')

// ==================== #396：StoreLike.actions 即 Actions ====================

// 局限说明（#R5-344）：下面这对双向 `extends` 只校验**结构等价**。若有人把 `StoreLike.actions`
// 改回一份手抄的 `Record<string, (...args: any[]) => any>`（与 `Actions` 的定义逐字同构），
// 两侧仍互为 true ⇒ #396 想锁的「复用 Actions、消除副本」这件事并不由类型系统保证，
// 它实际靠的是 src/types/compose.ts 里 `actions: Actions` 这一行的字面写法（review 侧人工核对）。
const _actionsFieldIsActions: [StoreLike['actions']] extends [Actions] ? true : false = true
const _actionsFieldBack: [Actions] extends [StoreLike['actions']] ? true : false = true

// 具体 store 仍满足 StoreLike（复用 Actions 未收紧约束）
const _like: StoreLike = userStore

// ==================== #394：树节点与组合形状不再是 any ====================

// 真实工厂侧（#R5-343）：`createStoreTree` 的形参是默认泛型的 `Store[]`
// （`Store<object, Actions, Getters<object>>`），具体状态的 store 会因 `getters` 的参数逆变被拒——
// 实测 `createStoreTree([userStore])` 报
//   TS2322: Type 'Store<UserState, Actions, Getters<UserState>>' is not assignable to
//           type 'Store<object, Actions, Getters<object>>'
// 那是 core 侧的既有签名问题（src/core/compose/composeStore.ts 的 `createStoreTree(stores: Store[])`
// 未带泛型；本轮记为 NEEDS-MAIN，签名泛型化后应改为直接调工厂并把下面的断言换成实参版本）。
// 但**返回类型**不必等签名泛型化就能按名钉住：它必须仍是 `StoreTreeNode`，
// 一旦 `createStoreTree` 的返回类型被放宽成 `any`（本条 finding 担心的退化），第一行立即报错。
const _treeReturnTypeExact: Equal<ReturnType<typeof createStoreTree>, StoreTreeNode> = true
declare const realTree: ReturnType<typeof createStoreTree>
const _realTreeStoreName: string | undefined = realTree.children?.user?.store?.name
// @ts-expect-error 根节点的 store 仍是 `Store | null`：真实工厂同样要求判空
const _realUncheckedState = realTree.store.getState()

// 别名形状（declare const）侧：同一套断言在 `StoreTreeNode` / `ComposedStore` 上照旧成立
declare const tree: StoreTreeNode
const child = tree.children?.user
const _childName: string | undefined = child?.name
// 子节点 store 是 Store：可读公开成员，且 getState() 不再是 any
const _childStoreName: string | undefined = child?.store?.name
const _childStoreState: State | undefined = child?.store?.getState()
// getState() 的返回类型来自 Store 契约（object）而非 any
// @ts-expect-error 若 store 仍是 any，这条断言会被静默放行
const _badStateAssign: number = child?.store?.getState()
// 根节点不绑定 store（`Store | null` 的 null 分支要求调用方显式判空）
const _rootStore: Store | null = tree.store
// @ts-expect-error store 不再是 any：不存在的成员必须被检查出来
child?.store?.definitelyNotAStoreMethod?.()
// @ts-expect-error store 可能为 null：不再是 any 之后必须判空
const _uncheckedState = tree.store.getState()

// ComposedStore 形状：stores 字典按 Store 而非 any
declare const composedShape: ComposedStore<{ count: number }>
const _storedStore: Store = composedShape.stores.someKey
const _storedName: string = composedShape.stores.someKey.name
// @ts-expect-error 值类型是 Store，不是 any
const _storedWrongType: number = composedShape.stores.someKey

// State 仍可作为显式约束使用（避免本文件只引用类型别名而漏掉 noUnusedLocals 之外的回归）
const _stateConstraint: State = { count: 1 }

export { _id, _items, _missingState, _rename, _addItem, _displayName, _displayNameFn, _gettersNotNever }
export { _stateRoundTrip, _stateRoundTripBack, _actionsFieldIsActions, _actionsFieldBack, _like }
export { _anyStateName, _anyActionCall, _badStateAssign }
export { _childName, _childStoreName, _childStoreState, _rootStore, _uncheckedState, _storedStore, _storedName, _storedWrongType, _stateConstraint }
export { _stateKeysExact, _stateIdExact, _stateNameExact, _stateItemsExact }
export { _actionsKeysExact, _actionsUnionIsNever, _renameSigExact, _addItemSigExact, _displayNameSigExact }
export { _treeReturnTypeExact, _realTreeStoreName, _realUncheckedState }
