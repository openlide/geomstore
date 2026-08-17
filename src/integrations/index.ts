/**
 * GeomStore v1.0.0 - 微信小程序集成模块
 *
 * 提供 Store 与微信小程序的集成方案
 *
 * @module integrations
 * @since 1.0.0
 */

// ==================== 核心集成函数 ====================

export { withPageStore, withComponentStore } from './with-store'
export { withAppStore, createApp } from './with-app-store'

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
} from './enterprise/index'
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
} from './enterprise/index'

// ==================== 集成工具函数 ====================

export { parseMapping, bindMappings, bindActions, performAutoInject, exposeStoreAPI, cleanupBindings } from './utils'

// ==================== 类型导出 ====================

export type { ConnectOptions } from '../types/integration'

// ==================== 默认导出 ====================

export { default } from './utils'
