/**
 * GeomStore v1.0.0 - 集成类型精确性回归测试（编译期断言）
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾，
 * 不被 jest testMatch 收集），仅由 `pnpm typecheck:tests`（tsc --noEmit，strict）做编译期校验。
 *
 * 通过 `@ts-expect-error` 锁定「集成层精确映射类型」行为：
 * - 映射 action 拥有精确签名，传错参数 / 拼错方法名会触发 TS 编译错误
 * - 若集成层 `[key: string]: any` 兜底回归，下述 `@ts-expect-error` 将变为 unused，
 *   导致 typecheck:tests 失败，从而拦截回归
 *
 * 书写约定（#R5-354）：每条断言绑定（`const _xxx`）随后都有一行 `void _xxx`／`void [...]`，
 * 本文件不依赖 `noUnusedLocals` 被关闭这一非默认编译选项。
 * 例外：夹具实现体里 `login` / `setCount` 这类**被断言的签名形参**天然不读用，它们属于被测形状本身，
 * 一律以 `_` 前缀书写（`_payload` / `_n`）——只保留位置与类型，不占读用，形参不可删。
 *
 * @file tests/types/integration-types.typecheck.ts
 */

import type {
  AppThis,
  ComponentConfig,
  ComponentThis,
  ExtractMappedActions,
  ExtractPageData,
  PageConfig,
  PageOwnMethods,
  PageReservedKeys,
} from '@/types/integration.js'
import { withPageStore, withComponentStore, withAppStore, createStore, type State, type Actions, type Getters, type PageThis } from '@/index.js'

// ==================== 示例类型 ====================

/**
 * 双向精确类型相等断言（`Equal<A, B>` 为 true 才通过）
 *
 * 「可赋值」断言在**函数参数逆变**下会被白送：窄形参的 getter 一样能赋给宽形参目标，
 * 于是看着在锁类型、实际什么都没锁（#432 的空转点）。需要「就是这个类型」时用本 helper。
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

interface UserState extends State {
  userInfo: { name: string } | null
  count: number
}

interface UserActions extends Actions {
  login: (payload: { username: string; password: string }) => Promise<boolean>
  logout: () => void
  setCount: (n: number) => void
}

// ==================== 数组形式 mapActions 精确签名 ====================

type ArrayMapped = ExtractMappedActions<UserActions, { mapActions: ['login', 'setCount', 'logout'] }>
declare const arrayMapped: ArrayMapped

// 正例：精确参数与返回类型
const _loginResult: Promise<boolean> = arrayMapped.login({ username: 'u', password: 'p' })
arrayMapped.setCount(1)
void _loginResult

// logout 的精确签名（#433：整份 fixture 里此前从未被断言过）：零参、返回 void
const _logoutResult: void = arrayMapped.logout()
void _logoutResult
// @ts-expect-error logout 不接受任何参数
arrayMapped.logout('x')

// 反例：传错参数类型
// @ts-expect-error setCount 期望 number，传入 string 应报错
arrayMapped.setCount('wrong')

// 反例：漏传必填 payload
// @ts-expect-error login 需要一个参数
arrayMapped.login()

// 反例：拼错方法名
// @ts-expect-error setcount 不存在，应报错
arrayMapped.setcount(1)

// ==================== 对象形式 mapActions（别名）精确签名 ====================

type AliasMapped = ExtractMappedActions<UserActions, { mapActions: { doLogin: 'login'; bump: 'setCount' } }>
declare const aliasMapped: AliasMapped

// 正例
const _aliasLogin: Promise<boolean> = aliasMapped.doLogin({ username: 'u', password: 'p' })
aliasMapped.bump(2)
void _aliasLogin

// 反例：别名方法参数错误
// @ts-expect-error bump 期望 number，传入 string 应报错
aliasMapped.bump('wrong')

// ==================== ExtractPageData 精确 ====================

type PageData = ExtractPageData<UserState, { mapState: ['count'] }>
declare const pageData: PageData
const _count: number = pageData.count
void _count

// ==================== withPageStore 编译期键约束（S/A/G 从 store 推断） ====================

const typedStore = createStore({
  state: { userInfo: null as { name: string } | null, count: 0 },
  actions: {
    login: (_payload: { username: string; password: string }) => Promise.resolve(true),
    logout: () => {},
    setCount: (_n: number) => {},
  },
  getters: {
    // 形参标注为 fixture 的完整状态类型：写成 `(state: { count: number })` 这种手抄窄形状时，
    // 参数逆变会让它照样赋给 `(state: UserState) => number`，下方赋值断言于是恒真、
    // 完全不校验「getter 的 state 由 store 状态推断」（#432）
    double: (state: UserState) => state.count * 2,
  },
})

// 正例：mapState / mapGetters / mapActions 键均合法
withPageStore(typedStore, {
  mapState: ['count', 'userInfo'],
  mapGetters: ['double'],
  mapActions: ['login', 'setCount'],
})

// 对象形式（别名）：值也受键约束
withPageStore(typedStore, {
  mapState: { myCount: 'count' },
  mapGetters: { myDouble: 'double' },
  mapActions: { doLogin: 'login' },
})

// 反例：拼错 state 键应报错
// @ts-expect-error 'cont' 不是状态键
withPageStore(typedStore, { mapState: ['cont'] })

// 反例：拼错 getter 名应报错（修复前 Store 接口缺少 G 的属性级推断位点，此处不报错）
// @ts-expect-error 'doubl' 不是 getter 名
withPageStore(typedStore, { mapGetters: ['doubl'] })

// 反例：对象形式 getter 名拼错应报错
// @ts-expect-error 'doubl' 不是 getter 名
withPageStore(typedStore, { mapGetters: { myDouble: 'doubl' } })

// 反例：拼错 action 名应报错（修复前 A 泛型失效，此处不报错）
// @ts-expect-error 'logn' 不是 action 名
withPageStore(typedStore, { mapActions: ['logn'] })

// 反例：对象形式值拼错应报错
// @ts-expect-error 'logn' 不是 action 名
withPageStore(typedStore, { mapActions: { doLogin: 'logn' } })

// ==================== store.getters 精确类型（G 推断位点） ====================

type TypedGetters = (typeof typedStore)['getters']
declare const typedGetters: TypedGetters
const _doubleFn: (state: UserState) => number = typedGetters.double
void _doubleFn
// 精确锁定（#432）：可赋值断言在逆变下会被窄形参白送，这里要求 getters 保留的
// 就是 `(state: UserState) => number` 本身——getters 类型一旦被擦回
// `Getters<State>` / `(state: State) => unknown`，本行立即报错
const _doubleExact: Equal<typeof typedGetters.double, (state: UserState) => number> = true
void _doubleExact
// 反例：拼错 getter 名应报错
// @ts-expect-error 'doubl' 不在 getters 上
typedGetters.doubl

// ==================== 装饰器保持配置类型 ====================

const enhancePage = withPageStore(typedStore, { mapState: ['count'] })
const pageInput = {
  data: { local: 'x' },
  customMethod() {
    return 'kept'
  },
}
const pageOutput = enhancePage(pageInput)
// 返回值保持传入配置的具体类型（不擦除为 PageOptions）
const _kept: string = pageOutput.customMethod()
const _local: string = pageOutput.data.local
void [_kept, _local]
// 反例：访问不存在的成员应报错
// @ts-expect-error 'notExist' 不在原配置上
pageOutput.notExist

const enhanceComponent = withComponentStore(typedStore, { mapActions: ['setCount'] })
const componentOutput = enhanceComponent({
  methods: {
    handleTap() {
      return 42
    },
  },
})
const _tapResult: number = componentOutput.methods.handleTap()
void _tapResult
// 反例：访问不存在的方法应报错
// @ts-expect-error 'missing' 不在原配置上
componentOutput.methods.missing()

// ==================== withComponentStore 编译期键约束（#433 补齐反向用例） ====================
// 此前组件块只有一个正向用例：与 page / app 两块的断言清单保持同口径，
// 否则 withComponentStore 泛型一旦回归（例如键约束被 [key: string]: any 抹平）这里查不出来

// 正例：三组映射键均合法
withComponentStore(typedStore, {
  mapState: ['count', 'userInfo'],
  mapGetters: ['double'],
  mapActions: ['login', 'setCount'],
})

// 正例：对象别名形式，键与值都受约束
withComponentStore(typedStore, {
  mapState: { myCount: 'count' },
  mapGetters: { myDouble: 'double' },
  mapActions: { doTap: 'setCount' },
})

// 反例：拼错 state 键应报错
// @ts-expect-error 'cont' 不是状态键
withComponentStore(typedStore, { mapState: ['cont'] })

// 反例：拼错 getter 名应报错
// @ts-expect-error 'doubl' 不是 getter 名
withComponentStore(typedStore, { mapGetters: ['doubl'] })

// 反例：拼错 action 名应报错
// @ts-expect-error 'logn' 不是 action 名
withComponentStore(typedStore, { mapActions: ['logn'] })

// 反例：别名形式的值同样受键约束
// @ts-expect-error 'doubl' 不是 getter 名
withComponentStore(typedStore, { mapGetters: { myDouble: 'doubl' } })

// ==================== withAppStore 编译期键约束（S/A/G 从 store 推断） ====================
// 本块只覆盖 `withAppStore`：仓库里没有名为 `createApp` 的入口（`src/index.ts` 未导出、
// 文档亦无），此前的小节标题与下面的一条反例注释提到它，属于凭空承诺（#R5-352）。

// 正例：三组映射键均合法
withAppStore(typedStore, {
  mapState: ['count'],
  mapGetters: ['double'],
  mapActions: ['setCount'],
})
withAppStore(typedStore, { mapActions: { doLogin: 'login' } })

// 反例：拼错 state 键应报错
// @ts-expect-error 'cont' 不是状态键
withAppStore(typedStore, { mapState: ['cont'] })

// 反例：拼错 getter 名应报错（修复前 A/G 泛型缺失，此处不报错）
// @ts-expect-error 'doubl' 不是 getter 名
withAppStore(typedStore, { mapGetters: ['doubl'] })

// 反例：拼错 action 名应报错
// @ts-expect-error 'logn' 不是 action 名
withAppStore(typedStore, { mapActions: ['logn'] })

// 反例：对象形式值拼错应报错
// @ts-expect-error 'logn' 不是 action 名
withAppStore(typedStore, { mapActions: { doLogin: 'logn' } })

// 装饰器保持配置类型
const enhanceApp = withAppStore(typedStore, { mapState: ['count'] })
const appOutput = enhanceApp({
  globalData: { extra: 1 },
  customLaunch() {
    return 'kept'
  },
})
const _appKept: string = appOutput.customLaunch()
const _extra: number = appOutput.globalData.extra
void [_appKept, _extra]
// 反例：访问不存在的成员应报错
// @ts-expect-error 'notExist' 不在原配置上
appOutput.notExist

// ==================== PageOwnMethods / PageReservedKeys 的框架键清单（#427） ====================

type PageCfgShape = {
  data: { local: string }
  setData: (data: Record<string, unknown>) => void
  onLoad: (query: Record<string, string>) => void
  onShow: () => void
  onHide: () => void
  onUnload: () => void
  onReady: () => void
  onPullDownRefresh: () => void
  onReachBottom: () => void
  onPageScroll: (e: { scrollTop: number }) => void
  onRouteDone: () => void
  onShareAppMessage: () => { title: string }
  onShareTimeline: () => { title: string }
  onAddToFavorites: () => { title: string }
  onSaveExitState: () => { data: unknown }
  onTabItemTap: (index: string) => void
  onResize: (size: { windowWidth: number }) => void
  options: { additive: boolean }
  __geomUnbinds: Array<() => void>
  customMethod: (n: number) => string
}

type PageCustom = PageOwnMethods<PageCfgShape>

// 夹具覆盖度断言（#R5-353）：`PageReservedKeys` 的每个键都必须在 `PageCfgShape` 里出现一次。
// 缺一个键，下面那句「少收任何一个框架键都会让它出现在 keyof 里」就只对夹具恰好写出的键成立——
// 例如 src 侧把 `onHide` 从清单里删掉，夹具没写 `onHide` 时本文件仍会全绿。
const _reservedKeysAllCovered: [Exclude<PageReservedKeys, keyof PageCfgShape>] extends [never] ? true : false = true
void _reservedKeysAllCovered

// 正例：只剩用户自定义方法，且签名保持（this 被刻意剥离，与 ComponentOwnMethods 同口径）
const _custom: string = (null as unknown as PageCustom).customMethod(1)
void _custom
// 基例断言：自定义方法集合恰为 { customMethod }。
// 少收任何一个框架键（含基础库提供的 onShareTimeline / onAddToFavorites / onSaveExitState、
// 以及非函数的 options）都会让它出现在 keyof 里，下面两条断言随即报错。
const _keys: 'customMethod' = null as unknown as keyof PageCustom
void _keys
// @ts-expect-error 反向确认：keyof PageCustom 不含框架键
const _keysBad: 'onShareTimeline' = null as unknown as keyof PageCustom
void _keysBad

// ==================== PageThis 的 ExtraMethods 默认不注入（#428 现状记录） ====================

declare const bareThis: PageThis<UserState, UserActions, Getters<UserState>, { mapState: ['count']; mapActions: ['login'] }>
const _bareCount: number = bareThis.data.count
const _bareLogin: Promise<boolean> = bareThis.login({ username: 'u', password: 'p' })
void [_bareCount, _bareLogin]
// @ts-expect-error 未传第 5 个泛型 ExtraMethods 时，同页自定义方法在 this 上不可见
// （withPageStore 当前正是按默认值实例化 PageThis 的；接线属集成层，见本轮待办）
bareThis.customMethod

// ==================== 注入成员的四处同形（#429） ====================

// `data` / `setData` 由 types/integration.ts 的内部基类型 `InjectedDataShape` 声明一次，
// 页面/组件 × 实例视角/配置视角 四处复用。任一处退回各写一遍，就可能悄悄漂移成
// 「声明出运行时不存在的成员」——下面用 Equal 逐对钉住同一形状
type PageM = { mapState: ['count'] }
type PgThis = PageThis<UserState, UserActions, Getters<UserState>, PageM>
type PgCfg = PageConfig<UserState, PageM>
type CpThis = ComponentThis<UserState, UserActions, Getters<UserState>, PageM>
type CpCfg = ComponentConfig<UserState, UserActions, Getters<UserState>, PageM>

const _dataIsExtractPageData: [Equal<PgThis['data'], ExtractPageData<UserState, PageM>>, Equal<PgCfg['data'], ExtractPageData<UserState, PageM>>] = [true, true]
void _dataIsExtractPageData
const _dataSameAcrossFour: [Equal<CpThis['data'], PgThis['data']>, Equal<CpCfg['data'], PgThis['data']>] = [true, true]
void _dataSameAcrossFour
const _setDataSameAcrossFour: [
  Equal<PgCfg['setData'], PgThis['setData']>,
  Equal<CpThis['setData'], PgThis['setData']>,
  Equal<CpCfg['setData'], PgThis['setData']>,
] = [true, true, true]
void _setDataSameAcrossFour
// setData 的确切形状（框架签名，本库不改其语义）
const _setDataExact: Equal<PgThis['setData'], (data: Record<string, unknown>, callback?: () => void) => void> = true
void _setDataExact
// getTabBar 只在页面侧声明（组件侧原本就没有）
const _getTabBarPageOnly: [PgThis['getTabBar'], PgCfg['getTabBar']] = [undefined, undefined]
void _getTabBarPageOnly
// 组件两个类型上不声明 getTabBar，避免给出运行时不存在的成员。
// 写成「取值的断言」而不是无人引用的类型别名（#R5-354）：别名本身不产生使用点，
// 一旦 tsconfig.tests.json 的 noUnusedLocals 与 tsconfig.typecheck.json 对齐，无人引用的别名会整片报错。
// @ts-expect-error CpThis 上没有 getTabBar
const _cpNoTabBar: CpThis['getTabBar'] = undefined
// @ts-expect-error CpCfg 上同样没有 getTabBar
const _cpCfgNoTabBar: CpCfg['getTabBar'] = undefined
void [_cpNoTabBar, _cpCfgNoTabBar]

// ==================== AppThis：action 与调试 API 撞名的优先级（#430） ====================

type ClashActions = { getState: () => string; login: (id: string) => Promise<boolean> }
type ClashMap = { mapActions: ['getState', 'login'] }
declare const clashThis: AppThis<UserState, ClashActions, Getters<UserState>, ClashMap>

// 运行时是 bindActions 先、exposeStoreAPI 后（后者无条件覆写同名成员），所以留在实例上的是调试 API。
// 修复前两侧直接求交：`() => string` 这个 action 签名排在重载集首位，下面这行能编译，
// 而运行时拿到的是 UserState —— 类型谎报。现在它必须报错。
// 注（#R5-355）：这一段只是**类型侧**的口径，运行时的挂载顺序另由
// tests/integration/with-app-store.test.ts 断言，那里目前只查 `app.__store__.getState()`，
// 未查展平成员 `app.getState` 的优先级；补运行时断言的事本轮记为 NEEDS-MAIN（该文件不在本分片）。
// @ts-expect-error getState 归调试 API（返回 S），不再是 action 的 () => string
const _clashLooksLikeActionString: string = clashThis.getState()
void _clashLooksLikeActionString

// 正例：调试 API 完整可见，且 getCached 的泛型签名未被映射类型吃掉
const _clashState: UserState = clashThis.getState()
const _clashCached: { name: string } | null = clashThis.getCached('userInfo')
void [_clashState, _clashCached]
// 未撞名的 action 保持精确签名
const _clashLogin: Promise<boolean> = clashThis.login('u1')
void _clashLogin

export {}
