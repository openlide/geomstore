/**
 * Store 模块导出
 *
 * 提供统一的导出入口
 */

// 主类导出
export { Store, isGeomStore } from './Store.js'

// 工厂函数
export { createStore } from './factory.js'

// 子模块导出（供高级用户使用）
// 各类的构造参数类型一并再导出：本 barrel 是这些管理器在库内的集中出口，
// 只出类不出选项类型会逼调用方再去深路径取类型，破坏「单一类型入口」的一致性
// （注意本 barrel 不在 package.json exports 里，包外取不到；此处仅为内部一致性）
export { StateProxyManager, createProxyCache } from './StateProxy.js'
export type { StateProxyOptions } from './StateProxy.js'

export { SubscriptionManager, createSubscribeFunction } from './SubscriptionManager.js'
export type { SubscriptionManagerOptions } from './SubscriptionManager.js'

export { StoreCacheManager } from './StoreCache.js'
export type { StoreCacheOptions } from './StoreCache.js'
export type { CacheStats } from '../../types/store.js'

export { ActionManager, GetterManager } from './ActionManager.js'
export type { ActionManagerOptions } from './ActionManager.js'

export { BatchManager } from './BatchManager.js'

// 内部类型导出
export type { InternalStateProtectionConfig, ProxyCache, SubscriptionManagerInterface, BatchManagerInterface } from './types.js'

// 工具导出
export { isProduction, createMutationErrorMessage, deepCloneState } from './utils.js'
