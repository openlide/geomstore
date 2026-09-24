/**
 * GeomStore - 错误处理器
 *
 * 提供统一的错误处理、记录和统计功能
 *
 */

import { createErrorContext, defaultErrorHandler, type ErrorContext, type ErrorHandler, type ErrorLevel, type OperationType } from '../../types/error.js'

/**
 * 错误条目上限的默认值 —— **唯一来源**：`ErrorHandler.errorLog` 的字段初始化、
 * `setMaxLogSize` 的非有限值回退，以及 `ErrorBoundary.errorHistory` 的裁剪都取本常量。
 *
 * 调这一处即同时改掉两侧上限（此前 `ErrorBoundary` 另写了一份字面量、注释却自称
 * 「与 ErrorHandler 同口径」，值各持一份 = 迟早漂移）。
 *
 * 导出仅供同目录复用；未经 barrel 再导出，不是公开 API。
 */
export const DEFAULT_MAX_LOG_SIZE = 100

/**
 * thenable 判定：只看**语法**（自带 callable `then`），不比对 `instanceof Promise`
 *
 * 跨 realm（iframe / worker / node:vm）的 Promise 与手写 thenable 的 `instanceof` 均为 false，
 * 只认 Promise 实例会让它们的 rejection 无人接收（unhandledRejection）。
 *
 * 导出仅供同目录复用（`ErrorBoundary` 的装饰器需要同一判据）；未经 barrel 再导出，不是公开 API。
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function'
}

/**
 * handler 失败的唯一出口：只落一条日志，绝不再抛
 *
 * 同步抛错与异步 rejection 共用它，两条路径的可见输出才会一致。
 */
function reportHandlerFailure(error: unknown): void {
  console.error('[ErrorHandler] Error in error handler:', error)
}

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
   * @remarks 允许传 async 函数（TS 的 void 返回签名并不排除它）：**被返回的那条 Promise**
   * 的 rejection 由 {@link ErrorHandlerImpl.handleError} 接住并折成一条 `console.error`，
   * 调用方拿不到「handler 失败」的信号；handler 内部另起而未返回的 Promise 不在保护范围内，
   * 需自行兜底。
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
   *
   * @remarks 处理器抛错被隔离成一条 `[ErrorHandler] Error in error handler:` 的
   * `console.error`，不外溢给调用方：本方法是错误链路的最后一环，让坏掉的上报 handler
   * 把原始错误顶替成二次异常，会让现场只剩 handler 的堆栈。异步 handler（返回 Promise 的
   * 函数可赋给 `(context) => void` 的签名）的 rejection 同样被接住并折成同一条日志——
   * 否则「上报错误」这条链路自己就能把进程搞崩（Node 下 unhandledRejection 可终止进程）。
   * context 在调用 handler 之前已写入 errorLog，因此 handler 长期失效时仍可由
   * `getErrorLog()`/`getErrorStats()` 观察到错误在累积——这是该取舍的兜底通道，也是不额外加
   * `onHandlerError` 钩子的理由（钩子本身同样可能抛错，且要新增公开 API）。
   */
  handleError(context: ErrorContext): void {
    // 记录错误
    this.logError(context)

    // 交给 handler 的是副本：传同一个对象时，handler 里一句 `ctx.level = 'critical'`
    // 或 `ctx.error = ...` 就静默改写了已入库的记录（见 copyContext 的不变量）
    let handlerResult: unknown
    try {
      handlerResult = this.handler(this.copyContext(context))
    } catch (error) {
      reportHandlerFailure(error)
      return
    }

    // 只在 handler 真的返回 thenable 时建 Promise 链：同步 handler（默认路径）不为此
    // 多付一次微任务，async handler 的 rejection 才有人接
    if (isThenable(handlerResult)) {
      Promise.resolve(handlerResult).catch(reportHandlerFailure)
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
    // 入库即取副本：留着调用方手里的同一个对象，则 `handleError(ctx)` 之后
    // 任何一句 `ctx.level = ...` 都会改写历史记录——副本不变量只在读取路径生效等于没做
    this.errorLog.push(this.copyContext(context))

    // 限制日志大小
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.shift()
    }
  }

  /**
   * 拷贝一条错误上下文
   *
   * 内部 errorLog 存的若是交给调用方的同一个对象，一句 `ctx.level = 'critical'`
   * 或 `ctx.error = ...` 就会污染此后所有查询与统计，故对外一律给副本——
   * 交给 handler 的那一份同样如此（handler 是长期驻留的用户代码，最容易出现「顺手改一下」）。
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
   * @param {number} size - 最大日志数量（必须 >= 1；小数向下取整，非有限值回退 {@link DEFAULT_MAX_LOG_SIZE}）
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
    // 取整只为让字段值等于实际容量：`length > 5.9` 的稳态本来就是 5 条，
    // 但字段留着 5.9 会让读它的人（和下面的截断循环）误算成 5.9 条；
    // 与 ActionHistoryTracker.setMaxHistory 的口径也由此一致
    this.maxLogSize = Number.isFinite(size) ? Math.max(1, Math.floor(size)) : DEFAULT_MAX_LOG_SIZE

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
    // byOperation 的键来自 `ErrorContext.operation`：类型上它是 OperationType，
    // 但 handle() 对 JS 调用方接受任意字符串（返回类型是 Record<string, number> 即因为这个），
    // 开放域的值会落进 `{}` 的原型链：`'__proto__'` 触发 Object.prototype 的 setter
    // （值是数字时被静默忽略，计数丢失），`'constructor'` / `'toString'` 则让
    // `stats.byOperation[k] ?? 0` 读出继承来的函数而不是计数。
    // 累计阶段用无原型对象承载（与本模块的 strategies 一致，ErrorRecovery 那边直接用 Map），
    // 但**返回普通对象**：对外的返回类型是 Record<string, number>，调用方
    // `stats.byOperation.hasOwnProperty(k)` 在类型上完全合法，把无原型对象直接交出去
    // 会让它在运行时抛 `hasOwnProperty is not a function`——修好统计却弄坏既有调用方。
    // 展开用 CreateDataProperty 语义（不触发 setter），故 `__proto__` 这个键搬回普通对象
    // 仍然是自有数据属性，不会改写原型
    const byOperation = Object.create(null) as Record<string, number>
    const byLevel = Object.create(null) as Partial<Record<ErrorLevel, number>>

    for (const ctx of this.errorLog) {
      byLevel[ctx.level] = (byLevel[ctx.level] || 0) + 1
      byOperation[ctx.operation] = (byOperation[ctx.operation] || 0) + 1
    }

    return { total: this.errorLog.length, byLevel: { ...byLevel }, byOperation: { ...byOperation } }
  }
}

/**
 * 命名再导出（本模块无 default export）
 *
 * `defaultErrorHandler` / `createErrorContext` 的**定义在 `src/types/error.ts`**，此处转发是为
 * 保持既有深导入路径（`extras/error/ErrorHandler.js`）可用；barrel 直接从定义模块导出。
 */
export { defaultErrorHandler, createErrorContext }
export type { ErrorContext, ErrorHandler, ErrorLevel, OperationType } from '../../types/error.js'
