/**
 * 第五轮审查修复（分片 plugins-types-p1）：types 层契约的回归锁
 *
 * 编译期部分由 `npx tsc -p tsconfig.tests.json --noEmit` 把守：
 * R5-316（AsyncActions 形参方差）、R5-312（ComposedStore 别名对齐 Store 契约面）、
 * R5-311（ExtractMember 拆出 MemberOrEmpty 后两道守卫语义不变）。
 */

import type { AsyncActions } from '@/types/action.js'
import type { ComposedStore, ExtractGetters, ExtractStates, StoreLike } from '@/types/compose.js'
import type { Store } from '@/types/store.js'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// ==================== 编译期断言：R5-316 ====================

/**
 * 带标注的箭头函数必须能直接满足 AsyncActions。
 *
 * 索引签名写成 `(...args: unknown[]) => …` 时，`strictFunctionTypes` 下属性式函数按逆变比较，
 * 下面三行全部编译不过（`unknown` 不能赋给 `string`），调用方只能去掉形参标注或整体断言。
 */
export const asyncActions: AsyncActions = {
  fetchUser: async (id: string): Promise<{ id: string }> => ({ id }),
  fetchList: async (): Promise<unknown[]> => [],
  search: async (term: string, page: number): Promise<unknown> => ({ term, page }),
}

// 返回值仍受约束：协变位置没有被一并放宽，同步 action 不属于 AsyncActions
// @ts-expect-error 返回 number 不满足 Promise<unknown>
export const syncActionRejected: AsyncActions = { load: (id: string): number => id.length }

// ==================== 编译期断言：R5-312 ====================

/**
 * `ComposedStore` 别名描述的是 `core/compose` 那个类的形状。
 *
 * 旧别名只有 name/state/stores 三个成员，`hooks`、`getState` 等按别名书写时拿不到；
 * 交叉 `Store<S>` 后这些成员重新可见，`state` 也重新是只读的。
 * 本函数只用于让这些断言参与编译，永不被调用。
 */
function _composedShapeLocks(): void {
  const composed = null as unknown as ComposedStore<{ count: number }>
  const stores: Record<string, Store> = composed.stores
  const name: string = composed.name
  const state: { count: number } = composed.state
  const viaGetState: { count: number } = composed.getState()
  const dispatched: unknown = composed.dispatch('noop')
  composed.hooks.clear()
  composed.subscribe(() => {})
  void [stores, name, state, viaGetState, dispatched]
  // @ts-expect-error state 与 Store 一致地只读
  composed.state = { count: 1 }

  // 默认泛型改用 State 后不带类型实参也能书写（旧默认是 Record<string, unknown>，
  // 与 StoreLike 注释「Record<string, unknown> 会把业务 interface 拒之门外」自相矛盾）
  const defaultState: object = (null as unknown as ComposedStore).state
  void defaultState
}

// ==================== 编译期断言：R5-311 ====================

/** `state: any` 的成员：IsAny 守卫必须在 MemberOrEmpty 之前，否则精度全丢 */
interface AnyStateStore extends StoreLike {
  state: any
}
export const anyMemberPassesThrough: Equal<ExtractStates<[AnyStateStore]>, any> = true

/** 可选 getters 缺省：归一为空对象而不是把整个交叉塌成 never（#393） */
interface NoGettersStore extends StoreLike {
  state: { count: number }
  actions: { ping(): void }
}
export const gettersNotNever: Equal<keyof ExtractGetters<[NoGettersStore]>, never> = true

// ==================== 运行时断言：R5-316 ====================

describe('R5-316 AsyncActions 的编译期样本在运行时同样可用', () => {
  it('带标注的异步箭头函数无需断言即可赋值', async () => {
    expect(await asyncActions.fetchUser('u1')).toEqual({ id: 'u1' })
    expect(await asyncActions.search('x', 1)).toEqual({ term: 'x', page: 1 })
  })
})
