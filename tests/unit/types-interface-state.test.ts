/**
 * 状态类型为「未声明索引签名的业务 interface」时的可用性回归测试
 *
 * 背景：`State` 约束定义为 `object`（见 types/store.ts），本意是允许业务 interface
 * 直接作为状态类型；但 `StoreLike.state`（composeStore）与选择器族的签名曾写作
 * `Record<string, unknown>`，而 interface 没有隐式索引签名，会被拒之门外。
 *
 * 该缺陷只在类型层可见，故用测试锁住：ts-jest 会报告类型错误，比仅依赖
 * typecheck:examples 更早失败。
 */

import { composeStore, createStore } from '../../src/index.js'
import { createParametricSelector, createSelector } from '../../src/extras/selector.js'

interface UserState {
  id: number
  name: string
}

interface CartState {
  items: Array<{ id: number; price: number }>
}

describe('状态类型为业务 interface（无索引签名）', () => {
  it('createSelector / createParametricSelector 可直接接收 interface 状态', () => {
    const store = createStore({
      name: 'iface-selector',
      state: (): UserState => ({ id: 1, name: 'Ada' }),
    })

    const selectName = createSelector((state: UserState) => state.name)
    expect(selectName(store.getState())).toBe('Ada')

    // 参数化选择器：按参数分别缓存
    const selectNameById = createParametricSelector(
      (state: UserState, id: number) => (state.id === id ? state.name : ''),
      { ttl: 1000, maxEntries: 8 },
    )(store.getState())
    expect(selectNameById(1)).toBe('Ada')
    expect(selectNameById(2)).toBe('')
  })

  it('composeStore 可组合状态为 interface 的 Store', () => {
    const userStore = createStore({
      name: 'user',
      state: (): UserState => ({ id: 7, name: 'Bob' }),
      actions: {
        rename(this: { $patch: (patch: Partial<UserState>) => void }, name: string): void {
          this.$patch({ name })
        },
      },
    })
    const cartStore = createStore({
      name: 'cart',
      state: (): CartState => ({ items: [] }),
    })

    const root = composeStore([userStore, cartStore], { namespace: true })

    // 命名空间模式下运行时的状态是按 name 嵌套的，而 getState() 的静态类型为
    // 各子 store 状态的交叉类型 —— 与 examples/advanced/compose-stores.ts 同处理
    const readState = (): { user: UserState; cart: CartState } => root.getState() as unknown as { user: UserState; cart: CartState }

    expect(readState().user.name).toBe('Bob')
    expect(readState().cart.items).toEqual([])

    root.dispatch('user/rename', 'Carol')
    expect(readState().user.name).toBe('Carol')

    root.destroy()
  })
})
