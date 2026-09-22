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
| `notify.clone` | `boolean` | 未显式配置＝自动 | 通知时是否深拷贝载荷。**未显式配置**时按订阅者构成决定：仅有只读订阅者（页面 / 组件绑定）走零拷贝，存在可写订阅者才深拷贝；显式 `true` 强制深拷贝；显式 `false` 仍在有可写订阅者时深拷贝（防共享载荷被改） |
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
| `$replaceState` | `(newState: S \| (() => S)): void` | 整体替换；未列出的键会丢失，且这些**消失的旧键同样被标脏**（`isStateKeyDirty` 对它们为 `true`） |
| `$snapshot` | `(): Readonly<S>` | 深克隆后**部分冻结**：纯对象与数组链上深度只读；经 Date / RegExp / Map / Set 或非纯对象（类实例等）触达的节点仍可变，`Readonly<S>` 只是类型层面的承诺 |
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
| `subscribe` | `(listener: StateListener<S>, options?: { readOnly?: boolean }): () => void` | 监听器**只接收新状态**；返回值为退订函数。`readOnly: true` 声明回调不写状态，全部订阅者都只读时通知载荷免深拷贝（开启状态保护时为只读保护 Proxy，关闭时为原始引用） |
| `isStateKeyDirty` | `(key: string): boolean` | 自上次通知以来该键是否变更（集成层据此跳过 `setData`） |
| `batch` | `<T>(fn: () => T): T` | 期间合并通知，结束时统一发一次（返回值与异常原样透传） |
| `startBatch` / `endBatch` | `(): void` | 手动批量（支持嵌套，仅最外层收尾时通知） |

- 同一监听器注册 N 次会收到 N 次通知。每个返回的退订句柄只抵消一份注册，**重复调用同一句柄无效**，不会移除其他注册。
- 回调抛错被逐个隔离（不影响其余监听器）：开发模式打印，生产模式改由 `onError` 钩子承接（控制台仍静默），因此「某个订阅者一直在抛错」有可上报的入口。本轮派发对象是进入通知时在册的注册，回调内退订自己仍会收到本次这最后一次更新。
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
| `shallowEqual` / `deepEqual` | 仅比较**自有属性**；`shallowEqual` 对 Date/RegExp/Map/Set 按内容比较。`deepEqual(a, b, maxDepth?)` 为迭代实现（栈安全），默认深度预算 1000，**超出即判不等**并在一次顶层调用内只告警一次；深度沿 Set 元素同样累加（不跨 Set 归零），`symbol` 与不可枚举属性不参与比较 |
| `deepMerge(target, ...sources)` | 仅对纯对象递归；其余类型整体替换；内置循环引用防护（WeakMap 配对跟踪） |
| `clone(value, mode?)` | `mode`: `'deep'`（默认）/ `'shallow'` / `'safe'`（尽力且绝不抛错）/ `'json'`（有损） |
| `uniqueId(prefix?)` | 递增唯一 ID |
| `get` / `set` | 路径读写（`set` 遇到中间路径为原始值时不静默替换） |

## 1.4 钩子与插件

```ts
interface IHookSystem {
  // 处理器形参与 emit 实参都按钩子名从 HookArgsMap 取，写错参数个数/顺序即编译错误
  on<K extends HookName>(hookName: K, handler: HookHandlerFor<K>): () => void
  emit<K extends HookName>(hookName: K, ...args: HookArgsMap[K]): void
  clear(hookName?: HookName): void
  size(hookName?: HookName): number         // 量纲随入参变化：无参＝钩子名称数，带参＝该钩子的处理器数
  listenerCount(hookName: HookName): number // 数某个钩子挂了几个处理器，请用这个无歧义版本
}

type HookHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void
type HookHandlerFor<K extends HookName> = IsUnion<K> extends true ? HookHandler : (...args: HookArgsMap[K]) => void

usePlugin<S extends State, A extends Actions, G extends Getters<S>>(
  plugin: Plugin<S>,
  store: Store<S, A, G>,
): () => void
```

> `HookHandler` 的第二个类型参数（旧的 `TResult`）已删除：`emit` 一律忽略处理器返回值，需要否决请抛异常。精确形参在插件侧（`install(store)` 拿到的 `Store` 接口）已生效；`createStore(...).hooks` 直连调用目前仍是实现类 `HookSystem` 的擦除签名（该字段声明为实现类类型），待源码把位点换成 `IHookSystem` 后统一。

> **`emit` 的失败语义**：逐个处理器 `try/catch`，单个抛错既不中断其余处理器也不传播给 `emit` 调用方；错误先 `console.error` 再转投 `onError` 钩子（`emit('onError', error, hookName)`），`onError` 自身抛错只落 `console.error` 不递归。要让异常冒泡到业务方请走 action 的错误边界，不要指望钩子。

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
- 非命名空间组合包含**命名空间内层**时，其子 store 的键以「子 store 名/键」出现在合并状态里：读写用完整斜杠路径（`setState('leaf/count', 1)`、`$patch({ 'leaf/count': 2 })`），构造期会在开发模式提示书写形式。`$replaceState` 不支持该路径（整树替换需按内层命名空间形状传值）。该路由判定**只看数据形状**，与 `warnMissingKeys`（`$replaceState` 的丢键告警开关）无关，开发/生产走同一分支
- 通知回调内的重入写入会把对应子 store 记为「下一轮的脏」：本轮收尾只作废本轮脏键（与单 Store 的 `_deferredDirtyKeys` 同口径），集成层对稳定引用对象值的「未变化」跳过判定因此不会漏更新。覆盖注册子 store 时，旧实例 `destroy()` 抛错只记日志，注册一定会完成

## 1.7 LRUCache

```ts
new LRUCache<K, V>(options?: CacheOptions)
```

| 方法 | 说明 |
| --- | --- |
| `get` / `set` / `has` / `delete` / `clear` | 基础读写（命中刷新顺序） |
| `getOrSet(key, factory)` | 未命中时计算并写入（未命中计入 `misses`） |
| `resize(size)` | 调整容量：只接受**有限值**并夹到 `≥ 1`（小数不取整，实际条目数为向下取整）；`NaN` / `Infinity` 保持当前容量不变 |
| `getStats(): LRUCacheStats` | `hits` / `misses` / `size` / `avgAccessTime` / `missRate`。`hitRate` / `missRate` 为 0–100 的百分比（两位小数），`totalAccesses === 0` 时两者同为 0，需先看 `totalAccesses`；`avgAccessTime` / `avgItemLifetime` 的 `0` 兼作「无样本 / 未开启计时」哨兵。`evictions` 计的是 `onEvict` 触发次数（配置性清空亦计入）；`keys` 为字符串化后的键，需要原始键请用 `keys()` |
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
| `onProgress` | — | `(progress: SnapshotProgress) => void`；**抛错被就地兜住**（落一条 `unknown` 账、不影响 `success` 与克隆结果），首次异常后不再调用。`total` / `percentage` 是近似值（估算深度上限 10），别当完成判据 |
| `onError` | 见下 | `(error, context) => boolean \| void`；按**真值**解释：truthy＝忽略该错误并按种类降级，falsy（含不写 `return` 的 `void` 写法）＝拒绝继续。拒绝的后果分岔：`cloneError` → 抛 `SnapshotAbortError`、整次快照 `success: false`；`circular` → 该位置写 `'[Circular Reference]'` 占位并继续（快照仍可 `success: true`）。纯观测请显式 `return true`，或改用 `onProgress`；`maxDepth` / `timeout` 两类不经本回调 |

**`SnapshotResult<T>`**

| 字段 | 说明 |
| --- | --- |
| `data` | 隔离副本；**异常 / 中止 / 根节点被丢弃时为 `undefined`**（失败结果绝不回传活引用） |
| `success` | 无 `cloneError` 且未超时（`circular` / `maxDepth` / `onProgress` 属已降级项，不参与判定，故 `success: true` 且 `errors` 非空是合法状态） |
| `errors` | 错误账本（`type` / `message` / `path` / `originalError`） |
| `metadata` | `id` / `timestamp` / `dataType` / `size` / `nodeCount` / `duration` / `hasCircular` …。`nodeCount` 为实际进入克隆的节点数（同步 / 异步同口径，不含在计数前就被 `maxDepth` 截断的节点）；`size` 为估算值 |
| `stats` | `cloneOperations` / `circularReferences` / `maxDepthHits` 等 |

**隔离契约（丢弃语义）**：无法安全克隆的节点一律丢弃，绝不把原值兜底进快照。

| 容器 | 丢弃时的表现 |
| --- | --- |
| 对象属性 | 不写入该属性 |
| 数组 | 保留位置（留洞） |
| `Set` | 不添加该元素 |
| `Map` | 跳过整条 entry（键或值被丢弃时都跳过） |
| 根节点 | `data` 为 `undefined` |

其他要点：类实例保留原型；访问器属性以 getter 求值结果克隆（不二次触发）；`Map` 的 **Symbol 键**按 `String(key)` 生成路径（不会再触 `ToString(Symbol)` 抛错）；节点的类型判定与外壳构造（`instanceof` / `getTime()` / `Object.getPrototypeOf`）也在错误处理范围内——被代理过的 Date/RegExp/Map/Set 触发陷阱抛错时按节点落 `cloneError` 并咨询 `onError`（异步路径），而不是冒成一条路径含糊的驱动层错误；`customCloner` 抛错语义在同步/异步路径**完全一致**（落账 → 咨询 `onError` → 继续丢子树 / 中止抛 `SnapshotAbortError`）。

`SnapshotManager.compareSnapshots(snapshot1, snapshot2): SnapshotDiff` —— 传入两个完整的 `SnapshotResult`，而非 `.data`；纯函数实现，不依赖实例状态。数组逐元素比较，`Set` 无序匹配，`Map` 键引用匹配失败后做结构匹配。递归按对象对识别循环，等价循环不会仅因重复进入而产生差异；自有 `undefined` 属性的新增 / 删除与键缺失不同，分别报告 `kind: 'added' | 'removed'`，继承属性不参与。逐路径展开的深度护栏（100 层）保留，但**超出护栏不再无条件记为差异**：退化为迭代式 `deepEqual`（深度预算不限），只有内容确实不同才 `changed`——两侧逐字节相同的超深结构不再永远报差异而让上层缓存全量失效。同步克隆 `cloneDeep` 是**递归**实现（栈深＝数据深度，默认 `maxDepth: 100` 兜住）；超深结构请用异步路径。

---

# 三、extras/selector —— 选择器

```ts
createSelector<S, R>(selectorFn: Selector<S, R>, options?: SelectorOptions): Selector<S, R>
createMemoizedSelector<S, R>(selectorFn, equalityFn?): Selector<S, R>
createParametricSelector<S extends State, P, R>(
  selectorFn: (state: S, params: P) => R, options?: { ttl?: number; maxEntries?: number },
): (state: S) => (params: P) => R                       // 默认 ttl 5000 / maxEntries 1000（仅原始类型参数侧）
createStructuredSelector<S, R>(selectors: { [K in keyof R]?: Selector<S, R[K]> }): Selector<S, R>
class SelectorFactory<S, R> { execute(state) / withCacheResult() }
class SelectorComposer { createRetrySelector / createRetrySelectorAsync / … }
```

> 类型别名 `Selector` / `ParametricSelector` / `SelectorComposerInput` 的默认值本轮统一：`ParametricSelector<S extends State = Record<string, unknown>, P = unknown, R = unknown>`（此前三个参数全必填，未标注场景要写满 `ParametricSelector<Record<string, unknown>, unknown, unknown>`）；`SelectorComposerInput` 新增可选第三参数 `R`，`combiner` 的返回位由它给出（两参数旧写法取默认 `unknown`，运行行为不变）。显式传参的既有用法逐字不变。

| `SelectorOptions` | 默认 | 说明 |
| --- | --- | --- |
| `cache` | `true` | 是否启用缓存 |
| `cacheSize` | `10` | 历史条目容量；归一化为 `Number.isFinite(v) ? Math.max(1, v) : 10`（`0` / 负数夹到 1，不会关掉历史命中）。与 `cacheTTL` / `equalityFn` 一样只在 `cache: true` 时被读取 |
| `cacheTTL` | `5000` | 缓存生存时间（毫秒）；**不校验取值**：`<= 0` 每条立即过期，`NaN` 让过期判定恒为 false（永不过期），请传正数 |
| `equalityFn` | `deepEqual` | 无状态版本号时的回退比较器——**比较的是输入状态**（`S` 形状）而非选择器结果；形参为 `unknown` 是必需的（本类型不随 `S` 实例化） |

- `createSelector` / `SelectorFactory` 的版本化缓存命中要求**状态对象身份与版本号同时相同**（O(1) 比较）；不同 Store 即使版本号相同，也不会串用结果。状态不带版本号（如传入普通对象）时回退 `equalityFn`；版本号存在但内容被就地改过时按版本判定，条目为版本化而输入是无版本号的普通对象时一律 miss。
- `createParametricSelector` 按参数分别缓存；`ttl: 0` 表示条目立即过期（等同禁用缓存，每次调用重新计算），`maxEntries` 控制原始类型参数侧的容量并在写入前清理过期项。**对象参数侧是 WeakMap，只有读侧 TTL 判定、没有容量上限与清扫**；以复用对象为参数时，原地改内容会拿到陈旧结果（要换引用）。Map / Set 参数的缓存标记用数组承载条目（`['__map', entries]`），用户参数无法伪造标记而串用结果。
- `createStructuredSelector` 以 DefineOwnProperty 语义写入结果（选择器映射含 `__proto__` 键时不会被静默丢弃）。映射的每个键在类型上可选：省略或放非函数值的键会被**静默跳过**，而返回值仍被断言成完整的 `R`——需要完整性请用 `Record<keyof R, Selector<…>>` 显式声明。
- `createStructuredSelector` 与 `SelectorComposer.combine` **需显式给出状态类型参数**：`S` 只出现在「对另一类型参数取索引」的嵌套位置（`Selector<S, R[K]>` / `Selector<S, unknown>[]`），TS 无法据此反推并会退回约束 `State`
- `SelectorComposer.createObjectSelector` 对状态的**每个键**应用选择器并返回同键名对象（`K` 须为 `keyof S` 中排除 `symbol` 的全部键，而非某一单个键）
- 重试选择器抛出的错误带**不可枚举**的 `attempts` 属性，记录真实执行次数；`shouldRetry` 自身抛错被隔离为一条 `console.error` 并按「不再重试」处理（抛出的是原始错误 + 真实 `attempts`），异步变体的 `delay` 函数抛错按 0 等待继续。**没有取消入口**：已在执行的 selector 无法打断，提前停止只能由 `shouldRetry` 返回 `false` 表达

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
| `sharedLoadingCounts` | — | 共享引用计数表，**仅构造期读取**（`setOptions()` 会忽略它）；由 `withLoading` 内部注入，供跨 loader 实例集中引用计数，外部清空时按兜底值 1 递减、不出现负计数。改 `loadingKey` / `errorKey` / `errorDataKey` / `perActionKeys` 会先给派生键补写复位值再丢弃旧记账 |
| `autoLoading` | `true` | 是否自动维护 loading |
| `autoError` | `true` | 是否自动维护 error |

`wrap` 的 `setState` 为 **`(key, value)` 两参数**签名。`ActionLoader.clear()` 会把 loading / error / errorData 派生键复位后再清内部记账（此前只清账、界面上残留 `loading: true`）。`ActionHistory.getHistory()` 返回的是**容器副本 + 共享条目**：数组本身可随意排序裁剪，条目按只读对待（改 `history[0].success` 会污染后续 `getStats()`）。

## 装饰器

```ts
withLog(name?: string, options?: LogDecoratorOptions)   // options: { sink?, redact? }
withDebounce(delay?: number)                  // 默认 300ms
withThrottle(interval: number, options?)     // 间隔是第一个位置参数
withCache(options?)
withRetry(options?)
withTimeout(timeout: number, options?)
createDecorator(options?: DecoratorOptions)   // 自定义装饰器：{ before?, after?, onError? }
```

| 选项 | 说明 |
| --- | --- |
| `LogDecoratorOptions.sink` | 输出目标（`{ log, error }`），缺省 `console`；生产构建接入统一日志通道或整体 no-op |
| `LogDecoratorOptions.redact` | `(value, phase) => unknown`，`phase` 为 `'args'` / `'result'` / `'error'`。**生产构建缺省只输出摘要**（类型 / 长度 / 键数），不再原样打印参数与返回值；传了 `redact` 即以其为准 |
| `ThrottleDecoratorOptions.leading` / `trailing` | 默认均为 `true`（窗口结束时以**最新参数**补发） |
| `ThrottleDecoratorOptions.assumeAsync` | 默认 `false`；为 `true` 时被抑制的调用也返回 Promise（用于「非 `async` 语法但返回 Promise」的方法） |
| `CacheDecoratorOptions.ttl` / `keyFn` | 默认 `5000`；并发同参调用会 in-flight 去重。`keyFn` 抛错时该次调用退化为「用一次性唯一键、直接执行原方法且不写缓存」，不再让整个业务方法失败（非生产期一条 `[Cache] keyFn threw` 调试日志） |
| `RetryDecoratorOptions.retries` / `delay` / `shouldRetry` | `retries` 是**首次执行之外**的最大重试次数（总尝试 = `retries + 1`）；`shouldRetry` 收到的是规范化后的 `Error`（`throw 'str'` 被包成带原文的 Error），它抛错按「不再重试」处理；对外抛出的仍是原始值 |
| `DecoratorOptions.before` / `after` / `onError` | `before` 返回 Promise 时整次调用降级为异步并等它 settle，其 rejection 走 `onError`；`after` 返回 Promise 时只有被装饰方法本身异步才被接回返回值（同步路径就地兜住 rejection 并记日志）；`onError` 收到规范化 `Error`，且**自身抛错只记日志、不顶替原始失败** |

> `createDecorator` **不再把同步方法包成 `async`**：同步方法原样同步返回，返回 Promise 的方法才返回 Promise（此前 `const v = obj.method()` 这类按同步契约取值的调用方会拿到 `Promise`）。装饰非函数描述符（`get` / `set`）在装饰阶段即抛 `TypeError`；包装函数保留原方法的 `name` 与 `length`。
> `withTimeout(ms)` 在工厂阶段归一化：`0` / 负数 / `NaN` / `Infinity` 直接抛 `RangeError`（不等方法执行才炸），有限值截到 `2^31-1`；超时错误是普通 `Error`，`Timeout after <n>ms` 属稳定文案（改动即破坏性变更），按文案匹配时注意 `executeWithTimeout` 用的是 `Action timeout after <n>ms`。

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
- `maxSize` 一律规范化为「有限、非负、整数」（负数会让此前的 `while (length > maxSize) shift()` 在空数组上死循环）；`setOptions({ maxSize })` 与构造器同守卫
- `getMetrics()` / `getMetricsByType()` / `getRecentMetrics()` 返回**元素副本**（不再交出内部数组或其成员引用）；`MetricsCollector.getAll()` 只复制数组容器、元素与内部共享，按只读对待
- `analyzeBottlenecks()` 返回的是**全部出现过的操作**按 `avgDuration` 降序分组（未超阈值的记 `severity: 'low'`），不是过滤后的瓶颈子集；分级门槛为均值的 2x / 3x
- 阈值预警的 logger 收到的是记录副本（含 `memoryUsage`），`sampleRate` / `threshold` 在构造与 `setOptions` 两侧都归一化
- `wx.getPerformance()` 的结果按**监控器实例**缓存并校验（不可用形状 / 工厂抛错 / 读数非有限值均降级 `Date.now`）：避免每次计时都新建对象，也避免不同原点的时间戳互减得到失真耗时
- `analyzerPlugin` 自动接入 dispatch / setState / getter 计时；`onError` 时按**来源**精确清理未完成的配对栈（无关来源如 `persistence` 一条不弹）；卸载时若 `store.getter` 已被后续插件重新包装则跳过恢复并告警，且包装内以开关短路，之后不再向已清理的 monitor 写指标

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
| `storage` | 自动探测 `wx` 同步存储，否则内存 | **必须同步且三方法齐备**：`{ getItem, setItem, removeItem }`。缺任一方法在 `store.use()` 安装期即抛 `TypeError`（不再静默回落到别的后端）；返回 Promise 的实现在恢复 / 落盘 / 清理三条路径上各自明确报错（`wx` 适配器同样受检，Taro / uni-app 类 Promise 版 polyfill 下不再变成未处理 rejection） |
| `filter` | 全量 | `(state) => Partial<state>`，指定落盘子集（未被持久化的键保留初始值） |
| `validate` | — | 恢复前的数据校验 |
| `debounce` | `0` | 写入防抖（毫秒）；卸载时会**同步补写**窗口内最后一次变更 |
| `clearOnUninstall` | `false` | 为 `true` 时卸载改为清理存储（丢弃待写数据）；删除失败不再被吞掉，会记 `console.error` 并 `emit('onError', …, 'persistence')` |

`WxStorageBackend` 封装 `wx.getStorageSync` / `setStorageSync` / `removeStorageSync`：`getStorageSync` 对缺失键返回**空串**，故 `getItem` 只把非空字符串视为有数据（`''` 与 `undefined` 同按「键无数据」处理）；三个方法的存储故障一律记录后**抛错**交给调用方（`getItem` 返回 `null` 只代表无数据，不代表读失败——混用会让下一次落盘覆盖真实数据）。不传 `storage` 且检测不到 `wx` 同步存储时降级为内存存储：开发模式 `console.warn`，**生产模式改经 `onError` 钩子上报**（`emit('onError', error, 'persistence')`），持久化静默失效从此可被监控发现。

`timeTravelPlugin(options?)` 另注意：`importHistory()` 会跳过 `state` 为数组或自持 `__proto__` 自有键的畸形条目（此前入栈后 `goTo` / `undo` 会在核心抛错）；`undo` / `redo` 在回放成功后才推进索引。

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
- `fallback` 计算函数自身抛错时**重抛原始错误**（不丢失现场），且不重复触发 `onError`（`onError` 已就原始错误触发）
- 非 `Error` 的抛出值（`throw 'str'` / `throw 42`）在入口处归一化为 `Error` 后再写入 `errorHistory`、传给 `onError` 与 `fallback`；**重抛时仍是原始值**，捕获方语义不变
- 显式 `recoverable: true` 而未配 `fallback`（或 `setFallbackState(undefined)`）时 `execute` / `executeAsync` 返回 `undefined`，返回类型为 `T | F | undefined`
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
- `recover(error, context)` 的 `error` / `config` / `attempt` 由库内后写，调用方传入的同名字段无法覆盖实际执行的策略与重试记账键；`attempt` 现反映真实重试次数（此前恒为 0，仅诊断用途）
- 策略回退优先级：`fallbackFn` 在前、`config.fallback` 在后，两者皆缺则抛错；`fallback` 的值可以是 `undefined`（判据是「键是否存在」，别用展开 / 序列化搬运 config）
- `RESTART` 策略不接受配置（库内无引用，只上报意图）

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

> `batchInterval` / `batchThreshold` / `reportTimeout` 用 `??` 兜底，**显式传入的 `0` 是合法语义**（立即 / 无延迟），不会被替换为默认值；`reportTimeout <= 0` 一律按「不超时」处理（不创建定时器，直接等 reporter 任务）。

- flush 对每个 reporter 做 `ok / fail / timeout` **三态判定**：仅真正 resolve 才算成功；超时告警后批次重入队（上报先落地时取消未到期的定时器，不留句柄）
- `flushReports()` 排空的是**入口时刻**在册的批次；`isFlushing` 期间的并发调用不会追加排空保证（关闭时的最终 flush 才保证排空）
- `clear()` 同时复位「连续全部失败」计数（否则新批次会被上一次的失败次数提前判定丢弃），但**不停止调度器**
- 聚合统计：`getStats().byStore` 与错误组同生命周期，组被 `maxGroups` 驱逐时对应计数一并删除，故 `sum(byStore) === totalErrors` 长期成立；`ErrorGroup.sampleError` 是只含标量字段 + `error` 引用的浅拷贝（**不含 `payload`**，避免进程级缓存钉住 store / 页面节点），并随每次命中刷新为最近一次出现
- 定时器做 `unref` 探测（小程序 / 浏览器无该 API 时自动跳过，不阻止进程退出）

## 上报器

```ts
class ConsoleReporter implements ErrorReporter   // 基础库缺 console.group 时降级为平铺输出
class HttpReporter implements ErrorReporter      // 自动选择 wx.request（校验 statusCode）或 fetch（校验 ok）
defaultErrorHandler / createErrorContext / ErrorHandlerImpl
```

- `ConsoleReporter` 保证 `groupEnd` 恰好一次（`console.group` 存在但调用即抛的基础库下本次降级为平铺输出，并只试探一次）；分组与平铺两条路径打印的字段与批量级别标签一致，残缺 context（缺 `level` / 非法时间戳）不会让上报自身抛错
- `HttpReporter` 对 `Headers` 形参数走鸭子类型归一化（真实 `Headers` 实例没有自有可枚举属性，此前被展开成空对象而丢请求头），并把 `timeout` 透传给 `wx.request`；其余 `RequestInit` 字段在 `wx` 分支被忽略。请求体由 `JsonBody` 直接序列化为字符串，不再走 `stringify → parse → 再 stringify`
- `defaultErrorHandler` 按级别映射输出通道；`throw null` / `throw 'str'` 之类的抛出值在读取 `message` / `stack` 前统一兜底（非字符串按 `String(error)` 收口），处理器自身不再因取值崩掉而顶替原始失败

---

# 八、extras/enterprise —— 企业微信集成

```ts
createUserStore(config)                // 账号态 Store 工厂：{ userId, syncUrl?, initialState? }
class StoreManager { getUserStore / switchUser / logout / getCurrentStore / clearAll }
export const storeManager: StoreManager
initHotUpdate(config) / restoreFromHotUpdate()
class OfflineManager { execute / syncQueue / getQueueLength / getDeadLetters / dispose }
initBackgroundSync(config) / unregisterBackgroundSync()
createEnterpriseApp(config): Plugin
```

- `getUserStore(userId)` 只「取 / 建」指定账号的 store，**不改变当前登录身份**（切换请显式 `switchUser`）；被 LRU 淘汰或 `logout()` 后的 store 已 `destroy()`，不可继续 dispatch；`clearAll()` 只清内存实例，不动存储键（连带删数据会越权，注销请用 `logout()`）

- `createUserStore` 对 `userId` 严格入口校验：非字符串、空串或纯空白直接抛错（畸形键会让不同账号撞同一存储键）。`syncWithServer()` 先校验响应体再 resolve：`statusCode` 为 2xx 但没有 `userInfo` 对象时 **reject**；同步地址由 `syncUrl` 配置（有模块默认值）。`lastSyncTime` 是**会话级**字段，刻意不持久化（重启后由 `syncWithServer` 重新写入）
- `StoreManager` 为真正 LRU（命中刷新顺序），且不会淘汰当前登录用户的 store；无可淘汰候选（只剩当前用户）时会告警而非静默超限；`switchUser` 会写回「当前用户」键（此前只有 `login` 写，其它入口换号后冷启动会恢复旧身份）
- `initBackgroundSync` 包装全局 `App` 构造器注入 `onShow` / `onHide`（修改 `App.prototype` 在微信中不生效）；注册表在重装包装器时**保留**（清空会静默停用其他模块的前台回调），同一份 `App` 配置被重复包装是幂等的
- `OfflineManager`：`execute(type, action, payload)` 的契约是**失败不外抛**——在线执行抛错时记 `logger.error`、入队并返回 `null`（＝本次未执行、已交队列重放），重放唯一入口是 `syncQueue`，按 `(type, payload)` 组装（传入的 `action` 闭包不会被重放）。`getQueueLength()` 不含在途段；`getDeadLetters()` 与 `syncQueue` 同口径过滤损坏条目并告警丢弃条数；已 `dispose()` 的实例上 `execute` 会告警「不会重放」并返回 `null`。同步期间落盘完整联合队列视图；未知 action 走重试 → 死信路径
- 热更新：备份在用户确认时执行；写入失败则不写待更新标记并跳过 apply；备份时间戳非有限值按「已过期」处理（不再静默绕过过期清理）；`createEnterpriseApp` 的 `onLaunch` 四步各自兜异常，热更新失败不再让后台同步与离线队列永不初始化
- 集成层的调试入口（`exposeStoreAPI` / `devtoolsPlugin`）默认以**只读**订阅注册（回调收到只读保护 Proxy；需要就地改载荷请显式传 `{ readOnly: false }`），注入的成员按自有属性写入并在解绑时恢复宿主原值（`__proto__` / `constructor` 不再污染原型链）

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
