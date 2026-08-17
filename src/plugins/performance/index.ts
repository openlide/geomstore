/**
 * GeomStore v1.0 - 性能插件导出
 *
 * 提供性能监控和分析相关的插件
 *
 * @module @geomstore/plugins/performance
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { analyzerPlugin } from '@geomstore/plugins/performance'
 *
 * // 安装性能分析插件（默认配置）
 * store.use(analyzerPlugin)
 *
 * // 或使用自定义配置
 * store.use(createAnalyzerPlugin({
 *   sampleRate: 1.0,
 *   threshold: 16,
 *   trackMemory: true
 * }))
 *
 * // 访问性能分析API
 * const api = globalThis.__GEOMSTORE_ANALYZER__['store-name']
 * const stats = api.getStats()
 * const bottlenecks = api.analyzeBottlenecks()
 * ```
 */

export { analyzerPlugin, createAnalyzerPlugin } from './analyzerPlugin'
