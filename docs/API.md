# API 参考

按**引入路径**组织：标注 [核心] 的符号从主入口引入并始终进入产物；标注 [extras] 的符号从对应子路径引入，不进入主包。

```ts
import { createStore, withPageStore } from '@openlide/geomstore'                // 核心
import { createSnapshot } from '@openlide/geomstore/extras/snapshot'            // extras
```

> 本文签名与源码一致；未在此列出的类型请查阅 `src/types/*.ts`。使用示例见 [GUIDE.md](./GUIDE.md) 与 [`examples/`](../examples)。

## 入口一览

| 引入路径 | 内容 | 体积 |
| --- | --- | --- |
| `@openlide/geomstore` | 核心：Store / 工厂 / 工具 / 钩子 / 小程序集成 / 组合 / LRU | 常驻 |
| `@openlide/geomstore/core` | 与主入口同源的显式核心子入口 | 常驻 |
| `@openlide/geomstore/integrations` | 小程序集成底层绑定工具（`bindMappings` 等） | 按需 |
| `@openlide/geomstore/extras` | 全部可选能力聚合 | 最大，仅调试/全都要用时 |
| `@openlide/geomstore/extras/snapshot` | 快照引擎 | 按需 |
| `@openlide/geomstore/extras/selector` | 选择器与组合器 | 按需 |
| `@openlide/geomstore/extras/action` | ActionLoader / withLoading / 装饰器 | 按需 |
| `@openlide/geomstore/extras/performance` | 性能监控与 analyzer 插件 | 按需 |
| `@openlide/geomstore/extras/plugins` | 内置插件实现与存储后端 | 按需 |
| `@openlide/geomstore/extras/error` | 错误类族 / 边界 / 恢复 / 监控 / 上报器 | 按需 |
| `@openlide/geomstore/extras/enterprise` | 企业微信集成 | 按需 |
| `@openlide/geomstore/{store,hooks,plugins,integrations}` | 转发子目录（`pnpm stubs` 生成，供微信「构建 npm」等不支持 `exports` 子路径的场景） | — |

---

# 一、核心 [核心]

## 1.1 createStore

`createStore` 有两个重载：`state` 传工厂函数、或传对象字面量。工厂重载置于对象重载**之前**——函数类型本身可赋给 `State`，顺序颠倒会让 `state: () => ({...})` 被对象重载误判成 `S` 即函数类型，导致 getter / action 上下文退化。两种形态返回同一 `Store<S, A, G>`：

```ts
// 工厂函数形式（推荐：避免引用类型被多实例共享）
createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: FactoryStoreConfig<S, A, G>,
): Store<S, A, G>

// 对象字面量形式
createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  options: LiteralStoreConfig<S, A, G>,
): Store<S, A, G>
```

> `FactoryStoreConfig` / `LiteralStoreConfig` 是内部的**未导出**别名，各自等价于 `Omit<StoreConfig<S, A, G>, 'state'>` 再把 `state` 固定为 `() => S` / `S`（即「下方选项表 + 该形态的 `state`」）。另有导出的 `StoreOptions`，那是给「显式泛型场景」使用的构造配置，**不是** `createStore` 的形参类型。

| 选项 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | — | Store 名称（日志、组合命名空间、错误上下文） |
| `state` | `S \| (() => S)` | — | **推荐工厂函数**：创建时执行一次，避免引用类型被多实例共享 |
| `actions` | `A` | — | 方法集合；`this` 为 action 上下文（`state` / `setState` / `$patch` / `$replaceState` / `dispatch` / `getState`） |
| `getters` | `G` | — | 纯函数，**只接收 `state`** |
| `notify.clone` | `boolean` | `true` | 通知时是否克隆状态（关闭且状态保护关闭时，仅无可读写订阅者才零拷贝） |
| `notify.async` | `boolean` | `false` | 微任务合并同一 tick 内的多次写入 |
| `notify.onlyOnChange` | `boolean` | `false` | 根据变更计数抑制未检测到写入的 dispatch / batch 通知；脏键追踪不依赖此开关，同值写入也可能推进计数 |
| `stateProtection.deep` | `boolean` | `true` | 是否递归保护嵌套对象（`false` 只保护顶层） |
| `cacheConfig.enableStats` | `boolean` | `false` | 是否采集缓存命中统计（有额外开销） |
| `subscription.onLimit` | `'evict-oldest' \| 'throw'` | `'evict-oldest'` | 订阅数达上限时的策略 |

## 1.2 Store 实例

### 状态

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `getState` | `(): S` | 返回活动引用（就地变异语义） |
| `setState` | `<K extends keyof S>(key: K, value: S[K]): void` | 单键写入 |
| `$patch` | `(partialState: Partial<S>): void` | 多键合并（底层 `deepMerge`，仅对纯对象递归） |
| `$replaceState` | `(newState: S \| (() => S)): void` | 整体替换；未列出的键会丢失 |
| `$snapshot` | `(): Readonly<S>` | 深克隆 + 递归冻结，嵌套层级只读承诺同样成立 |
| `$restore` | `(snapshot: Readonly<S>): void` | 从快照恢复（经 `$replaceState`，不重复深拷贝） |

### Action 与 Getter

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `dispatch` | `(name, ...args) => ReturnType<A[name]>` | 返回值原样透传（异步 action 返回 Promise） |
| `getter` | `<K extends keyof G>(getterName: K): InferGetterReturn<G, K>` | 依赖未变时复用结果 |
| `getGetterNames` | `(): string[]` | 供调试 / DevTools |

### 订阅与批量

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `subscribe` | `(listener: StateListener<S>, options?: { readOnly?: boolean }): () => void` | 监听器**只接收新状态**；返回值为退订函数 |
| `isStateKeyDirty` | `(key: string): boolean` | 自上次通知以来该键是否变更（集成层据此跳过 `setData`） |
| `batch` | `<T>(fn: () => T): T` | 期间合并通知，结束时统一发一次（返回值与异常原样透传） |
| `startBatch` / `endBatch` | `(): void` | 手动批量（支持嵌套，仅最外层收尾时通知） |

- 同一监听器注册 N 次会收到 N 次通知。每个返回的退订句柄只抵消一份注册，**重复调用同一句柄无效**，不会移除其他注册。
- action 内通过 `this.state` 修改对象、数组及 Map/Set 时，会累积受影响的**顶层键**；共享别名可能同时使多个键变脏。这在默认模式与 `onlyOnChange` 模式下均生效。
- 在同步订阅回调内读取 `isStateKeyDirty(key)`；脏键在通知结束后清空，批处理或异步通知等待期间会累积。`batch` 延迟的是通知，不是状态写入。
- Date 等其他内建对象的内部变异不在此代理追踪范围；需要通知时，通过 `setState` 等 API 替换所属状态键。`getState()` 返回的裸引用不是 action 脏追踪视图。

### 缓存

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `enableCache` | `(keys?: Array<keyof S>): void` | 省略 `keys` 表示缓存全部顶层键 |
| `disableCache` | `(): void` | 关闭缓存 |
| `getCached` | `<K extends keyof S>(key: K): S[K]` | 走缓存读取 |
| `invalidateCache` | `<K extends keyof S>(key?: K): void` | 省略 `key` 清空全部 |
| `getCacheStats` | `(): CacheStats` | 只读，销毁后仍可调用 |

action 完成时，缓存刷新同时检查已有缓存键与当前状态键，移除已被 `delete this.state.key` 删除的条目；`$replaceState` 则先清空整个键级缓存再按新状态回填。不要依赖 action 尚未完成时 `getCached` 已反映直接变异。

### 插件与生命周期

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `use` | `(plugin: Plugin): () => void` | 返回卸载函数；`install` 抛错会回滚入列 |
| `hooks` | `HookSystem` | `on` / `emit` / `size` / `listenerCount` |
| `destroy` | `(): void` | 销毁后所有写操作抛错（只读统计仍可用） |

> 除 `getCacheStats` 等只读操作外，销毁后调用任何方法都会抛 `[GeomStore] Cannot call … on a destroyed Store`。

## 1.3 工具函数

```ts
import {
  isObject, isPlainObject, isFunction, isArray, isPromise,
  shallowEqual, deepEqual, deepMerge, get, set,
  noop, identity, uniqueId, clone,
} from '@openlide/geomstore'
import type { CloneMode } from '@openlide/geomstore'
```

| 函数 | 说明 |
| --- | --- |
| `shallowEqual` / `deepEqual` | 仅比较**自有属性**；`shallowEqual` 对 Date/RegExp/Map/Set 按内容比较 |
| `deepMerge(target, ...sources)` | 仅对纯对象递归；其余类型整体替换；内置循环引用防护（WeakMap 配对跟踪） |
| `clone(value, mode?)` | `mode`: `'deep'`（默认）/ `'shallow'` / `'safe'`（尽力且绝不抛错）/ `'json'`（有损） |
| `uniqueId(prefix?)` | 递增唯一 ID |
| `get` / `set` | 路径读写（`set` 遇到中间路径为原始值时不静默替换） |

## 1.4 钩子与插件

```ts
class HookSystem {
  on(name: HookName, handler: HookHandler): () => void
  off?(name: HookName, handler: HookHandler): void
  emit(name: HookName, ...args: unknown[]): void
  get size(): number
  listenerCount(name: HookName): number
}

usePlugin<S extends State, A extends Actions, G extends Getters<S>>(
  plugin: Plugin<S>,
  store: Store<S, A, G>,
): () => void
```

**钩子名**：`beforeDispatch` / `afterDispatch` / `beforeSetState` / `afterSetState` / `beforePatch` / `afterPatch` / `beforeReplaceState` / `afterReplaceState` / `beforeGet` / `afterGet` / `onError`。

**插件契约**：`{ name: string; install(store: Store): (() => void) | void }`。

> `usePlugin(plugin, store)` 的泛型从 `store` 反推，传入具体 Store **无需断言**；`plugin` 需与其状态类型匹配，状态无关的插件写作 `Plugin<State>`（如 `loggerPlugin`）。日常也可直接用 `store.use(plugin)`（返回值同为卸载函数）。

## 1.5 小程序集成

```ts
withPageStore<S, A, G, O>(store, options?: ConnectOptions<S, A, G>): <C>(config: C) => PageThis<...>
withComponentStore<S, A, G, O>(store, options?: ConnectOptions<S, A, G>): <C>(config: C) => ComponentThis<...>
withAppStore<S, A, G>(store, options?: ConnectOptions<S, A, G>): <C>(config: C) => C
```

**`ConnectOptions` 映射形式**（三端一致）：

| 字段 | 简写 | 别名 |
| --- | --- | --- |
| `mapState` | `['isLoggedIn']` | `{ loggedIn: 'isLoggedIn' }` |
| `mapGetters` | `['greet']` | `{ hello: 'greet' }` |
| `mapActions` | `['login']` | `{ doLogin: 'login' }` |
| `inject` | — | 注入额外值 / 方法 |

- `onUnload`（Page）/ `lifetimes.detached`（Component）先执行用户生命周期，再在 `finally` 中清理订阅与映射 actions；用户钩子同步执行期间仍可调用映射方法，抛错也会完成清理。包装器**不等待异步钩子返回的 Promise**，不要在 `await` 后依赖仍存在的映射方法。App 级绑定不随 `onHide` 清理。
- 组件生命周期必须写在 `lifetimes` 字段内；配置顶层的 `attached` / `detached` 不会被执行
- 三处集成的配置方法内 `this` 均已注入（`PageThis` / `ComponentThis` / `AppThis`），**无需手写 `this` 标注**；Component 的注入方法与 `data` 同时出现在顶层与 `methods` 下（微信会把 `methods` 条目提升到实例）
- 类型分工：`PageThis` / `ComponentThis` / `AppThis` 描述**方法内的 `this`**（含实例侧注入的 action）；装饰器**返回的配置对象**由 `PageConfig` / `ComponentConfig` 描述，不含这些实例侧成员
- `mapState` 对象值仅在引用未变且对应顶层键未变脏时跳过更新；`mapGetters` 等没有脏键信息的对象映射保守下发。原始值按值比较；`undefined` 字段被过滤（清除字段请用 `null`）。
- 底层绑定工具 `parseMapping` / `bindMappings` / `bindActions` / `performAutoInject` / `exposeStoreAPI` / `cleanupBindings` **不在主入口**，需从 `@openlide/geomstore/integrations` 引入（已在 `exports` 声明）；日常优先使用上述高阶函数

## 1.6 组合

```ts
composeStore(stores: StoreLike[], options?: ComposeOptions): ComposedStore
createStoreTree(config: StoreTreeNode, options?: ComposeOptions): ComposedStore
class StoreRegistry { register / get / has / delete / list … }
export const globalRegistry: StoreRegistry
```

| `ComposeOptions` | 默认 | 说明 |
| --- | --- | --- |
| `namespace` | `false` | 子 store 按 `name` 嵌套，dispatch 使用 `'store/action'` 斜杠路径 |
| `strict` | `false` | 冲突与非法访问按严格模式处理 |

`ComposedStore`：`getState` / `dispatch`（支持斜杠路径）/ `subscribe` / `isStateKeyDirty` / `hooks` / `$patch` / `$replaceState` / `destroy` 等，语义与单 Store 一致。

- `getState()` / `state` 的合并缓存在读取前校验子 store 版本，批内或 `notify.async` 尚未通知时也能读取最新状态；无版本号的子 store（含嵌套组合）保守地在每次读取时使缓存失效。
- `actions` 汇总子 store 的 action 名称，外层非命名空间组合可以把裸名 `dispatch('increment', ...args)` 路由到内层非命名空间组合；同名 action 取第一个。命名空间模式仍使用 `'store/action'` 路径。
- 非命名空间组合包含**命名空间内层**时，其子 store 的键以「子 store 名/键」出现在合并状态里：读写用完整斜杠路径（`setState('leaf/count', 1)`、`$patch({ 'leaf/count': 2 })`），构造期会在开发模式提示书写形式。`$replaceState` 不支持该路径（整树替换需按内层命名空间形状传值）。

## 1.7 LRUCache

```ts
new LRUCache<K, V>(options?: CacheOptions)
```

| 方法 | 说明 |
| --- | --- |
| `get` / `set` / `has` / `delete` / `clear` | 基础读写（命中刷新顺序） |
| `getOrSet(key, factory)` | 未命中时计算并写入（未命中计入 `misses`） |
| `resize(size)` | 调整容量（NaN/Infinity 回退默认值） |
| `getStats(): LRUCacheStats` | `hits` / `misses` / `size` / `avgAccessTime` / `missRate` |
| `forEach(fn)` | 遍历时删除当前项安全（先取后继再回调） |

---

# 二、extras/snapshot —— 快照

```ts
createSnapshot<T>(data: T, options?: SnapshotOptions): SnapshotResult<T>
createSnapshotAsync<T>(data: T, options?: AsyncSnapshotOptions): Promise<SnapshotResult<T>>
class SnapshotManager { createSnapshot / createSnapshotAsync / compareSnapshots }
export default SnapshotManager
```

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `maxDepth` | — | 超限节点返回占位符（**不是活引用**） |
| `detectCircular` | `true` | 是否上报循环引用（防护始终生效） |
| `includeNonEnumerable` | `false` | 是否包含不可枚举属性 |
| `customCloner` | — | 自定义克隆；返回 `undefined` 表示交回默认流程 |
| `batchSize` | `100` | 异步模式的单批节点数（批间让出控制权） |
| `batchInterval` | `0` | 批间隔（毫秒） |
| `timeout` | — | 超时后中断并置 `success: false` |
| `onProgress` | — | `(progress: SnapshotProgress) => void` |
| `onError` | 见下 | `(error, context) => boolean`；`true` 继续（丢弃该节点），`false` 中止 |

**`SnapshotResult<T>`**

| 字段 | 说明 |
| --- | --- |
| `data` | 隔离副本；根节点被丢弃时为 `undefined` |
| `success` | 无 `cloneError` 且未超时 |
| `errors` | 错误账本（`type` / `message` / `path` / `originalError`） |
| `metadata` | `id` / `timestamp` / `dataType` / `size` / `nodeCount` / `duration` / `hasCircular` … |
| `stats` | `cloneOperations` / `circularReferences` / `maxDepthHits` 等 |

**隔离契约（丢弃语义）**：无法安全克隆的节点一律丢弃，绝不把原值兜底进快照。

| 容器 | 丢弃时的表现 |
| --- | --- |
| 对象属性 | 不写入该属性 |
| 数组 | 保留位置（留洞） |
| `Set` | 不添加该元素 |
| `Map` | 跳过整条 entry（键或值被丢弃时都跳过） |
| 根节点 | `data` 为 `undefined` |

其他要点：类实例保留原型；访问器属性以 getter 求值结果克隆（不二次触发）；`customCloner` 抛错语义在同步/异步路径**完全一致**（落账 → 咨询 `onError` → 继续丢子树 / 中止抛 `SnapshotAbortError`）。

`SnapshotManager.compareSnapshots(snapshot1, snapshot2): SnapshotDiff` —— 传入两个完整的 `SnapshotResult`，而非 `.data`；纯函数实现，不依赖实例状态。数组逐元素比较，`Set` 无序匹配，`Map` 键引用匹配失败后做结构匹配。递归按对象对识别循环，等价循环不会仅因重复进入而产生差异；最大递归深度 100 的保护仍保留。对象比较区分自有键缺失与值为 `undefined`：新增/删除自有 `undefined` 属性会产生 `kind: 'added' | 'removed'`，继承属性不参与。

---

# 三、extras/selector —— 选择器

```ts
createSelector<S, R>(selectorFn: Selector<S, R>, options?: SelectorOptions): Selector<S, R>
createMemoizedSelector<S, R>(selectorFn, equalityFn?): Selector<S, R>
createParametricSelector<S, P, R>(selectorFn, options: { ttl?, maxEntries? }): (state: S) => (params: P) => R
createStructuredSelector<S, R>(selectors: { [K in keyof R]?: Selector<S, R[K]> }): Selector<S, R>
class SelectorFactory<S, R> { execute(state) / withCacheResult() }
class SelectorComposer { createRetrySelector / createRetrySelectorAsync / … }
```

| `SelectorOptions` | 默认 | 说明 |
| --- | --- | --- |
| `cache` | `true` | 是否启用缓存 |
| `cacheTTL` | — | 缓存有效期（毫秒） |
| `equalityFn` | `deepEqual` | 无状态版本号时的回退比较器 |
| `maxCacheSize` | — | 缓存容量上限 |

- `createSelector` / `SelectorFactory` 的版本化缓存命中要求**状态对象身份与版本号同时相同**（O(1) 比较）；不同 Store 即使版本号相同，也不会串用结果。状态不带版本号（如传入普通对象）时回退 `equalityFn`。
- `createParametricSelector` 按参数分别缓存；`ttl: 0` 表示永不过期，`maxEntries` 控制容量并在写入前清理过期项
- `createStructuredSelector` 以 DefineOwnProperty 语义写入结果（选择器映射含 `__proto__` 键时不会被静默丢弃）
- `createStructuredSelector` 与 `SelectorComposer.combine` **需显式给出状态类型参数**：`S` 只出现在「对另一类型参数取索引」的嵌套位置（`Selector<S, R[K]>` / `Selector<S, unknown>[]`），TS 无法据此反推并会退回约束 `State`
- `SelectorComposer.createObjectSelector` 对状态的**每个键**应用选择器并返回同键名对象（`K` 通常取 `keyof S`，而非某一单个键）
- 重试选择器抛出的错误带**不可枚举**的 `attempts` 属性，记录真实执行次数

---

# 四、extras/action —— Action 增强

```ts
class ActionLoader { constructor(options?: ActionLoaderOptions); wrap(fn, name, setState) }
withLoading(...)                      // loading 引用计数按 (宿主, loading 键) 集中
class ActionExecutor { … }            // 异步 action 执行器
class ActionUtils { … }               // 便捷工具（ActionUtilsOptions）
```

| `ActionLoaderOptions` | 默认 | 说明 |
| --- | --- | --- |
| `perActionKeys` | `false` | loading / error 键是否按 action 名后缀区分 |
| `sharedLoadingCounts` | — | 共享引用计数表（外部清空时按兜底值 1 递减，不出现负计数） |
| `autoLoading` | `true` | 是否自动维护 loading |
| `autoError` | `true` | 是否自动维护 error |

`wrap` 的 `setState` 为 **`(key, value)` 两参数**签名。

## 装饰器

```ts
withLog(options?)
withDebounce(delay?: number)                  // 默认 300ms
withThrottle(interval: number, options?)     // 间隔是第一个位置参数
withCache(options?)
withRetry(options?)
withTimeout(timeout: number, options?)
createDecorator(impl)                         // 自定义装饰器
```

| 选项 | 说明 |
| --- | --- |
| `ThrottleDecoratorOptions.leading` / `trailing` | 默认均为 `true`（窗口结束时以**最新参数**补发） |
| `ThrottleDecoratorOptions.assumeAsync` | 默认 `false`；为 `true` 时被抑制的调用也返回 Promise（用于「非 `async` 语法但返回 Promise」的方法） |
| `CacheDecoratorOptions.ttl` / `keyFn` | 默认 `5000`；并发同参调用会 in-flight 去重 |
| `RetryDecoratorOptions.retries` / `delay` / `shouldRetry` | 默认重试延迟与指数退避由 `delay` 控制 |
| `DecoratorOptions.logger` 等 | 见 `src/extras/action/decorators/common.ts` |

> `withDebounce` / `withThrottle` / `withCache` 按**宿主与方法**隔离状态，支持实例方法与静态方法。复用同一装饰器时，不同 Symbol 方法（即使 description 相同）以及与其字符串表示同名的方法不会串数据。异步判定基于函数原型比较，压缩后依然可靠。

---

# 五、extras/performance —— 性能监控

```ts
class PerformanceMonitor { record(metrics) / getMetrics() / … }
class MetricsCollector { … }
class PerformanceAnalyzer { … }
createAnalyzerPlugin(options?) / analyzerPlugin
```

- `record(metrics)` 会顺手清理超时未结束的计时条目（调用方遗漏 `end()` 时的兜底，防 Map 无限增长）
- `getMetrics()` 返回副本
- `analyzerPlugin` 自动接入 dispatch / setState / getter 计时；`onError` 时精确清理未完成的配对栈；卸载时若 `store.getter` 已被后续插件重新包装则跳过恢复并告警

---

# 六、extras/plugins —— 插件实现

```ts
persistencePlugin(options?: PersistenceOptions): Plugin
loggerPlugin / devtoolsPlugin / timeTravelPlugin: Plugin
builtinPlugins: Plugin[]
class WxStorageBackend implements StorageBackend
```

`timeTravelPlugin(options?)` 安装后通过 `store.__timeTravel__` 提供 `getSnapshots()`、`goTo(index)`、`undo()`、`redo()` 等调试接口。`getSnapshots()` 对每条历史状态重新使用核心 `deepCloneState` 克隆：修改返回值中的普通对象、数组或 Date/RegExp/Map/Set，不会污染内部历史与后续 `goTo` 恢复值，循环引用也受支持。**这不是 extras/snapshot 的丢弃契约**：类实例、函数、Promise、WeakMap/WeakSet 等不可克隆节点仍保留原引用；不要修改这些共享节点。

| `PersistenceOptions` | 默认 | 说明 |
| --- | --- | --- |
| `key` | Store 名 | 存储键 |
| `storage` | 自动探测 `wx` 同步存储，否则内存 | **必须同步**：`{ getItem, setItem, removeItem }`；传异步实现会被显式拒绝 |
| `filter` | 全量 | `(state) => Partial<state>`，指定落盘子集（未被持久化的键保留初始值） |
| `validate` | — | 恢复前的数据校验 |
| `debounce` | `0` | 写入防抖（毫秒）；卸载时会**同步补写**窗口内最后一次变更 |
| `clearOnUninstall` | `false` | 为 `true` 时卸载改为清理存储（丢弃待写数据） |

`WxStorageBackend` 封装 `wx.getStorageSync` / `setStorageSync` / `removeStorageSync`；不传 `storage` 且检测不到 `wx` 同步存储时降级为内存存储并输出开发告警。

---

# 七、extras/error —— 错误处理

## 错误类族

```ts
GeomStoreError( message, code, context? )
ActionError / StateError / SelectorError / PluginError / ComposeError / ValidationError
createError(code, message, context?) / ErrorCode
isGeomStoreError / isActionError / isStateError / isSelectorError / isPluginError / isComposeError / isValidationError
```

## ErrorBoundary

```ts
new ErrorBoundary<S, F>(options?: ErrorBoundaryOptions)
withErrorBoundary(boundary, fn?)
```

- **默认 fail-loud**：未配置 `fallback` 时错误重抛；提供 `fallback` 即声明恢复意图（显式 `recoverable` 配置优先）
- `fallback` 计算函数自身抛错时**重抛原始错误**（不丢失现场）
- 错误历史上限 100；`getErrorHistory()` 可读

## ErrorRecovery

```ts
new ErrorRecovery()
configure(map: RecoveryStrategyMap): void
recover<T>(error: GeomStoreError, context?: RecoveryContext): Promise<T>
clearRetryCount(code: string): void
createDefaultErrorRecovery() / defaultErrorRecovery
RecoveryStrategy: { RETRY, FALLBACK, IGNORE, RECOVER, RESTART }
```

- 重试额度按**故障周期**计量：窗口 = `max(60s, 本周期全部退避总时长 × 2)`；超窗视为新周期重置
- 达到上限仅清除**当前键**（`code:storeName:operation`）的计数与周期窗，不级联清除同码其他键
- 键容量守卫 `MAX_RETRY_KEYS = 1000`：超限时清理过期窗口并一次性淘汰到上限内

## ErrorMonitoring

```ts
new ErrorMonitoring(config: MonitoringConfig)
report(error) / reportBatch(errors) / flushReports() / shutdown()
```

| `MonitoringConfig` | 默认 | 说明 |
| --- | --- | --- |
| `reporters` | — | `ErrorReporter[]` |
| `batchThreshold` | `10` | 达到条数立即 flush |
| `batchInterval` | `5000` | 定时 flush（毫秒） |
| `reportTimeout` | `10000` | 单个 reporter 的超时（毫秒） |
| `enableAggregation` | `true` | 是否聚合相同错误 |
| `enableConsoleLog` | `true` | 是否输出控制台日志 |
| `maxQueueSize` | `1000` | 队列容量；超容量按最旧优先淘汰 |
| `maxFlushRetries` | `3` | 「全部 reporter 连续失败」的重入队上限，超过则丢弃该批并告警 |

> `batchInterval` / `batchThreshold` / `reportTimeout` 用 `??` 兜底，**显式传入的 `0` 是合法语义**（立即 / 无延迟 / 不超时），不会被替换为默认值。

- flush 对每个 reporter 做 `ok / fail / timeout` **三态判定**：仅真正 resolve 才算成功；超时告警后批次重入队
- 定时器做 `unref` 探测（小程序 / 浏览器无该 API 时自动跳过，不阻止进程退出）

## 上报器

```ts
class ConsoleReporter implements ErrorReporter   // 基础库缺 console.group 时降级为平铺输出
class HttpReporter implements ErrorReporter      // 自动选择 wx.request（校验 statusCode）或 fetch（校验 ok）
defaultErrorHandler / createErrorContext / ErrorHandlerImpl
```

---

# 八、extras/enterprise —— 企业微信集成

```ts
createUserStore(config)                // 账号态 Store 工厂
class StoreManager { switchUser / getCurrentStore / … }
export const storeManager: StoreManager
initHotUpdate(config) / restoreFromHotUpdate()
class OfflineManager { … }
initBackgroundSync(config) / unregisterBackgroundSync()
createEnterpriseApp(config): Plugin
```

- `StoreManager` 为真正 LRU（命中刷新顺序），且不会淘汰当前登录用户的 store
- `initBackgroundSync` 包装全局 `App` 构造器注入 `onShow` / `onHide`（修改 `App.prototype` 在微信中不生效）
- `OfflineManager` 同步期间落盘完整联合队列视图；未知 action 走重试 → 死信路径
- 热更新：备份在用户确认时执行；写入失败则不写待更新标记并跳过 apply

---

# 九、易误用点

| 事项 | 说明 |
| --- | --- |
| `bindMappings` 等底层绑定工具 | **不在主入口**，从 `@openlide/geomstore/integrations` 引入。日常优先用 `withPageStore` / `withComponentStore` / `withAppStore` |
| `SnapshotManager.compareSnapshots` | **实例方法**（实现是无状态纯函数），需要实例或自备 `SnapshotManager` |
| `extras` 聚合入口 | 会把所有可选能力拉进产物，只有调试或确实全都要用时才引入 |
| `import type` | 类型（`SelectorOptions`、`MonitoringConfig`、`SnapshotResult` 等）请用 `import type` 引入，避免无谓的运行时代码 |
| 深链内部源码路径 | 可选能力的**实现**已移到 `src/extras/**`（快照 / 选择器 / Action 增强）；仅入口在 `extras/*` 的还有 `cache` / `hooks` / `performance`（实现保留在 `core`） |

---

# 十、版本与变更

破坏性变更与迁移代码见 [MIGRATION.md](./MIGRATION.md)，完整变更记录见 [CHANGELOG](../CHANGELOG.md)。
