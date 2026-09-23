/**
 * 第五轮 ocr 复审（medium 波次）的回归用例
 *
 * 每条用例对应一处本轮修复的行为变更，命名标注 finding 编号便于回溯。
 */

import { StoreRegistry } from '@/core/compose/StoreRegistry.js'
import { composeStore } from '@/core/compose/composeStore.js'
import { mergeStateMaps } from '@/core/compose/merge.js'
import { findTargetStoreWithKey } from '@/core/compose/helpers.js'
import { usePlugin } from '@/core/hooks/index.js'
import { GeomStoreError } from '@/core/errors/GeomStoreError.js'
import { AsyncBatchNotifier } from '@/core/performance/AsyncBatchNotifier.js'
import { MetricsCollector, PerformanceAnalyzer, computePerformanceStats } from '@/core/performance/metrics.js'
import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor.js'
import { ActionManager, GetterManager } from '@/core/store/ActionManager.js'
import { StoreCacheManager } from '@/core/store/StoreCache.js'
import { SubscriptionManager } from '@/core/store/SubscriptionManager.js'
import { getStateVersion } from '@/core/store/stateVersion.js'
import { LRUCache } from '@/core/cache/LRUCache.js'
import { createPluginUninstaller } from '@/core/store/pluginSupport.js'
import { StateProxyManager, createProxyCache } from '@/core/store/StateProxy.js'
import { createStore } from '@/core/store/factory.js'
import { deepCloneState } from '@/core/utils/clone.js'
import { deepEqual } from '@/core/utils/equality.js'
import { shallowEqual, clone, deepMerge } from '@/core/utils/helpers.js'
import { createDirtyTrackingProxy, createDirtyTrackingCache } from '@/core/store/dirtyTracking.js'
import type { Store as StoreInterface, State } from '@/types/store.js'

/** 只实现注册表用到的成员的假 store */
function fakeStore(name: string, state: Record<string, unknown>, extra: Partial<StoreInterface> = {}): StoreInterface {
  const store: Record<string, unknown> = {
    name,
    destroyed: false,
    getState: () => state,
    $replaceState: jest.fn(),
    destroy: jest.fn(() => {
      store.destroyed = true
    }),
  }
  return Object.assign(store, extra) as unknown as StoreInterface
}

describe('StoreRegistry', () => {
  it('#87 clear 快照后销毁：destroy 内重入 unregister 不会二次销毁或漏销毁', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const registry = new StoreRegistry()
    const a = fakeStore('a', { x: 1 })
    const b = fakeStore('b', { x: 2 })
    registry.register('a', a)
    registry.register('b', b)

    let reentered = false
    ;(a as unknown as { destroy: () => void }).destroy = () => {
      if (!reentered) {
        reentered = true
        registry.unregister('b')
      }
    }

    registry.clear()

    expect(b.destroy).toHaveBeenCalledTimes(1)
    expect(registry.size()).toBe(0)
    warnSpy.mockRestore()
  })

  it('#87 clear 跳过已在外部销毁的 store', () => {
    const registry = new StoreRegistry()
    const store = fakeStore('a', { x: 1 })
    registry.register('a', store)
    const destroyMock = store.destroy as unknown as jest.Mock
    store.destroy()
    const callsAfterExternalDestroy = destroyMock.mock.calls.length

    registry.clear()

    // 直接数原始 mock 的调用次数：对 jest.fn 再 spyOn 不会重置其历史记录，
    // 断言「 spy 未被调用」会把外部那次销毁也算进来
    expect(destroyMock.mock.calls.length).toBe(callsAfterExternalDestroy)
  })

  it('#88 registerAll 校验失败时不修改注册表', () => {
    const registry = new StoreRegistry()
    const first = fakeStore('first', {})

    expect(() => registry.registerAll({ first, second: null as unknown as StoreInterface })).toThrow('[StoreRegistry] Invalid store object')
    expect(registry.size()).toBe(0)
    expect(registry.has('first')).toBe(false)
  })

  it("#89 createSnapshot 以自有属性承载 '__proto__' 名称的 store", () => {
    const registry = new StoreRegistry()
    registry.register('__proto__', fakeStore('__proto__', { n: 1 }))

    const snapshot = registry.createSnapshot()

    expect(Object.prototype.hasOwnProperty.call(snapshot, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(snapshot)).toBe(Object.prototype)
    expect((snapshot as Record<string, unknown>)['__proto__']).toEqual({ n: 1 })
  })

  it('#90 restoreSnapshot 报告未被快照覆盖的注册 store', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const registry = new StoreRegistry()
    const covered = fakeStore('covered', { n: 1 })
    const missing = fakeStore('missing', { n: 1 })
    registry.register('covered', covered)
    registry.register('missing', missing)

    registry.restoreSnapshot({ covered: { n: 9 } })

    expect(covered.$replaceState).toHaveBeenCalledWith({ n: 9 })
    expect(missing.$replaceState).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing'))
    warnSpy.mockRestore()
  })
})

describe('compose helpers / merge', () => {
  it('#112 三 store 同名键的告警反映真实的上一任写入者', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const stores = [fakeStore('A', { k: 1 }), fakeStore('B', { k: 2 }), fakeStore('C', { k: 3 })]

    mergeStateMaps(stores, (s) => s.getState() as Record<string, unknown>, new Set<string>())

    const messages = warnSpy.mock.calls.map((c) => String(c[0]))
    expect(messages.some((m) => m.includes('(A, B)'))).toBe(true)
    expect(messages.some((m) => m.includes('(B, C)'))).toBe(true)
    expect(messages.some((m) => m.includes('(A, C)'))).toBe(false)
    warnSpy.mockRestore()
  })

  it("#113 合并结果保留 '__proto__' 自有键而不改写出对象原型", () => {
    const source = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    const merged = mergeStateMaps([fakeStore('a', source)], () => source, new Set<string>())

    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    expect((merged as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('#109 歧义键保持「告警 + 取第一个」语义', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const first = fakeStore('first', { shared: 1 })
    const second = fakeStore('second', { shared: 2 })

    expect(() => findTargetStoreWithKey('shared', [first, second], false)).not.toThrow()
    expect(findTargetStoreWithKey('shared', [first, second], false)[0]).toBe(first)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Ambiguous key'))
    warnSpy.mockRestore()
  })
})

describe('HookSystem.usePlugin', () => {
  it('#98 插件对象形状非法时兜底分支不再抛第二个 TypeError', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation()
    const store = createStore({ state: { count: 0 } })
    const broken = null as unknown as Parameters<typeof usePlugin>[0]

    let uninstall: (() => void) | undefined
    expect(() => {
      uninstall = usePlugin(broken, store)
    }).not.toThrow()

    expect(() => uninstall!()).not.toThrow()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to install plugin "unknown"'), expect.anything())
    errorSpy.mockRestore()
  })
})

describe('GeomStoreError', () => {
  it('#101 非字符串的 context 值不参与友好消息拼接', () => {
    expect(new GeomStoreError('失败', 'STATE_UPDATE_ERROR', { storeName: { name: 'x' }, operation: 0 }).getFriendlyMessage()).toBe('失败')
    expect(new GeomStoreError('失败', 'STATE_UPDATE_ERROR', { storeName: 'user' }).getFriendlyMessage()).toBe("失败 in store 'user'")
  })
})

describe('AsyncBatchNotifier', () => {
  it('#119 flush 期间新增的监听器不参与本批次投递', async () => {
    const notifier = new AsyncBatchNotifier<number>()
    const late = jest.fn()
    const early = jest.fn(() => {
      notifier.subscribe(late)
    })

    notifier.subscribe(early)
    notifier.notify(1)
    await Promise.resolve()

    expect(early).toHaveBeenCalledWith(1)
    expect(late).not.toHaveBeenCalled()
  })

  it('#118 clear 之后的 notify 仍会在微任务中送达', async () => {
    const notifier = new AsyncBatchNotifier<number>()
    notifier.notify(1)
    notifier.clear()
    const listener = jest.fn()
    notifier.subscribe(listener)

    notifier.notify(2)
    await Promise.resolve()

    expect(listener).toHaveBeenCalledWith(2)
  })
})

describe('performance metrics', () => {
  it("#123 操作名为 '__proto__' 时统计不再污染 Object.prototype", () => {
    const stats = computePerformanceStats([
      { operation: '__proto__', type: 'dispatch', duration: 10, timestamp: 0, exceedThreshold: false },
      { operation: '__proto__', type: 'dispatch', duration: 20, timestamp: 0, exceedThreshold: false },
    ])

    expect((Object.prototype as unknown as Record<string, unknown>).count).toBeUndefined()
    expect(stats.byOperation['__proto__']).toEqual({ count: 2, avgDuration: 15, maxDuration: 20 })
  })

  it('#123 analyzeBottlenecks / getHotPaths 同样承载任意操作名', () => {
    const metrics = [{ operation: '__proto__', type: 'dispatch', duration: 100, timestamp: 0, exceedThreshold: true }] as never
    const collector = new MetricsCollector(10)
    collector.collectBatch(metrics)

    expect(() => PerformanceAnalyzer.analyzeBottlenecks(metrics, 10)).not.toThrow()
    expect(PerformanceAnalyzer.analyzeBottlenecks(metrics, 10)[0].operation).toBe('__proto__')
    expect(collector.getHotPaths(1)[0].operation).toBe('__proto__')
    expect(() => PerformanceAnalyzer.detectRegression(metrics, metrics)).not.toThrow()
  })

  it('#124 环形缓冲在满员后仍保持容量与「淘汰最旧」顺序', () => {
    const collector = new MetricsCollector(3)
    for (let i = 0; i < 10; i++) {
      collector.collect({ operation: `op${i}`, type: 'dispatch', duration: i, timestamp: i, exceedThreshold: false })
    }

    expect(collector.count()).toBe(3)
    expect(collector.getAll().map((m) => m.operation)).toEqual(['op7', 'op8', 'op9'])
    expect(collector.getPercentile(50)).toBe(8)
    expect(collector.calculateStats().avgDuration).toBeCloseTo(8, 5)
    expect(collector.filterByOperation('op7').count()).toBe(1)

    collector.clear()
    expect(collector.count()).toBe(0)
    expect(collector.getAll()).toEqual([])
  })

  it('#125 0 基线退化按 Infinity 上报且两条 Infinity 排序稳定', () => {
    const baseline = [
      { operation: 'noop', type: 'dispatch', duration: 0, timestamp: 0, exceedThreshold: false },
      { operation: 'other', type: 'dispatch', duration: 0, timestamp: 0, exceedThreshold: false },
    ] as never
    const current = [
      { operation: 'noop', type: 'dispatch', duration: 5, timestamp: 0, exceedThreshold: false },
      { operation: 'other', type: 'dispatch', duration: 3, timestamp: 0, exceedThreshold: false },
    ] as never

    const regressions = PerformanceAnalyzer.detectRegression(current, baseline, 0.2)

    // 两条同为 Infinity：相减得 NaN，比较器需按相等处理才不会给出未定义顺序
    expect(regressions.map((r) => r.operation)).toEqual(['noop', 'other'])
    expect(regressions.every((r) => r.changePercent === Infinity)).toBe(true)
  })
})

describe('PerformanceMonitor', () => {
  it('#131 getRecentMetrics 对 (0,1) 小数返回空数组而非全部', () => {
    const monitor = new PerformanceMonitor()
    for (let i = 0; i < 3; i++) {
      monitor.record({ operation: `op${i}`, type: 'dispatch', duration: 1, timestamp: 0, exceedThreshold: false })
    }

    expect(monitor.getRecentMetrics(0.5)).toEqual([])
    expect(monitor.getRecentMetrics(1.9)).toHaveLength(1)
  })

  it('#132 超阈值预警不受采样影响，未受采样的指标仍不落缓冲', () => {
    const logger = jest.fn()
    const monitor = new PerformanceMonitor({ sampleRate: 0, threshold: 10, logger })

    monitor.record({ operation: 'slow', type: 'dispatch', duration: 100, timestamp: 0, exceedThreshold: true })

    expect(logger).toHaveBeenCalledTimes(1)
    expect(monitor.getMetrics()).toHaveLength(0)
  })

  it('#132 sampleRate/threshold 的非有限值与越界值被规范化', () => {
    const monitor = new PerformanceMonitor({ sampleRate: Number.NaN, threshold: Number.NaN })
    const opts = (monitor as unknown as { options: { sampleRate: number; threshold: number } }).options
    expect(opts.sampleRate).toBe(1)
    expect(opts.threshold).toBe(16)

    monitor.setOptions({ sampleRate: 5, threshold: -3 })
    expect(opts.sampleRate).toBe(1)
    expect(opts.threshold).toBe(0)
  })

  it('#134 读取接口返回元素副本，改写不影响内部指标', () => {
    const monitor = new PerformanceMonitor()
    monitor.record({ operation: 'op', type: 'dispatch', duration: 5, timestamp: 0, exceedThreshold: false })

    monitor.getMetrics()[0].duration = 999
    monitor.getMetricsByType('dispatch')[0].duration = 999
    monitor.getMetricsByOperation('op')[0].duration = 999
    monitor.getRecentMetrics(1)[0].duration = 999

    expect(monitor.getMetrics()[0].duration).toBe(5)
    expect(monitor.getStats().avgDuration).toBe(5)
  })
})

describe('ActionManager', () => {
  const makeManager = (hooks: { emit: jest.Mock }, actions: Record<string, (...args: unknown[]) => unknown>) => {
    const setDispatching = jest.fn()
    const notifyListeners = jest.fn()
    const manager = new ActionManager({
      storeName: 'test',
      withInternalAccess: <T>(fn: () => T): T => fn(),
      setDispatching,
      notifyListeners,
      hooks: hooks as never,
    })
    manager.initialize(actions, {} as never)
    return { manager, setDispatching, notifyListeners }
  }

  it('#137 beforeDispatch 钩子抛错不会让 dispatching 永久卡死', () => {
    const hooks = {
      emit: jest.fn((name: string) => {
        if (name === 'beforeDispatch') throw new Error('hook boom')
      }),
    }
    const { manager, setDispatching } = makeManager(hooks, { run: jest.fn() })

    expect(() => manager.execute('run')).toThrow(/execution failed/)
    expect(manager.dispatchDepth).toBe(0)
    expect(setDispatching).toHaveBeenLastCalledWith(false)
  })

  it('#138 action 已返回后收尾步骤抛错，不再二次复位 dispatch 计数', () => {
    const hooks = {
      emit: jest.fn((name: string) => {
        if (name === 'afterDispatch') throw new Error('after boom')
      }),
    }
    const { manager, setDispatching } = makeManager(hooks, { run: jest.fn() })

    expect(() => manager.execute('run')).toThrow('after boom')
    expect(manager.dispatchDepth).toBe(0)
    expect(setDispatching.mock.calls.map((c) => c[0])).toEqual([true, false])
  })

  it('#140 跨 realm / 自定义 thenable 走异步补发路径', async () => {
    const hooks = { emit: jest.fn() }
    const notifyListeners = jest.fn()
    let resolveOuter: () => void = () => {}
    const thenable = {
      then(onFulfilled: () => void) {
        resolveOuter = onFulfilled
      },
    }
    const manager = new ActionManager({
      storeName: 'test',
      withInternalAccess: <T>(fn: () => T): T => fn(),
      setDispatching: () => {},
      notifyListeners,
      hooks: hooks as never,
    })
    manager.initialize({ later: () => thenable }, {} as never)

    expect(manager.execute('later')).toBe(thenable)
    expect(notifyListeners).not.toHaveBeenCalled()

    resolveOuter()
    await Promise.resolve()
    expect(notifyListeners).toHaveBeenCalledTimes(1)
  })

  it('#143 初始化前访问 getters 返回空对象而非 null', () => {
    const getters = new GetterManager('test', () => ({}))
    expect(getters.getters).toEqual({})
    expect(() => Object.keys(getters.getters)).not.toThrow()
  })
})

describe('composeStore 订阅', () => {
  it('#145 可写监听器拿到深拷贝载荷，改它不再污染子 store', async () => {
    const child = createStore({ name: 'child', state: { nested: { n: 1 } } })
    const composed = composeStore([child as unknown as StoreInterface])

    const writable = jest.fn((state: { nested?: { n: number } }) => {
      state.nested!.n = 99
    })
    composed.subscribe(writable)

    child.setState('nested' as never, { n: 5 } as never)
    await Promise.resolve()

    expect(writable).toHaveBeenCalled()
    expect(child.getState().nested).toEqual({ n: 5 })
  })

  it('#145 只读监听器仍共享合并状态（零拷贝快路径）', async () => {
    const child = createStore({ name: 'ro', state: { nested: { n: 1 } } })
    const composed = composeStore([child as unknown as StoreInterface])
    const seen: unknown[] = []
    composed.subscribe((state: unknown) => seen.push(state), { readOnly: true })

    child.setState('nested' as never, { n: 5 } as never)
    await Promise.resolve()
    child.setState('nested' as never, { n: 6 } as never)
    await Promise.resolve()

    expect(seen.length).toBe(2)
    expect(seen[0]).not.toBe(seen[1])
  })
})

describe('StoreCache', () => {
  const makeCache = (ttl: number) => {
    const cache = new LRUCache<string, number>({ capacity: 10 })
    return { cache, manager: new StoreCacheManager<Record<string, number>>({ cache, ttl }) }
  }

  it('#151 缺失时间戳的条目按已过期处理并回读状态源', () => {
    const { cache, manager } = makeCache(1000)
    manager.enable(['k'], () => 1)
    ;(manager as unknown as { _timestamps: Map<string, number> })._timestamps.delete('k')
    cache.set('k', 999)

    expect(manager.get('k', () => 2)).toBe(2)
  })

  it('#153 cacheKeys 为空数组时告警并保持「不缓存任何键」语义', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const { cache, manager } = makeCache(0)
    const getState = jest.fn(() => 1)

    manager.enable([], getState)

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('空数组'))
    expect(manager.get('k', getState)).toBe(1)
    expect(cache.size()).toBe(0)
    warnSpy.mockRestore()
  })
})

describe('StateProxy 写陷阱', () => {
  it('#157 目标不可写时如实返回 false，不再谎报成功', () => {
    const manager = new StateProxyManager({
      protection: { enabled: true, deep: true, productionHandler: 'warn' },
      proxyCache: createProxyCache(),
      isInternalAccess: () => true,
    })
    const frozen = Object.freeze({ a: 1 }) as Record<string, unknown>
    const proxy = manager.createStateProxy(frozen, '')

    expect(Reflect.set(proxy, 'a', 2)).toBe(false)
    expect(frozen.a).toBe(1)
  })
})

describe('pluginSupport', () => {
  it('#160 缺少代际令牌时卸载句柄不动任何东西', () => {
    const plugin = { name: 'p' } as never
    const plugins = [plugin]
    const uninstallFns = new Map([[plugin, jest.fn()]])
    const installations = new Map()
    const handle = createPluginUninstaller(plugin, plugins, uninstallFns, installations, undefined)

    handle()

    expect(plugins).toHaveLength(1)
    expect(uninstallFns.has(plugin)).toBe(true)
  })
})

describe('createStore 入参', () => {
  it('#168 null / 非对象配置快速失败', () => {
    expect(() => createStore(null as unknown as { state: State })).toThrow('[GeomStore] createStore: options must be a valid object')
    expect(() => createStore(undefined as unknown as { state: State })).toThrow('[GeomStore] createStore: options must be a valid object')
  })
})

describe('克隆与比较', () => {
  it('#170 克隆保留 null 原型', () => {
    const source = Object.create(null) as Record<string, unknown>
    source.a = 1
    const cloned = deepCloneState(source)

    expect(Object.getPrototypeOf(cloned)).toBeNull()
    expect(cloned.a).toBe(1)
  })

  it("#212 克隆把自有 '__proto__' 键保留为自有属性", () => {
    const source = JSON.parse('{"__proto__":{"injected":true},"ok":1}') as Record<string, unknown>
    const cloned = deepCloneState(source)

    expect(Object.getPrototypeOf(cloned)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(cloned, '__proto__')).toBe(true)
    expect(cloned.injected).toBeUndefined()

    const merged = deepMerge({} as Record<string, unknown>, { patch: cloned } as never)
    expect((merged.patch as Record<string, unknown>).injected).toBeUndefined()
  })

  it('#211 json 模式下顶层 Date 与嵌套处口径一致', () => {
    expect(clone(new Date(0), { mode: 'json' })).toBe('1970-01-01T00:00:00.000Z')
    expect(clone({ d: new Date(0) }, { mode: 'json' })).toEqual({ d: '1970-01-01T00:00:00.000Z' })
    expect(clone({ r: /a/g }, { mode: 'json' })).toEqual({ r: {} })
    expect(clone(new Date(0), { mode: 'shallow' })).toBeInstanceOf(Date)
    expect(clone(new Date(0), { mode: 'deep' })).toBeInstanceOf(Date)
  })

  it('#189 稀疏数组不因键集为空而误判相等', () => {
    expect(deepEqual(new Array(3), [])).toBe(false)
    expect(deepEqual(new Array(5), new Array(2))).toBe(false)
    // delete 才造得出真正的空洞（字面量 `[1, , 3]` 会触发 no-sparse-arrays 且可读性差）
    const holey = [1, undefined, 3]
    delete holey[1]
    expect(deepEqual([1, undefined, 3], holey)).toBe(false)
    expect(deepEqual([1, 2], [1, 2])).toBe(true)
  })

  it('#190 原型不同的对象不再判为相等', () => {
    class Foo {
      a = 1
    }
    expect(deepEqual(new Foo(), { a: 1 })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true)
    const nullProto = Object.create(null) as Record<string, unknown>
    nullProto.a = 1
    expect(deepEqual(nullProto, { a: 1 })).toBe(false)
  })

  it('#209/#210 浅比较按结构判别类别，数组/对象与不透明实例不再误判相等', () => {
    expect(shallowEqual([], {})).toBe(false)
    expect(shallowEqual([1], { 0: 1 })).toBe(false)
    expect(shallowEqual(new Error('a'), new Error('b'))).toBe(false)
    expect(shallowEqual(new Map(), new Set())).toBe(false)
    expect(shallowEqual(new Array(2), [])).toBe(false)
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true)
    expect(shallowEqual([1, 2], [1, 2])).toBe(true)
  })
})

describe('Store 状态替换与销毁', () => {
  it('#186 被 $replaceState 删掉的顶层键也标记为脏', () => {
    const store = createStore<{ kept: number; removed?: number }>({ name: 's186', state: { kept: 1, removed: 2 } })
    const dirtyDuringNotify: boolean[] = []
    // 脏键的口径是「自上次通知以来」：同步通知收尾即作废，必须在订阅者内观测
    const unsubscribe = store.subscribe(() => {
      dirtyDuringNotify.push(store.isStateKeyDirty('removed'))
    })

    store.$replaceState({ kept: 9 })
    unsubscribe()

    // 消失型变更同样要标脏，否则集成层会对已删除的键跳过 setData
    expect(dirtyDuringNotify).toEqual([true])
  })

  it('#183 destroy 重建状态保护管理器，旧的 Proxy 缓存不再被使用', () => {
    const store = createStore({ name: 's183', state: { nested: { n: 1 } } })
    const manager = (store as unknown as { _stateProxyManager: object })._stateProxyManager
    const cacheOnManager = (manager as unknown as { _proxyCache: object })._proxyCache

    store.destroy()

    expect((store as unknown as { _stateProxyManager: object })._stateProxyManager).not.toBe(manager)
    expect((store as unknown as { _proxyCache: object })._proxyCache).not.toBe(cacheOnManager)
    expect((store as unknown as { _stateProxyManager: { _proxyCache: object } })._stateProxyManager._proxyCache).toBe(
      (store as unknown as { _proxyCache: object })._proxyCache,
    )
  })

  it('#179 索引解析不出归属的对象变更时保守标记全部顶层键', () => {
    const root: Record<string | symbol, unknown> = { a: 1, b: 2 }
    const holder = { child: { n: 0 } }
    // 经访问器取出的对象不在 rebuildOwners 的索引范围内（描述符非数据属性）
    Object.defineProperty(root, 'lazy', {
      get() {
        return holder
      },
      enumerable: true,
    })
    const mutated: Array<string | symbol>[] = []
    const proxy = createDirtyTrackingProxy(root, createDirtyTrackingCache(), (keys) => mutated.push([...keys])) as Record<string, unknown>

    ;(proxy.lazy as { child: { n: number } }).child.n = 5

    expect(mutated.length).toBeGreaterThan(0)
    expect(mutated[mutated.length - 1].sort()).toEqual(['a', 'b', 'lazy'])
  })
})

describe('缓存统计键列表', () => {
  it('#82 非字符串键被字符串化，需以 keys() 取回原始键', () => {
    const cache = new LRUCache<string | number | symbol, number>({ capacity: 5 })
    cache.set(1, 1)
    cache.set('1', 2)
    cache.set('原始', 3)

    // keys 是「最近使用优先」的字符串化视图：数字 1 与字符串 '1' 在此不可区分
    expect(cache.getStats().keys).toEqual(['原始', '1', '1'])
    expect(cache.keys()).toEqual(['原始', '1', 1])
  })

  it('#115 onEvict 回填被逐出的键不会递归淘汰直到栈溢出', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation()
    const cache = new LRUCache<number, number>({
      capacity: 1,
      onEvict: (key, value) => {
        cache.set(key, value)
      },
    })

    const writes = 200
    for (let i = 0; i < writes; i++) {
      cache.set(i, i)
    }

    // 决定性判据是「没有被淘汰回调里的异常」：没有重入保护时，回调内的 set() 会再开一层
    // 淘汰、再触发回调，一路递归到 RangeError，而该异常正好被 evictLRU 的 try 吞成
    // console.error（实测 200 次写入 = 199 次 RangeError 告警），所以 expect().not.toThrow()
    // 这种断言证明不了收敛，必须直接盯住这条被吞掉的异常
    expect(errorSpy).not.toHaveBeenCalled()
    // 自相矛盾的回调（逐出即回填）无法同时满足容量：单帧淘汰预算有界，尺寸最多随写入线性缓增
    expect(cache.size()).toBeLessThanOrEqual(writes + 1)
    expect(cache.getStats().evictions).toBeGreaterThan(0)
    errorSpy.mockRestore()
  })
})

describe('计时配对与通知隔离', () => {
  it('#135 计时条目缺失时降级为可观测日志，而非无声丢弃这次测量', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation()
    const monitor = new PerformanceMonitor()
    const end = monitor.start('slowOp')

    // 模拟 pruneStaleOperations() 抢先摘除条目（end() 再也取不到起始时间）
    ;(monitor as unknown as { currentOperations: Map<string, unknown> }).currentOperations.clear()
    end()

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('slowOp'))
    expect(monitor.getMetrics()).toHaveLength(0)
    debugSpy.mockRestore()
  })

  it('#147 cloneOnNotify=false 与可写订阅者共存时给出契约违规告警', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const manager = new SubscriptionManager<State>({ storeName: 's147' })
    manager.add(() => {})

    manager.notify({ a: 1 }, false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cloneOnNotify=false'))

    // 纯只读订阅走零拷贝是设计内的快路径，不应告警
    const readOnly = new SubscriptionManager<State>({ storeName: 's147' })
    readOnly.add(() => {}, { readOnly: true })
    warnSpy.mockClear()
    readOnly.notify({ a: 1 }, false)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('#174 版本号读取抛错或非有限值时回退 undefined 而不是外溢', () => {
    const STATE_VERSION = Symbol.for('geomstore.stateVersion')
    const throwing = {} as Record<symbol, unknown>
    Object.defineProperty(throwing, STATE_VERSION, {
      get() {
        throw new Error('accessor boom')
      },
    })
    expect(() => getStateVersion(throwing)).not.toThrow()
    expect(getStateVersion(throwing)).toBeUndefined()

    // NaN 也满足 typeof === 'number'，但 NaN !== NaN 会让「版本未变」永远判假
    const notANumber = {} as Record<symbol, unknown>
    Object.defineProperty(notANumber, STATE_VERSION, { get: () => Number.NaN })
    expect(getStateVersion(notANumber)).toBeUndefined()
    expect(getStateVersion({ [STATE_VERSION]: 3 })).toBe(3)
  })
})
