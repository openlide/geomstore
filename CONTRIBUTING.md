# 贡献指南（Contributing Guide）

感谢你对 GeomStore 的关注！本文档介绍如何搭建开发环境、提交代码与发布版本。

---

## 目录

1. [行为准则](#1-行为准则)
2. [开发环境](#2-开发环境)
3. [快速开始](#3-快速开始)
4. [项目结构](#4-项目结构)
5. [开发工作流](#5-开发工作流)
6. [代码规范](#6-代码规范)
7. [测试规范](#7-测试规范)
8. [提交信息规范](#8-提交信息规范)
9. [发布流程](#9-发布流程)

---

## 1. 行为准则

- 尊重他人，保持友好、专业的交流。
- 提交前请确保代码通过全部质量门禁（见 [§5](#5-开发工作流)）。
- 新增功能请同步补充文档与测试。

---

## 2. 开发环境

| 工具       | 版本要求                                |
| ---------- | --------------------------------------- |
| Node.js    | >= 22.0.0（CI 矩阵 22 / 24）            |
| pnpm       | 11.21.0（项目 `packageManager` 已锁定） |
| TypeScript | ^6.0.3                                  |

> 建议启用 pnpm 的 `corepack`：`corepack enable`，确保使用锁定的 pnpm 版本。

---

## 3. 快速开始

```bash
# 安装依赖
pnpm install

# 全量测试（含覆盖率）
pnpm test:coverage

# 类型检查（源码 / 测试 / 示例）
pnpm typecheck
pnpm typecheck:tests
pnpm typecheck:examples

# 代码规范检查
pnpm lint

# 构建（CJS 产物）
pnpm build
```

---

## 4. 项目结构

```
src/
├── core/                    # 核心模块
│   ├── store/              # Store 核心（Store/StateProxy/ActionManager/BatchManager/StoreCache/SubscriptionManager）
│   ├── action/             # Action 系统 + 装饰器（debounce/throttle/cache/retry/timeout/log）
│   ├── cache/              # LRU 缓存
│   ├── snapshot/           # 快照管理
│   ├── selector/           # 选择器
│   ├── error/              # 错误处理（边界/监控/恢复）
│   ├── performance/        # 性能工具（指纹/批量通知/监控）
│   ├── compose/            # Store 组合
│   ├── hooks/              # 生命周期钩子
│   └── utils/              # 工具函数 + 类型校验
├── plugins/                # 插件系统
├── integrations/           # 小程序集成（with-store/with-app-store/enterprise）
├── types/                  # 类型定义
└── index.ts                # 主入口

tests/                      # 单元 + 集成 + 回归测试
examples/                   # 示例代码（basic/advanced/cache/weapp）
docs/                       # 文档
```

---

## 5. 开发工作流

提交 PR 前，请确保以下门禁**全部通过**（与 CI 一致，见 `.github/workflows/ci.yml`）：

```bash
pnpm lint:ci              # ESLint（CI 门禁：--max-warnings 70 警告预算）
pnpm typecheck            # tsc --noEmit（src，strict）
pnpm typecheck:examples   # 示例类型检查（CI 门禁）
pnpm test:ci              # Jest --ci --coverage（覆盖率阈值门禁）
pnpm build                # 构建 + 产物冒烟
```

> 本地开发建议额外跑 `pnpm lint`（0 警告标准，严于 CI）与 `pnpm typecheck:tests`（源码 + 测试）。

### 脚本速查

| 命令                      | 说明                |
| ------------------------- | ------------------- |
| `pnpm test`               | 全量测试            |
| `pnpm test:unit`          | 仅单元测试          |
| `pnpm test:integration`   | 仅集成测试          |
| `pnpm test:coverage`      | 测试 + 覆盖率       |
| `pnpm lint`               | ESLint 检查         |
| `pnpm lint:fix`           | ESLint 自动修复     |
| `pnpm format`             | Prettier 格式化     |
| `pnpm typecheck`          | 源码类型检查        |
| `pnpm typecheck:tests`    | 源码 + 测试类型检查 |
| `pnpm typecheck:examples` | 示例类型检查        |
| `pnpm build`              | 构建 CJS 产物       |

---

## 6. 代码规范

### 6.1 TypeScript

- **严格模式**：`tsconfig.json` 启用 `strict`、`noUnusedLocals`、`noUnusedParameters`、`noImplicitReturns`、`noFallthroughCasesInSwitch`。
- **禁止 `any`**：`@typescript-eslint/no-explicit-any` 为 warn 门禁；确需兜底时须加 `// eslint-disable-next-line` 并说明原因。
- **类型收敛**：对外 API 优先用泛型推导而非 `any`。集成层的映射类型已收敛为精确签名（见 `src/types/integration.ts`），新增映射类型请遵循同样标准。

### 6.2 命名约定

| 对象            | 约定                                                    |
| --------------- | ------------------------------------------------------- |
| Store 名称      | `lowerCamelCase`（如 `userStore`）                      |
| action / getter | `lowerCamelCase`（如 `fetchUser`、`displayName`）       |
| 类型 / 接口     | `UpperCamelCase`（如 `StoreOptions`、`ConnectOptions`） |
| 未使用变量      | 前缀 `_`（ESLint `varsIgnorePattern: '^_'`）            |

### 6.3 安全红线

- 禁止引入运行时依赖（保持「零运行时依赖」承诺）。
- 禁止 `eval` / `new Function` 等动态代码执行。
- 深合并/路径写入须防护原型污染（`__proto__` / `constructor` / `prototype`）。
- 错误上报须脱敏，不得泄露 token 等敏感信息。

---

## 7. 测试规范

### 7.1 覆盖率阈值

| 范围                 | branches | functions | lines | statements |
| -------------------- | -------- | --------- | ----- | ---------- |
| 全局                 | 95%      | 98%       | 98%   | 98%        |
| `src/core/**` 单文件 | 85%      | 98%       | 98%   | 98%        |

### 7.2 测试命名

回归测试按「系列编号」组织，便于追踪：

- `HELPERS-*`：工具函数
- `PERF-*`：性能工具
- `SNAP-*`：快照系统
- `STORE-*`：Store 核心
- `PROTECT-*`：安全防护类用例（原型污染 / 路径写入 / 变异拦截）
- `REGR-*`：针对已修复缺陷的回归用例

新增 bug 修复时，请补充对应 `REGR-*` 用例；新增功能时补充覆盖主路径与边界分支的用例（补覆盖变体使用 `*-COV` 后缀，如 `STORE-COV`、`HELPERS-COV`）。

### 7.3 类型级测试

纯类型断言（如集成层精确映射类型）放在 `tests/types/*.typecheck.ts`：

- 文件名**不以** `.test` / `.spec` 结尾，避免被 jest 收集执行。
- 通过 `@ts-expect-error` 锁定「应报错」的类型行为，由 `pnpm typecheck:tests` 校验。
- 示例：`tests/types/integration-types.typecheck.ts`。

---

## 8. 提交信息规范

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：

```
<type>(<scope>): <subject>

type: feat | fix | docs | style | refactor | perf | test | build | ci | chore
scope: 可选，如 store、action、integration、docs
```

示例：

```
fix(store): 修复 dispatch 后缓存与状态不一致
feat(integration): 集成层映射类型收敛为精确签名
docs: 重写生产可行性评审报告
```

---

## 9. 发布流程

1. 确认 `CHANGELOG.md` 已记录本次变更。
2. 确认全部质量门禁通过（见 [§5](#5-开发工作流)）。
3. 更新 `package.json` 版本号。
4. 运行 `pnpm build`，确认 `dist/cjs` 产物及 14 个子路径导出完整。
5. 打 tag 并发布：`git tag vX.Y.Z && git push --tags`。

---

## 相关文档

- [迁移指南](./docs/MIGRATION.md)
- [生产可行性评审报告](./docs/PRODUCTION_READINESS_REPORT.md)
- [全量源码评审报告](./docs/CODE_REVIEW_FINAL.md)
