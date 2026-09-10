/**
 * GeomStore - 微信小程序集成模块
 *
 * 提供 Store 与微信小程序的集成方案
 *
 * @module integrations
 */

// ==================== 核心集成函数 ====================

export { withPageStore, withComponentStore } from './with-store.js'
export { withAppStore } from './with-app-store.js'

// ==================== 企业级方案 ====================

export {
  createUserStore,
  StoreManager,
  storeManager,
  initHotUpdate,
  restoreFromHotUpdate,
  OfflineManager,
  initBackgroundSync,
  unregisterBackgroundSync,
  createEnterpriseApp,
} from './enterprise/index.js'
export type {
  UserInfo,
  UserPreferences,
  UserState,
  UserStoreConfig,
  BackupData,
  HotUpdateConfig,
  OfflineAction,
  BackgroundSyncConfig,
  EnterpriseAppConfig,
} from './enterprise/index.js'

// ==================== 集成工具函数 ====================

export { parseMapping, bindMappings, bindActions, performAutoInject, exposeStoreAPI, cleanupBindings } from './utils.js'

// ==================== 类型导出 ====================

export type { ConnectOptions } from '../types/integration.js'
