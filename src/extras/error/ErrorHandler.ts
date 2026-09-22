/**
 * GeomStore - 错误处理器
 *
 * 提供统一的错误处理、记录和统计功能
 *
 */

import { createErrorContext, defaultErrorHandler, type ErrorContext, type ErrorHandler, type ErrorLevel, type OperationType } from '../../types/error.js'

/** errorLog 条目上限的默认值：字段初始化与 setMaxLogSize 的非有限值回退共用 */
const DEFAULT_MAX_LOG_SIZE = 100

/**
 * 错误处理器类
 *
 * 用于管理GeomStore运行过程中的错误处理、记录和统计
 *
 * @class ErrorHandlerImpl
 *
 * @example
 * ```typescript
 * const errorHandler = new ErrorHandlerImpl()
 *
 * // 自定义错误处理
 * errorHandler.setHandler((context) => {
 *   console.error(`[${context.level}] ${context.error.message}`)
 * })
 *
 * // 处理错误
 * errorHandler.handle('user-store', 'state-update', new Error('Failed'))
 *
 * // 获取错误统计
 * const stats = errorHandler.getErrorStats()
 * console.log(`Total errors: ${stats.total}`)
 * ```
 */
export class ErrorHandlerImpl {
  /**
   * 错误处理函数
   * @private
   * @type {ErrorHandler}
   */
  private handler: ErrorHandler = defaultErrorHandler

  /**
   * 错误日志
   * @private
   * @type {ErrorContext[]}
   */
  private errorLog: ErrorContext[] = []

  /**
   * 最大日志大小
   * @private
   * @type {number}
   */
  private maxLogSize: number = DEFAULT_MAX_LOG_SIZE

  /**
   * 设置错误处理器
   *
   * 覆盖默认的错误处理行为
   *
   * @param {ErrorHandler} handler - 错误处理函数
   * @throws {Error} 如果handler不是函数
   *
   * @example
   * ```typescript
   * errorHandler.setHandler((context) => {
   *   // 发送错误到监控服务
   *   errorTrackingService.log(context)
   *
   *   // 根据级别采取不同措施
   *   if (context.level === 'critical') {
   *     alertUser('发生严重错误')
   *   }
   * })
   * ```
   */
  setHandler(handler: ErrorHandler): void {
    if (typeof handler !== 'function') {
      throw new Error('[ErrorHandler] Handler must be a function')
    }
    this.handler = handler
  }

  /**
   * 处理错误上下文
   *
   * 记录错误并调用当前处理器
   *
   * @param {ErrorContext} context - 错误上下文对象
   *
   * @example
   * ```typescript
   * const context: ErrorContext = {
   *   storeName: 'user-store',
   *   operation: 'action-execution',
   *   error: new Error('Action failed'),
   *   level: 'error',
   *   timestamp: Date.now(),
   *   payload: { actionName: 'login' }
   * }
   * errorHandler.handleError(context)
   * ```
   */
  handleError(context: ErrorContext): void {
    // 记录错误
    this.logError(context)

    // 调用处理器
    try {
      this.handler(context)
    } catch (error) {
      console.error('[ErrorHandler] Error in error handler:', error)
    }
  }

  /**
   * 创建并处理错误
   *
   * 便捷方法，自动创建错误上下文并处理
   *
   * @param {string} storeName - Store名称
   * @param {OperationType} operation - 操作类型
   * @param {Error} error - 错误对象
   * @param {ErrorLevel} [level='error'] - 错误级别
   * @param {unknown} [payload] - 附加载荷数据
   *
   * @example
   * ```typescript
   * try {
   *   store.dispatch('login', 'user', 'pass')
   * } catch (error) {
   *   errorHandler.handle(
   *     'user-store',
   *     'action-execution',
   *     error as Error,
   *     'error',
   *     { actionName: 'login', username: 'user' }
   *   )
   * }
   * ```
   */
  handle(storeName: string, operation: OperationType, error: Error, level: ErrorLevel = 'error', payload?: unknown): void {
    const context = createErrorContext(storeName, operation, error, level, payload)
    this.handleError(context)
  }

  /**
   * 记录错误
   *
   * @private
   * @param {ErrorContext} context - 错误上下文
   */
  private logError(context: ErrorContext): void {
    this.errorLog.push(context)

    // 限制日志大小
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift()
    }
  }

  /**
   * 拷贝一条错误上下文
   *
   * 内部 errorLog 存的若是交给调用方的同一个对象，一句 `ctx.level = 'critical'`
   * 或 `ctx.error = ...` 就会污染此后所有查询与统计，故对外一律给副本。
   * 浅拷贝已足够：`error`/`payload` 按约定是外部持有的不可变引用。
   *
   * @private
   */
  private copyContext(context: ErrorContext): ErrorContext {
    return { ...context }
  }

  /**
   * 获取错误日志
   *
   * 返回所有错误上下文的副本（数组与条目均可安全修改，不影响内部状态）
   *
   * @returns {ErrorContext[]} 错误日志数组的副本
   *
   * @example
   * ```typescript
   * const logs = errorHandler.getErrorLog()
   * logs.forEach(log => {
   *   console.log(`[${log.level}] ${log.error.message}`)
   * })
   * ```
   */
  getErrorLog(): ErrorContext[] {
    return this.errorLog.map((context) => this.copyContext(context))
  }

  /**
   * 获取最近的错误
   *
   * @returns {ErrorContext | undefined} 最后一个错误上下文，如果没有则返回undefined
   *
   * @example
   * ```typescript
   * const lastError = errorHandler.getLastError()
   * if (lastError) {
   *   console.log('Last error:', lastError.error.message)
   * }
   * ```
   */
  getLastError(): ErrorContext | undefined {
    const last = this.errorLog[this.errorLog.length - 1]

    return last ? this.copyContext(last) : undefined
  }

  /**
   * 清除错误日志
   *
   * 删除所有已记录的错误
   *
   * @example
   * ```typescript
   * // 清空日志
   * errorHandler.clearErrorLog()
   * ```
   */
  clearErrorLog(): void {
    this.errorLog = []
  }

  /**
   * 设置最大日志大小
   *
   * 当日志超过指定大小时，最旧的错误会被移除
   *
   * @param {number} size - 最大日志数量（必须 >= 1）
   *
   * @example
   * ```typescript
   * // 只保留最近50条错误
   * errorHandler.setMaxLogSize(50)
   * ```
   */
  setMaxLogSize(size: number): void {
    // NaN/Infinity 守卫：Math.max(1, NaN) 返回 NaN，此后 logError 的
    // `length > this.maxLogSize` 与下方截断 while 条件恒为 false，
    // errorLog 会变成无界增长（入参可能来自 parseInt(配置) 等）
    this.maxLogSize = Number.isFinite(size) ? Math.max(1, size) : DEFAULT_MAX_LOG_SIZE

    // 如果当前日志超过新大小，截断
    while (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift()
    }
  }

  /**
   * 按操作类型筛选错误
   *
   * @param {OperationType} operation - 操作类型
   * @returns {ErrorContext[]} 匹配的错误列表
   *
   * @example
   * ```typescript
   * // 获取所有action相关的错误
   * const actionErrors = errorHandler.getErrorsByOperation('action-execution')
   * console.log(`Action errors: ${actionErrors.length}`)
   * ```
   */
  getErrorsByOperation(operation: OperationType): ErrorContext[] {
    return this.errorLog.filter((ctx) => ctx.operation === operation).map((ctx) => this.copyContext(ctx))
  }

  /**
   * 按错误级别筛选错误
   *
   * @param {ErrorLevel} level - 错误级别
   * @returns {ErrorContext[]} 匹配的错误列表
   *
   * @example
   * ```typescript
   * // 获取所有严重错误
   * const criticalErrors = errorHandler.getErrorsByLevel('critical')
   * if (criticalErrors.length > 0) {
   *   // 通知管理员
   *   alertAdmin(criticalErrors)
   * }
   * ```
   */
  getErrorsByLevel(level: ErrorLevel): ErrorContext[] {
    return this.errorLog.filter((ctx) => ctx.level === level).map((ctx) => this.copyContext(ctx))
  }

  /**
   * 获取错误统计信息
   *
   * 两个分组字段都是**稀疏**的：只包含实际出现过的级别 / 操作类型，
   * 未出现过的键不存在（而非 0），因此按 `Partial` 暴露——
   * 把它们预置成 0 会让「`Object.keys(byLevel)` 的长度」这类聚合口径失真。
   * 读侧请写 `stats.byLevel.warn ?? 0`。
   *
   * @returns {{total: number, byLevel: Partial<Record<ErrorLevel, number>>, byOperation: Record<string, number>}} 错误统计对象
   *
   * 键类型为 `string`（而非 `OperationType`）是刻意的：`OperationType` 是开放字符串
   * 联合的聚合口径，调用方传入自定义 operation 时也会原样出现在这里。
   *
   * @example
   * ```typescript
   * const stats = errorHandler.getErrorStats()
   * console.log(`Total: ${stats.total}`)
   * console.log(`Critical: ${stats.byLevel.critical ?? 0}`)
   * console.log(`Action errors: ${stats.byOperation['action-execution'] ?? 0}`)
   * ```
   */
  getErrorStats(): {
    total: number
    byLevel: Partial<Record<ErrorLevel, number>>
    byOperation: Record<string, number>
  } {
    const stats = {
      total: this.errorLog.length,
      byLevel: {} as Partial<Record<ErrorLevel, number>>,
      byOperation: {} as Record<string, number>,
    }

    for (const ctx of this.errorLog) {
      stats.byLevel[ctx.level] = (stats.byLevel[ctx.level] || 0) + 1
      stats.byOperation[ctx.operation] = (stats.byOperation[ctx.operation] || 0) + 1
    }

    return stats
  }
}

/**
 * 默认导出
 */
export { defaultErrorHandler, createErrorContext }
export type { ErrorContext, ErrorHandler, ErrorLevel, OperationType } from '../../types/error.js'
