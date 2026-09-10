/**
 * GeomStore - 错误监控和报警系统
 *
 * 提供完整的错误监控功能，包括：
 * - 错误上报
 * - 错误聚合
 * - 错误报告生成
 * - 性能预警
 */

import type { ErrorContext, ErrorReporter, ErrorGroup, ErrorReport, MonitoringConfig } from '../../types/error.js'
import { ErrorAggregator } from './ErrorAggregator.js'
import { ConsoleReporter } from './reporters/ConsoleReporter.js'

// 上报器与聚合器已拆至子模块；此处再导出以保持既有导入路径（extras/error/ErrorMonitoring.js）不变
export { ConsoleReporter } from './reporters/ConsoleReporter.js'
export { HttpReporter } from './reporters/HttpReporter.js'
export type { HttpRequestImpl } from './reporters/HttpReporter.js'
export { ErrorAggregator } from './ErrorAggregator.js'

/**
 * 错误监控系统
 *
 * @class ErrorMonitoring
 * @description
 * 统一的错误监控系统，支持多个报告器、批量上报和错误聚合
 *
 * @example
 * ```typescript
 * const monitoring = new ErrorMonitoring({
 *   reporters: [
 *     new ConsoleReporter(),
 *     new HttpReporter('https://api.example.com/errors')
 *   ],
 *   batchInterval: 5000,
 *   batchThreshold: 10,
 *   enableAggregation: true,
 *   enableConsoleLog: true
 * })
 *
 * // 上报错误
 * await monitoring.report(errorContext)
 *
 * // 获取错误报告
 * const report = monitoring.generateReport()
 * console.log(report)
 * ```
 */
export class ErrorMonitoring {
  private reporters: ErrorReporter[]
  private batchInterval: number
  private batchThreshold: number
  private enableAggregation: boolean
  private enableConsoleLog: boolean
  private reportTimeout: number

  private errorQueue: ErrorContext[] = []
  private aggregator: ErrorAggregator
  private batchTimer?: ReturnType<typeof setInterval>
  private isFlushing = false
  /** 在途 flush 的 Promise（shutdown 等待其完成后再做最终上报） */
  private inFlightFlush: Promise<void> | null = null
  private isShuttingDown = false
  private nonAggregatedErrorCount = 0 // 禁用聚合时记录的错误数
  /** 防止队列无限增长的最大大小（可由 MonitoringConfig.maxQueueSize 覆盖） */
  private readonly maxQueueSize: number
  /** 连续「全部报告器失败」的 flush 次数：用于给重入队加上限，见 doFlushReports */
  private consecutiveFlushFailures = 0
  /** 重入队重试上限：超过后丢弃该批并告警，避免永久失败批次无限空转 */
  private readonly maxFlushRetries: number

  constructor(config: MonitoringConfig) {
    this.reporters = config.reporters
    // 用 ?? 而非 ||：batchInterval / batchThreshold / reportTimeout 的 0 是合法语义
    // （立即/无延迟、立即上报、不超时），|| 会把显式传入的 0 静默替换为默认值
    this.batchInterval = config.batchInterval ?? 5000
    this.batchThreshold = config.batchThreshold ?? 10
    this.enableAggregation = config.enableAggregation ?? true
    this.enableConsoleLog = config.enableConsoleLog ?? true
    this.reportTimeout = config.reportTimeout ?? 10000
    this.maxQueueSize = config.maxQueueSize ?? 1000
    this.maxFlushRetries = config.maxFlushRetries ?? 3

    this.aggregator = new ErrorAggregator()

    // 批量调度器延迟到首次 report 时启动：
    // 避免仅 import 本模块（或 re-export 它的入口）就产生常驻定时器
  }

  /**
   * 上报错误
   *
   * @param {ErrorContext} context - 错误上下文
   * @returns {Promise<void>}
   *
   * @example
   * ```typescript
   * await monitoring.report(errorContext)
   * ```
   */
  async report(context: ErrorContext): Promise<void> {
    if (this.isShuttingDown) {
      return
    }

    // 检查队列大小，防止无限增长
    if (this.errorQueue.length >= this.maxQueueSize) {
      console.warn('[ErrorMonitoring] Error queue full, dropping oldest error')
      this.errorQueue.shift()
    }

    // 聚合错误
    if (this.enableAggregation) {
      this.aggregator.addError(context)
    } else {
      // 禁用聚合时，计数但不分组
      this.nonAggregatedErrorCount++
    }

    // 控制台日志
    if (this.enableConsoleLog) {
      console.error('[ErrorMonitoring]', context)
    }

    // 加入批量队列
    this.errorQueue.push(context)

    // 惰性启动批量调度器（仅在首次上报时创建）
    if (!this.batchTimer) {
      this.startBatchScheduler()
    }

    // 检查是否达到批量阈值
    if (this.errorQueue.length >= this.batchThreshold) {
      await this.flushReports()
    }
  }

  /**
   * 立即上报所有队列中的错误
   *
   * @returns {Promise<void>}
   */
  async flushReports(): Promise<void> {
    if (this.errorQueue.length === 0 || this.isFlushing) {
      // 已有 flush 在途：返回其 Promise，调用方等待的是真实完成而非立即返回
      return this.inFlightFlush ?? undefined
    }

    this.isFlushing = true
    // 记录在途 flush 的 Promise：shutdown 需先等待它完成再做最终 flush，
    // 否则最终 flush 被入口守卫跳过，进程可能在报文发出前退出导致尾部错误丢失
    const flush = this.doFlushReports()
    this.inFlightFlush = flush
    return flush
  }

  /**
   * 执行批量上报（flushReports 已设置 isFlushing 与 inFlightFlush）
   *
   * @private
   */
  private async doFlushReports(): Promise<void> {
    const batch = [...this.errorQueue]
    this.errorQueue = []

    // 注意：不清除周期调度器（batchTimer）。
    // flush 与周期调度是两个独立职责，若在 flush 中清除会导致
    // 阈值触发的 flush 永久杀死周期上报；调度器由 shutdown() 统一清理

    try {
      // 上报到所有报告器。reportBatch 仅类型约束返回 Promise，同步抛错完全合法：
      // 经 Promise.resolve().then 包装消除同步抛点，避免异常绕过 try/finally 使
      // isFlushing 永久为 true，之后所有 flush（周期/阈值/shutdown）静默失效。
      // 三态判定：只有任务真正 resolve 才算成功；超时不是成功——否则弱网/服务端
      // 黑洞（最需要重试的场景）下批次既不算失败也不确认送达，被直接丢弃
      let anyReporterSucceeded = false
      const promises = this.reporters.map((reporter) => {
        const task = Promise.resolve()
          .then(() => reporter.reportBatch(batch))
          .then(
            () => 'ok' as const,
            (error) => {
              console.error('[ErrorMonitoring] Error in reportBatch:', error)
              return 'fail' as const
            },
          )
        return Promise.race([task, this.delay(this.reportTimeout).then(() => 'timeout' as const)]).then((outcome) => {
          if (outcome === 'ok') {
            anyReporterSucceeded = true
          } else if (outcome === 'timeout') {
            console.warn(`[ErrorMonitoring] Reporter "${reporter.getName()}" timed out after ${this.reportTimeout}ms`)
          }
        })
      })
      await Promise.allSettled(promises)

      // 关闭中不重试：shutdown 会用最终 flushReports 排空队列，
      // 若此处重新入队，最终 flush 会再次调用已失败的 reportBatch——
      // 对挂起/已退出的上报端无限等待，shutdown 永不返回
      if (this.isShuttingDown || batch.length === 0) {
        return
      }
      if (anyReporterSucceeded) {
        this.consecutiveFlushFailures = 0
        return
      }

      // 全部报告器失败：报文重新入队等待下次 flush 重试，否则网络抖动期间产生的
      // 错误会被静默丢弃。但重试必须有上限——reporters 为空数组（promises 为空，
      // anyReporterSucceeded 恒 false）、或唯一报告器恒失败（如某条 payload 含循环
      // 引用使 JSON.stringify 每次抛错）时，无上限的重入队会让该批每个 batchInterval
      // 空转一次：永不落地也永不丢弃，还会持续把队列顶到上限、连带淘汰掉正常错误
      this.consecutiveFlushFailures++
      if (this.consecutiveFlushFailures > this.maxFlushRetries) {
        console.warn(
          `[ErrorMonitoring] 连续 ${this.consecutiveFlushFailures} 次上报全部失败` +
            `（当前报告器数: ${this.reporters.length}），丢弃本批 ${batch.length} 条错误以避免无限重入队`,
        )
        this.consecutiveFlushFailures = 0
        return
      }

      // 置于队首保持时序：失败批次早于 flush 期间新入队的条目。
      // 超出容量时保留队尾、丢弃队首（即优先丢弃最旧），与 report() 中「队列满则
      // shift 丢弃最旧错误」同一口径——溢出已是过载降级状态，全类统一按最旧先淘汰，
      // 不为此处开「保旧」特例（那会与入队路径的淘汰方向相反，反而更难推理）
      const requeued = [...batch, ...this.errorQueue]
      this.errorQueue = requeued.length > this.maxQueueSize ? requeued.slice(requeued.length - this.maxQueueSize) : requeued
    } finally {
      this.isFlushing = false
      this.inFlightFlush = null
    }
  }

  /**
   * 生成错误报告
   *
   * @returns {ErrorReport} 错误报告
   *
   * @example
   * ```typescript
   * const report = monitoring.generateReport()
   * console.log('Total Errors:', report.summary.totalErrors)
   * console.log('Top Errors:', report.topErrors)
   * ```
   */
  generateReport(): ErrorReport {
    const stats = this.aggregator.getStats()
    const groups = this.aggregator.getGroups()

    // 计算总错误数
    const totalErrors = this.enableAggregation ? stats.totalErrors : this.nonAggregatedErrorCount

    return {
      generatedAt: Date.now(),
      summary: {
        totalGroups: stats.totalGroups,
        totalErrors,
        queuedErrors: this.errorQueue.length,
      },
      byCode: stats.byCode,
      byStore: stats.byStore,
      topErrors: groups.sort((a, b) => b.count - a.count).slice(0, 10),
      recentErrors: groups.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 10),
    }
  }

  /**
   * 获取聚合统计
   *
   * @returns {object} 聚合统计
   */
  getAggregationStats() {
    return this.aggregator.getStats()
  }

  /**
   * 获取错误组
   *
   * @returns {ErrorGroup[]} 错误组
   */
  getErrorGroups(): ErrorGroup[] {
    return this.aggregator.getGroups()
  }

  /**
   * 清除所有数据
   */
  clear(): void {
    this.errorQueue = []
    this.aggregator.clear()
    this.nonAggregatedErrorCount = 0
  }

  /**
   * 添加报告器
   *
   * @param {ErrorReporter} reporter - 错误报告器
   */
  addReporter(reporter: ErrorReporter): void {
    this.reporters.push(reporter)
  }

  /**
   * 移除报告器
   *
   * @param {string} name - 报告器名称
   */
  removeReporter(name: string): void {
    this.reporters = this.reporters.filter((r) => r.getName() !== name)
  }

  /**
   * 关闭监控系统
   *
   * @returns {Promise<void>}
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true

    // 清除周期调度器（用 clearInterval 明确语义，避免与 timeout 句柄混淆）
    if (this.batchTimer) {
      clearInterval(this.batchTimer)
      this.batchTimer = undefined
    }

    // 先等待在途 flush 完成：避免最终 flush 被 isFlushing 守卫跳过
    if (this.inFlightFlush) {
      await this.inFlightFlush.catch(() => {})
    }

    // 上报剩余错误
    await this.flushReports()
  }

  /**
   * 启动批量调度器
   *
   * @private
   */
  private startBatchScheduler(): void {
    const timer = setInterval(() => {
      this.flushReports().catch((error) => {
        console.error('[ErrorMonitoring] Error in batch scheduler:', error)
      })
    }, this.batchInterval)
    // 调用 unref() 让定时器不阻止 Node.js 进程退出（解决测试/小程序环境句柄泄漏）
    const timerWithUnref = timer as unknown as { unref?: () => void }
    if (timer && typeof timerWithUnref.unref === 'function') {
      timerWithUnref.unref()
    }
    this.batchTimer = timer
  }

  /**
   * 延迟执行
   *
   * @private
   * @param {number} ms - 延迟毫秒数
   * @returns {Promise<void>}
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms)
      // unref()：退避等待定时器不应阻止 Node.js 进程/测试 worker 退出
      // （与 batchTimer 的 unref 处理一致，小程序/浏览器环境无 unref 时跳过）
      const timerWithUnref = timer as unknown as { unref?: () => void }
      if (typeof timerWithUnref.unref === 'function') {
        timerWithUnref.unref()
      }
    })
  }
}

/**
 * 创建默认的错误监控系统
 *
 * @param {Partial<MonitoringConfig>} [config] - 配置选项
 * @returns {ErrorMonitoring} 错误监控系统实例
 *
 * @example
 * ```typescript
 * const monitoring = createDefaultMonitoring({
 *   enableConsoleLog: true,
 *   batchInterval: 10000
 * })
 * ```
 */
export function createDefaultMonitoring(config?: Partial<MonitoringConfig>): ErrorMonitoring {
  const defaultConfig: MonitoringConfig = {
    reporters: [new ConsoleReporter()],
    batchInterval: 5000,
    batchThreshold: 10,
    enableAggregation: true,
    enableConsoleLog: true,
    reportTimeout: 10000,
    ...config,
  }

  return new ErrorMonitoring(defaultConfig)
}

/**
 * 导出全局默认实例（惰性创建）
 *
 * 注意：首次访问才创建实例并（在首次 report 时）启动批量调度器，
 * 避免仅 import 本模块就产生常驻定时器
 */
let _defaultMonitoring: ErrorMonitoring | undefined

/**
 * 获取全局默认的错误监控实例（惰性单例）
 *
 * @returns {ErrorMonitoring} 默认错误监控实例
 */
export function getDefaultMonitoring(): ErrorMonitoring {
  if (!_defaultMonitoring) {
    _defaultMonitoring = createDefaultMonitoring()
  }
  return _defaultMonitoring
}
