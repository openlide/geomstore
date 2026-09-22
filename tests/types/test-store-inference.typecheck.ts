/**
 * createTestStore 的入参约束与返回类型精度（编译期断言）
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - 状态约束与全 API 同口径 `S extends State`（= object）：interface 声明的状态没有隐式
 *   字符串索引签名，旧的 `S extends Record<string, unknown>` 约束会直接拒收（TS2345），
 *   而真实 `createStore` 接受同样的输入
 * - `A` / `G` 从 actions / getters 字面量真实推断：返回的 Store 保留字面映射，
 *   `store.getter('double')` 精确到 number。工厂若退回 `StoreOptions<S>`（A/G 被默认值钉死），
 *   G 退化为 `Getters<S>` 的索引签名、结果只剩 unknown，下面 `const _double: number` 即报 TS2322
 *
 * @file tests/types/test-store-inference.typecheck.ts
 */

import { createTestStore } from '../utils/createTestStore.js'

interface ProfileState {
  nick: string
}

// ==================== 状态约束：interface 状态可用 ====================

declare const profileState: ProfileState
const profileStore = createTestStore({ state: profileState })
const _nick: string = profileStore.getState().nick
void _nick

// ==================== A / G 穿透：返回类型与 createStore 同精度 ====================

const store = createTestStore({
  state: { count: 0 },
  actions: {
    bump() {
      this.$patch({ count: this.state.count + 1 })
    },
  },
  getters: {
    double: (state: { count: number }) => state.count * 2,
  },
})

// getter 结果精确到 number（见头部：A/G 被钉死为默认值时这里只能是 unknown）
const _double: number = store.getter('double')
void _double

// 状态形状同样被保留：getState() 返回推断出的字面状态类型，而不是 any / object
const _count: number = store.getState().count
void _count

export {}
