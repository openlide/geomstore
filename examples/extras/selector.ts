/**
 * Extras 示例：选择器（派生值缓存）
 *
 * 覆盖：createSelector 的缓存、createParametricSelector 的参数化缓存、
 * 以及选择器与 Store 状态版本号配合的失效语义。
 *
 * 发布包等价导入：`@openlide/geomstore/extras/selector`
 */

import { createStore } from '../../src/index.js'
import { createParametricSelector, createSelector } from '../../src/extras/selector.js'

// 先定义状态类型：选择器的参数类型直接引用它，不再重复书写字面量；
// 字面量联合（'paid' | 'unpaid'）也只需声明一处，无需在每个初始值上写 `as const`
export interface Order {
  id: number
  amount: number
  status: 'paid' | 'unpaid'
}

export interface OrderState {
  orders: Order[]
  rate: number
}

export const orderStore = createStore({
  name: 'orders',
  state: (): OrderState => ({
    orders: [
      { id: 1, amount: 100, status: 'paid' },
      { id: 2, amount: 50, status: 'unpaid' },
    ],
    rate: 0.9,
  }),
})

// 基础选择器：接收「单个选择器函数 + 选项」；多步计算在函数体内完成
// 依赖未变时复用缓存（判定依据是 Store 的状态版本号）
export const selectPaidTotal = createSelector((state: OrderState) =>
  state.orders.filter((order) => order.status === 'paid').reduce((sum, order) => sum + order.amount, 0),
)

console.log('已支付合计:', selectPaidTotal(orderStore.getState()))

/**
 * 参数化选择器：同一状态函数下按参数分别缓存（注意 ttl 与容量上限）
 *
 * 两条必须一起成立的约定：
 * 1. 选择器体**只读入参 `state`**。绕过去读 `orderStore.getState()`，等于用一份状态取数、
 *    拿另一份状态当失效凭证——`$replaceState` / `$restore` 会深拷贝并整树换新对象，
 *    旧对象的版本号是常量，结果就永远缓存在旧 state 键下（TTL 内直接命中，过期重算仍是同一份错值）。
 * 2. 工厂 `(state) => (params) => R` 的返回值**不要长期持有**，每次取值都绑定当前状态。
 *    绑定是 O(1) 的：内层缓存挂在闭包里的 `WeakMap<state, …>` 上，同一个 state 对象重复绑定
 *    仍复用同一份条目，既没丢缓存收益也不会读到旧状态。
 *
 * 需要跨 Store 取值时走 `createStructuredSelector` / `composeStore`，
 * 而不是在选择器体里读另一个 Store 的活状态。
 */
export const selectDiscountedFor = createParametricSelector(
  (state: OrderState, id: number) => {
    const order = state.orders.find((o) => o.id === id)
    return (order?.amount ?? 0) * state.rate
  },
  { ttl: 5000, maxEntries: 50 },
)

/** 某个订单的折后金额：以「当前状态」绑定，失效凭证与实际读取的是同一份状态 */
export function selectDiscounted(id: number): number {
  return selectDiscountedFor(orderStore.getState())(id)
}

console.log('订单 1 折后:', selectDiscounted(1))
console.log('订单 2 折后:', selectDiscounted(2))

console.log('\n✅ 选择器样例完成')
