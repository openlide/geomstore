/**
 * createEnterpriseApp 的生命周期兜底路径
 *
 * - 热更新确认后的 onBeforeUpdate 回调（仅在用户确认更新时执行）
 * - App.onShow 中离线队列同步失败被接住（syncQueue 可 reject：wx API 异常等）
 */
import { createEnterpriseApp } from '@/integrations/enterprise/wechat-enterprise.js'

const mockStorage: Record<string, unknown> = {}
const networkListeners: Array<(res: { isConnected: boolean }) => void> = []
let onUpdateReady: (() => void) | undefined

const applyUpdate = jest.fn()

const mockWx = {
  setStorageSync: (key: string, value: unknown) => {
    mockStorage[key] = value
  },
  getStorageSync: (key: string) => mockStorage[key],
  removeStorageSync: (key: string) => {
    delete mockStorage[key]
  },
  onNetworkStatusChange: (callback: (res: { isConnected: boolean }) => void) => {
    networkListeners.push(callback)
  },
  getNetworkType: (options: { success: (res: { networkType: string }) => void }) => {
    options.success({ networkType: 'wifi' })
  },
  getUpdateManager: () => ({
    onUpdateReady: (callback: () => void) => {
      onUpdateReady = callback
    },
    onUpdateFailed: () => {},
    applyUpdate,
  }),
  request: () => {},
  // 直接确认更新：触发备份 → onBeforeUpdate → applyUpdate
  showModal: jest.fn((options: { success?: (res: { confirm: boolean }) => void }) => {
    options.success?.({ confirm: true })
  }),
  showToast: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
}

;(globalThis as unknown as { wx?: unknown }).wx = mockWx
;(globalThis as unknown as { App?: unknown }).App = function App(options: unknown) {
  return options
}

describe('createEnterpriseApp 生命周期兜底', () => {
  beforeEach(() => {
    networkListeners.length = 0
    onUpdateReady = undefined
    Object.keys(mockStorage).forEach((key) => {
      delete mockStorage[key]
    })
    mockWx.showToast.mockReset()
    mockWx.showModal.mockClear()
    applyUpdate.mockClear()
  })

  it('用户确认热更新后执行 onBeforeUpdate 回调并应用更新', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    // 冷启动恢复身份：store 非空才会注册热更新保护
    mockStorage['current_user_id'] = 'u1'

    try {
      const app = createEnterpriseApp()
      app.onLaunch.call(app)

      expect(typeof onUpdateReady).toBe('function')
      onUpdateReady?.()

      expect(mockWx.showModal).toHaveBeenCalled()
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('准备更新，状态已备份'))
      expect(applyUpdate).toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
    }
  })

  it('App.onShow 中离线队列同步失败被接住，不中断生命周期', async () => {
    // 冷启动恢复身份 → onLaunch 初始化离线管理器
    mockStorage['current_user_id'] = 'u2'
    const app = createEnterpriseApp()
    app.onLaunch.call(app)

    // 进入离线态
    networkListeners.forEach((listener) => listener({ isConnected: false }))

    const manager = app.getOfflineManager()
    expect(manager).not.toBeNull()
    // 离线期间入队一个无法执行的 action
    await manager?.execute('unknownAction', async () => 'never')
    expect(manager?.getQueueLength()).toBe(1)

    // 制造一条**仍会外溢**的同步失败：重试用尽 → 移入死信 → onDrop 抛错 → syncQueue reject。
    // （第六轮 R6-103 起 `wx.showToast` 抛错已被单独兜底，不再把 syncQueue 变成 rejection——
    //  旧写法用 showToast 制造失败，测的正是那个被判掉的 bug。）
    const internals = manager as unknown as { maxRetryCount: number; onDrop?: (action: unknown) => void }
    internals.maxRetryCount = 1
    internals.onDrop = () => {
      throw new Error('onDrop boom')
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => app.onShow.call(app)).not.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('离线队列同步失败'), expect.anything())
      expect(mockWx.hideLoading).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
