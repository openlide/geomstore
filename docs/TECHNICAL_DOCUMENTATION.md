# GeomStore v0.2.0 技术文档

> 轻量级微信小程序状态管理库 - 企业级生产就绪

---

## 目录

1. [项目概述](#1-项目概述)
2. [系统架构](#2-系统架构)
3. [核心功能模块](#3-核心功能模块)
4. [API接口定义](#4-api接口定义)
5. [部署流程](#5-部署流程)
6. [用户指南](#6-用户指南)
7. [性能基准](#7-性能基准)
8. [故障排查](#8-故障排查)

---

## 1. 项目概述

### 1.1 项目简介

**GeomStore** 是一个专为微信小程序设计的轻量级状态管理库，提供简洁、高效、类型安全的状态管理解决方案。

| 属性     | 值                                        |
| -------- | ----------------------------------------- |
| 版本     | 0.2.0                                     |
| 许可证   | MIT                                       |
| 运行环境 | Node.js ≥22.0.0, 微信小程序基础库 ≥2.10.0 |
| 语言     | TypeScript 6.0+                           |
| 打包格式 | CommonJS（CJS-only，微信小程序专用）      |

### 1.2 核心特性

```
┌─────────────────────────────────────────────────────────────┐
│                     GeomStore 核心特性                       │
├─────────────────────────────────────────────────────────────┤
│  ✓ 简洁易用的 API 设计                                       │
│  ✓ 完整的 TypeScript 类型推断                                │
│  ✓ Proxy 状态保护机制                                        │
│  ✓ 高性能 LRU 缓存系统                                       │
│  ✓ 灵活的插件系统                                            │
│  ✓ 微信小程序原生集成                                        │
│  ✓ Skyline 和 Webview 双渲染引擎支持                         │
│  ✓ 企业级错误处理体系                                        │
│  ✓ Store 组合与命名空间                                      │
│  ✓ 性能监控与分析                                            │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 技术栈

| 技术                    | 用途                |
| ----------------------- | ------------------- |
| TypeScript 6.0+         | 核心开发语言        |
| Jest 30+                | 单元测试框架        |
| ESLint 9+               | 代码质量检查        |
| ts-jest                 | TypeScript 测试支持 |
| miniprogram-api-typings | 小程序类型定义      |

### 1.4 项目结构

```
GeomStore/
├── src/                          # 源代码目录
│   ├── index.ts                  # 主入口文件
│   ├── core/                     # 核心模块
│   │   ├── store/                # Store 核心实现
│   │   │   ├── Store.ts          # Store 类定义
│   │   │   ├── factory.ts        # createStore 工厂
│   │   │   ├── ActionManager.ts  # Action 注册与执行
│   │   │   ├── BatchManager.ts   # 批量通知管理
│   │   │   ├── StateProxy.ts     # 状态代理
│   │   │   ├── StoreCache.ts     # Store 级缓存
│   │   │   ├── SubscriptionManager.ts # 订阅管理
│   │   │   ├── types.ts          # 内部类型
│   │   │   ├── utils.ts          # 工具函数
│   │   │   └── index.ts          # 导出入口
│   │   ├── compose/              # Store 组合
│   │   │   ├── composeStore.ts   # 组合函数
│   │   │   ├── StoreRegistry.ts  # 全局注册表
│   │   │   └── index.ts          # 导出入口
│   │   ├── hooks/                # 钩子系统
│   │   │   ├── HookSystem.ts     # 钩子系统实现
│   │   │   └── index.ts          # 导出入口
│   │   ├── selector/             # 选择器系统
│   │   │   ├── createSelector.ts   # 选择器工厂
│   │   │   ├── selectorComposer.ts # 选择器组合器（重试 / 记忆化）
│   │   │   └── index.ts            # 导出入口
│   │   ├── cache/                # 缓存系统
│   │   │   ├── LRUCache.ts       # LRU 缓存实现
│   │   │   └── index.ts          # 导出入口
│   │   ├── error/                # 错误处理
│   │   │   ├── GeomStoreError.ts # 错误类定义
│   │   │   ├── ErrorHandler.ts   # 错误处理器
│   │   │   ├── ErrorBoundary.ts  # 错误边界
│   │   │   ├── ErrorRecovery.ts  # 错误恢复
│   │   │   ├── ErrorMonitoring.ts # 错误监控
│   │   │   └── index.ts          # 导出入口
│   │   ├── action/               # Action 增强
│   │   │   ├── ActionLoader.ts   # Action 加载器
│   │   │   ├── ActionUtils.ts    # Action 工具
│   │   │   ├── AsyncActionSupport.ts # 异步支持
│   │   │   ├── decorators/       # Action 装饰器
│   │   │   └── index.ts          # 导出入口
│   │   ├── performance/          # 性能监控
│   │   │   ├── PerformanceMonitor.ts # 性能监控器
│   │   │   ├── Optimizations.ts  # 性能优化
│   │   │   ├── metrics.ts        # 性能指标
│   │   │   └── index.ts          # 导出入口
│   │   ├── snapshot/             # 快照系统
│   │   │   ├── SnapshotManager.ts # 快照管理器
│   │   │   └── index.ts          # 导出入口
│   │   └── utils/                # 工具函数
│   │       ├── helpers.ts        # 辅助函数
│   │       ├── TypeValidator.ts  # 类型校验器
│   │       └── index.ts          # 导出入口
│   ├── types/                    # 类型定义
│   │   ├── store.ts              # Store 类型
│   │   ├── compose.ts            # 组合类型
│   │   ├── error.ts              # 错误类型
│   │   ├── action.ts             # Action 类型
│   │   ├── selector.ts           # 选择器类型
│   │   ├── performance.ts        # 性能类型
│   │   ├── persistence.ts        # 持久化类型
│   │   ├── integration.ts        # 集成类型
│   │   ├── plugin.ts             # 插件类型
│   │   ├── global.ts             # 全局类型扩展
│   │   └── index.ts              # 类型导出入口
│   ├── plugins/                  # 插件系统
│   │   ├── builtin.ts            # 内置插件
│   │   ├── devtools/             # 开发工具插件
│   │   │   ├── timeTravelPlugin.ts # 时间旅行插件
│   │   │   └── index.ts          # 导出入口
│   │   ├── performance/          # 性能分析插件
│   │   │   ├── analyzerPlugin.ts # 性能分析插件
│   │   │   └── index.ts          # 导出入口
│   │   └── index.ts              # 插件导出入口
│   └── integrations/             # 小程序集成
│       ├── with-store.ts         # Page/Component 集成
│       ├── with-app-store.ts     # App 集成
│       ├── utils.ts              # 集成工具
│       ├── enterprise/           # 企业级集成
│       │   ├── wechat-enterprise.ts # 微信企业版集成
│       │   └── index.ts          # 导出入口
│       └── index.ts              # 集成导出入口
├── tests/                        # 测试目录
│   ├── unit/                     # 单元测试
│   ├── integration/              # 集成测试
│   └── setup.js                  # 测试配置
├── packages/benchmark/           # 基准测试包
├── styles/                       # 样式文件
├── dist/                         # 编译输出
├── docs/                         # 文档目录
├── scripts/                      # 构建脚本
├── package.json                  # 项目配置
├── tsconfig.json                 # TypeScript 配置
├── tsconfig.jest.json            # Jest TypeScript 配置
├── jest.config.cjs               # Jest 配置
└── eslint.config.js              # ESLint 配置
```

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           应用层 (Application Layer)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│  │    Page     │  │  Component  │  │     App     │  │  自定义页面  │    │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘    │
│         │                │                │                │            │
│         └────────────────┴────────────────┴────────────────┘            │
│                                    │                                    │
├────────────────────────────────────┼────────────────────────────────────┤
│                           集成层 (Integration Layer)                    │
│                                    │                                    │
│  ┌─────────────────────────────────┴─────────────────────────────────┐  │
│  │                    withPageStore / withComponentStore              │  │
│  │                    withAppStore / createApp                        │  │
│  └─────────────────────────────────┬─────────────────────────────────┘  │
│                                    │                                    │
├────────────────────────────────────┼────────────────────────────────────┤
│                           核心层 (Core Layer)                           │
│                                    │                                    │
│  ┌─────────────┐  ┌───────────────┴───────────────┐  ┌─────────────┐  │
│  │    Store    │  │       composeStore            │  │  Selector   │  │
│  │   (核心)    │  │       (Store组合)             │  │  (选择器)   │  │
│  └──────┬──────┘  └───────────────┬───────────────┘  └──────┬──────┘  │
│         │                         │                         │          │
│  ┌──────┴─────────────────────────┴─────────────────────────┴──────┐  │
│  │                         State (状态)                            │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                         支撑层 (Support Layer)                          │
│                                                                         │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐           │
│  │ LRU Cache │  │  Errors   │  │  Plugins  │  │Performance│           │
│  │ (缓存系统)│  │ (错误处理)│  │ (插件系统)│  │ (性能监控)│           │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块依赖关系

```
                    ┌─────────────┐
                    │   index.ts  │
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │    Store    │ │ composeStore│ │   plugins   │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           ├───────────────┴───────────────┤
           │                               │
           ▼                               ▼
    ┌─────────────┐                 ┌─────────────┐
    │    types    │                 │    hooks    │
    └─────────────┘                 └─────────────┘
           │
           ├───────────────┬───────────────┐
           │               │               │
           ▼               ▼               ▼
    ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
    │   errors    │ │    cache    │ │   utils     │
    └─────────────┘ └─────────────┘ └─────────────┘
```

### 2.3 数据流架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                          单向数据流                                  │
│                                                                     │
│   ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐   │
│   │  View   │ ──── │ Action  │ ──── │  Store  │ ──── │  State  │   │
│   │ (视图)  │      │ (动作)  │      │ (仓库)  │      │ (状态)  │   │
│   └─────────┘      └─────────┘      └─────────┘      └────┬────┘   │
│        ▲                                                  │        │
│        │                                                  │        │
│        └──────────────────────────────────────────────────┘        │
│                         订阅更新 (Subscribe)                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

详细流程:

┌──────────┐    dispatch()    ┌──────────┐    setState()    ┌──────────┐
│  View    │ ───────────────> │  Action  │ ──────────────>  │  Store   │
│ (Page/   │                  │          │                  │          │
│Component)│                  └──────────┘                  └────┬─────┘
└────┬─────┘                                                     │
     ▲                                                           │
     │                        subscribe()                        │
     └───────────────────────────────────────────────────────────┘
                                        状态变化通知
```

### 2.4 模块职责划分

| 模块             | 职责                         | 核心文件                                                 |
| ---------------- | ---------------------------- | -------------------------------------------------------- |
| **Store**        | 状态存储、状态保护、订阅管理 | `src/core/store/Store.ts`                                |
| **composeStore** | 多 Store 组合、命名空间管理  | `src/core/compose/composeStore.ts`                       |
| **Selector**     | 派生状态计算、缓存优化       | `src/core/selector/createSelector.ts`                    |
| **Cache**        | LRU 缓存、状态缓存           | `src/core/cache/LRUCache.ts`                             |
| **Error**        | 错误分类、错误恢复、错误监控 | `src/core/error/`                                        |
| **Plugin**       | 钩子系统、插件生命周期       | `src/core/hooks/`（实现）+ `src/types/plugin.ts`（契约） |
| **Integration**  | 小程序集成、自动绑定         | `src/integrations/`                                      |

---

## 3. 核心功能模块

### 3.1 Store 核心模块

#### 3.1.1 模块概述

Store 是 GeomStore 的核心，负责状态管理、状态保护、订阅通知等功能。

#### 3.1.2 核心类图

```
┌─────────────────────────────────────────────────────────────────────┐
│                            Store<S, A, G>                           │
├─────────────────────────────────────────────────────────────────────┤
│  - _state: S                                                        │
│  - _proxyCache: ProxyCache                                          │
│  - _stateProtection: StateProtectionOptions                        │
│  - _plugins: Plugin[]                                               │
├─────────────────────────────────────────────────────────────────────┤
│  子模块实例（模块化重构后）：                                        │
│  - _subscriptionManager: SubscriptionManager<S>  （订阅管理）       │
│  - _cacheManager: StoreCacheManager<S>           （LRU 级缓存）     │
│  - _stateProxyManager / _actionManager                              │
│  - _getterManager / _batchManager                                   │
│  + hooks: HookSystem（实例级）                                      │
├─────────────────────────────────────────────────────────────────────┤
│  + name: string                                                     │
│  + state: S                                                         │
│  + actions: A                                                       │
├─────────────────────────────────────────────────────────────────────┤
│  + getState(): S                                                    │
│  + setState<K>(key: K, value: S[K]): void                          │
│  + $patch(partialState: Partial<S>): void                          │
│  + $replaceState(newState: S \| (() => S)): void                    │
│  + dispatch<K>(actionName: K, ...args): R                          │
│  + getter<K>(getterName: K): R                                      │
│  + subscribe(listener: StateListener<S>): () => void               │
│  + use(plugin: Plugin): () => void                                 │
│  + destroy(): void                                                  │
│  + $snapshot(): Readonly<S>                                         │
│  + $restore(snapshot: Readonly<S>): void                           │
│  + startBatch(): void                                               │
│  + endBatch(): void                                                 │
│  + batch<T>(fn: () => T): T                                         │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3.1.3 状态保护机制

Store 使用 Proxy 实现状态保护，防止外部直接修改状态：

```
状态访问流程:
                    
外部访问                    内部访问(actions中)
    │                            │
    ▼                            │
┌─────────────┐                  │
│ state 访问  │                  │
└──────┬──────┘                  │
       │                         │
       ▼                         │
┌─────────────────┐              │
│ _stateProtection│              │
│   enabled?      │              │
└────────┬────────┘              │
         │                       │
    ┌────┴────┐                  │
    │         │                  │
    ▼         ▼                  ▼
  false     true         _isInternalAccess=true
    │         │                  │
    │         ▼                  │
    │   ┌─────────────┐          │
    │   │ 返回 Proxy  │          │
    │   └─────────────┘          │
    │         │                  │
    │         ▼                  │
    │   ┌─────────────────────────────────────┐
    │   │ Proxy 拦截 set 操作                 │
    │   │ - 检查 _isInternalAccess           │
    │   │ - 外部修改: 抛出错误/警告           │
    │   │ - 内部修改: 允许通过                │
    │   └─────────────────────────────────────┘
    │
    ▼
┌─────────────┐
│ 返回原始状态│
└─────────────┘
```

#### 3.1.4 使用示例

```typescript
import { createStore } from '@openlide/geomstore'

// 定义状态类型
interface UserState {
  user: { name: string; age: number } | null
  isLoggedIn: boolean
  token: string | null
}

// 定义 Actions 类型
interface UserActions {
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  updateProfile: (profile: Partial<UserState['user']>) => void
}

// 定义 Getters 类型
interface UserGetters {
  displayName: (state: UserState) => string
  isAuthenticated: (state: UserState) => boolean
}

// 创建 Store
const userStore = createStore<UserState, UserActions, UserGetters>({
  name: 'user-store',
  state: () => ({
    user: null,
    isLoggedIn: false,
    token: null
  }),
  actions: {
    // this 自动获得类型提示
    async login(username, password) {
      // 模拟 API 调用
      const response = await fetch('/api/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      })
      const data = await response.json()
      
      // 使用 this.setState 更新状态
      this.setState('user', data.user)
      this.setState('isLoggedIn', true)
      this.setState('token', data.token)
    },
    
    logout() {
      this.$patch({
        user: null,
        isLoggedIn: false,
        token: null
      })
    },
    
    updateProfile(profile) {
      if (this.state.user) {
        this.setState('user', { ...this.state.user, ...profile })
      }
    }
  },
  
  getters: {
    displayName: (state) => state.user?.name ?? 'Guest',
    isAuthenticated: (state) => state.isLoggedIn && state.token !== null
  }
})

// 使用 Store
await userStore.dispatch('login', 'admin', 'password')
console.log(userStore.getter('displayName')) // 'admin'
console.log(userStore.getter('isAuthenticated')) // true
```

> **state 工厂函数形式**：除字面量对象外，`state` 也可定义为工厂函数 `state: (): UserState => ({...})`（初始化时执行一次并深拷贝）。在 strict TypeScript 下，显式返回类型可避免 `[]` 被推断为 `never[]`、`null` 被收窄为 `null` 导致的类型错误。`$replaceState(newState: S | (() => S))` 同样支持工厂函数形式。

### 3.2 Store 组合模块 (composeStore)

#### 3.2.1 模块概述

`composeStore` 允许将多个 Store 组合成一个统一的 Store，支持命名空间和模块化管理。

#### 3.2.2 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                       ComposedStore                                  │
├─────────────────────────────────────────────────────────────────────┤
│  - _stores: Store[]                                                 │
│  - _namespace: string                                                │
│  - _strict: boolean                                                  │
│  - _notificationScheduled: boolean                                  │
├─────────────────────────────────────────────────────────────────────┤
│  + name: string                                                      │
│  + stores: Record<string, Store>                                    │
├─────────────────────────────────────────────────────────────────────┤
│  + getState(): CombinedState                                         │
│  + dispatch(namespace/action, ...args): any                         │
│  + getter(namespace/getter): any                                    │
│  + subscribe(listener): () => void                                  │
│  + use(plugin): () => void                                          │
└─────────────────────────────────────────────────────────────────────┘

组合示例:

┌─────────────────────────────────────────────────────────────────────┐
│                         ComposedStore                                │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐           │
│  │   userStore   │  │  cartStore    │  │ productStore  │           │
│  │  (用户模块)   │  │  (购物车)     │  │  (商品)       │           │
│  │               │  │               │  │               │           │
│  │  state: {     │  │  state: {     │  │  state: {     │           │
│  │    user,      │  │    items,     │  │    products,  │           │
│  │    token      │  │    total      │  │    categories │           │
│  │  }            │  │  }            │  │  }            │           │
│  └───────────────┘  └───────────────┘  └───────────────┘           │
│                                                                     │
│  统一访问:                                                           │
│  - store.getState()         → { user, token, items, ... }          │
│  - store.dispatch('user/login', ...)                               │
│  - store.getter('cart/totalPrice')                                 │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3.2.3 使用示例

```typescript
import { createStore, composeStore } from '@openlide/geomstore'

// 创建模块 Store
const userStore = createStore({
  name: 'user',
  state: () => ({ name: 'Alice', age: 25 }),
  actions: {
    setName(name: string) {
      this.setState('name', name)
    }
  },
  getters: {
    greeting: (state) => `Hello, ${state.name}!`
  }
})

const counterStore = createStore({
  name: 'counter',
  state: () => ({ count: 0 }),
  actions: {
    increment() {
      this.setState('count', this.state.count + 1)
    },
    add(n: number) {
      this.setState('count', this.state.count + n)
    }
  },
  getters: {
    double: (state) => state.count * 2
  }
})

// 组合 Store (命名空间模式)
// namespace: true 启用命名空间（键格式 storeName/actionName）；
// 传入字符串仅作为启用标志，实际前缀固定为各子 store 的 name
const rootStore = composeStore([userStore, counterStore], {
  namespace: true,
  strict: true
})

// 访问组合后的状态
console.log(rootStore.getState())
// { user: { name: 'Alice', age: 25 }, counter: { count: 0 } }

// 调用 Action (命名空间格式)
rootStore.dispatch('user/setName', 'Bob')
rootStore.dispatch('counter/add', 10)

// 获取 Getter
console.log(rootStore.getter('counter/double')) // 20
console.log(rootStore.getter('user/greeting')) // 'Hello, Bob!'

// 访问子 Store
console.log(rootStore.stores.user.getState())
```

#### 3.2.4 行为要点

- **命名空间多级路径**：命名空间模式下 `dispatch('store/a/b')` 这类多级路径会将首段解析为 store 名，其余段合并为 action 名（即调用 store `a` 的 action `b`），不再静默落入裸名查找而失败。
- **同名冲突提示**：裸名（不带命名空间）查找 action / getter 时，若命中多个 store 的同名定义，会打印 `console.warn` 冲突提示并取第一个 store 的定义（保持兼容）；建议启用命名空间消除歧义。
- **订阅语义**：`subscribe(listener)` 与普通 Store 保持一致——订阅时**不立即回调**，仅在子 store 状态变化时通知，避免带副作用的监听器在订阅时被意外执行。

### 3.3 选择器模块 (Selector)

#### 3.3.1 模块概述

选择器用于从状态中派生计算值，支持缓存和参数化查询。

#### 3.3.2 选择器类型

| 类型                       | 描述         | 适用场景     |
| -------------------------- | ------------ | ------------ |
| `createSelector`           | 基础选择器   | 简单状态派生 |
| `createMemoizedSelector`   | 记忆化选择器 | 高性能计算   |
| `createParametricSelector` | 参数化选择器 | 动态参数查询 |
| `createStructuredSelector` | 结构化选择器 | 多值派生     |

#### 3.3.3 使用示例

```typescript
import { createSelector, createMemoizedSelector, createParametricSelector } from '@openlide/geomstore'

// 基础选择器
const selectUserName = createSelector((state: AppState) => state.user.name)

// 记忆化选择器 (自动缓存结果；可选第二参数为自定义相等性函数)
const selectFilteredItems = createMemoizedSelector(
  (state: AppState) => state.items.filter(item => item.category === state.filter)
)

// 参数化选择器
const selectUserById = createParametricSelector(
  (state: AppState, userId: string) => state.users[userId]
)

// 使用
const store = createStore({ state: { users: { '1': { name: 'Alice' } } } })

const user = selectUserById(store.getState())('1')
console.log(user) // { name: 'Alice' }
```

参数化选择器可选第二个参数 `options`（`{ ttl?: number, maxEntries?: number }`，默认 `ttl: 5000`、`maxEntries: 1000`）：对象参数用 WeakMap 缓存；原始类型参数用 Map 缓存，写入前按 `ttl` 清理过期条目并按 `maxEntries` 淘汰最早插入的条目，防止高基数参数场景内存无限增长。

### 3.4 缓存模块 (LRU Cache)

#### 3.4.1 模块概述

LRU (最近最少使用) 缓存用于状态值缓存，提供 O(1) 时间复杂度的读写操作。

#### 3.4.2 数据结构

```
LRU Cache 数据结构:

HashMap (O(1) 查找)
┌─────────────────────────────────────────────────────────────┐
│  Key    │  Node Pointer                                      │
├─────────┼─────────────────────────────────────────────────┤
│  "a"    │  ───────────────────────┐                        │
│  "b"    │  ─────────────────────┐ │                        │
│  "c"    │  ───────────────────┐ │ │                        │
└─────────┴─────────────────────┘─┘─┘                        │
                                        │                     │
Doubly Linked List (O(1) 更新)          │                     │
                                        ▼                     │
┌─────────┐   ┌─────────┐   ┌─────────┐                     │
│  HEAD   │◄──│   "c"   │◄──│   "b"   │◄──│   "a"   │──►│  TAIL   │
│ (dummy) │──►│ newest  │──►│         │──►│ oldest  │◄──│ (dummy) │
└─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘
              
淘汰策略: 当容量满时，删除 TAIL 前的节点 (最久未使用)
```

#### 3.4.3 使用示例

```typescript
import { LRUCache } from '@openlide/geomstore'

// 创建缓存
const cache = new LRUCache<string, User>({ 
  capacity: 100,
  enableStats: true,
  onEvict: (key, value) => console.log(`Evicted: ${key}`)
})

// 基本操作
cache.set('user:1', { name: 'Alice', age: 25 })
cache.set('user:2', { name: 'Bob', age: 30 })

const user = cache.get('user:1') // { name: 'Alice', age: 25 }

// 批量操作
cache.setMany([
  ['user:3', { name: 'Charlie', age: 35 }],
  ['user:4', { name: 'Diana', age: 28 }]
])

// 获取或计算
const user5 = cache.getOrSet('user:5', () => fetchUserFromAPI(5))

// 统计信息
const stats = cache.getStats()
console.log(`Hit rate: ${stats.hitRate}%`)
console.log(`Size: ${stats.size}/${stats.capacity}`)

// 动态调整容量
cache.resize(200)
```

### 3.5 错误处理模块

#### 3.5.1 错误类体系

```
GeomStoreError (基类)
├── ActionError       # Action 执行错误
├── StateError        # 状态操作错误
├── SelectorError     # 选择器错误
├── PluginError       # 插件错误
├── ComposeError      # Store 组合错误
└── ValidationError   # 数据验证错误
```

#### 3.5.2 错误代码枚举

```typescript
enum ErrorCode {
  // Action 错误
  ACTION_NOT_FOUND = 'ACTION_NOT_FOUND',
  ACTION_EXECUTION_ERROR = 'ACTION_EXECUTION_ERROR',
  ACTION_TIMEOUT = 'ACTION_TIMEOUT',
  ACTION_CANCELLED = 'ACTION_CANCELLED',

  // State 错误
  STATE_KEY_NOT_FOUND = 'STATE_KEY_NOT_FOUND',
  STATE_UPDATE_ERROR = 'STATE_UPDATE_ERROR',
  STATE_TYPE_ERROR = 'STATE_TYPE_ERROR',

  // Selector 错误
  SELECTOR_NOT_FOUND = 'SELECTOR_NOT_FOUND',
  SELECTOR_EXECUTION_ERROR = 'SELECTOR_EXECUTION_ERROR',
  SELECTOR_CACHE_ERROR = 'SELECTOR_CACHE_ERROR',

  // Plugin 错误
  PLUGIN_NOT_FOUND = 'PLUGIN_NOT_FOUND',
  PLUGIN_INSTALLATION_ERROR = 'PLUGIN_INSTALLATION_ERROR',
  PLUGIN_EXECUTION_ERROR = 'PLUGIN_EXECUTION_ERROR',

  // Compose 错误
  STORE_NAME_CONFLICT = 'STORE_NAME_CONFLICT',
  STORE_DEPENDENCY_ERROR = 'STORE_DEPENDENCY_ERROR',
  STORE_COMPOSE_ERROR = 'STORE_COMPOSE_ERROR',

  // 验证错误
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TYPE_ERROR = 'TYPE_ERROR',
  PARAMETER_ERROR = 'PARAMETER_ERROR',

  // 通用错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
```

#### 3.5.3 使用示例

```typescript
import { 
  isGeomStoreError, 
  isActionError, 
  ErrorBoundary,
  ErrorRecovery 
} from '@openlide/geomstore'

// 基本错误处理
try {
  store.dispatch('nonExistentAction')
} catch (error) {
  if (isGeomStoreError(error)) {
    console.log(`Error code: ${error.code}`)
    console.log(`Context:`, error.context)
    console.log(`Friendly message: ${error.getFriendlyMessage()}`)
  }
}

// 错误边界
const boundary = new ErrorBoundary({
  // fallback 第二参数为当前状态（S | undefined）
  fallback: (error, currentState) => {
    console.error('Caught by boundary:', error)
    return { recovered: true }
  }
})

const result = boundary.execute(() => {
  return store.dispatch('riskyAction')
})

// 错误恢复：先创建实例，再通过 configure 按错误码配置策略
import { RecoveryStrategy, ErrorCode } from '@openlide/geomstore'

const recovery = new ErrorRecovery()
recovery.configure({
  [ErrorCode.ACTION_TIMEOUT]: {
    strategy: RecoveryStrategy.RETRY,
    maxRetries: 3,
    retryDelay: 1000,
    exponentialBackoff: true
  },
  [ErrorCode.STATE_KEY_NOT_FOUND]: {
    strategy: RecoveryStrategy.FALLBACK,
    fallback: undefined
  }
})
```

### 3.6 插件系统模块

#### 3.6.1 插件架构

```
插件系统架构:

┌─────────────────────────────────────────────────────────────────────┐
│                          Plugin System                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐          │
│  │   Logger    │     │ Persistence │     │   DevTools  │          │
│  │   Plugin    │     │   Plugin    │     │   Plugin    │          │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘          │
│         │                   │                   │                  │
│         └───────────────────┴───────────────────┘                  │
│                             │                                       │
│                             ▼                                       │
│                    ┌─────────────────┐                              │
│                    │   Hook System   │                              │
│                    │                 │                              │
│                    │  • beforeSetState                              │
│                    │  • afterSetState                               │
│                    │  • beforeDispatch                              │
│                    │  • afterDispatch                               │
│                    │  • onError                                     │
│                    │  • ...                                         │
│                    └─────────────────┘                              │
│                             │                                       │
│                             ▼                                       │
│                    ┌─────────────────┐                              │
│                    │     Store       │                              │
│                    └─────────────────┘                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3.6.2 内置插件

| 插件                                      | 功能                             | 配置选项                                         |
| ----------------------------------------- | -------------------------------- | ------------------------------------------------ |
| `loggerPlugin`                            | 状态变化日志（生产环境自动禁用） | 无                                               |
| `persistencePlugin`                       | 状态持久化                       | key, storage, filter, debounce, clearOnUninstall |
| `devtoolsPlugin`                          | 开发者工具                       | 无                                               |
| `timeTravelPlugin`                        | 时间旅行调试                     | maxSize, filter, autoRecord                      |
| `analyzerPlugin` / `createAnalyzerPlugin` | 性能分析                         | sampleRate, threshold, maxSize, trackMemory      |

#### 3.6.3 钩子列表

| 钩子名称         | 触发时机      | 参数                       |
| ---------------- | ------------- | -------------------------- |
| `beforeSetState` | 状态设置前    | (key, value)               |
| `afterSetState`  | 状态设置后    | (key, value)               |
| `beforePatch`    | 批量更新前    | (partialState)             |
| `afterPatch`     | 批量更新后    | (partialState)             |
| `beforeDispatch` | Action 执行前 | (actionName, args)         |
| `afterDispatch`  | Action 执行后 | (actionName, args, result) |
| `onError`        | 错误发生时    | (error, context)           |

#### 3.6.4 内置插件用法

```typescript
import { 
  loggerPlugin, 
  persistencePlugin, 
  devtoolsPlugin,
  timeTravelPlugin,
  createAnalyzerPlugin
} from '@openlide/geomstore'

// 日志插件
store.use(loggerPlugin)

// 持久化插件（工厂调用传入配置）
store.use(
  persistencePlugin({
    key: 'my-app-state',
    filter: (state) => ({ user: state.user }), // 只持久化部分状态
    debounce: 500, // 防抖写入
    clearOnUninstall: false // 卸载时是否清除存储（默认 false）
  }),
)

// DevTools 插件
store.use(devtoolsPlugin)

// 时间旅行插件 (调试用)
store.use(timeTravelPlugin({ maxSize: 100 }))

// 性能分析插件
store.use(
  createAnalyzerPlugin({
    threshold: 100, // 超过 100ms 标记为超阈值
    maxSize: 1000, // 最多保留的指标数
  }),
)
```

#### 3.6.5 自定义插件

```typescript
import type { Plugin } from '@openlide/geomstore'

const myPlugin: Plugin = {
  name: 'my-custom-plugin',

  install(store) {
    console.log(`Plugin installed on store: ${store.name}`)

    // 监听钩子（每个 Store 拥有独立的 hooks 实例）
    const unhook1 = store.hooks.on('beforeDispatch', (actionName) => {
      console.log(`About to dispatch: ${actionName}`)
    })

    const unhook2 = store.hooks.on('afterDispatch', (actionName, args, result) => {
      console.log(`Dispatched: ${actionName}, result:`, result)
    })

    // 订阅状态变化
    const unsubscribe = store.subscribe((state) => {
      console.log('State changed:', state)
    })

    // 返回卸载函数
    return () => {
      unhook1()
      unhook2()
      unsubscribe()
    }
  }
}

// 使用自定义插件
store.use(myPlugin)
```

### 3.7 Action 装饰器模块

#### 3.7.1 装饰器架构

```
Action 装饰器系统:

┌─────────────────────────────────────────────────────────────────────┐
│                       Action Decorators                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐ │
│  │  withLog    │  │withDebounce │  │withThrottle │  │ withCache │ │
│  │  (日志)     │  │  (防抖)     │  │  (节流)     │  │  (缓存)   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └───────────┘ │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐ │
│  │ withRetry   │  │withTimeout  │  │     createDecorator         │ │
│  │  (重试)     │  │  (超时)     │  │     (自定义装饰器)          │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────────┘ │
│                                                                     │
│                              │                                      │
│                              ▼                                      │
│                    ┌─────────────────┐                              │
│                    │  Action 执行    │                              │
│                    └─────────────────┘                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3.7.2 装饰器列表

| 装饰器            | 功能             | 工厂参数（返回 MethodDecorator）                                                   |
| ----------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `withLog`         | 日志记录         | `name?: string`                                                                    |
| `withDebounce`    | 防抖             | `delay?: number`（默认 300ms）                                                     |
| `withThrottle`    | 节流             | `interval?: number`（默认 300ms）                                                  |
| `withCache`       | 结果缓存         | `{ ttl?: number, keyFn?: Function }`（ttl 默认 5000ms）                            |
| `withRetry`       | 重试机制         | `{ retries?: number, delay?: number, shouldRetry?: Function }`（默认 3 次、100ms） |
| `withTimeout`     | 超时控制         | `timeout?: number`（默认 5000ms）                                                  |
| `createDecorator` | 创建自定义装饰器 | `{ before?, after?, onError? }`                                                    |

> 注意：这些是 **TypeScript 传统方法装饰器工厂**，需配合 `@decorator` 语法用于类方法（tsconfig 需开启 `experimentalDecorators`），不支持 `withX(fn, options)` 函数包装器写法。
>
> `withCache` 缓存键行为：默认按参数深排序后序列化生成稳定键，Symbol 参数按 `description` 区分；序列化失败（如循环引用参数）时生成唯一键跳过缓存直接执行原方法，不会因装饰器导致被装饰方法整体不可用。

#### 3.7.3 使用示例

```typescript
import { 
  withLog, 
  withDebounce, 
  withThrottle, 
  withCache, 
  withRetry, 
  withTimeout,
  createDecorator 
} from '@openlide/geomstore'

// 装饰器用于类方法（tsconfig 需开启 experimentalDecorators）
class SearchService {
  results: unknown[] = []
  attempts = 0

  // 搜索防抖：300ms 内只执行最后一次
  @withDebounce(300)
  async search(keyword: string) {
    this.results = await searchApi(keyword)
  }

  // API 缓存：5 分钟 TTL
  @withCache({ ttl: 300000 })
  async fetchUser(userId: string) {
    const res = await fetch(`/api/user/${userId}`)
    return res.json()
  }

  // 网络请求重试：最多重试 3 次，间隔 1000ms
  @withRetry({ retries: 3, delay: 1000 })
  async fetchWithRetry(url: string) {
    this.attempts++
    const res = await fetch(url)
    return res.json()
  }

  // 超时控制：10 秒超时
  @withTimeout(10000)
  async fetchData() {
    const res = await fetch('/api/data')
    return res.json()
  }
}

// 创建自定义装饰器：在方法执行前后插入逻辑
const withMetrics = createDecorator({
  before: (...args) => {
    console.log('[Metrics] action called with:', args)
  },
  after: (result) => {
    console.log('[Metrics] action completed:', result)
  },
  onError: (error) => {
    console.error('[Metrics] action failed:', error)
  }
})

class DataService {
  @withMetrics
  async loadData(id: string) {
    return await fetchData(id)
  }
}
```

### 3.8 微信小程序集成模块

#### 3.8.1 集成架构

```
微信小程序集成:

┌─────────────────────────────────────────────────────────────────────┐
│                         MiniProgram                                  │
│                                                                     │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐          │
│  │     App     │     │    Page     │     │  Component  │          │
│  │             │     │             │     │             │          │
│  │ withAppStore│     │withPageStore│     │withComponent│          │
│  │             │     │             │     │   Store     │          │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘          │
│         │                   │                   │                  │
│         └───────────────────┴───────────────────┘                  │
│                             │                                       │
│                             ▼                                       │
│                    ┌─────────────────┐                              │
│                    │      Store      │                              │
│                    │                 │                              │
│                    │  • mapState     │                              │
│                    │  • mapActions   │                              │
│                    │  • mapGetters   │                              │
│                    │  • autoInject   │                              │
│                    └─────────────────┘                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 3.8.2 Page 集成

```typescript
// pages/user/user.ts
import { createStore } from '@openlide/geomstore'
import { withPageStore } from '@openlide/geomstore/integrations'

const userStore = createStore({
  name: 'user',
  state: () => ({
    userInfo: null,
    isLoading: false
  }),
  actions: {
    async fetchUser(userId: string) {
      this.setState('isLoading', true)
      try {
        const res = await wx.request({ url: `/api/user/${userId}` })
        this.setState('userInfo', res.data)
      } finally {
        this.setState('isLoading', false)
      }
    }
  },
  getters: {
    userName: (state) => state.userInfo?.name ?? '未登录'
  }
})

// 数组形式映射
Page(withPageStore(userStore, {
  mapState: ['userInfo', 'isLoading'],
  mapGetters: ['userName'],
  mapActions: ['fetchUser']
})({
  
  data: {
    localData: '页面本地数据'
  },
  
  onLoad() {
    // this.userInfo, this.isLoading 来自 store
    // this.userName 来自 getter
    console.log(this.data.userName)
    
    // 调用 action
    this.fetchUser('123')
  }
}))

// 对象形式映射 (重命名)
Page(withPageStore(userStore, {
  mapState: {
    user: 'userInfo',      // this.data.user = store.state.userInfo
    loading: 'isLoading'   // this.data.loading = store.state.isLoading
  },
  mapGetters: {
    name: 'userName'       // this.data.name = store.getter('userName')
  },
  mapActions: {
    loadUser: 'fetchUser'  // this.loadUser() = store.dispatch('fetchUser')
  }
})({
  // 页面配置
}))
```

#### 3.8.3 Component 集成

```typescript
// components/user-card/user-card.ts
import { withComponentStore } from '@openlide/geomstore/integrations'

Component(withComponentStore(userStore, {
  mapState: ['userInfo'],
  mapGetters: ['userName'],
  mapActions: ['fetchUser']
})({
  
  properties: {
    userId: String
  },
  
  data: {
    localData: '组件本地数据'
  },
  
  methods: {
    handleTap() {
      // this.userInfo 来自 store
      // this.fetchUser 来自 action
      this.fetchUser(this.data.userId)
    }
  },
  
  lifetimes: {
    attached() {
      console.log('Component attached, user:', this.data.userName)
    }
  }
}))
```

#### 3.8.4 App 集成

```typescript
// app.ts
import { withAppStore, createApp } from '@openlide/geomstore/integrations'

const globalStore = createStore({
  name: 'global',
  state: () => ({
    systemInfo: null,
    theme: 'light'
  }),
  actions: {
    async init() {
      const info = await wx.getSystemInfo()
      this.setState('systemInfo', info)
    }
  }
})

App(withAppStore(globalStore, {
  mapState: ['systemInfo', 'theme'],
  mapActions: ['init']
})({
  
  onLaunch() {
    this.init()
  }
}))
```

---

## 4. API接口定义

### 4.1 核心接口

#### 4.1.1 Store 接口

```typescript
interface Store<
  S extends State = State,
  A extends Actions = Actions,
  G extends Getters<S> = Getters<S>
> {
  /** Store 名称 */
  readonly name: string
  
  /** 当前状态（受保护） */
  readonly state: S
  
  /** Actions 集合 */
  readonly actions: A
  
  /** Getters 定义对象（只读；提供类型推断位点，可用于调试检查） */
  readonly getters: G

  /** 实例级钩子系统（每个 Store 独立） */
  readonly hooks: IHookSystem

  /** Store 是否已销毁（销毁后调用公开方法会抛错） */
  readonly destroyed: boolean
  
  // 状态管理
  getState(): S
  setState<K extends keyof S>(key: K, value: S[K]): void
  $patch(partialState: Partial<S>): void
  $replaceState(newState: S | (() => S)): void
  
  // 快照（深拷贝并递归冻结嵌套纯对象/数组，不可变）
  $snapshot(): Readonly<S>
  $restore(snapshot: Readonly<S>): void
  
  // Action 和 Getter
  dispatch<K extends keyof A>(
    actionName: K,
    ...args: InferActionArgs<A, K>
  ): InferActionReturn<A, K>
  dispatch(actionName: string, ...args: unknown[]): unknown
  
  getter<K extends keyof G>(getterName: K): InferGetterReturn<G, K>
  getter(getterName: string): unknown

  /** 获取所有 getter 名称列表（用于 DevTools / 调试） */
  getGetterNames(): string[]
  
  // 订阅
  subscribe(listener: StateListener<S>): () => void
  
  // 批量更新
  startBatch(): void
  endBatch(): void
  batch<T>(fn: () => T): T
  
  // 插件
  use(plugin: Plugin): () => void
  
  // 缓存
  getCached<K extends keyof S>(key: K): S[K]
  enableCache(keys?: Array<keyof S>): void
  disableCache(): void
  invalidateCache<K extends keyof S>(key?: K): void
  getCacheStats(): CacheStats
  
  // 生命周期
  destroy(): void
}
```

#### 4.1.2 StoreConfig 接口（免泛型自动推导，推荐）

```typescript
interface StoreConfig<
  S = unknown,
  A = unknown,
  G = unknown
> {
  /** Store 名称 */
  name?: string
  
  /** 初始状态：字面量对象或工厂函数（state: () => ({...})，初始化时执行一次并深拷贝） */
  state?: S | (() => S)
  
  /** Actions（自动注入 this 类型） */
  actions?: ActionsWithThis<S, A>
  
  /** Getters */
  getters?: G
  
  /** 缓存配置 */
  enableCache?: boolean
  cacheKeys?: Array<keyof S>
  cacheConfig?: CacheConfig
  
  /** 状态保护配置 */
  stateProtection?: StateProtectionOptions

  /** 订阅配置（上限数量、超限策略 evict-oldest / throw） */
  subscription?: SubscriptionOptions

  /** 通知行为配置（clone 深拷贝开关、onlyOnChange 仅变更时通知） */
  notify?: NotifyOptions
}
```

#### 4.1.3 类型工具

```typescript
// 状态类型（宽松对象约束：兼容 Record 写法，也允许未声明索引签名的业务 interface）
type State = object

// Actions 类型
type Actions = Record<string, (...args: any[]) => any>

// Getters 类型
type Getters<S extends State = State> = {
  [K: string]: (state: S) => unknown
}

// 推断 Action 参数类型
type InferActionArgs<A extends Actions, K extends keyof A> = 
  A[K] extends (...args: infer Args) => unknown ? Args : never

// 推断 Action 返回类型
type InferActionReturn<A extends Actions, K extends keyof A> = 
  A[K] extends (...args: never[]) => infer R ? R : never

// 推断 Getter 返回类型
type InferGetterReturn<G extends Getters, K extends keyof G> = 
  G[K] extends (...args: never[]) => infer R ? R : never
```

### 4.2 组合接口

```typescript
interface ComposeOptions {
  /** 命名空间模式：true 启用（键格式 storeName/actionName），或传入任意字符串作为启用标志 */
  namespace?: string | boolean

  /** 延迟初始化 */
  lazy?: boolean

  /** 严格模式（访问不存在的 Store 报错） */
  strict?: boolean

  /** Store 树结构 */
  tree?: boolean
}

// 从 Store 数组推断组合状态类型
type ExtractStates<Stores extends readonly StoreLike[]> = 
  Stores extends readonly [infer First extends StoreLike, ...infer Rest extends StoreLike[]]
    ? First['state'] & ExtractStates<Rest>
    : Record<string, never>

// 从 Store 数组推断组合 Actions 类型
type ExtractActions<Stores extends readonly StoreLike[]> = 
  Stores extends readonly [infer First extends StoreLike, ...infer Rest extends StoreLike[]]
    ? First['actions'] & ExtractActions<Rest>
    : Record<string, never>

// 从 Store 数组推断组合 Getters 类型
type ExtractGetters<Stores extends readonly StoreLike[]> = 
  Stores extends readonly [infer First extends StoreLike, ...infer Rest extends StoreLike[]]
    ? First['getters'] & ExtractGetters<Rest>
    : Record<string, never>
```

### 4.3 插件接口

```typescript
interface Plugin<S extends State = State> {
  /** 插件名称 */
  name: string
  
  /** 安装函数（返回可选的卸载函数） */
  install: (store: Store) => void | (() => void)
}

// 钩子类型
type HookName = 
  | 'beforeSetState' 
  | 'afterSetState' 
  | 'beforePatch' 
  | 'afterPatch'
  | 'beforeDispatch' 
  | 'afterDispatch' 
  | 'beforeReplaceState'
  | 'afterReplaceState'
  | 'onError'

// 类型层面为宽松的 (...args: unknown[]) => void；以下为常用钩子的推荐参数签名
type HookHandler<H extends HookName> = H extends 'beforeSetState' | 'afterSetState'
  ? (key: string, value: unknown) => void
  : H extends 'beforePatch' | 'afterPatch'
  ? (partialState: unknown) => void
  : H extends 'beforeDispatch'
  ? (actionName: string, args: unknown[]) => void
  : H extends 'afterDispatch'
  ? (actionName: string, args: unknown[], result: unknown) => void
  : H extends 'onError'
  ? (error: Error, context?: string) => void
  : (...args: unknown[]) => void
```

### 4.4 集成接口

```typescript
interface ConnectOptions<
  S extends State = State,
  A extends Actions = Actions,
  G extends Getters<S> = Getters<S>
> {
  /** 状态映射（对象形式值须为状态键） */
  mapState?: Array<keyof S> | Record<string, keyof S>
  
  /** Getter 映射（键/值须为 getter 名，拼错编译报错） */
  mapGetters?: Array<keyof G> | Record<string, keyof G>
  
  /** Action 映射（对象形式值须为 action 名） */
  mapActions?: Array<keyof A> | Record<string, keyof A>
  
  /** 自动注入配置 */
  autoInject?: boolean
  injectMapping?: Record<string, string>
  
  /** 页面显示时自动更新 */
  autoUpdateOnShow?: boolean
}
```

> 类型推断：`withPageStore` / `withComponentStore` / `withAppStore` 的 `S` / `A` / `G` 均从 store 参数自动推断（依赖 `store.getters` 提供的 G 属性级推断位点），`O` 保留 options 字面量类型用于精确推导；三组映射的键与值拼错时编译期报错；装饰器返回类型重写所有方法的 `this` 为 `PageThis` / `ComponentThis`，使方法内 `this.data` / `this.xxx` 自动获得精确类型推导（含 data、actions、自定义方法），无需手动声明泛型参数。

---

## 5. 部署流程

### 5.1 环境要求

| 环境              | 版本要求      |
| ----------------- | ------------- |
| Node.js           | ≥ 22.0.0      |
| npm / pnpm / yarn | 最新稳定版    |
| TypeScript        | 6.0+ (开发时) |
| 微信小程序基础库  | ≥ 2.10.0      |

### 5.2 安装方式

#### 5.2.1 npm 安装

```bash
# npm
npm install @openlide/geomstore

# pnpm
pnpm add @openlide/geomstore

# yarn
yarn add @openlide/geomstore
```

#### 5.2.2 微信小程序 npm 构建

1. 在小程序项目根目录安装依赖：

```bash
npm install @openlide/geomstore
```

2. 在微信开发者工具中构建 npm：

```
工具 → 构建 npm
```

3. 构建完成后在代码中引用：

```typescript
import { createStore } from 'miniprogram_npm/geomstore'
```

### 5.3 构建配置

#### 5.3.1 TypeScript 配置

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["miniprogram-api-typings", "node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

#### 5.3.2 package.json 配置

```json
{
  "name": "@openlide/geomstore",
  "version": "0.2.0",
  "main": "dist/cjs/index.js",
  "types": "dist/cjs/index.d.ts",
  "files": ["dist", "CHANGELOG.md", "store", "hooks", "plugins", "integrations", "error", "compose", "selectors", "snapshot", "performance", "actions", "cache"],
  "scripts": {
    "build": "tsc -p tsconfig.cjs.json && node scripts/postbuild-dist.cjs",
    "test": "jest",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --coverage --maxWorkers=2",
    "lint": "eslint src tests --ext .ts",
    "typecheck": "tsc --noEmit -p tsconfig.typecheck.json"
  },
  "engines": {
    "node": ">=22.0.0"
  },
  "devDependencies": {
    "typescript": "^6.0.3"
  }
}
```

### 5.4 构建命令

```bash
# 编译 TypeScript
npm run build

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 运行测试
npm test

# 测试覆盖率
npm run test:coverage
```

### 5.5 CI/CD 配置示例

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Type check
        run: npm run typecheck
      
      - name: Lint
        run: npm run lint
      
      - name: Test
        run: npm run test:ci
      
      - name: Build
        run: npm run build
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
```

---

## 6. 用户指南

### 6.1 快速开始

#### 6.1.1 创建第一个 Store

```typescript
// store/counter.ts
import { createStore } from '@openlide/geomstore'

interface CounterState {
  count: number
  history: number[]
}

interface CounterActions {
  increment: () => void
  decrement: () => void
  add: (n: number) => void
  reset: () => void
}

interface CounterGetters {
  double: (state: CounterState) => number
  historyLength: (state: CounterState) => number
}

export const counterStore = createStore<CounterState, CounterActions, CounterGetters>({
  name: 'counter',
  
  state: () => ({
    count: 0,
    history: []
  }),
  
  actions: {
    increment() {
      this.setState('count', this.state.count + 1)
      this.state.history.push(this.state.count)
    },
    
    decrement() {
      this.setState('count', this.state.count - 1)
      this.state.history.push(this.state.count)
    },
    
    add(n) {
      this.setState('count', this.state.count + n)
      this.state.history.push(this.state.count)
    },
    
    reset() {
      this.$patch({ count: 0, history: [] })
    }
  },
  
  getters: {
    double: (state) => state.count * 2,
    historyLength: (state) => state.history.length
  }
})
```

#### 6.1.2 在 Page 中使用

```typescript
// pages/index/index.ts
import { withPageStore } from '@openlide/geomstore/integrations'
import { counterStore } from '../../store/counter'

Page(withPageStore(counterStore, {
  mapState: ['count', 'history'],
  mapGetters: ['double'],
  mapActions: ['increment', 'decrement', 'reset']
})({
  
  data: {
    pageTitle: '计数器'
  },
  
  onLoad() {
    console.log('Current count:', this.data.count)
    console.log('Double:', this.data.double)
  },
  
  handleIncrement() {
    this.increment()
  },
  
  handleDecrement() {
    this.decrement()
  },
  
  handleReset() {
    this.reset()
  }
}))
```

### 6.2 最佳实践

#### 6.2.1 状态设计原则

```typescript
// ✅ 推荐：扁平化状态结构
interface GoodState {
  users: Record<string, User>
  currentUserId: string | null
  loading: boolean
  error: string | null
}

// ❌ 避免：深层嵌套状态
interface BadState {
  data: {
    users: {
      list: {
        items: User[]
      }
    }
  }
}
```

#### 6.2.2 Action 设计原则

```typescript
// ✅ 推荐：单一职责
const store = createStore({
  actions: {
    fetchUser(userId) {
      // 只负责获取用户
    },
    updateUser(userData) {
      // 只负责更新用户
    },
    deleteUser(userId) {
      // 只负责删除用户
    }
  }
})

// ❌ 避免：过于复杂的 Action
const store = createStore({
  actions: {
    async doEverything(userId, userData) {
      // 获取、更新、删除、通知... 太复杂
    }
  }
})
```

#### 6.2.3 使用批量更新优化性能

```typescript
// ✅ 推荐：使用 store.batch 批量更新减少通知次数
const store = createStore({
  state: () => ({ a: 1, b: 2, c: 3 }),
  actions: {
    updateAll() {
      this.setState('a', 10)
      this.setState('b', 20)
      this.setState('c', 30)
    }
  }
})

// batch 是 Store 级 API（action 内部没有 this.batch）
store.batch(() => {
  store.dispatch('updateAll') // 或直接多次 store.setState
}) // 只触发一次通知

// ❌ 避免：不经 batch 的多次单独更新
store.setState('a', 10)  // 触发通知
store.setState('b', 20)  // 触发通知
store.setState('c', 30)  // 触发通知
```

#### 6.2.4 使用选择器缓存计算结果

```typescript
import { createMemoizedSelector } from '@openlide/geomstore'

// ✅ 推荐：使用记忆化选择器（复杂计算在单个选择器函数内完成，结果会被缓存）
const selectExpensiveValue = createMemoizedSelector(
  (state: State) => {
    // 复杂计算，结果会被缓存
    return state.items.filter(/* ... */).map(/* ... */).reduce(/* ... */)
  }
)

// 在 getter 中使用
const store = createStore({
  getters: {
    expensiveValue: (state) => selectExpensiveValue(state)
  }
})
```

### 6.3 常见问题解答

#### Q1: 如何处理异步 Action？

```typescript
const store = createStore({
  state: () => ({
    data: null,
    loading: false,
    error: null
  }),
  
  actions: {
    async fetchData(id: string) {
      this.setState('loading', true)
      this.setState('error', null)
      
      try {
        const response = await fetch(`/api/data/${id}`)
        const data = await response.json()
        this.setState('data', data)
      } catch (error) {
        this.setState('error', error.message)
      } finally {
        this.setState('loading', false)
      }
    }
  }
})
```

#### Q2: 如何实现状态持久化？

```typescript
import { persistencePlugin } from '@openlide/geomstore'

const store = createStore({
  name: 'user-preferences',
  state: () => ({
    theme: 'light',
    language: 'zh-CN'
  })
})

// 使用持久化插件（工厂调用传入配置）
store.use(
  persistencePlugin({
    key: 'app-preferences',
    filter: (state) => ({ theme: state.theme }) // 只持久化部分状态
  }),
)
// storage 省略时自动检测 wx 同步存储；不可用时降级为内存存储（开发模式告警）
// 恢复采用 $patch 合并语义：未持久化的键（如 language）保留初始值
```

#### Q3: 如何调试状态变化？

```typescript
import { devtoolsPlugin, loggerPlugin, timeTravelPlugin } from '@openlide/geomstore'

// 开发环境启用调试工具
if (process.env.NODE_ENV === 'development') {
  store.use(loggerPlugin)
  store.use(devtoolsPlugin)
  store.use(timeTravelPlugin({ maxSize: 50 }))
}

// 在控制台访问
// globalThis.__GEOMSTORE_STORES__["store-name"]
// globalThis.__GEOMSTORE_DEVTOOLS__["store-name"]
```

#### Q4: 如何在组件间共享 Store？

```typescript
// store/index.ts - 创建全局 Store
import { createStore } from '@openlide/geomstore'

export const globalStore = createStore({
  name: 'global',
  state: () => ({ /* ... */ })
})

// 在不同页面/组件中导入使用
// pages/page-a.ts
import { globalStore } from '../../store'
Page(withPageStore(globalStore, { /* ... */ })({ /* 页面配置 */ }))

// components/comp-b.ts
import { globalStore } from '../../store'
Component(withComponentStore(globalStore, { /* ... */ })({ /* 组件配置 */ }))
```

---

## 7. 性能基准

### 7.1 基准测试结果

```
GeomStore v0.2.0 性能基准测试
==============================

测试环境:
  - Node.js: v22.14.0
  - Platform: win32
  - CPU: Intel i7-12700K
  - Memory: 32GB

测试结果:

1. Store 创建性能
   - 创建空 Store: ~0.05ms
   - 创建带状态的 Store: ~0.15ms
   - 创建带 Actions 的 Store: ~0.25ms

2. 状态操作性能
   - setState (单次): ~0.001ms
   - $patch (批量): ~0.01ms
   - getState: ~0.0001ms

3. 订阅性能
   - subscribe: ~0.005ms
   - 通知单个监听器: ~0.01ms
   - 通知 100 个监听器: ~0.5ms

4. 缓存性能
   - LRU Cache get (命中): ~0.0005ms
   - LRU Cache set: ~0.001ms
   - 缓存命中率: >95%

5. 内存占用
   - 空 Store: ~2KB
   - 带状态的 Store: ~3KB + 状态大小
   - LRU Cache (100项): ~10KB
```

### 7.2 与其他库对比

| 操作       | GeomStore | Redux  | Vuex    | MobX    |
| ---------- | --------- | ------ | ------- | ------- |
| 创建 Store | 0.15ms    | 0.3ms  | 0.25ms  | 0.2ms   |
| dispatch   | 0.02ms    | 0.05ms | 0.04ms  | 0.03ms  |
| subscribe  | 0.005ms   | 0.01ms | 0.008ms | 0.006ms |
| 内存占用   | 低        | 中     | 中      | 低      |

---

## 8. 故障排查

### 8.1 常见错误及解决方案

#### 错误 1: Action not found

```
错误信息: Action "xxx" not found in store "yyy"
```

**原因**: 尝试调用不存在的 Action

**解决方案**:
```typescript
// 检查 Action 是否正确定义
const store = createStore({
  actions: {
    fetchUser() { /* ... */ }
  }
})

// 正确调用
store.dispatch('fetchUser')  // ✅

// 错误调用
store.dispatch('fetchUsers') // ❌ 拼写错误
```

#### 错误 2: State mutation outside action

```
错误信息: [GeomStore] Direct mutation of state "xxx" is prohibited.
          Use setState() or $patch() methods instead.
          Operation: set
          Attempted value: ...
```

> 生产模式下若 `stateProtection.productionHandler` 配置为 `'warn'` / `'silent'`，则仅告警或放行而不抛错。

**原因**: 在 Action 外部直接修改状态

**解决方案**:
```typescript
// ❌ 错误：直接修改
store.state.count = 10

// ✅ 正确：通过 Action 修改
store.dispatch('setCount', 10)

// 或使用 setState (仅在 Action 内部可用)
actions: {
  setCount(n) {
    this.setState('count', n)
  }
}
```

#### 错误 3: Maximum call stack size exceeded

```
错误信息: RangeError: Maximum call stack size exceeded
```

**原因**: 循环依赖或递归调用

**解决方案**:
```typescript
// ❌ 错误：Action 循环调用
actions: {
  actionA() {
    this.actionB()  // A -> B
  },
  actionB() {
    this.actionA()  // B -> A (循环)
  }
}

// ✅ 正确：避免循环调用
actions: {
  actionA() {
    // 直接执行逻辑，不调用 actionB
  },
  actionB() {
    // 直接执行逻辑，不调用 actionA
  }
}
```

### 8.2 调试技巧

#### 8.2.1 使用 DevTools

```typescript
// 启用 DevTools 插件
store.use(devtoolsPlugin)

// 在控制台访问
const storeInstance = globalThis.__GEOMSTORE_STORES__["your-store-name"]

// 查看当前状态
storeInstance.getState()

// 执行 Action
storeInstance.dispatch('actionName', arg1, arg2)

// 查看可用 Actions
Object.keys(storeInstance.actions)
```

#### 8.2.2 使用 Logger 插件

```typescript
// 启用日志插件
store.use(loggerPlugin)

// 所有状态变化都会输出到控制台
// [GeomStore] State changed: { count: 1 }
// [GeomStore] Setting state: count => 2
// [GeomStore] Dispatching action: increment []
```

#### 8.2.3 状态快照对比

```typescript
// 保存快照
const snapshot1 = store.$snapshot()

// 执行一些操作
store.dispatch('someAction')

// 保存新快照
const snapshot2 = store.$snapshot()

// 对比状态变化
console.log('Before:', snapshot1)
console.log('After:', snapshot2)
```

---

## 附录

### A. 完整 API 列表

| API                                       | 描述             |
| ----------------------------------------- | ---------------- |
| `createStore(options)`                    | 创建 Store 实例  |
| `composeStore(stores, options)`           | 组合多个 Store   |
| `createSelector(fn)`                      | 创建基础选择器   |
| `createMemoizedSelector(fn, equalityFn?)` | 创建记忆化选择器 |
| `createParametricSelector(fn)`            | 创建参数化选择器 |
| `LRUCache`                                | LRU 缓存类       |
| `withPageStore(store, options)`           | Page 集成        |
| `withComponentStore(store, options)`      | Component 集成   |
| `withAppStore(store, options)`            | App 集成         |
| `loggerPlugin`                            | 日志插件         |
| `persistencePlugin`                       | 持久化插件       |
| `devtoolsPlugin`                          | DevTools 插件    |
| `timeTravelPlugin`                        | 时间旅行插件     |
| `analyzerPlugin`                          | 性能分析插件     |

### B. 版本历史

| 版本  | 日期       | 变更                                                  |
| ----- | ---------- | ----------------------------------------------------- |
| 0.1.0 | 2026-08-17 | 初始版本发布                                          |
| 0.1.1 | 2026-08-19 | Round-2 全量源码审阅修复（16 项）+ typecheck 0 errors |
| 0.1.2 | 2026-08-20 | 文档全面审阅对齐源码、导入统一 NPM 包路径、CJS 单产物 / 14 子路径导出 |
| 0.1.3 | 2026-08-22 | 契约变更（StorageBackend 同步收窄、ErrorFallback 泛型反转、clone mode 重构等）+ 全量审查修复约 50 项 |
| 0.2.0 | 2026-08-22 | 全量审查第二轮修复：订阅引用计数、快照数组 diff 与克隆契约、错误系统映射、企业版存储尽力而为语义等约 25 项 |

### C. 参与贡献

欢迎提交 Issue 和 Pull Request：

- GitHub: https://github.com/openlide/GeomStore
- Issues: https://github.com/openlide/GeomStore/issues

---

**GeomStore v0.2.0** - 轻量级微信小程序状态管理库

Copyright (c) 2026 GeomStore Team. Licensed under MIT.
