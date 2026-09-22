# 分片 plugins-types-p1（23 条，第五轮）— 断片接手对账 + 补齐

接手状态：前任改了代码但无台账。逐条与 `git diff` 对账后确认 **22 条已落地且方向正确**，
本分片补做/修正 4 处：R5-317 判定为改不动（转 NEEDS-MAIN，零改动）、修正 R5-319 遗留的**过期事实注释**
并补上它自己承认的栈增长代价（`MAX_PENDING_DEPTH` + 回归例）、按本轮并行改动校正 R5-310 的过期注释事实、
同步两处测试里的过期计数与本分片文件的 prettier 漂移。前任已写好回归锁
`tests/unit/r5-plugins-types-p1-plugins.test.ts`（29 例）与 `tests/unit/r5-plugins-types-p1-types.test.ts`（4 例 + 编译期锁）。

清单：`.ocr-fix/groups5/plugins-types-p1.md`。改动只落在本分片 11 个文件 + 3 个测试文件。

自验口径（全程实跑，均在本分片改动之后）：
- `npx tsc -p tsconfig.json --noEmit` → 本分片 11 个文件零报错（末次运行仅 `src/core/store/StateProxy.ts` 一条 TS6133，属并行分片中间态）
- `npx tsc -p tsconfig.tests.json --noEmit` → 本分片文件零报错（仅余 tests/types 与别的分片新建用例的 7 条）
- `npx eslint <本分片 11 个 src 文件>` → 零输出；`npx prettier --check src/plugins src/types/{action,compose,error,global}.ts tests/unit/r5-plugins-types-p1-*.test.ts` → 干净
- `npx jest --ci --silent tests/unit/plugins tests/integration tests/unit/r5-plugins-types-p1-plugins.test.ts tests/unit/r5-plugins-types-p1-types.test.ts tests/unit/hot-round5.test.ts tests/unit/types-interface-state.test.ts tests/unit/core/error` → **24 suites / 808 tests 全绿**
- 全量 `npx jest --ci --silent tests/unit` → 3153 passed / 6 failed；失败的 3 个 suite（`r5-core-store-p1-state-proxy`、`ocr-medium-round4-p3`、`ocr-medium-round4-p4`）都在 clone/state-proxy/snapshot 域，非本分片文件

对 R5-279 / R5-305 的主会话结论照单接受，未触碰 `tests/unit/hot-round5.test.ts` 与
`wx-storage-backend.test.ts` 的三条抛错断言（只在其既有契约下补了 R5-280 的同源断言）。

### R5-300  verdict=FIXED  恢复失败的三条出口全部转投 onError('persistence')，与写入失败同口径

`installPersistence` 新增 `skipRestore(reason)`（console.error + `store.hooks.emit('onError', new Error(reason), 'persistence')`），
两个「skipping restore」分支（非纯对象、validate 拒绝）与 catch 分支（后端抛错、JSON 语法错、`$patch` 被拒）三条出口都改走它/补 emit，
`console.error` 保持原样。回归：`r5-plugins-types-p1-plugins.test.ts`「R5-300 persistence 恢复失败转投 onError」3 例（含断言首参 `objectContaining({message})` + 次参 `'persistence'`）。
API-CHANGE: `persistencePlugin` 在**恢复**失败时也会发 `onError(err, 'persistence')`（改前只写 console）；只订阅 `onError` 做监控的调用方会多看到一类事件。

### R5-301  verdict=FIXED  卸载一律摘待触发定时器，回调自身先把句柄复位为 null

disposer 里 `if (debounceTimer) { clearTimeout; debounceTimer = null }` 提到 `if (!clearOnUninstall)` 之外（只有「补写」仍受 `clearOnUninstall` 约束），
`setTimeout` 回调改为进入即 `debounceTimer = null` 再判 `isUninstalled`，使 `if (debounceTimer)` 重新等价「确有落盘待触发」。
回归：同上文件 3 例——`clearOnUninstall: true` 时 `jest.getTimerCount()` 由 1 变 0 且不补写；定时器已触发后卸载不再调用 `clearTimeout`（spy 断言零调用）。

### R5-302  verdict=FIXED  恢复入口新增 isRestorablePayload，自带 `__proto__` 自有键的载荷直接拒收

`builtin.ts` 顶部新增 `isRestorablePayload = isPlainObject(v) && !hasOwn(v,'__proto__')`，替换原 `isPlainObject` 判定，注释改写为「只校顶层原型 +
深层同名键由 clone/merge 的 defineProperty 兜底」这一实际覆盖面（原注释「防止原型链污染」确实言过其实）。
回归：`r5-plugins-types-p1-plugins.test.ts` 用 `'{"__proto__":{"injected":1},"count":7}'` 断言不恢复、状态无 `__proto__` 自有键、`Object.prototype` 未被污染。
报告建议的「把共享判定挪进 `src/core/utils/helpers.ts` 与 devtools 的 `isImportableObject` 复用」需要改 core（本分片禁改）→ 见文末 NEEDS-MAIN（可选）。

### R5-281  verdict=FIXED  devtools/index.ts 的两句假陈述改为「只有全局调试入口不在生产挂载」

核对实现为真：`timeTravelPlugin.install()` 无条件建 `snapshots`、无条件 `store.subscribe`、`__timeTravel__ = api` 也在 `if (!isProduction())` 之外，
所以改前「生产构建下插件根本不注册」「该字段在生产不存在」两句都与代码相反。现文档写明 install 照常执行、直到卸载才清理，
`store.__timeTravel__` 存在但不参与类型检查、无对外契约。纯注释，无代码改动；示例代码同步为 `?.` 读法。

### R5-297  verdict=FIXED  importHistory 把 JSON.parse 圈进 try，语法错误按「畸形数据」静默跳过

改前 `api.importHistory('{')` 会把 SyntaxError 抛出 API，与同方法其余「结构不合即 return」的防御契约矛盾（devtools 导入流程整体中断）。
现为 `let data: {snapshots?: unknown; currentIndex?: unknown}; try { … } catch { return }`。
回归：`r5-plugins-types-p1-plugins.test.ts` 对 `'{'`/`'{"snapshots":['`/`'<html>…'`/`''`/`undefined` 五类载荷断言 not.toThrow 且快照数与索引不变，另一例断言截断后仍可正常导入。
API-CHANGE: `timeTravelAPI.importHistory` 的契约由「非法 JSON 抛错」改为「非法 JSON 静默跳过」（与既有「结构非法即跳过」并轨）。

### R5-298  verdict=FIXED  maxSize 经 normalizeMaxSize 归一为 ≥1 整数，NaN/0/负数/Infinity 一律回退 50

两个相反方向的失效都堵住：`NaN` 下 `snapshots.length > NaN` 恒假（上限消失、快照无界增长）、`0`/负数下 push 完立刻 shift（历史恒空）并在
`importHistory` 的 `overflow = snapshots.length - maxSize` 里留下「空快照 + currentIndex=0」这一 `clear()` 从不产生的非法索引。
实现取 `Number.isFinite && >= 1 ? Math.floor(raw) : 50`（小数向下取整），`TimeTravelOptions.maxSize` 文档同步。
回归：`it.each([NaN,0,-1,Infinity,-Infinity])` 断言 60 次变更后恰留 50 条且索引 49；`3.7 → 3`、`5 → 5`、缺省 → 50；`maxSize: 0` 导入两条历史得 count=2/index=1 且 `goTo` 不抛。
API-CHANGE: `timeTravelPlugin({maxSize})` 对非法取值的语义由「静默失效/恒空」改为「按默认 50 生效」。

### R5-299  verdict=FIXED  全局键串提为 TIME_TRAVEL_GLOBAL_KEY，注册与日志同源

`const TIME_TRAVEL_GLOBAL_KEY = '__GEOMSTORE_TIME_TRAVEL__'` 同时用于 `registerGlobalEntry` 与访问提示日志，改一处不会再让日志指向不存在的路径。
同一形态在 `builtin.ts`（`STORES_GLOBAL_KEY`/`DEVTOOLS_GLOBAL_KEY`）与 `analyzerPlugin.ts`（`ANALYZER_GLOBAL_KEY`）一并收敛（各 2 处重复）。
回归：`r5-plugins-types-p1-plugins.test.ts` 抓 `console.log` 里的 `Access at:` 行，断言其指向的表键下真能读到该 store 的条目。

### R5-306  verdict=FIXED  换表只在容器确实挂不住条目时发生，且抛弃非空容器前出声告警

承接主会话 R5-305 的 `Object.isExtensible` 判据，本条补的是「静默孤儿化」：`discardedEntries = Object.keys(existing).length` 仅在 object-like 时读
（原始值/函数上挂不住条目，`Object.keys('abc')` 还会读出字符下标，据此告警等于谎报），只在**真正换新表**且计数 > 0 时 `console.warn` 点明「这些条目的调试入口失效、其卸载函数成为空操作」。
`isExtensible`/`keys` 两步连同判定圈进 try：探测抛错按「不可复用」处理而非放弃注册。
回归：`r5-plugins-types-p1-plugins.test.ts`「R5-306 换掉容器时必须出声」2 例（冻结表告警 / 原始值容器不告警；`isExtensible` trap 抛错的 Proxy 降级为新表且卸载不抛）。

### R5-307  verdict=FIXED  摘空表前先认 identity：current === table

改前 `current` 从 `globalThis` 重读，一旦「看起来空」就把外部（或别的库）刚挂上来的同名表从 globalThis 删掉。
现在 `if (current === table && Object.keys(current).length === 0) delete g[globalKey]`。
回归：`r5-plugins-types-p1-plugins.test.ts`「R5-307」构造两种情形——条目被整表替换、换上一张同名条目已删空的新表——都断言 `g[globalKey]` 仍是外部那张（`toBe`）。

### R5-308  verdict=FIXED  键位归属表改嵌套 Map，NUL 拼键碰撞消失且条目随释放自动收缩

`registrationOwners: Map<string, Map<string, number>>` + `claimOwner`/`releaseOwner`：彻底不做字符串拼接，
`globalKey` 或 `storeName` 含 `\u0000` 时两对键位互不侵占（改前后一次注册会「接管」前一次的令牌，前者的卸载函数永久变空操作、条目留在表上）。
`releaseOwner` 成功即删内层键、内层空了删外层键，因此表规模正比于「当前在册键位数」而非「出现过的键位数」。
报告提到的「无 reset/cap」：不额外开一个测试用 reset 出口（属垫片），残留只来自「从不卸载」的 store，与全局表本身同源。
回归：`r5-plugins-types-p1-plugins.test.ts`「R5-308」用 `('A\u0000B','C')` 与 `('A','B\u0000C')` 两对断言各自注册可见、各自卸载后两张表都被摘净。

### R5-319  verdict=FIXED  onError 只在「来源显式点名配对键」时弹栈；注释里的过期发射点计数已改对，并补上栈深度上限

前任已删掉 `HOOK_TO_OPERATION` 归一与 `source === undefined → popEnd('dispatch')` 兜底（误弹的真正后果不是少一条指标而是**配错 span**：`HookSystem.emit`
吞掉处理器异常后 after* 照常来，提前弹内层会让 after* 弹到外层），实现即报告的第二方案。本分片补两处：
1. 注释事实校正——「全库 5 处不带来源的 emit」在 core 收敛后已不成立：无源发射点实为 2 处（`ActionManager._reportSettledFailure`、`Store.ts` 的 `onListenerError`），
   前者被 5 条失败路径共用、其中只有同步 dispatch 的 catch 真的中止操作，且**当前没有任何发射点带配对键 source**，故本分支暂不命中（改前措辞「ActionManager 的失败路径补上 'dispatch' 后即命中此分支」把未发生的 core 改动写成既成事实）。
2. 注释承认的代价（中止一次留一条永不 pop 的栈项，重试风暴下持续增长）落地为 `MAX_PENDING_DEPTH = 1000`：超限淘汰栈底并 `console.debug` 说明缺口（与 `PerformanceMonitor` 计时条目缺失时同口径）；
   淘汰栈底不破坏配对（pop 取栈顶），量级与 `PerformanceMonitor.DEFAULT_MAX_SIZE` 一致。顺带修掉 `instrument` 的 `@param pairKey` 与实参名 `type` 不符。
回归：`tests/unit/plugins/performance/analyzerPlugin-timing-stack.test.ts` 5 例（无 source 一条都不弹、钩子名作 source 不弹、显式 `'dispatch'`/`'setState'` 才弹、嵌套配对不串、
新增栈上限例：1000 条内无 debug、第 1001 条 debug 一次且 `afterDispatch` 仍与自己那条配对）；`analyzerPlugin.test.ts` 的 BUG-F2 用例按新契约改判（中止那次不再产出指标）。两处测试注释里的旧计数同步改正。
API-CHANGE: 被中止的 dispatch 不再产出「到出错为止」的耗时指标（改前会记一条），且 `onError` 不再结束任何进行中的计时。

### R5-320  verdict=FIXED  卸载时 delete 自有 getter，不再把 bind 副本写回成永久自有属性

`hadOwnGetter`/`ownGetterBeforeInstall` 在安装前采样；还原时若原本没有自有属性就 `delete storeProxy.getter`（查找回到 `Store.prototype`），
有则原样还回。改后 `Object.keys(store)` 不再含 `getter`、`store.getter === Store.prototype.getter` 重新成立、展开对象里也不再冒出一个可枚举方法。
回归：`r5-plugins-types-p1-plugins.test.ts`「R5-320」2 例（原型还原 + 自有值还原）。
API-CHANGE: `analyzerPlugin` 卸载后的实例形状变化——`getter` 由「可枚举自有绑定函数」恢复为原型方法（只影响做 `Object.keys(store)`/展开/身份比较的消费方）。

### R5-321  verdict=FIXED  四处 before/after 计时收敛为 instrument(type, beforeHook, afterHook, operationOf)；analyzerPlugin 改为工厂产物

`MetricType` 成为必填形参，新增被计时操作在签名上就无法漏传（漏传会被 `monitor.start` 的第二参默认 `'dispatch'` 静默抹平类型维度）；
disposer 侧 `uninstrument.forEach(...)` 与注册同序，不再手写 8 个退订。`analyzerPlugin` 改为 `createAnalyzerPlugin()`，消掉一份 install 副本。
`HookName` 联合形参走 `HookHandlerFor` 的擦除分支（与 `types/plugin.ts` 的说明一致，非本分片文件的杜撰）。
验证：`npx tsc -p tsconfig.json --noEmit` 零报错 + `tests/unit/plugins/performance/*.test.ts` 49 例全绿（指标名与类型维度断言未放宽）。

### R5-322  verdict=FIXED  disposer 幂等：先取 wasActive 再翻 getterActive

改前重复调用 disposer 会因 `storeProxy.getter` 早已还原而身份判假，谎报「store.getter 已被后续插件重新包装」。
现为 `const wasActive = getterActive; getterActive = false` 且只在 `wasActive && !isProduction()` 时告警。
回归：`r5-plugins-types-p1-plugins.test.ts`「R5-322」2 例——第二次调用 not.toThrow 且 warn 零调用；真被后续插件重新包装时仍告警一次（防漏报的反向锁）。

### R5-303  verdict=FIXED  performance/index.ts 的入口示例改为判空读法并注明 dev-only

`globalThis.__GEOMSTORE_ANALYZER__` 仅在插件已安装、`store.name` 对得上且 `isProduction()` 为假时才存在（`registerGlobalEntry` 调用点在 if 内），
改前的示例照抄即 `TypeError`。现为 `?.['store-name']` + `api?.getStats()` + `api?.analyzeBottlenecks(…) ?? []`，注释写明失效场景。纯文档。

### R5-280  verdict=FIXED  三处 try/catch/log/rethrow 收敛为 private run(method, fn)

`getItem`/`setItem`/`removeItem` 现在都是 `this.run('<method>', () => { const {api, fn} = this.resolve(...); ... })`，
「记录 + 重抛」单点，新增操作不会再只补上一半行为。日志文案逐字保持不变（`[WxStorage] getItem error:` 等），与主会话 R5-279 的 `resolve()` 抛错契约叠加后仍由 `run` 统一出声。
回归：`r5-plugins-types-p1-plugins.test.ts`「R5-280」按 `toHaveBeenNthCalledWith` 断言三条日志各以自身方法名出现且原样重抛同一错误对象；`wx-storage-backend.test.ts` 三条抛错断言（主会话所写）未改。

### R5-316  verdict=FIXED  AsyncActions 索引签名形参放宽为 any[]，与基类型 Actions 同口径

`strictFunctionTypes` 下属性式函数按逆变比较，`unknown[]` 会拒掉 `{ fetchUser: (id: string) => Promise<User> }`；返回位保持 `Promise<unknown>`（协变位，无需也不应放宽）。
带 `eslint-disable @typescript-eslint/no-explicit-any` 与完整理由注释。
验证：`tests/unit/r5-plugins-types-p1-types.test.ts` 的编译期锁（三个带标注箭头直接可赋 + `@ts-expect-error` 锁住「同步函数不属 AsyncActions」）。
探针留在 `.cache/variance-probe.ts`（gitignored 取证脚本，可复跑）：
`npx tsc --noEmit --ignoreConfig --strict --target es2020 --module esnext --moduleResolution bundler .cache/variance-probe.ts`
→ 第 16 行（`AsyncActions` 带标注箭头）零报错，第 17 行 `error TS2322: Type '(x: OrderState, y: OrderState) => boolean' is not assignable to type '(a: unknown, b: unknown) => boolean'`（`SelectorOptions` 侧仍拒具体比较器）。
API-CHANGE: 公开类型 `AsyncActions` 的索引签名形参由 `unknown[]` 改为 `any[]`（只放宽，原有可赋的写法全部继续可赋）。
NEEDS-MAIN: `src/types/selector.ts` `SelectorOptions.equalityFn` 的同一方差限制（上面探针的第二半，改 `unknown[]`/加泛型透传或补写方差限制文档）——本分片禁改该文件，且 `groups5/plugins-types-p2.md` 无对应条目。

### R5-317  verdict=REJECT  注入通道搬不出公开选项形状：唯一读写方都在 src/extras，本分片禁改

已核实报告为真：`ActionLoaderOptions` 经 `src/extras/index.ts:74`、`src/extras/action.ts:38`、`src/extras/action/index.ts:56` 三处 barrel 公开再导出，
`sharedLoadingCounts` 因而是 de-facto 公开 API；`@internal` 只是文档标记，tsc 不隐藏也不剥离，且 `ActionLoader.setOptions()` 静默忽略它。
本分片无法只动 types 层收口：读写点全在禁改文件——`ActionLoader.ts:190` 以 `options.sharedLoadingCounts ?? new Map()` 读、
`:17` 的 `Required<Omit<ActionLoaderOptions, 'sharedLoadingCounts'>>` 也按公开类型派生、`withLoading.ts:151/156` 以对象字面量注入；
从 `ActionLoaderOptions` 摘掉该成员必然在这些文件里报 TS2339 / 字面量多余属性，符号键与内部类型两条路都要求实现侧同步改。
「至少加运行时健全性守卫」同样落在 `ActionLoader` 构造器里。台账未改任何文件（保持前任原样，注释里已写清「只在构造期读一次、勿跨 loader 复用」的边界）。
NEEDS-MAIN: `src/extras/action/ActionLoader.ts` + `src/extras/action/withLoading.ts` + `src/types/action.ts`——把 `sharedLoadingCounts` 从公开 `ActionLoaderOptions` 移到内部通道
（构造器第二参或 symbol 键的 `ActionLoaderOptionsInternal`，barrel 不再再导出该内部类型），并在构造期守卫注入值（非 `Map` 实例即拒绝/自建新表），使「首个 true、末个 false」的引用计数不变量不再靠散文约束。

**主会话收口（改判 REJECT：事实成立，但不按报告方向改）**：搬到二次构造参数 / symbol 键会给一个
`docs/API.md` 已列出、6 处测试按公开方式使用的选项制造真破坏性变更。报告的实质是「`@internal` 标签在说谎」，
按实质修：`src/types/action.ts` 删掉 `@internal`，把三条真实约束（只在构造期读一次、`setOptions()` 忽略它的原因、
不变量归注入方）写成消费者能读的契约；`src/extras/action/ActionLoader.ts:194` 补构造期准入判定
`injectedCounts instanceof Map ? injectedCounts : new Map()`（JS 调用方传非 Map 时，原先要到异步收尾
第一次 `get/set` 才炸，炸点看不出现场）。守卫与契约两条都落地，仅「移出公开面」不做。

### R5-311  verdict=FIXED  ExtractMember 的第二道守卫抽成命名辅助 MemberOrEmpty，条件层级回到一层

`type MemberOrEmpty<T> = undefined extends T ? Record<never, never> : T`，`ExtractMember` 只剩 `IsAny` 一层判断；
`undefined extends any` 为真决定了 `IsAny` 必须先判，这个顺序约束现在写在 `ExtractMember` 与 `MemberOrEmpty` 两处注释里而不是藏在嵌套 ternary 里。
语义零变化：`tests/unit/r5-plugins-types-p1-types.test.ts` 断言 `state: any` 成员仍原样穿过（`Equal<ExtractStates<[AnyStateStore]>, any>`），
可选 `getters` 缺省时结果仍是「空对象形状」（`Equal<keyof ExtractGetters<[NoGettersStore]>, never>`）而不是整份交叉塌成 `never`
——若真塌成 `never`，`keyof` 反而是 `string | number | symbol`，任意 getter 名都编译通过；既有 `tests/types/compose-field-extraction.typecheck.ts`
与 `tsconfig.tests.json` 全量类型检查零报错。

### R5-312  verdict=FIXED  ComposedStore 别名改为 Store<S> & { stores }，默认泛型回到 State

核对实现为真：`src/core/compose/composeStore.ts:25` 是 `class ComposedStore<S extends State = State> implements Store<S>`，公开成员除 `stores` 外全在 `Store<S>` 契约面上，
所以交叉同一份契约比手抄 name/state/stores 三件套更不易漂移（类增删成员时这里会报错而非沉默），`hooks`/`getState`/`dispatch` 等重新可见、`state` 恢复只读。
默认泛型由 `Record<string, unknown>` 改为 `State`，与同文件 `StoreLike` 注释「`Record<string, unknown>` 会把业务 interface 拒之门外」不再自相矛盾。
验证：`r5-plugins-types-p1-types.test.ts` 的 `_composedShapeLocks`（编译期锁：`composed.hooks.clear()`/`subscribe`/`dispatch` 可用、`composed.state = …` 处 `@ts-expect-error` 生效）
+ 全量 jest 与 `tsconfig.tests.json` 零本分片报错。报告提出的「在 tests/types 下补类型级一致性断言」以该函数形式落在本分片可写路径内（`tests/types/**` 禁改）。
API-CHANGE: 公开别名 `ComposedStore` 形状改变——成员从 `{name,state,stores}` 扩为整个 `Store<S>` 面，且类型实参新增 `extends State` 约束（原为无约束默认 `Record<string, unknown>`）。

### R5-309  verdict=FIXED  level 拼前缀前做类型兜底，非字符串一律落 UNKNOWN

`describeLevelLabel(level)`（`typeof level === 'string' ? level.toUpperCase() : 'UNKNOWN'`）与同文件 `describeErrorProperty` 同动机、同风格：
`createErrorContext` 的 `= 'error'` 默认值只覆盖显式走工厂且真传 `undefined` 的路径，JS 调用方手搓 `{storeName, operation, error}` 时裸调 `.toUpperCase()` 会让处理器自身崩溃并顶掉原始失败。
后面的 switch/default 保持原样：未知级别仍落 default 分支（穷尽性 `never` 守卫不变、输出仍是 `console.info` + `[UNKNOWN]` 标签），
本条只修「处理器自身崩溃顶掉原始失败」，不改动未知级别的落点——报告亦只要求拼前缀前做一次类型兜底。
回归：`r5-plugins-types-p1-types.test.ts` 3 例（缺省 level 与 42/null/{}/[] 四类非法值都 not.toThrow 且前缀 `[UNKNOWN]`；合法 `'warning'` 的 `[WARNING]` 前缀与分派不变）。

### R5-310  verdict=FIXED  取报告的第一方案写清异步口径，并按本轮调用侧现状校正前任留下的过期表述

报告前提在 HEAD 上成立：`git show HEAD:src/extras/error/ErrorHandler.ts` 的 `handleError` 只有 `try { this.handler(context) } catch`，
而 `Promise<void>` 可赋给 `void` 返回类型（同文件已发布的 `ErrorReporter` 又是异步的）→ `(ctx) => reporter.report(ctx)` 的 rejection 绕过兜底日志。
本分片按报告第一方案在 `src/types/error.ts` 补文档。**对账修正**：前任那段把事实写成「调用侧只用 try/catch 包住同步调用、rejection 无人接」，
而本轮 extras-error 分片已在调用侧补上 `isThenable(handlerResult) → Promise.resolve(handlerResult).catch(reportHandlerFailure)`（`src/extras/error/ErrorHandler.ts:156-168`，非本分片文件）——
注释与代码相反 → 现改写为「库内入口会接住，但 `ErrorHandler` 是公开类型、消费方自建调用点仍会丢掉 Promise，故处理器须自行吞失败」，指引不变、事实归位。
不采第二方案（签名放宽 `void | Promise<void>`）：该文件在本分片禁改清单内，且兜底现已存在，放宽签名只会重复承诺。
证据：`grep -n "isThenable(handlerResult)" src/extras/error/ErrorHandler.ts` 命中；`npx tsc -p tsconfig.json --noEmit` 零报错。

### R5-304  verdict=FIXED  __DEV__ 的注入方与「必须 typeof 守卫」写进声明处

`src/types/global.ts` 现说明：由打包器构建期字符串替换注入（DefinePlugin / rollup replace / 小程序构建工具常量定义），**本库与仓库内任何构建配置都不注入它**；
`declare const` 只向类型系统声明可解析，运行时未注入时裸读抛 `ReferenceError` 而非得到 `undefined`，`boolean | undefined` 描述的是「注入后可能显式置 undefined」；
读取方须先 `typeof __DEV__ !== 'undefined'`，正确示范指向 `core/store/utils.ts` 的 `isProduction()`。
「谁注入」已核实：全仓 `__DEV__` 赋值点只有 `tests/setup.ts:144`（`g.__DEV__ = process.env.NODE_ENV !== 'production'`），读取点只有 `src/core/store/utils.ts:56-57`（带 typeof 守卫）。纯文档。

## NEEDS-MAIN

- NEEDS-MAIN: `src/core/store/ActionManager.ts` —— `_reportSettledFailure` 被 5 条失败路径共用（同步 dispatch 的 catch、Promise 拒绝分支、settled 兜底 catch、
  `_settleAfterDispatch`、`_safeRefreshCache`），前 1 条才是「afterDispatch 永不再来」的真中止。请给该路径的 emit 补显式第二参 `'dispatch'`
  （或把中止路径与非中止路径的发射分开、各带自己的 source），`analyzerPlugin` 的 `discardPendingEnd` 才会重新清理中止项（R5-319）。
  现状：库内没有任何发射点带配对键 source，故 onError 一律不弹栈，中止的那条计时靠 `MAX_PENDING_DEPTH` 与 monitor 的 TTL 兜住。
- NEEDS-MAIN: `src/extras/action/ActionLoader.ts` + `src/extras/action/withLoading.ts` + `src/types/action.ts` —— 把 `sharedLoadingCounts`
  移出公开 `ActionLoaderOptions`（内部构造参数或 symbol 键的 `ActionLoaderOptionsInternal`，barrel 不再导出该内部类型），并在构造期守卫注入值
  （非 `Map` 实例即拒绝/自建）。本分片禁改前两个文件，只动 types 层必然报 TS2339 / 字面量多余属性（R5-317，verdict 即 NEEDS-MAIN）。
- NEEDS-MAIN: `src/types/selector.ts` —— `SelectorOptions.equalityFn: (a: unknown, b: unknown) => boolean` 的方差限制：实测
  `{ equalityFn: (x: OrderState, y: OrderState) => x.id === y.id }` 报 `TS2322 … Type 'unknown' is not assignable to type 'OrderState'`，
  即 R5-316 点名的第二种受害写法。属 p2 文件且 `groups5/plugins-types-p2.md` 无对应条目，请一并处理（放宽形参或把方差限制写进消费者必读处）。
- NEEDS-MAIN(可选): `src/core/utils/helpers.ts` —— 若要按 R5-302 的建议做「共享导入准入判定」，把 `isRestorablePayload`（`src/plugins/builtin.ts`）与
  `isImportableObject`（`src/plugins/devtools/timeTravelPlugin.ts`）合成一个 `isSafeImportedObject`。两处现在同口径但各写一遍，属可接受重复；
  本分片禁改 core，故未合并。
- 提示（非单条 finding）：本分片改动的公开面为 `AsyncActions` 索引签名、`ComposedStore` 别名形状，以及 `persistencePlugin`/`timeTravelPlugin`/`analyzerPlugin`
  三处运行时口径（详见各条 API-CHANGE）。由 `scripts/generate-skill-api-reference.mjs` 生成的 skill API 参考仍是旧快照，需随 Wave 一并重跑。
