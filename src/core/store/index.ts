/**
 * Store 模块导出
 *
 * 提供统一的导出入口
 */

// 主类导出
export { Store, isGeomStore } from './Store'

// 工厂函数
export { createStore } from './factory'

// 子模块导出（供高级用户使用）
export { StateProxyManager, createProxyCache } from './StateProxy'
export type { StateProxyOptions } from './StateProxy'

export { SubscriptionManager, createSubscribeFunction } from './SubscriptionManager'
export type { SubscriptionManagerOptions } from './SubscriptionManager'

export { StoreCacheManager } from './StoreCache'
export type { StoreCacheOptions } from './StoreCache'

export { ActionManager, GetterManager } from './ActionManager'
export type { ActionManagerOptions } from './ActionManager'

export { BatchManager, createBatchFunction } from './BatchManager'

// 内部类型导出
export type {
  InternalStateProtectionConfig,
  ProxyCache,
  SubscriptionManagerInterface,
  BatchManagerInterface,
  ActionExecutorInterface,
  GetterExecutorInterface,
} from './types'

// 工具导出
export { isProduction, createMutationErrorMessage, deepCloneState } from './utils'
