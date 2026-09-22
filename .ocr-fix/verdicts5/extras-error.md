# 分片 extras-error — 第五轮（ocrreview.md）25 条判定台账

清单：`.ocr-fix/groups5/extras-error.md`（25 条）。报告：`ocrreview.md` 第 2406-2786 / 2518-2763 行段。
owned 源码（9 文件）：`ErrorHandler.ts`、`recoveryTypes.ts`、`ErrorAggregator.ts`、`ErrorRecovery.ts`、
`ErrorBoundary.ts`、`ErrorMonitoring.ts`、`index.ts`、`reporters/ConsoleReporter.ts`、`reporters/HttpReporter.ts`。

**接手状态**：前任已把 25 条全部落成代码（`git diff --stat` +562/−162），并留下
`tests/unit/r5-extras-error-monitoring.test.ts`（15 例）与 `r5-extras-error-recovery.test.ts`（13 例），
但没写台账。逐条对账后确认 25 条实现方向正确，其中 4 处需要补/改（见下），本台账按磁盘现状记录。

**我对账后动手的部分**：
1. **R5-209 的回归锁是空跑**——原用例在队列为空时调 `flushReports()`，走的是入口守卫的 `inFlightFlush ?? undefined`
   早退分支，`doFlushReports` 从未执行、代际守卫零覆盖（`coverage` 报 `ErrorMonitoring.ts:267` 未命中）。
   重写为「先入队 → 显式 flush → 断言 `batchStarted === 1` → 在途 clear()」，并把「新周期只剩新条目」写进断言。
   判别性已验证：把守卫改成 `if (false && generation !== this.generation)` 后该用例失败
   （`Expected length: 0 / Received length: 1 / storeName: "old-generation"`），恢复守卫后 399 例全绿。
2. **门禁 lint error**：`r5-extras-error-recovery.test.ts:23` 的 `;(recovery as ...)` 触发 `no-extra-semi`
   → 改为局部变量写法，`npx eslint` 归零。
3. **报告器侧 6 条（R5-198/199/200/213/214/215/216）前任没有留任何回归锁** → 新建
   `tests/unit/r5-extras-error-reporters.test.ts`（23 例），并顺带补上 `console.group` 调用即抛的降级锁、
   symbol/function 载荷收口锁、`toJSON → undefined` 的 body 合法性锁。
4. **一处事实性注释错误**（前任在 R5-214 的 `JsonBody` 注释里写「嵌套层 `toJSON` 返回 undefined 会把该键写成
   `null`」）：实测 `node -e "JSON.stringify({a:{toJSON:()=>undefined},b:1})"` → `{"b":1}`，即**整个键被丢弃**
   （数组元素才写 `null`）→ 注释按事实改正，并用例锁住（`'payload' in parsed === false`）。
5. `ErrorBoundary` 的「回退值不做 thenable 判定」补一行「为什么」（回退值是边界自己产出的，await 它等于把同步
   方法的返回值换成 `Promise<X>`），避免后人把它当漏网之鱼「修回去」。

**没动的两条**（主会话 hot-p0 已定稿，本分片确认未回退）：R5-192（非 Error 抛值保护式取值 + 建组后才计数）、
R5-201（达上限保留计数与周期键）。证据见各条与下方门禁。

自验口径（全部在改完后执行）：
- `npx tsc -p tsconfig.json --noEmit` → 本分片 9 文件 **0 error**（`grep "error TS" | grep -c extras/error` → 0）；
  跑动时残留 8 条全在 `src/extras/action/index.ts`（`Duplicate identifier 'RetryOptions'` 等），属并行分片中间态。
- `npx tsc -p tsconfig.tests.json --noEmit` → 5 条 error，全在别人文件
  （`tests/types/integration-types`、`tests/types/store-config-base`、`tests/unit/r5-core-store-p1-action`、
  `r5-extras-snapshot-fixes` ×2）；`grep -E "r5-extras-error|extras/error|core/error"` **零命中**。
- `npx eslint src/extras/error tests/unit/r5-extras-error-{monitoring,recovery,reporters}.test.ts` → **0 error / 0 warning**。
- `npx jest --ci --silent tests/unit/extras/error tests/unit/core/error tests/unit/r5-extras-error-monitoring.test.ts
  tests/unit/r5-extras-error-recovery.test.ts tests/unit/r5-extras-error-reporters.test.ts tests/unit/hot-round5.test.ts`
  → **12 suites / 399 tests 全绿**。
- `npx jest --ci --silent tests/unit/extras` → 42 suites / 806 例，2 例失败均在 `ocr-medium-round4-p3/p4`
  （`#286/#287`、`#304`，`src/extras/snapshot/**` 的克隆降级口径），属并行分片中间态，本分片用例无一失败。
- 覆盖率（`--collectCoverageFrom='src/extras/error/**/*.ts'` + 上面那 12 个 suite）：
  `ErrorAggregator/ErrorHandler/recoveryTypes` **100/100/100/100**；`ErrorRecovery` 100/98.63/100/100；
  `ErrorMonitoring` 99.31/96.96/97.14/99.29（缺 247 行 `reportTimeout<=0` 分支，非本分片条目）；
  `ErrorBoundary` 98.46/96.55/100/98.43（缺 378 行装饰器 TypeError，由 extras-action 分片用例覆盖）；
  `ConsoleReporter` 100/90.9/100/100、`HttpReporter` 100/93.47/100/100（余下未命中分支是
  `levelLabel`/`formatTimestamp` 的畸形入参兜底，属第四轮口径）。目录合计 99.66% stmts / 96.63% branch。

---

## 逐条判定

### R5-187  verdict=FIXED  交给 handler 的是副本，且入库即副本

`handleError` 改为 `this.handler(this.copyContext(context))`；同时把 `logError` 的
`this.errorLog.push(context)` 也改成 `push(this.copyContext(context))`——只修 handler 一侧的话，
调用方在 `handleError(ctx)` 之后改自己那份 `ctx` 仍能改写历史记录，`copyContext` 的不变量等于没做。
验证：`npx jest -t R5-187 tests/unit/r5-extras-error-monitoring.test.ts` → 2 passed
（`expect(seen[0]).not.toBe(original)` + 改写后 `getErrorLog()[0].level` 仍为 `'error'`）。
API-CHANGE: 用户 handler 收到的是上下文副本（改 `ctx.level`/`ctx.error` 不再回写 `errorLog`）；`getErrorLog()` 返回的条目也与内部记录解耦。

### R5-188  verdict=FIXED  async handler 的 rejection 折成同一条日志

新增模块内 `isThenable(value)`（鸭子类型，认跨 realm Promise 与手写 thenable）+ 单一出口
`reportHandlerFailure`，同步抛错与异步拒绝共用它，只在结果真是 thenable 时才建
`Promise.resolve(handlerResult).catch(...)`，同步 handler 不为此多付微任务；`setHandler` 的
`@remarks` 写明「只保护**被返回的那条** Promise」。判据与 R5-193 的 `common.ts:isThenable` 同形，但
`src/extras/common.ts` 不归本分片，故在 ErrorHandler 内自建并由 `ErrorBoundary` 复用（未进 barrel，非公开 API）。
验证：`npx jest -t R5-188 tests/unit/r5-extras-error-monitoring.test.ts` → 2 passed（拒绝被就地 `console.error`；同步路径无额外日志）。
API-CHANGE: `(context) => void` 签名不变，但返回 Promise 的 handler 其 rejection 由「未处理拒绝（Node 下可终止进程）」变为一条 `[ErrorHandler] Error in error handler:` 日志。

### R5-189  verdict=FIXED  两处「默认导出」注释按事实改写

`ErrorHandler.ts` 的注释改为「命名再导出（本模块无 default export）」并点明定义在 `src/types/error.ts`；
`ErrorBoundary.ts` 的改为「命名类型再导出（本模块无 default export）」+ 说明公开出口是 barrel。
`ErrorBoundaryOptions` 的深路径转发保留不删：删掉会让 `extras/error/ErrorBoundary.js` 的既有深导入断掉，
而报告给的二选一（改注释 / 删转发）里改注释不改变任何运行时行为。
验证：`grep -rn "默认导出" src/extras/error` → 无命中；`grep -n "export default" src/extras/error` → 无命中。

### R5-190  verdict=FIXED  把「展开」从丢键诱因里摘掉

`recoveryTypes.ts` 的 `fallback` 注释改为：真正丢键的是 JSON 序列化 / 条件展开 / 解构改名，
普通浅展开与 `Object.assign` 保留值为 `undefined` 的自有可枚举键（`'fallback' in copy === true`），
并说明 `configure()` 的归一化正是靠这一点。属纯文档，无行为改动。
验证：`node -e "console.log('fallback' in {...{fallback: undefined}})"` → true；`npx tsc -p tsconfig.json --noEmit` 0 error。

### R5-191  verdict=FIXED  MAX_RETRY_KEYS 注释补齐淘汰语义

`recoveryTypes.ts` 的常量注释按现实现写清三件事：判定时机（仅 RETRY 路径的 `executeRetryStrategy`）、
两步淘汰（先删自身周期窗已到期的键，再按 Map 插入顺序从最旧端删；开新周期的键会重插到队尾）、
副作用（被删键若属进行中的故障周期，其 `maxRetries` 额度被清零）。
验证：读 `ErrorRecovery.ts:294-326` 与注释逐句对齐；`npx jest -t R5-202 tests/unit/r5-extras-error-recovery.test.ts` → 2 passed。

### R5-197  verdict=FIXED  指纹→组 ID 改为反向索引，驱逐不再分裂同一指纹

`Map<groupId, fingerprint>` 换成 `Map<fingerprint, groupId>`，`resolveGroupId` 先查索引复用既有 ID，
未登记才按 `base~n` 探测**当前空闲槽**（判据从「指纹表占位」改为 `groups.has(candidate)`）；
条目与组同生命周期（建组写入、驱逐/clear 删除）。同时把 `group`/`fingerprint`/`hits` 收进 `GroupEntry`，
三处删除点收敛为一处。报告给的场景用真实哈希碰撞串复现并锁住。
验证：`npx jest -t R5-197 tests/unit/r5-extras-error-recovery.test.ts` → 2 passed
（邻居组被驱逐后 `COLLIDE_B` 仍并入 `base~2`、`count` 为 2 而不重置；`sum(byStore) === totalErrors`）。

### R5-202  verdict=FIXED  过期判定用每键自身的到期时刻

`retryWindowStart: Map<string, number>`（存起点）→ `retryCycleEnd`（存 **now + cycleWindow** 的到期时刻），
容量守卫的过期判据从 `ws < now - 60_000` 改为 `now > end`；开新周期时先 `delete` 再 `set` 以刷新插入顺序，
使「最旧插入键」=「最早进入当前周期」而非「很久没被刷新过的活跃键」。
验证：`npx jest -t R5-202 tests/unit/r5-extras-error-recovery.test.ts` → 2 passed
（600s 窗口的活跃键静默 90s 后 `attempts` 为 `[1,2]`、计数为 2，修复前为 `[1,1]`；重开周期的键排在队尾、被淘汰的是 `other-0`）。

### R5-203  verdict=FIXED  策略内部失败统一抛 GeomStoreError 并挂 cause

`executeRecovery` 的 default 分支、`executeRetryStrategy` 的 MAX_RETRIES 分支、
`executeFallbackStrategy` 无回退、`executeRecoverStrategy` 无 `recoverFn` 四处裸 `new Error` 全部改为
`withCause(createError(ErrorCode.INTERNAL_ERROR, ...), error)`，并把 `strategy` / `originalCode` /
`retryKey` / `attempts` 放进 `context`。抛出消息文本逐字保留（既有十余条 `toThrow('Max retries …')` 断言不需改）。
验证：`npx jest -t R5-203 tests/unit/r5-extras-error-recovery.test.ts` → 4 passed
（`isGeomStoreError(caught)`、`caught.code === ErrorCode.INTERNAL_ERROR`、`caught.cause` 为原错误）。
API-CHANGE: `ErrorRecovery.recover()` 的策略内部失败从裸 `Error` 变为 `GeomStoreError`（`code: INTERNAL_ERROR`，带 `cause` 与 `context`）。

### R5-204  verdict=FIXED  策略表换成 Map

`strategies: RecoveryStrategyMap` → `private readonly strategies = new Map<string, RecoveryConfig>()`；
`configure` 直接在 Map 上 `set`（不再有 `normalizedStrategies[code] = …` 这层中间对象，`__proto__` 键不再触发
原型 setter），`getConfig` 用 `get`。报告说的两条后果都锁住了：`getConfig('constructor')` 返回 undefined，
`configure(JSON.parse('{"__proto__":…}'))` 后 `Object.getPrototypeOf(recovery)` 不变。
验证：`npx jest -t R5-204 tests/unit/r5-extras-error-recovery.test.ts` → 3 passed。
API-CHANGE: 以 `Object.prototype` 成员名作错误码时 `getConfig` 由「返回原型链成员」变为 `undefined`（`recover` 改报
「No recovery strategy configured for error code: constructor」，不再是误导性的 Unknown recovery strategy）。既有
`tests/unit/core/error/ErrorRecovery.test.ts` 三处 `strategies['TEST_CODE'] = …` 的私有写入按新结构改为 `strategies.set(…)`。

### R5-205  verdict=FIXED  未归因重试键显式命名并把键回传到诊断里

`storeName` 与 `operation` 两处来源都为空时键改为 `${code}:unattributed`（只缺一个维度仍按已报出维度隔离，
缺失侧留 `unknown` 占位），超限抛出物的 `context.retryKey` 回传键名；注释写明这桶是**有意的粗粒度兜底**：
两个来源都缺时库内已无可区分信息，用堆栈/调用点做键会把「同一逻辑故障在不同行构造」打散成多份额度，
直接破坏 `REGR-RECOVERY-003` 锁定的「新实例仍累计同一额度」。要按 Store 隔离的路径（`recover(error,
{storeName, operation})` 或 createError 内嵌 context）写进 `@remarks`。
验证：`npx jest -t R5-205 tests/unit/r5-extras-error-recovery.test.ts` → 2 passed；
`npx jest tests/unit/core/error/ErrorRecovery.test.ts -t 'REGR-RECOVERY-003'` 未回退。
API-CHANGE: 未归因重试键名由 `CODE:unknown:unknown` 变为 `CODE:unattributed`（仅经 `context.retryKey` 可观测）。

### R5-206  verdict=FIXED  只对「被包裹方法的原始返回值」做 thenable 判定

装饰后的方法体改为先用 `rawResult` 单独留被包裹方法的原始返回值，`isThenable(rawResult)` 为真才走
`executeAsync`：回退值与同步方法的普通返回值即使自带 callable `then` 也不会再被 re-wrap，返回形状不再从
`X` 变成 `Promise<X>`。方法自己的 Promise/thenable 仍被等待（判据是 then 鸭子类型，跨 realm 与手写 thenable 不漏）。
选「只判定原始返回值」而非报告给的「再要求 `catch`」：后者仍会把带 `then`+`catch` 的状态对象误判成 Promise。
验证：`npx jest -t R5-206 tests/unit/r5-extras-error-monitoring.test.ts` → 4 passed
（回退值 `{then, value}` 按 `toBe(fallback)` 原样返回；方法返回手写 thenable 时其 rejection 仍被折成 `'fb'`）。
API-CHANGE: 被 `@withErrorBoundary` 装饰的方法，其**回退值**不再被 await（此前带 `then` 的回退值会返回 `Promise<fallback>`）。

### R5-207  verdict=FIXED  回退值相关的 JSDoc 由 `S` 改为 `F`

`getFallbackState()` 与 `setFallbackState(@param)`、`handleError(@returns)` 的类型标注改为 `F | undefined` / `F`；
顺带把 `execute`/`executeAsync` 的 `@returns` 从 `T | undefined` 改为 `T | F | undefined`、类头补
`@template F`。均为注释，签名未变。
验证：`grep -n "{S}" src/extras/error/ErrorBoundary.ts` 只剩 `@param {S} [currentState]`（那三处确实收 `S`）。

### R5-209  verdict=FIXED  代际标记作废在途 flush 的重入队

新增 `private generation = 0`，`doFlushReports` 进入时快照 `const generation = this.generation`，
`allSettled` 之后、`isShuttingDown` 判定之前 `generation !== this.generation` 即整批丢弃；`clear()` 里 `generation++`。
一条 `return` 同时堵住报告点名的两个后果（旧批次回流 `errorQueue` + `consecutiveFlushFailures` 由 0 变 1）。
`clear()` 的文档按「作废在途 flush 的重入队，但不断它的网络请求本体」改写。
验证：重写后的锁 `npx jest -t R5-209 tests/unit/r5-extras-error-monitoring.test.ts` → 1 passed；
判别性（把守卫短路为 `if (false && …)` 后）→ 失败于 `errorQueue` 长度 1（`storeName: "old-generation"`）、
`consecutiveFlushFailures` 为 1，恢复后全绿。

### R5-210  verdict=FIXED  溢出丢弃量成为可消费计数，totalErrors 口径写明

新增 `private droppedErrors` + 公开 `getDroppedErrors()`：`report()` 的入队淘汰（+1）与失败批次重入队的超容量
裁剪（+裁掉的条数，并补一条 warn 日志）都入账；`clear()` 归零。`generateReport()` 的文档把 `summary.totalErrors`
钉为「观测到的错误」口径（被丢弃者仍是真实发生过的错误，不回退聚合计数——那会让 `sum(byStore) === totalErrors`
的既有不变量崩塌），并指向 `getDroppedErrors()` 看投递缺口。
验证：`npx jest -t R5-210 tests/unit/r5-extras-error-monitoring.test.ts` → 4 passed
（5 条入队 maxQueueSize=3 → dropped 2、`summary.totalErrors` 5；重入队 7→5 → dropped 2 且 warn 含 `dropped 2 oldest`；clear 归零）。
「纳入 summary」这半步本分片做不到：`ErrorReport.summary` 的形状在别人的文件里。
NEEDS-MAIN: `src/types/error.ts` `ErrorReport.summary` 增加 `droppedErrors: number`，`ErrorMonitoring.generateReport()` 填 `this.droppedErrors`（本分片已备好取值入口）。

### R5-211  verdict=FIXED  聚合组对外一律给副本

新增模块级 `copyGroup(group)`（`affectedStores` 与 `sampleError` 各再拷一层），用于
`getGroups()`、`getGroupsByStore()` 与 `addError()` 的返回值；`ErrorMonitoring.getErrorGroups()` 因走
`aggregator.getGroups()` 同步受益，`generateReport()` 的 `topErrors`/`recentErrors` 也拿到副本。
`getStats()` 改为直读内部组求和（不再借道 `getGroups()`，免得为求标量而复制 n 个组）。
验证：`npx jest -t R5-211 tests/unit/r5-extras-error-monitoring.test.ts` → 2 passed
（`groups[0].count = 999` / `affectedStores.push('tampered')` / `sampleError.level = 'critical'` 之后
`summary.totalErrors`、`byStore`、`getAggregationStats()` 均不受影响；两次 `getGroups()` 返回不同对象）。
同一次 `generateReport()` 里 `topErrors` 与 `recentErrors` 是同一批副本的两个视图（快照内自洽），仅对内部状态只读。
API-CHANGE: `ErrorAggregator.getGroups()/addError()` 与 `ErrorMonitoring.getErrorGroups()/generateReport()` 返回的是副本，改它们不再污染内部账目（此前会）。

### R5-212  verdict=FIXED  容量类入参下限裁剪

新增 `normalizeCapacity(value, fallback, min)`（非有限值回退缺省，其余 `Math.max(min, Math.floor(value))`）：
`maxQueueSize` 下限 1、缺省 1000，`maxFlushRetries` 下限 0、缺省 3。报告点名的三个失效形态都堵住：
`maxQueueSize: 0` 不再「每条新错误先 shift 掉上一条」、负值不再让重入队 `slice` 算出空数组、
`maxFlushRetries` 负值不再让首批立即被丢弃。
验证：`npx jest -t R5-212 tests/unit/r5-extras-error-monitoring.test.ts` → 4 passed
（`[0,-5,NaN,Infinity] → [1,1,1000,1000]`，最终 flush 仍投递过 2 条的批次；`maxFlushRetries:-3 → 0`）。
API-CHANGE: `MonitoringConfig.maxQueueSize` < 1 按 1 生效、`maxFlushRetries` < 0 按 0 生效（此前原样接受并使上报链近乎静默失效）。

### R5-217  verdict=FIXED  barrel 头部的能力清单与实际导出对齐

补 `createErrorContext`、`defaultErrorRecovery`、`createDefaultMonitoring`/`getDefaultMonitoring`、
`ErrorCode`/`createError`，并新增「类型」一行列出全部 13 个 `export type`。
验证（脚本比对，非目测）：解析 `src/extras/error/index.ts` 的全部 `export [type] {…} from` 说明符后逐个查头部
是否以 `` `名字` `` 形式出现 → `exported names: 44 / not named in header: []`（`is*Error` 家族按清单里的
「与对应 `is*Error` 守卫」计）。

### R5-218  verdict=FIXED  标明 createErrorContext/defaultErrorHandler 的真实来源

`index.ts` 的再导出行上方注释改为：定义在 `../../types/error.js`（该文件同时承载契约类型与这两个运行时值），
`ErrorHandler.ts` 只是为保深导入路径的转发；并注明把来源改成 `'./ErrorHandler.js'` 会误导。
未采纳「从定义模块直接导出」的另一半建议：`src/types/error.ts` 不归本分片，且 `defaultErrorHandler` 的
`describeErrorProperty` 设防口径刚由主会话定稿，不该为此分片去动它。
验证：`grep -n "types/error.js" src/extras/error/index.ts` → 注释与三条 `export … from '../../types/error.js'` 并存；
`npx tsc -p tsconfig.json --noEmit` 0 error。

### R5-198  verdict=FIXED  payload 打印改为显式 null/undefined 判定

`if (context?.payload)` → `if (context?.payload !== undefined && context?.payload !== null)`：
`0` / `''` / `false` / `NaN` 这些恰恰最需要看的诊断值不再被真值判定吞掉；注释写明「只有 undefined 与显式
null 视为没带 payload」。
验证：`npx jest -t R5-198 tests/unit/r5-extras-error-reporters.test.ts` → 5 passed
（`toHaveBeenCalledWith('Payload:', 0 | '' | false | NaN)`；无 payload / `payload: null` 时 `Payload:` 行 0 次）。
API-CHANGE: falsy 的 `payload` 现在会输出一行 `Payload:`（此前静默丢弃）。

### R5-199  verdict=FIXED  groupEnd 的异常不得顶替组内输出的异常

`runGrouped` 由 `try { grouped() } finally { console.groupEnd() }` 改为「捕获 primary → 无条件闭合一次 →
有 primary 时抛 primary、无 primary 时抛 close 的异常」。报告只要求「不掩盖」，这里额外保住两条既有契约：
组仍恰好闭合一次（否则后续输出留在已打开分组里），且 `grouped` 成功而 `groupEnd` 抛错时仍算一次真实失败
（吞掉会让监控层把「一条都没落地」判成上报成功并丢弃批次）。
验证：`npx jest -t R5-199 tests/unit/r5-extras-error-reporters.test.ts` → 3 passed
（`rejects.toBe(primary)` + `groupEnd` 调用 1 次；仅 groupEnd 抛错时 `rejects.toThrow('close boom')`；
`console.group` 调用即抛时降级平铺且只试探一次）。

### R5-200  verdict=FIXED  批量行的 store 名给 UNKNOWN 占位

新增 `storeLabel(storeName)`（与同文件 `levelLabel` 同口径），`printBatchEntry` 的插值由
`String(context?.storeName)` 改为 `storeLabel(context?.storeName)`，模板串里不再出现可读成
「有个叫 undefined 的 store」的字面量。`printContext` 的 `Store:` 行仍打原值：它是独立的 console 实参，
`undefined` 与字符串在 devtools 里本就可分辨，不需要占位串。
验证：`npx jest -t R5-200 tests/unit/r5-extras-error-reporters.test.ts` → 1 passed
（`'[1] ERROR in UNKNOWN:'` / `'[2] ERROR in UNKNOWN:'` / `'[3] ERROR in user-store:'`，且无任何输出含 `in undefined`）。
API-CHANGE: `ConsoleReporter.reportBatch` 缺失 storeName 时的输出行由 `in undefined:` 变为 `in UNKNOWN:`。

### R5-213  verdict=FIXED  畸形 context.error 不再让整个 reportBatch 失败

`serializeContext` 先把 `context?.error` 收成可空形状，三个字段改为 `typeof x === 'string' ? x : 兜底`，
消息兜底用 `String(error ?? '')`（与 `src/types/error.ts` 的 `describeErrorProperty` + `String(error)`
全库口径一致），并把 `storeName`/`level`/`payload` 等读取全部改为可选链。一条手搓/非 Error 上下文不再能把
同批其余上下文一起拖成 rejection（也不再让监控层把它当网络失败反复重入队）。
验证：`npx jest -t R5-213 tests/unit/r5-extras-error-reporters.test.ts` → 6 passed
（`null`/`undefined`/`'boom'`/`42`/`{}` 五种抛值下批次仍 resolve、第 2 条上下文完好；`{}` 收口为 `'[object Object]'`）。
API-CHANGE: `HttpReporter.report/reportBatch` 遇到非 Error 的 `context.error` 不再抛 `TypeError`，该条被投影为可读字符串形态。

### R5-214  verdict=FIXED  不可序列化载荷在投影阶段降级，坏载荷只伤自己那一条

新增 `toSerializablePayload(payload)`：`bigint`/`symbol`/`function` 统一字符串化标记（用 `String(payload)`，
模板串插值对 symbol 会抛），对象先试跑一次 `JSON.stringify` 验可序列化性、抛错则降级为
`[Unserializable payload: …]`。`JsonBody` 品牌前提的注释同步按事实更正（顶层恒是本模块构造的对象字面量，
故 stringify 不会整体返回 undefined；嵌套层 `toJSON()` → undefined 只是**丢掉那个键**，不是写成 `null`——
实测 `JSON.stringify({a:{toJSON:()=>undefined},b:1})` → `{"b":1}`）。
验证：`npx jest -t R5-214 tests/unit/r5-extras-error-reporters.test.ts` → 3 passed
（顶层 `10n` → `[bigint 10]`；循环引用 / 嵌套 BigInt → `/^\[Unserializable payload:/`；好载荷仍是原对象；
body 恒为可 `JSON.parse` 的 `{` 开头文本）。
API-CHANGE: 含 BigInt/循环引用的 `payload` 由「整个批次 reject（并被监控层无限重入队）」变为「该条 payload 降级为字符串标记，批次照常发送」。

### R5-215  verdict=FIXED  JSON content-type 成为兜底而不是默认参数的一部分

新增 `withJsonContentType(headers)`（头名大小写不敏感判重），只用在 `createDefaultRequest` 的 **两个** 默认实现里
（`wx.request` 的 `header`、`fetch` 的 `headers`）；`normalizeHeaders()` 明确只「做形式归一、不注入任何头」，
`HttpRequestImpl` 的 `@remarks` 同步写明注入实现收到的是归一化后的调用方请求头。
这样 `new HttpReporter(url, { method: 'PUT' })`（默认参数对象被整体替换、里头不再有 headers）也不会再以
`text/plain;charset=UTF-8` 发一份合法 JSON；而调用方自带 `content-type`（任意大小写）时原样保留、不重复注入。
兜底放在默认实现而非 `normalizeHeaders`：发不发这个头属于「这条请求怎么发」的传输细节，注入实现可能把 body 转投别处。
验证：`npx jest -t R5-215 tests/unit/r5-extras-error-reporters.test.ts` → 4 passed
（fetch 只传 method → `Content-Type: application/json` + `method: PUT`；`{'content-type': 'application/vnd.api+json'}` 不被覆盖；
wx 分支 `header` 兜底且 `data` 可 `JSON.parse`；注入 impl 收到 `{Authorization}` 原样）。
API-CHANGE: 传入自定义 `HttpReporterOptions`（不再自带 headers）时，默认请求实现会补上 `Content-Type: application/json`；自定义 `HttpRequestImpl` 收到的 headers 不含该兜底。

### R5-216  verdict=FIXED  单条与批量收进同一个私有 send(body)

`report`/`reportBatch` 各自重复的 `this.requestImpl(this.endpoint, …, this.options.method ?? 'POST',
this.normalizeHeaders())` 收进 `private async send(body: JsonBody)`，失败向上抛出的契约（驱动监控层重试）
只在它一处文档化，两个入口共用。
验证：`npx jest -t R5-216 tests/unit/r5-extras-error-reporters.test.ts` → 1 passed
（两个入口的 `[url, method, headers]` 逐次全等，且单条投影与批量元素的字段集 `Object.keys().sort()` 相同）；
既有 `error-boundaries.test.ts` 的「未显式配置 method 时回退为 POST」两条断言未改仍绿。

---

## 交回主会话的 NEEDS-MAIN 清单

1. `src/types/error.ts` — `ErrorReport.summary` 增 `droppedErrors: number`，`ErrorMonitoring.generateReport()` 填
   `this.droppedErrors`（R5-210，取值入口与 `getDroppedErrors()` 已就位）。
2. `docs/API.md` — 本分片改了公开行为，文档需同步：`ErrorMonitoring.getDroppedErrors()` 与 `totalErrors` 口径、
   `maxQueueSize`/`maxFlushRetries` 的下限裁剪、`clear()` 作废在途 flush 的重入队、聚合组/上下文对外为副本、
   `ErrorRecovery` 策略内部失败改抛 `GeomStoreError`、`HttpReporter` 的 content-type 兜底与畸形载荷降级、
   `ConsoleReporter` 打印 falsy payload。
3. `src/extras/common.ts`（extras-action 分片）— `isThenable` 已有同名判据；本分片在 `ErrorHandler.ts` 内自建了一份
   （未进 barrel）。两处并存是可接受的，若要合并请由主会话决定归属，本分片不越界改 `common.ts`。
