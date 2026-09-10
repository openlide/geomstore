/**
 * 性能监控与性能插件（可选能力，按需动态引入）
 *
 * - `PerformanceMonitor` / `MetricsCollector` / `PerformanceAnalyzer`：指标采集与分析，
 *   实现位于 `src/core/performance`——因 `core/store` 依赖其中的 `AsyncBatchNotifier`，
 *   该模块需保留在 core 内，仅通过本入口对外暴露
 * - `analyzerPlugin` / `createAnalyzerPlugin`：将性能分析接入插件系统的插件实现
 *
 * @remarks 核心主入口不导出性能监控，需按需从本入口引入。
 */
export { PerformanceMonitor, MetricsCollector, PerformanceAnalyzer } from '../core/performance/index.js'
export type { PerformanceMetrics, PerformanceOptions, PerformanceStats, MetricType } from '../types/performance.js'
export { analyzerPlugin, createAnalyzerPlugin } from '../plugins/performance/index.js'
