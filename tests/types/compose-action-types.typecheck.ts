/**
 * GeomStore v1.0.0 - 组合 Store / Action 执行器类型精确性回归测试（编译期断言）
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - ExtractStates 基例不向组合状态注入 [x: string]: never 索引签名
 * - ActionExecutor / ActionUtils 接受同步 + 异步混合的 actions（约束不再限定 AsyncActions）
 * - execute 对异步 action 返回解包后的值（不再出现 Promise<Promise<T>> 类型谎言）
 *
 * @file tests/types/compose-action-types.typecheck.ts
 */

import { composeStore, createStore } from '@/index.js'
import { ActionExecutor, ActionUtils } from '@/extras/index.js'

// ==================== ExtractStates 基例不被索引签名污染 ====================

const storeA = createStore({ name: 'compose-a', state: { count: 0 } })
const storeB = createStore({ name: 'compose-b', state: { name: 'x' } })

const composed = composeStore([storeA, storeB])
const composedState = composed.getState()

// 正例：各 Store 的状态键保持原始类型
const _composedCount: number = composedState.count
const _composedName: string = composedState.name

// 反例：不存在的属性应报错
// （修复前基例 Record<string, never> 注入 [x: string]: never，任意属性访问返回 never 且不报错）
// @ts-expect-error 'nope' 不在组合状态上
composedState.nope

// ==================== ActionExecutor / ActionUtils 约束放宽（同步 + 异步混合） ====================

// type alias 对象具有隐式索引签名，可满足 Actions 约束（interface 需 extends Actions）
type MixedActions = {
  fetchUser: (id: string) => Promise<{ id: string }>
  tick: () => number
}
declare const mixedActions: MixedActions

// 正例：混合 actions 满足约束（修复前 A extends AsyncActions 拒绝同步 action，此处编译报错）
const executor = new ActionExecutor<MixedActions>()
const utils = new ActionUtils<MixedActions>(mixedActions)

// 正例：异步 action 返回已解包（修复前为 Promise<Promise<{id: string}>>，then 回调参数是 Promise，user.id 报错）
// 两条 `.then` 断言都收进同一个 await 探针（#434）：此前链子既不 await 也不 catch，
// 一旦本文件被执行（jest testMatch 放宽、或经 ts-node/tsx 直跑）就是未处理拒绝；
// 且 `mixedActions` 是 `declare const`，真跑起来会在断言之前抛 ReferenceError
async function probeThenChannel(): Promise<void> {
  await executor.execute(mixedActions, 'fetchUser', 'u1').then((user) => {
    const _userId: string = user.id
    void _userId
  })
  await executor.execute(mixedActions, 'tick').then((n) => {
    const _tick: number = n
    void _tick
  })
}
void probeThenChannel

// 正例：await 结果直接可用。
// 返回类型写精确元组而不是 `[unknown, number]`（#435）：`unknown` 恰恰抹掉了本文件要锁的
// 那点精度——异步 action await 出来的是解包值，写成 unknown 时 Promise<Promise<T>> 也能过
async function probeExecutor(): Promise<[{ id: string }, number]> {
  const user: { id: string } = await executor.execute(mixedActions, 'fetchUser', 'u1')
  const n: number = await utils.execute(mixedActions, 'tick')
  return [user, n]
}
void probeExecutor
