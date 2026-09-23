/**
 * 第六轮 f1-09 回归锁（企业侧）
 *
 * 覆盖四条修复：
 * - R6-056：StoreManager 的 userId 入口校验必须先于 LRU 淘汰（非法输入不得销毁他账号 store）
 * - R6-057：登出连该账号的离线队列键与死信键一起清，重新登录不重放登出前的操作
 * - R6-058：createUserStore 的 persistUserInfoKeys 把未列出的 userInfo 字段挡在本地存储外
 * - R6-059：已有同步在途时 App.onShow 不再抢同一个全局 loading
 */

import { StoreManager } from '@/integrations/enterprise/store-manager.js'
import { createUserStore } from '@/integrations/enterprise/user-store.js'
import { createEnterpriseApp } from '@/integrations/enterprise/wechat-enterprise.js'

const mockStorage: Record<string, unknown> = {}
const networkListeners: Array<(res: { isConnected: boolean }) => void> = []

const mockWx = {
  setStorageSync: jest.fn((key: string, value: unknown) => {
    mockStorage[key] = value
  }),
  getStorageSync: jest.fn((key: string) => mockStorage[key]),
  removeStorageSync: jest.fn((key: string) => {
    delete mockStorage[key]
  }),
  onNetworkStatusChange: jest.fn((callback: (res: { isConnected: boolean }) => void) => {
    networkListeners.push(callback)
  }),
  offNetworkStatusChange: jest.fn((callback: (res: { isConnected: boolean }) => void) => {
    const i = networkListeners.indexOf(callback)
    if (i >= 0) networkListeners.splice(i, 1)
  }),
  getNetworkType: jest.fn((options: { success?: (res: { networkType: string }) => void }) => {
    options.success?.({ networkType: 'wifi' })
  }),
  getUpdateManager: () => ({
    onUpdateReady: () => {},
    onUpdateFailed: () => {},
    applyUpdate: () => {},
  }),
  request: jest.fn(),
  showModal: jest.fn(),
  showToast: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
}

const g = globalThis as unknown as { wx?: unknown; App?: unknown }
g.wx = mockWx
g.App = function App(options: unknown) {
  return options
}

/** 触发全部已注册的网络状态回调（模拟 wx.onNetworkStatusChange 的广播） */
function emitNetwork(isConnected: boolean): void {
  // 先取快照再广播：回调一侧会注册/摘除监听（dispose 把自己从数组里删掉），
  // 直接迭代原数组会漏掉同批的其余回调
  const listeners = [...networkListeners]
  listeners.forEach((listener) => listener({ isConnected }))
}

/** 让微任务与 setTimeout(0) 排干，使在途同步真正停在被 gate 卡住的那一步 */
async function drain(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('第六轮 f1-09 企业侧回归', () => {
  let logSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    Object.keys(mockStorage).forEach((key) => {
      delete mockStorage[key]
    })
    networkListeners.length = 0
    jest.clearAllMocks()
  })

  afterEach(() => {
    logSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    jest.useRealTimers()
  })

  describe('R6-056：入口校验先于 LRU 淘汰', () => {
    it('getUserStore 收到纯空白 userId 时抛错，且不销毁、不剔除无关账号的活跃 store', () => {
      const manager = new StoreManager(2)
      manager.switchUser('acct-a')
      const storeB = manager.getUserStore('acct-b')

      // 修复前：cleanupOldestStore() 先销毁 B，再在 createUserStore 里抛「userId 不能为空」，
      // 非法输入白换一个合法账号的实例
      expect(() => manager.getUserStore('   ')).toThrow(/userId 不能为空/)
      expect(storeB.destroyed).toBe(false)
      expect(manager.getUserStore('acct-b')).toBe(storeB)
    })

    it('switchUser 收到空 userId 时不改身份、不写身份键，也不淘汰 store', () => {
      const manager = new StoreManager(2)
      const storeA = manager.switchUser('acct-a')
      const storeB = manager.getUserStore('acct-b')

      expect(() => manager.switchUser('')).toThrow(/userId 不能为空/)
      expect(storeB.destroyed).toBe(false)
      expect(manager.getCurrentStore()).toBe(storeA)
      expect(mockStorage['current_user_id']).toBe('acct-a')
    })

    it('合法 userId 仍按 LRU 正常淘汰（校验前移没有削弱容量约束）', () => {
      const manager = new StoreManager(2)
      manager.switchUser('acct-a')
      const storeB = manager.getUserStore('acct-b')

      manager.getUserStore('acct-c')

      expect(storeB.destroyed).toBe(true)
    })
  })

  describe('R6-057：登出清空离线队列与死信键', () => {
    it('logout 删掉该账号的队列键与死信键，重新登录后不重放登出前的操作', async () => {
      const app = createEnterpriseApp()
      app.login('logout-user')
      const manager = app.getOfflineManager()
      expect(manager).not.toBeNull()

      emitNetwork(false)
      await manager!.execute('setUserInfo', async () => ({ id: '1' }))

      const queueKey = 'offline_action_queue_user-store-logout-user'
      const deadLetterKey = `${queueKey}_dead_letter`
      expect(mockStorage[queueKey]).toBeDefined()
      // 死信键由业务层/上一会话留下：登出同样不得把它留在设备上
      mockStorage[deadLetterKey] = [{ id: 'x', type: 'setUserInfo', payload: null, timestamp: 1, retryCount: 3 }]

      app.logout()

      expect(mockStorage[queueKey]).toBeUndefined()
      expect(mockStorage[deadLetterKey]).toBeUndefined()
      expect(mockStorage['user-store-logout-user']).toBeUndefined()

      const second = app.login('logout-user')
      expect(app.getOfflineManager()!.getQueueLength()).toBe(0)
      // 修复前这里会读回登出前的那一条，App.onShow 随即把它 dispatch 进刚重建的 store
      const dispatchSpy = jest.spyOn(second, 'dispatch')
      await app.getOfflineManager()!.syncQueue()
      expect(dispatchSpy).not.toHaveBeenCalled()
    })
  })

  describe('R6-058：persistUserInfoKeys 收窄落盘字段', () => {
    it('只把允许列表里的 userInfo 字段写进本地存储，内存状态保持完整', () => {
      jest.useFakeTimers()
      const store = createUserStore({ userId: 'filter-user', persistUserInfoKeys: ['id', 'name'] })

      store.dispatch('setUserInfo', { id: '1', name: 'Ada', token: 'secret-token', phone: '13800000000' })
      jest.advanceTimersByTime(600)

      const saved = JSON.parse(mockStorage['user-store-filter-user'] as string) as { userInfo: Record<string, unknown> }
      expect(saved.userInfo).toEqual({ id: '1', name: 'Ada' })
      expect(store.state.userInfo).toMatchObject({ token: 'secret-token', phone: '13800000000' })
    })

    it('未配置该选项时保持既有行为：整个 userInfo 落盘', () => {
      jest.useFakeTimers()
      const store = createUserStore({ userId: 'default-user' })

      store.dispatch('setUserInfo', { id: '2', token: 't' })
      jest.advanceTimersByTime(600)

      const saved = JSON.parse(mockStorage['user-store-default-user'] as string) as { userInfo: Record<string, unknown> }
      expect(saved.userInfo).toEqual({ id: '2', token: 't' })
    })

    it('允许列表只投影自有键：不沿原型链取值，也不因 __proto__ 改坏投影对象', () => {
      jest.useFakeTimers()
      const store = createUserStore({ userId: 'proto-user', persistUserInfoKeys: ['__proto__', 'name'] })

      store.dispatch('setUserInfo', { name: 'Ada' })
      jest.advanceTimersByTime(600)

      const saved = JSON.parse(mockStorage['user-store-proto-user'] as string) as { userInfo: Record<string, unknown> }
      // `__proto__` 在 userInfo 上不是自有键 → 不落盘；否则它会命中 Object.prototype 的 setter
      expect(saved.userInfo).toEqual({ name: 'Ada' })
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })
  })

  describe('R6-059：在途同步与 onShow 的加载提示竞态', () => {
    it('有一轮同步在途且队列非空时，onShow 既不弹也不收 loading', async () => {
      const app = createEnterpriseApp()
      const store = app.login('race-user')
      const manager = app.getOfflineManager()
      expect(manager).not.toBeNull()

      // 让重放卡在待完成的 dispatch 上（真实场景里是一次慢网络请求）
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      jest.spyOn(store, 'dispatch').mockImplementation(() => gate)

      emitNetwork(false)
      await manager!.execute('setUserInfo', async () => ({ id: '1' }))
      // 网络恢复回调自行发起一轮（与 onShow 并发的正是这一轮）
      emitNetwork(true)
      await drain()

      // 报告的时序：本轮在途期间又有一条操作入队 → getQueueLength() 回到 >0
      await manager!.execute('setUserInfo', async () => {
        throw new Error('offline')
      })
      expect(manager!.getQueueLength()).toBeGreaterThan(0)

      mockWx.showLoading.mockClear()
      mockWx.hideLoading.mockClear()
      app.onShow()
      // 修复前：syncQueue() 被 syncing 互斥空跑挡回，finally 立刻 hideLoading，
      // 把正在跑的那轮同步的转圈收掉（用户看到「一闪就没、队列还在」，日志里毫无失败）
      expect(mockWx.showLoading).not.toHaveBeenCalled()
      expect(mockWx.hideLoading).not.toHaveBeenCalled()

      release()
      await drain()
    })

    it('没有在途同步时 onShow 照常接管：弹一次 loading、跑完一轮后收起', async () => {
      const app = createEnterpriseApp()
      app.login('idle-user')
      const manager = app.getOfflineManager()
      expect(manager).not.toBeNull()

      emitNetwork(false)
      await manager!.execute('setUserInfo', async () => ({ id: '1' }))
      expect(manager!.getQueueLength()).toBe(1)

      mockWx.showLoading.mockClear()
      mockWx.hideLoading.mockClear()
      app.onShow()
      expect(mockWx.showLoading).toHaveBeenCalledTimes(1)
      await drain()
      expect(mockWx.hideLoading).toHaveBeenCalledTimes(1)
      expect(manager!.getQueueLength()).toBe(0)
    })
  })
})
