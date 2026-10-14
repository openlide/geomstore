/**
 * GeomStore 基础示例 3：Getter（派生状态）
 *
 * 覆盖：getter 定义、经 store.getter(name) 读取。getter 每次调用按当前状态重算，Store 不缓存它的结果。
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

// 提纯函数共用 subtotal 公式：getter 之间不能相互调用，两处字面量若各写一份
// 未来定价规则改动就会悄悄漂移
function calcSubtotal(state: CartState): number {
  return state.items.reduce((sum, item) => sum + item.price * item.count, 0)
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
    // 只读派生值：保持纯函数便于调试；需要「依赖未变则复用」请用 extras/selector 的 createSelector
    subtotal: (state: CartState) => calcSubtotal(state),
    // getter 只接收 state（需要组合时在函数内自行计算）
    total(state: CartState) {
      return Math.max(0, calcSubtotal(state) - state.coupon)
    },
  },
  actions: {
    // action 的 this 由 Store 自动注入，无需手写标注。
    // 语义是「覆盖优惠券金额」（不是累加）：$patch({ coupon: amount })，
    // 命名 setCoupon 与实现对齐；此前叫 addCoupon 会让人误以为
    // addCoupon(100) 得到 50+100=150，实际是 100
    setCoupon(amount: number): void {
      this.$patch({ coupon: amount })
    },
  },
})

// 读取 getter（泛型签名会推导出返回类型）。注意：每一次 getter() 都会重算，
// Store 侧没有 getter 结果缓存，重复读取的收益只是类型收敛与写法统一
console.log('小计:', cartStore.getter('subtotal'))
console.log('应付:', cartStore.getter('total'))

// 修改依赖后重新计算
cartStore.dispatch('setCoupon', 100)
console.log('改券后应付:', cartStore.getter('total'))

console.log('\n✅ 基础示例 3 完成')
