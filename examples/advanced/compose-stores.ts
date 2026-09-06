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
  state: () => ({
    id: 1,
    name: 'Alice',
    email: 'alice@example.com',
  }),
  actions: {
    updateName(name: string) {
      this.setState('name', name)
    },
  },
})

// 购物车 Store
const cartStore = createStore({
  name: 'cart',
  state: () => ({
    items: [] as Array<{ id: number; name: string; price: number }>,
  }),
  actions: {
    addItem(item: { id: number; name: string; price: number }) {
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
  state: () => ({
    theme: 'light',
    language: 'zh-CN',
  }),
  actions: {
    setTheme(theme: string) {
      this.setState('theme', theme)
    },
  },
})

// ==================== 组合 Store ====================

console.log('=== Store 组合示例 ===\n')

// 使用 composeStore 创建组合（数组形式 + 命名空间）
const rootStore = composeStore([userStore, cartStore, settingsStore], {
  namespace: true, // 启用命名空间，支持 'storeName/actionName' 斜杠路径
  strict: true,
})

// composeStore 在 namespace 模式下运行时将各子 store 按 name 嵌套为
// { user, cart, settings }，但当前类型将其推断为状态扁平交叉类型，
// 这里用一次断言对齐运行时结构。
type RootState = {
  user: { id: number; name: string; email: string }
  cart: { items: Array<{ id: number; name: string; price: number }> }
  settings: { theme: string; language: string }
}
const rootState = () => rootStore.getState() as unknown as RootState

console.log('Combined state:', rootState())

// 访问子 Store 状态
console.log('\nUser name:', rootState().user.name)
console.log('Cart items:', rootState().cart.items)
console.log('Theme:', rootState().settings.theme)

// 命名空间 dispatch
rootStore.dispatch('user/updateName', 'Bob')
console.log('\nAfter updateName:', rootState().user.name)

rootStore.dispatch('cart/addItem', { id: 1, name: 'Product A', price: 100 })
console.log('After addItem:', rootState().cart.items)

// 使用 getter
console.log('Cart total:', rootState().cart.items.reduce((sum, item) => sum + item.price, 0))

// 订阅组合状态变化
const unsubscribe = rootStore.subscribe((state) => {
  console.log('\nRoot state changed:', state)
})

rootStore.dispatch('settings/setTheme', 'dark')

unsubscribe()

console.log('\n✅ Compose stores example completed')
