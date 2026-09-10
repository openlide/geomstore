# 核心概念

本文解释 GeomStore 的模型与设计取舍。接口细节见 [API.md](./API.md)，落地写法见 [GUIDE.md](./GUIDE.md)。

## 1. 状态（State）

- **状态是就地变异的活动引用**：`getState()` 返回的是内部状态的引用（或保护代理），`setState` / `$patch` / action 内的直接写入都作用在同一对象上。
- **推荐用工厂函数声明**：`state: () => ({ ... })`。工厂在创建 Store 时执行，避免数组 / Map / Set 等引用类型被多个实例共享。
- **需要不可变副本时用快照**：`$snapshot()` 返回递归深冻结的结构；`$restore()` 从快照恢复。
- **就地变异带来的推论**：引用相等不等于内容相等。缓存与通知判定都不能依赖 `===`，这也是下文「版本号」与「脏计数」存在的原因。

## 2. 通知（Notify）

一次写入到监听器收到回调，中间有三层可配置语义：

| 配置 | 作用 | 默认 |
| --- | --- | --- |
| `notify.clone` | 通知时是否克隆状态；关闭且状态保护关闭时，**仅当无可读写订阅者**才返回原始引用（零拷贝） | `true` |
| `notify.async` | 微任务合并：同一 tick 内多次写入只通知一次 | `false` |
| `notify.onlyOnChange` | 脏跟踪：dispatch / batch 期间未实际改变状态则不通知 | `false` |

- **监听器只接收新状态**：`StateListener<S> = (state: S) => void`；需要前后对比请在闭包里自行保存。
- **只读订阅**：`subscribe(listener, { readOnly: true })` 声明不写入状态，通知路径可据此做零拷贝优化。
- **dispatch 的通知去重**：异步 action 的同步段不单独通知（其变更会被完成时的补发覆盖），`await` 之后的变更在结算时补发一次；嵌套 dispatch 仅最外层通知；dispatch 与 batch 交叉时由 batch 收尾统一通知。
- **订阅有上限**：达上限时可配置驱逐最旧监听器或直接抛错；同一监听器重复订阅按引用计数计次（退订一份不误删其他份）。

## 3. 状态保护（State Protection）

`stateProtection` 开启后，状态访问经代理拦截写入、删除与 `Object.defineProperty`：

- **四种代理**：深层对象、浅层对象、数组、脏跟踪专用代理，共用同一组写陷阱；数组的索引 / symbol / 自定义属性上的对象值都经缓存包装，不存在绕过保护的裸引用
- **非法变更抛错**：越过 `setState` / `$patch` 直接变异会抛错（开发模式给出可读路径），错误消息对 BigInt / 循环引用值安全
- **`deep: false` 只保护顶层**：嵌套对象不再被包装（性能优先）

## 4. 版本号（stateVersion）

每次状态写入都会推进一个内部版本号，`getStateVersion(state)` 可读取。

- **用途**：选择器缓存命中判定退化为 O(1) 整数比较——若改为对缓存项做全树 `deepEqual`，2000 键的状态树上单次判定即达秒级，而整数比较是亚毫秒级。
- **回退路径**：状态不带版本号（例如直接传入的普通对象）时，选择器回退用 `equalityFn`（默认 `deepEqual`）比较。

## 5. 缓存（Cache）

`enableCache(keys?)` 打开 Store 内置缓存（`keys` 省略表示全部顶层键），`getCached` / `invalidateCache` / `getCacheStats` 分别用于读取、失效与观测。

- **失效时机**：对应键发生写入即失效，下次读取重新计算
- **按需开启**：`cacheConfig.enableStats` 采集命中统计有额外开销；只缓存高频键（如长列表）收益最大
- **LRU 工具**：核心另导出 `LRUCache`（容量淘汰 + TTL），供需要独立缓存策略的场景使用

## 6. 快照（Snapshot，`extras/snapshot`）

**隔离契约**：快照绝不会把活引用兜底进结果。任何无法安全克隆的节点都会被丢弃（同步路径不写该位置 / 数组留洞；异步路径跳过填充），并把错误记入 `errors`。

- **错误账本 + 降级策略**：每个节点失败都会落账 `cloneError`；`onError` 回调返回 `true` 继续（丢弃该节点）、`false` 中止整次快照。存在 `cloneError` 时 `success` 为 `false`。
- **同步 / 异步**：同步实现是迭代式深克隆（不递归爆栈）；异步实现按 `batchSize` 分片、批间让出控制权，适合大对象并支持 `onProgress`。
- **其他维度**：`maxDepth` 超限返回占位符（不返回活引用）、循环引用检测始终生效（`detectCircular` 只控制是否上报）、访问器属性以 getter 求值结果克隆、类实例保留原型。
- **自定义克隆器**：两条路径共用同一套抛错语义（落账 → 咨询 `onError` → 继续则丢弃 / 中止则抛 `SnapshotAbortError`）。

## 7. 选择器（Selector，`extras/selector`）

- **创建形式**：`createSelector(单个选择器函数, 选项?)`；`createMemoizedSelector` 是携带自定义相等函数的便捷包装；多步计算请在函数体内完成
- **参数化选择器**：`createParametricSelector(fn, { ttl, maxEntries })` 按参数分别缓存，注意 TTL 与容量上限（`ttl: 0` 表示永不过期）
- **组合与重试**：`SelectorComposer` 提供异步与重试形态；重试错误带不可枚举的 `attempts`（真实执行次数）

## 8. 错误处理（`extras/error`）

- **错误模型**：`GeomStoreError` 携带错误码与上下文，派生出 `ActionError` / `StateError` / `SelectorError` / `PluginError` / `ComposeError` / `ValidationError`，并有对应的 `is*Error` 守卫
- **边界（ErrorBoundary）**：默认 fail-loud——未配置 `fallback` 时错误重抛；提供 `fallback` 即视为声明恢复意图，`fallback` 函数自身抛错会重抛**原始错误**（不丢失现场）
- **恢复（ErrorRecovery）**：策略含 `RETRY` / `FALLBACK` / `IGNORE` / `RECOVER` / `RESTART`；重试额度按**故障周期**计量（时间窗 = `max(60s, 本周期退避总时长 × 2)`），并有键容量守卫防动态 operation id 导致的无界增长
- **监控（ErrorMonitoring）**：批量 flush 对每个 reporter 做 `ok / fail / timeout` 三态判定；仅真正 resolve 才算成功；全部失败则按序重入队重试，连续失败超过 `maxFlushRetries` 丢弃该批并告警（避免永久失败批次空转）

## 9. 插件（Plugin）

- **契约**：`{ name, install(store) }`，`install` 返回卸载函数（`store.use(plugin)` 返回同一函数）
- **钩子**：插件通过 `store.hooks.on/emit` 接入 `beforeDispatch` / `afterDispatch` / `beforeSetState` / `afterSetState` / `beforePatch` / `afterPatch` / `beforeReplaceState` / `afterReplaceState` / `onError` 等生命周期
- **安装安全**：`install` 抛错时回滚入列，不会残留半安装条目；生产模式下安装/卸载日志静默

## 10. 组合（Compose）

- **命名空间**：`composeStore([a, b], { namespace: true })` 下子 store 按 `name` 嵌套，dispatch 使用 `'storeName/actionName'`
- **脏追踪**：命名空间模式下 `isStateKeyDirty` 精确判断子 store 是否变化，集成层据此跳过未变化的 `setData`
- **订阅复用**：组合层 N 个监听器只占用每个子 store 一份订阅；无只读订阅者时通知走零拷贝
- **只读化**：`composed.state` 顶层冻结，嵌套经子 store 保护代理，写入不会穿透

## 11. 批处理（Batch）

`batch(fn)` / `startBatch` / `endBatch` 期间合并通知，结束时统一发一次；batch 会记录变更计数基线，`onlyOnChange` 下期间无变更则不通知。

> 注意：`batch(fn)` 传入**异步回调**时，`await` 之后的变更会逐条通知（批保护边界只在同步段有效），开发模式下会显式告警。

## 12. 一条写入的完整链路

以 `store.setState('count', 1)` 为例：

1. **保护代理**判定为合法写入（经 setState 而非直接变异）
2. 写入状态并**推进版本号**，脏计数 +1
3. **缓存**中 `count` 相关条目失效
4. 触发 `beforeSetState` / `afterSetState` 钩子（插件与监控在此接入）
5. 依据 `notify.async` 决定立即通知或合并到微任务；`notify.clone` 决定克隆或（条件性）零拷贝
6. 监听器收到新状态；`isStateKeyDirty('count')` 为 true，集成层据此更新 `setData`
