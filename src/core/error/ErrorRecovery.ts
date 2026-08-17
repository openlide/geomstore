/**
 * GeomStore v1.0 - 错误恢复和回退策略
 *
 * 提供完整的错误恢复机制，包括：
 * - 错误恢复策略定义
 * - 自动错误恢复
 * - 回退值支持
 * - 错误重试机制
 */

import { GeomStoreError, isGeomStoreError, ErrorCode } from './GeomStoreError'

/**
 * 错误恢复策略类型
 *
 * @enum {string}
 * @description
 * 定义不同的错误恢复策略：
 * - RETRY: 延迟后重抛原错误，由调用方重试（库内无原操作引用，无法自动重试）
 * - FALLBACK: 使用回退值
 * - IGNORE: 忽略错误
 * - RESTART: 重启相关组件
 * - RECOVER: 执行自定义恢复逻辑
 */
export enum RecoveryStrategy {
  RETRY = 'retry',
  FALLBACK = 'fallback',
  IGNORE = 'ignore',
  RESTART = 'restart',
  RECOVER = 'recover',
}

/**
 * 错误恢复配置
 *
 * @interface RecoveryConfig
 * @description
 * 定义错误恢复的配置选项
 */
export interface RecoveryConfig {
  /** 恢复策略 */
  strategy: RecoveryStrategy

  /** 最大重试次数（仅RETRY策略） */
  maxRetries?: number

  /** 重试延迟（毫秒）（仅RETRY策略） */
  retryDelay?: number

  /** 是否使用指数退避（仅RETRY策略） */
  exponentialBackoff?: boolean

  /** 回退值（仅FALLBACK策略） */
  fallback?: unknown

  /** 回退函数（仅FALLBACK策略） */
  fallbackFn?: (error: GeomStoreError) => unknown

  /** 恢复函数（仅RECOVER策略） */
  recoverFn?: (error: GeomStoreError) => unknown

  /** 是否需要恢复的条件函数 */
  shouldRecover?: (error: GeomStoreError) => boolean

  /** 重试前的回调 */
  onRetry?: (error: GeomStoreError, attempt: number) => void

  /** 恢复成功的回调 */
  onRecovery?: (error: GeomStoreError, result: unknown) => void

  /** 恢复失败的回调 */
  onRecoveryFailed?: (error: GeomStoreError, recoveryError: Error) => void
}

/**
 * 错误恢复策略映射
 *
 * @type {RecoveryStrategyMap}
 * @description
 * 将错误代码映射到恢复配置
 */
export type RecoveryStrategyMap = Record<string, RecoveryConfig>

/**
 * 恢复上下文
 *
 * @interface RecoveryContext
 * @description
 * 提供错误恢复过程中的上下文信息
 */
export interface RecoveryContext {
  /** 原始错误 */
  error: GeomStoreError

  /** 恢复配置 */
  config: RecoveryConfig

  /** 当前重试次数 */
  attempt: number

  /** Store名称（如果适用） */
  storeName?: string

  /** 操作名称（如果适用） */
  operation?: string
}

/**
 * 错误恢复器类
 *
 * @class ErrorRecovery
 * @description
 * 实现自动错误恢复机制，支持多种恢复策略
 *
 * @example
 * ```typescript
 * const recovery = new ErrorRecovery()
 *
 * // 配置重试策略
 * recovery.configure({
 *   [ErrorCode.ACTION_EXECUTION_ERROR]: {
 *     strategy: RecoveryStrategy.RETRY,
 *     maxRetries: 3,
 *     retryDelay: 1000,
 *     exponentialBackoff: true,
 *     onRetry: (error, attempt) => {
 *       console.log(`Retry attempt ${attempt} for error:`, error.message)
 *     }
 *   }
 * })
 *
 * // 尝试恢复错误
 * const result = await recovery.recover(error, {
 *   storeName: 'user-store',
 *   operation: 'fetchData'
 * })
 * ```
 */
export class ErrorRecovery {
  private strategies: RecoveryStrategyMap = {}
  private retryCount = new Map<string, number>()

  /**
   * 配置错误恢复策略
   *
   * @param {RecoveryStrategyMap} strategies - 错误代码到恢复配置的映射
   *
   * @example
   * ```typescript
   * recovery.configure({
   *   [ErrorCode.ACTION_TIMEOUT]: {
   *     strategy: RecoveryStrategy.RETRY,
   *     maxRetries: 5,
   *     retryDelay: 2000
   *   },
   *   [ErrorCode.STATE_KEY_NOT_FOUND]: {
   *     strategy: RecoveryStrategy.FALLBACK,
   *     fallback: undefined
   *   }
   * })
   * ```
   */
  configure(strategies: RecoveryStrategyMap): void {
    // 为每个策略添加默认值
    const normalizedStrategies: RecoveryStrategyMap = {}
    for (const [errorCode, config] of Object.entries(strategies)) {
      normalizedStrategies[errorCode] = {
        ...config,
        // 为RETRY策略添加默认值
        ...(config.strategy === RecoveryStrategy.RETRY && {
          maxRetries: config.maxRetries !== undefined ? config.maxRetries : 3,
          retryDelay: config.retryDelay !== undefined ? config.retryDelay : 1000,
          exponentialBackoff: config.exponentialBackoff !== undefined ? config.exponentialBackoff : true,
        }),
      }
    }
    this.strategies = { ...this.strategies, ...normalizedStrategies }
  }

  /**
   * 获取错误恢复配置
   *
   * @param {string} errorCode - 错误代码
   * @returns {RecoveryConfig | undefined} 恢复配置
   */
  getConfig(errorCode: string): RecoveryConfig | undefined {
    return this.strategies[errorCode]
  }

  /**
   * 尝试恢复错误
   *
   * @param {unknown} error - 错误对象
   * @param {Partial<RecoveryContext>} context - 恢复上下文
   * @returns {Promise<unknown>} 恢复结果
   * @throws {Error} 如果无法恢复错误
   *
   * @example
   * ```typescript
   * try {
   *   await store.dispatch('fetchData')
   * } catch (error) {
   *   const result = await recovery.recover(error, {
   *     storeName: 'user-store',
   *     operation: 'fetchData'
   *   })
   *   // 如果成功恢复，result包含恢复后的值
   * }
   * ```
   */
  async recover(error: unknown, context: Partial<RecoveryContext> = {}): Promise<unknown> {
    // 验证错误类型
    if (!isGeomStoreError(error)) {
      throw new Error('[ErrorRecovery] Can only recover GeomStoreError instances')
    }

    // 获取恢复配置
    const config = this.getConfig(error.code)
    if (!config) {
      throw new Error(`[ErrorRecovery] No recovery strategy configured for error code: ${error.code}`)
    }

    // 检查是否应该恢复
    if (config.shouldRecover && !config.shouldRecover(error)) {
      throw error
    }

    // 构建恢复上下文
    const recoveryContext: RecoveryContext = {
      error,
      config,
      attempt: 0,
      ...context,
    }

    // 根据策略执行恢复
    try {
      const result = await this.executeRecovery(recoveryContext)

      // 恢复成功回调
      if (config.onRecovery) {
        try {
          config.onRecovery(error, result)
        } catch (callbackError) {
          console.error('[ErrorRecovery] Error in onRecovery callback:', callbackError)
        }
      }

      // 清除重试计数
      this.clearRetryCount(error.code)

      return result
    } catch (recoveryError) {
      // 恢复失败回调
      if (config.onRecoveryFailed) {
        try {
          config.onRecoveryFailed(error, recoveryError as Error)
        } catch (callbackError) {
          console.error('[ErrorRecovery] Error in onRecoveryFailed callback:', callbackError)
        }
      }

      throw recoveryError
    }
  }

  /**
   * 执行恢复策略
   *
   * @private
   * @param {RecoveryContext} context - 恢复上下文
   * @returns {Promise<unknown>} 恢复结果
   */
  private async executeRecovery(context: RecoveryContext): Promise<unknown> {
    const { config } = context

    switch (config.strategy) {
      case RecoveryStrategy.RETRY:
        return this.executeRetryStrategy(context)

      case RecoveryStrategy.FALLBACK:
        return this.executeFallbackStrategy(context)

      case RecoveryStrategy.IGNORE:
        return { ignored: true }

      case RecoveryStrategy.RECOVER:
        return this.executeRecoverStrategy(context)

      case RecoveryStrategy.RESTART:
        return this.executeRestartStrategy(context)

      default:
        throw new Error(`[ErrorRecovery] Unknown recovery strategy: ${config.strategy}`)
    }
  }

  /**
   * 执行重试策略
   *
   * 语义：按退避延迟后重抛原错误，由调用方捕获后自行重试原操作
   * （ErrorRecovery 不持有原操作引用，无法在库内自动重试）。
   *
   * @private
   * @param {RecoveryContext} context - 恢复上下文
   * @returns {Promise<unknown>} 重试结果（实际总是重抛原错误）
   */
  private async executeRetryStrategy(context: RecoveryContext): Promise<unknown> {
    const { error, config } = context
    const maxRetries = config.maxRetries !== undefined ? config.maxRetries : 3
    const baseDelay = config.retryDelay !== undefined ? config.retryDelay : 1000
    const useExponentialBackoff = config.exponentialBackoff !== undefined ? config.exponentialBackoff : true

    // 获取重试计数
    const retryKey = this.getRetryKey(error)
    const currentAttempt = this.getRetryCount(retryKey)

    // 检查是否超过最大重试次数
    if (currentAttempt >= maxRetries) {
      // 达到上限：清除计数，避免调用方后续重试成功后额度被残留计数永久消耗
      this.clearRetryCount(error.code)
      throw new Error(`[ErrorRecovery] Max retries (${maxRetries}) exceeded for error: ${error.message}`)
    }

    // 更新重试计数
    this.incrementRetryCount(retryKey)

    // 执行重试回调
    if (config.onRetry) {
      try {
        config.onRetry(error, currentAttempt + 1)
      } catch (callbackError) {
        console.error('[ErrorRecovery] Error in onRetry callback:', callbackError)
      }
    }

    // 计算延迟
    const delay = useExponentialBackoff ? baseDelay * Math.pow(2, currentAttempt) : baseDelay

    // 等待延迟
    await this.delay(delay)

    // 抛出错误，让调用方重试
    throw error
  }

  /**
   * 执行回退策略
   *
   * @private
   * @param {RecoveryContext} context - 恢复上下文
   * @returns {unknown} 回退值
   */
  private executeFallbackStrategy(context: RecoveryContext): unknown {
    const { error, config } = context

    // 优先使用回退函数
    if (config.fallbackFn) {
      return config.fallbackFn(error)
    }

    // 使用静态回退值：用 'fallback' in config 区分「显式配置 undefined 回退值」与「未配置」，
    // 否则默认 VALIDATION_ERROR 策略的 fallback: undefined 永远走失败分支
    if ('fallback' in config) {
      return config.fallback
    }

    throw new Error(`[ErrorRecovery] No fallback value or function configured for error: ${error.message}`)
  }

  /**
   * 执行恢复策略
   *
   * @private
   * @param {RecoveryContext} context - 恢复上下文
   * @returns {Promise<unknown>} 恢复结果
   */
  private async executeRecoverStrategy(context: RecoveryContext): Promise<unknown> {
    const { error, config } = context

    if (!config.recoverFn) {
      throw new Error(`[ErrorRecovery] No recover function configured for error: ${error.message}`)
    }

    return await config.recoverFn(error)
  }

  /**
   * 执行重启策略
   *
   * @private
   * @param {RecoveryContext} context - 恢复上下文
   * @returns {unknown} 重启结果
   */
  private executeRestartStrategy(context: RecoveryContext): unknown {
    // 清除重试计数
    this.clearRetryCount(context.error.code)

    // 返回undefined，表示需要重启
    return undefined
  }

  /**
   * 获取重试计数
   *
   * @private
   * @param {string} key - 重试键
   * @returns {number} 当前重试次数
   */
  private getRetryCount(key: string): number {
    return this.retryCount.get(key) || 0
  }

  /**
   * 增加重试计数
   *
   * @private
   * @param {string} key - 重试键
   */
  private incrementRetryCount(key: string): void {
    const current = this.getRetryCount(key)
    this.retryCount.set(key, current + 1)
  }

  /**
   * 清除重试计数
   *
   * @private
   * @param {string} errorCode - 错误代码
   */
  private clearRetryCount(errorCode: string): void {
    const keys = Array.from(this.retryCount.keys())
    keys.forEach((key) => {
      if (key.startsWith(errorCode)) {
        this.retryCount.delete(key)
      }
    })
  }

  /**
   * 生成重试键
   *
   * @private
   * @param {GeomStoreError} error - 错误对象
   * @returns {string} 重试键
   */
  private getRetryKey(error: GeomStoreError): string {
    const storeName = error.context?.storeName || 'unknown'
    const operation = error.context?.operation || 'unknown'
    return `${error.code}:${storeName}:${operation}`
  }

  /**
   * 延迟执行
   *
   * @private
   * @param {number} ms - 延迟毫秒数
   * @returns {Promise<void>}
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 清除所有重试计数
   *
   * @example
   * ```typescript
   * recovery.clearAllRetryCounts()
   * ```
   */
  clearAllRetryCounts(): void {
    this.retryCount.clear()
  }
}

/**
 * 创建默认的错误恢复器
 *
 * @param {RecoveryStrategyMap} [strategies] - 自定义策略
 * @returns {ErrorRecovery} 错误恢复器实例
 *
 * @example
 * ```typescript
 * const recovery = createDefaultErrorRecovery({
 *   [ErrorCode.ACTION_TIMEOUT]: {
 *     strategy: RecoveryStrategy.RETRY,
 *     maxRetries: 3,
 *     retryDelay: 1000
 *   }
 * })
 * ```
 */
export function createDefaultErrorRecovery(strategies?: RecoveryStrategyMap): ErrorRecovery {
  const recovery = new ErrorRecovery()

  // 配置默认策略
  const defaultStrategies: RecoveryStrategyMap = {
    [ErrorCode.ACTION_TIMEOUT]: {
      strategy: RecoveryStrategy.RETRY,
      maxRetries: 3,
      retryDelay: 1000,
      exponentialBackoff: true,
      onRetry: (error, attempt) => {
        console.warn(`[ErrorRecovery] Retrying action (attempt ${attempt}):`, error.message)
      },
    },
    [ErrorCode.STATE_KEY_NOT_FOUND]: {
      strategy: RecoveryStrategy.IGNORE,
    },
    [ErrorCode.VALIDATION_ERROR]: {
      strategy: RecoveryStrategy.FALLBACK,
      fallback: undefined,
      onRecoveryFailed: (error) => {
        console.error('[ErrorRecovery] Validation error recovery failed:', error.message)
      },
    },
  }

  recovery.configure(defaultStrategies)

  // 应用自定义策略
  if (strategies) {
    recovery.configure(strategies)
  }

  return recovery
}

/**
 * 导出全局默认实例
 */
export const defaultErrorRecovery = createDefaultErrorRecovery()
