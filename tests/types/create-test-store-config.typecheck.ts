/**
 * createTestStore 的入参约束（编译期断言）— #420
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - `state` 必填：与 `createStore` 两个公开重载同口径（此前整调用的 `@ts-expect-error`
 *   连带把「漏写 state / 配置形状不对」也一起吞掉）
 * - 两种 state 形态（对象字面量 / 工厂函数）仍精确推断出 S（Equal 逐字断言，见 #R5-345）
 * - state 工厂返回非对象形状**当前在 `createStore` 与 `createTestStore` 两个入口上都不受检**，
 *   故本文件不写该反例断言（缺口与实测证据见文件末 #R5-346 的说明）
 * - action 内的 `this` 仍是 ActionContext（`this.state` 可用）：这是本工厂**不能**改用
 *   `StoreConfig` 复刻重载的原因——`StoreConfig.actions` 的 `ThisType` 实参含未展开的
 *   `ResolveState<S>` 条件类型，实测让 `this` 退化为 `{}`
 *
 * @file tests/types/create-test-store-config.typecheck.ts
 */

import { createTestStore } from '../utils/createTestStore.js'

/**
 * 双向精确类型相等断言（与 tests/types/integration-types.typecheck.ts 同口径）
 *
 * 本文件目的是「钉住精确推断 S」，而 `const _c: number = ...` 这类可赋值断言在结果被漂白成
 * `any` / 收成 `never` 时都会白过，故精确性一律走 Equal。
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

// 正例：对象字面量形态（actions 内不写 this 标注，靠 StoreOptions 的 ThisType 注入）
const literal = createTestStore({
  state: { count: 0, label: '' },
  actions: {
    bump() {
      const _c: number = this.state.count
      void _c
    },
  },
})
const _literalCount: number = literal.getState().count
// 精确锁定（#R5-345）：`this.state.count` 与 `getState().count` 的可赋值断言在 S 被漂白成
// `any`（或退化成 `never`）时同样通过，这里要求 getState() 的返回类型逐字等于手写形状。
const _literalStateExact: Equal<ReturnType<typeof literal.getState>, { count: number; label: string }> = true

// 正例：工厂函数形态
const factory = createTestStore({
  state: (): { n: number } => ({ n: 1 }),
})
const _factoryN: number = factory.getState().n
const _factoryStateExact: Equal<ReturnType<typeof factory.getState>, { n: number }> = true

// 反例：state 必填（此前 createTestStore({}) 编译通过，而真实 API 会拒绝）
// @ts-expect-error 缺少必需的 state
createTestStore({})

// 反例：state 形状写错仍会被检查（不再有整调用的抑制指令兜底）
// @ts-expect-error state 不是对象也不是工厂
createTestStore({ state: 42 })

// 反例（#R5-346，实测后撤回）：报告建议的「工厂返回非对象形状应被拒」目前**在两个入口上都还没被实现**，
// 故这里不写 @ts-expect-error（写了就是 unused 指令、typecheck:tests 直接失败）。证据：
//   npx tsc -p tsconfig.tests.json --noEmit
//     create-test-store-config.typecheck.ts(68,1): error TS2578: Unused '@ts-expect-error' directive.
//   （指令挂在 `createStore({ state: () => 1 })` 上）
// 机理：`createStore` 的字面量重载 `state: S` 允许 `S` 直接吸收成 `() => number`（函数满足
// `S extends State` = `object`），`TestStoreConfig<S>` 的 `state: S | (() => S)` 同理。
// ⇒ 缺口在 src/types/store.ts 的 `StoreOptionsBase.state` 与 tests/utils/createTestStore.ts 的
//   `TestStoreConfig`（本轮各记一条 NEEDS-MAIN）。收紧后本处应补：
//   // @ts-expect-error 工厂返回的不是 state 对象
//   createTestStore({ state: () => 1 })

void [_literalCount, _factoryN, _literalStateExact, _factoryStateExact]
export {}
