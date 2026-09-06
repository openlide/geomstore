/**
 * GeomStore - 核心 API（瘦核心，始终打包）
 *
 * 仅导出应用运行所必需的最小接口集合。快照、选择器、性能监控、Action 增强、
 * 企业微信集成与插件实现等可选能力统一收敛至 `../extras`，按需动态引入。
 */

// ==================== 核心Store ====================
export { Store, isGeomStore } from './store/index'
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
} from '../types/store'

// ==================== 错误处理 ====================
export { ErrorHandlerImpl, defaultErrorHandler, createErrorContext } from './error/ErrorHandler'
export { ErrorBoundary, withErrorBoundary } from './error/ErrorBoundary'
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
} from './error/index'
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
} from '../types/error'
export type { RecoveryConfig, RecoveryContext, RecoveryStrategyMap } from './error/index'

// ==================== 工厂函数 ====================
export { createStore } from './store/factory'

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
} from './utils/helpers'
export type { CloneMode } from './utils/helpers'

// ==================== 插件系统（核心） ====================
export { HookSystem, usePlugin } from './hooks/index'
export type { Plugin, HookName, HookHandler, IHookSystem, PluginHook } from './hooks/index'

// ==================== 微信小程序集成 ====================
export { withPageStore, withComponentStore } from '../integrations/with-store'
export { withAppStore } from '../integrations/with-app-store'
export type { AppOptions } from '../integrations/with-app-store'
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
} from '../types/integration'

// ==================== Store组合 ====================
export { composeStore, createStoreTree, StoreRegistry, globalRegistry, ComposedStore } from './compose/index'
export type { ComposeOptions, StoreTreeNode, NamespaceConfig } from '../types/compose'

// ==================== LRU缓存 ====================
export { LRUCache } from './cache/index'
export type { LRUCacheStats, CacheOptions } from './cache/index'
