# 分片 plugins-types-p2（13 条，纯类型契约层）— 第五轮

清单：`.ocr-fix/groups5/plugins-types-p2.md`。改动只落在 `src/types/{integration,store,performance,persistence,plugin,selector}.ts`。
回归锁：`tests/unit/r5-plugins-types-p2-contract.test.ts`（编译期断言集中在 `_typeLocks`，运行期 5 例）。

自验口径（全程实际跑过，均无本分片的残留错误）：
`npx tsc -p tsconfig.json --noEmit`、`npx tsc --noEmit -p tsconfig.typecheck.json`、`npx tsc --noEmit -p tools/tsconfig.examples.json`、
`npx tsc -p tsconfig.tests.json --noEmit`、`npx jest tests/unit/r5-plugins-types-p2-contract.test.ts`、`npx eslint <改动文件>`。

### R5-327  verdict=FIXED  HostStoreApi.subscribe 补上 options 位点，并声明漏掉的 `__store__` 别名

成立：修复前 `app.subscribe(cb, { readOnly: false })` 直接 TS2554（临时探针实测 `error TS2554: Expected 1 arguments, but got 2`；
探针已折进 `tests/unit/r5-plugins-types-p2-contract.test.ts` 的 `_typeLocks`，下同），而 `src/integrations/utils.ts` 的实现是
`subscribe(cb, options ?? { readOnly: true })` 且注释明写「确需就地改载荷的调用方显式传 { readOnly: false }」——类型与它声称镜像的运行时契约互相矛盾。
五个方法拆成内部 `HostStoreDebugApi`（不导出，先例是同文件的 `InjectedDataShape`），`HostStoreApi extends` 它并加 `readonly __store__`，
与运行时「api 只定义一次、展平成员与别名同一个对象」同形；`keyof HostStoreApi<S>` 因此自动把 `store` / `__store__` 也计入撞名让位清单。
API-CHANGE: `HostStoreApi` 公开面新增必填成员 `__store__`、`subscribe` 多一个可选形参（只放宽，不收紧；仓库内无实现方，`AppThis` 是唯一消费点）。

### R5-328  verdict=FIXED  mapState/mapGetters 撞名键按运行时次序归 getter，不再塌成 never

成立：修复前 `ExtractPageData<St, {mapState:['count'];mapGetters:['count']}, Gl>['count']` 实测为 `never`（断言
`Equal<…, never>` 编译通过），而运行时两侧写同一个本地键空间、state 先 getters 后，留下的是 getter 的值。
取报告第一方案（`Omit` 掉撞名键），但**报告只点了 `ExtractMappedState` 一侧不够**：`Partial<S>` 里那份 `T | undefined` 同样要剔，
否则「getter 名恰好是状态键、却没写进 mapState」这一路仍是 `never`（实测 `ExtractPageData<St, {mapGetters:['name']}, Gl>['name']` 修复前塌 never）——
后者比前者更隐蔽，因为它连 `mapState` 都不需要写。不撞名时 `keyof object` 即 `never`，两次 `Omit` 都是恒等，既有精确性断言（`tests/types/compose-getters-mapping-precision.typecheck.ts`
的逐键 `Equal`、`integration-types` 的 `_dataIsExtractPageData`）全部照旧通过。
API-CHANGE: `ExtractPageData`（以及共用它的 `PageThis/PageConfig/ComponentThis/ComponentConfig/AppThis.globalData`）在键相交时的结果形状由 `never` 改为 getter 返回类型。

### R5-329  verdict=FIXED  保留键清单补 `onRouteDone`

成立：清单里确实没有它，漏收的表现为 `PageOwnMethods` 把它当用户方法（实测断言 `'onRouteDone' extends keyof PageOwnMethods<{…; onRouteDone(): void}>` 为 true）。
只补报告点名的这一个：本机无网络、仓库内也不带 `miniprogram-api-typings`（`ls node_modules | grep miniprogram` 无命中），
Skyline 侧的 `onBackPress` / `onPullIntercept` 等是否属同一张表无法离线核对，不凭印象往公开清单里塞键——注释改成「按基础库 Page 事件表逐项维护」并写清补键的连带义务。
连带项见文末 NEEDS-MAIN（`PageCfgShape` 夹具要同步一行）。
API-CHANGE: `PageReservedKeys` 联合多一个成员（纯类型、无运行时影响，与第四轮 #427 同性质）。

### R5-330  verdict=FIXED  名为 `globalData` 的 action 让位，类型不再承认 `this.globalData()` 可调用

成立：修复前同一个实例上 `appThis.globalData()`（返回 string）与 `appThis.globalData.count` **都能编译**（实测两行皆零报错），
而运行时 `bindActions` 的 `Object.defineProperty(this, 'globalData', …)` 会把刚写进 `this.globalData` 的映射数据整包顶掉
（实测 `typeof config.globalData === 'function'`，`mapState` 的 `count` 消失，`bindActions` 另有「宿主已有成员将被覆盖」告警）。
方向与调试 API 那批相反：那里赢家是调试 API，这里赢家是 action，但可交付的类型只有「数据形状」一种（把 `globalData` 声成函数等于让 `data` 侧全部不可用），
故让位 + 注释指路别名写法 `mapActions: { setGlobalData: 'globalData' }`。`Omit` 的键集合成 `keyof HostStoreApi<S> | 'globalData'`。
API-CHANGE: `AppThis` 上 `globalData` 不再可调用（此前能编译的是错的那一侧）。

### R5-313  verdict=FIXED  MetricType 按「谁会写它」分两组写明，不收窄

成立：`src/` 内只有 `'setState' | 'patch' | 'replaceState' | 'dispatch' | 'getter'` 进过 `monitor.start/record`
（`grep -n "monitor.start(" src/plugins/performance/analyzerPlugin.ts` 五条命中，其余四个标签在 `src/` 内零产出，仅 `PerformanceMonitor.ts` 的 JSDoc 与测试引用）。
取报告第二方案（文档化 reserved/unused）而不是收窄联合：`record()`/`getMetricsByType()` 是公开入口，
收窄会把消费者自定义的标签维度判成编译错误，还会打掉 `tests/unit/core/performance/PerformanceMonitor.test.ts:561/565` 那条 `'state-update'` 用例。
顺带把 `'state-update'`（`OperationType` 同名成员那一侧的逻辑分类）与 `'setState'`（一次调用计时）不是一个桶写进注释，正是报告说的分桶风险。
锁：`r5-plugins-types-p2-contract.test.ts` 一条运行期断言（内置监控器上 `getMetricsByType('notify')` 为空、自定义标签可查）。

### R5-314  verdict=FIXED  getMetrics 的副本契约说一遍，删掉两处实现特定的旁注

成立：原括注「浅拷贝数组仍共享元素，改 `m.duration` 会写脏内部数据」与 `PerformanceMonitor.getMetrics` 的实现相反——
`src/core/performance/PerformanceMonitor.ts:414-417` 是 `this.metrics.map((m) => ({ ...m }))`（`getMetricsByType` / `getMetricsByOperation` / `getRecentMetrics` 同形），
`MetricsCollector` 也没 `implements PerformanceMonitor`（只有 `:71` 那个类实现），把它当本接口「已知差异」确属误导。
现在契约只写一句「数组与元素都是独立副本」+ 一句「只复制数组即不满足契约」，并补一条运行期锁（改写返回对象后 `getStats().byOperation…avgDuration` 仍是原值）。

### R5-315  verdict=FIXED  PerformanceOptions 写明「归一化是实现层的义务」并逐条给越界表现

成立：数值域在类型上就是裸 `number`，责任层此前无人认领。现按实现现状写清：`PerformanceMonitor` 构造与 `setOptions` 两处都过
`normalizeSampleRate`（夹 `[0,1]`、非有限回退 1）/ `normalizeThreshold`（夹 `>= 0`、非有限回退 16）/ `normalizeMaxSize`（有限非负整数，默认 1000），
`MetricsCollector` 的环形缓冲同口径（默认 10000）；不做归一的表现逐条写进各字段注释（>1 全采样、负/NaN 一条不留、小数 maxSize 取到空洞下标）。
不采纳品牌类型（`UnitInterval` 之类）：那会把公开签名变成会报错的形状，且 `PerformanceOptions` 是消费者自己也要写的入参类型，收益不抵破坏面。

### R5-318  verdict=FIXED  restore 的默认值补进契约，filter 的双路径写清

成立：`src/plugins/builtin.ts:119` 是 `restore: shouldRestore = true`，此前只有 `clearOnUninstall` / `debounce` 标了默认值，
同类型里口径不一致正是要不得的那种「读注释的人会漏」。`filter` 确实在两条路径上都套：
落盘前 `filter(state)`（:250）、恢复时 `filter(parsedState)` 再 `$patch`（:215-218），单向理解的写法会让「只持久化子集」的配置在恢复时静默吃掉未过滤键。
纯注释改动，无契约变化；默认值本身已由既有 persistence 用例覆盖，未重复加锁。

### R5-331  verdict=FIXED  HookArgsMap 的 patch/replace 载荷写明是刻意收宽

成立：`Store.ts:344/366` 传出的确是 `Partial<S>`、`:387/433` 传出的确是 `S`，表里写的 `Record<string, unknown>` / `object` 是擦除后的形状；
原注释「参数类型取实现层实际传出的形状」会让读者以为已经按键建模。补了收宽的原因（`IHookSystem` 不随 S 泛型化，否则一个 HookSystem 只能服务一种状态）
与 `object` 的那一半陷阱（数组/函数能通过编译，但 `$patch`/`$replaceState` 先按「必须是普通对象」抛 TypeError，钩子观察不到那种载荷）。
纯注释改动，不动元组类型。

### R5-332  verdict=FIXED  emit 的吞异常语义限定为「当前实现的行为约定」

成立：`IHookSystem.emit` 返回 `void`，类型层无法强制任何实现去 catch；仓库内 `core/store/ActionManager.ts` 的 dispatch 事务注释
明写「hooks 是注入的 IHookSystem，接口不保证 emit 内部吞掉处理器异常」并把 `emit` 放进 try，正是与本段旧措辞相反的假设。
现在四条行为全部前缀「按当前实现（`core/hooks` 的 HookSystem）」，并给出插件作者的自保口径（不能承受异常冒进业务栈就在处理器内 try/catch）。
纯注释改动。

### R5-323  verdict=FIXED  combine 侧的 R 推断承诺按现状收回，修法记 NEEDS-MAIN

成立：`src/extras/selector/selectorComposer.ts` 的 `combine<S, R = unknown, T>(input: SelectorComposerInput<S, T>)` 不给 `R` 任何推断来源，
`R` 只能由调用点上下文回推、`as R` 仍在，而本文件那段注释写的是「由 combiner 的返回类型直接给出、不再需要 `as R`」——契约描述了未接线的行为。
类型侧不能单方面兑现：把 `SelectorComposerInput` 的 `R` 默认去掉会让 `src/extras` 与 `tests/types/selector-combiner-result.typecheck.ts`
（该文件断言的正是「两参数写法的默认 `R` 是 `unknown`」）同时报错，且 `combine` 的 `S` 同样没有推断来源（实测未标注时 `S` 落到约束 `object`）。
注释改为「现状 + 今天拿到精确结果的两种写法 + 修法在实现层」，兑现部分等 NEEDS-MAIN 落地后收尾。

### R5-324  verdict=FIXED  cacheTTL 的归一化责任层写明，去掉悬空的过程引用

成立（对类型层而言是文档准确性）：`SelectorOptions.cacheTTL` 就是裸 `number`，取值不校验是事实，原注释已承认，
但结尾「属 `src/extras`，见本轮待办」是对着评审流程的悬空引用，读代码的人无从查起。现写成自包含一段：责任在
`createSelector.ts` 的 `SelectorFactory`（当前只有 `?? 5000`，与 `cacheSize` 的「夹到有限正值」不同口径）、两类无效值各自的表现、
以及「要拒值去改归一化，别在类型层做把戏」。不在类型上收（`Positive<number>` 之类会把 `SelectorOptions` 变成消费者写不出来的形状）。
落地守卫的是 extras-selector 分片的 R5-225，见文末 NEEDS-MAIN。

### R5-326  verdict=FIXED  退化输入的 cacheKeys 改由 `StoreConfig` 的 S 默认值解决；报告给的表达式实测破 factory

成立：修复前 `const cfg: StoreConfig = { state: {count:1}, cacheKeys: ['count'] }` 实测
`error TS2322: Type 'string' is not assignable to type 'never'`（`ResolvedState<unknown>` 归一到 `object` ⇒ `keyof` 为空）。
**报告建议的 `Array<keyof ConfigState<S>>` 不能采纳**：`keyof <未展开条件类型>` 会参与 `src/core/store/factory.ts` 里 `new Store(options)` 的反向推断，
S 的候选被污染成 `ConfigState<S | (() => S)>`，实测两条错（TS2322 返回值不兼容 + TS2345 实参不兼容），
显式类型实参 `new Store<S, A, G>(options)` 同样救不回（在探针里以同形签名复现，仍是 TS2345），`NoInfer<Array<…>>` 也拦不住该候选。
改为把退化输入一次归位：`StoreConfig` 的 `S` 默认值取 `Record<string, unknown>`（与 `getters` 一侧的兜底同一口径），
`cacheKeys` 因此自然接受任意字符串键，`keyof ResolvedState<S>` 的表达式不动 ⇒ 具名状态下仍是键集精确（补了 `@ts-expect-error` 负例锁住），
`factory.ts` / `examples` / 其余 `tests/types` 全绿。同时把 getters 那处内联条件表达式提成命名 `ConfigState<S>`（报告的去重诉求），
并在两个 helper 的注释里写清「为何 cacheKeys 不能共用」并附实测证据。
API-CHANGE: `StoreConfig` 的 `S` 默认值 `unknown` → `Record<string, unknown>`（裸 `StoreConfig` 作形参类型时，`state` 不再接受无索引签名的 interface 值；
走 `createStore` 的调用不经过该默认值）。新增导出类型别名 `ConfigState<S>`（与 `ResolvedState` 同属深路径导入面，`src/core/index.ts` 的精选再导出未列 `ResolvedState`，故不跟着动）。

---

## NEEDS-MAIN

- NEEDS-MAIN: `tests/types/integration-types.typecheck.ts` `PageCfgShape` 夹具补一行 `onRouteDone: () => void`（R5-329 扩了 `PageReservedKeys`，297 行
  `_reservedKeysAllCovered` 断言现为 `error TS2322: Type 'true' is not assignable to type 'false'`）。该文件归 tests 分片。
- NEEDS-MAIN: `tests/types/store-config-base.typecheck.ts` 102 行的 `@ts-expect-error 裸写法下 … cacheKeys 退化为 never[]` 现在 unused
  （`error TS2578`）——裸 `StoreConfig` 的 `cacheKeys` 已可用，应改成正例；同文件 89/92 行「S 取默认 unknown」「与 ResolvedState 的 object 兜底刻意不同」两处措辞同步。归 tests 分片。
- NEEDS-MAIN: `src/extras/selector/selectorComposer.ts` `combine` 的参数位点 `SelectorComposerInput<S, T>` → `SelectorComposerInput<S, T, R>`
  （同处另有 R5-232 的 `as R` 断言待删），落地后把 `src/types/selector.ts` 里 `SelectorComposerInput` 注释的「现状」段落收尾。归 extras-selector 分片。
- NEEDS-MAIN: `src/extras/selector/createSelector.ts:94` `cacheTTL: options.cacheTTL ?? 5000` 补数值守卫（R5-225 已在其分片内），
  落地后同步 `src/types/selector.ts` 的 cacheTTL 注释（本分片刻意先只写「责任层 + 现状」，不预告未落地的行为）。归 extras-selector 分片。
- 提示（非单条 finding）：`src/types/**` 的公开面本轮有变（`HostStoreApi` 成员、`PageReservedKeys`、`ExtractPageData` 撞名口径、`StoreConfig` 默认 S、新增 `ConfigState`），
  由 `scripts/generate-skill-api-reference.mjs` 生成的 `.codebuddy/skills/geomstore/references/api/*.md` 仍是旧快照，需随 Wave D 一并重跑。
