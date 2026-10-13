/**
 * GeomStore - 错误类型定义
 *
 * 0.9.0 起只保留错误边界的契约类型。此前的错误处理/监控/恢复契约
 * （ErrorContext / ErrorHandler / ErrorReporter / MonitoringConfig 等）已随
 * `extras/error` 精简一并移除。
 */

/**
 * 回退状态：支持固定值或根据错误/当前状态动态计算
 *
 * **`F` 本身可调用时这个联合是二义的**：消费侧一律以 `typeof fallback === 'function'` 判别形态
 * （见 `ErrorBoundary.resolveFallback` 与 `getFallbackState`），因此「恰好是函数的**静态**回退值」
 * 会被当成计算函数、以 `(error, currentState)` 调用，而不是原样返回。需要把函数本身当回退值时
 * 请包一层对象（如 `{ fn }`），别直接传裸函数。
 *
 * 另：`withErrorBoundary()` 不传泛型时 `F` 落回 `unknown`，而 `unknown | X` 仍是 `unknown`，
 * 类型层连「两种形态」都表达不出来，此时判别只剩运行时 `typeof`。
 */
export type ErrorFallback<F = unknown, S = unknown> = F | ((error: Error, currentState: S | undefined) => F)

/**
 * 错误边界选项
 *
 * @template S - 状态类型（传入 fallback 计算函数的上下文）
 * @template F - 回退值类型（与状态类型解耦：回退值不必是状态对象）
 */
export interface ErrorBoundaryOptions<S = unknown, F = unknown> {
  /** 回退状态：固定值或计算函数（`F` 可为函数类型时的二义见 {@link ErrorFallback}） */
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
