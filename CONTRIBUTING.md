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

```
src/
  core/            核心：store / cache(LRUCache) / hooks / compose / performance / utils
  extras/          可选能力：snapshot / selector / action / error / performance / plugins / enterprise
  integrations/    微信小程序集成（withPageStore / withComponentStore / withAppStore）
  plugins/         插件实现（builtin / devtools / performance）
  types/           公共类型契约
tests/             unit / integration（按领域分目录）
examples/          可运行示例（分类目录 + 索引）
docs/              文档
scripts/           clean-dist / postbuild-dist / minify-dist / generate-subpath-stubs（均为 .mjs）
packages/benchmark 性能基准
```

**分层原则**：`extras/*` 的实现不得被核心反向依赖；核心只保留运行必需 API。若某能力只有部分用户需要，它就应该出现在 `extras`。

## 门禁（与 CI 一致，必须全绿）

```bash
pnpm lint:ci          # ESLint（带 --max-warnings 上限）
pnpm typecheck        # 源码
pnpm typecheck:examples
pnpm test:ci          # jest --ci --coverage
pnpm build            # clean-dist → tsc → postbuild（写 module-type 标记、移除 sourcemap）
```

CI 在 `build` 之后还会跑一段 **ESM + 子路径冒烟**（`import dist/index.js`、`dist/extras/error/index.js`、`dist/extras/plugins.js`），改动构建或 exports 时请本地复现：

```bash
node --input-type=module -e 'const s = await import("./dist/index.js"); console.log(typeof s.createStore)'
```

## 测试约定

- **按领域放置**：新测试放到对应模块的目录（`tests/unit/extras/snapshot/…`），不要新建按时间/批次命名的文件
- **覆盖率即契约**：语句 / 分支 / 函数 / 行保持 **100%**；确实不可达的防御分支请加 `/* istanbul ignore … */`，并**必须在注释里写明为什么不可达**（不接受无理由标注）
- **不要靠私有状态通吃**：优先使用公开 API 或测试缝；确需触碰内部（如构造越界状态）时，用 `as unknown as { … }` 并写明成因
- **全局对象要真还原**：备份为 `undefined` 时用 `Reflect.deleteProperty`，否则会留下 `{ wx: undefined }` 这类残键，影响 `'wx' in globalThis` 判断
- **定时器**：打桩 `setTimeout`/`setInterval` 时若底层仍创建真实定时器，必须留存真实句柄以便清理，否则 jest worker 无法优雅退出
- 避免恒真断言（`toBeDefined()`、`isFinite(...)`）：要么断言具体字段，要么在用例名中声明「仅冒烟」

## 代码约定

- TypeScript `strict`；**避免 `any`**（测试里也不滥用），类型收窄优先于断言
- 注释解释**为什么**，而不是复述代码在做什么；对不直观的兜底、上限、复杂度处理尤其要写清楚
- 生产代码里避免为了覆盖率而改写表达式结构；确需改写时保持**语义等价**并在提交说明中标注
- 公共 API 的类型一旦发布即视为契约：放宽（如泛型变宽、参数变可选）是非破坏性改动，收紧或重命名需要在 CHANGELOG 标注 **Breaking**
- 行为变更（错误语义、通知时机、默认值）必须在 CHANGELOG 中说明影响面与迁移方式

## 构建与发布

- 子路径转发目录（`store/`、`hooks/`、`plugins/`、`integrations/` 等）由 `prepack` 生成、`postpack` 清理；手动入口为 `pnpm stubs` / `pnpm stubs:clean`
- 发布走 `prepublishOnly`：`pnpm test && pnpm run build:release`。`build:release` 使用**严格压缩**——无可用压缩器时以退出码 1 中止，杜绝静默发出未压缩包
- 改动 `package.json` 的 `exports` / `files` 后，请用 `pnpm stubs` + `pnpm build` 验证一次真实解析

## 文档

- 文档以**源码为唯一依据**；示例代码请与 `examples/` 保持同源，使其可通过 `pnpm typecheck:examples` 校验
- 易错点（写文档时特别容易写错，均有测试兜底）：
  - `store.subscribe(listener, options?)` 的监听器是 **`(state: S) => void`**，没有 `prevState`
  - `createSelector(单个选择器函数, 选项?)`，没有「输入函数 + 结果函数」的双函数重载
  - `withThrottle(interval, options)` 的间隔是**第一个位置参数**
  - 装饰器选项为 `withRetry({ retries, delay, shouldRetry })`
  - 持久化后端必须是**同步**实现
- 新增/变更 API 时同步更新：[docs/API.md](./docs/API.md)、相关指南，以及（若涉及行为变更）[CHANGELOG.md](./CHANGELOG.md) 与 [docs/MIGRATION.md](./docs/MIGRATION.md)

## 提交与 PR

- 提交信息说明「改了什么 + 为什么」，行为变更请附前后对比
- PR 描述中列出本地已跑的门禁命令与结果
- 涉及 Breaking 的改动请单独成 PR，或在描述中显著标注
