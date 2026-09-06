/**
 * 性能监控 / 性能插件（可选功能，按需动态引入）
 */
export { PerformanceMonitor, MetricsCollector, PerformanceAnalyzer } from '../core/performance/index'
export type { PerformanceMetrics, PerformanceOptions, PerformanceStats, MetricType } from '../types/performance'
export { analyzerPlugin, createAnalyzerPlugin } from '../plugins/performance/index'
