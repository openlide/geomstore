/**
 * GeomStore - 错误处理模块（可选能力，按需动态引入）
 *
 * 0.9.0 起精简为最小错误面：
 * - 错误类型与守卫：`GeomStoreError` / `ErrorCode` / `createError` 及 `ActionError` /
 *   `StateError` / `SelectorError` / `PluginError` / `ComposeError` / `ValidationError`
 *   与对应 `is*Error` 守卫（定义位于 `src/core/errors`，此处统一再导出）
 * - 错误边界：`ErrorBoundary` / `withErrorBoundary`
 *
 * 已移除：`ErrorHandler` / `ErrorRecovery` / `ErrorMonitoring` / `ErrorAggregator` 与
 * `ConsoleReporter` / `HttpReporter`——越界的应用级 APM/恢复能力。需要监控请接入
 * `Store` 的 `onError` 钩子 + 第三方监控（`wx.reportError` / Sentry 等）。
 *
 * @remarks 请通过 `@openlide/geomstore/extras/error` 引入。
 */

// 自定义错误类
export {
  GeomStoreError,
  ActionError,
  StateError,
  SelectorError,
  PluginError,
  ComposeError,
  ValidationError,
  ErrorCode,
  isGeomStoreError,
  isActionError,
  isStateError,
  isSelectorError,
  isPluginError,
  isComposeError,
  isValidationError,
  createError,
} from '../../core/errors/GeomStoreError.js'

// 错误边界
export { ErrorBoundary, withErrorBoundary } from './ErrorBoundary.js'
export type { ErrorFallback, ErrorBoundaryOptions } from '../../types/error.js'
