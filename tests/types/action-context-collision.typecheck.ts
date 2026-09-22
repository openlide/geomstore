/**
 * Action 上下文与用户 action 同名键的解析（编译期断言）— #423
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - `ActionContext` 先从基座 `Omit` 掉与用户 action 同名的成员再交叉：
 *   交叉不会「覆盖」，同名成员会合成重载体，`this.getState()` 取到哪一条不确定
 *   （修复前实测命中基座签名 `() => S`，把返回状态对象当数字用）
 * - 未冲突的基础成员（state / setState / $patch / name）仍完整可用
 * - `A` 退化为 `Actions`（带索引签名，如显式泛型写法 `StoreOptions<S>`）时**不剔任何键**，
 *   否则整个基座被清空，action 内 `this.state` 全部 TS2339
 *
 * @file tests/types/action-context-collision.typecheck.ts
 */

import { createStore } from '@/index.js'
import type { ActionContext, Actions } from '@/types/store.js'

// ==================== 冲突键：用户 action 覆盖基座同名成员 ====================

const collision = createStore({
  name: 'ctx-collision',
  state: { count: 0 },
  actions: {
    /** 与 ActionContextBase.getState 同名 */
    getState(): number {
      return 42
    },
    probe() {
      const n: number = this.getState()
      void n
    },
  },
})
void collision

// ==================== 非冲突时基座成员照旧 ====================

const normal = createStore({
  name: 'ctx-normal',
  state: { count: 0 },
  actions: {
    bump(n: number) {
      this.setState('count', this.state.count + n)
      this.$patch({ count: this.getState().count })
      void this.name
      // 跨 action 调用仍走类型安全的 dispatch 重载
      this.dispatch('bump', 1)
      // 反例：宽松基座签名 `dispatch(actionName: string, ...args: unknown[])` 一旦回流，
      // 下面两条 @ts-expect-error 会同时变成 unused，typecheck:tests 立刻失败
      // @ts-expect-error 未声明的 action 名必须被拒绝
      this.dispatch('missing', 1)
      // @ts-expect-error 实参类型必须按已声明的 action 签名校验
      this.dispatch('bump', 'x')
      // @ts-expect-error 实参个数同样受检（bump 需要一个参数）
      this.dispatch('bump')
    },
  },
})
void normal

// ==================== A 为擦除形状（索引签名）时基座不得被清空 ====================

type ErasedCtx = ActionContext<{ count: number }, Actions>
declare const erased: ErasedCtx
const _erasedState: { count: number } = erased.state
const _erasedName: string = erased.name
// 注：本行不具锁定力，只记录「基座成员在擦除分支下仍可调用」这一形状。
// `Actions` 的索引签名 `(...args: any[]) => any` 也参与交叉：即使基座被整体剔掉（本文件要防的回归），
// `erased.setState('count', 1)` 也会命中索引签名而编译通过，写反例（如 `erased.setState('nope', 1)`）
// 同样会被索引签名放行。该分支真正的守卫是上面两条赋值断言——函数类型不可赋给
// `{ count: number }` / `string`，基座一旦被清空它们立即报错。
erased.setState('count', 1)
void [_erasedState, _erasedName]

// 具体 action 集合（无索引签名，等价于从字面量推断出的 A）下同名键的解析结果：
// 基座成员已被剔除，只剩用户签名
type LiteralActions = { getState(): number; bump(n: number): void }
type CtxWithCollision = ActionContext<{ count: number }, LiteralActions>
declare const collided: CtxWithCollision
const _fromUser: number = collided.getState()
void _fromUser
// @ts-expect-error 基座的 getState 已让位给用户 action，不再返回状态对象
const _fromBase: { count: number } = collided.getState()
void _fromBase
// 未冲突的基座成员照旧可用
const _patchStillThere: void = collided.$patch({ count: 3 })
void _patchStillThere

export {}
