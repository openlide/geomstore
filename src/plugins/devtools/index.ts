/**
 * GeomStore v1.0 - DevTools插件导出
 *
 * 提供开发者工具相关的插件，包括时间旅行等功能
 *
 * @module @geomstore/plugins/devtools
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { timeTravelPlugin } from '@geomstore/plugins/devtools'
 *
 * // 安装时间旅行插件
 * store.use(timeTravelPlugin({
 *   maxSize: 100,
 *   autoRecord: true
 * }))
 *
 * // 访问时间旅行API
 * const api = store.__timeTravel__
 * api.undo()
 * api.redo()
 * api.goTo(10)
 * ```
 */

export { timeTravelPlugin } from './timeTravelPlugin'
export type { TimeTravelOptions } from './timeTravelPlugin'
