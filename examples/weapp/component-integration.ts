/**
 * GeomStore 微信小程序集成示例 - Component 集成
 *
 * 演示如何在微信小程序 Component 中使用 GeomStore
 */

import { createStore } from '../../src'
import { withComponentStore } from '../../src/integrations'

// 创建购物车 Store
const cartStore = createStore({
  name: 'cart-store',
  state: () => ({
    items: [] as Array<{ id: number; name: string; price: number; quantity: number }>,
    totalCount: 0,
  }),
  actions: {
    addItem(item: { id: number; name: string; price: number }) {
      const existingItem = this.state.items.find((i) => i.id === item.id)
      if (existingItem) {
        const items = this.state.items.map((i) => (i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i))
        this.setState('items', items)
      } else {
        this.setState('items', [...this.state.items, { ...item, quantity: 1 }])
      }
      this.setState('totalCount', this.state.totalCount + 1)
    },
    removeItem(id: number) {
      const item = this.state.items.find((i) => i.id === id)
      if (item) {
        const items = this.state.items.filter((i) => i.id !== id)
        this.setState('items', items)
        this.setState('totalCount', this.state.totalCount - item.quantity)
      }
    },
  },
  getters: {
    totalPrice: (state) => state.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  },
})

// ==================== Component 集成示例 ====================

// 购物车商品列表组件
Component(
  withComponentStore(cartStore, {
    mapState: ['items', 'totalCount'],
    mapGetters: ['totalPrice'],
    mapActions: ['addItem', 'removeItem'],
  })({
    data: {
      componentName: 'cart-list',
    },
    methods: {
      onAddItem(this: any, e: { currentTarget: { dataset: { item: { id: number; name: string; price: number } } } }) {
        const item = e.currentTarget.dataset.item
        this.addItem(item)
      },
      onRemoveItem(this: any, e: { currentTarget: { dataset: { id: number } } }) {
        const id = e.currentTarget.dataset.id
        this.removeItem(id)
      },
    },
    lifetimes: {
      attached(this: any) {
        console.log('Cart component attached')
        console.log('Cart items:', this.data.items)
        console.log('Total count:', this.data.totalCount)
        console.log('Total price:', this.data.totalPrice)
      },
      detached() {
        console.log('Cart component detached, subscriptions cleaned up automatically')
      },
    },
  }),
)

console.log('✅ Component integration examples defined')
console.log('Note: These examples are for demonstration. Run in WeChat Mini Program environment.')
