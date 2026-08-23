# GeomStore 核心概念与原理解析

本文档深入解析 GeomStore 的核心概念、设计理念和实现原理，帮助你更好地理解和使用这个状态管理库。

---

## 目录

1. [核心概念](#核心概念)
2. [设计理念](#设计理念)
3. [实现原理](#实现原理)
4. [状态管理机制](#状态管理机制)
5. [响应式系统](#响应式系统)
6. [性能优化策略](#性能优化策略)

---

## 核心概念

### Store

Store 是 GeomStore 的核心概念，它是一个包含状态、操作和计算属性的容器。

```javascript
const store = createStore({
  name: 'my-store',     // 标识符
  state: () => ({ ... }), // 状态（推荐工厂函数形式）
  actions: { ... },     // 操作
  getters: { ... }      // 计算属性
})
```

**Store 的三个核心要素：**

| 要素        | 说明           | 特点                 |
| ----------- | -------------- | -------------------- |
| **State**   | 应用状态数据   | 响应式、不可直接修改 |
| **Actions** | 修改状态的方法 | 唯一的状态修改入口   |
| **Getters** | 派生状态计算   | 惰性求值（每次读取即时计算，无缓存） |

### State（状态）

State 是应用的状态数据，具有以下特点：

```javascript
state: () => ({
  // 状态应该是普通对象
  user: null,
  items: [],
  settings: {}
})
```

**特点：**

1. **响应式**：状态变化自动触发更新
2. **保护性**：不能直接修改，必须通过 action
3. **可观测**：可订阅状态变化

**为什么不能直接修改状态？**

```javascript
// ❌ 错误：直接修改
store.state.count = 10

// ✅ 正确：通过 action 修改
store.dispatch('setCount', 10)
```

直接修改状态会导致：
- 无法追踪变化来源
- 无法触发订阅回调
- 调试困难

### Actions（操作）

Actions 是修改状态的唯一途径，具有以下特点：

```javascript
actions: {
  // 同步操作（action 通过 this.state 读写状态，参数为调用时传入）
  increment() {
    this.state.count++
  },

  // 异步操作
  async fetchData() {
    const res = await fetch('/api/data')
    this.state.data = res.data
  }
}
```

**设计原则：**

1. **单一职责**：每个 action 只做一件事
2. **语义化命名**：`fetchUser`、`addToCart`、`removeItem`
3. **幂等性**：相同输入产生相同输出

**Action 上下文：**

```javascript
actions: {
  async login(credentials) {
    // this 指向 action 上下文
    this.state         // 读写状态
    this.dispatch      // 调用其他 action
    this.setState      // 设置单个状态
    this.$patch        // 批量更新
    this.$replaceState // 替换整个状态

    // 调用当前 store 的其他 action
    await this.clearSession()
  }
}
```

### Getters（计算属性）

Getters 用于派生状态，类似 Vue 的 computed：

```javascript
getters: {
  // 基础派生（getter 接收 state 作为第一个参数）
  doubleCount(state) {
    return state.count * 2
  },

  // 基于其他派生值计算
  formattedPrice(state) {
    const totalPrice = state.items.reduce((sum, item) => sum + item.price, 0)
    return `¥${totalPrice.toFixed(2)}`
  },

  // 返回函数（惰性计算）
  findById(state) {
    return (id) => state.items.find(item => item.id === id)
  }
}
```

**求值时机：**

Getter 采用惰性求值：只在被调用时执行，不访问不计算。但 getter 结果**不会缓存**——每次调用都会重新执行函数：

```javascript
getters: {
  expensiveGetter(state) {
    return state.items.reduce((sum, item) => {
      // 复杂计算...
    }, 0)
  }
}

// store.getter('expensiveGetter') 每次调用都会重新执行
```

需要缓存的昂贵派生计算请使用选择器 API（`createSelector` / `createMemoizedSelector` / `createParametricSelector`，见「性能优化策略」）。

---

## 设计理念

### 1. 简洁优先

GeomStore 的 API 设计力求简洁，减少概念数量：

```javascript
// 创建 store - 只需一个函数
const store = createStore({ state, actions, getters })

// 使用 store - 只有几个核心方法
store.state           // 访问状态
store.dispatch()      // 调用 action
store.getter()        // 获取派生值
store.subscribe()     // 订阅变化
```

**对比其他方案：**

| 库        | 核心概念数量                                    | 学习曲线 |
| --------- | ----------------------------------------------- | -------- |
| Redux     | Actions, Reducers, Store, Middleware, Selectors | 高       |
| Vuex      | State, Getters, Mutations, Actions, Modules     | 中高     |
| GeomStore | State, Actions, Getters                         | 低       |

### 2. 类型优先

从设计之初就考虑 TypeScript 支持：

```typescript
// 完整的类型推断
const store = createStore({
  state: () => ({ count: 0 }),
  actions: {
    add(n: number) {
      this.state.count += n
    }
  }
})

// 参数类型自动推断
store.dispatch('add', 'string')  // ❌ 类型错误
store.dispatch('add', 10)        // ✅ 正确
```

### 3. 渐进式增强

从简单用法开始，按需使用高级功能：

```javascript
// Level 1: 基础用法
const store = createStore({ state, actions })

// Level 2: 添加 getters
const store = createStore({ state, actions, getters })

// Level 3: 添加插件
store.use(loggerPlugin)
store.use(persistencePlugin)

// Level 4: 使用方法装饰器（用于类方法，需开启 experimentalDecorators）
class DataService {
  results: unknown[] = []
  data: unknown = null

  @withDebounce(300)
  async search(keyword: string) {
    this.results = await searchApi(keyword)
  }

  @withRetry({ retries: 3, delay: 1000 })
  @withTimeout(5000)
  async fetchData() {
    this.data = await fetchData()
  }
}

// Level 5: Store 组合
const rootStore = composeStore([storeA, storeB])

// Level 6: 性能监控与错误处理
store.use(analyzerPlugin)
const boundary = new ErrorBoundary({ fallback: recoveryFn })
```

### 4. 小程序优化

针对微信小程序场景的特殊优化：

```javascript
// 一键连接页面
Page(withPageStore(store, {
  mapState: ['user', 'cart'],
  mapActions: ['login', 'addToCart']
})({
  // 页面配置
}))

// 一键连接组件
Component(withComponentStore(store, options)({
  // 组件配置
}))

// 自动处理生命周期
// 自动清理订阅
// 自动更新 data
```

---

## 实现原理

### 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                      Application                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                   Store                          │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────────┐  │   │
│  │  │  State  │  │ Actions │  │    Getters      │  │   │
│  │  └────┬────┘  └────┬────┘  └────────┬────────┘  │   │
│  │       │            │                │           │   │
│  │       ▼            ▼                ▼           │   │
│  │  ┌──────────────────────────────────────────┐  │   │
│  │  │           Reactive System                 │  │   │
│  │  └──────────────────────────────────────────┘  │   │
│  │                      │                         │   │
│  │                      ▼                         │   │
│  │  ┌──────────────────────────────────────────┐  │   │
│  │  │           Subscription Manager            │  │   │
│  │  └──────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Plugin System                       │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │   │
│  │  │ Logger │ │Persist │ │DevTools│ │Custom  │   │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │            Integration Layer                     │   │
│  │  ┌─────────────┐  ┌────────────────────────┐   │   │
│  │  │withPageStore│  │withComponentStore      │   │   │
│  │  └─────────────┘  └────────────────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 状态存储

```javascript
class Store {
  // 内部状态存储
  private _state: State

  // 状态代理
  private _proxy: Proxy<State>

  constructor(options) {
    // 创建响应式状态
    this._state = this.createReactiveState(options.state)
  }

  createReactiveState(initialState) {
    // 使用 Proxy 实现响应式
    return new Proxy(initialState, {
      set(target, key, value, receiver) {
        // 1. 设置值
        const result = Reflect.set(target, key, value, receiver)

        // 2. 触发更新
        this.notifyChange()

        return result
      }
    })
  }
}
```

### 订阅发布系统

```javascript
class Store {
  // 监听器 → 注册次数：同一函数重复订阅 N 次会被通知 N 次，
  // 任一份退订只减一，归零才真正移除；重复订阅不计入订阅上限
  private _listeners = new Map<StateListener, number>()

  // 订阅状态变化
  subscribe(listener: StateListener) {
    this._listeners.set(listener, (this._listeners.get(listener) ?? 0) + 1)

    // 返回取消订阅函数（多份注册时只抵消一份）
    return () => {
      /* 计数减一，归零移除 */
    }
  }

  // 通知所有订阅者
  private notifyChange() {
    // 默认对状态深拷贝一次（cloneOnNotify），保证监听器之间引用隔离
    const payload = deepCloneState(this.getState())
    this._listeners.forEach((_count, listener) => {
      try {
        listener(payload)
      } catch (error) {
        // 生产环境静默，开发模式输出 '[GeomStore] Error in state listener:'
        console.error('[GeomStore] Error in state listener:', error)
      }
    })
  }
}
```

### 批量更新机制

```javascript
class Store {
  private _batchDepth = 0
  private _pendingNotify = false

  // 开始批量更新
  startBatch() {
    this._batchDepth++
  }

  // 结束批量更新
  endBatch() {
    this._batchDepth--
    if (this._batchDepth === 0 && this._pendingNotify) {
      this._pendingNotify = false
      this.notifyChange()
    }
  }

  // 批量操作包装器
  batch<T>(fn: () => T): T {
    this.startBatch()
    try {
      return fn()
    } finally {
      this.endBatch()
    }
  }

  // 修改 notifyChange
  private notifyChange() {
    if (this._batchDepth > 0) {
      this._pendingNotify = true
      return
    }
    // 实际通知...
  }
}
```

> 注意两个补充语义：
>
> - action 执行体内调用 `batch()` 时，批量收尾**不提前通知**，统一由外层 dispatch 结束时补发一次，避免 action 中间态外泄；
> - `batch(fn)` 的批保护仅覆盖同步段：开发模式下传入异步回调（返回 Promise）会收到告警，`await` 之后的变更将逐条通知。

---

## 状态管理机制

### 状态修改流程

```
用户操作
    │
    ▼
dispatch(actionName, ...args)
    │
    ▼
┌─────────────────┐
│  Action 执行     │
│  ┌───────────┐  │
│  │  Hook:    │  │
│  │ beforeDis │──┼──► 插件钩子
│  │  patch    │  │
│  └───────────┘  │
│       │         │
│       ▼         │
│  修改 State     │
│       │         │
│       ▼         │
│  ┌───────────┐  │
│  │  Hook:    │  │
│  │ afterDisp │──┼──► 插件钩子
│  │  atch     │  │
│  └───────────┘  │
└─────────────────┘
    │
    ▼
触发订阅回调
    │
    ▼
更新视图
```

### 状态保护

GeomStore 实现了状态保护机制，防止非法修改：

```javascript
class Store {
  private _stateProtection = true

  // 状态访问器
  get state() {
    // 返回只读代理
    return this.createReadOnlyProxy(this._state)
  }

  createReadOnlyProxy(state) {
    return new Proxy(state, {
      set(target, key, value) {
        if (!isInternalAccess()) {
          if (isProduction()) {
            // 生产模式由 productionHandler 配置决定：
            // 'warn'（默认）→ 输出告警后放行写入；'silent' → 静默放行；'error' → 抛错
            handleProduction()
          } else {
            // 开发模式总是抛错
            throw new Error(
              `[GeomStore] Direct mutation of state "${String(key)}" is prohibited. ` +
              'Use setState() or $patch() methods instead.'
            )
          }
        }
        return Reflect.set(target, key, value)
      },

      deleteProperty(target, key) {
        if (!isInternalAccess()) {
          // 同上：开发模式抛错，生产模式由 productionHandler 决定
          handleIllegalDelete(key)
        }
        return Reflect.deleteProperty(target, key)
      }
    })
  }
}
```

---

## 响应式系统

### Proxy 实现

GeomStore 使用 ES6 Proxy 实现响应式系统：

```javascript
function createReactiveObject(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      // 无逐键依赖收集：递归代理嵌套对象，保证深层写入同样被拦截
      const result = Reflect.get(target, key, receiver)
      if (typeof result === 'object' && result !== null) {
        return createReactiveObject(result)
      }
      return result
    },

    set(target, key, value, receiver) {
      // 写入本身不直接触发更新：通知由 setState/$patch/dispatch 流程收尾统一发出。
      // 默认每次变更都广播完整状态；开启 notify.onlyOnChange 后仅在实际发生写入时通知
      return Reflect.set(target, key, value, receiver)
    }
  })
}
```

### 变化检测策略

```javascript
// 基础比较使用 Object.is，按需内嵌在各处（未单独导出 hasChanged）
// 导出的工具为 shallowEqual 与 deepEqual

// 浅比较（用于数组/对象）
function shallowEqual(objA, objB) {
  if (Object.is(objA, objB)) return true

  // 内建对象（Date/RegExp/Map/Set）自有可枚举键恒为空，只比 Object.keys
  // 会把内容不同的实例误判为相等——按内容比较（Date/RegExp 直接比对，
  // Map/Set 复用 deepEqual）
  if ([Date, RegExp, Map, Set].some(
    (T) => objA instanceof T || objB instanceof T
  )) {
    return deepEqual(objA, objB)
  }

  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)

  if (keysA.length !== keysB.length) return false

  for (const key of keysA) {
    if (!Object.is(objA[key], objB[key])) {
      return false
    }
  }

  return true
}

// 深比较（可选）
function deepEqual(objA, objB) {
  // 递归比较...
}
```

---

## 性能优化策略

### 1. LRU 缓存

用于缓存 getter 计算结果：

```javascript
class LRUCache {
  constructor(capacity = 100) {
    this.capacity = capacity
    this.cache = new Map()
  }

  get(key) {
    if (!this.cache.has(key)) return undefined

    // 移动到最前面（最近使用）
    const value = this.cache.get(key)
    this.cache.delete(key)
    this.cache.set(key, value)
    return value
  }

  set(key, value) {
    // 删除旧的
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // 添加新的
    this.cache.set(key, value)

    // 超出容量，删除最久未使用的
    if (this.cache.size > this.capacity) {
      const firstKey = this.cache.keys().next().value
      this.cache.delete(firstKey)
    }
  }
}
```

### 2. 批量更新

```javascript
// 多次修改只触发一次更新
store.batch(() => {
  store.dispatch('setA', 1)
  store.dispatch('setB', 2)
  store.dispatch('setC', 3)
})
// 只触发一次订阅回调
```

### 3. 惰性求值

Getter 只在被访问时才计算：

```javascript
getters: {
  // 这个函数只在 getter 被调用时执行
  expensiveCalculation(state) {
    console.log('计算中...')
    return heavyComputation(state.data)
  }
}

// 不调用就不会计算
store.getter('expensiveCalculation')  // 此时才执行
```

### 4. 选择器缓存

```javascript
import { createParametricSelector } from '@openlide/geomstore'

// 创建带参数的选择器（第二参数可配置缓存：{ ttl, maxEntries }）
const selectUserById = createParametricSelector(
  (state, id) => state.users.find(u => u.id === id)
)

// 先传状态，再传参数调用；结果会被缓存（默认 TTL 5 秒、maxEntries 1000）
selectUserById(state)(1)  // 计算
selectUserById(state)(1)  // 缓存命中
selectUserById(newState)(1)  // 状态变化，重新计算
```

### 5. 内存管理

```javascript
class Store {
  // 销毁时清理资源
  destroy() {
    // 清理订阅
    this._listeners.clear()

    // 清理缓存
    this._cache?.clear()

    // 清理插件
    this._plugins.forEach(uninstall => uninstall?.())
    this._plugins.clear()

    // 清理代理引用
    this._proxy = null
  }
}
```

---

## 总结

GeomStore 的核心设计可以总结为：

1. **单一数据源**：所有状态存储在一个 Store 中
2. **状态只读**：不能直接修改状态，必须通过 action
3. **响应式更新**：状态变化自动触发视图更新
4. **插件扩展**：通过插件系统扩展功能
5. **性能优化**：LRU 缓存、批量更新、惰性求值

这种设计确保了：
- 可预测的状态变化
- 易于调试和追踪
- 高性能的状态更新
- 良好的开发体验
