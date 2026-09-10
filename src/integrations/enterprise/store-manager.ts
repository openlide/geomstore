/**
 * GeomStore - 微信小程序企业级方案：Store 管理器（账号切换 / LRU 清理）
 *
 * 自 wechat-enterprise.ts 拆出。
 */

import type { Store } from '../../types/store.js'
import { createUserStore, type UserState } from './user-store.js'
import { storage, logger, CURRENT_USER_KEY, DEFAULT_MAX_STORES } from './env.js'

/**
 * Store 管理器：负责多账号 Store 的获取/创建、身份切换、登出与 LRU 淘汰
 *
 * 使用约束：
 * - `getUserStore` 只「取/建」指定账号的 store，**不改变当前登录身份**——
 *   只读预览其它账号时若顺带切换身份，后续 `logout()` 会清错账号的数据；
 *   身份切换请显式调用 `switchUser`
 * - 被 LRU 淘汰或 `logout()` 后的 store 已 `destroy()`，不可继续 dispatch
 */
export class StoreManager {
  private stores: Map<string, Store<UserState>> = new Map()
  private currentUserId: string | null = null
  private readonly maxStores: number

  constructor(maxStores: number = DEFAULT_MAX_STORES) {
    this.maxStores = maxStores
  }

  /**
   * 获取或创建用户 Store
   *
   * 只负责「取/建某账号的 store」，**不改变当前登录身份**。
   * 此前未命中分支会顺带写 this.currentUserId，而命中分支不会——同一调用的身份
   * 副作用取决于 LRU 淘汰状态这一调用方不可见的实现细节；只读预览另一账号
   * （getUserStore('B')）会静默把身份切成 B，随后 logout() 清的是 B 的数据。
   * 身份切换与冷启动恢复一律走 switchUser 显式表达。
   */
  getUserStore(userId: string): Store<UserState> {
    const existingStore = this.stores.get(userId)
    if (existingStore) {
      // 命中即刷新插入顺序：Map 迭代序即淘汰顺序，不刷新则高频使用的账号
      // 会被当作最旧淘汰（FIFO 而非注释宣称的 LRU）
      this.stores.delete(userId)
      this.stores.set(userId, existingStore)
      return existingStore
    }

    this.cleanupOldestStore(userId)

    const store = createUserStore({ userId })
    this.stores.set(userId, store)

    return store
  }

  /**
   * 切换用户
   */
  switchUser(userId: string): Store<UserState> {
    const newStore = this.getUserStore(userId)
    this.currentUserId = userId
    logger.log('StoreManager', `切换到用户: ${userId}`)
    return newStore
  }

  /**
   * 登出当前用户
   * 持久化键与 createUserStore 的存储键一致（均为 `user-store-${userId}`）
   */
  logout(): void {
    if (!this.currentUserId) return

    const store = this.stores.get(this.currentUserId)
    store?.destroy()
    this.stores.delete(this.currentUserId)

    storage.remove(`user-store-${this.currentUserId}`)
    storage.remove(CURRENT_USER_KEY)

    this.currentUserId = null
    logger.log('StoreManager', '用户已登出')
  }

  /**
   * 获取当前用户的 Store
   */
  getCurrentStore(): Store<UserState> | null {
    return this.currentUserId ? (this.stores.get(this.currentUserId) ?? null) : null
  }

  /**
   * 清理所有 Store
   */
  clearAll(): void {
    this.stores.forEach((store) => store.destroy())
    this.stores.clear()
    this.currentUserId = null
  }

  /**
   * LRU 清理最早的 Store
   */
  private cleanupOldestStore(excludeUserId: string): void {
    if (this.stores.size < this.maxStores) return

    // 跳过排除用户与当前活跃用户找到最久未使用的 Store：
    // - 若 LRU 头部恰好是排除用户时不清理，会导致 stores 超限，需继续向后查找
    // - currentUserId 的 store 被淘汰会让 getCurrentStore() 返回 null、
    //   页面订阅被 destroy 静默清除，因此也必须排除
    let oldestKey: string | undefined
    for (const key of this.stores.keys()) {
      if (key !== excludeUserId && key !== this.currentUserId) {
        oldestKey = key
        break
      }
    }

    if (oldestKey) {
      this.stores.get(oldestKey)?.destroy()
      this.stores.delete(oldestKey)
      logger.log('StoreManager', `清理旧用户 store: ${oldestKey}`)
    }
  }
}

/**
 * 全局默认 StoreManager 实例（单账号或需复用缓存的场景可直接使用）
 */
export const storeManager = new StoreManager()
