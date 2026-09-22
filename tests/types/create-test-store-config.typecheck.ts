/**
 * createTestStore 的入参约束（编译期断言）— #420
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - `state` 必填：与 `createStore` 两个公开重载同口径（此前整调用的 `@ts-expect-error`
 *   连带把「漏写 state / 配置形状不对」也一起吞掉）
 * - 两种 state 形态（对象字面量 / 工厂函数）仍精确推断出 S
 * - action 内的 `this` 仍是 ActionContext（`this.state` 可用）：这是本工厂**不能**改用
 *   `StoreConfig` 复刻重载的原因——`StoreConfig.actions` 的 `ThisType` 实参含未展开的
 *   `ResolveState<S>` 条件类型，实测让 `this` 退化为 `{}`
 *
 * @file tests/types/create-test-store-config.typecheck.ts
 */

import { createTestStore } from '../utils/createTestStore.js'

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

// 正例：工厂函数形态
const factory = createTestStore({
  state: (): { n: number } => ({ n: 1 }),
})
const _factoryN: number = factory.getState().n

// 反例：state 必填（此前 createTestStore({}) 编译通过，而真实 API 会拒绝）
// @ts-expect-error 缺少必需的 state
createTestStore({})

// 反例：state 形状写错仍会被检查（不再有整调用的抑制指令兜底）
// @ts-expect-error state 不是对象也不是工厂
createTestStore({ state: 42 })

void [_literalCount, _factoryN]
export {}
