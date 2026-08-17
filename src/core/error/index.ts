/**
 * GeomStore v1.0 - 错误处理模块导出
 */

export { ErrorHandlerImpl } from './ErrorHandler'
export { ErrorBoundary, withErrorBoundary } from './ErrorBoundary'
export { defaultErrorHandler, createErrorContext } from './ErrorHandler'
export type { ErrorContext, ErrorHandler, ErrorLevel, OperationType, ErrorBoundaryOptions } from '../../types/error'

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
  isValidationError,
  createError,
} from './GeomStoreError'

// 错误恢复策略
export { ErrorRecovery, RecoveryStrategy, createDefaultErrorRecovery, defaultErrorRecovery } from './ErrorRecovery'
export type { RecoveryConfig, RecoveryContext, RecoveryStrategyMap } from './ErrorRecovery'

// 错误监控和报警系统
export {
  ErrorMonitoring,
  ErrorAggregator,
  ConsoleReporter,
  HttpReporter,
  createDefaultMonitoring,
  getDefaultMonitoring,
  defaultMonitoring,
} from './ErrorMonitoring'
export type { ErrorReporter, ErrorGroup, ErrorReport, MonitoringConfig } from '../../types/error'
