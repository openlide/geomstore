/**
 * GeomStore - 核心 API（瘦核心，始终打包）
 *
 * 「瘦」的判据是**是否被核心运行链路直接依赖**，不是「接口数量最少」。
 * 本入口始终导出：Store/createStore 与状态工具、组合 Store、LRU 缓存，
 * 以及插件钩子（`HookSystem` / `usePlugin`）与**微信小程序**接入
 * （`withPageStore` / `withComponentStore` / `withAppStore`）。
 * 后两组留在核心是依赖方向决定的，不是遗漏：钩子是 `store.use` 的实现层，
 * 小程序绑定是本库的主用法，拆到 extras 会让主入口拿不到最基本的接入能力。
 *
 * 真正可选、需从 `../extras` 各子入口按需引入的是：插件**实现**（logger / persistence /
 * devtools / timeTravel，钩子机制本身仍属核心）、快照、选择器、性能监控与性能插件、
 * Action 增强（withCache / withThrottle 等）、错误边界与聚合上报、企业微信（WeCom）集成。
 *
 * @remarks 术语澄清：**企业微信集成（WeCom，`extras/enterprise`）**与
 * **微信小程序集成（`src/integrations`，本入口导出）**是两回事，前者是可选能力、
 * 后者属核心，历史文档把两者混写过，勿据此判断某个 API 是否需要额外引入。
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
