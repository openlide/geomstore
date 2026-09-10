/**
 * 内置插件与插件工具（可选能力，按需动态引入）
 *
 * - `loggerPlugin`：Action 调用日志
 * - `persistencePlugin`：状态持久化（`StorageBackend` 可替换，默认提供 `WxStorageBackend`）
 * - `devtoolsPlugin` / `timeTravelPlugin`：开发期调试与时间旅行
 *
 * @example
 * ```ts
 * import { persistencePlugin } from '@openlide/geomstore/extras/plugins'
 *
 * store.use(persistencePlugin({ key: 'my-store' }))
 * ```
 *
 * @remarks 插件运行时（`HookSystem` / `usePlugin`）属核心 API，由主入口导出；
 * 本入口仅提供插件实现。
 */
export { loggerPlugin, persistencePlugin, devtoolsPlugin, builtinPlugins } from '../plugins/builtin.js'
export type { PersistenceOptions, StorageBackend } from '../types/persistence.js'
export { WxStorageBackend } from '../types/persistence.js'
export { timeTravelPlugin } from '../plugins/devtools/index.js'
export type { TimeTravelOptions } from '../plugins/devtools/index.js'
