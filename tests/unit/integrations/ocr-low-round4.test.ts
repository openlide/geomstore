/**
 * OCR low 第4轮 G3（src/integrations + src/plugins）回归
 *
 * 逐条锁定 .ocr-fix/groups/G3-integrations-plugins-low.md 中判定为 fix 的行为，
 * 并为判为 FP 的条目留下反证。用例名带 finding 编号。
 */

import { createStore } from '@/index.js'
import { storage } from '@/integrations/enterprise/env.js'
import { initHotUpdate } from '@/integrations/enterprise/hot-update.js'
import { StoreManager } from '@/integrations/enterprise/store-manager.js'
import { OfflineManager } from '@/integrations/enterprise/offline.js'
import { initBackgroundSync, unregisterBackgroundSync } from '@/integrations/enterprise/background-sync.js'
import { bindMappings } from '@/integrations/utils.js'
import { registerGlobalEntry } from '@/plugins/globalRegistry.js'
import { timeTravelPlugin } from '@/plugins/devtools/timeTravelPlugin.js'

// ==================== 可控 wx mock（Map 后端 + 可编程 updateManager） ====================

const mockMap: Record<string, unknown> = {}

let removeShouldThrow = false
const removeStorageSync = jest.fn((key: string) => {
  if (removeShouldThrow) throw new Error('remove boom')
  delete mockMap[key]
})
let rawStored: unknown = undefined
const getStorageSync = jest.fn((key: string) => (key === '__raw__' ? rawStored : mockMap[key]))

const networkListeners: Array<(res: { isConnected?: boolean }) => void> = []
const getNetworkType = jest.fn((options: { success?: (res: { networkType: string }) => void }) => {
  options.success?.({ networkType: 'wifi' })
})

/** #328：宿主交替返回两个「稳定的」manager 实例（真实环境是全局单例，
 *  这里验证的是实例交替时旧实例不被重复安装），每个实例记录自己收到的监听数 */
interface FakeManager {
  onUpdateReady: (cb: () => void) => void
  onUpdateFailed: (cb: () => void) => void
  applyUpdate: () => void
  readyListeners: number
  failedListeners: number
}
function createFakeManager(): FakeManager {
  const manager = {
    readyListeners: 0,
    failedListeners: 0,
    applyUpdate: () => {},
  } as unknown as FakeManager
  manager.onUpdateReady = (_cb: () => void) => {
    manager.readyListeners += 1
  }
  manager.onUpdateFailed = (_cb: () => void) => {
    manager.failedListeners += 1
  }
  return manager
}
let managerPool: FakeManager[] = [createFakeManager()]
let managerCursor = 0
const getUpdateManager = jest.fn(() => {
  const manager = managerPool[managerCursor % managerPool.length]
  managerCursor += 1
  return manager
})

;(globalThis as { wx?: unknown }).wx = {
  setStorageSync: jest.fn((key: string, value: unknown) => {
    mockMap[key] = value
  }),
  getStorageSync,
  removeStorageSync,
  request: jest.fn(),
  onNetworkStatusChange: jest.fn((callback: (res: { isConnected?: boolean }) => void) => {
    networkListeners.push(callback)
  }),
  offNetworkStatusChange: jest.fn(),
  getNetworkType,
  getUpdateManager,
  showModal: jest.fn(),
  showToast: jest.fn(),
  showLoading: jest.fn(),
  hideLoading: jest.fn(),
}

beforeEach(() => {
  Object.keys(mockMap).forEach((key) => delete mockMap[key])
  networkListeners.length = 0
  removeShouldThrow = false
  rawStored = undefined
  managerCursor = 0
  jest.clearAllMocks()
})

// ==================== hot-update ====================

describe('#328 热更新监听按 manager 实例幂等安装', () => {
  it('宿主交替返回两个 manager 时，同一实例不被重复安装监听', () => {
    managerPool = [createFakeManager(), createFakeManager()]
    const storeA = createStore({ name: 'hu-328-a', state: { n: 1 } })
    const storeB = createStore({ name: 'hu-328-b', state: { n: 2 } })

    initHotUpdate({ store: storeA }) // 安装到 pool[0]
    initHotUpdate({ store: storeB }) // 安装到 pool[1]
    initHotUpdate({ store: storeA }) // 回到 pool[0]
    initHotUpdate({ store: storeB }) // 回到 pool[1]

    // 修复前只记「最近一个实例」：回到旧实例会被判为未安装而再注册一份累加式监听，
    // 一次更新即弹出多个模态、备份多份
    expect(managerPool[0].readyListeners).toBe(1)
    expect(managerPool[0].failedListeners).toBe(1)
    expect(managerPool[1].readyListeners).toBe(1)
    expect(managerPool[1].failedListeners).toBe(1)
  })
})

// ==================== env storage ====================

describe('#330 storage.get 的缺失键判定', () => {
  it('空串 / undefined / null 视为键不存在，返回 null', () => {
    for (const raw of ['', undefined, null]) {
      rawStored = raw
      expect(storage.get('__raw__')).toBeNull()
    }
  })

  it('外部写入的原始 0 / false 不再被当作缺失键（显式判空而非真值判定）', () => {
    rawStored = 0
    expect(storage.get<number>('__raw__')).toBe(0)
    rawStored = false
    expect(storage.get<boolean>('__raw__')).toBe(false)
  })
})

describe('#333 storage.remove 返回删除结果', () => {
  it('删除成功返回 true，抛错时返回 false 并记日志', () => {
    mockMap['k-333'] = '"v"'
    expect(storage.remove('k-333')).toBe(true)
    expect(mockMap['k-333']).toBeUndefined()

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    removeShouldThrow = true
    try {
      expect(storage.remove('k-333')).toBe(false)
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('删除 storage 失败'), expect.anything())
    } finally {
      removeShouldThrow = false
      errorSpy.mockRestore()
    }
  })
})

// ==================== StoreManager ====================

describe('#341 空串身份不可达（FP 佐证）', () => {
  it('空/纯空白 userId 在入口抛错，currentUserId 只能是 null 或非空串', () => {
    const manager = new StoreManager()

    expect(() => manager.getUserStore('')).toThrow(/userId 不能为空/)
    expect(() => manager.switchUser('')).toThrow(/userId 不能为空/)
    expect(() => manager.switchUser('   ')).toThrow(/userId 不能为空/)

    // 身份从未被写成空串 → logout 的 `!currentUserId` 与 `currentUserId === null` 等价
    expect(manager.getCurrentStore()).toBeNull()
    expect(() => manager.logout()).not.toThrow()

    const store = manager.switchUser('u-341')
    mockMap['user-store-u-341'] = JSON.stringify({ userInfo: { id: 'u-341' } })
    mockMap['current_user_id'] = 'u-341'
    manager.logout()
    expect(store.destroyed).toBe(true)
    expect(mockMap['user-store-u-341']).toBeUndefined()
    expect(mockMap['current_user_id']).toBeUndefined()
  })
})

// ==================== integrations/utils ====================

describe('#344 初始映射值全空时不触发 setter', () => {
  it('全部映射值为 undefined：一次 setter 都不调', () => {
    const setter = jest.fn()
    const store = createStore({ name: 'bind-344', state: { a: undefined as unknown, b: undefined as unknown } })

    const unbinds = bindMappings(
      {},
      { localA: 'a', localB: 'b' },
      (key) => store.state[key as 'a' | 'b'],
      setter,
      (callback) => {
        callback()
        return () => {}
      },
    )

    expect(setter).not.toHaveBeenCalled()
    unbinds.forEach((fn) => fn())
  })

  it('存在有值键时仍按一次批量调用下发', () => {
    const setter = jest.fn()
    const store = createStore({ name: 'bind-344b', state: { a: 1 as unknown, b: undefined as unknown } })

    const unbinds = bindMappings(
      {},
      { localA: 'a', localB: 'b' },
      (key) => store.state[key as 'a' | 'b'],
      setter,
      (callback) => {
        callback()
        return () => {}
      },
    )

    expect(setter).toHaveBeenCalledTimes(1)
    expect(setter).toHaveBeenCalledWith({ localA: 1 })
    unbinds.forEach((fn) => fn())
  })
})

// ==================== offline ====================

describe('#354 dispose 后 execute 不再静默入队', () => {
  it('已释放实例：告警 + 不入队，返回值仍为 null', async () => {
    const store = createStore({ name: 'offline-354', state: { n: 0 } })
    const manager = new OfflineManager(store, 'queue-354')
    networkListeners.forEach((l) => l({ isConnected: false }))
    manager.dispose()

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = await manager.execute('anyAction', async () => 1)
      expect(result).toBeNull()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('实例已释放'))
      // 修复前：入队并打「操作已缓存（离线）」，而 saveQueue 短路 → 只活在内存里、
      // 既不落盘也永不同步，getQueueLength 还在报数
      expect(manager.getQueueLength()).toBe(0)
      expect(mockMap['queue-354']).toBeUndefined()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe('#353 getDeadLetters 与 loadQueue 同口径过滤损坏条目', () => {
  it('死信键中的 null/字符串/缺字段条目不返回，并告警丢弃条数', () => {
    const store = createStore({ name: 'offline-353', state: { n: 0 } })
    const manager = new OfflineManager(store, 'queue-353')
    const good = { id: '1', type: 'submitOrder', payload: 1, timestamp: 1, retryCount: 3 }
    mockMap['queue-353_dead_letter'] = JSON.stringify([null, 'broken', { type: 'noRetryCount' }, good])

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(manager.getDeadLetters()).toEqual([good])
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('死信队列包含损坏条目'))
    } finally {
      warnSpy.mockRestore()
    }
  })
})

// ==================== background-sync ====================

describe('#357 同一 options 二次进入 App 不叠加包装', () => {
  it('第二次 App(同一 config) 后 onShow 仍只跑一轮时效性检查', () => {
    const originalApp = (globalThis as { App?: unknown }).App
    ;(globalThis as { App?: unknown }).App = function App(options: Record<string, unknown> = {}) {
      return options
    }
    const callApp = (options: Record<string, unknown>) =>
      (globalThis as unknown as { App: (o: Record<string, unknown>) => { onShow: () => void } }).App(options)

    const store = createStore({
      name: 'bg-357',
      state: { refreshed: 0 },
      actions: {
        refreshData() {
          const state = this.state as { refreshed: number }
          state.refreshed += 1
        },
      },
    })
    initBackgroundSync({ store, maxInactiveTime: -1 })

    const config: Record<string, unknown> = {}
    callApp(config).onShow()
    expect(store.state.refreshed).toBe(1)

    // 宿主缓存同一份 config 再注册一次（热重载 / 测试重复调用）
    callApp(config).onShow()
    // 修复前此处为 3：二次包装把上一轮的检查也带进来了
    expect(store.state.refreshed).toBe(2)

    unregisterBackgroundSync(store)
    ;(globalThis as { App?: unknown }).App = originalApp
  })
})

describe('#358 refreshData 守卫只认自有属性', () => {
  it('原型链上的同名 action 不放行，且不产生 dispatch 失败日志', () => {
    const originalApp = (globalThis as { App?: unknown }).App
    ;(globalThis as { App?: unknown }).App = function App(options: Record<string, unknown> = {}) {
      return options
    }

    const store = createStore({ name: 'bg-358', state: { refreshed: 0 } })
    const inherited = jest.fn()
    // refreshData 只存在于 actions 的原型链上：`in` 会命中它，自有属性判定不会
    ;(store as unknown as { actions: unknown }).actions = Object.create({ refreshData: inherited })
    initBackgroundSync({ store, maxInactiveTime: -1 })

    const appOptions = (globalThis as unknown as { App: (o: Record<string, unknown>) => { onShow: () => void } }).App({})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      appOptions.onShow()
      expect(inherited).not.toHaveBeenCalled()
      // 修复前 `in` 命中继承成员 → 放行 dispatch → ACTION_NOT_FOUND 被记成刷新失败
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('刷新状态失败'), expect.anything())
    } finally {
      errorSpy.mockRestore()
    }

    unregisterBackgroundSync(store)
    ;(globalThis as { App?: unknown }).App = originalApp
  })
})

// ==================== plugins/globalRegistry ====================

describe('#365 全局表最后一个条目卸载后回收容器', () => {
  it('仍有其它条目时保留容器，清空后摘掉键', () => {
    const g = globalThis as unknown as Record<string, Record<string, unknown> | undefined>
    delete g.__OCR_LOW_365__

    const unA = registerGlobalEntry('__OCR_LOW_365__', 'store-a', { id: 'a' })
    const unB = registerGlobalEntry('__OCR_LOW_365__', 'store-b', { id: 'b' })
    const table = g.__OCR_LOW_365__ as unknown as Record<string, unknown>

    unA()
    expect(g.__OCR_LOW_365__).toBe(table)
    expect(Object.keys(table)).toEqual(['store-b'])

    unB()
    // 修复前后条目都不可见；差别是此处不再留下空表占住全局键位
    expect(g.__OCR_LOW_365__).toBeUndefined()
  })
})

describe('#366 registerGlobalEntry 内置生产守卫', () => {
  it('生产模式下不向 globalThis 写入任何条目（fail-safe）', async () => {
    const prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      await jest.isolateModulesAsync(async () => {
        const mod = await import('@/plugins/globalRegistry.js')
        const unregister = mod.registerGlobalEntry('__OCR_LOW_366__', 'store-x', { id: 'x' })
        expect((globalThis as Record<string, unknown>).__OCR_LOW_366__).toBeUndefined()
        expect(typeof unregister).toBe('function')
        expect(() => unregister()).not.toThrow()
      })
    } finally {
      process.env.NODE_ENV = prevEnv
    }
  })
})

// ==================== plugins/devtools/timeTravel ====================

interface TimeTravelApi {
  getSnapshots: () => Array<Record<string, unknown>>
  getSnapshotCount: () => number
  getCurrentIndex: () => number
  goTo: (index: number) => void
  undo: () => void
  redo: () => void
  record: () => void
  exportHistory: () => string
  importHistory: (json: string) => void
}

const installTimeTravel = (name: string): { api: TimeTravelApi } => {
  const store = createStore({ name, state: { v: 0 } })
  store.use(timeTravelPlugin({ maxSize: 50 }))
  const api = (store as unknown as { __timeTravel__: TimeTravelApi }).__timeTravel__
  return { api }
}

describe('#378 回放抛错时不推进 currentIndex', () => {
  it('$replaceState 抛错后索引仍指向真实状态所在快照', () => {
    const store = createStore({ name: 'tt-378', state: { v: 0 } })
    store.use(timeTravelPlugin({ maxSize: 50, autoRecord: false }))
    const api = (store as unknown as { __timeTravel__: TimeTravelApi }).__timeTravel__

    api.record()
    expect(api.getCurrentIndex()).toBe(1)

    // 用抛错的 $replaceState 模拟「store 已销毁 / 快照状态非法」：
    // destroy() 会先跑插件卸载（清空快照与索引），不能直接用来制造抛出
    const replaceSpy = jest.spyOn(store, '$replaceState').mockImplementation(() => {
      throw new TypeError('[GeomStore] $replaceState: newState must be a plain object')
    })
    try {
      expect(() => api.undo()).toThrow(/must be a plain object/)
      // 修复前索引已被改成 0：与仍是旧状态的活状态失步，
      // 之后 recordSnapshot 会以该索引为分支点截断 redo 历史
      expect(api.getCurrentIndex()).toBe(1)

      expect(() => api.goTo(0)).toThrow(/must be a plain object/)
      expect(api.getCurrentIndex()).toBe(1)
      // 抛出的那次回放没有将历史分支点挪走：canRedo 仍按索引 1 判定
      expect(api.getSnapshotCount()).toBe(2)
    } finally {
      replaceSpy.mockRestore()
    }
  })
})

describe('#379/#380 importHistory 的大输入与索引语义', () => {
  it('#380 先按完整输入钳制再按 overflow 偏移：导入 index=90 / 100 条 → 40', () => {
    const { api } = installTimeTravel('tt-380')
    const snapshots = Array.from({ length: 100 }, (_, i) => ({ state: { v: i }, timestamp: 1700000000000 + i }))
    api.importHistory(JSON.stringify({ snapshots, currentIndex: 90 }))

    expect(api.getSnapshotCount()).toBe(50)
    expect(api.getCurrentIndex()).toBe(40)
  })

  it('#379 超出 V8 实参上限的历史不再让导入崩溃', () => {
    jest.setTimeout(30000)
    const { api } = installTimeTravel('tt-379')
    const total = 200000
    const snapshots = Array.from({ length: total }, (_, i) => ({ state: { v: i }, timestamp: 1700000000000 + (i % 1000) }))
    const json = JSON.stringify({ snapshots, currentIndex: total - 1 })

    // 修复前 push(...valid) 以展开传参实参超限抛 RangeError:
    // Maximum call stack size exceeded
    expect(() => api.importHistory(json)).not.toThrow()
    expect(api.getSnapshotCount()).toBe(50)
    expect(api.getCurrentIndex()).toBe(49)
    jest.setTimeout(10000)
  })
})
