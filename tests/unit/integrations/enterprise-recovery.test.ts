/**
 * 企业级方案的异步失败兜底
 *
 * 覆盖两条「无人接住就会成为 unhandled rejection」的防御路径：
 * - 网络恢复自动同步失败（含 onDrop 回调抛错）→ syncQueue 的 rejection 被接住
 * - 切前台 refreshData 失败 → 不中断 App.onShow 生命周期
 */
import { createStore } from '@/index.js'
import { OfflineManager } from '@/integrations/enterprise/offline.js'
import { initBackgroundSync } from '@/integrations/enterprise/background-sync.js'

const mockStorage: Record<string, unknown> = {}
const networkListeners: Array<(res: { isConnected: boolean }) => void> = []

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
  request: () => {},
  showModal: () => {},
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  getUpdateManager: () => ({ onUpdateReady: () => {}, onUpdateFailed: () => {}, applyUpdate: () => {} }),
}

;(globalThis as { wx?: unknown }).wx = mockWx

describe('企业级异步失败兜底', () => {
  beforeEach(() => {
    networkListeners.length = 0
    Object.keys(mockStorage).forEach((key) => {
      delete mockStorage[key]
    })
  })

  it('网络恢复自动同步失败（onDrop 抛错）时接住 rejection，不产生未处理拒绝', async () => {
    const store = createStore({
      name: 'offline-reject',
      state: { x: 0 },
      actions: {
        fail(): void {
          throw new Error('queued action failed')
        },
      },
    })
    const onDrop = jest.fn(() => {
      throw new Error('onDrop boom')
    })
    // maxRetryCount = 1：首次失败即超限 → 进入死信 + onDrop
    const manager = new OfflineManager(store, 'queue-reject', 1, onDrop)

    // 先进入离线态
    networkListeners.forEach((listener) => listener({ isConnected: false }))

    await manager.execute('fail', async () => 'never')
    expect(manager.getQueueLength()).toBe(1)

    // 恢复网络：自动同步 → dispatch 失败 → 超限 → onDrop 抛错 → syncQueue reject 被接住
    networkListeners.forEach((listener) => listener({ isConnected: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onDrop).toHaveBeenCalled()
    manager.dispose()
  })

  it('切前台 refreshData 失败时被接住，不中断 App.onShow 生命周期', async () => {
    const store = createStore({
      name: 'bg-refresh',
      state: { x: 0 },
      actions: {
        async refreshData(): Promise<void> {
          throw new Error('refresh failed')
        },
      },
    })
    const userOnShow = jest.fn()
    ;(globalThis as { App?: unknown }).App = function App(options: unknown) {
      return options
    }

    // maxInactiveTime 为负 → 首次 onShow 即判定超时，触发 refreshData
    initBackgroundSync({ store, maxInactiveTime: -1 })

    const appOptions = (globalThis as unknown as { App: (options: unknown) => { onShow: () => void } }).App({ onShow: userOnShow })
    expect(() => appOptions.onShow()).not.toThrow()

    await new Promise((resolve) => setTimeout(resolve, 0))

    // 单个 store 刷新失败不影响用户自己的 onShow 回调
    expect(userOnShow).toHaveBeenCalled()
    expect(store.getState().x).toBe(0)
  })
})
