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
 *
 * @remarks 下方每一段都从**同一能力的已发布子入口**（`./plugins.js` / `./performance.js` /
 * `./snapshot.js` / `./action.js` / `./enterprise.js`）按名再导出，而不是各自指向叶子模块：
 * 同一公开面若被两处独立指向叶子，两处清单会静默漂移（此前即已出现
 * `ActionStats`/`LogDecoratorOptions` 只在本入口可取的情况），名字写错则由编译期
 * 「导出项不存在」直接报错。**值导出**的一致性由
 * `tests/unit/r5-extras-action-p2-entry-parity.test.ts` 逐项比对兜底；该测试用
 * `Object.keys()` 枚举，拿不到 `export type`，所以**类型清单仍需人工与子入口对齐**
 * （R6-096 就是这类漂移：子入口已导出 `LogSink`/`LogPhase`，本入口漏写）。
 * 仍写显式清单而不用 `export *`：wildcard 会把上游新增符号未经评审地并入本入口，
 * 且同名冲突在编译期不报错（静默丢失）。
 */

// ==================== 内置插件与插件工具（同 `./plugins.js` 子入口） ====================
export { loggerPlugin, persistencePlugin, devtoolsPlugin, builtinPlugins, WxStorageBackend, timeTravelPlugin } from './plugins.js'
// 类型契约在 `types/persistence.ts`；带 `wx.*` I/O 的内置后端与插件实现同层，本入口只策展再导出
export type { PersistenceOptions, StorageBackend, TimeTravelOptions } from './plugins.js'

// ==================== 性能监控与性能插件（同 `./performance.js` 子入口） ====================
export { PerformanceMonitor, MetricsCollector, PerformanceAnalyzer, analyzerPlugin, createAnalyzerPlugin } from './performance.js'
export type { PerformanceMetrics, PerformanceOptions, PerformanceStats, MetricType } from './performance.js'

// ==================== 快照系统（同 `./snapshot.js` 子入口） ====================
export { SnapshotManager, createSnapshot, createSnapshotAsync } from './snapshot.js'
export type {
  SnapshotOptions,
  SnapshotProgress,
  SnapshotError,
  SnapshotResult,
  SnapshotMetadata,
  SnapshotStats,
  AsyncSnapshotOptions,
  SnapshotDiff,
} from './snapshot.js'

// ==================== Action 增强（同 `./action.js` 子入口） ====================
export {
  ActionExecutor,
  ActionLoader,
  withLoading,
  ActionUtils,
  withLog,
  withDebounce,
  withThrottle,
  withCache,
  withRetry,
  withTimeout,
  createDecorator,
  // 防抖/节流挂起调用的宿主级收尾入口（cancel 丢弃 / flush 立即执行 / dispose 释放状态）
  cancelDebouncedCalls,
  flushDebouncedCalls,
  disposeDebouncedState,
  cancelThrottledCalls,
  flushThrottledCalls,
  disposeThrottledState,
  TIMEOUT_ERROR_CODE,
} from './action.js'
export type {
  ActionUtilsOptions,
  ActionStats,
  DecoratorOptions,
  CacheDecoratorOptions,
  RetryDecoratorOptions,
  ThrottleDecoratorOptions,
  LogDecoratorOptions,
} from './action.js'
// LogDecoratorOptions 的 `sink?: LogSink` 与 `redact?: (value, phase: LogPhase) => unknown`
// 引用了这两个类型：本入口若只转发 LogDecoratorOptions，调用方仍要深链才能写出带类型的 sink
// （子入口 ./action.js 早已导出它们，此前是这一段的名字漏项——见 R6-096）
export type { LogSink, LogPhase } from './action.js'
export type { AsyncActions, ActionResult, ActionLoaderOptions, ActionDecorator, ActionExecutionContext } from './action.js'
export type { ActionErrorData, RetryOptions, TimeoutError } from './action.js'

// ==================== 企业微信集成（同 `./enterprise.js` 子入口） ====================
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
} from './enterprise.js'
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
} from './enterprise.js'
