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

  /**
   * 回退值（仅FALLBACK策略）
   *
   * 与 {@link RecoveryConfig.fallbackFn} 的优先级：**fallbackFn 在前**，配了 fallbackFn 时
   * 本字段被忽略；两者都没配则 FALLBACK 策略抛错（`No fallback value or function configured`）。
   *
   * 类型是 `unknown` 而非某个具体形状，因此「回退值就是 undefined」是合法配置，
   * 与「没配」在类型上无法区分；引擎按 **`'fallback' in config`** 判定是否配过
   * （见 `ErrorRecovery.executeFallbackStrategy`），故默认策略里 `fallback: undefined`
   * 表示「显式回退到 undefined」。反过来说：不要靠展开/序列化搬运 config 后还指望
   * 该键保留（删掉键就等于没配回退值）。做成 `{ value: unknown }` 之类的判别式联合
   * 能消除这层歧义，但会破坏已发布的公开配置形状，故保留现形并在此写明判据。
   */
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

  /**
   * 本次恢复进入策略时该重试键已消耗的尝试次数
   *
   * 由引擎填充：`recover()` 总是以 0 起算（调用方传入的同名字段会被覆盖，避免外部
   * 伪造计数），随后 `executeRetryStrategy` 按内部计数表把它写成该键已试次数（首次为 0），
   * 因此只有 RETRY 策略下会被更新；其余策略（FALLBACK/IGNORE/RECOVER/RESTART）不做
   * 重试记账，恒为 0。本字段仅供诊断，不参与策略判定，也不会作为参数传给任何用户回调
   */
  attempt: number

  /** Store名称（如果适用） */
  storeName?: string

  /** 操作名称（如果适用） */
  operation?: string
}
