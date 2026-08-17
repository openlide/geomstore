/**
 * GeomStore v1.0 - 微信小程序企业级方案入口
 *
 * 提供多账号隔离、热更新恢复、离线状态管理与前后台同步等企业功能。
 * 子路径导出：`@openlide/geomstore/integrations/enterprise`
 *
 * @module integrations/enterprise
 * @since 1.0.0
 */

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
} from './wechat-enterprise'

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
} from './wechat-enterprise'
