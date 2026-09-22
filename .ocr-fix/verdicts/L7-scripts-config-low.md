# L7-scripts-config-low 判定记录（15 条）

#5 | fix | 实测 `npx eslint --print-config src/index.ts` → `no-undef = [0,{"typeof":false}]`、globals 14 项；flat config 里只有 no-undef 一类规则消费 globals（启用的 81 条中唯一相关项是 no-shadow-restricted-names，只认 undefined/NaN/Infinity/globalThis 固定集），手写清单零参与判定 → 删除 `**/*.ts`（14 项）与 `tests/**`（13 项）两块 globals，原地注释类型来源为 tsconfig lib + @types。改后 print-config globals = {}、`pnpm run lint` 退出 0 且零告警（改前亦零告警，无规则翻转）。
#8 | FP | 读实装 `node_modules/@jest/reporters/build/index.js:401-499`：416 行先试 path 前缀匹配，未命中则 428 行 glob.sync 命中即标 GLOB；GLOB 分支 490-491 对**每个文件单独** check（只有 PATH 分支 483 与 GLOBAL 分支 475 走 combineCoverage 汇总）；439-442 命中任一 glob/path 组的文件直接 return，不再进 GLOBAL 组（445 行才「toss it in global」）。故注释「glob 阈值按单文件执行」「85 档豁免 core/snapshot/selector/action」两条都属实，报告的反向结论（汇总判定 + 仍计入 global 95）不成立。jest.config.js 未改。
#13 | fix | 成立：`npx tsc -p tsconfig.jest.json --showConfig` 改前 exclude 仅 [node_modules, dist]，局部 exclude 整体替换基线（基线含 packages / **/*.example.ts），include 含 src/**/* → 示例文件会进类型检查。已补 `packages` + `**/*.example.ts`（与 medium 波 tsconfig.tests.json 同形），有意**不**抄基线的 `tests`——本配置 include 正需要 tests/**/*，照抄即自我否空。当前 src/tests 下 *.example.ts 实测 0 个，属漂移防护；`tsc -p tsconfig.jest.json --noEmit` 退出 0。tests/tsconfig.json 同一缺陷（越界）→ 待办。
#14 | fix（rootDir 部分为报告失实） | 探针①`npx tsc -p tsconfig.jest.json --noEmit --declaration --declarationMap --sourceMap` 退出 0、零诊断零产出 → 三行 emit 选项与重复的 `noEmit: true` 已删（noEmit 由基线继承，showConfig 复核仍为 true）。探针②`--rootDir ./src`（= 回到基线值）报 **119 条 TS6059**；对 tools/tsconfig.examples.json 同法报 TS6059（examples/index.ts）→ 两处 rootDir 都是必要项，全部保留并就地注释「必要项」，防的就是报告这类误读。
#16 | fix（已由 medium #12 落地，本条复核关闭） | `tsconfig.build.json` 现不含 exclude 段，`--showConfig` 显示继承基线 5 项；有效文件集 105 个文件全在 `./src` 下（showConfig 输出中非 ./src 项 grep 0 命中），`ls src` 亦无 tests/packages 子树 → 报告点名的「根级 no-op exclude」已不存在，无待改项。
#26 | fix（采报告方案二，方案一 reject） | 方案一「在 exports 里镜像老别名」与既定收口冲突（exports 收口是正确性目标，见 scripts/clean-dist.mjs 头 9-11 行），且 package.json 不能写注释 → 改为机器校验防漂移：scripts/generate-subpath-stubs.mjs 新增 files 白名单覆盖检查（按 npm 语义，'plugins/devtools' 由白名单里的 'plugins' 覆盖）。临时副本实测：files 漏 `error` → 退出 1 并点名该目录；补回 → 退出 0 生成 14 个。
#27 | fix | 成立（npm/pnpm pack 与 publish --ignore-scripts 均不跑 prepublishOnly，stub 的 main/types 指向可缺失的 dist）。采报告第二方案在脚本内 fail fast：dist 缺失、或任一 `dist/<rel>/index.{js,d.ts}` 缺失 → 退出 1 且**不落盘任何 stub**（先校验后生成）。临时副本三例：正常 14/exit 0；无 dist/exit 1；删 dist/extras/error/index.d.ts → exit 1 且未生成任何目录。「dist 与源码一致」仍归 prepublishOnly，脚本头注释已写明分工。真实 dist 的 14 个目标 index.js/index.d.ts 实测全部存在 → 不误伤正常打包。
#30 | fix（CI 非零退出部分 reject） | 两脚本补后置校验：clean-dist 以 `existsSync(dist)` + `countFiles` 为准，真清干净才打 `removed dist (N files)`，否则 WARN 并报「仍残留 M 个（清理前 N 个）」；postbuild 删完重扫 map，日志改为 `found / removed / remaining` 三值，消歧「0 = 本就没有」还是「0 = 一个没删掉」，并在「无抛错却仍有残留」时单独 WARN。临时 dist 实测：found 1/removed 1/remaining 0 → found 0/removed 0/remaining 0 → `removed dist (3 files)` 且目录确实消失。「违反不变式即非零退出」不改：残留属「未清理干净」而非「构建错误」是脚本头部既定策略（同 medium #440 维持现状的判例），unlink 半途失败的产物仍可发布；非零退出仅保留给「目标不可信」（符号链接/junction）一类不可回滚情形。
#42 | fix（采报告第二方案） | 聚合入口「哪些已在别处展开」不可机械推导（文档决策），故按报告「至少校验」落地：新增 validateEntries() 在 collectEntries 之后、清空输出目录之前对照 exports 校验 NAME_ONLY，缺失即退出 1。临时副本实测：exports 把 `./core` 改名 `./core2` → 退出 1 点名「NAME_ONLY 中的入口 ./core 已不在 exports 里」，原产出 4 个 md 未被触碰；三项齐备 → 退出 0 产出 main/core/extras.md。
#43 | fix | 成立：toFileName 下 `./a/b` 与 `./a-b` 同映射 a-b.md。validateEntries() 内按输出文件名分组，冲突即退出 1。临时副本实测同时给出 `./a/b` 与 `./a-b` → 退出 1「入口 `./a-b` 与 `./a/b` 的输出文件名同为 `a-b.md`，会互相覆盖」。
#439 | reject | 「workspace scope 变模糊」实测不成立：仓库根 `pnpm -r exec pwd` 只打印 1 行（根目录）→ 无 packages 键时 pnpm 12.3.4 的工作区就是根包，pnpm-workspace.yaml:2 的注释即现状而非隐含假设；同一条命令还证明 pnpm 完全忽略 package.json 的 `workspaces: ["packages/*"]`（否则 benchmark 必被列出）。按报告补 `packages: ['.']` 需 `pnpm install` 复验锁文件与 `-r` 行为，本轮禁安装 → 维持现状，要改随下轮带安装一并做（见待办）。
#444 | fix | 成立：改前 ci.yml 无 concurrency（js-yaml 解析 top-level keys = name,on,permissions,jobs）。已加 `group: ${{ github.workflow }}-${{ github.ref }}`；cancel-in-progress 采 GitHub 文档式表达式，仅对非长期分支取消——main/master/develop 的运行是「已合入代码的验证记录」，被后续推送取消会让最新提交失去 CI 结论；三个分支名与 `on.push.branches` 实测一致。改后 js-yaml 解析通过，keys 含 concurrency（group + cancel-in-progress 两键），12 steps / timeout-minutes 20 未变。
#448 | defer（越界：本轮禁改 .gitignore） | 成立：`grep -n coverage-report.json .gitignore` → 第 17 与 19 行重复（16-20 段实为 coverage/、coverage-report.json、.nyc_output/、coverage-report.json、coverage-*.json）。删 19 行即可 → 待办交主控。
#451 | defer（越界：本轮禁改 .gitignore）+ 报告结论需修正 | 定性成立：`examples/` 在第 34 行「# Temporary files」段下，属误分类。但「会静默排除 docs/tests/build 引用的示例源」不成立——`git ls-files examples` 实测 12 个文件已跟踪，.gitignore 对已跟踪文件无效，克隆与 `pnpm run typecheck:examples`（tools/tsconfig.examples.json include ../examples/**/*）均不受影响。真实风险只有一条且已实测：`git check-ignore -v --no-index examples/newprobe.ts` → 命中 `.gitignore:38:examples/`，即**新增**示例会被静默漏提交。修法建议：把 `examples/` 移出临时段并写明意图；报告给的 `examples/**/dist/` 今天等于删掉该规则（实测 examples/ 下无 dist/、无 node_modules/）→ 待办交主控。
#454 | FP | 实测 `npm pack --dry-run --ignore-scripts` → total files **213**、.md 只有 README.md 与 CHANGELOG.md，与 .npmignore 头部 1-9 行自述完全一致；发布面由 package.json `files` 白名单决定，`.npmignore` 只在白名单被删时兜底，而兜底正需要宽 `*.md`（收窄到根级会在白名单被删时把 docs/*.md、ocr.md 放进包）。「丢弃 LICENSE-*.md」不成立：仓库无该文件，且实测 npm 无条件附带无扩展名的 `LICENSE`（1.1kB 在包内）；nested docs/*.md 已有第 12 行 `docs/` 显式排除，不依赖 `*.md`。唯一属实点是 README 的 negation 冗余（npm 强附 README/LICENSE/package.json），无害；CHANGELOG 的 negation **不**冗余（非强附项，删了会在兜底路径丢 CHANGELOG）。未改。

## 门禁结果（全部改动落地后复跑）
- `pnpm run lint` → 0（零告警）；`pnpm run typecheck` → 0；`pnpm run typecheck:tests` → 0；`pnpm run typecheck:examples` → 0
- `npx prettier --check src/index.ts` → 0（All matched files use Prettier code style）
- `node -e "import('./jest.config.js')..."` → 12 键 / 退出 0（本分片未改 jest.config.js）
- `npx tsc -p tsconfig.jest.json --noEmit` → 0；`--showConfig` → exclude 4 项、noEmit:true（继承）、rootDir "./"
- `node --check` → scripts/clean-dist.mjs、postbuild-dist.mjs、generate-subpath-stubs.mjs、generate-skill-api-reference.mjs、eslint.config.js、jest.config.js 全通过
- js-yaml 解析 .github/workflows/ci.yml → 通过
- 临时探针目录/文件（.probe、tmp-stubs-probe*、tmp-dist-probe*、tmp-skill-probe、tmp-probe-*.json、npm-pack-probe.txt）已全部删除并 `ls` 复核为空；真实 dist/ 未参与任何写入

## 待办（交主控）
1. `.gitignore:19` 删重复的 `coverage-report.json`（#448，本分片禁改 .gitignore）。
2. `.gitignore`：把 `examples/` 移出「# Temporary files」段并写明意图（保留整目录忽略 = 新增示例需 `git add -f`；若只想忽略生成物，examples/ 下当前无生成物）（#451）。
3. 另注：`.gitignore` 未提交的改动实际是 `.env*` 段（`git diff -- .gitignore` 只含 .env 三行 + 2 行注释），**没有** ocr.md 一行；ocr 相关条目只有 .npmignore:47 的 `.ocr-fix/`。ocr.md/review.json 目前未被任何 ignore 规则覆盖（`git status` 显示为未跟踪），其去留请主控与用户定夺。
4. `tests/tsconfig.json` 的 exclude 同样丢了基线项（`../packages`、`**/*.example.ts`），越界未改；本分片已修其父配置 tsconfig.jest.json，下轮同法补齐（#13）。
5. `pnpm pack` / `npm publish --ignore-scripts` 路径的端到端验证：本分片给 generate-subpath-stubs.mjs 加了 dist 前置校验，需在**已构建**的干净工作区实跑一次 `pnpm pack` 确认 14 个 stub 全部落地（本轮禁 build/pack 真跑，仅临时副本验证）。
6. 若要让 pnpm 工作区显式化（#439 的 `packages: ['.']`），需在允许 `pnpm install` 的轮次做，并复验 `pnpm -r exec` 仍只命中根包、锁文件不抖动。
7. `pnpm test:ci` 对 jest 阈值语义（#8 判定为 FP，未改配置）与 src 改动的最终确认，仍归主控统一跑。
