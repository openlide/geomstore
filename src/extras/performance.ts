/**
 * 性能监控与性能插件（可选能力，按需动态引入）
 *
 * - `PerformanceMonitor` / `MetricsCollector` / `PerformanceAnalyzer`：指标采集与分析，
 *   实现位于 `src/core/performance`——因 `core/store` 深导入其中的 `AsyncBatchNotifier`，
 *   该模块需保留在 core 内。它本身也是**已发布子路径** `@openlide/geomstore/performance`
 *   （`scripts/generate-subpath-stubs.mjs` 的 `performance` 项映射到 `dist/core/performance`），
 *   而 `extras/index.ts` 又原样再导出了同一组符号——即这三个类各有三处公开出口
 *   （core 出口 / 本入口 / extras 总入口），增删任一处都是破坏性变更，
 *   契约要在三处同步维护。本入口刻意只策展这三个监控器与类型，
 *   core 出口另有的 `LRUCache` / `AsyncBatchNotifier` 不经本入口
 * - `analyzerPlugin` / `createAnalyzerPlugin`：将性能分析接入插件系统的插件实现
 *
 * @remarks 核心主入口不导出性能监控，需按需从本入口引入。
 */
export { PerformanceMonitor, MetricsCollector, PerformanceAnalyzer } from '../core/performance/index.js'
export type { PerformanceMetrics, PerformanceOptions, PerformanceStats, MetricType } from '../types/performance.js'
export { analyzerPlugin, createAnalyzerPlugin } from '../plugins/performance/index.js'
