/**
 * GeomStore v1.0 - 轻量级微信小程序状态管理库
 *
 * 特性：
 * - 简洁易用的API
 * - 高性能的状态管理
 * - 完整的插件系统
 * - 原生支持微信小程序
 * - 支持Skyline和Webview渲染引擎
 * - 企业级功能：错误处理、Store组合、性能监控、异步Action
 */

// ==================== 核心Store ====================
export { Store, isGeomStore } from './core/store/index'
export type {
  StoreOptions,
  State,
  Actions,
  Getters,
  StateListener,
  InferActionArgs,
  InferActionReturn,
  InferGetterReturn,
  ActionNames,
  GetterNames,
  MappedActions,
  MappedGetters,
  CacheStats,
} from './types/store'

// ==================== 错误处理 ====================
export { ErrorHandlerImpl, defaultErrorHandler, createErrorContext } from './core/error/ErrorHandler'
export { ErrorBoundary, withErrorBoundary } from './core/error/ErrorBoundary'
export {
  ErrorRecovery,
  RecoveryStrategy,
  createDefaultErrorRecovery,
  defaultErrorRecovery,
  GeomStoreError,
  createError,
  ErrorMonitoring,
  ErrorAggregator,
  ConsoleReporter,
  HttpReporter,
  createDefaultMonitoring,
  getDefaultMonitoring,
  defaultMonitoring,
  ErrorCode,
  isGeomStoreError,
  isActionError,
  isStateError,
  isSelectorError,
  isPluginError,
  isValidationError,
  ActionError,
  StateError,
  SelectorError,
  PluginError,
  ComposeError,
  ValidationError,
} from './core/error/index'
export type {
  ErrorContext,
  ErrorHandler,
  ErrorLevel,
  OperationType,
  ErrorBoundaryOptions,
  ErrorFallback,
  ErrorReporter,
  ErrorGroup,
  ErrorReport,
  MonitoringConfig,
} from './types/error'
// 恢复策略类型依赖运行时枚举/类，由 core/error 定义并导出
export type { RecoveryConfig, RecoveryContext, RecoveryStrategyMap } from './core/error/index'

// ==================== 工厂函数 ====================
// createStore 实现位于 core/store/factory，避免集成层反向依赖根入口
export { createStore } from './core/store/factory'

// ==================== 工具函数 ====================
export {
  isObject,
  isPlainObject,
  isFunction,
  isArray,
  isPromise,
  shallowEqual,
  deepEqual,
  deepMerge,
  get,
  set,
  noop,
  identity,
  uniqueId,
  clone,
} from './core/utils/helpers'
export type { CloneMode } from './core/utils/helpers'

// ==================== 插件系统 ====================
export { HookSystem, usePlugin } from './core/hooks/index'
export type { Plugin, HookName, HookHandler, IHookSystem, PluginHook } from './core/hooks/index'
export { loggerPlugin, persistencePlugin, devtoolsPlugin, builtinPlugins } from './plugins/builtin'
export type { PersistenceOptions, StorageBackend } from './types/persistence'
export { WxStorageBackend } from './types/persistence'

// ==================== 性能插件 ====================
export { analyzerPlugin, createAnalyzerPlugin } from './plugins/performance/index'
export { timeTravelPlugin } from './plugins/devtools/index'
export type { TimeTravelOptions } from './plugins/devtools/index'

// ==================== 微信小程序集成 ====================
export { withPageStore, withComponentStore } from './integrations/with-store'
export { withAppStore, createApp } from './integrations/with-app-store'
export type {
  ConnectOptions,
  PageThis,
  ComponentThis,
  ExtractPageData,
  WithPageThis,
  PageOwnMethods,
  ComponentOwnMethods,
  PageReservedKeys,
  ComponentReservedKeys,
} from './types/integration'

// ==================== Store组合 ====================
export { composeStore, createStoreTree, StoreRegistry, globalRegistry, ComposedStore } from './core/compose/index'
export type { ComposeOptions, StoreTreeNode, NamespaceConfig } from './types/compose'

// ==================== 性能监控 ====================
export { PerformanceMonitor, MetricsCollector, PerformanceAnalyzer } from './core/performance/index'
export type { PerformanceMetrics, PerformanceOptions, PerformanceStats, MetricType } from './types/performance'

// ==================== LRU缓存 ====================
export { LRUCache } from './core/cache/index'
export type { LRUCacheStats, CacheOptions } from './core/cache/index'

// ==================== 快照系统 ====================
export { SnapshotManager, createSnapshot, createSnapshotAsync } from './core/snapshot/index'
export type {
  SnapshotOptions,
  SnapshotProgress,
  SnapshotError,
  SnapshotResult,
  SnapshotMetadata,
  SnapshotStats,
  AsyncSnapshotOptions,
  SnapshotDiff,
} from './core/snapshot/index'

// ==================== Action增强 ====================
export { ActionExecutor, ActionLoader, withLoading, ActionUtils } from './core/action/index'
export type { ActionUtilsOptions } from './core/action/index'
// 装饰器导出
export { withLog, withDebounce, withThrottle, withCache, withRetry, withTimeout, createDecorator } from './core/action/index'
export type { DecoratorOptions, CacheDecoratorOptions, RetryDecoratorOptions, ThrottleDecoratorOptions } from './core/action/index'
// 类型导出
export type { AsyncActions, ActionResult, ActionLoaderOptions, ActionDecorator, ActionExecutionContext } from './types/action'

// ==================== 状态选择器 ====================
export {
  createSelector,
  createMemoizedSelector,
  createParametricSelector,
  createStructuredSelector,
  SelectorComposer,
  SelectorFactory,
} from './core/selector/index'
export type { Selector, SelectorOptions, SelectorCacheItem, SelectorResult, SelectorComposerInput, ParametricSelector } from './types/selector'
