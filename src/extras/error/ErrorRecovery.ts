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
 * 重试次数的合法化：非有限值与小数一律归到安全区间
 *
 * `currentAttempt >= maxRetries` 这条上限判定对 NaN 恒为 false、对 Infinity 恒为 true
 * 但永远达不到——两种输入都会让「防重试风暴」的上限形同虚设，重试循环按调用方的
 * 失败循环一路跑下去（配置常来自 `parseInt(untrustedConfig)` 之类，NaN 并不罕见）。
 * 负数/小数同样没有可用语义：负数等同 0（首次即判超限），小数会让上限随计数漂移。
 * 归一口径与 ErrorMonitoring 的 `normalizeCapacity` 一致：非法值回落到默认 3
 */
function normalizeMaxRetries(value: number | undefined, fallback = 3): number {
  if (value === undefined) {
    return fallback
  }
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
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
  /**
   * 错误码 → 恢复配置
   *
   * 用 `Map` 而非对象字面量：`error.code` 是开放字符串域（`code: string`），
   * 落在 `Object.prototype` 上的码名（`constructor` / `toString` / `__proto__`）会让
   * `strategies[code]` 命中原型链成员并被当作 `RecoveryConfig` 返回——`config.strategy`
   * 为 undefined，最终抛出误导方向的「Unknown recovery strategy: undefined」，
   * 而写入侧的 `obj.__proto__ = ...` 更是直接改原型而非建键。
   */
  private readonly strategies = new Map<string, RecoveryConfig>()
  private readonly retryCount = new Map<string, number>()
  /**
   * 重试键 → 当前故障周期的**到期时刻**
   *
   * 存到期时刻而非起始时间：容量守卫判定「某个键是否还在自己的周期里」时无需知道它
   * 用的是哪个策略的退避参数（不同 code 的周期窗可差几个数量级），因此也不必拿一个
   * 硬编码下限去比——那会把仍在自身窗口内的活跃键连计数一起删掉（风控被削弱）。
   */
  private readonly retryCycleEnd = new Map<string, number>()

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
    // 为每个策略补默认值后写进 Map：不再先组一个 `{}` 中间对象，
    // 那层中间对象正是 `__proto__` 键会触发原型 setter 的地方
    for (const [errorCode, config] of Object.entries(strategies)) {
      this.strategies.set(errorCode, {
        ...config,
        // 为RETRY策略添加默认值（maxRetries 经归一：NaN/Infinity 会让上限判定失效）
        ...(config.strategy === RecoveryStrategy.RETRY && {
          maxRetries: normalizeMaxRetries(config.maxRetries),
          retryDelay: config.retryDelay !== undefined ? config.retryDelay : 1000,
          exponentialBackoff: config.exponentialBackoff !== undefined ? config.exponentialBackoff : true,
        }),
      })
    }
  }

  /**
   * 获取错误恢复配置
   *
   * @param {string} errorCode - 错误代码
   * @returns {RecoveryConfig | undefined} 恢复配置
   */
  getConfig(errorCode: string): RecoveryConfig | undefined {
    return this.strategies.get(errorCode)
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
      this.retryCycleEnd.delete(retryKey)

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
        // 与 recover() 入口的两处抛出同口径：调用方普遍用 isGeomStoreError/error.code
        // 分类，裸 Error 会被当作「外来错误」绕过既有处理。strategy 与 originalCode 都进
        // context（前者让人一眼看出是配错还是被改写），cause 保留触发本次恢复的原始错误
        throw withCause(
          createError(ErrorCode.INTERNAL_ERROR, `[ErrorRecovery] Unknown recovery strategy: ${String(config.strategy)}`, {
            strategy: config.strategy,
            originalCode: context.error.code,
          }),
          context.error,
        )
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
    // 二次归一：strategies 可经 getConfig 之外的路径被直接改写（Map 由实例持有），
    // 归一放在读取侧才能保证上限判定与 cycleSpan/cycleWindow 的退避计算都拿到合法值
    const maxRetries = normalizeMaxRetries(config.maxRetries)
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
    const cycleEnd = this.retryCycleEnd.get(retryKey)
    if (cycleEnd === undefined || now > cycleEnd) {
      // 先 delete 再 set：`Map.set` 对已存在的键**不刷新插入顺序**，而下面的容量守卫正是
      // 按插入顺序从最旧端淘汰；不重插的话，刚开启新周期的活跃键会一直待在队首、
      // 在超限扫描里被当成「最旧键」优先删掉（连计数一起删 = 直接送一轮全新额度）
      this.retryCycleEnd.delete(retryKey)
      this.retryCount.delete(retryKey)
      this.retryCycleEnd.set(retryKey, now + cycleWindow)
    }

    // 容量守卫：动态 operation id（如 fetchUser:${id}）场景下，停止调用的键永不触发周期
    // 重置与清理，retryCycleEnd / retryCount 会无界增长。超过阈值时先清理**自身周期窗已
    // 到期**的键（每个键的到期时刻是各自策略算出的，故用 `now > end` 而不是一个全局阈值：
    // 拿硬编码 60s 判过期会把 cycleWindow 更长的活跃键连计数一起删掉，风控被削弱），
    // 仍超限则淘汰最旧插入的键（配合上面的重插，即「最早进入当前周期」的键）
    if (this.retryCycleEnd.size > MAX_RETRY_KEYS) {
      for (const [k, end] of this.retryCycleEnd) {
        if (now > end) {
          this.retryCycleEnd.delete(k)
          this.retryCount.delete(k)
        }
      }
      // 一次性清到上限内：每次 delete 都令 size 严格递减，配合循环条件必然终止
      // （此前用 `guard++ < MAX_RETRY_KEYS` 限制单轮淘汰量，键数远超上限时需多轮调用
      // 才收敛，且每轮都要重做一次 O(n) 的过期扫描）
      while (this.retryCycleEnd.size > MAX_RETRY_KEYS) {
        const oldest = this.retryCycleEnd.keys().next().value as string | undefined
        /* istanbul ignore if -- 循环条件已保证 size > MAX_RETRY_KEYS（非空），keys().next() 必有值 */
        if (oldest === undefined) break
        this.retryCycleEnd.delete(oldest)
        this.retryCount.delete(oldest)
      }
    }

    const currentAttempt = this.getRetryCount(retryKey)
    // 把真实计数回填给上下文（RecoveryContext.attempt 的文档口径）：本方法不读它，
    // 只保证诊断用途的字段不再恒为 0
    context.attempt = currentAttempt

    // 检查是否超过最大重试次数
    if (currentAttempt >= maxRetries) {
      // 达到上限时**保留**计数与周期窗：清键会让紧接的下一次 recover 落进上方
      // `cycleEnd === undefined` 分支、计数归零，于是调用方只要在同一失败循环里
      // 继续调用就每轮都能领到全新额度——max-retries 防重试风暴的保护实际上只对
      // 触发超限的那一次调用生效。新故障周期只由上方的时间窗过期判定开启。
      // 同样不按 code 级联全清——同码其他 store/operation 的进行中额度会被误重置。
      // 抛 GeomStoreError（同 recover() 入口与 executeRecovery 的 default 分支）：
      // 「Max retries exceeded」是调用方最需要按 code 分支处理的一种失败，裸 Error
      // 会让它落到「外来错误」通道里。retryKey 一并带上——两个 store 互相挤占额度时，
      // 没有键就无从判断被用满的是哪一份额度
      throw withCause(
        createError(ErrorCode.INTERNAL_ERROR, `[ErrorRecovery] Max retries (${maxRetries}) exceeded for error: ${error.message}`, {
          retryKey,
          attempts: currentAttempt,
        }),
        error,
      )
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

    // 配置缺失属策略内部失败：与 recover() 入口同口径抛 GeomStoreError 并挂 cause，
    // 调用方才能用 error.code 分支处理，而不是把它当外来错误绕过既有处理
    throw withCause(
      createError(ErrorCode.INTERNAL_ERROR, `[ErrorRecovery] No fallback value or function configured for error: ${error.message}`, {
        originalCode: error.code,
      }),
      error,
    )
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
      // 同 executeFallbackStrategy：策略内部失败也要能按 code 分支，不外泄裸 Error
      throw withCause(
        createError(ErrorCode.INTERNAL_ERROR, `[ErrorRecovery] No recover function configured for error: ${error.message}`, {
          originalCode: error.code,
        }),
        error,
      )
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
    this.retryCycleEnd.delete(retryKey)

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
   * @param {RecoveryContext} [context] - 本次恢复的调用上下文
   * @returns {string} 重试键
   *
   * @remarks 隔离粒度是「**被报出来的** Store/操作」，不是调用方身份：两处来源都缺时
   * 库内已无任何可区分的信息（`error.code` 已在键里，堆栈会把「同一逻辑故障在不同行
   * 构造」打散成多份额度，反而让防重试风暴失效——`REGR-RECOVERY-003` 锁的正是它们
   * 必须共用一份额度），此时**所有**未归因的调用共用一份额度，这是有意的粗粒度兜底。
   * 该桶在键名与抛出物里都写作 `unattributed` 并随 `retryKey` 一起回传，
   * 便于识别「被用满的是哪一份额度」；需要按 Store 隔离就由调用方传
   * `recover(error, { storeName, operation })`，或在 createError 的 context 里内嵌二者。
   */
  private getRetryKey(error: GeomStoreError, context?: RecoveryContext): string {
    // recover() 的第二个参数与会话内嵌 context 都是合法来源：单看 error.context 会让
    // 「错误对象未内嵌 context、由调用方按 Store/操作传入」的场景全部落到未归因桶，
    // 不同 Store 的重试额度互相挤占（A 用满后 B 也被判超限）
    const storeName = context?.storeName || error.context?.storeName
    const operation = context?.operation || error.context?.operation
    if (storeName === undefined && operation === undefined) {
      return `${error.code}:unattributed`
    }
    // 只缺一个维度时仍按已报出的维度隔离，缺失侧留 unknown 占位
    const storeSegment = storeName ?? 'unknown'
    const operationSegment = operation ?? 'unknown'
    // 键只做**整串精确匹配**（get/set/delete 用同一个 getRetryKey 产物），从不按 ':' 切分
    // 或做前缀匹配：因此 code/storeName/operation 含 ':' 至多让两段边界挪位，不会误命中
    // 别人的计数。若将来要按 code 级联清理，必须改成嵌套 Map 或 JSON 元组，不要回到 split
    return `${error.code}:${storeSegment}:${operationSegment}`
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
    this.retryCycleEnd.clear()
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
