/**
 * ActionManager：onlyOnChange 模式下的通知抑制判定
 */

import { createStore } from '@/core/store/index.js'

describe('ActionManager 的通知抑制判定', () => {
  it('onlyOnChange 模式下有变更的异步 action 正常补发通知', async () => {
    const store = createStore({
      name: 'am-only-change-mutate',
      state: { v: 0 },
      notify: { onlyOnChange: true },
      actions: {
        async bump(this: any): Promise<void> {
          this.$patch({ v: (this.state as { v: number }).v + 1 })
        },
      },
    })
    const listener = jest.fn()
    store.subscribe(listener)

    await store.dispatch('bump')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(listener).toHaveBeenCalled()
  })

  it('onlyOnChange 模式下无变更的异步 action 不补发通知', async () => {
    const store = createStore({
      name: 'am-only-change-noop',
      state: { v: 0 },
      notify: { onlyOnChange: true },
      actions: {
        async noop(): Promise<void> {
          // 不触碰状态
        },
      },
    })
    const listener = jest.fn()
    store.subscribe(listener)

    await store.dispatch('noop')
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 计数未超过已通知覆盖计数 → 不通知（该分支仅在 onlyOnChange 生效时可到达）
    expect(listener).not.toHaveBeenCalled()
  })

  it('内层 dispatch 在外层未完成时结算：跳过自重通知，由外层收尾', async () => {
    const store: any = createStore({
      name: 'am-nested-settle',
      state: { v: 0 },
      actions: {
        async inner(this: any): Promise<void> {
          this.$patch({ v: 1 })
        },
        async outer(this: any): Promise<void> {
          // 内层 dispatch 的 promise 在外层 dispatch 尚未退出时结算
          await store.dispatch('inner')
        },
      },
    })
    const listener = jest.fn()
    store.subscribe(listener)

    await store.dispatch('outer')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(store.getState().v).toBe(1)
    expect(listener).toHaveBeenCalled()
  })
})
