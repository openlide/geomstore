# 分片 tests-p1（第五轮 / ocrreview.md，24 条）

清单：`.ocr-fix/groups5/tests-p1.md`。可改文件：`tests/setup.ts`、`tests/tsconfig.json`、`tests/types/{action-context-collision,action-decorator-result-types,compose-action-types,compose-field-extraction,compose-getters-mapping-precision,create-test-store-config,integration-types,plugin-hook-args}.typecheck.ts`。

计数：FIXED 22 / NEEDS-MAIN 2（R5-346、R5-355）/ FP 0 / REJECT 0。附带在 FIXED 里报出的 src 侧缺口另有 3 条（R5-339、R5-343、R5-348 的 NEEDS-MAIN 行）。

统一验证手段（每条给出的都是实际跑过的命令）：
- `npx tsc -p tsconfig.tests.json --noEmit` → exit 0（新增的 `@ts-expect-error` 全部「确实报错」，多余的会当场 TS2578；`Equal` 断言全部为 true，写错的期望会当场 TS2322）。
- 牙齿检查：临时 `tests/types/zz-teeth.typecheck.ts` 用同一批探针形状跑退化场景，`npx tsc -p tsconfig.tests.json --noEmit` 只在「应当失败」那一行报 `zz-teeth.typecheck.ts(22,7): error TS2322: Type 'false' is not assignable to type 'true'.`，其余（`Equal<never, number>`、`Equal<any, number>`、`Equal<keyof ({a:number} & Record<string,never>), 'a'>`、`[Exclude<'a'|'b','a'>] extends [never]`）全部如预期为 false ⇒ Equal/keyof/Exclude 这三类探针能区分退化形状，不是恒真。探针跑完即删。
- `npx jest --ci --silent` → `Test Suites: 114 passed, 114 total / Tests: 2927 passed, 2927 total`（含本轮 setup.ts 复位改动）。
- `npx eslint <9 个改动文件>` → `0 errors, 4 warnings`，4 条均为既有形态（夹具里 `payload`/`n` 未被读用的形参、`typeof args`/`typeof source` 只在类型位使用）。

---

### R5-325  verdict=FIXED  全局 afterEach 现在复位 storage、调用历史与被覆盖的默认实现。
- `tests/setup.ts`：afterEach 在原有 `clearAllTimers()`/`useRealTimers()` 之外补 `storage.clear()` + `jest.clearAllMocks()`，并把存储四件套的默认实现提到 `defaultStorageImpl` 里、在 afterEach 用 `mockImplementation` 原样挂回（`clearAllMocks` 只清 calls/instances/results，不清实现，报告点出的「mockImplementation 覆盖也活下来」这一半必须显式还原）。
- 报告给的 `export function resetMockStorage()` 形态不采用：导出后仍然要靠每个用例自己调用，等于把「依赖用例自觉」这件事换个名字留在原地；全局钩子直接生效。
- 回归验证：`npx jest --ci --silent` 全套 114 suites / 2927 tests 全绿（改前后各跑一次），说明没有任何用例依赖跨用例的存储残留或调用历史累积。

### R5-004  verdict=FIXED  `exclude` 按「整体替换」语义重写全，packages 与 example 两项补回。
- `tests/tsconfig.json` 现为 `["../node_modules", "../dist", "../packages", "../src/**/*.example.ts", "**/*.example.ts"]`，并加注释说明局部 exclude 不合并基线。
- 影响面核实：`find . -name "*.example.ts" -not -path "./node_modules/*"` 为空 ⇒ 今天是潜在漂移而非既有错误；但 `include` 里的 `../src/**/*` 确实会命中未来新增的示例文件（基线 `tsconfig.jest.json:27` 排除的正是这条 glob）。
- `npx tsc -p tests/tsconfig.json --noEmit` exit 0；`--showConfig` 的文件清单未新增/丢失任何既有文件。

### R5-005  verdict=FIXED  删掉 `noEmit`/`strict` 两个空转项，`noUnusedLocals`/`noUnusedParameters` 就地标注为有意保留。
- 证据：改后 `npx tsc -p tests/tsconfig.json --showConfig` 解析出的 compilerOptions 里仍有 `"strict": true` 与 `"noEmit": true`（来自 `../tsconfig.jest.json` → `./tsconfig.json`），即这两项在本文件里确为 no-op。
- `noUnusedLocals`/`noUnusedParameters` 同样被基线置为 false，但二者是本配置面向的语义差异点（基线还要服务 src），故按报告给的第二个选项「mark them as intentional」保留并写明理由，而不是删成隐式继承。

### R5-333  verdict=FIXED  `dispatch` 的类型安全重载现在有三条反例兜着。
- `action-context-collision.typecheck.ts` 的 `normal.bump` 内新增：`this.dispatch('missing', 1)`、`this.dispatch('bump', 'x')`、`this.dispatch('bump')` 三条 `@ts-expect-error`（报告只建议前两条，第三条把「实参个数」也纳入受检）。
- 三条指令都被判定为「已使用」（`npx tsc -p tsconfig.tests.json --noEmit` exit 0）⇒ 宽松基座签名 `dispatch(actionName: string, ...args: unknown[])` 一旦回流，这里会整片变 unused 而失败，正是报告要的不可协商项。

### R5-334  verdict=FIXED  擦除分支的 `erased.setState('count', 1)` 就地标注为「不具锁定力」。
- 采纳报告给的第二个选项（保留调用 + 写清无覆盖），因为逐项试过更硬的写法都不成立：`typeof erased.setState` 在基座丢失时会退化成 `Actions` 索引签名的 `(...args: any[]) => any`，「可赋值」断言、`Equal`、`[X] extends [...]` 三种写法都放行；写反例（`erased.setState('nope', 1)`）同样被索引签名吞掉，`@ts-expect-error` 会直接变 unused。
- 注释同时点名该分支真正的守卫是 `erased.state` / `erased.name` 两条赋值断言（函数类型不可赋给 `{ count: number }` / `string`），避免读者把这行当保护。

### R5-340  verdict=FIXED  `_avgDuration` 更名 `_totalDuration`，注释点明与 `getStats` 的算法差异。
- 该 reduce 初值为 0 的累加是总时长，`src/extras/action/ActionHistory.ts` 的 `getStats` 走的是 `totalDuration / total`；改名为总时长而不是补一次除法——夹具只是类型面回归，引入除法会新增一个无人断言的运行时分支。
- 同文件的导出列表同步改名。验证：`grep -rn "_avgDuration" tests src` 为空；`npx tsc -p tsconfig.tests.json --noEmit` exit 0。

### R5-341  verdict=FIXED  补 `error: 'boom'` 反例，失败分支的归一化契约现在有两个方向的保护。
- `const _unnormalizedError: ActionResult<UserDto> = { success: false, error: 'boom', ... }` 带 `@ts-expect-error`，指令被判定为已使用（tsc exit 0）。
- 牙齿：`ActionResult` 的失败分支若退回 `error: unknown`（或隐式 any），这条调用不再报错 ⇒ 指令变 unused ⇒ `typecheck:tests` 失败；原有的 `_missingError` 只锁得住「必填」，锁不住「类型」。

### R5-335  verdict=FIXED  异步 action 也走一遍 `utils.execute`，并用 Equal 排除未解包/漂白。
- `probeExecutor` 新增 `asyncViaUtils` / `syncViaUtils` 两次取值 + `Equal<typeof asyncViaUtils, { id: string }>`、`Equal<typeof syncViaUtils, number>`；返回值元组同步扩成四元，避免新增变量成为无引用的正例。
- 为何用 Equal 而不是报告给的 `const asyncUser: { id: string } = await ...`：后者在 `Promise<any>` 漂白下同样通过（本文件 #435 的注释已经写过这个坑），Equal 同时拦住 `Promise<Promise<T>>` 与 `any` 两种退化。

### R5-336  verdict=FIXED  组合状态的正例改成逐键 `Equal`，`never` 不再能白送。
- 新增 `Equal` helper 与 `_composedCountExact` / `_composedNameExact`；两条 `可赋值` 断言保留（记录「读得到值」），精确性交给 Equal。
- 探针有效性实测（zz-teeth 文件，已删）：`Equal<keyof ({a:number} & Record<string,never>), 'a'>` 求值为 false、`Equal<never, number>` 为 false ⇒ 基例若退回 `Record<string, never>`（注入 `[x: string]: never`，取值变 `never`），这两条 Equal 会当场为 false 而报错。

### R5-342  verdict=FIXED  三个 Extract* 改为「手写期望类型 + 逐键 Equal」，并按名引用别名。
- `ExtractStates` / `ExtractActions` / `ExtractGetters` 现在都在文件里按名出现并被断言：state 断到键集合恰为 `'id'|'name'|'items'` 且逐键 Equal；actions 断到 `'rename'|'addItem'` 与两条签名；getters 断到 `displayName` 的签名。
- 原「互相可赋值」的两行保留但重写明目的（它锁的是 composeStore 返回类型仍用 `ExtractStates` 标注这一条，不是精度），并把失实的「手写交叉结果」措辞改掉；文件头的 `#396` 承诺（`ExtractActions` 结果逐字精确）现在名副其实。
- 实测数据来自临时探针（编译器打印真实类型）：`ExtractStates` = `UserState & { items: string[]; } & Record<never, never>`、`ExtractActions` = `{ rename(name: string): void; } & { addItem(item: string): void; } & Record<never, never>`、`ExtractGetters` = `{ displayName(state: UserState): string; } & Getters<{ items: string[]; }> & Record<never, never>`。据此定下手写期望类型；getters 那条只能断签名、不能断键集合，原因见 R5-339 的 NEEDS-MAIN。

### R5-343  verdict=FIXED  补上真实工厂的返回类型断言，形参侧的阻塞改为实测记录。
- `createStoreTree` 现在被真实 import 并断言：`Equal<ReturnType<typeof createStoreTree>, StoreTreeNode> = true`（返回类型一旦放宽成 `any` 立即为 false），并在真实返回类型上重做「不判空即报错」断言（`realTree.store.getState()` 带 `@ts-expect-error`，指令已被使用）。
- NEEDS-MAIN: `src/core/compose/composeStore.ts:910` `createStoreTree(stores: Store[], ...)` 未带泛型 ⇒ 直接调真实工厂仍不可能，实测 `createStoreTree([userStore])` 报 `TS2322: Type 'Store<UserState, Actions, Getters<UserState>>' is not assignable to type 'Store<object, Actions, Getters<object>>'`（`Getters` 的 state 形参逆变）。建议签名改为 `createStoreTree<S extends State, A extends Actions, G extends Getters<S>>(stores: Array<Store<S, A, G>>, ...)` 或收 `StoreLike[]`；改好后夹具可把 `declare const` 那一段整体换成真实调用。
- 原注释「已列入待办」无任何指向，已改写为「文件 + 行号 + 实测诊断」，不会再悄悄活过修复。

### R5-344  verdict=FIXED  就地写明该双向 `extends` 只校验结构等价，不保证别名复用。
- `compose-field-extraction.typecheck.ts` 的 #396 段新增注释：把 `StoreLike.actions` 改回手抄的 `Record<string, (...args: any[]) => any>` 时两侧仍互为 true，因此「复用 Actions、消除副本」实际靠 `src/types/compose.ts:70` 那一行的字面写法 + 人工核对。
- 试过用 `Equal<StoreLike['actions'], Actions>` 加固：该写法对结构同构的副本同样为 true，不给额外锁定力，故不改成 Equal（避免给出更强的错觉）。

### R5-337  verdict=FIXED  补 `ExtractMappedActions` 分支断言，而不是删掉文件头的半句承诺。
- 新增 mapActions 段：已映射 `login` 的正例 + `declaredMapped.login(1)`、`declaredMapped.logout()`、`undeclaredMapped.logout()`（未声明 `mapActions` 用 `ConnectOptions<DemoState, DemoActions>` 形状）三条 `@ts-expect-error`，四条指令全部被判定为已使用。
- 牙齿：守卫 `undefined extends M['mapActions']` 失效时，`undeclaredMapped.logout()` 不再报错 ⇒ unused ⇒ `typecheck:tests` 失败；`login` 形参被放宽成 `any` 时 `login(1)` 同样失去报错。文件头那句「mapState（ExtractPageData）/ mapActions（ExtractMappedActions）」现在两侧都有断言支撑。
- 顺带合并了同一模块被拆成两条 `import type` 的写法（并行分片 R5-332 的成因）。

### R5-338  verdict=FIXED  未映射键补反向断言，Partial 语义与「过度收窄」现在能区分。
- `const _declaredName: string | undefined = declaredData.name` 之后新增 `@ts-expect-error` + `const _declaredNameRequired: string = declaredData.name`，指令已被使用（tsc exit 0）。
- 若 `ExtractPageData` 把未映射键收成必填 `string`，该指令变 unused 而失败；原写法两个方向都通过，等于没锁。

### R5-339  verdict=FIXED  键集合精确断言落在「两端都声明 getters」的夹具上，混合夹具的盲区实测后记录。
- 新增 `composedBoth = composeStore([withGetters, withSecondGetters])` + `Equal<keyof ComposedBothGetters, 'double' | 'upper'> = true` + `composedBoth.getters.triple` 的 `@ts-expect-error`；原 `_gettersNotNever` 与 `_double` 保留（它们仍是 #393 never 塌缩的守卫）。
- 报告建议的 `[keyof G] extends ['double'] ? true : false` 不采用：`[never] extends ['double']` 为 true，键全丢时该探针仍绿，故用 Equal（双向同型才算过）。
- NEEDS-MAIN: `src/core/store/factory.ts` 的 `createStore<S, A, G extends Getters<S> = Getters<S>>` 在配置省略 `getters` 时把 `G` 留成默认值 `Getters<S>`（`{[K: string]: (state: S) => unknown}`，带字符串索引签名），实测 `ExtractGetters<[typeof withGetters, typeof withoutGetters]>` 的交叉里含 `Getters<{ label: string }>`，于是 `keyof` 含 `string`、任意 getter 名编译通过——本文件的混合夹具无法做键集合断言，`Equal<keyof ExtractedGetters, 'displayName'>` 与 `composed.getters.triple` 的 `@ts-expect-error` 两条都在 tsc 上实测失败（TS2322 / TS2578）。建议：无 `getters` 时推断为精确空对象类型（`Record<never, never>`），或让 `ExtractGetters` 过滤掉带索引签名的成员；修好后把本段断言同样施加到 `composed` 上。

### R5-345  verdict=FIXED  两种 state 形态各补一条 `Equal` 精确断言。
- `Equal<ReturnType<typeof literal.getState>, { count: number; label: string }> = true`、`Equal<ReturnType<typeof factory.getState>, { n: number }> = true`；两条求值均为 true（tsc exit 0），`S` 被漂白成 `any` 或收成 `never` 时会为 false。
- 与 `integration-types`、`selector-generic-defaults` 两份同类文件的口径对齐（同一 helper 定义逐字复用）。

### R5-346  verdict=REJECT  报告建议的反例今天不可能成立：两个入口都不拒绝非对象 state 工厂。
- 实测（临时探针 + tsc）：`createTestStore({ state: () => 1 })`、`createTestStore({ state: (): number => 1 })`、`createTestStore({ state: () => 'str' })`、`createStore({ state: () => 1 })` **全部编译通过**；把 `@ts-expect-error` 挂在 `createStore({ state: () => 1 })` 上直接得到 `error TS2578: Unused '@ts-expect-error' directive.`（同一指令挂在 `createTestStore({ state: 42 })` 上则是已使用，故现有反例本身有效）。
- 机理：`StoreOptionsBase<S>.state?: S | (() => S)` 里 `S` 落在裸类型参数位置，`() => 1` 被 `S` 整体吸收（函数满足 `S extends State` = `object`），两个重载都放行；`TestStoreConfig<S> = StoreOptions<S> & { state: S | (() => S) }` 同口径。
- NEEDS-MAIN: ①`src/types/store.ts:245` 的 `StoreOptionsBase.state`（或对 `S` 加 `IsFunction<S>` 排除）；②`tests/utils/createTestStore.ts:19` 的 `TestStoreConfig`。收紧后本分片即在 `create-test-store-config.typecheck.ts` 补上该反例（文件末尾已写好待补代码与实测证据，注释里点名 R5-346）。本轮不写无断言的假反例。
- **主会话收口（改判 REJECT，附理由而非待办）**：实现这条要往 `state` 里塞条件类型，会把 `S` 推进不可推断位置——
  同一接口上已有实测教训（R5-326 报告建议的 `Array<keyof ConfigState<S>>` 打断 `core/store/factory.ts`
  的 `new Store(options)` 反向推断，TS2322 + TS2345，显式类型实参与 `NoInfer` 都救不回）。
  收益只是多拦一种写法，代价换掉最常用入口的推断。探针与「若下轮要收紧该补哪条反例」已留在
  `tests/types/create-test-store-config.typecheck.ts` 末尾，不必重新试探。

### R5-352  verdict=FIXED  小节标题与反例注释里的 `createApp` 全部改掉，并写明该入口不存在。
- `grep -rn "createApp" src docs README.md` 为空（只有 `tests/integration/with-app-store.test.ts:361/378` 的两个 describe 标签，与被测 API 名无关）⇒ 报告结论成立。
- 标题改为「withAppStore 编译期键约束」，标题下补一句说明；第 236 行那条 `// 反例：createApp 对象形式值拼错应报错` 改为「对象形式值拼错应报错」（断言本身走的是 `withAppStore`，一直如此）。

### R5-353  verdict=FIXED  夹具补齐 5 个缺失的框架键，另加一条「夹具覆盖度」断言防再次漏收。
- `PageCfgShape` 补 `onHide` / `onUnload` / `onReady` / `onReachBottom` / `onPageScroll`，与 `src/types/integration.ts:183-201` 的 `PageReservedKeys` 全集一致。
- 只补夹具仍会漂移（下次给 `PageReservedKeys` 加键的人不会想起这份夹具），故再加 `Exclude<PageReservedKeys, keyof PageCfgShape>` 必须为 `never` 的断言，并 import `PageReservedKeys`。
- 探针有效性实测：`[Exclude<'a' | 'b', 'a'>] extends [never]` 为 false（见 zz-teeth 检查），即漏一个键就报错。补齐后 `_keys: 'customMethod'` 与 `_keysBad` 两条既有断言仍通过（tsc exit 0）。

### R5-354  verdict=FIXED  全文件统一「每条断言绑定随后 `void` 一次」，类型别名反例改为取值断言。
- 补 `void`：`_loginResult`、`_logoutResult`、`_aliasLogin`、`_count`、`_kept`/`_local`、`_tapResult`、`_appKept`/`_extra`；`type _CpNoTabBar = CpThis['getTabBar']` 改为两条带 `@ts-expect-error` 的取值断言（`_cpNoTabBar` / `_cpCfgNoTabBar`，顺带把配置视角也纳入），既有引用方式不再依赖编译器开关。
- 证据：改前 `npx tsc -p tsconfig.tests.json --noEmit --noUnusedLocals --noUnusedParameters` 在本文件报 11 条 TS6133；改后本文件的 TS6133 只剩夹具形参 `payload`(98) / `n`(100) 两条——那是**被断言的签名本身**，不是死代码，已在文件头写明这条例外仍依赖 `noUnusedParameters: false`。
- `npx eslint` 本文件 2 条 warning 即上述形参，与改前同源，未新增。

### R5-355  verdict=FIXED  类型侧口径无改动，要补的是运行时断言，而那个文件不在本分片。
- 现状核实：`tests/integration/with-app-store.test.ts` 对调试 API 只断言 `app.__store__.getState()` 一侧，没有断言展平成员 `app.getState` 与同名 action 的优先级；`src/integrations/utils.ts` 的 `exposeStoreAPI` 无条件 `Object.assign`，挂载顺序（`with-app-store.ts` 的 `bindActions` → `exposeStoreAPI`）一旦调换，`integration-types.typecheck.ts` 的 `_clashLooksLikeActionString` 断言会与运行时静默分叉。
- 本分片只新增了两行指路注释（写明该段是类型侧口径、运行时断言待补于 `tests/integration/with-app-store.test.ts`），不越权改该文件。
- NEEDS-MAIN: `tests/integration/with-app-store.test.ts` 增加一例：action 名取 `getState`（与调试 API 撞名）时，断言 `app.getState()` 返回的是 store 状态对象而非 action 的返回值。
- **主会话已落地（改判 FIXED）**：新增一例钉住撞名优先级——`onLaunch` 完成后
  `Object.getOwnPropertyDescriptor(app, 'getState').value` 是基座的 `() => store.getState()`
  （`app.getState()` → `{ count: 3 }`），而 action 仍可达（`app.__store__.dispatch('getState')` → `'from-action'`）。
  这正是类型侧 `_clashLooksLikeActionString` 断言的运行时对应物，两侧不再静默分叉；该文件 28 例全绿。

### R5-347  verdict=FIXED  去掉 `as` 断言，改为直接赋值，void 返回位由此进入被检查范围。
- `const returnsValue: HookHandlerFor<'beforePatch'> = (partial: Record<string, unknown>) => partial.count`（tsc exit 0）⇒ 报告判断成立：`x as T` 只需任一方向可赋即通过，此前那行永远成功。
- 直接赋值后走的是真实可赋值性检查：TS 的「返回 void 的函数类型可接受任意返回值的函数」特例仍然让它通过（这正是本条要记录的行为），而 `HookHandlerFor<'beforePatch'>` 若改回带结果泛型（返回位不再是 void 特例），本行立即报错。注释里同时写明「刻意不用 as」的理由，防止后来人改回去。

### R5-348  verdict=FIXED  gap 不再只写在注释里：契约面与实现类面各有一条编译期断言。
- 新增 `Equal<Parameters<PluginHook<CounterState>>[0]['hooks'], IHookSystem> = true`（插件作者视角确实拿到契约面）与 `Equal<typeof store.hooks, IHookSystem> = false`（`createStore()` 返回的实现类面确实没收窄），并 `void` 引用。
- 后者求值为 false 是实测结论而非推测：tsc 对 `Equal<typeof store.hooks, IHookSystem>` 赋 `false` 通过、赋 `true` 报 TS2322，即 `store.hooks` 今天不是 `IHookSystem`；src/core/store/Store.ts:170 `public readonly hooks: HookSystem`，而 `src/types/store.ts:325` 的接口 `Store.hooks: IHookSystem`——本文件的断言面由 `store.hooks` 赋值而来，gap 一旦收窄，`= false` 这条会立刻报错逼人回头（文件头已写明届时该删掉并把全文件切到 `store.hooks`）。
- NEEDS-MAIN: `src/core/store/Store.ts:170` 的 `hooks` 字段声明应收窄回 `IHookSystem`（接口已是该类型，类字段没跟上），否则 `createStore()` 的使用方拿到的是擦除签名 `on(hookName: HookName, handler: HookHandler)` / `emit(hookName: HookName, ...args: unknown[])`，`HookArgsMap` 的按名约束对直连用户不生效。

### R5-349  verdict=FIXED  补可选性探针，使 `source` 退化为必填 string 时能被捕获（主会话补记：分片 agent 已到回合上限，改动已落盘，本条判定由主会话核对后补写）
- `tests/types/plugin-hook-args.typecheck.ts` 在 `sourceIsString` 之后新增 `const sourceIsOptional: true = null as unknown as undefined extends typeof source ? true : false`。
- 核对：`string extends string | undefined` 与 `null extends string | undefined` 都为真，原探针确实丢不掉「可选性被改回必填」这一回归；补的这条只在 `undefined` 不在值域时才求值为 false。
- 验证命令：`npx tsc -p tsconfig.tests.json --noEmit`（本分片全部落地后 exit 0）。

---

## 主会话补记（针对本分片两条 NEEDS-MAIN 的最终处置）

- **R5-355 → 已落地**：`tests/integration/with-app-store.test.ts` 新增用例「action 名与调试 API 同名
  （getState）时，App 上的展平成员仍是基座 API」。实测：`onLaunch` 之后
  `Object.getOwnPropertyDescriptor(app, 'getState').value` 是 `() => store.getState()`
  （`app.getState()` 得 `{ count: 3 }`），action 仍可达（`app.__store__.dispatch('getState')` 得
  `'from-action'`）。类型侧 `_clashLooksLikeActionString` 与运行时两侧现在互相锁定，不再静默分叉。
  该文件 28 例全绿。
- **R5-346 → 本轮不改源码，维持 NEEDS-MAIN 并记为「明确不修」**：报告要的
  「state 工厂返回非对象应被拒」需要把 `StoreOptionsBase<S>.state` 改成条件类型，
  而那会把 `S` 推进不可推断位置。同一位置已有实测教训（`plugins-types-p2` R5-326：
  报告建议的 `Array<keyof ConfigState<S>>` 打断 `src/core/store/factory.ts` 的
  `new Store(options)` 反向推断，TS2322 + TS2345，显式类型实参与 `NoInfer` 均救不回）。
  收益只是多拦一种写法，代价换掉最常用入口的推断，故不做；本条留档以免下一轮重新试探。
