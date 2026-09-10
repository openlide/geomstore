/**
 * GeomStore - 可选 / 高级功能总入口（extras，按需引入）
 *
 * 这些模块不属于运行必需的核心 API，默认不进入主包。推荐两种引入方式：
 *
 * 1. 按子入口精确引入（推荐，体积最优）：
 *    `@openlide/geomstore/extras/snapshot`、`/selector`、`/action`、
 *    `/performance`、`/plugins`、`/enterprise`、`/error`
 * 2. 动态导入按需加载：
 *    `const { SnapshotManager } = await import('@openlide/geomstore/extras/snapshot')`
 *
 * 从本入口（`@openlide/geomstore/extras`）引入会一并拉入全部可选能力，
 * 仅在「确实都要用」或开发调试时使用。
 *
 * @remarks v0.5.0 起快照 / 选择器 / Action 增强的实现已由 `src/core` 物理下沉至
 * `src/extras`，与各自子入口同层；核心主入口（`@openlide/geomstore` 与
 * `@openlide/geomstore/core`）始终不导出这些能力。
 */

// ==================== 插件系统实现 ====================
export { loggerPlugin, persistencePlugin, devtoolsPlugin, builtinPlugins } from '../plugins/builtin.js'
export type { PersistenceOptions, StorageBackend } from '../types/persistence.js'
export { WxStorageBackend } from '../types/persistence.js'

// ==================== 性能插件 ====================
export { analyzerPlugin, createAnalyzerPlugin } from '../plugins/performance/index.js'
export { timeTravelPlugin } from '../plugins/devtools/index.js'
export type { TimeTravelOptions } from '../plugins/devtools/index.js'

// ==================== 性能监控 ====================
export { PerformanceMonitor, MetricsCollector, PerformanceAnalyzer } from '../core/performance/index.js'
export type { PerformanceMetrics, PerformanceOptions, PerformanceStats, MetricType } from '../types/performance.js'

// ==================== 快照系统 ====================
export { SnapshotManager, createSnapshot, createSnapshotAsync } from './snapshot/index.js'
export type {
  SnapshotOptions,
  SnapshotProgress,
  SnapshotError,
  SnapshotResult,
  SnapshotMetadata,
  SnapshotStats,
  AsyncSnapshotOptions,
  SnapshotDiff,
} from './snapshot/index.js'

// ==================== Action 增强 ====================
export { ActionExecutor, ActionLoader, withLoading, ActionUtils } from './action/index.js'
export type { ActionUtilsOptions } from './action/index.js'
export { withLog, withDebounce, withThrottle, withCache, withRetry, withTimeout, createDecorator } from './action/index.js'
export type { DecoratorOptions, CacheDecoratorOptions, RetryDecoratorOptions, ThrottleDecoratorOptions } from './action/index.js'
export type { AsyncActions, ActionResult, ActionLoaderOptions, ActionDecorator, ActionExecutionContext } from '../types/action.js'

// ==================== 企业微信集成 ====================
export * from '../integrations/enterprise/index.js'
