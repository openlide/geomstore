# SKILL.md 第五轮同步台账

> 已完成 18/18 条清单项 + 自查 3 项（R5-SKILL-19 ~ 21），共 21 条：FIXED 18 / FP 1（R5-SKILL-21）/ REJECT 2（R5-SKILL-05、R5-SKILL-18）。条目按核对顺序落盘，编号沿用清单序号，故非严格递增。

### R5-SKILL-01 SelectorOptions.snapshotState 与引用相等比较器
verdict=FIXED
源码依据：src/types/selector.ts:70-85（`snapshotState` 默认 `true`＝缓存内容快照）、src/extras/selector/createSelector.ts:109（`snapshotState: options.snapshotState ?? true`）、createSelector.ts:248（`version === undefined && this.options.snapshotState ? clone(state) : state`）、createSelector.ts:434-439（`createMemoizedSelector` 只把 `equalityFn` 转交 `createSelector`，不带 `snapshotState`）
改动：「选择器」段（原 173 行）主会话写的正文与源码一致，未回退；补一句堵住残留误用点——`createMemoizedSelector(fn, equalityFn)` 的第二参不会顺手关掉快照，要走引用相等必须改用 `createSelector(fn, { equalityFn, snapshotState: false })`。

### R5-SKILL-07 SelectorComposer.combine 泛型透传 R
verdict=FIXED
源码依据：src/extras/selector/selectorComposer.ts:66-80（`combine<S, R = unknown, T>` 入参为 `SelectorComposerInput<S, T, R>`，实现体 `return combiner(...results)`，`as R` / `as unknown as T` 两处断言均已删除）、src/types/selector.ts:117-121、tests/types/selector-combiner-result.typecheck.ts（反例用 `@ts-expect-error` 锁定）
改动：「选择器」段末句加写：`R` 由 `combiner` 返回类型反推；显式 `combine<S, R>(…)` 而 combiner 返回不符现在编译失败（此前被断言吞成 `R`），两参数写法的 `R` 仍默认 `unknown`、行为不变。原「需显式给出状态类型参数」一句仍成立（docs/API.md:331 同口径），保留。

### R5-SKILL-08 cacheTTL 归一化守卫
verdict=FIXED
源码依据：src/extras/selector/createSelector.ts:94-98（`typeof v === 'number' && v > 0 ? v : 5000`，注释明写「放行 Infinity」是有意的）、createSelector.ts:90-93（`cacheSize` 是另一条 `Number.isFinite ? Math.max(1, v) : 10`）
改动：「选择器」段补一句：`cacheTTL` 只认正数、`NaN`/`0`/负数/非 number 回落 5000、`Infinity` 有意放行＝不按时间过期；并显式写明它与 `cacheSize` 的归一化**不是同一套**（未使用「统一归一化」这类措辞）。

### R5-SKILL-02 WxStorageBackend 缺失即抛错
verdict=FIXED
源码依据：src/plugins/WxStorageBackend.ts:115-127（`resolve()` 在 `!api || typeof fn !== 'function'` 时抛错）、:145-170（三方法各自 `run` 记录 + 重抛）、:75-79（`isWxStorageSyncAvailable` 要求三方法齐备）；src/plugins/builtin.ts:192-202（只有 persistencePlugin 的探测路径降级内存）
改动：157 行那段主会话已写好且与源码一致，未回退。本条实际改动在**示例代码**：`extras/plugins` 的 import 行补上 `WxStorageBackend`（正文叫读者「接入微信请传 `new WxStorageBackend()`」，示例却没引入该符号，照抄即编译失败），并在 `persistencePlugin({...})` 示例里加上 `storage: new WxStorageBackend()` 一行。符号确由该入口导出：src/extras/plugins.ts:19。

### R5-SKILL-03 ErrorRecovery 达 maxRetries 保留计数与周期键
verdict=FIXED
源码依据：src/extras/error/ErrorRecovery.ts:334-351（超限分支注释「达到上限时**保留**计数与周期窗」，抛 `ErrorCode.INTERNAL_ERROR` 且 context 带 `retryKey`/`attempts`）、:276-302（周期窗判定 + delete-then-set 重插）、:204-209（仅恢复成功清该键）、:436-444（RESTART 清该键）、:525-528（`clearAllRetryCounts` 计数与窗口一起清）、:484-500（键粒度与 `unattributed` 兜底桶）、:149-174（非 GeomStoreError / 未配置策略都抛 GeomStoreError 并挂 cause）
改动：「错误处理」代码块后新增一段：RETRY 不替调用方重跑原操作、额度按 (store, operation) 键 + 时间窗累计、达上限保留计数（同一失败循环不会每轮领新额度）、清零路径只有周期窗过期 / 恢复成功 / RESTART / `clearAllRetryCounts()`；并写明 `recover` 的失败一律是带 `code` 的 `GeomStoreError`。

### R5-SKILL-12 ErrorMonitoring.generateReport().summary.droppedErrors
verdict=FIXED
源码依据：src/extras/error/ErrorMonitoring.ts:319-361（generateReport 三字段与「不能相加核对」注释）、:142-149（入队溢出 `droppedErrors++`，`totalErrors` 不回退）、:300-312（失败批次重入队裁剪同样累加）、src/types/error.ts:270-281
改动：「错误处理」段新增一句：`totalErrors` / `queuedErrors` / `droppedErrors` 三口径互不重叠、不能相加核对（被丢弃的那条已计入 `totalErrors`，成功投递的既不在 queued 也不在 dropped）。SKILL.md 此前完全未提 `ErrorMonitoring`，属新增契约而非改错。

### R5-SKILL-04 withLog：sink/redact 抛错隔离、生产 Error 只留 name、summarizeInProduction
verdict=FIXED
源码依据：src/extras/action/decorators/log.ts:74-80（`safeLog` 包住每次 sink 调用，抛错只 `console.warn`）、:60-67（`summarize`：`value instanceof Error → value.name`，不含 message）、:39-49（`summarizeInProduction` 默认 true，生产下 redact 的返回值仍要过摘要）、:124-133（`summarizeOutput = production && (options.summarizeInProduction ?? true)`）
改动：原句「要自定义脱敏传 redact（…显式给出即以你给的为准）」是**错**的（生产下 redact 让位于强制摘要），已改写为「非生产即最终输出 / 生产还要再过一道摘要 / 需显式 `summarizeInProduction: false` 才由 redact 全权决定」；补 `Error` 只留 `name` 不含 `message`、`sink`/`redact` 抛错与业务调用隔离。签名行的 `options` 形状同步补 `summarizeInProduction?`。

### R5-SKILL-09 extras/action 子入口符号面
verdict=FIXED
源码依据：src/extras/action/index.ts:29-65（新增 `type LogSink`、`type LogPhase`、`type ActionErrorData`、`type RetryOptions`、`type TimeoutError`、值 `TIMEOUT_ERROR_CODE`；及防抖/节流各 3 个收尾函数 `cancelDebouncedCalls`/`flushDebouncedCalls`/`disposeDebouncedState`、`cancelThrottledCalls`/`flushThrottledCalls`/`disposeThrottledState`）
改动：SKILL.md 没有「入口有 N 个符号」这类计数表述（已 grep 确认），但完全没有符号面指引，读者会去深链叶子文件。在「Action 装饰器」签名段后新增一段：列出这 6 个收尾函数与 6 个类型/错误件，并明确 `exports` 未声明叶子路径、不要深链。

### R5-SKILL-11 ActionLoaderOptions.perActionKeys
verdict=FIXED
源码依据：src/types/action.ts:36-43（默认 false，开启后 `${baseKey}_${actionName}`）、src/extras/action/ActionLoader.ts:35-36（`perActionKeys: false` 默认）、:427-452（`getLoadingKey`/`getErrorKey`/`getErrorDataKey` 三处派生）
改动：「Action 装饰器」签名段末补一句：`ActionLoader` 默认多个异步 action 共用 `loadingKey`/`errorKey`/`errorDataKey`（并发互相覆盖），`perActionKeys: true` 后键派生成 `loading_fetchUser` 这类形态。

### R5-SKILL-13 超时错误身份判据 TIMEOUT_ERROR_CODE
verdict=FIXED
源码依据：src/extras/action/async-core.ts:96-119（`TIMEOUT_ERROR_CODE = 'ACTION_TIMEOUT'`、`createTimeoutError` 唯一构造点）、:247-254；decorators/timeout.ts:74（文案 `Timeout after ${delay}ms`）、AsyncActionSupport.ts:366（文案 `Action timeout after ${timeout}ms`）、src/core/errors/GeomStoreError.ts:474（`ACTION_TIMEOUT = 'ACTION_TIMEOUT'`）
改动：「Action 装饰器」语义列表新增一条：判超时按 `error.code === TIMEOUT_ERROR_CODE`（值与 `ErrorCode.ACTION_TIMEOUT` 同串），两入口文案不同且只作展示；并补「超时不可取消、底层 Promise 仍在后台跑完」（async-core.ts:241-243）。

### R5-SKILL-15 withRetry 装饰同步方法返回 Promise<T>
verdict=FIXED
源码依据：src/extras/action/decorators/retry.ts:47-51（JSDoc「**返回类型会变**」）、:90-93（`descriptor.value = async function …`）
改动：语义列表新增一条：`withRetry` 的包装是 `async`，装饰同步方法后返回 `Promise<T>`、同步抛出改判 rejection，靠同步返回值/`try…catch` 的调用点要改写；不想改就别给同步方法加。与 `createDecorator`「不把同步方法包成 async」那条并列后不再互相误导（createDecorator 的行为已按 src/extras/action/decorators/common.ts 核对，未改）。

### R5-SKILL-10 withAppStore 的 autoUpdateOnShow 与按自有属性写入
verdict=FIXED
源码依据：src/integrations/with-app-store.ts:265-281（`if (options.autoUpdateOnShow && options.autoInject && hasInjectMapping)` 才装 onShow 包装器，内部 `performAutoInject` + `finally` 转发用户 onShow）、:212-216（`writeGlobalData` 走 `copyOwnEntries`，注释点名 `'__proto__'` 不得命中 setter）、src/integrations/utils.ts:61-63（`setOwnEntry` = defineProperty）、utils.ts:345-366（`performAutoInject` 读 `store.getCached`、undefined 跳过）、with-store.ts:238 / :445（Page 用 `onShow`、Component 用 `pageLifetimes.show`）
改动：「接入微信小程序」段末补一段：`autoInject` 只在挂载钩子注入一次、`autoUpdateOnShow` 需与 `autoInject` 同开且 `injectMapping` 非空才追加回前台重注入（三端各自的钩子名已写明）；映射/注入键按自有属性写入，`'__proto__'` 不再被静默丢弃。SKILL.md 此前完全没提这两个开关，读者会以为 App 侧无效或干脆不写。

### R5-SKILL-14 notify.clone / 订阅载荷归属
verdict=FIXED
源码依据：src/core/store/Store.ts:1181-1210（`needsClone = 显式 clone || hasWritableListeners()`；需要隔离时把**原始状态**连同 `cloneOnNotify=true` 交下去，不再自备克隆后传 false）、src/core/store/SubscriptionManager.ts:261-299（只读注册共用 `sharedPayload`，`payloads.push(cloneOnNotify && !readOnly ? deepCloneState(state) : sharedPayload)`＝每个可写注册各一份独立深拷贝）、:274-278（注释「只读订阅不改载荷，继续共用一份」「份数由 maxSubscribers 封顶」）
改动：「性能与最佳实践」的 `notify.clone` 条改正——原文「存在可写订阅者时每次深拷贝」会被读成「整轮共用一份克隆」（或被反过来写成「默认总是深拷贝」），两者都与实现相反。现写明：判定需要拷贝后**按注册可写性分配**，可写注册各一份独立深拷贝、只读注册共用一份，一次 dispatch 可产生 N 份（N＝可写注册数）、由 `maxSubscribers` 封顶；补双重隔离目的（载荷 ↔ 活状态、监听器彼此）。

### R5-SKILL-16 快照 data / errors / 同步深度硬上限
verdict=FIXED
源码依据：src/extras/snapshot/types.ts:143-163（`data: T | undefined` 与三条不变量：只有 cloneError 参与 success、success:false 时 errors 必非空、失败可能是 undefined 或半成品）、src/extras/snapshot/SnapshotManager.ts:187（同步 `success: !errors.some(cloneError)`）、:542（异步再叠加 `!hasTimedOut`）、:341（onProgress 抛错记 `unknown`、不参与 success）、src/extras/snapshot/clone.ts:210-232（`HARD_MAX_CLONE_DEPTH = 1000`、`syncDepthLimit` 用 `<` 把 NaN/Infinity 一并落到硬上限、异步队列不叠加）
改动：「快照与性能」代码块注释改口径（`data` 是 `T | undefined`，超时下可能是半成品，用前必须判 success），并新增一段：`errors` 是完整账本（circular / maxDepth / onProgress 的 unknown 都入账但不影响 success）、只有 cloneError / 超时 / 顶层异常会让 success 变 false、`success: true` 时 errors 可以非空（别拿它当失败信号）、同步路径另有 `min(maxDepth, 1000)` 栈安全硬上限、更深结构走 `createSnapshotAsync`（不叠加硬上限）。

### R5-SKILL-17 isStateKeyDirty(key: string | symbol) 保守方向
verdict=FIXED
源码依据：src/core/compose/composeStore.ts:637-653（`_mergedCacheEnabled` 为假 → true；命名空间模式 `typeof key === 'string' ? this._dirtyStores.has(key) : true`；非命名空间模式恒 true；注释「保守的方向性始终是宁多勿漏」）
改动：「Store 组合」段补一句：组合层 `isStateKeyDirty` 收 `string | symbol`，只有命名空间模式的字符串键能精确判定，非命名空间与任何符号键一律保守返回 true（宁可多写一次 setData，不可漏更新）。原段只讲了 getState 的版本校验，没讲这个公开判定方法的失效方向。

### R5-SKILL-05 retrySelector 的 NO_ERROR 哨兵
verdict=REJECT
源码依据：src/extras/selector/retrySelector.ts:128-137（哨兵定义）、:245-251（`throwRetryExhausted` 用 `lastError !== NO_ERROR` 区分「没捕到」与「捕到 falsy 值」，且该分支按注释是运行期不可达的防御代码）
改动：不改。源码确实如此，但 SKILL.md 全篇没有介绍 `SelectorComposer.createRetrySelector` / `createRetrySelectorAsync`（只在 selector 段提过 `combine`），本轮改动对使用者的可见差异只有「抛 `null`/`0` 的选择器重试耗尽后原样抛该值并带 `attempts` 标注」这一条边角；为它单独引入整个重试选择器族（retries 校验、shouldRetry 规范化、delay 退避、不可取消）会新写一片未逐条核对的公开面，超出「与本轮修复对齐」的范围。若后续要补重试选择器，另开一轮。

### R5-SKILL-06 globalRegistry 的 Object.isExtensible + try/catch fail-safe
verdict=FIXED
源码依据：src/plugins/globalRegistry.ts:69-127（生产直接 no-op；`Object.isExtensible` 而非 `isFrozen` 的注释；探测/建表/defineProperty 三处 try/catch，失败只 `console.warn` 并跳过本次注册）、:134-152（卸载按令牌 + 自有属性守卫）
改动：折叠进两处（不另起小节）：① 插件段新增一段讲调试入口——四个 `__GEOMSTORE_*` 全局表、表键是 `store.name`、生产不挂表而插件本体照常采集、既有容器不可扩展/不可写时注册就地跳过并 warn 且不中断 `store.use()`；② 排查表把「时间旅行 / analyzer API 不存在」一行改写为按全局表口径的完整判据。

### R5-SKILL-18 StoreConfig 的 S 默认值与 ConfigState 别名
verdict=REJECT
源码依据：src/types/store.ts:281-307（`StoreConfig<S = Record<string, unknown>>`、`ConfigState`）、src/core/index.ts:22-33（主入口类型清单里没有 `StoreConfig` / `ConfigState`）、`grep StoreConfig dist/index.d.ts dist/core/index.d.ts` 无命中
改动：不改。两条都是**类型层内部口径**：`StoreConfig` 与 `ConfigState` 都不在任何 `exports` 面上（只 `src/types/store.js` / `dist/types/store.d.ts` 深路径可达，而深路径不在包的 exports 白名单内），SKILL.md 的导入路径表与「创建 Store」段讲的都是 `createStore` 的推断（`S` 由标注了返回类型的 state 工厂唯一确定），本轮改动不改变它的任何表述。写进 skill 反而会诱导读者去引不存在的类型名。

### R5-SKILL-19 自查：示例把内部字段 `store.__timeTravel__` 当公开入口
verdict=FIXED
源码依据：src/plugins/devtools/index.ts:33-46（「全局表是唯一的公开入口（表键为 store.name）」「`store.__timeTravel__` 是内部字段，不在 `Store` 公共类型上、也不参与类型检查，更没有对外契约」）、timeTravelPlugin.ts:456-457（`__timeTravel__` 经类型断言挂上）
改动：插件示例的注释由 `store.__timeTravel__.undo()` 改为 `globalThis.__GEOMSTORE_TIME_TRAVEL__['<store.name>']`——原写法在 TS 下直接编译不过（`Store` 上没这个成员），且指向一个无契约的内部字段。

### R5-SKILL-20 自查：排查表两行写成三列（markdown 表格破裂）+ 调试入口行口径
verdict=FIXED
源码依据：src/plugins/globalRegistry.ts:69-127（生产 no-op、容器不可复用时跳过并 warn）、src/plugins/performance/analyzerPlugin.ts:286-297（生产不挂全局表、`storeProxy.__performanceMonitor__` 仍赋值）、src/extras/snapshot/types.ts:143-163
改动：「快照结果 `data` 是 `undefined`」与「生产环境完全没有日志」两行原本是 3 个单元格（表头只有 2 列），已各自并成 2 列；同时把「时间旅行 / analyzer API 不存在」行改写为按全局表口径（表键＝store.name、生产不挂表但插件仍在采集、容器被外部占用时注册跳过并 warn、`store.__timeTravel__` 不作契约）。另在插件段补了同一口径的正文段落，避免只有表格里孤零零一句。

### R5-SKILL-21 自查：全篇其余表述与包面/默认值核对
verdict=FP
源码依据：package.json（`name=@openlide/geomstore`、`version=0.5.1`、`engines.node>=22.0.0`）、README.md:18（TS ≥ 5.4 / NoInfer）、src/core/store/Store.ts:56（`DEFAULT_MAX_SUBSCRIBERS = 50`）与 :191-201（stateProtection.productionHandler 默认 'warn'、notify.clone/async/onlyOnChange 默认值）、src/plugins/builtin.ts:38-45（loggerPlugin 生产静默）与 :192-212（降级只在探测路径、生产 emit onError）、src/core/hooks/HookSystem.ts:48-68（emit 逐个 try/catch、先 console.error 再转投 onError、onError 自身抛错不再转投）与 :84-96（`size(name)` / `listenerCount(name)`）、src/types/plugin.ts:46-75（`HookArgsMap` 精确形参）、src/core/store/Store.ts:501-511（`$snapshot` = `deepFreezeState(deepCloneState(...))`、Date/RegExp/Map/Set 留可变）、src/types/compose.ts:12-16（`namespace` / `strict`）、src/extras/snapshot/index.ts:18 与 src/integrations/index.ts:41（示例里的符号确有导出）
改动：未改。以上（含版本号、包名、导入路径表、子入口符号名、示例里用到的选项）逐条核对与源码一致；「主入口只含运行必需 API」「快照 `createSnapshot` 返回 `{ data, metadata, success, errors, stats }`」等表述也成立。唯一保留意见：SKILL.md 第 34 行讲 `subscription.onLimit` 时没点明默认值是 `'evict-oldest'`（src/types/store.ts:199-211 确认默认如此）——该段属主会话本轮已改好的三处之一，只补默认值即可，留给主会话决定是否加这半句。

---

## 留给主会话的两点（我不便动 src，也未写进 SKILL.md）

1. **源码自己的 JSDoc 与 `snapshotState` 默认值互相矛盾**：src/extras/selector/createSelector.ts:424-427 的 `createMemoizedSelector` 示例正好是 `(state) => state.user.name, (a, b) => a === b` —— 在新默认 `snapshotState: true` 下这个组合**永远不命中**（缓存放克隆体、比较器比引用）。SKILL.md 已按实现写清，但那份 JSDoc 会随 `pnpm skill:api` 落进 `references/api/extras-selector.md`，需要改源码注释（或让 `createMemoizedSelector` 在显式传引用相等比较器时联动 `snapshotState: false`，那是行为变更、不在本轮）。
2. **第 34 行订阅条目缺 `onLimit` 的默认值**：src/types/store.ts:199-211 确认默认 `'evict-oldest'`。该段属主会话本轮已改好的三处，我只补了核对结论、没有再动文字，是否加这半句请主会话定。
