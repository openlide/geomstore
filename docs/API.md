# GeomStore v0.1.0 API 参考文档

完整的 API 参考文档，包含所有公开接口、类型定义和使用示例。

---

## 目录

- [GeomStore v0.1.0 API 参考文档](#geomstore-v010-api-参考文档)
  - [目录](#目录)
  - [核心 API](#核心-api)
    - [createStore](#createstore)
    - [Store 类](#store-类)
  - [状态管理](#状态管理)
    - [getState](#getstate)
    - [setState](#setstate)
    - [$patch](#patch)
    - [$replaceState](#replacestate)
    - [$snapshot](#snapshot)
    - [$restore](#restore)
  - [Action 系统](#action-系统)
    - [dispatch](#dispatch)
    - [Action 上下文](#action-上下文)
  - [Getter 系统](#getter-系统)
    - [getter](#getter)
  - [订阅系统](#订阅系统)
    - [subscribe](#subscribe)
  - [钩子系统](#钩子系统)
    - [on](#on)
    - [emit](#emit)
    - [size](#size)
    - [listenerCount](#listenercount)
  - [批量更新](#批量更新)
    - [batch](#batch)
    - [startBatch / endBatch](#startbatch--endbatch)
  - [缓存系统](#缓存系统)
    - [enableCache](#enablecache)
    - [disableCache](#disablecache)
    - [getCached](#getcached)
    - [invalidateCache](#invalidatecache)
    - [getCacheStats](#getcachestats)
  - [插件系统](#插件系统)
    - [use](#use)
    - [内置插件](#内置插件)
      - [loggerPlugin](#loggerplugin)
      - [persistencePlugin](#persistenceplugin)
      - [devtoolsPlugin](#devtoolsplugin)
      - [analyzerPlugin](#analyzerplugin)
      - [timeTravelPlugin](#timetravelplugin)
  - [小程序集成](#小程序集成)
    - [withPageStore](#withpagestore)
    - [withComponentStore](#withcomponentstore)
    - [withAppStore](#withappstore)
  - [Store 组合](#store-组合)
    - [composeStore](#composestore)
    - [StoreRegistry](#storeregistry)
  - [选择器](#选择器)
    - [createSelector](#createselector)
    - [createMemoizedSelector](#creatememoizedselector)
    - [createParametricSelector](#createparametricselector)
    - [createStructuredSelector](#createstructuredselector)
  - [错误处理](#错误处理)
    - [GeomStoreError](#geomstoreerror)
    - [ErrorRecovery](#errorrecovery)
    - [ErrorMonitoring](#errormonitoring)
  - [性能监控](#性能监控)
    - [PerformanceMonitor](#performancemonitor)
  - [LRU 缓存](#lru-缓存)
    - [LRUCache](#lrucache)
  - [快照系统](#快照系统)
    - [SnapshotManager](#snapshotmanager)
  - [工具函数](#工具函数)
    - [对象工具](#对象工具)
    - [其他工具](#其他工具)
  - [Action 装饰器](#action-装饰器)
    - [withLog](#withlog)
    - [withDebounce](#withdebounce)
    - [withThrottle](#withthrottle)
    - [withCache](#withcache)
    - [withRetry](#withretry)
    - [withTimeout](#withtimeout)
    - [createDecorator](#createdecorator)
  - [ErrorBoundary](#errorboundary)
  - [性能优化工具](#性能优化工具)
    - [AsyncBatchNotifier](#asyncbatchnotifier)
    - [StateFingerprint](#statefingerprint)
    - [工具函数](#工具函数-1)
  - [类型定义](#类型定义)
    - [常用类型](#常用类型)
  - [版本历史](#版本历史)

---

## 核心 API

### createStore

创建一个 Store 实例，支持完整的类型推断。

**签名：**

`createStore` 提供两种重载：

1. **工厂函数形式**（推荐，类型锚定更精确）：`state` 定义为返回初始状态的函数

```typescript
function createStore<
  S extends State,
  A extends Actions = Actions,
  G extends Getters<S> = Getters<S>
>(options: Omit<StoreOptions<S, A, G>, 'state'> & { state: () => S }): Store<S, A, G>
```

2. **字面量对象形式**：`state` 直接传入初始状态对象

```typescript
function createStore<
  S extends State,
  A extends Actions = Actions,
  G extends Getters<S> = Getters<S>
>(options: StoreOptions<S, A, G>): Store<S, A, G>
```

**参数：**

| 参数    | 类型         | 必填 | 说明           |
| ------- | ------------ | ---- | -------------- |
| options | StoreOptions | 是   | Store 配置选项 |

**StoreOptions 接口：**

```typescript
interface StoreOptions<S, A, G> {
  /** Store 名称，用于调试和识别 */
  name?: string

  /** 初始状态：字面量对象（`state: {...}`）或工厂函数（`state: () => ({...})`，初始化时执行一次并深拷贝） */
  state?: S | (() => S)

  /** Actions（通过 ThisType 注入 this，action 内用 this.state 读写状态） */
  actions?: ActionsWithThis<S, A>

  /** Getters */
  getters?: G

  /** 是否启用缓存 */
  enableCache?: boolean

  /** 需要缓存的 state 键（为空时缓存所有） */
  cacheKeys?: Array<keyof S>

  /** 缓存配置（容量、TTL、统计采集开关等） */
  cacheConfig?: CacheConfig

  /** 状态保护配置 */
  stateProtection?: StateProtectionOptions

  /** 订阅配置（上限数量、超限策略 evict-oldest / throw） */
  subscription?: SubscriptionOptions

  /** 通知行为配置（clone: 通知前是否深拷贝；onlyOnChange: 仅变更时通知） */
  notify?: NotifyOptions
}
```

**返回值：**

返回一个 `Store<S, A, G>` 实例。

**示例：**

```javascript
const { createStore } = require('@openlide/geomstore')

// 基础用法（action 通过 this.state 读写状态，参数为调用时传入的用户参数）
const store = createStore({
  name: 'user',
  state: {
    userInfo: null,
    token: '',
    isLoggedIn: false
  },
  actions: {
    login(credentials) {
      this.state.userInfo = credentials.user
      this.state.token = credentials.token
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

// TypeScript 类型推断
interface UserState {
  userInfo: { name: string } | null
  token: string
  isLoggedIn: boolean
}

interface UserActions {
  login: (credentials: { user: any; token: string }) => void
  logout: () => void
}

interface UserGetters {
  displayName: (state: UserState) => string
}

const typedStore = createStore<UserState, UserActions, UserGetters>({
  // ... 配置同上
})

// ✅ 推荐：state 工厂函数形式（配合显式返回类型，类型锚定更精确）
interface CityState {
  list: string[]
  detail: { id: number; name: string } | null
}

const cityStore = createStore<CityState>({
  state: (): CityState => ({
    list: [],
    detail: null,
  }),
  actions: {
    setList(list: string[]) {
      this.setState('list', list) // ✅ 精确推断为 string[]
    },
  },
})
```

---

### Store 类

Store 类是 GeomStore 的核心，提供状态管理和响应式更新功能。

**属性：**

| 属性    | 类型     | 说明                                                       |
| ------- | -------- | ---------------------------------------------------------- |
| name    | `string` | Store 名称                                                 |
| state   | `S`      | 当前状态（只读 getter，无 setter）                         |
| actions | `A`      | Actions 对象                                               |
| getters | `G`      | Getters 定义对象（只读；提供类型推断位点，可用于调试检查） |

**示例：**

```javascript
const store = createStore({ name: 'counter', state: { count: 0 } })

console.log(store.name)    // 'counter'
console.log(store.state)   // { count: 0 }
console.log(store.actions) // { ... }
console.log(store.getters) // { double: fn }（未定义 getters 时为空对象）
```

---

## 状态管理

### getState

获取当前状态。

**签名：**

```typescript
getState(): S
```

**返回值：**

当前状态的引用。

**示例：**

```javascript
const state = store.getState()
console.log(state.count)
```

---

### setState

设置单个状态值。

**签名：**

```typescript
setState<K extends keyof S>(key: K, value: S[K]): void
```

**参数：**

| 参数  | 类型    | 说明     |
| ----- | ------- | -------- |
| key   | keyof S | 状态键名 |
| value | S[K]    | 新值     |

**示例：**

```javascript
store.setState('count', 10)
store.setState('userInfo', { name: 'John' })
```

---

### $patch

批量更新状态。

**签名：**

```typescript
$patch(partialState: Partial<S>): void
```

**参数：**

| 参数         | 类型         | 说明         |
| ------------ | ------------ | ------------ |
| partialState | Partial\<S\> | 部分状态对象 |

**示例：**

```javascript
store.$patch({
  count: 10,
  name: 'New Name',
  active: true
})
```

---

### $replaceState

替换整个状态。

> ℹ️ 传入的对象会被深拷贝，外部引用不会被 Store 内部持有，避免意外的状态污染。

**签名：**

```typescript
$replaceState(newState: S): void
```

**参数：**

| 参数     | 类型 | 说明       |
| -------- | ---- | ---------- |
| newState | S    | 新状态对象 |

**示例：**

```javascript
store.$replaceState({
  count: 0,
  name: 'Reset',
  active: false
})
```

---

### $snapshot

创建状态快照。

> ℹ️ 快照会被**递归深冻结**：嵌套的纯对象与数组（含数组元素）均被 `Object.freeze`，任何直接修改在严格模式下抛出 `TypeError`，非严格模式下静默失败。冻结仅作用于快照副本，不影响原 state 的可变性。

**签名：**

```typescript
$snapshot(): Readonly<S>
```

**返回值：**

状态的深拷贝快照（递归冻结，不可变）。

**示例：**

```javascript
const snapshot = store.$snapshot()
// 快照深冻结，直接修改会抛错（严格模式）
// snapshot.count = 100 // ❌ TypeError: Cannot assign to read only property
console.log(store.state.count) // 原值不受影响
```

---

### $restore

从快照恢复状态。

**签名：**

```typescript
$restore(snapshot: Readonly<S>): void
```

**参数：**

| 参数     | 类型          | 说明     |
| -------- | ------------- | -------- |
| snapshot | Readonly\<S\> | 快照对象 |

**示例：**

```javascript
const snapshot = store.$snapshot()
// ... 执行一些操作
store.$restore(snapshot) // 恢复到快照状态
```

---

## Action 系统

### dispatch

执行 action。

**签名：**

```typescript
// 类型安全版本
dispatch<K extends keyof A>(
  actionName: K,
  ...args: InferActionArgs<A, K>
): InferActionReturn<A, K>

// 动态调用版本
dispatch(actionName: string, ...args: unknown[]): unknown
```

**参数：**

| 参数       | 类型   | 说明        |
| ---------- | ------ | ----------- |
| actionName | string | Action 名称 |
| args       | any[]  | Action 参数 |

**返回值：**

Action 的返回值。

**示例：**

```javascript
// 无参数 action
store.dispatch('increment')

// 带参数 action
store.dispatch('add', 10)

// 多参数 action
store.dispatch('addRange', 1, 10)

// 异步 action
await store.dispatch('fetchData')
```

---

### Action 上下文

在 action 内部，`this` 指向 ActionContext，提供以下属性和方法：

**ActionContext 接口：**

```typescript
interface ActionContext<S, A> {
  // 属性
  readonly name: string      // Store 名称
  readonly state: S          // 状态访问器

  // 状态方法
  setState<K extends keyof S>(key: K, value: S[K]): void
  $patch(partialState: Partial<S>): void
  $replaceState(newState: S): void
  getState(): S

  // 类型安全的跨 action 调用（编译期校验 action 名与参数，仅接受已声明的 action 名称）
  dispatch<K extends keyof A>(actionName: K, ...args: InferActionArgs<A, K>): InferActionReturn<A, K>

  // 其他 action 方法（通过 A 类型合并）
  [K in keyof A]: A[K]
}
```

> 注意：action 内 `this.dispatch` **不提供字符串兜底重载**（拼错 action 名/传错参数会在编译期报错）。
> 需要动态 dispatch（action 名来自变量）时，请改用外部 `store.dispatch(actionName, ...args)`。

**示例：**

```javascript
actions: {
  async login(credentials) {
    // 调用其他 action（通过 A 类型合并到 this）
    await this.clearSession()

    // dispatch
    this.dispatch('setLoading', true)

    try {
      const res = await wx.request({
        url: '/api/login',
        method: 'POST',
        data: credentials
      })
      this.state.userInfo = res.data.user
      this.state.token = res.data.token
    } finally {
      this.dispatch('setLoading', false)
    }
  },

  clearSession() {
    this.state.userInfo = null
    this.state.token = null
  },

  setLoading(loading) {
    this.state.loading = loading
  }
}
```

---

## Getter 系统

### getter

获取派生状态。

**签名：**

```typescript
// 类型安全版本
getter<K extends keyof G>(getterName: K): InferGetterReturn<G, K>

// 动态调用版本
getter(getterName: string): unknown
```

**参数：**

| 参数       | 类型   | 说明        |
| ---------- | ------ | ----------- |
| getterName | string | Getter 名称 |

**返回值：**

Getter 计算后的值。

**示例：**

```javascript
// 基础用法
const doubled = store.getter('doubleCount')

// 参数化 getter
const item = store.getter('getById')(123)

// 复杂计算
const total = store.getter('totalPrice')
```

---

## 订阅系统

### subscribe

订阅状态变化。

**签名：**

```typescript
subscribe(listener: StateListener<S>): () => void
```

**参数：**

| 参数     | 类型               | 说明       |
| -------- | ------------------ | ---------- |
| listener | StateListener\<S\> | 监听器函数 |

**StateListener 类型：**

```typescript
type StateListener<S> = (state: S) => void
```

**返回值：**

取消订阅函数。

**示例：**

```javascript
// 订阅状态变化
const unsubscribe = store.subscribe((state) => {
  console.log('状态已更新:', state)
})

// 取消订阅
unsubscribe()

// 在页面中使用
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

---

## 钩子系统

Store 内部提供生命周期钩子（`onError`、`beforeSetState` 等），插件可借助钩子系统实现自定义扩展。每个 Store 实例独立拥有一个 `HookSystem` 实例，可通过插件的 `install(store)` 回调访问。

### on

注册钩子处理器。

```typescript
on(hookName: HookName, handler: HookHandler): () => void
```

**参数：**

- `hookName`: 钩子名称，如 `'onError'`、`'beforeSetState'`
- `handler`: 处理器函数，钩子触发时被调用

**返回值：**

取消注册函数，调用后该处理器不再被触发。

### emit

触发钩子。

```typescript
emit(hookName: HookName, ...args: unknown[]): void
```

处理器抛错会被捕获并记录，同时触发 `onError` 钩子（若 `hookName` 本身不是 `'onError'`）。

### size

获取钩子数量。

```typescript
size(hookName?: HookName): number
```

**注意双语义：**

- 无参调用时返回已注册的钩子种类数
- 传入 `hookName` 时返回该钩子当前的监听器数量

如需语义明确，推荐使用 `listenerCount()`。

### listenerCount

获取指定钩子的监听器数量，是 `size()` 的语义明确别名。

```typescript
listenerCount(hookName: HookName): number
```

**示例：**

```javascript
const hooks = store.hooks

hooks.on('beforeSetState', handlerA)
const unsubscribe = hooks.on('beforeSetState', handlerB)

hooks.listenerCount('beforeSetState') // 2
hooks.size('beforeSetState')          // 2

unsubscribe()
hooks.listenerCount('beforeSetState') // 1
```

---

## 批量更新

### batch

在批量更新上下文中执行操作，只触发一次更新。

**签名：**

```typescript
batch<T>(fn: () => T): T
```

**参数：**

| 参数 | 类型    | 说明         |
| ---- | ------- | ------------ |
| fn   | () => T | 要执行的函数 |

**返回值：**

函数的返回值。

**示例：**

```javascript
store.batch(() => {
  store.setState('a', 1)
  store.setState('b', 2)
  store.setState('c', 3)
  // 只触发一次订阅回调
})
```

---

### startBatch / endBatch

手动控制批量更新的开始和结束。

**签名：**

```typescript
startBatch(): void
endBatch(): void
```

**示例：**

```javascript
store.startBatch()
store.setState('a', 1)
store.setState('b', 2)
store.endBatch() // 触发更新
```

---

## 缓存系统

### enableCache

启用缓存功能。

**签名：**

```typescript
enableCache(keys?: Array<keyof S>): void
```

**参数：**

| 参数 | 类型             | 说明                   |
| ---- | ---------------- | ---------------------- |
| keys | Array\<keyof S\> | 可选，要缓存的键名数组 |

**示例：**

```javascript
// 缓存所有状态
store.enableCache()

// 只缓存特定键
store.enableCache(['userInfo', 'settings'])
```

---

### disableCache

禁用缓存功能。

**签名：**

```typescript
disableCache(): void
```

---

### getCached

从缓存获取状态值。

**签名：**

```typescript
getCached<K extends keyof S>(key: K): S[K]
```

**参数：**

| 参数 | 类型    | 说明     |
| ---- | ------- | -------- |
| key  | keyof S | 状态键名 |

**返回值：**

缓存的状态值，如果未命中则返回当前值。

**示例：**

```javascript
const cached = store.getCached('userInfo')
```

---

### invalidateCache

使缓存失效。

**签名：**

```typescript
invalidateCache<K extends keyof S>(key?: K): void
```

**参数：**

| 参数 | 类型    | 说明                               |
| ---- | ------- | ---------------------------------- |
| key  | keyof S | 可选，要清除的键名，不传则清除所有 |

**示例：**

```javascript
// 清除单个缓存
store.invalidateCache('userInfo')

// 清除所有缓存
store.invalidateCache()
```

---

### getCacheStats

获取缓存统计信息。

**签名：**

```typescript
getCacheStats(): CacheStats
```

**返回值：**

```typescript
interface CacheStats {
  enabled: boolean    // 是否启用
  size: number        // 缓存项数量
  keys: string[]      // 缓存的键
  hits: number        // 命中次数
  misses: number      // 未命中次数
  evictions?: number  // 淘汰次数
}
```

---

## 插件系统

### use

安装插件。

**签名：**

```typescript
use(plugin: Plugin): () => void
```

**参数：**

| 参数   | 类型   | 说明     |
| ------ | ------ | -------- |
| plugin | Plugin | 插件对象 |

**Plugin 接口：**

```typescript
interface Plugin {
  name: string
  install: (store: Store) => void | (() => void)
}
```

**返回值：**

卸载插件的函数。

**示例：**

```javascript
// 使用内置插件
const uninstall = store.use(loggerPlugin)

// 卸载插件
uninstall()
```

---

### 内置插件

#### loggerPlugin

日志插件，记录状态变化。

> ℹ️ 生产环境保护：当 `NODE_ENV === 'production'` 时，插件自动返回空操作，不订阅任何钩子，避免性能损耗和信息泄露。

```javascript
const { loggerPlugin } = require('@openlide/geomstore')

store.use(loggerPlugin)
// 每次状态变化输出：[GeomStore] State changed: { ... }
```

#### persistencePlugin

持久化插件，将状态保存到存储。

```javascript
const { persistencePlugin } = require('@openlide/geomstore')

store.use(persistencePlugin({
  key: 'app-state',
  storage: {
    getItem: (key) => wx.getStorageSync(key),
    setItem: (key, value) => wx.setStorageSync(key, value),
    removeItem: (key) => wx.removeStorageSync(key)
  },
  filter: (state) => ({ userInfo: state.userInfo }),
  restore: true,
  debounce: 500
}))
```

**PersistenceOptions：**

| 参数             | 类型                               | 说明                                                                       |
| ---------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| key              | string \| (name: string) => string | 存储键名                                                                   |
| storage          | StorageBackend                     | 存储后端                                                                   |
| filter           | (state: S) => Partial\<S\>         | 状态过滤器                                                                 |
| restore          | boolean                            | 是否在启动时恢复                                                           |
| debounce         | number                             | 防抖延迟（毫秒）                                                           |
| clearOnUninstall | boolean                            | 卸载插件时是否清除存储数据（默认 `false`，仅停止监听，保留已持久化的数据） |

**行为说明：**

- **storage 后端解析顺序**：优先使用 `options.storage`；未提供时自动检测微信环境的 `wx.getStorageSync` / `wx.setStorageSync`；两者都不可用时（如测试/Node 环境）**降级为进程内内存存储**，开发模式下输出 `[GeomStore][persistence]` 告警，持久化不真正落盘但不影响运行。
- **恢复语义为合并不替换**：启动恢复使用 `$patch` 将持久化数据合并进当前 state；未持久化的键（如被 `filter` 过滤掉的键）**保留初始值**，不会被覆盖为 `undefined`。

#### devtoolsPlugin

开发者工具插件。

```javascript
const { devtoolsPlugin } = require('@openlide/geomstore')

if (process.env.NODE_ENV === 'development') {
  store.use(devtoolsPlugin)
}

// 在控制台访问
console.log(globalThis.__GEOMSTORE_STORES__)
console.log(globalThis.__GEOMSTORE_DEVTOOLS__)
```

#### analyzerPlugin

性能分析插件。

```javascript
const { analyzerPlugin } = require('@openlide/geomstore')

store.use(analyzerPlugin)

// 访问分析数据
console.log(globalThis.__GEOMSTORE_ANALYZER__)
```

**行为说明：**

- dispatch / setState / getter 执行抛错时，插件会在 `onError` 时结束并清理未完成的计时配对，避免监控器内部残留悬挂条目。
- 卸载时若发现 `store.getter` 已被后续插件重新包装，会跳过恢复并输出告警，避免破坏其他插件的包装链。

#### timeTravelPlugin

时间旅行插件，支持状态回滚。

```javascript
const { timeTravelPlugin } = require('@openlide/geomstore')

store.use(timeTravelPlugin({
  maxSize: 100,    // 最多保留的快照数（默认 50）
  autoRecord: true // 自动记录状态变化快照
}))

// 使用时间旅行
const timeTravel = globalThis.__GEOMSTORE_TIME_TRAVEL__[store.name]
timeTravel.undo()
timeTravel.redo()
timeTravel.goTo(5)
```

---

## 小程序集成

### withPageStore

将 Store 连接到页面。

`S` / `A` / `G` 均从 store 参数自动推断，`O` 保留 options 字面量类型用于精确推导：`mapState` / `mapGetters` / `mapActions` 的键与值拼错时会在编译期报错；装饰器返回类型重写所有方法的 `this` 为 `PageThis`，使方法内 `this.data` / `this.xxx` 自动获得精确类型推导（含 data、actions、自定义方法）。

**签名：**

```typescript
function withPageStore<S, A, G, O extends ConnectOptions<S, A, G>>(
  store: Store<S, A, G>,
  options?: O
): <C extends PageOptions>(pageOptions: C) => PageThis<S, A, G, O, PageOwnMethods<C>> & Omit<C, 'data'> & { data: C.data & ExtractPageData<S, O, G> }
```

**参数：**

| 参数    | 类型           | 说明       |
| ------- | -------------- | ---------- |
| store   | Store          | Store 实例 |
| options | ConnectOptions | 连接选项   |

**ConnectOptions 接口：**

```typescript
interface ConnectOptions<S, A, G> {
  /** 映射 state 到页面 data（对象形式值须为状态键，别名映射同样有类型约束） */
  mapState?: (keyof S)[] | Record<string, keyof S>

  /** 映射 getters 到页面 data（键/值须为 getter 名，拼错编译报错） */
  mapGetters?: (keyof G)[] | Record<string, keyof G>

  /** 映射 actions 到页面方法（对象形式支持本地名重命名，值须为 action 名） */
  mapActions?: (keyof A)[] | Record<string, keyof A>

  /** 是否自动注入到 data */
  autoInject?: boolean

  /** 注入字段映射 */
  injectMapping?: Record<string, string>

  /** 是否在 onShow 时更新 */
  autoUpdateOnShow?: boolean
}
```

**示例：**

```typescript
const { withPageStore } = require('@openlide/geomstore')
const app = getApp()

Page(withPageStore(app.userStore, {
  mapState: ['userInfo', 'token'],
  mapGetters: ['displayName'],
  mapActions: ['login', 'logout']
})({
  data: {
    loading: false
  },

  onLoad() {
    // ✅ this.data 自动推导：userInfo / token / displayName / loading 均有精确类型
    console.log(this.data.userInfo)
    this.data.loading = true
    // ✅ this.login 精确签名：参数类型有提示，传错会报错
    this.login({ username: 'test' })
  }
}))
```

---

### withComponentStore

将 Store 连接到组件。

类型推断与 `withPageStore` 一致（S/A/G/O 从 store 与 options 自动推断，映射键拼错编译报错，装饰器重写方法 this 为 `ComponentThis`）。Component 的自定义方法与 actions 均在 `methods` 命名空间内（与微信官方 Component API 一致）。

**签名：**

```typescript
function withComponentStore<S, A, G, O extends ConnectOptions<S, A, G>>(
  store: Store<S, A, G>,
  options?: O
): <C extends ComponentOptions>(componentOptions: C) => ComponentThis<S, A, G, O, ComponentOwnMethods<C>> & Omit<C, 'data' | 'methods'> & { data: C.data & ExtractPageData<S, O, G> }
```

**示例：**

```typescript
const { withComponentStore } = require('@openlide/geomstore')
const app = getApp()

Component(withComponentStore(app.userStore, {
  mapState: ['userInfo'],
  mapActions: ['updateProfile']
})({
  properties: {
    editable: Boolean
  },

  methods: {
    onSave() {
      // ✅ this.data.userInfo 精确类型
      // ✅ this.updateProfile 精确签名
      this.updateProfile({ name: 'New Name' })
    }
  }
}))
```

---

### withAppStore

将 Store 连接到 App。

类型推断与 `withPageStore` 一致（S/A/G 从 store 自动推断，映射键拼错编译报错，装饰器保持 App 配置原始类型）。

**签名：**

```typescript
function withAppStore<S, A, G>(
  store: Store<S, A, G>,
  options?: ConnectOptions<S, A, G>
): <C extends AppOptions>(appConfig: C) => C
```

`createApp(store, options)` 为语义化别名，签名与 `withAppStore` 完全一致。

**示例：**

```javascript
const { createStore, withAppStore } = require('@openlide/geomstore')

const globalStore = createStore({
  name: 'global',
  state: { theme: 'light' },
  actions: {
    setTheme(theme) {
      this.state.theme = theme
    }
  }
})

App(withAppStore(globalStore, {})({
  onLaunch() {
    this.store.dispatch('setTheme', 'dark')
  }
}))
```

---

## Store 组合

### composeStore

组合多个 Store 成一个统一的 Store。

**签名：**

```typescript
function composeStore<Stores extends readonly StoreLike[]>(
  stores: Stores,
  options?: ComposeOptions
): ComposedStore<ExtractStates<Stores>>
```

组合后的 Store 暴露 `getters` 只读属性，合并规则与 `getter()` 的解析语义一致：命名空间模式下键为 `storeName/getterName`，非命名空间模式为裸名（同名冲突取第一个 store 的定义）。

**参数：**

| 参数    | 类型           | 说明       |
| ------- | -------------- | ---------- |
| stores  | Store[]        | Store 数组 |
| options | ComposeOptions | 组合选项   |

**ComposeOptions 接口：**

```typescript
interface ComposeOptions {
  namespace?: string      // 命名空间前缀
  lazy?: boolean         // 延迟初始化
  strict?: boolean       // 严格模式
  tree?: boolean         // 树形结构
}
```

**示例：**

```javascript
const { composeStore } = require('@openlide/geomstore')

const userStore = createStore({ name: 'user', state: { userInfo: null } })
const cartStore = createStore({ name: 'cart', state: { items: [] } })

const rootStore = composeStore([userStore, cartStore], {
  namespace: true,
  strict: true
})

// 访问组合状态
console.log(rootStore.state) // { user: {...}, cart: {...} }

// 带命名空间调用
rootStore.dispatch('user/login', credentials)
rootStore.dispatch('cart/addItem', product)
```

> ⚠️ 非命名空间模式下 `$replaceState` 保留整体替换语义：未包含某子 store 键时，该子 store 对应状态将被替换丢失。开发模式下会输出 `console.warn` 提示缺失的键；如需保留未提供的状态，请改用 `$patch`。命名空间模式下按子 store 整体替换，无此告警。

---

### StoreRegistry

全局 Store 注册表。

**方法：**

| 方法       | 签名                                 | 说明           |
| ---------- | ------------------------------------ | -------------- |
| register   | (name: string, store: Store) => void | 注册 Store     |
| unregister | (name: string) => void               | 注销 Store     |
| get        | (name: string) => Store \| undefined | 获取 Store     |
| getAll     | () => Record<string, Store>          | 获取所有 Store |
| clear      | () => void                           | 清空注册表     |

**示例：**

```javascript
const { StoreRegistry, globalRegistry } = require('@openlide/geomstore')

// 使用全局注册表
globalRegistry.register('user', userStore)
const store = globalRegistry.get('user')

// 创建独立注册表
const registry = new StoreRegistry()
registry.register('user', userStore)
```

---

## 选择器

### createSelector

创建基础选择器。

**签名：**

```typescript
function createSelector<S, R>(
  selector: Selector<S, R>,
  options?: SelectorOptions
): Selector<S, R>
```

**示例：**

```javascript
const { createSelector } = require('@openlide/geomstore')

const selectUser = createSelector(
  (state) => state.user,
  { cache: true }
)

const user = selectUser(store.state)
```

---

### createMemoizedSelector

创建带记忆化的选择器。

**签名：**

```typescript
function createMemoizedSelector<S, R>(
  selectorFn: Selector<S, R>,
  equalityFn?: (a: unknown, b: unknown) => boolean
): Selector<S, R>
```

**参数：**

| 参数       | 类型     | 说明                                                          |
| ---------- | -------- | ------------------------------------------------------------- |
| equalityFn | Function | 可选，比较函数（默认 `shallowEqual`），决定是否命中记忆化缓存 |

**示例：**

```javascript
const selectExpensive = createMemoizedSelector(
  (state) => {
    // 复杂计算，只有比较函数判定状态变化时才重新计算
    return state.items.reduce((sum, item) => sum + item.price, 0)
  },
  (a, b) => a === b // 自定义比较函数（可选）
)
```

---

### createParametricSelector

创建参数化选择器（柯里化：先传入 state，再传入参数）。

**签名：**

```typescript
function createParametricSelector<S, P, R>(
  selectorFn: (state: S, params: P) => R,
  options?: {
    /** 缓存存活时间（毫秒），默认 5000；设为 0 可禁用过期 */
    ttl?: number
    /** 单个 state 下原始类型参数的缓存条目上限，默认 1000（超出时淘汰最早插入的条目） */
    maxEntries?: number
  }
): (state: S) => (params: P) => R
```

**参数：**

| 参数       | 类型   | 说明                                                                  |
| ---------- | ------ | --------------------------------------------------------------------- |
| ttl        | number | 缓存存活时间（毫秒），默认 5000                                       |
| maxEntries | number | 原始类型参数的缓存条目上限，默认 1000（防高基数参数场景内存无限增长） |

**示例：**

```javascript
const selectItemById = createParametricSelector(
  (state, id) => state.items.find(item => item.id === id),
  { ttl: 10000 } // 自定义缓存有效期
)

// 柯里化调用：先传 state，再传参数
const item = selectItemById(store.state)(123)

// 5 秒（默认 TTL）内同参数直接命中缓存
const itemAgain = selectItemById(store.state)(123)
```

> 对象参数使用 WeakMap 缓存（随参数对象被回收自动释放）；原始类型参数（string/number/boolean 等）使用 Map 缓存并按 `ttl` / `maxEntries` 维护。

---

### createStructuredSelector

创建结构化选择器。

**签名：**

```typescript
function createStructuredSelector<S, R>(
  selectors: { [K in keyof R]?: Selector<S, R[K]> }
): Selector<S, R>
```

**示例：**

```javascript
const selectUserSummary = createStructuredSelector({
  name: (state) => state.user.name,
  email: (state) => state.user.email,
  vipLevel: (state) => state.user.vipLevel
})

const summary = selectUserSummary(store.state)
// { name: '...', email: '...', vipLevel: 1 }
```

---

## 错误处理

### GeomStoreError

自定义错误类。

**签名：**

```typescript
class GeomStoreError extends Error {
  code: string
  context?: Record<string, unknown>
  timestamp: number

  constructor(message: string, code: string, context?: Record<string, unknown>)
}
```

**错误代码：**

| 代码                      | 说明            |
| ------------------------- | --------------- |
| ACTION_NOT_FOUND          | Action 不存在   |
| ACTION_EXECUTION_ERROR    | Action 执行错误 |
| ACTION_TIMEOUT            | Action 超时     |
| ACTION_CANCELLED          | Action 已取消   |
| STATE_KEY_NOT_FOUND       | 状态键不存在    |
| STATE_UPDATE_ERROR        | 状态更新错误    |
| STATE_TYPE_ERROR          | 状态类型错误    |
| SELECTOR_NOT_FOUND        | 选择器不存在    |
| SELECTOR_EXECUTION_ERROR  | 选择器执行错误  |
| SELECTOR_CACHE_ERROR      | 选择器缓存错误  |
| PLUGIN_NOT_FOUND          | 插件不存在      |
| PLUGIN_INSTALLATION_ERROR | 插件安装错误    |
| PLUGIN_EXECUTION_ERROR    | 插件执行错误    |
| STORE_NAME_CONFLICT       | Store 名称冲突  |
| STORE_DEPENDENCY_ERROR    | Store 依赖错误  |
| STORE_COMPOSE_ERROR       | Store 组合错误  |
| VALIDATION_ERROR          | 验证错误        |
| TYPE_ERROR                | 类型错误        |
| PARAMETER_ERROR           | 参数错误        |
| UNKNOWN_ERROR             | 未知错误        |
| INTERNAL_ERROR            | 内部错误        |

**示例：**

```javascript
const { GeomStoreError, isGeomStoreError } = require('@openlide/geomstore')

try {
  store.dispatch('someAction')
} catch (error) {
  if (isGeomStoreError(error)) {
    console.log('错误代码:', error.code)
    console.log('错误上下文:', error.context)
  }
}
```

---

### ErrorRecovery

错误恢复器。

**方法：**

| 方法                    | 说明                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| configure(strategies)   | 配置恢复策略                                                                                                            |
| getConfig(code)         | 获取策略配置                                                                                                            |
| recover(error, context) | 尝试恢复                                                                                                                |
| clearRetryCount(code)   | 清除指定错误码的重试计数（**精确匹配**错误码，不会误清同前缀的其他错误码，如清除 `AUTH` 不会影响 `AUTH_FAILED` 的计数） |
| clearAllRetryCounts()   | 清除重试计数                                                                                                            |

**恢复策略：**

| 策略     | 说明                         |
| -------- | ---------------------------- |
| RETRY    | 重试（见下方语义说明）       |
| FALLBACK | 使用回退值（见下方语义说明） |
| IGNORE   | 忽略错误                     |
| RESTART  | 重启                         |
| RECOVER  | 执行恢复函数                 |

**语义说明：**

- `RETRY`：延迟 `retryDelay` 后**重抛原错误**，由调用方捕获后自行重试原操作（库内不持有原操作引用，无法自动重试）；达到 `maxRetries` 上限时自动清除该错误码的重试计数，避免后续重试成功后额度被残留计数永久占用。
- `FALLBACK`：显式配置 `fallback` 字段（即使值为 `undefined`）时返回该回退值；未配置 `fallback` 字段时走失败分支（不会与「显式配置 `undefined` 回退值」混淆）。

**示例：**

```javascript
const { ErrorRecovery, RecoveryStrategy } = require('@openlide/geomstore')

const recovery = new ErrorRecovery()

recovery.configure({
  'ACTION_TIMEOUT': {
    strategy: RecoveryStrategy.RETRY,
    maxRetries: 3,
    retryDelay: 1000,
    exponentialBackoff: true
  },
  'STATE_KEY_NOT_FOUND': {
    strategy: RecoveryStrategy.FALLBACK,
    // 显式配置 undefined 回退值：恢复时返回 undefined（与「未配置 fallback」的失败分支语义不同）
    fallback: undefined
  }
})

// 恢复错误
const result = await recovery.recover(error, { storeName: 'user' })
```

---

### ErrorMonitoring

错误监控系统。

全局默认实例通过 `getDefaultMonitoring()` 惰性单例获取（首次访问才创建，仅 import 不会产生实例与定时器）；`defaultMonitoring` 为其兼容代理（已废弃，建议改用 `getDefaultMonitoring()`）。

内置 `ConsoleReporter` 在不支持 `console.group` / `console.groupEnd` 的环境（如微信真机基础库）会自动降级为 `console.error` 平铺输出，信息内容不变，不会因分组 API 缺失而静默失效。

**方法：**

| 方法             | 说明                 |
| ---------------- | -------------------- |
| report(context)  | 上报错误             |
| flushReports()   | 立即上报队列中的错误 |
| generateReport() | 生成错误报告         |
| getErrorGroups() | 获取错误分组         |
| clear()          | 清除数据             |
| shutdown()       | 关闭监控             |

**示例：**

```javascript
const { ErrorMonitoring, ConsoleReporter, HttpReporter } = require('@openlide/geomstore')

const monitoring = new ErrorMonitoring({
  reporters: [
    new ConsoleReporter(),
    new HttpReporter('https://api.example.com/errors')
  ],
  batchInterval: 5000,
  batchThreshold: 10,
  enableAggregation: true
})

// 上报错误
await monitoring.report({
  storeName: 'user',
  operation: 'dispatch',
  error: new Error('Something went wrong'),
  level: 'error',
  timestamp: Date.now()
})

// 生成报告
const report = monitoring.generateReport()
console.log(report.summary.totalErrors)
```

---

## 性能监控

### PerformanceMonitor

性能监控器。

**方法：**

| 方法       | 签名                                                 | 说明                                                  |
| ---------- | ---------------------------------------------------- | ----------------------------------------------------- |
| start      | (operation: string, type?: MetricType) => () => void | 开始计时（同名操作并发/嵌套时各自独立配对，互不覆盖） |
| record     | (metrics: PerformanceMetrics) => void                | 记录指标                                              |
| getMetrics | () => PerformanceMetrics[]                           | 获取所有指标                                          |
| getStats   | () => PerformanceStats                               | 获取统计信息                                          |
| clear      | () => void                                           | 清除指标                                              |
| setOptions | (options: PerformanceOptions) => void                | 设置选项                                              |

**示例：**

```javascript
const { PerformanceMonitor } = require('@openlide/geomstore')

const monitor = new PerformanceMonitor({
  sampleRate: 1,
  threshold: 100,
  trackMemory: true
})

// 计时操作
const stop = monitor.start('fetchData', 'dispatch')
// ... 执行操作
stop() // 自动记录

// 获取统计
const stats = monitor.getStats()
console.log('平均耗时:', stats.avgDuration)
console.log('超过阈值次数:', stats.thresholdExceeded)
```

---

## LRU 缓存

### LRUCache

LRU 缓存实现。

**方法：**

| 方法     | 签名                       | 说明         |
| -------- | -------------------------- | ------------ |
| get      | (key: K) => V \| undefined | 获取值       |
| set      | (key: K, value: V) => this | 设置值       |
| has      | (key: K) => boolean        | 检查是否存在 |
| delete   | (key: K) => boolean        | 删除         |
| clear    | () => this                 | 清空         |
| size     | () => number               | 获取大小     |
| resize   | (capacity: number) => this | 调整容量     |
| keys     | () => K[]                  | 获取所有键   |
| values   | () => V[]                  | 获取所有值   |
| getStats | () => LRUCacheStats        | 获取统计     |

**示例：**

```javascript
const { LRUCache } = require('@openlide/geomstore')

const cache = new LRUCache({
  capacity: 100,
  enableStats: true,
  trackAccessTime: true
})

cache.set('user:1', { name: 'John' })
const user = cache.get('user:1')

console.log(cache.getStats())
// { capacity: 100, size: 1, hits: 1, misses: 0, hitRate: 100 }
```

---

## 快照系统

### SnapshotManager

快照管理器。

**方法：**

| 方法                | 签名                                                       | 说明         |
| ------------------- | ---------------------------------------------------------- | ------------ |
| createSnapshot      | \<T\>(data: T, options?) => SnapshotResult\<T\>            | 创建快照     |
| createSnapshotAsync | \<T\>(data: T, options?) => Promise\<SnapshotResult\<T\>\> | 异步创建快照 |
| compareSnapshots    | \<T\>(s1, s2) => SnapshotDiff                              | 对比快照     |

**示例：**

```javascript
const { SnapshotManager, createSnapshotAsync } = require('@openlide/geomstore')

const manager = new SnapshotManager({
  maxDepth: 100,
  detectCircular: true
})

// 同步快照
const result = manager.createSnapshot(store.state)
console.log(result.metadata.nodeCount)

// 异步快照（大数据）
const asyncResult = await createSnapshotAsync(largeState, {
  batchSize: 100,
  onProgress: (p) => console.log(`${p.percentage}%`)
})

// 对比快照
const diff = manager.compareSnapshots(snapshot1, snapshot2)
console.log(diff.changes)
```

---

## 工具函数

### 对象工具

```javascript
const {
  isObject,
  isPlainObject,
  isFunction,
  isArray,
  isPromise,
  shallowEqual,
  deepEqual,
  deepMerge,
  get,
  set,
  clone
} = require('@openlide/geomstore')

// 类型检查
isObject({}) // true
isFunction(() => {}) // true
isArray([]) // true
isPromise(Promise.resolve()) // true

// 比较
shallowEqual({ a: 1 }, { a: 1 }) // true
deepEqual({ a: { b: 1 } }, { a: { b: 1 } }) // true

// 合并
deepMerge({ a: 1 }, { b: 2 }) // { a: 1, b: 2 }

// 路径访问
const obj = { a: { b: { c: 1 } } }
get(obj, 'a.b.c') // 1
set(obj, 'a.b.c', 2)

// 克隆
const cloned = clone({ a: { b: 1 } })
```

### 其他工具

```javascript
const { noop, identity, uniqueId } = require('@openlide/geomstore')

// 空函数
noop() // undefined

// 恒等函数
identity(5) // 5

// 唯一ID
uniqueId('user_') // 'user_1'
```

---

## Action 装饰器

GeomStore 提供了多种装饰器，用于增强方法的行为。

> 这些是 **TypeScript 传统方法装饰器工厂**（返回 `MethodDecorator`），需配合 `@decorator` 语法用于类方法（tsconfig 需开启 `experimentalDecorators`），不支持 `withX(fn, options)` 函数包装器写法。

### withLog

为方法添加日志记录。

**签名：**

```typescript
function withLog(name?: string): MethodDecorator
```

**示例：**

```typescript
import { withLog } from '@openlide/geomstore'

class DataService {
  @withLog('fetchData')
  async fetchData(id: string) {
    const res = await fetch(`/api/data/${id}`)
    return res.json()
  }
}
```

---

### withDebounce

为方法添加防抖功能。

**签名：**

```typescript
function withDebounce(delay?: number): MethodDecorator
```

**参数：**

|| 参数 | 类型 | 默认值 | 说明 |
||------|------|--------|------|
|| delay | number | 300 | 防抖等待时间（毫秒） |

**示例：**

```typescript
import { withDebounce } from '@openlide/geomstore'

class SearchService {
  results: unknown[] = []

  // 搜索防抖
  @withDebounce(300)
  async search(keyword: string) {
    this.results = await searchApi(keyword)
  }
}
```

---

### withThrottle

为方法添加节流功能。

**签名：**

```typescript
function withThrottle(interval?: number): MethodDecorator
```

**参数：**

|| 参数 | 类型 | 默认值 | 说明 |
||------|------|--------|------|
|| interval | number | 300 | 节流间隔（毫秒） |

> ℹ️ 支持同步与异步方法：装饰异步方法时，被节流跳过的调用返回 `Promise<undefined>`（保持调用方 `await` 语义）。异步判定基于函数原型比较，构建压缩（混淆函数名）后依然可靠。

**示例：**

```typescript
import { withThrottle } from '@openlide/geomstore'

class ScrollService {
  scrollTop = 0

  // 滚动位置更新节流
  @withThrottle(100)
  updateScroll(scrollTop: number) {
    this.scrollTop = scrollTop
  }
}
```

---

### withCache

为方法添加结果缓存功能。

**签名：**

```typescript
function withCache(options?: CacheDecoratorOptions): MethodDecorator
```

**CacheDecoratorOptions：**

|| 参数 | 类型 | 默认值 | 说明 |
||------|------|--------|------|
|| ttl | number | 5000 | 缓存有效期（毫秒） |
|| keyFn | Function | 按参数序列化 | 自定义缓存键生成函数 |

> ℹ️ 支持同步与异步方法：异步方法缓存命中时直接返回缓存的 `Promise`（不会重复发起底层调用），判定基于函数原型比较，构建压缩后依然可靠。

**示例：**

```typescript
import { withCache } from '@openlide/geomstore'

class UserService {
  // API 响应缓存
  @withCache({ ttl: 300000 }) // 5分钟缓存
  async fetchUser(userId: string) {
    const res = await fetch(`/api/user/${userId}`)
    return res.json()
  }
}
```

---

### withRetry

为方法添加重试功能。

**签名：**

```typescript
function withRetry(options?: RetryDecoratorOptions): MethodDecorator
```

**RetryDecoratorOptions：**

|| 参数 | 类型 | 默认值 | 说明 |
||------|------|--------|------|
|| retries | number | 3 | 最大重试次数 |
|| delay | number | 100 | 重试延迟（毫秒） |
|| shouldRetry | Function | 始终重试 | 自定义重试条件（接收错误对象） |

**示例：**

```typescript
import { withRetry } from '@openlide/geomstore'

class ApiService {
  // 网络请求重试
  @withRetry({
    retries: 3,
    delay: 1000,
    shouldRetry: (error: Error) => error.message.includes('retryable')
  })
  async fetchWithRetry(url: string) {
    const res = await fetch(url)
    return res.json()
  }
}
```

---

### withTimeout

为方法添加超时限制。

**签名：**

```typescript
function withTimeout(timeout?: number): MethodDecorator
```

**参数：**

|| 参数 | 类型 | 默认值 | 说明 |
||------|------|--------|------|
|| timeout | number | 5000 | 超时时间（毫秒） |

**示例：**

```typescript
import { withTimeout } from '@openlide/geomstore'

class ApiService {
  // 请求超时限制
  @withTimeout(10000) // 10秒超时
  async fetchData() {
    const res = await fetch('/api/data')
    return res.json()
  }
}
```

---

### createDecorator

创建自定义装饰器，在方法执行前后插入自定义逻辑。

**签名：**

```typescript
function createDecorator(options?: DecoratorOptions): MethodDecorator

interface DecoratorOptions {
  before?: (...args: unknown[]) => void
  after?: (result: unknown) => void
  onError?: (error: Error) => void
}
```

**示例：**

```typescript
import { createDecorator } from '@openlide/geomstore'

// 创建自定义装饰器
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
  async fetchData(id: string) {
    const res = await fetch(`/api/data/${id}`)
    return res.json()
  }
}
```

---

## ErrorBoundary

错误边界，用于捕获和处理 Action 执行中的错误。

**签名：**

```typescript
class ErrorBoundary<S = unknown> {
  constructor(options?: ErrorBoundaryOptions<S>)

  // 同步执行函数，捕获错误
  execute<T>(fn: () => T, currentState?: S): T | undefined

  // 异步执行函数，捕获错误
  executeAsync<T>(fn: () => Promise<T>, currentState?: S): Promise<T | undefined>

  // 获取回退状态（fallback 为计算函数时返回 undefined）
  getFallbackState(): S | undefined

  // 设置回退状态
  setFallbackState(state: S): void

  // 获取错误历史（副本）
  getErrorHistory(): Error[]

  // 清除错误历史
  clearErrorHistory(): void

  // 检查是否有错误
  hasError(): boolean

  // 获取最后一个错误
  getLastError(): Error | undefined
}
```

**ErrorBoundaryOptions：**

| 参数        | 类型               | 说明                                                       |
| ----------- | ------------------ | ---------------------------------------------------------- |
| fallback    | `ErrorFallback<S>` | 回退状态：固定值，或 `(error, currentState) => S` 计算函数 |
| onError     | Function           | 错误回调                                                   |
| recoverable | boolean            | 是否可恢复（默认 true）；为 false 时捕获错误后重新抛出     |

**示例：**

```javascript
const { ErrorBoundary } = require('@openlide/geomstore')

const boundary = new ErrorBoundary({
  fallback: (error, currentState) => {
    console.error('Caught by boundary:', error)
    return { ...currentState, recovered: true }
  },
  onError: (error) => {
    // 上报错误
    reportError(error)
  },
})

// 执行并捕获错误（可恢复时返回 undefined，不可恢复时重新抛出）
const result = boundary.execute(() => riskyOperation(), currentState)

// 异步执行
const asyncResult = await boundary.executeAsync(() => riskyAsyncOperation())
```

---

## 性能优化工具

除了 PerformanceMonitor，GeomStore 还提供了一系列性能优化工具：

### AsyncBatchNotifier

异步批量通知器，合并多次状态更新。

```javascript
const { AsyncBatchNotifier } = require('@openlide/geomstore')

const notifier = new AsyncBatchNotifier({
  delay: 16, // 延迟时间
  maxBatchSize: 100 // 最大批量大小
})

notifier.notify(callback)
```

### StateFingerprint

状态指纹，用于快速检测状态变化。

```javascript
const { StateFingerprint } = require('@openlide/geomstore')

const fingerprint = new StateFingerprint()
const hash = fingerprint.compute(state)
const changed = fingerprint.hasChanged(newState)
```

### 工具函数

```javascript
const { 
  iterativeDeepEqual, // 迭代式深度比较
  scheduleIdle,       // 空闲调度
  debounce,           // 防抖
  throttle,           // 节流
  createLRUCache,     // 创建 LRU 缓存
  createAsyncBatchNotifier, // 创建异步批量通知器
  createStateFingerprint,   // 创建状态指纹
  createSubscriptionManager // 创建订阅管理器
} = require('@openlide/geomstore')

// 使用示例
const isEqual = iterativeDeepEqual(obj1, obj2)

scheduleIdle(() => {
  // 在空闲时执行
})

const debouncedFn = debounce(fn, 300)
const throttledFn = throttle(fn, 100)
```

---

## 类型定义

完整的 TypeScript 类型定义请参考 `dist/index.d.ts`。

### 常用类型

```typescript
// 状态类型
type State = Record<string, unknown>

// Actions 类型
type Actions = Record<string, (...args: any[]) => any>

// 为 actions 注入 this 类型（ThisType 方案）
type ActionsWithThis<S, A> = A & ThisType<ActionContext<S, A>>

// Getters 类型
type Getters<S = State> = { [K: string]: (state: S) => unknown }

// 类型推断工具
type InferActionArgs<A, K> = A[K] extends (...args: infer Args) => any ? Args : never
type InferActionReturn<A, K> = A[K] extends (...args: any[]) => infer R ? R : never
type InferGetterReturn<G, K> = G[K] extends (state: any) => infer R ? R : never

// 名称提取
type ActionNames<A> = keyof A & string
type GetterNames<G> = keyof G & string

// 映射类型
type MappedActions<A, M extends (keyof A)[]> = {
  [K in M[number] as K extends string ? K : never]: (...args: InferActionArgs<A, K>) => InferActionReturn<A, K>
}
type MappedGetters<S, G, M extends (keyof G)[]> = {
  [K in M[number] as K extends string ? K : never]: InferGetterReturn<G, K>
}
```

---

## 版本历史

- **v0.1.0** - 初始版本发布
  - 核心 Store 功能
  - 微信小程序集成
  - 插件系统
  - Store 组合
  - 性能监控
  - 错误处理
  - LRU 缓存
  - 快照系统
