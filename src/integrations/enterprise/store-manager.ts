/**
 * GeomStore - 微信小程序企业级方案：Store 管理器（账号切换 / LRU 清理）
 *
 * 自 wechat-enterprise.ts 拆出。
 */

import type { Store } from '../../types/store.js'
import { createUserStore, isValidUserId, userStoreKey, type UserState } from './user-store.js'
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
    // 容量必须是正整数：0/负数/NaN/非整数都会让 `stores.size < maxStores` 恒为 false，
    // 于是每次插入都尝试淘汰、又因「唯一候选是当前用户」每次都判定超出上限并告警，
    // 实际容量退化成 1~2 个而契约文档写的是调用方给的值——静默失真比报错更糟。
    // 不在构造期抛错：宿主把配置项写错不该让 Store 管理器整体不可用，
    // 但必须留痕并按最小的合法容量（1）执行
    this.maxStores = Number.isInteger(maxStores) && maxStores >= 1 ? maxStores : 1
    if (this.maxStores !== maxStores) {
      logger.warn('StoreManager', `maxStores 非法（${maxStores}），已按最小合法值 1 执行`)
    }
  }

  /**
   * 获取或创建用户 Store
   *
   * 只负责「取/建某账号的 store」，**不改变当前登录身份**。
   * 此前未命中分支会顺带写 this.currentUserId，而命中分支不会——同一调用的身份
   * 副作用取决于 LRU 淘汰状态这一调用方不可见的实现细节；只读预览另一账号
   * （getUserStore('B')）会静默把身份切成 B，随后 logout() 清的是 B 的数据。
   * 身份切换与冷启动恢复一律走 switchUser 显式表达。
   *
   * userId 的合法性在**触碰注册表之前**判定：未命中分支会先做 LRU 淘汰再创建 store，
   * 校验晚于淘汰时，一次非法 userId（空/纯空白）的调用会在 createUserStore 抛错前
   * 销毁一个无关账号的活跃 store（其页面订阅与组合 store 的失效回调被静默解除），
   * 而抛错后注册表里也没有任何新条目——非法输入白换一个合法账号的实例，
   * 调用方只看到一句「userId 不能为空」，看不出代价落在别人身上
   */
  getUserStore(userId: string): Store<UserState> {
    // 与 createUserStore 同源判定（isValidUserId），错误文案保留 `userId 不能为空` 子串：
    // 调用方与既有用例按该子串匹配，改措辞等于改异常契约
    if (!isValidUserId(userId)) {
      throw new Error('[StoreManager] userId 不能为空')
    }

    const existingStore = this.stores.get(userId)
    if (existingStore) {
      // 命中即刷新插入顺序：Map 迭代序即淘汰顺序，不刷新则高频使用的账号
      // 会被当作最旧淘汰（FIFO 而非注释宣称的 LRU）
      this.stores.delete(userId)
      this.stores.set(userId, existingStore)
      return existingStore
    }

    this.cleanupOldestStore()

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
    // 身份变更必须落盘：logout 会 remove CURRENT_USER_KEY，冷启动
    // （createEnterpriseApp）也只读该键恢复身份。此前持久化只发生在示例 login
    // 路径里，StoreManager 的直接调用方换号后 storage 仍指向上一个账号，
    // 下次冷启动恢复错误身份。getUserStore 的只读预览不写此键（不改身份）
    storage.set(CURRENT_USER_KEY, userId)
    logger.log('StoreManager', `切换到用户: ${userId}`)
    return newStore
  }

  /**
   * 登出当前用户
   * 持久化键经 userStoreKey 派生，与 createUserStore 写入的键同源
   *
   * 清理范围**只到本账号的 Store 持久化键与身份键**：该账号的离线队列键与死信键由
   * `OfflineManager` 持有（键按其 store name 派生），在 `createEnterpriseApp` 的
   * `logout()` 里随 `clearQueue()` / `clearDeadLetters()` 一并清除。这里不去删它们：
   * 本类不持有 OfflineManager 引用，硬编码 `offline_action_queue_` 前缀就等于把
   * 「两处各自硬编码字面量、任一侧改动清不掉数据」的老风险再复制一遍
   */
  logout(): void {
    // currentUserId 只有两种取值：null（未登录）或 createUserStore 入口校验过的非空串
    // （空/纯空白 userId 在 getUserStore/switchUser 处即抛错，写不进本字段），
    // 故此处真值判定等价于 `=== null`
    if (!this.currentUserId) return

    const userId = this.currentUserId
    const store = this.stores.get(userId)
    // destroy 与持久化清理各自兜底：destroy 会 flush 防抖中的待写入，那里抛错
    // 不该让后续的键清理与身份重置一起被跳过——那会留下「内存已登出、
    // 存储还留着账号数据与身份」的半登出状态，下次冷启动直接复活该账号
    try {
      store?.destroy()
    } catch (error) {
      logger.error('StoreManager', `销毁 store 失败，继续清理持久化数据: ${userId}`, error)
    }
    this.stores.delete(userId)

    // 返回值必须核验（env.storage.remove 的布尔结果正是为此而存在）：
    // 平台拒绝删除时内存已报「已登出」，而 user-store-<id> 与 current_user_id
    // 仍在磁盘上，冷启动会恢复用户刚刚登出的身份
    const storeKeyRemoved = storage.remove(userStoreKey(userId))
    const currentKeyRemoved = storage.remove(CURRENT_USER_KEY)
    if (!storeKeyRemoved || !currentKeyRemoved) {
      logger.error('StoreManager', `登出的持久化清理未被平台接受，账号数据与身份键可能残留: ${userId}`)
    }

    this.currentUserId = null
    logger.log('StoreManager', '用户已登出')
  }

  /**
   * 获取当前用户的 Store
   *
   * 真值判定与 logout 同源：currentUserId 不会是空串（见 logout 注释）
   */
  getCurrentStore(): Store<UserState> | null {
    return this.currentUserId ? (this.stores.get(this.currentUserId) ?? null) : null
  }

  /**
   * 清理所有 Store 实例与当前身份标记 —— 不删除各账号的持久化数据（#342）
   *
   * 与 logout 的差别是刻意的：本方法面向「测试重置 / 宿主整体换号」这类
   * 需要立刻回收全部实例的场景，而调用方无法指定「哪些账号的数据该被删除」；
   * 在这里连带删除所有 `user-store-*` 键会把无法归零的数据一次抹掉，
   * 风险远高于收益。需要真正清除某账号持久化数据请显式走 `logout()`（当前用户），
   * 或按该账号 store 的 `name` 自行删键：持久化键即 store name，而 `user-store-` 前缀
   * 是对外契约（见 user-store.ts 的 `USER_STORE_PREFIX` 与 `createUserStore` 的 name/key
   * 同源写法）。派生函数 `userStoreKey()` **不在公开导出面上**（`enterprise/index.ts`
   * 与 `integrations/index.ts` 的具名清单都没带它），照它写代码的宿主只能硬编码前缀
   *
   * `CURRENT_USER_KEY` 则一并移除：它是身份/会话标记而非账号数据，与
   * `currentUserId = null` 属于同一次「清理」。留着它会让内存报「无当前用户」
   * 而下一次冷启动（createEnterpriseApp → switchUser）把身份指回最后一个登录账号，
   * 调用方以为已经结束的会话被静默复活。需要跨 clearAll 保留身份的场景，
   * 请在调用后自行 `storage.set(CURRENT_USER_KEY, userId)` 写回
   */
  clearAll(): void {
    this.stores.forEach((store) => store.destroy())
    this.stores.clear()
    this.currentUserId = null
    if (!storage.remove(CURRENT_USER_KEY)) {
      logger.error('StoreManager', '清理当前身份标记未被平台接受，冷启动可能恢复上一个账号的身份')
    }
  }

  /**
   * LRU 清理最早的 Store
   */
  private cleanupOldestStore(): void {
    if (this.stores.size < this.maxStores) return

    // Map 迭代序即淘汰序，从头找第一个非当前用户的 store。
    // 此前的 excludeUserId 参数是死代码（唯一调用点在 stores.get(userId) 未命中
    // 分支，待建 userId 必不在 map 中），已移除。
    // currentUserId 必须排除：其 store 被淘汰会让 getCurrentStore() 返回 null、
    // 页面订阅被 destroy 静默清除
    let oldestKey: string | undefined
    for (const key of this.stores.keys()) {
      if (key !== this.currentUserId) {
        oldestKey = key
        break
      }
    }

    if (!oldestKey) {
      // 候选只剩当前用户（maxStores=1 且身份活跃时的每次新插入）：
      // 强行淘汰会破坏身份语义，只能接受 stores 暂时超出上限 1 个——
      // 但这打破了容量契约，必须告警而非静默
      logger.warn('StoreManager', `无可淘汰的旧 store，store 数将超出上限 ${this.maxStores}（当前用户的 store 不可被淘汰）`)
      return
    }

    this.stores.get(oldestKey)?.destroy()
    this.stores.delete(oldestKey)
    logger.log('StoreManager', `清理旧用户 store: ${oldestKey}`)
  }
}

/**
 * 全局默认 StoreManager 实例（单账号或需复用缓存的场景可直接使用）
 */
export const storeManager = new StoreManager()
