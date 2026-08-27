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
│  │               Core Layer (核心层)                     │   │
│  │                                                       │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐  │   │
│  │  │  Store  │  │ Compose │  │ Selector│  │ Action │  │   │
│  │  │         │  │  Store  │  │         │  │        │  │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └────────┘  │   │
│  │                                                       │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐  │   │
│  │  │  Cache  │  │ Snapshot│  │  Error  │  │ Perform│  │   │
│  │  │  LRU    │  │ Manager │  │ Handler │  │ Monitor│  │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Plugin Layer (插件层)                    │   │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐       │   │
│  │  │ Logger │ │Persist │ │DevTools│ │Analyzer│       │   │
│  │  └────────┘ └────────┘ └────────┘ └────────┘       │   │
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
├── index.ts                 # 主入口，导出所有公共 API
│
├── types/                   # 类型定义层
│   ├── store.ts            # Store 相关类型
│   ├── action.ts           # Action 相关类型
│   ├── compose.ts          # 组合相关类型
│   ├── error.ts            # 错误相关类型
│   ├── integration.ts      # 集成相关类型
│   ├── performance.ts      # 性能相关类型
│   ├── persistence.ts      # 持久化相关类型
│   ├── selector.ts         # 选择器相关类型
│   ├── plugin.ts           # 插件相关类型
│   ├── global.ts           # 全局类型扩展
│   └── index.ts            # 类型导出入口
│
├── core/                    # 核心实现层
│   ├── store/              # Store 核心实现
│   │   ├── Store.ts        # Store 类定义
│   │   ├── factory.ts      # createStore 工厂
│   │   ├── ActionManager.ts    # Action 注册与执行
│   │   ├── BatchManager.ts     # 批量通知管理
│   │   ├── StateProxy.ts       # 状态代理
│   │   ├── StoreCache.ts       # Store 级缓存
│   │   ├── SubscriptionManager.ts # 订阅管理
│   │   ├── types.ts        # Store 内部类型
│   │   ├── utils.ts        # Store 工具函数
│   │   └── index.ts        # 导出
│   │
│   ├── hooks/              # 钩子系统
│   │   ├── HookSystem.ts   # 钩子系统实现
│   │   └── index.ts        # 导出
│   │
│   ├── cache/              # 缓存系统
│   │   ├── LRUCache.ts     # LRU 缓存实现
│   │   └── index.ts        # 导出
│   │
│   ├── selector/           # 选择器系统
│   │   ├── createSelector.ts   # 选择器工厂
│   │   ├── selectorComposer.ts # 选择器组合器
│   │   └── index.ts        # 导出
│   │
│   ├── error/              # 错误处理系统
│   │   ├── GeomStoreError.ts   # 自定义错误类
│   │   ├── ErrorHandler.ts     # 错误处理器
│   │   ├── ErrorBoundary.ts    # 错误边界
│   │   ├── ErrorRecovery.ts    # 错误恢复
│   │   ├── ErrorMonitoring.ts  # 错误监控
│   │   └── index.ts        # 导出
│   │
│   ├── action/             # Action 增强系统
│   │   ├── ActionLoader.ts     # Action 加载状态
│   │   ├── ActionUtils.ts      # Action 工具
│   │   ├── AsyncActionSupport.ts # 异步支持
│   │   ├── decorators/     # 装饰器
│   │   └── index.ts        # 导出
│   │
│   ├── snapshot/           # 快照系统
│   │   ├── SnapshotManager.ts  # 快照管理器
│   │   └── index.ts        # 导出
│   │
│   ├── compose/            # Store 组合系统
│   │   ├── composeStore.ts     # 组合函数
│   │   ├── StoreRegistry.ts    # Store 注册表
│   │   └── index.ts        # 导出
│   │
│   ├── performance/        # 性能监控系统
│   │   ├── PerformanceMonitor.ts # 性能监控器
│   │   ├── Optimizations.ts     # 性能优化（批量通知/指纹）
│   │   ├── metrics.ts           # 性能指标统计
│   │   └── index.ts        # 导出
│   │
│   └── utils/              # 工具函数
│       ├── helpers.ts      # 通用工具函数
│       ├── TypeValidator.ts    # 类型校验器
│       └── index.ts        # 导出
│
├── plugins/                 # 插件实现层
│   ├── builtin.ts          # 内置插件
│   ├── devtools/           # 开发工具插件
│   │   ├── timeTravelPlugin.ts # 时间旅行插件
│   │   └── index.ts        # 导出
│   ├── performance/        # 性能分析插件
│   │   ├── analyzerPlugin.ts   # 性能分析插件
│   │   └── index.ts        # 导出
│   └── index.ts            # 插件导出
│
└── integrations/            # 集成层
    ├── with-store.ts       # 页面/组件集成
    ├── with-app-store.ts   # App 集成
    ├── utils.ts            # 集成工具
    ├── enterprise/         # 企业级集成
    │   ├── wechat-enterprise.ts # 微信企业版集成
    │   └── index.ts        # 导出
    └── index.ts            # 集成导出
```

---

## 核心模块

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
