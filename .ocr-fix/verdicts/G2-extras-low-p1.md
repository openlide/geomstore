# G2-extras low p1 判定记账（30 条 · src/extras）

| #id | verdict | 依据 |
| --- | --- | --- |
| #181 | fix(文档路线) | 成立：`getHistory` 只复制数组容器，条目与内部桶同引用（`ActionResult` 字段非 readonly，`history[0].success = true` 类型合法且会污染后续 getStats）。按报告第二方案取「文档化共享 + 只读」：JSDoc @returns/@remarks 与行内注释改写为「容器是副本、条目共享只读」并说明不逐条拷贝的理由（诊断入口读多写少，拷贝让每次读多付 N 次分配；且 `{...r}` 也只是浅拷贝，`data`/`error` 仍共享，报告主方案的“深度保护”同样不成立）。零行为变更 |
| #182 | FP(前提不实)+补说明 | 报告核心断言不成立：`clearHistory` **确实存在**——`src/extras/action/AsyncActionSupport.ts:393` `clearHistory(actionName){ this.history.clear(actionName) }`（`grep -rn "clearHistory" src` 命中该定义与 JSDoc 两处），示例用 `executor.` 前缀是有意的门面写法、非笔误。残余问题只是示例换了调用对象而未点明：在类文档补 @remarks 列出门面与本类的方法对应关系（clearHistory→clear），零行为变更 |
| #195 | fix | 成立：`ActionUtils.execute` 只是门面而 JSDoc 只写返回值。核对 `AsyncActionSupport.recordOutcome`（155-170：catch 里先 `recordResult(success:false, error:toError(error))` 再 `throw error`）后补 `@throws`——原样抛出、不包装、不转失败结果，原始值身份保留（`e === thrown` 成立）、executor 已按失败记账。按报告建议只补文档，不加无意义的 try/catch |
| #202 | fix(部分)+FP(第1点) | 三点分治：(1) 报告称 `asyncFn.bind(ctx)` 原型是 `Function.prototype` → **实测不成立**：规范 BoundFunctionCreate 取目标 realm 的 `%AsyncFunction.prototype%`，临时用例 `isAsyncFunction(async function(){}.bind({})) === true`（已固化为 #202 用例）；(2) 跨 realm 原型身份不同确是真实边界，但 `observesPromise`+`assumeAsync` 已兜底、误判只影响被抑制调用的返回形状 → 只写进 @remarks；(3) 成立并修复：`Object.getPrototypeOf` 对抛错 Proxy 陷阱会崩掉 withCache/withThrottle，按报告 try/catch 降级 false。正常输入行为不变 |
| #204 | fix | 成立：`onRetry` 抛错会中断循环并让调用方看到与真实失败无关的报错，且与同库 `ErrorRecovery.executeRetryStrategy`（已 try/catch + console.error，被 `tests/unit/core/error/ErrorRecovery.test.ts:452 RECOVERY-031「onRetry 回调出错不应该影响重试」`锁定）口径不一致。隔离通知（`[retryWithBackoff] Error in onRetry callback:`）并在 @remarks 写明 shouldRetry/onRetry 处理不同的取舍（前者决定是否再来一次，抛错时不擅自替调用方重试）。行为变更，带 #204 两条用例 |
| #215 | fix | 成立：`DebounceState` 字面量在兜底分支与 miss 分支逐字重复两份。抽模块级 `createDebounceState()` 单点构造，两处共用；零行为变更 |
| #216 | fix(文档路线) | 成立且报告分析准确：兜底分支每次新建状态 → `timeoutId` 恒 null、不 clearTimeout、各排各的定时器、各结算自己的 resolver，**防抖实际失效**，原方法还以 undefined receiver 执行（ESM/严格模式 detached 调用可达）。按报告第一方案改写注释写清代价与「刻意不抛错/不告警」的取舍（与 withThrottle 放行、withCache 一次性 Map 同口径），并用 #216 用例钉住现状；不引入 warn/reject，避免把无害误用变成崩溃点 |
| #220 | fix | 成立：用户 `keyFn` 无异常保护，而 `defaultKeyFn` 内部已 try/catch 降级为不可缓存键，两处不对称——keyFn 抛错会让业务方法整体抛错。新增 `userKeyFn()` 包装 + 抽 `uncacheableKey()`（两条降级路径共用同一唯一键），失败退化为一次性唯一键（等效跳过缓存），非生产期一条 `[Cache] keyFn threw` 的 console.debug 点名原因，JSDoc @remarks 写明该契约。行为变更（原抛错→降级执行），带 #220 两条用例（含 keyFn 正常时语义不变的护栏） |
| #223 | FP | 报告描述的重复已不存在：`grep -rn "name \|\| 'action'" src` 仅 1 处（log.ts:90 `const label = name || 'action'`），三个回调全部用 `${label}`。残余 `[Action]` 字面量 x3 是日志 tag（同 cache.ts 的 `[Cache]`、throttle 的 `[withThrottle]`），抽常量只会让 grep 前缀变难、无漂移风险 → 不改 |
| #228 | FP | 前提不成立：legacy `MethodDecorator` 不改变被装饰成员的**声明类型**，包装函数上的 `this: unknown`/`...args: unknown[]` 只在替换实现内部，调用方看到的仍是 `async getValue(key: string)`（证据：`tests/unit/extras/action/decorators.test.ts:682-692` 装饰后按原签名传参并 await 取具体返回值，而 `npx tsc --noEmit -p tsconfig.tests.json` 零输出）。第二点也不成立：`descriptor.value` 在 `PropertyDescriptor` 里是 `any`，`originalMethod.apply(this, args)` 无需断言。泛型化包装在 legacy 装饰器下无从表达（descriptor 层拿不到方法类型参数） |
| #229 | reject | 问题真实（判据是硬编码文案），但报告主方案（导出 `TimeoutError`/常量并改 `instanceof`）是新增公开 API + 改 `raceWithTimeout(promise, timeout, timeoutMessage)` 的入参形状，越出 low 波次。保留现状并把契约写进 JSDoc：超时错误是普通 `Error`、`Timeout after <n>ms` 属稳定文案（改动即破坏性变更）；并纠正一个报告未见的坑——`executeWithTimeout` 的文案是 `Action timeout after <n>ms`，大小写敏感的 `'Timeout'` 匹配跨入口会失配 |
| #230 | fix | 成立：strict/useUnknownInCatchVariables 下 catch 形参是 `unknown`，示例直接 `.message` 教坏调用方。按报告改为 `error instanceof Error && error.message.includes('Timeout after')` |
| #231 | FP | 「内核把抛出的值原样传给 shouldRetry」不成立：`retryWithBackoff` 在 catch 里先 `const normalizedError = toError(error)`（async-core.ts:89）再 `shouldRetry(normalizedError)`（92 行），@remarks 已写明「回调收规范化 Error、对外抛出仍是原始值」。字符串/对象字面量抛出会被包成带原文的 Error，`error.message` 恒可读。顺带把该保证写进 `RetryDecoratorOptions.shouldRetry` 字段文档 |
| #232 | reject(第1点)+fix(第2点) | 第 1 点方向不对：注释只声称「与 executeWithRetry 同一实现、避免退避语义漂移」，这在实现层成立，并未声称选项面相等；补 `onRetry` 等于给装饰器新增公开选项（还要同步选项类型与 barrel 类型导出），不属 low 波次。改为在 @remarks 显式写明「实现共享但选项面不等，onRetry 只在 executeWithRetry 提供」。第 2 点成立：`retries` 改「首次执行之外的最大重试次数（总尝试 = retries + 1）」并补 delay 退避公式，消除 off-by-one 预期 |
| #236 | FP(机制)+保留取整 | 算术不成立：旧实现 `length > 5.9` 的稳态本就是 5 条（node 复算 push→6→6>5.9→shift 得 `[3,4,5,6,7]`，截断 while 同样收敛到 5），不存在「effectively keeps 6」。取整仍保留（非行为变更）：字段值从此等于生效容量、并与 `setMaxHistory` 的 floor 口径一致；@param 同步写「小数向下取整，非有限值回退默认 100」。#236 用例作特征化护栏 |
| #237 | reject | 静默的担忧成立，但三个建议改法都不采纳：re-throw 会让错误链路自身成为崩溃点；`lastHandlerError`/`onHandlerError` 是新增公开 API（且钩子自己也可能抛错）。保留 console.error，并在 `handleError` 补 @remarks 写明已有兜底：context 在调用 handler **之前**已入 errorLog，handler 长期失效时 `getErrorLog()/getErrorStats()` 仍能看出错误在累积，故障本身有一行 console.error 可查 |
| #243 | fix(界内部分) | 成立但报告的落点（在 `ActionLoader.ts` 导出 `ACTION_LOADER_DEFAULTS`）越界：该文件不在本分组可改清单内。界内做法：`withLoading.ts` 内新增 `LOADER_DEFAULTS` 单点常量 + `normalizeLoaderOptions()`，两个签名函数改由同一归一化结果派生（原来两份 `?? true`/`?? 'loading'` 字面量收敛为一处），注释写明与 ActionLoader 构造器的对应关系及漂移后果（分桶错配→状态互相覆盖或该共享的被拆开）。行为不变；跨文件单点化列为待办 |
| #244 | fix | 成立：`./ErrorHandler.js` 被两条语句分别再导出、中间还夹着类型导出。合并为一条 `export { ErrorHandlerImpl, defaultErrorHandler, createErrorContext } from './ErrorHandler.js'` 并注释原因。导出名不变（`exports.test.ts`、`entry-exports.test.ts` 全绿） |
| #253 | fix(第2点)+文档(第1点) | 第 2 点成立并修复：`fireTrailing`/`scheduleTrailingAt` 从每次调用提升到装饰阶段（每被装饰方法一份），宿主与状态改参数传入——同一 `ThrottleState` 恒属同一宿主（按宿主存于 WeakMap），与原先闭包捕获 `this` 严格等价，热路径每次调用少分配 2 个闭包。第 1 点（待发尾调用拖住宿主、无 dispose）成立但取消入口是新公开 API，超出 low 波次；在排程处写明量级（默认 300ms 窗口、句柄随状态被 WeakMap 连带回收）与最坏后果（宿主在窗口内销毁则多补发一次）。#253 两条用例锁补发参数与不重复补发 |
| #256 | fix(文档路线)+reject(改类型) | 两点分治：(1) fallbackFn 与 fallback 的优先级确为只在引擎注释里写 → 按报告在 `RecoveryConfig.fallback` 字段补「fallbackFn 在前、两者皆缺则抛错」；(2) `'fallback' in config` 判据与「回退值可以是 undefined」一并写入，并提示不要用展开/序列化搬运 config。判别式改法（`{ value: unknown }`/`hasFallback`）不采纳：`RecoveryConfig` 是已发布公开形状，默认 VALIDATION_ERROR 策略正靠「键存在且值为 undefined」区分，改形状属破坏性变更 |
| #264 | fix(第1点)+FP(第2点) | 第 1 点成立：`DEFAULT_MAX_LOG_SIZE` 从 ErrorHandler.ts 导出（未经 barrel，不入公开面）供 ErrorBoundary 引用，两处 100 同源；已核对无循环依赖（ErrorHandler 只依赖 types/error），且 ErrorBoundary 与 ErrorHandler 同由 `extras/error/index.ts` 导出，不新增体积耦合。「用户无法调上限」属新增公开选项，不做并在注释写明。第 2 点不成立：每个入口只 push 一条，`length > LIMIT` 后 `shift()` 恰丢最旧一条，与提议的 `splice(0, length - LIMIT)` 结果集完全相同（#264 用例断言保留最新 N 条、首条为 e5），只加注释说明该等价性 |
| #265 | reject | 「与文档矛盾」成立（@throws 只写了一条路径），但改判 `return undefined` 不采纳：回退值是容错的最后一道，它自己失败时本边界已无从恢复，返回 undefined 会把容错路径故障静默成一次正常返回。取「更正文档」：`execute`/`executeAsync` 的 @throws 与 handleError 注释补第二条重抛路径、且抛出的是**原始**错误（非 fallback 异常，现场不失真）；不重复触发 onError 的理由写进注释（onError 已就原始错误触发，二次触发会让按次计数的上报翻倍） |
| #269 | FP | 报告依据的机制已不存在：`grep -rn "split(':')" src` 在 src 下**零命中**（唯一命中在 tests/unit/plugins 的无关文件），`clearRetryCount`/`key.split(':')[0]` 在 `ErrorRecovery.ts` 无任何对应代码——现只有 `clearAllRetryCounts()`（全量 clear）与键级 get/set/delete，全部用 `getRetryKey` 产物做整串精确匹配，含 `':'` 的 code/operation 只挪分段边界、不会误命中他人计数，也就不会 leak counters。为防回归在 `getRetryKey` 注释写明「从不按 `:` 切分/前缀匹配，将来按 code 级联清理须改嵌套 Map 或 JSON 元组」 |
| #270 | fix | 成立：`attempt` 恒 0（`recover()` 里 `attempt: 0` 覆盖调用方传值，之后再无写入点），文档却写「当前重试次数」；`grep -rn "\.attempt\b" src tests` 零命中，确无读取方。采纳报告第一方案：`executeRetryStrategy` 取到 `currentAttempt` 后回填 `context.attempt`（内部写入，不进用户回调、不作策略判定 → 非行为变更；刻意不选「删字段」，`RecoveryContext` 公开、删必填字段会让传 `{attempt:0}` 的调用方编译失败），并在 `RecoveryContext.attempt` 写明填充时机与「仅诊断」定位 |
| #275 | fix | 成立：`serializeErrorMessage` 与 `serializeErrorBatch` 的 `contexts.map` 体是同一份逐字段投影，新增/改名字段只会落到一处。按报告抽 `private serializeContext(ctx)` 两条路径共用；键顺序与取值不变故 JSON 逐字一致（#275 用例断言 `batch.errors[0]` 与单条 body `toEqual`，即漂移护栏） |
| #276 | fix | 成立：`selector/index.ts` 实际导出 `SelectorFactory`/`createSelector`/`createMemoizedSelector`/`createStructuredSelector`/`createParametricSelector`/`SelectorComposer` + 8 个类型，本文件只列 4 项。按报告第一方案枚举全量（值/类型分列、注明类型定义在 `src/types/selector.ts`），并加「增删以 ./selector/index.ts 为准」防再次漂移 |
| #278 | reject | 观察成立（带 `wx.*` I/O 的运行时类 `WxStorageBackend` 住在 `src/types/persistence.ts`，与本入口「types 可被 import type 擦除」的预期矛盾），但报告的修法要同时改 `src/types/persistence.ts` 与 `src/plugins/builtin`（消费方）+ 子入口映射，全部越出本分组边界，且在 low 波次做目录级搬迁风险远大于收益。保留该再导出，在 `src/extras/index.ts:24` 上方把这笔债与其影响（verbatimModuleSyntax 消费者）写明确，列为待办 |
| #280 | fix | 成立：`shouldRetry`（及异步变体的 `delay` 函数）在 catch 块里裸调，回调抛错会同时绕过 `throwRetryExhausted` 的 `attempts` 标注并把选择器的真实失败换成回调异常，与本模块其它失败路径不一致。按报告第一方案隔离：抽 `invokeShouldRetry()`（抛错→一条 console.error + 判为「不再重试」，抛原始错误并带真实 attempts）、`delay` 函数抛错按 0 等待继续（保持「总尝试 = retries + 1」契约），两个工厂的 @remarks 写明。行为变更（回调异常从外溢改为被隔离），带 #280 三条用例 |
| #281 | fix | 成立：`Number.isInteger(retries) \|\| retries < 0` 与同一条 `TypeError` 文案在两个工厂逐字重复。抽 `assertValidRetries(retries)` 单点，文案原样保留（既有断言不受影响），零行为变更；#281 用例同时断言两个工厂对 `-1`/`1.5` 给出同一报错、对 `0` 放行 |
| #282 | reject | 「不可达」判断成立，但按报告删分支会让代码变差：`lastError` 的类型是 `Error \| undefined`，收窄签名要靠 `as Error`/`!`（`no-non-null-assertion` 为 warn），一旦断言失真就成了 `throw undefined`——调用方拿到 undefined 比现在这条明确的 `[SelectorComposer] Retry selector failed without error` 难查得多。保留现状，只在 `throwRetryExhausted` 文档里把「为何保留这段 istanbul 忽略的死代码」写明（代价 5 行，收益是断言失真时仍有可读失败） |

## 汇总

30 条：纯 fix 13（其中文档/注释路线 6 条：#181、#195、#216、#230、#276、#270 的字段文档部分）· fix 与 FP/reject 混合 8（#182、#202、#232、#236、#243、#253、#256、#264）· 纯 reject 5（#229、#237、#265、#278、#282）· 纯 FP 4（#223、#228、#231、#269）。报告**前提或算术不实**共 7 条：#182（clearHistory 确实存在）、#223（重复已消除）、#228（legacy 装饰器不改声明类型）、#231（shouldRetry 收规范化 Error）、#236（5.9 实际已只留 5 条）、#269（无 split 前缀匹配）、#202 第 1 点（bound async 仍判为异步）。

本轮新增的**命令级误报证据**：
- #236：`node -e` 复算旧实现的 push/shift 序列，`maxLogSize=5.9` 稳态是 5 条（报告称 6 条）。
- #202(1)：`isAsyncFunction(async function(){}.bind({}))` 实测 `true`（报告称被误判为同步），已固化为用例。
- #269：`grep -rn "split(':')" src` 零命中，`clearRetryCount` 在 `src/extras/error/ErrorRecovery.ts` 无对应实现。
- #182：`clearHistory` 定义在 `src/extras/action/AsyncActionSupport.ts:393`。
- #231：`async-core.ts:89-92` 传的是 `toError(error)` 规范化值。
- #223：`name || 'action'` 全库仅 1 处（log.ts:90）。
- #228：`tests/unit/extras/action/decorators.test.ts:682-692` 按装饰后原签名调用，`tsconfig.tests.json` 全量 typecheck 零输出。

### 本轮引入的行为变更（用例见 tests/unit/extras/ocr-low-round4-p1.test.ts）

| # | 变更 | 用例 |
| --- | --- | --- |
| #204 | `retryWithBackoff` 的 `onRetry` 抛错被隔离为一条 console.error：不再中断重试、不再顶替真实失败（与 `ErrorRecovery` 的 onRetry 口径对齐） | #204 两条 |
| #220 | `withCache` 的用户 `keyFn` 抛错时不再让整个方法失败：该次调用用一次性唯一键、直接执行原方法且不写缓存（非生产一条 `[Cache] keyFn threw` debug） | #220 两条 |
| #280 | 重试选择器的 `shouldRetry` 抛错按「不再重试」处理、`delay` 函数抛错按 0 等待继续：原始错误照常带 `attempts` 标注抛出，回调异常不再外溢 | #280 三条 |
| #202 | `isAsyncFunction` 对 `getPrototypeOf` 抛错（Proxy 陷阱）降级为 false 而非崩溃；正常输入判定不变 | #202 两条 |
| #253 | `withThrottle` 的尾随助手提升到装饰阶段（每次调用少分配 2 个闭包），补发宿主由参数传入 —— 与逐字等价的纯重构，由既有用例 + 新增 2 条共同锁定 | #253 两条 |
| #236/#264 | 无行为变更：前者取整不改实际容量（均 5 条），后者上限改为引用同一常量；各带 1 条特征化用例 | #236、#264 |

### 验证

- `npx tsc --noEmit -p tsconfig.typecheck.json`：零输出；`npx tsc --noEmit -p tsconfig.tests.json`：零输出。
- `npx eslint src/extras tests/unit/extras`：零输出。
- `npx jest --ci --silent tests/unit/extras`：38 套件 / 737 用例全绿（本轮新增 1 套件 16 用例）。
- 越界自查：`npx jest --ci --silent` 全量 103 套件 / 2764 用例全绿（含 tests/integration），确认 async-core、ErrorHandler、HttpReporter、retrySelector、throttle 等被核心/插件复用的改动无连带破坏。

### 待办（越界，需后续波次处理）

1. #243：把 `ActionLoader` 构造器与 `withLoading.LOADER_DEFAULTS` 收敛为单一 `ACTION_LOADER_DEFAULTS` 需改 `src/extras/action/ActionLoader.ts`（不在本分组清单）；现已在 withLoading 侧单点声明并注明对应关系。
2. #278：`WxStorageBackend` 从 `src/types/persistence.ts` 迁到运行时持久化模块（改 src/types + src/plugins/builtin + 子入口映射），并把 `src/types/persistence.ts` 恢复为纯类型。
3. #229：超时错误若要可类型化判定，需新增公开 `TimeoutError`（或统一 code 字段），并一并处理 `withTimeout` 的 `Timeout after <n>ms` 与 `executeWithTimeout` 的 `Action timeout after <n>ms` 两套文案——属 API 设计，建议单列波次。
4. #253：为 `withThrottle`/`withDebounce` 增加 dispose/cancel 入口（新公开 API），解决「宿主在窗口内销毁仍会补发一次」。
5. #265：若判定「recoverable 时不应因 fallback 失败而抛出」，需要同时给 fallback 失败一个可上报通道（否则退化为静默），属行为契约重设计。
