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
 * 从本入口（`@openlide/geomstore/extras`）引入会一并拉入本文件聚合的可选能力
 * （插件 / 性能监控 / 快照 / Action 增强 / 企业微信集成）；选择器与错误处理**不在**本入口
 * 聚合，请走各自的子入口 `@openlide/geomstore/extras/selector`、`/extras/error`。
 *
 * @remarks v0.4.0 起快照 / 选择器 / Action 增强的实现已由 `src/core` 物理下沉至
 * `src/extras`，与各自子入口同层；核心主入口（`@openlide/geomstore` 与
 * `@openlide/geomstore/core`）始终不导出这些能力。
 */

// ==================== 插件系统实现 ====================
export { loggerPlugin, persistencePlugin, devtoolsPlugin, builtinPlugins } from '../plugins/builtin.js'
// 类型契约在 `types/persistence.ts`；带 `wx.*` I/O 的内置后端与插件实现同层
// （`src/plugins/WxStorageBackend.ts`），本入口只策展再导出，不再从 types/* 拉运行时依赖
export type { PersistenceOptions, StorageBackend } from '../types/persistence.js'
export { WxStorageBackend } from '../plugins/WxStorageBackend.js'

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
export type { ActionUtilsOptions, ActionStats } from './action/index.js'
export { withLog, withDebounce, withThrottle, withCache, withRetry, withTimeout, createDecorator } from './action/index.js'
// 防抖/节流挂起调用的宿主级收尾入口（cancel 丢弃 / flush 立即执行 / dispose 释放状态）
export { cancelDebouncedCalls, flushDebouncedCalls, disposeDebouncedState, cancelThrottledCalls, flushThrottledCalls, disposeThrottledState } from './action/index.js'
export type { DecoratorOptions, CacheDecoratorOptions, RetryDecoratorOptions, ThrottleDecoratorOptions, LogDecoratorOptions } from './action/index.js'
export type { AsyncActions, ActionResult, ActionLoaderOptions, ActionDecorator, ActionExecutionContext } from '../types/action.js'

// ==================== 企业微信集成 ====================
// 显式清单而非 `export *`：本入口其余段落都是策展式再导出，wildcard 会把上游
// 新增符号未经评审地并入公开 API，且同名冲突在编译期不报错（静默丢失）
export {
  createUserStore,
  StoreManager,
  storeManager,
  initHotUpdate,
  restoreFromHotUpdate,
  OfflineManager,
  initBackgroundSync,
  unregisterBackgroundSync,
  createEnterpriseApp,
} from '../integrations/enterprise/index.js'
export type {
  UserInfo,
  UserPreferences,
  UserState,
  UserStoreConfig,
  BackupData,
  HotUpdateConfig,
  OfflineAction,
  BackgroundSyncConfig,
  EnterpriseAppConfig,
} from '../integrations/enterprise/index.js'
