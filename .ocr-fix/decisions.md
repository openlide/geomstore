# ocr.md 修复决策台账

报告：`ocr.md`（454 条 · 127 个文件）。本台账逐条记录判定与处置，编号 `#N` 对应
`ledger.tsv` 的第 N 行（即报告内第 N 个 `─── 文件:行号 ───` 块）。

- `fix` = 已按报告（或等价的更严格修法）改代码
- `FP` = 误报（附证据，未改代码）
- `reject` = 问题真实但报告的修法方向错误，保留现状并说明

## Wave A — critical + high（37 条：fix 33 / FP 3 / reject 1）

| # | 严重度 | 位置 | 判定 | 处置与证据 |
|---|---|---|---|---|
| 1 | critical | eslint.config.js:69 | FP | ESLint 9.39.2 仍内置 `no-extra-semi`：`eslint --print-config src/core/store/Store.ts` 输出 `"no-extra-semi": [2]`，`pnpm lint` 退出 0。该规则是 v8.53 弃用、**v10** 移除项，报告把移除版本说成 v9。 |
| 67 | critical | benchmark/constants.ts:32 | fix | `THROUGHPUT_THRESHOLDS` 改为由 `TIME_THRESHOLDS` 推导并留 0.5 安全系数，消除 GETTER_AVG 0.05ms(=20000 ops/s) 与 GETTER_MIN 50000 的互不可满足。 |
| 130 | critical | PerformanceMonitor.ts:260 | fix | 新增 `normalizeMaxSize`（有限/非负/整数）+ `trimToMaxSize` 一次性 splice；构造器与 `setOptions` 均规范化。负数 maxSize 此前会让 `while (length > maxSize) shift()` 在空数组上死循环。 |
| 334 | critical | enterprise/user-store.ts:77 | fix | 响应体校验后再 resolve，缺 `userInfo` 改为 reject；statusCode 按 `WxRequestOptions` 的必填类型直接判断，不再自行降级为可选。 |
| 405 | critical | tests/jest.d.ts:7 | fix | 整文件删除（`git rm`）。顶层 `JestMatchers` 从不被 `expect()` 引用，所有 matcher 由 @types/jest 提供；删后 `typecheck:tests` 退出 0。 |
| 438 | critical | pnpm-workspace.yaml:4 | FP | pnpm 12.3.4 实际识别 `allowBuilds`：`node_modules/.modules.yaml:1330` 有它写回的 `allowBuilds: {esbuild:true, unrs-resolver:true}`，且 `pendingBuilds: []`。按报告改成 `onlyBuiltDependencies` 会让该白名单失效。 |
| 6 | high | jest.config.js:15 | fix | `.github/workflows/ci.yml` 在 Typecheck(src) 与 (examples) 之间补 `Typecheck (tests)`，使 `typecheck:tests` 进 CI（此前测试代码类型错误永不被发现）。 |
| 10 | high | .prettierrc.json:10 | fix | 改名 `bracketSameLine`。注：prettier 3.8.1 实测只输出 `jsxBracketSameLine is deprecated` 警告并仍生效，报告称「3.0 已移除、静默忽略」不准确，但改名仍是正确处置。 |
| 18 | high | benchmark/package.json:35 | fix | peer `^0.4.0` → `^0.5.1`（0.x 下 caret 锁 minor，^0.4.0 与仓库自身 0.5.1 不兼容）。 |
| 21 | high | tsconfig.json:28 | FP | 构建不读基线的 `noEmit`：`tsconfig.build.json` 显式 `"noEmit": false`，emit 选项经 extends 生效。已在 tsconfig.json 加注释说明该分工，避免后续误删。 |
| 28 | high | scripts/clean-dist.mjs:54 | fix | `countFiles` 入 try/catch 只告警（兑现脚本头「清理失败不中断构建」）；同时 `postbuild-dist.mjs` 的 map 删除改逐文件兜错并汇总告警。 |
| 31 | high | scripts/minify-dist.mjs:59 | fix | esbuild/terser 先把全部结果备在内存，再统一 `writeAll` 落盘，避免中途失败留下半压缩 dist。 |
| 39 | high | scripts/minify-dist.mjs:74 | fix | 删除 uglify-js 兜底分支（不支持 ESM/ES2015+，`module` 是 terser 专有选项），并更新文件头探测顺序说明。 |
| 44 | high | tools/fix-errors.sh:1 | fix | 加 `set -euo pipefail`，build/test 失败即以非零码中止，末尾「完成」不再无条件输出。 |
| 47 | high | benchmark/reporter.ts:117 | fix | 新增 `escapeHtml()` 并用于 `r.scenario`、metadata（timestamp/nodeVersion/platform）与 `recommendations` 的 `<li>`。 |
| 56 | high | benchmark/helpers.ts:160 | fix | `mergeCacheStats` 汇总 `evictions`；全部来源都缺该字段时保持 undefined，不把「未统计」写成「0 次淘汰」。 |
| 72 | high | benchmark/runner.ts:147 | fix | `runScenario` 主体包进 try/finally，`store.destroy()` 移到 finally。 |
| 86 | high | compose/StoreRegistry.ts:95 | fix | 覆盖注册时的 `existingStore.destroy()` 加 try/catch + console.error，与 `unregister`/`clear` 一致，保证覆盖一定完成。 |
| 91 | high | benchmark/utils.ts:162 | fix | 并发池改为 `const index = completed++` 同步预约槽位并写入 `results[index]`，不再超跑 total 次，结果顺序同时确定。 |
| 108 | high | compose/helpers.ts:93 | fix | 去掉 `!options?.warnMissingKeys` 耦合：嵌套归属只按数据形状判定，开发/生产走同一分支。 |
| 144 | high | compose/composeStore.ts:497 | fix | 引入 `_deferredDirtyStores` + `_notifying` 与 `_markDirtyStore()`，收尾换成「本轮脏键作废、通知期间新脏键留给下一轮」（对齐 Store._deferredDirtyKeys）。 |
| 176 | high | store/dirtyTracking.ts:101 | reject | 问题真实（只读方法也标脏、`onlyOnChange` 失效），但报告的修法（先调用后 report）会把「多报」换成「漏报」：方法内改完状态再抛错时脏标记丢失 → 视图永久漏更新。现状是注释明示的「宁可多报」保守契约，保留。 |
| 199 | high | decorators/common.ts:80 | fix | `createDecorator` 不再无条件 async：同步方法原样返回，结果为 Promise 时以 `.then` 挂 after/onError；补 `typeof originalMethod !== 'function'` 早失败守卫，并保留原方法 `name`/`length`。 |
| 238 | high | ErrorAggregator.ts:168 | fix | 按组维护 `storeHits`，组被 `maxGroups` 驱逐时同步删除其计数，使 `sum(byStore) === totalErrors` 在驱逐后仍成立。 |
| 245 | high | ConsoleReporter.ts:39 | fix | `report`/`reportBatch` 的分组体包 try/finally 调 `groupEnd()`。 |
| 257 | high | ErrorMonitoring.ts:188 | fix | `reportTimeout <= 0` 特判为「不超时」：不再创建 0ms 定时器，直接等待 task（此前真实异步上报几乎必然被判超时→重入队→按 maxFlushRetries 丢弃）。 |
| 261 | high | ErrorBoundary.ts:167 | fix | `handleError(rawError: unknown)` 入口归一化后再写 `errorHistory`/回调/fallback；重抛仍用原始值以保持既有捕获方语义。 |
| 266 | high | ErrorRecovery.ts:142 | fix | 展开顺序改为 `...context` 在前、受控字段 `error`/`config`/`attempt` 在后，调用方无法再覆盖策略与重试记账键。 |
| 279 | high | retrySelector.ts:33 | fix | `annotateAttempts` 先判对象性与可扩展性，`defineProperty` 入 try/catch；标注失败不再顶替原始错误。 |
| 284 | high | snapshot/clone.ts:300 | fix | Map 值路径改 `String(k)`，Symbol 键不再触发 `ToString(Symbol)` 抛错（clone-async 早已是该写法，clone.ts 是唯一漏点）。 |
| 298 | high | SnapshotManager.ts:155 | fix | 同步与异步两处 catch 的 `data: data as T` 改 `data: undefined as T`，中止/异常不再回传活引用。 |
| 346 | high | integrations/utils.ts:209 | fix | `bindActions` 改用 `Object.defineProperty` 写自有属性（`__proto__`/`constructor` 不再沿原型链污染），冲突时告警并在解绑时恢复原值。同条 finding 里 point 到的 with-app-store / exposeStoreAPI / with-store 分项由各自文件条目处理。 |
| 389 | high | types/persistence.ts:67 | fix | `getItem` 收紧为 `typeof value === 'string' && value !== ''`（wx 缺失键返回 `''`），并把 `getStorageSync` 返回类型放宽为 `unknown` 使守卫有意义。 |
| 393 | high | types/compose.ts:93 | fix | `ExtractGetters` 先排除 `undefined extends First['getters']` 再交，避免 `undefined & {}` 塌成 never 使组合 store 的 G 退化为 never。 |
| 406 | high | tests/jest.d.ts:11 | fix | 同 #405：文件删除即消除误拼的 `toHaveBeenCalledNthWith`（Jest 真名 `toHaveBeenNthCalledWith`，由 @types/jest 提供）。 |
| 418 | high | tests/utils/createTestStore.ts:17 | fix | 不再写回入参：无 name 时用 `{ ...options, name }` 构造新对象，复用同一 fixture 的多个测试不再撞名，冻结入参也不再抛错。 |
| 426 | high | types/integration.ts:43 | fix | `ExtractMappedState`/`Getters`/`Actions` 各加 `undefined extends M[...]` → `object` 守卫；连带把 `withAppStore` 的 M 位点改成按实参推断（新增 `O extends ConnectOptions<S,A,G>`，与 withPageStore 一致），并把 `tests/integration/with-app-store.test.ts` 的 `let store: any` 改为 `Store<AppState>`（`any` 会让 `keyof S` 退化为 never）。 |

## Wave B — medium（239 条）

待处理。

## Wave C — low（178 条）

待处理。
