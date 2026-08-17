# GeomStore v0.1.0 最佳实践

本文档总结了在微信小程序项目中使用 GeomStore 的最佳实践，帮助开发者构建高质量、可维护的应用。

---

## 目录

1. [项目结构](#项目结构)
2. [状态设计原则](#状态设计原则)
3. [Action 编写规范](#action-编写规范)
4. [Getter 使用技巧](#getter-使用技巧)
5. [小程序集成最佳实践](#小程序集成最佳实践)
6. [性能优化](#性能优化)
7. [错误处理策略](#错误处理策略)
8. [测试策略](#测试策略)
9. [TypeScript 最佳实践](#typescript-最佳实践)
10. [常见陷阱与解决方案](#常见陷阱与解决方案)

---

## 项目结构

### 推荐目录结构

```
miniprogram/
├── app.js                      # 应用入口
├── app.json
├── app.wxss
├── pages/                      # 页面
│   ├── index/
│   │   ├── index.js
│   │   ├── index.json
│   │   ├── index.wxml
│   │   └── index.wxss
│   └── user/
│       └── ...
├── components/                 # 组件
│   ├── user-card/
│   └── product-item/
├── stores/                     # Store 定义
│   ├── index.js               # Store 导出入口
│   ├── user.js                # 用户状态
│   ├── cart.js                # 购物车状态
│   ├── product.js             # 商品状态
│   └── settings.js            # 设置状态
├── services/                   # API 服务
│   ├── api.js                 # API 配置
│   ├── user.js                # 用户 API
│   └── product.js             # 商品 API
├── utils/                      # 工具函数
│   ├── geomstore/             # GeomStore 库
│   │   └── dist/
│   ├── request.js             # 请求封装
│   └── storage.js             # 存储封装
└── plugins/                    # 自定义插件
    └── analytics.js           # 分析插件
```

### Store 文件组织

**stores/index.js** - 统一导出入口：

```javascript
// stores/index.js
const { composeStore } = require('../utils/geomstore')
const userStore = require('./user')
const cartStore = require('./cart')
const productStore = require('./product')
const settingsStore = require('./settings')

// 导出独立 Store
module.exports = {
  userStore,
  cartStore,
  productStore,
  settingsStore
}

// 导出组合 Store（可选）
module.exports.rootStore = composeStore(
  [userStore, cartStore, productStore, settingsStore],
  { namespace: true, strict: true }
)
```

**stores/user.js** - 单个 Store 定义：

```javascript
// stores/user.js
const { createStore } = require('../utils/geomstore')
const userService = require('../services/user')

const userStore = createStore({
  name: 'user',

  state: {
    userInfo: null,
    token: '',
    isLoggedIn: false,
    loading: false,
    error: null
  },

  actions: {
    // 登录
    async login(credentials) {
      this.state.loading = true
      this.state.error = null
      try {
        const res = await userService.login(credentials)
        this.state.userInfo = res.user
        this.state.token = res.token
        this.state.isLoggedIn = true
      } catch (error) {
        this.state.error = error.message
        throw error
      } finally {
        this.state.loading = false
      }
    },

    // 登出
    logout() {
      this.state.userInfo = null
      this.state.token = ''
      this.state.isLoggedIn = false
      this.state.error = null
    },

    // 更新用户信息
    updateProfile(profile) {
      if (this.state.userInfo) {
        Object.assign(this.state.userInfo, profile)
      }
    }
  },

  getters: {
    displayName(state) {
      return state.userInfo?.nickname || state.userInfo?.name || '未登录'
    },

    isVip(state) {
      return (state.userInfo?.vipLevel ?? 0) > 0
    }
  }
})

module.exports = userStore
```

---

## 状态设计原则

### 1. 最小化状态

只存储必要的状态，能计算得出的不要存储。

```javascript
// ❌ 不推荐：存储冗余数据
state: {
  items: [...],
  itemCount: 10,        // 可计算得出
  totalPrice: 1000,     // 可计算得出
  isEmpty: false        // 可计算得出
}

// ✅ 推荐：使用 getter 计算
state: {
  items: []
},
getters: {
  itemCount(state) {
    return state.items.length
  },
  totalPrice(state) {
    return state.items.reduce((sum, item) => sum + item.price, 0)
  },
  isEmpty(state) {
    return state.items.length === 0
  }
}
```

### 2. 扁平化状态结构

避免过深的嵌套，保持状态扁平。

```javascript
// ❌ 不推荐：深层嵌套
state: {
  user: {
    profile: {
      personal: {
        name: 'John',
        age: 30
      },
      contact: {
        email: 'john@example.com',
        phone: '123456'
      }
    }
  }
}

// ✅ 推荐：扁平化结构
state: {
  userName: 'John',
  userAge: 30,
  userEmail: 'john@example.com',
  userPhone: '123456'
}

// 或适度分组
state: {
  userBasic: {
    name: 'John',
    age: 30
  },
  userContact: {
    email: 'john@example.com',
    phone: '123456'
  }
}
```

### 3. 规范化列表数据

对于列表数据，使用对象存储便于查找。

```javascript
// ❌ 不推荐：纯数组
state: {
  products: [
    { id: 1, name: 'Product 1' },
    { id: 2, name: 'Product 2' },
    { id: 3, name: 'Product 3' }
  ]
}
// 查找需要遍历：state.products.find(p => p.id === 2)

// ✅ 推荐：规范化存储
state: {
  products: {
    1: { id: 1, name: 'Product 1' },
    2: { id: 2, name: 'Product 2' },
    3: { id: 3, name: 'Product 3' }
  },
  productIds: [1, 2, 3]
}
// 直接访问：state.products[2]
```

### 4. 状态初始化

为所有状态提供默认值，避免 undefined。

```javascript
// ❌ 不推荐
state: {
  user: null,        // 可能导致解构错误
  list: undefined,   // 不明确
  count: undefined
}

// ✅ 推荐
state: {
  user: null,
  list: [],
  count: 0,
  loading: false,
  error: null
}
```

---

## Action 编写规范

### 1. 单一职责

每个 action 只做一件事。

```javascript
// ❌ 不推荐：action 做太多事
actions: {
  async loadPage() {
    this.state.loading = true
    const user = await fetchUser()
    const products = await fetchProducts()
    const settings = await fetchSettings()
    this.state.user = user
    this.state.products = products
    this.state.settings = settings
    this.state.loading = false
  }
}

// ✅ 推荐：拆分职责
actions: {
  async loadUser() {
    this.state.userLoading = true
    try {
      this.state.user = await fetchUser()
    } finally {
      this.state.userLoading = false
    }
  },

  async loadProducts() {
    this.state.productsLoading = true
    try {
      this.state.products = await fetchProducts()
    } finally {
      this.state.productsLoading = false
    }
  },

  async loadPage() {
    await Promise.all([
      this.loadUser(),
      this.loadProducts()
    ])
  }
}
```

### 2. 错误处理

始终处理异步 action 的错误。

```javascript
// ✅ 推荐：完善的错误处理
actions: {
  async fetchData() {
    this.state.loading = true
    this.state.error = null
    try {
      const res = await wx.request({ url: '/api/data' })
      this.state.data = res.data
    } catch (error) {
      this.state.error = {
        message: error.message,
        code: error.code || 'UNKNOWN',
        timestamp: Date.now()
      }
      // 可选：上报错误
      console.error('[Store] fetchData error:', error)
      throw error // 让调用方也能处理
    } finally {
      this.state.loading = false
    }
  }
}

// 页面中使用
Page({
  async onLoad() {
    try {
      await this.fetchData()
    } catch (error) {
      wx.showToast({ title: '加载失败', icon: 'error' })
    }
  }
})
```

### 3. 使用 Action 上下文

利用 action 上下文访问其他方法。

```javascript
actions: {
  async checkout() {
    // 检查登录状态
    if (!this.state.isLoggedIn) {
      // 调用其他 action
      await this.login()
    }

    // 使用 dispatch
    this.dispatch('setLoading', true)

    try {
      await this.processOrder()
      await this.clearCart()
      wx.showToast({ title: '下单成功' })
    } finally {
      this.dispatch('setLoading', false)
    }
  },

  async login() { /* ... */ },
  async processOrder() { /* ... */ },
  clearCart() { /* ... */ },
  setLoading(loading) { this.state.loading = loading }
}
```

### 4. 批量更新

对多个状态更新使用批量操作。

```javascript
actions: {
  // ❌ 不推荐：多次单独更新
  updateSettings(settings) {
    this.setState('theme', settings.theme)      // 触发更新
    this.setState('language', settings.language) // 触发更新
    this.setState('fontSize', settings.fontSize) // 触发更新
  }

  // ✅ 推荐：$patch 批量合并，只触发 1 次更新
  updateSettings(settings) {
    this.$patch(settings)
  }
}

// 在调用侧也可以用 store.batch 将多次更新合并为一次通知
store.batch(() => {
  store.setState('a', data.a)
  store.setState('b', data.b)
  store.setState('c', data.c)
})
```

---

## Getter 使用技巧

### 1. 缓存复杂计算

对复杂计算使用记忆化。

```javascript
const { createMemoizedSelector } = require('@openlide/geomstore')

// 在 Store 外部创建记忆化选择器
const selectFilteredProducts = createMemoizedSelector(
  (state) => {
    return state.products.filter(p => 
      p.price >= state.filter.minPrice &&
      p.price <= state.filter.maxPrice
    )
  },
  { cache: true }
)

// 在 getter 中使用
getters: {
  filteredProducts(state) {
    return selectFilteredProducts(state)
  }
}
```

### 2. 参数化 Getter

返回函数实现动态查询。

```javascript
getters: {
  // 返回函数
  getProductById(state) {
    return (id) => state.products[id] || null
  },

  // 多参数
  getProductsByCategory(state) {
    return (categoryId, sortBy = 'name') => {
      return Object.values(state.products)
        .filter(p => p.categoryId === categoryId)
        .sort((a, b) => a[sortBy] > b[sortBy] ? 1 : -1)
    }
  }
}

// 使用
const product = store.getter('getProductById')(123)
const products = store.getter('getProductsByCategory')(1, 'price')
```

### 3. 组合 Getter

组合多个 getter 的结果。

```javascript
getters: {
  userBasicInfo(state) {
    return {
      name: state.userInfo?.name,
      avatar: state.userInfo?.avatar
    }
  },

  userVipInfo(state) {
    return {
      level: state.userInfo?.vipLevel,
      points: state.userInfo?.vipPoints
    }
  },

  // 组合其他 getter
  userFullInfo(state) {
    const basic = this.getter('userBasicInfo')
    const vip = this.getter('userVipInfo')
    return { ...basic, ...vip, isLoggedIn: state.isLoggedIn }
  }
}
```

---

## 小程序集成最佳实践

### 1. App 层初始化

在 App 层创建和初始化全局 Store。

```javascript
// app.js
const { createStore, withAppStore } = require('./utils/geomstore')
const { userStore, cartStore, settingsStore } = require('./stores')

App(withAppStore(createStore({
  name: 'global',
  state: {
    initialized: false,
    systemInfo: null
  },
  actions: {
    async init() {
      if (this.state.initialized) return

      // 获取系统信息
      this.state.systemInfo = wx.getSystemInfoSync()

      // 恢复用户状态
      await this.restoreUser()

      this.state.initialized = true
    },

    async restoreUser() {
      const token = wx.getStorageSync('token')
      if (token) {
        try {
          const user = await userService.getProfile()
          userStore.dispatch('setUser', user)
        } catch (error) {
          wx.removeStorageSync('token')
        }
      }
    }
  }
}))({
  stores: { userStore, cartStore, settingsStore }, // 挂载 stores

  onLaunch(options) {
    // 初始化
    this.store.dispatch('init')

    // 暴露给页面使用
    this.userStore = userStore
    this.cartStore = cartStore
    this.settingsStore = settingsStore
  },

  onShow() {},

  onHide() {}
}))
```

### 2. 页面连接规范

```javascript
// pages/index/index.js
const app = getApp()
const { withPageStore } = require('../../utils/geomstore')

Page(withPageStore(app.userStore, {
  // 明确映射需要的状态
  mapState: ['userInfo', 'isLoggedIn', 'loading'],
  mapGetters: ['displayName', 'isVip'],
  mapActions: ['login', 'logout', 'updateProfile']
})({
  // 页面私有数据
  data: {
    pageLoading: false,
    showLoginModal: false
  },

  onLoad(options) {
    // 检查登录状态
    if (!this.data.isLoggedIn) {
      this.setData({ showLoginModal: true })
    }
  },

  onShow() {
    // 页面显示时的逻辑
  },

  onUnload() {
    // 清理资源
  },

  // 自定义方法
  async handleLogin(e) {
    const { username, password } = e.detail.value
    this.setData({ pageLoading: true })

    try {
      await this.login({ username, password })
      this.setData({ showLoginModal: false })
      wx.showToast({ title: '登录成功' })
    } catch (error) {
      wx.showToast({ title: error.message, icon: 'error' })
    } finally {
      this.setData({ pageLoading: false })
    }
  },

  handleLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          this.logout()
        }
      }
    })
  }
}))
```

### 3. 组件连接规范

```javascript
// components/product-card/index.js
const app = getApp()
const { withComponentStore } = require('../../utils/geomstore')

Component(withComponentStore(app.productStore, {
  mapState: ['currency'],
  mapGetters: ['formatPrice'],
  mapActions: ['addToCart', 'toggleFavorite']
})({
  properties: {
    product: {
      type: Object,
      value: {}
    },
    showActions: {
      type: Boolean,
      value: true
    }
  },

  data: {
    isFavorite: false
  },

  lifetimes: {
    attached() {
      this.setData({
        isFavorite: this.checkFavorite()
      })
    }
  },

  methods: {
    checkFavorite() {
      // 检查是否已收藏
      return this.store.getter('isFavorite')(this.data.product.id)
    },

    onTap() {
      this.triggerEvent('tap', { product: this.data.product })
    },

    async onAddToCart() {
      try {
        await this.addToCart(this.data.product)
        wx.showToast({ title: '已加入购物车' })
        this.triggerEvent('cartadd', { product: this.data.product })
      } catch (error) {
        wx.showToast({ title: '添加失败', icon: 'error' })
      }
    },

    async onToggleFavorite() {
      try {
        await this.toggleFavorite(this.data.product.id)
        this.setData({
          isFavorite: !this.data.isFavorite
        })
      } catch (error) {
        console.error('Toggle favorite error:', error)
      }
    }
  }
}))
```

### 4. 避免过度映射

只映射页面/组件真正需要的状态。

```javascript
// ❌ 不推荐：映射所有状态
mapState: ['userInfo', 'token', 'isLoggedIn', 'settings', 'preferences', 'notifications']

// ✅ 推荐：只映射需要的
mapState: ['userInfo', 'isLoggedIn']

// 如果需要多个 Store，考虑组合或使用全局访问
Page({
  onLoad() {
    // 直接访问全局 Store
    const { userStore, cartStore } = getApp()
    this.setData({
      user: userStore.state.userInfo,
      cartCount: cartStore.state.items.length
    })
  }
})
```

---

## 性能优化

### 1. 启用缓存

对频繁访问的状态启用缓存。

```javascript
const store = createStore({
  state: {
    largeList: [], // 大列表数据
    config: {}     // 配置数据
  },
  enableCache: true,
  cacheKeys: ['largeList', 'config'],
  cacheConfig: {
    capacity: 50,
    ttl: 300000 // 5 分钟
  }
})
```

### 2. 选择性订阅

只订阅必要的状态变化。

```javascript
// ❌ 不推荐：订阅整个状态
store.subscribe((state) => {
  this.setData({ state }) // 所有变化都触发
})

// ✅ 推荐：只订阅关心的字段
store.subscribe((state) => {
  if (this.data.userInfo?.id !== state.userInfo?.id) {
    this.setData({ userInfo: state.userInfo })
  }
})

// 更好的方式：使用选择器
const { createSelector } = require('@openlide/geomstore')
const selectUserName = createSelector(state => state.userInfo?.name)

store.subscribe((state) => {
  const name = selectUserName(state)
  if (this.data.userName !== name) {
    this.setData({ userName: name })
  }
})
```

### 3. 虚拟列表优化

对长列表使用虚拟列表。

```javascript
// Store 中分页存储
state: {
  products: {
    // 按页存储
    page1: [...],
    page2: [...],
    // ...
  },
  currentPage: 1,
  hasMore: true
},
actions: {
  async loadMore() {
    const state = this.state
    if (!state.hasMore || state.loading) return
    this.setState('loading', true)

    const page = state.currentPage + 1
    const res = await fetchProducts(page)

    // 逐字段 setState；如需合并为一次通知，在调用侧用 store.batch 包裹
    this.setState('products', { ...state.products, [`page${page}`]: res.items })
    this.setState('currentPage', page)
    this.setState('hasMore', res.hasMore)
    this.setState('loading', false)
  }
}
```

### 4. 防抖与节流

对频繁操作使用防抖/节流。GeomStore 提供的 `withDebounce` / `withThrottle` 是 TypeScript 方法装饰器，用于类方法（需开启 `experimentalDecorators`）；对于 Store action，建议在触发侧控制频率：

```javascript
// 在触发侧对 dispatch 做防抖
let timer = null
function debouncedSearch(keyword) {
  clearTimeout(timer)
  timer = setTimeout(() => store.dispatch('search', keyword), 300)
}
debouncedSearch(keyword)

// 或在类方法上使用内置装饰器
// class SearchService {
//   @withDebounce(300)
//   async search(keyword) { /* ... */ }
// }
```

### 5. 懒加载 Store

按需加载不常用的 Store。

```javascript
// stores/index.js
let cartStore = null

module.exports.getCartStore = () => {
  if (!cartStore) {
    cartStore = require('./cart')
  }
  return cartStore
}

// 页面中按需加载
const cartStore = require('../../stores').getCartStore()
```

---

## 错误处理策略

### 1. 全局错误处理

```javascript
// app.js
const { ErrorMonitoring, ConsoleReporter } = require('./utils/geomstore')

const monitoring = new ErrorMonitoring({
  reporters: [
    new ConsoleReporter(),
    // 生产环境添加 HTTP Reporter
    // new HttpReporter('https://api.example.com/errors')
  ],
  batchInterval: 5000
})

// 全局错误处理
App({
  onLaunch() {
    // 捕获未处理的 Promise 拒绝
    wx.onUnhandledRejection((event) => {
      monitoring.report({
        storeName: 'global',
        operation: 'unhandledRejection',
        error: event.reason,
        level: 'error',
        timestamp: Date.now()
      })
    })
  }
})
```

### 2. Store 错误边界

```javascript
const { ErrorBoundary } = require('@openlide/geomstore')

const boundary = new ErrorBoundary({
  fallback: (error, currentState) => {
    // 返回回退状态
    return {
      ...currentState,
      error: error.message,
      loading: false
    }
  },
  onError: (error) => {
    console.error('[Store Error]', error)
    // 上报错误
  }
})

// 包装 action
const safeDispatch = (store, actionName, ...args) => {
  return boundary.wrap(() => store.dispatch(actionName, ...args))
}
```

### 3. 错误恢复策略

```javascript
const { ErrorRecovery, RecoveryStrategy } = require('@openlide/geomstore')

const recovery = new ErrorRecovery()

// 配置恢复策略
recovery.configure({
  // 网络错误：重试
  'NETWORK_ERROR': {
    strategy: RecoveryStrategy.RETRY,
    maxRetries: 3,
    retryDelay: 1000,
    exponentialBackoff: true,
    onRetry: (error, attempt) => {
      console.log(`重试第 ${attempt} 次...`)
    }
  },

  // 数据不存在：使用默认值
  'DATA_NOT_FOUND': {
    strategy: RecoveryStrategy.FALLBACK,
    fallback: []
  },

  // 验证错误：忽略
  'VALIDATION_ERROR': {
    strategy: RecoveryStrategy.IGNORE
  }
})

// 在 action 中使用
actions: {
  async fetchData() {
    try {
      const res = await fetchApi()
      this.state.data = res.data
    } catch (error) {
      const result = await recovery.recover(error)
      this.state.data = result || []
    }
  }
}
```

---

## 测试策略

### 1. 单元测试

```javascript
// tests/stores/user.test.js
const { createStore } = require('../../utils/geomstore')

describe('UserStore', () => {
  let store

  beforeEach(() => {
    store = createStore({
      name: 'user',
      state: {
        userInfo: null,
        token: '',
        isLoggedIn: false
      },
      actions: {
        login({ user, token }) {
          this.state.userInfo = user
          this.state.token = token
          this.state.isLoggedIn = true
        },
        logout() {
          this.state.userInfo = null
          this.state.token = ''
          this.state.isLoggedIn = false
        }
      },
      getters: {
        displayName(state) {
          return state.userInfo?.name || '未登录'
        }
      }
    })
  })

  test('initial state', () => {
    expect(store.state.isLoggedIn).toBe(false)
    expect(store.getter('displayName')).toBe('未登录')
  })

  test('login action', () => {
    store.dispatch('login', {
      user: { id: 1, name: 'John' },
      token: 'abc123'
    })

    expect(store.state.isLoggedIn).toBe(true)
    expect(store.state.userInfo.name).toBe('John')
    expect(store.getter('displayName')).toBe('John')
  })

  test('logout action', () => {
    store.dispatch('login', { user: { name: 'John' }, token: 'abc' })
    store.dispatch('logout')

    expect(store.state.isLoggedIn).toBe(false)
    expect(store.state.token).toBe('')
  })

  test('subscribe', () => {
    const callback = jest.fn()
    store.subscribe(callback)

    store.dispatch('login', { user: {}, token: 'abc' })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      isLoggedIn: true
    }))
  })
})
```

### 2. 集成测试

```javascript
// tests/integration/page.test.js
const { withPageStore, createStore } = require('../../utils/geomstore')

describe('Page Integration', () => {
  let store
  let pageInstance

  beforeEach(() => {
    store = createStore({
      state: { count: 0 },
      actions: {
        increment() { this.state.count++ }
      }
    })

    // 模拟页面
    const pageConfig = withPageStore(store, {
      mapState: ['count'],
      mapActions: ['increment']
    })({
      data: {},
      onLoad() {}
    })

    pageInstance = {
      data: { ...pageConfig.data },
      setData(data) {
        Object.assign(this.data, data)
      }
    }
  })

  test('state sync', () => {
    store.dispatch('increment')
    // 验证状态同步
    expect(store.state.count).toBe(1)
  })
})
```

### 3. Mock API

```javascript
// tests/mocks/api.js
const mockApi = {
  user: {
    login: jest.fn(),
    getProfile: jest.fn()
  }
}

// 在测试中使用
beforeEach(() => {
  mockApi.user.login.mockResolvedValue({
    user: { id: 1, name: 'Test User' },
    token: 'test-token'
  })
})

test('login flow', async () => {
  const res = await mockApi.user.login({ username: 'test' })
  expect(res.token).toBe('test-token')
})
```

---

## TypeScript 最佳实践

### 1. 定义完整类型

```typescript
// types/store.ts
export interface UserState {
  userInfo: {
    id: number
    name: string
    avatar: string
    vipLevel: number
  } | null
  token: string
  isLoggedIn: boolean
  loading: boolean
  error: {
    message: string
    code: string
  } | null
}

export interface UserActions {
  login: (credentials: { username: string; password: string }) => Promise<void>
  logout: () => void
  updateProfile: (profile: Partial<NonNullable<UserState['userInfo']>>) => void
  setLoading: (loading: boolean) => void
  setError: (error: UserState['error']) => void
}

export interface UserGetters {
  displayName: () => string
  isVip: () => boolean
  userLevel: () => number
}
```

### 2. 创建类型安全的 Store

```typescript
// stores/user.ts
import { createStore } from '../utils/geomstore'
import type { UserState, UserActions, UserGetters } from '../types/store'

export const userStore = createStore<UserState, UserActions, UserGetters>({
  name: 'user',

  state: {
    userInfo: null,
    token: '',
    isLoggedIn: false,
    loading: false,
    error: null
  },

  actions: {
    async login(credentials) {
      this.state.loading = true
      this.state.error = null
      try {
        const res = await userService.login(credentials)
        this.state.userInfo = res.user
        this.state.token = res.token
        this.state.isLoggedIn = true
      } catch (error) {
        this.state.error = {
          message: error instanceof Error ? error.message : '登录失败',
          code: 'LOGIN_ERROR'
        }
        throw error
      } finally {
        this.state.loading = false
      }
    },

    logout() {
      this.state.userInfo = null
      this.state.token = ''
      this.state.isLoggedIn = false
      this.state.error = null
    },

    updateProfile(profile) {
      if (this.state.userInfo) {
        Object.assign(this.state.userInfo, profile)
      }
    },

    setLoading(loading) {
      this.state.loading = loading
    },

    setError(error) {
      this.state.error = error
    }
  },

  getters: {
    displayName(state) {
      return state.userInfo?.name ?? '未登录'
    },

    isVip(state) {
      return (state.userInfo?.vipLevel ?? 0) > 0
    },

    userLevel(state) {
      return state.userInfo?.vipLevel ?? 0
    }
  }
})

// 使用时有完整类型推断
userStore.dispatch('login', { username: 'test', password: '123' }) // ✅
userStore.dispatch('login', { username: 123 }) // ❌ 类型错误

const name = userStore.getter('displayName') // string
const isVip = userStore.getter('isVip') // boolean
```

### 3. 类型安全的页面

```typescript
// pages/index/index.ts
interface IndexPageData {
  userInfo: UserState['userInfo']
  isLoggedIn: boolean
  displayName: string
  loading: boolean
}

interface IndexPageMethods {
  login: UserActions['login']
  logout: UserActions['logout']
  handleLogin: (e: { detail: { value: { username: string; password: string } } }) => Promise<void>
}

type IndexPageThis = {
  data: IndexPageData
  store: typeof userStore
} & IndexPageMethods

Page(withPageStore(userStore, {
  mapState: ['userInfo', 'isLoggedIn', 'loading'],
  mapGetters: ['displayName'],
  mapActions: ['login', 'logout']
})({
  data: {
    // 页面私有数据
    showLoginModal: false
  },

  onLoad(this: IndexPageThis) {
    console.log(this.data.displayName)
  },

  async handleLogin(this: IndexPageThis, e) {
    const { username, password } = e.detail.value
    await this.login({ username, password })
  }
}))
```

---

## 常见陷阱与解决方案

### 1. 直接修改状态

```javascript
// ❌ 错误：直接修改
store.state.count = 10

// ✅ 正确：通过 action 或方法
store.dispatch('setCount', 10)
store.setState('count', 10)
```

### 2. 异步更新问题

```javascript
// ❌ 错误：依赖异步更新后的状态
store.dispatch('fetchData')
console.log(store.state.data) // 可能还是旧值

// ✅ 正确：等待异步完成
await store.dispatch('fetchData')
console.log(store.state.data)
```

### 3. 循环依赖

```javascript
// ❌ 错误：循环调用
actions: {
  a() {
    this.b() // a -> b
  },
  b() {
    this.a() // b -> a，无限循环
  }
}

// ✅ 正确：避免循环，或使用条件判断
actions: {
  a() {
    if (!this.state.processed) {
      this.b()
    }
  },
  b() {
    this.state.processed = true
  }
}
```

### 4. 内存泄漏

```javascript
// ❌ 错误：未取消订阅
Page({
  onLoad() {
    store.subscribe((state) => {
      this.setData({ count: state.count })
    })
  }
})

// ✅ 正确：在 onUnload 取消订阅
Page({
  onLoad() {
    this.unsubscribe = store.subscribe((state) => {
      this.setData({ count: state.count })
    })
  },
  onUnload() {
    this.unsubscribe?.()
  }
})
```

### 5. 大数据性能问题

```javascript
// ❌ 错误：存储大量冗余数据
state: {
  allProducts: [...], // 10000 条数据
  filteredProducts: [...], // 冗余
  sortedProducts: [...] // 冗余
}

// ✅ 正确：只存储必要数据，计算派生值
state: {
  products: [...], // 原始数据
  filter: { minPrice: 0, maxPrice: 1000 },
  sort: 'price'
},
getters: {
  filteredProducts(state) {
    return state.products
      .filter(p => p.price >= state.filter.minPrice)
      .sort((a, b) => a[state.sort] - b[state.sort])
  }
}
```

---

## 总结

遵循以上最佳实践，可以构建出：

- **可维护**：清晰的项目结构和代码组织
- **高性能**：合理的缓存和更新策略
- **健壮**：完善的错误处理机制
- **可测试**：良好的测试覆盖
- **类型安全**：完整的 TypeScript 支持

如有问题，请参考 [API 文档](API.md) 或提交 [Issue](https://github.com/openlide/GeomStore/issues)。
