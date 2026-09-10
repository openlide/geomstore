/**
 * GeomStore - 核心 API（瘦核心，始终打包）
 *
 * 仅导出应用运行所必需的最小接口集合。快照、选择器、性能监控、Action 增强、
 * 企业微信集成与插件实现等可选能力统一收敛至 `../extras`，按需动态引入。
 */

// ==================== 核心Store ====================
export { Store, isGeomStore } from './store/index.js'
export type {
  StoreOptions,
  State,
  Actions,
  Getters,
  StateListener,
  InferActionArgs,
  InferActionReturn,
  InferGetterReturn,
  ActionNames,
  CacheStats,
} from '../types/store.js'

// ==================== 工厂函数 ====================
export { createStore } from './store/factory.js'

// ==================== 工具函数 ====================
export {
  isObject,
  isPlainObject,
  isFunction,
  isArray,
  isPromise,
  shallowEqual,
  deepEqual,
  deepMerge,
  get,
  set,
  noop,
  identity,
  uniqueId,
  clone,
} from './utils/helpers.js'
export type { CloneMode } from './utils/helpers.js'

// ==================== 插件系统（核心） ====================
export { HookSystem, usePlugin } from './hooks/index.js'
export type { Plugin, HookName, HookHandler, IHookSystem, PluginHook } from './hooks/index.js'

// ==================== 微信小程序集成 ====================
export { withPageStore, withComponentStore } from '../integrations/with-store.js'
export { withAppStore } from '../integrations/with-app-store.js'
export type { AppOptions } from '../integrations/with-app-store.js'
export type {
  ConnectOptions,
  PageThis,
  ComponentThis,
  PageConfig,
  ComponentConfig,
  ExtractPageData,
  WithPageThis,
  PageOwnMethods,
  ComponentOwnMethods,
  PageReservedKeys,
} from '../types/integration.js'

// ==================== Store组合 ====================
export { composeStore, createStoreTree, StoreRegistry, globalRegistry, ComposedStore } from './compose/index.js'
export type { ComposeOptions, StoreTreeNode, NamespaceConfig } from '../types/compose.js'

// ==================== LRU缓存 ====================
export { LRUCache } from './cache/index.js'
export type { LRUCacheStats, CacheOptions } from './cache/index.js'
