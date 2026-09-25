/**
 * GeomStore - 性能插件导出
 *
 * 提供性能监控和分析相关的插件
 *
 * @module @openlide/geomstore/extras/performance
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { analyzerPlugin, createAnalyzerPlugin } from '@openlide/geomstore/extras/performance'
 *
 * const store = createStore({ name: 'order', state: { count: 0 } })
 *
 * // 默认配置
 * store.use(analyzerPlugin)
 *
 * // 自定义配置：与上面**二选一**。两个都装会在同一个 store 上得到两个分析器
 * // （use() 的去重按插件实例判，createAnalyzerPlugin 每次返回新对象），
 * // dispatch / getter 会被各包一层，指标翻倍、__performanceMonitor__ 被后者覆盖。
 * // store.use(createAnalyzerPlugin({
 * //   sampleRate: 1.0,
 * //   threshold: 16,
 * //   trackMemory: true
 * // }))
 *
 * // 访问性能分析 API：全局表只在非生产环境挂载（且要插件已安装、store 名对得上），
 * // 其余情况读到 undefined，直接调用会抛 TypeError
 * const api = globalThis.__GEOMSTORE_ANALYZER__?.order
 * const stats = api?.getStats()
 * const bottlenecks = api?.analyzeBottlenecks() ?? []
 * ```
 */

export { analyzerPlugin, createAnalyzerPlugin } from './analyzerPlugin.js'
// createAnalyzerPlugin / setOptions 的入参类型：核心与 extras 入口早已导出，
// 本插件入口此前只给运行时 API 不给类型，按同一入口配置分析器时还得另找路径导入
export type { PerformanceOptions } from '../../types/performance.js'
