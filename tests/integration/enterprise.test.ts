/**
 * GeomStore v1.0.0 - 企业级方案集成测试
 *
 * 测试内容：
 * - 多账号隔离 Store
 * - StoreManager 账号切换
 * - 热更新状态恢复
 * - 离线操作队列
 * - 后台/前台状态同步
 */

import { createStore } from '../../src/index.js'
import {
  createUserStore,
  storeManager,
  StoreManager,
  OfflineManager,
  restoreFromHotUpdate,
  initHotUpdate,
  initBackgroundSync,
  unregisterBackgroundSync,
  createEnterpriseApp,
  OfflineAction,
} from '../../src/integrations/enterprise/wechat-enterprise.js'

// ==================== Mock 微信小程序 API ====================

const mockStorage: Record<string, any> = {}
const mockNetworkListeners: Array<(res: { isConnected: boolean; networkType: string }) => void> = []
const mockUpdateListeners: {
  onReady?: () => void
  onFailed?: () => void
} = {}

// Mock wx 对象
const mockWx = {
  setStorageSync: jest.fn((key: string, value: any) => {
    mockStorage[key] = value
  }),
  getStorageSync: jest.fn((key: string) => mockStorage[key]),
  removeStorageSync: jest.fn((key: string) => {
    delete mockStorage[key]
  }),
  onNetworkStatusChange: jest.fn((callback: any) => {
    mockNetworkListeners.push(callback)
  }),
  getNetworkType: jest.fn((options: { success: (res: any) => void }) => {
    options.success({ networkType: 'wifi' })
  }),
  getUpdateManager: jest.fn(() => ({
    onUpdateReady: jest.fn((callback: () => void) => {
      mockUpdateListeners.onReady = callback
    }),
    onUpdateFailed: jest.fn((callback: () => void) => {
      mockUpdateListeners.onFailed = callback
    }),
    applyUpdate: jest.fn(),
  })),
  request: jest.fn(),
  showModal: jest.fn(),
  showToast: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
}

// 设置全局 wx mock
;(global as any).wx = mockWx

// ==================== 测试 ====================

describe('企业级方案 - 多账号隔离', () => {
  beforeEach(() => {
    // 清空存储
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    // 重置 storeManager
    storeManager.clearAll()
    // 清空网络监听器
    mockNetworkListeners.length = 0
    // 清空更新监听器
    mockUpdateListeners.onReady = undefined
    mockUpdateListeners.onFailed = undefined
    // 重置 mock 调用记录
    jest.clearAllMocks()
  })

  describe('createUserStore', () => {
    it('ENTERPRISE-001: 应该创建用户隔离的 Store', () => {
      const store = createUserStore({ userId: 'user-001' })

      expect(store.name).toBe('user-store-user-001')
      expect(store.state.userInfo).toBeNull()
      expect(store.state.preferences).toEqual({})
    })

    it('ENTERPRISE-002: 应该支持初始状态', () => {
      const store = createUserStore({
        userId: 'user-002',
        initialState: {
          userInfo: { name: 'Test User' },
          preferences: { theme: 'dark' },
        },
      })

      expect(store.state.userInfo).toEqual({ name: 'Test User' })
      expect(store.state.preferences).toEqual({ theme: 'dark' })
    })

    it('ENTERPRISE-003: setUserInfo action 应该更新用户信息', () => {
      const store = createUserStore({ userId: 'user-003' })

      store.dispatch('setUserInfo', { id: 1, name: 'John' })

      expect(store.state.userInfo).toEqual({ id: 1, name: 'John' })
      expect(store.state.lastSyncTime).toBeGreaterThan(0)
    })

    it('ENTERPRISE-004: updatePreferences action 应该更新偏好设置', () => {
      const store = createUserStore({ userId: 'user-004' })

      store.dispatch('updatePreferences', 'theme', 'light')
      store.dispatch('updatePreferences', 'language', 'en')

      expect(store.state.preferences).toEqual({
        theme: 'light',
        language: 'en',
      })
    })

    it('ENTERPRISE-005: 不同用户的 Store 应该隔离', () => {
      const store1 = createUserStore({ userId: 'user-005a' })
      const store2 = createUserStore({ userId: 'user-005b' })

      store1.dispatch('setUserInfo', { name: 'User A' })
      store2.dispatch('setUserInfo', { name: 'User B' })

      expect(store1.state.userInfo).toEqual({ name: 'User A' })
      expect(store2.state.userInfo).toEqual({ name: 'User B' })
    })
  })

  describe('StoreManager', () => {
    it('ENTERPRISE-006: 应该获取或创建用户 Store', () => {
      const store = storeManager.getUserStore('user-006')

      expect(store.name).toBe('user-store-user-006')
    })

    it('ENTERPRISE-007: 相同用户应该返回同一个 Store 实例', () => {
      const store1 = storeManager.getUserStore('user-007')
      const store2 = storeManager.getUserStore('user-007')

      expect(store1).toBe(store2)
    })

    it('ENTERPRISE-008: 切换用户应该返回新用户的 Store', () => {
      const store1 = storeManager.switchUser('user-008a')
      store1.dispatch('setUserInfo', { name: 'User A' })

      const store2 = storeManager.switchUser('user-008b')

      expect(store2.name).toBe('user-store-user-008b')
      expect(store2.state.userInfo).toBeNull()
    })

    it('ENTERPRISE-009: 超过最大 Store 数量时应该清理最早的', () => {
      const stores: any[] = []
      for (let i = 0; i < 6; i++) {
        stores.push(storeManager.getUserStore(`user-009-${i}`))
      }

      // 第一个 store 应该被清理
      expect(storeManager.getUserStore('user-009-0')).not.toBe(stores[0])
    })

    it('ENTERPRISE-010: logout 应该清理当前用户的 Store', () => {
      const store = storeManager.switchUser('user-010')
      store.dispatch('setUserInfo', { name: 'Test' })

      storeManager.logout()

      expect(storeManager.getCurrentStore()).toBeNull()
      expect(mockStorage['user-store-user-010']).toBeUndefined()
    })

    it('ENTERPRISE-011: getCurrentStore 应该返回当前用户的 Store', () => {
      storeManager.switchUser('user-011')
      const currentStore = storeManager.getCurrentStore()

      expect(currentStore?.name).toBe('user-store-user-011')
    })

    it('ENTERPRISE-012: clearAll 应该清理所有 Store', () => {
      storeManager.getUserStore('user-012a')
      storeManager.getUserStore('user-012b')

      storeManager.clearAll()

      expect(storeManager.getCurrentStore()).toBeNull()
    })

    it('REGR-ENT-004: getUserStore 只读预览另一账号不应切换当前身份', () => {
      storeManager.switchUser('user-A')

      // 只读预览 B（缓存未命中）：修复前未命中分支会顺带写 currentUserId，
      // 而命中分支不会——身份副作用取决于 LRU 淘汰状态这一调用方不可见的实现细节
      const preview = storeManager.getUserStore('user-B')
      expect(preview.name).toBe('user-store-user-B')
      expect(storeManager.getCurrentStore()?.name).toBe('user-store-user-A')

      // 再次预览（此时缓存命中）：两条路径行为必须一致
      storeManager.getUserStore('user-B')
      expect(storeManager.getCurrentStore()?.name).toBe('user-store-user-A')

      // logout 清的必须是真正登录的 A，而非被静默切换到的 B
      storeManager.logout()
      expect(storeManager.getCurrentStore()).toBeNull()
      // B 的 store 未被登出流程牵连销毁
      expect(storeManager.getUserStore('user-B')).toBe(preview)
    })
  })
})

describe('企业级方案 - 离线状态管理', () => {
  let testStore: any
  let offlineManager: OfflineManager

  beforeEach(() => {
    // 清空存储
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    // 清空网络监听器
    mockNetworkListeners.length = 0
    jest.clearAllMocks()

    // 创建测试 Store
    testStore = createStore({
      name: 'offline-test-store',
      state: {
        items: [] as string[],
        syncCount: 0,
      },
      actions: {
        addItem(item: string) {
          (this.state as any).items.push(item)
        },
        syncToServer() {
          (this.state as any).syncCount++
          return Promise.resolve({ success: true })
        },
        failingAction() {
          return Promise.reject(new Error('Network error'))
        },
      },
    })
  })

  describe('OfflineManager 基本功能', () => {
    it('ENTERPRISE-013: 在线时应该直接执行操作', async () => {
      offlineManager = new OfflineManager(testStore)
      // 模拟在线状态
      ;(offlineManager as any).isOnline = true

      const result = await offlineManager.execute('syncToServer', () => Promise.resolve({ data: 'success' }))

      expect(result).toEqual({ data: 'success' })
    })

    it('ENTERPRISE-014: 离线时应该将操作加入队列', async () => {
      offlineManager = new OfflineManager(testStore)
      // 模拟离线状态
      ;(offlineManager as any).isOnline = false

      await offlineManager.execute('addItem', () => Promise.resolve(null), 'item-1')

      expect(offlineManager.getQueueLength()).toBe(1)
    })

    it('ENTERPRISE-015: 网络恢复时应该同步队列', async () => {
      offlineManager = new OfflineManager(testStore)
      // 模拟离线状态
      ;(offlineManager as any).isOnline = false

      // 添加离线操作
      await offlineManager.execute('addItem', () => Promise.resolve(null), 'item-1')
      await offlineManager.execute('addItem', () => Promise.resolve(null), 'item-2')

      expect(offlineManager.getQueueLength()).toBe(2)

      // 触发网络状态变化回调（不要手动设置 isOnline，让回调自己设置）
      // 回调会检查 wasOffline = !this.isOnline = true，然后设置 isOnline = true
      mockNetworkListeners.forEach((cb) => cb({ isConnected: true, networkType: 'wifi' }))

      // 等待异步操作完成
      await new Promise((resolve) => setTimeout(resolve, 100))

      // 队列应该被清空
      expect(offlineManager.getQueueLength()).toBe(0)
    })

    it('ENTERPRISE-016: 队列应该持久化到存储', async () => {
      offlineManager = new OfflineManager(testStore, 'test_offline_queue')
      // 模拟离线状态
      ;(offlineManager as any).isOnline = false

      await offlineManager.execute('addItem', () => Promise.resolve(null), 'item-1')

      // 检查存储
      expect(mockStorage['test_offline_queue']).toBeDefined()
    })

    it('ENTERPRISE-017: 应该从存储加载队列', () => {
      // 预设存储数据
      mockStorage['test_offline_queue_load'] = JSON.stringify([{ id: '1', type: 'addItem', payload: 'item-1', timestamp: Date.now(), retryCount: 0 }])

      offlineManager = new OfflineManager(testStore, 'test_offline_queue_load')

      expect(offlineManager.getQueueLength()).toBe(1)
    })

    it('ENTERPRISE-018: clearQueue 应该清空队列', async () => {
      offlineManager = new OfflineManager(testStore)
      ;(offlineManager as any).isOnline = false

      await offlineManager.execute('addItem', () => Promise.resolve(null), 'item-1')
      offlineManager.clearQueue()

      expect(offlineManager.getQueueLength()).toBe(0)
    })

    it('ENTERPRISE-019: 执行失败时应该加入队列', async () => {
      offlineManager = new OfflineManager(testStore)
      ;(offlineManager as any).isOnline = true

      try {
        await offlineManager.execute('failingAction', () => Promise.reject(new Error('Network error')))
      } catch (error) {
        // 预期的错误
      }

      expect(offlineManager.getQueueLength()).toBe(1)
    })

    it('ENTERPRISE-051: 空队列时 syncQueue 应该直接返回', async () => {
      offlineManager = new OfflineManager(testStore)

      await offlineManager.syncQueue()

      expect(offlineManager.getQueueLength()).toBe(0)
    })

    it('ENTERPRISE-052 (BUG 回归): 未知 action 应该走重试→死信路径而非被当作成功丢弃', async () => {
      mockStorage['ghost_queue'] = JSON.stringify([{ id: '1', type: 'ghostAction', payload: null, timestamp: Date.now(), retryCount: 0 }])
      const onDrop = jest.fn()
      // maxRetryCount=1：首次失败即超过上限，直接进入死信队列
      offlineManager = new OfflineManager(testStore, 'ghost_queue', 1, onDrop)
      offlineManager.clearDeadLetters()

      await offlineManager.syncQueue()

      // 不再被当作成功出队：操作进入死信队列并触发 onDrop，而非无感丢失
      expect(offlineManager.getQueueLength()).toBe(0)
      expect(offlineManager.getDeadLetters()).toHaveLength(1)
      expect(offlineManager.getDeadLetters()[0].type).toBe('ghostAction')
      expect(onDrop).toHaveBeenCalled()
    })

    it('ENTERPRISE-053: 同步失败时应该留在队列并提示', async () => {
      mockStorage['retry_queue'] = JSON.stringify([{ id: '1', type: 'failingAction', payload: null, timestamp: Date.now(), retryCount: 0 }])
      offlineManager = new OfflineManager(testStore, 'retry_queue', 3)

      await offlineManager.syncQueue()

      // 失败后 retryCount=1 < 3，留在队列中
      expect(offlineManager.getQueueLength()).toBe(1)
      expect(mockWx.showToast).toHaveBeenCalled()
    })

    it('ENTERPRISE-054: 重试次数超过限制时应该放弃', async () => {
      mockStorage['abandon_queue'] = JSON.stringify([{ id: '1', type: 'failingAction', payload: null, timestamp: Date.now(), retryCount: 2 }])
      offlineManager = new OfflineManager(testStore, 'abandon_queue', 3)

      await offlineManager.syncQueue()

      expect(offlineManager.getQueueLength()).toBe(0)
      expect(mockWx.showToast).not.toHaveBeenCalled()
    })

    it('ENTERPRISE-066: 死信队列超限时应淘汰最旧条目', () => {
      offlineManager = new OfflineManager(testStore, 'dead_letter_cap_queue', 3)

      // 预设已达上限（500 条）的死信队列
      mockStorage['dead_letter_cap_queue_dead_letter'] = Array.from({ length: 500 }, (_, i) => ({
        id: `id-${i}`,
        type: 'failingAction',
        payload: null,
        timestamp: Date.now(),
        retryCount: 9,
      }))

      // 再追加一条，应淘汰最旧的一条（id-0）
      ;(offlineManager as any).appendDeadLetter({
        id: 'overflow',
        type: 'failingAction',
        payload: null,
        timestamp: Date.now(),
        retryCount: 9,
      })

      const result = offlineManager.getDeadLetters()
      expect(result.length).toBe(500)
      expect(result[0].id).toBe('id-1')
      expect(result[result.length - 1].id).toBe('overflow')
    })

    it('ENTERPRISE-066b (BUG 回归): 同步失败的操作不重复落盘，恢复后不重复执行', async () => {
      mockStorage['dup_queue'] = JSON.stringify([{ id: 'dup-1', type: 'failingAction', payload: null, timestamp: Date.now(), retryCount: 0 }])
      offlineManager = new OfflineManager(testStore, 'dup_queue', 3)

      await offlineManager.syncQueue()

      const persisted = JSON.parse(String(mockStorage['dup_queue']))
      expect(persisted).toHaveLength(1)
      expect(persisted[0].id).toBe('dup-1')
    })

    it('ENTERPRISE-066c (BUG 回归): 死信落盘失败时操作保留在队列中不丢失', async () => {
      mockStorage['dl_fail_queue'] = JSON.stringify([{ id: 'dl-1', type: 'ghostAction', payload: null, timestamp: Date.now(), retryCount: 0 }])
      const onDrop = jest.fn()
      offlineManager = new OfflineManager(testStore, 'dl_fail_queue', 1, onDrop)

      // 模拟死信键写入失败（配额满），普通队列写入照常
      const originalSet = mockWx.setStorageSync.getMockImplementation() as (key: string, value: unknown) => void
      mockWx.setStorageSync.mockImplementation((key: string, value: unknown) => {
        if (key.includes('dead_letter')) {
          throw new Error('storage quota exceeded')
        }
        originalSet(key, value)
      })

      try {
        await offlineManager.syncQueue()
      } finally {
        mockWx.setStorageSync.mockImplementation(originalSet)
      }

      // 死信未落盘：操作必须留队（内存与磁盘都在），且不触发 onDrop
      expect(offlineManager.getQueueLength()).toBe(1)
      expect(JSON.parse(String(mockStorage['dl_fail_queue']))).toHaveLength(1)
      expect(offlineManager.getDeadLetters()).toHaveLength(0)
      expect(onDrop).not.toHaveBeenCalled()
    })

    it('ENTERPRISE-055: 存储值为对象时应该直接加载', () => {
      mockStorage['object_queue'] = [{ id: '1', type: 'addItem', payload: 'x', timestamp: Date.now(), retryCount: 0 }]
      offlineManager = new OfflineManager(testStore, 'object_queue')

      expect(offlineManager.getQueueLength()).toBe(1)
    })

    it('ENTERPRISE-056: 断网时 isOnline 应该为 false', () => {
      (mockWx.getNetworkType as jest.Mock).mockImplementationOnce((options: any) => options.success({ networkType: 'none' }))
      offlineManager = new OfflineManager(testStore)

      expect((offlineManager as any).isOnline).toBe(false)
    })

    it('ENTERPRISE-057: 网络断开回调不应触发同步', () => {
      offlineManager = new OfflineManager(testStore)

      mockNetworkListeners.forEach((cb) => cb({ isConnected: false, networkType: 'none' }))

      expect((offlineManager as any).isOnline).toBe(false)
    })

    it('ENTERPRISE-063: 损坏的队列数据应被清空且不报错', () => {
      mockStorage['broken_queue'] = 'corrupted-data-not-json'
      offlineManager = new OfflineManager(testStore, 'broken_queue')

      expect(offlineManager.getQueueLength()).toBe(0)
      expect(mockStorage['broken_queue']).toBeUndefined()
    })

    it('ENTERPRISE-064: 非数组的队列数据应被清空', () => {
      mockStorage['object_broken_queue'] = JSON.stringify({ id: 'x' })
      offlineManager = new OfflineManager(testStore, 'object_broken_queue')

      expect(offlineManager.getQueueLength()).toBe(0)
      expect(mockStorage['object_broken_queue']).toBeUndefined()
    })

    it('REGR-OFF-001: 默认队列键按 store 名派生，多账号队列互不串扰', async () => {
      const storeA = createStore({ name: 'acct-a', state: { items: [] as string[] } })
      const storeB = createStore({ name: 'acct-b', state: { items: [] as string[] } })
      const managerA = new OfflineManager(storeA)
      const managerB = new OfflineManager(storeB)

      // 修复前：共用固定键会导致账号 A 的离线操作被账号 B 加载/同步
      expect((managerA as any).queueKey).not.toBe((managerB as any).queueKey)
      expect((managerA as any).queueKey).toContain('acct-a')
      expect((managerB as any).queueKey).toContain('acct-b')
      expect((managerA as any).deadLetterKey).not.toBe((managerB as any).deadLetterKey)

      // 各自离线入队互不干扰
      ;(managerA as any).isOnline = false
      ;(managerB as any).isOnline = false
      await managerA.execute('addItem', () => Promise.resolve(null), 'item-a')
      await managerB.execute('addItem', () => Promise.resolve(null), 'item-b')

      expect(managerA.getQueueLength()).toBe(1)
      expect(managerB.getQueueLength()).toBe(1)
    })

    it('REGR-OFF-002: syncQueue 执行期间新入队的操作应保留', async () => {
      // 同步第一个操作期间入队一个新操作（模拟同步进行中用户又触发的离线操作）
      class ConcurrentOfflineManager extends OfflineManager {
        private injected = false

        protected async executeAction(action: OfflineAction): Promise<void> {
          await super.executeAction(action)
          if (!this.injected) {
            this.injected = true
            ;(this as any).enqueue('addItem', 'concurrent-item')
          }
        }
      }

      mockStorage['concurrent_queue'] = JSON.stringify([{ id: '1', type: 'syncToServer', payload: null, timestamp: Date.now(), retryCount: 0 }])
      const manager = new ConcurrentOfflineManager(testStore, 'concurrent_queue')

      await manager.syncQueue()

      // 修复前：同步结束后整体赋值会丢弃同步期间入队的操作
      expect(manager.getQueueLength()).toBe(1)
      expect((manager as any).actionQueue[0].type).toBe('addItem')
      expect((manager as any).actionQueue[0].payload).toBe('concurrent-item')
    })

    it('REGR-OFF-003: 同步进行中入队触发的落盘必须包含未处理旧项（进程被杀不丢队列）', async () => {
      // 第一个操作执行期间：新操作入队会触发 saveQueue。若落盘只写 this.actionQueue，
      // 磁盘会被「仅剩新项」的队列覆写——进程恰在此窗口被杀时未处理旧项永久丢失
      let savedDuringSync: unknown
      class CrashWindowOfflineManager extends OfflineManager {
        protected async executeAction(action: OfflineAction): Promise<void> {
          await super.executeAction(action)
          if (savedDuringSync === undefined) {
            // 模拟同步期间用户触发的离线操作：enqueue → saveQueue 落盘
            void (this as any).enqueue('addItem', 'mid-sync-item')
            savedDuringSync = mockStorage['crash_window_queue']
          }
        }
      }

      mockStorage['crash_window_queue'] = JSON.stringify([
        { id: '1', type: 'syncToServer', payload: null, timestamp: Date.now(), retryCount: 0 },
        { id: '2', type: 'syncToServer', payload: null, timestamp: Date.now(), retryCount: 0 },
      ])
      const manager = new CrashWindowOfflineManager(testStore, 'crash_window_queue')

      await manager.syncQueue()

      expect(savedDuringSync).toBeDefined()
      const persisted = JSON.parse(savedDuringSync as string) as Array<{ id: string; type: string }>
      // 处理完 id=1 后，磁盘上必须仍有 id=2（未处理旧项）与同步期间新增的操作
      expect(persisted.some((a) => a.id === '2')).toBe(true)
      expect(persisted.some((a) => a.type === 'addItem')).toBe(true)
    })

    it('ENTERPRISE-067: dispose 幂等且只移除一次网络监听', () => {
      (mockWx as any).offNetworkStatusChange = jest.fn()
      offlineManager = new OfflineManager(testStore)

      offlineManager.dispose()
      offlineManager.dispose() // 第二次直接 return

      expect((mockWx as any).offNetworkStatusChange).toHaveBeenCalledTimes(1)
      delete (mockWx as any).offNetworkStatusChange
    })

    it('ENTERPRISE-068: networkHandler 为 null 时 dispose 应该安全跳过', () => {
      offlineManager = new OfflineManager(testStore)
      // 模拟 networkHandler 已被外部置空的场景（disposed 仍为 false）
      ;(offlineManager as any).networkHandler = null
      ;(offlineManager as any).disposed = false

      expect(() => offlineManager.dispose()).not.toThrow()
      expect((offlineManager as any).disposed).toBe(true)
    })

    it('ENTERPRISE-069: dispose 后网络回调应该被忽略', () => {
      offlineManager = new OfflineManager(testStore)
      const handler = (offlineManager as any).networkHandler
      ;(offlineManager as any).isOnline = false
      offlineManager.dispose()

      // dispose 后触发网络回调：disposed 守卫直接返回，不更新在线状态
      handler({ isConnected: true, networkType: 'wifi' })

      expect((offlineManager as any).isOnline).toBe(false)
    })

    it('ENTERPRISE-070: dispose 后 getNetworkType 回调不应该更新在线状态', () => {
      let capturedSuccess: ((res: { networkType: string }) => void) | null = null
      const originalGetNetworkType = mockWx.getNetworkType
      mockWx.getNetworkType = jest.fn((options: { success: (res: any) => void }) => {
        capturedSuccess = options.success
      })

      try {
        offlineManager = new OfflineManager(testStore)
        ;(offlineManager as any).isOnline = false
        // 构造完成后 success 回调尚未触发，先 dispose
        offlineManager.dispose()

        // 延迟回调到达时已 dispose，不应更新 isOnline
        capturedSuccess!({ networkType: 'wifi' })

        expect((offlineManager as any).isOnline).toBe(false)
      } finally {
        mockWx.getNetworkType = originalGetNetworkType
      }
    })

    it('REGR-OFF-004 (BUG 回归): 已 dispose 的 manager 在途同步不得覆写同键上新实例的入队', async () => {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let entered = false
      const sharedKey = 'shared_dispose_queue'

      const storeA = createStore({
        name: 'dispose-a',
        state: { done: 0 },
        actions: {
          async slowAction() {
            entered = true
            await gate
            ;(this.state as any).done++
          },
        },
      })

      // 账号 A 的慢操作已在共享键的磁盘队列中
      mockStorage[sharedKey] = JSON.stringify([{ id: 'slow-1', type: 'slowAction', payload: null, timestamp: Date.now(), retryCount: 0 }])
      const managerA = new OfflineManager(storeA, sharedKey)
      const syncingA = managerA.syncQueue()

      // 等慢操作真正进入执行，制造「同步在途」窗口
      for (let i = 0; i < 20 && !entered; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(entered).toBe(true)

      // 登出/切号：A 被释放，同键上的新实例 B 接管并写入自己的操作
      managerA.dispose()

      const storeB = createStore({
        name: 'dispose-b',
        state: { items: [] as string[] },
        actions: {
          addItem(item: string) {
            (this.state as any).items.push(item)
          },
        },
      })
      const managerB = new OfflineManager(storeB, sharedKey)
      ;(managerB as any).isOnline = false
      await managerB.execute('addItem', () => Promise.resolve(null), 'item-b')
      expect(managerB.getQueueLength()).toBe(2)

      release()
      await syncingA

      // 修复前：A 的 finally 无条件 saveQueue，用「A 视角」的队列覆写共享键，
      // B 刚持久化的操作从磁盘消失（B 内存仍有、磁盘没有，重启即丢）
      const persisted = JSON.parse(String(mockStorage[sharedKey])) as Array<{ type: string }>
      expect(persisted.some((action) => action.type === 'addItem')).toBe(true)
      expect(persisted).toHaveLength(managerB.getQueueLength())

      storeA.destroy()
      storeB.destroy()
      managerB.dispose()
    })

    it('REGR-OFF-005 (BUG 回归): dispose 应停止在途同步循环，不再执行剩余操作', async () => {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      let entered = false

      const store = createStore({
        name: 'dispose-loop-store',
        state: { done: 0 },
        actions: {
          async slowAction() {
            entered = true
            await gate
            ;(this.state as any).done++
          },
        },
      })

      mockStorage['dispose_loop_queue'] = JSON.stringify([
        { id: '1', type: 'slowAction', payload: null, timestamp: Date.now(), retryCount: 0 },
        { id: '2', type: 'slowAction', payload: null, timestamp: Date.now(), retryCount: 0 },
      ])
      const manager = new OfflineManager(store, 'dispose_loop_queue')
      const syncing = manager.syncQueue()

      for (let i = 0; i < 20 && !entered; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      expect(entered).toBe(true)

      manager.dispose()
      release()
      await syncing

      // 修复前：dispose 只摘除网络监听，循环继续把第 2 个操作也执行完
      expect(store.state.done).toBe(1)
      // 未执行项保持原样留在磁盘（未被已释放实例的视角覆写）
      const persisted = JSON.parse(String(mockStorage['dispose_loop_queue'])) as Array<{ id: string }>
      expect(persisted.map((action) => action.id)).toEqual(['1', '2'])

      store.destroy()
    })

    it('REGR-OFF-006 (BUG 回归): 队列中的损坏条目应被丢弃，其余操作继续同步', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      mockStorage['malformed_queue'] = JSON.stringify([
        { id: '1', type: 'syncToServer', payload: null, timestamp: Date.now(), retryCount: 0 },
        null,
        'not-an-action',
        { id: '4', type: 'addItem' },
        { id: '5', type: 'addItem', payload: 'ok', timestamp: Date.now(), retryCount: 0 },
      ])

      try {
        offlineManager = new OfflineManager(testStore, 'malformed_queue')

        // 损坏条目（null / 字符串 / 缺 retryCount）在加载时被丢弃，合法条目保留
        expect(offlineManager.getQueueLength()).toBe(2)

        // 修复前：null 条目令 retryCount++ 抛 TypeError，整个 syncQueue 拒绝，
        // 后续所有合法操作永久得不到同步
        await offlineManager.syncQueue()

        expect(testStore.state.syncCount).toBe(1)
        expect(testStore.state.items).toEqual(['ok'])
        expect(warnSpy.mock.calls.some((call) => String(call[0]).includes('损坏'))).toBe(true)
        // 清理后的队列已落盘（不再包含损坏条目）
        expect(JSON.parse(String(mockStorage['malformed_queue']))).toEqual([])
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('REGR-OFF-008: 队列全部损坏时直接删除存储键而非留下空数组', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      mockStorage['all_broken_queue'] = JSON.stringify([null, 'not-an-action', { id: 'x' }])

      try {
        offlineManager = new OfflineManager(testStore, 'all_broken_queue')

        expect(offlineManager.getQueueLength()).toBe(0)
        // 全部损坏：删除键，避免磁盘上长期留着无意义的空队列
        expect(mockStorage['all_broken_queue']).toBeUndefined()
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('REGR-OFF-007 (BUG 回归): 内存中混入损坏条目时 syncQueue 仍应处理其余操作', async () => {
      offlineManager = new OfflineManager(testStore, 'in_memory_malformed_queue')
      // 绕过 loadQueue 直接注入损坏条目（如运行期外部替换数组），
      // 验证 retryCount++ 路径自身也有防护
      ;(offlineManager as any).actionQueue = [null, { id: 'ok', type: 'syncToServer', payload: null, timestamp: Date.now(), retryCount: 0 }]

      // 修复前：null 条目的 retryCount++ 抛 TypeError，整个 syncQueue 拒绝
      await expect(offlineManager.syncQueue()).resolves.toBeUndefined()

      expect(testStore.state.syncCount).toBe(1)
      expect(offlineManager.getQueueLength()).toBe(0)
    })
  })
})

describe('企业级方案 - 热更新状态恢复', () => {
  let testStore: any

  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    jest.clearAllMocks()

    testStore = createStore({
      name: 'hot-update-test-store',
      state: {
        userData: { name: 'Test User', score: 100 },
        settings: { theme: 'dark' },
      },
    })
  })

  describe('restoreFromHotUpdate', () => {
    it('ENTERPRISE-020: 没有备份时应该返回 false', () => {
      const result = restoreFromHotUpdate(testStore)

      expect(result).toBe(false)
    })

    it('ENTERPRISE-021: 有有效备份时应该恢复状态', () => {
      // 设置备份数据 - state 格式应该与 $snapshot() 返回的一致
      const backupData = {
        timestamp: Date.now() - 1000 * 60 * 30, // 30分钟前
        state: { userData: { name: 'Restored User', score: 200 }, settings: { theme: 'light' } },
        version: '1.0.0',
      }
      mockStorage['store_backup_before_update_hot-update-test-store'] = JSON.stringify(backupData)
      // 更新确认后的首启：待更新重启标记存在
      mockStorage['store_backup_before_update_hot-update-test-store__pending_update_launch'] = JSON.stringify(true)

      const result = restoreFromHotUpdate(testStore)

      expect(result).toBe(true)
      // 验证状态已恢复
      expect(testStore.state.userData).toEqual({ name: 'Restored User', score: 200 })
      expect(testStore.state.settings).toEqual({ theme: 'light' })
    })

    it('ENTERPRISE-022: 备份超过1小时应该被忽略', () => {
      // 设置过期的备份数据
      const backupData = {
        timestamp: Date.now() - 1000 * 60 * 70, // 70分钟前（超过1小时）
        state: { userData: { name: 'Old User', score: 50 }, settings: { theme: 'old' } },
        version: '1.0.0',
      }
      mockStorage['store_backup_before_update_hot-update-test-store'] = JSON.stringify(backupData)

      const result = restoreFromHotUpdate(testStore)

      expect(result).toBe(false)
      expect(mockStorage['store_backup_before_update_hot-update-test-store']).toBeUndefined()
    })

    it('ENTERPRISE-023: 恢复后应该删除备份', () => {
      const backupData = {
        timestamp: Date.now() - 1000 * 60 * 5, // 5分钟前
        state: { userData: { name: 'Test', score: 100 }, settings: { theme: 'dark' } },
        version: '1.0.0',
      }
      mockStorage['store_backup_before_update_hot-update-test-store'] = JSON.stringify(backupData)
      mockStorage['store_backup_before_update_hot-update-test-store__pending_update_launch'] = JSON.stringify(true)

      restoreFromHotUpdate(testStore)

      expect(mockStorage['store_backup_before_update_hot-update-test-store']).toBeUndefined()
      expect(mockStorage['store_backup_before_update_hot-update-test-store__pending_update_launch']).toBeUndefined()
    })

    it('ENTERPRISE-024: 应该支持自定义备份 key', () => {
      const backupData = {
        timestamp: Date.now() - 1000,
        state: { userData: { name: 'Test', score: 100 }, settings: { theme: 'dark' } },
        version: '1.0.0',
      }
      mockStorage['custom_backup_key'] = JSON.stringify(backupData)
      mockStorage['custom_backup_key__pending_update_launch'] = JSON.stringify(true)

      const result = restoreFromHotUpdate(testStore, 'custom_backup_key')

      expect(result).toBe(true)
    })

    it('ENTERPRISE-055 (BUG 回归): 拒绝更新后的普通重启不应回滚状态', () => {
      // 备份存在（onUpdateReady 时写入）但用户拒绝了更新、也未写入重启标记
      const backupData = {
        timestamp: Date.now() - 1000 * 60 * 5,
        state: { userData: { name: 'Backup Point', score: 1 }, settings: { theme: 'dark' } },
        version: '1.0.0',
      }
      mockStorage['store_backup_before_update_hot-update-test-store'] = JSON.stringify(backupData)
      testStore.$patch({ userData: { name: 'After Decline', score: 99 } })

      const result = restoreFromHotUpdate(testStore)

      // 修复前：普通重启也会恢复备份，备份点之后的变更被静默回滚
      expect(result).toBe(false)
      expect(testStore.state.userData).toEqual({ name: 'After Decline', score: 99 })
    })

    it('ENTERPRISE-025: 损坏的备份数据应该返回 false', () => {
      mockStorage['store_backup_before_update_hot-update-test-store'] = 'invalid json'

      const result = restoreFromHotUpdate(testStore)

      expect(result).toBe(false)
    })

    it('ENTERPRISE-025b: wx.getStorageSync 抛错时 storage.get 降级返回 null', () => {
      (mockWx.getStorageSync as jest.Mock).mockImplementationOnce(() => {
        throw new Error('storage boom')
      })

      const result = restoreFromHotUpdate(testStore)

      // 存储读取失败按"无备份"处理：返回 false（不抛错）
      expect(result).toBe(false)
    })

    it('REGR-ENT-001: 恢复应保留新版本新增的 state 键（合并语义）', () => {
      const backupKey = 'store_backup_before_update_hot-update-test-store'
      // 备份取自旧版本：没有 settings，也没有新版本的 newFeature
      mockStorage[backupKey] = JSON.stringify({
        timestamp: Date.now(),
        state: { userData: { name: 'Old User', score: 1 } },
        version: '1.0.0',
      })
      mockStorage[`${backupKey}__pending_update_launch`] = JSON.stringify(true)

      const newVersionStore = createStore({
        name: 'hot-update-test-store',
        state: {
          userData: { name: 'Init', score: 0 },
          settings: { theme: 'dark' },
          newFeature: { enabled: true },
        },
      })

      const result = restoreFromHotUpdate(newVersionStore)

      expect(result).toBe(true)
      expect(newVersionStore.state.userData).toEqual({ name: 'Old User', score: 1 })
      // 修复前用 $restore（= $replaceState 整树替换）：新版本新增/未备份的键被整体抹掉，
      // 新代码读 newFeature.enabled 即得 undefined
      expect(newVersionStore.state.settings).toEqual({ theme: 'dark' })
      expect(newVersionStore.state.newFeature).toEqual({ enabled: true })
    })

    it('REGR-ENT-002: 备份 state 非纯对象时应返回 false 并清理，不得静默成功', () => {
      const backupKey = 'store_backup_before_update_hot-update-test-store'
      mockStorage[backupKey] = JSON.stringify({
        timestamp: Date.now(),
        state: [1, 2, 3],
        version: '1.0.0',
      })
      mockStorage[`${backupKey}__pending_update_launch`] = JSON.stringify(true)

      const result = restoreFromHotUpdate(testStore)

      // $patch 走 deepMerge，而 deepMerge 对数组会静默跳过合并却仍算成功；
      // 无预校验时损坏备份会被当成「已恢复」删掉，状态却原封不动
      expect(result).toBe(false)
      expect(testStore.state.userData).toEqual({ name: 'Test User', score: 100 })
      // 结构性损坏永久不可重试，按过期路径同口径清理两个键
      expect(mockStorage[backupKey]).toBeUndefined()
      expect(mockStorage[`${backupKey}__pending_update_launch`]).toBeUndefined()
    })

    it('REGR-ENT-003: 备份版本与库版本不一致时应告警但仍按合并语义恢复', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const backupKey = 'store_backup_before_update_hot-update-test-store'
      mockStorage[backupKey] = JSON.stringify({
        timestamp: Date.now(),
        state: { userData: { name: 'Legacy', score: 7 } },
        version: '0.9.0',
      })
      mockStorage[`${backupKey}__pending_update_launch`] = JSON.stringify(true)

      const result = restoreFromHotUpdate(testStore)

      // version 是本库版本常量而非宿主 app 版本：硬门禁会在库升级时白丢用户数据，
      // 合并语义本身已能容忍结构漂移，故只告警不拦截
      expect(result).toBe(true)
      expect(testStore.state.userData).toEqual({ name: 'Legacy', score: 7 })
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('不一致'))
      warnSpy.mockRestore()
    })
  })
})

describe('企业级方案 - StoreManager 完整场景', () => {
  let manager: StoreManager

  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    manager = new StoreManager()
  })

  it('ENTERPRISE-026: 用户登录登出完整流程', () => {
    // 用户登录
    const store = manager.switchUser('user-login-test')
    expect(store.name).toBe('user-store-user-login-test')
    expect(manager.getCurrentStore()).toBe(store)

    // 用户操作
    store.dispatch('setUserInfo', { id: 1, name: 'Test User' })
    expect(store.state.userInfo).toEqual({ id: 1, name: 'Test User' })

    // 用户登出
    manager.logout()
    expect(manager.getCurrentStore()).toBeNull()
  })

  it('ENTERPRISE-027: 多用户切换场景', () => {
    // 用户A登录
    const storeA = manager.switchUser('user-a')
    storeA.dispatch('setUserInfo', { name: 'User A' })

    // 切换到用户B
    const storeB = manager.switchUser('user-b')
    storeB.dispatch('setUserInfo', { name: 'User B' })

    // 用户A的数据应该保留
    expect(storeA.state.userInfo).toEqual({ name: 'User A' })

    // 切换回用户A
    const storeAAgain = manager.switchUser('user-a')
    expect(storeAAgain).toBe(storeA)
    expect(storeAAgain.state.userInfo).toEqual({ name: 'User A' })
  })

  it('ENTERPRISE-028 (BUG 回归): LRU 清理场景——驱逐时防抖写入已落盘，新实例可恢复', () => {
    // 创建 6 个用户（超过默认限制 5）
    const stores: any[] = []
    for (let i = 0; i < 6; i++) {
      stores.push(manager.getUserStore(`user-lru-${i}`))
      stores[i].dispatch('setUserInfo', { index: i })
    }

    // 第一个用户应该被清理（防抖窗口内的最后写入在驱逐卸载时同步落盘）
    // 再次获取第一个用户会创建新实例，并从持久化存储恢复数据
    const newUser0 = manager.getUserStore('user-lru-0')
    expect(newUser0).not.toBe(stores[0])
    // 修复前：卸载丢弃防抖写入 → storage 无数据 → 恢复为 null（丢最后一次变更）
    expect(newUser0.state.userInfo).toEqual({ index: 0 })
  })

  it('ENTERPRISE-058: maxStores 为 0 时不应该抛错', () => {
    const zeroManager = new StoreManager(0)

    expect(() => zeroManager.getUserStore('zero-user')).not.toThrow()
    expect(zeroManager.getUserStore('zero-user')).toBeDefined()
  })

  it('ENTERPRISE-059: 幽灵用户 ID 时 getCurrentStore 应该返回 null', () => {
    (manager as any).currentUserId = 'ghost-user'

    expect(manager.getCurrentStore()).toBeNull()
  })
})

describe('企业级方案 - 并发与边界情况', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    storeManager.clearAll()
  })

  it('ENTERPRISE-029: 并发创建相同用户的 Store', async () => {
    // 并发获取同一个用户的 Store
    const [store1, store2, store3] = await Promise.all([
      Promise.resolve(storeManager.getUserStore('concurrent-user')),
      Promise.resolve(storeManager.getUserStore('concurrent-user')),
      Promise.resolve(storeManager.getUserStore('concurrent-user')),
    ])

    // 由于是同步操作，应该返回同一个实例
    expect(store1).toBe(store2)
    expect(store2).toBe(store3)
  })

  it('ENTERPRISE-030: logout 无当前用户时不应该报错', () => {
    // 没有登录用户时 logout
    expect(() => storeManager.logout()).not.toThrow()
  })

  it('ENTERPRISE-031 (#337 行为变更): 空用户ID 在入口抛错而非生成畸形键', () => {
    // 旧断言固化了 getUserStore('') 产出 `user-store-` 键的行为：
    // 该键会让所有空/空白账号在 storage 与 Map 上碰撞同一持久化键（跨账号泄漏），
    // createUserStore 入口校验后改为抛错（见 ocr-medium-round4-p1 #337）
    expect(() => storeManager.getUserStore('')).toThrow(/userId 不能为空/)
  })

  it('ENTERPRISE-032: Store 销毁后不应该影响其他 Store', () => {
    const store1 = storeManager.getUserStore('destroy-test-1')
    const store2 = storeManager.getUserStore('destroy-test-2')

    store1.dispatch('setUserInfo', { name: 'User 1' })
    store2.dispatch('setUserInfo', { name: 'User 2' })

    // 销毁 store1
    store1.destroy()

    // store2 不应该受影响
    expect(store2.state.userInfo).toEqual({ name: 'User 2' })
  })
})

describe('企业级方案 - 存储隔离验证', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    storeManager.clearAll()
  })

  it('ENTERPRISE-033: 不同用户的持久化数据应该隔离', () => {
    const store1 = createUserStore({ userId: 'isolation-user-1' })
    const store2 = createUserStore({ userId: 'isolation-user-2' })

    store1.dispatch('updatePreferences', 'theme', 'dark')
    store2.dispatch('updatePreferences', 'theme', 'light')

    // 验证两个 store 的状态是独立的
    expect(store1.state.preferences.theme).toBe('dark')
    expect(store2.state.preferences.theme).toBe('light')
  })

  it('ENTERPRISE-034: 用户登出后存储应该被清理', () => {
    const store = storeManager.switchUser('logout-storage-test')
    store.dispatch('setUserInfo', { name: 'To Be Deleted' })

    // 模拟持久化
    mockStorage['user-store-logout-storage-test'] = JSON.stringify({
      userInfo: { name: 'To Be Deleted' },
    })

    storeManager.logout()

    // 验证存储被清理
    expect(mockStorage['user-store-logout-storage-test']).toBeUndefined()
  })
})

describe('企业级方案 - 网络同步', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    jest.clearAllMocks()
  })

  it('ENTERPRISE-035: syncWithServer 应该从服务器同步用户信息', async () => {
    (mockWx.request as jest.Mock).mockImplementation((options: any) => {
      options.success({ data: { userInfo: { id: 9, name: 'Server User' } } })
    })
    const store = createUserStore({ userId: 'sync-user' })

    await store.dispatch('syncWithServer')

    expect(store.state.userInfo).toEqual({ id: 9, name: 'Server User' })
    expect(store.state.lastSyncTime).toBeGreaterThan(0)
  })

  it('ENTERPRISE-036: syncWithServer 请求失败时应该 reject', async () => {
    (mockWx.request as jest.Mock).mockImplementation((options: any) => {
      options.fail?.(new Error('Network error'))
    })
    const store = createUserStore({ userId: 'sync-user-fail' })

    await expect(store.dispatch('syncWithServer')).rejects.toThrow('Network error')
  })

  it('ENTERPRISE-065: syncWithServer 非 2xx 状态码应该 reject 且不污染状态', async () => {
    (mockWx.request as jest.Mock).mockImplementation((options: any) => {
      options.success({ statusCode: 500, data: { userInfo: null } })
    })
    const store = createUserStore({ userId: 'sync-user-500' })

    await expect(store.dispatch('syncWithServer')).rejects.toThrow('status 500')
    expect(store.state.userInfo).toBeNull()
    expect(store.state.lastSyncTime).toBeNull()
  })

  it('ENTERPRISE-066: 响应缺少 userInfo 时应该 reject 且不写入 undefined', async () => {
    // 修复前 `r.data?.userInfo as UserInfo` 会把 undefined 伪装成 UserInfo 兑现，
    // syncWithServer 随之写入 userInfo: undefined，破坏 UserInfo | null 契约
    (mockWx.request as jest.Mock).mockImplementation((options: any) => {
      options.success({ statusCode: 200, data: {} })
    })
    const store = createUserStore({ userId: 'sync-user-no-payload' })

    await expect(store.dispatch('syncWithServer')).rejects.toThrow(/no userInfo object/)
    expect(store.state.userInfo).toBeNull()
    expect(store.state.lastSyncTime).toBeNull()
  })

  it('ENTERPRISE-050: App 未定义时 initBackgroundSync 应该安全返回', () => {
    // 本 describe 未 mock App（后台/前台 describe 才 mock）
    const store = createUserStore({ userId: 'no-app-user' })
    expect(() => initBackgroundSync({ store })).not.toThrow()
  })
})

describe('企业级方案 - 热更新初始化', () => {
  let testStore: any

  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    mockUpdateListeners.onReady = undefined
    mockUpdateListeners.onFailed = undefined
    jest.clearAllMocks()

    testStore = createStore({
      name: 'hot-update-init-test-store',
      state: { counter: 1 },
    })
  })

  it('ENTERPRISE-037: initHotUpdate 应该注册更新监听器', () => {
    initHotUpdate({ store: testStore })

    expect(mockWx.getUpdateManager).toHaveBeenCalled()
    expect(mockUpdateListeners.onReady).toBeDefined()
    expect(mockUpdateListeners.onFailed).toBeDefined()
  })

  it('ENTERPRISE-038: 更新就绪时弹出确认框，用户确认时才备份状态', () => {
    testStore.$patch({ counter: 42 })
    const onBeforeUpdate = jest.fn()
    initHotUpdate({ store: testStore, onBeforeUpdate })

    mockUpdateListeners.onReady!()

    // 备份必须在用户确认时进行而非 onUpdateReady 时：弹窗期间业务仍在运行
    // 并持续持久化，若备份取自弹窗前，重启恢复会把弹窗期间的持久化变更回滚
    expect(mockWx.showModal).toHaveBeenCalled()
    expect(mockStorage['store_backup_before_update_hot-update-init-test-store']).toBeUndefined()
    expect(onBeforeUpdate).not.toHaveBeenCalled()

    const modalOptions = (mockWx.showModal as jest.Mock).mock.calls[0][0]
    modalOptions.success({ confirm: true })

    // 确认后：备份 + 待更新重启标记 + applyUpdate
    const backup = JSON.parse(mockStorage['store_backup_before_update_hot-update-init-test-store'])
    expect(backup.state).toEqual({ counter: 42 })
    expect(backup.version).toBe('1.0.0')
    expect(mockStorage['store_backup_before_update_hot-update-init-test-store__pending_update_launch']).toBe('true')
    expect(onBeforeUpdate).toHaveBeenCalled()
  })

  it('ENTERPRISE-038b: 用户取消更新时不备份、不写标记、不 applyUpdate', () => {
    testStore.$patch({ counter: 7 })
    initHotUpdate({ store: testStore })

    mockUpdateListeners.onReady!()
    const modalOptions = (mockWx.showModal as jest.Mock).mock.calls[0][0]
    modalOptions.success({ confirm: false })

    expect(mockStorage['store_backup_before_update_hot-update-init-test-store']).toBeUndefined()
    expect(mockStorage['store_backup_before_update_hot-update-init-test-store__pending_update_launch']).toBeUndefined()
    const updateManager = (mockWx.getUpdateManager as jest.Mock).mock.results[0].value
    expect(updateManager.applyUpdate).not.toHaveBeenCalled()
  })

  it('ENTERPRISE-039: 用户确认后应该调用 applyUpdate', () => {
    initHotUpdate({ store: testStore })

    mockUpdateListeners.onReady!()

    const modalOptions = (mockWx.showModal as jest.Mock).mock.calls[0][0]
    modalOptions.success({ confirm: true })

    const updateManager = (mockWx.getUpdateManager as jest.Mock).mock.results[0].value
    expect(updateManager.applyUpdate).toHaveBeenCalled()
  })

  it('ENTERPRISE-040: 用户取消时不应该调用 applyUpdate', () => {
    initHotUpdate({ store: testStore })

    mockUpdateListeners.onReady!()

    const modalOptions = (mockWx.showModal as jest.Mock).mock.calls[0][0]
    modalOptions.success({ confirm: false })

    const updateManager = (mockWx.getUpdateManager as jest.Mock).mock.results[0].value
    expect(updateManager.applyUpdate).not.toHaveBeenCalled()
  })

  it('ENTERPRISE-041: 更新失败时应该提示', () => {
    initHotUpdate({ store: testStore })

    mockUpdateListeners.onFailed!()

    expect(mockWx.showToast).toHaveBeenCalledWith({ title: '更新失败，请重试', icon: 'none' })
  })

  it('ENTERPRISE-041b: 更新失败时应清理标记与备份（防残留标记回滚普通重启）', () => {
    testStore.$patch({ counter: 9 })
    initHotUpdate({ store: testStore })

    // 走到确认更新：备份与标记已写入
    mockUpdateListeners.onReady!()
    const modalOptions = (mockWx.showModal as jest.Mock).mock.calls[0][0]
    modalOptions.success({ confirm: true })
    expect(mockStorage['store_backup_before_update_hot-update-init-test-store']).toBeDefined()

    // 基础库应用更新失败：不清清理会让之后的普通冷启动被误判为「更新后首启」，
    // 把用户继续使用期间的持久化变更回滚到旧备份点
    mockUpdateListeners.onFailed!()

    expect(mockStorage['store_backup_before_update_hot-update-init-test-store']).toBeUndefined()
    expect(mockStorage['store_backup_before_update_hot-update-init-test-store__pending_update_launch']).toBeUndefined()
  })
})

describe('企业级方案 - 后台/前台状态同步', () => {
  const originalApp = (global as any).App
  let testStore: any
  // 捕获 App(options) 接收的 options，供测试触发生命周期回调
  let appOptions: Record<string, any> | null = null

  // 模拟微信小程序全局 App 构造器（函数形式，用户回调通过 options 注册）
  const mockApp = (options: Record<string, any> = {}) => {
    appOptions = options
    return options
  }

  beforeAll(() => {
    (global as any).App = mockApp
  })

  afterAll(() => {
    (global as any).App = originalApp
  })

  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    jest.clearAllMocks()
    // 重置全局 App 为原始 mock：initBackgroundSync 检测到 App 被外部替换后会重新包装
    // （#355 起不再清空注册表），本 describe 各用例的 store 互不相同，
    // 断言只针对自己创建的实例，残留处理器不影响结果
    ;(global as any).App = mockApp
    appOptions = null

    testStore = createStore({
      name: 'bg-sync-test-store',
      state: { refreshed: 0 },
      actions: {
        refreshData() {
          (this.state as any).refreshed++
        },
      },
    })
  })

  /** 注册 App 并返回包装后的 options（触发 initBackgroundSync 后调用） */
  const registerApp = (options: Record<string, any> = {}): Record<string, any> => {
    (global as any).App(options)
    return appOptions!
  }

  it('ENTERPRISE-042: 非活跃时间过长时应该刷新数据', () => {
    initBackgroundSync({ store: testStore, maxInactiveTime: -1 })

    registerApp().onShow()

    expect(testStore.state.refreshed).toBe(1)
  })

  it('ENTERPRISE-043: 非活跃时间未超过限制时不应该刷新', () => {
    initBackgroundSync({ store: testStore, maxInactiveTime: 100000 })

    registerApp().onShow()

    expect(testStore.state.refreshed).toBe(0)
  })

  it('ENTERPRISE-044: 回调与原始生命周期应该被调用', () => {
    const userOnShow = jest.fn()
    const userOnHide = jest.fn()
    const onForeground = jest.fn()
    const onBackground = jest.fn()
    initBackgroundSync({ store: testStore, maxInactiveTime: -1, onForeground, onBackground })

    const options = registerApp({ onShow: userOnShow, onHide: userOnHide })
    options.onShow()
    expect(onForeground).toHaveBeenCalled()
    expect(userOnShow).toHaveBeenCalled()

    options.onHide()
    expect(onBackground).toHaveBeenCalled()
    expect(userOnHide).toHaveBeenCalled()
  })

  it('ENTERPRISE-060: store 无 refreshData 时 onShow 不应报错', () => {
    const plainStore = createStore({ name: 'no-refresh-store', state: { a: 1 } })
    initBackgroundSync({ store: plainStore, maxInactiveTime: -1 })

    expect(() => registerApp().onShow()).not.toThrow()
  })

  it('ENTERPRISE-061: unregisterBackgroundSync 注销后 onShow 不再刷新', () => {
    initBackgroundSync({ store: testStore, maxInactiveTime: -1 })
    unregisterBackgroundSync(testStore)

    registerApp().onShow()

    expect(testStore.state.refreshed).toBe(0)
  })

  it('ENTERPRISE-062: store 销毁后 onShow 应自清理处理器且不抛错', () => {
    initBackgroundSync({ store: testStore, maxInactiveTime: -1 })
    testStore.destroy()

    const options = registerApp()
    // 残留 handler 指向已销毁 store：onShow 应跳过并清理，而不是 dispatch 抛错
    expect(() => options.onShow()).not.toThrow()
    // 再次触发也不抛错（处理器已被自清理）
    expect(() => options.onShow()).not.toThrow()
  })

  it('ENTERPRISE-068: 快照迭代中处理器已被移除时 indexOf 为 -1 应安全跳过', () => {
    const storeA = createStore({
      name: 'bg-indexof-a',
      state: { a: 0 },
      actions: {
        refreshData() {
          (this.state as any).a++
        },
      },
    })
    const storeB = createStore({ name: 'bg-indexof-b', state: { b: 0 } })

    // A 的 onForeground 中移除 B 的处理器；B 提前销毁（残留处理器仍会被快照遍历）
    initBackgroundSync({
      store: storeA,
      maxInactiveTime: -1,
      onForeground: () => unregisterBackgroundSync(storeB),
    })
    initBackgroundSync({ store: storeB, maxInactiveTime: -1 })
    storeB.destroy()

    expect(() => registerApp().onShow()).not.toThrow()
    expect(storeA.state.a).toBe(1)
  })

  it('ENTERPRISE-069: App(options) 未提供生命周期回调时包装后仍可正常调用', () => {
    initBackgroundSync({ store: testStore, maxInactiveTime: -1 })

    // 用户未注册 onShow/onHide：包装函数应注入回调且可安全触发
    const options = registerApp()
    expect(() => options.onShow()).not.toThrow()
    expect(testStore.state.refreshed).toBe(1)
  })

  it('ENTERPRISE-070 (#355 行为变更): 全局 App 被外部替换后再次 init 应重新包装并保留注册表', () => {
    initBackgroundSync({ store: testStore, maxInactiveTime: -1 })
    // 外部重置 App（如测试/框架重新注入）
    ;(global as any).App = mockApp

    const newStore = createStore({
      name: 'bg-reinstall-store',
      state: { refreshed: 0 },
      actions: {
        refreshData() {
          (this.state as any).refreshed++
        },
      },
    })
    initBackgroundSync({ store: newStore, maxInactiveTime: -1 })

    registerApp().onShow()

    // 新包装遍历同一模块级注册表：旧调用方的处理器仍应被调用，
    // 清空它们会静默停用其他模块的前台刷新/onForeground，且无从重新注册
    expect(testStore.state.refreshed).toBe(1)
    expect(newStore.state.refreshed).toBe(1)
  })

  it('ENTERPRISE-071: App 非函数（如测试对象 mock）时应安全返回不注册', () => {
    const original = (global as any).App
    ;(global as any).App = { prototype: { onShow: jest.fn() } }

    try {
      expect(() => initBackgroundSync({ store: testStore, maxInactiveTime: -1 })).not.toThrow()
    } finally {
      (global as any).App = original
    }
  })
})

describe('企业级方案 - App 集成', () => {
  const originalApp = (global as any).App
  const mockApp = {
    prototype: {
      onShow: jest.fn(),
      onHide: jest.fn(),
    },
  }

  beforeAll(() => {
    (global as any).App = mockApp
  })

  afterAll(() => {
    (global as any).App = originalApp
  })

  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    storeManager.clearAll()
    mockUpdateListeners.onReady = undefined
    jest.clearAllMocks()
    // 重置 App 生命周期 mock（initBackgroundSync 会替换原型方法）
    mockApp.prototype.onShow = jest.fn()
    mockApp.prototype.onHide = jest.fn()
  })

  it('ENTERPRISE-045: 无当前用户时 onLaunch 应该安全跳过', () => {
    const app = createEnterpriseApp()

    expect(app.globalData.store).toBeNull()
    expect(() => app.onLaunch()).not.toThrow()
  })

  it('ENTERPRISE-046: 有当前用户时 onLaunch 应该初始化完整流程', () => {
    mockStorage['current_user_id'] = 'app-user-1'
    const app = createEnterpriseApp()

    app.onLaunch()

    expect(app.globalData.store).not.toBeNull()
    expect(app.getStore()?.name).toBe('user-store-app-user-1')
    expect(app.getOfflineManager()).not.toBeNull()
    expect(mockWx.getUpdateManager).toHaveBeenCalled()
  })

  it('ENTERPRISE-047: login 应该切换用户并重建离线管理器', () => {
    const app = createEnterpriseApp()
    const store = app.login('app-user-2')

    expect(store.name).toBe('user-store-app-user-2')
    expect(app.getStore()).toBe(store)
    expect(app.getOfflineManager()).not.toBeNull()
    expect(mockStorage['current_user_id']).toBe('app-user-2')
  })

  it('ENTERPRISE-048: logout 应该清理状态', () => {
    const app = createEnterpriseApp()
    app.login('app-user-3')
    app.logout()

    expect(app.getStore()).toBeNull()
    expect(app.getOfflineManager()).toBeNull()
    expect(mockStorage['current_user_id']).toBeUndefined()
  })

  it('REGR-ENT-006: 冷启动应显式恢复身份，登出才能真正清理持久化数据', () => {
    mockStorage['current_user_id'] = 'cold-user'
    // 预置该账号的持久化状态：logout 是否真正执行可由它是否被删除判别
    mockStorage['user-store-cold-user'] = JSON.stringify({
      userInfo: { name: 'Cold' },
      preferences: {},
      lastSyncTime: null,
    })

    const app = createEnterpriseApp()
    expect(app.globalData.store?.name).toBe('user-store-cold-user')

    app.logout()

    // 修复前 getUserStore 不设 currentUserId，冷启动后该字段仍为 null，
    // StoreManager.logout() 开头的 `if (!this.currentUserId) return` 早退，
    // store.destroy() 与用户持久化键都不会被清理（App 层只清 CURRENT_USER_KEY）
    expect(mockStorage['user-store-cold-user']).toBeUndefined()
    expect(mockStorage['current_user_id']).toBeUndefined()
    expect(app.getStore()).toBeNull()
  })

  it('ENTERPRISE-063: login 切换账号应注销旧处理器，旧 store 不再被刷新', () => {
    mockStorage['current_user_id'] = 'app-user-1'
    const app = createEnterpriseApp()
    app.onLaunch()
    const oldStore = app.getStore()!

    const oldDispatch = jest.spyOn(oldStore, 'dispatch')
    const newStore = app.login('app-user-2')

    // 触发 App onShow 包装函数：旧 store 的 handler 已注销，不应被 dispatch
    mockApp.prototype.onShow()

    expect(newStore.name).toBe('user-store-app-user-2')
    expect(oldDispatch).not.toHaveBeenCalled()
    expect(() => mockApp.prototype.onShow()).not.toThrow()
  })

  it('ENTERPRISE-064: logout 后 onShow 不应因残留处理器抛错', () => {
    mockStorage['current_user_id'] = 'app-user-3'
    const app = createEnterpriseApp()
    app.onLaunch()
    app.logout()

    // 旧 store 已 destroy：若 handler 残留，onShow 的 destroyed 防御应自清理而不抛错
    expect(() => mockApp.prototype.onShow()).not.toThrow()
    expect(() => mockApp.prototype.onShow()).not.toThrow()
  })

  it('ENTERPRISE-049: onShow 有离线队列时应该触发同步', async () => {
    mockStorage['current_user_id'] = 'app-user-4'
    const app = createEnterpriseApp()
    app.onLaunch()

    // 模拟离线状态并添加操作
    const offlineManager = app.getOfflineManager()!
    ;(offlineManager as any).isOnline = false
    await offlineManager.execute('setUserInfo', () => Promise.resolve(null), { name: 'Queued' })

    // 恢复在线，触发同步
    ;(offlineManager as any).isOnline = true
    app.onShow()
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(mockWx.showLoading).toHaveBeenCalled()
    expect(mockWx.hideLoading).toHaveBeenCalled()
  })

  it('ENTERPRISE-061: onShow 无离线队列时不应显示加载', () => {
    mockStorage['current_user_id'] = 'app-user-5'
    const app = createEnterpriseApp()
    app.onLaunch()

    app.onShow()

    expect(mockWx.showLoading).not.toHaveBeenCalled()
  })

  it('ENTERPRISE-062: 纯数字字符串 userId 重启后应恢复同一 Store', () => {
    // storage.set 对字符串原样存储（不 JSON 序列化），重启后读取不应被解析为 number
    mockStorage['current_user_id'] = '1001'
    const app = createEnterpriseApp()
    const store = app.getStore()

    expect(store?.name).toBe('user-store-1001')
    // 与 login 后的 Store 应为同一实例（Map 键类型一致，避免多账号隔离失效）
    const loginStore = app.login('1001')
    expect(loginStore).toBe(store)
  })

  it('ENTERPRISE-070: 无当前 store 时 logout 应该安全', () => {
    const app = createEnterpriseApp()

    expect(() => app.logout()).not.toThrow()
    expect(app.getStore()).toBeNull()
    expect(app.getOfflineManager()).toBeNull()
  })
})

// ==================== 本轮修复回归 ====================
it('ENTERPRISE-060 (BUG 回归): syncQueue 中途异常不应丢失未处理完的队列项', async () => {
  // 第一个 action 成功；第二个超过重试上限进死信时 onDrop 抛错中断循环；
  // 第三个尚未迭代——修复前永久丢失且残缺队列覆盖磁盘
  mockStorage['partial_queue'] = JSON.stringify([
    { id: '1', type: 'setUserInfo', payload: { index: 1 }, timestamp: Date.now(), retryCount: 99 },
    { id: '3', type: 'setUserInfo', payload: { index: 3 }, timestamp: Date.now(), retryCount: 0 },
  ])
  const onDrop = jest.fn(() => {
    throw new Error('onDrop callback boom')
  })
  const localStore = createStore({ name: 'partial-queue-store', state: { userInfo: null } })
  const offlineManager = new OfflineManager(localStore, 'partial_queue', 1, onDrop)

  await expect(offlineManager.syncQueue()).rejects.toThrow('onDrop callback boom')

  // 未迭代到的第 3 项必须保留在队列中（重新入队）
  const queue = JSON.parse(mockStorage['partial_queue'])
  expect(queue.some((a: { id: string }) => a.id === '3')).toBe(true)
})

it('ENTERPRISE-061 (BUG 回归): initHotUpdate 幂等安装不累积监听', () => {
  const sharedManager = {
    onUpdateReady: jest.fn((callback: () => void) => {
      mockUpdateListeners.onReady = callback
    }),
    onUpdateFailed: jest.fn((callback: () => void) => {
      mockUpdateListeners.onFailed = callback
    }),
    applyUpdate: jest.fn(),
  }
  // 保存实现而非 mock 函数本身：mockImplementation(mock 自身) 会形成
  // 「调用自身实现」的无限递归，污染同文件后续所有 getUpdateManager 调用
  const originalGetUpdateManagerImpl = (mockWx.getUpdateManager as jest.Mock).getMockImplementation()
  const originalShowModal = mockWx.showModal
  let confirmCallback: ((res: { confirm: boolean }) => void) | null = null
  ;(mockWx.getUpdateManager as jest.Mock).mockImplementation(() => sharedManager)
  ;(mockWx as any).showModal = jest.fn((options: { success: (res: { confirm: boolean }) => void }) => {
    confirmCallback = options.success
  })

  const localStore = createStore({ name: 'hot-idempotent-store', state: { v: 1 } })
  try {
    initHotUpdate({ store: localStore })
    initHotUpdate({ store: localStore })
    initHotUpdate({ store: localStore })

    // 同一 updateManager 实例只安装一次监听
    expect(sharedManager.onUpdateReady).toHaveBeenCalledTimes(1)
    expect(sharedManager.onUpdateFailed).toHaveBeenCalledTimes(1)

    // 切换保护目标后再触发：备份来自最新注册的 store（确认更新时写入）
    const otherStore = createStore({ name: 'hot-update-switch-store', state: { v: 7 } })
    initHotUpdate({ store: otherStore })
    mockUpdateListeners.onReady!()
    confirmCallback!({ confirm: true })
    expect(mockStorage['store_backup_before_update_hot-update-switch-store']).toBeDefined()
  } finally {
    const getUpdateManagerMock = mockWx.getUpdateManager as jest.Mock
    getUpdateManagerMock.mockImplementation(originalGetUpdateManagerImpl!)
    ;(mockWx as any).showModal = originalShowModal
  }
})

// ==================== #42 回归：storage 写入异常容错与备份失败契约 ====================
describe('#42 回归：storage 写入异常容错', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    mockUpdateListeners.onReady = undefined
  })

  afterEach(() => {
    // 恢复默认实现，避免影响同文件后续用例（当前为末尾，防御性恢复）
    const setStorageMock = mockWx.setStorageSync as jest.Mock
    setStorageMock.mockReset()
    setStorageMock.mockImplementation((key: string, value: unknown) => {
      mockStorage[key] = value
    })
  })

  it('REGR-ENT-042a: setStorageSync 抛错时离线入队不受影响（saveQueue 尽力而为）', async () => {
    const setStorageMock = mockWx.setStorageSync as jest.Mock
    setStorageMock.mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const store = createStore({ name: 'quota-store', state: { counter: 1 } })
    const offlineManager = new OfflineManager(store)
    // 模拟离线
    ;(offlineManager as unknown as { isOnline: boolean }).isOnline = false

    // 落盘失败不再打断入队路径：操作照常缓存
    await expect(offlineManager.execute('addItem', () => Promise.resolve(null), 'item-1')).resolves.toBeNull()
    expect(offlineManager.getQueueLength()).toBe(1)

    offlineManager.dispose()
  })

  it('REGR-ENT-042b: 热更新备份写入失败时不写标记、不 applyUpdate', () => {
    const backupKey = 'store_backup_before_update_backup-fail-store'
    const testStore = createStore({ name: 'backup-fail-store', state: { counter: 1 } })
    initHotUpdate({ store: testStore })

    // 仅备份键写入失败：验证「先备份成功、后写标记」的顺序契约
    ;(mockWx.setStorageSync as jest.Mock).mockImplementation((key: string, value: unknown) => {
      if (key === backupKey) {
        throw new Error('quota exceeded')
      }
      mockStorage[key] = value
    })

    mockUpdateListeners.onReady!()
    const showModalCalls = (mockWx.showModal as jest.Mock).mock.calls
    const modalOptions = showModalCalls[showModalCalls.length - 1][0]
    modalOptions.success({ confirm: true })

    const getResults = (mockWx.getUpdateManager as jest.Mock).mock.results
    const updateManager = getResults[getResults.length - 1].value
    // 备份失败必须阻断更新流程：否则重启后会凭空执行一次无源恢复
    expect(updateManager.applyUpdate).not.toHaveBeenCalled()
    expect(mockStorage[`${backupKey}__pending_update_launch`]).toBeUndefined()
  })
})

// ==================== 覆盖率缺口补充：热更新守卫路径 ====================
describe('覆盖率补充：热更新守卫与恢复失败路径', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    mockUpdateListeners.onReady = undefined
  })

  it('REGR-ENT-COV1: onUpdateReady 时 store 已销毁应跳过备份（不弹确认框）', () => {
    const store = createStore({ name: 'destroyed-backup-store', state: { counter: 1 } })
    initHotUpdate({ store })
    const modalCallsBefore = (mockWx.showModal as jest.Mock).mock.calls.length

    store.destroy()
    mockUpdateListeners.onReady!()

    // 已销毁 store：$snapshot 会抛错且无人捕获，必须先跳过
    expect((mockWx.showModal as jest.Mock).mock.calls.length).toBe(modalCallsBefore)
  })

  it('REGR-ENT-COV2: restoreFromHotUpdate 恢复抛错时应返回 false 且保留备份', () => {
    const backupKey = 'store_backup_before_update_restore-fail-store'
    mockStorage[backupKey] = JSON.stringify({
      timestamp: Date.now(),
      state: { counter: 42 },
      version: '1.0.0',
    })
    mockStorage[`${backupKey}__pending_update_launch`] = 'true'

    const store = createStore({ name: 'restore-fail-store', state: { counter: 1 } })
    // 恢复已改用 $patch 合并语义（见 REGR-ENT-003），spy 随之落在 $patch 上
    const spy = jest.spyOn(store, '$patch').mockImplementation(() => {
      throw new Error('restore boom')
    })

    const result = restoreFromHotUpdate(store)

    expect(result).toBe(false)
    expect(store.state.counter).toBe(1)
    // 恢复失败不清理备份/标记：避免吞掉可重试的恢复机会
    expect(mockStorage[backupKey]).toBeDefined()
    expect(mockStorage[`${backupKey}__pending_update_launch`]).toBe('true')

    spy.mockRestore()
  })
})

// ==================== 第五轮高危回归：createEnterpriseApp 初始化时序 ====================

describe('R5 回归：createEnterpriseApp 必须在 App(options) 之前安装生命周期包装', () => {
  const originalApp = (global as any).App
  // 捕获 App(options) 实际接收的 options（包装后），供测试触发生命周期回调
  let appOptions: Record<string, any> | null = null

  // 函数形式的全局 App：与真实小程序一致，用户回调经 options 注册，
  // 框架直接调用 options 上的回调（改 prototype 拦不到）
  const mockApp = (options: Record<string, any> = {}) => {
    appOptions = options
    return options
  }

  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    storeManager.clearAll()
    jest.clearAllMocks()
    // 每个用例都从「未包装的原始 App」开始，模拟小程序冷启动时的全局状态
    ;(global as any).App = mockApp
    appOptions = null
  })

  afterAll(() => {
    (global as any).App = originalApp
  })

  it('ENTERPRISE-R5-001: 工厂返回时全局 App 应已被包装', () => {
    expect((global as any).App).toBe(mockApp)

    createEnterpriseApp()

    // 修复前包装只在 onLaunch/login 里安装，此时全局 App 仍是原始的
    expect((global as any).App).not.toBe(mockApp)
    expect(typeof (global as any).App).toBe('function')
  })

  it('ENTERPRISE-R5-002: App(createEnterpriseApp()) 应拦截到 onShow/onHide', () => {
    const config = createEnterpriseApp() as Record<string, any>
    // 包装器就地改写传入的 options，故须在 App() 之前留存原引用才能判断是否被替换
    const originalOnShow = config.onShow
    expect(typeof originalOnShow).toBe('function')
    expect(config.onHide).toBeUndefined()

    // 关键时序：App 在 createEnterpriseApp() 求值之后才解析，拿到的已是包装函数
    ;(global as any).App(config)

    expect(appOptions).not.toBeNull()
    expect(config.onShow).not.toBe(originalOnShow)
    // onHide 即使配置未提供也被注入，否则切后台检查无从触发
    expect(typeof config.onHide).toBe('function')
  })

  it('ENTERPRISE-R5-003: 包装后的 onShow 仍应执行配置原有的 onShow 逻辑', () => {
    mockStorage['current_user_id'] = 'r5-user-1'
    const config = createEnterpriseApp() as Record<string, any>
    config.onLaunch()
    ;(global as any).App(config)

    const hideLoadingSpy = jest.spyOn(mockWx, 'hideLoading')
    // 无离线队列时原 onShow 体不弹 loading，但必须被调用且不抛错
    expect(() => appOptions!.onShow()).not.toThrow()
    expect(hideLoadingSpy).not.toHaveBeenCalled()
  })

  it('ENTERPRISE-R5-004: App 创建之后注册的处理器应能经包装 onShow 收到回调', () => {
    const config = createEnterpriseApp() as Record<string, any>
    ;(global as any).App(config)

    // 模拟 login() 的时序：处理器在 App 已创建之后才注册
    const store = createStore({
      name: 'r5-bg-store',
      state: { refreshed: 0 },
      actions: {
        refreshData() {
          (this.state as any).refreshed++
        },
      },
    })
    const onForeground = jest.fn()
    const onBackground = jest.fn()
    initBackgroundSync({ store, maxInactiveTime: -1, onForeground, onBackground })

    // 修复前 runForegroundChecks/runBackgroundChecks 只存在于「未被安装」的包装闭包里，
    // 通过 App(config) 注册的 onShow/onHide 永不触发它们，以下全部静默失效
    appOptions!.onShow()
    expect(store.state.refreshed).toBe(1)
    expect(onForeground).toHaveBeenCalledTimes(1)

    appOptions!.onHide()
    expect(onBackground).toHaveBeenCalledTimes(1)
  })

  it('ENTERPRISE-R5-005: 重复调用工厂不应层层叠加包装', () => {
    createEnterpriseApp()
    const afterFirst = (global as any).App

    createEnterpriseApp()
    const afterSecond = (global as any).App

    // 已是本模块包装时直接跳过，避免 onShow 被包装多层导致检查重复执行
    expect(afterSecond).toBe(afterFirst)
  })
})

// ==================== 第五轮中危回归：clearQueue 与同步窗口的竞态 ====================

describe('R5 回归：clearQueue 在同步进行中不得被静默撤销', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
  })

  it('同步途中 clearQueue 后，已清空的操作不应复活并落盘', async () => {
    let entered = false
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const store = createStore({
      name: 'r5-offline-store',
      state: { done: 0 },
      actions: {
        async addItem() {
          entered = true
          await gate
          ;(this.state as any).done++
        },
      },
    })

    const manager = new OfflineManager(store, 'r5_offline_queue')
    ;(manager as any).isOnline = false
    await manager.execute('addItem', () => Promise.resolve(null), 'a')
    await manager.execute('addItem', () => Promise.resolve(null), 'b')
    expect(manager.getQueueLength()).toBe(2)

    ;(manager as any).isOnline = true
    const syncing = manager.syncQueue()

    // 轮询等待第一个操作真正进入 action（不依赖固定的微任务层数），
    // 制造「同步进行中」窗口
    for (let i = 0; i < 20 && !entered; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(entered).toBe(true)

    manager.clearQueue()
    expect(manager.getQueueLength()).toBe(0)

    release()
    await syncing

    // 修复前 clearQueue 只清 actionQueue 与磁盘键，而 syncQueue 的 finally 用
    // 局部 failedActions + 未清的 syncPending 回填并 saveQueue，
    // 已「清空」的操作 b 会复活继续同步并落盘
    expect(manager.getQueueLength()).toBe(0)

    // 从磁盘重新加载也读不到被复活的操作
    const reloaded = new OfflineManager(store, 'r5_offline_queue')
    expect(reloaded.getQueueLength()).toBe(0)

    store.destroy()
  })
})

// ==================== G3-p2 回归：离线队列语义 / onShow loading / onLaunch 兜底 ====================
describe('G3-p2 回归：离线执行语义与 App 生命周期兜底', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
    storeManager.clearAll()
    mockUpdateListeners.onReady = undefined
    mockUpdateListeners.onFailed = undefined
    jest.clearAllMocks()
  })

  afterEach(() => {
    // setStorageSync 的实现被个别用例改写，统一恢复，避免污染同文件后续用例
    const setStorageMock = mockWx.setStorageSync as jest.Mock
    setStorageMock.mockReset()
    setStorageMock.mockImplementation((key: string, value: unknown) => {
      mockStorage[key] = value
    })
  })

  it('#350 回归: 在线执行失败不再 rethrow，队列成为唯一重放入口', async () => {
    const store = createStore({
      name: 'p2-replay-store',
      state: { items: [] as string[] },
      actions: {
        addItem(item: string) {
          (this.state as any).items.push(item)
        },
      },
    })
    const manager = new OfflineManager(store, 'p2_replay_queue')
    ;(manager as any).isOnline = true
    const boom = new Error('Network error')
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      // 修复前是「入队 + 抛错」并存：调用方捕获 rejection 自行重试会与队列重放叠加，
      // 非幂等操作被执行两次。现约定失败即入队、返回 null，原错误记日志
      await expect(manager.execute('addItem', () => Promise.reject(boom), 'item-1')).resolves.toBeNull()
      expect(manager.getQueueLength()).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('已转交离线队列重放: addItem'), boom)

      await manager.syncQueue()
      expect(store.getState().items).toEqual(['item-1'])
      expect(manager.getQueueLength()).toBe(0)
    } finally {
      errorSpy.mockRestore()
      manager.dispose()
      store.destroy()
    }
  })

  it('#351 回归: 队列落盘失败给出操作级告警（内存是唯一副本）', async () => {
    const setStorageMock = mockWx.setStorageSync as jest.Mock
    setStorageMock.mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const store = createStore({ name: 'p2-savefail-store', state: { counter: 1 } })
    const manager = new OfflineManager(store, 'p2_savefail_queue')
    ;(manager as any).isOnline = false
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await manager.execute('addItem', () => Promise.resolve(null), 'item-1')

      // storage 层只记「写入失败」，看不出「操作仅存内存」的后果，必须补操作级告警
      expect(manager.getQueueLength()).toBe(1)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('队列落盘失败，操作仅存于内存'))
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
      manager.dispose()
      store.destroy()
    }
  })

  it('#359 回归: 同步进行中重复 onShow 不重复弹 loading，也不提前收起', async () => {
    mockStorage['current_user_id'] = 'p2-loading-user'
    const app = createEnterpriseApp()
    app.onLaunch()
    const manager = app.getOfflineManager()!
    const store = app.getStore()!
    expect(manager).not.toBeNull()
    expect(store).not.toBeNull()

    let release!: () => void
    const hanging = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    // 挂起 action：制造真实的「同步进行中」窗口（syncQueue 停在第一个操作的 await 上）
    ;(store.actions as Record<string, unknown>).hangFirst = () => hanging
    ;(manager as any).isOnline = false
    await manager.execute('hangFirst', () => Promise.resolve(null), 'p2-1')
    ;(manager as any).isOnline = true

    app.onShow()

    // 同步期间新入队的操作让 getQueueLength() 再次 > 0：修复前第二次 onShow 会再弹一次
    // loading，并因 syncQueue 的 syncing 互斥立刻 resolve 而在首次同步仍在跑时收起转圈
    ;(manager as any).isOnline = false
    await manager.execute('hangFirst', () => Promise.resolve(null), 'p2-2')
    ;(manager as any).isOnline = true
    app.onShow()

    expect(mockWx.showLoading).toHaveBeenCalledTimes(1)

    release()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(mockWx.hideLoading).toHaveBeenCalledTimes(1)
    manager.dispose()
  })

  it('#360 回归: onLaunch 单个初始化步骤抛错不影响后续步骤', () => {
    mockStorage['current_user_id'] = 'p2-launch-user'
    const getUpdateManagerMock = mockWx.getUpdateManager as jest.Mock
    const originalImpl = getUpdateManagerMock.getMockImplementation()
    getUpdateManagerMock.mockImplementation(() => {
      throw new Error('getUpdateManager unavailable')
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const app = createEnterpriseApp()

    try {
      // 修复前热更新初始化抛错会连带跳过后台同步与离线管理器创建，
      // 且异常沿框架生命周期外抛中断宿主启动
      expect(() => app.onLaunch()).not.toThrow()
      expect(app.getOfflineManager()).not.toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('热更新初始化失败'), expect.anything())
    } finally {
      if (originalImpl) {
        getUpdateManagerMock.mockImplementation(originalImpl)
      }
      errorSpy.mockRestore()
      app.getOfflineManager()?.dispose()
    }
  })
})
