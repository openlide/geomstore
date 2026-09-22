# tests-p2 判定记录（第五轮 / ocrreview.md）

10 条全部核实处置。改动文件：tests/types/plugin-parameter-types.typecheck.ts、
tests/types/selector-combiner-result.typecheck.ts、tests/types/selector-generic-defaults.typecheck.ts、
tests/types/store-config-base.typecheck.ts、tests/utils/createTestStore.ts，
新建 tests/types/test-store-inference.typecheck.ts（为 R5-359/R5-360 的工厂类型补回归锁）。

### R5-361  verdict=FIXED  属实：filter 用例此前只靠上下文推断，noImplicitAny:false 下退化即静默放行，已换成 typeof 探针。
- tsconfig.tests.json 第 6 行实测 `"noImplicitAny": false`，报告的失效前提成立；隐式 any 让 `typeof state extends UserState ? true : false` 展开为 boolean，赋 `true` 报 TS2322。
- 探针写法与 tests/types/plugin-hook-args.typecheck.ts 的既有约定一致；`npx tsc -p tsconfig.tests.json --noEmit` 零输出通过。

### R5-362  verdict=FIXED  属实：CartInstallable 只由 `Store.use` 的入参联合导出，与 persistencePlugin 返回类型无关，注释已改为「use 的入参联合被改写/收窄」。
- src/core/store/Store.ts:562 `use(plugin: PluginType<NoInfer<S>> | PluginType<State>)` 是 CartInstallable 的唯一来源；返回类型抹平只被下方 @ts-expect-error 组捕获，报告归因正确。

### R5-363  verdict=FIXED  属实：usePlugin 的两条负向调用已镜像一对类型级断言（Parameters<typeof usePlugin<CartState, Actions, Getters<CartState>>>[0]，正反双极性）。
- usePlugin 的 plugin 形参联合（src/core/hooks/HookSystem.ts:108）独立声明、不随 Store.use 漂移，单测其一不能守其二；TS 6.0.3 支持实例化表达式，tsc 通过且两条断言极性各向成立。

### R5-351  verdict=FIXED  属实：已补 Equal<DefaultCombinerResult, unknown> 精确断言，assignability 区分不了 unknown 与 any 的洞被钉死。
- Equal 采用双向同形技巧，`Equal<any, unknown>` 为 false：默认值漂回 any 时该断言以 TS2322 失败；`['combiner'] extends (...results: never[]) => infer R` 对现签名 `(...results: any[]) => unknown` 实测取回 unknown。

### R5-350  verdict=FIXED  属实：`Equal<_GettersOf<ItemsState>, Getters<ItemsState>>` 展开后两侧同一类型，永真；已删除别名并按报告改为单元格类型断言 `Equal<Getters<ItemsState>['k'], (state: ItemsState) => unknown>`。
- Getters<S>（src/types/store.ts:114）单元格为 `(state: S) => unknown`，S 漂白或返回值放宽都会翻转 Equal；`State` 导入仍被 ItemsState 约束使用，无悬空引用。

### R5-356  verdict=FIXED  属实：sharedOnly 已显式标注 `StoreOptionsBase<CounterState>`，恢复 EPC，键名拼错（如 cacheConifg）在 fixture 处即报 TS2353。
- StoreOptionsBase 六成员名与嵌套字段（capacity/ttl/trackAccessTime/enableStats、productionHandler:'silent'、onLimit:'throw'）逐一比对 src/types/store.ts 后标注编译通过；两条 spread 消费点行为不变。

### R5-357  verdict=FIXED  属实：已加负向锁定 `Record<string, unknown> = null as unknown as Unresolved`（@ts-expect-error）。
- ResolvedState<unknown> 实测退回 State=object（ResolveState 不命中函数分支），object 无隐式字符串索引签名 → 诊断确实命中（tsc 对未命中的 @ts-expect-error 会报 unused directive，实测零输出）；兜底漂成索引签名类型即编译失败。

### R5-358  verdict=FIXED  属实：已补零类型参数的 `satisfies StoreConfig` 裸写法用例，并顺带锁住裸配置下 cacheKeys 退化为 never[]（@ts-expect-error）与 getter 侧 Record<string, unknown> 兜底。
- bareForm 的 getters 形参显式标注 `Record<string, unknown>`：strictFunctionTypes 逆变下，兜底漂成 State(object) 或 unknown 都会拒绝该标注——R5-357 指出的「getter 侧兜底无人断言」一并补齐；两条新负向指令均实测命中。

### R5-359  verdict=FIXED  属实（可复现的真实类型洞）：createTestStore 的 `S extends Record<string, unknown>` 与 TestStoreConfig/StoreOptions/createStore 的 `S extends State` 口径不一致，interface 状态（无隐式索引签名）被拒收 TS2345；已改为 `S extends State`，默认值保留 Record<string, unknown>。
- 与 src/types/store.ts:13 `State = object`、:285 `StoreOptions<S extends State>` 对齐；仓库无调用点受影响（grep createTestStore 仅 tests/utils、tests/unit/store/store.test.ts、tests/types/create-test-store-config.typecheck.ts 三处引用），tsc+jest 全绿。回归锁见新建 tests/types/test-store-inference.typecheck.ts（interface ProfileState 直接传入）。

### R5-360  verdict=FIXED  属实且非破坏性：A/G 已按报告方案穿透工厂（`TestStoreConfig<S, A = Actions, G = Getters<S>>` + `createTestStore<S, A, G>(options: TestStoreConfig<S, A, G>)`），返回的 Store 保留字面 action/getter 映射。
- 改前按要求 grep 全部调用点：仅 store.test.ts 158 处 + p1 的类型断言文件，均无显式类型实参（`createTestStore<` 零命中）、无 `getters[动态键]` 访问；dispatch/getter 在 Store 上都有 string 兜底重载（src/core/store/Store.ts:488/501），改名/漏名不会新报错。
- 验证：`npx tsc -p tsconfig.tests.json --noEmit` 全绿；`npx jest --ci --silent tests/unit/store/store.test.ts` 160/160 通过；新锁 test-store-inference.typecheck.ts 断言 `store.getter('double')` 精确到 number（G 若退回索引签名即 TS2322）。

## 验证汇总
- `npx tsc -p tsconfig.tests.json --noEmit`：本分片全部改动落盘后实测 EXIT=0（含并行 agent 未扰动窗口的一次完整复跑）。
- `npx eslint <6 个文件>`：零输出。
- `npx jest --ci --silent tests/unit/store/store.test.ts`：160 passed。

## 主控需知（非本分片归属）
- 收尾复跑时 src/integrations/enterprise/background-sync.ts:131 出现一条 TS2345（`originalApp.call(this, rawOptions)`，rawOptions 为 unknown）——该文件正被并行分片编辑（git status M、错误行来自其未提交 diff），与本分片改动无关，请源码分片自行收口。
