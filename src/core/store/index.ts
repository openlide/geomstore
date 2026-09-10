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
export { StateProxyManager, createProxyCache } from './StateProxy.js'

export { SubscriptionManager, createSubscribeFunction } from './SubscriptionManager.js'

export { StoreCacheManager } from './StoreCache.js'
export type { CacheStats } from '../../types/store.js'

export { ActionManager, GetterManager } from './ActionManager.js'

export { BatchManager } from './BatchManager.js'

// 内部类型导出
export type { InternalStateProtectionConfig, ProxyCache, SubscriptionManagerInterface, BatchManagerInterface } from './types.js'

// 工具导出
export { isProduction, createMutationErrorMessage, deepCloneState } from './utils.js'
