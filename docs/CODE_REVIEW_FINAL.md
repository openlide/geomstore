# GeomStore 全量源码最终评审报告

> 评审范围：`src/`（全部源码）、`examples/`、`tests/`、`packages/`、`docs/` 与构建/工程配置。
> 评审时间：2026-08-13
> 评审方式：逐文件静态审查 + 子代理分片交叉复核 + 类型检查（`tsc --noEmit`）+ 文档与实现交叉比对。
>
> **状态说明（2026-08-22）**：本报告为 v0.1.0 时期的时点评审快照，文中所有问题均已闭环（详见各条 ✅ 标注）。其后 v0.1.1–v0.2.0 又完成多轮全量审查修复（累计约 70+ 项，见 CHANGELOG 对应条目）。当前基线：`dist/cjs` 单产物（ESM 已移除）、40 个测试套件 / 2233 用例、覆盖率达标；文中「43 文件」「1986 用例」「双产物」等表述仅反映评审时点。

---

## 1. 评审结论（TL;DR）

**整体评价：源码实现质量良好、工程化成熟、类型安全基础扎实，达到可发布 1.0 的标准。核心逻辑经多轮修复后正确性与健壮性较高；当前残留的代码问题均为低严重度的边界问题，不阻塞发布。**

**主要风险不在源码，而在文档与示例：** 集成 API（`withPageStore` / `withComponentStore` / `withAppStore`）的文档、JSDoc 与示例代码与实际「柯里化」实现不一致，按文档照抄会得到错误行为（`Page` 收到函数而非配置对象、`data`/生命周期丢失）；`BEST_PRACTICES.md` 多处 action 签名与真实 action 模型（`this.state`）相悖。这部分属于发布前必须修复的「文档级 Critical/High」。

### 健康度快照

| 维度 | 状态 | 说明 |
| --- | --- | --- |
| 类型检查 | ✅ 通过 | `tsc --noEmit -p tsconfig.typecheck.json` 退出码 0 |
| 单元/集成测试 | ✅ 充分 | `tests/` 43 文件，覆盖核心/集成/插件/企业版 |
| 代码规模 | — | `src/` 71 文件，`packages/` 9 文件，`examples/` 12 文件 |
| 语言/引擎 | — | TypeScript `^6.0.3`、Node `>=22`、pnpm `11.x` |
| 包名/产物 | — | `@openlide/geomstore`（评审时点为 `dist/cjs` + `dist/esm` 双产物，现为 CJS 单产物） |

---

## 2. 源码质量总评（按子系统）

| 子系统 | 文件 | 评价 |
| --- | --- | --- |
| 核心 Store | `core/store/*` | 状态代理、批量更新、订阅管理设计清晰；`getState()` 返回内部引用属刻意权衡 |
| 缓存 | `core/cache/*` | LRU 实现规范，淘汰回调处理到位 |
| 选择器 | `core/selector/*` | 参数化 selector + 记忆化实现正确 |
| 钩子 | `core/hooks/*` | 生命周期钩子完备 |
| Action 系统 | `core/action/*` | 异步/装饰器（debounce/throttle/cache/retry/timeout）覆盖全面 |
| 组合 | `core/compose/*` | 多订阅者通知调度已修复 |
| 错误处理 | `core/error/*` | 边界/监控/恢复分层清晰 |
| 快照 | `core/snapshot/*` | 时间旅行能力完整 |
| 性能 | `core/performance/*` | 指纹、批量通知、调度工具齐备 |
| 插件 | `plugins/*` | devtools/性能分析器内聚 |
| 集成 | `integrations/*` | 柯里化实现正确，但文档/示例未对齐（见 §4） |
| 类型定义 | `types/*` | 泛型体系完整；局部 `any` 兜底见 §3 |

---

## 3. 确认的代码问题（按严重度）

> 说明：以下问题均已通过直接阅读源码验证，非猜测。类型检查通过、测试全绿，故均为边界/语义问题，不构成编译或功能阻塞。

### Medium

1. **`deepEqual` 对 `Set` 按插入顺序配对比较，语义不严谨**
   - 位置：`src/core/utils/helpers.ts` L163-174
   - 问题：`new Set([1,2])` 与 `new Set([2,1])` 被判定为不相等。`Set` 在语义上是无序集合，深比较应按元素「存在性」而非「迭代顺序」比较。
   - 影响：依赖 `deepEqual` 做状态去重/变更检测时，同内容但不同插入顺序的 `Set` 会被误判为「已变化」，造成多余的通知/重渲染。
   - ✅ **已修复（2026-08-13）**：新增 `setsEqual` 辅助函数，原始值元素按 SameValueZero 匹配、对象元素做贪心深比较配对，实现与插入顺序无关的集合语义；顺带修正 `deepEqual(NaN, NaN)` 误判（快速路径改为 SameValueZero）。回归测试 `REGR-HELPER-004b` / `REGR-HELPER-006`。

2. **`StateFingerprint` 对 `Set` 按迭代顺序哈希，导致指纹不稳定**
   - 位置：`src/core/performance/Optimizations.ts` L253-258
   - 问题：`Set` 指纹依赖插入顺序，同内容不同顺序产生不同指纹。
   - 影响：仅影响性能（误判为变化多触发一次比较），不产生正确性问题；但若指纹被用作「相等性」判据会引入假阴性。
   - ✅ **已修复（2026-08-13）**：改为先收集元素哈希、排序后组合，实现顺序无关指纹。回归测试 `REGR-PERF-006`。

### Low

3. **`AsyncBatchNotifier` 用 `null` 作为「无待通知状态」的哨兵值**
   - 位置：`src/core/performance/Optimizations.ts` L49、L98
   - 问题：`notify(null)` 会把 `latestState` 置回 `null`，`flush()` 中 `if (state !== null)` 会静默丢弃本次通知。
   - ✅ **已修复（2026-08-13）**：新增 `hasPendingState` 独立标志取代 `null` 哨兵，`flush` 以该标志判定是否有待通知，支持 `S` 允许为 `null` 的场景。

4. **`SubscriptionManager` 中 `nextId` 递增但从不使用**
   - 位置：`src/core/performance/Optimizations.ts` L330-343
   - 问题：`listeners: Map<listener, id>` 的 `id` 从未被读取，`nextId` 为死代码/冗余设计。
   - ✅ **已修复（2026-08-13）**：`listeners` 由 `Map<listener, id>` 简化为 `Set<listener>`，移除冗余 `nextId`。

5. **集成层类型兜底使用 `any`，削弱类型安全**
   - 位置：`src/types/integration.ts`（原 L122/L139 的 `[key: string]: any`，及 `ExtractMapped*` 的 `ConnectOptions<any, any>` 约束）
   - 问题：`PageThis` / `ComponentThis` 通过索引签名 `any` 支持动态 action 调用，导致页面方法内拼错 action 名不会报类型错误。
   - ✅ **已修复（2026-08-13）**：`PageThis` / `ComponentThis` 的 `[key: string]: any` 收敛为 `ExtractMappedActions<A, M>`（用 `InferActionArgs`/`InferActionReturn` 推导精确签名），`data` 收敛为 `ExtractPageData<S, M>`；`ConnectOptions.mapActions` 对象形式值约束为 `keyof A`；`ExtractMappedState/Actions/Getters` 的 `ConnectOptions<any, any>` 约束收敛为结构化最小约束（规避数组类型不变性问题）；`ExtraMethods` 约束由 `Record<string, unknown>` 放宽为 `object`（修复文档示例 interface 无法编译的缺陷）。新增编译期回归测试 `tests/types/integration-types.typecheck.ts`，用 `@ts-expect-error` 锁定「拼错 action 名 / 传错参数」均报类型错误。

6. **（本轮新增）`deepEqual` 对 `NaN` 误判为不相等**
   - 位置：`src/core/utils/helpers.ts` L111（快速路径原为 `===`）
   - 问题：`deepEqual(NaN, NaN)` 返回 `false`，违反 SameValueZero 语义。
   - ✅ **已修复（2026-08-13）**：快速路径改为 `currentA === currentB || Object.is(currentA, currentB)`。回归测试 `REGR-HELPER-006`。

> 注：历史评审中曾被提及的「`src/index.ts` 重复导出 `defaultErrorHandler`/`createErrorContext`」经复核为**误报**——该名称仅在 `src/index.ts` L31 从 `core/error/ErrorHandler` 导出一次，L33-60 的 `core/error/index` 导出块中不含此二名。类型检查通过亦佐证无重复导出。

---

## 4. 文档与示例问题（发布前必修）

### Critical（按文档照抄会得到错误行为）

1. **集成 API 的柯里化用法在文档/JSDoc/示例中全部写错**
   - 实际实现（`src/integrations/with-store.ts`、`with-app-store.ts`）为柯里化：
     `withPageStore(store, connectOptions)` 返回 `(pageConfig) => pageConfig`。
   - 正确用法（以 `tests/integration/with-store.test.ts` 为准）：
     ```javascript
     Page(withPageStore(store, { mapState: ['count'], mapActions: ['increment'] })({
       data: { local: 1 },
       onLoad() { this.increment() },
     }))
     ```
   - 错误写法（散布于 README、API.md、GUIDE.md、TECHNICAL_DOCUMENTATION.md、CONCEPTS.md、FAQ.md、BEST_PRACTICES.md 及 `with-store.ts`/`with-app-store.ts` 的 JSDoc）：
     ```javascript
     // ❌ 缺少第二次调用，Page 会收到函数而非配置对象；data/onLoad 会丢失
     Page(withPageStore(store, { mapState: [...], data: {...}, onLoad() {...} }))
     ```

2. **`examples/weapp/*.ts` 虽用了柯里化，但 `data`/生命周期被放错参数**
   - 位置：`examples/weapp/page-integration.ts`、`component-integration.ts`、`app-integration.ts`
   - 问题：`data`、`onLoad`、`onUnload`、`methods`、`lifetimes` 等被放进第一个参数（`connectOptions`）而非第二个参数（页面/组件/App 配置对象），导致这些配置被 `parseMapping` 忽略，生命周期回调与本地 `data` 全部丢失。
   - 建议：将「连接选项（mapState/mapActions/autoInject 等）」与「宿主配置（data/onLoad/onUnload/methods/lifetimes/globalData 等）」分离，前者入 `connectOptions`，后者入第二调用。

### High

3. **`BEST_PRACTICES.md` 多处 action 签名与真实 action 模型相悖**
   - 位置：`docs/BEST_PRACTICES.md` L322、L535、L547、L956、L990、L995、L1061、L1172、L1191、L1198、L1204、L1208 等
   - 问题：action 被写成 `login(state, { user, token })`、`increment(state) { state.count++ }`、`async init(state)` 等，把 `state` 当第一参数。
   - 真实模型：action 通过 `this.state` 访问状态，第一参数是用户传入参数；`state` 作为参数只出现在 **getter**（`(state) => ...`）中。
   - 建议：全部改为 `this.state` 风格，与 README / API.md / CONCEPTS.md / examples 保持一致。

### Medium

4. **`API.md` 中 `withAppStore` 签名错误**
   - 位置：`docs/API.md` L1105-1108
   - 问题：写成 `function withAppStore<S, A, G>(store): <A>(appOptions) => A`（漏掉 `options` 参数）。
   - 真实：`withAppStore<S extends State>(store, options?)` 双参，返回 `(appConfig) => appConfig`。

5. **`API.md` 使用 `store.__hooks__`，实际属性名为 `store.hooks`**
   - 位置：`docs/API.md` L658
   - 建议：`const hooks = store.hooks`。

6. **`TECHNICAL_DOCUMENTATION.md` 版本号陈旧/自相矛盾**
   - TypeScript 写「5.0+」（实际 `^6.0.3`）、Node 写「≥14」（实际 `engines >=22`）、基础库「≥3.0.0」与「≥2.10.0」两处冲突、产物路径 `dist/index.js`/`dist/index.esm.js`（实际 `dist/cjs` + `dist/esm`）。

7. **`CONCEPTS.md` 中 `createSelector` 误用为变参组合器**
   - 位置：`docs/CONCEPTS.md` L642-645
   - 问题：`createSelector((state) => state.users, (users) => (id) => ...)` 把 `createSelector` 当变参组合器使用；实际 `createSelector(selectorFn, options?)` 只接受单个选择器函数，参数化派生应使用 `createParametricSelector((state, id) => ...)`。

### Low

8. **`PRODUCTION_READINESS_REPORT.md` 架构图仍引用已移除的 `src/plugins/hooks.ts`**
   - 该报告自身已声明「兼容垫片 `plugins/hooks.ts` 已移除」，但架构图/文件清单未同步清理，自相矛盾。

---

## 5. 修复状态与优先级建议

> **本轮已修复**：§4 中的 1-7 项文档/示例问题（集成 API 柯里化用法、action 签名、`withAppStore` 签名、`__hooks__`、`createParametricSelector`、版本号）已在本轮评审中全部修正，涉及 README、API.md、GUIDE.md、CONCEPTS.md、FAQ.md、BEST_PRACTICES.md、TECHNICAL_DOCUMENTATION.md、`with-store.ts`/`with-app-store.ts` 的 JSDoc 及 `examples/weapp/*.ts`。

| 优先级 | 事项 | 类别 | 状态 |
| --- | --- | --- | --- |
| P0 | 修正所有集成示例为柯里化用法 | 文档 | ✅ 已修复 |
| P0 | 修正 `examples/weapp/*.ts` 的连接选项与宿主配置分离 | 示例 | ✅ 已修复 |
| P1 | 修正 `BEST_PRACTICES.md` 的 action 签名 | 文档 | ✅ 已修复 |
| P1 | 修正 `API.md` 集成 API 签名与 `__hooks__` | 文档 | ✅ 已修复 |
| P1 | 修正 `CONCEPTS.md` 的 `createParametricSelector` 用法 | 文档 | ✅ 已修复 |
| P2 | 统一 `TECHNICAL_DOCUMENTATION.md` 版本号 | 文档 | ✅ 已修复 |
| P2 | 同步 `PRODUCTION_READINESS_REPORT.md` 架构图 | 文档 | ✅ 已修复 |
| P3 | `deepEqual` 的 `Set` 语义（顺序无关） | 源码 | ✅ 已修复 |
| P3 | `StateFingerprint` 的 `Set` 顺序无关指纹 | 源码 | ✅ 已修复 |
| P3 | `AsyncBatchNotifier` 的 `null` 哨兵 | 源码 | ✅ 已修复 |
| P3 | `SubscriptionManager` 冗余 `Map`/`nextId` | 源码 | ✅ 已修复 |
| P3 | `deepEqual` 对 `NaN` 误判 | 源码 | ✅ 已修复 |
| P2 | 集成层 `[key: string]: any` 收敛为精确映射类型 | 源码 | ✅ 已修复 |
| P2 | 补充 `MIGRATION.md` / `CONTRIBUTING.md` | 文档 | ✅ 已修复 |

---

## 6. 总结

源码主体已具备发布条件：类型检查通过、测试充分、核心逻辑健壮、安全防护（原型污染、路径遍历、错误上报脱敏等）到位。文档/示例与实现的集成 API 用法不一致、action 签名错误等 P0/P1 文档问题，以及 `deepEqual`/`StateFingerprint`/`AsyncBatchNotifier`/`SubscriptionManager` 的 P3 源码边界项均已在本轮修复。

### 回归结果（2026-08-13 最终）

- **测试**：1986 个测试全部通过（40 个测试套件），覆盖率 statements 99.86% / branches 98.58% / functions 99.76% / lines 99.86%，全部超过阈值
- **类型**：`tsc --noEmit`（src）0 错误
- **lint**：本次评审修改的 4 个源码/测试文件 0 错误

### 残留项（发布前建议处理，但不阻塞）

- **`no-extra-semi` lint 错误 ×36**（预先存在，非本轮引入）：分布在 `src/core/error/ErrorMonitoring.ts`、`src/core/snapshot/SnapshotManager.ts` 及 4 个测试文件中，均为行首防御性分号 `;(...)` 触发的 `no-extra-semi` 规则。✅ **已修复（2026-08-13）**：经 ESLint ASI 分析确认这些分号非必需后，`eslint --fix` 一键清理，`lint` 现为 0 errors / 0 warnings。
- **集成层 `[key: string]: any`**：✅ **已修复（2026-08-13）**，收敛为精确映射类型（见 §3 第 5 项）。
