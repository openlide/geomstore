# GeomStore 入门指南

本指南将帮助你快速掌握 GeomStore 的使用方法，从基础概念到高级特性，循序渐进地学习如何在小程序项目中高效管理状态。

---

## 目录

1. [安装配置](#安装配置)
2. [基础用法](#基础用法)
3. [连接小程序](#连接小程序)
4. [插件系统](#插件系统)
5. [Store 组合](#store-组合)
6. [TypeScript 支持](#typescript-支持)
7. [常见问题](#常见问题)

---

## 安装配置

### 方式一：直接复制（推荐小程序项目）

微信小程序项目推荐直接复制编译产物：

1. 将 `dist` 文件夹复制到小程序项目的 `utils/geomstore/` 目录下：

```
你的小程序项目/
├── pages/
├── utils/
│   └── geomstore/
│       └── dist/           ← 复制整个 dist 文件夹
│           ├── index.js
│           ├── index.d.ts
│           └── ...
├── app.js
└── app.json
```

2. 在代码中引入：

```javascript
// 方式一：CommonJS
const { createStore } = require('./utils/geomstore/dist/index.js')

// 方式二：解构导入（如果支持）
const { createStore, withPageStore } = require('./utils/geomstore/dist/index.js')
```

> 💡 复制安装时，本文示例中的 `@openlide/geomstore`（含 `/integrations`、`/plugins` 等子路径）需替换为 `./utils/geomstore/dist/index.js` 全路径；采用 NPM 安装则无需修改。

### 方式二：NPM 安装

如果你的小程序项目使用 NPM：

```bash
# 进入小程序项目目录
cd your-miniprogram-project

# 安装依赖
npm install @openlide/geomstore

# 构建npm（微信开发者工具）
# 工具 -> 构建npm
```

```javascript
// 使用
const { createStore } = require('@openlide/geomstore')
```

### 方式三：源码引入（开发调试）

如果需要调试或二次开发，可以复制 `src` 源码目录：

```
小程序项目/
└── utils/
    └── geomstore/
        └── src/           ← 复制源码
```

---

## 基础用法

### 创建第一个 Store

```javascript
// stores/counter.js
const { createStore } = require('@openlide/geomstore')

const counterStore = createStore({
  // Store 名称（可选，用于调试）
  name: 'counter',

  // 状态（推荐使用工厂函数形式，初始化时执行一次并深拷贝）
  state: () => ({
    count: 0,
    step: 1
  }),

  // Actions：修改状态的方法（通过 this.state 读写状态，参数为调用时传入）
  actions: {
    // 增加
    increment() {
      this.state.count += this.state.step
    },

    // 减少
    decrement() {
      this.state.count -= this.state.step
    },

    // 设置步长
    setStep(newStep) {
      this.state.step = newStep
    },

    // 重置
    reset() {
      this.state.count = 0
      this.state.step = 1
    },

    // 异步操作
    async fetchCount() {
      const res = await wx.request({
        url: '/api/count'
      })
      this.state.count = res.data.count
    }
  },

  // Getters：派生状态
  getters: {
    doubleCount(state) {
      return state.count * 2
    },

    isPositive(state) {
      return state.count > 0
    }
  }
})

module.exports = { counterStore }
```

### 直接使用 Store

```javascript
const { counterStore } = require('./stores/counter')

// 获取状态
console.log(counterStore.state.count)  // 0

// 调用 action
counterStore.dispatch('increment')
console.log(counterStore.state.count)  // 1

// 使用 getter
console.log(counterStore.getter('doubleCount'))  // 2

// 订阅状态变化
const unsubscribe = counterStore.subscribe((state) => {
  console.log('状态已更新:', state)
})

// 取消订阅
unsubscribe()
```

### Action 详解

#### 同步 Action

```javascript
actions: {
  // 无参数 action
  increment() {
    this.state.count++
  },

  // 带参数 action
  add(amount) {
    this.state.count += amount
  },

  // 多参数 action
  addRange(start, end) {
    for (let i = start; i <= end; i++) {
      this.state.count += i
    }
  }
}

// 调用方式
store.dispatch('increment')
store.dispatch('add', 10)
store.dispatch('addRange', 1, 10)
```

#### 异步 Action

```javascript
actions: {
  // 异步获取数据
  async fetchData() {
    try {
      const res = await wx.request({ url: '/api/data' })
      this.state.data = res.data
    } catch (error) {
      console.error('获取数据失败:', error)
    }
  },

  // 带参数的异步 action
  async fetchUser(userId) {
    const res = await wx.request({
      url: `/api/users/${userId}`
    })
    this.state.currentUser = res.data
  },

  // 组合多个异步操作
  async loadAllData() {
    const [users, products] = await Promise.all([
      wx.request({ url: '/api/users' }),
      wx.request({ url: '/api/products' })
    ])
    this.state.users = users.data
    this.state.products = products.data
  }
}

// 调用异步 action
await store.dispatch('fetchData')
await store.dispatch('fetchUser', 123)
await store.dispatch('loadAllData')
```

#### Action 上下文

在 action 内部，`this` 指向 action 上下文，可通过 `this.state` 读写状态：

```javascript
actions: {
  async login(credentials) {
    // 通过 this.state 读写状态
    console.log(this.state.loading)

    // 调用其他 action
    await this.clearSession()

    // dispatch 其他 action
    this.dispatch('setLoading', true)

    try {
      const res = await wx.request({
        url: '/api/login',
        method: 'POST',
        data: credentials
      })
      this.state.user = res.data.user
      this.state.token = res.data.token
    } finally {
      this.dispatch('setLoading', false)
    }
  },

  clearSession() {
    this.state.user = null
    this.state.token = null
  },

  setLoading(loading) {
    this.state.loading = loading
  }
}
```

### Getter 详解

```javascript
getters: {
  // 基础 getter
  doubleCount(state) {
    return state.count * 2
  },

  // 返回对象
  userInfo(state) {
    return {
      name: state.user?.name || '未登录',
      avatar: state.user?.avatar || '/images/default-avatar.png',
      level: state.user?.level || 0
    }
  },

  // 返回函数（参数化 getter）
  getItemById(state) {
    return (id) => {
      return state.items.find(item => item.id === id)
    }
  },

  // 复杂计算
  totalPrice(state) {
    return state.cartItems.reduce((sum, item) => {
      return sum + item.price * item.quantity
    }, 0)
  }
}

// 使用 getter
const doubled = store.getter('doubleCount')
const info = store.getter('userInfo')
const item = store.getter('getItemById')(123)
const total = store.getter('totalPrice')
```

---

## 连接小程序

### 连接页面

使用 `withPageStore` 将 Store 连接到页面：

```javascript
// pages/index/index.js
const { withPageStore } = require('@openlide/geomstore/integrations')
const app = getApp()

Page(withPageStore(app.userStore, {
  // 映射配置
  mapState: ['userInfo', 'token', 'isLoggedIn'],
  mapGetters: ['displayName', 'isVip'],
  mapActions: ['login', 'logout', 'updateProfile']
})({
  // 页面配置
  data: {
    // 页面私有数据
    loading: false,
    showLoginModal: false
  },

  onLoad(options) {
    // 访问映射的状态
    console.log(this.data.userInfo)
    console.log(this.data.displayName)

    // 访问原始 store（withPageStore 不会向页面实例暴露 store 属性，
    // 请通过 getApp() 或模块导入的 store 引用访问）
    console.log(app.userStore.getState())  // 当前状态
  },

  onShow() {
    // 页面显示时自动更新状态
  },

  // 自定义方法
  handleLogin() {
    this.setData({ showLoginModal: true })
  },

  async doLogin(e) {
    const { username, password } = e.detail.value
    this.setData({ loading: true })

    try {
      await this.login({ username, password })
      this.setData({ showLoginModal: false })
      wx.showToast({ title: '登录成功' })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'error' })
    } finally {
      this.setData({ loading: false })
    }
  },

  handleLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          this.logout()
          wx.showToast({ title: '已退出' })
        }
      }
    })
  }
}))
```

### 连接组件

使用 `withComponentStore` 将 Store 连接到组件：

```javascript
// components/user-card/index.js
const { withComponentStore } = require('@openlide/geomstore/integrations')
const app = getApp()

Component(withComponentStore(app.userStore, {
  // 映射配置
  mapState: ['userInfo'],
  mapGetters: ['displayName', 'isVip'],
  mapActions: ['updateProfile']
})({
  // 组件属性
  properties: {
    showEdit: {
      type: Boolean,
      value: false
    }
  },

  // 组件数据
  data: {
    editing: false
  },

  // 生命周期
  lifetimes: {
    attached() {
      console.log('组件已挂载', this.data.userInfo)
    }
  },

  // 组件方法
  methods: {
    onEdit() {
      this.setData({ editing: true })
    },

    onSave(e) {
      const { nickname, avatar } = e.detail.value
      this.updateProfile({ nickname, avatar })
      this.setData({ editing: false })
      this.triggerEvent('updated', this.data.userInfo)
    }
  }
}))
```

### 连接 App

使用 `withAppStore` 将 Store 连接到 App：

```javascript
// app.js
const { createStore } = require('@openlide/geomstore')
const { withAppStore } = require('@openlide/geomstore/integrations')

// 创建全局 store
const globalStore = createStore({
  name: 'global',
  state: () => ({
    theme: 'light',
    language: 'zh_CN',
    systemInfo: null
  }),
  actions: {
    setTheme(theme) {
      this.state.theme = theme
    },
    setLanguage(language) {
      this.state.language = language
    },
    initSystemInfo() {
      this.state.systemInfo = wx.getSystemInfoSync()
    }
  }
})

App(withAppStore(globalStore)({
  onLaunch(options) {
    // 初始化系统信息
    this.store.dispatch('initSystemInfo')

    // 订阅状态变化
    this.store.subscribe((state) => {
      if (state.theme) {
        this.applyTheme(state.theme)
      }
    })
  },

  onShow() {},

  onHide() {},

  // 自定义方法
  applyTheme(theme) {
    // 应用主题
  },

  // 暴露 store 给页面使用
  globalStore
}))
```

### 自动注入配置

```javascript
// 自动注入状态到页面 data
Page(withPageStore(store, {
  // 自动注入配置
  autoInject: true,  // 显式开启（默认 false，不会自动注入）
  injectMapping: {
    // store 键 -> 本地键
    'userInfo': 'user',
    'isLoggedIn': 'loggedIn'
  },

  // 页面显示时更新注入
  autoUpdateOnShow: true  // 默认 false
})({
  onLoad() {
    // 自动注入后可访问
    console.log(this.data.user)      // 对应 store.userInfo
    console.log(this.data.loggedIn)  // 对应 store.isLoggedIn
  }
}))
```

---

## Action 装饰器

GeomStore 提供了多种装饰器，用于增强方法的行为。

> **注意**：这些是 **TypeScript 传统方法装饰器工厂**，需配合 `@decorator` 语法用于类方法（tsconfig 需开启 `experimentalDecorators: true`），不支持 `withX(fn, options)` 函数包装器写法。

### 内置装饰器

```typescript
import { 
  withLog, 
  withDebounce, 
  withThrottle, 
  withCache, 
  withRetry, 
  withTimeout 
} from '@openlide/geomstore'

class DataService {
  searchResults: unknown[] = []
  userData: unknown = null
  scrollPosition = 0

  // 防抖搜索 - 300ms 内只执行最后一次
  @withDebounce(300)
  async search(keyword: string) {
    const res = await fetch(`/api/search?q=${keyword}`)
    this.searchResults = await res.json()
  }
  
  // 节流更新 - 每 100ms 最多执行一次
  @withThrottle(100)
  updateScroll(position: number) {
    this.scrollPosition = position
  }
  
  // 缓存 API 响应 - 5 分钟缓存
  @withCache({ ttl: 300000 })
  async fetchUser(userId: string) {
    const res = await fetch(`/api/user/${userId}`)
    this.userData = await res.json()
    return this.userData
  }
  
  // 网络请求重试 - 最多 3 次，间隔 1000ms
  @withRetry({ retries: 3, delay: 1000 })
  async fetchWithRetry(url: string) {
    const res = await fetch(url)
    return res.json()
  }
  
  // 超时控制 - 10 秒超时
  @withTimeout(10000)
  async fetchWithTimeout() {
    const res = await fetch('/api/data')
    return res.json()
  }
}
```

### 组合装饰器

多个装饰器可以叠加在同一个方法上：

```typescript
// 重试 + 超时
@withRetry({ retries: 3, delay: 1000 })
@withTimeout(5000)
async safeFetch(url: string) {
  const res = await fetch(url)
  return res.json()
}

// 缓存 + 防抖
@withCache({ ttl: 60000 })
@withDebounce(300)
async cachedSearch(keyword: string) {
  const res = await fetch(`/api/search?q=${keyword}`)
  return res.json()
}
```

### 自定义装饰器

```typescript
import { createDecorator } from '@openlide/geomstore'

// 创建自定义装饰器：在方法执行前后插入逻辑
const withAudit = createDecorator({
  before: (...args) => {
    console.log('[Audit] action called with:', args)
  },
  after: (result) => {
    console.log('[Audit] action completed:', result)
  },
  onError: (error) => {
    console.error('[Audit] action failed:', error)
  }
})

// 使用自定义装饰器
class DataService {
  @withAudit
  async fetchData() {
    const res = await fetch('/api/data')
    return res.json()
  }
}
```

---

## 插件系统

### 内置插件

#### 日志插件

```javascript
const { loggerPlugin } = require('@openlide/geomstore/plugins')

// 安装日志插件
store.use(loggerPlugin)

// 效果：每次状态变化都会打印日志
// [GeomStore] State changed: { count: 1 }
// 注意：生产环境 (NODE_ENV=production) 下自动禁用，无性能影响
```

#### 持久化插件

```javascript
const { persistencePlugin } = require('@openlide/geomstore/plugins')

store.use(persistencePlugin({
  // 存储键名
  key: 'app-state',

  // 存储后端（默认使用微信存储）
  storage: {
    getItem: (key) => wx.getStorageSync(key),
    setItem: (key, value) => wx.setStorageSync(key, value),
    removeItem: (key) => wx.removeStorageSync(key)
  },

  // 状态过滤器（只持久化部分状态）
  filter: (state) => ({
    userInfo: state.userInfo,
    token: state.token,
    settings: state.settings
  }),

  // 是否在启动时恢复状态
  restore: true,

  // 防抖延迟（毫秒）
  debounce: 500,

  // 卸载插件时是否清除存储数据（默认 false，仅停止监听）
  // 注意：开启 debounce 时，卸载会先同步落盘防抖窗口内最后一次变更（clearOnUninstall 为 true 时跳过落盘直接清除）
  clearOnUninstall: false
}))
```

**说明：**

- `storage` 可省略：插件会自动检测微信环境并使用 `wx.getStorageSync` / `wx.setStorageSync`；两者都不可用时降级为进程内内存存储（开发模式输出告警），不影响运行。
- 启动恢复采用**合并语义**（`$patch`）：未持久化的键（如被 `filter` 过滤的键）保留初始值，不会被覆盖为 `undefined`。

#### DevTools 插件

```javascript
const { devtoolsPlugin } = require('@openlide/geomstore/plugins')

// 仅在开发环境启用
if (process.env.NODE_ENV === 'development') {
  store.use(devtoolsPlugin)
}

// 使用 DevTools
// 在控制台访问：
console.log(globalThis.__GEOMSTORE_STORES__)
console.log(globalThis.__GEOMSTORE_DEVTOOLS__)
```

### 自定义插件

```javascript
// 自定义插件结构
const myPlugin = {
  name: 'my-plugin',

  install(store) {
    // 插件安装逻辑
    console.log('插件已安装到', store.name)

    // 订阅状态变化
    const unsubscribe = store.subscribe((state) => {
      console.log('状态变化:', state)
    })

    // 监听 action
    store.hooks?.on('afterDispatch', (actionName, ...args) => {
      console.log(`Action ${actionName} 已执行`)
    })

    // 返回卸载函数
    return () => {
      unsubscribe()
      console.log('插件已卸载')
    }
  }
}

// 使用插件
store.use(myPlugin)
```

---

## Store 组合

对于大型应用，可以将多个 Store 组合起来管理：

```javascript
const { composeStore } = require('@openlide/geomstore')

// 创建多个独立 store
const userStore = createStore({
  name: 'user',
  state: () => ({ userInfo: null, token: '' }),
  actions: { /* ... */ }
})

const cartStore = createStore({
  name: 'cart',
  state: () => ({ items: [] }),
  actions: { /* ... */ }
})

const settingsStore = createStore({
  name: 'settings',
  state: () => ({ theme: 'light' }),
  actions: { /* ... */ }
})

// 组合多个 store
const rootStore = composeStore([userStore, cartStore, settingsStore], {
  namespace: true,  // 启用命名空间
  strict: true      // 严格模式
})

// 访问组合后的状态
console.log(rootStore.state)  // { user: {...}, cart: {...}, settings: {...} }

// 调用 action（带命名空间）
rootStore.dispatch('user/login', credentials)
rootStore.dispatch('cart/addItem', product)

// 获取子 store
const user = rootStore.stores['user']
```

---

## TypeScript 支持

### 定义类型安全的 Store

```typescript
import { createStore, State, Actions, Getters } from '@openlide/geomstore'

// 定义状态类型
interface UserState {
  userInfo: {
    id: number
    name: string
    avatar: string
    vipLevel: number
  } | null
  token: string
  isLoggedIn: boolean
}

// 定义 actions 类型
interface UserActions {
  login: (credentials: { username: string; password: string }) => Promise<void>
  logout: () => void
  updateProfile: (profile: Partial<UserState['userInfo']>) => void
}

// 定义 getters 类型
interface UserGetters {
  isVip: () => boolean
  displayName: () => string
}

// 创建类型安全的 store
const userStore = createStore<UserState, UserActions, UserGetters>({
  name: 'user',

  state: () => ({
    userInfo: null,
    token: '',
    isLoggedIn: false
  }),

  actions: {
    async login(credentials) {
      const res = await wx.request({
        url: '/api/login',
        method: 'POST',
        data: credentials
      })
      this.state.userInfo = res.data.user
      this.state.token = res.data.token
      this.state.isLoggedIn = true
    },

    logout() {
      this.state.userInfo = null
      this.state.token = ''
      this.state.isLoggedIn = false
    },

    updateProfile(profile) {
      if (this.state.userInfo) {
        Object.assign(this.state.userInfo, profile)
      }
    }
  },

  getters: {
    isVip(state) {
      return (state.userInfo?.vipLevel ?? 0) > 0
    },

    displayName(state) {
      return state.userInfo?.name ?? '未登录'
    }
  }
})

// 类型自动推断
userStore.dispatch('login', { username: 'test', password: '123' })  // ✅ 类型正确
userStore.dispatch('login', { username: 123 })  // ❌ 类型错误

const isVip = userStore.getter('isVip')  // boolean
const name = userStore.getter('displayName')  // string
```

### state 工厂函数形式（推荐）

除了上面示例中的字面量对象形式，`createStore` 还支持 **state 工厂函数**形式（Pinia 同款）：

```typescript
import { createStore } from '@openlide/geomstore'

interface CityGroup {
  key: string
  cities: Array<{ id: number; name: string }>
}

interface CityState {
  historyList: string[]
  cityGroups: CityGroup[]
  activeLetter: string | null
}

const cityStore = createStore<CityState>({
  name: 'city',

  state: (): CityState => ({
    historyList: [],
    cityGroups: [],
    activeLetter: null,
  }),

  actions: {
    setHistoryList(historyList: string[]) {
      this.setState('historyList', historyList)
    },
  },
})
```

**两种形式的选择：**

| 形式                        | 适用场景                                                                     |
| --------------------------- | ---------------------------------------------------------------------------- |
| `state: { ... }`            | 对象字面量类型简单、无空数组/`null` 字面量需要精确推断时，可直接配合泛型使用 |
| `state: (): S => ({ ... })` | 状态字段包含 `[]`、`null` 等字面量，需要精确类型锚定时，**推荐使用**         |

**为什么需要工厂函数 + 显式返回类型：**

在 strict TypeScript 下，字面量 `[]` 会被推断为 `never[]`、`null` 会被收窄为 `null`，而非接口声明的 `string[]` / `string | null`。这会直接导致 action 内 `this.setState('historyList', historyList)` 等写入操作无法通过类型检查。使用 `state: (): CityState => ({ ... })` 显式锚定返回类型后，空数组精确推断为 `string[]`、`activeLetter` 保持 `string | null`。

> 注意：`satisfies` 不改变字面量推断（空数组仍为 `never[]`、`null` 仍被收窄为 `null`），因此**不可用** `state: {...} satisfies CityState` 替代。

另外，工厂函数在 Store 初始化时执行一次并深拷贝结果，可避免外部修改 `options.state` 引用污染 Store 内部状态。

### 类型推断工具

```typescript
import type { InferActionArgs, InferActionReturn, InferGetterReturn } from '@openlide/geomstore'

// 推断 action 参数类型
type LoginArgs = InferActionArgs<UserActions, 'login'>  // [{ username: string; password: string }]

// 推断 action 返回类型
type LoginReturn = InferActionReturn<UserActions, 'login'>  // Promise<void>

// 推断 getter 返回类型
type IsVipReturn = InferGetterReturn<UserGetters, 'isVip'>  // boolean
```

---

## 常见问题

### Q: 状态更新后页面没有刷新？

A: 确保使用了 `withPageStore` 或手动订阅状态变化：

```javascript
// ✅ 正确：使用 withPageStore
Page(withPageStore(store, {
  mapState: ['userInfo']
})({
  // 页面配置
}))

// ✅ 正确：手动订阅
Page({
  onLoad() {
    this.unsubscribe = store.subscribe((state) => {
      this.setData({ userInfo: state.userInfo })
    })
  },
  onUnload() {
    this.unsubscribe?.()
  }
})
```

### Q: 如何在 action 中调用其他 action？

```javascript
actions: {
  async actionA() {
    // 方式一：通过 this（推荐）
    await this.actionB()

    // 方式二：通过 dispatch
    this.dispatch('actionB')
  },

  actionB() {
    // ...
  }
}
```

### Q: 如何重置 Store 状态？

```javascript
// 方式一：定义 reset action
actions: {
  reset() {
    // 恢复初始状态
    this.$replaceState({
      userInfo: null,
      token: '',
      isLoggedIn: false
    })
  }
}

// 方式二：使用 $replaceState
store.$replaceState(initialState)

// 方式三：使用快照
const snapshot = store.$snapshot()
// ... 后续可以恢复
store.$restore(snapshot)
```

### Q: 如何处理大量数据的性能问题？

```javascript
const store = createStore({
  // 启用缓存
  enableCache: true,
  cacheConfig: {
    capacity: 100,  // 缓存容量
    ttl: 60000      // 缓存时间
  },

  // 批量更新
  actions: {
    batchUpdate(updates) {
      // $patch 一次性合并更新，只触发一次通知
      const patch = {}
      updates.forEach(update => {
        patch[update.key] = update.value
      })
      this.$patch(patch)
    }
  }
})
```

---

## 下一步

- 阅读 [核心概念](CONCEPTS.md) 深入理解设计原理
- 查看 [API 参考](API.md) 了解完整 API
- 学习 [最佳实践](BEST_PRACTICES.md) 提升开发效率
