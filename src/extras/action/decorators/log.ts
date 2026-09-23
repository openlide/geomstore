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
   * 与 `PerformanceMonitor` 的 `logger` 选项同一思路。sink 自身抛错只告警，
   * 不会中断被装饰的 action，也不会把成功的调用改判成失败。
   */
  sink?: LogSink
  /**
   * 输出前的脱敏钩子：决定参数 / 返回值 / 错误以什么形态进入日志
   *
   * 非生产构建下它的返回值就是最终输出。生产构建下**不**再接管输出：返回值仍要过一道
   * {@link summarize} 摘要，除非同时显式传 `summarizeInProduction: false`（见该选项）。
   */
  redact?: (value: unknown, phase: LogPhase) => unknown
  /**
   * 生产构建下是否强制摘要输出，缺省 `true`
   *
   * `true`：进 sink 的一律是不含内容的摘要（{@link summarize}），自带 `redact` 也绕不过去
   * ——一个过于宽松或有 bug 的脱敏器不该能静默关掉这道防线。
   * 只有显式传 `false` 才表示「我确认过，sink 侧自行脱敏」，此时 `redact` 单独决定形态。
   *
   * 非生产构建默认原样输出（本地调试用）：staging 之类与生产同构的运行期由
   * `isProduction()` 的判定覆盖，需要收敛内容时同样传 `redact`。
   */
  summarizeInProduction?: boolean
}

/**
 * 生产环境缺省脱敏策略：只保留结构信息，不保留内容
 *
 * `Error` 只取 `name`：`message` 属于内容而非结构，且最常夹带上下文
 * （`Failed to login with password=...`、URL 里的 token），把它拼进摘要等于在生产
 * 里留一条内容外泄路径。需要消息就在非生产构建看日志，或显式
 * `summarizeInProduction: false` 并自带 `redact`。
 */
function summarize(value: unknown): unknown {
  if (value === null) return 'null'
  if (Array.isArray(value)) return `Array(${value.length})`
  if (value instanceof Error) return value.name
  if (typeof value === 'object') return `${value.constructor?.name ?? 'Object'}{${Object.keys(value).length} keys}`

  return typeof value
}

/**
 * 把日志输出与业务调用隔离：`sink`/`redact` 都是调用方注入的代码（`LogSink` 明确
 * 面向自定义/远程 logger），它们抛错时既不能让 action 本体不执行，也不能把一次
 * 成功的调用改判成失败。告警走 console 而非 sink，避免 sink 自身故障时递归。
 */
function safeLog(emit: () => void): void {
  try {
    emit()
  } catch (error) {
    console.warn('[withLog] 日志输出失败，已忽略（不影响业务调用）：', error instanceof Error ? error.message : String(error))
  }
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
 * 下改为摘要（类型 / 长度 / 键数，`Error` 只留 `name`），避免 token、密码、PII 随日志外泄。
 * 该摘要在生产构建下是**强制**的：自带 `redact` 只会先于摘要生效，不会取代它，
 * 除非显式传 `summarizeInProduction: false`（表示 sink 侧自行脱敏）。
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
 *   // （非生产构建下日志里就是 '[credentials]'；生产构建下还要再过一道摘要，
 *   //   要让 redact 单独决定内容形态得同时传 summarizeInProduction: false）
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
  const production = isProduction()
  const summarizeOutput = production && (options.summarizeInProduction ?? true)
  const label = name || 'action'

  // redact 只负责「按字段决定形态」，它不是生产防线的开关：生产构建下它的返回值
  // 仍要过一次 summarize（显式 summarizeInProduction: false 时才由调用方全权决定）
  const project = (value: unknown, phase: LogPhase): unknown => {
    const redacted = options.redact ? options.redact(value, phase) : value

    return summarizeOutput ? summarize(redacted) : redacted
  }

  return createDecorator({
    before: (...args) => {
      safeLog(() => sink.log(`[Action] ${label} started with args:`, project(args, 'args')))
    },
    after: (result) => {
      safeLog(() => sink.log(`[Action] ${label} completed with result:`, project(result, 'result')))
    },
    onError: (error) => {
      safeLog(() => sink.error(`[Action] ${label} failed:`, project(error, 'error')))
    },
  })
}
