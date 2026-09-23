# 架构设计

本文讲**分层、依赖方向、模块职责与设计取舍**。它不复述行为契约——契约的正本是 [CONCEPTS.md](./CONCEPTS.md)（机制语义）与 [API.md](./API.md)（默认值与逐 API 契约）；构建与发版操作的正本是 [CONTRIBUTING.md](../CONTRIBUTING.md)。下文凡是涉及这些内容的地方，都只留架构视角的一句话结论并链接过去。

## 目录

1. [设计目标与约束](#1-设计目标与约束)
2. [分层与依赖方向](#2-分层与依赖方向)
3. [目录结构与职责](#3-目录结构与职责)
4. [核心模块](#4-核心模块)
5. [可选能力层（extras）](#5-可选能力层extras)
6. [集成层（integrations）](#6-集成层integrations)
7. [插件层（plugins）](#7-插件层plugins)
8. [关键数据流](#8-关键数据流)
9. [构建与产物](#9-构建与产物)
10. [质量门禁](#10-质量门禁)
11. [刻意保留的取舍](#11-刻意保留的取舍)

## 1. 设计目标与约束

| 目标                               | 约束下的做法                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| **小程序优先**：主包体积是第一约束 | 核心只保留运行必需 API（`extras/index.ts` 之外，可选能力全部走 `extras/*` 子路径按需引入）          |
| **视图层开销可控**                 | 脏追踪（`isStateKeyDirty`）让集成层跳过未变化的 `setData`；通知可合并（`notify.async`）             |
| **行为可观测**                     | 统一的错误账本（`errors` + `onError` 降级）、性能指标采集、快照隔离                                 |
| **类型完备**                       | 公共契约集中在 `src/types`，实现层引用契约；`PageThis` / `ComponentThis` 等集成类型保证 `this` 精确 |
| **纯 ESM**                         | 源码/测试/脚本一律 `import`，构建产物为 ESM 并写入 module-type 标记                                 |

## 2. 分层与依赖方向

```
             ┌────────────────────────────────────────────┐
 入口层      │ src/index.ts → core/index.ts                │
             │ extras/*（snapshot|selector|action|…）       │
             └───────────────┬────────────────────────────┘
                             │ 只能向下依赖
             ┌───────────────▼────────────────────────────┐
 能力层      │ core/store   core/cache   core/compose      │
             │ core/hooks   core/performance  core/utils   │
             └───────────────┬────────────────────────────┘
                             │
             ┌───────────────▼────────────────────────────┐
 集成/插件层 │ integrations/*（withPageStore / enterprise） │
             │ plugins/*（builtin / devtools / performance）│
             └───────────────┬────────────────────────────┘
                             │
             ┌───────────────▼────────────────────────────┐
 契约层      │ types/*（store|action|selector|error|…）     │
             └────────────────────────────────────────────┘
```

**强制规则**：

- `core` **不得**反向依赖 `extras` / `plugins`（钩子与插件运行时的契约放在 `core/hooks` + `types/plugin.ts`，plugin 实现只依赖契约）
- `extras` 可以依赖 `core`；`extras/*` 之间尽量不互相依赖
- 契约统一放 `src/types`，实现层不重复定义公共类型；`src/types/**` **只放类型与接口**，不得有运行时导出（类 / 函数 / 常量）。带 `wx.*` I/O 的 `WxStorageBackend` 曾是唯一违反者，现已迁到 `src/plugins/WxStorageBackend.ts`（公开子入口不变）：运行时实现住在那里会让「`types/*` 可被 `import type` 整体擦除」的假设失效，`verbatimModuleSyntax` 的消费者无法把 `types/*` 当纯类型看

## 3. 目录结构与职责

```
src/
  index.ts                      re-export core（主入口 = 核心）
  core/
    index.ts                    核心 API 汇总（Store/工厂/工具/钩子/集成/组合/LRU）
    store/                      Store 门面与运行时职责拆分
    cache/                      LRUCache（容量淘汰 + TTL + 统计）
    compose/                    composeStore / StoreRegistry / 合并与辅助
    hooks/                      HookSystem 与 usePlugin
    performance/                PerformanceMonitor / AsyncBatchNotifier / metrics
    utils/                      helpers（深合并/相等/克隆/ID）与 equality
    errors/                     核心层错误基础设施
  extras/
    index.ts                    可选能力聚合入口（体积最大，仅调试用）
    snapshot.ts / selector.ts / action.ts / performance.ts / plugins.ts / enterprise.ts
                                ← 逐能力的公开子路径入口
    snapshot/                   同步 + 异步克隆引擎、diff、管理器
    selector/                   SelectorFactory / 组合器 / 重试
    action/                     ActionLoader / withLoading / ActionUtils / ActionExecutor
      decorators/               withLog|Debounce|Throttle|Cache|Retry|Timeout + common
    error/                      ErrorBoundary / ErrorRecovery / ErrorMonitoring / 类族
      reporters/                ConsoleReporter / HttpReporter
  integrations/                 withPageStore / withComponentStore / withAppStore / utils
    enterprise/                 账号态、离线队列、后台同步、热更新
  plugins/                      builtin（logger/persistence/devtools）/ WxStorageBackend / globalRegistry
    devtools/                   timeTravelPlugin
    performance/                analyzerPlugin
  types/                        公共契约（store/action/selector/error/…）：**只放类型与接口**，不得有运行时导出（类 / 函数 / 常量）
```

本文件**不写各目录的文件数与行数**：那两个数没有谁据以行动，却保证随每次拆分失真；要数当场 `find src -name '*.ts'`。文档门禁守的是更有意义的不变量——上面这棵树里点名的每个 `src/` 子目录都必须真实存在（`G12`）。

## 4. 核心模块

### 4.1 `core/store`：门面 + 运行时职责拆分

`Store` 是**门面**，把运行时关注点拆给专职对象（都通过构造期装配，运行期无动态创建）：

| 文件                                 | 职责                                                                                                                                                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Store.ts`                           | 公开 API 门面：状态读写、快照/恢复、缓存开关、订阅、批量、插件安装、销毁守卫；`getter(name)` 直转 `GetterManager.execute`——**Store 侧不存在 getter 结果缓存**（`GetterManager` 只持 `_storeName / _getState / _getters` 三个字段，无 memo 表、无比版本复用），记忆化归 `extras/selector`                  |
| `factory.ts`                         | `createStore`：选项归一化（默认值、状态工厂求值、缓存配置）                                                                                                                                                                                                                                               |
| `StateProxy.ts`                      | 状态保护：深/浅/数组代理拦截非法写入；Action 可写脏跟踪由 `dirtyTracking.ts` 单独实现。get 陷阱在包装前先兑现 Proxy `[[Get]]` 不变量——自有数据属性「既不可配置也不可写」时原样返回裸值（深代理与数组代理同口径，判据与 `dirtyTracking.ts` 的既有守卫一致），代价是这类子树不受写保护、不计数              |
| `dirtyTracking.ts`                   | 默认与 `onlyOnChange` 模式共用的 Action 可写代理；跟踪变更计数与所有受影响的顶层脏键                                                                                                                                                                                                                      |
| `ActionManager.ts`                   | dispatch 生命周期：深度计数、action 上下文、仅最外层通知、异步 action 的**同步段当场补发一次** + 结算再补发一次、`onError` 钩子。通知时点的完整语义与开关见 [CONCEPTS §2](./CONCEPTS.md#dispatch-的通知时点)                                                                                              |
| `SubscriptionManager.ts`             | 订阅注册/退订/上限策略（引用计数；重复订阅计次；`maxSubscribers` 是**每一次注册**都过的硬上界，达限按 `throw` / `evict-oldest` 处置并把驱逐事件交给宿主的 `onError`）                                                                                                                                     |
| `BatchManager.ts`                    | 批开始/结束与嵌套；批内变更基线                                                                                                                                                                                                                                                                           |
| `StoreCache.ts`                      | 缓存开关、按键失效与统计（`enableCache` / `invalidateCache` / `getCacheStats`）。**读侧只有一个入口**：`getCached(key)`；`getState()` 直接返回内部状态引用、不查缓存也不计未命中，`setState` / `$patch` 是**写穿**（回写条目、不删条目），显式失效只有 `invalidateCache()` 与 `$replaceState`（整表清空） |
| `stateVersion.ts`                    | 状态版本号：为**选择器**与缓存失效提供 O(1) 变更判定（getter 不读它——Store 侧无 getter 结果缓存）                                                                                                                                                                                                         |
| `pluginSupport.ts`                   | 插件安装与回滚、钩子接线                                                                                                                                                                                                                                                                                  |
| `types.ts` / `utils.ts` / `index.ts` | 局部类型、内部工具与出口                                                                                                                                                                                                                                                                                  |

**写入追踪**：`setState` / `$patch` / `$replaceState` 三个入口共用 `core/utils/helpers.ts` 导出的 `PROTO_SENSITIVE_KEYS` + `defineOwnProperty` 一份判据，Action 侧走独立的可写脏跟踪代理。**这三者对外的契约（写穿而非失效、敏感键按自有数据属性承载、脏跟踪覆盖面与集合代理白名单）以 [CONCEPTS §1](./CONCEPTS.md#1-状态state)、[§2](./CONCEPTS.md#脏跟踪的覆盖面)、[§6](./CONCEPTS.md#6-缓存cache) 为正本，此处不复述。** 架构侧只留下面这条归属索引的取舍。

**归属索引的三档维护**（`dirtyTracking.ts`，索引形状是 `对象 → 可达它的顶层键`，构建与查找都不求值访问器，因此能识别未读取的别名与环）：按一次写入对被索引图的影响分三档，代价与保真度都不一样——

- `EDGE_ADDED`（纯新增边）：只把容器归属键并入新子树，子树里已覆盖同批键的节点直接剪枝。
- `EDGE_STABLE`（图不变）：原样复用索引。包括标量改写、`Set` 重复 `add`、数组 `length` 变长只造空洞、**实例方法调用**。方法调用归这一档是有意的：重建发生在 `Reflect.apply` 之前、看不到方法体新增的边，等于把整图原样再推一遍，是纯开销；而方法体的写入以原始对象为接收者、本就不走陷阱，改前改后都归因不到它，解析不出归属时由「标记全部顶层键」兜底（多报不漏报）。
- `EDGE_REMOVED`（删边）：覆盖已有对象值、`delete` 对象值键、`Map#set` 覆盖值已是对象的键、`Map` / `Set` 的 `delete` / `clear`、经访问器写入（自有 setter，或自有属性缺席时命中原型链上的 setter——setter 改哪些边不可知），以及状态版本被外部推进。这些一律退化为**全量重建**。

退化是**有意的保守**：删边后旧子树是否仍可达判不准，而猜错的后果是漏报——漏报等于变更对页面永久不可见，这比多花一次重建严重得多。

### 4.2 `core/cache`：LRUCache

容量淘汰 + TTL + 统计（`hits` / `misses` / `avgAccessTime` / `missRate`；`enableStats` **默认为 `true`**，关掉后 hits/misses 恒为 0）。构造与 `resize` 对 NaN/Infinity 回退默认值；`forEach` **进入时取键快照**：回调内删除或重排都不会漏访问、也不会回调已删条目，遍历期间新写入的键本次不访问，值取回调时刻的当前值。Store 的键级缓存建立在其上。

### 4.3 `core/compose`：组合 Store

- `composeStore(stores, { namespace, strict })`：命名空间模式下子 store 按 `name` 嵌套，dispatch 支持 `'store/action'`
- 组合层 N 个监听器只占用每个子 store **一份**订阅（避免成倍挤占外部直连订阅的额度）
- 子 Store 以**只读**订阅注册，通知因此免深拷贝；组合层自己仅在存在可写监听器时对合并结果深拷贝一次（与 `Store._notifyListeners` 的 `hasWritableListeners()` 判据同口径；单 Store 侧更进一步按注册分配拷贝，组合层是「一轮一份」的有意差别）；`isStateKeyDirty` 在命名空间模式下精确追踪脏子 store（键型 `string | symbol`），通知回调内的重入写入归下一轮。投递集合与次数都在进入本轮时快照，回调内退订自己不会截断同一轮剩余的投递
- `getState()` / `state` 读取合并缓存前校验子 Store 版本，批内及异步通知前也能读到最新值；无版本号的子 Store（含嵌套组合）每次读取保守失效
- **子 store 在组合之外被独立销毁**：三条读路径（`getState()` / `state` / `$snapshot()`）的 pick 与平铺模式的归属判定（`compose/helpers.ts` 的 `findTargetStoreWithKey`）统一走「已销毁即跳过」，把死店按**空视图**并入、按 store 去重**一次性告警**（`_warnedDestroyedChildren` WeakSet / helpers 的 `warnDestroyedChildOnce`），与写侧 `applyToStore` 同一判据——0.6.x 是读侧每次调用都抛 `Cannot call getState on a destroyed Store`、写侧却静默跳过，读写口径互不一致且一个子店废掉整个组合。合并缓存的新鲜度判定把「已销毁」编成版本哨兵 `-1`（`_childVersion`），避免死店此前并入的键被当作新鲜数据继续读
- 合并子 Store 的 `actions` 注册表，嵌套组合支持外层裸名 dispatch；非命名空间模式同名 action 取第一个 Store
- `StoreRegistry` / `globalRegistry` 提供按名字管理

### 4.4 `core/hooks`：钩子与插件运行时

`HookSystem` 提供 `on` / `emit` / `size` / `listenerCount`；`usePlugin` 是独立于 Store 方法的安装入口。契约来自 `types/plugin.ts`，因此插件实现（`plugins/*`）与核心之间是**依赖契约而非依赖实现**。

### 4.5 `core/performance`

`PerformanceMonitor`（`start()` 与 `record()` 都会顺手清理超时未结束的在途计时条目；`record()` 先把入参拷一份再入缓冲区，不持有调用方对象）、`MetricsCollector`、`AsyncBatchNotifier`。**实现保留在 core**（被 store 与插件共用），对外入口在 `extras/performance`。

## 5. 可选能力层（extras）

### 实现位置与入口的关系

可选能力的**实现**位于 `extras/*`，**入口**是同目录的 barrel（`extras/xxx.ts`）。这样安排有两点收益：

1. 依赖方向诚实：核心不「物理包含」只有少数用户需要的能力，`core` 的引用图即可证明主包不含它们
2. 深链内部路径的行为可预测：`src/extras/snapshot/...` 与公开入口同目录，不会出现「入口在 extras、实现在 core」的错位

**例外**：`cache` / `hooks` / `performance` 的实现保留在 `core`（`core/store` 直接依赖 `LRUCache`、`HookSystem`、`AsyncBatchNotifier`），仅入口在 `extras/*`。

### 体积模型

```
主入口（core）            常驻：Store / 集成 / 组合 / LRU / 工具 / 钩子
extras/snapshot           需要快照时引入
extras/selector           需要选择器缓存时引入
extras/action             需要 ActionLoader / 装饰器时引入
extras/performance        需要指标采集时引入
extras/plugins            需要内置插件实现时引入
extras/error              需要错误边界 / 恢复 / 上报时引入
extras/enterprise         需要账号态 / 离线 / 热更新时引入
extras（聚合）            仅调试或全都要用；会把以上全部拉入产物
```

## 6. 集成层（integrations）

`with-store.ts` / `with-app-store.ts` 共用 `resolveMappings`（解析 `mapState` / `mapGetters` / `mapActions` / `inject` 的数组与对象两种写法），差异只在生命周期接线：

| 集成                 | 订阅建立              | 订阅清理                                     |
| -------------------- | --------------------- | -------------------------------------------- |
| `withPageStore`      | `onLoad`              | `onUnload`                                   |
| `withComponentStore` | `lifetimes.attached`  | `lifetimes.detached`                         |
| `withAppStore`       | 包装全局 `App` 构造器 | 不做清理（生命周期贯穿运行期，仅防重复绑定） |

Page 的 `onUnload` / Component 的 `lifetimes.detached` 先调用用户钩子，再在 `finally` 中清理绑定，即使钩子同步抛错也会清理；用户钩子的同步段仍可使用映射 actions。包装器不等待异步钩子的 Promise，`await` 后不能依赖绑定仍存在。

**只识别 `lifetimes` 写法**（基础库 3.15.0+）；组件 methods 上的运行时注入改为实例级拷贝，多实例挂载不互相覆盖。

`enterprise/` 提供账号态 Store、离线队列、后台同步与热更新；`initBackgroundSync` 包装 `App` 构造器注入 `onShow` / `onHide`（改 `App.prototype` 在微信中不生效）。

## 7. 插件层（plugins）

| 插件                                  | 说明                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `loggerPlugin`                        | 打印 dispatch 的 action 名与实参数组、afterDispatch 的返回值、`before`/`afterSetState` 的键值，外加一条**只读订阅**打印整份状态；**不计时**（要耗时请用 `extras/performance` 的 `analyzerPlugin`），`NODE_ENV=production` 下整体静默 |
| `persistencePlugin(options)`          | 状态持久化；后端必须同步且三方法齐备，卸载时同步补写防抖窗口内容；降级与恢复被跳过都走 `onError`。插件路径与直接 `new WxStorageBackend()` 的**两条不同判据**见 [CONCEPTS §11](./CONCEPTS.md#调试表与持久化)                          |
| `devtoolsPlugin` / `timeTravelPlugin` | 调试与时间旅行（卸载带身份守卫，只清理属于本实例的全局项）                                                                                                                                                                           |
| `analyzerPlugin`                      | 接入 dispatch / setState / getter 计时；`onError` 精确清理配对栈                                                                                                                                                                     |

插件在 `NODE_ENV=production` 下的安装/卸载日志静默；安装抛错会回滚入列。

## 8. 关键数据流

### 8.1 一次 `setState`

```
setState('count', 1)
  → 销毁守卫 → 保护代理判定合法
  → 敏感键走 defineOwnProperty（__proto__ / constructor / prototype：承载为自有数据属性、不换原型），其余按 [[Set]] 写入
  → 写入状态 + 推进版本号 + 脏计数 +1
  → 写穿缓存条目（cacheManager.set）；此处不失效、不计未命中——显式失效是 invalidateCache()，整体清空是 $replaceState()
  → beforeSetState / afterSetState 钩子（插件、监控在此接入）
  → 通知调度：notify.async 决定立即或微任务合并；载荷形态按「本轮有没有可写注册」决定（notify.clone 未显式配置＝自动，显式 true 强制拷贝），需要拷贝时由 SubscriptionManager **按注册分配**：可写注册各一份独立深拷贝、只读注册共用一份
  → 监听器收到新状态；isStateKeyDirty('count') 为 true → 集成层更新 setData
```

### 8.2 一次 `dispatch`

```
dispatch('load', id)
  → _enterDispatch()（深度 +1，用于「仅最外层通知」判定）
  → 记录 onlyOnChange 基线计数
  → 执行 action（this = action 上下文；该上下文是每次 initialize 现造的 Proxy，不对外暴露，
     所以 withDebounce / withThrottle 的 cancel*/flush*/dispose* 在 store action 上定位不到槽位）
      ├─ 同步返回：深度归零且非 batch 时通知（onlyOnChange 下比对计数）
      └─ 返回 Promise / thenable：注册 .then 之前先按「同步段有没有写入」补发一次（默认模式因此一轮两次通知，
         onlyOnChange 用与结算同一条计数判据去重；batch 内不提前补发），再注册 onSettled（结算覆盖续段），
         失败同时补发 onError 钩子
  → finally 深度 -1
```

补发同步段的动机：Promise 永不 settle（悬挂请求、被吞掉的回调）时，同步段的写入此前只能等「下一个不相干通知」才浮出来。

### 8.3 一次异步快照

> 对照：**同步** `createSnapshot` 走 `cloneDeep`，是递归实现（栈深＝数据深度），生效上限为 `min(maxDepth, HARD_MAX_CLONE_DEPTH = 1000)`——那个硬上限与调用方选项无关，是栈安全兜底，超出部分按 `maxDepth` 落一条错误 + 占位（`success` 不受影响）；`maxDepth` 传 `NaN` / `Infinity` 也落到硬上限。异步引擎按队列逐节点处理、栈深与数据深度无关，因此**不叠加**硬上限，只按 `maxDepth` 判定。两条路径的克隆语义（`customCloner` 抛错、`ownKeys` 抛错丢节点并从 visited 除名、访问器按描述符里的 getter 求值、Date/RegExp 计一次克隆、数组附加自有键随克隆、`includeNonEnumerable` 下被拷键一律落为可枚举）逐分支同口径，`index.ts` 的「能力概览」写的就是这套；三道准入门槛（`isExactly` 判定内建容器子类、`isSlotBearingBuiltin` 判定内部槽位值、非纯对象降级）与核心 `deepCloneState` 共用同一份判据。

```
createSnapshotAsync(data, options)
  → 根治任务入队（队列 + queueHead 游标，避免 Array#shift 的 O(n²)）
  → 按 batchSize 分片处理，批间 await 让出控制权；推进 processedCount 并回调 onProgress
  → 单节点失败：落账 cloneError → 咨询 onError
        ├─ 继续 → 返回丢弃哨兵；processQueue 跳过填充（prop 占位一并删除）
        └─ 中止 → 抛 SnapshotAbortError
  → 超时：置 hasTimedOut，仅当「仍有未处理任务、或超时后丢掉过入队任务」时才让 success:false
     （收尾竞态下交付的完好克隆不再被判为失败）
  → 汇总 metadata / stats / errors；success = 无 cloneError 且未出现上面那种「未完成」的超时
```

**保留原引用而不是重建的节点**（同步与异步一致）：`Date` / `RegExp` / `Map` / `Set` / `Array` 的**子类实例**，以及值靠内部槽位承载的对象（Promise、装箱原始值、ArrayBuffer / TypedArray / DataView、WeakMap / WeakSet、Error、生成器）。**完整清单、判据与代价是 [CONCEPTS §8](./CONCEPTS.md#保留原引用的两类值) 的正本，此处不复述**；架构侧只有一句话：引擎不为这两类值造副本，因为它们的状态不在自有可枚举属性上、重建必然造出「形状对而语义空」的东西。类实例（原型是普通类）仍重建为同类实例。

`compareSnapshots(a, b)` 在入口有一道**输入可信性闸门**：任一来源 `success === false` 时不逐路径比对，交付一条 root 级整体差异并置 `changed: true`，同时在 `SnapshotDiff` 上给出 `inputTrusted: false`。`changed` 在不可信输入下表达的是「我不敢说没变」，不是「确有差异」。差异路径方言与克隆账本同源，**读法与逐条格式以 [CONCEPTS §8](./CONCEPTS.md#差异比较comparesnapshots) 为准**，此处不复述。

### 8.4 一次小程序 `setData`

```
Store 通知 → 集成层合并订阅回调
  → 对每个映射值判断是否需要更新
      ├─ 原始值：值未变则跳过
      ├─ mapState 对象值：引用未变且顶层键未变脏才跳过
      └─ 无脏键信息的对象映射（如 mapGetters）：保守下发
  → 过滤 undefined，合并补丁；仅有更新时调用一次 setData
```

## 9. 构建与产物

| 环节       | 脚本                                                                | 作用                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 清理       | `prebuild` → `clean-dist.mjs`                                       | 删除旧 `dist`（避免残留过期产物）                                                                                                                                                                                                                                      |
| 编译       | `build` → `tsc -p tsconfig.build.json`                              | 产出 `dist/**`（结构保留，供子路径导出）                                                                                                                                                                                                                               |
| 收尾       | `postbuild-dist.mjs`                                                | 写入 `dist/package.json` 的 `{"type":"module"}` 标记并移除 sourcemap                                                                                                                                                                                                   |
| 压缩       | `minify-dist.mjs`（`build:min` / `build:release`）                  | `build:release` 为**严格模式**：无可用压缩器时以退出码 1 中止                                                                                                                                                                                                          |
| 子路径转发 | `generate-subpath-stubs.mjs`（`prepack` / `postpack`）              | 生成/清理 `store/`、`hooks/`、`plugins/`、`integrations/` 等转发目录，供不解析 `exports` 的老式场景按目录裸导入                                                                                                                                                        |
| 微信产物   | `build-weapp.mjs` + `weapp-entries.mjs` + `verify-weapp-bundle.mjs` | 把 `src` 全部模块一比一转译成 CJS 落进 `dist-weapp/`，由包根 `miniprogram` 字段交给微信「构建 npm」整目录拷贝。**不做 bundle**（会重复内联 core、并让每个入口各持一份模块实例）。入口清单从 `exports` 派生，判据与成因见 [CONTRIBUTING](../CONTRIBUTING.md#构建与发布) |

`exports` 映射是运行时的唯一权威（`.` / `./core` / `./extras` / `./extras/*`）；转发子目录只是为不支持 `exports` 子路径的环境兜底。

## 10. 质量门禁

**本节不重复门禁清单**——清单与 CI 步骤的正本在 [CONTRIBUTING.md 的「门禁」一节](../CONTRIBUTING.md#门禁与-ci-一致必须全绿)，那里只写一次，改只改那里。

从架构角度只有一条需要记住：**分层的依赖方向与入口导出面是有机器守卫的**，不是靠约定。类型面由多套 tsconfig 全量零错误把守；`extras` 不得反向依赖 `core` 之外的层次、禁止 CJS 写法，由 ESLint 规则把守；`exports` 表里每个子路径都必须能被真实加载、且导出面与生成参考逐项一致，由 `pnpm verify:weapp` 与 CI 的 ESM 冒烟把守。覆盖率阈值的唯一事实来源是 `jest.config.js` 的 `coverageThreshold`，文档不抄数值。确实不可达的防御分支用 `/* istanbul ignore … */` 标注并**写明原因**。

## 11. 刻意保留的取舍

| 取舍                                                       | 原因                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 就地变异状态（非不可变）                                   | 小程序场景看重性能与写法简洁；用 `$snapshot()` / `createSnapshot()` 提供隔离副本                                                                                                                                                              |
| 钩子/插件的错误被隔离处理                                  | 监控插件不得因自身异常影响主流程；`onError` 是唯一观察点                                                                                                                                                                                      |
| 持久化后端强制同步                                         | 微信同步存储是主流；异步后端会因竞态导致写入静默丢失                                                                                                                                                                                          |
| 生产模式日志静默                                           | 减少发布包日志噪声；需要被监控发现的问题（持久化降级与恢复被跳过、监听器抛错、**订阅者被驱逐**、落盘 / 清理失败）统一 `emit('onError', …, source)`，排查时也可临时切开发模式                                                                  |
| `customCloner` 抛错不降级为「原值兜底」                    | 宁可丢弃节点也不能让活引用穿透隔离契约                                                                                                                                                                                                        |
| getter 不做结果缓存（记忆化只在选择器）                    | Store 侧要维持「`getter()` 就是按当前状态求值」这一条无需心智模型的语义；版本号与失效判据已经由 `extras/selector` 承担，在 `GetterManager` 再放一份 memo 表就是两套会互相打脸的失效规则                                                       |
| 状态保护对「不可配置且不可写」的自有属性返回裸引用、不拦截 | Proxy `[[Get]]` 不变量不允许代理返回别的值——包了就是读取即抛。豁免是两害相权：读取可用性 > 对 freeze 进来的子树的写保护；同一判据 `dirtyTracking.ts` 早已在用                                                                                 |
| 子 store 独立销毁时组合层读空视图 + 一次性告警，而不是抛错 | 一个子店的销毁不该让整个组合不可用（集成层渲染热线会直接崩）；也不该静默并入旧值——故版本哨兵编成 `-1` 让并入结果作废重算。写侧本来就是这个口径，读写统一                                                                                      |
| 不把 action 上下文作为可寻址宿主暴露给装饰器               | 一旦暴露，「装饰器内部槽位键」就升成跨 core 与 extras 的公开契约；收益只是 `cancel*` / `flush*` / `dispose*` 在 store action 上可用，而该场景已有两条不改公开面的写法（装饰页面/组件方法，或在 store 外包一层）。代价写在 GUIDE 第 3 节与 FAQ |
| `SnapshotDiff.inputTrusted` 是**必填**而非可选             | 该对象只由库产出，返回类型说「一定带这个字段」比可选更诚实；代价是对「自己构造 `SnapshotDiff` 字面量」的调用方构成类型层破坏                                                                                                                  |
| 覆盖率设的是下限而非「必须 100%」，但不为数字改写语义      | 等价改写须可证明；不可达分支用带原因的标注，而非删除防御。文档只引用 `jest.config.js` 的阈值，不写实跑数字，也不留「等收口时填」的空占位                                                                                                      |
