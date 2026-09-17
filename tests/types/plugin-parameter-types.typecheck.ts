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

// 反例：针对其他状态类型声明的插件不得安装到本 Store
// @ts-expect-error UserState 插件不能安装到 CartState 的 Store
cartStore.use(userPlugin)
// @ts-expect-error UserState 插件不能通过 usePlugin 安装到 CartState 的 Store
usePlugin(userPlugin, cartStore)

export {}
