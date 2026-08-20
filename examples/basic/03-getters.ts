/**
 * GeomStore Getters 示例
 *
 * 演示如何使用计算属性 (Getters)
 */

import { createStore } from '../../src'

// getter 只接收 state 一个参数；需要复用计算逻辑时可提取辅助函数
const calcSubtotal = (items: Array<{ price: number; quantity: number }>) => items.reduce((sum, item) => sum + item.price * item.quantity, 0)

// 创建带有 Getters 的 Store
const cartStore = createStore({
  name: 'shopping-cart',
  state: () => ({
    items: [
      { id: 1, name: 'Apple', price: 1.5, quantity: 3 },
      { id: 2, name: 'Banana', price: 0.8, quantity: 5 },
      { id: 3, name: 'Orange', price: 2.0, quantity: 2 },
    ] as Array<{ id: number; name: string; price: number; quantity: number }>,
    taxRate: 0.08,
  }),
  getters: {
    itemCount: (state) => state.items.reduce((sum, item) => sum + item.quantity, 0),
    subtotal: (state) => calcSubtotal(state.items),
    tax: (state) => calcSubtotal(state.items) * state.taxRate,
    total: (state) => calcSubtotal(state.items) * (1 + state.taxRate),
    isEmpty: (state) => state.items.length === 0,
  },
})

// 使用 Getters
console.log('Shopping Cart:')
console.log('  Item count:', cartStore.getter('itemCount'))
console.log('  Subtotal: $', cartStore.getter('subtotal').toFixed(2))
console.log('  Tax: $', cartStore.getter('tax').toFixed(2))
console.log('  Total: $', cartStore.getter('total').toFixed(2))
console.log('  Is empty?', cartStore.getter('isEmpty'))

// 添加商品后重新计算
cartStore.setState('items', [...cartStore.getState().items, { id: 4, name: 'Grapes', price: 3.5, quantity: 1 }])

console.log('\nAfter adding grapes:')
console.log('  Item count:', cartStore.getter('itemCount'))
console.log('  Total: $', cartStore.getter('total').toFixed(2))

console.log('\n✅ Getters example completed')
