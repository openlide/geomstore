# G7-config-medium-p2 判定记录

#441 | reject | 成立（ci.yml 全文无顶层 permissions，`grep -n permissions` 空）但报告只给 `contents: read` 会打断本 job——末步 `actions/upload-artifact@v4` 调 Runtime Tools API 需 `actions: write`（GitHub 官方要求，Actions 无法本地跑，故按文档补齐）。实际写入 `contents: read` + `actions: write`；`npx js-yaml .github/workflows/ci.yml` 退出 0 且解析出 `"permissions": {"contents":"read","actions":"write"}`。
#442 | fix（成立·本轮未落地） | 事实无误：pnpm/action-setup 非 actions/* 首方 org、`@v4` 为可变 tag（.github/workflows 仅此一处第三方 action）。修法即「换成 commit SHA」，但 SHA 必须外部核验，本沙箱 `git ls-remote https://github.com/pnpm/action-setup refs/tags/v4` 与 WebFetch 均被自动模式拦截 → 盲填 SHA 会直接让 CI 挂。文件未改，列入待办给主控命令。缓解事实：pnpm 本体已由 package.json:116 `packageManager` 的 sha512 锁住。
#443 | fix | 成立：改前 ci.yml `timeout-minutes` 命中 0（verify job 含 install/test:ci/build 三步无上限）。加 `timeout-minutes: 20`（runs-on 之后、strategy 之前），js-yaml 解析出 `"timeout-minutes": 20`。
#445 | reject | 事实成立且已实测：exports 声明 `./extras/selector` → `./dist/extras/selector.js`（package.json:30-33），而 tsc 另 emitted `dist/extras/selector/index.js`，旧 smoke 导的是后者那个「从不发布」的路径，故确实在自证空转。报告修法（改裸包名 `import("@openlide/geomstore/extras/selector")`）依赖 Node 在 `--input-type=module -e` 无模块路径场景下的 self-reference 解析，本沙箱该探针被拦截、无法实测，赌错即 CI 红。改为同等且已验证的做法：smoke 从 package.json `exports` 读出 default 目标再 import，exports 表本身被真正执行；`node --input-type=module -e "<该步骤 body>"` 在仓库根退出 0，输出 `ESM SMOKE OK (exports map exercised)`。
#446 | FP | 前提半对、结论不成立：`# dist` 确为注释，但 Prettier 3.8.1 CLI 的 `--ignore-path` 默认值是 `[".gitignore", ".prettierignore"]`（node_modules/prettier/internal/legacy-cli.mjs:943-953），`dist/`、`coverage/` 由 .gitignore:7/16 覆盖。实测 `npx prettier --file-info dist/index.js` → `{"ignored": true}`、`coverage/lcov.info` → ignored true；对照组 `ocr.md`（仅被 .gitignore 忽略）默认 ignored:true，加 `--ignore-path .prettierignore` 后翻成 ignored:false，机制坐实；`--check .` 输出中 `^\[warn\] (dist|coverage)/` 命中 0。报告所述「noisy diffs」不复现 → 未改。
#447 | fix | 成立且实测有害：`package-lock.json` 不存在（`ls` 报 No such file）属死条目；真锁文件 `pnpm-lock.yaml` 已入 git 且不被 .gitignore 覆盖 → `--file-info` 给 `{"ignored": false, "inferredParser": "yaml"}`，`--check pnpm-lock.yaml` 退出 1（`[warn] pnpm-lock.yaml`），即一次 `--write .` 就会重排 15 万行锁文件。已把该行替换为 `pnpm-lock.yaml`，改后 `--file-info pnpm-lock.yaml` → ignored:true。
#449 | FP | 依赖锚定并未被移除：本仓库锁文件是 `pnpm-lock.yaml`，`git ls-files --error-unmatch pnpm-lock.yaml` 退出 0（已跟踪）、`git check-ignore pnpm-lock.yaml` 退出 1（未被忽略），CI 用 `pnpm install --frozen-lockfile`（ci.yml:31）。`.gitignore:3-4` 只是拦「误用 npm/yarn 时顺手提交的第二把锁」，属 pnpm-only 仓库的常规做法。改后复测这两行行为未变、pnpm-lock 仍 exit 1 → 未改。
#450 | fix | 实测成立：改前 `git check-ignore -q .env.production`/`.env.development` 退出 1（未忽略），`.env.production.local` 退出 0。改为 `.env` + `.env.*` + `!.env.example`（并删被 `.env.*` 吞掉的冗余 `.env.local`）。改后逐项复测退出码：.env / .env.local / .env.production / .env.development / .env.test / .env.staging / .env.production.local 全为 0（忽略），`.env.example` 为 1（负向规则放行，末匹配规则生效）；仓库无任何已跟踪 .env 文件（`git ls-files | grep '\.env'` 退出 1），行为变更零回归。
#452 | fix | 两点均实测成立：`npm pack --dry-run --ignore-scripts`（files 在场）→ 213 文件，全为 dist/** + CHANGELOG.md + README.md + package.json，无 src/tests/docs/scripts（.npmignore 一行都没参与）→ npm 见 files 即弃 .npmignore 属实；「仅 dist」亦不实（CHANGELOG.md 当场在包内，store/ 等 11 个 stub 目录由 prepack 生成后按 files 入包）。修法取「保留文件 + 就地纠错」而非删除，以与 #453 的兜底定位一致：重写头注释，写明 files 为唯一发布清单、实测包内容清单、本文件仅在 files 被删/放宽时生效；顺手把漂移的 `jest.config.cjs`/`.eslintrc.*` 改为仓库真实存在的 `jest.config.js`/`eslint.config.js`。
#453 | fix | 兜底缺口实测成立：临时摘掉 package.json 的 files（用后还原，`git status` 确认 package.json 干净）再 pack → 435 文件，`coverage/base.css`、`.vscode/settings.json` 等确实入包，证明「.npmignore 在场时 npm 不再读 .gitignore」，故 gitignore 覆盖不等于发布安全。已补 `.npmrc`、`.env*`、`coverage/`、`coverage-report.json`、`coverage-*.json`、`.vscode/`、`.idea/`、`.codebuddy/`、`.ocr-fix/`、`*.log`、`.DS_Store`。回归：改后 `npm pack --dry-run --ignore-scripts` 仍 213 文件 → 当前发布面零影响，纯前置加固（安全等级实为纵深防御，非中危可利用）。

## 门禁结果（改动后全量复跑，改前基线同为全 0）
- pnpm run lint → 0；pnpm run typecheck → 0；pnpm run typecheck:tests → 0；pnpm run typecheck:examples → 0
- npx prettier --check src/index.ts → 0（"All matched files use Prettier code style!"）
- node -e "import('./jest.config.js')" → 0（本分片未改 jest.config.js，仅按规跑）
- npx js-yaml .github/workflows/ci.yml → 0，解析出 permissions{contents:read,actions:write}、timeout-minutes:20、4 个 uses 保持
- npm pack --dry-run --ignore-scripts → 0（213 文件，改动前后一致）
- 附加：smoke body 本地跑 → 0；`prettier --file-info`/`git check-ignore` 逐项见上

## 边界与处置说明
- 只改 .github/workflows/ci.yml、.prettierignore、.gitignore、.npmignore；eslint.config.js/jest.config.js/tsconfig*.json/package.json 属分片清单但本分片 10 条无一指向它们（p1 已处理），故未改。package.json 仅做过一次「摘 files」探针，已 cp 还原，git status 中不出现。
- `.gitignore:39` 未提交的 `ocr.md` 行非本分片 finding 对象，按要求原样保留、未删。

## 待办（交主控）
1. #442：在有外网的机器上 `git ls-remote https://github.com/pnpm/action-setup "refs/tags/v4*"` 取 v4 指向的 commit SHA（用 `^{}` 剥 annotated tag），把 ci.yml:22 的 `pnpm/action-setup@v4` 改成 `@<sha>` 并保留 `# v4.x.x` 注释；建议同时开 Dependabot/renovate 管 tags→SHA 更新。
2. #445 可选升级：把 smoke 改为裸包名 `@openlide/geomstore/...`（真正走 Node 解析器而非读 exports 字段）——需先在 CI 里验证 `-e` 场景的 self-reference，本沙箱探针被拦未做。
3. `npx prettier --check .` 在 tests/utils/createTestStore.ts 报 [warn]（该文件 git 状态干净，即基线就不符合 prettier，非本轮任何改动引入）；越界未动，需 `pnpm run format` 或单独 --write。
4. 全量 `pnpm test:ci` / `pnpm build` 对本轮 ci.yml smoke 步骤新写法的最终确认（按约定本轮未跑）。

