# GeomStore 常见问题解答 (FAQ)

本文档收集了使用 GeomStore 过程中常见的问题和解决方案。

---

## 目录

1. [安装与配置](#安装与配置)
2. [基础使用](#基础使用)
3. [小程序集成](#小程序集成)
4. [性能问题](#性能问题)
5. [错误处理](#错误处理)
6. [TypeScript](#typescript)
7. [与其他库对比](#与其他库对比)

---

## 安装与配置

### Q: 如何在微信小程序中安装 GeomStore？

**A:** 有三种方式：

**方式一：直接复制（推荐）**
```bash
# 复制 dist 文件夹到小程序项目
小程序项目/
└── utils/
    └── geomstore/
        └── dist/
```

**方式二：NPM 安装**
```bash
npm install @openlide/geomstore
# 然后在微信开发者工具中：工具 -> 构建npm
```

**方式三：源码引入**
```bash
# 复制 src 文件夹进行二次开发
```

---

### Q: 为什么引入时报错 "Cannot find module '@openlide/geomstore'"？

**A:** 请检查：

1. **路径是否正确**
```javascript
// 确认路径正确
const { createStore } = require('./utils/geomstore/dist/index.js')
```

2. **NPM 是否构建**
```bash
# 使用 NPM 安装后，需要在微信开发者工具中构建
工具 -> 构建npm
```

3. **文件是否存在**
```bash
# 检查文件是否存在
ls utils/geomstore/dist/index.js
```

---

### Q: 是否支持分包加载？

**A:** 支持。可以在分包中按需引入 Store：

```javascript
// 分包 A
const userStore = require('../../stores/user')

// 分包 B
const productStore = require('../../stores/product')
```

---

## 基础使用

### Q: 如何重置 Store 到初始状态？

**A:** 有多种方式：

**方式一：定义 reset action**
```javascript
const initialState = {
  count: 0,
  name: ''
}

const store = createStore({
  state: { ...initialState },
  actions: {
    reset() {
      this.$replaceState(initialState)
    }
  }
})
```

**方式二：使用 $replaceState**
```javascript
store.$replaceState({ count: 0, name: '' })
```

**方式三：使用快照**
```javascript
const snapshot = store.$snapshot()
// ... 操作后恢复
store.$restore(snapshot)
```

---

### Q: 如何在 action 中调用其他 action？

**A:** 使用 `this` 上下文：

```javascript
actions: {
  async checkout() {
    // 方式一：直接调用
    await this.validateCart()

    // 方式二：通过 dispatch
    this.dispatch('setLoading', true)

    // 方式三：访问其他 action（通过 this 合并）
    await this.processPayment()
  },

  validateCart() { /* ... */ },
  setLoading(loading) { this.state.loading = loading },
  processPayment() { /* ... */ }
}
```

---

### Q: 如何处理异步 action？

**A:** 使用 async/await：

```javascript
actions: {
  // 异步 action
  async fetchData() {
    this.state.loading = true
    try {
      const res = await wx.request({ url: '/api/data' })
      this.state.data = res.data
    } catch (error) {
      this.state.error = error.message
    } finally {
      this.state.loading = false
    }
  }
}

// 调用
await store.dispatch('fetchData')
```

---

### Q: 如何监听特定状态变化？

**A:** 可以在订阅回调中判断：

```javascript
// 方式一：手动判断
let lastCount = store.state.count
store.subscribe((state) => {
  if (state.count !== lastCount) {
    console.log('count 变化了:', state.count)
    lastCount = state.count
  }
})

// 方式二：使用选择器
const { createSelector } = require('@openlide/geomstore')
const selectCount = createSelector(s => s.count)

let lastCount = selectCount(store.state)
store.subscribe((state) => {
  const count = selectCount(state)
  if (count !== lastCount) {
    console.log('count 变化了:', count)
    lastCount = count
  }
})
```

---

### Q: action 和 getter 有什么区别？

**A:**

| 特性         | Action   | Getter       |
| ------------ | -------- | ------------ |
| 用途         | 修改状态 | 计算派生状态 |
| 是否修改状态 | 是       | 否           |
| 是否支持异步 | 是       | 否           |
| 返回值       | 任意     | 计算结果     |
| 触发更新     | 是       | 否（纯计算） |

```javascript
// Action：修改状态（通过 this.state 读写）
actions: {
  increment() {
    this.state.count++  // 修改状态
  }
}

// Getter：计算派生值（接收 state 参数）
getters: {
  doubleCount(state) {
    return state.count * 2  // 只计算，不修改
  }
}
```

---

## 小程序集成

### Q: 状态更新后页面没有刷新？

**A:** 确保正确使用了连接函数：

```javascript
// ✅ 正确：使用 withPageStore
Page(withPageStore(store, {
  mapState: ['userInfo']
})({
  // 页面配置
}))

// ❌ 错误：直接修改 Store 状态但未连接
Page({
  onLoad() {
    store.state.userInfo = { name: 'test' }  // 页面不会更新
  }
})

// ✅ 如果不使用连接函数，需要手动订阅
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

---

### Q: 如何在组件中访问 Store？

**A:** 两种方式：

**方式一：使用 withComponentStore**
```javascript
Component(withComponentStore(store, {
  mapState: ['userInfo'],
  mapActions: ['login']
})({
  // 组件配置
}))
```

**方式二：通过 getApp()**
```javascript
Component({
  lifetimes: {
    attached() {
      const { userStore } = getApp()
      this.store = userStore
    }
  },
  methods: {
    handleLogin() {
      this.store.dispatch('login')
    }
  }
})
```

---

### Q: mapState 和 mapGetters 有什么区别？

**A:**

```javascript
// mapState：映射 Store 的原始状态
mapState: ['userInfo', 'token']

// mapGetters：映射计算属性
mapGetters: ['displayName', 'isVip']

// 结果
this.data.userInfo   // 来自 state.userInfo
this.data.displayName // 来自 getter('displayName')
```

---

### Q: 如何实现多 Store 连接？

**A:** 方式一：组合 Store

```javascript
const { composeStore } = require('@openlide/geomstore')

const rootStore = composeStore([userStore, cartStore], {
  namespace: true
})

Page(withPageStore(rootStore, {
  // 命名空间模式下 mapState 映射子 Store 整体（state 为 { user, cart } 嵌套结构）
  mapState: ['user', 'cart']
})({
  // 页面中通过 this.data.user.userInfo 访问
}))
```

方式二：直接访问

```javascript
Page({
  onLoad() {
    const { userStore, cartStore } = getApp()
    this.userStore = userStore
    this.cartStore = cartStore
  }
})
```

---

### Q: 页面 onShow 时如何更新状态？

**A:** 使用 `autoUpdateOnShow` 选项：

```javascript
Page(withPageStore(store, {
  autoInject: true,
  injectMapping: { userInfo: 'userInfo' },  // store 键 → 本地键
  autoUpdateOnShow: true  // 页面显示时自动重新注入
})({
  // 页面配置
}))
```

> 注意：`autoUpdateOnShow` 仅在同时启用 `autoInject` 时生效（默认仅 onLoad 时注入一次）。

或手动处理：

```javascript
Page(withPageStore(store, {
  mapState: ['userInfo']
})({
  onShow() {
    // 重新获取状态（store 为闭包中的变量）
    this.setData({
      userInfo: store.state.userInfo
    })
  }
}))
```

---

## 性能问题

### Q: 大列表数据渲染慢怎么办？

**A:** 优化策略：

**1. 启用缓存**
```javascript
const store = createStore({
  enableCache: true,
  cacheConfig: { capacity: 100 }
})
```

**2. 分页加载**
```javascript
state: {
  products: { page1: [], page2: [] },
  currentPage: 1
}
```

**3. 使用虚拟列表**
```xml
<!-- 使用小程序虚拟列表组件 -->
<recycle-view list="{{items}}" />
```

**4. 选择性订阅**
```javascript
// 只订阅需要的数据
store.subscribe((state) => {
  this.setData({ 
    count: state.count  // 只更新 count
  })
})
```

---

### Q: 状态更新频繁导致卡顿？

**A:** 使用批量更新或对调用侧做防抖：

```javascript
// 批量更新
store.batch(() => {
  store.setState('a', 1)
  store.setState('b', 2)
  store.setState('c', 3)
})

// 对 dispatch 调用做防抖（在触发侧控制频率）
let timer = null
function debouncedSearch(keyword) {
  clearTimeout(timer)
  timer = setTimeout(() => store.dispatch('search', keyword), 300)
}
```

---

### Q: 如何减少 setData 调用？

**A:** 合并数据更新：

```javascript
// ❌ 多次 setData
this.setData({ a: 1 })
this.setData({ b: 2 })
this.setData({ c: 3 })

// ✅ 合并 setData
this.setData({ a: 1, b: 2, c: 3 })

// ✅ 使用批量更新
store.batch(() => {
  // 内部只触发一次更新
})
```

---

## 错误处理

### Q: 如何捕获 action 执行错误？

**A:** 使用 try-catch：

```javascript
// 在 action 中处理
actions: {
  async fetchData() {
    try {
      this.state.data = await fetchApi()
    } catch (error) {
      this.state.error = error.message
      throw error  // 可选：继续抛出让调用方处理
    }
  }
}

// 在页面中处理
try {
  await store.dispatch('fetchData')
} catch (error) {
  wx.showToast({ title: '加载失败', icon: 'error' })
}
```

---

### Q: 如何实现错误重试？

**A:** 使用 ErrorRecovery：

```javascript
const { ErrorRecovery, RecoveryStrategy, ErrorCode } = require('@openlide/geomstore')

const recovery = new ErrorRecovery()
recovery.configure({
  [ErrorCode.ACTION_EXECUTION_ERROR]: {  // 键为 ErrorCode 枚举值
    strategy: RecoveryStrategy.RETRY,
    maxRetries: 3,
    retryDelay: 1000,
    exponentialBackoff: true
  }
})

try {
  await store.dispatch('fetchData')
} catch (error) {
  // 注意：recover 仅支持恢复 GeomStoreError 实例（dispatch 抛出的错误通常是）
  const result = await recovery.recover(error)
}
```

---

### Q: 如何全局捕获错误？

**A:** 使用 ErrorMonitoring：

```javascript
const { ErrorMonitoring, ConsoleReporter } = require('@openlide/geomstore')

const monitoring = new ErrorMonitoring({
  reporters: [new ConsoleReporter()]
})

// App 中捕获全局错误
App({
  onLaunch() {
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

---

### Q: 如何使用 Action 装饰器？

**A:** GeomStore 提供了多种内置装饰器。它们是 **TypeScript 传统方法装饰器工厂**，用于类方法（tsconfig 需开启 `experimentalDecorators`）：

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
  results: unknown[] = []
  user: unknown = null
  data: unknown = null

  // 防抖：搜索输入
  @withDebounce(300)
  async search(keyword: string) {
    this.results = await searchApi(keyword)
  }
  
  // 缓存：API 响应缓存（ttl 单位毫秒）
  @withCache({ ttl: 300000 })
  async fetchUser(userId: string) {
    const res = await fetch(`/api/user/${userId}`)
    this.user = await res.json()
    return this.user
  }
  
  // 重试：网络请求（最多 3 次，间隔 1000ms）
  @withRetry({ retries: 3, delay: 1000 })
  async fetchData() {
    const res = await fetch('/api/data')
    this.data = await res.json()
  }
  
  // 超时：请求超时控制
  @withTimeout(5000)
  async fetchWithTimeout() {
    this.data = await fetchData()
  }
  
  // 组合使用：重试 + 超时（装饰器叠加）
  @withRetry({ retries: 3, delay: 1000 })
  @withTimeout(5000)
  async safeFetch() {
    this.data = await fetchData()
  }
}
```

---

## TypeScript

### Q: 如何获得完整的类型推断？

**A:** 定义完整的类型并传入泛型：

```typescript
interface UserState {
  userInfo: { name: string } | null
  token: string
}

interface UserActions {
  login: (credentials: { username: string; password: string }) => Promise<void>
  logout: () => void
}

interface UserGetters {
  displayName: () => string
}

const store = createStore<UserState, UserActions, UserGetters>({
  // 配置
})

// 自动推断类型
store.dispatch('login', { username: 'test', password: '123' })  // ✅
store.dispatch('login', { username: 123 })  // ❌ 类型错误
```

---

### Q: state 字段被推断为 `never[]` / `null`，action 里写入报类型错误？

**A:** 这是 TypeScript 字面量推断导致的。字面量 `[]` 会被推断为 `never[]`、`null` 会被收窄为 `null`，与接口声明不一致：

```typescript
// ❌ 错误：字面量对象形式，[] 被推断为 never[]
interface CityState {
  historyList: string[]
  activeLetter: string | null
}

const store = createStore<CityState>({
  state: {
    historyList: [],       // 推断为 never[]，而非 string[]
    activeLetter: null,    // 收窄为 null，而非 string | null
  },
  actions: {
    setHistoryList(historyList: string[]) {
      this.setState('historyList', historyList)  // ❌ never[] 不能接收 string[]
    },
  },
})

// ✅ 正确：使用 state 工厂函数 + 显式返回类型锚定
const store = createStore<CityState>({
  state: (): CityState => ({
    historyList: [],
    activeLetter: null,
  }),
  // ...
})
```

**注意：** `satisfies` 不改变字面量推断（空数组仍为 `never[]`、`null` 仍为 `null`），不能替代显式返回类型。

---

### Q: dispatch 参数类型不正确？

**A:** 确保正确定义了 Actions 类型：

```typescript
// ❌ 错误：没有定义 Actions 类型
const store = createStore({ state: { count: 0 } })
store.dispatch('increment', 10)  // 参数类型为 any

// ✅ 正确：定义 Actions 类型
interface Actions {
  increment: (n: number) => void
  setName: (name: string) => void
}

const store = createStore<State, Actions>({
  actions: {
    increment(n: number) { this.state.count += n },
    setName(name: string) { this.state.name = name }
  }
})

store.dispatch('increment', 10)  // n: number ✅
store.dispatch('setName', 'John')  // name: string ✅
```

---

### Q: 如何定义参数化的 getter 类型？

**A:** getter 返回函数：

```typescript
interface Getters {
  // 返回函数
  getItemById: () => (id: number) => Item | undefined
  
  // 多参数
  filterItems: () => (category: string, minPrice: number) => Item[]
}

// 使用
const item = store.getter('getItemById')(123)
const filtered = store.getter('filterItems')('electronics', 100)
```

---

## 与其他库对比

### Q: GeomStore 与 Vuex 有什么区别？

**A:**

| 特性     | GeomStore            | Vuex         |
| -------- | -------------------- | ------------ |
| 目标平台 | 微信小程序           | Vue.js       |
| 学习曲线 | 简单                 | 中等         |
| 模块化   | composeStore         | modules      |
| 异步处理 | 原生支持 async/await | 需要 actions |
| 类型推断 | 完整支持             | 需要额外配置 |
| 体积     | ~15KB                | ~30KB        |

---

### Q: GeomStore 与 Pinia 有什么区别？

**A:**

| 特性       | GeomStore   | Pinia        |
| ---------- | ----------- | ------------ |
| 目标平台   | 微信小程序  | Vue.js       |
| API 风格   | createStore | defineStore  |
| DevTools   | 自定义      | Vue DevTools |
| 插件系统   | 完整支持    | 完整支持     |
| TypeScript | 完整支持    | 完整支持     |

---

### Q: 为什么不直接使用小程序的 data？

**A:** 使用状态管理的优势：

1. **跨页面/组件共享状态**
2. **统一的状态管理逻辑**
3. **可预测的状态变化**
4. **更好的调试体验**
5. **更易测试**

```javascript
// ❌ 直接使用 data：状态分散难以管理
Page({ data: { user: {} } })
Component({ data: { user: {} } })

// ✅ 使用 Store：状态集中管理
const userStore = createStore({ state: { user: {} } })
Page(withPageStore(userStore, { mapState: ['user'] })({
  // 页面配置
}))
```

---

## 行为变更与进阶（v0.1.1）

### Q: 为什么修改 `$snapshot()` 返回的快照会报错？

**A:** 自 v0.1.1 起，`$snapshot()` 返回的快照会被**递归深冻结**（嵌套纯对象与数组均被 `Object.freeze`），严格模式下直接修改会抛出 `TypeError`。这是有意为之的不可变性保证：

```javascript
const snapshot = store.$snapshot()
snapshot.count = 100            // ❌ TypeError: Cannot assign to read only property
snapshot.user.name = 'Bob'      // ❌ 嵌套对象同样被冻结

// ✅ 如需修改，先克隆一份
const copy = JSON.parse(JSON.stringify(snapshot))
copy.count = 100
```

快照冻结不影响原 state 的可变性，`store.setState()` 等正常操作不受影响。

---

### Q: persistencePlugin 恢复状态时，未持久化的键为什么保留了初始值？

**A:** 自 v0.1.1 起，启动恢复采用**合并语义**（内部使用 `$patch`）：持久化数据只覆盖其中包含的键，未被持久化的键（如被 `filter` 过滤掉的键）保留初始值，不会被覆盖为 `undefined`：

```javascript
store.use(persistencePlugin({
  filter: (state) => ({ theme: state.theme }) // 只持久化 theme
}))
// 启动恢复后：theme 为持久化值，其他键（如 language）保留初始值
```

---

### Q: 非小程序环境（Node / 测试环境）使用 persistencePlugin 会报错吗？

**A:** 不会。v0.1.1 起 storage 后端解析顺序为：`options.storage` → 微信 `wx` 同步存储 → **进程内内存存储降级**。无可用后端时自动降级并在开发模式输出 `[GeomStore][persistence]` 告警，持久化不真正落盘但不影响运行。

---

### Q: 组合 Store（非命名空间模式）调用 `$replaceState` 时控制台出现告警？

**A:** 这是 v0.1.1 新增的开发模式保护：非命名空间模式下 `$replaceState` 保留整体替换语义，若提供的数据未包含某子 store 的全部键，这些键将被替换丢失。告警会列出将丢失的键：

```javascript
// 告警示例：[composeStore] $replaceState 未包含 store "user" 的键 [age]...
composed.$replaceState({ name: 'Bob' }) // 缺少 age，开发模式告警

// ✅ 如需保留未提供的状态，改用 $patch
composed.$patch({ name: 'Bob' })
```

---

### Q: withCache / withThrottle 装饰异步方法后行为有变化吗？

**A:** v0.1.1 起异步方法判定改为**函数原型比较**（不再依赖 `constructor.name`，构建压缩后依然可靠）：

- `withCache`：异步方法缓存命中时直接返回缓存的 `Promise`，不会重复发起底层调用
- `withThrottle`：被节流跳过的异步调用返回 `Promise<undefined>`，保持调用方 `await` 语义

---

## 更多问题

如有其他问题，请：

1. 查阅 [API 文档](API.md)
2. 查看 [最佳实践](BEST_PRACTICES.md)
3. 提交 [Issue](https://github.com/openlide/GeomStore/issues)
