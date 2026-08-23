/**
 * GeomStore v1.0 - 错误监控和报警系统
 *
 * 提供完整的错误监控功能，包括：
 * - 错误上报
 * - 错误聚合
 * - 错误报告生成
 * - 性能预警
 */

import type { ErrorContext, ErrorReporter, ErrorGroup, ErrorReport, MonitoringConfig } from '../../types/error'
import { GeomStoreError, isGeomStoreError } from './GeomStoreError'

/**
 * 控制台错误报告器
 *
 * @class ConsoleReporter
 * @implements ErrorReporter
 * @description
 * 将错误输出到控制台，用于开发环境
 */

/**
 * console.group/groupEnd 特性检测：
 * 微信小程序真机基础库的 console 不提供分组方法，
 * 直接调用会抛 TypeError 导致报告静默失败，需降级为平铺输出。
 * 延迟到调用时求值（而非模块加载时），兼容测试环境对 console 的动态 stub。
 */
function consoleSupportsGroup(): boolean {
  return typeof console.group === 'function' && typeof console.groupEnd === 'function'
}

export class ConsoleReporter implements ErrorReporter {
  constructor(private readonly prefix: string = '[ErrorMonitoring]') {}

  getName(): string {
    return 'console'
  }

  async report(context: ErrorContext): Promise<void> {
    if (consoleSupportsGroup()) {
      console.group(`${this.prefix} ${context.level.toUpperCase()}`)
      console.error('Error:', context.error)
      console.error('Store:', context.storeName)
      console.error('Operation:', context.operation)
      if (context.payload) {
        console.error('Payload:', context.payload)
      }
      console.error('Timestamp:', new Date(context.timestamp ?? Date.now()).toISOString())
      console.groupEnd()
      return
    }

    // 降级：无分组能力时平铺输出同样信息
    const header = `${this.prefix} ${context.level.toUpperCase()}`
    console.error(`${header} Error:`, context.error)
    console.error(`${header} Store:`, context.storeName)
    console.error(`${header} Operation:`, context.operation)
    if (context.payload) {
      console.error(`${header} Payload:`, context.payload)
    }
    console.error(`${header} Timestamp:`, new Date(context.timestamp ?? Date.now()).toISOString())
  }

  async reportBatch(contexts: ErrorContext[]): Promise<void> {
    if (consoleSupportsGroup()) {
      console.group(`${this.prefix} Batch Report (${contexts.length} errors)`)
      contexts.forEach((ctx, index) => {
        console.error(`[${index + 1}] ${ctx.level} in ${ctx.storeName}:`, ctx.error)
      })
      console.groupEnd()
      return
    }

    // 降级：无分组能力时平铺输出同样信息
    console.error(`${this.prefix} Batch Report (${contexts.length} errors)`)
    contexts.forEach((ctx, index) => {
      console.error(`[${index + 1}] ${ctx.level} in ${ctx.storeName}:`, ctx.error)
    })
  }
}

/**
 * HTTP请求实现：适配不同运行环境（小程序 wx.request / 浏览器 fetch / 自定义注入）
 */
export type HttpRequestImpl = (url: string, body: string, method: string, headers: Record<string, string>) => Promise<void>

/**
 * 构建默认 HTTP 请求实现
 *
 * 微信小程序无全局 fetch，直接使用会导致错误上报静默失败（仅 console.error），
 * 因此优先检测并适配 wx.request，其次回退到全局 fetch。
 *
 * @param options - 构造函数传入的 RequestInit 配置（fetch 分支需完整透传，
 *   避免 credentials/mode/keepalive 等配置被静默丢弃）
 */
function createDefaultRequest(options: RequestInit): HttpRequestImpl {
  const wxApi = (globalThis as { wx?: { request?: (options: unknown) => void } }).wx
  const request = wxApi?.request
  if (typeof request === 'function') {
    return (url, body, method, headers) =>
      new Promise<void>((resolve, reject) => {
        request({
          url,
          method: method as 'POST',
          header: headers,
          data: body ? JSON.parse(body) : undefined,
          // wx.request 的 success 回调在任何 HTTP 状态（含 4xx/5xx）都会触发，
          // 必须校验 statusCode，否则上报失败（服务端拒绝/鉴权失效）被当作成功静默丢失
          success: (res: { statusCode: number }) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve()
            } else {
              reject(new Error(`wx.request failed with HTTP ${res.statusCode}`))
            }
          },
          fail: (err: unknown) => reject(err instanceof Error ? err : new Error('wx.request failed')),
        })
      })
  }

  return async (url, body, method, headers) => {
    // 透传全部 RequestInit 配置；method/headers/body 以归一化后的上报参数为准
    await fetch(url, { ...options, method, headers, body })
  }
}

/**
 * HTTP错误报告器
 *
 * @class HttpReporter
 * @implements ErrorReporter
 * @description
 * 将错误通过HTTP发送到远程服务器。
 * 默认自动适配运行环境（小程序 wx.request / 浏览器 fetch），
 * 也可通过构造参数注入自定义请求实现。
 */
export class HttpReporter implements ErrorReporter {
  private readonly requestImpl: HttpRequestImpl

  constructor(
    private readonly endpoint: string,
    private readonly options: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    },
    requestImpl?: HttpRequestImpl,
  ) {
    this.requestImpl = requestImpl ?? createDefaultRequest(this.options)
  }

  getName(): string {
    return 'http'
  }

  async report(context: ErrorContext): Promise<void> {
    try {
      await this.requestImpl(
        this.endpoint,
        JSON.stringify({
          error: {
            message: context.error.message || '',
            stack: context.error.stack || '',
            name: context.error.name || '',
          },
          storeName: context.storeName,
          operation: context.operation,
          level: context.level,
          payload: context.payload,
          timestamp: context.timestamp,
        }),
        this.options.method ?? 'POST',
        this.normalizeHeaders(),
      )
    } catch (error) {
      console.error('[HttpReporter] Failed to report error:', error)
    }
  }

  async reportBatch(contexts: ErrorContext[]): Promise<void> {
    try {
      await this.requestImpl(
        this.endpoint,
        JSON.stringify({
          errors: contexts.map((ctx) => ({
            error: {
              message: ctx.error.message || '',
              stack: ctx.error.stack || '',
              name: ctx.error.name || '',
            },
            storeName: ctx.storeName,
            operation: ctx.operation,
            level: ctx.level,
            payload: ctx.payload,
            timestamp: ctx.timestamp,
          })),
        }),
        this.options.method ?? 'POST',
        this.normalizeHeaders(),
      )
    } catch (error) {
      console.error('[HttpReporter] Failed to report batch:', error)
    }
  }

  /**
   * 将 RequestInit.headers 归一化为普通键值对象，
   * 兼容 Headers / string[][] / Record 三种形式
   */
  private normalizeHeaders(): Record<string, string> {
    const headers = this.options.headers
    if (!headers) return {}

    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      const result: Record<string, string> = {}
      headers.forEach((value, key) => {
        result[key] = value
      })
      return result
    }

    if (Array.isArray(headers)) {
      const result: Record<string, string> = {}
      for (const [key, value] of headers) {
        result[key] = value
      }
      return result
    }

    return { ...(headers as Record<string, string>) }
  }
}

/**
 * 错误聚合器
 *
 * 将相似的错误聚合成组，便于分析和报告
 */
export class ErrorAggregator {
  private groups = new Map<string, ErrorGroup>()
  private readonly maxGroups: number

  constructor(maxGroups: number = 100) {
    this.maxGroups = maxGroups
  }

  /**
   * 添加错误到聚合器
   *
   * @param {ErrorContext} context - 错误上下文
   * @returns {ErrorGroup | undefined} 错误组（如果是新创建的）
   */
  addError(context: ErrorContext): ErrorGroup | undefined {
    const groupId = this.generateGroupId(context)
    const error = context.error as GeomStoreError
    const code = isGeomStoreError(error) ? error.code : 'UNKNOWN'
    const now = context.timestamp || Date.now()

    // 检查是否已存在该组
    const group = this.groups.get(groupId)
    if (group) {
      // 更新组信息
      group.count++
      group.lastSeen = now

      // 更新受影响的Store
      if (!group.affectedStores.includes(context.storeName)) {
        group.affectedStores.push(context.storeName)
      }

      return undefined
    }

    // 创建新的错误组
    const newGroup: ErrorGroup = {
      groupId,
      type: error.name,
      code,
      message: error.message,
      count: 1,
      firstSeen: now,
      lastSeen: now,
      affectedStores: [context.storeName],
      sampleError: context,
    }

    this.groups.set(groupId, newGroup)

    // 限制组数量
    if (this.groups.size > this.maxGroups) {
      this.cleanupOldGroups()
    }

    return newGroup
  }

  /**
   * 获取所有错误组
   *
   * @returns {ErrorGroup[]} 错误组数组
   */
  getGroups(): ErrorGroup[] {
    return Array.from(this.groups.values()).sort((a, b) => b.lastSeen - a.lastSeen)
  }

  /**
   * 获取指定Store的组
   *
   * @param {string} storeName - Store名称
   * @returns {ErrorGroup[]} 错误组数组
   */
  getGroupsByStore(storeName: string): ErrorGroup[] {
    return this.getGroups().filter((group) => group.affectedStores.includes(storeName))
  }

  /**
   * 清理旧的错误组
   *
   * @private
   */
  private cleanupOldGroups(): void {
    const groups = this.getGroups()
    const toDelete = groups.slice(this.maxGroups)
    toDelete.forEach((group) => this.groups.delete(group.groupId))
  }

  /**
   * 生成错误组ID
   *
   * @private
   * @param {ErrorContext} context - 错误上下文
   * @returns {string} 组ID
   */
  private generateGroupId(context: ErrorContext): string {
    const error = context.error
    const stack = error.stack || ''
    const message = error.message

    // 使用简单的哈希算法
    let hash = 0
    const str = `${error.name}:${message}:${stack.slice(0, 100)}`

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }

    return Math.abs(hash).toString(36)
  }

  /**
   * 清空所有错误组
   */
  clear(): void {
    this.groups.clear()
  }

  /**
   * 获取统计信息
   *
   * @returns {object} 统计信息
   */
  getStats() {
    const groups = this.getGroups()

    return {
      totalGroups: groups.length,
      totalErrors: groups.reduce((sum, g) => sum + g.count, 0),
      byCode: groups.reduce(
        (acc, g) => {
          acc[g.code] = (acc[g.code] || 0) + g.count
          return acc
        },
        {} as Record<string, number>,
      ),
      byStore: groups.reduce(
        (acc, g) => {
          g.affectedStores.forEach((store) => {
            acc[store] = (acc[store] || 0) + g.count
          })
          return acc
        },
        {} as Record<string, number>,
      ),
    }
  }
}

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
  private readonly maxQueueSize = 1000 // 防止队列无限增长的最大大小

  constructor(config: MonitoringConfig) {
    this.reporters = config.reporters
    this.batchInterval = config.batchInterval || 5000
    this.batchThreshold = config.batchThreshold || 10
    this.enableAggregation = config.enableAggregation ?? true
    this.enableConsoleLog = config.enableConsoleLog ?? true
    this.reportTimeout = config.reportTimeout || 10000

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
      // isFlushing 永久为 true，之后所有 flush（周期/阈值/shutdown）静默失效
      let anyReporterSucceeded = false
      const promises = this.reporters.map((reporter) =>
        Promise.race([Promise.resolve().then(() => reporter.reportBatch(batch)), this.delay(this.reportTimeout)])
          .then(
            () => {
              anyReporterSucceeded = true
            },
            (error) => {
              console.error('[ErrorMonitoring] Error in reportBatch:', error)
            },
          ),
      )
      await Promise.allSettled(promises)

      // 关闭中不重试：shutdown 会用最终 flushReports 排空队列，
      // 若此处重新入队，最终 flush 会再次调用已失败的 reportBatch——
      // 对挂起/已退出的上报端无限等待，shutdown 永不返回
      if (!this.isShuttingDown && !anyReporterSucceeded && batch.length > 0) {
        // 全部报告器失败：报文重新入队等待下次 flush 重试，否则网络抖动
        // 期间产生的错误会被静默丢弃。置于队首保持时序；超过容量上限时
        // 从队尾丢弃新条目（与 enqueue 的淘汰方向一致，保旧优先）
        const requeued = [...batch, ...this.errorQueue]
        this.errorQueue = requeued.length > this.maxQueueSize ? requeued.slice(requeued.length - this.maxQueueSize) : requeued
      }
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
    if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref()
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
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref()
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

/**
 * 全局默认实例（惰性代理）
 *
 * 首次访问任意属性/方法时才创建真实实例，避免仅 import 就产生实例与调度器；
 * 代理目标继承自 ErrorMonitoring.prototype，保证 instanceof 检查通过
 *
 * @deprecated 建议改用 {@link getDefaultMonitoring} 以获得更明确的惰性语义
 */
export const defaultMonitoring: ErrorMonitoring = new Proxy(Object.create(ErrorMonitoring.prototype) as ErrorMonitoring, {
  get(_target, prop) {
    const instance = getDefaultMonitoring()
    const value = (instance as unknown as Record<PropertyKey, unknown>)[prop]
    return typeof value === 'function' ? value.bind(instance) : value
  },
  // 缺少 set/deleteProperty 陷阱时，属性写入落在哑 target 上被静默丢弃，
  // 用户配置（如 enableConsoleLog = false）不生效且无任何提示
  set(_target, prop, value) {
    (getDefaultMonitoring() as unknown as Record<PropertyKey, unknown>)[prop] = value
    return true
  },
  deleteProperty(_target, prop) {
    delete (getDefaultMonitoring() as unknown as Record<PropertyKey, unknown>)[prop]
    return true
  },
})
