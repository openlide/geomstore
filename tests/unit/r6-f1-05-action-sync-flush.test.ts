/**
 * 第六轮 f1-05 回归锁：异步 action 的同步段通知兜底（R6-037）
 *
 * 旧实现把异步 action 的通知**无条件**推迟到 promise settle，且没有任何兜底路径：
 * 返回的 promise 若不 settle（等用户交互才 resolve、请求无回调也不 reject），
 * 本次 dispatch 期间被抑制的写入就永不被通知——不是「晚一点」，而是要等下一个
 * 不相干的通知顺带补发。
 */

import { createStore } from '@/core/store/index.js'

const nextRound = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('R6-037 永不 settle 的 promise 不再吞掉同步段的通知', () => {
  it('默认模式：$patch 写入的可见性当场送达（不再等对话框被关掉）', async () => {
    let release!: (value: unknown) => void
    const store = createStore({
      name: 'r6-sync-flush-patch',
      state: { dialogVisible: false, other: 0 },
      actions: {
        confirm(this: { state: { dialogVisible: boolean }; $patch: (p: Partial<{ dialogVisible: boolean }>) => void }) {
          this.$patch({ dialogVisible: true })
          return new Promise((resolve) => {
            release = resolve
          })
        },
      },
    })
    const seen: boolean[] = []
    store.subscribe((state) => seen.push(state.dialogVisible))

    const pending = store.dispatch('confirm')

    expect(store.getState().dialogVisible).toBe(true)
    // 旧实现在这里 seen 仍是 []：那一格变更要等 release 之后才可见
    expect(seen).toEqual([true])

    release(undefined)
    await pending
    await nextRound()
    expect(seen.length).toBeGreaterThanOrEqual(1)
  })

  it('默认模式：action 体内直接变异状态同样当场送达', () => {
    const store = createStore({
      name: 'r6-sync-flush-direct',
      state: { loading: false },
      actions: {
        start(this: { state: { loading: boolean } }) {
          this.state.loading = true
          // 自定义 thenable：收下回调却永不回调，等价于「挂起等外部事件」
          return { then: () => undefined }
        },
      },
    })
    const seen: boolean[] = []
    store.subscribe((state) => seen.push(state.loading))

    store.dispatch('start')
    expect(seen).toEqual([true])
  })

  it('onlyOnChange：同步段兜发与 settle 补发共用去重判据，不叠加', async () => {
    let release!: (value: unknown) => void
    const store = createStore({
      name: 'r6-sync-flush-only-change',
      state: { v: 0 },
      notify: { onlyOnChange: true },
      actions: {
        bump(this: { $patch: (p: Partial<{ v: number }>) => void }) {
          this.$patch({ v: 1 })
          return new Promise((resolve) => {
            release = resolve
          })
        },
      },
    })
    const listener = jest.fn()
    store.subscribe(listener)

    const pending = store.dispatch('bump')
    expect(listener).toHaveBeenCalledTimes(1)

    release(undefined)
    await pending
    await nextRound()
    // 续段没有任何新变更 ⇒ settle 那一轮被「已通知覆盖计数」吃掉
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('无变更的异步 action 不因兜底而多刷监听器', async () => {
    const store = createStore({
      name: 'r6-sync-flush-noop',
      state: { v: 0 },
      actions: {
        async idle(this: { $patch: (p: Partial<{ v: number }>) => void }): Promise<void> {
          await Promise.resolve()
          this.$patch({ v: 1 })
        },
      },
    })
    const listener = jest.fn()
    store.subscribe(listener)

    await store.dispatch('idle')
    await nextRound()
    // 两轮都是既有口径：续段 $patch 在 dispatch 之外自发通知一次 + settle 补发一次。
    // 同步段什么都没改 ⇒ 兜底不再加第三轮
    expect(listener).toHaveBeenCalledTimes(2)
    expect(store.getState().v).toBe(1)
  })

  it('同步段无写入的正常异步 action：兜底不额外补发（settle 一轮照旧）', async () => {
    const store = createStore({
      name: 'r6-sync-flush-empty',
      state: { v: 0 },
      actions: {
        async idle(): Promise<void> {
          await Promise.resolve()
        },
      },
    })
    const listener = jest.fn()
    store.subscribe(listener)

    await store.dispatch('idle')
    await nextRound()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('onlyOnChange 下无变更的异步 action 仍然一次都不通知', async () => {
    const store = createStore({
      name: 'r6-sync-flush-only-change-noop',
      state: { v: 0 },
      notify: { onlyOnChange: true },
      actions: {
        async noop(this: { dispatch: (n: string) => unknown }): Promise<void> {
          await Promise.resolve()
        },
      },
    })
    const listener = jest.fn()
    store.subscribe(listener)

    await store.dispatch('noop')
    await nextRound()
    expect(listener).not.toHaveBeenCalled()
  })

  it('batch 中返回挂起 promise：同步段不提前通知，由 batch 收尾统一发', async () => {
    let release!: (value: unknown) => void
    const store = createStore({
      name: 'r6-sync-flush-batch',
      state: { v: 0 },
      actions: {
        hold(this: { $patch: (p: Partial<{ v: number }>) => void }) {
          this.$patch({ v: 1 })
          return new Promise((resolve) => {
            release = resolve
          })
        },
      },
    })
    const listener = jest.fn()
    store.subscribe(listener)

    store.batch(() => {
      void store.dispatch('hold')
      expect(listener).not.toHaveBeenCalled()
    })
    expect(listener).toHaveBeenCalledTimes(1)
    release(undefined)
    await nextRound()
  })
})
