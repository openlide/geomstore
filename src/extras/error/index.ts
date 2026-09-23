/**
 * GeomStore - 错误处理模块（可选能力，按需动态引入）
 *
 * - 错误捕获与降级：`ErrorHandlerImpl` / `defaultErrorHandler` / `createErrorContext` /
 *   `ErrorBoundary` / `withErrorBoundary`
 * - 错误类型与守卫：`GeomStoreError` / `ErrorCode` / `createError`
 *   及 `ActionError` / `StateError` / `SelectorError` /
 *   `PluginError` / `ComposeError` / `ValidationError` 与对应 `is*Error` 守卫
 *   （定义位于 `src/core/errors`，此处统一再导出）
 * - 恢复策略：`ErrorRecovery` / `RecoveryStrategy` / `createDefaultErrorRecovery` /
 *   `defaultErrorRecovery`（后者是已配好默认策略的全局单例）
 * - 监控上报：`ErrorMonitoring` / `ErrorAggregator` / `ConsoleReporter` / `HttpReporter` /
 *   `createDefaultMonitoring` / `getDefaultMonitoring`（后者是惰性创建的默认单例）
 * - 类型：`ErrorContext` / `ErrorHandler` / `ErrorLevel` / `OperationType` /
 *   `ErrorBoundaryOptions` / `ErrorFallback` / `ErrorReporter` / `ErrorGroup` /
 *   `ErrorReport` / `MonitoringConfig` / `RecoveryConfig` / `RecoveryContext` /
 *   `RecoveryStrategyMap`
 *
 * @remarks v0.4.0 起本模块由核心下沉，请通过 `@openlide/geomstore/extras/error` 引入。
 */

// 同一模块的再导出集中在一条语句里：拆成两条会让改动 ErrorHandler 导出时漏改其中一条。
// 注意 `defaultErrorHandler` / `createErrorContext` 的**定义在 `../../types/error.js`**
// （那里同时承载 ErrorContext 等契约类型与这两个运行时值），ErrorHandler.ts 只是转发
// 以保持深导入路径 `extras/error/ErrorHandler.js` 可用——把本行的来源改成
// './ErrorHandler.js' 会让人以为它们住在那里
export { ErrorHandlerImpl, defaultErrorHandler, createErrorContext } from './ErrorHandler.js'
export { ErrorBoundary, withErrorBoundary } from './ErrorBoundary.js'
export type { ErrorContext, ErrorHandler, ErrorLevel, OperationType, ErrorBoundaryOptions, ErrorFallback } from '../../types/error.js'

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

// 错误恢复策略
export { ErrorRecovery, RecoveryStrategy, createDefaultErrorRecovery, defaultErrorRecovery } from './ErrorRecovery.js'
export type { RecoveryConfig, RecoveryContext, RecoveryStrategyMap } from './ErrorRecovery.js'

// 错误监控和报警系统
export { ErrorMonitoring, ErrorAggregator, ConsoleReporter, HttpReporter, createDefaultMonitoring, getDefaultMonitoring } from './ErrorMonitoring.js'
export type { ErrorReporter, ErrorGroup, ErrorReport, MonitoringConfig } from '../../types/error.js'
