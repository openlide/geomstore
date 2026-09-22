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
 *
 * @file tests/types/plugin-parameter-types.typecheck.ts
 */

import { createStore, usePlugin } from '@/index.js'
import { persistencePlugin } from '@/plugins/builtin.js'
import type { Plugin } from '@/types/plugin.js'

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
persistencePlugin<UserState>({
  filter: (state) => ({ userInfo: state.userInfo }),
})
userStore.use(persistencePlugin<UserState>({ debounce: 10 }))

// 工厂的**返回值**同样必须带上 S（#436）：历史缺陷是返回类型被抹平为 `Plugin`（= Plugin<State>），
// 而 `Store.use(plugin: Plugin<NoInfer<S>> | Plugin<State>)` 的联合里就有 Plugin<State>，
// 于是「只校验入参」的上面几行在回归后仍全部通过。正向先取回带 S 的返回类型……
const typedPersistence: Plugin<UserState> = persistencePlugin<UserState>({ debounce: 10 })
userStore.use(typedPersistence)
// ……再反向下到状态不匹配的 Store 上；返回类型一旦被抹平，这行会重新被接受，
// 未命中的 @ts-expect-error 直接编译失败，从而真正守住返回泛型
// @ts-expect-error 工厂返回值保留 S：UserState 插件不能安装到 CartState 的 Store
cartStore.use(persistencePlugin<UserState>({ debounce: 10 }))
// @ts-expect-error 同上：显式取回的 Plugin<UserState> 也不能装到 CartState 的 Store
cartStore.use(typedPersistence)

// 反例：针对其他状态类型声明的插件不得安装到本 Store
// @ts-expect-error UserState 插件不能安装到 CartState 的 Store
cartStore.use(userPlugin)
// @ts-expect-error UserState 插件不能通过 usePlugin 安装到 CartState 的 Store
usePlugin(userPlugin, cartStore)

export {}
