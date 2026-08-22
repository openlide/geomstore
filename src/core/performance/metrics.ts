/**
 * GeomStore v1.0 - 性能指标采集
 *
 * 提供性能指标的收集、批量操作、筛选排序、统计分析与退化检测能力。
 *
 * @since 1.0.0
 */

import type { PerformanceMetrics, PerformanceStats } from '../../types/performance'

/**
 * 性能指标采集器
 *
 * 用于收集和管理性能指标数据。
 */
export class MetricsCollector {
  /** 默认指标容量上限：超出后淘汰最旧条目，防止长生命周期采集无限增长 */
  static readonly DEFAULT_MAX_SIZE = 10000

  /** 性能指标数组 */
  private metrics: PerformanceMetrics[] = []

  /** 容量上限 */
  private readonly _maxSize: number

  /**
   * @param maxSize - 容量上限（默认 10000，超出后淘汰最旧条目）
   */
  constructor(maxSize: number = MetricsCollector.DEFAULT_MAX_SIZE) {
    this._maxSize = maxSize
  }

  /**
   * 收集指标
   *
   * 添加单个性能指标到采集器。
   *
   * @param {PerformanceMetrics} metrics - 性能指标
   */
  collect(metrics: PerformanceMetrics): void {
    this.metrics.push(metrics)
    this._trim()
  }

  /**
   * 批量收集指标
   *
   * 一次性添加多个性能指标。
   *
   * @param {PerformanceMetrics[]} metricsList - 性能指标数组
   */
  collectBatch(metricsList: PerformanceMetrics[]): void {
    // 循环写入而非 push(...list)：spread 展开为函数参数，
    // 大数组（实测 20 万条）直接抛 RangeError 栈溢出
    for (const metric of metricsList) {
      this.metrics.push(metric)
    }
    this._trim()
  }

  /**
   * 超出容量上限时淘汰最旧条目
   *
   * @private
   */
  private _trim(): void {
    if (this.metrics.length > this._maxSize) {
      this.metrics.splice(0, this.metrics.length - this._maxSize)
    }
  }

  /**
   * 获取所有指标
   *
   * 返回所有已收集性能指标的副本。
   *
   * @returns {PerformanceMetrics[]} 指标数组副本
   */
  getAll(): PerformanceMetrics[] {
    return [...this.metrics]
  }

  /** 清空所有指标 */
  clear(): void {
    this.metrics = []
  }

  /**
   * 获取指标数量
   *
   * @returns {number} 已收集的指标数量
   */
  count(): number {
    return this.metrics.length
  }

  /**
   * 计算统计信息
   *
   * 计算平均/最大/最小耗时、总次数、超阈值次数，并按操作分组统计。
   *
   * @returns {PerformanceStats} 性能统计对象
   */
  calculateStats(): PerformanceStats {
    if (this.metrics.length === 0) {
      return {
        avgDuration: 0,
        maxDuration: 0,
        minDuration: 0,
        totalCount: 0,
        thresholdExceeded: 0,
        byOperation: {},
      }
    }

    // reduce 累计而非 Math.max(...durations)：大样本下 spread 同样栈溢出
    let maxDuration = -Infinity
    let minDuration = Infinity
    let totalDuration = 0
    for (const d of this.metrics) {
      totalDuration += d.duration
      if (d.duration > maxDuration) maxDuration = d.duration
      if (d.duration < minDuration) minDuration = d.duration
    }
    const avgDuration = totalDuration / this.metrics.length
    const thresholdExceeded = this.metrics.filter((m) => m.exceedThreshold).length

    // 按操作分组（单次遍历，避免 O(n×k) 的重复 filter）
    const byOperation: Record<
      string,
      {
        count: number
        avgDuration: number
        maxDuration: number
      }
    > = {}

    // 累加器：记录每个操作的总时长
    const opSums: Record<string, number> = {}

    for (const metric of this.metrics) {
      const op = metric.operation
      if (!byOperation[op]) {
        byOperation[op] = {
          count: 0,
          avgDuration: 0,
          maxDuration: 0,
        }
        opSums[op] = 0
      }

      byOperation[op].count++
      byOperation[op].maxDuration = Math.max(byOperation[op].maxDuration, metric.duration)
      opSums[op] += metric.duration
    }

    // 计算平均值
    for (const op in byOperation) {
      byOperation[op].avgDuration = opSums[op] / byOperation[op].count
    }

    return {
      avgDuration,
      maxDuration,
      minDuration,
      totalCount: this.metrics.length,
      thresholdExceeded,
      byOperation,
    }
  }

  /**
   * 筛选指标
   *
   * 根据谓词函数筛选指标，返回包含筛选结果的新采集器。
   *
   * @param {(metrics: PerformanceMetrics) => boolean} predicate - 筛选函数
   * @returns {MetricsCollector} 包含筛选结果的新采集器
   */
  filter(predicate: (metrics: PerformanceMetrics) => boolean): MetricsCollector {
    const collector = new MetricsCollector(this._maxSize)
    const filtered = this.metrics.filter(predicate)
    collector.collectBatch(filtered)
    return collector
  }

  /**
   * 按时间范围筛选
   *
   * 筛选指定时间范围内（含端点）的所有指标。
   *
   * @param {number} startTime - 开始时间戳
   * @param {number} endTime - 结束时间戳
   * @returns {MetricsCollector} 包含筛选结果的新采集器
   */
  filterByTimeRange(startTime: number, endTime: number): MetricsCollector {
    return this.filter((m) => m.timestamp >= startTime && m.timestamp <= endTime)
  }

  /**
   * 按操作筛选
   *
   * 筛选指定操作名称的所有指标。
   *
   * @param {string} operation - 操作名称
   * @returns {MetricsCollector} 包含筛选结果的新采集器
   */
  filterByOperation(operation: string): MetricsCollector {
    return this.filter((m) => m.operation === operation)
  }

  /**
   * 排序指标
   *
   * 按持续时间排序，返回包含排序结果的新采集器。
   *
   * @param {boolean} [ascending=false] - 是否升序（默认降序）
   * @returns {MetricsCollector} 包含排序结果的新采集器
   */
  sortByDuration(ascending: boolean = false): MetricsCollector {
    const collector = new MetricsCollector(this._maxSize)
    const sorted = [...this.metrics].sort((a, b) => (ascending ? a.duration - b.duration : b.duration - a.duration))
    collector.collectBatch(sorted)
    return collector
  }

  /**
   * 获取百分位数
   *
   * 计算指定百分位数的持续时间。
   *
   * @param {number} percentile - 百分位数（0-100）
   * @returns {number} 指定百分位数的持续时间
   */
  getPercentile(percentile: number): number {
    if (this.metrics.length === 0) return 0

    // 边界校验：负数会取到负索引（undefined），>100 无意义，直接抛错而非静默失真
    if (!Number.isFinite(percentile) || percentile < 0 || percentile > 100) {
      throw new RangeError(`[GeomStore] getPercentile: percentile must be between 0 and 100, got ${percentile}`)
    }

    const sorted = [...this.metrics].map((m) => m.duration).sort((a, b) => a - b)

    const index = Math.min(Math.floor((percentile / 100) * sorted.length), sorted.length - 1)
    return sorted[index]
  }

  /**
   * 获取热路径（最频繁的操作）
   *
   * 返回最频繁操作列表，包含执行次数和平均耗时。
   *
   * @param {number} [limit=5] - 返回的热路径数量
   * @returns {Array<{operation: string, count: number, avgDuration: number}>} 热路径数组
   */
  getHotPaths(limit: number = 5): Array<{ operation: string; count: number; avgDuration: number }> {
    const operationCounts: Record<string, { count: number; totalDuration: number }> = {}

    for (const metric of this.metrics) {
      if (!operationCounts[metric.operation]) {
        operationCounts[metric.operation] = { count: 0, totalDuration: 0 }
      }
      operationCounts[metric.operation].count++
      operationCounts[metric.operation].totalDuration += metric.duration
    }

    return Object.entries(operationCounts)
      .map(([operation, data]) => ({
        operation,
        count: data.count,
        avgDuration: data.totalDuration / data.count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit)
  }
}

/**
 * 性能分析工具
 *
 * 提供静态方法用于分析性能数据（瓶颈识别与退化检测）。
 */
export class PerformanceAnalyzer {
  /**
   * 分析性能瓶颈
   *
   * 识别超过阈值的性能瓶颈，按平均耗时相对阈值的倍数分级严重程度。
   *
   * @param {PerformanceMetrics[]} metrics - 性能指标数组
   * @param {number} [threshold=16] - 性能阈值（毫秒）
   * @returns {Array<{operation: string, count: number, avgDuration: number, maxDuration: number, severity: 'low' | 'medium' | 'high'}>} 瓶颈列表
   */
  static analyzeBottlenecks(
    metrics: PerformanceMetrics[],
    threshold: number = 16,
  ): Array<{
    operation: string
    count: number
    avgDuration: number
    maxDuration: number
    severity: 'low' | 'medium' | 'high'
  }> {
    const byOperation: Record<string, PerformanceMetrics[]> = {}

    for (const metric of metrics) {
      if (!byOperation[metric.operation]) {
        byOperation[metric.operation] = []
      }
      byOperation[metric.operation].push(metric)
    }

    return Object.entries(byOperation)
      .map(([operation, ops]) => {
        const count = ops.length
        let totalDuration = 0
        let maxDuration = -Infinity
        for (const o of ops) {
          totalDuration += o.duration
          if (o.duration > maxDuration) maxDuration = o.duration
        }
        const avgDuration = totalDuration / count

        let severity: 'low' | 'medium' | 'high' = 'low'
        if (avgDuration > threshold * 3) {
          severity = 'high'
        } else if (avgDuration > threshold * 2) {
          severity = 'medium'
        }

        return {
          operation,
          count,
          avgDuration,
          maxDuration,
          severity,
        }
      })
      .sort((a, b) => b.avgDuration - a.avgDuration)
  }

  /**
   * 检测性能退化
   *
   * 对比当前与基准指标，返回平均耗时增长超过阈值的操作列表。
   *
   * @param {PerformanceMetrics[]} currentMetrics - 当前性能指标
   * @param {PerformanceMetrics[]} baselineMetrics - 基准性能指标
   * @param {number} [threshold=0.2] - 退化阈值（比例，0.2 表示 20%）
   * @returns {Array<{operation: string, baselineDuration: number, currentDuration: number, change: number, changePercent: number}>} 退化列表
   */
  static detectRegression(
    currentMetrics: PerformanceMetrics[],
    baselineMetrics: PerformanceMetrics[],
    threshold: number = 0.2,
  ): Array<{
    operation: string
    baselineDuration: number
    currentDuration: number
    change: number
    changePercent: number
  }> {
    const currentStats = this.calculateAvgDurations(currentMetrics)
    const baselineStats = this.calculateAvgDurations(baselineMetrics)
    const regressions: Array<{
      operation: string
      baselineDuration: number
      currentDuration: number
      change: number
      changePercent: number
    }> = []

    for (const [operation, currentDuration] of Object.entries(currentStats)) {
      const baselineDuration = baselineStats[operation]

      // 基线为 0（亚毫秒取整）此前被 falsy 判断静默跳过，回归不上报；
      // 0 基线且当前恶化时按无限恶化处理
      if (baselineDuration !== undefined) {
        const change = currentDuration - baselineDuration
        const changePercent = baselineDuration > 0 ? change / baselineDuration : currentDuration > 0 ? Infinity : 0

        if (changePercent > threshold) {
          regressions.push({
            operation,
            baselineDuration,
            currentDuration,
            change,
            changePercent: changePercent * 100,
          })
        }
      }
    }

    return regressions.sort((a, b) => b.changePercent - a.changePercent)
  }

  /**
   * 计算平均持续时间
   *
   * @private
   * @param {PerformanceMetrics[]} metrics - 性能指标数组
   * @returns {Record<string, number>} 按操作分组的平均持续时间
   */
  private static calculateAvgDurations(metrics: PerformanceMetrics[]): Record<string, number> {
    const byOperation: Record<string, { sum: number; count: number }> = {}

    for (const metric of metrics) {
      if (!byOperation[metric.operation]) {
        byOperation[metric.operation] = { sum: 0, count: 0 }
      }
      byOperation[metric.operation].sum += metric.duration
      byOperation[metric.operation].count++
    }

    const result: Record<string, number> = {}
    for (const [op, data] of Object.entries(byOperation)) {
      result[op] = data.sum / data.count
    }

    return result
  }
}

/** 默认导出 */
export type { PerformanceMetrics, PerformanceStats } from '../../types/performance'
