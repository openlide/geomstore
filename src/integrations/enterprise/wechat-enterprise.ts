/**
 * GeomStore - 微信小程序企业级方案
 *
 * 包含：
 * - 多账号隔离（持久化 key 与登出清理 key 统一为 store name）
 * - Store 管理器（账号切换 / LRU 清理）
 * - 热更新状态恢复
 * - 离线操作队列（支持 dispose 释放网络监听、syncQueue 互斥）
 * - 后台/前台状态同步（App.prototype 仅包装一次，多实例共享注册表）
 */

import type { Store } from '../../types/store.js'
import { storage, logger, CURRENT_USER_KEY, type WxApi } from './env.js'
import { OfflineManager } from './offline.js'
import type { UserState } from './user-store.js'
import { storeManager } from './store-manager.js'
import { initHotUpdate, restoreFromHotUpdate } from './hot-update.js'
import { initBackgroundSync, unregisterBackgroundSync, ensureAppLifecycleHooks } from './background-sync.js'

// wx API 类型声明、常量与 storage/logger 底座已抽至 ./env.js

// 本模块直接调用 wx（网络/热更新/网络状态/UI 反馈），故保留模块级 ambient 声明；
// 不向全局类型空间注入 wx，运行时由小程序宿主提供（测试环境由 tests/setup.js mock）
declare const wx: WxApi

// ==================== 1/2. 用户 Store 工厂与 Store 管理器 ====================
// 已拆至 ./user-store.js（UserInfo/UserPreferences/UserState/UserStoreConfig/createUserStore）
// 与 ./store-manager.js（StoreManager/storeManager）；此处再导出以保持对外 API 不变。

export type { UserInfo, UserPreferences, UserState, UserStoreConfig } from './user-store.js'
export { createUserStore } from './user-store.js'
export { StoreManager, storeManager } from './store-manager.js'

// ==================== 3. 热更新处理（已拆至 ./hot-update.js） ====================

export type { BackupData, HotUpdateConfig } from './hot-update.js'
export { initHotUpdate, restoreFromHotUpdate } from './hot-update.js'

// ==================== 4. 离线状态管理（已拆至 ./offline.js） ====================

export { OfflineManager } from './offline.js'
export type { OfflineAction } from './offline.js'

// ==================== 5. 后台/前台状态同步（已拆至 ./background-sync.js） ====================

export type { BackgroundSyncConfig } from './background-sync.js'
export { initBackgroundSync, unregisterBackgroundSync } from './background-sync.js'

// ==================== 6. 完整示例：App.ts 集成 ====================

/**
 * `createEnterpriseApp` 的配置项
 */
export interface EnterpriseAppConfig {
  /** 允许的最长非活跃时长（毫秒），透传给 `initBackgroundSync`；默认 10 分钟 */
  maxInactiveTime?: number
}

/**
 * 示例：在 App.ts 中使用以上所有功能
 * 账号切换/登出时自动 dispose 旧的 OfflineManager，避免监听泄漏
 */
export function createEnterpriseApp(config: EnterpriseAppConfig = {}) {
  const { maxInactiveTime = 10 * 60 * 1000 } = config

  // 必须在返回配置（即 App(options) 被调用）之前安装全局 App 包装。
  // 包装靠替换全局 App 拦截 options.onShow/onHide，而 onLaunch/login 里的
  // initBackgroundSync 执行时框架早已消费完本配置的回调——那时安装拦不到任何东西，
  // runForegroundChecks/runBackgroundChecks 永不执行，refreshData 与
  // onForeground/onBackground 全部静默失效（installAppLifecycleHooks 注释已声明此前置要求）。
  // 无登录用户（store 为 null）时同样要安装：login() 之后注册的处理器依赖包装已就位
  ensureAppLifecycleHooks()

  // 获取当前用户ID
  const currentUserId = storage.get<string>(CURRENT_USER_KEY)
  // 用 switchUser 而非 getUserStore：冷启动时 StoreManager.currentUserId 为 null，
  // 必须显式恢复身份，否则 StoreManager.logout() 的 `if (!this.currentUserId) return`
  // 会早退，导致 store.destroy() 与持久化键 user-store-<id> 都不被清理。
  // 冷启动本就是一次「切换到持久化的用户」，switchUser 语义正确
  let store: Store<UserState> | null = null
  if (currentUserId) {
    try {
      store = storeManager.switchUser(currentUserId)
    } catch (error) {
      // 历史脏标识（如旧版未校验时写入的空白 userId）会在 createUserStore 的
      // 入口校验处抛错：冷启动不能因身份损坏而整体崩溃，清键后按未登录处理
      logger.error('App', '冷启动恢复身份失败，已清除损坏的用户标识:', error)
      storage.remove(CURRENT_USER_KEY)
    }
  }

  // 离线管理器实例（延迟初始化）
  let offlineManager: OfflineManager<UserState> | null = null
  // 本轮 onShow 发起的同步是否仍在进行：OfflineManager.syncQueue 自带 syncing 互斥，
  // 同步期间再次调用只会立刻 resolve 一个空跑的 promise。若据此再走一遍
  // showLoading/hideLoading，第二次的 finally 会在首次同步仍在跑时提前收起转圈，
  // 两次 showLoading/hideLoading 抢同一个全局 toast
  let syncInFlight = false

  return {
    globalData: {
      storeManager,
      store,
      offlineManager: null as OfflineManager<UserState> | null,
    },

    onLaunch() {
      if (!store) return
      const currentStore = store

      // 四个初始化步骤各自兜底：此前背靠背执行，任一步抛错（存储配额满、
      // 宿主 wx API 不可用等）都会跳过后续步骤——离线管理器缺失会让 onShow 的
      // 队列同步静默失效，异常还会沿框架生命周期外抛、中断宿主自己的启动逻辑
      const initStep = (name: string, run: () => void): void => {
        try {
          run()
        } catch (error) {
          logger.error('App', `${name}初始化失败，已跳过该步骤继续`, error)
        }
      }

      // 1. 初始化热更新处理
      initStep('热更新', () => {
        initHotUpdate({
          store: currentStore,
          onBeforeUpdate: () => logger.log('App', '准备更新，状态已备份'),
        })
      })

      // 2. 尝试从热更新备份恢复
      initStep('热更新备份恢复', () => {
        restoreFromHotUpdate(currentStore)
      })

      // 3. 初始化后台/前台同步
      initStep('后台/前台同步', () => {
        initBackgroundSync({ store: currentStore, maxInactiveTime })
      })

      // 4. 初始化离线管理
      initStep('离线管理器', () => {
        offlineManager = new OfflineManager(currentStore)
        this.globalData.offlineManager = offlineManager
      })
    },

    onShow() {
      if (syncInFlight) return
      if (offlineManager && offlineManager.getQueueLength() > 0) {
        syncInFlight = true
        wx.showLoading({ title: '同步中...' })
        // syncQueue 可 reject（onDrop 回调抛错等），finally 前必须接住，
        // 避免 unhandled rejection；hideLoading 在成功与失败时都要执行
        offlineManager
          .syncQueue()
          .catch((error) => logger.error('App', '离线队列同步失败:', error))
          .finally(() => {
            syncInFlight = false
            wx.hideLoading()
          })
      }
    },

    login(userId: string) {
      // 身份持久化由 switchUser 统一完成，此处不再重复写 CURRENT_USER_KEY：
      // 两处写入时任一侧改动都会让内存身份与 storage 身份分叉
      const previousStore = this.globalData.store
      const newStore = storeManager.switchUser(userId)
      this.globalData.store = newStore

      // 账号切换：注销旧 Store 的后台同步处理器，为新 Store 重新注册
      if (previousStore && previousStore !== newStore) {
        unregisterBackgroundSync(previousStore)
      }
      initBackgroundSync({ store: newStore, maxInactiveTime })
      // 热更新保护切换到新 store：监听幂等安装（不累积），保护目标切换。
      // 首次登录（previousStore 为 null，onLaunch 因无 store 未注册）也必须注册
      if (previousStore !== newStore) {
        initHotUpdate({ store: newStore })
      }

      // 重新初始化离线管理器：先释放旧实例的网络监听，防止泄漏
      offlineManager?.dispose()
      offlineManager = new OfflineManager(newStore)
      this.globalData.offlineManager = offlineManager

      return newStore
    },

    logout() {
      // 先注销后台同步处理器，避免已销毁 Store 残留在注册表
      const currentStore = this.globalData.store
      if (currentStore) {
        unregisterBackgroundSync(currentStore)
      }

      offlineManager?.dispose()
      storeManager.logout()
      this.globalData.store = null
      this.globalData.offlineManager = null
      offlineManager = null
      storage.remove(CURRENT_USER_KEY)
      // 有意不做热更新注册的反向注销（#361）：hot-update 的 onUpdateReady 回调按
      // 累加式注册、微信没有 off API，注销只能靠读注册表时判活。这里留着指向已销毁
      // store 的注册项，回调入口的 `store.destroyed` 守卫会跳过备份并告警，
      // 下一次 initHotUpdate（login/冷启动）即覆盖为新目标——它就是预期的清理路径。
      // 残留代价仅是一个已销毁 store 的引用，直到那次覆盖为止
    },

    getStore(): Store<UserState> | null {
      return this.globalData.store
    },

    getOfflineManager(): OfflineManager<UserState> | null {
      return this.globalData.offlineManager
    },
  }
}
