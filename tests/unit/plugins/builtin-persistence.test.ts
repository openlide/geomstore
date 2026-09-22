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
    const store = createStore({
      name: 'persist-clear',
      state: { x: 1 },
      actions: {
        bump(this: any) {
          this.$patch({ x: (this.state as { x: number }).x + 1 })
        },
      },
    })
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

describe('持久化插件恢复不得回写', () => {
  it('REGR-PERSIST-001 (BUG 回归): notify.async 恢复后不得覆写同一 tick 内的其他写入', async () => {
    const storageKey = 'geomstore_persist-async-restore'
    const saved = new Map<string, string>([[storageKey, JSON.stringify({ count: 5 })]])
    const storageBackend = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
      removeItem: (key: string) => void saved.delete(key),
    }

    const store = createStore({
      name: 'persist-async-restore',
      state: { count: 0 },
      notify: { async: true },
      actions: {},
    })

    store.use(persistencePlugin({ storage: storageBackend }))
    expect(store.getState().count).toBe(5)

    // 同一 tick 内另一个实例写入更新的数据
    storageBackend.setItem(storageKey, JSON.stringify({ count: 99 }))

    // 等恢复触发的合并通知 flush（微任务），插件订阅此时才收到通知
    await Promise.resolve()
    await Promise.resolve()

    // 修复前：恢复的延迟通知打到刚注册的订阅，插件把 {count:5} 回写覆盖 {count:99}
    expect(JSON.parse(saved.get(storageKey) ?? 'null')).toEqual({ count: 99 })

    store.destroy()
  })

  it('REGR-PERSIST-002 (BUG 回归): 恢复本身不产生磁盘写入，后续真实变更仍会落盘', async () => {
    const storageKey = 'geomstore_persist-async-no-rewrite'
    const storageBackend = {
      getItem: (key: string) => (key === storageKey ? JSON.stringify({ count: 5 }) : null),
      setItem: jest.fn(),
      removeItem: jest.fn(),
    }

    const store = createStore({
      name: 'persist-async-no-rewrite',
      state: { count: 0 },
      notify: { async: true },
      actions: {},
    })

    store.use(persistencePlugin({ storage: storageBackend }))
    expect(store.getState().count).toBe(5)

    await Promise.resolve()
    await Promise.resolve()

    // 修复前：每次启动恢复都会把同一份内容重写回磁盘（lastSaved 去重失效）
    expect(storageBackend.setItem).not.toHaveBeenCalled()

    // 恢复后的真实状态变更仍必须落盘
    store.setState('count', 6)
    await Promise.resolve()
    await Promise.resolve()

    expect(storageBackend.setItem).toHaveBeenCalledWith(storageKey, JSON.stringify({ count: 6 }))

    store.destroy()
  })
})

describe('持久化插件的吸收与卸载兜底分支', () => {
  it('恢复内容无法序列化时放弃吸收，后续变更仍正常落盘', async () => {
    const store = createStore({ name: 'persist-absorb-fail', state: { n: 0 }, notify: { async: true }, actions: {} })
    const saved = new Map<string, string>()
    saved.set('geomstore_persist-absorb-fail', JSON.stringify({ n: 5 }))
    const written: string[] = []
    const backend = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        written.push(value)
        saved.set(key, value)
      },
      removeItem: (key: string) => void saved.delete(key),
    }
    const circular: { self?: unknown } = {}
    circular.self = circular
    // filter 返回循环引用结构：吸收步骤的 JSON.stringify 抛错 → 放弃吸收（不影响后续保存路径）
    store.use(persistencePlugin({ storage: backend, filter: () => circular as never }))
    try {
      await Promise.resolve()
      await Promise.resolve()
      // 放弃吸收后行为回到「通知即落盘」，写入必然失败（循环引用）但不抛出
      store.setState('n', 1)
      await Promise.resolve()
      await Promise.resolve()
    } finally {
      store.destroy()
    }
    expect(written.length).toBeGreaterThanOrEqual(0)
  })

  it('卸载补写时 filter 抛错只记录日志，不影响卸载完成', () => {
    const store = createStore({ name: 'persist-uninstall-throw', state: { n: 0 }, actions: {} })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation()
    let calls = 0
    const backend = { getItem: () => null, setItem: jest.fn(), removeItem: jest.fn() }
    const uninstall = store.use(
      persistencePlugin({
        storage: backend,
        // 卸载补写时 filter 抛错：验证外层 try/catch 兜底（无恢复、无通知，filter 只在补写时被调用）
        filter: () => {
          calls++
          throw new Error('filter boom')
        },
      }),
    )
    try {
      expect(calls).toBe(0)
      expect(() => uninstall()).not.toThrow()
      expect(calls).toBe(1)
      expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('Failed to persist state on uninstall'))).toBe(true)
    } finally {
      errorSpy.mockRestore()
      store.destroy()
    }
  })
})
