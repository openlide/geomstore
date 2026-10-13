/**
 * 代码审查修复回归（review-fixes）
 *
 * 覆盖本轮审查中定位并修复的缺陷，每条用例都锁定「修复前会失败、修复后通过」的行为：
 * - withCache：观测标记按缓存条目记录（不串键/不串宿主）；ttl NaN 归一化
 * - withThrottle / withDebounce：排程延迟钳到 setTimeout 上限
 * - ActionLoader：getAllLoading 的 __proto__ 键；setOptions 的键变更检测
 * - timeTravelPlugin：回放通知回调内重入 goTo 被忽略（索引与状态不错位）
 * - MetricsCollector.sortByDuration：非有限耗时过滤
 * - ErrorRecovery：retryDelay NaN 归一 + 周期窗不锁死 + 退避延迟钳位
 * - ErrorMonitoring：batchInterval/batchThreshold/reportTimeout 的 NaN 归一（0 语义保留）
 * - ErrorAggregator：带过去时间戳的新建组不会被同一次 addError 立刻驱逐
 * - OfflineManager：存储读取失败后拒绝覆写磁盘队列（at-least-once）
 * - PerformanceMonitor：环形缓冲的容量/时序语义与 metrics 兼容访问面
 * - integrations：createMapper/subscribeMappers 单订阅驱动多组映射
 *
 * 第二轮（「已定位暂未实施」5 条的最优方案落地）：
 * - ErrorHandler.isThenable：取值即抛的 then getter 按非 thenable 降级
 * - integrations/utils updateAll：单键 getValue 抛错跳过坏键、批次后原样抛出（onError 可见）
 * - HttpReporter：快路径零试用串化；坏 payload 只在慢路径逐字段降级，隔离语义不变
 * - withCache × withThrottle/withDebounce：占位品牌协议（错序叠加降级为不缓存，不错值）
 * - env.storage.getWithStatus 三态；OfflineManager 迁移后不再依赖 wx.getStorageInfoSync 探测
 */

import { createStore } from '@/index.js'
import { withCache } from '@/extras/action/decorators/cache.js'
import { withThrottle } from '@/extras/action/decorators/throttle.js'
import { withDebounce } from '@/extras/action/decorators/debounce.js'
import { ActionLoader } from '@/extras/action/ActionLoader.js'
import { timeTravelPlugin } from '@/plugins/devtools/index.js'
import { MetricsCollector } from '@/core/performance/metrics.js'
import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor.js'
import { ErrorRecovery, RecoveryStrategy, ErrorMonitoring, ErrorAggregator, ErrorHandlerImpl } from '@/extras/error/index.js'
import { isThenable } from '@/extras/error/ErrorHandler.js'
import { HttpReporter } from '@/extras/error/reporters/HttpReporter.js'
import { GeomStoreError } from '@/core/errors/GeomStoreError.js'
import { OfflineManager } from '@/integrations/enterprise/offline.js'
import { storage } from '@/integrations/enterprise/env.js'
import { createMapper, subscribeMappers, bindMappings } from '@/integrations/utils.js'
import { SelectorComposer } from '@/extras/selector/selectorComposer.js'
import { persistencePlugin } from '@/plugins/builtin.js'

/** setTimeout 上限（与源码各处的 MAX_TIMER_DELAY 同值） */
const MAX_TIMER_DELAY = 2 ** 31 - 1

/** 把 legacy 方法装饰器应用到原型上（与装饰器在类定义期的行为一致） */
type MethodDecoratorLike = (proto: object, key: string | symbol, descriptor: PropertyDescriptor) => PropertyDescriptor
function decorate(proto: object, key: string, decorator: MethodDecoratorLike): void {
  const descriptor = Object.getOwnPropertyDescriptor(proto, key)
  if (!descriptor) throw new Error(`missing descriptor for ${key}`)
  const next = decorator(proto, key, descriptor) ?? descriptor
  Object.defineProperty(proto, key, next)
}

const TIMER_CEILING = 2 ** 31 - 1

describe('withCache：Promise 语义按条目记录，ttl 归一化', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('非 async 方法观测到 thenable 后，其他键/其他宿主的同步命中不被包成 Promise', async () => {
    class Svc {
      m(k: string): unknown {
        return k === 'async' ? Promise.resolve('v') : 42
      }
    }
    decorate(Svc.prototype, 'm', withCache({ ttl: 60_000 }) as unknown as MethodDecoratorLike)
    const svc = new Svc()

    await expect(svc.m('async')).resolves.toBe('v')
    // 修复前：observesPromise 是装饰器闭包标记，首次观测后所有命中都包 Promise
    expect(svc.m('sync')).toBe(42)
    expect(svc.m('sync')).toBe(42)
    expect(new Svc().m('sync')).toBe(42)
  })

  it('同一键的值由 Promise 产出时，后续命中保持 Promise 语义', async () => {
    class Svc {
      m(k: string): unknown {
        return k === 'async' ? Promise.resolve('v') : 42
      }
    }
    decorate(Svc.prototype, 'm', withCache({ ttl: 60_000 }) as unknown as MethodDecoratorLike)
    const svc = new Svc()

    await expect(svc.m('async')).resolves.toBe('v')
    await expect(svc.m('async')).resolves.toBe('v')
  })

  it('ttl: NaN 归一为默认值：值条目可命中、在途占位可去重', async () => {
    let calls = 0
    class Svc {
      async m(): Promise<number> {
        calls++
        await Promise.resolve()
        return calls
      }
    }
    decorate(Svc.prototype, 'm', withCache({ ttl: Number.NaN }) as unknown as MethodDecoratorLike)
    const svc = new Svc()

    // 修复前：expiry = at + NaN ⇒ 占位判据与命中判据双双恒假，并发两次各跑一遍
    const results = await Promise.all([svc.m(), svc.m()])
    expect(calls).toBe(1)
    expect(results).toEqual([1, 1])
    // 结算后的值条目同样可命中
    await expect(svc.m()).resolves.toBe(1)
    expect(calls).toBe(1)
  })
})

describe('withThrottle / withDebounce：排程延迟钳到 setTimeout 上限', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it('withThrottle：interval 越界后 trailing 补发不被宿主夹成 1ms', () => {
    jest.useFakeTimers()
    const spy = jest.spyOn(global, 'setTimeout')
    try {
      class Svc {
        m(): number {
          return 1
        }
      }
      decorate(Svc.prototype, 'm', withThrottle(2 ** 31 + 5000) as unknown as MethodDecoratorLike)
      const svc = new Svc()
      svc.m() // leading 立即执行
      svc.m() // 窗口内被抑制 → 排 trailing
      const delays = spy.mock.calls.map((call) => call[1] as number)
      expect(delays.length).toBeGreaterThan(0)
      expect(Math.max(...delays)).toBe(TIMER_CEILING)
    } finally {
      spy.mockRestore()
    }
  })

  it('withDebounce：delay 越界后被钳制而非立即执行', () => {
    jest.useFakeTimers()
    const spy = jest.spyOn(global, 'setTimeout')
    try {
      class Svc {
        m(): number {
          return 1
        }
      }
      decorate(Svc.prototype, 'm', withDebounce(2 ** 31 + 5000) as unknown as MethodDecoratorLike)
      const svc = new Svc()
      void svc.m()
      const delays = spy.mock.calls.map((call) => call[1] as number)
      expect(delays.length).toBeGreaterThan(0)
      expect(Math.max(...delays)).toBe(TIMER_CEILING)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('ActionLoader：__proto__ 键与 setOptions 变更检测', () => {
  it("getAllLoading 保留 '__proto__' 键（普通对象字面量上会被原型 setter 静默吞掉）", () => {
    const loader = new ActionLoader({ loadingKey: '__proto__' })
    const internal = loader as unknown as { loadingRefCounts: Map<string, number> }
    internal.loadingRefCounts.set('__proto__', 1)

    const states = loader.getAllLoading()
    expect(Object.prototype.hasOwnProperty.call(states, '__proto__')).toBe(true)
    expect(states['__proto__']).toBe(true)
  })

  it("setOptions 用 JSON.stringify 判定键变更：'|' 分隔符撞串不再假阴性", () => {
    const loader = new ActionLoader({ loadingKey: 'a', errorKey: 'b|c' })
    const internal = loader as unknown as { stateGeneration: number }
    const before = internal.stateGeneration

    // ('a', 'b|c') → ('a|b', 'c')：'|' join 后两份串完全相同（假阴性），JSON 比较可分辨
    loader.setOptions({ loadingKey: 'a|b', errorKey: 'c' })

    expect((loader as unknown as { options: { loadingKey: string } }).options.loadingKey).toBe('a|b')
    expect(internal.stateGeneration).toBe(before + 1)
  })
})

describe('timeTravelPlugin：回放通知内的重入时间旅行被忽略', () => {
  afterEach(() => {
    try {
      delete (globalThis as unknown as { __GEOMSTORE_TIME_TRAVEL__?: unknown }).__GEOMSTORE_TIME_TRAVEL__
    } catch {
      // ignore
    }
  })

  it('订阅回调内再次 goTo 不会把 currentIndex 写回外层帧的索引', () => {
    const store = createStore({ name: 'tt-reentrant-goTo', state: { n: 0 }, actions: {} })
    const uninstall = store.use(timeTravelPlugin())
    try {
      const api = (store as unknown as { __timeTravel__: Record<string, (...args: unknown[]) => unknown> }).__timeTravel__
      store.setState('n', 1)
      store.setState('n', 2)
      store.setState('n', 3)
      expect(api.getSnapshotCount()).toBe(4)

      let reentered = false
      store.subscribe(() => {
        if (reentered) return
        reentered = true
        // 同步通知下这一调用发生在 goTo(2) 的回放窗口内：修复前内层帧会把状态推到
        // 快照 1，外层帧 unwind 时又把索引覆盖回 2——索引与真实状态错位
        api.goTo(1)
      })

      api.goTo(2)

      expect(api.getCurrentIndex()).toBe(2)
      expect(store.getState().n).toBe(2)
      expect(reentered).toBe(true)
    } finally {
      uninstall()
    }
  })
})

describe('MetricsCollector.sortByDuration：非有限耗时过滤', () => {
  it('NaN 样本不参与排序，结果确定且可复现', () => {
    const collector = new MetricsCollector(10)
    const mk = (operation: string, duration: number) => ({ operation, type: 'dispatch' as const, duration, timestamp: 1, exceedThreshold: false })
    collector.collect(mk('a', 5))
    collector.collect(mk('nan', Number.NaN))
    collector.collect(mk('c', 3))
    collector.collect(mk('inf', Number.POSITIVE_INFINITY))

    const desc = collector
      .sortByDuration()
      .getAll()
      .map((m) => m.operation)
    const asc = collector
      .sortByDuration(true)
      .getAll()
      .map((m) => m.operation)
    expect(desc).toEqual(['a', 'c'])
    expect(asc).toEqual(['c', 'a'])
    // 同一份数据重复排序结果一致（修复前 NaN 比较器语义下顺序未定义）
    expect(
      collector
        .sortByDuration()
        .getAll()
        .map((m) => m.operation),
    ).toEqual(desc)
  })
})

describe('ErrorRecovery：retryDelay 归一与周期窗不锁死', () => {
  /** 跳过真实退避等待（沿用 r5-extras-error-recovery 的做法） */
  function withoutBackoff(recovery: ErrorRecovery): void {
    const target = recovery as unknown as { delay: () => Promise<void> }
    target.delay = async () => {}
  }

  it('configure 与运行期都把 NaN retryDelay 归一到默认 1000', async () => {
    let now = 1_000_000
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now)
    const recovery = new ErrorRecovery()
    withoutBackoff(recovery)
    try {
      recovery.configure({
        NAN_DELAY: { strategy: RecoveryStrategy.RETRY, maxRetries: 1, retryDelay: Number.NaN },
      })
      expect(recovery.getConfig('NAN_DELAY')?.retryDelay).toBe(1000)

      const mk = () => new GeomStoreError('boom', 'NAN_DELAY', { storeName: 's', operation: 'op' })
      await expect(recovery.recover(mk())).rejects.toThrow('boom') // 第 1 次：重试信号
      await expect(recovery.recover(mk())).rejects.toThrow('Max retries') // 第 2 次：额度耗尽

      // 越过周期窗（maxRetries=1 ⇒ cycleWindow = 60s）后应开启新周期：
      // 修复前 cycleEnd 为 NaN，`now > cycleEnd` 恒假 ⇒ 周期永不过期、额度永久锁死
      now += 120_000
      await expect(recovery.recover(mk())).rejects.toThrow('boom')
    } finally {
      nowSpy.mockRestore()
    }
  })
})

describe('ErrorMonitoring：计时/阈值字段的 NaN 归一', () => {
  it('NaN 回落默认值，0 的合法语义保留', () => {
    const nan = new ErrorMonitoring({ reporters: [], batchInterval: Number.NaN, batchThreshold: Number.NaN, reportTimeout: Number.NaN })
    const zero = new ErrorMonitoring({ reporters: [], batchInterval: 0, batchThreshold: 0, reportTimeout: 0 })
    const fields = (m: ErrorMonitoring) => m as unknown as { batchInterval: number; batchThreshold: number; reportTimeout: number }

    expect(fields(nan).batchInterval).toBe(5000)
    expect(fields(nan).batchThreshold).toBe(10)
    expect(fields(nan).reportTimeout).toBe(10000)
    expect(fields(zero).batchInterval).toBe(0)
    expect(fields(zero).batchThreshold).toBe(0)
    expect(fields(zero).reportTimeout).toBe(0)
  })
})

describe('ErrorAggregator：新建组不被同一次 addError 立刻驱逐', () => {
  it('带过去时间戳的新组在满员时存活（返回的组在册）', () => {
    const aggregator = new ErrorAggregator(2)
    const ctx = (message: string, timestamp?: number) =>
      ({ error: new Error(message), storeName: 's', timestamp }) as unknown as Parameters<ErrorAggregator['addError']>[0]

    aggregator.addError(ctx('a'))
    aggregator.addError(ctx('b'))

    // 修复前：新组 lastSeen 来自过去时间戳，是全场最旧 ⇒ 建成即被驱逐，
    // 而 addError 仍按契约返回这份已不在 Map 里的拷贝
    const fresh = aggregator.addError(ctx('c', Date.now() - 600_000))
    expect(fresh).toBeDefined()
    expect(aggregator.getGroups().map((g) => g.message)).toContain('c')
    expect(aggregator.getGroups()).toHaveLength(2)
  })

  it('退化配置 maxGroups=0 下仍收敛（保护不造成无界增长）', () => {
    const aggregator = new ErrorAggregator(0)
    const ctx = (message: string) => ({ error: new Error(message), storeName: 's' }) as unknown as Parameters<ErrorAggregator['addError']>[0]
    for (let i = 0; i < 5; i++) {
      aggregator.addError(ctx(`e${i}`))
    }
    expect(aggregator.getGroups()).toHaveLength(0)
  })
})

describe('OfflineManager：存储读取失败后拒绝覆写磁盘队列', () => {
  const originalWx = (globalThis as unknown as { wx?: unknown }).wx
  const setWx = (value: unknown): void => {
    const holder = globalThis as unknown as { wx?: unknown }
    holder.wx = value
  }

  afterEach(() => {
    setWx(originalWx)
    jest.restoreAllMocks()
  })

  it('读失败（键存在但取值抛错）后入队不覆写盘上旧队列', async () => {
    const setCalls: Array<{ key: string; value: unknown }> = []
    setWx({
      getStorageSync: (key: string) => {
        if (key === 'review_queue') throw new Error('read boom')
        return ''
      },
      setStorageSync: (key: string, value: unknown) => {
        setCalls.push({ key, value })
      },
      removeStorageSync: () => {},
      getStorageInfoSync: () => ({ keys: ['review_queue'] }),
      getNetworkType: () => ({ isConnected: true }),
      onNetworkStatusChange: () => {},
      offNetworkStatusChange: () => {},
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const store = createStore({
      name: 'offline-read-failure',
      state: { n: 0 },
      actions: {
        save(this: { setState: (k: string, v: unknown) => void }) {
          this.setState('n', 1)
        },
      },
    })

    let manager: OfflineManager<{ n: number }> | null = null
    try {
      manager = new OfflineManager(store as never, 'review_queue')
      // 在线执行失败 → 入队 → saveQueue：修复前会用仅含新项的内存队列覆写磁盘
      const result = await manager.execute('save', () => Promise.reject(new Error('offline')), { n: 1 })
      expect(result).toBeNull()
      expect(setCalls.some((call) => call.key === 'review_queue')).toBe(false)
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      manager?.dispose()
      errorSpy.mockRestore()
    }
  })

  it('读取正常时不受影响：入队照常落盘', async () => {
    const setCalls: Array<{ key: string; value: unknown }> = []
    setWx({
      getStorageSync: () => '',
      setStorageSync: (key: string, value: unknown) => {
        setCalls.push({ key, value })
      },
      removeStorageSync: () => {},
      getStorageInfoSync: () => ({ keys: [] }),
      getNetworkType: () => ({ isConnected: true }),
      onNetworkStatusChange: () => {},
      offNetworkStatusChange: () => {},
    })

    const store = createStore({
      name: 'offline-read-ok',
      state: { n: 0 },
      actions: {
        save(this: { setState: (k: string, v: unknown) => void }) {
          this.setState('n', 1)
        },
      },
    })

    let manager: OfflineManager<{ n: number }> | null = null
    try {
      manager = new OfflineManager(store as never, 'review_queue_ok')
      await manager.execute('save', () => Promise.reject(new Error('offline')), { n: 1 })
      expect(setCalls.some((call) => call.key === 'review_queue_ok')).toBe(true)
    } finally {
      manager?.dispose()
    }
  })
})

describe('PerformanceMonitor：环形缓冲', () => {
  const mk = (operation: string, duration: number) => ({
    operation,
    type: 'dispatch' as const,
    duration,
    timestamp: Date.now(),
    exceedThreshold: false,
  })

  it('满员后覆盖最旧条目，读取时序与容量上限不变', () => {
    const monitor = new PerformanceMonitor({ maxSize: 3, sampleRate: 1 })
    for (let i = 1; i <= 5; i++) {
      monitor.record(mk(`op${i}`, i))
    }
    expect(monitor.getMetrics().map((m) => m.operation)).toEqual(['op3', 'op4', 'op5'])
    expect(monitor.getMetrics()).toHaveLength(3)
    expect(monitor.getRecentMetrics(2).map((m) => m.operation)).toEqual(['op4', 'op5'])
    expect(monitor.getMetricsByOperation('op5')).toHaveLength(1)
    expect(monitor.getMetricsByType('dispatch')).toHaveLength(3)
  })

  it('setOptions 扩容后续写入按时间正序可读', () => {
    const monitor = new PerformanceMonitor({ maxSize: 2, sampleRate: 1 })
    monitor.record(mk('a', 1))
    monitor.record(mk('b', 2))
    monitor.setOptions({ maxSize: 4 })
    monitor.record(mk('c', 3))
    monitor.record(mk('d', 4))
    expect(monitor.getMetrics().map((m) => m.operation)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('metrics 兼容访问面返回同一批缓冲对象（有序）', () => {
    const monitor = new PerformanceMonitor({ maxSize: 3, sampleRate: 1 })
    monitor.record(mk('a', 1))
    monitor.record(mk('b', 2))
    const view = (monitor as unknown as { metrics: Array<{ operation: string }> }).metrics
    expect(view.map((m) => m.operation)).toEqual(['a', 'b'])
    monitor.clear()
    expect(monitor.getMetrics()).toHaveLength(0)
    expect((monitor as unknown as { metrics: unknown[] }).metrics).toHaveLength(0)
  })
})

describe('integrations：多组映射共享一条订阅', () => {
  it('createMapper + subscribeMappers 只注册一条订阅且驱动全部更新器', () => {
    const store = createStore({ name: 'shared-sub', state: { a: 1, b: 2 }, actions: {} })
    const subscribeSpy = jest.spyOn(store, 'subscribe')
    const data: Record<string, unknown> = {}

    const mappers = [
      createMapper(
        data,
        { a: 'a' },
        (key) => (store.getState() as Record<string, unknown>)[key],
        (updates) => Object.assign(data, updates),
      ),
      createMapper(
        data,
        { b: 'b' },
        (key) => (store.getState() as Record<string, unknown>)[key],
        (updates) => Object.assign(data, updates),
      ),
    ]
    expect(data).toEqual({ a: 1, b: 2 })

    const unsubscribe = subscribeMappers((cb, opts) => store.subscribe(cb, opts), mappers)
    expect(subscribeSpy).toHaveBeenCalledTimes(1)

    store.setState('a', 10)
    expect(data).toEqual({ a: 10, b: 2 })

    unsubscribe()
    store.setState('a', 20)
    expect(data.a).toBe(10)
    subscribeSpy.mockRestore()
  })

  it('bindMappings 单映射路径保持「一次绑定一条订阅」的既有行为', () => {
    const store = createStore({ name: 'bind-mappings-compat', state: { a: 1 }, actions: {} })
    const subscribeSpy = jest.spyOn(store, 'subscribe')
    const data: Record<string, unknown> = {}
    const unbinds = bindMappings(
      data,
      { a: 'a' },
      (key) => (store.getState() as Record<string, unknown>)[key],
      (updates) => Object.assign(data, updates),
      (cb, opts) => store.subscribe(cb, opts),
    )
    expect(subscribeSpy).toHaveBeenCalledTimes(1)
    expect(unbinds).toHaveLength(1)
    store.setState('a', 5)
    expect(data.a).toBe(5)
    unbinds[0]()
    store.setState('a', 6)
    expect(data.a).toBe(5)
    subscribeSpy.mockRestore()
  })
})

// ==================== 第二轮：五项「暂未实施」的最优方案落地 ====================

describe('ErrorHandler.isThenable：.then 读取保护', () => {
  it('取值即抛的 then getter 按非 thenable 降级，handleError 不二次抛错', () => {
    const nasty = {
      get then(): unknown {
        throw new Error('then getter boom')
      },
    }
    // 修复前：读 .then 的异常从 handleError 逃出，错误链路自己抛第二条错
    expect(isThenable(nasty)).toBe(false)

    const handler = new ErrorHandlerImpl()
    try {
      handler.setHandler(() => nasty as never)
      expect(() => handler.handleError({ storeName: 's', operation: 'dispatch', error: new Error('x'), level: 'error', timestamp: Date.now() })).not.toThrow()
    } finally {
      handler.setHandler(() => {})
    }
  })
})

describe('createMapper/updateAll：单键 getValue 抛错的批次容错', () => {
  it('坏键跳过、其余键照常 setData、错误经 store onError 上报，状态恢复后自愈', () => {
    let broken = false
    const store = createStore({
      name: 'mapper-bad-key',
      state: { a: 1, b: 2 },
      getters: {
        boom: (): number => {
          if (broken) throw new Error('getter boom')
          return 1
        },
      },
    })
    const onError = jest.fn()
    store.hooks.on('onError', onError)

    const data: Record<string, unknown> = {}
    const setter = jest.fn((updates: Record<string, unknown>) => Object.assign(data, updates))
    const mappers = [
      createMapper(data, { a: 'a' }, (key) => (store.getState() as Record<string, unknown>)[key], setter),
      createMapper(data, { boom: 'boom' }, (key) => store.getter(key), setter),
    ]
    // 绑定期 getValue 全部正常（fail-fast 契约不变）：初值已下发
    expect(data).toEqual({ a: 1, boom: 1 })

    const unsubscribe = subscribeMappers((cb, opts) => store.subscribe(cb, opts), mappers)
    setter.mockClear()
    broken = true

    store.setState('a', 10)

    // 修复前：boom 抛错中断整批，a 的更新被一起拖垮
    expect(data.a).toBe(10)
    // 错误没有静默：经订阅通道上报到 store 的 onError 钩子（SubscriptionManager 的
    // onListenerError 链），与「整批中断」时代的可见性一致
    expect(onError).toHaveBeenCalled()
    // boom 键保持旧值不更新（prevValues 未动）
    expect(data.boom).toBe(1)

    // 状态恢复后的下次通知自愈（订阅仍在）
    broken = false
    store.setState('a', 11)
    expect(data.boom).toBe(1)
    expect(data.a).toBe(11)

    unsubscribe()
  })
})

describe('HttpReporter：快慢路径序列化', () => {
  const makeReporter = (bodies: string[]): HttpReporter =>
    new HttpReporter('https://example.com/err', {}, (async (_url: string, body: string) => {
      bodies.push(body)
    }) as never)

  const ctx = (message: string, payload?: unknown) => ({
    error: new Error(message),
    storeName: 's',
    operation: 'dispatch' as const,
    level: 'error' as const,
    timestamp: 1,
    payload,
  })

  it('坏 payload（循环引用 / 嵌套 BigInt）只降级该条，批次其余条目照常交付', async () => {
    const bodies: string[] = []
    const reporter = makeReporter(bodies)

    const circular: Record<string, unknown> = { name: 'cyc' }
    circular.self = circular

    await reporter.reportBatch([ctx('good', { ok: true }), ctx('circular', circular), ctx('bigint', { n: 10n }), ctx('plain')])

    expect(bodies).toHaveLength(1)
    const parsed = JSON.parse(bodies[0]) as { errors: Array<{ error: { message: string }; payload?: unknown }> }
    expect(parsed.errors).toHaveLength(4)
    // 好条目原样通过（快路径一次串化即成功）
    expect(parsed.errors[0].payload).toEqual({ ok: true })
    // 坏条目只自己降级：专名标记保留，批次不 reject（否则监控层会按网络失败反复重入队）
    expect(String(parsed.errors[1].payload)).toContain('[Unserializable payload:')
    expect(String(parsed.errors[2].payload)).toContain('[Unserializable payload:')
    // 其余条目不受牵连
    expect(parsed.errors[3].error.message).toBe('plain')
  })

  it('bigint 顶层 payload 走快路径的全函数 coercian，不进慢路径', async () => {
    const bodies: string[] = []
    const reporter = makeReporter(bodies)

    await reporter.report(ctx('bigint-top', 10n))

    const parsed = JSON.parse(bodies[0]) as { payload?: unknown }
    expect(parsed.payload).toBe('[bigint 10]')
  })

  it('好 payload 只序列化一次（快路径零试用串化）', async () => {
    const bodies: string[] = []
    const reporter = makeReporter(bodies)
    const stringifySpy = jest.spyOn(JSON, 'stringify')

    try {
      await reporter.report(ctx('good', { ok: true, nested: { deep: [1, 2, 3] } }))
      // 修复前：toSerializablePayload 先试用串一遍（结果丢弃）、buildRequestBody 再串一遍 = 2 次；
      // 修复后：快路径整体串化一次 = 1 次（畸形条目才在慢路径付额外代价）
      expect(stringifySpy).toHaveBeenCalledTimes(1)
    } finally {
      stringifySpy.mockRestore()
    }
  })
})

describe('withCache × 节流/防抖：占位品牌协议', () => {
  /** 按「内 → 外」的顺序手动应用装饰器（与类定义期自下而上一致） */
  const applyInnerOuter = (proto: object, key: string, inner: MethodDecorator, outer: MethodDecorator): void => {
    let descriptor = Object.getOwnPropertyDescriptor(proto, key)
    if (!descriptor) throw new Error(`missing descriptor for ${key}`)
    descriptor = (inner(proto, key, descriptor) as PropertyDescriptor) ?? descriptor
    Object.defineProperty(proto, key, descriptor)
    descriptor = Object.getOwnPropertyDescriptor(proto, key)
    descriptor = (outer(proto, key, descriptor as PropertyDescriptor) as PropertyDescriptor) ?? (descriptor as PropertyDescriptor)
    Object.defineProperty(proto, key, descriptor as PropertyDescriptor)
  }

  afterEach(() => {
    jest.useRealTimers()
  })

  it('错序（缓存在外、节流在内）：被抑制调用的占位不写入缓存', async () => {
    class Svc {
      async m(k: string): Promise<string> {
        await Promise.resolve()
        return k
      }
    }
    jest.useFakeTimers()
    applyInnerOuter(Svc.prototype, 'm', withThrottle(1000) as unknown as MethodDecorator, withCache({ ttl: 60_000 }) as unknown as MethodDecorator)
    const svc = new Svc()

    // 同参调用在 TTL 内会被缓存外层短路、根本到不了节流——要让被抑制调用抵达缓存，
    // 抑制那一次必须是**未缓存过的新键**（节流的窗口不区分参数）
    expect(await svc.m('A')).toBe('A') // t=0 leading：真实执行并入缓存（键 A）
    expect(await svc.m('B')).toBeUndefined() // t=0 窗口内：键 B 未缓存 → 节流抑制 → 占位

    // t=1000：trailing 补发（走缓存包装）。修复前 t=0 的占位已把键 B 写成 undefined，
    // trailing 与后续调用都只能拿到这个毒条目；修复后 trailing 真实执行并入缓存
    jest.advanceTimersByTime(1000)
    jest.advanceTimersByTime(1000)
    // t=2000：窗口已由 trailing 重置过，再一次推进后节流放行 → 缓存命中
    // 修复前：命中毒条目返回 undefined，真实方法永不执行
    expect(await svc.m('B')).toBe('B')
  })

  it('错序（缓存在外、防抖在内）：不同参数的调用不把别种参数的结果写进缓存', async () => {
    class Svc {
      async m(k: string): Promise<string> {
        await Promise.resolve()
        return k
      }
    }
    jest.useFakeTimers()
    applyInnerOuter(Svc.prototype, 'm', withDebounce(300) as unknown as MethodDecorator, withCache({ ttl: 60_000 }) as unknown as MethodDecorator)
    const svc = new Svc()

    const pA = svc.m('A')
    const pB = svc.m('B')
    await jest.advanceTimersByTimeAsync(300)
    // 防抖契约：窗口内所有调用共享最新参数那一次执行的结果
    expect(await pA).toBe('B')
    expect(await pB).toBe('B')

    // 修复前：A 的缓存条目已被写入 B 的结果，这一枪返回 'B'（静默错值）；
    // 修复后：占位不进缓存，A 重新走一次防抖执行
    const pA2 = svc.m('A')
    await jest.advanceTimersByTimeAsync(300)
    expect(await pA2).toBe('A')
  })

  it('正序（节流在外、缓存在内）：每次真实执行都进缓存', async () => {
    let calls = 0
    class Svc {
      async m(): Promise<number> {
        calls++
        await Promise.resolve()
        return calls
      }
    }
    jest.useFakeTimers()
    applyInnerOuter(Svc.prototype, 'm', withCache({ ttl: 60_000 }) as unknown as MethodDecorator, withThrottle(1000) as unknown as MethodDecorator)
    const svc = new Svc()

    expect(await svc.m()).toBe(1)
    expect(await svc.m()).toBeUndefined() // 窗口内抑制
    expect(calls).toBe(1)
    // t=1000：trailing 补发（走缓存包装 → 命中，不重复执行）并把 lastCallTime 重置为 1000，
    // 故再推进一个窗口才是下一次 leading
    jest.advanceTimersByTime(1000)
    jest.advanceTimersByTime(1000)
    // 窗口外：节流放行 → 缓存命中 → 不重复执行
    expect(await svc.m()).toBe(1)
    expect(calls).toBe(1)
  })
})

describe('env.storage.getWithStatus 三态', () => {
  const originalWx = (globalThis as unknown as { wx?: unknown }).wx
  const setWx = (value: unknown): void => {
    const holder = globalThis as unknown as { wx?: unknown }
    holder.wx = value
  }

  afterEach(() => {
    setWx(originalWx)
    jest.restoreAllMocks()
  })

  it('hit / miss / error 三态可分，get 的既有 null 契约不变', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      setWx({
        getStorageSync: (key: string) => {
          if (key === 'boom') throw new Error('read boom')
          if (key === 'empty') return ''
          if (key === 'obj') return '{"a":1}'
          if (key === 'num') return '1001'
          return ''
        },
      })

      expect(storage.getWithStatus('obj').status).toBe('hit')
      expect(storage.getWithStatus('obj').value).toEqual({ a: 1 })
      expect(storage.getWithStatus('num').status).toBe('hit')
      // number 原文返回的既有契约在三态下保持
      expect(storage.getWithStatus('num').value).toBe('1001')
      expect(storage.getWithStatus('empty').status).toBe('miss')
      expect(storage.getWithStatus('missing').status).toBe('miss')
      expect(storage.getWithStatus('boom').status).toBe('error')
      expect(storage.getWithStatus('boom').value).toBeNull()

      // get 的行为逐字不变：error 与 miss 都回落 null
      expect(storage.get('obj')).toEqual({ a: 1 })
      expect(storage.get('boom')).toBeNull()
      expect(storage.get('missing')).toBeNull()
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})

// ==================== 第三轮：二次审查（diff 对抗审查 + 未覆盖文件补审） ====================

/**
 * 捕获本轮排定的 setTimeout 延迟
 *
 * 这一族缺陷（延迟越过 setTimeout 的 2^31-1 上限后被宿主静默夹成 ~1ms）**不能**靠
 * fake timers 复现——假时钟按字面值排程，不做宿主的 32 位截断。因此这里直接判定
 * 「排定的延迟值」：源码侧统一钳到上限，两侧也就都以 MAX_TIMER_DELAY 为准绳
 */
function captureTimerDelays(): { delays: () => number[]; restore: () => void } {
  const spy = jest.spyOn(globalThis, 'setTimeout')
  return {
    delays: () => spy.mock.calls.map((call) => call[1]).filter((delay): delay is number => typeof delay === 'number'),
    restore: () => spy.mockRestore(),
  }
}

describe('subscribeMappers：单个映射器抛错不得阻断同宿主其余映射', () => {
  it('坏 getter 所在的映射器抛出后，其后 state 映射本轮仍照常更新', () => {
    let broken = false
    const store = createStore({
      name: 'r3-mapper-isolation',
      state: { a: 1 },
      getters: {
        bad: (): number => {
          if (broken) throw new Error('bad getter')
          return 1
        },
      },
    })
    const onError = jest.fn()
    store.hooks.on('onError', onError)

    const data: Record<string, unknown> = {}
    const setter = jest.fn((updates: Record<string, unknown>) => Object.assign(data, updates))
    // 顺序刻意：会抛错的映射排在前，紧跟其后的是 state 映射
    const mappers = [
      createMapper(data, { bad: 'bad' }, (key) => store.getter(key), setter),
      createMapper(
        data,
        { a: 'a' },
        (key) => (store.getState() as Record<string, unknown>)[key],
        setter,
        (storeKey) => store.isStateKeyDirty(storeKey),
      ),
    ]
    // 绑定期 getValue 全部正常：两组初值都已下发
    expect(data).toEqual({ bad: 1, a: 1 })

    const unsubscribe = subscribeMappers((cb, opts) => store.subscribe(cb, opts), mappers)
    broken = true
    store.setState('a', 10)

    // 修复前：第一个映射器的错误从共享订阅的回调里同步逸出，回调就此中断，
    // 排在其后的 state 映射本轮收不到通知——「共享订阅省额度」反而把单键失败
    // 放大成同实例其余映射的丢更新，与 createMapper 内部的容错口径相反
    expect(data.a).toBe(10)
    // 错误依旧可见：经 SubscriptionManager 的 onListenerError 上报到 store 的 onError
    expect(onError).toHaveBeenCalled()

    unsubscribe()
  })
})

describe('ErrorRecovery：指数退避溢出取上限而非「立即重试」', () => {
  it('rawDelay 溢出为 Infinity 时排定 MAX_TIMER_DELAY（不是 0）', async () => {
    jest.useFakeTimers()
    const captured = captureTimerDelays()
    try {
      const recovery = new ErrorRecovery()
      // 巨大的**有限** baseDelay：attempt 0 的退避仍有限（被钳到上限），
      // attempt 1 的 baseDelay * 2 溢出为 Infinity——只有这一档能区分新旧行为
      recovery.configure({ HUGE_BACKOFF: { strategy: RecoveryStrategy.RETRY, maxRetries: 3, retryDelay: 1e300 } })
      const mk = () => new GeomStoreError('boom', 'HUGE_BACKOFF', { storeName: 's', operation: 'op' })

      // 断言必须在推进时钟**之前**挂上：recover 的 rejection 落地在假时钟推进期间，
      // 晚付带 handler 会被 Node 记为未处理拒绝（测试虽稍后 awaiting 仍判失败）
      const first = recovery.recover(mk())
      const firstSettles = expect(first).rejects.toThrow('boom')
      await jest.advanceTimersByTimeAsync(MAX_TIMER_DELAY + 1)
      await firstSettles
      expect(captured.delays()[0]).toBe(MAX_TIMER_DELAY)

      const second = recovery.recover(mk())
      const secondSettles = expect(second).rejects.toThrow('boom')
      await jest.advanceTimersByTimeAsync(0)
      // 修复前：Infinity 落到 `: 0` 分支 ⇒ setTimeout(fn, 0)，最后几次重试紧贴执行；
      // 修复后按「能等多久等多久」排到上限（与 async-core 的 retryWithBackoff 同口径）
      // 同上：拒绝必须先有 handler 才能推进时钟
      expect(captured.delays()[1]).toBe(MAX_TIMER_DELAY)
      await jest.advanceTimersByTimeAsync(MAX_TIMER_DELAY + 1)
      await secondSettles
    } finally {
      captured.restore()
      jest.useRealTimers()
    }
  })
})

describe('ErrorMonitoring：超大 reportTimeout 不得让超时在下一个宏任务就落地', () => {
  it('reportTimeout 越界时按上限排定超时定时器', async () => {
    jest.useFakeTimers()
    const captured = captureTimerDelays()
    try {
      // 永不结算的上报：为了让超时定时器成为唯一的结算路径（Await 它就没有观察窗口了）
      const reporter = {
        report: jest.fn(() => new Promise<void>(() => {})),
        reportBatch: jest.fn(() => Promise.resolve()),
        getName: () => 'r3-never-settling',
      }
      const monitoring = new ErrorMonitoring({
        reporters: [reporter],
        batchThreshold: 1,
        batchInterval: 3_600_000,
        // 有限但远超 2^31-1：宿主会把它夹成 ~1ms，每次 flush 都把所有在途上报判成超时
        reportTimeout: 5e9,
        enableConsoleLog: false,
      })

      await monitoring.report({ storeName: 's', operation: 'dispatch', error: new Error('boom'), level: 'error', timestamp: 1 })

      expect(captured.delays()).toContain(MAX_TIMER_DELAY)
    } finally {
      captured.restore()
      jest.useRealTimers()
    }
  })
})

describe('SelectorComposer.createDebouncedSelector：延迟钳到 setTimeout 上限', () => {
  it('越界 delay 按上限排定，防抖窗口不退化成立即执行', () => {
    jest.useFakeTimers()
    const captured = captureTimerDelays()
    try {
      const selector = SelectorComposer.createDebouncedSelector((s: { v: number }) => s.v, 3e9)
      void selector({ v: 1 })

      // 修复前排定的是原值 3e9（宿主口径是 ~1ms）：调用方以为配了超长窗口，
      // 实际每次调用都在下一个宏任务就跑选择器
      expect(captured.delays()).toContain(MAX_TIMER_DELAY)
    } finally {
      captured.restore()
      jest.useRealTimers()
    }
  })
})

describe('createRetrySelectorAsync：退避等待钳到 setTimeout 上限', () => {
  it('退避函数返回越界值时按上限等待', async () => {
    jest.useFakeTimers()
    const captured = captureTimerDelays()
    try {
      let calls = 0
      const selector = SelectorComposer.createRetrySelectorAsync(
        (_s: { v: number }) => {
          calls++
          throw new Error('boom')
        },
        { retries: 1, delay: () => 5e9 },
      )

      const promise = selector({ v: 1 })
      const settles = expect(promise).rejects.toThrow('boom')
      await jest.advanceTimersByTimeAsync(0)
      // 修复前排定 5e9 ⇒ 宿主夹成 ~1ms，退避静默消失（调用方看到的仍是「我配了退避」）
      expect(captured.delays()).toContain(MAX_TIMER_DELAY)

      await jest.advanceTimersByTimeAsync(MAX_TIMER_DELAY + 1)
      await settles
      expect(calls).toBe(2)
    } finally {
      captured.restore()
      jest.useRealTimers()
    }
  })
})

describe('persistencePlugin：debounce 越界时按上限排定落盘', () => {
  it('配置笔误（300 → 3e9）不会退化成每次变更都同步落盘', () => {
    jest.useFakeTimers()
    const captured = captureTimerDelays()
    try {
      const store = createStore({ name: 'persist-debounce-clamp', state: { x: 1 }, actions: {} })
      const storageBackend = { getItem: () => null, setItem: jest.fn(), removeItem: jest.fn() }
      store.use(persistencePlugin({ storage: storageBackend, debounce: 3e9 }))

      store.setState('x', 2)

      // 修复前：宿主把 3e9 夹成 ~1ms ⇒ 高频变更下每帧一次 JSON.stringify(整棵状态树)
      // + 同步 wx.setStorageSync（小程序里是阻塞 I/O）
      expect(captured.delays()).toContain(MAX_TIMER_DELAY)
    } finally {
      captured.restore()
      jest.useRealTimers()
    }
  })
})
