# 第五轮判定 · 分片 root-config（22 条，对应 `.ocr-fix/groups5/root-config.md`）

审查对象：`ocrreview.md`（第四轮改完之后的代码）。本分片只动工程配置/CI/脚本文件：
`eslint.config.js`、`jest.config.js`、`tsconfig.typecheck.json`、`package.json`、
`.prettierignore`、`.gitignore`、`.npmignore`、`.github/workflows/ci.yml`、`tools/fix-errors.sh`。

统计：FIXED 18 / FP 3 / REJECT 0 / NEEDS-MAIN 1（另有 3 条在 FIXED 之内附带 NEEDS-MAIN 待办）。

---

### R5-001  verdict=FIXED  tests 不再整条关掉 no-unused-vars，同时取消 no-empty 的测试侧豁免；代价是暴露 59 警告 + 3 错误，需 tests 分片清扫
改了什么：删除 `tests/**/*.ts` 块里的 `'@typescript-eslint/no-unused-vars': 'off'` 与 `'no-empty': 'off'`，两条都改为继承 `**/*.ts` 块（含 `^_` 三组 ignorePattern），并在块注释里写明理由。
验证：`npx eslint --print-config tests/setup.ts` 由 `[0,{...}]` 变 `[1,{"argsIgnorePattern":"^_",...}]`；`npx eslint src tests --ext .ts --max-warnings 0` → `✖ 62 problems (3 errors, 59 warnings)`，明细见下方 NEEDS-MAIN。
NEEDS-MAIN: tests/**（15 个文件、59 处 no-unused-vars 警告）需按 `^_` 前缀或删除处理：with-store.test.ts 8、decorators.test.ts 13、composeStore.test.ts 9、ErrorMonitoring.test.ts 5、SnapshotManager.test.ts 6、utils.test.ts 4、with-app-store.test.ts 2、integration-types.typecheck.ts 2、plugin-hook-args.typecheck.ts 2、LRUCache.test.ts 1、ActionManager.test.ts 2、StateProxy.test.ts 2、StoreCache.test.ts 1、integrations/utils.test.ts 1、ocr-medium-round4.test.ts 1；另 `tests/unit/extras/action/AsyncActionSupport.test.ts:632/635/638` 三处空块触发 `no-empty` 错误。
涉及文件：eslint.config.js。

### R5-002  verdict=FIXED  examples 块的 no-unused-vars 漂移属实，但正确处理是整块删除而非补参数
改了什么：删除整个 `examples/**` override 块。核实其两条规则与基线块重复后仅剩 caughtErrors 差异：`'no-console': 'off'` 与基线 `**/*.ts` 的 `'no-console': 'off'` 逐字相同（基线是显式写的，不是默认值，报告说它是 no-op 说反了），no-unused-vars 与基线对齐后两块完全等价 → 保留即死配置。
验证：`npx eslint --print-config examples/basic/01-simple-store.ts` 删除块前后唯一差异就是 `@typescript-eslint/no-unused-vars` 的 options，删后为 `[1,{"argsIgnorePattern":"^_","varsIgnorePattern":"^_","caughtErrorsIgnorePattern":"^_","caughtErrors":"none"}]`，与 `--print-config src/index.ts` 逐字节相同（no-empty 亦同为 `[2,...]`）。
涉及文件：eslint.config.js。

### R5-003  verdict=FIXED  @tests/* 的 Jest 单边映射确为死配置，两条一起删除
改了什么：删 `moduleNameMapper` 的 `'^@tests/(.*)\\.js$'` 与 `'^@tests/(.*)$'`，并在注释里写明「别名只保留 tsconfig paths 里真实存在的 @/*」，防止再次单边复活。
验证：`grep -rn "@tests/" src tests examples packages tools scripts` 命中 0（仅 jest.config.js 自身两处，已删）；`node -e "import('./jest.config.js')"` mapper 剩 3 条；`npx jest --ci --silent tests/unit/cache` 52/52 通过，`npx jest --ci --silent tests/integration/dirty-skip.test.ts`（走 `@/` 别名）3/3 通过。
涉及文件：jest.config.js。

### R5-010  verdict=FIXED  tsconfig.typecheck.json 不再重写 exclude，直接继承基线那一组，漂移源头消除
改了什么：删掉 `"exclude": ["node_modules","dist","packages","src/**/*.example.ts"]`（漏 tests、示例 glob 收窄），改为注释说明「extends 对数组是整组替换」；`include: ["src/**/*"]` 保留以钉住本配置的边界。
验证：`npx tsc -p tsconfig.typecheck.json --showConfig` 的 exclude 现为基线的 `node_modules/dist/tests/packages/**`；`npx tsc --noEmit -p tsconfig.typecheck.json` 退出 0，`--listFiles` 命中 src 文件 105 个（与改前同集合，因 include 仍限 src 且 src 下 `find src -name "*.example*"` 为空 → 本次行为中性，与报告判断一致）。
涉及文件：tsconfig.typecheck.json。

### R5-011  verdict=FIXED  @eslint/js 是 eslint.config.js 的直接 import，已声明为 devDependency
改了什么：devDependencies 增 `"@eslint/js": "^9.39.2"`（与 eslint 同 major）。核实报告前提成立：`eslint` 自带 `"@eslint/js": "9.39.2"` 依赖，本仓 `node_modules/@eslint/js` 是它被 hoisted 提升后的副本（`node -e require('./node_modules/@eslint/js/package.json').version` → 9.39.2），`pnpm-workspace.yaml` 的 `nodeLinker: hoisted` 注释也确实预告了「环境允许时可删本项回到 isolated」。
验证/配套：改 package.json 后 `pnpm run ...` 触发 pnpm 12 的 run 前依赖自查并自动补锁，`git diff -- pnpm-lock.yaml` 只多出 `importers['.'].devDependencies.'@eslint/js'` 3 行（specifier ^9.39.2 / version 9.39.2），故 CI 的 `pnpm install --frozen-lockfile` 不会因本改动红；该 3 行是 package.json 改动的必要配套，非我手改锁文件。`npx eslint src tests --ext .ts` 改后仍退出 0。
涉及文件：package.json（+ pnpm-lock.yaml 由 pnpm 自动同步的 3 行）。

### R5-012  verdict=FIXED  lint:ci 阈值由 70 收到 0，第四轮清完后确实已到零告警基线
改了什么：`"lint:ci": "eslint src tests --ext .ts --max-warnings 0"`。
验证：改动落地前（tests 仍豁免 no-unused-vars 时）`npx eslint src tests --ext .ts -f json` 汇总为 `warnings 0 / errors 0`（232 文件）→ 70 的余量当时就是纯静默空间；现因 R5-001 同时生效，门禁当前状态为 62 problems，需 R5-001 的 NEEDS-MAIN 清扫后才能变绿——这是刻意保留的显式红，不做基线冻结。
涉及文件：package.json。

### R5-369  verdict=FIXED  .prettierignore 补上 dist；「Prettier 会递归进产物」在默认调用下仍不成立，但显式 --ignore-path 模式下成立（新证据）
改了什么：`# dist` 取消注释为 `dist`，并把「默认调用读 .gitignore + .prettierignore、显式 --ignore-path 只读本文件」的分工写进注释。
验证（新证据，第四轮 #446 只测了默认模式）：改前 `npx prettier --file-info dist/index.js` → `{"ignored": true}`（.gitignore 兜住，报告结论仍不成立），但 `npx prettier --ignore-path .prettierignore --file-info dist/index.js` → `{"ignored": false, "inferredParser": "babel"}` —— 只认 .prettierignore 的调用方式确实会把产物当源码格式化；改后同一命令翻成 `{"ignored": true}`。
涉及文件：.prettierignore。

### R5-370  verdict=FP  依赖锚定并未被移除：真正使用的 pnpm-lock.yaml 一直入库且未被忽略
为什么不改（事实层）：报告把「忽略 package-lock.json / yarn.lock」读成「忽略锁文件、CI 跑浮动范围」。实测 `git ls-files --error-unmatch pnpm-lock.yaml` 退出 0（已跟踪）、`git check-ignore -v pnpm-lock.yaml` 退出 1（未被任何规则命中），`.github/workflows/ci.yml` 两条 job 都是 `pnpm install --frozen-lockfile` → 同 tag 两次构建的依赖树一致，供应链 diff 审查可正常做；那两行只拦「误用 npm/yarn 时顺手提交的第二把锁」。与第四轮 #449 同一结论，无新证据。
仍采纳报告的第二方案（若属刻意则写明策略）：在 `# Dependencies` 段补 4 行策略注释，点名 pnpm-only 与 --frozen-lockfile，避免下轮再被当漏洞报。
涉及文件：.gitignore。

### R5-371  verdict=FIXED  审查素材与 coverage-*.json 全部锚到仓库根
改了什么：`ocr.md` → `/ocr.md`、`ocrreview.md` → `/ocrreview.md`、`review.json` → `/review.json`、`coverage-*.json` → `/coverage-*.json`，并写明锚定理由。
验证：改前 `git check-ignore -v docs/ocr.md` → `.gitignore:53:ocr.md`、`docs/review.json` → `.gitignore:55:review.json`（子包/文档目录同名合法文件会被静默吞掉，报告成立）；改后这两条命令均无输出（退出非 0），而根级 `ocr.md`/`ocrreview.md`/`review.json`/`coverage-foo.json` 仍分别命中 `.gitignore:62/63/64/24`。`git ls-files | grep -E '(^|/)(ocr\.md|ocrreview\.md|review\.json|coverage-[^/]*\.json)$'` 退出 1 → 无已跟踪文件受影响的边界。
涉及文件：.gitignore。

### R5-372  verdict=FP  该条在本轮开始前已由主会话按建议改完，现规则实测就是「整目录忽略 + 判定台账白名单」
为什么不改：当前 .gitignore 已是 `.ocr-fix/*` + `!.ocr-fix/decisions.md` / `!.ocr-fix/verdicts*/` 的写法（报告看到的是第四轮收尾前的 `groups/`+`ledger.*` 三行版本）。
验证：`git check-ignore -v .ocr-fix/state.json .ocr-fix/ledger5.json .ocr-fix/groups5/root-config.md` 三条全部命中 `.gitignore:56:.ocr-fix/*`（中间产物被忽略），`git ls-files .ocr-fix` 只有 decisions.md 与 verdicts/* 两类（白名单生效），`git status --short --untracked=all .ocr-fix` 显示 `?? .ocr-fix/verdicts5/tests-p2.md`（新账本目录可被 add，无需 -f）。
涉及文件：无（只读核对）。

### R5-373  verdict=FIXED  取消 examples/ 整目录忽略：新证据表明它在破坏 CI，而不只是「要 git add -f」
为什么本轮推翻第四轮 #451 的「保留整目录忽略 + 注释」处置（新证据）：CI 有 `pnpm run typecheck:examples` 一步，`tools/tsconfig.examples.json` 的 include 覆盖整个 `../examples/**/*`；而已跟踪的 `examples/weapp/{page,app,component}-integration.ts` 在第 35/36/43/66 行顶层调用 `App(` / `Page(` / `Component(`，这三个全局只由 **被忽略的** `examples/global.d.ts` 声明（`grep -rn "declare function (Page|App|Component)" src tests tools examples` 全仓唯一命中该文件）。→ 干净检出缺 global.d.ts，该步骤必然报 TS2304；被忽略的还有 `examples/{basic,cache,advanced,weapp}/index.ts` 与整个 `examples/extras/`（`git status --short --ignored examples` 折叠成 6 行、展开为 9 个文件）。这不是「本地试验目录」，是仓库源码 + CI 覆盖面。
改了什么：删除 `examples/` 忽略规则，改写为 5 行说明（examples 属源码、被 tsconfig.examples 覆盖、新增示例不再需要 `-f`）。未采用报告建议的「`examples/*` + 逐个 `!` 反选」——那等于给当前已跟踪文件做基线冻结，与本仓「不加白名单/不做基线冻结」口径相反。
NEEDS-MAIN: 请执行 `git add examples/` —— 取消忽略后可见 9 个未跟踪文件（`git status --untracked-files=all examples`）：`examples/{advanced,basic,cache,weapp}/index.ts` 四个汇总入口、`examples/extras/{index,action-decorators,selector,snapshot}.ts` 四个、以及 `examples/global.d.ts`；不加进去 CI 的 typecheck(examples) 仍会因缺 `App/Page/Component` 声明而红。
涉及文件：.gitignore。

### R5-374  verdict=FIXED  头注释去掉「213 文件」这类会漂移的实测数，并修掉自相矛盾的表述
改了什么：删除 `当前发布面 = 213 文件` 的逐项枚举，改为「本文件不复制文件数/清单，要看发布面就读 package.json > files」，并把矛盾点写清：`--ignore-scripts` 会让 prepack 钩子根本不执行，所以那次 dry-run 量不到任何 stub 目录（原注释既把 stub 目录算进 213、又说 dry-run 时缺席，正是报告指出的自相矛盾）；同时保留「npm 无条件补 README/LICENSE」这一事实与「仅 dist 不准确」的结论。
验证：`node -e` 读 package.json 的 files 计数 = `dist` + `CHANGELOG.md` + 11 个子路径 stub 目录名（store/hooks/plugins/integrations/compose/selectors/snapshot/performance/actions/cache/error），与注释一致；`npm pack --dry-run --ignore-scripts` 现测 215 文件（dist/** 211 + README + CHANGELOG + LICENSE + package.json，stub 目录因 prepack 未跑而缺席），进一步说明「写死数字」不可靠。
涉及文件：.npmignore。

### R5-375  verdict=FP  兜底路径下 !CHANGELOG.md 实测生效；报告给出的 diff 自身是 no-op
为什么不改：① 机制层证据——`C:\Program Files\nodejs\node_modules\npm\node_modules\npm-packlist\lib\index.js:280-293` 的强制清单只有 `'!/package.json'`、`'!/readme{,.*[^~$]}'`、`'!/copying...'`、`'!/license/licence...'`，外加硬排除 `/.git`、`/node_modules`、`.npmrc`、`/package-lock.json`、`/yarn.lock`、`/pnpm-lock.yaml`：CHANGELOG **不在**强附列表里，也就是它能进包完全是 `!CHANGELOG.md` 起了作用。② 行为层证据——把本文件原样放进一个无 `files` 字段的探针包跑 `npm pack --dry-run --ignore-scripts`，Tarball Contents 里同时出现 `CHANGELOG.md`、`README.md`、`LICENSE`、`package.json`，`docs/guide.md` 缺席 → negation 在 npm-packlist 语义下确实生效，「可能不生效而被丢掉」不复现。③ 报告的建议 diff（`docs/**`、`examples/**/*.md` 与 `*.md` 并存）本身矛盾且冗余：`docs/` 与 `examples/` 第 9/10 行已整目录排除，加 `docs/**` 不改任何东西。
涉及文件：无（.npmignore 的 `*.md` + 两条 negation 原样保留）。

### R5-376  verdict=FIXED  兜底规则补齐 packages/ tools/ tmp/ 与凭据/压缩包类，报告的缺口实测成立
改了什么：新增 `*.pem`、`*.key`、`*.p12`（凭据段）与 `packages/`、`tools/`、`tmp/`、`.changeset/`、`.husky/`、`.turbo/`、`*.tgz`、`*.zip`（仓库级开发目录/打包中间物段），并注明 npm-packlist 的硬排除只有 .git/node_modules/各类锁文件/.npmrc。
验证：探针包（无 `files` 字段 + 旧 .npmignore）实测 `total files: 8`，其中 `packages/benchmark/package.json`、`tmp/scratch.txt`、`secret.pem` 三项确实入包 → 缺口为真；`tools/fix-errors.sh` 当时只因 `tsconfig*.json` 恰好命中那条死条目才没进包，同类文件（如 `tools/*.sh`）在兜底路径下同样会外泄。补规则后仓库侧 `npm pack --dry-run --ignore-scripts` 仍 215 文件、grep 不到 src/tests/docs/scripts/coverage/packages 真实泄漏 → 当前发布面零影响，纯纵深加固。
涉及文件：.npmignore。

### R5-364  verdict=FIXED  「actions: write 是 upload-artifact 前置权限」这句无法在本沙箱核实，按报告的下限方案收窄到单个 job
改了什么：工作流级 `permissions` 只留 `contents: read`；`actions: write` 下移到真正上传制品的 `jobs.verify.permissions`（连带 R5-367 拆出的 `verify-static` 只继承 `contents: read`，跑 PR head 代码的静态检查 job 不再拿到仓库级 Actions 写权限）。注释改为如实写明「本轮仍无法离线核实该说法」，不再把未经证实的断言当既成事实陈述。
验证：`node -e require('js-yaml').load(...)` 解析后 `permissions` = `{contents: "read"}`，`jobs.verify.permissions` = `{contents:"read", actions:"write"}`，`jobs.verify-static.permissions` = undefined（继承工作流的最小权限）；报告说的「步骤级收窄」在 GitHub Actions 里做不到（permissions 只能挂在 workflow/job 两级），故取 job 级。
涉及文件：.github/workflows/ci.yml。

### R5-365  verdict=NEEDS-MAIN  第三方 action 仍未钉 SHA，本环境无任何可达的核验通道，盲填会直接挂 CI
现状：`.github/workflows/ci.yml` 三处 `uses` 为 `actions/checkout@v4`、`pnpm/action-setup@v4`、`actions/setup-node@v4`、`actions/upload-artifact@v4`，其中只有 `pnpm/action-setup` 非 actions/* 首方 org。文件未改。
为什么不改（与第四轮 #442 同因，非偷懒）：需要 `refs/tags/v4` → 40 位 commit SHA 的权威映射，本会话内 `git ls-remote https://github.com/pnpm/action-setup refs/tags/v4*`、WebFetch(api.github.com)、WebSearch 三种通道均被环境策略拦断，拿不到可核对的 SHA；填错一个字符 CI 立刻 `Unable to resolve action`。缓解事实：pnpm 本体已由 `package.json > packageManager` 的 `pnpm@12.3.4+sha512...` 钉死。
NEEDS-MAIN: `.github/workflows/ci.yml` —— 在有外网的机器上 `git ls-remote https://github.com/pnpm/action-setup "refs/tags/v4"`（annotated tag 需再解 `v4^{}` 指向的 commit），把第 37 行与第 77 行的 `pnpm/action-setup@v4` 换成 `pnpm/action-setup@<40位SHA> # v4.x.y`，并建议配 Dependabot/renovate 管 tags→SHA 更新。
涉及文件：无（.github/workflows/ci.yml 待主会话补）。

### R5-366  verdict=FIXED  冒烟步骤改走 Node 真实 exports 解析（自引用 import），并遍历 exports 表全部子路径
改了什么：删掉 `import.meta.resolve("./") + new URL("./" + exp[key].default ...)` 的手工拼路径，改 `const s = await import(name)` 与 `await import(name + "/extras/error")`；另加一段对 `Object.keys(exp)` 的遍历，除 `.` 与 `./package.json` 外每个子路径都必须被 Node 解析出非空模块（键名/条件顺序/default 缺失都会当场红），并显式校验 key 以 `./` 开头。
验证：把改后 YAML 里该 step 的 `run` 原文抽出来在仓库根实跑（当前 dist 为第四轮产物）→ 输出 `ESM SMOKE OK (exports map exercised by node resolver)`，退出 0；遍历对 10 个子路径分别报出 28/18/40/4/6/5/17/9/6/31 个导出，说明每个都经真实解析器命中。
涉及文件：.github/workflows/ci.yml。

### R5-367  verdict=FIXED  lint 与三项 typecheck 抽成单腿 verify-static，矩阵只留 Test/Build/Smoke
改了什么：新增 `verify-static`（Node 22，checkout → pnpm/action-setup → setup-node(cache: pnpm) → install → lint:ci → typecheck → typecheck:tests → typecheck:examples），`verify` 矩阵 job 名称改为 `Test / Build / Smoke (Node ${{ matrix.node-version }})` 并只保留 install/test:ci/build/smoke/upload 六步；两 job 各自 `timeout-minutes: 20`。
验证：js-yaml 解析 → `jobs: [verify-static, verify]`，两 job steps 均 8、timeout 20，`verify.strategy.matrix` = `{node-version:[22,24]}`；被移出的四条命令与 package.json scripts 逐字一致（与 Node 22/24 无关的判断依据：tsconfig `target: ES2020` + eslint/typescript 全在锁定的 devDependencies 里）。
涉及文件：.github/workflows/ci.yml。

### R5-368  verdict=FIXED  覆盖率制品改为 if-no-files-found: error
改了什么：`Upload coverage report` 步增 `if-no-files-found: error` 并注释理由（缺文件说明产出链断了，要红不要告警）。
验证：`jest.config.js` 的 `coverageReporters` 含 `'html'`（无自定义 outputDir，落 `coverage/lcov-report`），本地实测 `ls -d coverage/lcov-report` 存在且 `coverage/lcov.info` 157KB → 门禁路径名正确，收紧不会误红。
涉及文件：.github/workflows/ci.yml。

### R5-037  verdict=FIXED  脚本改用 pnpm（与 CI 同入口），并显式给 jest --ci；报告建议的 `pnpm test -- --ci` 写法实测会把 jest 弄挂
改了什么：`npm run build` → `pnpm run build`、`npm test` → `pnpm test --ci`，并写明理由（npm 绕开 pnpm 锁文件/workspace 布局，且会在根目录生成正被 .gitignore 忽略的 package-lock.json）。
验证（新证据，修正报告的 diff）：pnpm 12.3.4 下 `pnpm test -- --listTests` 实际执行的是 `jest "--" "--listTests"` → `No tests found, exiting with code 1`（`--` 被原样转给 jest，`--ci` 会被当成测试路径正则）；正确写法 `pnpm test --ci --showConfig` 打印 `jest "--ci" "--showConfig"` 且配置里 `"ci": true`。故采用不带 `--` 的形式。
涉及文件：tools/fix-errors.sh。

### R5-038  verdict=FIXED  跑 build/test 前先自查 pnpm 与 node_modules/.bin 可执行文件，给出可执行提示
改了什么：`package.json` 存在性检查之后补两道前置守卫——`command -v pnpm`（缺失提示启用 corepack，依据 `package.json > packageManager`）与 `[ -x node_modules/.bin/tsc ] || [ -x node_modules/.bin/jest ]`（缺失提示 `pnpm install --frozen-lockfile`），两条都走 stderr + exit 1。
验证：本机 `node_modules/.bin/{tsc,jest,eslint}` `-x` 探测全 OK（hoisted 布局下 Git Bash 可见 shims）；在 /tmp 造的同结构假仓库上实测三种路径——只放 package.json → 报「依赖未安装：node_modules/.bin 下缺 tsc 或 jest…」、再放可执行 stub → 打印「校验 GeomStore（仓库根：…）...」并继续、无 package.json → 报仓库根定位失败。
涉及文件：tools/fix-errors.sh。

### R5-039  verdict=FIXED  脚本自身是符号链接时先逐级还原，readlink 缺失则降级并由 package.json 守卫兜住
改了什么：`SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)` 换成 `${BASH_SOURCE[0]:-$0}` + `while [ -L "$SOURCE" ]` 逐跳还原（只用无 `-f` 的 readlink，绝对/相对目标分别处理），注释保留原判断（`readlink -f` 在 BSD/macOS 语义不同）并说明降级路径。
验证：`bash -n tools/fix-errors.sh` 退出 0；从 `/` 目录调用还原后的脚本，仓库根解析仍正确（打印 `仓库根：/tmp/tmp.xxx/fakerepo`）。本机 Windows 环境无法造软链（`ln -s` 静默退化为复制、`MSYS=winsymlinks:nativestrict ln -s` 报 Operation not permitted），故软链命中分支未做端到端跑测；逻辑分支已由 `[ -L ]` 守卫，最坏情况退化为改动前行为并被 R5-038 的 package.json 检查明确拦下（不会在错误目录跑 build）。
涉及文件：tools/fix-errors.sh。

---

## 附 1：分片内顺带修正（不占 R5 编号）

- `.gitignore:17` 写的是 `scripts/generate-subpath-stubs.cjs`，该文件不存在（`ls scripts | grep -i stub` → 只有 `generate-subpath-stubs.mjs`，`package.json` 的 prepack/postpack 亦指向 `.mjs`），已就地改为 `.mjs`。

## 附 2：本轮对门禁的净影响（供主会话核对）

- `npx tsc --noEmit -p tsconfig.typecheck.json` → 0；`npx tsc --noEmit -p tools/tsconfig.examples.json` → 0；`npx tsc --noEmit -p tsconfig.tests.json` → 2 处错误全部来自其他分片正在改的 `tests/types/integration-types.typecheck.ts`（引用尚未定义的 `PageReservedKeys`）与未跟踪的临时探针 `tests/types/zz-probe.typecheck.ts`，与本分片改动无关。
- `npx jest --ci --silent tests/unit/cache` 52/52、`tests/unit/core/error` 303/303、`tests/integration/dirty-skip.test.ts`（走 `@/` 别名）3/3 全绿；`npm pack --dry-run --ignore-scripts` 仍 215 文件 → 发布面零变化。
- `npx eslint src tests --ext .ts --max-warnings 0` → `✖ 62 problems (3 errors, 59 warnings)`，全部落在 tests/**，清单见 R5-001 的 NEEDS-MAIN；这是刻意的显式红，不做基线冻结。
- R5-011 落地过程中 pnpm 12 的 run 前依赖自查自动补了 `pnpm-lock.yaml` 的 3 行 importer 条目（`git diff -- pnpm-lock.yaml` 仅此 3 行），属 package.json 改动的必要配套，请一并入库。
