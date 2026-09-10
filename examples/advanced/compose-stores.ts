/**
 * 高级示例：Store 组合
 *
 * 覆盖：composeStore 的命名空间模式、斜杠路径 dispatch、组合订阅。
 *
 * 发布包等价导入：`import { composeStore } from '@openlide/geomstore'`
 */

import { composeStore, createStore } from '../../src/index.js'

// 先定义各自的状态类型：action 参数与 RootState 都引用同一命名类型，
// 不必反复书写 `Array<{ id: number; name: string; price: number }>` 这类字面量
interface UserState {
  id: number
  name: string
  email: string
}

interface CartItem {
  id: number
  name: string
  price: number
}

interface CartState {
  items: CartItem[]
}

interface SettingsState {
  theme: string
  language: string
}

// 各 action 的 this 均由 Store 自动注入，无需手写标注
const userStore = createStore({
  name: 'user',
  state: (): UserState => ({ id: 1, name: 'Alice', email: 'alice@example.com' }),
  actions: {
    updateName(name: string): void {
      this.$patch({ name })
    },
  },
})

const cartStore = createStore({
  name: 'cart',
  state: (): CartState => ({ items: [] }),
  actions: {
    addItem(item: CartItem): void {
      this.$patch({ items: [...this.state.items, item] })
    },
  },
})

const settingsStore = createStore({
  name: 'settings',
  state: (): SettingsState => ({ theme: 'light', language: 'zh-CN' }),
  actions: {
    setTheme(theme: string): void {
      this.$patch({ theme })
    },
  },
})

// namespace: true → 子 store 按 name 嵌套，dispatch 用 'storeName/actionName'
const rootStore = composeStore([userStore, cartStore, settingsStore], {
  namespace: true,
  strict: true,
})

/**
 * 组合状态的类型：当前 `getState()` 的返回类型为各子 store 状态的交叉类型，
 * 而命名空间模式下运行时结构是按 name 嵌套的 —— 因此这里做一次断言对齐运行时结构。
 * （若不需要命名空间，可传 `namespace: false`，此时状态为扁平结构。）
 */
interface RootState {
  user: UserState
  cart: CartState
  settings: SettingsState
}

const readRoot = (): RootState => rootStore.getState() as unknown as RootState

console.log('组合状态:', readRoot().user.name, '/', readRoot().settings.theme)

// 斜杠路径 dispatch 到对应子 store 的 action
rootStore.dispatch('user/updateName', 'Bob')
rootStore.dispatch('cart/addItem', { id: 1, name: 'Product A', price: 100 })
rootStore.dispatch('settings/setTheme', 'dark')

const state = readRoot()
console.log('更新后:', state.user.name, '/', state.cart.items.length, '件商品 /', state.settings.theme)

// 组合订阅：任一子 store 变化都会收到通知
const unsubscribe = rootStore.subscribe((next) => {
  console.log('组合状态变化:', (next as unknown as RootState).settings.theme)
})
rootStore.dispatch('settings/setTheme', 'light')
unsubscribe()

console.log('\n✅ Store 组合示例完成')
