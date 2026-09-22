/**
 * GeomStore - 插件模块入口
 *
 * 对外发布路径：package.json exports 声明的是 `@openlide/geomstore/extras/plugins`
 * （由 src/extras/plugins.ts 挑选性再导出）；`@openlide/geomstore/plugins` 只是 prepack
 * 生成的老式解析器兼容别名（scripts/generate-subpath-stubs.mjs，供不识别 exports 字段的
 * 微信小程序「构建 npm」命中）。新代码请用 extras/plugins 子路径。
 *
 * @module plugins
 */

// 内置插件
export { loggerPlugin, persistencePlugin, devtoolsPlugin, builtinPlugins } from './builtin.js'
export type { PersistenceOptions, StorageBackend } from '../types/persistence.js'

// 钩子系统（实现位于 core/hooks，此处保留插件层入口便于发现性）
export { HookSystem, usePlugin } from '../core/hooks/index.js'
export type { Plugin, PluginHook, HookName, HookHandler, IHookSystem } from '../types/plugin.js'

// DevTools 插件
export { timeTravelPlugin } from './devtools/index.js'
export type { TimeTravelOptions } from './devtools/index.js'

// 性能插件
export { analyzerPlugin, createAnalyzerPlugin } from './performance/index.js'
// 与 PersistenceOptions / TimeTravelOptions 同口径：配置项类型随运行时 API 一起给出
export type { PerformanceOptions } from '../types/performance.js'
