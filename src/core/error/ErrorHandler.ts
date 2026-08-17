/**
 * GeomStore v1.0 - 错误处理器
 *
 * 提供统一的错误处理、记录和统计功能
 *
 * @since 1.0.0
 */

import { createErrorContext, defaultErrorHandler, type ErrorContext, type ErrorHandler, type ErrorLevel, type OperationType } from '../../types/error'

/**
 * 错误处理器类
 *
 * 用于管理GeomStore运行过程中的错误处理、记录和统计
 *
 * @class ErrorHandlerImpl
 * @since 1.0.0
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
  private maxLogSize: number = 100

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
   * 获取错误日志
   *
   * 返回所有错误上下文的副本
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
    return [...this.errorLog]
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
    return this.errorLog[this.errorLog.length - 1]
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
    this.maxLogSize = Math.max(1, size)

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
    return this.errorLog.filter((ctx) => ctx.operation === operation)
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
    return this.errorLog.filter((ctx) => ctx.level === level)
  }

  /**
   * 获取错误统计信息
   *
   * 返回按级别和操作类型分组的错误统计
   *
   * @returns {{total: number, byLevel: Record<ErrorLevel, number>, byOperation: Record<OperationType, number>}} 错误统计对象
   *
   * @example
   * ```typescript
   * const stats = errorHandler.getErrorStats()
   * console.log(`Total: ${stats.total}`)
   * console.log(`Critical: ${stats.byLevel.critical}`)
   * console.log(`Action errors: ${stats.byOperation['action-execution']}`)
   * ```
   */
  getErrorStats(): {
    total: number
    byLevel: Record<ErrorLevel, number>
    byOperation: Record<string, number>
  } {
    const stats = {
      total: this.errorLog.length,
      byLevel: {} as Record<ErrorLevel, number>,
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
export type { ErrorContext, ErrorHandler, ErrorLevel, OperationType } from '../../types/error'
