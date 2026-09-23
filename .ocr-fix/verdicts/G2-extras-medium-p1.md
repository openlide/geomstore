# G2-extras medium p1 判定记账（审计 4f08963 落盘改动）

审计范围：`.ocr-fix/groups/G2-extras-medium-p1.md` 实际列出的 **12 条**（主控交办的
「25 条」与该文件不符：p1 分片头自称「12 条」，`grep '^## #'` 也只有 12 个 id；
其余 13 条若存在应落在 p2/p3/p4，已由各自 verdict 文件覆盖）。

结论一览：**11 条 未落地**（agent 完全没动这些文件——`git show 4f08963 --name-only`
不含 ErrorAggregator / withLoading / ConsoleReporter / throttle 四个文件），本轮全部
按报告路线补做；2 条判为 **reject**（#240 的改法、#247 的方向）。

| #id | verdict | 依据 |
| --- | --- | --- |
| #235 | 未落地→fix | ErrorHandler.ts 在该提交只改了副本语义，`byLevel: {} as Record<ErrorLevel,number>` 原样在；按报告第二方案改 `Partial<Record<ErrorLevel,number>>` 并把 JSDoc 的 `Record<OperationType,number>` 对齐为 `Record<string,number>`+稀疏说明。不预置 0：tests/unit/core/error/ErrorHandler.test.ts:354 断言 `Object.keys(stats.byLevel)).toHaveLength(0)`，该目录越界不可改 |
| #239 | 未落地→fix | ErrorAggregator.ts 不在提交文件清单内。`cleanupOldGroups` 仍 `getGroups().slice(maxGroups)`（复制+O(n log n) 排序，且达到上限后每次 addError 都跑）→ 改为一次 O(n) 线性扫描取最小 lastSeen、不分配临时数组，驱逐时同步删 storeHits/fingerprints；带回归用例 |
| #240 | 未落地→reject(取报告第二条路线) | 采纳「命中前校验」：新增 `fingerprints` 表，组键命中后严格比对 name+message+堆栈头部原文，不同则 `base~n` 线性探测，杜绝 32 位哈希碰撞静默并组。**不采纳**「用完整堆栈」：那会把同一逻辑错误按行号打散，tests/unit/core 的 MONITOR-008/014/015/062（越界不可改）正是靠「截断到 file:line 之前」跨调用点归并；实测改全文堆栈即 4 例失败。已在 buildFingerprint 注释里把该口径写成明示契约，用例锁住「头部不同→不同组 / 仅深层帧不同→同组」 |
| #241 | 未落地→fix | `sampleError: context` 原样在（强引用 + 永不刷新）。改为 `copySample()`：只留 storeName/operation/level/timestamp + error 引用的浅拷贝，payload 不再随组驻留（它是钉住 store/页面节点的来源），命中时刷新为最近一次出现。`error` 本体保留：`ErrorGroup.sampleError: ErrorContext` 在 src/types（越界），契约要求 Error 实例 |
| #242 | 未落地→fix | withLoading.ts 最后修改还是 87db0d1，:126-129 正是报告引用的旧行。条件改 `this !== null && (typeof this === 'object' \|\| typeof this === 'function')`，函数宿主走共享分支；else 只处理基本类型并注入独立计数。原 tests/unit/extras/action/withLoading.test.ts:38 把「函数宿主退化为一次性 loader」当成契约断言（正是锁定缺陷的用例），改写为断言并发下只有一对 true/false |
| #246 | 未落地→fix | ConsoleReporter.ts 在该提交未被触碰，仍是纯 typeof 检测。新增 `runGrouped()`：`console.group` 存在但调用即抛时捕获、本次降级平铺并置实例级 `groupUnavailable` 只试探一次；group 未开成功则不 groupEnd |
| #247 | reject | 传播是 Wave A #245 已定的有意行为（decisions.md:38），且报告的前提在库内路径不成立：`ErrorMonitoring.doFlushReports` 以 `Promise.resolve().then(() => reporter.reportBatch(...))` 消掉同步抛点、再 `.then(ok, err => {console.error; 'fail'})` + allSettled 折算，不存在 unhandled rejection。若按报告「never rethrows」，`anyReporterSucceeded` 会被恒置 true → 整批错误在一条都没落地时被判定成功并丢弃。已把该取舍写进类 JSDoc；锁定用例见 tests/unit/extras/error/error-followups.test.ts:96-115（断言 rejects + groupEnd 恰一次） |
| #248 | 未落地→fix | 四处复制的字段打印原样在（含批量路径小写 `ctx.level` 的漂移）。抽 `printContext(ctx, decorate)` + `printBatchEntry(ctx, index)`，分组/平铺共用；批量级别统一大写。用例逐条比对两条路径的标签序列与批量行文本 |
| #249 | 未落地→fix | `context.level.toUpperCase()` / `new Date(ts).toISOString()` 仍裸调用。改 `levelLabel()`（非字符串/空串→'UNKNOWN'）与 `formatTimestamp()`（非有限值与 Invalid Date（如 1e30，`toISOString()` 抛 RangeError）回退当前时间），并对 `context` 本体、非数组 `contexts` 做兜底；6 种残缺入参用例均 resolves 不抛 |
| #250 | 未落地→fix | `let observesPromise` 仍在装饰器作用域（throttle.ts:80）。移入 `ThrottleState.sawPromise`，按 (宿主,方法) 读写；用例：同一装饰器下 Promise 宿主置起标记、同步宿主的抑制调用仍返回 undefined |
| #251 | 未落地→fix | leading 分支（:136-138）未清定时器、`fireTrailing` 仍无条件 `state.timer = null`。改为新窗口开启即 `clearTimeout` 并置 null，`fireTrailing(handle)` 只在 `state.timer === handle` 时清引用；同步更新 tests/unit/extras/action/throttle-leading-trailing.test.ts 首个用例的失效前提（原断言「空参数分支」）并加 `jest.getTimerCount()` 与「89/90ms 恰好一次补发」的时序断言 |
| #252 | 未落地→fix | `interval` 全程未校验。装饰期归一为 `window`：非有限值或 <=0 回退 300（与 PerformanceMonitor.normalizeMaxSize 同口径；不在类定义期抛错），JSDoc 同步。用例 it.each([0,-100,NaN,Infinity]) 锁住 300ms 窗口 |

## 审计中发现的额外问题（同一提交落盘，属本边界）

- `tests/unit/extras/action/log-decorator-sink.test.ts:65` 用 `require(...)` 加载被隔离模块，
  触发 `@typescript-eslint/no-require-imports` → `pnpm lint` 在 4f08963 之后其实是**红的**
  （提交信息称 lint 全绿）。已改 `jest.requireActual(...)`，`npx eslint src tests --ext .ts` 现无输出。

## 与报告无关但需主控拍板

- 探测式哈希冲突分支（`resolveGroupId` 的 while 循环体）无法在不伪造哈希碰撞的前提下构造用例，
  已 `/* istanbul ignore if */` 注明；若要真覆盖，需要放开 `ErrorGroup.groupId` 直接改用指纹原文
  （会同时使 src/types/error.ts:120 的「基于…的哈希」注释过期，越界）。
- `sampleError` 不再含 `payload`、且随命中刷新：docs/ 与 skill 的 API 参考若描述过样本含 payload，
  需主控在 Wave D 文档同步时核对（本 agent 边界外）。
