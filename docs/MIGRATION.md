# 迁移指南

本文按版本倒序列出**会影响调用方**的变更。完整变更记录见 [CHANGELOG](../CHANGELOG.md)。

> 版本约定：`0.x` 阶段的行为契约变更会显式标注「Breaking」并给出迁移代码；仅「新增可选项」之类的纯增量不在此列。

## 升级到 0.5.2

第四轮复审（454 条）的修复同步。多数为「原本就该如此」的缺陷修复，本节只列**需要动调用方**或**会改变可观测行为**的点；完整清单见 [CHANGELOG](../CHANGELOG.md)。

### Breaking

- **快照 `onError` 的签名与真值语义**：返回类型改为 `boolean | void`，判定是 `if (!shouldContinue)`——不写 `return` 的箭头函数（`void`）等价于**拒绝继续**。只观测不表态的写法必须改成显式 `return true`：

  ```ts
  // 改前（会把整次快照做成失败）
  createSnapshot(state, { onError: (e) => console.warn(e) })
  // 改后
  createSnapshot(state, { onError: (e) => (console.warn(e), true) })
  ```

- **`persistencePlugin({ storage })` 在 `store.use()` 安装期即校验三方法**：只实现了部分方法的自定义后端会抛 `TypeError`（此前静默回落到 `wx` / 内存）。补齐 `getItem` / `setItem` / `removeItem`，或直接传 `new WxStorageBackend()`。`Store.use` 会原样上抛，`usePlugin` 仍吞掉并 `console.error`。
- **`OfflineManager.execute` 失败不再 reject**：契约改为「失败返回 `null` ＝ 已入队待重放」。原先靠 `catch` 它做重试的代码要改成读返回值 / 队列，否则非幂等操作可能被「自己重试 + 队列重放」执行两次。
- **类型面**：`HookHandler<TArgs, TResult>` → `HookHandler<TArgs>`（`TResult` 删除，`emit` 从不读返回值）；`IHookSystem` 新增必需成员 `listenerCount(hookName)`，自行实现该接口的代码需补方法；`ActionDecorator` 改为 `MethodDecorator` 别名；`ActionResult` 为判别联合（`success: true` 不再带 `error`）；`ActionContext` 默认泛型收紧为 `Actions`（以 `interface` 声明的 action 集合需改 `type` 别名）；`withAppStore` 的映射类型改按实参推断。
- **Store 品牌 Symbol 键更名**为 `Symbol.for('@openlide/geomstore:brand')`。`isGeomStore()` 用法不变；直接读旧键 `Symbol.for('__geomstore_brand__')` 的代码需同步。
- **`createUserStore({ userId })` 拒绝空 / 纯空白 userId**（抛错）；**`syncWithServer()` 在响应体缺 `userInfo` 时 reject**。依赖「失败也 resolve」的调用方需加 `catch`。
- **`setStateProtection()` 在 Store 销毁后抛错**：与 `setState` / `$patch` / `subscribe` / `use` / `cache` / `batch` 同口径；只读的 `isStateProtectionEnabled` / `getStateProtectionConfig` 仍可用。

### 行为变更（无需改代码，但断言 / 监控需复核）

- **装饰器不再把同步方法包成 `async`**（`createDecorator` 及其派生装饰器）：同步方法按同步取值；`before` 返回 Promise 时整次调用才降级为异步。
- **`withLog` 在生产构建默认输出摘要**（类型 / 长度 / 键数），不再原样打印 `args` / `result`；需要内容请传 `redact`（同时可用 `sink` 换出口）。
- **快照失败 / 中止时 `data` 为 `undefined`**（不再回传活引用）；`metadata.nodeCount` 两条路径同口径；`onProgress` 抛错不再让整次快照失败。
- **`subscribe(fn, { readOnly })` 决定载荷形态**：仅有只读订阅者时免深拷贝（保护开启给只读 Proxy、关闭给原始引用）。`notify.clone` 未显式配置即自动模式——集成层绑定本身是只读注册，默认场景下通知开销显著下降；若有测试断言「回调拿到的是副本」，请改为显式 `notify: { clone: true }`。
- **脏键与通知**：`$replaceState` 会把被删掉的旧键一并标脏；通知回调内的重入写入归下一轮（组合 Store 同口径）；监听器抛错与 action 收尾链路异常改由 `onError` 承接（生产控制台仍静默）。
- **持久化生产降级改走 `onError`**（`emit('onError', error, 'persistence')`）；`clearOnUninstall` 删除失败不再被吞。`StorageBackend` 三方法一律「失败抛错」，`getItem` 返回 `null` 只代表键无数据。
- **不传 `storage` 时的默认后端统一为 `WxStorageBackend`**（`builtin.ts` 的内联适配器已删除）：微信缺失键返回的 `''` 与非字符串载荷改按「无数据」处理（此前 `''` 会被送去 `JSON.parse` 并在恢复路径报一条解析错误）；可用性判定由「有 `getStorageSync`」收紧为「三方法齐备」，只有读方法的残缺 `wx` 不再每次落盘抛 `TypeError`，而是走内存降级；降级文案括号里新增「wx 同步 API 不齐备」，按文案匹配日志 / `onError` 的调用方需同步。显式传 `storage` 的路径不受影响。
- **`WxStorageBackend` 的实现文件换位置**（`src/types/persistence.ts` → `src/plugins/WxStorageBackend.ts`）：**非破坏性**，`@openlide/geomstore/extras/plugins` 与 `@openlide/geomstore/extras` 的导出名与形状不变，import 无需改动；类体逐字节相同。
- **`compareSnapshots` 不再把「深过 100 层」当成差异**（退化为整体 `deepEqual`）；`deepEqual` 的深度预算跨 Set 累加，超深结构按保守语义判不等且一次顶层调用只告警一次。
- **错误子系统统计与上报**：`ErrorAggregator` 的样例不再携带 `payload` 且随命中刷新、`byStore` 随组驱逐保持一致；`ErrorMonitoring` 的 `reportTimeout <= 0` 表示不超时、`clear()` 复位连续失败计数；`ErrorRecovery` 的受控字段（`error` / `config` / `attempt`）不再被调用方上下文覆盖；`ErrorBoundary` 会把非 `Error` 抛出值归一化后记账（重抛仍用原始值）。
- **时间旅行 `importHistory` 会跳过畸形条目**（`state` 为数组或自持 `__proto__` 键），`undo` / `redo` 在回放成功后才推进索引。

## 升级到 0.5.1

公开签名基本不变（含两处类型放宽）；升级时请确认依赖旧行为的断言与收尾逻辑。以下两节按修复批次列出会改变可观测行为的点，完整清单见 [CHANGELOG](../CHANGELOG.md)。

### 第三轮复审

- **脏追踪范围扩大**：类实例与类型化数组不再原样返回——实例属性写入、数组元素写入会被标记；实例方法调用会保守标记所属键（宁可多报），读取时方法绑定原始接收者，`#private` 与内部槽位可用。`$patch` 就地改写被其他顶层键引用的对象时，这些键一并标记。Date/RegExp/WeakMap/WeakSet 维持原引用与不跟踪契约。
- **保护代理读取**：`store.state.<实例>.method()` 与类型化数组的展开 / 切片不再抛错（此前 `this` 是代理导致 `#private` 与内部槽位失效），非法写入仍被拒绝。
- **时间旅行**：回放吞并判断只作用于订阅通知路径——`undo()` 后手动 `record()` 现在会真正记录（此前静默无效，异步模式下回放还会二次截断 redo）。
- **订阅与插件语义**：`readOnly` 按每次注册判定（同一函数先只读后只写时，可写注册仍走深拷贝隔离）；`destroy()` 期间插件清理重入不再重复执行；`usePlugin()` 委托 `store.use()`，因此 `destroy()` 会执行其清理、与 `store.use` 混用不再双重安装。
- **比较与队列**：`deepEqual` 对等价循环 / 别名图两个方向都判等（配对按对象对记录）；离线管理器 `dispose()` 后不再落盘、也不再继续在途同步；队列中的畸形条目会被丢弃而不是让同步永久失败；持久化恢复不再回写磁盘。
- **类型放宽（编译期）**：`store.use` / `usePlugin` / `ComposedStore.use` 的插件参数接受 `Plugin<State>` 联合类型，状态无关插件（logger/analyzer 等）可直接传入；针对其他状态类型的插件仍被拒绝。`persistencePlugin<S>(options)` 保留状态类型参数。
- **选择器与 Action 历史**：`createParametricSelector` 的 `ttl: 0` 统一为「立即过期（等同禁用缓存）」；`ActionHistoryTracker.setMaxHistory` 立即裁剪已有桶并在非有限输入下回退 1；重试内核在 `retries` 为 NaN / 负数时按 0 处理（首次尝试必执行，抛出真实错误而非兜底错误）。

### 第一、二轮修复（cb686d4 / 998af4e）

公开签名不变；升级时请确认依赖旧行为的断言与收尾逻辑：

- **Action 状态代理**：默认与 `onlyOnChange` 模式均跟踪对象 / 数组 / Map / Set 的直接变异，标记所有受影响的顶层键（含别名与异步累积）。归属关系按需求构建一次索引、标量写入 O(1) 查表，逐项更新长列表不再呈平方级开销。类实例与类型化数组也被代理：属性写入与元素写入会被标记，实例方法调用保守标记所属键（方法内部的写入无法精细归因），方法读取时绑定原始接收者；Date/RegExp/WeakMap/WeakSet 仍保留原引用、内部变异不跟踪，需显式替换值。`onlyOnChange` 是变更计数判定，不是内容深比较。
- **通知与脏键**：通知回调内的重入写入归下一轮通知（脏键不会被本轮清空）；`onlyOnChange` 的变更基线覆盖 `beforeDispatch` 钩子内的写入。退订句柄按注册标识精确退订：被驱逐的旧句柄不会误删同一回调的重新注册，插件卸载句柄也不影响同一插件的重新安装。
- **缓存新鲜度**：dispatch 刷新时会移除已删除的状态键，`$replaceState` 清空整表后回填；组合缓存读取前校验子 Store 版本，无版本号的子 Store（含嵌套组合）每次读取保守失效，不要依赖合并结果引用永远稳定。合并的 `actions` 注册表支持外层裸名 dispatch 路由嵌套组合，非命名空间模式同名取第一个 Store。
- **选择器与退订**：版本化选择器缓存同时校验状态对象身份与版本号；每个退订句柄幂等，重复调用不会消耗同回调的其他注册。
- **卸载顺序**：Page `onUnload` / Component `lifetimes.detached` 先执行用户钩子，再在 `finally` 清理绑定，同步抛错也会清理。依赖映射 actions 的收尾放在同步段；包装器不等待异步钩子的 Promise。
- **装饰器隔离**：`withDebounce` / `withThrottle` / `withCache` 支持静态方法（函数宿主），不同的同描述 Symbol 方法互不串扰。
- **快照 diff 与循环 Set**：按活动对象对识别循环，共享子对象仍按各路径比较；自有 `undefined` 属性新增 / 删除会报告 `kind: 'added' | 'removed'`。Set 元素配对共享循环防护并在候选失败时回滚，自引用 Set 判等为真、快照差异不再误报。
- **持久化与离线队列**：持久化卸载时直接读取当前状态补写（`notify.async` 下通知未送达即销毁也不再丢最后一次变更），与上次写入内容相同则不重复写；离线队列同步失败项只落盘一份（不再重启后重复执行），死信落盘失败时操作保留在队列中而非丢弃。
- **错误与性能子系统**：`ErrorRecovery.recover` 第二参数参与重试键（按 Store/操作隔离额度）；`ErrorMonitoring` 上报成功后回收超时定时器；`ErrorAggregator.getStats().byStore` 按实际次数统计（各项之和等于 `totalErrors`）；`PerformanceMonitor.setOptions({ maxSize })` 立即裁剪超额记录；`LRUCache` 缩容期间 `onEvict` 重入写入后仍维持容量上限。

## 升级到 0.5.0

### 1. 产物格式由 CJS 切换为 ESM

```diff
- const { createStore } = require('@openlide/geomstore')
+ import { createStore } from '@openlide/geomstore'
```

- 包根与 `dist/` 均为 ESM（`"type": "module"`）；入口仍为 `dist/index.js`
- **ESM 不做目录索引回退**：直接引用内部路径时请写全 `dist/xxx/index.js`（不要依赖目录解析）
- 复制安装场景：把 `@openlide/geomstore` 换成你的本地目录即可，但只支持 `import`

### 2. 可选能力的实现移入 `extras/*`

公开子路径与各入口的导出集合**均未变化**；仅当代码**深链了内部源码路径**时才需要调整：

| 能力 | 源码路径 | 对外引入方式（不变） |
| --- | --- | --- |
| 快照 | `src/extras/snapshot` | `@openlide/geomstore/extras/snapshot` |
| 选择器 | `src/extras/selector` | `@openlide/geomstore/extras/selector` |
| Action 增强 | `src/extras/action` | `@openlide/geomstore/extras/action` |

`cache` / `hooks` / `performance` 的实现仍在 `src/core`（被 `core/store` 直接依赖），仅入口在 `extras/*`。

### 3. 组件生命周期收严（Breaking）

- 组件生命周期必须写在 `lifetimes`（`created` / `attached` / `ready` / `moved` / `detached` / `error`），页面级写在 `pageLifetimes`（`show` / `hide` / `resize`）
- 两者都**不再放开索引签名**，键与微信官方一致：拼错生命周期名、或传入自定义键，现在会在编译期报错

```diff
- lifetimes: { attache() {} }              // 拼错 → 现在报错
+ lifetimes: { attached() {} }
```

### 4. 集成方法内的 `this` 已注入（请删除手写标注）

三处集成都会把注入后的 `this`（`PageThis` / `ComponentThis` / `AppThis`）交给配置方法，手写标注会**覆盖**它，反而使类型变弱：

```diff
- onLaunch(this: { globalData: { appName: string } }) { … }   // globalData 退回字面量类型，丢掉映射状态
+ onLaunch() { … }                                            // 映射状态已在 this.globalData 上
```

- Page：`this.data`（含 `mapState` / `mapGetters`）+ `mapActions` 注入的方法
- Component：`methods` 内注入的方法与 `data`（微信会把 `methods` 条目提升到实例，`this.add` 与 `this.methods.add` 都可用），`lifetimes` / `pageLifetimes` 内同样是注入后的 `this`
- App：`this.globalData`（含映射状态）+ `mapActions` 注入的方法与调试 API

### 5. 状态类型约束放宽（仅类型，无需迁移）

`Selector` / `ParametricSelector` / `SelectorComposerInput`、选择器各创建函数与 `composeStore` 的 `StoreLike` 由 `Record<string, unknown>` 放宽为 `State`：**未声明索引签名的业务 `interface`** 现在可直接作为状态类型。

```ts
interface OrderState { rate: number }        // 此前会被拒之门外
createSelector((state: OrderState) => state.rate)
composeStore([userStore, cartStore])
```

`Plugin` / `PluginHook` 亦已泛型化：省略类型参数（`Plugin`）与既有写法一致，新增的编译错误只出现在「插件与 Store 状态类型不匹配」这类本就错误的组合上。

## 升级到 0.4.0

**错误子系统从核心入口下沉到 `extras/error`**（Breaking）：主入口不再导出 `GeomStoreError`、`createError`、`ErrorCode`、`isGeomStoreError` 及其子类、`ErrorRecovery`、`ErrorMonitoring`、`ErrorBoundary`、`ErrorHandler` 等。

```diff
- import { createError, ErrorCode, ErrorRecovery } from '@openlide/geomstore'
+ import { createError, ErrorCode, ErrorRecovery } from '@openlide/geomstore/extras/error'
```

同时移除 `TypeValidator` 模块与 `core/index` 中已废弃的零碎 barrel / 工厂函数（死代码收口）。

## 升级到 0.3.0

| 变更 | 迁移方式 |
| --- | --- |
| 可选能力改由 `extras/*` 子路径引入（瘦核心拆分） | `import { createSnapshot } from '@openlide/geomstore/extras/snapshot'` |
| 构建产物目录扁平化：`dist/cjs/**` → `dist/**` | 复制安装时引用 `dist/cjs/...` 的改为 `dist/...`（NPM 安装不受影响） |
| 转发 stub 目录改由 `prepack` 生成 / `postpack` 清理 | 需要时用 `pnpm stubs` / `pnpm stubs:clean` |
| `withPageStore` / `withComponentStore` **只识别 `lifetimes` 写法** | 组件顶层 `attached` / `detached` 改为写在 `lifetimes: { attached, detached }` 内 |
| `SubscriptionManager` 内部 API 重命名（`subscribe`→`add`、`unsubscribe`→`delete`、`size` 改为 getter、移除 `has`） | 使用 `store.subscribe` 公共 API 的代码不受影响 |
| `persistencePlugin` 直接安装不再透传第二参数 | 需要 `storage` / `key` / `filter` / `validate` 时改用工厂形式 `persistencePlugin(options)` |
| 热更新备份新增 `version` 字段 | 备份版本与库版本不一致时仅告警，仍按 `$patch` 合并语义恢复（不因版本不符丢弃用户数据） |
| 零拷贝通知语义收紧（`notify.clone: false`） | 存在可读写订阅者时仍会克隆以保证内部状态安全 |
| `withCache` 命中日志 `console.log` → `console.debug` | 依赖日志做断言的测试需同步 |
| 组合 Store 订阅复用单路合并订阅 | 外部直连子 Store 的订阅不再被组合层订阅静默驱逐 |

## 升级到 0.2.x

- **`$patch` 底层 `deepMerge` 仅对纯对象递归合并**：Date/RegExp/Map/Set/数组/类实例整体替换为深拷贝
- **`createSelector` 默认比较器 `shallowEqual` → `deepEqual`**，且缓存比较基于写入时快照（避免 `$patch` 后误命中陈旧值）
- **`bindMappings`**：对象值始终纳入 `setData`（不做引用脏检查）；`undefined` 字段被过滤（微信 `setData` 不接受 `undefined`，清除字段请用 `null`）
- **`HttpReporter.report/reportBatch` 失败向上抛出**：直接调用方需自行 `catch`（内部批量管线已兜底）；默认实现校验 `ok` / `statusCode`
- **`ErrorBoundary` 的 `fallback` 计算函数抛错时重抛原始错误**
- **`ErrorRecovery` 重试额度按故障周期计量**（时间窗 = `max(60s, 本周期退避总时长 × 2)`），达到上限仅清除当前键
- **类型层**：`ActionExecutor` / `ActionUtils` 泛型放宽为 `Actions`，返回 `Promise<Awaited<...>>`（消除 `Promise<Promise<T>>`）；`ExtractStates` 等基例改用 `Record<never, never>`（不污染组合 Store 属性类型）；`withPageStore` 入参改为同态映射，自定义方法保留精确类型

## 升级到 0.1.3

- **`StorageBackend` 收窄为纯同步接口**：`getItem/setItem/removeItem` 不接受 Promise；传异步后端会在恢复/保存路径显式报错。异步持久化请在外部自行订阅 store 实现
- **`ErrorFallback` 泛型参数反转**：`ErrorFallback<S>` → `ErrorFallback<F, S>`
- **`ErrorBoundary` / `withErrorBoundary` 默认 fail-loud**：未配置 `fallback` 时错误重抛；提供 `fallback` 即视为声明恢复意图
- **`withThrottle` 默认 `{ leading: true, trailing: true }`**：窗口内被抑制的调用在窗口结束时以**最新参数**补发；`trailing: false` 回到纯 leading
- **`clone` 选项重构**：`{ deep, safe }` → `{ mode: 'deep' | 'shallow' | 'safe' | 'json' }`；`safe` 语义为「尽力深拷贝且绝不抛错」，JSON 有损语义移至 `json`
- **`compareSnapshots` 集合语义**：Set 按内容无序匹配；Map 键引用匹配失败后做结构匹配；`changes` 条目新增可选 `kind: 'added' | 'removed'`
- **`createRetrySelector` 选项化**：第二参数 `maxRetries: number` → `{ retries?, shouldRetry? }`；负数创建期抛 `TypeError`；新增 `createRetrySelectorAsync`

## 升级到 0.1.1 / 0.1.2

以修复与文档对齐为主，无破坏性变更；以下行为修正值得同步确认：

- `persistencePlugin` 启动恢复改用 `$patch` 合并语义（未被持久化的键保留初始值）；无 `wx` 同步存储时降级为内存存储并告警
- `initBackgroundSync` 改为包装全局 `App` 构造器注入 `onShow` / `onHide`（修改 `App.prototype` 在微信中不生效）
- `Store.$snapshot` 返回递归深冻结结构（**该口径已在 0.5.2 更正为「部分冻结」**：只有纯对象与数组链被冻结，经 Date/RegExp/Map/Set 或非纯对象触达的节点仍可变）
- 文档与示例统一使用 `state` 工厂函数形式 `state: () => ({ ... })`
