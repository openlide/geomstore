# 分片 extras-action-p1 — 第五轮（ocrreview.md）25 条判定

清单：`.ocr-fix/groups5/extras-action-p1.md`。
owned 源码：`src/extras/action.ts`、`action/{ActionHistory,ActionLoader,ActionUtils,async-core,AsyncActionSupport}.ts`、
`action/decorators/{cache,common,debounce,log}.ts`。
回归锁：`tests/unit/r5-extras-action-p1-loader.test.ts`（21 例）、
`tests/unit/r5-extras-action-p1-decorators.test.ts`（19 例）。

自验口径（全部在改完后执行）：
- `npx tsc -p tsconfig.json --noEmit` → 0 error。
- `npx tsc -p tsconfig.tests.json --noEmit` → 本分片两测与十份源码零报错；
  残留报错全在 `tests/types/**`、`r5-core-store-p1-action.test.ts`、
  `r5-extras-error-reporters.test.ts`（并行分片中间态，未触碰）。
- `npx eslint <10 源码 + 2 测试>` → 0 error / 0 warning。
- `npx jest --ci --silent tests/unit/extras/action r5-extras-action-p1-{loader,decorators}`
  → 18 套件 / 337 例全绿。
- 覆盖率（`--collectCoverageFrom='src/extras/action/**/*.ts'` 限定本目录，跑
  `tests/unit/extras/action` + `r5-extras-action-{p1,p2}` + `hot-round5` + `ocr-*-round4`）：
  本分片 10 份源码 statements/lines/functions 全部 **100%**；
  branches：`cache.ts` 94.89%、`log.ts` 91.66%，其余 100%（门槛 branches 85 / functions 98 /
  lines 98 / statements 98 全部满足）。
- 期间 2 例失败（`#286/#287`、`#304`）在 `src/extras/snapshot/**`/clone，属并行分片中间态，
  与 p2 台账自验记录完全一致，本分片用例全绿。

分片承接的非编号项（任务书点名归本分片，不占 25 条）：

- **hot-p0 R5-193 连带项**：`decorators/cache.ts` 的异步性判定 `result instanceof Promise`
  改为 `isThenable(result)`，占位 Promise 由 `Promise.resolve(result).then(...)` 承载，
  与 `common.ts`/`throttle.ts` 同口径。落地位置 `cache.ts:411`；回归锁
  `r5-extras-action-p1-decorators.test.ts`「R5-193 连带项」用例（手写 thenable 走占位、
  `then` 只被调用一次、同参第二次复用同一 pending）。

- **p2 R5-175 NEEDS-MAIN**：共享超时错误构造点落在 `async-core.ts`（本分片所有）。新增
  `TIMEOUT_ERROR_CODE` + `createTimeoutError(message)`，`raceWithTimeout` 用它替换
  `new Error(timeoutMessage)`；两个入口（`decorators/timeout.ts` 的 `withTimeout` 与
  `AsyncActionSupport.executeWithTimeout`）都经 `raceWithTimeout` 复用到同一构造点，
  无需修改 p2 文件。`executeWithTimeout` 的 JSDoc 同步改为「按 code 判定，文案仅展示」。
  API-CHANGE: `raceWithTimeout` 抛出的 `Error` 新增稳定属性 `code === 'ACTION_TIMEOUT'`；
  `decorators/timeout.ts` 头部「无 code、唯一判据是文本」的表述因此过时——该文件 p2 定稿、
  本分片无写权限，记此供后续。回归锁：`r5-extras-action-p1-loader.test.ts`「R5-175」三条。

---

### R5-128  verdict=FIXED  `src/extras/action.ts` 入口补齐 LogDecoratorOptions / ActionStats / LogSink / LogPhase

在既有清单上追加 `LogDecoratorOptions`（同行）与 `ActionStats`（新行），并同步转发
`LogSink` + `LogPhase`（p2 R5-185 NEEDS-MAIN：`LogDecoratorOptions` 的 `sink?: LogSink`
与 `redact?: (value, phase: LogPhase) => unknown` 引用二者，缺一即仍要深链）。
锁定方式不是字符串断言而是真实用法：`r5-extras-action-p1-loader.test.ts` 顶部
`import type { LogDecoratorOptions, LogSink, LogPhase, ActionStats } from '@/extras/action.js'`
+ 编译期构造 `sink: LogSink` 与 `redact(value, _phase: LogPhase): unknown` 并驱动 `LogDecoratorOptions`，
漏项时 `tsc -p tsconfig.tests.json` 直接报错。
API-CHANGE: 纯增项——`@openlide/geomstore/extras/action` 的类型再导出集合由 5 → 9，
无丢失（差集 LOST `[]`，仅新增 LogDecoratorOptions/ActionStats/LogSink/LogPhase 四项）。

### R5-129  verdict=FIXED  ActionHistory.record 去掉不可达的 `if (history)` 守卫

`record` 改为 get-or-create + 局部持有数组：`let history = this.actionResults.get(actionName)`，
`undefined` 时 `new` 并 `set`，随后直接 push/shift。旧实现里 `if (!has) set` 与 `get` 之间没有
能让条目消失的路径，`if (history)` 的 false 分支不可达。行为零变化：
`tests/unit/extras/action/ActionHistory.test.ts` 全绿。

### R5-160  verdict=FIXED  decrementLoading 只退自己那一次（代际凭证 + 键缺失早退）

新增 `stateGeneration`（`clearInternalRecords()` 每次自增）与 `CallScope.generation`：in-flight
调用在 `captureCallScope` 里捕获代际，`settleCall` 比对不同即整体跳过写状态。
`decrementLoading` 移除 `?? 1` 兜底——键缺失说明本调用的 increment 记录已不在，
`return` 而不是往别人写过的键补 `false`。`releaseLoadingSlot` 单独处理 `setState` 抛错回滚，
只退计数不写状态（`<= 0` 时 `delete(key)` 不留 `0` 记账）。回归锁
`r5-extras-action-p1-loader.test.ts` 五条（clear 后新起调用不吞计数 / 外部清共享 Map /
increment setState 抛错 / 回滚时别人仍在计数 / 回滚时记账已被清）。

### R5-161  verdict=FIXED  increment/decrement 按同一份配置快照决定

`wrap` 内 `async function` 起手即 `loader.captureCallScope(actionName)`，把
`autoLoading` + 三个状态键一次求值；`incrementLoading(scope.loadingKey, ...)`、
`settleCall(scope, ...)` 只认这份快照，`setOptions()` 中途改 autoLoading 或换键都不再影响
本调用的两端。另外 `setOptions()` 检测到 autoLoading 或任一键名变化时先 `resetDerivedState()`
给旧键补写复位值再 `clearInternalRecords()`（代际 ++），in-flight 调用整体跳过收尾；
两个机制叠加、互不遮蔽。回归锁 `r5-extras-action-p1-loader.test.ts` 两条
（在途 autoLoading false→true / 在途改 loadingKey）。

### R5-162  verdict=FIXED  wrap 包装函数改为函数表达式并原样转发 receiver

`wrapped` 从箭头函数改成 `async function (this: unknown, ...args)`，内部
`await action.apply(receiver, args)`——调用方的 receiver 传到被包装 action。
JSDoc 补写「包装函数把自己的 receiver 原样转发给被包装的 action」段落。
`loader.wrap(store.fetchUser, 'fetchUser', store.setState.bind(store))` 之后再
`wrapped.call(store, ...)` 现在能正常工作（此前直接 TypeError）。回归锁
`r5-extras-action-p1-loader.test.ts`「R5-162」一条（未绑定方法引用 + receiver 保留）。

### R5-163  verdict=FIXED  getErrorData 返回具体类型 ActionErrorData | undefined

新增 `export interface ActionErrorData { message: string; stack?: string; timestamp: number }`，
内部 `errorData: Map<string, ActionErrorData>`、`setError` 构造体加类型标注。
`getErrorData(): ActionErrorData | undefined` 与文档示例里的
`errorData.timestamp`/`errorData.stack` 一致，调用方不再被迫 cast。回归锁
`r5-extras-action-p1-loader.test.ts`「R5-163」一条（`const data: ActionErrorData | undefined =
loader.getErrorData('a')` 编译期读 timestamp）。
API-CHANGE: `getErrorData` 返回类型由 `unknown` 收窄为 `ActionErrorData | undefined`——
纯收窄不破坏既有调用方（`unknown` 上本就无法直接取字段），但 `ActionErrorData` 目前仅在
`src/extras/action/ActionLoader.ts` 导出、未通过 `action/index.ts` 与 `action.ts` 再导出
（后者属 p2 分片，本分片不越界）。调用方通过结构化类型仍可直接读三个字段，
若需按类型名引用（例如声明 `Record<string, ActionErrorData>`）需深链 `ActionLoader.js`；
记此供后续。

### R5-145  verdict=FIXED  ActionUtils.execute 首参判定改为形状判定并早失败

`const first = params[0]` + `first === undefined || first === null` →
抛 `TypeError('ActionUtils.execute: 缺少 actionName（或 actions + actionName）参数')`；
`withExplicitActions = typeof first === 'object'`（Actions 只能是对象），
数字键（`{ 0: fn }` 下 `K = number`）不再被误投到显式 actions 分支。
`@throws {TypeError}` 段落同步补写「不经过执行器，因此不会在 getStats/getHistory 里留下记录」。
回归锁 `r5-extras-action-p1-loader.test.ts`「R5-145」三条
（数字键正常派发 / 缺 actionName 抛错且 executor 历史为空 / 显式 actions 形态不受影响）。

### R5-146  verdict=FIXED  execute 就地校验 actions[actionName] 是函数

`return this.executor.execute(...)` 之前新增 `if (target == null ||
typeof (target as A)[actionName] !== 'function') throw new TypeError(...)`，
错误消息含 `action "${String(actionName)}" 不存在或不是函数`。此前 `ActionExecutor.run`
抛 `actions[actionName] is not a function` 并把这次「不是 action 执行的失败」写进 executor 历史。
回归锁 `r5-extras-action-p1-loader.test.ts`「R5-146」两条（错名 / 构造期 null actions），
均断言 `getHistory()).toHaveLength(0)`。

### R5-147  verdict=FIXED  shouldRetry 抛错时把真实失败挂成 cause 再抛回调异常

`retryWithBackoff` 里 `canRetry` 计算包一层 try/catch：`shouldRetry` 抛错时先
`attachCause(callbackError, error)`（`cause === undefined` 才写；`Error` 属性赋值绕过 ES2020
构造器签名缺失；只读/冻结对象 try/catch 放弃），再按原样抛出 `callbackError`，
不改变「不擅自替调用方决定重试」的既有语义。非 Error 抛出保持抛出物身份（不为挂 cause 改判类型）。
回归锁 `r5-extras-action-p1-decorators.test.ts`「R5-147」四条
（cause 挂上 / 已有 cause 不覆盖 / 冻结 Error / 非 Error 保持身份）。

### R5-148  verdict=FIXED  正的 Infinity 与超界 delay 钳到 MAX_TIMER_DELAY

`baseDelay = typeof delay === 'number' && !Number.isNaN(delay) && delay > 0
? Math.min(delay, MAX_TIMER_DELAY) : 0`。此前 `Number.isFinite(delay) ? max(0, delay) : 0`
把 Infinity（「能等多久等多久」的常见写法）折成 0，退避反而静默变成紧贴重试、
与相邻注释「Infinity 会被宿主钳制」的意图自相矛盾。NaN/负数仍归 0。回归：
`tests/unit/extras/action/async-core.test.ts` 与 `ocr-*-round4` 全部继续通过（Infinity 场景
在 `retryWithBackoff` 上无既有时序假设）。

### R5-149  verdict=FIXED  被抛对象只做一层原始字段投影，不执行 toJSON/getter

新增 `describeThrownObject`：`Object.keys` + 数据描述符（跳过 accessor 属性避免读用户代码）、
只保留 `null|string|boolean|number`（BigInt 转 `n` 后缀文本），`object` 用
`ELIDED_PLACEHOLDER` 占位，`function|symbol|undefined` 省略。整段 try/catch，
连 `ownKeys`/`getOwnPropertyDescriptor` 都被 Proxy 陷阱打断时退化为
`new Error('[thrown object could not be inspected]')`。
不再递归展开整棵对象树，错误路径也不再执行 `toJSON`/getter。
文档明确「顶层原始字段依旧会进消息：真要严格脱敏，依据只能是『被抛的值里本来就不放凭证』」——
按报告「shallow + document」选项落地，未采「name/message/code 白名单」以严格化：
本模块的既有约定是「错误消息是内容」，白名单会与 R5-176/R5-178 的日志侧脱敏
（`summarize` 也只到结构层）在同一层重开一次讨论。
回归锁 `r5-extras-action-p1-decorators.test.ts`「R5-149」三条
（嵌套 req 不落 token 也不执行 toJSON/getter / BigInt 转文本 / hostile Proxy 陷阱降级）。

### R5-150  verdict=FIXED  `RetryOptions` 从内核导出

`interface RetryOptions` → `export interface RetryOptions`，`retryWithBackoff` 的入参契约
与 `decorators/retry.ts` 的 `RetryDecoratorOptions`、`AsyncActionSupport.executeWithRetry`
的 options 从此有一处唯一定义。`retry.ts` 是本分片之外的 p2 文件、其复用改动留给 p2 后续。
回归锁 `r5-extras-action-p1-decorators.test.ts`「R5-150」一条（`const options: RetryOptions
= { retries, delay, shouldRetry, onRetry }` 直接引用）。
API-CHANGE: 纯增项——`RetryOptions` 从 `@openlide/geomstore/extras/action` 内部模块的
非公开类型变为其所在模块的公开接口。当前只从 `async-core.js` 导出，未过 `action/index.ts`
（p2 分片所有），下游按名引用需深链；本分片不越界改。

### R5-151  verdict=FIXED  executeWithTimeout 先校验 timeout 再启动 action

`this.recordOutcome` 之前加 `normalizeTimeout(timeout, 'executeWithTimeout')`（同 `async-core.ts`
里的 helper，不重复实现）。此前非法 timeout（0 / 负数 / NaN / Infinity）会让 `this.run(...)`
已把 action 真实启动（副作用照发）、`Promise.race` 尚未装上 catch 时 `raceWithTimeout`
内部才抛 RangeError → 迟到 reject 成 unhandledRejection、并且 RangeError 会经 recordOutcome
记成一次 action 失败、污染 `getStats().successRate/total`。回归锁
`r5-extras-action-p1-loader.test.ts`「R5-151」五条
（4 个非法值 `started === false` + `getStats.total === 0` + `getHistory` 空；
合法 timeout 的既有计时/记账语义不变）。

### R5-152  verdict=FIXED  duration/avgDuration 含退避等待写进 JSDoc

`executeWithRetry` 的 `@remarks` 段新增一段：端到端耗时包括 `retryWithBackoff`
的全部退避等待（`delay * 2^(i-1)`），例 `retries: 3, delay: 100` 会给 duration 加上
约 700ms。它是「这次调用等了多久」，不是 action 自身的执行延迟。纯注释，代码未动。

### R5-167  verdict=FIXED  容量硬上限：无路可退时也淘汰在途占位

`writeCache` 与占位写入两条路径都走 `beforeWrite(cache, at)` → `enforceCapacity`：
先 `evictOldest(cache, true)` 优先淘汰已完成条目、仍 ≥ MAX 时 `evictOldest(cache, false)`
把在途占位一并淘汰。此前只淘汰已完成条目 → 全表都是占位时产出可以是 0，
`cache.size` 上界只剩「调用速率 × inFlightExpiry」，与文档承诺的 MAX_CACHE_ENTRIES 无关。
未采报告建议的 `MAX_CACHE_ENTRIES * 2` 双阈值：单上限语义更简单，「越界时宁可让那批并发
调用失去去重，也不让 Map 无界增长」是文档写明的取舍。回归锁
`r5-extras-action-p1-decorators.test.ts`「R5-167」一条（1005 个不同键的永不结算在途调用，
第 1006 次同 key=0 调用不再复用被吞掉的占位）。

### R5-168  verdict=FIXED  过期回收按写入次数摊销，不再每次全表扫描

`HostCache { entries, writes }` 取代裸 `Map` 作为 WeakMap 值；`beforeWrite` 里
`writes % SWEEP_EVERY_WRITES === 0`（32）或 `size >= MAX_CACHE_ENTRIES` 时才 `reclaimExpired`。
逼近容量上限那轮仍要扫（那时过期条目正占着坑，不扫就会把还有效的条目当成「最旧」淘汰掉）。
两条写入路径共用同一 `beforeWrite`。`getCache` 对不可跟踪宿主返回一次性容器，
保留 round-4 契约（与 `withLoading` 的 `isTrackableHost` 同口径）。回归锁
`r5-extras-action-p1-decorators.test.ts`「R5-168」一条（spy `Map.prototype.delete`，
少次写入 `delete` 计数不变、跨过 32 步长后才上升）。

### R5-169  verdict=FIXED  值语义路径追加原型类型标签

`sortKeysDeep` 的普通对象分支返回 `['__obj', typeTag, sorted]`，
`typeTag = proto === Object.prototype || proto === null ? '' : 'p:' + identityId(proto)`。
纯对象与 null 原型对象共用空标签（本就按值等价），其余原型按身份编号。
`new Uint8Array([1, 2])` / `new String('ab')` / 普通对象 `{ 0:1, 1:2 }` 不再撞同一个键。
承载方式选「首元素为裸 `__obj` 的数组」而非给 `sorted` 加保留键：
对象键不参与类型标记，用户参数自带的 `__obj` 键能原样伪造标签
（与 `__map`/`__set` 的包装同一理由）。回归锁 `r5-extras-action-p1-decorators.test.ts`
「R5-169」两条（三态互不串用 / null 原型仍与 `{}` 共用缓存）。

### R5-170  verdict=FIXED  userKeyFn 校验返回值类型，非 string/number 降级不缓存

`const raw: unknown = keyFn(...args)`；`typeof raw !== 'string' && typeof raw !== 'number'`
时 `!isProduction()` 下 `console.debug` 点名原因并 `return uncacheableKey()`。此前 `String()`
把 `undefined`（箭头函数漏写 `return`）折成 `"undefined"`、对象折成 `"[object Object]"`，
所有参数共用一个键、第二次起拿到第一次的结果——正是本模块其余路径全力避免的
「返回别人的缓存值」。数字键保留合法缓存能力。回归锁
`r5-extras-action-p1-decorators.test.ts`「R5-170」三条
（undefined / object 两种降级；数字仍正常缓存）。

### R5-153  verdict=FIXED  isThenable 判定的属性读取包一层 try/catch，并导出给全模块复用

`(typeof value !== 'object' && typeof value !== 'function') || value === null` → `false`；
其余用 `try { return typeof (value as PromiseLike<unknown>).then === 'function' }
catch { return false }`——Proxy 的 get 陷阱与抛错访问器不再让「判定被装饰方法是不是 thenable」
崩掉业务调用。函数由私有 `function` 升级为 `export function isThenable`，
供 `cache.ts`/`throttle.ts` 复用（R5-193 与本分片连带项）。回归锁
`r5-extras-action-p1-decorators.test.ts`「R5-153」两条（hostile Proxy 返回 false /
被装饰方法返回该宿主时调用方拿到原值而不是 trap 异常）。

### R5-154  verdict=FIXED  after 回调三种失败口径统一（同步抛错/异步拒绝都过 onError）

`callAfter` 里同步 `options.after(result)` 包 try/catch，抛错先 `reportError(error)` 再 rethrow，
兑现 `DecoratorOptions` JSDoc「同步抛错走 onError」的承诺。
`tail = Promise.resolve(afterResult).then(() => result)` 的 catch 无条件 `reportError(error)`，
同步路径额外 `console.error` 就地留痕（同步方法不能改判为 Promise 返回，无处传给调用方），
异步路径调用方 await 到的仍是原 `tail`、拒绝语义保留。回归锁
`r5-extras-action-p1-decorators.test.ts`「R5-154」三条
（同步抛错 onError 收到 / 异步 reject onError 收到且 await 侧仍拿得到 / 同步路径的
async-after rejection 也上报并 console.error）。

### R5-171  verdict=FIXED  withDebounce 返回类型恒为 Promise 写进装饰器与类型别名注释

采报告「documenting the Promise-return contract」选项。`withDebounce` 的 `@remarks` 新增段落
明说：包装函数返回值恒为 `Promise`，装饰同步方法 `sync(): T` 时 TS 旧式方法装饰器改不了
声明签名（`const v: T = host.sync()` 编译通过却拿错值）。`DecoratedMethod` 类型别名上方
注释同口径改写（原「防抖只在调用时刻改延迟，不改返回值语义」过于绝对，与
`runPendingCalls` 每次产出 Promise 的实现不一致）。未采「装饰阶段判 isAsyncFunction 拒
同步宿主」：`debounce.ts` 目前不 import `isAsyncFunction`，且 round-4 明确保留了对
「非 async 但返回 Promise」的运行时观测兜底口径，加静态拒绝会破坏同文件既有契约。
纯注释，行为零变化。

### R5-172  verdict=FIXED  runPendingCalls 在 reject 前给每个挂起 Promise 补 catch

与 `cancelPendingCalls` 同口径：`catch` 分支在 reject 之前先
`for (const promise of taken.pendingPromises) { void promise.catch(() => undefined) }`，
消除全局未处理告警但不吞结果——真正 await/.then 了的调用方仍看得到这次失败。
`flushDebouncedCalls` 的文档同步纠正（原「不会漏成 unhandledRejection」措辞与旧实现不符）。
`pendingPromises` 字段是 round-4 契约的三份同序队列之一（`pendingResolves` /
`pendingRejects` / `pendingPromises`），本改动不引入新数据。回归锁
`r5-extras-action-p1-decorators.test.ts`「R5-172」两条
（fire-and-forget 到期失败无 `unhandledRejection` / flush 触发的失败 await 侧仍拿得到）。

### R5-173  verdict=FIXED  withDebounce 的 delay 与 withThrottle 同口径归一化

`const wait = Number.isFinite(delay) && delay > 0 ? delay : DEFAULT_DELAY`，
`setTimeout(..., wait)`。此前 `setTimeout(fn, NaN)` / 负延迟按 ~0ms 触发、`Infinity`
在 Node 下溢出告警后按 1ms 处理，参数笔误静默把防抖退化成近无操作。
`@param delay` 文档补写该归一化口径；装饰器在类定义期求值、非法配置回退默认值而非抛错
（抛错会把参数笔误升级成模块加载失败），与 `withThrottle` 的 `interval` 归一化完全同构。
回归锁 `r5-extras-action-p1-decorators.test.ts`「R5-173」四条（NaN / -50 / Infinity
都归一到 300；50 保留原值）。

### R5-177  verdict=FIXED  生产构建的摘要输出改为强制，显式 `summarizeInProduction: false` 才让调用方全权决定

`summarizeInProduction?: boolean`（默认 `true`）加入 `LogDecoratorOptions`。
`withLog` 内 `production = isProduction()`、`summarizeOutput = production &&
(options.summarizeInProduction ?? true)`。project 组合：`options.redact ? options.redact(v, phase) : v`
后再 `summarizeOutput ? summarize(redacted) : redacted`——调用方 `redact` 抛错或有 bug
都不能静默关掉生产防线；`sink.error`/`sink.log` 由 `safeLog` 兜住（hot-p0 R5-176 已建）。
报告点 2（非生产默认原样输出）按「documented default」保留：
本文件的 sink/redact/summarize 都在被装饰 action 的调用路径上，
把「mis-detected production」泄漏的兜底塞进 log.ts 只会把 `isProduction()` 的探测缺陷
换成一处二次判定；已在 `summarizeInProduction` 选项文档中明写「非生产构建默认原样输出，
需要收敛内容时同样传 redact」，`sink` 选项文档亦补写 safeLog 承诺。回归锁
`tests/unit/extras/action/log-decorator-sink.test.ts` 与 `hot-round5`（R5-176 三条继续通过）；
本分片 `r5-extras-action-p1-decorators.test.ts` 未重复覆盖，因 hot-p0 已锁定 sink 侧契约。
API-CHANGE: `LogDecoratorOptions` 新增可选字段 `summarizeInProduction?: boolean`；
纯增项，未传的调用方行为在**生产构建 + 自带宽松 redact** 组合下从「redact 说了算」变
「redact 后再过 summarize」——正是本条要堵的漏洞；非生产构建行为零变化。

### R5-178  verdict=FIXED  summarize 生产摘要里 Error 只留 name

`if (value instanceof Error) return value.name`（此前 `${value.name}: ${value.message}`）。
`message` 属于内容而非常量结构，且最常夹带上下文（`Failed to login with password=...`、
URL 里的 token），拼进摘要等于生产里留一条内容外泄路径。函数上方 `@remarks` 补写
「需要消息就在非生产构建看日志，或显式 `summarizeInProduction: false` 并自带 `redact`」。
`withLog` 的 `@remarks` 同步改写摘要口径（`Error` 只留 `name`）。
回归锁：`tests/unit/extras/action/log-decorator-sink.test.ts` 与 `hot-round5`（R5-176）
继续通过——两处都不依赖摘要里含 message 文本；`r5-extras-action-p1-decorators.test.ts`
未额外加锁，因 R5-178 只是一处 `return value.name` 的收窄。
API-CHANGE: 生产构建的 `withLog` 默认摘要输出中 `Error` 部分由 `name: message` 变为 `name`；
既有依赖摘要 message 的调用方需显式 `summarizeInProduction: false` 并自带 `redact`。
