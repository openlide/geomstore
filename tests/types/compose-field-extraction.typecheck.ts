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

import { composeStore, createStore } from '@/index.js'
import type { Actions, State, Store } from '@/types/store.js'
import type { ComposedStore, StoreLike, StoreTreeNode } from '@/types/compose.js'

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

// 三个 Extract* 与手写交叉结果互相可赋值（同构性：改动其中一个忘了另两个会在这里暴露）
type ExtractedState = ReturnType<typeof composed.getState>
const _stateRoundTrip: ExtractedState = null as unknown as import('@/types/compose.js').ExtractStates<[typeof userStore, typeof cartStore]>
const _stateRoundTripBack: import('@/types/compose.js').ExtractStates<[typeof userStore, typeof cartStore]> = null as unknown as ExtractedState

// #395 关键回归：`any` 成员必须原样穿过 undefined 守卫。
// `undefined extends any` 为 true，若守卫不区分 any，元组里出现 `let store: any`
// （测试里极常见，见 tests/unit/core/compose/composeStore.test.ts）时
// 整个交叉会塌成 Record<never, never>，下面两次取值都会变成编译错误。
declare const anyStore: any
const composedFromAny = composeStore([anyStore, anyStore])
const _anyStateName: string = composedFromAny.getState().name
const _anyActionCall = composedFromAny.actions.someAction('x')

// ==================== #396：StoreLike.actions 即 Actions ====================

const _actionsFieldIsActions: [StoreLike['actions']] extends [Actions] ? true : false = true
const _actionsFieldBack: [Actions] extends [StoreLike['actions']] ? true : false = true

// 具体 store 仍满足 StoreLike（复用 Actions 未收紧约束）
const _like: StoreLike = userStore

// ==================== #394：树节点与组合形状不再是 any ====================

// 注：这里不直接调 `createStoreTree([userStore])` —— 它的形参是默认泛型的 `Store[]`
// （`Store<object, Actions, Getters<object>>`），具体状态的 Store 会因 `getters` 的参数逆变而被拒，
// 那是 core 侧的既有签名问题（与本条 finding 无关，已列入待办）。
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
