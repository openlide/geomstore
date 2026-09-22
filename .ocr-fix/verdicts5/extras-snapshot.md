# 分片 extras-snapshot — 第五轮（ocrreview.md）19 条判定

清单：`.ocr-fix/groups5/extras-snapshot.md`。
owned 源码：`src/extras/snapshot/{types,diff,clone,clone-async,SnapshotManager}.ts`。
回归锁：`tests/unit/r5-extras-snapshot-fixes.test.ts`（36 例；前任写 32 例，本分片补 4 例）。

对账结论：接手的分片**代码基本落地、台账为零**（前任未留任何 verdicts5 记录，源码与
`tests/unit/r5-extras-snapshot-fixes.test.ts`（32 例）、`tests/unit/extras/snapshot/SnapshotManager.test.ts`
两处断言已在树里）。逐条与 `git diff` 对账后：14 条前任已完整做完（R5-239/243/245/246/251/252/253/254/255/256/
259/260/261/262，含各条的异步侧同口径）；2 条做了但留有残留，由本分片加固（R5-244 的「只跳过不比较」空转、
R5-257 硬上限被 `maxDepth: NaN` 绕过）；1 条完全没做（R5-238 的 `data` 类型，前任只写了「为什么不改」的注释，
本分片改到位）；2 条判 FP（R5-240 第四轮 #304 已裁定、R5-241 报告给的类型手段是空操作）。
顺带修掉三处与代码不符的注释（`handleCloneError` 的调用点计数、异步 keys catch 的「已入队子任务」、
`syncDepthLimit` 的取值口径）。本分片改动文件：owned 源码 5 个 + `tests/unit/r5-extras-snapshot-fixes.test.ts`
（+4 例）+ `tests/unit/extras/snapshot/snapshot-custom-cloner-consistency.test.ts`（R5-238 判空同步，
两处 `result.data` 改走 `partialClone(result)` 辅助函数——该用例断言的正是「失败但仍有部分克隆」的形态）。

自验口径（改完后全部重跑）：
- `npx jest --ci --silent tests/unit/extras/snapshot tests/unit/r5-extras-snapshot-fixes.test.ts`
  → **7 suites / 234 例全绿**。
- `npx tsc -p tsconfig.json --noEmit` → **零输出**；`npx tsc -p tsconfig.tests.json --noEmit` →
  本分片 5 个源码文件与 2 个测试文件零报错，仅余
  `tests/unit/extras/ocr-medium-round4-p4.test.ts` 6 条 `TS18048/TS2769`（越界文件，见 NEEDS-MAIN）。
- `npx eslint <5 个源码文件 + 2 个测试文件>` → **exit 0，0 error / 0 warning**。
- `npx jest --ci --silent tests/unit/extras`（42 suites / 806 例）→ 仅 2 例失败，均在
  round-4 越界测试文件（`ocr-medium-round4-p3:157`、`ocr-medium-round4-p4:96`），成因见 R5-239 / R5-254。
- 覆盖率（`--collectCoverageFrom='src/extras/snapshot/**/*.ts'`，跑 snapshot 目录 + 本分片锁 +
  hot-round5 + round4 三个 ocr 文件 + entry-exports）：
  `All files 100 / 99.35 / 98.03 / 100`，其中 `clone.ts` / `clone-async.ts` / `diff.ts` 四项均 100，
  `SnapshotManager.ts` 97.93 branches（缺口 547-549 是异步 catch 里 `'Unknown error'` 非 Error 侧，
  本分片未改动该处）→ 门槛 branches 85 / functions 98 / lines 98 / statements 98 全部满足。
- `tests/unit/hot-round5.test.ts` 全绿（R5-258 的 `normalizeBatchSize` / 构造期守卫未回退）。

---

### R5-238  verdict=FIXED  `SnapshotResult.data` 改为 `T | undefined`，失败路径不再靠断言圆场

前任只写了「为什么不改」的注释（原判词见下），本分片按报告第一选项改到位：`types.ts:163` `data: T | undefined`，
`SnapshotManager.ts` 三处出口随之去掉 `undefined as T`（`buildFailureResult` 交 `data: undefined`，同步路径
`clonedData === SKIP_CLONE_NODE ? undefined : (clonedData as T)`，异步路径断言收窄到 `as T | undefined`）。
权威口径与库内文档本就一致（`docs/API.md` 的 `data` 行、`docs/BEST_PRACTICES.md:88`、`docs/FAQ.md:82` 都写着
失败时 `data` 是 `undefined`），只有类型在说谎。刻意不改成 `data?: T`，也不改成以 `success` 判别的联合：
失败分支的 `data` 未必为空（异步超时交半成品），且接口变联合后任何以 `success: boolean` 自造结果的调用方都会转红。
回归：`r5-extras-snapshot-fixes.test.ts` R5-238 一例，含 `const failure: SnapshotResult<number> = { data: undefined, … }`
（无断言可编译）与 `/* @ts-expect-error */ halfBuilt.data.a`（不判空取属性必须报错；类型检查由
`npx tsc -p tsconfig.tests.json` 执行，ts-jest 是 transpile-only）。
API-CHANGE: `SnapshotResult<T>.data` 由 `T` 改为 `T | undefined`（纯类型面破坏；运行期取值不变）。
连带：`tests/unit/extras/ocr-medium-round4-p4.test.ts` 6 处判空需同步（NEEDS-MAIN）。

### R5-239  verdict=FIXED  恒真标记 `recoverable` 从公开类型上删除，而不是 @deprecated

前任按报告第一选项删字段（`types.ts:127-141` 现只剩 `path/depth/value`，两处咨询点的 `recoverable: true` 一并移除），
`SnapshotErrorContext` 的文档块写明「为什么没有它」：两处咨询点都有降级路径 ⇒ 恒真 ⇒ 既不参与走向判定也没有分流价值，
回调分流请读 `SnapshotError.type`。`@deprecated` 属于「留着继续误导」的垫片，不采纳。
验证：`npx jest … tests/unit/r5-extras-snapshot-fixes.test.ts` 的 R5-239 例断言
`Object.keys(context)` 严格等于 `['path','depth','value']` → 通过；全仓 `grep -rn recoverable src/extras/snapshot` 零命中。
API-CHANGE: 删除公开类型 `SnapshotErrorContext.recoverable`（读取该字段的回调会编译失败）。
连带：`tests/unit/extras/ocr-medium-round4-p3.test.ts:157` 仍 `toMatchObject({ recoverable: true })`（NEEDS-MAIN）。

### R5-240  verdict=FP  `boolean | void` 是第四轮 #304 已裁定的刻意契约，本轮无新证据

同一行、同一论点（`(e) => { logger.warn(e) }` 隐式 undefined 会被当作拒绝继续）在第四轮
`.ocr-fix/verdicts/G2-extras-medium-p4.md` #304 已判「取文档方案」：报告给的两种处置里，本库选的是
「按真值解释 + 文档写实」。现状核对：`types.ts:44-63` 已把「falsy（含不写 return 的 `void`）＝拒绝继续」
与「拒绝的后果按 `cloneError` / `circular` 分岔」写明，`docs/API.md` 的 `onError` 行同口径；
行为锁在 `tests/unit/extras/ocr-medium-round4-p4.test.ts` #304 三例（本分片跑测除 R5-254 那条外全绿）。
报告未给出 #304 之外的事实（只重复「TS 不会告警」），按纪律不推翻第四轮判定。

### R5-241  verdict=FP  报告建议的类型手段在 TS 里是空操作，唯一有牙齿的改法是破坏公开契约

**命令级证据**（探针已删）：`npx tsc --noEmit --strict --target es2020 --module esnext --ignoreConfig
.cache/r5snap-union-probe.ts` → **exit 0**，其中 `const collapsed: Equals<typeof NOT_HANDLED | unknown, unknown> = true`
成立 ⇒ `unknown` 吸收联合成员，报告建议的「把导出的 NOT_HANDLED 符号并进返回类型联合」折叠回 `unknown`，
既不能静态区分「未命中」与「命中且值为 undefined」，也不改变任何调用点判定（`declare const v: 符号|unknown`
仍不能赋给 `number`）。反向对照 `.cache/r5snap-union-probe2.ts`（`Equals<typeof NOT_HANDLED | undefined, unknown>`）
报 TS2322 → 探针本身有效。真正可静态强制的只有结果对象协议（`{ handled: boolean; value?: unknown }`），
那是对已发布 `customCloner` 的破坏性重设计（还要连带 `docs/API.md`「返回 `undefined` 表示交回默认流程」
与 skill API reference 生成脚本），与一条 low·maintainability 不成比例。
可做的「与 clone.ts 保持一致」这半件前任已完成：`types.ts:23-34` 三条出口（undefined=未命中 / 其他值=直接采用 /
抛错=落 cloneError 并按 onError 决定丢节点或抛 SnapshotAbortError）逐条对得上 `clone.ts:169-185` 的
`invokeCustomCloner`，两条路径各调一次（`clone.ts:352` / `clone-async.ts:76`，同一 import 自 clone.js）。现行为锁在
`tests/unit/extras/snapshot/snapshot-custom-cloner-consistency.test.ts`（8 例，含「命中值原样进快照、不再递归」
「两条路径产出完全一致的结构」「根节点被丢弃时两条路径都交 undefined」）。

### R5-243  verdict=FIXED  结构配对统一以 Infinity 深度预算调 deepEqual，超深等价键不再成对误报

`diff.ts:59` 的 `pairUnordered` 是唯一调用点，`deepEqual(item1, items2[k], Number.POSITIVE_INFINITY)`，
Map 键与 Set 元素同时受益（报告只点了 Map 那一处）。口径与 `compareValues` 深度护栏回落处一致（那里也传 Infinity，
注释写明「沿用默认 1000 等于把要消除的误报换个位置重新引入」）。
回归：`r5-extras-snapshot-fixes.test.ts` 「深过 deepEqual 默认预算的等价 Map 键」一例——1100 层的等价键，
断言 `diff.changes` 为 `[]` 且 `console.warn` 未被调用（修复前成对 removed+added 并附带 `[deepEqual]` 告警）→ 通过。
API-CHANGE: 深于 1000 层的等价 Map 键 / Set 元素不再被报为「一删一增」。

### R5-244  verdict=FIXED  护栏由「集合规模 >1000 项」改为「比较次数 >2000 次」，本分片再补两处收口

前任的改动：`diff.ts:24` `MAX_STRUCTURAL_DIFF_COMPARISONS = 2000` 按 deepEqual **次数**计费并在超预算时
`aborted → 整体差异报告`；两侧规模相等的冗余判定（`unmatched1.length === unmatched2.length`）随重构删除。
本分片补两处（报告「最坏情况可预测」的诉求尚未完全落地）：
① items2 侧的对象槽位预先过滤成 `structuralSlots`（`diff.ts:82-88`），「一侧全对象、一侧全原语」的形状
从 n×m 次 deepEqual（每次都只在 `typeof` 上失败）降为 **0 次**；
② 明确**不**把已配走的槽位从候选里摘除，并在注释写清原因：摘除后回填会把「两侧同序的等价集合」这条
每元素一次比较的快路径打散成 n² 次 deepEqual，超预算后把等价集合误报成整体差异（我先试了带摘除的写法，
260 元素的同序等价集合即被误报，遂改回）。
回归（`r5-extras-snapshot-fixes.test.ts` 无序配对 describe，共 9 例）：60 个互不相同的对象 → 1 条整体差异；
20 个 → 40 条逐项增删；3000 原语集合只差一个值 → 精确一删一增；3000 对象 vs 3000 原语 → 6000 条逐项增删（不退化）；
260 个同序等价对象 → `changed: false`。
`npx jest --ci --silent tests/unit/extras/snapshot tests/unit/r5-extras-snapshot-fixes.test.ts` → 234/234。
API-CHANGE: 无序集合退化为整体差异的触发条件由「项数 >1000」改为「结构比较次数 >2000」。

### R5-245  verdict=FIXED  Map 键与 Set 元素改共用 pairUnordered，护栏与判等口径不再各自漂移

`diff.ts:59-118` 抽出 `pairUnordered`（第 1 层 SameValueZero 索引、第 2 层预算内结构匹配、同一 `aborted` 出口），
Map 分支（`diff.ts:266-289`）与 Set 分支（`diff.ts:303-316`）各调一次，两份逐行重复的 unmatched/used 循环删除；
报告点名的「同一份数据在两条分支上判等口径不同」随共用消解（`grep -c used2 src/extras/snapshot/diff.ts` → 0，
`grep -n pairUnordered src/extras/snapshot/diff.ts` → 5 行：模块头 1 + 定义 1 + 注释 1 + 调用 2，
即 `diff.ts:268`（Map 键）与 `diff.ts:303`（Set 元素）各一处）。
Map 的引用级快路径（`map2.has(key)`）保留在调用方（要先取到配对的**值**才能续比），注释已标明
「Map 分支传的是未命中引用的键，引用匹配在调用方已做过」。行为等价性由既有用例守住：
`tests/unit/extras/ocr-low-round4-p2.test.ts` 的「Map 键结构匹配对 0/-0 与 NaN 判等」「真实差异仍按
added/removed 报出」两例 + 本分片 9 例全绿。

### R5-246  verdict=FIXED  对象分支一律先比原型，判定不再随嵌套深度分岔

`diff.ts:211-214` 在 Date/RegExp/Map/Set/数组/通用对象所有分支之前加 `Object.getPrototypeOf(obj1) !== …→ changed`，
与深度护栏回落的 `deepEqual` 同判据（`src/core/utils/equality.ts` 的 `class Foo` 实例 vs `{a:1}` 段落，
该文件由 core-misc-p2 定稿，本分片未触碰、只按现状对齐）。连带收益：`obj1 instanceof X || obj2 instanceof X`
式的「两侧都判」闸门收敛成单侧判定 + 一处 Array 例外说明（`Array.isArray` 看内部槽而非原型）。
回归：`r5-extras-snapshot-fixes.test.ts` R5-246 describe 4 例（浅层 `Point` vs 结构相同的普通对象 → 1 条 changed；
同一对值包到 150 层下 → 结论同为 changed 且只记 1 条；`[1,2]` vs `Object.create(Array.prototype)` → 整体差异；
同原型 + 自有键差异 → 仍按 `added` 报）。
同步改动（owned 测试）：`tests/unit/extras/snapshot/SnapshotManager.test.ts` 「inherited values do not count as own
properties」原对照物是 `{ value: undefined }` 字面量，与 `Object.create({value: undefined})` 原型不同，
会被新判据抢先记成整体差异而测不到「自有键」这一点 → 改成两侧共用同一 `proto`（断言文本未动）。
API-CHANGE: 原型不同的对象在任意深度都判为有差异（此前只在深过 100 层护栏时由 deepEqual 判出）。

### R5-251  verdict=FIXED  ownKeys 抛错改丢节点，不再交出源数据里不存在的空壳

`clone.ts:509-521`（同步 keys catch）与 `clone-async.ts:233-239`（异步同处）都改为
`dropFailedNode(...) → return SKIP_CLONE_NODE`，与 customCloner / 外壳构造 / 属性读三类失败出口的
「该位置不出现」统一；`clone.ts:516-518` 注释写明「空壳与丢节点对下游 diff / 序列化的结论并不相同」。
回归（`r5-extras-snapshot-fixes.test.ts` R5-251/R5-252 describe，3 例）：`{ first: hostile, second: hostile, ok: 1 }`
在同步与异步两条路径上都断言 `first` / `second` 两处键**都不存在**（修复前 `first` 是 `{}`、`second` 命中 visited
复用同一副空壳）、`data.ok === 1`、`errors` 里 2 条 cloneError → 通过。
API-CHANGE: Proxy `ownKeys` 抛错且 onError 允许继续时，该节点从快照中消失（此前留下 `{}`）。

### R5-252  verdict=FIXED  丢节点的同时从 visited 除名，两条路径共用 dropFailedNode

`clone.ts:132-141` 新增 `dropFailedNode`（先 `context.visited.delete(value)` 再走 `handleCloneError`），
四个节点级 catch（同步外壳/keys、异步外壳/keys）统一调用它；注释写明除名的必要性：容器分支建壳后立刻登记，
只丢不除名会让同一源对象的后续引用命中快路径、静默拿到被丢弃的半成品。
异步 catch 的注释由本分片改写：原写「已入队的子任务只会写进这副被丢弃的壳」不成立——对象分支的子任务
在 keys 之后的属性循环里才入队，此刻队列为空，真正要除名的理由是 visited 复用（`clone-async.ts:229-232`）。
同轮顺手把 `handleCloneError` 头部的「同步三处 catch 与异步两处 catch 共用」改成与现状一致的表述
（直接调用点 2+1，节点级丢弃另经 `dropFailedNode` 转来，合计四处）。
验证：`grep -n "visited.delete" src/extras/snapshot/*.ts` → 仅 `clone.ts:140` 一处（单点收尾）；
上条 3 例用例覆盖两条路径 + 容器登记后抛错（HostileMap 迭代器抛错 → `visited.has(source) === false`）。

### R5-253  verdict=FIXED  circular 的「不构成中止点」按规格写进注释，不改抛错

取报告的文档方案（另一选项「改抛 SnapshotAbortError」会推翻第四轮 #304 定稿的「拒绝继续的后果按错误种类分岔」，
且 `docs/API.md` 的 `onError` 行同样按现语义写着）。`clone.ts:283-286` 现在明确：`detectCircular` 只控制是否上报本条
circular 错误、检测始终生效、onError 拒绝时该位置写 `'[Circular Reference]'` 并继续，快照仍可 `success: true`，
并指回 `types.ts` 的 `SnapshotOptions#onError` 分岔说明。
验证：`createSnapshot(source, { onError: () => false })`（source 自引用）→ `success: true` 且
`data.self === '[Circular Reference]'`（R5-253/R5-254 describe 第 1 例）；`detectCircular: false` 时
`errors` 为空、`data.self === data`（复用已建克隆）→ 第 2 例锁住。

### R5-254  verdict=FIXED  circular 先落账再咨询 onError，errors 成为完整账本

`clone.ts:288-301`：构造 `circularError` → `errors.push(circularError)` → 用**同一个对象**咨询 `onError`
（此前是两处各造一份、且一份都不入 errors）。与相邻 `maxDepth` 分支同账本口径，也与
`types.ts:147-149` 的「`success: true` 时 errors 可以非空：只有 cloneError 参与 success 判定」和
`docs/API.md` 的 `success` 行一致；`stats.circularReferences` / `metadata.hasCircular` / `errors` 三处不再两有一无。
回归：`r5-extras-snapshot-fixes.test.ts` 断言 `result.errors.map(e => e.type) === ['circular']`（同步）；
`tests/unit/extras/snapshot/SnapshotManager.test.ts` #21 段补了同步/异步两条同口径断言（前任同步，属 owned 路径）。
API-CHANGE: `result.errors` 现在包含 `circular` 条目（此前只计入 stats/metadata）。
连带：`tests/unit/extras/ocr-medium-round4-p4.test.ts:96` 的 `toHaveLength(0)` 需同步（NEEDS-MAIN）。

### R5-255  verdict=FIXED  Date/RegExp 计一次克隆操作，两条路径同口径

`clone.ts:372-379` 与 `clone-async.ts:91-98` 的 Date / RegExp 分支各补 `stats.cloneOperations++`，
与 Map/Set/数组/对象分支及 `handleCloneError` 的降级计数一致；`types.ts:201-208` 的
`cloneOperations` 定义同步改写为「产出了独立克隆值的节点数（容器 + Date/RegExp + 按 onError 丢弃的降级），
原语与函数按引用直返不计」，注释并留「异步路径同口径，两条路径不要各自改」。
回归：`{ when: Date, pattern: /x/g, nested: { list: [1] } }` → 同步与异步都等于 5
（root + nested + list + Date + RegExp，R5-255 一例双断言）。
API-CHANGE: `stats.cloneOperations` 对含 Date/RegExp 的数据变大（此前每漏一个 Date/RegExp 少计 1）。

### R5-256  verdict=FIXED  访问器按描述符里捕获的 getter 求值，不再回读 value[key]

`clone.ts:543` 与 `clone-async.ts:254`：`descriptor.get.call(value)` 取代 `(value as Record<…>)[key]`，
Proxy 上不再重跑 `get` 陷阱，克隆值与被检查的那份描述符同源；报告要求的「setter-only 静默降级为
undefined → 经 `normalizeDescriptorFlags` 还原成可写数据属性」也写进了 `clone.ts:540-541` 的注释
（含「setter 本身不进快照」的理由）。异步侧注释指回同步侧，不重复展开。
回归（R5-256 describe 2 例）：target 上挂 `get: () => 'from-getter'`、外层 Proxy 的 `get: () => 'from-get-trap'`，
同步与异步都断言 `host.lazy === 'from-getter'`（修复前两条路径都拿到 `'from-get-trap'`）；
getter 抛错仍按 `root.boom` 落一条 cloneError 且 `onError` 只被咨询一次。
API-CHANGE: Proxy（或代理化对象）上访问器属性的克隆值来源改变：取描述符里的 getter，而非再次走 `[[Get]]`。

### R5-257  verdict=FIXED  递归克隆新增与选项无关的栈安全硬上限，并把 NaN/Infinity 一并接管

前任取报告的第一选项（显式硬上限，而非把同步引擎改成迭代工作栈——后者等于重写 `cloneDeep` 且
异步引擎 `clone-async` 已是那条路）：`clone.ts:220` `HARD_MAX_CLONE_DEPTH = 1000`、
`clone.ts:227-231` `syncDepthLimit()`，`cloneDeep` 用它替代 `options.maxDepth`（`clone.ts:341`），
异步 `processNodeAsync` 仍传 `options.maxDepth`（`clone-async.ts:64` 注明「本引擎按队列逐节点处理、
栈深度与数据深度无关，故不叠加」），`clonePrelude` 的 `maxDepth` 改由调用方以 `depthLimit` 显式传入，
超限仍按既有 `maxDepth` 降级（落 `maxDepth` 错误 + 占位，不影响 `success`）。
本分片加固：原写法 `Math.min(options.maxDepth, HARD)` 在 `maxDepth: NaN` 时得到 NaN，而 `depth > NaN` 恒为 false
⇒ 等于取消一切上限，报告要堵的「溢出落在任意一帧、被那个属性的 try 记成 cloneError」原样复现；
改成 `<` 比较（NaN 与 +Infinity 落到硬上限，负值仍原样返回以免抬高调用方刻意设的 0/负数）。
回归（R5-257 describe 4 例）：`deepChain(2500)` + `maxDepth: Number.MAX_SAFE_INTEGER` → `success: true`、
唯一一条 `maxDepth` 错误、`metadata.maxDepth === 1000`；同输入 `maxDepth: NaN` / `Infinity` 三条同断言（本分片新增）；
`processNodeAsync` 在 depth 1500 / maxDepth 5000 下不降级而同参数 `cloneDeep` 降级（两条路径口径差的锁）；
`maxDepth: 3` 仍报 `Maximum depth 3 exceeded`。
API-CHANGE: 同步快照的深度上限变为 `min(maxDepth, 1000)`，超出部分按 `maxDepth` 降级（此前是 RangeError
伪装成某属性的 cloneError 且 `success: false`）。
连带（越界文件）：`src/extras/snapshot/index.ts` 头部仍写「迭代式深度克隆」，与递归实现 + 硬上限不符（NEEDS-MAIN）。

### R5-259  verdict=FIXED  Array.isArray 纳入 getDataType 的兜底 try，revoked Proxy 不再让 createSnapshot 抛

`SnapshotManager.ts:631-641`：`if (Array.isArray(value)) return 'array'` 移入 try（`value === null` 与兜底
`typeof` 永不抛，留在外面），注释写明两处调用点都在结果组装阶段、失败路径上抛出会让 catch 自身异常
（正是 #288 那个洞）。
回归（R5-259 describe 2 例）：`Proxy.revocable` + `revoke()` 作为快照数据 →
`expect(() => manager.createSnapshot(proxy)).not.toThrow()`、`success: false`、`metadata.dataType === 'object'`；
`createSnapshot([1,2]).metadata.dataType === 'array'`（普通数组归类未退化）→ 通过。
API-CHANGE: 传入已 revoke 的 Proxy 时 `createSnapshot` 交付 `success: false` 的失败结果（此前向外抛 TypeError）。

### R5-260  verdict=FIXED  timeout/batchInterval 走 normalizeDelay，非有限值一律归「不设超时」

`SnapshotManager.ts:51-64` 新增 `normalizeDelay`（`Number.isFinite(ms) && ms > 0 ? ms : 0`），
`createSnapshotAsync` 的 `batchInterval` / `timeout` 都过它（`:231-232`），`opts.timeout > 0` 处只剩
「武装定时器 / 不设超时」两义（`:266-273`）。注释与实现此前相反的那点（写「0 是合法语义：立即超时」而实跑得是
「完全不超时」）按实现统一：`types.ts:218-231` 明确 0 / 负数 / Infinity / NaN ⇒ **不设超时**，并解释
0 为何不是「立即超时」；`batchInterval` 同段写明 0 即 `setTimeout(r, 0)` 让出。
`Infinity` 走 `setTimeout` 会被宿主夹到约 1ms 变成莫名立即超时（Node 还告 TimeoutOverflowWarning），现被挡住。
回归（R5-260 describe 3 例，`setTimeout` 上 spy）：`timeout: Infinity` + 400 节点 → `success: true`、无 timeout 错误、
`nodeCount 401`，且断言所有 `setTimeout` 的 delay 都是有限值；`timeout: 0` / `timeout: -5` / `batchInterval: NaN`
同样不武装异常定时器；有限正数 `timeout: 1` + `batchInterval: 20` 仍超时并落一条 timeout 错误。
与 R5-258（hot-p0）边界清楚：`normalizeBatchSize` 管 batchSize（构造期 + 合并后），`normalizeDelay` 管两个延时项，
未把 batchSize 的守卫扩到延时项（0 对它们是合法语义）。
API-CHANGE: `timeout: Infinity/NaN/负值` 与 `batchInterval: Infinity/NaN` 的效果统一为「不设超时 / 无延迟」，
不再产生被宿主夹出来的立即超时。

### R5-261  verdict=FIXED  抽出 buildFailureResult，两条失败分支共用同一份累计 stats

`SnapshotManager.ts:571-605` 新增私有 `buildFailureResult`，同步 catch（`:199`）与异步 catch（`:552`）各调一次，
三处重复的 metadata/stats 字面量归一；异步那份「换一个全零新对象」改为交出共享 `stats`
（引擎在抛出前已累加 `cloneOperations` / `circularReferences` / `maxDepthHits`），`metadata` 的规模项仍归零，
注释写明理由（失败结果的 `data` 不可信，按它算出的 size/nodeCount/maxDepth 同样不可信）。
`duration` 由函数内统一 `Date.now() - timestamp`，异步不再出现「失败结果 duration 恒为 0」。
回归（R5-261 describe 2 例）：同一份带抛错 getter 的输入，异步中止路径 `stats.cloneOperations > 0`（修复前 0）、
`size/nodeCount === 0`；同步中止路径 `errors` 恰为 `['cloneError','unknown']` 且 `cloneOperations > 0`。
API-CHANGE: 失败结果的 `stats` 交出实际累计值（异步此前恒为全零），两条路径同口径。

### R5-262  verdict=FIXED  Map 键失败的 errors 路径带上键身份，与同步侧同口径

`clone-async.ts:118` 与 `clone.ts:393`（报告点名「sync 侧要 lockstep 同改」）都写成
`` `${context.path}.key[${String(k)}]` ``：`String(k)` 对 Symbol 安全（模板插值 Symbol 会抛 `ToString(Symbol)`，
第四轮 #284 在值路径上已踩过），且与值路径 `` `${path}[${String(k)}]` `` 只差 `.key` 段，键失败与值失败可区分。
回归（R5-262 describe 2 例）：两个 `toString()` 分别为 `'A'`/`'B'` 的对象键在 customCloner 上抛错，
同步与异步的 `errors.map(e => e.path)` 都严格等于 `['root.m.key[A]', 'root.m.key[B]']`（修复前两条同为 `root.m.key`）。
已知残余（与值路径同源、非本条范围）：无自定义 `toString` 的普通对象键都会落成 `[object Object]`，
仍不可区分；要再收一层就得给 Map 迭代加序号，会连带改值路径格式（#284 定稿形态），故未动。

---

## NEEDS-MAIN（本分片越界、需要主会话落刀）

1. `tests/unit/extras/ocr-medium-round4-p3.test.ts:157`
   `expect(context).toMatchObject({ path: 'root.boom', recoverable: true })`
   → 去掉 `recoverable: true`（R5-239 已删除该字段；现状 `toMatchObject` 失败，输出
   `- "recoverable": true`）。
2. `tests/unit/extras/ocr-medium-round4-p4.test.ts:96`
   `expect(result.errors).toHaveLength(0)` → `expect(result.errors.map((e) => e.type)).toEqual(['circular'])`
   （R5-254：circular 现在入 errors；`success: true` 与占位字符串两条断言不动，#304 语义未变）。
3. `tests/unit/extras/ocr-medium-round4-p4.test.ts:97,106,264,280,282,329`
   `result.data.xxx` / `Object.values(result.data)` / `Object.keys(result.data)`
   → 补判空（该文件在 `tests/**/*.ts` 覆盖范围内，`@typescript-eslint/no-non-null-assertion` 为 `off`，
   用 `result.data!` 即可；`npx tsc -p tsconfig.tests.json --noEmit` 现报 6 条 `TS18048/TS2769`，全在这 6 行）。
4. `src/extras/snapshot/index.ts:6,12`：模块头把同步引擎写成「迭代式深度克隆」，与 R5-257 后的事实
   （递归 + `HARD_MAX_CLONE_DEPTH` 栈安全硬上限，超深走 `clone-async`）不符，建议改为
   「递归深度克隆（深度受 maxDepth 与栈安全硬上限界定）」并同步「能力概览」那条。
