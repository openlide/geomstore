# GeomStore API 参考（按入口拆分，自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.8.0`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 使用规则与快速上手见 [`../../SKILL.md`](../../SKILL.md)
> - 默认值、语义契约与易误用点见仓库 `docs/API.md`（不随包发布，仅仓库内可见）

## 入口一览

按需打开所需入口的文件即可（渐进加载，不必读整个目录）：

| 引入路径 | 展开方式 | 符号数 | 文件 |
| --- | --- | --- | --- |
| `.` | 完整声明 | 63 | [`main.md`](./main.md) |
| `./core` | 仅符号名 | 63 | [`core.md`](./core.md) |
| `./extras` | 仅符号名 | 84 | [`extras.md`](./extras.md) |
| `./extras/action` | 完整声明 | 35 | [`extras-action.md`](./extras-action.md) |
| `./extras/enterprise` | 完整声明 | 18 | [`extras-enterprise.md`](./extras-enterprise.md) |
| `./extras/error` | 完整声明 | 44 | [`extras-error.md`](./extras-error.md) |
| `./extras/performance` | 完整声明 | 9 | [`extras-performance.md`](./extras-performance.md) |
| `./extras/plugins` | 完整声明 | 9 | [`extras-plugins.md`](./extras-plugins.md) |
| `./extras/selector` | 完整声明 | 17 | [`extras-selector.md`](./extras-selector.md) |
| `./extras/snapshot` | 完整声明 | 14 | [`extras-snapshot.md`](./extras-snapshot.md) |
| `./integrations` | 完整声明 | 28 | [`integrations.md`](./integrations.md) |

`./core` 与 `./extras` 是 `.` 及其子入口的聚合/别名，为避免重复只列符号名；完整声明请看对应入口文件。

### 检索方式

不确定某个符号属于哪个入口时，直接搜目录：

```bash
rg -n 'createSelector' references/api/          # 找出定义位置与所在入口
rg -n '^### `createSnapshot`' references/api/   # 精确定位某个符号的完整声明
```
