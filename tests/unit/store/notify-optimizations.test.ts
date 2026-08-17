/**
 * GeomStore v1.0.0 - 通知与订阅性能优化测试
 * @file tests/unit/store/notify-optimizations.test.ts
 *
 * 覆盖：
 * - notify.clone: 零拷贝通知模式（保护 Proxy / 原始引用）
 * - notify.onlyOnChange: 脏跟踪，未修改状态的 dispatch 不触发通知
 * - subscription.onLimit: 订阅者上限策略（evict-oldest / throw）
 * - cacheConfig.enableStats: 缓存统计采集开关
 * - deepCloneState 兜底克隆：循环引用 / Date / undefined 保留
 */

import { createStore } from '@/index'
import { deepCloneState } from '@/core/store/utils'

describe('通知行为优化', () => {
  describe('notify.clone（零拷贝模式）', () => {
    it('NOTIFY-001: 默认模式下监听器收到深拷贝（与内部状态引用隔离）', () => {
      const store = createStore({ state: { count: 0, nested: { v: 1 } } })
      let received: { nested: { v: number } } | undefined
      store.subscribe((state) => {
        received = state as unknown as { nested: { v: number } }
      })

      store.setState('count', 1)

      expect(received).toBeDefined()
      expect(received!.nested).not.toBe(store.getState().nested)
    })

    it('NOTIFY-002: clone=false 且状态保护开启时，监听器收到只读保护 Proxy', () => {
      const store = createStore({
        state: { count: 0, nested: { v: 1 } },
        notify: { clone: false },
      })
      let received: unknown
      store.subscribe((state) => {
        received = state
      })

      store.setState('count', 1)

      // 保护 Proxy 不是原始状态引用
      expect(received).not.toBe(store.getState())
      expect((received as { count: number }).count).toBe(1)
      // 两次通知收到同一缓存 Proxy（引用稳定，无重复克隆）
      let second: unknown
      const unsub = store.subscribe((state) => {
        second = state
      })
      store.setState('count', 2)
      expect(second).toBe(received)
      unsub()
    })

    it('NOTIFY-003: clone=false 且状态保护关闭时，监听器收到原始引用（零开销）', () => {
      const store = createStore({
        state: { count: 0 },
        notify: { clone: false },
        stateProtection: { enabled: false },
      })
      let received: unknown
      store.subscribe((state) => {
        received = state
      })

      store.setState('count', 5)

      expect(received).toBe(store.getState())
    })
  })

  describe('notify.onlyOnChange（脏跟踪通知）', () => {
    it('NOTIFY-004: 只读 action 不触发通知', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          read() {
            return this.state.count
          },
        },
        notify: { onlyOnChange: true },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      const result = store.dispatch('read')

      expect(result).toBe(0)
      expect(listener).not.toHaveBeenCalled()
    })

    it('NOTIFY-005: 直接变异、数组变异、setState 均正常触发通知', () => {
      const store = createStore({
        state: { count: 0, items: [1, 2] },
        actions: {
          inc() {
            this.state.count++
          },
          push() {
            this.state.items.push(9)
          },
          viaSetState() {
            this.setState('count', this.state.count + 1)
          },
        },
        notify: { onlyOnChange: true },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      store.dispatch('inc')
      expect(listener).toHaveBeenCalledTimes(1)

      store.dispatch('push')
      expect(listener).toHaveBeenCalledTimes(2)

      store.dispatch('viaSetState')
      expect(listener).toHaveBeenCalledTimes(3)
      expect(store.getState().count).toBe(2)
      expect(store.getState().items).toEqual([1, 2, 9])
    })

    it('NOTIFY-006: 嵌套对象与 delete 操作也被脏跟踪捕获', () => {
      const store = createStore({
        state: { user: { name: 'a', age: 1 } as Record<string, unknown> },
        actions: {
          rename() {
            this.state.user.name = 'b'
          },
          removeAge() {
            delete this.state.user.age
          },
          readUser() {
            return this.state.user.name
          },
        },
        notify: { onlyOnChange: true },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      store.dispatch('readUser')
      expect(listener).not.toHaveBeenCalled()

      store.dispatch('rename')
      expect(listener).toHaveBeenCalledTimes(1)

      store.dispatch('removeAge')
      expect(listener).toHaveBeenCalledTimes(2)
      expect(store.getState().user).toEqual({ name: 'b' })
    })

    it('NOTIFY-007: 默认模式（未开启 onlyOnChange）保持无条件通知', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          read() {
            return this.state.count
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      store.dispatch('read')

      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('subscription.onLimit（订阅者上限策略）', () => {
    it('SUB-001: onLimit=throw 达到上限时抛出错误', () => {
      const store = createStore({
        state: { count: 0 },
        subscription: { maxSubscribers: 2, onLimit: 'throw' },
      })

      store.subscribe(() => {})
      store.subscribe(() => {})

      expect(() => store.subscribe(() => {})).toThrow(/Subscriber limit reached/)
    })

    it('SUB-002: 默认策略保持驱逐最早订阅者（向后兼容）', () => {
      const store = createStore({
        state: { count: 0 },
        subscription: { maxSubscribers: 1 },
      })
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      const first = jest.fn()
      const second = jest.fn()
      store.subscribe(first)
      store.subscribe(second)

      store.setState('count', 1)
      expect(first).not.toHaveBeenCalled()
      expect(second).toHaveBeenCalledTimes(1)

      consoleSpy.mockRestore()
    })

    it('SUB-003: maxSubscribers 可单独配置', () => {
      const store = createStore({
        state: { count: 0 },
        subscription: { maxSubscribers: 1, onLimit: 'throw' },
      })

      store.subscribe(() => {})
      expect(() => store.subscribe(() => {})).toThrow(/Subscriber limit reached/)
    })
  })

  describe('cacheConfig.enableStats（统计采集开关）', () => {
    it('CACHE-STATS-001: enableStats=false 时不采集命中统计', () => {
      const store = createStore({
        state: { count: 0 },
        enableCache: true,
        cacheConfig: { enableStats: false },
      })

      store.getCached('count')
      store.getCached('count')

      const stats = store.getCacheStats()
      expect(stats.enabled).toBe(true)
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
    })

    it('CACHE-STATS-002: 默认仍采集统计（向后兼容）', () => {
      const store = createStore({ state: { count: 0 }, enableCache: true })

      store.getCached('count')
      store.getCached('count')

      expect(store.getCacheStats().hits).toBe(2)
    })
  })
})

describe('deepCloneState 兜底克隆（无 structuredClone 环境）', () => {
  const globalRef = globalThis as any
  const originalStructuredClone = globalRef.structuredClone

  beforeEach(() => {
    globalRef.structuredClone = undefined
  })

  afterEach(() => {
    globalRef.structuredClone = originalStructuredClone
  })

  it('CLONE-001: 支持循环引用（不栈溢出）', () => {
    const source: any = { name: 'a', list: [1, 2] }
    source.self = source

    const cloned = deepCloneState(source)

    expect(cloned).not.toBe(source)
    expect(cloned.self).toBe(cloned)
    expect(cloned.list).toEqual([1, 2])
    expect(cloned.list).not.toBe(source.list)
  })

  it('CLONE-002: 保留 Date 实例与 undefined 属性', () => {
    const date = new Date(123456789)
    const source = { created: date, maybe: undefined as unknown }

    const cloned = deepCloneState(source)

    expect(cloned.created).not.toBe(date)
    expect(cloned.created.getTime()).toBe(123456789)
    expect('maybe' in cloned).toBe(true)
  })

  it('CLONE-003: 原始值直接返回', () => {
    expect(deepCloneState(42)).toBe(42)
    expect(deepCloneState('s')).toBe('s')
    expect(deepCloneState(null)).toBe(null)
  })
})
