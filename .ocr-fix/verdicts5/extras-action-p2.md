# 分片 extras-action-p2 — 第五轮（ocrreview.md）15 条判定

清单：`.ocr-fix/groups5/extras-action-p2.md`。
owned 源码：`decorators/{retry,throttle,timeout}.ts`、`action/index.ts`、`action/withLoading.ts`、
`extras/{index,enterprise,performance}.ts`。
回归锁：新建 `tests/unit/r5-extras-action-p2-fixes.test.ts`（6 例）、
`tests/unit/r5-extras-action-p2-entry-parity.test.ts`（8 例，含 5 例逐子入口值导出比对）。

自验口径（全部在改完后执行）：
- `npx jest --ci --silent tests/unit/extras tests/unit/r5-extras-action-p2 tests/unit/hot-round5`
  → 845 例中 843 通过，仅余 2 例失败（`#286/#287`、`#304`，均在 `src/extras/snapshot/**`，
  属 extras-snapshot 分片并行中间态），本分片八文件相关用例全绿。
- `npx tsc -p tsconfig.json --noEmit` / `npx tsc -p tsconfig.tests.json --noEmit`：
  本分片 8 个源码文件与 2 个新测试文件零报错（残留报错全在 `src/extras/error/**`、
  `src/extras/snapshot/**`、`tests/unit/store/**`，属并行分片中间态，未触碰）。
- `npx eslint <8 个源码文件 + 2 个测试文件>`：0 error / 0 warning。
- `npx jest --ci --silent --testPathPatterns "r5-extras-action-p2"`：14/14 通过。
- `npx jest --ci --silent tests/unit/hot-round5 tests/unit/extras/action/throttle* .../withLoading .../utils tests/unit/extras/entry-exports`：
  8 suites / 101 例全绿（R5-193 的节流回归锁未回退）。
- 覆盖率（`--collectCoverageFrom` 限定本分片 4 个 action 源码文件，跑
  `tests/unit/extras` + `tests/unit/r5-extras-action-p2` + `tests/unit/hot-round5`）：
  `withLoading.ts` 100/100/100/100、`retry.ts` 100/100/100/100、`timeout.ts` 100/100/100/100、
  `throttle.ts` 100/98.36/100/100（唯一未覆盖分支是 246 行「旧定时器回调抹引用」的防御分支，
  文件内已写明不可稳定复现，门槛 branches 85 / 其余 98 全部满足）。

### R5-180  verdict=FIXED  描述符缺失并入同一条装饰阶段判据，友好 TypeError 得以上浮

`descriptor` 形参改为 `descriptor?: PropertyDescriptor`，判据写成
`descriptor === undefined || typeof descriptor.value !== 'function'`：同一条件里 TS 即把
`descriptor` 收窄为非可选，无需二次断言，也保住了 `return descriptor` 的 `PropertyDescriptor`
返回类型（比报告建议的 `descriptor?.value` 多做一步，避免下方再出现 `descriptor!`）。
回归：`r5-extras-action-p2-fixes.test.ts` 两条（按 PropertyDecorator 形状两参调用 / getter 描述符），
均断言 `[withRetry] can only decorate a method`。同形态仍存在于 `debounce.ts`/`cache.ts`/
`common.ts`（p1 分片所有，本分片无对应条目，未越界改动）。

### R5-181  verdict=FIXED  同步方法装饰后返回类型变更写入 JSDoc

选择「记录契约」而非「同步路径保持同步」：重试间隔靠 `retryWithBackoff` 里的
`await new Promise(setTimeout)`，改成同步就得阻塞事件循环或放弃退避，代价大于收益。
新增 `@remarks **返回类型会变**` 段：`T → Promise<T>`、同步抛错转 rejection、调用方必须
`await`，并说明「不想改调用方就不要给同步方法加本装饰器」。
`r5-extras-action-p2-fixes.test.ts` 用同步抛错方法锁住该行为（`rejects.toThrow('boom')` + 重试 2 次）。

### R5-194  verdict=FIXED  节流间隔变量改名 intervalMs，不再遮蔽全局 window

`const window = ...` → `const intervalMs = ...`，函数体内三处引用（新窗口判定、
`leading=false` 排程、窗口内补发排程）同步改名；全文 `grep -n '\bwindow\b'` 只剩注释里的两处
说明性引用。注释记录「为什么」：遮蔽全局对象后闭包内写 `window.setTimeout` 会落到该数值上抛
TypeError。行为零变化（`throttle-leading-trailing` / `throttle-debounce-dispose` / `hot-round5` 全绿）。

### R5-195  verdict=FIXED  删除错位的重复注释，说明只留在判定前

`const trailing` 上方那条（与 `let leading` 上方重复、且解释不到位的）注释删除，
保留唯一一条并移到 `if (!leading && !trailing)` 之前，与它解释的逻辑对齐。

### R5-196  verdict=FIXED  「主机」→「宿主」

`sawPromise` 字段注释里的用词笔误按报告原样改正，全文用词统一。

### R5-174  verdict=FIXED  超时消息改用归一化后的实际生效值

`Timeout after ${timeout}ms` → `${delay}ms`（`delay = normalizeTimeout(timeout, 'withTimeout')`）。
`async-core.ts` 的 `normalizeTimeout` 返回 `Math.min(timeout, 2**31-1)`，配置超上限时旧文本会报出
从未生效的数字；区间内 `delay === timeout`，故 `Timeout after <n>ms` 契约不变（`utils.test.ts`
三条与 `ocr-medium-round4.test.ts:974` 的 `Timeout after 5ms` 全部继续通过）。
新测试两条：`withTimeout(5_000_000_000)` → 断言 `Timeout after 2147483647ms`；区间内 120ms → 断言原文案。
文件头与 `@param` 同步补写截断口径。

### R5-175  verdict=FIXED  共享超时错误工厂要落在内核，本分片无写权限

要「解耦文案与识别」必须给 `new Error(timeoutMessage)` 挂 `code`，而这行在
`raceWithTimeout` 内部（`src/extras/action/async-core.ts`，p1 分片所有）；
在 `timeout.ts` 侧包一层 catch 再打 `code` 属于垫片，且 `ActionExecutor.executeWithTimeout`
（`AsyncActionSupport.ts`，同属 p1）不会受益——正是本条要避免的「两处文本各写一遍」。
本分片只在 `timeout.ts` 文档里把现有唯一判据讲清楚（含 `<n>` 是生效值），不改代码。
NEEDS-MAIN: src/extras/action/async-core.ts 导出 `TIMEOUT_ERROR_CODE` 与
`createTimeoutError(message)`（`Error` + `code`），`raceWithTimeout` 用它替换
`new Error(timeoutMessage)`；两个入口的文案继续由各自调用方拼，识别改按 `code`。
NEEDS-MAIN: src/extras/action/AsyncActionSupport.ts `executeWithTimeout` 与
src/extras/action/decorators/timeout.ts 的文件头随之改为「按 code 判定，文案仅用于展示」。

**主会话收口（改判 FIXED）**：extras-action-p1 的 recovery agent 在 `async-core.ts` 落地
`TIMEOUT_ERROR_CODE` + `createTimeoutError`，`raceWithTimeout` 成为两个入口的唯一超时错误构造点，
`decorators/timeout.ts` 文件头已改为「判据是 `code`，文案仅展示」。`src/extras/action/index.ts`
按 `TIMEOUT_ERROR_CODE`（值）+ `TimeoutError`/`RetryOptions`/`ActionErrorData`（类型）对外公开，
并同步 `src/extras/action.ts` 与 `src/extras/index.ts` 两层 barrel（`r5-extras-action-p2-entry-parity` 锁住）。
判据已核：`grep -c "TIMEOUT_ERROR_CODE" src/extras/action/async-core.ts` 与 dist 的 d.ts 导出面均命中。

### R5-185  verdict=FIXED  barrel 补再导出 LogSink / LogPhase

`src/extras/action/index.ts` 的 `from './decorators/index.js'` 清单追加
`type LogSink, type LogPhase`（`decorators/index.ts` 第 19 行本已转发二者，无需改动他人文件）。
API-CHANGE: 纯增项——`@openlide/geomstore/extras/action` 的导出符号集由 29 → 31，
以 TS 编译器 API 枚举 `getExportsOfModule` 前后集合比对证明零丢失（差集 `[]`，仅 +LogSink/+LogPhase）。
锁定方式不是字符串断言而是真实用法：`r5-extras-action-p2-entry-parity.test.ts` 用
`const sink: LogSink` + `(value: unknown, phase: LogPhase) => unknown` 直接驱动 `withLog`，
漏项时 `tsc -p tsconfig.tests.json` 直接报错。
NEEDS-MAIN: src/extras/action.ts（p1 分片）宜同步转发 LogSink / LogPhase，
否则两个公开入口 `/extras/action`、`/extras` 仍取不到 `LogDecoratorOptions` 引用的类型。

### R5-186  verdict=FIXED  入口头部补齐 cancel/flush/dispose 六个生命周期入口

`src/extras/action/index.ts` 头部「目录构成」之后新增一段，逐名列出防抖/节流的宿主级收尾入口
（`cancelDebouncedCalls` / `flushDebouncedCalls` / `disposeDebouncedState` 与节流侧三件），
与 `decorators/index.ts` 的措辞同口径；`@remarks 外部请勿深链子文件` 的承诺因此重新成立。

### R5-182  verdict=FP  基本类型宿主分支不是死代码，且被既有用例稳定覆盖

前提是错的：`this?.setState` 可以来自**基本类型的原型链**——`Number.prototype.setState = fn`
之后 `method.call(1)` 的 `setState` 为真值，而模块产物在严格模式下求值、`this` 不被装箱，
原始值 `1` 不是合法 WeakMap 键，`if` 为假。
仓库里就已有这条用例：`tests/unit/extras/action/withLoading.test.ts:92-123`
（「基本类型宿主每次调用各自计数，不跨调用串扰（#242 分支兜底）」）。
命令级证据：
`npx jest --ci --coverage --coverageReporters=json --coverageDirectory=.cache/cov-wl --collectCoverageFrom='src/extras/action/withLoading.ts' tests/unit/extras/action/withLoading.test.ts`
→ istanbul 记录 else 体内那条 `new ActionLoader({ ...options, sharedLoadingCounts: new Map() })`
**命中 2 次**（修复前位于 135 行、现随注释增删移到 156 行，同一命令下报 `156:2`），
同文件可跟踪路径（144–154）各命中 2–3 次，两条路径都是活体；该套件 4 例全通过。
按报告建议删分支等于把这条已文档化的降级口径改成 `loaderRegistry.set(原始值)` 的 TypeError。
连带改进（非行为）：else 分支的注释改为说明「有 setState ⇏ 宿主可跟踪」，避免下一轮又被判成死代码；
判定条件抽成 `isTrackableHost(this)`，与 `throttle.ts` / `debounce.ts` 的同名判据同口径。

### R5-183  verdict=FIXED  签名改用 JSON 序列化，分隔符撞桶消除

`resolveLoaderSignature` / `resolveLoadingSignature` 的 `.join('|')` 改为
`JSON.stringify([...])`。撞桶后果属实：`{loadingKey:'x|y',errorKey:'z'}` 与
`{loadingKey:'x',errorKey:'y|z'}` 旧串同为 `true|x|y|z|false`，第二个装饰器静默复用第一个的
loader 与状态键。归一化后的五项恒为 boolean/string，JSON 无 `undefined` 丢项风险。
回归：新测试同宿主挂两套撞桶配置，断言 `'x|y'`/`'z'` 与 `'x'`/`'y|z'` 各自被写入
（旧实现下 `'x'`、`'y|z'` 一次都不会出现）。

### R5-184  verdict=FIXED  两处 any 与 eslint-disable 全部移除

`descriptor.value` 的 `this` 标注为 `LoadingHost | null | undefined`
（`type LoadingHost = { setState?: (key: string, value: unknown) => void }`，形参形状与
`ActionLoader.wrap` 的 `setState` 一致），`const setState = this?.setState?.bind(this)` 无需断言，
两条 `// eslint-disable-next-line @typescript-eslint/no-explicit-any` 删除；
宿主有效性判定同时收敛到 `isTrackableHost` 一处。lint 复跑 0 warning 证明 `any` 已不存在。

### R5-179  verdict=FIXED  enterprise 头部改述真实的按需机制

核对：`export * from '../integrations/enterprise/index.js'` 是静态再导出，
`store-manager.ts:155` 的 `export const storeManager = new StoreManager()` 在 import 时即求值，
全包内无任何 `import()`。头部因此改为「引用按需，不是惰性求值」，点明求值成本与单例，
并把真正可用的延迟手段（业务侧对本子路径动态 `import()` / 分包）写成一行代码，
不再暗示库提供惰性 helper；`@example` 的静态 import 与新表述一致。

### R5-242  verdict=FIXED  总入口每段改为从同名已发布子入口按名再导出

`src/extras/index.ts` 五段（plugins / performance / snapshot / action / enterprise）不再各自
指向叶子模块，改为 `from './plugins.js'` … `from './enterprise.js'`；Action 段的来源正是报告
建议的 `./action.js`（p1 分片已按 R5-128 补齐 `ActionStats` / `LogDecoratorOptions`，
故本改动不丢符号）。仍是显式命名清单（不用 `export *`），策展语义保留。
API-CHANGE: 公开符号集**完全未变**——TS 编译器 API 枚举前后 76 → 76，
差集 LOST `[]` / ADDED `[]`（复跑方式：临时脚本用 TS 编译器 API
`checker.getExportsOfModule` 枚举两个入口的导出符号名并排序求差，脚本落在忽略目录 `.cache/`）。
新增漂移锁 `r5-extras-action-p2-entry-parity.test.ts`：逐个子入口断言其值导出全部可达总入口，
并反向断言总入口不夹带这五者之外的来源（唯一豁免 `./snapshot.js` 的 `default`，
因为总入口是策展清单、该子入口为 `export *` 显式补过 default）；
另断言 `ActionStats` / `LogDecoratorOptions` 在两处是同一类型（编译期，正是此前漂移的那两个名字）。
API-CHANGE: 顺带效果——叶子模块路径在 extras 公开面收敛到各子入口一处，
今后挪动叶子只需改一个文件。

### R5-208  verdict=FIXED  performance 头部改正「仅通过本入口暴露」的错误断言

核对结论与报告一致且更细：`scripts/generate-subpath-stubs.mjs:53` 有
`performance: 'core/performance'`，而 `src/core/performance/index.ts` 文件头自述为已发布子路径出口，
`src/extras/index.ts` 又原样再导出同一组符号——三个类实际有**三处**公开出口。
注释据此改写（并写明 `core/store` 是深导入 `AsyncBatchNotifier`，不是依赖整个 barrel），
同时补上本入口与 core 出口的策展差异（`LRUCache` / `AsyncBatchNotifier` 不经本入口），
让「能否挪动这三个类」的判断依据回到事实。纯注释，无代码变化。
