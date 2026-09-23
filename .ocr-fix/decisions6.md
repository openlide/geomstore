# 第六轮全库评审（`ocrreview6.md`，114 条 / 180 文件）判定与修复汇总

> 本文件与 `.ocr-fix/verdicts6/**` 是本轮唯一入库的判定结论；`ocrreview6.md`、`.ocr-fix/ledger6.*`、
> `batches6.json` / `fixshards6.json` / `*.mjs` 等中间物由 `.gitignore` 挡在库外，可由原始报告重放。
> 复算：`node .ocr-fix/tally6.mjs`（对账 114 条是否条条有结论）与 `node .ocr-fix/mkdecisions6.mjs`
> （本文件所有表格数字的出处，含主会话改判覆盖）。

## 方法

- **确定性工程交给 `@alibaba-group/open-code-review` v1.12.9**：`ocr scan --preview --format json` 从 400 个文件里选出 180 个可评审文件 / 36,351 行；`ocr delegate rule` 按 pattern 给每批 checklist。
- **判定与修复全部由 Qoder agent 的模型完成**，OCR 自带的 LLM provider 未被调用（delegate 模式）。
- 评审切 16 批（`batches6.json`，文件互不相交、装箱时断言并集 == 可评审集），修复切 13 片 + hot 层（`fixshards6.json`，同样互不相交；hot 层的 9 条 high 由主会话直接做）。
- 工作树在评审起点是干净的（`ocr delegate preview` 报 0 个待评审 diff），所以本轮是**整文件扫描**而不是 diff 扫描。
- 覆盖：total_files 180 / reviewed_files 180 / skipped_files 0 → **100%**，missing 与 extra 均为 0。

## 结论

| verdict | 条数 | 含义 |
| --- | --- | --- |
| FIXED | 112 | 报告成立且已落地 |
| REJECT | 2 | 事实成立但不按报告方向改（见下） |
| FP | 0 | 无一条判为误报 |
| 合计 | 114 | 条条有判定记录 |

| 严重度 | FIXED | REJECT | 合计 |
| --- | --- | --- | --- |
| high | 9 | 0 | 9 |
| medium | 54 | 2 | 56 |
| low | 49 | 0 | 49 |

category：bug 63 · documentation 24 · maintainability 14 · performance 5 · security 4 · test 4。
有 finding 的文件：78 / 180。

**两条 REJECT（均为「主会话改判」，分片台账原文是 NEEDS-MAIN，原文不改）**：

- **R6-046**（medium，`src/extras/action/decorators/debounce.ts`）：`cancel/flush/dispose` 装饰 store action 时静默 no-op，根因是宿主为 `ActionManager` 内部的 actionContext 代理、不可寻址。不暴露该宿主：暴露会把「装饰器内部槽位键」变成跨 core/extras 的公开契约，而收益只有这一组入口可用。改为在模块头与调用点写清限制 + 给两条替代写法，文档同步（`docs/GUIDE.md` §3、FAQ）。
- **R6-114**（low，`tsconfig.json`）：分片按「零配置改动」约束挂起，主会话核实该约束的原话（第五轮 root-config 实修 18 条配置）并不禁止改 tsconfig，且实测去掉基线 `types` 里的 `jest` 后四条 typecheck 与 build 全零错 → 采纳，终口径 FIXED。

## 分片索引

| 分片 | 条数 | 分布 | 台账 |
| --- | --- | --- | --- |
| hot-p0（主会话） | 9 | FIXED 9 | `.ocr-fix/verdicts6/hot-p0.md` |
| f1-01 | 7 | FIXED 7 | `.ocr-fix/verdicts6/f1-01.md` |
| f1-02 | 7 | FIXED 7 | `.ocr-fix/verdicts6/f1-02.md` |
| f1-03 | 11 | FIXED 11 | `.ocr-fix/verdicts6/f1-03.md` |
| f1-04 | 10 | FIXED 10 | `.ocr-fix/verdicts6/f1-04.md` |
| f1-05 | 10 | FIXED 10 | `.ocr-fix/verdicts6/f1-05.md` |
| f1-06 | 7 | FIXED 6 / REJECT 1 | `.ocr-fix/verdicts6/f1-06.md` |
| f1-07 | 10 | FIXED 10 | `.ocr-fix/verdicts6/f1-07.md` |
| f1-08 | 10 | FIXED 10 | `.ocr-fix/verdicts6/f1-08.md` |
| f1-09 | 9 | FIXED 9 | `.ocr-fix/verdicts6/f1-09.md` |
| f1-10 | 10 | FIXED 9 / REJECT 1 | `.ocr-fix/verdicts6/f1-10.md` |
| f1-11 | 1 | FIXED 1（改判） | `.ocr-fix/verdicts6/f1-11.md` |
| f2-12 | 11 | FIXED 11 | `.ocr-fix/verdicts6/f2-12.md` |
| f2-13 | 2 | FIXED 2 | `.ocr-fix/verdicts6/f2-13.md` |

另：`verdicts6/docs-a.md`、`verdicts6/docs-b.md`（文档波次）、`verdicts6/main-followups.md`（跨分片交接、主会话代做与裁定）、`verdicts6/main-cleanup-tests.md`（测试侧遗留 tsc 报错清理）。

## 本轮定稿的行为变更（0.7.0，必须同步 CHANGELOG / docs / skill）

> **计数口径以 `CHANGELOG.md` 的 0.7.0 一节为准**（用 `node .ocr-fix/mkdecisions6.mjs` 同款小节解析器实算）：`Breaking 3 / Changed 19 / Added 3 / Fixed 4 / Docs 4 / Tooling 9 / 明确不修与待拍板 6`；`docs/MIGRATION.md` 展开的是其中「需要改代码 5 条 + 断言或监控需复核 5 条」。下面 9 组是**必须落到门面文档**的对外语义变化，任何一处改写数字都要三份文档同步改（本轮就抓到一次漂移：MIGRATION 写「5 组行为变更」、CHANGELOG 写「六组」而 `Changed` 实为 19 条，已各自改成可核对的表述）。

1. `Store.setState` 对原型链敏感键（`__proto__`/`constructor`/`prototype`）改走 DefineOwnProperty：不再换掉状态对象原型、注入键不再经原型链可见；相等性判定改按自有描述符读取。判据与 `deepMerge` 共用 `core/utils/helpers.ts` 导出的同一份常量（R6-007）。
2. 组合层（`composeStore`）：子 store 在组合之外被独立销毁后，`getState` / `state` / `$snapshot` 与平铺模式归属判定不再抛错，该子店按**空视图**并入并一次性告警；此前一个死店会让整棵组合读不出来（R6-005）。
3. stateProtection 深代理：不可配置且不可写（`Object.freeze` 等）的自有数据属性按 Proxy `[[Get]]` 不变量原样返回裸引用，读取不再抛 TypeError；代价是这类属性不受写保护、写入不计数（R6-006）。
4. 快照克隆引擎与 `deepCloneState` 合流：`Date/RegExp/Map/Set/Array` 的**子类**与「内部槽位承载值」的内建对象（Promise、装箱原始值、ArrayBuffer/TypedArray/DataView、WeakMap/WeakSet、Error、Function）一律**保留原引用**，不再产出 `instanceof` 为真的空壳；数组上的附加自有键会被克隆；快照产物里键一律 `enumerable: true`；同步/异步两条路径同口径（R6-008、R6-099、R6-100 + 主会话 B15）。
5. `compareSnapshots`：返回值新增必填字段 `inputTrusted`，任一侧快照 `success:false` 时 `changed` 恒为 true（表示输入不可信，不表示确有差异）；Map 条目路径改按**键身份**生成并与克隆引擎同方言（`root[A]` 而非 `root[0]`）；内建值按内容比较（R6-050、R6-101 + 主会话 B14）。
6. 异步 action 的**同步段**现在当场补发一次通知：默认模式下「同步段有写入且最终 settle」的通知数由 1 变 2，`onlyOnChange: true` 自动去重仍为 1（R6-037）。
7. 新增公开面：`MonitoringConfig.maxGroups`（缺省 100，非有限值/小于 1 归回缺省）、`createUserStore` 的 `refreshData` action（委托 `syncWithServer`，使「切前台自动刷新」在库自带示例里闭环）。
8. 后台同步不再打假账：缺 `refreshData` 时不打印「刷新状态」，改为一次性告警点名缺失的 action（R6-009）。
9. 工程侧：`.gitignore` 的 `.ocr-fix` 白名单改为**模式**（`!.ocr-fix/decisions*.md` / `!.ocr-fix/verdicts*/**`），不再逐轮点名（此前连续两轮漏放新轮次台账）；CI 新增 `Format check`（`src`/`tests` glob，与 `pnpm format` 同口径）与 `Pack dry-run`，`Build` 改跑 `build:release` 让冒烟真正加载发布产物（R6-010/R6-011）；`.prettierrc.json` 维持 `endOfLine: auto`（lf 方案需要 `.gitattributes` + 全库 renormalize 才能双向都绿，另开一次提交做）。

## 报告外发现并已修

- `snapshot/diff.ts` 的对象分支把「无自有可枚举键的内建值」判等：`compareSnapshots({n:new Number(1)},{n:new Number(2)})` 恒报无差异。修 R6-008 时暴露，根因在 diff 自身口径 → 新增 `isSlotBearingBuiltin` 兜底交 `deepEqual` 判内容。
- `scripts/minify-dist.mjs` 的 `classifyEntry` 与 clean-dist 修复前同一处参照系缺陷（`path.resolve` 不解析重解析点 → Windows junction 下压缩静默空转）。该文件本轮无 finding、无人认领，主会话按正本移植。
- `isIndexKey` 三处私有副本 → 收敛到 `core/utils/clone.ts` 导出，快照两个引擎共用；`extras/action/decorators/cache.ts` 那份属参数序列化域，维持现状。
- `tests/unit/plugins/builtin.test.ts` 的 PERSIST-COVER-018 把「`options` 传 null 必崩」当契约钉住；`installPersistence` 修好判空口径后该锁必须换成新契约（不抛错且默认 wx 后端照常落盘）。

## 门禁实测（收口时全绿，一次性提交的验收依据）

| 门禁 | 实测结果 |
| --- | --- |
| `pnpm run lint:ci`（`eslint src tests --ext .ts --max-warnings 0`） | exit 0，0 problem |
| `prettier --check "src/**/*.ts" "tests/**/*.ts"`（与 CI `Format check`、`pnpm format` 同一组 glob） | 全绿 |
| `pnpm typecheck` / `typecheck:src` / `typecheck:tests` / `typecheck:examples` | 四条全部 exit 0、零错误 |
| `pnpm run build` / `pnpm run build:release` | exit 0（release 走严格压缩，无压缩器即退出码 1） |
| `pnpm run build:weapp` + `pnpm run verify:weapp` | exit 0；**105 个模块 / 11 个公开入口**，字段同源 / 镜像完整 / require 闭环 / 可加载 / 无 outsideDeps / 导出面对齐 / 跨入口单例同一 / 真实用例全过 |
| `npm pack --dry-run` + `pnpm run stubs:clean` | exit 0；**334 个文件**，package size **385.8 kB**、unpacked 1.2 MB，postpack 无 stub 残留 |
| `pnpm test`（`jest --ci --coverage`） | exit 0；**183 套件 / 3749 例全绿**；覆盖率 **99.48 / 98 / 99.75 / 99.64**（statements / branches / functions / lines），**零条阈值告警** |
| `pnpm skill:api` | exit 0；**11 个入口 / 375 个符号**；版本四处同步用例 `tests/unit/r6-f1-02-skill-version-sync.test.ts` 绿 |
| benchmark 冒烟（`npx tsc -p packages/benchmark/tsconfig.json && node packages/benchmark/dist/smoke.js`） | exit 0；**65 条 ok / 0 FAIL**（第五轮是 42 条，f1-03 补了断言） |
| CI 的 ESM + 子路径冒烟（走 Node `exports` 解析器、加载压缩后的 `dist`） | `ESM SMOKE OK`，exit 0 |
| `dist-weapp/` 压缩后实测 | **245.5 KB / 105 个文件**（0.6.1 是 228.3 KB，README 已按实测更正） |

### 门禁收口时补掉的测试缺口（不是代码缺陷）

- 卡点是 `global functions 96.3% < 98%`，根因是 **`src/integrations/index.ts` 这个集成桶此前没有任何测试 import 过**（18 个转发函数里 16 个从未执行）。`jest` 的 `coverageThreshold` 每个文件只进第一个命中分组、`global` 只收四个 glob 之外的文件，所以它落在 global 里。补 `tests/unit/integrations/entry-exports.test.ts`：逐项与叶子模块绑定做**引用相等**比较 + 断言导出键集与文档清单**逐字相同**（多一条死导出、少一条承诺过的 API 都红）+ 经本入口实际调用一次纯函数。该文件转 100/100/100/100，同时把「入口漂移」这条真实风险纳入门禁。
- `src/extras/snapshot/clone-async.ts`：主会话补 11 例（数组附加自有键的各形状、descriptor 在枚举后消失、访问器抛错只丢该键、`Array`/`Date`/`RegExp`/`Set` 子类保留原引用、与同步路径键集同形）。
- `src/extras/action/decorators/cache.ts`（1 个 sort 比较器）与 `src/extras/action/ActionHistory.ts`（1 个空表防御分支）由并行 agent 补齐，两文件现 100 / 96.5x / 100 / 100。
- 两处既有测试锁被按新契约改写（都不是放宽）：`tests/unit/store/action-dirty-keys.test.ts` 的异步投递数断言要按 `describe.each([false, true])` 分模式（默认模式多一个空批次、`onlyOnChange` 去重成一次）；`tests/unit/plugins/builtin.test.ts` 的 PERSIST-COVER-018 原本把「`options` 传 null 必崩」当契约钉住，现按修好的口径断言不抛且照常落盘。


## 遗留与后续单独提交

- `.gitattributes`(`* text=auto eol=lf`) + `git add --renormalize .`：把检出侧钉成 LF 之后才能把 `endOfLine` 切到 `lf`。本轮工作树有 400+ 未提交改动，不做这种难回退的全库归一。
- `packages/**`（benchmark）自 HEAD 起就未过 prettier，10 个文件在 `prettier --check .` 下报红；CI 的 Format check 只圈 `src`/`tests` 所以不红。要不要纳入需一并决定（纳入即一次全文件格式化提交）。
- `src/types/compose.ts` 的 `lazy` / `tree` / `NamespaceConfig`：运行时零消费的公开死选项，f1-10 判 REJECT（不静默删导出，已在类型上标注未实现），删除决策留到 0.7.0 之后的独立破坏性提交。
- `shallowEqual` 与 `deepEqual` 的原型口径、跨 realm 的 `isMapLike`/`isSetLike` 标签并集：第五轮登记的语义债，本轮未动。
- 全量 jest 的 "worker did not exit gracefully" 为既有现象。
- GitHub Release 对象仍未建（无 gh CLI / 无 token）。
