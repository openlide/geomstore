/**
 * GeomStore - 性能监控模块导出
 *
 * 本文件是**已发布的子路径出口**：package.json 的 `files` 收录 `performance` 兼容 stub，
 * `scripts/generate-subpath-stubs.mjs` 把它映射到 `dist/core/performance`，
 * 因此这里列出的每个符号都在公开 API 面上，增删等同于改动发布契约。
 */

export { PerformanceMonitor } from './PerformanceMonitor.js'
export { MetricsCollector, PerformanceAnalyzer } from './metrics.js'
export type { PerformanceMetrics, PerformanceOptions, PerformanceStats, MetricType } from '../../types/performance.js'

// 缓存类的子路径聚合出口。v0.4.0 起明确记载 LRUCache 的出口为
// `cache/index`（定义）→ `core/index`（主入口）+ `core/performance/index`（子路径聚合）；
// v0.5.x 随 Optimizations 一并清理掉这条重导出后，从 `@openlide/geomstore/performance`
// 取 LRUCache 的存量调用方会在运行时拿到 undefined（子路径 stub 仍在发布，无法感知缺失）。
// 恢复重导出使代码与该子路径的既有文档一致；定义与主出口仍只有 cache/index 一处
export { LRUCache } from '../cache/index.js'
export type { LRUCacheStats, CacheOptions } from '../cache/index.js'

// 异步批量通知（Store 通知合并使用）。`Store.ts` 走
// `../performance/AsyncBatchNotifier.js` 深导入而非本 barrel：barrel 会连带把
// PerformanceMonitor/metrics 钉进核心链路，而 Store 只需其中一类，
// 深导入是为可选能力不进主包服务的，不是遗漏。本符号经该 barrel 属公开面，保留导出
export { AsyncBatchNotifier } from './AsyncBatchNotifier.js'
