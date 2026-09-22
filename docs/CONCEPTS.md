# 核心概念

本文解释 GeomStore 的模型与设计取舍。接口细节见 [API.md](./API.md)，落地写法见 [GUIDE.md](./GUIDE.md)。

## 1. 状态（State）

- **状态是就地变异的活动引用**：`getState()` 返回的是内部状态的引用（或保护代理），`setState` / `$patch` / action 内的直接写入都作用在同一对象上。
- **推荐用工厂函数声明**：`state: () => ({ ... })`。工厂在创建 Store 时执行，避免数组 / Map / Set 等引用类型被多个实例共享。
- **需要不可变副本时用快照**：`$snapshot()` 返回深克隆后**部分冻结**的结构（纯对象与数组链上深度只读；经 Date / RegExp / Map / Set 或非纯对象触达的节点仍可变）；`$restore()` 从快照恢复。冻结范围只覆盖自有**可枚举字符串键**（数组按下标）——symbol 键（含状态版本号那个）、非可枚举自有属性、数组非下标自有属性指向的子对象都不在其中，这是与「冻结范围 ⊆ `deepCloneState` 隔离范围」配套的口径（那些键根本进不了快照），要 `Reflect.ownKeys` 口径请自行实现。
- **就地变异带来的推论**：引用相等不等于内容相等。缓存与通知判定都不能依赖 `===`，这也是下文「版本号」与「脏计数」存在的原因。
- **`setState` 的值按引用保存**：与初始化 / `$replaceState` 的深拷贝不同，Store 不接管调用方传入对象的归属——这是别名脏键与归属索引成立的前提（两者都按对象身份做可达性判定，写入时换一份克隆等于把「同一对象被多个顶层键引用」从状态图里抹掉）。代价是：调用方在 `setState` 之后再改它传进来的那个对象，Store 不察觉（无计数、无脏键、无钩子、缓存里就是同一引用）。要「写入即定格」请改用 `$patch`（补丁里的纯对象只在目标位置同为纯对象时逐层就地合并，其余分支一律换成克隆副本——但克隆本身按「不可安全克隆的值保留原引用」的口径工作，类实例 / Error / 字节缓冲等仍会与补丁共享引用，见 [BEST_PRACTICES](./BEST_PRACTICES.md) 的 `deepMerge` 说明），要可安全持有的副本请读 `$snapshot()`。

## 2. 通知（Notify）

一次写入到监听器收到回调，中间有三层可配置语义：

| 配置 | 作用 | 默认 |
| --- | --- | --- |
| `notify.clone` | 通知时是否深拷贝载荷。**未配置与显式 `false` 同义（自动）**：仅当存在可写注册时拷贝——每个可写注册各一份、只读注册共用一份；全部注册只读时零拷贝（状态保护开启给只读保护 Proxy、关闭给原始引用）。显式 `true` 强制拷贝，即使本轮只有只读注册（那时是共用的那一份） | 未配置（自动） |
| `notify.async` | 微任务合并：同一 tick 内多次写入只通知一次 | `false` |
| `notify.onlyOnChange` | dispatch / batch 期间未检测到写入则不通知（依据变更计数，非内容深比较） | `false` |

- **监听器只接收新状态**：`StateListener<S> = (state: S) => void`；需要前后对比请在闭包里自行保存。
- **只读订阅**：`subscribe(listener, { readOnly: true })` 声明不写入状态。载荷形态据此**按注册**决定：全部订阅者只读时免深拷贝（开启状态保护则收到只读保护 Proxy，关闭时是原始引用，回调需自行保证不写）；一旦存在可写注册，每个可写注册各拿一份独立深拷贝、只读注册共用一份——先执行的可写回调就地改载荷，不会再让同一轮里后面的监听器读到半成品。份数由 `maxSubscribers` 封顶，不随重复注册无界扩张。页面 / 组件 / App 的映射订阅本身就是只读注册。
- **dispatch 的通知去重**：异步 action 的同步段不单独通知（其变更会被完成时的补发覆盖），`await` 之后的变更在结算时补发一次；嵌套 dispatch 仅最外层通知；dispatch 与 batch 交叉时由 batch 收尾统一通知。通知收尾链路自身抛错（补刷缓存、emit 钩子）不再变成 `unhandledRejection`，而是转投 `onError`；订阅回调抛错同样在生产经 `onError` 上报（控制台仍静默），单个坏订阅者不影响其余监听器。
- **订阅有上限**：`maxSubscribers` 是**硬上界**，门禁对每一次注册生效（含同一监听器的重复注册）。达上限时按策略处理：`throw` 抛错；`evict-oldest` 驱逐一份最早注册（本次是重复注册就让位该监听器自己最早的一份，否则驱逐全局最旧的一份），并**向 `onError` 钩子发一次 `Error`**（第二参 `'subscribe'`；此前生产完全静默、被挤掉的订阅者无从定位）。每个退订句柄幂等，重复调用同一句柄不会退订其他注册。
- **两条通知通道对「迭代中退订」的口径不同**：同步通道（`SubscriptionManager`）按**进入本轮时在册的快照**派发，回调内退订自己、或本轮驱逐掉的最旧注册仍会收到这一次；`notify.async: true` 走的微任务合并通道（`AsyncBatchNotifier`）在 flush 时逐个复核在册状态，**已退订或被 `clear()` 摘除的监听器不再收本次回调**（它的下游是「状态变化 → 渲染 / 清理」，退订即表示处理方已失效）。依赖「退订立即生效」请在回调里自判存活标记。
- **Action 脏跟踪始终启用**：默认模式与 `onlyOnChange` 模式都通过可写代理记录对象 / 数组 / Map / Set 的直接变异，标记所有受影响的顶层键；异步 action 的脏键累积到通知时。`onlyOnChange` 额外依据变更计数跳过无写入的通知，并非前后内容深比较。
- **别名与边界**：同一对象复用同一代理；归属关系索引（对象 → 可达它的顶层键）增量维护——新增边只把容器归属键并入新子树（可剪枝），标量写入 O(1) 查表，删边类写入（覆盖已有对象值、`delete`、`Map` / `Set` 删除）与外部版本推进退化为全量重建，可识别未读取的别名、循环与重新挂接，构建与查找都不求值访问器。类实例与类型化数组同样被代理：实例属性写入与数组元素写入正常标记；实例方法调用保守标记所属键（方法内部的写入无法精细归因），读取时方法绑定到原始接收者，`#private` 字段与内部槽位可用。Date/RegExp/WeakMap/WeakSet 仍保留原引用、内部变异不跟踪；`$patch` 就地改写被其他顶层键引用的对象时，这些键一并标记。

## 3. 状态保护（State Protection）

`stateProtection` 开启后，状态访问经代理拦截写入、删除与 `Object.defineProperty`：

- **保护与脏跟踪分工**：深层对象、浅层对象与数组代理负责外部写入保护；Action 使用独立的可写脏跟踪代理。深层保护下数组的索引 / symbol / 自定义属性上的对象值经缓存包装
- **非法变更抛错**：越过 `setState` / `$patch` 直接变异会抛错（开发模式给出可读路径），错误消息对 BigInt / 循环引用值安全
- **`deep: false` 只保护顶层**：嵌套对象不再被包装（性能优先）
- **配置在构造期就要合法**：`stateProtection.productionHandler` 只接受 `'error' | 'warn' | 'silent'`，越界取值让 `createStore` 当场抛 `TypeError`，而不是留到很远的一次状态写入才以别的面目失败
- **保护层不抛 ≠ 底层写得进**：目标被 `Object.freeze`、属性不可写或不可配置时，`Reflect.set` 返回 false、严格模式下那次赋值照样抛 `TypeError`（不可配置又不可写的自有数据属性上，Proxy 不变量不允许谎报成功）。要判可写请显式 `Object.isFrozen`
- **自有不可写 / 不可配置的数据属性不被追踪**：Proxy 的 `[[Get]]` 不变量要求原样返回该值，调用方拿到的是裸对象，之后对它的写入不标脏、不推版本、不通知——把该状态放在可配置 / 可写的属性上，或经 `setState` / `$patch` 替换
- **读方法是缓存的**：保护代理上同一 (宿主, 键) 多次读取返回**同一**函数引用（此前每读一次 bind 一个新的，按引用相等做记忆化 / 依赖比较的调用方每次读都以为实现换了）；方法被整体替换后返回新实现的绑定。有一处**有意的保护豁免**：方法绑定到**原始接收者**，所以方法体内部的写入不经保护、也不进脏追踪
- **根状态是数组时走数组代理**：与嵌套数组同一套行为，错误路径形如 `[0].v`（浅保护不改道，其契约就是只保护顶层）

## 4. 版本号（stateVersion）

每次状态写入都会推进一个内部版本号，`getStateVersion(state)` 可读取。

- **用途**：选择器缓存同时校验**状态对象身份与版本号**（O(1)），不做全树比较。不同 Store 独立计数，版本号相同也不能跨状态对象误命中。
- **回退路径**：状态不带版本号（例如直接传入的普通对象）时，选择器改比**内容**——写缓存时先深克隆一份状态，命中判定用 `equalityFn(快照, 当前状态)`（默认 `deepEqual`），因此就地变异能被感知。这条凭证是显式选项 `snapshotState`（默认 `true`）：只有引用相等的比较器（`(a, b) => a === b`）才需要 `snapshotState: false` 换掉那趟克隆，否则克隆体与活引用永不相等 → 缓存永不命中。`createParametricSelector` 没有可注入的比较器（state 侧写死 `deepEqual`），也就没有这个选项。

## 5. 缓存（Cache）

`enableCache(keys?)` 打开 Store 内置缓存（`keys` 省略表示全部顶层键），`getCached` / `invalidateCache` / `getCacheStats` 分别用于读取、失效与观测。

- **刷新时机**：受控写入更新对应缓存；dispatch 收尾及异步结算时刷新缓存中已有键与当前状态键，清除 action 内已删除的键；`$replaceState` 清空整表后按新状态回填
- **按需开启**：`cacheConfig.enableStats` 采集命中统计有额外开销；只缓存高频键（如长列表）收益最大
- **配置归一**：`cacheConfig.ttl` 只接受**有限非负**数值——`NaN` / `Infinity` / `-Infinity` / 负数一律归一为 `0`（＝不过期）并打一条开发期告警，合法的 `0` 与正数原样保留、不告警。此前这些非法值靠「`> Infinity` / `> NaN` 恒 false」意外得到永不过期，算错的配置无声吞掉
- **LRU 工具**：核心另导出 `LRUCache`（容量淘汰 + TTL），供需要独立缓存策略的场景使用。容量默认 100、非有限值回退默认、小于 1 夹到 1，小数不取整（淘汰判据是 `size > capacity`，故 `2.5` 的等效上限是 2 条）；`getStats().evictions` 的契约是 **`onEvict` 触发次数**（`clear()` 这类配置性清空同样计入），不是「因容量上限被挤出的条目数」，需要后者请在清空前后各读一次求差

## 6. 快照（Snapshot，`extras/snapshot`）

**隔离契约**：快照绝不会把活引用兜底进结果。任何无法安全克隆的节点都会被丢弃（同步路径不写该位置 / 数组留洞；异步路径跳过填充），并把错误记入 `errors`；异常或中止时交付的 `data` 是 `undefined`，不是调用方的原始对象。

- **错误账本 + 降级策略**：每个节点失败都会落账 `cloneError`。`onError` 按**真值**解释（判定写法是 `if (!shouldContinue)`）：truthy 忽略该错误并按种类降级，falsy（含不写 `return` 的 `void` 写法）拒绝继续——`cloneError` 下抛 `SnapshotAbortError`、整次 `success: false`；`circular` 下只在该位置写 `'[Circular Reference]'` 占位并继续（快照仍可 `success: true`）。纯观测请显式 `return true`。`errors` 是**完整账本**：`circular` 先入账、再用同一条记录去咨询 `onError`，`maxDepth` 超限也落一条 `maxDepth` 错误，不再只体现在 `stats` / `metadata` 里。只有 `cloneError` 参与 `success` 判定，故 `success: true` 且 `errors` 非空是合法状态；失败必然带原因。
- **同步 / 异步**：同步实现是**递归**深克隆（栈深＝数据深度），深度上限是 `maxDepth`（默认 100）与一个与选项无关的栈安全硬上限 `HARD_MAX_CLONE_DEPTH = 1000` 的较小值——把 `maxDepth` 抬高不再等于放任调用栈溢出（此前是 `RangeError` 伪装成某个属性的 `cloneError` 且整次失败），`maxDepth` 传 `NaN` / `Infinity` 也落到硬上限；异步实现按 `batchSize` 分片、走任务队列不占调用栈、批间让出控制权，适合大对象并支持 `onProgress`。`onProgress` 抛错被就地兜住（落一条 `unknown`、不影响 `success` 与克隆结果），`onError` 作为决策回调仍会让整次快照失败。
- **其他维度**：`maxDepth` 超限返回占位符（不返回活引用）、循环引用检测始终生效（`detectCircular` 只控制是否上报）、访问器属性以 getter 求值结果克隆、类实例保留原型、函数按引用共享（无内部状态，共享无副作用）、`metadata.nodeCount` 两条路径同口径（实际进入克隆的节点数）。被 Proxy 包装过的 Date/RegExp/Map/Set 在类型判定处抛错时同样按节点落账并咨询 `onError`（异步路径）。
- **自定义克隆器**：两条路径共用同一套抛错语义（落账 → 咨询 `onError` → 继续则丢弃 / 中止则抛 `SnapshotAbortError`）。
- **差异比较**：`SnapshotManager.compareSnapshots` 按活动对象对识别循环，共享子对象仍在各路径比较；自有 `undefined` 属性的新增 / 删除与键缺失不同，分别报告 `kind: 'added' | 'removed'`。`Map` 键与 `Set` 元素的无序配对共用同一实现与同一套护栏：预算按**结构比较次数**计（不是按项数），超预算才退化为整体差异；结构配对一律以无限深度预算调 `deepEqual`，故超深的等价键不会成对误报「一删一增」；原型不同的对象在任意深度都判为有差异。
- **不要混淆时间旅行契约**：`timeTravelPlugin.getSnapshots()` 使用核心 `deepCloneState` 克隆支持的普通对象 / 数组 / Date / RegExp / Map / Set（支持循环引用）；类实例、函数、Promise、WeakMap 等保留原引用，不能宣称与 extras 快照一样完全隔离。

## 7. 选择器（Selector，`extras/selector`）

- **创建形式**：`createSelector(单个选择器函数, 选项?)`；`createMemoizedSelector` 是携带自定义相等函数的便捷包装；多步计算请在函数体内完成
- **参数化选择器**：`createParametricSelector(fn, { ttl, maxEntries })` 按参数分别缓存，注意 TTL 与容量上限（`ttl: 0` 表示立即过期，等同禁用缓存）。`maxEntries` 走归一化（`0` / 负数夹到 1、`NaN` / `Infinity` 回退 1000、小数向下取整），`ttl` **刻意不归一**——读侧判据是 `timestamp + ttl > now`，`0` / 负数 / `NaN` 都只是「立即过期＝不缓存」，没有 `cacheTTL` 那种「永不过期 → 返回陈旧值」的劣化。函数参数与对象参数同样走 WeakMap（不受强引用侧的容量淘汰，也不额外钉住闭包作用域）；状态侧传 `null` / 原始值时降级为「每次重算、不缓存」而不是抛错
- **组合与重试**：`SelectorComposer` 提供异步与重试形态；重试错误带不可枚举的 `attempts`（真实执行次数，嵌套重试时取两者之大、只增不减），喂给 `shouldRetry` 的是规范化后的 `Error`（`throw 'str'` 被包成 Error），而**抛给调用方的仍是原始值**；异步组合每次调用返回的 Promise 都必须 `await` 或挂 `.catch`，库不代为吞掉 rejection

## 8. 错误处理（`extras/error`）

- **错误模型**：`GeomStoreError` 携带错误码与上下文，派生出 `ActionError` / `StateError` / `SelectorError` / `PluginError` / `ComposeError` / `ValidationError`，并有对应的 `is*Error` 守卫。构造器接受可选的 `cause`（第 5 参，派生类第 4 参），`toJSON()` 只在提供时多一个 `cause` 键；`toJSON().context` 是**可 JSON 化的等价结构**而非入参逐字拷贝（循环引用 → `'[Circular]'`、BigInt → `'123n'`、取值即抛的访问器 → `'[Unreadable]'`、超 `6` 层 → `'[Truncated]'`），构造期也早已把 `context` 浅拷贝一份，调用方事后改入参不影响已捕获现场
- **边界（ErrorBoundary）**：默认 fail-loud——未配置 `fallback` 时错误重抛；提供 `fallback` 即视为声明恢复意图，`fallback` 函数自身抛错会重抛**原始错误**（不丢失现场）。非 `Error` 的抛出值在入口归一化后再记账与传给回调，重抛时仍是原始值；显式 `recoverable: true` 而无 `fallback` 时返回 `undefined`。`@withErrorBoundary` 只对**被包裹方法的原始返回值**做 thenable 判定：回退值即使自带可调用的 `then` 也不会被 await，返回形状不会从 `X` 悄悄变成 `Promise<X>`。`ErrorHandler` 的异步 handler 返回的 Promise 也有一条兜底出口（rejection 折成一条 `[ErrorHandler] Error in error handler:` 日志，不再是无人接的拒绝），交给用户 handler 的上下文是**副本**
- **恢复（ErrorRecovery）**：策略含 `RETRY` / `FALLBACK` / `IGNORE` / `RECOVER` / `RESTART`；重试额度按**故障周期**计量（时间窗 = `max(60s, 本周期退避总时长 × 2)`），并有键容量守卫防动态 operation id 导致的无界增长。**额度用尽后不会重置**——抛 `Max retries exceeded` 时保留计数与周期窗，同一故障周期内的后续 `recover()` 持续被拦截，只有时间窗过期才开新周期。策略内部失败（含额度耗尽、无回退可返回、无 `recoverFn`、未知策略）统一抛 `GeomStoreError`（`code: INTERNAL_ERROR`、带 `cause` 与 `context`，`context.retryKey` 指明是哪一份额度；`storeName` 与 `operation` 都缺时键名为 `<code>:unattributed`，只缺一个维度时按已报出的维度隔离）。`recover()` 的受控字段（`error` / `config` / `attempt`）由库内写入，调用方上下文无法覆盖实际执行的策略与重试记账键。
- **监控（ErrorMonitoring）**：批量 flush 对每个 reporter 做 `ok / fail / timeout` 三态判定；仅真正 resolve 才算成功（`reportTimeout <= 0` 表示不超时）；全部失败则按序重入队重试，连续失败超过 `maxFlushRetries` 丢弃该批并告警（避免永久失败批次空转）。容量类入参走下限裁剪（`maxQueueSize` 最小 1、`maxFlushRetries` 最小 0，非有限值回默认），`clear()` 除复位连续失败计数外还给在途 flush 打**代际标记**——旧批次不再回流队列、也不会把失败计数从无拨成 1。溢出被丢弃的条数是可消费指标：`getDroppedErrors()` 与 `generateReport().summary.droppedErrors`；它与 `summary.totalErrors`（观测到的错误数）、`summary.queuedErrors` 是三个互不重叠的口径，**不能相加核对**。聚合组对外一律给副本（`getGroups()` / `addError()` / `getErrorGroups()` / `generateReport()`），改它们不再污染内部账目。聚合统计与错误组同生命周期：组被驱逐时其按 Store 的计数一并删除，`sum(byStore) === totalErrors` 长期成立；组内样例是不含 `payload` 的浅拷贝并随命中刷新，避免进程级缓存钉住 store / 页面节点。指纹 → 组 ID 由反向索引维持，哈希碰撞的邻居组被驱逐后同一指纹仍并入原组、计数不重置。

## 9. 插件（Plugin）

- **契约**：`{ name, install(store) }`，`install` 返回卸载函数（`store.use(plugin)` 返回同一函数）
- **钩子**：插件通过 `store.hooks.on/emit` 接入 `beforeDispatch` / `afterDispatch` / `beforeSetState` / `afterSetState` / `beforePatch` / `afterPatch` / `beforeReplaceState` / `afterReplaceState` / `onError` 等生命周期。处理器的形参与 `emit` 的实参在类型层按**钩子名**关联（写错个数 / 顺序即编译错误）。`on()` 返回的退订句柄是**一次性**的：第二次调用是 no-op，`on → off → on → off(旧句柄)` 不会把新那次注册摘掉。`emit` 逐个 `try/catch`：单个处理器抛错不影响其余处理器、也不传播给 `emit` 调用方，先 `console.error` 再转投 `onError`（`onError` 自身抛错只落日志、不递归）；需要让异常冒泡到业务方请走 action 的错误边界。`emit('onError', error, source)` 的第三参在**同步 dispatch 中止**那条路径上是 `'dispatch'`（性能插件据此作废本次进行中的计时），其余失败发射不带来源。
- **安装安全**：`install` 抛错时回滚入列，不会残留半安装条目；生产模式下安装/卸载日志静默。在**已销毁**的 Store 上调用 `usePlugin(plugin, store)` 现在把 `store.use` 抛出的异常原样冒泡（该降级只罩住「插件自身安装失败」这一类）

## 10. 组合（Compose）

- **命名空间**：`composeStore([a, b], { namespace: true })` 下子 store 按 `name` 嵌套，dispatch 使用 `'storeName/actionName'`；合并的 `actions` 注册表也支持外层组合路由嵌套组合的裸名 action（非命名空间模式同名取第一个 Store）
- **合并缓存**：`getState()` / `state` 读取前校验子 Store 版本，批内或异步通知尚未发出时也保持新鲜；无版本号的子 Store（含嵌套组合）每次读取保守失效
- **嵌套内层**：非命名空间外层包含命名空间内层时，其子 store 的键为「子 store 名/键」，写操作需用完整斜杠路径（构造期开发模式提示）。该归属判定只看数据形状，与 `$replaceState` 的丢键告警开关无关——同一份写入在开发与生产走同一分支
- **脏追踪**：命名空间模式下 `isStateKeyDirty` 精确判断子 store 是否变化，集成层据此跳过未变化的 `setData`；通知回调内的重入写入留给下一轮（本轮收尾只作废本轮脏键）
- **订阅复用**：组合层 N 个监听器只占用每个子 store 一份订阅；子 store 的订阅按只读注册，因此通知路径免深拷贝
- **只读化**：`composed.state` 顶层冻结，嵌套经子 store 保护代理，写入不会穿透
- **批量写入的原子性**：命名空间 + `strict` 的 `dispatch` 先完成全部查找与校验再统一写入——要么全写、要么一个都不写，不再留下「前一半已落库」的中间态；已销毁子 store 抛出的**非销毁类**异常（不是「Cannot call … on a destroyed Store」那一类）也不再被吞掉，向调用方冒泡
- **注册表（`StoreRegistry`）**：同一实例可用多个名字登记。`unregister(name)` 与同名覆盖会摘掉该实例的**全部**别名并只 `destroy()` 一次（此前其余名字继续返回已销毁实例）；`destroy` 回调里重入登记同名时，重入的那个实例照常退场，返回后 `get(name)` 一定是本次注册的实例；缺 `destroy` 的鸭子类型实例不再以 TypeError 收场。`clear()` 的契约是「进入本方法时在册的条目全部注销」，清理过程中重入 `register()` 新增的条目会保留（`size()` 因此可以不为 0）

## 11. 批处理（Batch）

`batch(fn)` / `startBatch` / `endBatch` 期间合并通知，结束时统一发一次；batch 会记录变更计数基线，`onlyOnChange` 下期间无变更则不通知。

> 注意：`batch(fn)` 传入**异步回调**时，`await` 之后的变更会逐条通知（批保护边界只在同步段有效），开发模式下会显式告警。

## 12. 一条写入的完整链路

以 `store.setState('count', 1)` 为例：

1. **保护代理**判定为合法写入（经 setState 而非直接变异）
2. 写入状态并**推进版本号**，脏计数 +1
3. **缓存**中 `count` 相关条目失效
4. 触发 `beforeSetState` / `afterSetState` 钩子（插件与监控在此接入）
5. 依据 `notify.async` 决定立即通知或合并到微任务；`notify.clone` 与「本轮有没有可写注册」共同决定载荷形态（可写注册各一份克隆、只读注册共用一份，全只读时零拷贝）
6. 监听器收到新状态；`isStateKeyDirty('count')` 为 true，集成层据此更新 `setData`
