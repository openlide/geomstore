# 参与贡献

感谢参与。本文说明环境、门禁与约定；提交前请确保**与 CI 完全一致**的门禁在本地全绿。

## 环境

- **Node.js ≥ 22**（CI 在 22 / 24 上双跑），包管理器用 **pnpm**
- 仓库为纯 ESM：源码、测试、脚本一律 `import` / `export`（ESLint 的 `@typescript-eslint/no-require-imports` 已设为 `error`）

```bash
pnpm install
pnpm test          # 全量测试
```

## 目录结构

本仓库 `src/` 的树与各子目录职责的正本在 [ARCHITECTURE.md「目录结构与职责」](./docs/ARCHITECTURE.md#3-目录结构与职责)，本文件不复制第二份。其余顶层目录：

| 目录                 | 作用                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/`             | `unit`（按领域分目录）+ `integration`                                                                                                                                                                         |
| `examples/`          | 可运行示例。它是**仓库源码**、随 CI 的 `typecheck:examples` 全量编译                                                                                                                                          |
| `docs/`              | 文档。**不随 npm 包发布**（`files` 白名单里没有它）                                                                                                                                                           |
| `CHANGELOG.md`       | 发版记录。**刻意不随 npm 包发布**：对包使用者零价值（完整历史在仓库与 GitHub 上），体积却实打实地计入每个安装者的下载与 CI 缓存成本。`files` 白名单与 `.npmignore` 的兜底规则两处都不放行，改一处必须改另一处 |
| `scripts/`           | `clean-dist` / `postbuild-dist` / `minify-dist` / `build-weapp` / `verify-weapp-bundle` / `weapp-entries` / `generate-subpath-stubs` / `generate-skill-api-reference`                                         |
| `packages/benchmark` | 性能基准。**不是 pnpm 工作区成员**（`pnpm-workspace.yaml` 无 `packages:` 键），根目录的 `pnpm` 命令与 `--filter` 都不作用于它                                                                                 |

**分层原则**：`extras/*` 的实现不得被核心反向依赖；核心只保留运行必需 API。若某能力只有部分用户需要，它就应该出现在 `extras`。

## 门禁（与 CI 一致，必须全绿）

```bash
pnpm lint:ci          # ESLint，--max-warnings 0：零告警即门禁，不做基线冻结、不加白名单
pnpm format:check   # 格式（CI 的 Format check 就是这一条；修复器是 `pnpm format`，两者共用 package.json 里同一组 glob）
pnpm typecheck        # 源码
pnpm typecheck:tests  # 测试代码（tsconfig.tests.json；CI 独立成步，别指望它被 src 的检查顺带覆盖）
pnpm typecheck:examples
pnpm test:ci          # jest --ci --coverage
pnpm build            # clean-dist → tsc → postbuild（校验 dist 非空、写 module-type 标记、移除 sourcemap）
npx tsc -p packages/benchmark/tsconfig.json && node packages/benchmark/dist/smoke.js   # benchmark 包冒烟（CI 同一条）
```

`packages/benchmark` 不在 pnpm 工作区内，所以 `pnpm --filter` / 子包目录下的 `pnpm install` 都不适用：它借根装的 `typescript` 编译，产物落 `packages/benchmark/dist/`（被 `dist/` 规则忽略）。要把它接进工作区，前提是先补齐它自己的 devDependencies 安装路径并重生成锁文件——否则保持「声明了却没接入」的自相矛盾状态就是缺陷。

**格式门禁**：CI 的 `Format check` 步就是 `pnpm format:check`（glob 只在 `package.json` 里定义一次，这里不重抄），覆盖 `src` / `tests` 的 TS 与**全部手写文档 md**。生成物 `.codebuddy/skills/geomstore/references/api/**` 由 `.prettierignore` 排除：对它跑格式化器会**改动内容**（转义块引用内粗体跨度里的星号、把三反引号围栏抬成四反引号、并按 `semi:false` 删掉 `.d.ts` 声明行末的分号——实测某文件 20 行剩 1 行），而这份文件的契约恰恰是「逐字取自类型声明原文」，它的正确性由「与 `.d.ts` 一致」保证、不由排版门禁保证。手写文档实测幂等且不改动内容。`.ocr-fix/**` 是复审工作记录、不是文档产品，门禁的 glob 从不点名它。

**换行符口径（已归一，不要再改回 `auto`）**：仓库根 `.gitattributes` 用 `* text=auto eol=lf` 把仓库内与检出侧统一钉成 LF，`.prettierrc.json` 因此直接判 `endOfLine: lf`——`Format check` 现在**既判格式也判换行**，本地与 Linux runner 判据一致。归一是在检出侧做的（把工作树文件写成 LF），仓库侧一个字节都没变：index 侧 461 个文件本来就全是 LF，所以 `git add --renormalize .` 是**空操作**，那次提交不含 400 文件的churn。`core.autocrlf=true` 会被 `.gitattributes` 覆盖，本机不必再调 `git config`。

刻意**没有**给 `pnpm-lock.yaml` 加 `-text`，别按某些旧注释的说法把它加回去：`-text` 只是关掉 git 的换行转换，若包管理器在某平台写出 CRLF 就会**原样进仓库**；而 `eol=lf` 在 add 时归一回 LF，是自愈的。锁文件是纯文本，LF 入库正是我们要的结果。同理不罗列 `*.png -text` 之类的豁免——`text=auto` 自带 NUL 探测，将来加入的真二进制会自动被识别，而本仓库当前没有任何二进制文件。

**脚本改写文件的实操坑（归一之后换了方向）**：批量改写时**不要给行尾额外补 `\r`**。按 `split('\r\n')` 切出来的元素本身已不含 CR，再 `join('\r\n')` 就够；若此时又给插入行 `+ '\r'`，会造出 `\r\r\n`，症状是 CR 计数**大于**行数、`git ls-files --eol` 报 `w/-text`。反过来把 LF 文件的若干行写成 CRLF 会让文件变 `w/mixed`、`git diff` 从「改了几行」膨胀成「整个文件重写」。两个方向都要断言：`tr -cd '\r' | wc -c` 应当等于 `0`（本仓库现在应当全是 LF），而不是"等于行数"。

CI（`.github/workflows/ci.yml`）分两条 job：`verify-static`（Node 22 单腿）跑 lint:ci + `Format check` + 三项 typecheck + 上面那条 benchmark 冒烟，`verify`（Node 22/24 矩阵）跑 test:ci / `build:release` / `build:weapp` + `verify:weapp` / `npm pack --dry-run` / 冒烟 / 制品上传。另有三条约束，本地复现时注意：`concurrency` 对非长期分支取消旧运行、工作流级 `permissions` 只有 `contents: read`（`actions: write` 单独下放给上传制品的 `jobs.verify`）、两条 job 各自 `timeout-minutes: 20`。

CI 在 `build` 之后还会跑 **ESM + 子路径冒烟**：它从 `package.json` 的 `exports` 里读出每个子路径的 `default` 目标再 `import`（改动构建或 `exports` 时请本地复现；不要改成硬编码 `dist/...` 路径，那会导出 tsc 顺带产出、从不发布的目录形状，冒烟就成了自证空转）：

```bash
node --input-type=module -e 'const s = await import("./dist/index.js"); console.log(typeof s.createStore)'
```

## 测试约定

- **按领域放置**：新测试放到对应模块的目录（`tests/unit/extras/snapshot/…`），不要新建按时间/批次命名的文件
- **覆盖率即契约**：门禁就是 `jest.config.js` 的 `coverageThreshold`——global 语句 / 函数 / 行 98、分支 95，`./src/core/**` 与 `./src/extras/{snapshot,selector,action}/**` 按**单文件**再加分支 85 下限（jest 对 glob 阈值逐文件执行）。新增分支要么写测试覆盖，要么确实不可达并加 `/* istanbul ignore … */`，且**必须在注释里写明为什么不可达**（不接受无理由标注）。不要为了文档措辞好看去调低阈值，也不要为了凑数字删掉防御
- **不要靠私有状态通吃**：优先使用公开 API 或测试缝；确需触碰内部（如构造越界状态）时，用 `as unknown as { … }` 并写明成因
- **全局对象要真还原**：备份为 `undefined` 时用 `Reflect.deleteProperty`，否则会留下 `{ wx: undefined }` 这类残键，影响 `'wx' in globalThis` 判断
- **定时器**：打桩 `setTimeout`/`setInterval` 时若底层仍创建真实定时器，必须留存真实句柄以便清理，否则 jest worker 无法优雅退出
- 避免恒真断言（`toBeDefined()`、`isFinite(...)`）：要么断言具体字段，要么在用例名中声明「仅冒烟」

## 代码约定

- TypeScript `strict`；**避免 `any`**（测试里也不滥用），类型收窄优先于断言
- 注释解释**为什么**，而不是复述代码在做什么；对不直观的兜底、上限、复杂度处理尤其要写清楚
- **同一语义的默认值只允许有一处来源**：跨文件复用的缺省值导出常量 + `normalize*` 函数（范例：`ACTION_LOADER_DEFAULTS` / `normalizeActionLoaderOptions`、`DEFAULT_MAX_LOG_SIZE`），不要再写第二份 `options.x ?? 字面量` 镜像。这类「注释自称同口径、值各持一份」的漂移过，且后果是行为错配而非数值难看（`withLoading` 的注册表按归一化选项分桶，默认值不一致就会拆桶）。它们默认**不是公开 API**（未经 barrel 再导出），注释要写明可达范围
- 生产代码里避免为了覆盖率而改写表达式结构；确需改写时保持**语义等价**并在提交说明中标注
- 公共 API 的类型一旦发布即视为契约：放宽（如泛型变宽、参数变可选）是非破坏性改动，收紧或重命名需要在 CHANGELOG 标注 **Breaking**
- 行为变更（错误语义、通知时机、默认值）必须在 CHANGELOG 中说明影响面与迁移方式

## 构建与发布

- 子路径转发目录（`store/`、`hooks/`、`plugins/`、`integrations/` 等）由 `prepack` 生成、`postpack` 清理；手动入口为 `pnpm stubs` / `pnpm stubs:clean`
- 发布走 `prepublishOnly`：`pnpm test && pnpm run build:release && pnpm run build:weapp && pnpm run verify:weapp`。`build:release` 使用**严格压缩**——无可用压缩器时以退出码 1 中止，杜绝静默发出未压缩包
- **两份产物、两条链路**：`dist/` 是给 Node 与打包器的 ESM（`exports` 指向它）；`dist-weapp/` 是给微信「构建 npm」的 **按模块一比一转译的 CJS**（105 个模块与 `dist` 一一对应、模块间保留相对 `require`），由包根 `miniprogram` 字段指向、工具整目录拷贝。**不要改成「bundle 成单文件」**：esbuild 的 `--splitting` 只支持 esm，CJS 多入口 bundle 会把 core 重复内联（实测 457.1 KB vs 228.3 KB），更要命的是每个入口各持一份模块实例，`.` 与 `./core` 的 `globalRegistry` 会变成两个对象——`verify:weapp` 里的「跨入口单例同一性」断言就是钉这一条的。改 `exports` 时两条链路都要顾：`build-weapp.mjs` 的入口清单是从 `exports` 派生的（`scripts/weapp-entries.mjs` 单一实现），子路径的 `default` 不是 `./dist/**.js` 形状时构建直接失败，而不是悄悄少发一个入口。0.6.0 的坏产物能发出去，就是因为 `test` / `build` / `pack` 没有一个会加载要被微信拷走的那份文件；缺陷特征与判据见 CHANGELOG 的 `[0.6.1]` 一节
- **发版清单**（版本号散在四处，漏一处就有一条陈述变假话）：
  1. `package.json` 的 `version`
  2. `src/integrations/enterprise/hot-update.ts` 的 `LIBRARY_VERSION` —— 与 1 是**手工镜像**关系（#327 未收口：没有构建期注入）。漏改不会静默过去：`tests/integration/enterprise.test.ts` 会用 `package.json` 的 `version` 断言写入备份的该常量，漏 bump 直接红灯（比对结果本身只用于 `logger.warn`，不拦截恢复）
  3. `CHANGELOG.md` —— `## [Unreleased]` 改成 `## [x.y.z] - 日期` 并在其上补一个空的 `[Unreleased]`；文末链接区同步：`[Unreleased]` 的 compare 基准换成新 tag、新增 `[x.y.z]` 的 release 链接
  4. skill —— `pnpm run build && pnpm run skill:api` 重跑生成物（`references/api/*.md` 的「来源版本」行），另需手改 `SKILL.md` 三处版本号（frontmatter 的 `description`、正文「当前版本」、指向 `references/api/index.md` 那条的「当前对应 vX.Y.Z」）。这四处分量**必须一次改齐**：`tests` 里有用例把 `SKILL.md` 的手写版本行与生成物的「来源版本」行钉到 `package.json`，漏改 `SKILL.md` 三处或漏跑 `pnpm skill:api` 现在会让 `pnpm test` 直接变红（不再只是文档措辞过期）
  5. 门禁 —— `lint:ci` / `Format check` / 四条 `typecheck` / `test:ci` / `build:release` / `build:weapp` + `verify:weapp` / `npm pack --dry-run`（核对文件数，且必须看到 `dist-weapp/**` 与 `miniprogram` 字段随包出去），并在本地复现 CI 那条**走 Node `exports` 解析器的子路径冒烟**
  6. `git tag` 与 `npm publish` 是**对外不可逆动作**（npm 不允许覆盖已发版本），须单独确认后再做
- **0.x 的版本号语义**：`^0.5.1` 展开为 `>=0.5.1 <0.6.0`，即 caret **不跨 minor**——所以含破坏性变更的发版必须升 minor（0.6.0 就是这么定的）。发成 patch 会把破坏性变更自动装进按 caret 锁定的宿主并让它们的编译失败
- 改动 `package.json` 的 `exports` / `files` 后，请用 `pnpm stubs` + `pnpm build` 验证一次真实解析

## 文档

十篇文档共用一张「唯一正本」地图，**同一件事只在一处写全，其余位置一律一句结论 + 锚点链接**。新增内容前先确认它归哪一篇；写重了就会漂（本轮就是这么修掉 `enableStats` 方向被写反、三处各说各话那类问题的）。

| 内容                                   | 正本                                                                 |
| -------------------------------------- | -------------------------------------------------------------------- |
| 机制语义、契约边界、为什么这样设计     | [`docs/CONCEPTS.md`](./docs/CONCEPTS.md)                             |
| 选项默认值、逐 API 契约、易误用点      | [`docs/API.md`](./docs/API.md)                                       |
| 逐字签名与重载                         | `pnpm skill:api` 的生成物 + 随包 `.d.ts`（**两处都不手改**）         |
| 症状 → 诊断                            | [`docs/FAQ.md`](./docs/FAQ.md)                                       |
| 接入代码与上手路径                     | [`docs/GUIDE.md`](./docs/GUIDE.md)；可运行正本在 `examples/`         |
| 该做 / 别做的结论                      | [`docs/BEST_PRACTICES.md`](./docs/BEST_PRACTICES.md)                 |
| 分层、依赖方向、模块职责、设计取舍     | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)                     |
| 行为的历史对照（此前 → 现在 → 怎么改） | [`docs/MIGRATION.md`](./docs/MIGRATION.md)——**只有这里写历史**       |
| 门禁、构建、发版、目录树               | 本文件（目录树正本在 ARCHITECTURE §3）                               |
| agent 速查（一句结论 + §N）            | `.codebuddy/skills/geomstore/SKILL.md` → `references/*-semantics.md` |

- **文档以源码为唯一依据**：写完一段结论就回 `src/` 核一遍。复审报告 / 判定台账里的措辞不是真相，代码才是。
- **正文只写当前行为**：不写「此前 X、现在 Y」「旧实现」「0.x.0 变更」这类时间对比，也不留版本标签。要交代升级影响就写进 `MIGRATION.md` 并在正文放一个链接。
- `examples/` 是**唯一被编译的示例**（CI 的 `typecheck:examples`）。文档里的代码片段没有任何机制会编译它，所以照抄 `examples/` 里已验证的写法，比现编一段更稳。
- **文档不写实测数字**：覆盖率阈值的唯一事实来源是 `jest.config.js` 的 `coverageThreshold`（当前 global 语句 / 函数 / 行 98、分支 95；`core` 与 snapshot / selector / action 另设单文件分支 85 下限）——本文件是它面向人的正本，其余文档一律链接过来、**不抄数值**，本文件那串数值由文档门禁反查 `jest.config.js` 钉住，改了配置忘了改文档会变红。套件数 / 用例数 / 实测百分比**不写进任何文档**：它们随轮次变动，写下来就是等着漂移的假话，要数字当场跑 `pnpm test`。**严禁留「等收口时填」这类空占位**——占位进仓库就是对读者宣称「这里有数字但我没算」，宁可不写。同理不写「100% 覆盖」「全绿」这类不实措辞：**没跑过门禁就不要替它说话**
- `.codebuddy/skills/geomstore/references/api/*.md` 是 `pnpm run skill:api` 从 `dist` 的 `.d.ts` 生成的**产物**：不要手改，改了也会被下次生成覆盖。要改技能里的口径，先改 `src/**` 的 JSDoc，构建后重跑生成器。
- **结构层面的问题已经有机器门禁**：`tests/unit/docs-gates.test.ts` 判单一 h1、链接与锚点可达、文件内逐字节重复行、未填占位、子路径与 `package.json` 双向一致、模块数与覆盖率阈值的陈述、目录树真实性。排版与语义仍靠人。
- **新增 / 变更 API 时同步**：`docs/API.md` 相应小节、`docs/CONCEPTS.md`（若引入了新契约）、`SKILL.md` 及其 `references/*-semantics.md`、`examples/`，以及发版时的版本号（见上方清单第 4 步）。

### 写文档时最常写错的那一面

这张表**只列错法**，不重述正确契约——契约在上面那两处。每行指向它该去读的地方。

| 别这么写                                                               | 一手出处                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| 快照是「递归深冻结」                                                   | [CONCEPTS §1](./docs/CONCEPTS.md#1-状态state)                 |
| `subscribe` 回调能拿到 `prevState`                                     | [CONCEPTS §2](./docs/CONCEPTS.md#监听器与只读订阅)            |
| 用 `getState()` 演示缓存命中 / 把 `setState` 说成失效                  | [CONCEPTS §6](./docs/CONCEPTS.md#6-缓存cache)                 |
| 依赖未变时 getter 会复用结果、判定基于版本号                           | [CONCEPTS §4](./docs/CONCEPTS.md#4-getter无记忆化)            |
| 状态保护会拦住一切绕过 `setState` 的变异                               | [CONCEPTS §3](./docs/CONCEPTS.md#冻结与不可写属性明确豁免)    |
| 组合层读已销毁子 store 会崩、或那个键消失了                            | [CONCEPTS §12](./docs/CONCEPTS.md#子-store-生命周期)          |
| 快照把子类与内部槽位值克隆成独立副本                                   | [CONCEPTS §8](./docs/CONCEPTS.md#保留原引用的两类值)          |
| `compareSnapshots` 的 `changed: true` 就等于内容有差异                 | [CONCEPTS §8](./docs/CONCEPTS.md#差异比较comparesnapshots)    |
| 一次异步 dispatch 恰好一次通知                                         | [CONCEPTS §2](./docs/CONCEPTS.md#dispatch-的通知时点)         |
| 同步快照「无限深度安全」                                               | [CONCEPTS §8](./docs/CONCEPTS.md#同步与异步)                  |
| 快照 `onError` 不写 `return` 等于忽略错误                              | [CONCEPTS §8](./docs/CONCEPTS.md#错误账本与降级策略)          |
| `deepEqual` 先判内建类型再判原型                                       | [API.md 核心工具函数](./docs/API.md#工具函数)                 |
| 把 `wx` 全局对象直接当 `storage` 后端                                  | [CONCEPTS §11](./docs/CONCEPTS.md#调试表与持久化)             |
| `createSelector(输入fn, 结果fn)` 双函数重载；选项名写成 `maxCacheSize` | [API.md 选择器](./docs/API.md#extrasselector选择器)           |
| `withThrottle` 的间隔写成选项字段而非第一个位置参数                    | [API.md Action 增强](./docs/API.md#extrasactionaction-增强)   |
| `withRetry` 装饰同步方法后返回类型不变                                 | [API.md Action 增强](./docs/API.md#extrasactionaction-增强)   |
| 按错误 message 文本识别超时                                            | [API.md Action 增强](./docs/API.md#extrasactionaction-增强)   |
| `withLog` 的生产摘要里带 `Error.message`                               | [API.md Action 增强](./docs/API.md#extrasactionaction-增强)   |
| 装饰 store action 后还能用 `cancel*Calls(this)` 收尾                   | [API.md 宿主收尾入口](./docs/API.md#防抖--节流的宿主收尾入口) |
| `flush*` 会执行多次、`dispose*` 只是取消                               | [API.md 宿主收尾入口](./docs/API.md#防抖--节流的宿主收尾入口) |

## 提交与 PR

- 提交信息说明「改了什么 + 为什么」，行为变更请附前后对比
- PR 描述中列出本地已跑的门禁命令与结果
- 涉及 Breaking 的改动请单独成 PR，或在描述中显著标注
