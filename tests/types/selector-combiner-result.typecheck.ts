/**
 * 选择器组合入参的结果类型契约（编译期断言）— #409
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - `SelectorComposerInput` 的第 3 个类型参数 `R` 与 combiner 的返回类型直接关联：
 *   显式给出 R 时，combiner 返回其它类型（拼错属性 / 返回字符串）编译失败——
 *   此前 combiner 返回 `unknown`，任何返回值都被静默接受
 * - 未给 R（既有两参数写法）时行为不变：`combine` 的入参 `SelectorComposerInput<S, T>`
 *   仍是 `R = unknown`，故本轮不产生破坏性变更（extras 侧把 R 透传后 `as R` 断言才可删除）
 * - combiner 形参保持 `any[]`：具体形参的 combiner 必须仍可传入（`unknown[]` 会因参数逆变被拒）
 *
 * @file tests/types/selector-combiner-result.typecheck.ts
 */

import type { Selector, SelectorComposerInput } from '@/types/selector.js'

interface OrderState {
  base: number
  taxRate: number
  coupon: { code: string }
}

const base: Selector<OrderState, number> = (s) => s.base
const tax: Selector<OrderState, number> = (s) => s.base * s.taxRate

// ==================== 正例：combiner 返回类型与 R 一致 ====================

const okInput: SelectorComposerInput<OrderState, [typeof base, typeof tax], number> = {
  selectors: [base, tax],
  combiner: (b: number, t: number) => b + t,
}
void okInput

// 对象结果同样精确
const okObjectInput: SelectorComposerInput<OrderState, [typeof base, typeof tax], { total: number }> = {
  selectors: [base, tax],
  combiner: (b: number, t: number) => ({ total: b + t }),
}
void okObjectInput

// ==================== 反例：R 已给出时 combiner 返回类型受检 ====================

const badReturn: SelectorComposerInput<OrderState, [typeof base, typeof tax], number> = {
  selectors: [base, tax],
  // 报错落在 combiner 这一行，故指令贴在属性上方
  // @ts-expect-error 返回类型与 R 不符
  combiner: () => 'nope',
}
void badReturn

const badShape: SelectorComposerInput<OrderState, [typeof base, typeof tax], { total: number }> = {
  selectors: [base, tax],
  // @ts-expect-error 返回对象的键与 R 不符（拼错的 totall）
  combiner: (b: number, t: number) => ({ totall: b + t }),
}
void badShape

const missingReturn: SelectorComposerInput<OrderState, [typeof base, typeof tax], number> = {
  selectors: [base, tax],
  // @ts-expect-error combiner 隐式返回 undefined，不满足 R = number
  combiner: (b: number, t: number) => {
    void b
    void t
  },
}
void missingReturn

// ==================== 兼容：两参数写法（R 默认 unknown）行为不变 ====================

const legacyInput: SelectorComposerInput<OrderState, [typeof base, typeof tax]> = {
  selectors: [base, tax],
  combiner: (b: number, t: number) => b + t,
}
void legacyInput
// 未声明 R 时任意返回值仍被接受（这正是 combine 内部 `as R` 依赖的现有形状）
const legacyAnyReturn: SelectorComposerInput<OrderState, [typeof base, typeof tax]> = {
  selectors: [base, tax],
  combiner: () => 'anything',
}
void legacyAnyReturn

// ==================== combiner 形参：具体类型必须可传（any[] 的必要性） ====================

const narrowParams: SelectorComposerInput<OrderState, [typeof base, typeof tax], number> = {
  selectors: [base, tax],
  combiner: (b: number, t: number, ...rest: unknown[]) => b + t + rest.length,
}
void narrowParams

export {}
