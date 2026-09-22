/**
 * 第五轮 integrations-p1 回归：企业集成的存储/清理/同步路径
 *
 * 逐条锁定 R5-266 ~ R5-295 判定为 FIXED 的行为（用例名带 finding 编号）。
 * env.ts 的 R5-263 / R5-264 / R5-265 为类型标注与文档口径修正，无新行为可锁，
 * 其既有行为由 ocr-medium-round4-p1.test.ts（#332/#333）与 ocr-low-round4.test.ts（#330）覆盖。
 */

import { createStore } from '@/index.js'
import { OfflineManager } from '@/integrations/enterprise/offline.js'
import { StoreManager } from '@/integrations/enterprise/store-manager.js'
import { createUserStore } from '@/integrations/enterprise/user-store.js'
import { initHotUpdate } from '@/integrations/enterprise/hot-update.js'
import { createEnterpriseApp, storeManager } from '@/integrations/enterprise/wechat-enterprise.js'

// ==================== 可控 wx mock ====================

const mockMap: Record<string, unknown> = {}
let removeShouldThrow = false

const setStorageSync = jest.fn((key: string, value: unknown) => {
  mockMap[key] = value
})
const getStorageSync = jest.fn((key: string) => mockMap[key])
const removeStorageSync = jest.fn((key: string) => {
  if (removeShouldThrow) throw new Error('remove boom')
  delete mockMap[key]
})

const showToast = jest.fn()
const showModal = jest.fn()
const showLoading = jest.fn()
const hideLoading = jest.fn()
const request = jest.fn()

/** 每次返回新实例：`installedUpdateManagers` 按实例幂等安装，测试要逐条重新安装监听 */
const applyUpdate = jest.fn()
const updateListeners: { ready?: () => void; failed?: () => void } = {}
const getUpdateManager = jest.fn(() => ({
  onUpdateReady: (cb: () => void) => {
    updateListeners.ready = cb
  },
  onUpdateFailed: (cb: () => void) => {
    updateListeners.failed = cb
  },
  applyUpdate,
}))

;(globalThis as { wx?: unknown }).wx = {
  setStorageSync,
  getStorageSync,
  removeStorageSync,
  request,
  onNetworkStatusChange: jest.fn(),
  offNetworkStatusChange: jest.fn(),
  getNetworkType: jest.fn((options: { success?: (res: { networkType: string }) => void }) => {
    options.success?.({ networkType: 'wifi' })
  }),
  getUpdateManager,
  showModal,
  showToast,
  showLoading,
  hideLoading,
}

// createEnterpriseApp / initBackgroundSync 需要全局 App 就位（否则会走 R5-249 的降级告警）
;(globalThis as { App?: unknown }).App = function App(options: Record<string, unknown> = {}) {
  return options
}

function flush(ms = 20): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 最近一次 showModal 的入参（热更新模态的 success 回调由用例手动触发） */
function lastModal(): { success: (res: { confirm: boolean }) => void } {
  const calls = showModal.mock.calls
  return calls[calls.length - 1][0] as { success: (res: { confirm: boolean }) => void }
}

/** 直接改私有字段模拟网络状态（形参刻意不写 OfflineManager<S>：该类型对 S 不变，泛型实参会互相拒绝） */
function setOnline(manager: unknown, value: boolean): void {
  const target = manager as { isOnline: boolean }
  target.isOnline = value
}

beforeEach(() => {
  Object.keys(mockMap).forEach((key) => delete mockMap[key])
  removeShouldThrow = false
  delete updateListeners.ready
  delete updateListeners.failed
  jest.clearAllMocks()
  storeManager.clearAll()
})

// ==================== store-manager ====================

describe('StoreManager（R5-266 / R5-267 / R5-268）', () => {
  it('R5-266 maxStores=0 归一为 1 并告警：容量契约不再静默失真', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const manager = new StoreManager(0)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('maxStores 非法（0）'))

      const first = manager.getUserStore('r5-266-a')
      const second = manager.getUserStore('r5-266-b')
      // 归一后按容量 1 执行：新账号未命中时淘汰最旧的非当前 store
      expect(first.destroyed).toBe(true)
      expect(second.destroyed).toBe(false)
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('超出上限'))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('R5-266 NaN / 负数 / 非整数同样归一并留痕，正整数不受影响', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const invalid of [NaN, -2, 2.5]) {
        new StoreManager(invalid)
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`maxStores 非法（${invalid}）`))
      }
      warnSpy.mockClear()
      const manager = new StoreManager(3)
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('maxStores 非法'))
      expect(manager.getUserStore('r5-266-ok')).toBeDefined()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('R5-267 destroy 抛错不阻断登出的持久化清理与身份重置', () => {
    const manager = new StoreManager()
    const store = manager.switchUser('r5-267-destroy')
    mockMap['user-store-r5-267-destroy'] = '{"userInfo":null}'
    jest.spyOn(store, 'destroy').mockImplementation(() => {
      throw new Error('flush boom')
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      expect(() => manager.logout()).not.toThrow()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('销毁 store 失败'), expect.anything())
      expect(mockMap['user-store-r5-267-destroy']).toBeUndefined()
      expect(mockMap['current_user_id']).toBeUndefined()
      expect(manager.getCurrentStore()).toBeNull()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('R5-267 平台拒绝删除时登出必须留痕（否则身份会被冷启动复活）', () => {
    const manager = new StoreManager()
    manager.switchUser('r5-267-remove')
    removeShouldThrow = true
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      manager.logout()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('登出的持久化清理未被平台接受'))
    } finally {
      removeShouldThrow = false
      errorSpy.mockRestore()
    }
  })

  it('R5-268 clearAll 一并撤销持久化身份，但保留各账号数据键', () => {
    const manager = new StoreManager()
    manager.switchUser('r5-268')
    mockMap['user-store-r5-268'] = JSON.stringify({ userInfo: { name: 'kept' }, preferences: {} })

    manager.clearAll()

    expect(manager.getCurrentStore()).toBeNull()
    // 修复前只清内存：下一次冷启动据 current_user_id 把身份指回刚被清掉的账号
    expect(mockMap['current_user_id']).toBeUndefined()
    expect(mockMap['user-store-r5-268']).toBeDefined()
  })

  it('R5-268 clearAll 清身份键失败时告警', () => {
    const manager = new StoreManager()
    manager.switchUser('r5-268-b')
    removeShouldThrow = true
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      manager.clearAll()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('清理当前身份标记未被平台接受'))
    } finally {
      removeShouldThrow = false
      errorSpy.mockRestore()
    }
  })
})

// ==================== user-store ====================

describe('createUserStore（R5-273 / R5-274 / R5-275）', () => {
  function respondWith(userInfo: unknown): void {
    request.mockImplementation((options: { success?: (res: { statusCode: number; data: unknown }) => void }) => {
      options.success?.({ statusCode: 200, data: { userInfo } })
    })
  }

  it('R5-274 initialState 显式 undefined 不再覆盖 UserState 的契约字段', () => {
    const store = createUserStore({
      userId: 'r5-274',
      initialState: { userInfo: undefined, preferences: undefined, lastSyncTime: undefined },
    })

    expect(store.state.userInfo).toBeNull()
    expect(store.state.preferences).toEqual({})
    expect(store.state.lastSyncTime).toBeNull()
    // 修复前 preferences 为 undefined：这里会在 undefined 上展开而抛错
    expect(() => store.dispatch('updatePreferences', 'theme', 'dark')).not.toThrow()
    expect(store.state.preferences).toEqual({ theme: 'dark' })
    store.destroy()
  })

  it('R5-274 对照：给了值就按值初始化', () => {
    const store = createUserStore({
      userId: 'r5-274-b',
      initialState: { userInfo: { id: 1 }, preferences: { theme: 'light' }, lastSyncTime: 123 },
    })

    expect(store.state.userInfo).toEqual({ id: 1 })
    expect(store.state.preferences).toEqual({ theme: 'light' })
    expect(store.state.lastSyncTime).toBe(123)
    store.destroy()
  })

  it('R5-275 后发请求的结果不被先发请求的旧响应覆盖', async () => {
    const resolvers: Array<(res: { statusCode: number; data: unknown }) => void> = []
    request.mockImplementation((options: { success: (res: { statusCode: number; data: unknown }) => void }) => {
      resolvers.push(options.success)
    })
    const store = createUserStore({ userId: 'r5-275', syncUrl: 'https://api.example.com/user/sync' })

    const first = store.dispatch('syncWithServer') as Promise<void>
    const second = store.dispatch('syncWithServer') as Promise<void>

    resolvers[1]?.({ statusCode: 200, data: { userInfo: { name: 'new' } } })
    await second
    expect(store.state.userInfo).toEqual({ name: 'new' })

    resolvers[0]?.({ statusCode: 200, data: { userInfo: { name: 'old' } } })
    await first
    // 修复前：旧响应后到即覆盖 userInfo / lastSyncTime，调用方的重新同步判定失真
    expect(store.state.userInfo).toEqual({ name: 'new' })
    store.destroy()
  })

  it('R5-275 store 在等待期间被销毁时丢弃结果，而不是把 $patch 抛错当成同步失败', async () => {
    let succeed: ((res: { statusCode: number; data: unknown }) => void) | undefined
    request.mockImplementation((options: { success: (res: { statusCode: number; data: unknown }) => void }) => {
      succeed = options.success
    })
    const store = createUserStore({ userId: 'r5-275-destroyed', syncUrl: 'https://api.example.com/user/sync' })
    const pending = store.dispatch('syncWithServer') as Promise<void>

    store.destroy()
    succeed?.({ statusCode: 200, data: { userInfo: { name: 'x' } } })

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(pending).resolves.toBeUndefined()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Store 已销毁，丢弃本次同步结果'))
      // 修复前这里记的是「同步用户信息失败」，掩盖真实原因并诱导无谓重试
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('同步用户信息失败'))
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })

  it('R5-273 未配置 syncUrl 时直接 reject 且不发起请求；配置后按注入地址请求', async () => {
    respondWith({ name: 'S' })
    const noUrl = createUserStore({ userId: 'r5-273-none' })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(noUrl.dispatch('syncWithServer') as Promise<void>).rejects.toThrow(/未配置 syncUrl/)
      expect(request).not.toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }

    const store = createUserStore({ userId: 'r5-273', syncUrl: 'https://api.example.com/user/sync' })
    await (store.dispatch('syncWithServer') as Promise<void>)
    expect((request.mock.calls[0][0] as { url: string }).url).toBe('https://api.example.com/user/sync')
    expect(store.state.userInfo).toEqual({ name: 'S' })
    store.destroy()
    noUrl.destroy()
  })
})

// ==================== offline ====================

describe('OfflineManager（R5-292 / R5-293 / R5-294 / R5-295）', () => {
  it('R5-292 已释放实例的 clearQueue / clearDeadLetters 不再触碰共享存储键', () => {
    const store = createStore({ name: 'r5-292-store', state: { n: 1 } })
    const manager = new OfflineManager(store, 'r5_292_queue')
    const queued = [{ id: '1', type: 'submitOrder', payload: 'x', timestamp: 1, retryCount: 0 }]
    // 模拟「新实例已接管同键并落盘」
    mockMap['r5_292_queue'] = JSON.stringify(queued)
    mockMap['r5_292_queue_dead_letter'] = JSON.stringify(queued)
    manager.dispose()

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      manager.clearQueue()
      manager.clearDeadLetters()
      expect(mockMap['r5_292_queue']).toBeDefined()
      expect(mockMap['r5_292_queue_dead_letter']).toBeDefined()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('忽略 clearQueue'))
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('忽略 clearDeadLetters'))
    } finally {
      warnSpy.mockRestore()
      store.destroy()
    }
  })

  it('R5-292 对照：未释放实例的 clearQueue 仍会删除队列键', () => {
    const store = createStore({ name: 'r5-292b-store', state: { n: 1 } })
    const manager = new OfflineManager(store, 'r5_292b_queue')
    mockMap['r5_292b_queue'] = JSON.stringify([{ id: '1', type: 'a', payload: null, timestamp: 1, retryCount: 0 }])

    manager.clearQueue()

    expect(mockMap['r5_292b_queue']).toBeUndefined()
    expect(manager.getQueueLength()).toBe(0)
    manager.dispose()
    store.destroy()
  })

  it('R5-293 重放失败逐条留痕（不再只剩一条计数 toast）', async () => {
    const store = createStore({ name: 'r5-293-store', state: { n: 1 } })
    const manager = new OfflineManager(store, 'r5_293_queue')
    setOnline(manager, false)
    await manager.execute('notAnAction', async () => null)
    setOnline(manager, true)

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await manager.syncQueue()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('同步执行失败: notAnAction'), expect.anything())
    } finally {
      warnSpy.mockRestore()
      manager.dispose()
      store.destroy()
    }
  })

  it('R5-294 同步途中清空队列后，不再为已被清掉的操作弹「N个操作同步失败」', async () => {
    let release!: () => void
    const hanging = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    const store = createStore({ name: 'r5-294-store', state: { n: 1 } })
    ;(store.actions as Record<string, unknown>).hangThenFail = async () => {
      await hanging
      throw new Error('biz reject')
    }
    const manager = new OfflineManager(store, 'r5_294_queue')
    setOnline(manager, false)
    await manager.execute('hangThenFail', async () => null)
    setOnline(manager, true)

    const sync = manager.syncQueue()
    await flush()
    manager.clearQueue()
    release()
    await sync

    // 失败项落在已脱管的副本里、不会被保留，修复前按它计数会谎报「1个操作同步失败」
    expect(showToast).not.toHaveBeenCalled()
    expect(manager.getQueueLength()).toBe(0)
    manager.dispose()
    store.destroy()
  })

  it('R5-294 对照：未清空时按保留下来的失败数弹一次 toast', async () => {
    const store = createStore({ name: 'r5-294b-store', state: { n: 1 } })
    ;(store.actions as Record<string, unknown>).alwaysFail = async () => {
      throw new Error('biz reject')
    }
    const manager = new OfflineManager(store, 'r5_294b_queue')
    setOnline(manager, false)
    await manager.execute('alwaysFail', async () => null)
    setOnline(manager, true)

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await manager.syncQueue()
    } finally {
      warnSpy.mockRestore()
    }
    expect(showToast).toHaveBeenCalledWith({ title: '1个操作同步失败', icon: 'none' })
    expect(manager.getQueueLength()).toBe(1)
    manager.dispose()
    store.destroy()
  })

  it('R5-295 死信队列超限时告警淘汰条数，不再静默丢弃未处理操作', async () => {
    const seeded = Array.from({ length: 500 }, (_, i) => ({
      id: `d-${i}`,
      type: 'oldAction',
      payload: null,
      timestamp: 1,
      retryCount: 1,
    }))
    mockMap['r5_295_queue_dead_letter'] = JSON.stringify(seeded)

    const store = createStore({ name: 'r5-295-store', state: { n: 1 } })
    const manager = new OfflineManager(store, 'r5_295_queue', 1)
    setOnline(manager, false)
    await manager.execute('notAnAction', async () => null)
    setOnline(manager, true)

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await manager.syncQueue()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('淘汰最旧 1 条未处理操作'))
    } finally {
      warnSpy.mockRestore()
    }
    expect(manager.getDeadLetters()).toHaveLength(500)
    manager.dispose()
    store.destroy()
  })
})

// ==================== hot-update ====================

describe('initHotUpdate（R5-270 / R5-271 / R5-272）', () => {
  it('R5-270 onBeforeUpdate 抛错不再被误记成备份失败，也不阻断已确认的更新', () => {
    const store = createStore({ name: 'r5-270-store', state: { n: 1 } })
    const onBeforeUpdate = jest.fn(() => {
      throw new Error('report boom')
    })
    initHotUpdate({ store, onBeforeUpdate })
    applyUpdate.mockClear()

    updateListeners.ready?.()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => lastModal().success({ confirm: true })).not.toThrow()
      // 断言必须在 mockRestore 之前：Jest 30 的 restore 会连记录一起清空
      expect(onBeforeUpdate).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('onBeforeUpdate 回调执行失败'), expect.anything())
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('备份状态失败'), expect.anything())
    } finally {
      errorSpy.mockRestore()
    }

    // 备份与标记都已落盘，且更新照常执行
    expect(mockMap['store_backup_before_update_r5-270-store']).toBeDefined()
    expect(mockMap['store_backup_before_update_r5-270-store__pending_update_launch']).toBe('true')
    expect(applyUpdate).toHaveBeenCalledTimes(1)
    store.destroy()
  })

  it('R5-271 applyUpdate 抛错时按更新未生效成对清理标记与备份（R5-272）', () => {
    const store = createStore({ name: 'r5-271-store', state: { n: 1 } })
    initHotUpdate({ store })
    applyUpdate.mockImplementationOnce(() => {
      throw new Error('relaunch failed')
    })

    updateListeners.ready?.()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => lastModal().success({ confirm: true })).not.toThrow()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('applyUpdate 失败'), expect.anything())
    } finally {
      errorSpy.mockRestore()
    }

    // 修复前只写了标记没写清理：下一次普通冷启动被误判为「更新后首启」并回滚状态
    expect(mockMap['store_backup_before_update_r5-271-store']).toBeUndefined()
    expect(mockMap['store_backup_before_update_r5-271-store__pending_update_launch']).toBeUndefined()
    store.destroy()
  })

  it('R5-270 备份写入失败：不写标记，但用户确认的更新照常执行、宿主回调照常通知', () => {
    const store = createStore({ name: 'r5-270b-store', state: { n: 1 } })
    const onBeforeUpdate = jest.fn()
    initHotUpdate({ store, onBeforeUpdate })
    setStorageSync.mockImplementation((key: string, value: unknown) => {
      if (key === 'store_backup_before_update_r5-270b-store') throw new Error('quota exceeded')
      mockMap[key] = value
    })
    applyUpdate.mockClear()

    updateListeners.ready?.()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      lastModal().success({ confirm: true })
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('备份状态失败，本次更新不做状态恢复'), expect.anything())
    } finally {
      errorSpy.mockRestore()
      setStorageSync.mockImplementation((key: string, value: unknown) => {
        mockMap[key] = value
      })
    }

    expect(mockMap['store_backup_before_update_r5-270b-store__pending_update_launch']).toBeUndefined()
    expect(onBeforeUpdate).toHaveBeenCalledTimes(1)
    expect(applyUpdate).toHaveBeenCalledTimes(1)
    store.destroy()
  })
})

// ==================== wechat-enterprise ====================

describe('createEnterpriseApp（R5-282 / R5-283 / R5-284）', () => {
  async function enqueueOne(app: ReturnType<typeof createEnterpriseApp>): Promise<void> {
    const manager = app.getOfflineManager()
    if (!manager) throw new Error('离线管理器未初始化')
    setOnline(manager, false)
    await manager.execute('bump', async () => null)
    setOnline(manager, true)
  }

  it('R5-282 showLoading / hideLoading 抛错都不阻断同步，也不会把互斥标记永久卡死', async () => {
    mockMap['current_user_id'] = 'r5-282-user'
    const app = createEnterpriseApp()
    app.onLaunch()
    const store = app.getStore()
    expect(store).not.toBeNull()
    let replays = 0
    ;(store?.actions as Record<string, unknown>).bump = () => {
      replays += 1
    }
    showLoading.mockImplementation(() => {
      throw new Error('ui unavailable')
    })
    hideLoading.mockImplementation(() => {
      throw new Error('hide unavailable')
    })

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await enqueueOne(app)
      app.onShow()
      await flush()
      // 加载提示失败既没让同步被跳过，也没让 hideLoading 的抛错变成没人接的 rejection
      expect(replays).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('离线队列同步的加载提示失败'), expect.anything())
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('收起加载提示失败'), expect.anything())

      // 标记未卡在 true：下一次 onShow 仍会发起同步
      await enqueueOne(app)
      app.onShow()
      await flush()
      expect(replays).toBe(2)
    } finally {
      errorSpy.mockRestore()
      showLoading.mockImplementation(() => {})
      hideLoading.mockImplementation(() => {})
      app.logout()
    }
  })

  it('R5-283 login 换号后热更新注册仍复用同一份配置（onBeforeUpdate 不再被丢掉）', () => {
    mockMap['current_user_id'] = 'r5-283-a'
    const app = createEnterpriseApp()
    app.onLaunch()
    app.login('r5-283-b')
    applyUpdate.mockClear()

    updateListeners.ready?.()
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    try {
      lastModal().success({ confirm: true })
      // 修复前 login 路径只传 { store }：注册被整体覆盖，配置过的回调本次会话再也不触发
      // （断言写在 restore 之前：Jest 30 的 mockRestore 会连记录一起清空）
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('准备更新，状态已备份'))
    } finally {
      logSpy.mockRestore()
    }

    expect(mockMap['store_backup_before_update_user-store-r5-283-b']).toBeDefined()
    expect(applyUpdate).toHaveBeenCalledTimes(1)
    app.logout()
  })

  it('R5-284 switchUser 因无关原因抛错时保留持久化身份', () => {
    mockMap['current_user_id'] = 'r5-284-user'
    const spy = jest.spyOn(storeManager, 'switchUser').mockImplementation(() => {
      throw new Error('插件安装失败')
    })
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const app = createEnterpriseApp()

      expect(app.getStore()).toBeNull()
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('已保留持久化身份待下次启动重试'), expect.anything())
      // 修复前任何 switchUser 异常都会清键：一次瞬时故障即把用户强制登出、要重走认证
      expect(mockMap['current_user_id']).toBe('r5-284-user')
    } finally {
      spy.mockRestore()
      errorSpy.mockRestore()
      storeManager.clearAll()
    }
  })

  it('R5-284 持久化的是损坏标识（空/非字符串）时清键并按未登录处理', () => {
    for (const dirty of ['   ', JSON.stringify({ id: 1 })]) {
      Object.keys(mockMap).forEach((key) => delete mockMap[key])
      mockMap['current_user_id'] = dirty
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const app = createEnterpriseApp()

        expect(app.getStore()).toBeNull()
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('持久化的用户标识无效'))
        // 修复前只有「createUserStore 入口抛错」这一种成因，脏标识与瞬时故障无从区分
        expect(mockMap['current_user_id']).toBeUndefined()
      } finally {
        errorSpy.mockRestore()
        storeManager.clearAll()
      }
    }
  })
})
