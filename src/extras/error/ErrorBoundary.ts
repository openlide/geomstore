/**
 * GeomStore - 错误边界
 *
 * 提供函数执行时的错误捕获和恢复机制
 *
 */

import type { ErrorBoundaryOptions, ErrorFallback } from '../../types/error.js'
import { DEFAULT_MAX_LOG_SIZE } from './ErrorHandler.js'

/**
 * 错误边界类
 *
 * 用于捕获和处理函数执行过程中的错误，支持错误恢复和回退状态
 *
 * @class ErrorBoundary
 * @template S - 状态类型
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
export class ErrorBoundary<S = unknown, F = undefined> {
  /**
   * 回退状态（固定值或计算函数）
   * @private
   * @type {ErrorFallback<F, S> | undefined}
   */
  private fallback?: ErrorFallback<F, S>

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
  /** recoverable 是否被显式设置（未显式时事后提供 fallback 视为恢复意图） */
  private recoverableExplicit: boolean

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
  constructor(options: ErrorBoundaryOptions<S, F> = {}) {
    this.fallback = options.fallback
    this.onErrorCallback = options.onError
    // 默认由 fallback 推导恢复意图（显式 recoverable 优先）：
    // 无 fallback 却吞错返回 undefined，错误会在远离根因处变成二次异常
    this.recoverableExplicit = options.recoverable !== undefined
    this.recoverable = options.recoverable ?? options.fallback !== undefined
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
   * @throws {Error} 错误且不可恢复时重抛原始错误；可恢复但 `fallback` 函数自身抛错时
   *   同样重抛**原始**错误（回退路径已失效，不返回 undefined），见 {@link ErrorBoundary.handleError}
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
  execute<T>(fn: () => T, currentState?: S): T | F | undefined {
    try {
      return fn()
    } catch (error) {
      // 可显式配 recoverable: true 而不配 fallback，此时 handleError 返回 undefined，
      // 返回类型必须含 undefined，否则调用方按 T | F 消费会在远端炸出二次异常
      return this.handleError(error, currentState)
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
   * @throws {Error} 与 {@link ErrorBoundary.execute} 同：不可恢复、或可恢复但 fallback
   *   函数自身抛错时重抛原始错误
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
  async executeAsync<T>(fn: () => Promise<T>, currentState?: S): Promise<T | F | undefined> {
    try {
      return await fn()
    } catch (error) {
      // 同 execute：可恢复且未配 fallback 时返回 undefined，返回类型必须含 undefined
      return this.handleError(error, currentState)
    }
  }

  /**
   * 处理错误
   *
   * @private
   * @param {unknown} rawError - 被捕获的原始抛出值（非 Error 会归一化为 Error 记录）
   * @param {S} [currentState] - 当前状态
   * @returns {S | undefined} 回退状态（若配置）；未配置回退时返回 undefined
   * @throws {Error} 如果错误且不可恢复
   */
  private handleError(rawError: unknown, currentState?: S): F | undefined {
    // 归一化：`throw 'str'` / `throw 42` 会让 errorHistory（声明为 Error[]）与
    // onError/fallback 拿到非 Error，下游读 .message/.stack 得到 undefined。
    // 重抛时仍用原始值，保持「原样向上抛」的既有捕获方语义
    const error: Error = rawError instanceof Error ? rawError : new Error(String(rawError))
    // 记录错误
    this.errorHistory.push(error)
    // 上限保护：与 ErrorHandler 的 errorLog 共用同一个 DEFAULT_MAX_LOG_SIZE（单一来源，
    // 调那一处常量即同时改掉两侧上限），高频失败场景下 Error 对象不再无界累积（此前只增
    // 不减，需手动 clearErrorHistory）。每个入口只 push 一条，故此处判后 shift 恰好丢掉最旧
    // 一条，等价于「保留最新 N 条」；本类的上限暂不对外开放（需要可调请走 ErrorHandler.setMaxLogSize
    // 的同类接口设计，属新增公开配置，不在本轮范围）
    if (this.errorHistory.length > DEFAULT_MAX_LOG_SIZE) {
      this.errorHistory.shift()
    }

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
      throw rawError
    }

    // 返回回退状态：支持固定值与根据错误/当前状态动态计算
    if (this.fallback !== undefined) {
      // 输出完整错误对象（含堆栈）而非仅 message：吞错路径的现场信息是排障唯一线索
      console.warn('[ErrorBoundary] Returning fallback state due to error:', error)
      if (typeof this.fallback === 'function') {
        // fallback 函数自身就是容错路径，出错概率不低：不加保护会以 fallback
        // 的异常顶替原错误逃逸（原错误现场丢失）。失败时重抛原错误，
        // 与上方 onError 回调的防护口径一致。
        // 刻意不「按 recoverable 语义返回 undefined」：回退值是容错的最后一道，它自己
        // 失败时本边界已无从恢复，改判成功会把容错路径的故障静默成一次「正常的 undefined」，
        // 调用方拿不到任何信号；此处抛出的是原始错误而非 fallback 异常，现场不失真
        try {
          return (this.fallback as (error: Error, currentState: S | undefined) => F)(error, currentState)
        } catch (fallbackError) {
          console.error('[ErrorBoundary] Error in fallback function:', fallbackError)
          throw rawError
        }
      }
      return this.fallback
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
  getFallbackState(): F | undefined {
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
  setFallbackState(state: F): void {
    this.fallback = state
    // 构造时未显式设置 recoverable 时，事后提供 fallback 即声明恢复意图；
    // 否则 fail-loud 默认在构造时锁死，fallback 永远不会被返回
    if (!this.recoverableExplicit) {
      this.recoverable = state !== undefined
    }
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
  // 修复闭包陷阱：boundary 不得在工厂作用域创建，否则同一装饰器装饰的
  // 所有类实例共享同一份 errorHistory/恢复状态。现按宿主对象（this）懒创建并隔离。
  // F 取 unknown：装饰器选项的 fallback 类型由调用方决定，这里只承载运行时
  const boundaryByHost = new WeakMap<object, ErrorBoundary<unknown, unknown>>()

  const getBoundary = (host: unknown): ErrorBoundary<unknown, unknown> => {
    if (typeof host !== 'object' || host === null) {
      // 宿主非对象（罕见）：每次调用一次性实例，不跨调用串扰
      return new ErrorBoundary(options)
    }
    let boundary = boundaryByHost.get(host)
    if (!boundary) {
      boundary = new ErrorBoundary(options)
      boundaryByHost.set(host, boundary)
    }
    return boundary
  }

  return function (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value

    // 访问器描述符（get/set）与非函数属性的 value 是 undefined：晚到失败只会抛出
    // `originalMethod.apply is not a function`，故在装饰阶段拒绝
    if (typeof originalMethod !== 'function') {
      throw new TypeError('[withErrorBoundary] can only decorate a method, but the descriptor.value is not a function')
    }

    descriptor.value = function (this: ThisParameterType<typeof originalMethod>, ...args: unknown[]) {
      const boundary = getBoundary(this)
      // 同步阶段（含 async 方法的同步抛出）由 execute 包裹
      const result = boundary.execute(() => originalMethod.apply(this, args))
      // Promise rejection（含 async 方法的 rejection）会绕过同步 try/catch，
      // 需改用 executeAsync 包裹，避免成为 unhandled rejection。
      // 用 then 鸭子类型而非 instanceof Promise：跨 realm Promise（iframe/worker）
      // 与自定义 thenable 的 instanceof 为 false，其 rejection 会被漏掉
      const isThenable =
        result !== null && (typeof result === 'object' || typeof result === 'function') && typeof (result as { then?: unknown }).then === 'function'
      if (isThenable) {
        return boundary.executeAsync(() => result as Promise<unknown>)
      }
      return result
    }

    return descriptor
  }
}

/**
 * 默认导出
 */
export type { ErrorBoundaryOptions } from '../../types/error.js'
