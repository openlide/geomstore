/**
 * GeomStore - 微信小程序企业级方案：多账号隔离 Store 工厂
 *
 * 自 wechat-enterprise.ts 拆出。每个用户拥有独立 Store 实例与持久化键
 * （store name 即 `user-store-${userId}`）。
 */

import { createStore } from '../../core/store/index.js'
import type { Store, State } from '../../types/store.js'
import { persistencePlugin } from '../../plugins/builtin.js'
import { DEFAULT_DEBOUNCE_MS, type WxApi } from './env.js'

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
  /** 最近一次与服务端同步的时间戳；未同步时为 null */
  lastSyncTime: number | null
}

/**
 * `createUserStore` 的配置项
 */
export interface UserStoreConfig {
  /** 用户唯一标识：参与 Store 名称与持久化键（`user-store-${userId}`） */
  userId: string
  /** 初始状态覆盖项（可选） */
  initialState?: Partial<UserState>
}

/**
 * 从服务端拉取用户信息
 * 使用 wx.request（微信小程序网络 API），避免依赖 Node/DOM 的 fetch；
 * wx.request 在任意 HTTP 状态码下都会触发 success，非 2xx 视为请求失败
 */
function requestUserInfo(): Promise<UserInfo> {
  return new Promise<UserInfo>((resolve, reject) => {
    wx.request({
      url: '/api/user/sync',
      success: (res) => {
        const r = res as { statusCode?: number; data?: { userInfo?: UserInfo } }
        if (r.statusCode !== undefined && (r.statusCode < 200 || r.statusCode >= 300)) {
          reject(new Error(`sync failed with status ${r.statusCode}`))
          return
        }
        resolve(r.data?.userInfo as UserInfo)
      },
      fail: reject,
    })
  })
}

/**
 * 创建用户隔离的 Store
 *
 * 每个用户拥有独立的 Store 实例与持久化键（store name 即 `user-store-${userId}`），
 * 登出时 StoreManager 按同一键清理持久化数据，保证键的写入与删除一致
 */
export function createUserStore(config: UserStoreConfig): Store<UserState> {
  const { userId, initialState = {} } = config

  const store = createStore<UserState>({
    name: `user-store-${userId}`,
    state: {
      userInfo: null,
      preferences: {},
      lastSyncTime: null,
      ...initialState,
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
        // 先请求后写入：请求失败（reject）时不污染状态
        const userInfo = await requestUserInfo()
        this.$patch({ userInfo, lastSyncTime: Date.now() })
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
      filter: (state: UserState) => ({
        userInfo: state.userInfo,
        preferences: state.preferences,
      }),
      debounce: DEFAULT_DEBOUNCE_MS,
    }),
  )

  return store
}
