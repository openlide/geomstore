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
 * @file tests/types/integration-types.typecheck.ts
 */

import type { ExtractMappedActions } from '@/types/integration'
import {
  withPageStore,
  withComponentStore,
  withAppStore,
  createApp,
  createStore,
  type State,
  type Actions,
  type ConnectOptions,
  type PageThis,
  type ComponentThis,
  type ExtractPageData,
} from '@/index'

// ==================== 示例类型 ====================

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

type ArrayMapped = ExtractMappedActions<UserActions, { mapActions: ['login', 'setCount'] }>
declare const arrayMapped: ArrayMapped

// 正例：精确参数与返回类型
const _loginResult: Promise<boolean> = arrayMapped.login({ username: 'u', password: 'p' })
arrayMapped.setCount(1)

// 反例：传错参数类型
// @ts-expect-error setCount 期望 number，传入 string 应报错
arrayMapped.setCount('wrong')

// 反例：拼错方法名
// @ts-expect-error setcount 不存在，应报错
arrayMapped.setcount(1)

// ==================== 对象形式 mapActions（别名）精确签名 ====================

type AliasMapped = ExtractMappedActions<UserActions, { mapActions: { doLogin: 'login'; bump: 'setCount' } }>
declare const aliasMapped: AliasMapped

// 正例
const _aliasLogin: Promise<boolean> = aliasMapped.doLogin({ username: 'u', password: 'p' })
aliasMapped.bump(2)

// 反例：别名方法参数错误
// @ts-expect-error bump 期望 number，传入 string 应报错
aliasMapped.bump('wrong')

// ==================== ExtractPageData 精确 ====================

type PageData = ExtractPageData<UserState, { mapState: ['count'] }>
declare const pageData: PageData
const _count: number = pageData.count

// ==================== withPageStore 编译期键约束（S/A/G 从 store 推断） ====================

const typedStore = createStore({
  state: { userInfo: null as { name: string } | null, count: 0 },
  actions: {
    login: (payload: { username: string; password: string }) => Promise.resolve(true),
    setCount: (n: number) => {},
  },
  getters: {
    double: (state: { count: number }) => state.count * 2,
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
const _doubleFn: (state: { userInfo: { name: string } | null; count: number }) => number = typedGetters.double
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
// 反例：访问不存在的方法应报错
// @ts-expect-error 'missing' 不在原配置上
componentOutput.methods.missing()

// ==================== withAppStore / createApp 编译期键约束（S/A/G 从 store 推断） ====================

// 正例：三组映射键均合法
withAppStore(typedStore, {
  mapState: ['count'],
  mapGetters: ['double'],
  mapActions: ['setCount'],
})
createApp(typedStore, { mapActions: { doLogin: 'login' } })

// 反例：拼错 state 键应报错
// @ts-expect-error 'cont' 不是状态键
withAppStore(typedStore, { mapState: ['cont'] })

// 反例：拼错 getter 名应报错（修复前 A/G 泛型缺失，此处不报错）
// @ts-expect-error 'doubl' 不是 getter 名
withAppStore(typedStore, { mapGetters: ['doubl'] })

// 反例：拼错 action 名应报错
// @ts-expect-error 'logn' 不是 action 名
withAppStore(typedStore, { mapActions: ['logn'] })

// 反例：createApp 对象形式值拼错应报错
// @ts-expect-error 'logn' 不是 action 名
createApp(typedStore, { mapActions: { doLogin: 'logn' } })

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
// 反例：访问不存在的成员应报错
// @ts-expect-error 'notExist' 不在原配置上
appOutput.notExist
