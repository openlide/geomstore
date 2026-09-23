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

import type { Store, State } from '../../types/store.js'
import { storage, logger, CURRENT_USER_KEY, type WxApi } from './env.js'
import { OfflineManager } from './offline.js'
import { isValidUserId, type UserState } from './user-store.js'
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
 * 带「同步是否在途」信号的 OfflineManager
 *
 * 为什么需要它：基类的 `syncing` 互斥是私有字段，对调用方不可见，而 `getQueueLength()`
 * 刻意只数 `actionQueue`（同步在途期间整批已被快照移走，恒为 0，见 #352 口径）——
 * 于是 `App.onShow` 无法区分「本轮会同步」与「本轮被 syncing 空跑挡回」，
 * 据队列长度弹出的 loading 会在网络恢复回调那一轮仍在跑时被提前收起，
 * 两次 showLoading/hideLoading 抢同一个全局 toast（用户看到「转圈一闪就没、队列还在」）。
 *
 * 做法：覆写 `syncQueue()` 把基类的私有状态转成可查询信号。基类 344 行的网络恢复回调
 * 调的同样是实例方法（动态派发），所以那一轮也计入本计数；对基类「已释放/队列为空」的
 * 早退分支，本计数只在一个宏任务内为真，不会让 onShow 误跳过真正需要的同步。
 *
 * 一旦 `OfflineManager` 自己暴露 `isSyncing()`（当前 offline.ts 属另一分片），
 * 本类应整体删除、改读基类实现，保持单一事实来源
 */
class SyncAwareOfflineManager<S extends State> extends OfflineManager<S> {
  /** 在途轮次标记：>0 表示有一轮 syncQueue 正在跑（含基类网络恢复回调自行发起的那轮） */
  private roundsInFlight = 0

  /** 是否有一轮同步正在进行：onShow 据此决定是否接管加载提示 */
  isSyncing(): boolean {
    return this.roundsInFlight > 0
  }

  override async syncQueue(): Promise<void> {
    // 已有在途轮次时基类会立刻 resolve 一次空跑：此处既不再计数，也不能在返回时
    // 把那一轮的标记收掉，否则 loading 照样被提前收起
    const startsRound = this.roundsInFlight === 0
    if (startsRound) this.roundsInFlight += 1
    try {
      await super.syncQueue()
    } finally {
      if (startsRound) this.roundsInFlight -= 1
    }
  }
}

/**
 * `createEnterpriseApp` 的配置项
 */
export interface EnterpriseAppConfig {
  /** 允许的最长非活跃时长（毫秒），透传给 `initBackgroundSync`；默认 10 分钟 */
  maxInactiveTime?: number
}

/**
 * 示例：在 App.ts 中使用以上所有功能
 * 账号切换/登出时自动 dispose 旧的 OfflineManager，避免监听泄漏；
 * 登出还会清空该账号的离线队列与死信队列（键按 store name 派生，与账号一一对应），
 * 既不把载荷留在设备存储里，也不让下次登录重放登出前的操作
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
  // 身份键可能被外部写成非字符串，故按 unknown 处理再判定（storage.get 对缺失键归一为 null）
  const persistedUserId: unknown = storage.get<string>(CURRENT_USER_KEY)
  // 用 switchUser 而非 getUserStore：冷启动时 StoreManager.currentUserId 为 null，
  // 必须显式恢复身份，否则 StoreManager.logout() 的 `if (!this.currentUserId) return`
  // 会早退，导致 store.destroy() 与持久化键 user-store-<id> 都不被清理。
  // 冷启动本就是一次「切换到持久化的用户」，switchUser 语义正确
  let store: Store<UserState> | null = null
  if (persistedUserId !== null) {
    if (!isValidUserId(persistedUserId)) {
      // 只有「历史脏标识」（旧版未校验时写入的空/非字符串 userId，createUserStore
      // 入口按 #337 会为此抛错）才清键：冷启动不能因身份损坏而整体崩溃，清键后按未登录处理
      logger.error('App', '冷启动：持久化的用户标识无效（空或非字符串），已清除并按未登录处理')
      storage.remove(CURRENT_USER_KEY)
    } else {
      try {
        store = storeManager.switchUser(persistedUserId)
      } catch (error) {
        // switchUser 还会因与身份无关的原因抛错（store 创建、插件安装、LRU 淘汰既有
        // 账号时 destroy/订阅者抛错）。此前这条也清键：一次瞬时故障就把用户强制登出，
        // 下次冷启动变成未登录、要重走认证。这里只记失败并保留身份，留给下次启动重试
        logger.error('App', '冷启动恢复身份失败，已保留持久化身份待下次启动重试:', error)
      }
    }
  }

  // 离线管理器实例（延迟初始化）。类型用 SyncAwareOfflineManager：onShow 需要它的
  // isSyncing() 信号；对外（globalData / getOfflineManager()）仍按基类 OfflineManager 暴露
  let offlineManager: SyncAwareOfflineManager<UserState> | null = null
  // 本轮 onShow 发起的同步是否仍在进行：OfflineManager.syncQueue 自带 syncing 互斥，
  // 同步期间再次调用只会立刻 resolve 一个空跑的 promise。若据此再走一遍
  // showLoading/hideLoading，第二次的 finally 会在首次同步仍在跑时提前收起转圈，
  // 两次 showLoading/hideLoading 抢同一个全局 toast
  let syncInFlight = false

  // 热更新注册配置在闭包里只写一份：initHotUpdate 每次调用都会整体覆盖前一次注册，
  // login（账号切换）路径若只传 { store }，配置过的 onBeforeUpdate 会在本次会话余下
  // 时间里静默丢失
  const hotUpdateOptions = {
    onBeforeUpdate: () => logger.log('App', '准备更新，状态已备份'),
  }

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
        initHotUpdate({ store: currentStore, ...hotUpdateOptions })
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
        offlineManager = new SyncAwareOfflineManager(currentStore)
        this.globalData.offlineManager = offlineManager
      })
    },

    onShow() {
      if (syncInFlight) return
      // 已有同步在途（多为 offline.ts 网络恢复回调自行发起的那轮）：本轮 syncQueue 会被
      // syncing 互斥空跑挡回，随即 hideLoading 就把那一轮的转圈收掉，而队列里可能还剩
      // 一整批未跑完的操作。判据必须是「是否有一轮在跑」，不能是 getQueueLength()——
      // 它在同步期间刻意归 0（#352 口径），既不表明「本轮会同步」也不表明「本轮没人在同步」
      if (offlineManager && offlineManager.isSyncing()) {
        logger.log('App', '已有离线队列同步在进行中，本次切前台不接管加载提示')
        return
      }
      if (offlineManager && offlineManager.getQueueLength() > 0) {
        syncInFlight = true
        // 加载提示与同步本体分开兜底：showLoading 抛错（部分宿主/测试环境的 wx UI API 会抛）
        // 既不能把互斥标记永久留在 true（此后 onShow 再也不会触发同步，队列里的操作
        // 只能等网络状态变化），也不能让同步本身被跳过
        try {
          wx.showLoading({ title: '同步中...' })
        } catch (error) {
          logger.error('App', '离线队列同步的加载提示失败，继续同步:', error)
        }
        // syncQueue 可 reject（onDrop 回调抛错等），finally 前必须接住，
        // 避免 unhandled rejection；hideLoading 在成功与失败时都要执行。
        // hideLoading 同样兜住：它抛错会沿 finally 变成这条链路上没人接的 rejection
        offlineManager
          .syncQueue()
          .catch((error) => logger.error('App', '离线队列同步失败:', error))
          .finally(() => {
            syncInFlight = false
            try {
              wx.hideLoading()
            } catch (error) {
              logger.error('App', '收起加载提示失败:', error)
            }
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
      // 除目标外的配置与 onLaunch 同源（hotUpdateOptions），否则换号后回调静默丢失。
      // 首次登录（previousStore 为 null，onLaunch 因无 store 未注册）也必须注册
      if (previousStore !== newStore) {
        initHotUpdate({ store: newStore, ...hotUpdateOptions })
      }

      // 重新初始化离线管理器：先释放旧实例的网络监听，防止泄漏
      offlineManager?.dispose()
      offlineManager = new SyncAwareOfflineManager(newStore)
      this.globalData.offlineManager = offlineManager

      return newStore
    },

    logout() {
      // 先注销后台同步处理器，避免已销毁 Store 残留在注册表
      const currentStore = this.globalData.store
      if (currentStore) {
        unregisterBackgroundSync(currentStore)
      }

      // 登出必须连离线队列一起清：队列键与死信键按 store name 派生（与账号一一对应），
      // 只 dispose 不删键会留下两层后果——
      // (1) 队列条目携带 payload（下单/表单内容，可能含个人信息与凭证字段），用户已登出
      //     却仍在设备本地存储里明文留存；
      // (2) 同账号再次 login() 时新实例的构造期 loadQueue() 把它们读回，
      //     App.onShow 随即 dispatch 进刚重建的 store：登出前的操作被再次提交（非幂等即重复下单）
      // 顺序要求：clearQueue/clearDeadLetters 对已释放实例一律拒绝（存储键已由接管实例
      // 持有），故必须在 dispose() 之前调用
      offlineManager?.clearQueue()
      offlineManager?.clearDeadLetters()
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
