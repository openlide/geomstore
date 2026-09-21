/**
 * GeomStore - 错误恢复的类型与常量
 *
 * 自 ErrorRecovery.ts 拆出：恢复策略枚举、配置/上下文类型与重试键容量上限。
 *
 * @module extras/error/recoveryTypes
 */

import type { GeomStoreError } from '../../core/errors/GeomStoreError.js'

/** retryWindowStart / retryCount 的容量上限：防止动态 operation id 场景下的无界增长 */
export const MAX_RETRY_KEYS = 1000

/**
 * 错误恢复策略类型
 *
 * @enum {string}
 * @description
 * 定义不同的错误恢复策略：
 * - RETRY: 延迟后重抛原错误，由调用方重试（库内无原操作引用，无法自动重试）
 * - FALLBACK: 使用回退值
 * - IGNORE: 忽略错误
 * - RESTART: 重启相关组件。刻意不接受任何配置、结果恒为 undefined：与 RETRY 同理，
 *   库内不持有组件引用，无法自行重启；undefined 即「需要调用方重启」的信号，
 *   重启动作与重启对象由调用方决定，故不提供 restartFn/restartTarget 之类的钩子
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

  /**
   * 最大重试次数（仅 RETRY 策略）
   *
   * 缺省默认 3（ErrorRecovery.configure / executeRetryStrategy 静默补值，读本接口即知实际额度）。
   * 取值范围：正整数。0 会使首次失败直接命中「Max retries exceeded」分支而完全放弃重试；
   * 负数与 0 同（`currentAttempt >= maxRetries` 恒成立），均非「无限重试」语义
   */
  maxRetries?: number

  /**
   * 重试延迟（毫秒）（仅 RETRY 策略）
   *
   * 缺省默认 1000。取值范围：>= 0。0 表示不等待立即重试；负数传入 setTimeout 会被
   * 归一为 0（同样是立即重试），如需退避请配 exponentialBackoff
   */
  retryDelay?: number

  /**
   * 是否使用指数退避（仅 RETRY 策略）
   *
   * 缺省默认 true。为 true 时实际延迟为 `retryDelay * 2^已试次数`；
   * 为 false 时每次固定 retryDelay
   */
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
