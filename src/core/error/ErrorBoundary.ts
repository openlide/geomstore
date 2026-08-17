/**
 * GeomStore v1.0 - 错误边界
 *
 * 提供函数执行时的错误捕获和恢复机制
 *
 * @since 1.0.0
 */

import type { ErrorBoundaryOptions, ErrorFallback } from '../../types/error'

/**
 * 错误边界类
 *
 * 用于捕获和处理函数执行过程中的错误，支持错误恢复和回退状态
 *
 * @class ErrorBoundary
 * @template S - 状态类型
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const boundary = new ErrorBoundary<MyState>({
 *   fallback: { count: 0, user: null },
 *   recoverable: true,
 *   onError: (error) => {
 *     console.error('Error occurred:', error)
 *   }
 * })
 *
 * // 执行可能出错的函数
 * const result = boundary.execute(() => {
 *   return riskyOperation()
 * }, currentState)
 *
 * // 异步执行
 * const asyncResult = await boundary.executeAsync(async () => {
 *   return await riskyAsyncOperation()
 * })
 * ```
 */
export class ErrorBoundary<S = unknown> {
  /**
   * 回退状态（固定值或计算函数）
   * @private
   * @type {ErrorFallback<S> | undefined}
   */
  private fallback?: ErrorFallback<S>

  /**
   * 错误回调函数
   * @private
   * @type {(error: Error) => void | undefined}
   */
  private onErrorCallback?: (error: Error) => void

  /**
   * 是否可恢复
   * @private
   * @type {boolean}
   */
  private recoverable: boolean = false

  /**
   * 错误历史记录
   * @private
   * @type {Error[]}
   */
  private errorHistory: Error[] = []

  /**
   * 创建错误边界实例
   *
   * @param {ErrorBoundaryOptions} [options={}] - 配置选项
   *
   * @example
   * ```typescript
   * const boundary = new ErrorBoundary({
   *   fallback: { count: 0 },
   *   recoverable: true,
   *   onError: (error) => alert(error.message)
   * })
   * ```
   */
  constructor(options: ErrorBoundaryOptions<S> = {}) {
    this.fallback = options.fallback
    this.onErrorCallback = options.onError
    this.recoverable = options.recoverable ?? true
  }

  /**
   * 执行函数并捕获错误
   *
   * 如果函数执行抛出错误，根据配置决定是恢复还是重新抛出
   *
   * @template T - 返回值类型
   * @param {() => T} fn - 要执行的函数
   * @param {S} [currentState] - 当前状态（用于回退）
   * @returns {T | undefined} 函数执行结果，如果错误且可恢复则返回undefined
   * @throws {Error} 如果错误且不可恢复则重新抛出
   *
   * @example
   * ```typescript
   * const result = boundary.execute(() => {
   *   return state.value * 2
   * }, state)
   *
   * // 处理可能出错的操作
   * const safeResult = boundary.execute(() => {
   *   throw new Error('Error')
   * }, state)
   * // safeResult will be undefined, error is handled
   * ```
   */
  execute<T>(fn: () => T, currentState?: S): T | undefined {
    try {
      return fn()
    } catch (error) {
      // fallback 值与 fn 返回类型可能不同（类型层面以 T 为准），
      // 运行时不依赖类型，直接透传回退值
      return this.handleError(error as Error, currentState) as T | undefined
    }
  }

  /**
   * 异步执行函数并捕获错误
   *
   * 如果函数执行抛出错误，根据配置决定是恢复还是重新抛出
   *
   * @template T - 返回值类型
   * @param {() => Promise<T>} fn - 要执行的异步函数
   * @param {S} [currentState] - 当前状态（用于回退）
   * @returns {Promise<T | undefined>} 函数执行结果，如果错误且可恢复则返回undefined
   * @throws {Error} 如果错误且不可恢复则重新抛出
   *
   * @example
   * ```typescript
   * const result = await boundary.executeAsync(async () => {
   *   return await fetchData()
   * }, state)
   *
   * // 处理可能出错的异步操作
   * const safeResult = await boundary.executeAsync(async () => {
   *   throw new Error('Error')
   * }, state)
   * ```
   */
  async executeAsync<T>(fn: () => Promise<T>, currentState?: S): Promise<T | undefined> {
    try {
      return await fn()
    } catch (error) {
      // 同 execute：回退值透传，类型层面以 T 为准
      return this.handleError(error as Error, currentState) as T | undefined
    }
  }

  /**
   * 处理错误
   *
   * @private
   * @param {Error} error - 错误对象
   * @param {S} [currentState] - 当前状态
   * @returns {S | undefined} 回退状态（若配置）；未配置回退时返回 undefined
   * @throws {Error} 如果错误且不可恢复
   */
  private handleError(error: Error, currentState?: S): S | undefined {
    // 记录错误
    this.errorHistory.push(error)

    // 调用错误回调
    if (this.onErrorCallback) {
      try {
        this.onErrorCallback(error)
      } catch (callbackError) {
        console.error('[ErrorBoundary] Error in onError callback:', callbackError)
      }
    }

    // 如果不可恢复，重新抛出
    if (!this.recoverable) {
      throw error
    }

    // 返回回退状态：支持固定值与根据错误/当前状态动态计算
    if (this.fallback !== undefined) {
      console.warn('[ErrorBoundary] Returning fallback state due to error:', error.message)
      return typeof this.fallback === 'function' ? (this.fallback as (error: Error, currentState: S | undefined) => S)(error, currentState) : this.fallback
    }

    return undefined
  }

  /**
   * 获取回退状态
   *
   * @returns {S | undefined} 回退状态；若配置为计算函数则需结合错误上下文调用，此处返回undefined
   *
   * @example
   * ```typescript
   * const fallback = boundary.getFallbackState()
   * if (fallback) {
   *   console.log('Fallback state:', fallback)
   * }
   * ```
   */
  getFallbackState(): S | undefined {
    return typeof this.fallback === 'function' ? undefined : this.fallback
  }

  /**
   * 设置回退状态
   *
   * @param {S} state - 新的回退状态
   *
   * @example
   * ```typescript
   * boundary.setFallbackState({ count: 0, user: null })
   * ```
   */
  setFallbackState(state: S): void {
    this.fallback = state
  }

  /**
   * 获取错误历史
   *
   * 返回错误历史的副本，不影响原始数据
   *
   * @returns {Error[]} 错误历史数组的副本
   *
   * @example
   * ```typescript
   * const history = boundary.getErrorHistory()
   * history.forEach(error => {
   *   console.log(error.message)
   * })
   * ```
   */
  getErrorHistory(): Error[] {
    return [...this.errorHistory]
  }

  /**
   * 清除错误历史
   *
   * 删除所有已记录的错误
   *
   * @example
   * ```typescript
   * boundary.clearErrorHistory()
   * console.log(boundary.hasError()) // false
   * ```
   */
  clearErrorHistory(): void {
    this.errorHistory = []
  }

  /**
   * 检查是否有错误
   *
   * @returns {boolean} 如果错误历史不为空则返回true
   *
   * @example
   * ```typescript
   * if (boundary.hasError()) {
   *   const lastError = boundary.getLastError()
   *   console.error('Last error:', lastError?.message)
   * }
   * ```
   */
  hasError(): boolean {
    return this.errorHistory.length > 0
  }

  /**
   * 获取最后一个错误
   *
   * @returns {Error | undefined} 最后一个错误，如果没有则返回undefined
   *
   * @example
   * ```typescript
   * const lastError = boundary.getLastError()
   * if (lastError) {
   *   console.error('Most recent error:', lastError.message)
   * }
   * ```
   */
  getLastError(): Error | undefined {
    return this.errorHistory[this.errorHistory.length - 1]
  }
}

/**
 * 创建错误边界装饰器
 *
 * 用于装饰类方法，自动处理方法执行时的错误
 *
 * @param {ErrorBoundaryOptions} [options] - 配置选项
 * @returns {MethodDecorator} 方法装饰器
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * class MyComponent {
 *   @withErrorBoundary({
 *     fallback: { count: 0 },
 *     onError: (error) => console.error(error)
 *   })
 *   async loadData() {
 *     return await fetchData()
 *   }
 * }
 * ```
 */
export function withErrorBoundary(options?: ErrorBoundaryOptions) {
  const boundary = new ErrorBoundary(options)

  return function (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value

    descriptor.value = function (this: ThisParameterType<typeof originalMethod>, ...args: unknown[]) {
      // 同步阶段（含 async 方法的同步抛出）由 execute 包裹
      const result = boundary.execute(() => originalMethod.apply(this, args))
      // async 方法返回的 Promise 其 rejection 会绕过同步 try/catch，
      // 需改用 executeAsync 包裹，避免成为 unhandled rejection
      if (result instanceof Promise) {
        return boundary.executeAsync(() => result)
      }
      return result
    }

    return descriptor
  }
}

/**
 * 默认导出
 */
export type { ErrorBoundaryOptions } from '../../types/error'
