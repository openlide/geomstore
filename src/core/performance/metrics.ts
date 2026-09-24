/**
 * GeomStore - 性能指标采集
 *
 * 提供性能指标的收集、批量操作、筛选排序、统计分析与退化检测能力。
 *
 */

import type { PerformanceMetrics, PerformanceStats } from '../../types/performance.js'

/** 单个操作的耗时汇总：所有按操作分组的统计都从 summarizeByOperation 的这份结果派生 */
interface OperationSummary {
  /** 样本条数（含耗时不可测量的样本） */
  count: number
  /** 耗时为有限数的样本条数：平均/最大耗时的分母，0 表示该组没有任何可测量样本 */
  durationCount: number
  /** 有限样本的耗时之和 */
  totalDuration: number
  /** 有限样本中的最大耗时；无有限样本时为 -Infinity，由投影层归一为 0 */
  maxDuration: number
}

/**
 * 耗时是否可入统计。
 *
 * `PerformanceMetrics.duration` 的类型是 `number`，因而合法包含 NaN/Infinity：宿主自己算
 * 耗时（两侧时钟读数缺失、跨基准相减）或调用方漏传 duration 都会落进这里。非有限值一旦
 * 参与累加就污染整份结果（`totalDuration += NaN` 让 avgDuration 恒为 NaN），而
 * `NaN > max` / `NaN < min` 恒假又把这些样本从 max/min 里静默剔除——同一份数据 avg 是
 * NaN、max 却是个正常毫秒数，自相矛盾。故统一把它们排除在耗时聚合之外（仍计入 count，
 * 因为「这次操作确实发生过」），与本文件 getPercentile 的 Number.isFinite 早失败、
 * PerformanceMonitor.normalizeThreshold / getCurrentTime 的非有限读数降级同口径。
 */
const isMeasurableDuration = (duration: number): boolean => Number.isFinite(duration)

/**
 * 规范化阈值：非有限值（NaN/Infinity）回退默认、负值夹到 0。
 *
 * 与 PerformanceMonitor.normalizeThreshold 同一口径——那里的注释写的就是本处的失败模式
 * （「NaN 阈值会让 duration > NaN 恒为 false，超阈值预警静默失效」）。threshold 常见来路是
 * 从配置/环境变量取数（`Number(cfg.threshold)` 取不到即 NaN），恰好最容易静默失效；
 * 负阈值则反向失效（`avgDuration > 负数` 对所有非负耗时恒真 ⇒ 全部标成最严重程度）。
 * 本文件是同一算法的另外两个门（analyzeBottlenecks / detectRegression），故在此复刻一份
 * 而不是去 import 那个 private static：跨类调用私有成员要么放宽 PerformanceMonitor 的
 * 可见性（改动落在本分片之外）要么绕，都不如把口径写清楚。
 */
function normalizeThreshold(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback
}

/**
 * 按操作名分组汇总耗时（单次遍历）。
 *
 * 累加器用 Map 而非 Record：operation 名来自业务，可为 '__proto__'/'constructor' 等，
 * 普通对象上 `if (!acc[op])` 会命中原型成员从而跳过初始化，随后 `acc[op].count++`
 * 直接写脏 Object.prototype（全局污染），或在 push 路径抛 TypeError。
 * 需要普通对象结果形的调用方自行 `Object.fromEntries`（按键定义为自有数据属性，
 * 不触发 `__proto__` setter），读侧则没有原型链误命中的问题（Map.get 只认自有键）。
 *
 * 四个统计入口（computePerformanceStats / getHotPaths / analyzeBottlenecks /
 * detectRegression）共用本函数：分组口径只需改一处。
 */
function summarizeByOperation(metrics: PerformanceMetrics[]): Map<string, OperationSummary> {
  const byOperation = new Map<string, OperationSummary>()

  for (const metric of metrics) {
    let entry = byOperation.get(metric.operation)
    if (!entry) {
      entry = { count: 0, durationCount: 0, totalDuration: 0, maxDuration: -Infinity }
      byOperation.set(metric.operation, entry)
    }
    entry.count++
    // 非有限耗时只进 count，不进任何耗时聚合（见 isMeasurableDuration）
    if (!isMeasurableDuration(metric.duration)) continue
    entry.durationCount++
    entry.totalDuration += metric.duration
    if (metric.duration > entry.maxDuration) entry.maxDuration = metric.duration
  }

  return byOperation
}

/** 无有限样本时的平均耗时（0 而非 NaN：NaN 会顺着报表一路传到 JSON 导出变成 null） */
const averageOf = (summary: OperationSummary): number => (summary.durationCount > 0 ? summary.totalDuration / summary.durationCount : 0)

/** 无有限样本时的最大耗时（把 -Infinity 初值挡在对外结果之外） */
const maxOf = (summary: OperationSummary): number => (summary.durationCount > 0 ? summary.maxDuration : 0)

/**
 * 由指标数组计算性能统计（平均/最大/最小耗时、总次数、超阈值次数、按操作分组）。
 *
 * 抽为纯函数以消除 PerformanceMonitor.getStats 与 MetricsCollector.calculateStats
 * 的重复实现（同一算法的两份拷贝）。
 *
 * @remarks 耗时为非有限数（NaN/Infinity）的样本**不入耗时聚合**：`totalCount` 仍计入该次
 * 调用（操作确实发生过），但 avg/max/min 只在可测量的样本上计算；一组样本全非有限时
 * avg/max/min 均为 0。理由见 {@link isMeasurableDuration}。
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
  // 超阈值计数在同一趟循环里累加：再走一遍 metrics.filter(...).length 会让热路径
  // 多一次全量遍历加一个中间数组，而这里正是被监控操作自己的路径
  let maxDuration = -Infinity
  let minDuration = Infinity
  let totalDuration = 0
  let thresholdExceeded = 0
  // 有限样本数：avg 的分母，也是「全组耗时都不可测量」时 max/min 的归一判据
  let durationCount = 0
  for (const m of metrics) {
    if (m.exceedThreshold) thresholdExceeded++
    if (!isMeasurableDuration(m.duration)) continue
    durationCount++
    totalDuration += m.duration
    if (m.duration > maxDuration) maxDuration = m.duration
    if (m.duration < minDuration) minDuration = m.duration
  }
  const avgDuration = durationCount > 0 ? totalDuration / durationCount : 0

  return {
    avgDuration,
    // 一条有限耗时都没有时（样本全是 NaN/Infinity）返回 0 而非 ±Infinity：
    // 后者会被 JSON.stringify 序列化成 null，对外看成像「缺字段」的统计结果
    maxDuration: durationCount > 0 ? maxDuration : 0,
    minDuration: durationCount > 0 ? minDuration : 0,
    totalCount: metrics.length,
    thresholdExceeded,
    byOperation: Object.fromEntries(
      Array.from(
        summarizeByOperation(metrics),
        ([operation, summary]) =>
          [
            operation,
            {
              count: summary.count,
              avgDuration: averageOf(summary),
              maxDuration: maxOf(summary),
            },
          ] as [string, PerformanceStats['byOperation'][string]],
      ),
    ),
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
   * @param {(metric: PerformanceMetrics) => boolean} predicate - 筛选函数
   * @returns {MetricsCollector} 包含筛选结果的新采集器
   */
  filter(predicate: (metric: PerformanceMetrics) => boolean): MetricsCollector {
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

    // 非有限耗时先滤掉再排序：同文件的 computePerformanceStats / summarizeByOperation
    // 都经 isMeasurableDuration 过滤，唯独这里不滤——`a - b` 比较器拿到 NaN 返回 NaN
    // （等价于「不移动」），NaN 元素可能停在任何位置，index 落上去就返回 NaN，
    // 而同一份数据在 calculateStats() 里是确定性地被排除的
    const sorted = this._ordered()
      .map((m) => m.duration)
      .filter(isMeasurableDuration)
      .sort((a, b) => a - b)

    // 过滤后可能为空（采到的全是非有限耗时），与「采集器为空」同口径返回 0，
    // 否则 sorted.length - 1 会是 -1，读出 undefined
    if (sorted.length === 0) return 0

    const index = Math.min(Math.floor((percentile / 100) * sorted.length), sorted.length - 1)
    return sorted[index]
  }

  /**
   * 获取热路径（最频繁的操作）
   *
   * 返回最频繁操作列表，包含执行次数和平均耗时。
   *
   * @param {number} [limit=5] - 返回的热路径数量；小数向下取整，非有限值（NaN/Infinity）、
   *   0 与负数一律按 0 处理（返回空数组），与 PerformanceMonitor.getRecentMetrics 同口径
   * @returns {Array<{operation: string, count: number, avgDuration: number}>} 热路径数组
   */
  getHotPaths(limit: number = 5): Array<{ operation: string; count: number; avgDuration: number }> {
    const take = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0

    return Array.from(summarizeByOperation(this._ordered()), ([operation, summary]) => ({
      operation,
      count: summary.count,
      avgDuration: averageOf(summary),
    }))
      .sort((a, b) => b.count - a.count)
      .slice(0, take)
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
   *   > 3×threshold 记 high，否则 low（threshold 本身不是过滤门槛）。
   *   非有限值（NaN/Infinity）回落默认 16、负值夹到 0，见 {@link normalizeThreshold}
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
    // 分组走共享累加器：本函数只需要次数/平均/最大三项，无须先攒出每组的消息数组再重算
    const groups = summarizeByOperation(metrics)
    // 未规范化的 NaN 阈值会让两条 `avgDuration > NaN` 判定恒假 ⇒ 所有操作一律 'low'，
    // 瓶颈面板显示「一切正常」；负阈值反向让全部操作标成 'high'
    const effectiveThreshold = normalizeThreshold(threshold, 16)

    return Array.from(groups, ([operation, summary]) => {
      const avgDuration = averageOf(summary)

      let severity: 'low' | 'medium' | 'high' = 'low'
      if (avgDuration > effectiveThreshold * 3) {
        severity = 'high'
      } else if (avgDuration > effectiveThreshold * 2) {
        severity = 'medium'
      }

      return {
        operation,
        count: summary.count,
        avgDuration,
        maxDuration: maxOf(summary),
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
   * @param {number} [threshold=0.2] - 退化阈值（比例，0.2 表示 20%）。
   *   非有限值回落默认 0.2、负值夹到 0，见 {@link normalizeThreshold}
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
    // 与 analyzeBottlenecks 同一个门：`changePercent > NaN` 恒假 ⇒ 一条回归都不报，
    // `changePercent > -0.5` 恒真 ⇒ 明显改善也被报成退化
    const effectiveThreshold = normalizeThreshold(threshold, 0.2)
    const regressions: Array<{
      operation: string
      baselineDuration: number
      currentDuration: number
      change: number
      changePercent: number
    }> = []

    for (const [operation, currentDuration] of currentStats) {
      // 读侧同样按 Map 取：落回普通对象后 `baselineStats[operation]` 对未出现在基线里、
      // 却命中原型成员的操作名（'constructor'/'toString'/'hasOwnProperty'…）会取到继承的
      // 函数，`!== undefined` 守卫随之放行，change/changePercent 变 NaN 且这条被静默丢弃
      const baselineDuration = baselineStats.get(operation)

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

        if (changePercent > effectiveThreshold) {
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
   * @returns {Map<string, number>} 按操作分组的平均持续时间
   */
  private static calculateAvgDurations(metrics: PerformanceMetrics[]): Map<string, number> {
    // 返回 Map 而非 Record：读侧按操作名取值时不会沿原型链命中原型成员，
    // 调用方（detectRegression）因此无需自备 own-property 守卫
    const averages = new Map<string, number>()
    for (const [operation, summary] of summarizeByOperation(metrics)) {
      averages.set(operation, averageOf(summary))
    }

    return averages
  }
}

/** 默认导出 */
export type { PerformanceMetrics, PerformanceStats } from '../../types/performance.js'
