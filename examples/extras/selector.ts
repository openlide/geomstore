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
interface Order {
  id: number
  amount: number
  status: 'paid' | 'unpaid'
}

interface OrderState {
  orders: Order[]
  rate: number
}

const orderStore = createStore({
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
const selectPaidTotal = createSelector((state: OrderState) =>
  state.orders.filter((order) => order.status === 'paid').reduce((sum, order) => sum + order.amount, 0),
)

console.log('已支付合计:', selectPaidTotal(orderStore.getState()))

// 参数化选择器：同一状态函数下按参数分别缓存（注意 ttl 与容量上限）
const selectDiscounted = createParametricSelector(
  (state: OrderState, id: number) => {
    const order = orderStore.getState().orders.find((o) => o.id === id)
    return (order?.amount ?? 0) * state.rate
  },
  { ttl: 5000, maxEntries: 50 },
)(orderStore.getState())

console.log('订单 1 折后:', selectDiscounted(1))
console.log('订单 2 折后:', selectDiscounted(2))

console.log('\n✅ 选择器样例完成')
