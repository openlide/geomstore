/**
 * GeomStore 高级示例 - Store 组合
 *
 * 演示如何使用 composeStore 组合多个 Store
 */

import { createStore, composeStore } from '../../src'

// ==================== 创建多个独立的 Store ====================

// 用户 Store
const userStore = createStore({
  name: 'user',
  state: {
    id: 1,
    name: 'Alice',
    email: 'alice@example.com',
  },
  actions: {
    updateName(name: string) {
      // @ts-ignore
      this.setState('name', name)
    },
  },
})

// 购物车 Store
const cartStore = createStore({
  name: 'cart',
  state: {
    items: [] as Array<{ id: number; name: string; price: number }>,
  },
  actions: {
    addItem(item: { id: number; name: string; price: number }) {
      // @ts-ignore
      this.setState('items', [...this.state.items, item])
    },
  },
  getters: {
    total: (state) => state.items.reduce((sum, item) => sum + item.price, 0),
  },
})

// 设置 Store
const settingsStore = createStore({
  name: 'settings',
  state: {
    theme: 'light',
    language: 'zh-CN',
  },
  actions: {
    setTheme(theme: string) {
      // @ts-ignore
      this.setState('theme', theme)
    },
  },
})

// ==================== 组合 Store ====================

console.log('=== Store 组合示例 ===\n')

// 方式 1: 使用 composeStore 创建组合
const rootStore = composeStore({
  stores: {
    user: userStore,
    cart: cartStore,
    settings: settingsStore,
  },
})

console.log('Combined state:', rootStore.getState())

// 访问子 Store 状态
console.log('\nUser name:', rootStore.getState().user.name)
console.log('Cart items:', rootStore.getState().cart.items)
console.log('Theme:', rootStore.getState().settings.theme)

// 方式 2: 使用命名空间访问
rootStore.dispatch('user/updateName', 'Bob')
console.log('\nAfter updateName:', rootStore.getState().user.name)

rootStore.dispatch('cart/addItem', { id: 1, name: 'Product A', price: 100 })
console.log('After addItem:', rootStore.getState().cart.items)

// 使用 getter
console.log('Cart total:', rootStore.getState().cart.items.reduce((sum, item) => sum + item.price, 0))

// 订阅组合状态变化
const unsubscribe = rootStore.subscribe((state) => {
  console.log('\nRoot state changed:', state)
})

rootStore.dispatch('settings/setTheme', 'dark')

unsubscribe()

console.log('\n✅ Compose stores example completed')
