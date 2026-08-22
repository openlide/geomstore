/**
 * GeomStore v1.0 - 性能监控器
 *
 * 提供全面的性能监控功能，包括：
 * - 操作计时
 * - 性能指标记录
 * - 性能统计分析
 * - 阈值预警
 * - 内存使用监控
 * - 数据导出
 *
 * @since 1.0.0
 */

import type {
  PerformanceMonitor as PerformanceMonitorInterface,
  PerformanceMetrics,
  PerformanceOptions,
  PerformanceStats,
  MetricType,
} from '../../types/performance'

/**
 * 性能监控器实现类
 *
 * 用于监控Store操作的性能，记录和分析执行时间
 *
 * @class PerformanceMonitor
 * @implements PerformanceMonitor
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const monitor = new PerformanceMonitor({
 *   sampleRate: 1.0,       // 100%采样率
 *   threshold: 16,        // 16ms阈值（60fps）
 *   trackMemory: true,    // 跟踪内存使用
 *   maxSize: 1000         // 最多保留1000条记录
 * })
 *
 * // 监控操作
 * const endDispatch = monitor.start('fetchData', 'dispatch')
 * await store.dispatch('fetchData', 'user-123')
 * endDispatch()
 *
 * // 或直接记录
 * monitor.record({
 *   operation: 'setState',
 *   type: 'dispatch',
 *   duration: 5.2,
 *   timestamp: Date.now(),
 *   exceedThreshold: false
 * })
 *
 * // 获取统计信息
 * const stats = monitor.getStats()
 * console.log(`平均耗时: ${stats.avgDuration.toFixed(2)}ms`)
 * console.log(`最大耗时: ${stats.maxDuration.toFixed(2)}ms`)
 * console.log(`超阈值次数: ${stats.thresholdExceeded}`)
 *
 * // 按操作类型筛选
 * const dispatchMetrics = monitor.getMetricsByType('dispatch')
 *
 * // 按操作名称筛选
 * const fetchDataMetrics = monitor.getMetricsByOperation('fetchData')
 *
 * // 导出为JSON
 * const report = monitor.exportJSON()
 * console.log(report)
 * ```
 */
export class PerformanceMonitor implements PerformanceMonitorInterface {
  /**
   * 性能指标数组
   * @private
   * @type {PerformanceMetrics[]}
   */
  private metrics: PerformanceMetrics[] = []

  /**
   * 监控器配置
   * @private
   * @type {Required<PerformanceOptions>}
   */
  private options: Required<PerformanceOptions>

  /**
   * 当前操作计时器
   * @private
   * @type {Map<string, number>}
   */
  private currentOperations: Map<string, number> = new Map()

  /**
   * 操作序号计数器：使 start/end 配对的 key 唯一，
   * 避免同名操作并发/嵌套时 start 时间互相覆盖或残留条目
   * @private
   * @type {number}
   */
  private operationSeq = 0

  /**
   * 创建性能监控器
   *
   * @param {PerformanceOptions} [options={}] - 配置选项
   * @param {number} [options.sampleRate=1.0] - 采样率（0-1），1.0表示100%采样
   * @param {number} [options.threshold=16] - 性能阈值（毫秒），超过此值会触发警告
   * @param {(metrics: PerformanceMetrics) => void} [options.logger] - 自定义日志记录器
   * @param {number} [options.maxSize=1000] - 最大保留指标数量
   * @param {boolean} [options.trackMemory=false] - 是否跟踪内存使用
   *
   * @example
   * ```typescript
   * const monitor = new PerformanceMonitor({
   *   sampleRate: 0.5,    // 只采样50%的操作
   *   threshold: 50,      // 50ms阈值
   *   logger: (metrics) => {
   *     sendToAnalytics(metrics)
   *   }
   * })
   * ```
   */
  constructor(options: PerformanceOptions = {}) {
    this.options = {
      sampleRate: options.sampleRate ?? 1.0,
      threshold: options.threshold ?? 16,
      logger: options.logger ?? this.defaultLogger.bind(this),
      maxSize: options.maxSize ?? 1000,
      trackMemory: options.trackMemory ?? false,
    }
  }

  /**
   * 获取高精度时间戳（兼容微信小程序）
   * @private
   */
  private _getTimestamp(): number {
    // 优先使用小程序高精度计时 wx.getPerformance().now()（基础库 2.20.1+，微秒级），
    // 旧基础库降级使用 Date.now()（毫秒精度）；
    // wx 经 globalThis 读取，避免直接引用未声明的小程序全局标识符
    const wxGlobal = (globalThis as { wx?: { getPerformance?: () => unknown } }).wx
    if (wxGlobal && typeof wxGlobal.getPerformance === 'function') {
      // 微信运行时 getPerformance() 返回的对象确实包含 now()，但部分基础库类型未声明，故此处断言
      return (wxGlobal.getPerformance() as unknown as { now(): number }).now()
    }
    return Date.now()
  }

  /**
   * 开始计时
   *
   * 开始监控一个操作的性能，返回一个结束计时的函数
   *
   * @param {string} operation - 操作名称
   * @param {MetricType} [type='dispatch'] - 操作类型
   * @returns {() => void} 结束计时的函数
   *
   * @example
   * ```typescript
   * // 监控dispatch操作
   * const endDispatch = monitor.start('fetchUser', 'dispatch')
   * const result = await store.dispatch('fetchUser', 'user-123')
   * endDispatch()
   *
   * // 监控getter操作
   * const endGetter = monitor.start('userInfo', 'getter')
   * const info = store.getter('userInfo')
   * endGetter()
   *
   * // 使用try-finally确保总是结束计时
   * const end = monitor.start('saveData', 'dispatch')
   * try {
   *   return await store.dispatch('saveData', data)
   * } finally {
   *   end()
   * }
   * ```
   */
  start(operation: string, type: MetricType = 'dispatch'): () => void {
    // key 追加自增序号保证唯一：并发/嵌套的同名操作各自独立配对计时
    const key = `${type}:${operation}#${++this.operationSeq}`
    const startTime = this._getTimestamp()

    this.currentOperations.set(key, startTime)

    return () => {
      const endTime = this._getTimestamp()
      const startTime = this.currentOperations.get(key)

      if (startTime !== undefined) {
        const duration = endTime - startTime
        this.record({
          operation,
          type,
          duration,
          timestamp: Date.now(),
          exceedThreshold: duration > this.options.threshold,
        })

        this.currentOperations.delete(key)
      }
    }
  }

  /**
   * 记录指标
   *
   * 直接记录一个性能指标
   *
   * @param {PerformanceMetrics} metrics - 性能指标
   *
   * @example
   * ```typescript
   * monitor.record({
   *   operation: 'fetchUser',
   *   type: 'dispatch',
   *   duration: 42.5,
   *   timestamp: Date.now(),
   *   exceedThreshold: true
   * })
   * ```
   */
  record(metrics: PerformanceMetrics): void {
    // 采样
    if (Math.random() > this.options.sampleRate) {
      return
    }

    // 添加内存使用信息：写入副本而非调用方传入的对象，
    // 避免副作用泄漏到调用方（复用/比较该对象的代码受影响）
    let record = metrics
    if (this.options.trackMemory) {
      try {
        // memory 为 Chrome 系环境扩展属性，不依赖 DOM lib 的 Performance 类型
        const perf = performance as { memory?: { usedJSHeapSize?: number } }
        const memory = perf.memory
        if (memory && memory.usedJSHeapSize !== undefined) {
          record = { ...metrics, memoryUsage: memory.usedJSHeapSize }
        }
      } catch {
        // 内存监控可能不可用
      }
    }

    // 顺手清理超时未结束的计时条目：调用方缺 try/finally 时 end() 永不执行，
    // currentOperations 会随错误次数无限增长
    this.pruneStaleOperations()

    // 记录指标
    this.metrics.push(record)

    // 限制数量
    if (this.metrics.length > this.options.maxSize) {
      this.metrics.shift()
    }

    // 日志记录
    if (metrics.exceedThreshold) {
      this.options.logger(metrics)
    }
  }

  /**
   * 获取所有指标
   *
   * 返回所有已记录的性能指标
   *
   * @returns {PerformanceMetrics[]} 性能指标数组的副本
   *
   * @example
   * ```typescript
   * const allMetrics = monitor.getMetrics()
   * console.log(`Total metrics: ${allMetrics.length}`)
   *
   * // 计算平均耗时
   * const avgDuration = allMetrics.reduce((sum, m) => sum + m.duration, 0) / allMetrics.length
   * console.log(`Average duration: ${avgDuration.toFixed(2)}ms`)
   * ```
   */
  getMetrics(): PerformanceMetrics[] {
    return [...this.metrics]
  }

  /** 清理超时未结束的计时条目（调用方遗漏 end() 时的兜底，防止 Map 无限增长） */
  private pruneStaleOperations(): void {
    if (this.currentOperations.size === 0) return
    // 必须与 start() 写入条目时使用同一时钟基准（_getTimestamp 可能是
    // performance.now 的进程相对时间，与 Date.now 混用会把新条目误判为超时）
    const now = this._getTimestamp()
    for (const [key, startTime] of this.currentOperations) {
      if (now - startTime > PerformanceMonitor.MAX_OPERATION_AGE_MS) {
        this.currentOperations.delete(key)
      }
    }
  }

  /** 计时条目的最大保留时长：超过视为调用方遗漏 end() 的泄漏条目 */
  private static readonly MAX_OPERATION_AGE_MS = 10 * 60 * 1000

  /**
   * 获取统计信息
   *
   * 计算并返回性能统计信息
   *
   * @returns {PerformanceStats} 性能统计对象
   *
   * @example
   * ```typescript
   * const stats = monitor.getStats()
   * console.log(`平均耗时: ${stats.avgDuration.toFixed(2)}ms`)
   * console.log(`最大耗时: ${stats.maxDuration.toFixed(2)}ms`)
   * console.log(`最小耗时: ${stats.minDuration.toFixed(2)}ms`)
   * console.log(`总次数: ${stats.totalCount}`)
   * console.log(`超阈值次数: ${stats.thresholdExceeded}`)
   *
   * // 按操作查看统计
   * for (const [operation, opStats] of Object.entries(stats.byOperation)) {
   *   console.log(`${operation}:`)
   *   console.log(`  执行次数: ${opStats.count}`)
   *   console.log(`  平均耗时: ${opStats.avgDuration.toFixed(2)}ms`)
   *   console.log(`  最大耗时: ${opStats.maxDuration.toFixed(2)}ms`)
   * }
   * ```
   */
  getStats(): PerformanceStats {
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

    // 循环累计而非 Math.max(...durations)：大样本下 spread 栈溢出
    let maxDuration = -Infinity
    let minDuration = Infinity
    let totalDuration = 0
    for (const m of this.metrics) {
      totalDuration += m.duration
      if (m.duration > maxDuration) maxDuration = m.duration
      if (m.duration < minDuration) minDuration = m.duration
    }
    const avgDuration = totalDuration / this.metrics.length
    const thresholdExceeded = this.metrics.filter((m) => m.exceedThreshold).length

    // 按操作分组统计（单次遍历，避免 O(n×k) 的重复 filter）
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
   * 清除所有指标
   *
   * 清空所有已记录的性能指标
   *
   * @example
   * ```typescript
   * // 在开始新的测试前清除之前的指标
   * monitor.clear()
   *
   * // 运行测试
   * // ...
   *
   * // 获取新的统计
   * const stats = monitor.getStats()
   * ```
   */
  clear(): void {
    this.metrics = []
    this.currentOperations.clear()
  }

  /**
   * 设置配置选项
   *
   * 更新监控器的配置选项
   *
   * @param {PerformanceOptions} options - 新的配置选项
   *
   * @example
   * ```typescript
   * // 调整采样率
   * monitor.setOptions({ sampleRate: 0.5 })
   *
   * // 调整阈值
   * monitor.setOptions({ threshold: 50 })
   *
   * // 启用内存监控
   * monitor.setOptions({ trackMemory: true })
   * ```
   */
  setOptions(options: PerformanceOptions): void {
    Object.assign(this.options, {
      sampleRate: options.sampleRate ?? this.options.sampleRate,
      threshold: options.threshold ?? this.options.threshold,
      logger: options.logger ?? this.options.logger,
      maxSize: options.maxSize ?? this.options.maxSize,
      trackMemory: options.trackMemory ?? this.options.trackMemory,
    })
  }

  /**
   * 默认日志记录器
   *
   * @private
   * @param {PerformanceMetrics} metrics - 性能指标
   */
  private defaultLogger(metrics: PerformanceMetrics): void {
    console.warn(`[GeomStore][Performance] ${metrics.operation} took ${metrics.duration.toFixed(2)}ms ` + `(threshold: ${this.options.threshold}ms)`)
  }

  /**
   * 按类型筛选指标
   *
   * 获取指定类型的所有性能指标
   *
   * @param {MetricType} type - 指标类型（'dispatch'、'getter'、'state-update'等）
   * @returns {PerformanceMetrics[]} 匹配的性能指标数组
   *
   * @example
   * ```typescript
   * // 获取所有dispatch操作的指标
   * const dispatchMetrics = monitor.getMetricsByType('dispatch')
   *
   * // 计算dispatch的平均耗时
   * const avgDispatchDuration = dispatchMetrics.reduce((sum, m) => sum + m.duration, 0) / dispatchMetrics.length
   * console.log(`Average dispatch duration: ${avgDispatchDuration.toFixed(2)}ms`)
   *
   * // 获取所有getter操作的指标
   * const getterMetrics = monitor.getMetricsByType('getter')
   * ```
   */
  getMetricsByType(type: MetricType): PerformanceMetrics[] {
    return this.metrics.filter((m) => m.type === type)
  }

  /**
   * 按操作筛选指标
   *
   * 获取指定操作名称的所有性能指标
   *
   * @param {string} operation - 操作名称
   * @returns {PerformanceMetrics[]} 匹配的性能指标数组
   *
   * @example
   * ```typescript
   * // 获取fetchUser操作的所有指标
   * const fetchUserMetrics = monitor.getMetricsByOperation('fetchUser')
   *
   * // 分析特定操作的性能趋势
   * const durations = fetchUserMetrics.map(m => m.duration)
   * const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length
   * const max = Math.max(...durations)
   * const min = Math.min(...durations)
   *
   * console.log(`fetchUser performance:`)
   * console.log(`  Average: ${avg.toFixed(2)}ms`)
   * console.log(`  Max: ${max.toFixed(2)}ms`)
   * console.log(`  Min: ${min.toFixed(2)}ms`)
   * ```
   */
  getMetricsByOperation(operation: string): PerformanceMetrics[] {
    return this.metrics.filter((m) => m.operation === operation)
  }

  /**
   * 获取最近的指标
   *
   * 获取最近N条性能指标
   *
   * @param {number} [count=10] - 要获取的指标数量
   * @returns {PerformanceMetrics[]} 最近的性能指标数组
   *
   * @example
   * ```typescript
   * // 获取最近10条指标
   * const recentMetrics = monitor.getRecentMetrics(10)
   *
   * // 查看最近的性能趋势
   * recentMetrics.forEach((metric, index) => {
   *   console.log(`${index + 1}. ${metric.operation}: ${metric.duration.toFixed(2)}ms`)
   * })
   * ```
   */
  getRecentMetrics(count: number = 10): PerformanceMetrics[] {
    return this.metrics.slice(-count)
  }

  /**
   * 导出为JSON
   *
   * 将所有指标和统计信息导出为JSON字符串
   *
   * @returns {string} JSON字符串
   *
   * @example
   * ```typescript
   * // 导出性能报告
   * const report = monitor.exportJSON()
   *
   * // 保存到文件
   * fs.writeFileSync('performance-report.json', report)
   *
   * // 发送到服务器
   * await fetch('/api/performance', {
   *   method: 'POST',
   *   body: report,
   *   headers: { 'Content-Type': 'application/json' }
   * })
   * ```
   */
  exportJSON(): string {
    return JSON.stringify(
      {
        metrics: this.metrics,
        stats: this.getStats(),
        options: this.options,
      },
      null,
      2,
    )
  }
}

/**
 * 默认导出
 */
export type { PerformanceMetrics, PerformanceOptions, PerformanceStats, MetricType } from '../../types/performance'
