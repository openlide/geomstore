/**
 * GeomStore - 性能指标采集
 *
 * 提供性能指标的收集、批量操作、筛选排序、统计分析与退化检测能力。
 *
 */

import type { PerformanceMetrics, PerformanceStats } from '../../types/performance.js'

/**
 * 由指标数组计算性能统计（平均/最大/最小耗时、总次数、超阈值次数、按操作分组）。
 *
 * 抽为纯函数以消除 PerformanceMonitor.getStats 与 MetricsCollector.calculateStats
 * 的重复实现（同一算法的两份拷贝）。
 *
 * @param metrics - 性能指标数组
 * @returns {PerformanceStats} 性能统计对象
 */
export function computePerformanceStats(metrics: PerformanceMetrics[]): PerformanceStats {
  if (metrics.length === 0) {
    return {
      avgDuration: 0,
      maxDuration: 0,
      minDuration: 0,
      totalCount: 0,
      thresholdExceeded: 0,
      byOperation: {},
    }
  }

  // 循环累计而非 Math.max(...durations)：大样本下 spread 栈溢出
  let maxDuration = -Infinity
  let minDuration = Infinity
  let totalDuration = 0
  for (const m of metrics) {
    totalDuration += m.duration
    if (m.duration > maxDuration) maxDuration = m.duration
    if (m.duration < minDuration) minDuration = m.duration
  }
  const avgDuration = totalDuration / metrics.length
  const thresholdExceeded = metrics.filter((m) => m.exceedThreshold).length

  // 按操作分组（单次遍历，避免 O(n×k) 的重复 filter）。
  // 累加器用 Map 而非 Record：operation 名来自业务，可为 '__proto__'/'constructor' 等，
  // 普通对象上 `if (!acc[op])` 会命中原型成员从而跳过初始化，随后 `acc[op].count++`
  // 直接写脏 Object.prototype（全局污染），或在 push 路径抛 TypeError。
  // 结果经 Object.fromEntries 落回普通对象（按键定义为自有属性，不触发 __proto__ setter）
  const byOperation = new Map<string, { count: number; avgDuration: number; maxDuration: number }>()
  // 累加器：记录每个操作的总时长
  const opSums = new Map<string, number>()
  for (const metric of metrics) {
    const op = metric.operation
    let entry = byOperation.get(op)
    if (!entry) {
      entry = { count: 0, avgDuration: 0, maxDuration: 0 }
      byOperation.set(op, entry)
      opSums.set(op, 0)
    }
    entry.count++
    entry.maxDuration = Math.max(entry.maxDuration, metric.duration)
    opSums.set(op, (opSums.get(op) as number) + metric.duration)
  }
  // 计算平均值
  for (const [op, entry] of byOperation) {
    entry.avgDuration = (opSums.get(op) as number) / entry.count
  }

  return {
    avgDuration,
    maxDuration,
    minDuration,
    totalCount: metrics.length,
    thresholdExceeded,
    byOperation: Object.fromEntries(byOperation),
  }
}

/**
 * 性能指标采集器
 *
 * 用于收集和管理性能指标数据。
 */
export class MetricsCollector {
  /** 默认指标容量上限：超出后淘汰最旧条目，防止长生命周期采集无限增长 */
  static readonly DEFAULT_MAX_SIZE = 10000

  /**
   * 环形缓冲：定长数组 + 最旧元素游标 + 有效长度。
   *
   * 取代「push + 满员后 splice(0, 1)」：满员后每条指标都要前移整个 10000 元素数组
   * （O(n)），而采集器正处在被监控操作的热路径上。环形写入是 O(1)。
   */
  private buffer: PerformanceMetrics[] = []

  /** 最旧元素下标（缓冲未满时恒为 0） */
  private oldest = 0

  /** 有效条目数 */
  private _count = 0

  /** 容量上限 */
  private readonly _maxSize: number

  /**
   * @param maxSize - 容量上限（默认 10000，超出后淘汰最旧条目）
   */
  constructor(maxSize: number = MetricsCollector.DEFAULT_MAX_SIZE) {
    // 环形写入依赖整数下标：NaN/负数/小数会让 `length % maxSize` 取到空洞下标，
    // 静默丢数据或无界增长，故与 PerformanceMonitor.normalizeMaxSize 同口径规范化
    this._maxSize = Number.isFinite(maxSize) ? Math.max(0, Math.floor(maxSize)) : MetricsCollector.DEFAULT_MAX_SIZE
  }

  /**
   * 收集指标
   *
   * 添加单个性能指标到采集器。
   *
   * @param {PerformanceMetrics} metric - 单条性能指标（形参名与私有字段 `metrics` 区分，
   *   复数命名会让调用方误以为可传数组）
   */
  collect(metric: PerformanceMetrics): void {
    if (this._maxSize === 0) {
      return
    }
    if (this._count < this._maxSize) {
      this.buffer.push(metric)
      this._count++
      return
    }
    // 满员：覆盖最旧槽位并把游标前移，写入顺序仍等价于「淘汰最旧、保留最新」
    this.buffer[this.oldest] = metric
    this.oldest = (this.oldest + 1) % this._maxSize
  }

  /**
   * 批量收集指标
   *
   * 一次性添加多个性能指标。
   *
   * @param {PerformanceMetrics[]} metricsList - 性能指标数组
   */
  collectBatch(metricsList: PerformanceMetrics[]): void {
    // 逐条写入而非 push(...list)：spread 展开为函数参数，
    // 大数组（实测 20 万条）直接抛 RangeError 栈溢出
    for (const metric of metricsList) {
      this.collect(metric)
    }
  }

  /**
   * 按写入顺序展开环形缓冲
   *
   * 读取路径统一走此方法，调用方拿不到内部数组，
   * 也就无法通过原地改写缓冲数组绕过容量约束
   *
   * @private
   */
  private _ordered(): PerformanceMetrics[] {
    if (this._count === 0 || this.oldest === 0) {
      return this.buffer.slice()
    }
    return this.buffer.slice(this.oldest).concat(this.buffer.slice(0, this.oldest))
  }

  /**
   * 获取所有指标
   *
   * 返回所有已收集性能指标的副本。
   *
   * @returns {PerformanceMetrics[]} 指标数组副本
   */
  getAll(): PerformanceMetrics[] {
    return this._ordered()
  }

  /** 清空所有指标 */
  clear(): void {
    this.buffer = []
    this.oldest = 0
    this._count = 0
  }

  /**
   * 获取指标数量
   *
   * @returns {number} 已收集的指标数量
   */
  count(): number {
    return this._count
  }

  /**
   * 计算统计信息
   *
   * 计算平均/最大/最小耗时、总次数、超阈值次数，并按操作分组统计。
   *
   * @returns {PerformanceStats} 性能统计对象
   */
  calculateStats(): PerformanceStats {
    return computePerformanceStats(this._ordered())
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
    collector.collectBatch(this._ordered().filter(predicate))
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
    const sorted = this._ordered().sort((a, b) => (ascending ? a.duration - b.duration : b.duration - a.duration))
    collector.collectBatch(sorted)
    return collector
  }

  /**
   * 获取百分位数
   *
   * 计算指定百分位数的持续时间。
   *
   * @param {number} percentile - 百分位数（0-100）
   * @returns {number} 指定百分位数的持续时间；采集器为空时返回 0
   * @throws {RangeError} percentile 非有限数或落在 [0,100] 之外
   */
  getPercentile(percentile: number): number {
    // 参数校验先于「空采集器」短路：否则同一非法入参在有数据和无数据时行为不同
    // （空集返回 0、非空抛 RangeError），调用方的错误处理路径会随运行时机漂移
    if (!Number.isFinite(percentile) || percentile < 0 || percentile > 100) {
      throw new RangeError(`[GeomStore] getPercentile: percentile must be between 0 and 100, got ${percentile}`)
    }

    if (this._count === 0) return 0

    const sorted = this._ordered()
      .map((m) => m.duration)
      .sort((a, b) => a - b)

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
    // Map 累加：操作名可为 '__proto__'，普通对象累加会命中原型成员（同 computePerformanceStats）
    const operationCounts = new Map<string, { count: number; totalDuration: number }>()

    for (const metric of this._ordered()) {
      let entry = operationCounts.get(metric.operation)
      if (!entry) {
        entry = { count: 0, totalDuration: 0 }
        operationCounts.set(metric.operation, entry)
      }
      entry.count++
      entry.totalDuration += metric.duration
    }

    return Array.from(operationCounts, ([operation, data]) => ({
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
   * 按操作分组统计，并以 threshold 的倍数标定严重程度。
   *
   * @remarks 返回值**不是**「超阈值操作的子集」：入参中出现过的每个操作都会各出一条，
   * 未超阈值（`avgDuration <= threshold * 2`）的以 `severity: 'low'` 一并返回，
   * 结果按 avgDuration 降序排列。调用方若只要瓶颈，请自行按 severity 过滤，
   * 不能把列表长度当作「超标操作数」。
   *
   * @param {PerformanceMetrics[]} metrics - 性能指标数组
   * @param {number} [threshold=16] - 性能阈值（毫秒）：avgDuration > 2×threshold 记 medium、
   *   > 3×threshold 记 high，否则 low（threshold 本身不是过滤门槛）
   * @returns {Array<{operation: string, count: number, avgDuration: number, maxDuration: number, severity: 'low' | 'medium' | 'high'}>} 全部操作的分组列表（按 avgDuration 降序），含未超阈值项
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
    // Map 分组：操作名可为 '__proto__'，普通对象累加会命中原型成员（同 computePerformanceStats）
    const byOperation = new Map<string, PerformanceMetrics[]>()

    for (const metric of metrics) {
      let ops = byOperation.get(metric.operation)
      if (!ops) {
        ops = []
        byOperation.set(metric.operation, ops)
      }
      ops.push(metric)
    }

    return Array.from(byOperation, ([operation, ops]) => {
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
    }).sort((a, b) => b.avgDuration - a.avgDuration)
  }

  /**
   * 检测性能退化
   *
   * 对比当前与基准指标，返回平均耗时增长超过阈值的操作列表。
   *
   * @param {PerformanceMetrics[]} currentMetrics - 当前性能指标
   * @param {PerformanceMetrics[]} baselineMetrics - 基准性能指标
   * @param {number} [threshold=0.2] - 退化阈值（比例，0.2 表示 20%）
   * @returns {Array<{operation: string, baselineDuration: number, currentDuration: number, change: number, changePercent: number}>} 退化列表。
   *   基线为 0 而当前有耗时时无比例可算，changePercent 取 Infinity 哨兵（幅度按无限恶化处理）
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
        let changePercent: number
        if (baselineDuration > 0) {
          changePercent = change / baselineDuration
        } else {
          // 0 基线无法按比例放大：只要当前有耗时即按「无限恶化」计（Infinity 哨兵，
          // 见 @returns 说明），当前同样为 0 才是真无变化
          changePercent = currentDuration > 0 ? Infinity : 0
        }

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

    // 两条 0 基线退化同为 Infinity 时相减得 NaN，排序结果未定义；
    // 等值先判 0，保持入参顺序（均为无限恶化，谁前谁后无意义）
    return regressions.sort((a, b) => (a.changePercent === b.changePercent ? 0 : b.changePercent - a.changePercent))
  }

  /**
   * 计算平均持续时间
   *
   * @private
   * @param {PerformanceMetrics[]} metrics - 性能指标数组
   * @returns {Record<string, number>} 按操作分组的平均持续时间
   */
  private static calculateAvgDurations(metrics: PerformanceMetrics[]): Record<string, number> {
    // Map 累加后由 Object.fromEntries 落回普通对象：普通对象按操作名累加时，
    // '__proto__'/'constructor' 之类的操作名会命中原型成员，写入即污染 Object.prototype
    const byOperation = new Map<string, { sum: number; count: number }>()

    for (const metric of metrics) {
      let entry = byOperation.get(metric.operation)
      if (!entry) {
        entry = { sum: 0, count: 0 }
        byOperation.set(metric.operation, entry)
      }
      entry.sum += metric.duration
      entry.count++
    }

    const result = new Map<string, number>()
    for (const [op, data] of byOperation) {
      result.set(op, data.sum / data.count)
    }

    return Object.fromEntries(result)
  }
}

/** 默认导出 */
export type { PerformanceMetrics, PerformanceStats } from '../../types/performance.js'
