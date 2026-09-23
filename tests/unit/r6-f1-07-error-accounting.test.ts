/**
 * 第六轮 f1-07 分片回归（R6-047 / R6-093 / R6-048 / R6-094）
 *
 * 覆盖的公开行为：
 * - maxGroups 驱逐不再让 totalErrors/byCode/byStore 倒退，驱逐量随 getStats() 可查
 * - 单组 affectedStores 与全局 byStore 的基数上限：溢出并入 `__others__`，计数不缺
 * - `createDefaultMonitoring` 不被显式 `reporters: undefined` 顶掉默认 ConsoleReporter
 * - reporters 非数组时退回空数组并出声，上报链不再同步抛 TypeError
 * - 报告器列表是实例私有副本：addReporter 不改调用方数组、不跨实例生效
 */

import { ErrorAggregator, ErrorMonitoring, createDefaultMonitoring } from '@/extras/error/index.js'
import type { ErrorContext, ErrorReporter } from '@/types/error.js'

function context(overrides: Partial<ErrorContext> = {}): ErrorContext {
  return {
    storeName: 'probe-store',
    operation: 'dispatch',
    error: new Error('probe'),
    level: 'error',
    timestamp: 1,
    ...overrides,
  }
}

function sum(values: Record<string, number>): number {
  return Object.values(values).reduce((acc, n) => acc + n, 0)
}

/** 只记录被调用次数的报告器 */
function recorder(name: string): ErrorReporter & { calls: number; seen: ErrorContext[][] } {
  const reporter = {
    calls: 0,
    seen: [] as ErrorContext[][],
    getName: () => name,
    report: async () => {
      reporter.calls++
    },
    reportBatch: async (contexts: ErrorContext[]) => {
      reporter.calls++
      reporter.seen.push(contexts)
    },
  }
  return reporter
}

describe('R6-047 驱逐记账：totalErrors 是「观测到的错误数」，不随驱逐倒退', () => {
  it('组被 maxGroups 驱逐后 totalErrors 单调不减，evictedErrors/evictedGroups 记账', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const aggregator = new ErrorAggregator(2)
    const ctx = (message: string, storeName: string, timestamp: number) => context({ error: new Error(message), storeName, timestamp })

    const snapshots: number[] = []
    const observe = () => {
      const stats = aggregator.getStats()
      snapshots.push(stats.totalErrors)
      return stats
    }

    aggregator.addError(ctx('a', 's1', 1000))
    aggregator.addError(ctx('b', 's2', 2000))
    aggregator.addError(ctx('a', 's3', 3000)) // 并入既有组：A.count = 2
    observe()

    aggregator.addError(ctx('c', 's1', 4000)) // 第三组 → 驱逐 B（count 1）
    const afterFirstEviction = observe()
    expect(afterFirstEviction.totalGroups).toBe(2)
    expect(afterFirstEviction.evictedGroups).toBe(1)
    expect(afterFirstEviction.evictedErrors).toBe(1)
    expect(afterFirstEviction.totalErrors).toBe(4)

    aggregator.addError(ctx('d', 's4', 5000)) // 再驱逐 A（count 2）
    const afterSecond = observe()
    expect(afterSecond.evictedGroups).toBe(2)
    expect(afterSecond.evictedErrors).toBe(3)
    expect(afterSecond.totalErrors).toBe(5)

    // 单调不减：任何一次新错误都不会让总数变小（旧实现里这里会倒退）
    expect(snapshots).toEqual([...snapshots].sort((x, y) => x - y))
    // 三条账自洽：sum(byCode) === sum(byStore) === totalErrors
    expect(sum(afterSecond.byStore)).toBe(afterSecond.totalErrors)
    expect(sum(afterSecond.byCode)).toBe(afterSecond.totalErrors)
    // 按 Store 的账目不再随组消失
    expect(afterSecond.byStore).toEqual({ s1: 2, s2: 1, s3: 1, s4: 1 })
    // 驱逐至少出声一次
    expect(warn.mock.calls.flat().some((entry) => typeof entry === 'string' && entry.includes('maxGroups'))).toBe(true)
    warn.mockRestore()
  })

  it('clear() 把驱逐留痕与全部账目一起归零', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const aggregator = new ErrorAggregator(1)
    aggregator.addError(ctxMsg('a'))
    aggregator.addError(ctxMsg('b'))
    expect(aggregator.getStats().evictedErrors).toBe(1)

    aggregator.clear()
    const stats = aggregator.getStats()
    expect(stats.totalErrors).toBe(0)
    expect(stats.evictedErrors).toBe(0)
    expect(stats.evictedGroups).toBe(0)
    expect(stats.byStore).toEqual({})
    expect(stats.byCode).toEqual({})
    warn.mockRestore()
  })

  it('ErrorMonitoring.generateReport 的 totalErrors 跨驱逐保持单调', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const monitoring = new ErrorMonitoring({
      reporters: [],
      batchThreshold: 1000,
      batchInterval: 3_600_000,
      enableConsoleLog: false,
    })

    // 默认 maxGroups = 100：制造 130 个不同指纹，跨过驱逐线
    let previous = 0
    for (let i = 0; i < 130; i++) {
      await monitoring.report(context({ error: new Error(`boom-${i}`), storeName: `store-${i}` }))
      const total = monitoring.generateReport().summary.totalErrors
      expect(total).toBeGreaterThanOrEqual(previous)
      previous = total
    }

    expect(previous).toBe(130)
    const stats = monitoring.getAggregationStats()
    expect(stats.totalGroups).toBeLessThanOrEqual(100)
    expect(stats.evictedErrors).toBe(130 - stats.totalGroups)
    expect(sum(stats.byStore)).toBe(130)

    await monitoring.shutdown()
    warn.mockRestore()
    errorSpy.mockRestore()
  })
})

function ctxMsg(message: string): ErrorContext {
  return context({ error: new Error(message) })
}

describe('R6-093 单组 Store 基数与全局 byStore 基数有上限', () => {
  it('同一组超过 50 个 Store 后并入 __others__，组 count 与 byStore 不缺计', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const aggregator = new ErrorAggregator(5)
    const shared = new Error('same site failure')
    shared.stack = ''

    for (let i = 0; i < 60; i++) {
      aggregator.addError(context({ error: shared, storeName: `user-${i}`, timestamp: i + 1 }))
    }

    const groups = aggregator.getGroups()
    expect(groups).toHaveLength(1)
    expect(groups[0].count).toBe(60)
    // 50 个逐个列出 + 1 个溢出桶
    expect(groups[0].affectedStores).toHaveLength(51)
    expect(groups[0].affectedStores[50]).toBe('__others__')
    expect(new Set(groups[0].affectedStores).size).toBe(groups[0].affectedStores.length)

    const stats = aggregator.getStats()
    expect(stats.totalErrors).toBe(60)
    expect(sum(stats.byStore)).toBe(60)
    expect(stats.byStore['user-59']).toBe(1)

    // 溢出只出声一次，不在错误高发路径上刷屏
    expect(warn.mock.calls.filter((call) => String(call[0]).includes('Store 已达'))).toHaveLength(1)
    warn.mockRestore()
  })

  it('全局 byStore 的键数有上限，超出部分并入 __others__ 且求和不变', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const aggregator = new ErrorAggregator(500)
    for (let i = 0; i < 250; i++) {
      aggregator.addError(context({ error: new Error(`distinct-${i}`), storeName: `store-${i}`, timestamp: i + 1 }))
    }

    const stats = aggregator.getStats()
    expect(stats.totalErrors).toBe(250)
    expect(Object.keys(stats.byStore).length).toBeLessThanOrEqual(201)
    expect(stats.byStore.__others__).toBeGreaterThan(0)
    expect(sum(stats.byStore)).toBe(250)
    warn.mockRestore()
  })
})

describe('R6-048 reporters 归一化', () => {
  it('createDefaultMonitoring 带显式 undefined 的 reporters 时仍保留默认 ConsoleReporter', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const groupSpy = jest.spyOn(console, 'group').mockImplementation(() => {})
    const monitoring = createDefaultMonitoring({
      reporters: undefined,
      batchInterval: 3_600_000,
      batchThreshold: 1,
      enableConsoleLog: false,
    })

    await expect(monitoring.report(context())).resolves.toBeUndefined()

    // ConsoleReporter 的批量表头（走 console.group）：证明默认报告器真的收到了这一批
    // （旧实现下 reporters 是 undefined，flush 在 this.reporters.map 处同步抛 TypeError，
    // 于是 report() 自身 reject、队列永不清空）
    expect(groupSpy.mock.calls.flat().some((entry) => typeof entry === 'string' && entry.includes('Batch Report'))).toBe(true)
    expect(monitoring.generateReport().summary.queuedErrors).toBe(0)
    groupSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('reporters 非数组时退回空数组并出声，report/addReporter 不再同步抛 TypeError', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const monitoring = new ErrorMonitoring({
      reporters: 'not-an-array' as unknown as ErrorReporter[],
      batchInterval: 3_600_000,
      batchThreshold: 1,
      enableConsoleLog: false,
    })

    await expect(monitoring.report(context())).resolves.toBeUndefined()
    expect(warn.mock.calls.flat().some((entry) => typeof entry === 'string' && entry.includes('config.reporters 不是数组'))).toBe(true)

    // 事后补救的注册路径同样可用（旧实现下 this.reporters 是 undefined，push 直接抛）
    const reporter = recorder('late')
    monitoring.addReporter(reporter)
    await monitoring.report(context())
    expect(reporter.calls).toBe(1)

    await monitoring.shutdown()
    warn.mockRestore()
  })
})

describe('R6-094 报告器列表归实例私有', () => {
  it('addReporter 不改写调用方数组，也不跨实例生效', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const shared: ErrorReporter[] = []
    const r1 = recorder('r1')
    const r2 = recorder('r2')
    shared.push(r1)

    const m1 = new ErrorMonitoring({ reporters: shared, batchInterval: 3_600_000, batchThreshold: 1000, enableConsoleLog: false })
    const m2 = new ErrorMonitoring({ reporters: shared, batchInterval: 3_600_000, batchThreshold: 1000, enableConsoleLog: false })

    m1.addReporter(r2)
    expect(shared).toHaveLength(1)

    await m2.report(context())
    await m2.flushReports()
    expect(r2.calls).toBe(0)
    expect(r1.calls).toBe(1)

    await m1.report(context())
    await m1.flushReports()
    expect(r2.calls).toBe(1)

    // removeReporter 之后方向仍然一致：两个入口都只作用于私有副本
    m1.removeReporter('r2')
    await m1.report(context({ error: new Error('after-remove') }))
    await m1.flushReports()
    expect(r2.calls).toBe(1)
    expect(shared).toHaveLength(1)

    await m1.shutdown()
    await m2.shutdown()
    errorSpy.mockRestore()
  })
})
