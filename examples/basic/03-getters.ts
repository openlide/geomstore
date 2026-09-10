/**
 * GeomStore 基础示例 3：Getter（派生状态）
 *
 * 覆盖：getter 定义、经 store.getter(name) 读取、依赖未变时复用缓存。
 */

import { createStore } from '../../src/index.js'

// 先定义状态类型：getter 直接引用命名类型，不必重复书写同一份字面量
interface CartItem {
  name: string
  price: number
  count: number
}

interface CartState {
  items: CartItem[]
  coupon: number
}

const cartStore = createStore({
  name: 'cart',
  state: (): CartState => ({
    items: [
      { name: '键盘', price: 399, count: 1 },
      { name: '鼠标', price: 199, count: 2 },
    ],
    coupon: 50,
  }),
  getters: {
    // 只读派生值：建议保持纯函数，便于缓存命中与调试
    subtotal: (state: CartState) => state.items.reduce((sum, item) => sum + item.price * item.count, 0),
    // getter 只接收 state（需要组合时在函数内自行计算，保持纯函数便于缓存）
    total(state: CartState) {
      const subtotal = state.items.reduce((sum, item) => sum + item.price * item.count, 0)
      return Math.max(0, subtotal - state.coupon)
    },
  },
  actions: {
    // action 的 this 由 Store 自动注入，无需手写标注
    addCoupon(amount: number): void {
      this.$patch({ coupon: amount })
    },
  },
})

// 读取 getter（泛型签名会推导出返回类型）
console.log('小计:', cartStore.getter('subtotal'))
console.log('应付:', cartStore.getter('total'))

// 修改依赖后重新计算
cartStore.dispatch('addCoupon', 100)
console.log('改券后应付:', cartStore.getter('total'))

console.log('\n✅ 基础示例 3 完成')
