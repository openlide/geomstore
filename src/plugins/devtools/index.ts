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
 * // 访问时间旅行 API：全局表是唯一的公开入口（仅开发/测试环境挂载，
 * // 生产构建下插件根本不注册；表键为 store.name）
 * const api = globalThis.__GEOMSTORE_TIME_TRAVEL__?.['todo']
 * api?.undo()
 * api?.redo()
 * api?.goTo(0)
 * ```
 *
 * @remarks 插件安装时也会把同一份 API 挂到 `store.__timeTravel__`（内部字段，
 * 不在 `Store` 公共类型上、生产构建下不存在），因此不要按 `store.__timeTravel__`
 * 写业务代码——它不参与类型检查，也没有对外契约
 */

export { timeTravelPlugin } from './timeTravelPlugin.js'
export type { TimeTravelOptions } from './timeTravelPlugin.js'
