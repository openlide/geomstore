/**
 * GeomStore v1.0 - 插件模块入口（子路径导出 `geomstore/plugins`）
 *
 * @module plugins
 * @since 1.0.0
 */

// 内置插件
export { loggerPlugin, persistencePlugin, devtoolsPlugin, builtinPlugins } from './builtin'
export type { PersistenceOptions, StorageBackend } from '../types/persistence'

// 钩子系统（实现位于 core/hooks，此处保留插件层入口便于发现性）
export { HookSystem, usePlugin } from '../core/hooks/index'
export type { Plugin, PluginHook, HookName, HookHandler, IHookSystem } from '../types/plugin'

// DevTools 插件
export { timeTravelPlugin } from './devtools/index'
export type { TimeTravelOptions } from './devtools/index'

// 性能插件
export { analyzerPlugin, createAnalyzerPlugin } from './performance/index'
