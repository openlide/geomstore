/**
 * GeomStore - 错误类型定义
 */

/**
 * 操作类型
 */
export type OperationType = 'setState' | 'patch' | 'replaceState' | 'dispatch' | 'getter' | 'init' | 'state-update' | 'action-execution' | 'getter-execution'

/**
 * 错误级别
 *
 * 规范集合为 `'error' | 'warning' | 'critical' | 'info'`：
 * - `'critical'` 不是 `'error'` 的同义词，它表示「需人工介入」的致命级别，
 *   默认处理器按 error 同级输出（含堆栈），级别标签保留 CRITICAL。
 * - `'warn'` 是 `'warning'` 的历史别名（同义拼写），并非独立级别：它已随
 *   `ErrorContext` 发布给外部调用方，且 `tests/unit/core/error/ErrorHandler.test.ts`
 *   的 #36 回归（「warn 别名走 warning 通道」）与 `error-boundaries.test.ts` 仍在断言它，
 *   删除即为破坏性变更。故保留兼容，但默认处理器与 `'warning'` 归入同一分支输出。
 *   新代码一律使用 `'warning'`。
 */
export type ErrorLevel = 'error' | 'warning' | 'critical' | 'info' | /** @deprecated 同义别名，请改用 `'warning'` */ 'warn'

/**
 * 错误上下文
 */
export interface ErrorContext {
  /** Store名称 */
  storeName: string
  /** 操作类型 */
  operation: OperationType
  /** 错误对象 */
  error: Error
  /** 错误级别 */
  level: ErrorLevel
  /** 操作参数 */
  payload?: unknown
  /** 时间戳（缺省时由采集器使用当前时间） */
  timestamp?: number
}

/**
 * 错误处理器
 */
export type ErrorHandler = (context: ErrorContext) => void

/**
 * 回退状态：支持固定值或根据错误/当前状态动态计算
 */
export type ErrorFallback<F = unknown, S = unknown> = F | ((error: Error, currentState: S | undefined) => F)

/**
 * 错误边界选项
 *
 * @template S - 状态类型（传入 fallback 计算函数的上下文）
 * @template F - 回退值类型（与状态类型解耦：回退值不必是状态对象）
 */
export interface ErrorBoundaryOptions<S = unknown, F = unknown> {
  /** 回退状态：固定值或计算函数 */
  fallback?: ErrorFallback<F, S>
  /** 错误回调 */
  onError?: (error: Error) => void
  /**
   * 是否恢复（吞错返回 fallback / undefined）而非重抛。
   * 默认由 fallback 推导：提供了 fallback 即声明"我要恢复"；
   * 未提供 fallback 时默认重抛（fail-loud——吞错返回 undefined 是
   * 最难排查的故障模式，错误会在远离根因处变成二次异常）
   */
  recoverable?: boolean
}

/**
 * 取可打印的错误消息文本
 *
 * `ErrorContext.error` 的契约类型是 `Error`，但 JS 允许 `throw null` / `throw 'boom'`，
 * 而库内外通行写法是 `handle(name, op, error as Error)`（见 `ErrorHandler.handle` 的 JSDoc）——
 * 断言不做运行时校验，这里就可能拿到非 Error 值。直接 `.message` 取值时
 * `null` / `undefined` 会在处理器内部抛 TypeError 顶掉原始失败，字符串抛值则打印 `undefined`。
 * 统一兜底为字符串化，保证处理器自身不再抛错。
 */
function describeErrorProperty(error: Error, property: 'message' | 'stack'): string | undefined {
  const value = (error as { message?: unknown; stack?: unknown } | undefined | null)?.[property]
  return typeof value === 'string' ? value : undefined
}

/**
 * 默认错误处理器
 */
export const defaultErrorHandler: ErrorHandler = (context: ErrorContext): void => {
  const { storeName, operation, error, level } = context
  const prefix = `[GeomStore][${level.toUpperCase()}][${storeName}]`
  // 非 Error 抛值（字符串 / null / undefined）兜底为字符串化，避免处理器自身抛错掩盖原始失败
  const message = describeErrorProperty(error, 'message') ?? String(error)

  // 'critical' 与 'warn' 别名此前落入 info 分支：致命错误只打 console.info、
  // 无堆栈，监控台几乎不可见——分别映射到 error / warning 同级处理
  if (level === 'error' || level === 'critical') {
    console.error(prefix, `Error in ${operation}:`, error)
    const stack = describeErrorProperty(error, 'stack')
    if (stack) {
      console.error(prefix, 'Stack:', stack)
    }
  } else if (level === 'warning' || level === 'warn') {
    console.warn(prefix, `Warning in ${operation}:`, message)
  } else {
    console.info(prefix, `Info in ${operation}:`, message)
  }
}

/**
 * 创建错误上下文
 */
export function createErrorContext(storeName: string, operation: OperationType, error: Error, level: ErrorLevel = 'error', payload?: unknown): ErrorContext {
  return {
    storeName,
    operation,
    error,
    level,
    payload,
    timestamp: Date.now(),
  }
}

// ==================== 错误监控类型（契约层定义，extras/error 实现依赖此处） ====================

/**
 * 错误报告器接口
 *
 * 定义错误报告器的行为，用于将错误发送到远程监控系统
 */
export interface ErrorReporter {
  /** 上报单个错误 */
  report(context: ErrorContext): Promise<void>

  /** 批量上报错误 */
  reportBatch(contexts: ErrorContext[]): Promise<void>

  /** 获取报告器名称 */
  getName(): string
}

/**
 * 错误组 - 表示一组相似的错误聚合
 */
export interface ErrorGroup {
  /** 组标识（基于错误消息和堆栈的哈希） */
  groupId: string

  /** 错误类型 */
  type: string

  /** 错误代码 */
  code: string

  /** 错误消息 */
  message: string

  /** 组内错误数量 */
  count: number

  /** 首次出现时间 */
  firstSeen: number

  /** 最后出现时间 */
  lastSeen: number

  /** 受影响的Store列表 */
  affectedStores: string[]

  /** 示例错误上下文 */
  sampleError: ErrorContext
}

/**
 * 错误监控配置
 */
export interface MonitoringConfig {
  /** 错误报告器列表 */
  reporters: ErrorReporter[]

  /** 批量上报间隔（毫秒） */
  batchInterval?: number

  /** 批量上报阈值 */
  batchThreshold?: number

  /** 是否启用错误聚合 */
  enableAggregation?: boolean

  /** 是否在控制台输出日志 */
  enableConsoleLog?: boolean

  /** 错误上报超时（毫秒） */
  reportTimeout?: number

  /**
   * 队列容量上限（默认 1000）
   *
   * 超容量后按「最旧优先」淘汰：入队路径 shift 丢弃最旧错误，重入队路径裁剪队列头部。
   * 调大可容纳突发流量，调小可约束内存占用。
   */
  maxQueueSize?: number

  /**
   * 「全部报告器连续失败」的重入队上限（默认 3）
   *
   * 超过后丢弃该批并告警，避免永久失败的批次随 batchInterval 无限空转
   */
  maxFlushRetries?: number
}

/**
 * 错误报告 - 错误监控系统的报告格式
 */
export interface ErrorReport {
  /** 生成时间戳 */
  generatedAt: number

  /** 摘要信息 */
  summary: {
    totalGroups: number
    totalErrors: number
    queuedErrors: number
  }

  /** 按错误代码统计 */
  byCode: Record<string, number>

  /** 按Store统计 */
  byStore: Record<string, number>

  /** Top 10 错误 */
  topErrors: ErrorGroup[]

  /** 最近10个错误 */
  recentErrors: ErrorGroup[]
}

// 注：RecoveryConfig / RecoveryContext / RecoveryStrategyMap 依赖 RecoveryStrategy 枚举与
// GeomStoreError 类（均为运行时值），现由 extras/error/ErrorRecovery.ts 定义并经
// extras/error/index.ts 导出，避免 types 层反向依赖实现。
