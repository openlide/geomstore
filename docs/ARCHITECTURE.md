# GeomStore 架构设计文档

本文档详细描述 GeomStore 的系统架构、模块设计和实现细节。

---

## 目录

1. [整体架构](#整体架构)
2. [核心模块](#核心模块)
3. [数据流设计](#数据流设计)
4. [插件架构](#插件架构)
5. [集成层设计](#集成层设计)
6. [错误处理架构](#错误处理架构)
7. [性能监控架构](#性能监控架构)

---

## 整体架构

### 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
│                    (应用层 - 用户代码)                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Integration Layer                        │   │
│  │              (集成层)                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │withPageStore│  │withComponent│  │withAppStore │  │   │
│  │  │             │  │   Store     │  │             │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │               Core Layer (核心层 · 始终打包)           │   │
│  │  Store · Compose · Cache(LRU) · Error · Hooks · Integration  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │    Optional Layer (可选能力层 · 经 /extras/* 引入)      │   │
│  │  Selector · Snapshot · Performance · Action增强 · Plugins · Enterprise │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Foundation Layer (基础层)                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │   Types     │  │   Utils     │  │   Hooks     │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 目录结构

```
src/
├── index.ts                 # 瘦核心入口：export * from './core'（仅核心 API）
├── core/                    # 核心实现（始终随主入口打包）
│   ├── index.ts             # 仅导出运行必需 API
│   ├── store/               # Store 类与工厂
│   │   ├── Store.ts
│   │   ├── factory.ts
│   │   ├── ActionManager.ts
│   │   ├── BatchManager.ts
│   │   ├── StateProxy.ts
│   │   ├── StoreCache.ts
│   │   ├── SubscriptionManager.ts
│   │   ├── types.ts
│   │   ├── utils.ts
│   │   └── index.ts
│   ├── hooks/               # 插件钩子核心（HookSystem / usePlugin）
│   │   ├── HookSystem.ts
│   │   └── index.ts
│   ├── cache/               # LRU 缓存
│   │   ├── LRUCache.ts
│   │   └── index.ts
│   ├── utils/               # 工具函数
│   │   ├── helpers.ts
│   │   └── index.ts
│   ├── compose/             # Store 组合
│   │   ├── composeStore.ts
│   │   ├── StoreRegistry.ts
│   │   └── index.ts
│   ├── selector/            # 选择器实现（源码在 core，经 extras/selector 引入）
│   │   ├── createSelector.ts
│   │   ├── selectorComposer.ts
│   │   └── index.ts
│   ├── snapshot/            # 快照实现（经 extras/snapshot 引入）
│   │   ├── SnapshotManager.ts
│   │   └── index.ts
│   ├── performance/         # 性能监控实现（经 extras/performance 引入）
│   │   ├── PerformanceMonitor.ts
│   │   ├── Optimizations.ts
│   │   ├── metrics.ts
│   │   └── index.ts
│   └── action/              # Action 增强实现（经 extras/action 引入）
│       ├── ActionLoader.ts
│       ├── ActionUtils.ts
│       ├── AsyncActionSupport.ts
│       ├── decorators/
│       └── index.ts
├── plugins/                 # 插件实现（经 extras/plugins 引入）
│   ├── builtin.ts           # loggerPlugin / persistencePlugin / devtoolsPlugin
│   ├── devtools/
│   │   ├── timeTravelPlugin.ts
│   │   └── index.ts
│   └── performance/
│       ├── analyzerPlugin.ts
│       └── index.ts
├── integrations/            # 集成层
│   ├── with-store.ts        # withPageStore / withComponentStore（核心）
│   ├── with-app-store.ts    # withAppStore（核心）
│   ├── utils.ts
│   └── enterprise/          # 企业微信集成（经 extras/enterprise 引入）
│       ├── wechat-enterprise.ts
│       └── index.ts
├── extras/                  # 可选能力聚合与子入口
│   ├── index.ts             # 一次性引入全部可选能力
│   ├── error.ts             # → ../extras/error（v0.4.0 起从核心下沉）
│   ├── snapshot.ts          # → ../core/snapshot
│   ├── selector.ts          # → ../core/selector
│   ├── performance.ts       # → ../core/performance
│   ├── action.ts            # → ../core/action
│   ├── plugins.ts           # → ../plugins
│   └── enterprise.ts        # → ../integrations/enterprise
└── types/                   # 类型定义
    ├── store.ts
    ├── action.ts
    ├── compose.ts
    ├── error.ts
    ├── integration.ts
    ├── performance.ts
    ├── persistence.ts
    ├── selector.ts
    ├── plugin.ts
    ├── global.ts
    └── index.ts
```

---

## 核心模块

> 注：下文中的「选择器 / 快照 / 性能监控 / Action 增强 / 插件 / 企业微信集成 / 错误处理」等模块**不属于主入口自动导出的核心 API**，其源码位于 `src/core` 或 `src/plugins` / `src/integrations` / `src/extras`，但仅通过 `@openlide/geomstore/extras/*` 子路径按需引入（详见上方目录结构）。核心 API 仅包含 Store、小程序集成、组合、LRU 缓存与工具函数；错误处理位于 `src/extras/error`，通过 `@openlide/geomstore/extras/error` 引入。

### Store 模块

Store 是整个架构的核心，负责状态管理：

```typescript
// src/core/store/Store.ts（模块化重构版）

class Store<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> implements StoreInterface<S, A, G> {
  // ==================== 核心属性 ====================

  readonly name: string
  private _state!: S
  public actions!: A

  // ==================== 子模块实例 ====================

  private _proxyCache: ProxyCache
  private _stateProxyManager: StateProxyManager<S>
  private _subscriptionManager: SubscriptionManager<S>
  private _cacheManager: StoreCacheManager<S>
  private _actionManager: ActionManager<S, A>
  private _getterManager: GetterManager<S, G>
  private _batchManager: BatchManager
  public readonly hooks: HookSystem          // 实例级钩子系统

  // ==================== 公开API ====================

  get state(): S                              // 只读 getter（受保护Proxy）
  getState(): S                                // 获取原始状态引用（⚠️ 内部使用）
  setState<K extends keyof S>(key, value): void
  $patch(partialState: Partial<S>): void
  $replaceState(newState: S): void
  $snapshot(): Readonly<S>
  $restore(snapshot: Readonly<S>): void

  dispatch<K extends keyof A>(...args): unknown
  getter<K extends keyof G>(): unknown
  get getters(): G                          // getter 集合（直接访问派生值）
  getGetterNames(): string[]
  subscribe(listener): () => void
  use<T extends PluginType>(plugin): () => void
  batch<T>(fn): T
  startBatch(): void
  endBatch(): void
  destroy(): void
  get destroyed(): boolean
}
```

### LRU 缓存模块

提供高效的缓存实现：

```typescript
// src/core/cache/LRUCache.ts

class LRUCache<K, V> {
  // ==================== 核心属性 ====================

  /** 缓存容量 */
  private capacity: number

  /** 缓存存储 (Map 提供 O(1) 查找) */
  private cache: Map<K, LRUNode<K, V>>

  /** 双向链表头节点 */
  private head: LRUNode<K, V>

  /** 双向链表尾节点 */
  private tail: LRUNode<K, V>

  /** 当前大小 */
  private _size: number

  // ==================== 统计数据 ====================

  /** 命中次数 */
  private hitCount: number

  /** 未命中次数 */
  private missCount: number

  /** 淘汰次数 */
  private evictionCount: number

  // ==================== 核心方法 ====================

  /** 获取缓存值 */
  get(key: K): V | undefined

  /** 设置缓存值 */
  set(key: K, value: V): this

  /** 检查是否存在 */
  has(key: K): boolean

  /** 查看值（不更新顺序） */
  peek(key: K): V | undefined

  /** 删除缓存 */
  delete(key: K): boolean

  /** 清空缓存 */
  clear(): this

  /** 获取统计信息 */
  getStats(): LRUCacheStats
}
```

### 错误处理模块

完整的错误处理体系：

```
┌─────────────────────────────────────────────────────────┐
│                   Error Handling                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────┐    ┌─────────────────┐            │
│  │ Error Monitoring│◄───│ Error Aggregator│            │
│  │                 │    │                 │            │
│  └────────┬────────┘    └─────────────────┘            │
│           │                                             │
│           ▼                                             │
│  ┌─────────────────┐    ┌─────────────────┐            │
│  │ Error Reporters │    │ Error Boundary  │            │
│  │ ┌─────┐ ┌─────┐ │    │                 │            │
│  │ │Cons.│ │HTTP │ │    └─────────────────┘            │
│  │ └─────┘ └─────┘ │                                    │
│  └─────────────────┘    ┌─────────────────┐            │
│                         │ Error Recovery  │            │
│                         │ ┌─────┐ ┌─────┐ │            │
│                         │ │Retry│ │Fallb│ │            │
│                         │ └─────┘ └─────┘ │            │
│                         └─────────────────┘            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Action 装饰器模块

Action 装饰器系统用于增强 Action 的行为：

```
┌─────────────────────────────────────────────────────────┐
│                   Action Decorators                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────────┐│
│  │                  Built-in Decorators                ││
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐        ││
│  │  │ withLog   │ │withDebounce│ │withThrottle│        ││
│  │  └───────────┘ └───────────┘ └───────────┘        ││
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐        ││
│  │  │ withCache │ │ withRetry │ │withTimeout│        ││
│  │  └───────────┘ └───────────┘ └───────────┘        ││
│  └─────────────────────────────────────────────────────┘│
│                         │                               │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────────┐│
│  │                 createDecorator                     ││
│  │              (自定义装饰器工厂)                      ││
│  └─────────────────────────────────────────────────────┘│
│                         │                               │
│                         ▼                               │
│  ┌─────────────────────────────────────────────────────┐│
│  │                   Action 执行                        ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**装饰器组合示例：**

```typescript
// 多个装饰器可以叠加在同一个类方法上（需开启 experimentalDecorators）
class DataService {
  data: unknown = null

  // 重试 + 超时
  @withRetry({ retries: 3, delay: 1000 })
  @withTimeout(5000)
  async safeFetch(url: string) {
    this.data = await fetchData(url)
  }
}
```

---

## 数据流设计

### 单向数据流

GeomStore 采用单向数据流设计：

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│     ┌──────────┐      ┌──────────┐      ┌──────────┐   │
│     │   View   │─────►│  Action  │─────►│   Store  │   │
│     │  (UI)    │      │          │      │  (State) │   │
│     └──────────┘      └──────────┘      └──────────┘   │
│          ▲                                     │        │
│          │                                     │        │
│          │              ┌──────────┐          │        │
│          └──────────────│  Update  │◄─────────┘        │
│                         │ (Notify) │                   │
│                         └──────────┘                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Action 执行流程

```
dispatch(actionName, payload)
        │
        ▼
┌───────────────────┐
│  查找 Action       │
│  store.actions    │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  执行前置钩子      │
│  hooks.emit       │
│  'beforeDispatch' │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  执行 Action       │
│  action.call(ctx, │
│    ...args)       │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  状态变化         │
│  state 检测变更    │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  执行后置钩子      │
│  hooks.emit       │
│  'afterDispatch'  │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  通知订阅者        │
│ notifyListeners() │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│  触发 UI 更新      │
│  setData()        │
└───────────────────┘
```

---

## 插件架构

### 插件接口

```typescript
interface Plugin {
  /** 插件名称 */
  name: string

  /** 安装函数 */
  install: (store: Store) => void | (() => void)
}
```

### 钩子系统

```typescript
type HookName =
  | 'beforeSetState'    // setState 前
  | 'afterSetState'     // setState 后
  | 'beforePatch'       // $patch 前
  | 'afterPatch'        // $patch 后
  | 'beforeDispatch'    // dispatch 前
  | 'afterDispatch'     // dispatch 后
  | 'beforeReplaceState' // $replaceState 前
  | 'afterReplaceState'  // $replaceState 后
  | 'onError'           // 错误发生时

class HookSystem {
  /** 注册钩子 */
  on(name: HookName, handler: HookHandler): () => void

  /** 触发钩子（内部先快照 handler 列表，迭代期间取消订阅不影响当前触发） */
  emit(name: HookName, ...args: unknown[]): unknown

  /** 清除钩子 */
  clear(name?: HookName): void
}
```

### 插件执行流程

```
┌─────────────────────────────────────────────────────────┐
│                     Plugin System                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                 Hook System                      │   │
│  │                                                 │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐        │   │
│  │  │ before* │  │ after*  │  │ onError │        │   │
│  │  └─────────┘  └─────────┘  └─────────┘        │   │
│  └─────────────────────────────────────────────────┘   │
│                         │                              │
│                         ▼                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │               Plugin Manager                     │   │
│  │                                                 │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │   │
│  │  │Plugin A│ │Plugin B│ │Plugin C│ │Plugin D│   │   │
│  │  │        │ │        │ │        │ │        │   │   │
│  │  │install │ │install │ │install │ │install │   │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘   │   │
│  │                                                 │   │
│  │  按安装顺序执行                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 集成层设计

### 页面集成

```typescript
// withPageStore 实现
function withPageStore<S extends State, A extends Actions, G extends Getters, O extends ConnectOptions<S, A, G>>(
  store: Store<S, A, G>,
  options: O
) {
  return function<C extends PageOptions>(
    // WithPageThis 是同态映射类型，作为入参类型为 C 提供推断位点：
    // 配置字面量（含自定义方法 / data）反向推断出 C，返回类型据此保留精确成员
    PageConfig: WithPageThis<C, PageThis<S, A, G, O>> & { data: object } & ThisType<PageThis<S, A, G, O>>
  ): PageThis<S, A, G, O, PageOwnMethods<C>> & Omit<C, 'data'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> } {
    const enhancedConfig = { ...PageConfig }

    // 扩展 onLoad：bindMappings 绑定映射（对象值免脏检查、过滤 undefined）并订阅状态变化
    enhancedConfig.onLoad = function(this: any, ...args) {
      // 订阅状态变化
      store.subscribe((state) => {
        this.setData(extractMappedState(state, options.mapState))
        this.setData(extractMappedGetters(store, options.mapGetters))
      })

      // 调用原始 onLoad
      PageConfig.onLoad?.apply(this, args)
    }

    // 注入映射的 actions 到实例
    for (const [localName, actionName] of Object.entries(options.mapActions || {})) {
      enhancedConfig[localName] = (...args) => store.dispatch(actionName, ...args)
    }

    // 方法 this 由同态映射 + ThisType 在编译期注入为 PageThis（自定义方法保留自身精确 this）
    return enhancedConfig as any
  }
}
```

### 组件集成

```typescript
// withComponentStore 实现
function withComponentStore<S extends State, A extends Actions, G extends Getters, O extends ConnectOptions<S, A, G>>(
  store: Store<S, A, G>,
  options: O
) {
  return function<C extends ComponentOptions>(ComponentConfig: C): ComponentThis<S, A, G, O, ComponentOwnMethods<C>> & Omit<C, 'data' | 'methods'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> } {
    const enhancedConfig = { ...ComponentConfig }
    const boundMethods = createMappedActions(store, options.mapActions)

    // 配置级 methods 合并映射的 actions
    enhancedConfig.methods = { ...ComponentConfig.methods, ...boundMethods }

    // 扩展 lifetimes.attached：绑定映射、实例级合并 methods
    enhancedConfig.lifetimes = {
      ...ComponentConfig.lifetimes,
      attached() {
        // 订阅清理列表挂在组件实例上（同一配置可能存在多个实例，如列表项组件）
        this.__geomUnbinds = []

        // 实例级浅拷贝后再合并：this.methods 可能引用配置级共享对象，
        // 直接写入会污染所有实例共用的 methods 定义
        if (this.methods) {
          this.methods = { ...this.methods, ...boundMethods }
        }

        // bindMappings 绑定 state / getters（对象值免脏检查、过滤 undefined）
        this.__geomUnbinds.push(...bindStateAndGetters(this, store, options))

        ComponentConfig.lifetimes?.attached?.call(this)
      },
      detached() {
        // 清理当前实例的订阅
        cleanupBindings(this.__geomUnbinds || [])
        // 实例级拷贝后再删除绑定的 action 方法，避免误删共享 methods 上其他实例仍在用的成员
        if (this.methods) {
          this.methods = { ...this.methods }
          Object.keys(actionsMapping).forEach((localName) => delete this.methods[localName])
        }
        ComponentConfig.lifetimes?.detached?.call(this)
      }
    }

    // 方法 this 由 ComponentThis 在编译期注入
    return enhancedConfig as any
  }
}
```

---

## 错误处理架构

### 错误分类

```typescript
enum ErrorCode {
  // Action 错误
  ACTION_NOT_FOUND = 'ACTION_NOT_FOUND',
  ACTION_EXECUTION_ERROR = 'ACTION_EXECUTION_ERROR',
  ACTION_TIMEOUT = 'ACTION_TIMEOUT',
  ACTION_CANCELLED = 'ACTION_CANCELLED',

  // 状态错误
  STATE_KEY_NOT_FOUND = 'STATE_KEY_NOT_FOUND',
  STATE_UPDATE_ERROR = 'STATE_UPDATE_ERROR',
  STATE_TYPE_ERROR = 'STATE_TYPE_ERROR',

  // 选择器错误
  SELECTOR_NOT_FOUND = 'SELECTOR_NOT_FOUND',
  SELECTOR_EXECUTION_ERROR = 'SELECTOR_EXECUTION_ERROR',
  SELECTOR_CACHE_ERROR = 'SELECTOR_CACHE_ERROR',

  // 插件错误
  PLUGIN_NOT_FOUND = 'PLUGIN_NOT_FOUND',
  PLUGIN_INSTALLATION_ERROR = 'PLUGIN_INSTALLATION_ERROR',
  PLUGIN_EXECUTION_ERROR = 'PLUGIN_EXECUTION_ERROR',

  // 组合错误
  STORE_NAME_CONFLICT = 'STORE_NAME_CONFLICT',
  STORE_DEPENDENCY_ERROR = 'STORE_DEPENDENCY_ERROR',
  STORE_COMPOSE_ERROR = 'STORE_COMPOSE_ERROR',

  // 验证错误
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TYPE_ERROR = 'TYPE_ERROR',
  PARAMETER_ERROR = 'PARAMETER_ERROR',

  // 通用错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}
```

### 错误恢复策略

```typescript
enum RecoveryStrategy {
  RETRY = 'retry',       // 重试
  FALLBACK = 'fallback', // 回退
  IGNORE = 'ignore',     // 忽略
  RESTART = 'restart',   // 重启
  RECOVER = 'recover'    // 恢复
}
```

**关键行为语义：**

- `RETRY` 的重试额度按**故障周期**计量，周期以时间窗判定（窗口 = `max(60s, 本周期全部退避总时长 × 2)`）：窗口内额度持续累计（与错误实例身份无关，`maxRetries` 防重试风暴保护始终生效），超窗视为新周期重置额度；达到上限仅清除当前键（`code:storeName:operation`），不按错误码级联全清。`recover` 仅接受 `GeomStoreError` 实例。
- `HttpReporter.report / reportBatch` 失败时**向上抛出**（内部批量管线兜底重入队）；默认请求实现校验 `response.ok`，4xx/5xx 视为上报失败。
- 批量 flush 按 `ok / fail / timeout` 三态判定，仅 resolve 算成功；超时不算成功，批次重入队等待下次 flush。
- `ErrorBoundary` 的 `fallback` 计算函数自身抛错时，记录后**重抛原始错误**（避免 fallback 异常顶替原错误丢失现场）。

### 错误处理流程

```
错误发生
    │
    ▼
┌─────────────────┐
│ 捕获错误        │
│ try-catch       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 创建错误上下文   │
│ ErrorContext    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 错误处理        │
│ ErrorHandler    │
└────────┬────────┘
         │
         ├──────────────────┐
         │                  │
         ▼                  ▼
┌─────────────────┐ ┌─────────────────┐
│ 日志记录        │ │ 错误上报        │
│ ConsoleReporter │ │ HttpReporter    │
└─────────────────┘ └─────────────────┘
         │
         ▼
┌─────────────────┐
│ 尝试恢复        │
│ ErrorRecovery   │
└────────┬────────┘
         │
         ├─────┬─────┬─────┐
         ▼     ▼     ▼     ▼
      Retry Fallback Ignore Recover
```

---

## 性能监控架构

### 性能指标收集

```typescript
interface PerformanceMetrics {
  operation: string       // 操作名称
  type: MetricType        // 操作类型
  duration: number        // 执行时长
  timestamp: number       // 时间戳
  payloadSize?: number    // 负载大小
  memoryUsage?: number    // 内存使用
  exceedThreshold?: boolean // 是否超阈值
}
```

### 性能监控流程

```
操作执行
    │
    ▼
┌─────────────────┐
│ 开始计时        │
│ monitor.start() │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 执行操作        │
│ operation()     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 结束计时        │
│ stop()          │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 记录指标        │
│ monitor.record()│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 分析统计        │
│ getStats()      │
└─────────────────┘
```

---

## 总结

GeomStore 的架构设计遵循以下原则：

1. **模块化**：各模块职责清晰，松耦合
2. **可扩展**：通过插件系统扩展功能
3. **可观测**：完善的错误处理和性能监控
4. **高性能**：缓存、批量更新等优化策略
5. **易集成**：针对微信小程序的专门优化
