/**
 * 插件实现（可选功能，按需动态引入）
 */
export { loggerPlugin, persistencePlugin, devtoolsPlugin, builtinPlugins } from '../plugins/builtin'
export type { PersistenceOptions, StorageBackend } from '../types/persistence'
export { WxStorageBackend } from '../types/persistence'
export { timeTravelPlugin } from '../plugins/devtools/index'
export type { TimeTravelOptions } from '../plugins/devtools/index'
