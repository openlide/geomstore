# 第五轮 NEEDS-MAIN 汇总与主会话裁决

各分片 agent 无权改的文件/需要跨片配合的事项都汇总到这里，由主会话统一落地并给结论。
条目格式：`来源分片 · R5 编号或连带项 · 诉求 · 裁决`。

## root-config

- R5-001 连带：`eslint.config.js` 取消 `tests/**` 的 `no-unused-vars` / `no-empty` 豁免后，暴露
  15 个文件 59 处告警 + `AsyncActionSupport.test.ts:632/635/638` 三处空块。
  **裁决：待 tests 相关分片全部落地后由主会话清扫**（改 `^_` 前缀或删除死变量），
  否则 `pnpm lint:ci`（已收紧到 `--max-warnings 0`）必红。不做白名单、不恢复豁免。
- R5-373 连带：`.gitignore` 取消 `examples/` 整目录忽略后，9 个此前被忽略的源文件成为未跟踪。
  **裁决：接受**（实测证据：把 `examples/global.d.ts` 移出目录后
  `npx tsc --noEmit -p tools/tsconfig.examples.json` 报 4 条 TS2304 `App/Component/Page` 未声明，
  而这三个文件是被跟踪的），提交时 `git add examples/`。
- R5-365：第三方 GitHub Action 钉 SHA。**裁决：本环境无法核验 tag→commit 映射，盲填会直接挂 CI**，
  保留为发版前人工事项（与第四轮同一结论）。
- pnpm-lock.yaml：新增 devDependency `@eslint/js` 带来的 3 行 importer 条目。
  **裁决：一并入库**（是 `package.json` 声明的必要配套，不是顺手改锁文件）。

## bench-p2（packages/benchmark/src/{types/store,utils}.ts）

- ① `packages/benchmark/src/types/index.ts` 的 store.js 再导出清单需补 `DeepReadonly`。
  **裁决：主会话落地**（该文件不属于任何在跑分片）。
- ② `types/index.ts:408` `measureMemory` 契约注释补 GC 口径。**裁决：主会话落地**。
- ③ `helpers.ts` 的 `warmupCache` 要求 `getCached` 必填，与 `BenchmarkStore.getCached?` 冲突
  （HEAD 即存在，非本轮引入）。**裁决：待 bench-p1 落地后复核归属**——若 p1 未处理，主会话改
  `warmupCache` 的入参收窄，不让 p2 放宽契约。
- ④ `index.ts:60` `createBenchmarkAdapter<S extends State>` 需放开为 `object`，否则包外 interface
  状态仍被拒收（实测 TS2345）。**裁决：待 bench-p1 落地后复核**，p1 没做就主会话补。
- ⑤ packages/benchmark 全包在 `printWidth: 160` 下 prettier 不过（HEAD 版即不合规）。
  **裁决：门禁阶段由主会话统一 `prettier --write`，并核对换行不扩散成整文件 diff**。

## bench-p1（packages/benchmark 入口/runner/reporter/config，25 条全修）

1. `.github/workflows/ci.yml` 增加 benchmark 冒烟一步：`npx tsc -p packages/benchmark/tsconfig.json && node packages/benchmark/dist/smoke.js`。
   **裁决：主会话落地**（root-config 已交付该文件，避免与并行 agent 抢写）。
2. `packages/benchmark/README.md:9/15/16` 教的安装名 `@geomstore/benchmark` 与 `geomstore` 都不存在，
   且 R5-006 已定性本包不发布。**裁决：主会话改写为仓库内用法**（该文件不在任何分片清单内）。
3. `push(...list)` 展开溢出的同类点：`src/extras/action/ActionHistory.ts:106`、
   `src/core/compose/composeStore.ts:230/805`、`src/core/utils/equality.ts:255`
   （`src/core/performance/metrics.ts:143` 已有逐条写入口径可照抄）。
   **裁决：等 extras-action-p1 / core-misc-p1 / core-misc-p2 落地后由主会话复核**，
   谁的分片里没这条就主会话补，避免与在跑的 agent 抢同一文件。
4. `pnpm-workspace.yaml` 无 `packages:` 键、根 `package.json` 用 npm 风格 `workspaces`，
   导致 benchmark 包实际不在 pnpm 工作区内（lock 0 命中）。
   **裁决：门禁阶段处理**——要么把包接进 `pnpm-workspace.yaml`，要么删掉根 `workspaces` 声明并说明它靠什么解析；
   两种都行，但不能保持「声明了却没接入」的自相矛盾状态（与用户「一次改到位」口径一致）。

## tests-p1（回合上限中断，主会话接手）

- 分片 agent 在写判定台账时打到 150 回合上限：`tests/**` 的改动已落盘（setup.ts、tsconfig.json、
  9 个 typecheck 夹具 + 新建 `test-store-inference.typecheck.ts`），R5-349 的探针也已落盘；
  **R5-349 的判定条目由主会话核对后补写**，其余 23 条齐。
- 该分片留下的 NEEDS-MAIN 已在其台账内（`tests/integration/with-app-store.test.ts` 补展平成员优先级断言、
  `src/core/store/Store.ts:170` 的 `hooks` 字段收窄回 `IHookSystem`），门禁阶段一并处理。

## 主会话已落地（bench 两片的 NEEDS-MAIN）

- bench-p2 ①：`packages/benchmark/src/types/index.ts` 的 store.js 再导出清单补 `DeepReadonly`。
- bench-p2 ②：同文件 `BenchmarkUtilsContract.measureMemory` 补契约注释（只有带 `--expose-gc`
  才是干净堆增量，否则只能相对比较）。
- bench-p2 ③：`helpers.ts` 的 `warmupCache` 入参 `getCached` 改为可选并早退——
  必填声明与 `BenchmarkStore.getCached?` 冲突，会让「直接传 BenchmarkStore」这一最常见写法编译不过。
- bench-p2 ④：`index.ts` 的 `createBenchmarkAdapter<S extends State>` 放开为 `<S extends object>`
  （与 R5-069 同口径；`State = Record<string, unknown>` 会拒收业务侧 interface 状态），
  顺带删掉因此不再使用的 `State` 类型导入。
- bench-p1 ①：`.github/workflows/ci.yml` 的 `verify-static` job 末尾加
  `Benchmark package smoke` 步（`npx tsc -p packages/benchmark/tsconfig.json` + `node dist/smoke.js`）。
- bench-p1 ②：`packages/benchmark/README.md` 改写「安装」段为「定位与用法」——
  本包 `private: true` 不发布，真实包名 `@openlide/geomstore-benchmark`（原先两处 `@geomstore/*`、`geomstore`
  都是不存在的名字），并给出与 CI 一致的冒烟命令；`src/types/index.ts` 头注释里的旧包名一并改掉。
- bench-p1 ④：根 `package.json` 删除 npm 风格的 `workspaces: ["packages/*"]`。
  理由：`packageManager` 是 pnpm、CI 也只走 pnpm，而 `pnpm-workspace.yaml` 无 `packages:` 键
  → 该字段对实际使用的包管理器是死配置，只会让 npm/yarn 与 pnpm 得出两套拓扑。
  在 `pnpm-workspace.yaml` 注释里写清「子包不接入、编译借根 typescript、CI 用哪条命令」以及接入前提。
  **验证**：`npx tsc -p packages/benchmark/tsconfig.json`（含 emit）+ `node packages/benchmark/dist/smoke.js`
  → `=== 冒烟结果：全部通过 ===`；`package.json` 仍可被 JSON.parse。
- bench-p1 ③（`push(...list)` 展开溢出）：仍待 extras-action-p1 / core-misc-p1 / core-misc-p2 落地后复核。

## extras-action-p2（15 条：13 FIXED / 1 FP / 1 NEEDS-MAIN）

- R5-175 NEEDS-MAIN：共享的「超时错误工厂」应落在 `src/extras/action/async-core.ts` 或
  `AsyncActionSupport.ts`（都归 extras-action-p1）。**裁决：等 p1 落地后由主会话复核**——p1 若已建则
  接过去，没建则把 `timeout.ts` 里那份上提成单一实现（不能留两份超时消息口径）。
  **最终：extras-action-p1 recovery 建了 `createTimeoutError`，主会话按它收尾**（见「extras-action-p1 recovery」段）。
- 同片附带结论：`src/extras/action.ts` 宜转发 `LogSink` / `LogPhase`（p2 已在 `action/index.ts` 补齐
  符号，零丢失）。**裁决：门禁阶段一并处理**。
- API-CHANGE 供 CHANGELOG：`@openlide/geomstore/extras/action` 子入口新增 `LogSink` / `LogPhase` 两个类型
  导出（经 barrel 同步后该入口实为 35 符号）；`extras/index.ts` 的五段改述为「从同名已发布子入口按名
  再导出」，符号集 76→76 并有双向漂移锁用例；`withThrottle` 内部变量 `window` → `intervalMs`（不影响调用面）；
  `withTimeout` 的超时消息改用归一化后的生效值（区间外文案会变）。


## core-misc-p2（19 条全 FIXED）留下两条「报告未覆盖」的相邻观察

- (a) `shallowEqual({}, Object.create(null))` 为 true，而 `deepEqual` 判不等——两侧原型规则不一致；
  `shallowEqual` 在 `src/` 内零调用方。
- (b) `deepEqual` 的 Date/RegExp/Map/Set 内建分支在**通用对象比较（含「原型一致」那条规则）之前**就
  `continue`，于是空的 `new MyMap()` 与空的 `new Map()` 判等、装箱的 `new Number(1)` 与 `new Number(2)`
  也判等（`Object.keys` 对装箱原始值恒为空）。
- **裁决：本轮不改**。两条都不在 `ocrreview.md` 的 376 条范围内；修 (b) 要把原型判定提到内建分支之前，
  属于比较语义变更，而 `deepEqual` 是选择器 / 缓存的默认比较器（热路径 + 全库语义），批量修复进行中改它的
  相等语义会让回归面与本轮收口互相污染。连同 core-store-p1-B 交来的 `isMapLike` / `isSetLike` 标签判据那笔
  一起列为第五轮后续待办（(b) 是真缺陷、应修；(a) 建议统一到同一原型口径或直接删掉零调用方），等用户点头单独开一轮。


## 三个分片打到 150 回合上限（代码已落、台账缺失）→ 已派对账 agent 接手

| 分片 | 条数 | 断点线索 | 接手 agent |
| --- | --- | --- | --- |
| tests-p1 | 24 | 台账写了 23 条，缺 R5-349（改动其实已落盘） | 主会话核对后补写 R5-349 |
| core-misc-p1 | 25 | 无台账；9 个文件 +434/−179 | core-misc-p1-audit-r5 |
| extras-error | 25 | 无台账；9 个文件 +562/−162 | extras-error-audit-r5 |
| core-store-p1 | 25 | 无台账；最后输出停在「Now dirtyTracking (R5-155…159)」 | core-store-p1-audit-r5 |

对账 agent 的统一要求：`git diff` 逐条比对清单 → 补缺/纠错 → 补写完整台账；
不得回退主会话的 hot 结论与第四轮锁定契约（脏键归因/增量索引、克隆保留原引用）。
（另：误派了第二个 core-store-p1 接手 agent，已在启动阶段停止，未产生文件改动。）

## integrations-p2（10 条全 FIXED）的跨片诉求

- `src/types/integration.ts` 的 `autoUpdateOnShow` / `AppThis` 注释需与新实现同步。
  **裁决：等 plugins-types-p2 落地后主会话补**（该文件归它，避免抢写）。
- API-CHANGE 供 CHANGELOG：`withAppStore` 现在真正接入 `autoUpdateOnShow`（onShow 重注入；
  `globalData` 尚未建立时只转发不注入）；`bindActions` 重复绑定会先退订旧登记；Page/Component/App
  生命周期重入先清理旧订阅；绑定段抛错改为「回滚订阅 + 告警 + 原样抛回框架」；
  `__proto__` 之类的映射键不再被静默丢弃（改按自有属性写入）。


## plugins-types-p2（13 条全 FIXED）的 4 条 NEEDS-MAIN —— 主会话已全部落地

1. `tests/types/integration-types.typecheck.ts`：`PageCfgShape` 补 `onRouteDone`
   （对方分片给 `PageReservedKeys` 加了该键，夹具覆盖度断言随即 TS2322）。**已修**。
2. `tests/types/store-config-base.typecheck.ts:102`：`@ts-expect-error` 变成 unused
   （`StoreConfig` 的 `S` 默认值已改为 `Record<string, unknown>`，裸写法的 `cacheKeys` 现在合法）。
   **已改为正向断言**并写明「谁把默认值改回 `unknown`，这行会立刻报 TS2322」。
3. `src/types/selector.ts` 的 `cacheTTL` 注释还写着「实现只做 `?? 5000`、不夹范围」——
   extras-selector 的 R5-225 已加守卫。**已按实现现状改写**（含 `Infinity` 为何有意放行、
   以及它与 `cacheSize` 口径不同是有意的、别强行统一）。
4. 同文件 `SelectorComposerInput` 的 `R` 段还写着「`combine` 未把 `R` 透传、`as R` 仍在、
   修法见实现层」——extras-selector 的 R5-232 已经透传并删掉两处断言。**已改写为现状描述**。
   验证：`npx tsc -p tsconfig.tests.json --noEmit` 的 `tests/types/**` 报错清零。

## integrations-p1（23 FIXED / 1 REJECT）的文档接线

NEEDS-MAIN：`docs/API.md`、`.codebuddy/skills/geomstore/references/api/{integrations,extras-enterprise}.md`、
`CHANGELOG.md` 里 `syncUrl`「有模块默认值」的口径要随 R5-273 重写（另需补 R5-268/R5-270 的行为变更）。
**裁决：文档同步阶段（Wave 5）由主会话统一处理**；skill 参考文档是 `pnpm run skill:api` 的产出，
先改 src JSDoc 再重跑生成器，不手改产出文件。

## extras-action-p1 recovery（25 条全 FIXED）的 3 条后续 —— 主会话处置

1. `decorators/timeout.ts` 头部「超时错误是普通 Error（无专用错误类型、无 code），唯一判据是消息文本」
   已被 recovery 落地的 `createTimeoutError` 变成假话。**已改写**：判据是 `code === TIMEOUT_ERROR_CODE`，
   两个入口消息文本不同但 code 相同，文本仍是展示契约、改动即破坏性变更。
2. `action/index.ts` 再导出 `ActionErrorData` / `RetryOptions` / `TimeoutError` + 值导出
   `TIMEOUT_ERROR_CODE`，并按 barrel 链同步 `src/extras/action.ts` 与 `src/extras/index.ts`
   （否则 R5-242 的双向漂移锁用例会红：子入口有、总入口没有）。
   验证：`tsc -p tsconfig.json` 0 报错、`r5-extras-action-p2-entry-parity` + `entry-exports` +
   `tests/unit/extras/action` 共 18 套件 300 例全绿。
   （过程记录：第二次 Edit 触发过一次「追写重复导出块」，`TS2300 Duplicate identifier` 当场暴露并已删净。）
3. `decorators/retry.ts` 复用内核 `RetryOptions` 的建议：**不做**。装饰器侧只暴露
   `retries/delay/shouldRetry` 且每个字段的文档写的是装饰器语义（如「入参恒为 Error，
   非 Error 抛出值已由内核 `toError` 规范化」），改成 `Pick<RetryOptions, …>` 会丢这些字段级文档，
   而它自己在 `@remarks` 里已明写「选项面不等价、`onRetry` 只有执行器入口提供」——
   现状是「有意子集 + 显式声明」，不是漂移。

## core-store-p2 recovery（10 条全 FIXED）的 4 条 NEEDS-MAIN —— 都落在 core-store-p1 的文件里

前任（core-store-p2 原 agent）10 条其实都已完成，缺的只是台账；recovery 另修了 3 处「注释说假话」
（`SubscriptionManager.notify` 的 false 档归属、同处守卫注释、`onSubscriberEvicted` 未接线却写成既成事实），
删掉一处会挂 `lint:ci` 的未用导入，并补 4 例回归。它交回主会话的 4 条：

1. `src/core/store/Store.ts:207-215`：把 `onSubscriberEvicted` 真正接到 `SubscriptionManager`。
2. `src/core/store/Store.ts:1159-1191`：`needsClone` 分支应传 `notify(this._state, true)`
   （R5-122 只在公开 subscribe 路径闭环）。
3. `src/core/store/index.ts:21` 旁补 `SubscriberEvictionInfo` 再导出。
4. docs 四处「各回调独立深拷贝」的口径 + CHANGELOG。

**裁决：等 core-store-p1 的 recovery agent 收尾后由主会话落地 1–3**（1/2/3 全在 p1 的文件里，
现在改会撞车；p1 的接手 agent 是在这些交接条件出现之前派出去的，看不到它们）。
第 4 条属文档同步阶段。

## extras-error recovery（25 条全 FIXED，13 条带 API-CHANGE）的 3 条 NEEDS-MAIN

1. `src/types/error.ts`：`ErrorReport.summary` 增加 `droppedErrors` 字段
   （报告器侧现在会丢超限样本，摘要里没有可见口径）。**裁决：门禁阶段主会话落地**
   ——该文件归 plugins-types-p1，它的 recovery agent 在跑，避免抢写。
2. `docs/API.md`：本分片 8 项行为变更需写入。**裁决：文档同步阶段处理**。
3. `isThenable` 的归属：现在住在 `src/extras/action/decorators/common.ts`，而 `src/extras/error/**`
   也要用同一判据。**裁决：门禁阶段决定**——若确实出现第三处消费者就上提到 `src/extras/common.ts`
   并由两处转发；只有两处消费者时维持现状（避免为了对称再铺一层）。

## 门禁阶段必须收掉的两处已知红（现在还在跑的分片看不到）

1. `tests/unit/extras/ocr-medium-round4-p4.test.ts` 4 条 TS 错（`result.data` possibly undefined ×3 +
   一处 `Object.values` 重载不匹配）：extras-snapshot 把 `SnapshotResult.data` 收成
   `T | undefined`（与 SKIP 哨兵/失败语义一致）后，第四轮的旧用例仍按「必有 data」写。
   **处置：由主会话在门禁阶段按新语义改断言**（先判 `success`/非空再取值），不改源码语义。
2. root-config 取消 `tests/**` 的 `no-unused-vars`/`no-empty` 豁免后剩 62 条 lint 债
   （4 error / 58 warning，含 `StoreCache.test.ts` 已由 core-store-p2 recovery 修掉一条）。
   **处置：门禁阶段一次性清扫**，不恢复豁免、不加白名单。

## plugins-types-p1 recovery（22 FIXED / 1 NEEDS-MAIN）的 5 条交接

1. `src/core/store/ActionManager.ts` 的 `_reportSettledFailure` 补 `'dispatch'` source。
   **归 core-store-p1 的文件** → 等它的 recovery agent 收尾后主会话落地。
2. `src/extras/action/{ActionLoader,withLoading}.ts` 与 `src/types/action.ts`：把
   `sharedLoadingCounts` 移出类型层并加构造期守卫。**门禁阶段主会话处理**（extras-action 两片都已定稿）。
3. `src/types/selector.ts` 的 `equalityFn` 方差问题（探针留在 `.cache/variance-probe.ts`）。
   **门禁阶段主会话处理**（该文件本轮已两次被改：`snapshotState`、cacheTTL/combine 注释）。
4. 可选：`src/core/utils/helpers.ts` 合并导入的准入判定。**门禁阶段评估**，属可选清洁度。
5. `pnpm run skill:api` 需重跑（src JSDoc 大量变更）。**门禁阶段最后一并做**。

## extras-error recovery 交接 1 已落地（连同 plugins-types-p1 的第 3 条相关）

`ErrorReport.summary` 现在带 `droppedErrors`：`src/types/error.ts` 加字段 + 说明为何必须随快照出去，
`ErrorMonitoring.generateReport()` 填值，`generateReport` 的 JSDoc 补上「三个口径互不重叠、不能相加核对」
（`droppedErrors` 记的是被挤出队列的次数，那条在它自己那次 `report()` 里已计入 `totalErrors`；
成功投递过的既不在 queued 也不在 dropped）。回归锁加在
`tests/unit/r5-extras-error-monitoring.test.ts`（溢出 2 条 → `summary.droppedErrors === 2`）。
验证：`tsc -p tsconfig.json` 0 报错；`tests/unit/extras/error` + `tests/unit/core/error` 8 套件 323 例全绿。

## plugins-types-p1 交接第 2、3 条 —— 主会话已落地（含反证）

**第 3 条 `SelectorOptions.equalityFn` 方差**：形参由 `(a: unknown, b: unknown)` 改为 `(a: any, b: any)`
（与 R5-316 给 `AsyncActions` 的同一处方，带 `eslint-disable` 与理由）。
**判别性反证**：把类型临时改回 `unknown` 跑 `npx tsc -p tsconfig.tests.json`，
新建的锁 `tests/types/selector-equalityfn-variance.typecheck.ts` 立刻报 2 条
`TS2322: Type '(a: OrderState, b: OrderState) => boolean' is not assignable to type '(a: unknown, b: unknown) => boolean'`；
改回 `any` 后归零。同一文件里再锁一条「返回非 boolean 仍被拒」，证明放宽只发生在逆变形参位。

**第 2 条 `sharedLoadingCounts`**：**没有**按建议搬到内部通道。理由是它已经是被文档承认的公开面
（`docs/API.md` 选项表第 330 行列着它，6 处测试以公开选项方式构造），搬到二次构造参数/
symbol 键等于制造一次真破坏性变更，而 finding 的实质是「`@internal` 标签在说谎」。
改法：删掉 `@internal`，把两条真实约束（只构造期读一次、`setOptions()` 忽略它的原因、
不变量归注入方）写成消费者能读的契约；`ActionLoader` 构造器补一次
`injected instanceof Map ? injected : new Map()` 的准入判定（JS 调用方传非 Map 时
原先会在异步收尾里第一次 `get/set` 才炸，炸点看不出现场）。
验证：`tsc` 两配置 0 报错、`tests/unit/extras/action` + 两份 round4 台账共 18 套件 363 例全绿。

## extras-snapshot recovery（17 FIXED / 2 FP）的 4 条越界交接 —— 主会话已全部落地

1. `tests/unit/extras/ocr-medium-round4-p3.test.ts:157`：`recoverable` 字段已按 R5-239 从公开上下文删除，
   用例改为锁 `{ path }` + **键集合严格等于 `['depth','path','value']`**（防止有人日后塞回恒真字段）。
2. `ocr-medium-round4-p4.test.ts` 的 circular 账本断言：`toHaveLength(0)` 与 R5-254「errors 是完整账本」矛盾，
   改为 `errors.map(e=>e.type) === ['circular']`，并注明 `success` 仍为 true（只有 cloneError 参与判定）。
3. 同文件 6 处 `result.data.X`：新增本地 `delivered(result)` 取值器（undefined 时抛一条写明
   success/errors 现场的可读失败），**没有**采用对方建议的 `result.data!` ——
   非空断言正是第四轮点名要避免的写法（断言失真时会 `throw undefined` 式静默）。
4. `src/extras/snapshot/index.ts` 头部的「迭代式深度克隆」措辞：改为「递归深度克隆 +
   `maxDepth` 与 `HARD_MAX_CLONE_DEPTH` 双上限，更深结构走异步队列」，与 R5-257 后的实现一致。
   同文件 6 处 proxy `getOwnPropertyDescriptor(_target, key)` 的 lint 债：5 处真未用改 `_key`，
   **1 处（865 行）函数体在读 `key`，不是死参数**，按原样保留。
   踩坑记录：批量改 `_key` 与改 `result` 绑定时各命中一次错误锚点（`const result = manager.createSnapshot(data, {`
   在文件里有 13 处同名前缀），靠 `assert count==1` 前置检查当场拦下，未写坏文件；
   改用带函数体的长锚点后重做，`eslint` 0、`tsc -p tsconfig.tests.json` 0、`tests/unit/extras/snapshot` 198 例全绿。

## core-store-p1-B（11 条全 FIXED）的两条交接

- `docs/API.md`：把「非普通实例的方法绑定到原始接收者 ⇒ 方法内部写入不经状态保护与脏追踪」
  这条**有意豁免**写进 stateProtection 小节（现在只在源码注释里，用户看不到）。
  **裁决：文档同步阶段落地**（已在 CHANGELOG/docs 待办清单里）。
- `src/core/utils/equality.ts`：R5-119 的另一半——`deepEqual` 的 Date/RegExp/Map/Set 四分支
  应改用与 `StateProxy.isMapLike/isSetLike` 同款「`instanceof` ∪ `Symbol.toStringTag` 标签」并集判定。
  **裁决：本轮不做**，两条理由：① 要做对就得把标签判据下沉到 `src/core/utils/` 供两处共用，
  反向 import `core/store/StateProxy` 会形成 utils → store 的分层倒置；② 它与我已登记的另一笔
  `deepEqual` 语义债（内建分支在原型检查前 `continue`）是同一处代码，
  两笔一起改才自洽，拆一半改会把「跨 realm」与「原型一致性」两个问题搅在一起。
  连同那笔一起列为第五轮后续待办，等用户点头单独开一轮。

## 收尾前必须解释清的一条残留红（跨片冲突，等 core-store-p1-A 落地后由主会话裁决）

`tests/unit/store/notify-optimizations.test.ts` → `NOTIFY-002: clone=false 且状态保护开启时，
监听器收到只读保护 Proxy`：`expect(second).toBe(received)` 失败，两个对象「序列化成同样的字符串但不是同一引用」。
core-store-p1-B 判它是「SubscriptionManager 载荷身份的中间态」，但它所属的 core-store-p2 已交卷，
而本条正对着 core-store-p2 交给 A 组的那项交接（`needsClone` 分支应传 `notify(this._state, true)`）。
**处置：A 组落地后重跑；若仍红，按「只读订阅零拷贝 + 保护代理按 target 缓存」的锁定契约判定该改哪一侧**
——代理缓存是 `WeakMap<target, proxy>`（`createProxyCache` 只有 get/set、从不 delete），
同一次通知里对同一 target 取两次保护代理理应拿到同一对象。

## 主会话本轮另外两处顺手清掉的小债

- `tests/unit/store/modules/StateProxy.test.ts` 两个用例把 `proxyCache` 解构出来却从不使用，
  而用例名写着「应该正确删除缓存 / 应该清除缓存」。事实是：代理缓存按 `WeakMap<target, proxy>` 索引，
  全库只有 `get`/`set` 两处调用、从不 `delete`（target 存活期间映射不会失真），**从来没有可删的东西**。
  处理方式：删掉死绑定 + 把用例名改成它们真正锁住的行为（代理与源对象同时可见），
  而不是补一条为消警而写的假断言。
- `tests/unit/extras/snapshot/SnapshotManager.test.ts` 5 处 proxy `getOwnPropertyDescriptor(_target, key)`
  的未用形参改 `_key`；第 6 处（865 行）函数体在读 `key`，不是死参数，原样保留。
  一处 `const result = manager.createSnapshot(data, {...})` 的死绑定改为直接调用。
  批量替换时两次命中错误锚点（`const result = manager.createSnapshot(objA/data, {` 在文件里有 13 处同名前缀），
  都靠 `assert count==1` 当场拦下；改用带函数体的长锚点重做后 `eslint` 0、`tsc -p tsconfig.tests.json` 0、
  该目录 198 例全绿。

## R5-346 / R5-355（tests-p1 的两条 NEEDS-MAIN）—— 主会话裁决

- **R5-355 已落地**：`tests/integration/with-app-store.test.ts` 新增一例，实测钉住撞名优先级——
  action 名叫 `getState` 时，`onLaunch` 完成后 `Object.getOwnPropertyDescriptor(app,'getState').value`
  是基座的 `() => store.getState()`（`app.getState()` → `{count:3}`），
  而 action 仍可达（`app.__store__.dispatch('getState')` → `'from-action'`）。
  这正是类型侧 `_clashLooksLikeActionString` 断言的运行时对应物，两侧不再静默分叉。28 例全绿。
- **R5-346 本轮不做，改判 REJECT（附理由，不登记为待办）**：报告要的「工厂返回非对象应被拒」这条反例，
  需要收紧 `src/types/store.ts` 的 `StoreOptionsBase<S>.state`。该接口头上已写明一条刻意设计——
  `S` **不加** `extends State` 约束，因为 `StoreConfig` 的类型参数默认是 `unknown`（推断位点）。
  把 `state` 改成条件类型（`S extends (...args)=>unknown ? never : S | (()=>S)`）会让 `S` 落入
  不可推断位置，与 R5-326 已实测过的失败同类：那次报告建议的 `Array<keyof ConfigState<S>>`
  直接打断 `factory.ts` 里 `new Store(options)` 的反向推断（TS2322 + TS2345，
  显式类型实参与 `NoInfer` 都救不回）。同一个位置再来一次条件类型，收益只是「多拦一种写法」，
  代价是把最常用入口的推断换掉。已把探针与理由记在 `tests-p1.md` 的 R5-346 条内。

## 门禁收口阶段（主会话）新增落地

- **`lint:ci` 与 `prettier --check` 打架的 98 处**：`printWidth: 160` 下 prettier 会在以 `(` 开头的
  语句前补 `;`，ESLint 9 的 `no-extra-semi` 又把那个 `;` 判为多余——`eslint --fix` 与
  `prettier --write` 互相回退对方的改动（已在 `src/core/utils/clone.ts` 上实测）。
  **裁决：改写语句本体**（`const slot = target as Record<string, unknown>` /
  `const items = (this.state as {items:string[]}).items` 这类「用 `const` 绑定断言结果」），
  断言原样保留不放宽，**不加 `eslint-disable`、不改配置、不动 `printWidth`**。涉 21 文件 98 处。
- **`examples/extras/snapshot.ts:38`**：`SnapshotResult.data` 本轮收成 `T | undefined` 后，
  该示例 `pnpm run typecheck:examples` 报 TS18048。此前 `examples/` 被 `.gitignore` 整目录忽略
  （R5-373 已取消忽略），所以这条一直没人跑到。**改法按新契约写**：先判 `success && data` 再取值，
  让示例教的正是「用前判 `success`」这条口径，而不是加 `!` 断言把示例写成反面教材。
- **文档里「覆盖率四项 100%」是假话**（`README.md:9`、`README.md:125`、`docs/BEST_PRACTICES.md:153`、
  `docs/ARCHITECTURE.md` 两处）：`jest.config.js` 的 `coverageThreshold` 早就是
  global 语句/分支/函数/行 98/95/98/98 + `core`/`snapshot`/`selector`/`action` 单文件分支 85，
  本轮实测四项 99.86 / 99.08 / 99.82 / 99.91。**裁决：文档改为陈述真实门禁**，不调阈值、不删数字。
  `CHANGELOG.md:275` 那句「四项达到 100%」属 `[0.5.0]` 已发布条目的历史记录，**不改写历史**。
- **`docs/ARCHITECTURE.md:238` 的「62+ 套件、2300+ 用例」**：实测 144 套件 / 3408 用例，已按实际数改写。
- **`isThenable` 两份实现**（`extras/action/decorators/common.ts` 带 try/catch、
  `extras/error/ErrorHandler.ts` 不带）：**维持现状**。判据是消费者只有 action 与 error 两片，
  上提到 `src/extras/common.ts` 属于「为了对称再铺一层」；两处语义一致（只看 `then` 是否 callable），
  差别只在访问器抛错时的降级，而 error 侧的调用点本身在边界包裹内。登记为观察，不再动。
- **SKILL.md 三处失真已由主会话先改掉**（`maxSubscribers` 硬上界、`WxStorageBackend` 抛错与降级边界、
  `snapshotState` + `equalityFn` 形参放宽），余下条目交 `skill-md-r5` agent 逐条对源码核实，
  判定落 `.ocr-fix/verdicts5/skill-md.md`。
- **`docs/API.md` 的两处「术语缺席」判定为不需要补**：`cloneOnNotify` 是 `SubscriptionManager.notify`
  的形参名（`@internal`，非公开面），其语义已由「可写注册各拿一份独立深拷贝、只读注册共用一份」的
  正文覆盖（`docs/API.md:59`）；`ExtractPageData` 是类型导出，本文头部第 10 行已写明
  「未在此列出的类型请查阅 `src/types/*.ts`」，且它在 `docs/MIGRATION.md` 的破坏性变更清单里有名有姓。

## skill-md-r5 agent（SKILL.md 同步，21 条台账：FIXED 18 / FP 1 / REJECT 2）的三条交接 —— 主会话处置

1. **`createSelector.ts` 的 `createMemoizedSelector` JSDoc 自相矛盾**（它不能改 src，只登记）：
   示例写 `createMemoizedSelector(fn, (a, b) => a === b)`，而本工厂只转发 `{ cache: true, equalityFn }`、
   **没有 `snapshotState` 出口**——默认快照档下这是「永不命中」的缓存（命中判定是
   `equalityFn(内容快照, 当前状态)`）。**已修**：示例改为默认深比较 + 明确指向
   `createSelector(fn, { cache: true, equalityFn, snapshotState: false })`；顺带发现它的
   `equalityFn` 形参仍是 `(a: unknown, b: unknown)`，与本轮刚放宽的 `SelectorOptions.equalityFn`
   分叉（options 位能写的业务比较器在这个位置参数位报 `TS2345`）。**已一并放宽为 `(a: any, b: any)`**，
   判别性反证：临时改回 `unknown` → `tests/types/selector-equalityfn-variance.typecheck.ts:48`
   立刻报 `TS2345 Argument of type '(a: OrderState, b: OrderState) => boolean' is not
   assignable to parameter of type '(a: unknown, b: unknown) => boolean'`；改回 `any` 归零。
   该锁文件新增第 3 组用例（两条入口口径一致 + 返回位仍不放宽）。
   （踩坑记录：第一次反证用 `grep -c TS2322` 判有无报错，实际代码是 **TS2345**（位置实参）而
   属性位才是 TS2322，于是误判「反证不成立」；改按报错文件行号看输出才纠正。）
2. **SKILL.md 第 34 行缺 `subscription.onLimit` 的默认值 `'evict-oldest'`**（属主会话已改好的段落，
   agent 只记不动）。**已补**。
3. **两条 REJECT 的取舍**（`retrySelector` 的 `NO_ERROR` 哨兵、`StoreConfig`/`ConfigState` 属类型内部面，
   不该进 SKILL.md 用法指南）：**维持 REJECT**。SKILL.md 的定位是「怎么写对」，
   哨兵与深路径别名既无调用方写法可教、也不写会误导。
