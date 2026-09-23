/**
 * GeomStore - 性能插件导出
 *
 * 提供性能监控和分析相关的插件
 *
 * @module @geomstore/plugins/performance
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
 * // 访问性能分析API：全局表只在非生产环境挂载（且要插件已安装、store 名对得上），
 * // 其余情况读到 undefined，直接调用会抛 TypeError
 * const api = globalThis.__GEOMSTORE_ANALYZER__?.['store-name']
 * const stats = api?.getStats()
 * const bottlenecks = api?.analyzeBottlenecks() ?? []
 * ```
 */

export { analyzerPlugin, createAnalyzerPlugin } from './analyzerPlugin.js'
// createAnalyzerPlugin / setOptions 的入参类型：核心与 extras 入口早已导出，
// 本插件入口此前只给运行时 API 不给类型，按同一入口配置分析器时还得另找路径导入
export type { PerformanceOptions } from '../../types/performance.js'
