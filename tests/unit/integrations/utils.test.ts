/**
 * GeomStore - 集成工具测试
 *
 * @module tests/unit/integrations/utils
 * @description 测试 integrations/utils.ts 中的所有工具函数
 */

import { parseMapping, bindMappings, bindActions, performAutoInject, exposeStoreAPI, cleanupBindings } from '@/integrations/utils'
import { createStore } from '@/index'

describe('integrations/utils', () => {
  describe('parseMapping', () => {
    it('UTIL-001: 应该将数组映射转换为对象形式', () => {
      const result = parseMapping(['count', 'name', 'user'])

      expect(result).toEqual({
        count: 'count',
        name: 'name',
        user: 'user',
      })
    })

    it('UTIL-002: 应该保持对象映射不变', () => {
      const mapping = { totalCount: 'count', userName: 'name' }
      const result = parseMapping(mapping)

      expect(result).toBe(mapping)
      expect(result).toEqual({
        totalCount: 'count',
        userName: 'name',
      })
    })

    it('UTIL-003: 应该处理空数组', () => {
      const result = parseMapping([])

      expect(result).toEqual({})
    })

    it('UTIL-004: 应该处理包含空字符串的数组', () => {
      const result = parseMapping(['count', '', 'name'])

      expect(result).toEqual({
        count: 'count',
        '': '',
        name: 'name',
      })
    })
  })

  describe('bindMappings', () => {
    it('UTIL-005: 应该正确绑定状态映射并订阅变化', () => {
      const store = createStore({ state: { count: 0, name: 'test' } })
      const target = {}
      const mappings = { localCount: 'count', localName: 'name' }
      const setData: Record<string, unknown> = {}

      const unbinds = bindMappings(
        target,
        mappings,
        (storeKey) => store.getState()[storeKey as keyof typeof store.getState],
        (updates) => {
          Object.assign(setData, updates)
        },
        (callback) => store.subscribe(callback),
      )

      // 验证初始值被设置
      expect(setData.localCount).toBe(0)
      expect(setData.localName).toBe('test')

      // 修改 store 状态
      store.setState('count', 10)
      store.setState('name', 'updated')

      // 验证监听器被触发
      expect(setData.localCount).toBe(10)
      expect(setData.localName).toBe('updated')

      // 验证返回取消绑定函数（合并后为单个批量订阅）
      expect(unbinds).toHaveLength(1)
      expect(typeof unbinds[0]).toBe('function')

      // 清理
      unbinds.forEach((unbind) => unbind())
    })

    it('UTIL-006: 应该处理空映射', () => {
      const store = createStore({ state: { count: 0 } })
      const setData: Record<string, unknown> = {}

      const unbinds = bindMappings(
        {},
        {},
        (storeKey) => store.getState()[storeKey as keyof typeof store.getState],
        (updates) => {
          Object.assign(setData, updates)
        },
        (callback) => store.subscribe(callback),
      )

      expect(unbinds).toHaveLength(0)
      expect(Object.keys(setData)).toHaveLength(0)
    })

    it('UTIL-007: 应该正确取消绑定', () => {
      const store = createStore({ state: { count: 0 } })
      const setData: Record<string, unknown> = {}
      let subscribeCount = 0

      const unbinds = bindMappings(
        {},
        { localCount: 'count' },
        (storeKey) => store.getState()[storeKey as keyof typeof store.getState],
        (updates) => {
          Object.assign(setData, updates)
        },
        (callback) => {
          subscribeCount++
          return store.subscribe(callback)
        },
      )

      expect(subscribeCount).toBe(1)

      // 取消绑定
      unbinds[0]()

      // 修改 store 状态，监听器不应该再被触发
      store.setState('count', 100)

      // 值不应该更新（因为监听器已被取消）
      expect(setData.localCount).toBe(0)
    })
  })

  describe('bindActions', () => {
    it('UTIL-008: 应该正确绑定 actions 到目标对象', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment(n: number) {
            (this.state as { count: number }).count += n
          },
          decrement(n: number) {
            (this.state as { count: number }).count -= n
          },
        },
      })

      const target: Record<string, unknown> = {}
      const mappings = { add: 'increment', subtract: 'decrement' }

      const unbinds = bindActions(target, mappings, store)

      // 验证 actions 被绑定
      expect(typeof target.add).toBe('function')
      expect(typeof target.subtract).toBe('function')

      // 调用绑定的 actions
      ;(target.add as Function)(5)
      expect(store.getState().count).toBe(5)
      ;(target.subtract as Function)(3)
      expect(store.getState().count).toBe(2)

      // 验证返回取消绑定函数
      expect(unbinds).toHaveLength(2)

      // 取消绑定
      unbinds.forEach((unbind) => unbind())

      // 验证 actions 被删除
      expect(target.add).toBeUndefined()
      expect(target.subtract).toBeUndefined()
    })

    it('UTIL-009: 应该处理空 actions 映射', () => {
      const store = createStore({ state: { count: 0 } })
      const target: Record<string, unknown> = {}

      const unbinds = bindActions(target, {}, store)

      expect(unbinds).toHaveLength(0)
      expect(Object.keys(target)).toHaveLength(0)
    })

    it('UTIL-010: 应该正确处理 action 参数传递', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
        actions: {
          setValues(count: number, name: string) {
            (this.state as { count: number }).count = count
            ;(this.state as { count: number; name: string }).name = name
          },
        },
      })

      const target: Record<string, unknown> = {}

      bindActions(target, { update: 'setValues' }, store)

      // 调用 action 传递多个参数
      ;(target.update as Function)(42, 'updated')

      expect(store.getState().count).toBe(42)
      expect(store.getState().name).toBe('updated')
    })
  })

  describe('performAutoInject', () => {
    it('UTIL-011: 应该自动注入缓存的值到目标对象', () => {
      const store = createStore({
        state: { count: 0, name: 'test', unused: 'value' },
        enableCache: true,
        cacheKeys: ['count', 'name'],
      })

      const target = {}
      const injectMapping = { count: 'localCount', name: 'localName' }
      let receivedUpdates: Record<string, unknown> = {}

      // 先设置一些缓存值
      store.setState('count', 10)
      store.setState('name', 'injected')

      performAutoInject(target, injectMapping, store, (updates) => {
        receivedUpdates = updates
      })

      expect(receivedUpdates.localCount).toBe(10)
      expect(receivedUpdates.localName).toBe('injected')
    })

    it('UTIL-012: 应该跳过 undefined 值', () => {
      const store = createStore({
        state: { count: 0, optional: undefined },
        enableCache: true,
      })

      let receivedUpdates: Record<string, unknown> = {}

      performAutoInject({}, { count: 'localCount', optional: 'localOptional' }, store, (updates) => {
        receivedUpdates = updates
      })

      expect(receivedUpdates.localCount).toBe(0)
      expect(receivedUpdates.localOptional).toBeUndefined()
      expect(Object.keys(receivedUpdates)).toEqual(['localCount'])
    })

    it('UTIL-013: 应该处理空注入映射', () => {
      const store = createStore({ state: { count: 0 } })
      let setterCalled = false

      performAutoInject({}, {}, store, () => {
        setterCalled = true
      })

      expect(setterCalled).toBe(false)
    })

    it('UTIL-014: 应该在 injectMapping 为 null 或 undefined 时提前返回', () => {
      const store = createStore({ state: { count: 0 } })
      let setterCalls = 0

      // 测试 null
      performAutoInject(null as any, null as any, store, () => {
        setterCalls++
      })

      // 测试 undefined（通过空对象模拟）
      performAutoInject({}, {}, store, () => {
        setterCalls++
      })

      expect(setterCalls).toBe(0)
    })
  })

  describe('exposeStoreAPI', () => {
    it('UTIL-015: 应该正确暴露 Store API 到目标对象', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment(n: number) {
            (this.state as { count: number }).count += n
          },
        },
      })

      const target: Record<string, unknown> = {}

      const unexpose = exposeStoreAPI(target, store)

      // 验证 Store 实例被暴露
      expect(target.store).toBe(store)

      // 验证 getStore 方法
      expect(typeof target.getStore).toBe('function')
      expect((target.getStore as Function)()).toBe(store)

      // 验证 getState 方法
      expect(typeof target.getState).toBe('function')
      expect((target.getState as Function)()).toEqual({ count: 0 })

      // 验证 getCached 方法
      expect(typeof target.getCached).toBe('function')

      // 验证 dispatch 方法
      expect(typeof target.dispatch).toBe('function')
      ;(target.dispatch as Function)('increment', 5)
      expect(store.getState().count).toBe(5)

      // 验证 subscribe 方法
      expect(typeof target.subscribe).toBe('function')

      // 验证 __store__ 调试对象
      expect(target.__store__).toBeDefined()
      expect(typeof (target.__store__ as Record<string, unknown>).getStore).toBe('function')
      expect(typeof (target.__store__ as Record<string, unknown>).getState).toBe('function')
      expect(typeof (target.__store__ as Record<string, unknown>).dispatch).toBe('function')
      expect(typeof (target.__store__ as Record<string, unknown>).subscribe).toBe('function')

      // 测试取消暴露
      unexpose()

      expect(target.store).toBeUndefined()
      expect(target.getStore).toBeUndefined()
      expect(target.getState).toBeUndefined()
      expect(target.getCached).toBeUndefined()
      expect(target.dispatch).toBeUndefined()
      expect(target.subscribe).toBeUndefined()
      expect(target.__store__).toBeUndefined()
    })

    it('UTIL-016: 应该在暴露后允许通过 target 操作 store', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          setCount(n: number) {
            (this.state as { count: number }).count = n
          },
        },
      })

      const target: Record<string, unknown> = {}

      exposeStoreAPI(target, store)

      // 通过 target 订阅状态变化
      const listener = jest.fn()
      const unsubscribe = (target.subscribe as Function)(listener)

      // 通过 target 触发 action
      ;(target.dispatch as Function)('setCount', 42)

      // 验证监听器被调用
      expect(listener).toHaveBeenCalled()

      // 取消订阅
      unsubscribe()
    })
  })

  describe('cleanupBindings', () => {
    it('UTIL-017: 应该执行所有取消绑定函数', () => {
      const unbind1 = jest.fn()
      const unbind2 = jest.fn()
      const unbind3 = jest.fn()

      const unbinds = [unbind1, unbind2, unbind3]

      cleanupBindings(unbinds)

      expect(unbind1).toHaveBeenCalled()
      expect(unbind2).toHaveBeenCalled()
      expect(unbind3).toHaveBeenCalled()

      // 验证数组被清空
      expect(unbinds).toHaveLength(0)
    })

    it('UTIL-018: 应该处理取消绑定函数抛出错误的情况', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      const unbind1 = jest.fn()
      const unbind2 = jest.fn(() => {
        throw new Error('Unbind error')
      })
      const unbind3 = jest.fn()

      const unbinds = [unbind1, unbind2, unbind3]

      // 不应该抛出错误
      expect(() => cleanupBindings(unbinds)).not.toThrow()

      // 验证所有函数都被尝试执行
      expect(unbind1).toHaveBeenCalled()
      expect(unbind2).toHaveBeenCalled()
      expect(unbind3).toHaveBeenCalled()

      // 验证警告被打印
      expect(consoleSpy).toHaveBeenCalledWith('[GeomStore] Error during cleanup:', expect.any(Error))

      consoleSpy.mockRestore()
    })

    it('UTIL-019: 应该处理空数组', () => {
      const unbinds: Array<() => void> = []

      expect(() => cleanupBindings(unbinds)).not.toThrow()
      expect(unbinds).toHaveLength(0)
    })

    it('UTIL-020: 应该处理包含 undefined 的数组并捕获错误', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const unbind1 = jest.fn()

      const unbinds: any[] = [unbind1, undefined, null]

      // 不应该抛出错误，因为 cleanupBindings 内部捕获了所有错误
      expect(() => cleanupBindings(unbinds)).not.toThrow()

      // 验证第一个函数被调用
      expect(unbind1).toHaveBeenCalled()

      // 验证错误被记录（因为 undefined 和 null 不是函数）
      expect(consoleSpy).toHaveBeenCalledTimes(2)

      // 验证数组被清空
      expect(unbinds).toHaveLength(0)

      consoleSpy.mockRestore()
    })
  })

  describe('边界情况', () => {
    it('UTIL-021: bindMappings 应该在 getter 返回 undefined 时正确处理', () => {
      const setData: Record<string, unknown> = {}

      const unbinds = bindMappings(
        {},
        { localKey: 'missingKey' },
        () => undefined,
        (updates) => {
          Object.assign(setData, updates)
        },
        () => () => {},
      )

      expect(setData.localKey).toBeUndefined()
      expect(unbinds).toHaveLength(1)

      unbinds[0]()
    })

    it('UTIL-022: bindActions 应该允许多次绑定和取消绑定', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment() {
            (this.state as { count: number }).count++
          },
        },
      })

      const target: Record<string, unknown> = {}

      // 第一次绑定
      const unbinds1 = bindActions(target, { add: 'increment' }, store)
      expect(typeof target.add).toBe('function')

      // 取消绑定
      unbinds1.forEach((unbind) => unbind())
      expect(target.add).toBeUndefined()

      // 第二次绑定
      const unbinds2 = bindActions(target, { add: 'increment' }, store)
      expect(typeof target.add).toBe('function')

      // 清理
      unbinds2.forEach((unbind) => unbind())
    })

    it('UTIL-023: exposeStoreAPI 的 __store__ 对象应该是独立的', () => {
      const store = createStore({ state: { count: 0 } })
      const target: Record<string, unknown> = {}

      exposeStoreAPI(target, store)

      const storeObj = target.__store__ as Record<string, unknown>

      // 验证 __store__ 有自己的方法
      expect(typeof storeObj.getStore).toBe('function')
      expect(typeof storeObj.getState).toBe('function')
      expect(typeof storeObj.dispatch).toBe('function')
      expect(typeof storeObj.subscribe).toBe('function')

      // 验证方法可以正常工作
      expect((storeObj.getStore as Function)()).toBe(store)
    })
  })

  describe('performAutoInject 边界覆盖', () => {
    it('UTIL-COVER-001: 所有缓存值都为 undefined 时不应该调用 setter', () => {
      // 创建一个 store，所有 getCached 返回 undefined
      const store = createStore({
        state: { count: 0 },
        enableCache: true,
      })

      const mockStore = {
        getCached: () => undefined,
      } as any

      let setterCalled = false
      performAutoInject({}, { a: 'x', b: 'y' }, mockStore, () => {
        setterCalled = true
      })

      // 所有值都是 undefined，setter 不应该被调用
      expect(setterCalled).toBe(false)
    })
  })

  describe('exposeStoreAPI 边界覆盖', () => {
    it('UTIL-COVER-002: getCached 方法应该正确委托到 store', () => {
      const store = createStore({
        state: { count: 42 },
        enableCache: true,
        cacheKeys: ['count'],
      })

      const target: Record<string, unknown> = {}
      exposeStoreAPI(target, store)

      // 调用 getCached
      const result = (target.getCached as Function)('count')
      expect(result).toBe(42)
    })

    it('UTIL-COVER-003: __store__.getCached 方法应该正确委托到 store', () => {
      const store = createStore({
        state: { count: 99 },
        enableCache: true,
        cacheKeys: ['count'],
      })

      const target: Record<string, unknown> = {}
      exposeStoreAPI(target, store)

      const storeObj = target.__store__ as Record<string, unknown>

      // 调用 __store__.getCached
      const result = (storeObj.getCached as Function)('count')
      expect(result).toBe(99)
    })

    it('UTIL-COVER-004: __store__.dispatch 应该正确委托到 store', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment(n: number) {
            (this.state as { count: number }).count += n
          },
        },
      })

      const target: Record<string, unknown> = {}
      exposeStoreAPI(target, store)

      const storeObj = target.__store__ as Record<string, unknown>
      ;(storeObj.dispatch as Function)('increment', 10)

      expect(store.getState().count).toBe(10)
    })

    it('UTIL-COVER-006: __store__.getState 应该正确委托到 store', () => {
      const store = createStore({
        state: { count: 42 },
      })

      const target: Record<string, unknown> = {}
      exposeStoreAPI(target, store)

      const storeObj = target.__store__ as Record<string, unknown>
      const result = (storeObj.getState as Function)()
      expect(result).toEqual({ count: 42 })
    })

    it('UTIL-COVER-005: __store__.subscribe 应该正确委托到 store', () => {
      const store = createStore({
        state: { count: 0 },
      })

      const target: Record<string, unknown> = {}
      exposeStoreAPI(target, store)

      const storeObj = target.__store__ as Record<string, unknown>
      const listener = jest.fn()
      const unsubscribe = (storeObj.subscribe as Function)(listener)

      store.setState('count', 5)
      expect(listener).toHaveBeenCalled()

      unsubscribe()
    })
  })
})
