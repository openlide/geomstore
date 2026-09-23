/**
 * 第四轮 ocr 复审 low 波次（G1-core p1）的回归用例
 *
 * 每条用例名标注对应 finding 编号（#N），只覆盖本轮**有行为可观测差异**的改动；
 * 纯文档/注释类 finding 不在此列。
 */

import { LRUCache } from '@/core/cache/LRUCache.js'
import { HookSystem } from '@/core/hooks/HookSystem.js'
import { dispatchByNamespace } from '@/core/compose/helpers.js'
import { mergeStateMaps } from '@/core/compose/merge.js'
import { MetricsCollector } from '@/core/performance/metrics.js'
import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor.js'
import { ActionManager } from '@/core/store/ActionManager.js'
import { BatchManager } from '@/core/store/BatchManager.js'
import { SubscriptionManager } from '@/core/store/SubscriptionManager.js'
import { StateProxyManager, createProxyCache } from '@/core/store/StateProxy.js'
import { createStore } from '@/core/store/factory.js'
import { ActionError, GeomStoreError } from '@/core/errors/GeomStoreError.js'
import { LRUCache as PerfBarrelLRUCache } from '@/core/performance/index.js'
import type { InternalStateProtectionConfig } from '@/core/store/types.js'
import type { Store } from '@/types/store.js'

/** 只实现被调用成员的假 store */
function fakeStore(name: string, state: Record<string, unknown>): Store {
  return { name, destroyed: false, getState: () => state } as unknown as Store
}

describe('LRUCache 元数据与热路径（#83 / #116）', () => {
  it('#83 节点不再携带无读取方的访问元数据', () => {
    const cache = new LRUCache<string, number>(2)
    cache.set('a', 1)
    cache.get('a')
    // 链表节点不对外暴露，用「统计口径不变」+ 内部节点形状共同锁定：
    // 经 toObject/keys 拿到的都只有键值，节点字段变化不影响任何公开出口
    expect(cache.getStats().hits).toBe(1)
    expect(cache.keys()).toEqual(['a'])
    const node = (cache as unknown as { cache: Map<string, object> }).cache.get('a') as Record<string, unknown>
    expect(Object.keys(node).sort()).toEqual(['createdAt', 'key', 'next', 'prev', 'value'])
  })

  it('#116 未命中路径不再消耗高精度时钟调用，命中仍计真实耗时', () => {
    const cache = new LRUCache<string, number>({ capacity: 2, trackAccessTime: true, enableStats: true })
    cache.set('a', 1)

    const spy = jest.spyOn(performance, 'now')
    spy.mockClear()
    expect(cache.get('missing')).toBeUndefined()
    expect(spy).toHaveBeenCalledTimes(0)

    spy.mockClear()
    expect(cache.get('a')).toBe(1)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()

    const stats = cache.getStats()
    expect(stats.misses).toBe(1)
    expect(stats.hits).toBe(1)
    expect(typeof stats.avgAccessTime).toBe('number')
  })

  it('#116 set() 更新既有键不再无条件写访问时间戳（trackAccessTime 关闭时同样无副作用）', () => {
    const off = new LRUCache<string, number>({ capacity: 2, trackAccessTime: false, enableStats: true })
    off.set('a', 1)
    off.set('a', 2)
    expect(off.get('a')).toBe(2)
    expect(off.getStats().avgAccessTime).toBe(0)
    expect(off.getStats().hits).toBe(1)
  })
})

describe('LRUCache.clear 的回调异常上报（#117）', () => {
  it('#117 clear 中 onEvict 抛错与 evictLRU 同口径上报，且不中断其余条目', () => {
    const seen: string[] = []
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const cache = new LRUCache<string, number>({
      capacity: 3,
      onEvict: (key) => {
        if (key === 'a') throw new Error('evict boom')
        seen.push(String(key))
      },
    })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()

    expect(seen).toEqual(['b'])
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toBe('[LRUCache] Error in onEvict callback:')
    // 淘汰记账口径：clear 逐条计入 evictions
    expect(cache.getStats().evictions).toBe(2)
    errorSpy.mockRestore()
  })
})

describe('HookSystem 退订后的在册口径（#99）', () => {
  it('#99 最后一个监听者退订后钩子种类数回落', () => {
    const hooks = new HookSystem()
    const offBefore = hooks.on('beforeSetState', () => {})
    hooks.on('afterSetState', () => {})

    expect(hooks.size()).toBe(2)
    offBefore()
    expect(hooks.size()).toBe(1)
    expect(hooks.size('beforeSetState')).toBe(0)
  })

  it('#99 同一 handler 重复注册：退订一份仍保留另一份，全退后摘键', () => {
    const hooks = new HookSystem()
    const handler = jest.fn()
    const off1 = hooks.on('beforeSetState', handler)
    const off2 = hooks.on('beforeSetState', handler)

    off1()
    off2()
    expect(hooks.size()).toBe(0)

    hooks.on('beforeSetState', handler)
    expect(hooks.size('beforeSetState')).toBe(1)
    hooks.emit('beforeSetState')
    // Set 按身份去重：同一函数注册两次只存一份
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe('compose 分发的自有键判定与空值容忍（#110 / #114）', () => {
  it('#110 命名空间模式下原型链上的可枚举键不作为 store 名分发', () => {
    const data = Object.create({ ghost: 'from-proto' }) as Record<string, unknown>
    data.real = { x: 1 }
    const handler = jest.fn()
    const stores = [fakeStore('real', { x: 0 })]

    // strict=true：旧实现会把 ghost 一起枚举出来并抛「Cannot find store for key: ghost」
    expect(() => dispatchByNamespace(stores, true, data, true, handler)).not.toThrow()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('#110 非命名空间模式同样只按自有键分组', () => {
    const data = Object.create({ ghost: 'from-proto' }) as Record<string, unknown>
    data.a = 5
    const handler = jest.fn()
    const stores = [fakeStore('s', { a: 0 })]

    dispatchByNamespace(stores, false, data, true, handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][1]).toEqual({ a: 5 })
  })

  it('#114 子 store 视图为 null/undefined 时按「无键可并」降级', () => {
    const stores = [fakeStore('a', { x: 1 }), fakeStore('b', { y: 2 })]
    let n = 0
    // 旧实现在此抛 TypeError: Cannot convert undefined or null to object
    const merged = mergeStateMaps(stores, () => (n++ === 0 ? null : { z: 3 }), new Set<string>())
    expect(merged).toEqual({ z: 3 })
  })
})

describe('BatchManager（#120 / #122）', () => {
  it('#120 深度为 0 时 end() 既不回调也不让深度变负', () => {
    const onEnd = jest.fn()
    const manager = new BatchManager(onEnd)
    manager.end()
    manager.end()
    expect(onEnd).not.toHaveBeenCalled()
    manager.start()
    manager.end()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(manager.isInBatch).toBe(false)
  })

  it('#122 非函数 onEnd 在构造期即失败', () => {
    expect(() => new BatchManager(undefined as never)).toThrow(TypeError)
    expect(() => new BatchManager(null as never)).toThrow(/requires an onEnd callback/)
    expect(() => new BatchManager({} as never)).toThrow(TypeError)
  })
})

describe('MetricsCollector（#126）', () => {
  it('#126 非法 percentile 在空采集器上同样抛 RangeError', () => {
    const empty = new MetricsCollector()
    expect(() => empty.getPercentile(-1)).toThrow(RangeError)
    expect(() => empty.getPercentile(101)).toThrow(RangeError)
    expect(() => empty.getPercentile(Number.NaN)).toThrow(RangeError)
    expect(() => empty.getPercentile(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    // 合法入参在空集上仍是 0 哨兵
    expect(empty.getPercentile(50)).toBe(0)
  })
})

describe('PerformanceMonitor 计时来源（#136 / #133）', () => {
  const originalWx = (globalThis as { wx?: unknown }).wx

  /** 整体替换 wx：用 defineProperty 而非 `globalThis.wx = …`，避开 ASI 前导分号写法 */
  const setWx = (value: unknown): void => {
    Object.defineProperty(globalThis, 'wx', { value, configurable: true, writable: true })
  }

  afterEach(() => {
    setWx(originalWx)
  })

  it('#136 整轮计时只向 wx.getPerformance() 取一次性能实例', () => {
    let probes = 0
    let current = 1000
    setWx({
      getPerformance: () => {
        probes += 1
        return { now: () => current }
      },
    })
    const logger = jest.fn()
    const monitor = new PerformanceMonitor({ threshold: 5, logger })

    const end = monitor.start('op')
    current = 1020
    end()

    // start/end/pruneStaleOperations 合计取时间戳 ≥3 次，但工厂只被调用一次
    expect(probes).toBe(1)
    expect(monitor.getMetrics()[0].duration).toBe(20)
    expect(logger).toHaveBeenCalledTimes(1)
  })

  it('#136 getPerformance 返回不可用形状时降级 Date.now，且只探测一次', () => {
    let probes = 0
    setWx({
      getPerformance: () => {
        probes += 1
        return { noNow: true }
      },
    })
    const monitor = new PerformanceMonitor()
    const probe = () => (monitor as unknown as { _getTimestamp: () => number })._getTimestamp()

    expect(probe()).toBeGreaterThan(1e11) // Date.now 量级，说明已降级
    expect(probes).toBe(1)
    probe()
    expect(probes).toBe(1)
  })

  it('#136 getPerformance 自身抛错同样降级，不留下坏缓存', () => {
    setWx({
      getPerformance: () => {
        throw new Error('not supported')
      },
    })
    const monitor = new PerformanceMonitor()
    const ts = (monitor as unknown as { _getTimestamp: () => number })._getTimestamp()
    expect(Number.isFinite(ts)).toBe(true)
  })

  it('#136 now() 读数非有限值时撤下缓存并按 Date.now 继续计时', () => {
    let calls = 0
    setWx({
      getPerformance: () => ({
        now: () => {
          calls += 1
          return calls === 1 ? Number.NaN : 5000
        },
      }),
    })
    const monitor = new PerformanceMonitor()
    const probe = () => (monitor as unknown as { _getTimestamp: () => number })._getTimestamp()

    expect(probe()).toBeGreaterThan(1e11)
    // 坏实例已被撤下：后续调用不再触达 now()
    probe()
    expect(calls).toBe(1)
  })

  it('#133 超阈值预警收到的是入缓冲的同一份副本（含 memoryUsage）', () => {
    // Node 的 performance 无 memory 扩展，需挂一个 Chrome 系形状才能走到副本分支
    const descriptor = Object.getOwnPropertyDescriptor(performance, 'memory')
    Object.defineProperty(performance, 'memory', { value: { usedJSHeapSize: 123 }, configurable: true, writable: true })
    try {
      const logger = jest.fn()
      const monitor = new PerformanceMonitor({ threshold: 1, logger, trackMemory: true, sampleRate: 1 })
      const input = { operation: 'op', type: 'dispatch' as const, duration: 50, timestamp: Date.now(), exceedThreshold: true }
      monitor.record(input)

      const logged = logger.mock.calls[0][0] as Record<string, unknown>
      const buffered = (monitor as unknown as { metrics: Record<string, unknown>[] }).metrics[0]
      expect(logged).toBe(buffered)
      expect(logged).not.toBe(input)
      expect(logged.memoryUsage).toBe(123)
      // 副作用不得泄漏回调用方的入参对象
      expect(input).not.toHaveProperty('memoryUsage')
    } finally {
      if (descriptor) {
        Object.defineProperty(performance, 'memory', descriptor)
      } else {
        delete (performance as unknown as { memory?: unknown }).memory
      }
    }
  })
})

describe('ActionManager 上下文与收尾（#139 / #141）', () => {
  const createContextManager = (notifyListeners: () => void) => {
    const hooks = { emit: jest.fn(), on: jest.fn(() => () => {}), clear: jest.fn(), size: jest.fn(() => 0) }
    const manager = new ActionManager({
      storeName: 's',
      withInternalAccess: <T>(fn: () => T): T => fn(),
      setDispatching: () => {},
      notifyListeners,
      hooks: hooks as never,
    })
    return { manager, hooks }
  }

  it('#139 symbol 键透传给上下文目标，不再被短路成 undefined', () => {
    const { manager } = createContextManager(() => {})
    const tag = Symbol('tag')
    const contextBase = { [tag]: 'from-target' } as Record<string, unknown>
    let observed: unknown = 'not-called'
    manager.initialize(
      {
        read: function (this: Record<string | symbol, unknown>) {
          observed = this[tag]
        },
      } as never,
      contextBase as never,
    )

    manager.execute('read')
    expect(observed).toBe('from-target')
  })

  it('#141 收尾链路抛错经 onError 归口，不产生 unhandledRejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    const { manager, hooks } = createContextManager(() => {
      throw new Error('notify boom')
    })
    manager.initialize({ op: async () => 1 } as never, {} as never)

    await expect(manager.execute('op')).resolves.toBe(1)
    // 让派生 promise 的 catch 与进程级 unhandledRejection 事件都有机会落地
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off('unhandledRejection', onUnhandled)

    expect(unhandled).toHaveLength(0)
    expect(hooks.emit).toHaveBeenCalledWith('onError', expect.any(Error))
    expect((hooks.emit.mock.calls.find((c) => c[0] === 'onError')[1] as Error).message).toBe('notify boom')
  })

  it('#141 onError 钩子自身抛错时退到 console.error，不向上抛', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const hooks = {
      emit: (name: string) => {
        if (name === 'onError') throw new Error('hook boom')
      },
      on: jest.fn(() => () => {}),
      clear: jest.fn(),
      size: jest.fn(() => 0),
    }
    const manager = new ActionManager({
      storeName: 's',
      withInternalAccess: <T>(fn: () => T): T => fn(),
      setDispatching: () => {},
      notifyListeners: () => {
        throw new Error('notify boom')
      },
      hooks: hooks as never,
    })
    manager.initialize({ op: async () => 1 } as never, {} as never)

    await manager.execute('op')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('监听器异常上报（#148）', () => {
  it('#148 订阅者抛错交给注入的上报通道，且不影响其余监听器', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const reported: unknown[] = []
    const manager = new SubscriptionManager<{ x: number }>({
      storeName: 's',
      onListenerError: (error) => reported.push(error),
    })
    manager.add(() => {
      throw new Error('listener boom')
    })
    const healthy = jest.fn()
    manager.add(healthy)

    expect(() => manager.notify({ x: 1 })).not.toThrow()
    expect(healthy).toHaveBeenCalledTimes(1)
    expect(reported).toHaveLength(1)
    expect((reported[0] as Error).message).toBe('listener boom')
    errorSpy.mockRestore()
  })

  it('#148 上报通道自身抛错被兜住，不反噬通知流程', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const manager = new SubscriptionManager<{ x: number }>({
      storeName: 's',
      onListenerError: () => {
        throw new Error('reporter boom')
      },
    })
    manager.add(() => {
      throw new Error('listener boom')
    })

    expect(() => manager.notify({ x: 1 })).not.toThrow()
    errorSpy.mockRestore()
  })

  it('#148 Store 侧接线：监听器异常经 hooks 的 onError 浮出（生产控制台仍静默）', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const store = createStore({ name: 'wire', state: { x: 1 } })
    const onError = jest.fn()
    store.hooks.on('onError', onError)
    store.subscribe(() => {
      throw new Error('listener boom')
    })

    store.$patch({ x: 2 })

    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0][0] as Error).message).toBe('listener boom')
    // 开发期同时保留控制台定位信息
    expect(errorSpy).toHaveBeenCalledWith('[GeomStore] Error in state listener:', expect.any(Error))
    store.destroy()
    errorSpy.mockRestore()
  })
})

describe('状态保护代理（#158 / #159）', () => {
  const protection: InternalStateProtectionConfig = { enabled: true, deep: true, productionHandler: 'warn' }

  const createManager = () => {
    let internal = false
    return {
      manager: new StateProxyManager({ protection, proxyCache: createProxyCache(), isInternalAccess: () => internal }),
      setInternal: (v: boolean) => {
        internal = v
      },
    }
  }

  it('#158 访问器描述符的报错不再显示 Value: undefined', () => {
    const { manager } = createManager()
    const proxy = manager.createStateProxy({ a: 1 }, '')

    expect(() =>
      Reflect.defineProperty(proxy, 'a', {
        get() {
          return 1
        },
        configurable: true,
      }),
    ).toThrow(/\[accessor descriptor: get=true, set=false\]/)
  })

  it('#158 数据描述符仍按原值呈现', () => {
    const { manager } = createManager()
    const proxy = manager.createStateProxy({ a: 1 }, '')

    expect(() => Reflect.defineProperty(proxy, 'a', { value: 42, configurable: true })).toThrow(/Attempted value: 42/)
  })

  it('#159 嵌套数组走数组代理：索引路径与变异方法拦截口径与顶层一致', () => {
    const { manager } = createManager()
    const proxy = manager.createStateProxy({ matrix: [[1, 2]] }, '') as { matrix: unknown[][] }

    let setPath = ''
    try {
      const row = proxy.matrix[0] as unknown as number[]
      row[0] = 9
    } catch (error) {
      setPath = (error as Error).message
    }
    expect(setPath).toContain('matrix[0][0]')
    expect(setPath).not.toContain('matrix.0')

    let pushMessage = ''
    try {
      const row = proxy.matrix[0] as unknown as number[]
      row.push(3)
    } catch (error) {
      pushMessage = (error as Error).message
    }
    expect(pushMessage).toContain('Operation: push')
    expect(pushMessage).toContain('"matrix[0]"')
  })

  it('#159 嵌套数组仍保持可读与非变异方法可用', () => {
    const { manager } = createManager()
    const proxy = manager.createStateProxy({ matrix: [[1, 2], [3]] }, '') as { matrix: number[][] }

    expect(proxy.matrix[0][1]).toBe(2)
    expect(proxy.matrix[0].filter((v) => v > 1)).toEqual([2])
    expect(Array.isArray(proxy.matrix[0])).toBe(true)
    // 缓存按对象身份：同一次读取返回同一代理
    expect(proxy.matrix[0]).toBe(proxy.matrix[0])
  })
})

describe('错误类体系（#104 / #103）', () => {
  it('#104 派生类的名称/原型链由基类统一处理', () => {
    const action = new ActionError('boom', 'ACTION_EXECUTION_ERROR', { actionName: 'op' })
    expect(action.name).toBe('ActionError')
    expect(action).toBeInstanceOf(ActionError)
    expect(action).toBeInstanceOf(GeomStoreError)
    expect(Object.getPrototypeOf(action)).toBe(ActionError.prototype)
    expect(action.toJSON()).toMatchObject({ name: 'ActionError', message: 'boom' })
  })

  it('#104 外部再继承一层不会被基类原型复位打回', () => {
    class MyError extends GeomStoreError {}
    const mine = new MyError('boom', 'UNKNOWN_ERROR')
    expect(mine).toBeInstanceOf(MyError)
    expect(mine.name).toBe('GeomStoreError')
  })
})

describe('性能子路径出口（#150）', () => {
  it('#150 @/core/performance 的缓存聚合出口恢复，且与定义同源', () => {
    expect(PerfBarrelLRUCache).toBe(LRUCache)
  })
})
