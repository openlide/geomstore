/**
 * 第五轮审查（ocrreview.md）分片 core-misc-p2 的回归锁 —— 性能侧
 *
 * 覆盖 R5-090 / R5-091 / R5-092 / R5-093 / R5-094 / R5-095 / R5-096 / R5-097 / R5-098。
 * 每条用例断言的是**修复后的语义**，修复前这些断言全部会失败（失败点即报告描述的路径）。
 * R5-099（形参改名）是纯命名项，无可断言行为。
 */

import { MetricsCollector, PerformanceAnalyzer, computePerformanceStats } from '@/core/performance/metrics.js'
import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor.js'
import type { PerformanceMetrics } from '@/types/performance.js'

function metric(operation: string, duration: number, exceedThreshold = false): PerformanceMetrics {
  return { operation, type: 'dispatch', duration, timestamp: 0, exceedThreshold }
}

/** 取出私有计时表，验证条目生命周期 */
function operationsOf(monitor: PerformanceMonitor): Map<string, number> {
  return (monitor as unknown as { currentOperations: Map<string, number> }).currentOperations
}

const g = globalThis as unknown as Record<string, unknown>

/** 超时条目年龄阈值（与 PerformanceMonitor.MAX_OPERATION_AGE_MS 一致：10 分钟） */
const STALE_OFFSET_MS = 11 * 60 * 1000

afterEach(() => {
  jest.restoreAllMocks()
})

// ==================== metrics.ts ====================

describe('R5-095 detectRegression 的原型链读泄漏', () => {
  it('基线缺项而操作名命中原型成员时，不再产出 baselineDuration 为函数的幽灵退化项', () => {
    // 修复前：baselineStats 是 Object.fromEntries 落回的普通对象，
    // `baselineStats['toString']` 取到继承的函数（!== undefined 放行），
    // 于是「基线里根本没有这个操作」被算成 change=NaN、changePercent=Infinity 的**假退化**
    const current = [metric('toString', 7), metric('__proto__', 7), metric('hasOwnProperty', 7), metric('valueOf', 7)]

    expect(PerformanceAnalyzer.detectRegression(current, [], 0.2)).toEqual([])
    expect((Object.prototype as unknown as Record<string, unknown>).count).toBeUndefined()
  })

  it('基线确实存在该操作时照常上报，且 __proto__ 作为普通操作名可用', () => {
    const baseline = [metric('__proto__', 10), metric('toString', 10)]
    const current = [metric('__proto__', 20), metric('toString', 11)]

    const regressions = PerformanceAnalyzer.detectRegression(current, baseline, 0.2)

    expect(regressions.map((r) => r.operation)).toEqual(['__proto__'])
    expect(regressions[0]).toEqual({ operation: '__proto__', baselineDuration: 10, currentDuration: 20, change: 10, changePercent: 100 })
  })
})

describe('R5-096 getHotPaths 的 limit 规范化', () => {
  function collectorWith(operations: string[]): MetricsCollector {
    const collector = new MetricsCollector(100)
    collector.collectBatch(operations.map((operation) => metric(operation, 1)))
    return collector
  }

  it('NaN/负数/Infinity/0 一律返回空数组，小数向下取整', () => {
    const collector = collectorWith(['a', 'b', 'c'])

    expect(collector.getHotPaths(Number.NaN)).toEqual([])
    expect(collector.getHotPaths(-1)).toEqual([])
    expect(collector.getHotPaths(Number.POSITIVE_INFINITY)).toEqual([])
    expect(collector.getHotPaths(0)).toEqual([])
    // 修复前：-1 → slice(0, -1) 返回「除最后一条之外」的全部，与「热路径 top-N」相反
    expect(collector.getHotPaths(-1).length).toBe(0)
    expect(collector.getHotPaths(2.7)).toHaveLength(2)
    expect(collector.getHotPaths(99)).toHaveLength(3)
  })
})

describe('R5-097 按操作分组只剩一份实现', () => {
  it('四个入口的 次数/平均/最大 由同一份累加器派生（含基线均值的 detectRegression）', () => {
    const metrics = [metric('a', 10), metric('a', 30), metric('b', 5)]
    const collector = new MetricsCollector(10)
    collector.collectBatch(metrics)

    const stats = computePerformanceStats(metrics)
    const hot = collector.getHotPaths(10)
    const bottlenecks = PerformanceAnalyzer.analyzeBottlenecks(metrics, 8)
    const avgOf = (list: Array<{ operation: string; avgDuration: number }>, op: string): number =>
      (list.find((item) => item.operation === op) as { avgDuration: number }).avgDuration

    expect(stats.byOperation.a).toEqual({ count: 2, avgDuration: 20, maxDuration: 30 })
    expect(stats.byOperation.b).toEqual({ count: 1, avgDuration: 5, maxDuration: 5 })
    expect(avgOf(hot, 'a')).toBe(20)
    expect(hot[0].operation).toBe('a')
    expect(bottlenecks[0]).toEqual({ operation: 'a', count: 2, avgDuration: 20, maxDuration: 30, severity: 'medium' })
    // detectRegression 走私有均值表：同数据自比 => 零增长、零退化
    expect(PerformanceAnalyzer.detectRegression(metrics, metrics, 0.2)).toEqual([])
  })
})

describe('R5-098 超阈值计数并入主循环', () => {
  it('thresholdExceeded 与 min/max/sum 同一趟算出，结果与逐项判定一致', () => {
    const stats = computePerformanceStats([metric('a', 10, true), metric('b', 20, false), metric('c', 30, true)])

    expect(stats.thresholdExceeded).toBe(2)
    expect(stats.totalCount).toBe(3)
    expect(stats.minDuration).toBe(10)
    expect(stats.maxDuration).toBe(30)
    expect(stats.avgDuration).toBe(20)
  })

  it('exceedThreshold 缺省（undefined）时不计入', () => {
    const stats = computePerformanceStats([{ operation: 'a', type: 'dispatch', duration: 1, timestamp: 0 }])

    expect(stats.thresholdExceeded).toBe(0)
  })
})

// ==================== PerformanceMonitor.ts ====================

describe('R5-090 record 始终留存入参副本', () => {
  it('trackMemory 关闭时调用方改写已记录的入参，不再回写历史指标', () => {
    const input = metric('op', 5)
    const monitor = new PerformanceMonitor({ logger: () => {} })

    monitor.record(input)
    input.operation = 'hacked'
    input.duration = 999

    expect(monitor.getMetrics()[0]).toEqual(metric('op', 5))
    expect(monitor.getStats().avgDuration).toBe(5)
    expect(JSON.parse(monitor.exportJSON()).metrics[0].duration).toBe(5)
  })

  it('logger 拿到的也不是调用方对象', () => {
    const seen: PerformanceMetrics[] = []
    const monitor = new PerformanceMonitor({ threshold: 1, logger: (m) => seen.push(m) })
    const input = metric('slow', 50, true)

    monitor.record(input)
    input.duration = 1

    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toBe(input)
    expect(seen[0].duration).toBe(50)
  })
})

describe('R5-091 采样判据用严格小于', () => {
  it('sampleRate=0 时即便随机数恰好取到 0 也不留存', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0)

    const monitor = new PerformanceMonitor({ sampleRate: 0, logger: () => {} })
    monitor.record(metric('op', 1))

    // 修复前：Math.random() <= 0 为真，「一条都不留」的采样率漏进了一条
    expect(monitor.getMetrics()).toHaveLength(0)
  })

  it('sampleRate=1 仍 100% 留存（随机数取值域是 [0,1)）', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0)

    const monitor = new PerformanceMonitor({ sampleRate: 1, logger: () => {} })
    monitor.record(metric('op', 1))

    expect(monitor.getMetrics()).toHaveLength(1)
  })
})

describe('R5-092 内存读数经 globalThis', () => {
  it('运行时无 performance 全局时不抛错、不误报，仅不附 memoryUsage', () => {
    const original = Object.getOwnPropertyDescriptor(g, 'performance')

    try {
      delete g.performance
      const monitor = new PerformanceMonitor({ trackMemory: true, logger: () => {} })
      const input = metric('op', 1)

      expect(() => monitor.record(input)).not.toThrow()
      expect(monitor.getMetrics()[0].memoryUsage).toBeUndefined()
      // 修复前是裸 `performance` 标识符：无该全局的基础库里 ReferenceError 被 catch 静默吞掉，
      // trackMemory 永不生效且无任何线索说明原因
    } finally {
      if (original) {
        Object.defineProperty(g, 'performance', original)
      } else {
        delete g.performance
      }
    }
  })

  it('performance.memory 可用时写入副本，不污染调用方对象', () => {
    const original = Object.getOwnPropertyDescriptor(g, 'performance')
    Object.defineProperty(g, 'performance', {
      value: { now: () => 0, memory: { usedJSHeapSize: 4096 } },
      writable: true,
      configurable: true,
    })

    try {
      const monitor = new PerformanceMonitor({ trackMemory: true, logger: () => {} })
      const input = metric('op', 1)
      monitor.record(input)

      expect(monitor.getMetrics()[0].memoryUsage).toBe(4096)
      expect(input.memoryUsage).toBeUndefined()
    } finally {
      if (original) {
        Object.defineProperty(g, 'performance', original)
      } else {
        delete g.performance
      }
    }
  })
})

describe('R5-093 start() 也参与超时清扫', () => {
  it('只 start 不 end、也不再 record 时，下一次 start 会摘除超时条目', () => {
    const monitor = new PerformanceMonitor({ logger: () => {} })
    const ops = operationsOf(monitor)

    monitor.start('leaked')
    const staleKey = [...ops.keys()][0]
    ops.set(staleKey, (ops.get(staleKey) as number) - STALE_OFFSET_MS)

    monitor.start('fresh')

    // 修复前：清扫只挂在 record() 上，这种调用形状下 currentOperations 无界增长
    expect(ops.has(staleKey)).toBe(false)
    // 本轮新建的条目不被自己扫掉（清扫发生在 set 之前、且与条目同一时钟基准）
    expect(ops.size).toBe(1)
    expect([...ops.keys()][0]).toContain('fresh')

    // 在途条目同样受清扫约束：未超时则保留，end() 仍能正常计时
    const end = monitor.start('slow-leak')
    expect(ops.size).toBe(2)
    end()
    expect(ops.size).toBe(1)
  })
})

describe('R5-094 exportJSON 的口径', () => {
  it('options 段是不含 logger 的可序列化投影，metrics 与 getMetrics() 同源', () => {
    // 随机数钉在 0：否则 sampleRate=0.5 会让这条指标按概率不落缓冲，断言变成掷硬币
    jest.spyOn(Math, 'random').mockReturnValue(0)
    const monitor = new PerformanceMonitor({ threshold: 5, sampleRate: 0.5, maxSize: 20, logger: () => {} })
    monitor.record(metric('op', 100, true))

    const parsed = JSON.parse(monitor.exportJSON()) as {
      metrics: PerformanceMetrics[]
      stats: { totalCount: number }
      options: Record<string, unknown>
    }

    // logger 是函数、JSON.stringify 本就丢键：显式投影让「报告里的 options 是配置的投影」
    // 成为声明的契约，而不是依赖序列化不写回这一实现细节
    expect(Object.keys(parsed.options).sort()).toEqual(['maxSize', 'sampleRate', 'threshold', 'trackMemory'])
    expect(parsed.options).toEqual({ sampleRate: 0.5, threshold: 5, maxSize: 20, trackMemory: false })
    expect(parsed.metrics).toEqual(monitor.getMetrics())
    expect(parsed.stats.totalCount).toBe(1)
  })
})
