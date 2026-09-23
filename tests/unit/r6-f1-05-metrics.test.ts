/**
 * 第六轮 f1-05 回归锁：性能统计对「非有限耗时」与「非法阈值」的口径
 *
 * 覆盖 R6-084（NaN/Infinity duration 让 avg 恒为 NaN、max/min 静默剔除、全非有限时
 * 返回 ±Infinity）与 R6-085（analyzeBottlenecks / detectRegression 的 threshold 不归一，
 * NaN 让判定静默失效、负值让全部标成最严重程度）。
 */

import { MetricsCollector, PerformanceAnalyzer, computePerformanceStats } from '@/core/performance/metrics.js'
import type { PerformanceMetrics } from '@/types/performance.js'

const metric = (operation: string, duration: number, exceedThreshold = false): PerformanceMetrics => ({
  operation,
  type: 'dispatch',
  duration,
  timestamp: 1_700_000_000_000,
  exceedThreshold,
})

describe('R6-084 非有限耗时的样本不入耗时聚合', () => {
  it('NaN 样本不再把 avg 污染成 NaN，同时 max/min 与 avg 口径一致', () => {
    const stats = computePerformanceStats([metric('a', 10), metric('a', Number.NaN), metric('a', 30)])

    expect(Number.isFinite(stats.avgDuration)).toBe(true)
    expect(stats.avgDuration).toBe(20)
    expect(stats.maxDuration).toBe(30)
    expect(stats.minDuration).toBe(10)
    // 该样本仍算一次调用：totalCount 计的是「发生过」，不是「可测量」
    expect(stats.totalCount).toBe(3)
  })

  it('Infinity 样本同样被排除（此前它会把 max 与 avg 一起拉成 Infinity）', () => {
    const stats = computePerformanceStats([metric('a', 5), metric('a', Number.POSITIVE_INFINITY), metric('a', 7)])

    expect(stats.avgDuration).toBe(6)
    expect(stats.maxDuration).toBe(7)
    expect(stats.minDuration).toBe(5)
  })

  it('全部样本非有限时返回 0 而非 ±Infinity，且 JSON 导出看不出「缺字段」', () => {
    const stats = computePerformanceStats([metric('a', Number.NaN), metric('a', Number.POSITIVE_INFINITY)])

    expect(stats).toMatchObject({ avgDuration: 0, maxDuration: 0, minDuration: 0, totalCount: 2 })
    expect(JSON.parse(JSON.stringify(stats)).maxDuration).toBe(0)
  })

  it('按操作分组与热路径同样按有限样本求平均/最大', () => {
    const metrics = [metric('slow', 100), metric('slow', Number.NaN), metric('broken', Number.NaN)]
    const stats = computePerformanceStats(metrics)

    expect(stats.byOperation.slow).toEqual({ count: 2, avgDuration: 100, maxDuration: 100 })
    expect(stats.byOperation.broken).toEqual({ count: 1, avgDuration: 0, maxDuration: 0 })

    const collector = new MetricsCollector()
    collector.collectBatch(metrics)
    expect(collector.getHotPaths(2)).toEqual([
      { operation: 'slow', count: 2, avgDuration: 100 },
      { operation: 'broken', count: 1, avgDuration: 0 },
    ])
  })

  it('超阈值计数不受耗时过滤影响', () => {
    const stats = computePerformanceStats([metric('a', Number.NaN, true), metric('a', 1, false)])
    expect(stats.thresholdExceeded).toBe(1)
  })
})

describe('R6-085 阈值归一：两个静态分析入口一起改', () => {
  const metrics = [metric('a', 100)]

  it('analyzeBottlenecks：NaN 阈值回落默认 16（此前所有操作一律 low，面板显示「一切正常」）', () => {
    expect(PerformanceAnalyzer.analyzeBottlenecks(metrics, Number.NaN)[0].severity).toBe('high')
    expect(PerformanceAnalyzer.analyzeBottlenecks(metrics, Number.POSITIVE_INFINITY)[0].severity).toBe('high')
  })

  it('analyzeBottlenecks：负阈值夹到 0（此前 `avg > 负数` 恒真，未超阈值项也被标成 high）', () => {
    const [row] = PerformanceAnalyzer.analyzeBottlenecks([metric('a', 0.5)], -1)
    expect(row.avgDuration).toBe(0.5)
    // 夹到 0 后 0.5 > 0 仍判 high（预警不被关掉），但至少不会把 0 耗时也标成 high
    expect(PerformanceAnalyzer.analyzeBottlenecks([metric('a', 0)], -1)[0].severity).toBe('low')
    expect(row.severity).toBe('high')
  })

  it('analyzeBottlenecks：合法阈值行为不变', () => {
    expect(PerformanceAnalyzer.analyzeBottlenecks(metrics, 16)[0].severity).toBe('high')
    expect(PerformanceAnalyzer.analyzeBottlenecks([metric('a', 40)], 16)[0].severity).toBe('medium')
    expect(PerformanceAnalyzer.analyzeBottlenecks([metric('a', 10)], 16)[0].severity).toBe('low')
  })

  it('detectRegression：NaN 阈值回落默认 0.2（此前一条回归都不报）', () => {
    const current = [metric('a', 30)]
    const baseline = [metric('a', 10)]

    expect(PerformanceAnalyzer.detectRegression(current, baseline, Number.NaN)).toHaveLength(1)
    expect(PerformanceAnalyzer.detectRegression(current, baseline, Number.NaN)[0].changePercent).toBeCloseTo(200)
  })

  it('detectRegression：负阈值夹到 0，明显改善不再被报成退化', () => {
    // -0.1 的改动在 `changePercent > -0.5` 下会被旧实现报成退化
    expect(PerformanceAnalyzer.detectRegression([metric('a', 9)], [metric('a', 10)], -0.5)).toHaveLength(0)
    // 夹到 0 后仍报真实退化
    expect(PerformanceAnalyzer.detectRegression([metric('a', 30)], [metric('a', 10)], -0.5)).toHaveLength(1)
  })

  it('detectRegression：Infinity 阈值回落默认，不至于一报一漏两个门分叉', () => {
    expect(PerformanceAnalyzer.detectRegression([metric('a', 30)], [metric('a', 10)], Number.POSITIVE_INFINITY)).toHaveLength(1)
  })
})
