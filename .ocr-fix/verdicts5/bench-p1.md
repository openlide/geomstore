# bench-p1 判定记录（第五轮 / ocrreview.md，25 条）

Owned files：`packages/benchmark/{package.json,src/config.ts,src/constants.ts,src/helpers.ts,src/index.ts,src/reporter.ts,src/runner.ts}`；新建 `packages/benchmark/src/smoke.ts`。

计数：fixed 25 / fp 0 / reject 0；另记 NEEDS-MAIN 4 处（见文末）。

验证手段与结果：
- `npx tsc -p packages/benchmark/tsconfig.json --noEmit` → 0 诊断（含并行 bench-p1/p2 全量文件）。
- `node packages/benchmark/dist/smoke.js`（新建冒烟入口，`npm run bench` = `tsc && node dist/smoke.js`）→ 42 条断言全 ok、`FAIL` 0 条、`=== 冒烟结果：全部通过 ===`、退出码 0。断言覆盖本分片 25 条里可执行的 19 条回归点。
- 若干前提用 `node --input-type=module -e` 单独量过：`Math.min(...arr)` 在 10 万实参通过、15 万起 `RangeError: Maximum call stack size exceeded`；`5 <= NaN` / `5 >= NaN` 均为 `false`；`Math.floor(150/100)=1 → 150 个样本`、`Math.ceil(150/100)=2 → 75 个样本`；`Math.floor((1000/0)*0.5) = Infinity`。
- 改后常量表实测（编译产物直读）：`TIME_THRESHOLDS = {SET_STATE_AVG .1, SET_STATE_P99 1, PATCH_AVG .5, PATCH_P99 2, REPLACE_STATE_AVG 1, REPLACE_STATE_P99 3, DISPATCH_AVG .5, GETTER_AVG .05, SUBSCRIBE_AVG .1, SUBSCRIBE_P99 .5, CACHE_AVG .01}`、`THROUGHPUT_THRESHOLDS = {SET_STATE_MIN 5000, DISPATCH_MIN 1000, GETTER_MIN 10000, SUBSCRIBE_MIN 5000, CACHE_MIN 50000}`；`relaxedBenchmarkConfig.scenarios[].warmupIterations` 由 `1000,1000,500,100,200,500,10` 变 `100,100,100,100,100,100,10`。

行为变更（公开面/契约面，共 6 处，都在下面条目里逐条对应）：
1. `package.json` 删掉全部发布元数据与 `peerDependencies`（本包按内部工具定位，不发布）。
2. `TIME_THRESHOLDS` 的 `DISPATCH_AVG 0.2→0.5`、`REPLACE_STATE_AVG 0.3→1.0`、`REPLACE_STATE_P99 1→3`，连带 `THROUGHPUT_THRESHOLDS.DISPATCH_MIN 2500→1000`（改为从配置推导）。
3. `relaxedBenchmarkConfig` 额外下调逐场景 `warmupIterations`。
4. `ResultBuilder.createResult` 在 `passedCheck` 抛错时不再上抛，而是产出 `passed:false` + `errors` 一条；返回非 `true` 一律按不通过。
5. `mergeResults` 的 `executionTime.avg` 改为「总耗时 ÷ 总迭代数」，`peakInstantRate` 改为参与方的最大值（原先恒 0）。
6. `runner`：`quick-` 场景吞吐门限同步放宽 5 倍；`stateKeys` 非正整数改为抛错；`cacheConfig.capacity` 非整数改为抛错（原先只拦非有限/小于 1）。

### R5-006  verdict=FIXED  本包不发，删发布元数据、保留 `private: true`。
- 三条证据定位「发还是不发」：`pnpm-workspace.yaml:2` 白纸黑字写「当前仅根包纳入锁文件管理；packages/benchmark 为实验性子包，暂未接入」（且该文件根本没有 `packages:` 键，pnpm 不会把它当 workspace 成员）；`grep -c benchmark pnpm-lock.yaml` → `0`（从未被安装/链接过）；`.github/workflows` 下只有 `ci.yml`，全流程无 publish/release 步骤，根 `prepublishOnly` 只构建根包。全仓 `grep -rn "geomstore-benchmark"` 除自身 package.json 外 0 命中，没人按包名解析它。
- 结论：`npm/pnpm publish` 会被 `private` 硬拦，而 `main/types/exports/files/repository/author/license/keywords` 全是为一次不会发生的发布写的死配置 → 按报告第二方案删干净，不新增 `publishConfig`（那等于偷偷改口径为「要发布」）。
- 保留 `name/version/private/description/type/scripts/devDependencies/engines`；`description` 里显式写「仓库内部工具，不发布到 registry」，让下一个读 manifest 的人不必再猜。

### R5-007  verdict=FIXED  新增可运行冒烟入口 `src/smoke.ts` + `bench` 脚本，runAll 与三种报告格式都真跑。
- 报告结论成立：改前 `scripts` 只有 `build`/`typecheck`，本包被编译但从未被执行过（`grep -rn "geomstore-benchmark" .` 除自身外 0 命中，根 CI 只跑根包 jest）。
- `packages/benchmark/src/smoke.ts` 用一份内存实现的最小 `BenchmarkStore`（含 FIFO 缓存与 hits/misses/evictions 统计）跑 `BenchmarkRunner.runAll()` → `BenchmarkReporter.generate('markdown'|'html'|'json')`，42 条断言覆盖：报告结构自洽、`avg×opsPerSecond=1000` 的一致性、缓存计数器与派生比率自洽、注入用场景名（`<script>alert("inj")</script>|#注入`）在两种格式里被转义、mergeConfig 副本语义、relaxed 档预热、非法 `stateKeys` 被拒、容量单点推导、`mergeResults` 加权/峰值/20 万条不爆栈、`passedCheck` 抛错降级、`getSampleInterval` 上限、适配器 `getCacheStats` 懒解析。`npm run bench` = `tsc && node dist/smoke.js`，失败时 exit code 非 0。
- 实测：`node packages/benchmark/dist/smoke.js` → 42 ok / 0 FAIL / 退出码 0。刻意不断言「场景达标」，门限判定依赖机器速度；5c 那条吞吐回归用墙钟忙等把 ops 钉在 (2000,10000) 区间内，与快慢无关。
- NEEDS-MAIN: `.github/workflows/ci.yml` 增加一步 `npx tsc -p packages/benchmark/tsconfig.json && node packages/benchmark/dist/smoke.js`（该文件归 root-config 分片）；否则冒烟仍只在有人手动跑 `npm run bench` 时生效。

### R5-008  verdict=FIXED  删掉 `peerDependencies`，适配契约就是 `BenchmarkStore`。
- 报告结论成立且可证：`grep -rn "from '@openlide/geomstore" packages/benchmark/src` → 0 命中，包内没有任何一处解析被声明为 peer 的那个包，只依赖自己 `src/types/store.ts` 里的抽象 `BenchmarkStore`；把它写成硬 peer 等于逼消费者装一个永远用不到的包（pnpm 还会 auto-install）。
- 与「改成 `peerDependenciesMeta.optional`」的方案不采纳：可选 peer 仍是一份「消费者该装它」的暗示，而本包的契约明写「可以适配任何状态管理库」，装谁根本不由本包决定——留一个 optional 只是把噪声降级成噪声。
- NEEDS-MAIN: `packages/benchmark/README.md`（不在我的可改文件里）第 9/15/16 行仍教用户 `npm install @geomstore/benchmark geomstore`：两个名字都不存在（真名 `@openlide/geomstore-benchmark`、真包 `@openlide/geomstore`），且本条已定性为不发布，README 的安装段应整段改法。

### R5-009  verdict=FIXED  devDependencies 对齐根包：`@types/node` `24.8.1`、`typescript` `^6.0.0`→`^6.0.3`。
- 报告把两侧写反了（本包是 `^24.0.0`/`^5.0.0`，根包才是 `24.8.1`/`^6.0.3`），但「两个包各一套数」这件事是真的，且后果比报告说的更直接：本包声明 `typescript ^5.0.0`，而仓库实际装的是 `node -e "console.log(require('./node_modules/typescript/package.json').version)"` → `6.0.3`，`npx tsc --version` → `Version 6.0.3`；由于 pnpm 不认这个子包（见 R5-006），它永远不会有自己的 TS 5，那份 `^5.0.0` 是一行了言不对版的假声明。
- 取「显式 pin 同一版本」：`@types/node` 抄根包的精确 `24.8.1`（与 `engines: >=22` 的错配是根包同款既有事实，本条只解决两包不一致），`typescript` 抄 `^6.0.3`。改后 `npx tsc -p packages/benchmark/tsconfig.json --noEmit` 仍 0 诊断。
- 顺带说明为何 `engines` 与 `@types/node@24` 并存不是本条要修的点：包内实际用到的只有 `os.cpus/totalmem`、`process.memoryUsage/version/platform`、`v8.getHeapStatistics`、`performance.now`，全部在 Node 22 存在（Node 22 基线由根 CI matrix `[22, 24]` 守住），本包也没有发布面可谈「消费者的 22」。

### R5-050  verdict=FIXED  scenarios 连元素带 `cacheConfig` 一起复制。
- 报告结论成立：改前 `scenarios: [...(custom?.scenarios ?? base.scenarios)]` 只复制数组，元素仍是 `defaultBenchmarkConfig.scenarios[i]` 的活引用，与函数头注释「scenarios 数组都是副本」直接矛盾；`config.scenarios[0].iterations = 5` 会永久改掉模块级默认配置。
- 采纳报告方案：`.map((s) => ({ ...s, cacheConfig: s.cacheConfig ? { ...s.cacheConfig } : s.cacheConfig }))`，`BenchmarkScenario` 里唯一的嵌套对象就是 `cacheConfig`（其余成员全是原始值），故不需要更深的递归。
- 实测（编译产物直读）：`mergeConfig(default).scenarios === default.scenarios` → `false`、`[0] === [0]` → `false`、`relaxed...scenarios.find(s=>s.cacheConfig).cacheConfig === default...` → `false`；冒烟里「mergeConfig 返回的 scenario 元素是副本」「嵌套 cacheConfig 也是副本」两条改后为 ok。

### R5-051  verdict=FIXED  datasets 改成按 `base.datasets` 实际键集动态合并。
- 报告结论成立：改前四档手抄两遍（此处 + 默认配置），`DatasetSize` 增删档位时这里只会以「BenchmarkConfig 缺少属性 xlarge」间接报错；本文件对 `thresholds` 已经是「按类型键集驱动」的写法（`relaxThresholds` 遍历 `Object.keys(base)`），同一文件两套口径。
- 取报告方案：`Object.fromEntries((Object.keys(base.datasets) as DatasetSize[]).map(size => [size, { ...base.datasets[size], ...custom?.datasets?.[size] }])) as BenchmarkConfig['datasets']`；`DatasetSize` 本来就在首行 import，逐档位深合并语义（整档覆盖会丢 `actions/getters/...`）保持不变。
- 实测：冒烟「mergeConfig 逐档位键集完整（DatasetSize 四档齐全）」ok（比对 `large,medium,small,xlarge`），副本语义由「档位是副本」那条守着。

### R5-052  verdict=FIXED  `relaxThresholds` 补运行时守卫，缺倍数直接抛错。
- 报告对后果的量化成立：`node -e "console.log(5 <= NaN, 5 >= NaN)"` → `false false`，NaN 门限等于「该档永不达标」且不报错。
- 守卫按报告写法落地并多拦一档非有限值：`typeof factor !== 'number' || !Number.isFinite(factor)` → `throw new Error('relaxThresholds: 缺少键 "x" 的放宽倍数（得到 undefined）')`，错误文案带上键名与实际取值。
- 诚实标注可达性：`relaxThresholds` 是模块私有函数、三个调用点的 `factors` 都是 `Record<keyof ...>` 字面量表，类型化调用路径下缺键在编译期就被拦（这正是它当初的设计意图），所以这条是防「绕过字面量构造/未类型化 JS 传入的 base 多出键」的纵深防御，不是当下可复现的缺陷——报告自己也写的是「未来绕过字面量构造的调用」。

### R5-053  verdict=FIXED  宽松档同时下调逐场景 `warmupIterations`（不是只补注释）。
- 报告结论成立：`general.warmupIterations` 只管整轮开始前那次统一预热，场景级 `warmupIterations` 由 `runner.ts` 的 `if (scenario.warmup && scenario.warmupIterations) this.runWarmupIterations(...)` 独立驱动、不继承 general（`types/index.ts` 的 `BenchmarkScenario` 注释同一口径），所以改前「宽松档」在慢速 CI 上仍按 `1000,1000,500,100,200,500,10` 跑预热，与注释「用于开发环境或 CI」的加速意图相反。
- 取第二方案（同时下调），因为「只写注释」等于把一个真实的行为缺口留在文档里：新增 `RELAXED_WARMUP_ITERATIONS = 100`，general 与逐场景 `Math.min(原值, 100)` 共用同一个数，注释写明两处计数互不继承、所以必须两处一起夹。
- 实测：`relaxedBenchmarkConfig.scenarios[].warmupIterations` → `100,100,100,100,100,100,10`（第 7 条本来就 <100，按 `min` 保持不动，避免把「上调」当成放宽）；冒烟「relaxed 档把场景级预热一并夹到上限」ok。

### R5-043  verdict=FIXED  `getSampleInterval` 取整改 `Math.ceil`。
- 报告的算术成立且实测：`iterations=150` 时 `Math.floor(150/100)=1` → 样本数 `ceil(150/1)=150 > MAX_SAMPLES(100)`；改 `ceil` 后 interval=2 → 75 ≤ 100。`Math.ceil` 保证 `iterations/interval <= MAX_MEMORY_SAMPLES` 恒成立（含 `Math.max(1, …)` 兜底的小 iterations 情形）。
- 补一条报告没提、但决定该改法不是过度设计的实情：包内没有任何读取方用 `SAMPLING_CONFIG`（`grep -rn "SAMPLING_CONFIG\|getSampleInterval\|MAX_SAMPLES" packages/benchmark/src` 只命中 constants.ts 定义与 index.ts 再导出），runner 是每轮无条件采一次样，所以「defeating MAX_MEMORY_SAMPLES」在包内不发生；本条改的是对外导出的这份参考实现的自洽性，注释里同时写明包内无读取方、给自行抽样者用。
- 实测：冒烟「抽样间隔保证样本数不超过 MAX_SAMPLES」ok（`[1,99,150,199,1000,10001]` 全过，150 → interval 2）。

### R5-044  verdict=FIXED  `deriveThroughputMin` 加正有限值守卫。
- 报告结论成立且实测：`Math.floor((1000/0)*0.5)` → `Infinity`，而这是 `THROUGHPUT_THRESHOLDS` 公开表里的一个成员（静默变 `Infinity` = 该档永不可达）；负 `avgMs` 给负的 MIN、`NaN` 给 `NaN`，三种都不会抛。
- 守卫比报告原方案多覆盖 NaN/Infinity：`if (!(avgMs > 0) || !Number.isFinite(avgMs)) throw new RangeError(...)`，`!(avgMs > 0)` 一次夹住 0、负数与 NaN，`Number.isFinite` 再夹 `Infinity`（原方案漏这条：`Infinity` 作门限时派生出 0，同样是假门限）。
- 现状检查：三个 AVG 输入由配置给出（`0.1/0.5/1/0.5/0.05/0.1` + `CACHE_AVG 0.01`），改后包加载即跑过这段（冒烟里 `THROUGHPUT_THRESHOLDS` 有值、`TIME_THRESHOLDS` 断言 ok），未触发抛错。

### R5-045  verdict=FIXED  取报告第一方案：`TIME_THRESHOLDS` 的 AVG 档改为从 `defaultBenchmarkConfig.thresholds.operationTime` 推导，P99 写成 AVG 的倍数。
- 报告点名的两处脱钩成立（改前实测常量表 vs 配置表）：`DISPATCH_AVG 0.2` 对 `operationTime.dispatch 0.5`、`REPLACE_STATE_AVG 0.3` 对 `operationTime.$replaceState 1.0`；其余四档（setState/$patch/getter/subscribe）当时靠注释与手抄维持一致，`SUBSCRIBE_AVG` 那段注释甚至专门写「两处必须同一数值」——同一件事需要注释来维持，就是第二事实源的证据。
- 改法：新增模块内 `const OPERATION_TIME = defaultBenchmarkConfig.thresholds.operationTime`，六档 AVG 全部取配置值；`SET_STATE_P99 = AVG×10`、`PATCH_P99 = AVG×4`、`REPLACE_STATE_P99 = AVG×3`、`SUBSCRIBE_P99 = AVG×5`（倍数就是各条注释既有口径，写成乘积后配置一改 P99 自动跟走，也不会出现 P99 低于 AVG 的矛盾数）。`CACHE_AVG` 保留字面量并在注释里说明配置侧没有这一档。**行为变更**：`DISPATCH_AVG 0.2→0.5`、`REPLACE_STATE_AVG 0.3→1.0`、`REPLACE_STATE_P99 1→3`，连带由它推导的 `THROUGHPUT_THRESHOLDS.DISPATCH_MIN 2500→1000`（实测值见文件头）。
- 未一并改的两张表与理由（这是报告给的另一个许可「document why they intentionally differ」）：`MEMORY_THRESHOLDS` 与 `config.thresholds.memory` **不是同一个量**——配置里的 `perStore/perStateItem/perSubscriber` 被 runner 拿去比 `results.memory.delta`（场景峰值增量，默认 10KB 量级），本表是「单个实体常驻多少字节」的绝对容量（10MB/1KB/512B），把两者同源会得到「10KB 常驻不下一个 xlarge Store」的荒谬门限，故只在注释里把两个口径钉死；`CACHE_THRESHOLDS` 是命中率的「及格/优秀」评带，runner 判定走 `thresholds.cacheHitRate`、缓存类场景另有 `CACHE_SCENARIO_MIN_HIT_RATE`，三件事各管一处，注释同样写明。
- 循环依赖检查：`config.ts` 只 import `./types/index.js`，故 `constants.ts → config.js` 单向不成环；改后 `npx tsc -p packages/benchmark/tsconfig.json --noEmit` 0 诊断，冒烟「TIME_THRESHOLDS 不再是配置的第二事实源」ok（含 `SET_STATE_P99 > SET_STATE_AVG`）。

### R5-046  verdict=FIXED  `mergeTimeStats` 的 avg 改为 `total / totalIterations`（与同一份结果里的吞吐同源）。
- 报告结论成立：`throughput` 由 `totalIterations / (total/1000)` 反推，隐含的人均耗时是 `total/totalIterations`，而改前 avg 取各轮 avg 的算术平均；`iterations` 不等（合并的常态）时两个数必然背离。
- 选「`total/totalIterations`」而不是「按各轮 iterations 加权 Σ(avgᵢ·itᵢ)/Σitᵢ」：runner 产出的每轮本来就满足 `avgᵢ = totalᵢ/itᵢ`，两式等价，但前者把一致性写成了恒等式——即便 harness 塞进 `avg` 与 `total/iterations` 自相矛盾的输入，`executionTime.avg` 与 `throughput` 也不会各说各话。`median/p95/p99/stdDev` 继续按各轮 avg 统计（那三项描述的是轮间离散度，语义不变，注释写明）。
- 夹取：`total > 0 && totalIterations > 0` 才做除法，否则 0——`createErrorResult(scenario, 0, e)` 参与合并时 `0/0 = NaN` 会把整份合并报告打成 NaN，与 `calculateThroughput` 的兜底同口径。
- 实测：merge `[A:10000 it/1000 ms, B:10 it/100 ms]` → avg `0.10989010989010989` = `1100/10010`（改前的算术平均是 `5.05`），且 `avg × opsPerSecond = 1000` 精确成立（冒烟两条断言 ok）。

### R5-047  verdict=FIXED  合并结果保留 `peakInstantRate`（取参与方最大值），不再恒 0。
- 报告结论成立：`mergeResults` 走 `this.calculateThroughput(totalIterations, mergedTimeStats)`，而该私有函数的 `peakInstantRate` 是硬编码 0；runner 产的输入带 `calculatePeakInstantRate` 的真实值，合并一次就丢。
- 取「聚合输入峰值」方案：`results.reduce((m, r) => Math.max(m, r.results.throughput.peakInstantRate), 0)`，理由写进注释——峰值不是可累加量（合并后的平均速率另由 `totalIterations/total` 给出），跨轮次取 max 是「观测到的最好瞬时速率」，语义与 runner 单场景里 1ms 滑窗取最大是同一件事。`calculateThroughput` 增加第三参 `peakInstantRate = 0` 并在注释里说清谁能给出这个量。
- 实测：merge 两个 `peakInstantRate` 为 1234/9999 的输入 → `9999`（冒烟 ok），改前为 0。

### R5-048  verdict=FIXED  helpers.ts 三处 spread 全改单次遍历。
- 报告结论成立且实测边界：`Math.min(...arr)` 在本机 Node 22.22 下 10 万实参通过、**15 万起 `RangeError: Maximum call stack size exceeded`**（逐点量过），而 `mergeResults` 的输入条数由调用方分桶策略决定、包内无上限。
- 改点不止报告列的两行：`mergeTimeStats` 的 `min`/`max`（→ `reduce` + `Number.POSITIVE_INFINITY`/`NEGATIVE_INFINITY` 初值）与 `mergeMemoryStats` 的 `peak`（同一函数里的同类 spread，报告只举了前两处；`stats.length === 0` 已由上面的早退兜住，夹取初值不会漏出 ±Inf）。
- 实测：`ResultBuilder.mergeResults('many', 20 万条)` 不抛（冒烟「mergeResults 在 20 万条输入下不爆栈」ok）；10 万条不能作为证据，因为它在旧写法下也不抛，所以条数按实测边界提到 20 万并在注释里写下这两个数字。
- NEEDS-MAIN: `src/extras/action/ActionHistory.ts:106` 的 `allResults.push(...results)`（报告在同一条里点名的另一处）不在本分片可改文件内，`grep -rn "push(\.\.\." src/` 另命中 `src/core/compose/composeStore.ts:230/805`、`src/core/utils/equality.ts:255`；`src/core/performance/metrics.ts:143` 已有「逐条写入而非 push(...list)」的既有口径可照抄。

### R5-049  verdict=FIXED  `passedCheck` 抛错降级为不通过 + 记 errors，返回值按严格布尔取。
- 报告结论成立：改前 `passed = passedCheck?.() ?? true`，`passedCheck` 抛错会直接透出（与同类里 `createErrorResult` 的降级口径不一致），且 `??` 只兜 `null/undefined`，`0`/`''`/漏写 return 的 `undefined` 会被原样塞进 `boolean` 字段（`undefined ?? true` 虽兜住了，但 `''`、`0` 兜不住）。
- 改法：`try { passed = passedCheck() === true } catch { passed = false; checkFailure = message }`，异常文案并进 `errors`（`passedCheck 执行失败：<msg>`，保留调用方原有的 errors 条目）。`=== true` 而非 `Boolean(...)`：签名写的是 `() => boolean`，返回 `undefined`/`''` 是违约，让违约落在「通过」一侧等于把坏数据报成绿灯；未给回调仍是「无判定可做」→ 保持默认通过。
- 实测：抛错版 → `passed:false` 且 errors 含「检查器炸了」；`() => undefined` 版 → `passed:false`；不给 `passedCheck` → `passed:true`（三条冒烟断言 ok）。

### R5-054  verdict=FIXED  `getCacheStats` 改用 getter 每次访问现解析，删掉构造期解构。
- 报告结论成立，且改前代码自己就把两个分支的理由写矛盾了：`getCached` 用箭头函数「每次调用现取」，注释是「库常在 enableCache()/懒初始化之后才挂上它，构造期探测会把当时没有固化成永久 undefined」；同一段注释下一句却给 `getCacheStats` 相反处理并说「相反地保持构造期判定」——同一个懒挂模式，两个成员两套时序，前一条理由同样成立时后一条就是缺陷。后果如报告所述：晚挂上统计的 store 被 `runner.ts` 的 `store.getCacheStats ? buildCacheResult(...) : emptyCacheResult()` 静默报成「缓存未启用」，出一份错的缓存报告而不是报错。
- 采纳报告方案并保住三态信号：删 `const { getCacheStats } = store`（否则 `noUnusedLocals` 当场报），成员改成 `get getCacheStats(): (() => CacheStats) | undefined { const fn = store.getCacheStats; return fn ? () => fn.call(store) : undefined }`——缺席时返回 `undefined`（runner 照旧报未启用），存在时 `fn.call(store)` 保持 `this` 绑定，两种情形都在**访问时**解析。
- 实测：冒烟两条 ok——无 `getCacheStats` 的裸 store 适配后 `adapted.getCacheStats === undefined`；构造之后再给 `bare.getCacheStats = () => ({...hits:3...})`，`adapted.getCacheStats?.().hits` → `3`（改前恒 undefined）。

### R5-040  verdict=FIXED  新增 `escapeMarkdown`，markdown 侧全部数据字段过一遍。
- 报告结论成立：改前 `### ${status} ${result.scenario}`、`- ${w}`、`- ${e}`、`- ${rec}`、表格行 `| ${row.label} | ${row.value} |` 与 metadata 四行全是裸插值，而 `escapeHtml` 只为 HTML 存在；场景名/错误文本确实可能来自运行时（错误消息常带路径与环境值）。
- 转义口径写在函数注释里并说明为什么够用：`\\` 先转（避免 `\|` 被二次解释）、`& < >` 转义（掐掉允许内联 HTML 的渲染器里的 `<script>`/`<img onerror>` 执行面）、`|` 转义（表格结构）、`[\r\n]+` 折叠成空格（列表项/标题/表格行的块级语法都要求行首，折叠换行即堵死「一条 warning 变成多条」与「在下一行起 `#`/`- `」两类破坏）。刻意不转 `* _ \``：只影响观感，转了反而让建议文案难读。
- 覆盖面：metadata 四行、概览表 label+value、`formatResultMarkdown` 的场景名、metric 行、warnings、errors、recommendations（HTML 侧的 recommendations 改前就已转义，未动）。
- 实测：带 `<script>alert("inj")</script>|#注入` 场景名跑完整链路 → 「HTML 不含未转义的 script 标签」「Markdown 不含未转义的 script 标签」「Markdown 里的表格竖线被转义」三条 ok（改前 markdown 里就是裸 `<script>`）。

### R5-041  verdict=FIXED  HTML 里 label 与 value 同权转义。
- 报告结论成立：`toMetricRows`/`toSummaryRows` 的 label 与 value 都是 `ReportRow` 的同类字段，改前 HTML 侧只转 value（`<span class="label">${row.label}</span>`、`<td>${row.label}</td>`），两处不对称本身就是下一个注入点的入口（未来任何 label 由数据派生就静默中招）。
- 一并补第二处报告没点名的同类不对称：概览表的 `<td>${row.label}</td>` 同样裸插值，与 metric 卡片的 span 一起改成 `escapeHtml(row.label)`。
- 实测：42 条冒烟断言全绿；`toMetricRows`/`toSummaryRows` 的现有 label 全为静态中文串，转义后输出逐字节不变（无「&」「<」等），故本条不产生任何可见输出变化。

### R5-042  verdict=FIXED  HTML 头部补版本号，与 Markdown 对齐。
- 报告结论成立：`generateMarkdown` 有 `**版本**: ${report.metadata.version}`，HTML 那行只有生成时间/Node.js/平台；`metadata.version` 是 `BenchmarkReport` 的必填成员（`runner.generateReport()` 恒赋 `'1.0.0'`），不是可缺字段。
- 按报告方案插入 `| 版本: ${escapeHtml(report.metadata.version)}`，位置放在生成时间之后、Node.js 之前，与 markdown 的行序一致；新字段同样走 `escapeHtml`，不给后面的字段留未转义路径。
- 实测：冒烟「HTML 与 Markdown 都带版本号」ok。

### R5-063  verdict=FIXED  `cpu.model` 取 `os.cpus()[0]?.model || 'unknown'`。
- 报告结论成立：改前该字段填的是 `process.arch`（本机 `x64`），字段名 `model` 装的是架构，跨机器对比报告时这一档毫无信息量；同一对象里 `speed: os.cpus()[0]?.speed || 0` 已经证明数据源本该是 `os.cpus()`。
- 取报告方案并保留空数组兜底：容器/精简环境下 `os.cpus()` 可能为 `[]`（Optional Chaining 给 `undefined`），`|| 'unknown'` 保证 `metadata.cpu.model: string` 的必填类型成立，不会打出 `undefined`。
- 实测：`metadata.cpu.model` → `Intel(R) Xeon(R) W-10885M CPU @ 2.40GHz`，断言同时要求它 `!== process.arch` 且 `=== os.cpus()[0].model`（冒烟两条 ok），`cores` 一并核对。

### R5-064  verdict=FIXED  `stateKeys` 补整数校验，与 iterations 同口径。
- 报告结论成立，退化链实测复现：`generateTestState(NaN)`/`(2.5)` 只按 `i < size` 循环（NaN 一次都不进 → 空状态），随后每轮 `pickKey([], i)` 返回 `undefined`、四个操作槽全部跳过，整轮测量只剩外层 `getState()` → `avg ≈ 0`、`opsPerSecond` 虚高、`memory.delta ≈ 采样噪声`，非缓存场景三项门限都能过 → 一份假绿灯报告。
- 改法按报告方案：`!Number.isInteger(datasetConfig.stateKeys) || datasetConfig.stateKeys <= 0`，并把非法值打进错误消息（`stateKeys 须为正整数，得到 2.5`），使 errors 里的线索能直接指向被改坏的那一档；同一段的注释同步补上「非整数/NaN 会让整轮变 no-op」的因果，改掉报告点名的「注释声称按 dataset 同一口径、代码却没有 isInteger」的失配。
- 实测：`{ datasets: { small: { stateKeys: 2.5 } } }` + 一个 quick 场景 → `runAll()` 不抛、该场景 `passed:false` 且 `errors[0]` 是新消息（冒烟 ok）。注意 `Infinity` 也被 `Number.isInteger` 挡下（旧的 `<= 0` 挡不住它）。

### R5-065  verdict=FIXED  quick 档吞吐门限同步吃 `modeMultiplier`。
- 报告的量化成立：改前耗时门限对 `quick-small` 给 `0.1×1×5×10 = 5 ms/op`，吞吐门限却是 `100000/1×0.1 = 10000 ops/s`（= 0.1 ms/op），相差 50 倍；非缓存场景 `Math.ceil(3×0.67) === 3` 要求三项全过，于是一次刻意放宽的 CI 冒烟可以只在吞吐上假失败。文件里 `QUICK_MODE_HEADROOM` 的注释甚至明写「吞吐门限不套用」——方向不对，一并改掉而不是留注释。
- 按报告方案：`(thresholds.throughput.setState / (sizeMultiplier * modeMultiplier)) * THROUGHPUT_RELAXATION`（quick-small → 2000 ops/s = 0.5 ms/op），并把未达标建议文案补上门限来源（`档位 ÷N ÷ quick 模式 ×5`），与耗时那条同一写法；`THROUGHPUT_RELAXATION` 的注释口径不动（它只讲档位之外的一个数量级）。
- 实测：造一个「只慢在吞吐档」的 store——单次写忙等 1ms、四槽轮转 → `avg 0.28ms`、`ops 2979~3567`（两次运行，墙钟忙等故与机器快慢无关）。改后吞吐不再被判为未达标项；按旧门限 10000 它必然进 recommendations。两条冒烟断言（区间校验 + 无「吞吐量」建议）ok，且专门断言的是「吞吐有没有被判未达标」而不是 `result.passed`——后者还受内存档的首轮分配噪声影响（实测 392KB~468KB > 48.83KB 门限），用它会把这条回归测成噪声。

### R5-066  verdict=FIXED  读那一轮在无缓存实现上退化为真实状态读，不再空转。
- 报告结论成立：`BenchmarkStore.getCached` 是可选成员（`types/store.ts` 明写「无缓存的实现可省略」），改前两处 `store.getCached?.(key)` 对省略它的 store 什么都不做，1/4 的迭代只剩外层 `getState()` 的成本 → 平均耗时人为压低、吞吐虚高。
- 取报告第一方案（fallback 真实读，而非「显式跳过」——跳过会让非缓存 store 的测量口径变成「3 个操作 + 1 个空槽」，与缓存 store 的数字彻底不可比），并抽成 `readKey(store, state, key)` 供两处共用：缓存场景分支与四槽 switch 的 `case 2`（报告只点名 357-360 的 `case 2`，但同一缺陷在缓存分支里一模一样）。独立成函数也是为了把 `state[key]` 放在被消费的位置（`@typescript-eslint/no-unused-expressions` 对 `**/*.ts` 是 warn，虽然本包当前不在 `lint` 脚本范围内）。
- 实测：把 store 的 `getCached`/`getCacheStats` 删掉跑 80 轮 → `cache.enabled === false`（按未启用上报，见 R5-054 的三态契约）、`errors` 为空、`opsPerSecond = 413437~488998`（读轮确实在做事）；两条冒烟断言 ok。诚实标注残留：经 `createBenchmarkAdapter` 包装的无缓存 store 恒有 `getCached`（箭头函数）且返回 `undefined`，这条兜不住，那种情形只能由 `getCacheStats` 缺席上报「未启用」——契约上已由 R5-054 修好。

### R5-067  verdict=FIXED  删掉 runner.ts 的本地 `declare const process`。
- 报告结论成立：本包 `tsconfig.json` 的 `types: ["node"]` 已经给出真全局 `process`，那行窄声明把它遮成只有 `version/platform/arch` 三个成员；`utils.ts` 用 `process.memoryUsage()`（自带同类声明，属另一分片）、`v8.getHeapStatistics()`（顶层 import）都不需要额外声明，证明 Node 类型可用。
- 只删声明、不补任何东西：`process.version`/`process.platform`（`generateReport` 用到的两个）改由 @types/node 24.8.1 提供，`npx tsc -p packages/benchmark/tsconfig.json --noEmit` → 0 诊断，未来在本文件用 `process.env`/`process.hrtime`/`process.memoryUsage` 不再无端编译失败。
- 残留同类问题记给对方：`packages/benchmark/src/utils.ts:6` 还有一份同样窄化的 `declare const process`（`grep -n "declare const process" packages/benchmark/src/utils.ts` → `6`；该文件归 bench-p2，本轮不越权改）。

### R5-068  verdict=FIXED  缓存容量单点推导并随 store 一起回传，删掉测量轮里的第二份默认值 50。
- 报告结论成立且可算：`createTestStore` 用 `Math.max(1, Math.floor(stateKeys/2))`（`stateKeys=10` → 5）建 store，测量轮却 `const { capacity = 50, keySpaceMultiplier = 1 } = scenario.cacheConfig` 另一套默认 → `keySpaceSize = min(floor(50×1), 10) = 10`；未显式配 capacity 的小/中档 dataset 下两者背离，测出来的命中率/淘汰行为对应的不是被配置的那个缓存（`cache-efficiency` 那类显式给 capacity 的场景不受影响，因为两边都取到同一个显式值）。
- 取报告第一方案（在 `createTestStore` 里算一次、传进迭代），不采用「再抽一个共享默认值函数」：`createTestStore` 现在返回 `{ store, cacheCapacity }`，`runScenario` 解构后把 `cacheCapacity` 作为参数交给 `runBenchmarkIteration`，测量轮的解构里**不再有** capacity 这一项（`min(floor(cacheCapacity × keySpaceMultiplier), allKeysCount)`），同一个参数在类型层只剩一个来源。`cacheKeys` 的 `slice(0, Math.floor(stateKeys/2))` 一并改用 `cacheCapacity`（未显式配置时二者本就同式，写开是第二次抄同一条公式）。
- 顺带在同一条推导上补一项：显式 `capacity` 的合法性检查由 `Number.isFinite` 改 `Number.isInteger`（`capacity: 2.5` 原样下发给 store 属未定义行为，且与本 runner 其余计数入参同一取向）。**行为变更**。
- 实测：`stateKeys=8`、`cacheConfig: { keySpaceMultiplier: 1, readWriteRatio: 0.5 }`、150 轮 → store 实收容量 `4`，测量轮摸过的键集大小 `touched=4`（旧写法是 `min(50,8)=8` 全键集）；冒烟三条断言（探针唯一性 + 容量 + 键空间）ok。自查记录：第一版探针取 `probes[本轮起始下标]`，实际拿到的是 `runAll` 开头统一预热建的无缓存 store（`capacity=undefined`、`touched=1`），当时那句 `capacity === undefined || …` 于是**假绿**；已改为该场景显式 `enableWarmup: false`、断言「本轮只新增 1 个 store」再取最后一个探针，才量到 `capacity=4 / touched=4`。

---

## NEEDS-MAIN 汇总（4 处，均不在本分片可改文件内）

1. `.github/workflows/ci.yml`：加一步跑本包冒烟 —— `npx tsc -p packages/benchmark/tsconfig.json && node packages/benchmark/dist/smoke.js`（R5-007 的落地前提；当前 CI 只在根包跑 lint/typecheck/jest/build）。
2. `packages/benchmark/README.md:9,15,16`：安装/引入名 `@geomstore/benchmark`、`geomstore` 两个都不存在（真名 `@openlide/geomstore-benchmark`、真包 `@openlide/geomstore`），且本包 R5-006 已定性为不发布，「npm install」整段需改写为仓库内用法（R5-008 同源）。
3. `src/extras/action/ActionHistory.ts:106`：`allResults.push(...results)` 的 spread 在本轮同一条（R5-048）里点名，属主包文件；同类还有 `src/core/compose/composeStore.ts:230,805`、`src/core/utils/equality.ts:255`，`src/core/performance/metrics.ts:143` 已有可照抄的逐条写入口径。
4. `pnpm-workspace.yaml` / 根 `package.json`：本包只出现在 npm 风格的 `workspaces: ["packages/*"]` 里，`pnpm-workspace.yaml` 无 `packages:` 键（注释也自陈「暂未接入」）、`pnpm-lock.yaml` 对 benchmark 0 命中，因此它声明的 devDependencies 永不被安装、`npx tsc` 只能借到根装的 TS 6.0.3。要么接入 workspace、要么在两处注释里把「借根工具链」写死（R5-009 的对齐只有在接入后才有约束力）。
