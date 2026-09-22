/**
 * 插件参数类型契约（编译期断言）
 *
 * 本文件为「纯类型测试」，不参与 jest 运行时（文件名不以 .test/.spec 结尾），
 * 仅由 `pnpm typecheck:tests`（tsc --noEmit）做编译期校验。
 *
 * 锁定行为：
 * - 状态无关插件（`Plugin<State>`）可直接传给具体 Store 的 `use` 与 `usePlugin`
 * - 针对其他状态类型声明的插件仍应被拒绝（放宽不能退化为任意可传）
 * - `persistencePlugin<S>(options)` 保留状态类型参数，可安装到同类型的 Store
 * - 拒绝用例可归因（#437）：负向断言旁标注预期诊断 TS2345，并另以类型级断言
 *   直接检查「插件是否落在 `Store.use` 与 `usePlugin` 首参的入参联合里」，
 *   避免 @ts-expect-error 被无关错误顶包；上下文形参另用 typeof 探针钉死类型（不依赖 noImplicitAny）
 *
 * @file tests/types/plugin-parameter-types.typecheck.ts
 */

import { createStore, usePlugin } from '@/index.js'
import { persistencePlugin } from '@/plugins/builtin.js'
import type { Plugin } from '@/types/plugin.js'
import type { Actions, Getters } from '@/types/store.js'

interface UserState {
  userInfo: string | null
}

interface CartState {
  items: string[]
}

const userStore = createStore({
  name: 'plugin-types-user',
  state: (): UserState => ({ userInfo: null }),
})

const cartStore = createStore({
  name: 'plugin-types-cart',
  state: (): CartState => ({ items: [] }),
})

// 状态无关插件：对任意 Store 都适用
const stateAgnostic: Plugin = {
  name: 'state-agnostic',
  install() {
    return () => {}
  },
}

userStore.use(stateAgnostic)
usePlugin(stateAgnostic, userStore)
usePlugin(stateAgnostic, cartStore)

// 具体状态的插件：可安装到同状态类型的 Store
const userPlugin: Plugin<UserState> = {
  name: 'user-plugin',
  install(store) {
    const _state: UserState = store.getState()
    return () => void _state
  },
}

userStore.use(userPlugin)
usePlugin(userPlugin, userStore)

// persistencePlugin 保留状态类型参数：filter 回调的状态类型精确
// 探针而非裸用：tsconfig.tests.json 关掉了 noImplicitAny，推断一旦退化，`state` 会静默变成
// 隐式 any 而本行照样编译（隐式 any 让 `typeof state extends UserState` 展开为 boolean，赋 true 即报错）
persistencePlugin<UserState>({
  filter: (state) => {
    const _stateIsUserState: true = null as unknown as typeof state extends UserState ? true : false
    void _stateIsUserState
    return { userInfo: state.userInfo }
  },
})
userStore.use(persistencePlugin<UserState>({ debounce: 10 }))

// 工厂的**返回值**同样必须带上 S（#436）：历史缺陷是返回类型被抹平为 `Plugin`（= Plugin<State>），
// 而 `Store.use(plugin: Plugin<NoInfer<S>> | Plugin<State>)` 的联合里就有 Plugin<State>，
// 于是「只校验入参」的上面几行在回归后仍全部通过。正向先取回带 S 的返回类型……
const typedPersistence: Plugin<UserState> = persistencePlugin<UserState>({ debounce: 10 })
userStore.use(typedPersistence)

// ==================== 拒绝原因的可归属性（#437） ====================
//
// 下面四条 `@ts-expect-error` 只要求「下一行有任意诊断」即成立：签名重排、泛型改名等
// 与状态匹配无关的破法同样能让它们保持绿色。故把契约本身再写成一条类型级断言：
// 只依赖「Plugin<UserState> 是否落在 use 的入参联合里」，一旦这条判定翻转
// （例如 use 的入参联合被改写/收窄），报错点是这条赋值本身（TS2322），而不是某个被吞掉的诊断。
type CartInstallable = Parameters<typeof cartStore.use>[0]
// 状态不匹配的插件确实不在可安装联合里；契约翻转时这一行以 TS2322 失败
const _userPluginNotInstallable: Plugin<UserState> extends CartInstallable ? true : false = false
// 反向对照：同状态的插件必须在联合里，否则上一条断言会因「联合被整体改坏」而空过
const _cartPluginInstallable: Plugin<CartState> extends CartInstallable ? true : false = true
void [_userPluginNotInstallable, _cartPluginInstallable]

// 同样的可归因性镜像到 `usePlugin` 的第一入参（它是独立声明的联合，不随 Store.use 漂移）：
// 下方那条 @ts-expect-error 只要求「下一行有任意诊断」即成立，签名重排等无关错误同样能让它绿，
// 而这两条类型级断言把「状态匹配的插件是否在 plugin 形参联合里」本身钉死（翻转时以 TS2322 失败）
type UsePluginCartParam = Parameters<typeof usePlugin<CartState, Actions, Getters<CartState>>>[0]
const _userPluginRejectedByUsePlugin: Plugin<UserState> extends UsePluginCartParam ? true : false = false
const _cartPluginAcceptedByUsePlugin: Plugin<CartState> extends UsePluginCartParam ? true : false = true
void [_userPluginRejectedByUsePlugin, _cartPluginAcceptedByUsePlugin]

// ……再反向下到状态不匹配的 Store 上；返回类型一旦被抹平，这行会重新被接受，
// 未命中的 @ts-expect-error 直接编译失败，从而真正守住返回泛型
// @ts-expect-error 工厂返回值保留 S：UserState 插件不能安装到 CartState 的 Store（预期诊断 TS2345）
cartStore.use(persistencePlugin<UserState>({ debounce: 10 }))
// @ts-expect-error 同上：显式取回的 Plugin<UserState> 也不能装到 CartState 的 Store（预期诊断 TS2345）
cartStore.use(typedPersistence)

// 反例：针对其他状态类型声明的插件不得安装到本 Store
// @ts-expect-error UserState 插件不能安装到 CartState 的 Store（预期诊断 TS2345）
cartStore.use(userPlugin)
// @ts-expect-error UserState 插件不能通过 usePlugin 安装到 CartState 的 Store（预期诊断 TS2345）
usePlugin(userPlugin, cartStore)

export {}
