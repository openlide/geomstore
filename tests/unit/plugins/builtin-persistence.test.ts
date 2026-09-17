/**
 * 内置持久化插件：卸载时的清理与待清状态补写
 */

import { persistencePlugin } from '@/plugins/builtin.js'
import { createStore } from '@/core/store/index.js'

describe('持久化插件的清理边界', () => {
  it('无待清状态时卸载不做清理（静默）', () => {
    const store = createStore({ name: 'persist-no-pending', state: { x: 1 }, actions: {} })
    const storageBackend = { getItem: () => null, setItem: () => {}, removeItem: jest.fn() }

    const uninstall = store.use(persistencePlugin({ storage: storageBackend }))
    uninstall()

    expect(storageBackend.removeItem).not.toHaveBeenCalled()
  })

  it('clearOnUninstall=true 且存在待清状态时执行清理', () => {
    const store = createStore({ name: 'persist-clear', state: { x: 1 }, actions: { bump(this: any) { this.$patch({ x: (this.state as { x: number }).x + 1 }) } } })
    const storageBackend = { getItem: () => null, setItem: () => {}, removeItem: jest.fn() }

    const uninstall = store.use(persistencePlugin({ storage: storageBackend, clearOnUninstall: true }))
    store.dispatch('bump')
    uninstall()

    expect(storageBackend.removeItem).toHaveBeenCalled()
  })

  it('clearOnUninstall=true 且处于防抖待清态时丢弃待写数据并清理存储', () => {
    const store = createStore({
      name: 'persist-clear-pending',
      state: { x: 1 },
      actions: {
        bump(this: any): void {
          this.$patch({ x: (this.state as { x: number }).x + 1 })
        },
      },
    })
    const storageBackend = { getItem: () => null, setItem: jest.fn(), removeItem: jest.fn() }

    // 防抖 > 0：dispatch 后处于待清态；同时 clearOnUninstall 为真 → 丢弃待写、直接清理存储
    const uninstall = store.use(persistencePlugin({ storage: storageBackend, clearOnUninstall: true, debounce: 1000 }))
    store.dispatch('bump')
    uninstall()

    expect(storageBackend.setItem).not.toHaveBeenCalled()
    expect(storageBackend.removeItem).toHaveBeenCalled()
  })
})

describe('持久化插件的卸载补写', () => {
  it('防抖窗口内卸载且未开启 clearOnUninstall 时补写最后一次变更', () => {
    const store = createStore({
      name: 'persist-pending-flush',
      state: { x: 1 },
      actions: {
        bump(this: any): void {
          this.$patch({ x: (this.state as { x: number }).x + 1 })
        },
      },
    })
    const storageBackend = { getItem: () => null, setItem: jest.fn(), removeItem: jest.fn() }

    // 防抖 > 0：dispatch 后保存处于待清（pendingState 非空）
    const uninstall = store.use(persistencePlugin({ storage: storageBackend, debounce: 1000 }))
    store.dispatch('bump')
    uninstall()

    // 卸载时同步补写最后一次变更，且不因未开启 clearOnUninstall 而清除存储
    expect(storageBackend.setItem).toHaveBeenCalled()
    expect(storageBackend.removeItem).not.toHaveBeenCalled()
  })

  it('notify.async 下通知未送达即销毁时仍补写最后一次变更', async () => {
    const store = createStore({
      name: 'persist-async-destroy',
      state: { n: 0 },
      notify: { async: true },
      actions: {},
    })
    const saved = new Map<string, string>()
    const storageBackend = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
      removeItem: (key: string) => void saved.delete(key),
    }
    store.use(persistencePlugin({ storage: storageBackend, debounce: 1000 }))

    // 写入后立刻销毁：待发通知被取消，订阅回调从未收到新状态
    store.setState('n', 1)
    store.destroy()

    // 存储键默认加 geomstore_ 前缀
    expect(JSON.parse(saved.get('geomstore_persist-async-destroy') ?? 'null')).toEqual({ n: 1 })
  })

  it('卸载补写不产生无变化的重复写入', () => {
    const store = createStore({ name: 'persist-no-dup', state: { x: 1 }, actions: {} })
    const storageBackend = { getItem: () => null, setItem: jest.fn(), removeItem: jest.fn() }
    const uninstall = store.use(persistencePlugin({ storage: storageBackend }))
    uninstall()
    uninstall()
    expect(storageBackend.setItem).toHaveBeenCalledTimes(1)
  })
})
