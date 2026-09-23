/**
 * GeomStore - DevTools插件导出
 *
 * 提供开发者工具相关的插件，包括时间旅行等功能
 *
 * @module @openlide/geomstore/extras/plugins（timeTravelPlugin 亦经该入口再导出）
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { timeTravelPlugin } from '@openlide/geomstore/extras/plugins'
 *
 * const store = createStore({
 *   name: 'todo',
 *   state: { items: [] as string[] },
 *   actions: {
 *     addItem(text: string) {
 *       this.$patch({ items: [...this.state.items, text] })
 *     },
 *   },
 * })
 *
 * // 安装时间旅行插件
 * store.use(
 *   timeTravelPlugin({
 *     maxSize: 100,
 *     autoRecord: true,
 *   }),
 * )
 *
 * store.dispatch('addItem', 'buy milk')
 *
 * // 访问时间旅行 API：全局表是唯一的公开入口（表键为 store.name）。
 * // 全局表只在非生产环境挂载：生产构建下这句读到的是 undefined，
 * // 插件本身仍在记录快照（见下方 @remarks）
 * const api = globalThis.__GEOMSTORE_TIME_TRAVEL__?.['todo']
 * api?.undo()
 * api?.redo()
 * api?.goTo(0)
 * ```
 *
 * @remarks 生产环境下不挂载的只有**全局调试入口**（连同两行 console 提示）：
 * `install()` 本身照常执行，快照数组、状态订阅与 `store.__timeTravel__` 都在，
 * 直到插件被卸载才清理。所以 `store.__timeTravel__` 在生产构建下同样存在——
 * 它是内部字段，不在 `Store` 公共类型上、也不参与类型检查，更没有对外契约，
 * 不要按它写业务代码
 */

export { timeTravelPlugin } from './timeTravelPlugin.js'
export type { TimeTravelOptions } from './timeTravelPlugin.js'
