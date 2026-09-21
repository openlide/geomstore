/**
 * GeomStore - 日志装饰器
 *
 * 在Action执行前后记录日志，便于调试
 *
 */

import { isProduction } from '../../../core/store/utils.js'
import { createDecorator } from './common.js'

/** 日志输出口：与 console 的 (message, ...data) 形状一致，便于直接接入项目 logger */
export interface LogSink {
  log: (message: string, ...data: unknown[]) => void
  error: (message: string, ...data: unknown[]) => void
}

/** 日志内容产生的阶段，供 `redact` 按阶段决定脱敏策略 */
export type LogPhase = 'args' | 'result' | 'error'

/**
 * 日志装饰器选项
 */
export interface LogDecoratorOptions {
  /**
   * 日志输出目标，缺省 `console`
   *
   * 生产构建里接入统一日志通道（或整体替换为 no-op）比在业务代码里到处删日志更可控，
   * 与 `PerformanceMonitor` 的 `logger` 选项同一思路。
   */
  sink?: LogSink
  /**
   * 输出前的脱敏钩子：决定参数 / 返回值 / 错误以什么形态进入日志
   *
   * 缺省实现见 {@link withLog} 的 remarks——生产环境下自动降级为不含内容的摘要，
   * 因为 action 的参数与返回值常带 token、密码、用户隐私数据。
   */
  redact?: (value: unknown, phase: LogPhase) => unknown
}

/** 生产环境缺省脱敏策略：只保留结构信息，不保留内容 */
function summarize(value: unknown): unknown {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `Array(${value.length})`
  if (value instanceof Error) return `${value.name}: ${value.message}`
  if (typeof value === 'object') return `${value.constructor?.name ?? 'Object'}{${Object.keys(value).length} keys}`

  return typeof value
}

/**
 * 创建日志装饰器
 *
 * 在Action执行前后记录日志，便于调试
 *
 * @param {string} [name] - Action名称（用于日志标识）
 * @param {LogDecoratorOptions} [options] - 输出目标与脱敏配置
 * @returns {MethodDecorator} 方法装饰器
 *
 * @remarks 默认把 `args`/`result` 原样写入日志，方便本地调试；生产构建（`isProduction()`）
 * 下改为摘要（类型 / 长度 / 键数），避免 token、密码、PII 随日志外泄。需要自定义脱敏
 * （例如只脱敏某个字段）时传 `redact`，它会覆盖该缺省策略。
 *
 * @example
 * ```typescript
 * class MyComponent {
 *   @withLog('fetchUserData')
 *   async fetchUser(id: string) {
 *     return await fetch(`/api/users/${id}`).then(r => r.json())
 *   }
 *
 *   // 接入项目 logger，并把参数整体替换为不含内容的占位
 *   @withLog('login', {
 *     sink: appLogger,
 *     redact: (value, phase) => (phase === 'args' ? '[credentials]' : value),
 *   })
 *   async login(credentials: { user: string; password: string }) {
 *     return await api.login(credentials)
 *   }
 * }
 *
 * // 控制台输出：
 * // [Action] fetchUserData started with args: ['user-123']
 * // [Action] fetchUserData completed with result: { id: 'user-123', name: 'John' }
 * ```
 */
export function withLog(name?: string, options: LogDecoratorOptions = {}): MethodDecorator {
  const sink = options.sink ?? console
  // 生产环境不输出内容：调用方显式给了 redact 时以其为准（视为已自行评估过脱敏策略）
  const redact: NonNullable<LogDecoratorOptions['redact']> = options.redact ?? (isProduction() ? summarize : (value) => value)
  const label = name || 'action'

  return createDecorator({
    before: (...args) => {
      sink.log(`[Action] ${label} started with args:`, redact(args, 'args'))
    },
    after: (result) => {
      sink.log(`[Action] ${label} completed with result:`, redact(result, 'result'))
    },
    onError: (error) => {
      sink.error(`[Action] ${label} failed:`, redact(error, 'error'))
    },
  })
}
