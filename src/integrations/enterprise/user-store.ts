/**
 * GeomStore - 微信小程序企业级方案：多账号隔离 Store 工厂
 *
 * 自 wechat-enterprise.ts 拆出。每个用户拥有独立 Store 实例与持久化键
 * （store name 即 `user-store-${userId}`）。
 */

import { createStore } from '../../core/store/index.js'
import type { Store, State } from '../../types/store.js'
import { persistencePlugin } from '../../plugins/builtin.js'
import { logger, DEFAULT_DEBOUNCE_MS, type WxApi } from './env.js'

// 本模块直接调用 wx（网络），故保留模块级 ambient 声明
declare const wx: WxApi

/**
 * 用户信息（由服务端返回，业务可自行扩展字段）
 */
export interface UserInfo {
  /** 用户唯一标识 */
  id?: string | number
  /** 昵称 */
  name?: string
  /** 头像地址 */
  avatar?: string
  [key: string]: unknown
}

/**
 * 用户偏好设置（随账号隔离并持久化）
 */
export interface UserPreferences {
  /** 主题标识 */
  theme?: string
  /** 语言标识 */
  language?: string
  [key: string]: unknown
}

/**
 * 用户隔离 Store 的状态形状
 */
export interface UserState extends State {
  /** 当前用户信息；未登录或未同步时为 null */
  userInfo: UserInfo | null
  /** 用户偏好设置 */
  preferences: UserPreferences
  /** 最近一次与服务端同步的时间戳；未同步时为 null。会话级字段，不随持久化恢复（见 createUserStore 的 filter） */
  lastSyncTime: number | null
}

/**
 * `createUserStore` 的配置项
 */
export interface UserStoreConfig {
  /** 用户唯一标识：参与 Store 名称与持久化键（`user-store-${userId}`），不可为空/纯空白 */
  userId: string
  /**
   * 用户信息同步接口地址：必须是 `wx.request` 接受的绝对 URL（域名还需在小程序后台白名单内）。
   * 缺省即「本 Store 不具备服务端同步能力」——`syncWithServer` 会在发起请求前直接 reject
   * （库内不内置业务端点：相对路径在小程序端注定失败，内置一个「看起来像默认值」的地址
   * 只会把配置缺失变成一次无法归因的网络错误）。
   *
   * 注意落盘后果：响应体的 `userInfo` 会被**整体**写进本地存储（键 `user-store-${userId}`，
   * 小程序 storage 不加密），该接口顺带下发的 session/token/手机号这类字段因此长期驻留设备。
   * 要收窄请显式配置 `persistUserInfoKeys`
   */
  syncUrl?: string
  /** 初始状态覆盖项（可选） */
  initialState?: Partial<UserState>
  /**
   * `userInfo` 的持久化字段允许列表（可选）：列出的**自有**键才会落本地存储，
   * 其余键只在内存里存活。用于把 `syncUrl` 响应里顺带下发的敏感字段（token/session/
   * 手机号等）挡在设备存储之外——小程序 storage 明文且同主体的调试/备份通道可读。
   *
   * 缺省即「整个 `userInfo` 原样落盘」，刻意不作保守白名单：`UserInfo` 是带
   * `[key: string]: unknown` 的开放形状（业务自行扩展字段），内置白名单会让未列出的
   * 业务字段在重启后凭空消失，属破坏性变更。要收窄必须显式声明。
   * 该选项只管 `userInfo`：`preferences` 由宿主自己的 `updatePreferences` 写入，
   * 本就不来自服务端响应
   */
  persistUserInfoKeys?: readonly string[]
}

/** 用户隔离 Store 名称 / 持久化键的前缀 */
const USER_STORE_PREFIX = 'user-store-'

/**
 * 派生用户 Store 的名称与持久化键：与 StoreManager.logout 删除的键同源，
 * 两处各自硬编码字面量时任一侧改动都会让登出清不掉持久化数据
 */
export function userStoreKey(userId: string): string {
  return `${USER_STORE_PREFIX}${userId}`
}

/**
 * userId 合法性判定 —— 与 createUserStore 入口校验同源。
 *
 * 冷启动恢复身份（createEnterpriseApp）要靠它区分「持久化的是历史脏标识」与
 * 「switchUser 因无关原因抛错」：前者该清键按未登录处理，后者必须保留身份键，
 * 否则一次瞬时故障就把用户登出。判定规则散在两处时任一侧改动都会让这条区分失效
 */
export function isValidUserId(userId: unknown): userId is string {
  return typeof userId === 'string' && userId.trim() !== ''
}

/**
 * 从服务端拉取用户信息
 * 使用 wx.request（微信小程序网络 API），避免依赖 Node/DOM 的 fetch；
 * wx.request 在任意 HTTP 状态码下都会触发 success，非 2xx 视为请求失败
 */
function requestUserInfo(url: string): Promise<UserInfo> {
  return new Promise<UserInfo>((resolve, reject) => {
    wx.request({
      url,
      success: (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`sync failed with status ${res.statusCode}`))
          return
        }
        // 响应体来自服务端，形状不可信：缺 userInfo 时必须 reject，
        // 直接断言会把 undefined 写进 userInfo: UserInfo | null 的契约里
        const payload = res.data as { userInfo?: unknown } | null
        const userInfo = payload && typeof payload === 'object' ? payload.userInfo : undefined
        if (!userInfo || typeof userInfo !== 'object' || Array.isArray(userInfo)) {
          reject(new Error('sync failed: response body has no userInfo object'))
          return
        }
        resolve(userInfo as UserInfo)
      },
      fail: reject,
    })
  })
}

/**
 * userInfo 落盘前的字段投影（见 `UserStoreConfig.persistUserInfoKeys`）
 *
 * 未配置允许列表时原样交出（保持既有行为）。逐键用 defineProperty 写入：
 * 允许列表由宿主配置，`'__proto__'` 用普通赋值会命中 Object.prototype 的 setter
 * 而改坏投影对象的原型链（与 integrations/utils 的 setOwnEntry 同口径）
 */
function projectUserInfo(userInfo: UserInfo | null, allowedKeys?: readonly string[]): UserInfo | null {
  if (userInfo === null || !allowedKeys) return userInfo
  const projected: UserInfo = {}
  for (const key of allowedKeys) {
    // 只投影自有键：不沿原型链取值，否则宿主允许列表里的 `toString` 这类键
    // 会把继承来的方法一并落盘
    if (Object.prototype.hasOwnProperty.call(userInfo, key)) {
      Object.defineProperty(projected, key, {
        value: userInfo[key],
        writable: true,
        enumerable: true,
        configurable: true,
      })
    }
  }
  return projected
}

/**
 * 创建用户隔离的 Store
 *
 * 每个用户拥有独立的 Store 实例与持久化键（store name 即 `user-store-${userId}`），
 * 登出时 StoreManager 按同一键清理持久化数据，保证键的写入与删除一致。
 * 落盘内容默认为 `userInfo` + `preferences` 全量，敏感字段用
 * `persistUserInfoKeys` 收窄（见该选项说明）
 */
export function createUserStore(config: UserStoreConfig): Store<UserState> {
  const { userId, syncUrl, initialState = {}, persistUserInfoKeys } = config

  // 空/纯空白 userId 会生成 `user-store-` 这类畸形键：不同账号在 storage 与
  // StoreManager 的 Map 上碰撞同一键，即跨账号数据泄漏，必须在入口拒绝
  if (!isValidUserId(userId)) {
    throw new Error('[UserStore] userId 不能为空')
  }

  // 同步请求序号：并发 syncWithServer 时先发的请求可能后返回，无守卫地 $patch
  // 会让旧响应覆盖新响应（调用方拿 userInfo/lastSyncTime 判定是否需要重新同步，
  // 被旧响应覆盖后判定即失真）。刻意不做「在途去重」：那会把后一次调用的 promise
  // 变成空转或直接跳过，改变每次调用都能拿到一次同步结果的既有契约
  let syncSequence = 0

  const store = createStore<UserState>({
    name: userStoreKey(userId),
    // 三个契约字段逐字段回落默认值，而非 `...initialState` 展开覆盖：
    // Partial<UserState> 允许显式 `undefined`（exactOptionalPropertyTypes 未开），
    // 展开会把 preferences 等必填字段变成 undefined，state 从此违反 UserState，
    // updatePreferences 与持久化 filter 序列化出缺键的载荷
    state: {
      userInfo: initialState.userInfo ?? null,
      preferences: initialState.preferences ?? {},
      lastSyncTime: initialState.lastSyncTime ?? null,
    },
    actions: {
      // 推荐写法：通过 $patch 更新状态（而非直接变异 this.state），
      // 保证订阅通知、快照与缓存刷新行为一致
      setUserInfo(userInfo: UserInfo) {
        this.$patch({ userInfo, lastSyncTime: Date.now() })
      },
      updatePreferences(key: string, value: unknown) {
        this.$patch({
          preferences: { ...this.state.preferences, [key]: value },
        })
      },
      async syncWithServer() {
        // 先请求后写入：请求失败（reject）时不污染状态。
        // catch 记日志后原样 rethrow：调用方仍需感知失败做业务兜底，
        // 但无日志会让网络失败在监控里完全不可见
        try {
          if (!syncUrl) {
            throw new Error('[UserStore] 未配置 syncUrl：syncWithServer 需要显式注入同步接口地址（绝对 URL）')
          }
          const seq = ++syncSequence
          const userInfo = await requestUserInfo(syncUrl)
          // 等待期间 store 被销毁（StoreManager.logout / LRU 淘汰）：此时 $patch
          // 抛「Cannot call $patch on a destroyed Store」，会被下面的 catch 记成
          // 「同步用户信息失败」并 rethrow——掩盖真实原因、还诱导调用方重试一次
          // 注定失败的同步
          if (store.destroyed) {
            logger.warn('UserStore', 'Store 已销毁，丢弃本次同步结果')
            return
          }
          // 更晚发出的请求已有（或正在有）更新的结果：旧响应不得覆盖
          if (seq !== syncSequence) {
            logger.log('UserStore', '已有更新的同步请求发出，丢弃本次响应')
            return
          }
          this.$patch({ userInfo, lastSyncTime: Date.now() })
        } catch (error) {
          logger.error('UserStore', '同步用户信息失败:', error)
          throw error
        }
      },
      /**
       * 前台刷新入口：`background-sync` 在切前台且非活跃超阈值时按名字 dispatch 它
       * （`REFRESH_DATA_ACTION`，见同目录 background-sync.ts）。
       *
       * 该 action 名是后台同步的隐式契约，工厂不提供它，`createEnterpriseApp` 注册的
       * 两个 handler 就永远进不了刷新分支——「切前台自动刷新数据」在库自带的示例组合里
       * 整体失效（后台同步侧现在会为此显式告警一次）。
       */
      refreshData(): Promise<void> {
        return this.dispatch('syncWithServer')
      },
    },
    enableCache: true,
    cacheKeys: ['userInfo', 'preferences'],
  })

  // 用户隔离的持久化：直接复用 store name 作为存储键（本身已含 userId），
  // 使 StoreManager.logout 删除的键与持久化写入的键完全一致
  store.use(
    persistencePlugin<UserState>({
      key: (name: string) => name,
      // 刻意只持久化 userInfo / preferences：lastSyncTime 是会话级字段。
      // 跨进程重启沿用上一次的同步时间会让「上次同步于何时」指向一个本次进程
      // 并未发生过的网络往返，依赖它做 re-sync 判定的调用方会被误导；
      // 恢复后由 syncWithServer 重新写入（#338）
      // userInfo 先按 persistUserInfoKeys 投影，宿主据此把服务端顺带下发的敏感字段
      // 挡在设备存储之外（缺省不投影，见该选项的兼容性说明）
      filter: (state: UserState) => ({
        userInfo: projectUserInfo(state.userInfo, persistUserInfoKeys),
        preferences: state.preferences,
      }),
      debounce: DEFAULT_DEBOUNCE_MS,
    }),
  )

  return store
}
