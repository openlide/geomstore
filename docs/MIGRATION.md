# 迁移指南（Migration Guide）

> 本文档面向正在使用其他小程序状态管理方案、希望迁移到 **GeomStore v0.4.0** 的开发者。
>
> GeomStore 是零运行时依赖、TypeScript 优先、面向微信小程序（兼容 Skyline / WebView）的轻量级状态管理库。

---

## 目录

- [迁移指南（Migration Guide）](#迁移指南migration-guide)
  - [目录](#目录)
  - [0. 从旧版 GeomStore 升级（瘦核心）](#0-从旧版-geomstore-升级瘦核心)
  - [v0.4.0 错误子系统下沉](#v04-0-破坏性变更错误子系统下沉)
  - [1. 迁移总览](#1-迁移总览)
  - [2. 从原生 setData 迁移](#2-从原生-setdata-迁移)
    - [迁移前（原生写法）](#迁移前原生写法)
    - [迁移后（GeomStore）](#迁移后geomstore)
  - [3. 从 globalData 全局变量迁移](#3-从-globaldata-全局变量迁移)
    - [迁移前](#迁移前)
    - [迁移后](#迁移后)
  - [4. 从 MobX-MiniProgram 迁移](#4-从-mobx-miniprogram-迁移)
    - [迁移示例](#迁移示例)
  - [5. 从 westore / pinia / vuex 概念迁移](#5-从-westore--pinia--vuex-概念迁移)
  - [6. 核心概念对照表](#6-核心概念对照表)
  - [7. 迁移检查清单](#7-迁移检查清单)
  - [相关文档](#相关文档)

---

## 0. 从旧版 GeomStore 升级（瘦核心）

> 适用于已在使用 GeomStore（v0.2.0 及更早）并希望升级到 **v0.4.0 瘦核心 + 错误下沉** 的项目。

### 为什么需要迁移

v0.2.1 起，主入口 `@openlide/geomstore` 改为**瘦核心**：只导出应用运行所必需的核心 API（`Store`、`createStore`、小程序集成 `withPageStore` / `withComponentStore` / `withAppStore`、`composeStore`、LRU 缓存、工具函数）。快照、选择器、性能监控、Action 增强（执行器 / 装饰器）、内置插件、企业微信集成、错误处理等**高级能力**收敛到 `./extras` 子路径，**不再从主入口导出**。v0.4.0 起，错误处理进一步从核心下沉至 `./extras/error` 子路径（详见下文「v0.4.0 破坏性变更：错误子系统下沉」）。

这样做的好处：主包体积更小，未使用的可选能力不会进入小程序主包；代价是这些能力需要显式从子路径引入。

### 破坏性变更

| 变更 | 说明 |
| ---- | ---- |
| 可选能力移出主入口 | 原先从 `@openlide/geomstore` 导入的 `SnapshotManager`、`createSelector`、`PerformanceMonitor`、`ActionExecutor`、`withLog`、`loggerPlugin` 等，改为从对应 `extras` 子路径导入 |
| `createApp` 已移除 | 原 `createApp` 不再提供，App 集成统一使用核心中的 `withAppStore`（仍从主入口导入） |
| 核心 API 保持兼容 | `createStore`、`Store`、`getState` / `setState`、`dispatch`、小程序集成等核心接口签名不变；错误处理下沉至 `extras/error`，其接口签名保持不变 |

### 迁移示例

**升级前（v0.2.0）：**

```javascript
import {
  createStore,
  withPageStore,
  SnapshotManager,
  createSelector,
  PerformanceMonitor,
  loggerPlugin,
} from '@openlide/geomstore'
```

**升级后（v0.2.1 瘦核心）：**

```javascript
// 核心 API 仍从主入口导入
import { createStore, withPageStore, withAppStore } from '@openlide/geomstore'

// 可选能力按需从 extras 子路径导入
import { SnapshotManager } from '@openlide/geomstore/extras/snapshot'
import { createSelector } from '@openlide/geomstore/extras/selector'
import { PerformanceMonitor } from '@openlide/geomstore/extras/performance'
import { loggerPlugin } from '@openlide/geomstore/extras/plugins'

// App 集成：使用核心 withAppStore（替代旧版 createApp）
App(withAppStore(store, options)(config))
```

### 子路径速查

| 能力 | 子路径 |
| ---- | ------ |
| 全部可选能力 | `@openlide/geomstore/extras` |
| 快照 | `@openlide/geomstore/extras/snapshot` |
| 选择器 | `@openlide/geomstore/extras/selector` |
| 性能监控 | `@openlide/geomstore/extras/performance` |
| Action 增强 | `@openlide/geomstore/extras/action` |
| 插件 | `@openlide/geomstore/extras/plugins` |
| 企业微信集成 | `@openlide/geomstore/extras/enterprise` |
| 错误处理 | `@openlide/geomstore/extras/error` |

### 升级检查清单

- [ ] 全局搜索主入口导入，将 `SnapshotManager` / `createSelector` / `PerformanceMonitor` / `ActionExecutor` / `withLog` / `loggerPlugin` 等改为对应 `extras` 子路径
- [ ] 将旧版 `createApp(...)` 替换为 `App(withAppStore(store, options)(config))`
- [ ] 运行 `pnpm typecheck` 确认无缺失导出
- [ ] 运行 `pnpm test` 全量测试通过

### v0.4.0 破坏性变更：错误子系统下沉

> 适用于已在使用 GeomStore（v0.3.0 及更早）并希望升级到 **v0.4.0** 的项目。

v0.4.0 起，错误处理从核心入口进一步下沉至独立的 `./extras/error` 子路径，主入口 `@openlide/geomstore` **不再导出任何错误类**。这是破坏性变更：凡从主入口导入错误类的代码需在 v0.4.0 改为从 `@openlide/geomstore/extras/error` 引入。

| 变更 | 说明 |
| ---- | ---- |
| 错误类移出主入口 | 原先从 `@openlide/geomstore` 导入的 `GeomStoreError`、`createError`、`ErrorCode`、`ErrorRecovery`、`RecoveryStrategy`、`ErrorMonitoring`、`ConsoleReporter`、`ErrorBoundary`、`ErrorHandler` 等，改为从 `@openlide/geomstore/extras/error` 导入 |
| 接口签名不变 | 错误子系统的 API 形态（错误码、恢复策略、监控上报、边界捕获）与 v0.3.0 保持一致，仅导入路径变化 |

**升级前（v0.3.0）：**

```javascript
import { ErrorBoundary, ErrorRecovery } from '@openlide/geomstore'
```

**升级后（v0.4.0）：**

```javascript
import { ErrorBoundary, ErrorRecovery } from '@openlide/geomstore/extras/error'
```

- [ ] 全局搜索主入口导入，将 `GeomStoreError` / `createError` / `ErrorCode` / `ErrorRecovery` / `RecoveryStrategy` / `ErrorMonitoring` / `ConsoleReporter` / `ErrorBoundary` / `ErrorHandler` 等改为从 `@openlide/geomstore/extras/error` 引入

---

## 1. 迁移总览

无论从哪种方案迁移，核心步骤一致：

1. **识别状态归属**：将散落在页面 `data`、`globalData`、全局对象中的状态，收敛为一个个 `createStore`。
2. **把修改逻辑收敛为 action**：所有对状态的写入，从 `setData` / 直接赋值，改为 action（通过 `this.state` 访问状态）。
3. **把派生逻辑收敛为 getter / selector**：消除重复计算与「手写同步」。
4. **通过集成函数接入页面/组件/App**：`withPageStore` / `withComponentStore` / `withAppStore` 负责映射与订阅清理。

> 提示：迁移可以**渐进式**进行——GeomStore 与原生 `setData`、`globalData` 可以共存，先迁移一个页面或一个模块，验证无误后再铺开。

---

## 2. 从原生 setData 迁移

### 迁移前（原生写法）

```javascript
Page({
  data: {
    userInfo: null,
    count: 0,
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo')
    this.setData({ userInfo })
  },

  increment() {
    this.setData({ count: this.data.count + 1 })
  },

  async login(payload) {
    const res = await api.login(payload)
    this.setData({ userInfo: res.user })
  },
})
```

### 迁移后（GeomStore）

```javascript
// store.js —— 状态与逻辑集中到 Store
import { createStore } from '@openlide/geomstore'

export const userStore = createStore({
  name: 'user',
  state: () => ({
    userInfo: null,
    count: 0,
  }),
  actions: {
    async login(payload) {
      const res = await api.login(payload)
      this.state.userInfo = res.user // 通过 this.state 访问状态
    },
    increment() {
      this.state.count++ // 自动触发订阅通知
    },
  },
})
```

```javascript
// page.js —— 页面只负责连接与渲染
import { withPageStore } from '@openlide/geomstore'
import { userStore } from './store'

Page(withPageStore(userStore, {
  mapState: ['userInfo', 'count'],
  mapActions: ['login', 'increment'],
})({
  data: { localData: '仅页面私有的数据' },

  onLoad() {
    // 映射的 state 已在 this.data 上，映射的 action 已在 this 上
    console.log(this.data.userInfo)
    this.increment()
  },

  async handleLogin() {
    await this.login({ username: 'u', password: 'p' })
  },
}))
```

**关键差异**：

| 原生 setData                    | GeomStore                              |
| ------------------------------- | -------------------------------------- |
| `this.setData({ userInfo: x })` | `this.state.userInfo = x`（action 内） |
| 读 `this.data.count`            | 读 `this.data.count`（映射后一致）     |
| 手动管理订阅/清理               | 集成函数自动订阅 + 卸载自动清理        |
| 无类型提示                      | 泛型推导，精确类型提示                 |

---

## 3. 从 globalData 全局变量迁移

### 迁移前

```javascript
// app.js
App({
  globalData: {
    userInfo: null,
    theme: 'light',
  },
})

// page.js —— 各页面手动读写 globalData
const app = getApp()
Page({
  data: {},
  onLoad() {
    this.setData({ userInfo: app.globalData.userInfo })
  },
})
```

### 迁移后

```javascript
// app.js —— 使用 withAppStore 统一管理全局状态
import { withAppStore } from '@openlide/geomstore'
import { appStore } from './store'

App(withAppStore(appStore, {
  mapState: ['userInfo', 'theme'],
  mapActions: ['initApp', 'setTheme'],
})({
  onLaunch() {
    this.initApp()
  },
}))
```

```javascript
// page.js —— 页面直接连接，无需再手写 globalData 同步
Page(withPageStore(appStore, {
  mapState: ['userInfo', 'theme'],
})({
  // 页面配置
}))
```

> 如需保留 `getApp().globalData.xxx` 的访问习惯，`withAppStore` 会自动将映射的 state 同步到 `globalData`。

---

## 4. 从 MobX-MiniProgram 迁移

MobX 与 GeomStore 的映射关系最直观：

| MobX-MiniProgram               | GeomStore                                                    |
| ------------------------------ | ------------------------------------------------------------ |
| `observable({ ... })`          | `createStore({ state: () => ({ ... }) })`                            |
| `action` 装饰器/函数           | `createStore({ actions: { ... } })`（`this.state` 访问状态） |
| `computed`                     | `createStore({ getters: { ... } })` 或 `createSelector`      |
| `observer` 包装组件            | `withComponentStore` / `withPageStore`                       |
| `store.xxx = yyy`（action 内） | `this.state.xxx = yyy`                                       |

### 迁移示例

```javascript
// 迁移前（MobX）
import { observable, action, computed } from 'mobx-miniprogram'

const store = observable({
  count: 0,

  get double() {
    return this.count * 2
  },

  increment: action(function () {
    this.count += 1
  }),
})
```

```javascript
// 迁移后（GeomStore）
import { createStore } from '@openlide/geomstore'

const store = createStore({
  state: () => ({ count: 0 }),
  getters: {
    double: (state) => state.count * 2,
  },
  actions: {
    increment() {
      this.state.count += 1
    },
  },
})
```

---

## 5. 从 westore / pinia / vuex 概念迁移

| 概念     | westore               | pinia / vuex              | GeomStore                              |
| -------- | --------------------- | ------------------------- | -------------------------------------- |
| 状态容器 | `create({ data })`    | `defineStore` / `state`   | `createStore({ state })`               |
| 修改状态 | 直接赋值 + `update()` | `actions` / `mutations`   | `actions`（`this.state.xxx = ...`）    |
| 派生状态 | `computed`            | `getters`                 | `getters` / `createSelector`           |
| 页面接入 | `use` 注入            | `mapState` / `mapActions` | `withPageStore` / `withComponentStore` |
| 类型安全 | 弱                    | 强                        | 强（泛型推导 + 精确映射类型）          |

**GeomStore 与 Vue 系的最大差异**：action 内通过 `this.state` 访问状态（而非 `this.count` 或 `state.count` 参数）。注意迁移时不要把 action 写成 `login(state, payload)`——GeomStore 中 `state` 是 getter 的参数，action 的第一参数是用户传入参数。

---

## 6. 核心概念对照表

| 需求         | GeomStore API                                           |
| ------------ | ------------------------------------------------------- |
| 创建 Store   | `createStore({ state, actions, getters, ... })`         |
| 读取状态     | `store.state` / `store.getState()`                      |
| 设置单个状态 | `store.setState(key, value)`                            |
| 批量更新     | `store.$patch({ ... })` / `store.batch(fn)`             |
| 替换整个状态 | `store.$replaceState(newState)`                         |
| 调用 action  | `store.dispatch('actionName', ...args)`                 |
| 派生状态     | `store.getter('name')` / `createSelector(...)`          |
| 订阅变化     | `store.subscribe((state) => { ... })`                   |
| 页面接入     | `Page(withPageStore(store, options)(config))`           |
| 组件接入     | `Component(withComponentStore(store, options)(config))` |
| App 接入     | `App(withAppStore(store, options)(config))`             |
| 组合多 Store | `composeStore(...)` / `createStoreTree(...)`            |
| 快照/回滚    | `store.$snapshot()` / `$restore()` / `timeTravelPlugin` |

---

## 7. 迁移检查清单

- [ ] 状态从页面 `data` / `globalData` 收敛到 `createStore` 的 `state`
- [ ] 所有状态写入迁移到 `actions`，通过 `this.state` 访问（无 `state` 参数）
- [ ] 派生值迁移到 `getters` / `createSelector`，消除重复计算
- [ ] 页面/组件改用 `withPageStore` / `withComponentStore`（注意柯里化两段式调用）
- [ ] 全局状态改用 `withAppStore`，移除手写 `getApp().globalData` 同步
- [ ] 移除手动订阅与 `onUnload` 清理代码（集成函数自动管理）
- [ ] 运行 `pnpm typecheck` / `pnpm typecheck:tests` 校验类型（享受精确映射类型）
- [ ] 运行 `pnpm test` 全量测试通过

---

## 相关文档

- [快速上手](../README.md)
- [使用指南](./GUIDE.md)
- [API 参考](./API.md)
- [最佳实践](./BEST_PRACTICES.md)
- [常见问题](./FAQ.md)
