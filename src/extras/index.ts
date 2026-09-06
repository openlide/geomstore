/**
 * GeomStore - 可选 / 高级功能（extras，按需引入）
 *
 * 这些模块不属于运行必需的核心 API，默认不进入主包。需要时在业务侧用动态导入
 * 按需加载，例如：
 *   const { SnapshotManager } = await import('../../libs/geomstore/src/extras/snapshot')
 * 也可从当前入口一次性引入全部可选能力。
 */

// ==================== 插件系统实现 ====================
export { loggerPlugin, persistencePlugin, devtoolsPlugin, builtinPlugins } from '../plugins/builtin'
export type { PersistenceOptions, StorageBackend } from '../types/persistence'
export { WxStorageBackend } from '../types/persistence'

// ==================== 性能插件 ====================
export { analyzerPlugin, createAnalyzerPlugin } from '../plugins/performance/index'
export { timeTravelPlugin } from '../plugins/devtools/index'
export type { TimeTravelOptions } from '../plugins/devtools/index'

// ==================== 性能监控 ====================
export { PerformanceMonitor, MetricsCollector, PerformanceAnalyzer } from '../core/performance/index'
export type { PerformanceMetrics, PerformanceOptions, PerformanceStats, MetricType } from '../types/performance'

// ==================== 快照系统 ====================
export { SnapshotManager, createSnapshot, createSnapshotAsync } from '../core/snapshot/index'
export type {
  SnapshotOptions,
  SnapshotProgress,
  SnapshotError,
  SnapshotResult,
  SnapshotMetadata,
  SnapshotStats,
  AsyncSnapshotOptions,
  SnapshotDiff,
} from '../core/snapshot/index'

// ==================== Action 增强 ====================
export { ActionExecutor, ActionLoader, withLoading, ActionUtils } from '../core/action/index'
export type { ActionUtilsOptions } from '../core/action/index'
export { withLog, withDebounce, withThrottle, withCache, withRetry, withTimeout, createDecorator } from '../core/action/index'
export type { DecoratorOptions, CacheDecoratorOptions, RetryDecoratorOptions, ThrottleDecoratorOptions } from '../core/action/index'
export type { AsyncActions, ActionResult, ActionLoaderOptions, ActionDecorator, ActionExecutionContext } from '../types/action'

// ==================== 企业微信集成 ====================
export * from '../integrations/enterprise/index'
