# 分片 core-misc-p2（第五轮 ocrreview.md，19 条）

清单：`.ocr-fix/groups5/core-misc-p2.md`。拥有文件：`src/core/performance/metrics.ts`、
`src/core/performance/PerformanceMonitor.ts`、`src/core/utils/clone.ts`、
`src/core/utils/equality.ts`、`src/core/utils/helpers.ts`。

回归锁：`tests/unit/r5-core-misc-p2-performance.test.ts`（14 例）、
`tests/unit/r5-core-misc-p2-clone.test.ts`（17 例）、
`tests/unit/r5-core-misc-p2-boundaries.test.ts`（15 例，主控追加项：core/utils 三个纯工具的边界用例）。
既有用例改动：无（`tests/unit/regression/ocr-low-round4-p2.test.ts` 的 #191/#192 与
`ocr-medium-wave.test.ts` 的 #123/#189 在修复后仍按原文通过，第四轮结论未被推翻）。

自验：`npx tsc -p tsconfig.json --noEmit` 与 `npx tsc -p tsconfig.tests.json --noEmit` 在本分片文件上零输出
（后者仍有 `src/core/store/factory.ts`、`tests/types/*`、`r5-core-misc-p1-*`、`r5-plugins-types-p2-probe` 的报错，属并行分片中间态）；
`npx eslint <5 个源文件 + 3 个新测试>` 零输出；
`npx jest --ci --silent tests/unit/r5-core-misc-p2 tests/unit/core/utils tests/unit/core/performance tests/unit/regression tests/unit/store tests/unit/integration tests/unit/hot-round5.test.ts`
→ 43 suites / 1026 tests 全绿；分片五文件覆盖率 stmts/branch/funcs/lines = clone 100/100/100/100、
equality 100/99.06/100/100、helpers 100/100/100/100、metrics 99.07/94.64/100/98.97、PerformanceMonitor 100/100/100/100
（metrics.ts:146 与 equality.ts:274 是修复前就存在的防御分支，均高于 `./src/core/**` 的 85 分支门槛）。
`tests/unit/extras`、`tests/unit/plugins/performance`、compose 相关套件的失败点全部落在
`src/extras/**`、`src/plugins/performance/analyzerPlugin.ts`、`src/core/compose/**`（他分片在改），
单独运行 `tests/unit/plugins/performance/analyzerPlugin-lifecycle.test.ts` 为 PASS，与本分片无关。

NEEDS-MAIN：无（19 条全部落在本分片拥有的 5 个文件内，未越界改任何他分片文件）。
边界用例追加项不需要 jest 配置改动：`roots=<rootDir>/tests` + `testMatch` 的 `?(*.)+(spec|test).ts`
已覆盖新文件（`npx jest --ci --listTests` 共 133 个，含本分片 3 个）。

### R5-090  verdict=FIXED  record() 无条件留存入参副本

`let metricRecord = metrics` 在 trackMemory 关闭/内存不可用时让缓冲区与 logger 直接持有调用方对象。
改为 `const metricRecord: PerformanceMetrics = { ...metrics }`，内存字段改写在这份副本上。
用例断言「record 后改入参 → getMetrics()/getStats()/exportJSON() 不变」与「logger 收到的不是入参对象」。
API-CHANGE: `record()` 从此不持有入参引用（此前同一入参对象的后续改动会改写已记录的历史指标）；
签名与返回不变，`record` 的 JSDoc 已把该承诺写明。

### R5-091  verdict=FIXED  采样判据改严格小于

`Math.random()` 取值域是 [0,1)，`<= 0` 在随机数恰好为 0 时仍留存一条，而 sampleRate=0 的契约是「一条都不留」；
`sampleRate=1` 下 `< 1` 恒真，100% 采样不变。用例用 `jest.spyOn(Math,'random').mockReturnValue(0)` 双向锁住。
连带修正 `normalizeSampleRate` 的注释：原文写「`Math.random() > NaN` 恒为 false → NaN 让采样变成 100% 记录」，
与实际判据方向相反（真实后果是静默变成 0% 记录）。报告括注的「上方 sampled 分支应使用同一比较」不成立：
`grep -rn "Math.random()" src` 全仓仅此一处采样比较。

### R5-092  verdict=FIXED  内存读数改经 globalThis

与同类 `_getTimestamp` 读 wx 的口径统一：裸 `performance` 标识符在无该全局的基础库里抛 ReferenceError
并被同函数根的 catch 吞掉，trackMemory 静默失效。改 `(globalThis as {performance?: ...}).performance` +
可选链；catch 只保留「宿主 getter 抛错」这一真实可能。用例：`delete globalThis.performance` 后
record 不抛错且 memoryUsage 为空，另有 memory 可用时写入副本（不污染入参）一条。

### R5-093  verdict=FIXED  start() 也执行超时清扫

`pruneStaleOperations` 此前只被 `record()` 调用，「反复 start、从不 end、也不再 record」的调用形状下永不触发。
改为 start() 在 `currentOperations.set` **之前**清扫，并把 `pruneStaleOperations(now)` 的时钟读数交给调用方传入
（start 复用刚取到的 startTime、record 传 `_getTimestamp()`）：既省一次时钟读取，也让「与条目同一基准」
由参数而非注释保证。用例锁住超时条目被摘除、本轮新条目不被自己扫掉、未超时的在途条目保留。
API-CHANGE: 在途计时条目若超过 10 分钟未被 end()，此后任意一次 start() 即会摘除它（此前还需一次 record()），
disposer 走既有「计时条目缺失」debug 分支。

### R5-094  verdict=FIXED(口径显式化)  exportJSON 导出 options 投影与指标快照

`options.logger` 恒被定义（构造期绑定 defaultLogger），JSON.stringify 静默丢键使报告形状「恰好」少字段。
改为 `const { logger: _logger, ...reportOptions } = this.options` 显式投影，`metrics` 改走 `getMetrics()`
（与 getStats 同源，不再依赖「序列化不写回」这一实现细节）。**输出的 JSON 字节不变**（logger 本就是不可序列化成员），
故不引入 `loggerConfigured` 这类新键；JSDoc 用 @remarks 写明 options 段是配置的投影而非入参回放。

### R5-095  verdict=FIXED  detectRegression 读侧不再命中原型成员

报告的机制成立、**后果判断失实**：旧代码取到的原型成员（函数/对象）不等于 undefined 而放行守卫，
而 `Function > 0` 为 false 会走 0 基线分支，于是产出的不是「被静默丢弃」而是 `baselineDuration` 为函数、
`change` 为 NaN、`changePercent` 为 Infinity 的**幽灵退化项**。探针（HEAD 版本逻辑，node -e）：
`toString/__proto__/hasOwnProperty/valueOf` 四条全部 `hit:true, reported:true`。
修法取报告的第二方案（比 `Object.hasOwn` 更严）：`calculateAvgDurations` 直接返回 `Map<string, number>`，
读写两侧都不再有原型链命中（`lib: ["ES2020"]` 下 `Object.hasOwn` 无类型，报告给的第一方案改不了）。
用例锁「基线为空时四类原型名都不产出退化项」+「基线真有其项时照常上报、`__proto__` 作普通操作名可用」。

### R5-096  verdict=FIXED  getHotPaths 的 limit 先规范化再截断

`take = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0`，长度上界由 slice 天然夹住。
修复前 `-1` → `slice(0,-1)` 返回「除最后一条之外」的全部，与「top-N 热路径」语义相反；NaN → 空；小数静默截断。
非有限值统一按 0（与同库 `getRecentMetrics`、`normalizeMaxSize` 的口径一致，不再各自方言）。
API-CHANGE: 负数与 `Infinity` 由「返回其余条目 / 返回全部」变为返回空数组；0-1 与正常整数行为不变。

### R5-097  verdict=FIXED  按操作分组只剩一份实现

抽 `summarizeByOperation(metrics): Map<string, {count,totalDuration,maxDuration}>`，
`computePerformanceStats`（原本还要第二张 opSums 表）、`getHotPaths`、`analyzeBottlenecks`（原本先攒每组消息数组再重算一遍）、
`calculateAvgDurations` 四个入口全部由它派生，原型污染安全的累加注释也只留一处。
顺带把 `analyzeBottlenecks` 的每组 O(k) 二次求和消掉（它只需要 count/avg/max 三项）。
用例断言四者的次数/平均/最大在同一输入上互相对齐，防「只改一处」的漂移。

### R5-098  verdict=FIXED  thresholdExceeded 并入主循环

`metrics.filter(...).length` 改为在同一 `for (const m of metrics)` 里累加，省掉一次全量遍历与一个中间数组
（该函数正处在被监控操作自己的热路径上）。行为不变，用例双向锁住（含 `exceedThreshold` 缺省 undefined 不计入）。

### R5-099  verdict=FIXED  filter 谓词形参改单数命名

`(metrics: PerformanceMetrics) => boolean` → `(metric: PerformanceMetrics)`，JSDoc 的 @param 同步，
与第四轮 #128 对 `collect` 的改名保持同一口径。纯命名项，无可断言行为，故无用例。

### R5-136  verdict=FIXED  数组克隆保留空洞与非下标自有属性

旧实现 `[]` + 逐位 push：空洞被写成值为 undefined 的实槽位、`arr.meta` 整体丢弃。
改为 `new Array(value.length)` + 按 `hasOwnProperty` 判定存在性（不用 `i in value`，语义上只认自有键），
再补一趟 `Object.keys` 处理非下标键（`isIndexKey` 跳过已复制的下标），写入统一走 `assignOwn`
（数组上的自有 `__proto__` 键同样要按自有数据属性复刻，否则副本原型被 [[Set]] 换掉）。
HEAD 版探针：`OLD hasOwn(clone,'1')=true / OLD deepEqual(clone,src)=false / OLD meta kept(drop)=true`；
修复后 `false / true`。影响面按任务要求 grep 过：`deepCloneState` 的消费方为
Store（setState/$replaceState/$snapshot/notify 载荷）、SubscriptionManager、composeStore/StoreRegistry、
timeTravelPlugin、createSelector/parametricSelector 的快照路径。方向上这是让副本回到「与源同形」，
副本自比（clone vs clone）与副本对源比较都只会从失配变命中；唯一会由命中变失配的是
「拿补过空洞的旧副本去和真正的稀疏源比」这类本就该按 #189 的口径判不等、如今才判对的情况。
API-CHANGE: 克隆出的数组与源在空洞/附加属性上等价（此前副本 length 相同但槽位性质不同、附加属性丢失）。

### R5-137  verdict=FIXED  内建类型子类不再被静默降级为基类副本

Date/RegExp/Map/Set/Array 五个分支各加 `isExactly(value, X.prototype)` 门槛，非该内建原型本身时 `return value`，
与文件头既有的「不可安全克隆的值保留原引用」降级口径合流（子类的构造参数、内部槽位、自有字段都不可知，
重建必然得到残缺对象）。HEAD 版探针：`MyMap` 实例克隆后 `instanceof MyMap=false`、`===源=false`、
`extra=undefined`；修复后同引用、子类方法可用，Array 子类不再被 deepEqual 的原型一致性检查判不等。
不改判为按原型重建：`Object.create(Map.prototype)` 没有内部槽位、`new value.constructor(...)` 依赖未知签名，
两条都会在热路径上抛错或产出半残对象。grep 确认 src 与 tests 内无 `extends Map/Set/Array/Date/RegExp`，
StateProxy 对 Map/Set/Date/RegExp 一律不代理（`isBuiltinObject`），数组代理的原型仍指向 `Array.prototype`，
因此代理状态不受影响。
API-CHANGE: 状态里的内建类型子类实例在快照/克隆后与活状态共享同一实例（此前是丢方法的基类副本）。

### R5-138  verdict=FIXED(仅文档)  clone 头部补写 Map 键身份变化的窄口径

行为不变（键深克隆是克隆的本职），按报告第一诉求在 `deepCloneState` 文档里显式写明：
键随克隆改变引用身份、deepEqual 的 Map 分支按键引用匹配，因此**对象键 Map** 会让
`deepEqual(deepCloneState(state), state)` 恒 false，规避方式与 equality.ts 的 @remarks 一致。
另加用例把这条「声明出来的限制」锁住（对象键克隆后取不到、原始值键仍等价），文档无法再被静默推翻。

### R5-139  verdict=FIXED(仅文档，不改行为)  字节缓冲显式列为共享引用节点

文件头此前只举 WeakMap/Promise/Blob，现补一段完整的「保留原引用」清单，明确
ArrayBuffer/TypedArray/DataView 属**不隔离**节点、改写副本会串进活状态，并给出调用方出口（自行 `slice(0)`）。
不采纳「对它们做 slice / 按构造克隆」：视图类型 12 种 + DataView，重建要按 species/`ctor.prototype === proto`
反推构造器，还要处理 detach（越界即 RangeError）、resizable、SharedArrayBuffer、多视图共享同一 buffer 的
别名保持，且要新增一套原型判定；报告给的 `value.slice()` 只覆盖 TypedArray，DataView 无 slice、
ArrayBuffer.slice 会断开视图与 buffer 的别名。在 setState/$patch/$snapshot 的克隆热路径上
用这套复杂度换一项文档级 finding，代价与收益不匹配，且部分类型被克隆、部分仍共享反而更难推理。
改为用 `r5-core-misc-p2-clone.test.ts` 的 R5-139 用例锁定「三者都按原引用返回、改副本会串改源」，
使文档声明与运行时事实必须同步改动。

### R5-143  verdict=FIXED  引用快路径提到深度检查之前

`depth >= maxDepth` 早于 SameValueZero 快路径时，`deepEqual(1,1,0)`、同一引用恰好落在 maxDepth 上
都被判不等，自反性被破坏；且该分支是 `return false`，还会连带取消栈上兄弟分支。改为快路径在前、
深度检查只管「需要继续下钻」的结构，保守语义（超深判不等 + 一次性告警）原样保留。
HEAD 版探针：`OLD deepEqual(1,1,0)=false / OLD(shared,shared,0)=false / OLD({a:s},{a:s},1)=false`，
同探针里 `{x:{a:1}} vs {x:{a:2}}` 在 maxDepth=1 下两侧都为 false（未收窄）。
影响面：deepEqual 是选择器缓存比较器与 `equalityFn` 的默认实现，本次只把边界上的假「已变更」改回相等，
方向上不会造成陈旧值误命中（同引用/同原始值本来就等价）。
API-CHANGE: `deepEqual(x, x, n)` 与 `deepEqual(p, p, n)`（p 为同一原始值）在任意 n 下都为 true。

### R5-144  verdict=FIXED  告警状态随比较创建，deepEqual 可重入

删掉模块级 `depthWarningEmitted`，引入 `Comparison { maxDepth, seenPairs, warnedAtMaxDepth }`，
在 `deepEqual` 里新建并逐层传给 `compareWithSeenPairs` / `setsEqual`（两者签名一并收敛，
不再有 maxDepth/seenPairs 两个散参数）。两个内部函数均为模块私有，公开面不变。
探针（HEAD 版实现）：外层比较里 getter 再入一次 deepEqual 后，
`OLD warnings=1`（外层那条被内层消费掉的标记吞掉）、`NEW warnings=2`，两次返回都仍是 false。
「同一次顶层比较只警一条、下一次重新计一条」由既有用例 #192 与新用例分别锁住。

### R5-164  verdict=FIXED  删去 deepMerge 的重复分支

`Array.isArray || instanceof Map || instanceof Set` 确为下一分支 `typeof === 'object' && !== null` 的严格子集，
且两分支体逐字符相同，合并为一条并把数组/Map/Set 不做递归合并的理由（下标错位、键集叠加、Date/RegExp
自有键恒空会被零次循环静默丢弃、类实例会被散落成杂散属性）写进保留的那条注释。零行为变更，
R5-164 用例锁住四类源值仍被整体替换为克隆副本。

### R5-165  verdict=FIXED(仅文档)  deepMerge 的 JSDoc 改写为真实契约

现象成立：`clone()` 默认 deep → `deepCloneState`，对原型非 `Object.prototype`/null 的对象按引用返回，
所以 `deepMerge(target, {p: new Point(1,2)})` 之后 `target.p === source.p`，函数级 JSDoc
「会进行深拷贝以防止共享引用」确为失实，且行内注释只点了 Date/RegExp。
不采纳「把这些对象的自有可枚举属性拷进新实例」：那会同时改掉 deepCloneState 的既定降级口径，
状态里以引用承载的 Promise / WeakMap / 事件目标 / 宿主对象会被复制成失去内部槽位与身份的残骸
（第四轮 #287 已确认「不可克隆值按引用」是全库约定），且类实例的字段未必可枚举，浅拷自有键
也造不出可用实例。改为按报告的第一方案：@remarks 写清逐类合并规则、命中共享的具体类型清单、
`Store.$patch` 走本函数这一后果，以及调用方的规避方式；R5-165 用例锁住「类实例与 TypedArray 按引用并入、
纯对象仍隔离」。

### R5-166  verdict=FIXED  shallow 模式只展开可保类型的对象

`clone(obj, {mode:'shallow'})` 对非纯对象的 `{ ...obj }` 分支改为先 `isPlainObject` 守卫：
类实例/Error/WeakMap/Promise 的自有可枚举键一般为空，展开只会得到丢掉原型（连带全部方法）的空壳，
现按 deep/safe 的同一口径返回原引用。探针：`{...new Error('x')}` 的 `Object.keys` 长度为 0。
同时给纯对象分支补上原型复位（`{...obj}` 是 DefineDataProperty 语义，自有 `__proto__` 键不会被 [[Set]] 吞掉，
再 setPrototypeOf 回 null 原型），消除与 deep 路径 #170 原型保真口径的分叉。
`mode:'shallow'` 在 src 内零调用方（grep `mode: 'shallow'` 只命中 tests），clone 的 JSDoc 已同步模式说明。
`mode:'shallow'` 在 src 内零调用方（grep `mode: 'shallow'` 只命中 tests），clone 的 JSDoc 已同步模式说明。
API-CHANGE: 非纯对象的 shallow 克隆由「空普通对象」变为原引用；null 原型对象的 shallow 副本保留 null 原型。

### 本分片未动的相邻观察（无对应 R5 条目，交主控定夺）

1. `helpers.shallowEqual({}, Object.create(null))` 为 **true**：纯对象分支不校验 `getPrototypeOf`，
   而 `deepEqual` 自第四轮 #190 起要求原型一致。同一对值在两个比较器下一真一假，
   与 #210 立下的「结构判别取代白名单」并不冲突，只是当时没覆盖 null 原型这一格。
   不改的原因：`shallowEqual` 是公开导出（`src/core/index.ts:45`，src 内零调用方），
   收窄判据属独立 API 变更，且本轮 createSelector 的比较口径刚被改过，不叠加。
2. `deepEqual` 的 Date/RegExp/Map/Set 四个内建分支在原型一致性检查**之前** `continue`，
   于是 `deepEqual(new MyMap(), new Map())`（同为空内容）为 true，与 @returns 写的「原型一致」不符；
   `new Number(1)` 与 `new Number(2)` 也为 true（装箱值在内部槽位里，`Object.keys` 为空）。
   两条都是既有窄口径，第五轮 376 条里没有对应条目，本分片只登记不动。
3. `deepMerge` 的 @remarks 现在把「不共享引用只对可安全克隆的值成立」写成契约；
   若后续想让 `$patch` 真隔离，需要在 `deepCloneState` 层给类实例加按原型重建的分支，
   那是跨 clone/store 的设计变更，不在 core-misc-p2 范围内。

