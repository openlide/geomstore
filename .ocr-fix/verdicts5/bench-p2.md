# bench-p2 判定记录（第五轮 / ocrreview.md，9 条）

Owned files：`packages/benchmark/src/types/store.ts`、`packages/benchmark/src/utils.ts`。
9 条全部核实为真问题并修复（FP 0 / REJECT 0）。验证手段：`npx tsc -p packages/benchmark/tsconfig.json --noEmit`（exit 0，含并行 bench-p1 的全部文件）、`npx eslint <两个文件>`（0 问题）、`npx tsc -p tsconfig.jest.json --noEmit`（报错里 0 条与 packages/benchmark 相关）、`node --input-type=module -e` + TS 编译器 API 内存程序 / `ts.transpileModule` + data-URL 装载做运行时冒烟（探针不落盘、跑完即删）。
行为变更共 4 处，全部记在末尾汇总里；NEEDS-MAIN 5 条见文末。

### R5-069  verdict=FIXED  约束从 `State` 放开为 `object`，interface 状态类型可用了。
- 改前探针（编译器 API 内存程序，同一 probe 跑 HEAD 版与改后版对照）实测：`BenchmarkStore<CounterState>` / `StoreConfig<CounterState>` / `StoreFactory<CounterState>` 三处各报一条 `TS2344 Index signature for type 'string' is missing in type 'CounterState'`，报告结论成立。
- 六个泛型位一并放开：`StoreAction`/`ActionMap`/`BenchmarkStore`/`StoreConfig`/`StoreFactory` → `S extends object = State`（只放 `BenchmarkStore` 不够——它引用 `ActionMap<S>`，约束不齐会当场 TS2344），`ComposeStoreFn` → `T extends Record<string, object>`；默认值仍是 `State`，包内 `BenchmarkStore<Record<string, unknown>>` 等既有用点零改动。
- 残留并已写进注释：容器本身声明成 `interface BundleIface { a: BenchmarkStore<…> }` 再整体传给 `compose` 仍被拒（TS2345 缺索引签名），这是报告给的形状本身的边界；对象字面量与 `Record<string, …>` 两种传法实测通过。
- 顺带实测出一个我改不到的断点（已列 NEEDS-MAIN #4）：把 interface 状态的 store 传给 `src/index.ts:60` 的 `createBenchmarkAdapter<S extends State>` 仍报 TS2345，同一实参在 `S extends object` 下通过——types 放开后公开入口这一层还会把 interface 挡回来。而 `runner.ts:112/115` 的 `<S extends State>` 工厂参数**不是**断点：`<S extends object>` 的泛型工厂实测可直接赋给它（0 诊断），单态工厂则在两种约束下同样 TS2345（约束不是原因），故 runner 侧不配合也不影响本条收益。
- 第四轮曾以「会牵动 runner.ts/createStore 类型推断面」（同报告 #45 的理由）压住这条放开。本轮按实证落地：`npx tsc -p packages/benchmark/tsconfig.json --noEmit` exit 0（含 p1 全部文件），runner/helpers/reporter 一行未改，当年的回归风险不存在——`State` 本身即 `object` 的子型，放宽只减不增约束。

### R5-070  verdict=FIXED  取报告第一方案：`getState(): DeepReadonly<S>`（递归只读），没有走「只改注释」。
- 改前实测：浅 `Readonly<S>` 下 `s.count = 9` 报 TS2540，而 `s.user.name = 'x'`、`s.user.tags.push('y')` **两条都通过编译**——正是绕过 `$patch`/缓存失效的路子，注释那句「所以类型层先拦住」当时确为失实。
- 改后同一组写入全部被拦：TS2540（`user.name`、`m.get("k").a`）+ TS2339 `push does not exist on type 'readonly string[]'`；`Map`/`Set` 映成 `ReadonlyMap`/`ReadonlySet`（`s.m.set(...)` → TS2339），函数分支保持签名不丢，读取侧（`s.fn()`、`tags.length`、`m.size`、`Object.keys(getState())`）实测无新错。
- 新增导出 `DeepReadonly`（就在 store.ts 内，未新建文件）；对默认 `State = Record<string, unknown>` 有 `DeepReadonly<State> ≡ { readonly [x: string]: unknown }`，与旧 `Readonly<State>` 同型且实测可赋给 `Record<string, unknown>`，所以包内（runner/helpers/reporter，我无权改）不产生任何新诊断，全包 typecheck 仍 0。
- 注释按报告要求同时写清不是运行时保证，并补了报告没提的一层：`Date.setTime()` / `RegExp.lastIndex` 这类内建对象自带变异方法仍可调（readonly 修饰符管不到方法体）。

### R5-071  verdict=FIXED  `$patch` 合并口径写死进契约注释。
- 四条：浅合并（只覆盖 `partial` 出现的顶层键、取值整体替换、不做递归深合并）；未出现的键保持原值且失效范围只覆盖实际写入的顶层键；显式 `undefined` 算一次写入而非「未传」；空对象合法、按「零键写入」处理不抛。
- 同时给出为什么必须写死（深/浅合并每轮开销差一个状态尺寸量级，不统一则 patch 与 setState/$replaceState 的数不可比），与文件内 `subscribe`/`destroy` 既有契约注释的写法一致。纯文档，无类型/行为变更。

### R5-055  verdict=FIXED  `formatTime` 按 `formatBytes` 同口径补非有限值与负数两道闸。
- 改前逐字照抄函数体实测：`NaN → "NaNm NaNs"`、`Infinity → "Infinitym NaNs"`、`-1500 → "-1500000000.00ns"`（报告现象成立；报告写的 `"NaN m NaN s"` 多个空格，实际无空格，不影响结论）。
- 改后实测：`N/A / N/A / -1.50s`，正常档不变（`0.0005 → 500.00ns`、`0.5 → 500.00µs`、`1 → 1.00ms`、`61500 → 1m 1.50s`、`-75000 → -1m 15.00s`），与 `formatBytes(NaN) → N/A`、`formatBytes(-1536) → -1.50 KB` 对齐。
- 负值选保号而不是夹零的理由（负耗时是时钟回退/跨轮顺序错乱的真实信号）写进注释。

### R5-056  verdict=FIXED  `parallel` 入参校验落地，并与 `repeat` 共用一份计数口径。
- 改前实测（原逻辑照抄）：`parallel(fn, 0, 100) → len 0`、`concurrency=NaN → len 0`、`total=10.5 → len 11`（多跑一轮，下标 10 被执行）——报告的三个退化场景全部复现。
- 改后实测：`concurrency=0` 且 `total=100` → 抛 `RangeError: parallel 的 concurrency 至少为 1 才能跑满 100 项工作，收到 0`；`concurrency/total = NaN 或 Infinity` → 抛 RangeError；`total = 0/-5/0.4` → 返回 `[]`（工作量本就是 0，属合法退化）；`total=10.5` → 恰好 10 条；`concurrency=2.7` → 10 条；`concurrency=1000,total=10` → 10 条且不空转；某轮抛错仍收进结果（`len 3` 带 error）。
- 槽位判断的上界改用夹取后的 `workItems`（报告原方案只改了 `Math.min`，循环里仍拿原始 `total` 判上界，小数 total 会多放一槽——实测旧写法给 11 条），并抽 `toCount()` 让 `repeat` 的 iterations 走同一口径：`repeat(10.9) → 10`、`repeat(0/-3) → []`、`repeat(NaN) → 抛`。**行为变更**：`repeat(NaN)` 由静默 0 轮变抛错，与 runner 侧 #439 的 iterations 校验同一取向（跨层不静默给 0）。
- 全包 `parallel`/`repeat` 无包内调用点（`grep -rn "\.repeat(\|parallel(" src/` 只命中定义与注释），改签名内行为不牵动 bench-p1 文件。

### R5-057  verdict=FIXED  取报告第一方案：`measureMemory` 两侧各压一次 GC + 注释写明降级代价，没有删方法。
- 删方法的方案不采纳：`measureMemory` 在 `BenchmarkUtilsContract`（types/index.ts:408，p1 分片）里是列出的成员，且并行分片本轮的决策已把该接口定性为「runner 用到的最小面，类可以更多」——删它要动别人的文件且缩公开面，记 NEEDS-MAIN 让对方只补一行口径。
- 采样口径：GC 前后两侧度量的都是「回收后仍存活」的字节，差值即本轮净留存（`fn` 返回值被调用方持有，不会被第二次 GC 收掉）。只压基线一侧是不够的：收尾那侧仍挂着本轮待回收的临时对象，增量照旧偏大。
- 实测：无 `--expose-gc` 时 `forceGC() → false`、`measureMemory` 照常出数（delta 8896/107896 量级）；注入 `globalThis.gc` 后一次 `measureMemory` 触发 2 次 GC（另一次直接调 `forceGC` 时为 3），返回值 `result` 原样透传。注释明确写出「无 flag 时退化为原始前后采样、只能当方向参考」，以及 `BenchmarkConfig.general.skipGC` 管不到这里（那个开关只管 runner 整轮前那次预热 GC）。

### R5-058  verdict=FIXED  顶层 `import v8 from 'node:v8'` 与顶层求值一起删掉，改惰性 + 兜底。
- 现状确认：旧第 44 行是模块顶层 const 初始化器（ESM 求值期执行），同文件 `process` 只是 `declare`，所以 import 失败面确实先于任何内存调用。报告的方案只挪了 `getHeapStatistics()` 调用点、留着静态 import specifier 并不能达到「非 Node 宿主也能 import 本模块」，故按报告方向做彻底：改用 `process.getBuiltinModule('node:v8')`（Node 22.3+，唯一既同步又不需要静态 import 的入口）+ 结果缓存（含失败结果，热循环每轮调也不重复解析）。
- 实测：正常宿主 `heapLimit = 4345298944`（≈4.1GB，与真实 `heap_size_limit` 同值）；把 `process.getBuiltinModule` 置为 undefined 的新模块实例 → `heapLimit = 0`、`measureMemory` 仍出数、不抛；让它抛错的实例 → 同样兜住报 0。取不到报 0 的语义（真实堆上限不可能是 0）与旧「编造成 heapTotal*2」的教训一起写进注释。
- 不选动态 `import()`：`getMemorySnapshot()` 是同步 API，promise 结果赶不上本轮快照；`heapLimit` 全包无读取方（`grep -rn heapLimit packages src tests` 只命中类型定义与本文件产出点），0 兜底不影响任何计算路径。

### R5-059  verdict=FIXED  两处 `(global as any)` 与两条 eslint-disable 全删；顺手删掉只为它们存在的 `declare const global`。
- 前提核实成立：模块顶部那份 `declare const global: typeof globalThis & { gc?: () => void }` 确实让 `global.gc` 直接类型安全，`as any` 纯属冗余。
- 但按报告原样写 `global.gc` 仍留着两个问题：`global` 是 Node 专有名字（无该全局的宿主里 `global.gc` 抛 ReferenceError，全靠 try 吞掉），而模块作用域那句 `declare` 只是编译期的一厢情愿。故取 `const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc`：无 `any`、无 disable 注释、`globalThis` 在所有 ES2020 宿主都存在。
- 随之删掉那个 try/catch：它唯一的用途是兜 `global` 未定义，故障源没了之后保留它只会把 `gc()` 真实抛错伪装成「GC 不可用」（实测注入会抛的 `globalThis.gc`：现实现上抛，旧实现静默 false）。与并行分片对 `forceGC` 的同一决策口径一致。
- `npx eslint packages/benchmark/src/utils.ts` 0 问题（`no-explicit-any` 无告警，也没有留下无主的 disable 注释触发 `reportUnusedDisableDirectives: error`）。

### R5-060  verdict=FIXED  `calculateStandardDeviation` 单循环累加，中间数组消失。
- 改前 `values.map(...)` + `reduce` 确实为 n 个耗时额外分配一个 n 元素数组；`calculateTimeStats` 每轮用整轮耗时数组调它（xlarge 档十万量级），纯白分配。
- 等价性实测：1000 组 × 50 个随机耗时，新旧实现最大偏差 `0`（逐位相同）；`[] → 0` 的短路保留；`avg` 为 NaN 时同样返回 NaN（与旧实现一致，不额外加校验，避免改动统计口径）。
- `Math.pow(diff, 2)` → `diff * diff`：对有限浮点同值（同上 1000 组比对），省一次函数调用；注释同时写明这是**总体**标准差（除以 n，不是样本的 n-1），免得下一轮又有人来问分母。

## NEEDS-MAIN（4 条，均为 p1/主 agent 文件）

1. `packages/benchmark/src/types/index.ts` — `export type { ... } from './store.js'`（第 5-14 行）清单缺我在 store.ts 新增的导出类型 `DeepReadonly`。入口是 `export type * from './types/index.js'`，不加则包外 `import type { DeepReadonly } from '@openlide/geomstore-benchmark'` 取不到（`getState(): DeepReadonly<S>` 的返回类型在 .d.ts 里也写得出、但不具名），包内不会报错。请在该清单里补 `DeepReadonly,`。
2. `packages/benchmark/src/types/index.ts:408` — `measureMemory` 的契约注释现在只写「测量内存使用」。R5-057 已把口径改为「两侧各压一次 GC，无 `--expose-gc` 时退化为原始前后采样」，请在契约侧补这一句，否则只看契约的适配方仍以为拿到的是裸 heapUsed 差值。（我不动该文件。）
3. `packages/benchmark/src/helpers.ts` — `warmupCache<S extends Record<string, unknown>>(store: { getCached: (key: string) => unknown; getState: () => S }, …)` 的结构参数把 `getCached` 声明为**必填**，而 `BenchmarkStore.getCached?` 是可选：实测传任何 `BenchmarkStore` 都 TS2345（**HEAD 版与本轮改后同样报错**，非本轮引入，也与我改的 `DeepReadonly` 无关——`viaPlain`/`viaMut` 两种 getState 形状对照实测都通过）。建议 `getCached?: (key: string) => unknown` 并在体内用 `store.getCached?.(key)`；该函数是 `src/index.ts` 的公开导出，目前包内无调用点。
4. `packages/benchmark/src/index.ts:60` — `createBenchmarkAdapter<S extends State>(store: BenchmarkStore<S>): BenchmarkStore<S>` 的 `S extends State` 请放开为 `S extends object = State`。实测：interface 状态的 store 作实参时该签名报 TS2345（`BenchmarkStore<Counter>` 不赋给 `BenchmarkStore<Record<string, unknown>>`），换成 `S extends object` 后同一实参 0 诊断。不改的话 R5-069 的收益停在类型层，包自己的适配入口仍拒 interface 状态（README 教的正是这条路径）。`runner.ts:112/115` 的同名约束按实测不是断点，可顺带对齐也可不动。
5. `packages/**` 的 `prettier --check` 在根 `.prettierrc.json` 现在是 `printWidth: 160` 下**整包 13 个文件全部不过**，且这是本轮之前就有的漂移：用 prettier API 以生效配置比对 `git show HEAD:` 版，`packages/benchmark/src/utils.ts` 有 335 行不同、`types/store.ts` 有 120 行不同（HEAD 版即不合规，非我引入）。根 `src/**` 也非全清（`src/extras/monitor/collectors.ts`、`src/types/common.ts` 同样 warn）。我按「与所在文件既有风格一致」写（~100 列换行），没做全量重排以免与 p1 的同包改动打架、并制造无关 diff。要不要统一重排请主 agent 决定（`prettier --write` 即可，注意 `format:check` 显式带 `--ignore-path .prettierignore`，而该文件不忽略 packages）。

## 汇总

9 条：fixed 9 · FP 0 · REJECT 0。改 `types/store.ts`（+`DeepReadonly` 导出、6 处泛型约束、getState/$patch 契约）与 `utils.ts`（formatTime、parallel+repeat、measureMemory、堆上限惰性化、forceGC 去 cast、stdDev 单循环）。`npx tsc -p packages/benchmark/tsconfig.json --noEmit` 与 `npx eslint`（两个 owned 文件）均 0 诊断；行为变更共 4 处：`getState()` 返回类型收紧（默认 `State` 下与旧 `Readonly<State>` 同型）、`repeat(NaN)`/`parallel` 退化入参由静默给空数组改抛 RangeError、`measureMemory` 两侧压 GC、`forceGC` 在 `gc()` 自身抛错时改为上抛。
