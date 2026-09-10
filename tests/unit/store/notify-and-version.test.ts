/**
 * Store 通知模式与状态版本号的重挂载
 *
 * 覆盖此前未被执行的路径：
 * - notify.async：同一 tick 内多次变更合并为一次微任务通知
 * - isStateKeyDirty：通知回调内精确判断某键是否变化（脏键在通知结束时清空）
 * - $replaceState 后重新挂载版本号 getter，选择器仍能 O(1) 判定变化
 * - state 工厂函数写法（初始化与 $replaceState）
 */
import { createStore } from '@/core/store/index.js'
import { createSelector } from '@/extras/selector/createSelector.js'

describe('Store 通知模式与版本号', () => {
  it('notify.async 启用时合并同一 tick 内的多次变更为一次通知', async () => {
    const store = createStore({ name: 'async-notify', state: { count: 0 }, notify: { async: true } })
    const listener = jest.fn()
    store.subscribe(listener)

    store.$patch({ count: 1 })
    store.$patch({ count: 2 })

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ count: 2 }))
  })

  it('默认（同步通知）下每次变更都立即广播', () => {
    const store = createStore({ name: 'sync-notify', state: { count: 0 } })
    const listener = jest.fn()
    store.subscribe(listener)

    store.$patch({ count: 1 })
    store.$patch({ count: 2 })

    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('isStateKeyDirty 在通知回调内反映本次变更的键（通知结束后清空）', () => {
    const store = createStore({ name: 'dirty-key', state: { a: 1, b: 2 } })
    const observed: Array<{ a: boolean; b: boolean }> = []
    store.subscribe(() => {
      observed.push({ a: store.isStateKeyDirty('a'), b: store.isStateKeyDirty('b') })
    })

    store.$patch({ a: 2 })

    expect(observed).toEqual([{ a: true, b: false }])
    // 通知结束后脏键清空
    expect(store.isStateKeyDirty('a')).toBe(false)
  })

  it('$replaceState 后重新挂载版本号 getter，选择器仍按 O(1) 判定变化', () => {
    const store = createStore({ name: 'replace-version', state: { count: 1 } })
    const select = createSelector((s: { count: number }) => s.count)

    store.$replaceState({ count: 10 })
    expect(select(store.state)).toBe(10)
    // 命中缓存（版本未变）
    expect(select(store.state)).toBe(10)

    store.$patch({ count: 11 })
    expect(select(store.state)).toBe(11)
  })

  it('$replaceState 支持 state 工厂函数写法', () => {
    const store = createStore({ name: 'replace-fn', state: { count: 1 } })

    store.$replaceState(() => ({ count: 42 }))

    expect(store.getState().count).toBe(42)
  })

  it('初始 state 支持工厂函数写法', () => {
    const store = createStore({ name: 'init-fn', state: () => ({ count: 7 }) })

    expect(store.getState().count).toBe(7)
  })
})
