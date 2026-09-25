# 常见问题

本文是「**症状 → 诊断步骤**」的唯一正本：每条先给 1–3 行可操作结论，机制原理一律交给正本——语义见 [CONCEPTS.md](./CONCEPTS.md)，逐 API 契约见 [API.md](./API.md)，接入代码见 [GUIDE.md](./GUIDE.md)（可运行示例在 `examples/`），该做 / 别做清单见 [BEST_PRACTICES.md](./BEST_PRACTICES.md)。本文只答当前版本行为；版本历史对照见 [MIGRATION.md](./MIGRATION.md)，提交前的门禁与文档约定见 [CONTRIBUTING](../CONTRIBUTING.md)。

## 目录

| 症状关键词                                                                    | 跳转                          |
| ----------------------------------------------------------------------------- | ----------------------------- |
| 监听器没触发、通知次数不对、直接写状态抛错、脏键、`__proto__`                 | [状态与通知](#状态与通知)     |
| 缓存永不命中、命中率低、选择器陈旧值、getter 每次重算                         | [缓存与选择器](#缓存与选择器) |
| 快照字段丢失、`data` 是 `undefined`、`changed: true` 只有一条 root 差异、路径 | [快照](#快照)                 |
| 装饰器返回 `undefined`、卸载后防抖仍执行、`cancel*` / `dispose*` 不生效       | [装饰器](#装饰器)             |
| 持久化没生效、恢复丢字段、生产没日志、`onError`                               | [插件与持久化](#插件与持久化) |
| `require` 报错、子路径解析不到、体积变大、`destroyed Store`、内存增长         | [集成与工程](#集成与工程)     |

## 状态与通知

### 我改了状态，为什么监听器没被调用？

三种常见原因，按可能性排序：

1. **没有真正改变状态**：开启 `notify.onlyOnChange` 后，dispatch / batch 期间没有实际写入就不会通知。请确认写入是否真的发生（例如 patch 的键是否存在于状态中）。
2. **`notify.async` 合并了通知**：同一 tick 内的多次写入只发一次；如果你的断言在同一个 tick 里，看到的是「还没通知」。
3. **改的是克隆出来的副本**：`$patch` / `setState` 写入的是内部状态；如果你拿 `deepClone(state)` 的结果去改，不影响 Store。

通知语义见 [CONCEPTS §2](./CONCEPTS.md#2-通知notify)。

### 监听器为什么收不到 `prevState`？

`StateListener<S>` 的签名是 **`(state: S) => void`**——只有一个参数。需要前后对比请在闭包里自行保存上一次的值（`let last = store.getState().count`，回调里对比后再更新 `last`）。契约见 [CONCEPTS §2 监听器与只读订阅](./CONCEPTS.md#监听器与只读订阅)。

### 同一轮通知里，两个监听器拿到的是同一个对象吗？

看**本轮注册的可写性**（`notify.clone` 未配置时）：全部是只读注册（`subscribe(fn, { readOnly: true })`，页面 / 组件映射订阅本身就是）→ 零拷贝，共用同一个载荷；存在可写注册 → 每个可写注册各拿一份独立深拷贝、只读注册共用一份；显式 `notify.clone: true` 强制拷贝。份数由 `maxSubscribers` 封顶，不会因重复订阅而等比放大。分配规则见 [CONCEPTS §2](./CONCEPTS.md#2-通知notify)。

### 直接写 `state.x = 1` 为什么会抛错？

状态保护（默认开启）拦截绕过 `setState` / `$patch` 的直接变异（含 `Object.defineProperty` 与数组元素赋值）。请改用受控写入：

```ts
store.setState('x', 1)
store.$patch({ x: 1 })
```

- 确有性能或兼容需求时可用 `stateProtection: { deep: false }` 只保护顶层，但**不建议关闭保护**——就地变异是许多「数据不更新」问题的根源。
- 例外要认得：`Object.freeze` 过 / 不可写且不可配置的子树，读取拿到**裸引用**（不抛错），但对它的写入不受保护、不计变更与脏键——想让集成层看见它的变化，换一个新引用再 `setState`。

机制与豁免判据见 [CONCEPTS §3](./CONCEPTS.md#3-状态保护state-protection) 与 [冻结与不可写属性](./CONCEPTS.md#冻结与不可写属性明确豁免)。

### 异步 action 的通知次数和我想的不一样

默认模式下一次 dispatch 是 **2 次通知**：同步段结束时当场补发一次，settle（fulfill / reject）时续段再发一次。嵌套 dispatch 仅最外层通知；与 batch 交叉时由 batch 收尾统一通知。

- 只想要一次：开 `notify.async`（同一 tick 合并）或 `notify.onlyOnChange`（按写入计数去重）；想显式合并请在 action 里用 `batch` 包住两段。
- 断言通知次数的测试按「2 次」重算；历史对照见 [MIGRATION](./MIGRATION.md#升级到-070)。时点语义见 [CONCEPTS §2 dispatch 的通知时点](./CONCEPTS.md#dispatch-的通知时点)。

### `batch` 里 `await` 之后为什么不合并了？

批保护只在**同步段**有效——`await` 之后的变更会逐条通知（开发模式下有显式告警）。异步场景请让 action 承担合并职责，或在 `await` 之后重新 `startBatch` / `endBatch`。见 [CONCEPTS §14](./CONCEPTS.md#14-批处理batch)。

### `isStateKeyDirty` 有什么用？

供集成层判断「自上次通知以来某键是否变化」，据此跳过无意义的 `setData`（小程序视图层更新是主要开销）。键型是 `string | symbol`，symbol 顶层键同样有脏位可查。

只在同步订阅回调内有效；读取窗口、跟踪覆盖面与组合 Store 下的精确判定见 [CONCEPTS §7](./CONCEPTS.md#7-脏键isstatekeydirty)。

### `setState('__proto__', …)` 之后为什么读不回写入值？

值已经写进去了：`__proto__` / `constructor` / `prototype` 按状态对象的**自有数据属性**承载，原型不动。`state.__proto__` 这个表达式仍命中原型访问器、返回的是原型——读回写入值请用 `Object.getOwnPropertyDescriptor(state, '__proto__')`。机制见 [CONCEPTS §1](./CONCEPTS.md#1-状态state)；若你观察到的是原型链被整个换掉、注入键经缺失键可读，见 [MIGRATION](./MIGRATION.md#升级到-070)。

## 缓存与选择器

### `store.getState()` 和 `store.getCached(key)` 有什么区别？

只有第二条查缓存。三条结论：

- `getState()` 直接返回内部状态的活引用，**完全不经过缓存**——读多少遍都不产生命中，`getCacheStats()` 的 `hits` / `misses` 恒为 0。
- `setState(key, v)` 与 `$patch` 是**写穿**：把合并后的最终值同步回写进对应条目，不删条目、不记未命中，下一次 `getCached` 直接拿到新值——「写入即失效」的读法不成立。
- 真正清条目的是 `invalidateCache(key?)`（不传即整表清空）与 `$replaceState`（清空后按新状态回填）。

机制见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)。

### 缓存命中率很低

按顺序查：

1. 读的是不是 `getCached()`——`getState()` 不查缓存（见上一条）。
2. 是否缓存了全部键——只缓存热点键（`enableCache(['visibleRows'])`）。
3. 是否频繁整体替换状态——`$replaceState` 会让缓存整表清空再回填。

`setState` / `$patch` 不是原因——它们写穿，不制造未命中。见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)。

### 选择器返回了陈旧值 / 永不命中

- **陈旧值**：命中判定同时校验**状态对象身份与版本号**（O(1)）；只有当状态不带版本号（例如把普通对象直接传给选择器）时才回退 `equalityFn`（默认 `deepEqual`）比写缓存时的内容快照。陈旧值多来自自定义 `equalityFn` 过宽（只比自有属性、或恒真）——先检查它能否真正区分前后两版状态。
- **每次重算但结果没错（「永不命中」）**：检查是否传了引用相等的比较器 `equalityFn: (a, b) => a === b` 却没关快照——失效凭证是写缓存时的一份内容快照（`snapshotState` 默认 `true`），活引用与克隆体永不相等，要补 `snapshotState: false`（缓存活引用、只比身份）。带版本号的 Store 状态不走这条回退路径，也不克隆。

机制见 [CONCEPTS §5](./CONCEPTS.md#5-版本号stateversion) 与 [§9](./CONCEPTS.md#9-选择器selectorextrasselector)。

### `store.getter(name)` 会缓存结果吗？

**不会**：Store 侧没有 getter 结果缓存，每次调用都按当前状态重算函数体。要记忆化只有两条路——`extras/selector` 的 `createSelector`（按状态版本号做 O(1) 失效判定），或把派生值算成一个真实状态键、由 action 显式写入。见 [CONCEPTS §4](./CONCEPTS.md#4-getter无记忆化)。

### `enableCache` 的 stats 会影响性能吗？

有少量计数开销，但 `cacheConfig.enableStats` **默认开启**（缺省即 `true`，显式传 `true` 不打开任何东西）。要省这点开销是反过来传 `false`——代价是 `getStats()` / `getCacheStats()` 的 `hits` / `misses` 恒为 0，命中率与 `missRate` 无从观测。测量完记得打开回来。见 [CONCEPTS §6](./CONCEPTS.md#6-缓存cache)。

## 快照

### 快照里为什么少了字段 / 出现了 `undefined`？

隔离契约：无法安全克隆的节点一律**丢弃**，绝不把原始活引用兜底进结果。判读顺序：

1. **先判 `success`** 再信任 `data`：失败或中止的结果 `data` 是 `undefined`（类型面上 `SnapshotResult<T>.data` 就是 `T | undefined`，不判空取属性直接编译报错）。
2. 读 `result.errors[]`（每项含 `path` / `type` / `message`）定位被丢弃的节点，按需用 `customCloner` 接管该节点。`success: true` 且 `errors` 非空是合法状态——循环引用、`maxDepth` 超限也入账，但只有 `cloneError` 参与 `success` 判定。
3. `onError` 只想观测请**显式 `return true`**：不写 `return` 的箭头函数返回 `undefined`，等价「拒绝继续」，会把整次快照做成失败；纯观测也可改用 `onProgress`（它抛错被就地兜住）。

各容器的丢弃表现（对象不写键 / 数组留洞 / `Set` 不加入 / `Map` 跳整条 entry / 根节点 `data` 为 `undefined`）见 [CONCEPTS §8 失败与丢弃的表现](./CONCEPTS.md#失败与丢弃的表现)，账本与降级细节见 [错误账本与降级策略](./CONCEPTS.md#错误账本与降级策略)；失败结果的 `stats` / `metadata` 口径见 [API.md 二、extras/snapshot](./API.md#extrassnapshot快照)。

### `$snapshot()` 和 `createSnapshot()` 有什么区别？

|          | `store.$snapshot()`                                                      | `createSnapshot(data)`                       |
| -------- | ------------------------------------------------------------------------ | -------------------------------------------- |
| 归属     | 核心                                                                     | `extras/snapshot`                            |
| 结果     | 深克隆 + **部分冻结**（范围见 [CONCEPTS §1](./CONCEPTS.md#1-状态state)） | `{ data, success, errors, metadata, stats }` |
| 错误处理 | 无账本（失败即抛）                                                       | 逐节点落账 + `onError` 降级策略              |
| 适用     | 需要只读副本 / 回滚点                                                    | 需要错误可见性、进度、大对象分片             |

### 什么时候该用异步快照？

数据量导致单次克隆会阻塞主线程时。`createSnapshotAsync` 按 `batchSize`（默认 100）分片并在批间让出控制权，可配 `onProgress` 显示进度、`timeout` 限制总耗时。超过 1000 层的结构只能靠它——同步递归受 `min(maxDepth, 1000)` 硬上限约束，异步走任务队列、不占调用栈。`timeout` / `batchSize` / `batchInterval` 非法值的归一化细节见 [API.md 二、extras/snapshot](./API.md#extrassnapshot快照)。

### 快照能克隆类实例 / Date / Map 吗？

- 类实例：重建为**同类实例**（保留原型与方法，不触发构造器）；访问器属性以 getter 求值结果克隆（**不会二次触发** getter）。
- `Date` / `RegExp` / `Map` / `Set`：按类型正确克隆；循环引用检测始终生效（`detectCircular` 只控制是否**上报**）。
- **两类值保留原引用、不克隆**：内建容器的子类实例，以及值靠内部槽位承载的对象（`Promise`、装箱原始值、`ArrayBuffer` / TypedArray / DataView、`WeakMap` / `WeakSet`、`Error`、生成器）——快照对它们**不是隔离副本**，需要隔离请用 `customCloner` 接管该节点。
- 数组上的附加自有键（非下标、非 `length`）跟着克隆，`length` 被排除。

判据与完整覆盖面见 [CONCEPTS §8 保留原引用的两类值](./CONCEPTS.md#保留原引用的两类值) 与 [克隆覆盖面](./CONCEPTS.md#克隆覆盖面)。

### `compareSnapshots` 报 `changed: true`，但 `changes` 里只有一条根路径差异？

按顺序读：**先判两侧 `success` → 再判 `inputTrusted` → 最后读 `changes`**。只要有一侧快照 `success: false`（克隆出错、超时、被 `onError` 中止），`inputTrusted` 就是 `false`：不逐路径展开，交付一条 root 级整体差异且 `changed` 恒 `true`——含义是「输入不可信，保守认为有差异」，不是「内容确有差异」。请回上游重取快照再比。见 [CONCEPTS §8 差异比较](./CONCEPTS.md#差异比较comparesnapshots)。

### 差异路径 `changes[].path` 怎么读？

与克隆账本 `errors[].path` 同一份方言：对象属性 `parent.child`、数组下标 `parent[3]`、`Map` 按**键身份**生成（值差异 `parent.<String(key)>`、键新增 / 删除 `parent.key.<String(key)>`）。`Set` 的 `[removed:i]` / `[added:i]` 里的 `i` 是**报告序下标、不是条目身份**——跨快照配对 `Set` 变化请读 `oldValue` / `newValue`。完整方言见 [CONCEPTS §8 差异比较](./CONCEPTS.md#差异比较comparesnapshots)。

### 时间旅行的 `getSnapshots()` 返回值可以修改吗？

支持的普通对象 / 数组 / Date / RegExp / Map / Set 会经核心 `deepCloneState` 重新克隆（循环引用也受支持），修改这些副本不会污染内部历史或后续恢复值；类实例、函数、Promise、WeakMap 等仍保留原引用，**不要修改这些共享节点**。它不是 `extras/snapshot` 的丢弃契约。见 [CONCEPTS §8 不要混淆时间旅行契约](./CONCEPTS.md#不要混淆时间旅行契约)。

## 装饰器

### `withThrottle` / `withCache` 为什么返回了 `undefined`？

当方法**不是 `async` 语法但返回 Promise**（包装函数、手写 thenable）时，装饰器无从观测返回值：若首次调用即被抑制（`leading: false`）或命中缓存，它会按同步方法返回 `undefined`，而后续调用却真的返回 Promise——调用方 `await` 就可能崩。改法：显式声明异步语义。

```ts
withThrottle(200, { assumeAsync: true })
withCache({ ttl: 30_000, assumeAsync: true })
```

选项契约见 [API.md 装饰器](./API.md#装饰器)。

### 同一个装饰器实例用在多个方法上会串数据吗？

不会。`withCache` / `withDebounce` / `withThrottle` 按**宿主与方法**隔离状态（支持类静态方法），不同 Symbol 即使描述相同也互不干扰；`withLoading` 的引用计数按 (宿主, loading 键) 集中，多装饰器并发不会提前翻转 `loading`。契约见 [API.md 四、extras/action](./API.md#extrasactionaction-增强)。

### `withThrottle` 的间隔参数写在哪里？

```ts
withThrottle(100, { leading: true, trailing: true }) // 间隔是第一个位置参数
```

`leading` 与 `trailing` 默认均为 `true`：窗口结束时以**最新参数**补发被抑制的调用。见 [API.md 装饰器](./API.md#装饰器)。

### 自定义装饰器（`createDecorator`）把同步方法变成返回 Promise 了？

不会。只有被装饰方法返回 Promise（或 `before` 回调返回 Promise）时调用才返回 Promise，同步方法保持同步返回；`before` / `after` 的异步返回被接续而非并发执行，rejection 不会变成 unhandled rejection；`onError` 收到的是规范化后的 `Error`，它自身抛错只记一条日志、不顶替原始失败。装饰访问器（`get` / `set`）在装饰阶段就抛 `TypeError`。见 [API.md 四、extras/action](./API.md#extrasactionaction-增强)。

### 宿主（页面 / 组件）卸载了，挂起的防抖 / 节流调用怎么办？

不收尾它们**会到点执行**：排程中的定时器回调持有宿主与状态直到窗口 / 延迟到期（期间宿主不可被回收），到点照常调用被装饰方法——通常是往已销毁的 Store 里写，抛 `Cannot call … on a destroyed Store`。

在卸载点调用 `@openlide/geomstore/extras/action` 的收尾入口（参数是宿主 `this`，全部幂等）：`cancel*` **丢弃**挂起调用；`flush*` **立即执行且只执行一次**（想把最后一次输入落盘用它，无挂起调用时不凭空执行）；`dispose*` ＝ 取消 **+** 释放该宿主的整张状态表（「一切从简」只调它一个）。逐入口语义、被取消的 Promise 会收到什么、`withCache` / `withRetry` 为什么没有对应入口，以及完整示例，见 [API.md 防抖 / 节流的宿主收尾入口](./API.md#防抖--节流的宿主收尾入口)。

### 我把 `withDebounce` 装饰在 store action 上，为什么 `cancel*` / `flush*` / `dispose*` 都不生效？

store action 的 `this` 是 `ActionManager` 为一次 dispatch 现造的 action 上下文代理，外部无从寻址——六个入口对它一律**静默 no-op**：不抛错、也不清定时器，挂起调用照旧到点执行。

判别口诀：被装饰的方法由 `store.dispatch(...)` 触发 → 收尾入口不可用；由 `this.someMethod(...)`（页面 / 组件实例）触发 → 可用。

改写法两条：① 装饰页面 / 组件上的方法、让它去 `dispatch`（卸载点手里就有 `this`）；② 想在 store 侧复用同一段防抖，自己包一层（如一个 `CartApi` 实例）、让那一层的实例当宿主。契约与代码示例见 [API.md 防抖 / 节流的宿主收尾入口](./API.md#防抖--节流的宿主收尾入口) 与 [GUIDE](./GUIDE.md)。

## 插件与持久化

### 持久化没有生效 / 恢复后字段丢了？

三个最常见原因：

1. **后端不同步或三方法不齐**：`getItem` / `setItem` / `removeItem` 缺任一都会在 `store.use()` 安装期抛 `TypeError`；返回 Promise 的实现会在恢复 / 落盘 / 清理时被明确拒绝。小程序用 `new WxStorageBackend()` 或自封装同步实现（浏览器的 `localStorage` 恰好三方法齐备，可直接传）。
2. **在非微信环境直接 `new WxStorageBackend()`**：`wx` 或对应 `getStorageSync` / `setStorageSync` / `removeStorageSync` 缺失、非函数时它抛错；插件路径不受影响——它先用 `isWxStorageSyncAvailable()` 探测，探测不过才降级内存。请改传自建后端。
3. **恢复被跳过**：后端抛错、JSON 语法错、解析结果不是可信纯对象（含自带 `__proto__` 自有键）、被 `validate` 拒收、`$patch` 被拒——除 `console.error` 外统一 `emit('onError', error, 'persistence')`，监控在 `onError` 上就能接到。

补充：不传 `storage` 时默认后端就是 `WxStorageBackend`（`wx.getStorageSync` 对缺失键返回的 `''` 归一为 `null` ＝无数据）；恢复是**合并语义**（走 `$patch`），未被持久化的键保留初始值；`filter` 指定落盘子集、`debounce` 控制写入频率（卸载时同步补写窗口内最后一次变更）、`clearOnUninstall: true` 卸载即清理。

机制见 [CONCEPTS §11 调试表与持久化](./CONCEPTS.md#调试表与持久化)，逐选项契约见 [API.md 六、extras/plugins](./API.md#extrasplugins插件实现)。

### 生产环境为什么看不到插件日志？

`NODE_ENV=production` 下插件安装 / 卸载、子 store 竞态等路径**静默**（仅开发模式打日志），排查时临时切到开发模式即可。

**静默不等于没有信号**——需要被监控发现的问题都走 `onError` 钩子（`store.hooks.emit('onError', error, source)`），生产环境请挂上报处理器：

- 持久化降级为内存后端、恢复被跳过
- 订阅回调抛错
- 落盘失败、`clearOnUninstall` 删除失败
- action 收尾链路自身抛错
- 订阅者被驱逐：达到 `maxSubscribers` 触发 `evict-oldest` 时发一次 `Error`（第二参 `'subscribe'`，消息带被驱逐监听器的名字与上限）

### 插件安装失败会留下半成品吗？

不会。`store.use(plugin)` 在 `install` 抛错时回滚入列，重试不会累积重复条目。`usePlugin(plugin, store)` 是等价的独立函数，泛型从 `store` 反推、**无需断言**（插件需与其状态类型匹配；状态无关的插件写作 `Plugin<State>`）。见 [CONCEPTS §11](./CONCEPTS.md#11-插件plugin)。

## 集成与工程

### 小程序里 `require` 报错？

包是**纯 ESM**（`exports` 未声明 `require` 条件、包内无 CJS 产物），请一律写 `import`；构建链路仍产出 CJS 的，在打包器侧做转换。两条边界别把「能用」当「支持」：微信「构建 npm」消费的是包内 `dist-weapp/` 的 CJS 产物（工具整目录拷贝），与你源码怎么写无关；Node ≥ 22.12 的 `require()` 能同步加载 ESM 只是运行时兜底，别当 CJS 支持依赖。产物形态与边界见 [README 小程序环境适配](../README.md#小程序环境适配) 与 [引入方式与体积分层](../README.md#引入方式与体积分层)。

### 组件里收不到 `attached` / `detached`？

组件生命周期必须写在 `lifetimes` 字段内（基础库 3.15.0+）；写在配置顶层的 `attached` / `detached` 不会被调用。

```ts
withComponentStore(store, { mapState: ['count'] })({
  lifetimes: { attached() {}, detached() {} },
})
```

见 [CONCEPTS §13 订阅生命周期](./CONCEPTS.md#订阅生命周期)。

### 卸载钩子里还能调用映射的 action 吗？

可以在 `onUnload` / `lifetimes.detached` 的同步段调用：用户钩子先执行，绑定随后在 `finally` 中清理，钩子同步抛错也不漏清理；包装器不等待异步钩子的 Promise——**`await` 之后别依赖映射方法仍可用**。集成层只清订阅与映射：宿主上被 `withDebounce` / `withThrottle` 装饰的方法若还有挂起调用，请在同一个钩子里显式收尾（`cancel*` / `flush*` / `dispose*`，见[装饰器](#装饰器)一节）。见 [CONCEPTS §13 订阅生命周期](./CONCEPTS.md#订阅生命周期)。

### 组件 / App 里要不要手写 `this` 类型？

**不需要**：三处集成都已注入 `this` 类型（action 的 `state` / `setState` / `$patch` / `dispatch`，Page / Component 的 `this.data` 与映射方法，App 的 `this.globalData`），方法内直接写即可。**别手写 `this` 标注**——它会覆盖集成层注入的类型：写成 `onLaunch(this: { globalData: { appName: string } })` 会把 `globalData` 收窄回字面量类型、丢掉映射进来的状态键，`this: AppOptions` 之类会让 `globalData` 退回可选。

三者的差别只在注入形态：`withPageStore` 的方法在顶层、`withComponentStore` 写在 `methods` 里（实例上可平级调用）、`withAppStore` 的状态落在 `globalData` 上。接入代码见 [GUIDE](./GUIDE.md)，契约见 [CONCEPTS §13 映射](./CONCEPTS.md#映射)。

### `@openlide/geomstore/xxx` 解析不到？

- 先确认子路径在 `exports` 合法清单内（`.` / `core` / `integrations` / `extras` / `extras/*`）；注意 `bindMappings` 等底层绑定工具**不在主入口**，需从 `@openlide/geomstore/integrations` 引入，日常优先用 `withPageStore` / `withComponentStore` / `withAppStore`。
- 微信「构建 npm」解析的是 `miniprogram` 字段指向的 **`dist-weapp/`**（不是 `exports`、也不是 `dist`）：构建 npm 后仍取不到某个子路径，先在 `miniprogram_npm/@openlide/geomstore/` 下数文件——应与 `node_modules/@openlide/geomstore/dist-weapp/` 一致；不一致就是发布方产物问题，带信息报 issue（产物文件数与形态在 `verify:weapp` 门禁覆盖范围内，见 [CONTRIBUTING 构建与发布](../CONTRIBUTING.md#构建与发布)）。
- `@openlide/geomstore/{store,hooks,plugins,integrations}` 这类**转发子目录**服务的是其他不解析 `exports` 的老式场景（指向 `dist` 里的 ESM，微信侧不走这条）；Node / 打包器请优先用 `extras/*`。

见 [README 引入方式与体积分层](../README.md#引入方式与体积分层) 与 [API.md 入口一览](./API.md#入口一览)。

### 主包体积变大了

先分清宿主是哪一种，两者的答案相反：

**宿主带打包器**（webpack / vite / esbuild，典型是 Taro、uni-app 等一站式方案）：最常见原因是引入了聚合入口 `@openlide/geomstore/extras`，它会把全部可选能力拉进产物。改为按需子路径，打包器会摇掉没 import 的：

```diff
- import { createSnapshot, createSelector, withThrottle } from '@openlide/geomstore/extras'
+ import { createSnapshot } from '@openlide/geomstore/extras/snapshot'
+ import { createSelector } from '@openlide/geomstore/extras/selector'
+ import { withThrottle } from '@openlide/geomstore/extras/action'
```

**宿主只有 npm + 开发者工具「构建 npm」**：改子路径**不会**让上传体积变小。本包带 `miniprogram` 字段，微信按「小程序 npm 包」处理，构建时整目录拷贝 `dist-weapp/`，既不看你的 `import` 也不做可达性分析——引聚合入口和逐个子路径拷进去的字节完全一样。这时候能做的只有把构建输出挪进**分包**，换取主包额度，配置见 [README · 把构建结果放进分包](../README.md#把构建结果放进分包)。

顺带一提：手改 `node_modules` 里的产物去「裁剪」体积是跟安装器对抗，`npm i` 或重新构建 npm 就会覆盖回去；真要按需，路径是让宿主带打包器。「按需」与包体积的边界（打包器摇树 vs 整目录拷贝）见 [README 引入方式与体积分层](../README.md#引入方式与体积分层)。

### 报错 `Cannot call … on a destroyed Store`

Store 已 `destroy()`：销毁后所有**写接口**都会抛错（`setState` / `$patch` / `$replaceState` / `subscribe` / `use` / `cache` / `batch` / `setStateProtection`），只有只读统计（如 `getCacheStats`、`isStateProtectionEnabled`）仍可用；独立函数 `usePlugin(plugin, store)` 走同一条 `store.use`，同样抛该异常。请在销毁前完成收尾，或在使用前判断生命周期。注意销毁不会注销 getter 定义：`store.getters` 返回的仍是初始化时登记的那份，`getter(name)` 抛错、`getGetterNames()` 返回 `[]`。

**组合 Store 是这条规则的唯一豁免**：组合之外的某个子 store 被单独 `destroy()` 后，`composed.getState()` / `composed.state` / `composed.$snapshot()` 不抛错——已销毁的子 store 按**空视图**并入（它的命名空间变成空对象，不是缺失键），按 store 去重**告警一次**，其余存活子店照常读写。因此：别靠 try/catch 这个报错来发现子店被销毁（改看告警）；别把 `getState().child` 的存在性当存活判据（它在，只是空的）——判存活显式读 `store.destroyed`；销毁整个组合仍走 `composed.destroy()`。机制见 [CONCEPTS §12 子 store 生命周期](./CONCEPTS.md#子-store-生命周期)，历史对照见 [MIGRATION](./MIGRATION.md#升级到-070)。

### 长期运行的进程内存持续增长 / 定时器不退出？

- **错误处理**：`ErrorMonitoring` 的队列与失败重入队都有容量上限与淘汰策略，`ErrorRecovery` 的重试键有容量守卫——动态 operation id（如 `fetchUser:${id}`）不会无界增长。被丢弃的条数读 `getDroppedErrors()` / `summary.droppedErrors`，它与 `totalErrors` 是不同口径、**别相加核对**。见 [CONCEPTS §10 监控](./CONCEPTS.md#监控errormonitoring) 与 [恢复](./CONCEPTS.md#恢复errorrecovery)。
- **内部定时器做 `unref` 探测**：小程序 / 浏览器无该 API 时自动跳过，不阻止进程退出。
- **`PerformanceMonitor`**：会清理超时未结束的在途计时条目（调用方遗漏 `end()` 时的兜底）；`record()` 存的是**副本**——之后改入参对象、或复用同一对象连续 record，都不会改写已记录的历史指标，`getMetrics()` / `exportJSON()` 交出的也是副本。契约见 [API.md 五、extras/performance](./API.md#extrasperformance性能监控)。
- **防抖 / 节流的挂起定时器会拖住宿主**：宿主状态表本身是 `WeakMap`（宿主回收即消失），但没人清定时器时宿主就回收不了——在卸载点调 `cancel*` / `dispose*`；装饰 **store action** 时入口定位不到槽位、静默 no-op，那种定时器只能等窗口 / 延迟自然到期（见[装饰器](#装饰器)一节）。

### 为什么同一个功能在同步和异步路径行为不同？

**不应该**——「两条路径同语义」是契约（快照的 `customCloner` 抛错语义、失败结果的 `stats` 都是同一实现），发现差异请提 issue 并附复现。契约上保留的唯一差别是**深度**：同步 `cloneDeep` 是递归实现，生效上限 `min(maxDepth, HARD_MAX_CLONE_DEPTH = 1000)`；异步走任务队列、栈深与数据深度无关，只按你给的 `maxDepth` 判定。同样 1500 层的数据，异步能克隆完，同步会在 1000 层处落 `maxDepth` 错误 + 占位。见 [CONCEPTS §8 同步与异步](./CONCEPTS.md#同步与异步)。
