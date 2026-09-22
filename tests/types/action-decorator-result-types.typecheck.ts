/**
 * Action 公开类型面回归（G4-types-tests medium p1 #397 / #398 / #399，编译期断言）
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时，仅由 `pnpm typecheck:tests` 校验。
 *
 * 锁定行为：
 * - #397 `ActionDecorator` 与 lib `MethodDecorator` 双向等价：库内所有公开装饰器的返回值
 *   都能赋给它（修复前 `const d: ActionDecorator = withRetry()` 因 `target: unknown` 的参数逆变而编译不过）
 * - #398 `ActionResult` 是以 `success` 判别的联合：非法组合不可表示，
 *   但既有消费方「未收窄直接读 `.data` / `.error`」的写法仍然编译通过
 * - #399 `ActionExecutionContext` 默认泛型约束到 `State` / `Actions`，
 *   `ctx.actions.xxx()` 默认可调用，且非 Actions 的类型实参被约束拒绝
 *
 * @file tests/types/action-decorator-result-types.typecheck.ts
 */

import type { ActionDecorator, ActionExecutionContext, ActionResult } from '@/types/action.js'
import type { Actions, State } from '@/types/store.js'
import { withCache } from '@/extras/action/decorators/cache.js'
import { withRetry } from '@/extras/action/decorators/retry.js'
import { withTimeout } from '@/extras/action/decorators/timeout.js'
import { withLoading } from '@/extras/action/withLoading.js'

// ==================== #397：ActionDecorator ⇄ MethodDecorator ====================

type MD = MethodDecorator

// 双向等价（修复前只有 ActionDecorator → MethodDecorator 单向成立）
const _decoratorIsMethodDecorator: [ActionDecorator] extends [MD] ? true : false = true
const _methodDecoratorIsActionDecorator: [MD] extends [ActionDecorator] ? true : false = true

// 消费者真实写法：把库内公开装饰器存进 ActionDecorator 变量
const _fromRetry: ActionDecorator = withRetry()
const _fromCache: ActionDecorator = withCache()
const _fromTimeout: ActionDecorator = withTimeout(100)
const _fromLoading: ActionDecorator = withLoading()

// 装饰器语法位上也可直接使用（与 src 内所有装饰器的返回类型一致）
class DemoHost {
  @withRetry()
  run(): number {
    return 1
  }
}
const _demoHostOk = new DemoHost().run()

// ==================== #398：ActionResult 为判别联合 ====================

interface UserDto {
  id: string
}

declare const results: ActionResult<UserDto>[]

// 未收窄也可读（既有消费方写法，不能因为改成联合而破功）
const _data = results[0].data
const _error = results[0].error
const _message = results[0].error?.message
const _duration = results[0].duration

// 收窄后类型精确
function describe(r: ActionResult<UserDto>): string {
  return r.success ? `${r.data.id} @ ${r.duration}` : r.error.message
}

// 成功分支不再允许携带 error（修复前 `success: true` + `error` 可表示）
// @ts-expect-error 非法状态：success: true 与 error 互斥
const _illegal: ActionResult<UserDto> = { success: true, data: { id: '1' }, error: new Error('x'), startTime: 0, endTime: 1, duration: 1 }
// @ts-expect-error 非法状态：success: false 与 data 互斥
const _illegal2: ActionResult<UserDto> = { success: false, data: { id: '1' }, startTime: 0, endTime: 1, duration: 1 }
// @ts-expect-error 失败分支必须给出已归一化的 error
const _missingError: ActionResult<UserDto> = { success: false, startTime: 0, endTime: 1, duration: 1 }
// 只断言「error 必填」不足以锁定归一化契约：把类型退化成 `error: unknown`（或隐式 any）时
// 上面那行照样报错、下面这行却会编译通过，故再加一条反例钉住「非 Error 值不可表示」。
// @ts-expect-error error 必须已归一化为 Error，裸字符串不可表示
const _unnormalizedError: ActionResult<UserDto> = { success: false, error: 'boom', startTime: 0, endTime: 1, duration: 1 }

// 合法的两条分支
const _ok: ActionResult<UserDto> = { success: true, data: { id: '1' }, startTime: 0, endTime: 1, duration: 1 }
const _failed: ActionResult<UserDto> = { success: false, error: new Error('x'), startTime: 0, endTime: 1, duration: 1 }

// ActionHistory 一类的消费点：Map<string, ActionResult[]> 仍可直接写入与遍历统计
declare const history: Map<string, ActionResult[]>
history.set('a', [_ok, _failed])
// 命名与算法一致：这里是**总时长**（reduce 初值 0 求和），不是平均值。
// 真实消费方（src/extras/action/ActionHistory.ts 的 getStats）算的是 totalDuration / total，
// 此前把它叫 `_avgDuration` 会让本夹具的读者以为平均值也走同一条路径。
const _totalDuration = [...history.values()].flat().reduce((sum, r) => sum + r.duration, 0)

// ==================== #399：ActionExecutionContext 默认泛型 ====================

// 默认类型参数下 actions 可直接调用（修复前默认 `unknown`，一切调用都要断言）
declare const ctx: ActionExecutionContext
const _called: unknown = ctx.actions.fetchUser('id-1')
const _stateIsObject: State = ctx.state

// 显式实参仍精确
interface CounterState {
  count: number
}
// 注：A 的约束是 `Actions`（Record 索引签名），故类型实参须是 type alias / 推断出的字面量类型；
// 用 `interface` 声明 action 集合会因缺少隐式索引签名而不满足约束——与 `Store<S, A extends Actions>`
// 及 `ActionExecutor` / `ActionUtils` 的既有口径完全一致，本处刻意沿用。
type CounterActions = { inc(step: number): void }
declare const typedCtx: ActionExecutionContext<CounterState, CounterActions>
const _count: number = typedCtx.state.count
typedCtx.actions.inc(2)
// @ts-expect-error 形参类型由实参 A 保留
typedCtx.actions.inc('nope')

// A 必须满足 Actions 约束
// @ts-expect-error 非 Actions 的类型实参被拒绝
declare const _badCtx: ActionExecutionContext<CounterState, { notAnAction: string }>

// 任何 Actions 形状都满足默认约束（约束位点未收紧到具体签名）
declare const anyActions: Actions
const _ctxFromActions: ActionExecutionContext = { state: {}, actions: anyActions, actionName: 'a', args: [] }

export { _decoratorIsMethodDecorator, _methodDecoratorIsActionDecorator, _fromRetry, _fromCache, _fromTimeout, _fromLoading }
export { _demoHostOk, _data, _error, _message, _duration, describe, _illegal, _illegal2, _missingError, _unnormalizedError, _ok, _failed }
export { _totalDuration, _called, _stateIsObject, _count, _ctxFromActions }
