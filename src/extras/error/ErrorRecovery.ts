/**
 * GeomStore - 错误恢复和回退策略
 *
 * 提供完整的错误恢复机制，包括：
 * - 错误恢复策略定义
 * - 自动错误恢复
 * - 回退值支持
 * - 错误重试机制
 */

import { GeomStoreError, isGeomStoreError, createError, ErrorCode } from '../../core/errors/GeomStoreError.js'
import { MAX_RETRY_KEYS, RecoveryStrategy, type RecoveryConfig, type RecoveryContext, type RecoveryStrategyMap } from './recoveryTypes.js'

// 类型与常量已拆至 ./recoveryTypes.js；此处再导出以保持既有导入路径（extras/error/ErrorRecovery.js）不变
export { RecoveryStrategy } from './recoveryTypes.js'
export type { RecoveryConfig, RecoveryContext, RecoveryStrategyMap } from './recoveryTypes.js'

/**
 * 给元错误挂上原始抛出值作为 cause。
 *
 * target/lib 为 ES2020，`Error` 构造器无 `cause` 选项签名，用属性赋值补齐，
 * 保证「非 GeomStoreError / 未配置策略」两类抛出仍可回溯原始错误
 */
function withCause<T extends Error>(meta: T, original: unknown): T {
  const tagged = meta as Error & { cause?: unknown }
  tagged.cause = original
  return meta
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
  // 重试键 → 当前故障周期起始时间：以时间窗识别「新故障周期」并重置计数
  private retryWindowStart = new Map<string, number>()

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
      // 抛 GeomStoreError（PARAMETER_ERROR）而非裸 Error：本模块调用方普遍用
      // isGeomStoreError/error.code 分类错误，裸 Error 会被当作「外来错误」绕过
      // 既有处理；原始抛出值挂 cause 保留（ES2020 lib 的 Error 构造器无 cause
      // 选项，用赋值补）
      throw withCause(
        createError(ErrorCode.PARAMETER_ERROR, '[ErrorRecovery] Can only recover GeomStoreError instances', {
          receivedName: (error as { name?: unknown } | null)?.name ?? typeof error,
        }),
        error,
      )
    }

    // 获取恢复配置
    const config = this.getConfig(error.code)
    if (!config) {
      // 同上：context.originalCode 保留入错配置的错误码，供调用方分类排查
      throw withCause(
        createError(ErrorCode.INTERNAL_ERROR, `[ErrorRecovery] No recovery strategy configured for error code: ${error.code}`, {
          originalCode: error.code,
        }),
        error,
      )
    }

    // 检查是否应该恢复
    if (config.shouldRecover && !config.shouldRecover(error)) {
      throw error
    }

    // 构建恢复上下文：受控字段（error/config 由本方法按 error.code 查表得到）必须后写，
    // 否则调用方传入的 Partial<RecoveryContext> 可覆盖它们，使实际执行的策略与
    // error.code 查到的不一致，重试记账的 getRetryKey 也会错位
    const recoveryContext: RecoveryContext = {
      ...context,
      error,
      config,
      attempt: 0,
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

      // 仅清除当前重试键的计数与周期窗：恢复成功只代表本 (store, operation) 的
      // 故障周期结束。按 error.code 级联清除会误重置同码其他进行中的额度，
      // 违反 executeRetryStrategy max-retries 分支自述的键级不变量
      const retryKey = this.getRetryKey(error, recoveryContext)
      this.retryCount.delete(retryKey)
      this.retryWindowStart.delete(retryKey)

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

    // 获取重试计数（键按 Store/操作隔离，缺省取会话内嵌 context）
    const retryKey = this.getRetryKey(error, context)

    // 以时间窗识别「新故障周期」：窗口覆盖本周期 maxRetries 次重试的全部退避时长
    // （2 倍余量，下限 60s）。窗口内即使每次失败都以新错误实例触发 recover（调用方
    // 每轮重试 createError 后再 recover 的文档化用法），额度也持续累计，max-retries
    // 防重试风暴保护不会失效；超过窗口未再出现视为上一周期已结束（调用方重试成功后
    // 不再调用 recover，残留计数无清除路径），重置计数使额度按周期而非按错误码终身累计。
    // 周期判定是启发式：调用方自身重试耗时若使间隔超出窗口，会被视为新周期重新计额
    const now = Date.now()
    const cycleSpan = useExponentialBackoff ? baseDelay * (Math.pow(2, maxRetries) - 1) : baseDelay * maxRetries
    const cycleWindow = Math.max(60_000, cycleSpan * 2)
    const windowStart = this.retryWindowStart.get(retryKey)
    if (windowStart === undefined || now - windowStart > cycleWindow) {
      this.retryWindowStart.set(retryKey, now)
      this.retryCount.delete(retryKey)
    }

    // 容量守卫：动态 operation id（如 fetchUser:${id}）场景下，停止调用的键永不触发周期
    // 重置与清理，retryWindowStart / retryCount 会无界增长。超过阈值时先清理已过期窗口
    // （最小窗口 60s）的键，仍超限则淘汰最旧插入的键（Map 保留插入顺序），与超窗口重置
    // 语义一致，避免内存泄漏
    if (this.retryWindowStart.size > MAX_RETRY_KEYS) {
      const expiredCutoff = now - 60_000
      for (const [k, ws] of this.retryWindowStart) {
        if (ws < expiredCutoff) {
          this.retryWindowStart.delete(k)
          this.retryCount.delete(k)
        }
      }
      // 一次性清到上限内：每次 delete 都令 size 严格递减，配合循环条件必然终止
      // （此前用 `guard++ < MAX_RETRY_KEYS` 限制单轮淘汰量，键数远超上限时需多轮调用
      // 才收敛，且每轮都要重做一次 O(n) 的过期扫描）
      while (this.retryWindowStart.size > MAX_RETRY_KEYS) {
        const oldest = this.retryWindowStart.keys().next().value as string | undefined
        /* istanbul ignore if -- 循环条件已保证 size > MAX_RETRY_KEYS（非空），keys().next() 必有值 */
        if (oldest === undefined) break
        this.retryWindowStart.delete(oldest)
        this.retryCount.delete(oldest)
      }
    }

    const currentAttempt = this.getRetryCount(retryKey)

    // 检查是否超过最大重试次数
    if (currentAttempt >= maxRetries) {
      // 达到上限：仅清除当前键的计数与周期窗（下一故障周期从 0 重新开始）。
      // 不按 code 级联全清——同码其他 store/operation 的进行中额度会被误重置，
      // 防重试风暴的上限保护对它们失效
      this.retryCount.delete(retryKey)
      this.retryWindowStart.delete(retryKey)
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
    // 仅清当前重试键，不按 code 级联（与恢复成功路径同口径，避免误重置同码其他额度）
    const retryKey = this.getRetryKey(context.error, context)
    this.retryCount.delete(retryKey)
    this.retryWindowStart.delete(retryKey)

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
   * 生成重试键
   *
   * @private
   * @param {GeomStoreError} error - 错误对象
   * @returns {string} 重试键
   */
  private getRetryKey(error: GeomStoreError, context?: RecoveryContext): string {
    // recover() 的第二个参数与会话内嵌 context 都是合法来源：单看 error.context 会让
    // 「错误对象未内嵌 context、由调用方按 Store/操作传入」的场景全部落到 unknown，
    // 不同 Store 的重试额度互相挤占（A 用满后 B 也被判超限）
    const storeName = context?.storeName || error.context?.storeName || 'unknown'
    const operation = context?.operation || error.context?.operation || 'unknown'
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
   * 计数与周期窗必须一起清。只清计数会留下陈旧窗口，
   * 该窗口在中途过期时触发额度重置，使 max-retries 防重试风暴保护被击穿
   * （原本应被拦截的重试被放行），且残留窗口条目再无释放路径。
   *
   * @example
   * ```typescript
   * recovery.clearAllRetryCounts()
   * ```
   */
  clearAllRetryCounts(): void {
    this.retryCount.clear()
    this.retryWindowStart.clear()
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
