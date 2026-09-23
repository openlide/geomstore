/**
 * 第六轮 f1-08 分片的回归锁（企业级方案：storage 编解码 / 热更新 / 离线队列）
 *
 * 覆盖 R6-053（字符串读写闭环）、R6-054（热更新备份的容器编解码）、
 * R6-055（入队与收尾的自驱动重放）、R6-103（UI 反馈不污染同步结果）、
 * R6-104（网络监听注册顺序）。
 */

import { createStore } from '@/index.js'
import { storage } from '@/integrations/enterprise/env.js'
import { initHotUpdate, restoreFromHotUpdate } from '@/integrations/enterprise/hot-update.js'
import { OfflineManager } from '@/integrations/enterprise/offline.js'
import type { Store, State } from '@/types/store.js'

const rawStore: Record<string, unknown> = {}
let networkListeners: Array<(res: { isConnected: boolean }) => void> = []

const mockWx = {
  setStorageSync: (key: string, value: unknown) => {
    rawStore[key] = value
  },
  getStorageSync: (key: string) => rawStore[key],
  removeStorageSync: (key: string) => {
    delete rawStore[key]
  },
  onNetworkStatusChange: (callback: (res: { isConnected: boolean }) => void) => {
    networkListeners.push(callback)
  },
  offNetworkStatusChange: (callback: (res: { isConnected: boolean }) => void) => {
    networkListeners = networkListeners.filter((listener) => listener !== callback)
  },
  getNetworkType: (options: { success: (res: { networkType: string }) => void }) => {
    options.success({ networkType: 'wifi' })
  },
  request: () => {},
  showModal: (options: { success?: (res: { confirm: boolean }) => void }) => {
    options.success?.({ confirm: true })
  },
  showToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  getUpdateManager: () => ({ onUpdateReady: () => {}, onUpdateFailed: () => {}, applyUpdate: () => {} }),
}

;(globalThis as { wx?: unknown }).wx = mockWx

/** 等几轮宏任务，让 scheduleResync 排在微任务里的重放跑完（含其自身的落盘与再调度） */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * `OfflineManager<S>` 对 S 是**不变**的（`store.getters` 里的 S 同时出现在读写位，
 * 见 src/integrations/enterprise/offline.ts 的 `class OfflineManager<S extends State = State>`）：
 * 下面这些用例的 store 都写成 `createStore({ state: { x: 0 } })`，实例化出来就是
 * `OfflineManager<{ x: number }>`。接收侧（holder 字段、辅助函数返回类型）必须落到同一个 S，
 * 不能图省事留默认值 `OfflineManager`（= `OfflineManager<State>`）——那是另一个不变类型，
 * 编译器按「`{}` 上缺 `x`」直接拒掉。
 */
type OfflineManagerForX = OfflineManager<{ x: number }>

/** 让实例进入离线态：execute 只入队、不自驱（自驱只在在线时有意义） */
function goOffline(): void {
  networkListeners.forEach((listener) => listener({ isConnected: false }))
}

function goOnline(): void {
  networkListeners.forEach((listener) => listener({ isConnected: true }))
}

/** 每个测试装一个全新的 updateManager mock：监听安装按实例幂等 */
function armUpdateManager(onReady: (cb: () => void) => void): void {
  const bag = mockWx as unknown as { getUpdateManager: () => unknown }
  bag.getUpdateManager = () => ({
    onUpdateReady: onReady,
    onUpdateFailed: () => {},
    applyUpdate: () => {},
  })
}

describe('R6-053 storage 的字符串读写闭环', () => {
  beforeEach(() => {
    Object.keys(rawStore).forEach((key) => delete rawStore[key])
  })

  it.each(['null', '"abc"', '{"a":1}', '[1,2]', 'true', '1001', 'app-user-2', '{}', 'undefined', 'NaN'] as string[])(
    'set→get 对字符串 %s 类型无损',
    (value) => {
      storage.set('k', value)
      const read = storage.get<string>('k')
      expect(typeof read).toBe('string')
      expect(read).toBe(value)
    },
  )

  it('普通字符串仍以裸文本落盘（既有存储格式不变，外部读方看到的形状不变）', () => {
    storage.set('current_user_id', 'app-user-2')
    expect(rawStore['current_user_id']).toBe('app-user-2')

    // 只有「会被 get 读成另一种值」的字符串才套引号信封
    storage.set('current_user_id', 'null')
    expect(rawStore['current_user_id']).toBe('"null"')
    expect(storage.get<string>('current_user_id')).toBe('null')
  })

  it('报告里的真实触发链：id 为 null 时 switchUser(String(id)) 写入的字符串不再被读成未登录', () => {
    // 宿主常写 `String(res.userInfo?.id)`：id 缺失即得到字符串 'null'
    const userInfo: { id: number | null } = { id: null }
    storage.set('current_user_id', String(userInfo.id))
    // 修复前：get 返回 null，冷启动据此按「未登录」整轮跳过初始化（热更新/前台同步/离线管理器都不建）
    expect(storage.get<string>('current_user_id')).toBe('null')
  })

  it('对象与数字/布尔的既有口径不变（number/boolean 读回原始字符串是刻意契约）', () => {
    storage.set('obj', { a: [1, 2], b: { x: 1 }, s: 'text' })
    expect(storage.get('obj')).toEqual({ a: [1, 2], b: { x: 1 }, s: 'text' })

    storage.set('num', 1001)
    expect(storage.get('num')).toBe('1001')
    storage.set('bool', false)
    expect(storage.get('bool')).toBe('false')
  })

  it('历史裸值仍可读取（新格式向后兼容）', () => {
    rawStore['legacy'] = 'null'
    expect(storage.get('legacy')).toBeNull()
    rawStore['legacy2'] = '1001'
    expect(storage.get('legacy2')).toBe('1001')
  })
})

describe('R6-054 热更新备份的容器编解码', () => {
  beforeEach(() => {
    Object.keys(rawStore).forEach((key) => delete rawStore[key])
    networkListeners = []
  })

  /** 走真实的 onUpdateReady → 用户确认 → backupState 路径，而不是手搓备份 */
  function backupViaHotUpdate<S extends State>(store: Store<S>, backupKey: string): void {
    let ready: (() => void) | undefined
    armUpdateManager((cb) => {
      ready = cb
    })
    initHotUpdate({ store, backupKey })
    ready?.()
  }

  it('Map/Set/Date/RegExp 备份重启后仍是原类型实例（不再被换成空壳对象）', () => {
    const source = createStore({
      name: 'hot-containers',
      state: {
        selected: new Set<string>(['a', 'b']),
        meta: new Map<string, number>([['x', 1]]),
        deadline: new Date(1700000000000),
        pattern: /ab+/g,
      },
    })
    const backupKey = 'backup_hot-containers'
    backupViaHotUpdate(source, backupKey)

    // 备份落盘的确实不再是 JSON.stringify 折叠后的空壳
    const stored = JSON.parse(String(rawStore[backupKey])) as { state: { selected: unknown } }
    expect(stored.state.selected).toEqual({ '#gs': 's', v: ['a', 'b'] })

    const restarted = createStore({
      name: 'hot-containers-restarted',
      state: {
        selected: new Set<string>(),
        meta: new Map<string, number>(),
        deadline: new Date(0),
        pattern: /noop/,
      },
    })

    expect(restoreFromHotUpdate(restarted, backupKey)).toBe(true)
    const state = restarted.getState()
    expect(state.selected instanceof Set).toBe(true)
    expect([...state.selected]).toEqual(['a', 'b'])
    expect(state.meta instanceof Map).toBe(true)
    expect(state.meta.get('x')).toBe(1)
    expect(state.deadline instanceof Date).toBe(true)
    expect(state.deadline.getTime()).toBe(1700000000000)
    expect(state.pattern instanceof RegExp).toBe(true)
    expect(state.pattern.source).toBe('ab+')
    expect(state.pattern.flags).toBe('g')
  })

  it('业务侧调用 .has() / .getTime() 不再 TypeError（报告里的真实故障形状）', () => {
    const source = createStore({ name: 'hot-callers', state: { ids: new Set<number>([7]), at: new Date(5) } })
    const backupKey = 'backup_hot-callers'
    backupViaHotUpdate(source, backupKey)

    const restarted = createStore({ name: 'hot-callers-restarted', state: { ids: new Set<number>(), at: new Date(0) } })
    expect(restoreFromHotUpdate(restarted, backupKey)).toBe(true)

    const { ids, at } = restarted.getState()
    expect(ids.has(7)).toBe(true)
    expect(at.getTime()).toBe(5)
  })

  it('undefined / NaN / ±Infinity / -0 / BigInt 与自带标记键的对象都能无损往返', () => {
    const source = createStore({
      name: 'hot-scalars',
      state: {
        nothing: undefined,
        nan: Number.NaN,
        inf: Number.POSITIVE_INFINITY,
        ninf: Number.NEGATIVE_INFINITY,
        minusZero: -0,
        big: 12345678901234567890n,
        marked: { '#gs': 'd', v: 5 } as Record<string, unknown>,
      },
    })
    const backupKey = 'backup_hot-scalars'
    backupViaHotUpdate(source, backupKey)

    const restarted = createStore({
      name: 'hot-scalars-restarted',
      state: {
        nothing: 'placeholder',
        nan: 0,
        inf: 0,
        ninf: 0,
        minusZero: 0,
        big: 0n,
        marked: {} as Record<string, unknown>,
      },
    })
    expect(restoreFromHotUpdate(restarted, backupKey)).toBe(true)
    const state = restarted.getState()
    expect(state.nothing).toBeUndefined()
    expect(Number.isNaN(state.nan)).toBe(true)
    expect(state.inf).toBe(Number.POSITIVE_INFINITY)
    expect(state.ninf).toBe(Number.NEGATIVE_INFINITY)
    expect(Object.is(state.minusZero, -0)).toBe(true)
    expect(state.big).toBe(12345678901234567890n)
    // 用户数据自带 '#gs' 键：信封是单射的，读回来仍是那两个字面值属性
    expect(state.marked).toEqual({ '#gs': 'd', v: 5 })
  })

  it('类实例按「有损但可用」处理：备份带 lossy 清单，恢复侧留痕', () => {
    class Order {
      constructor(
        readonly id: string,
        readonly total: number,
      ) {}
    }
    const source = createStore({ name: 'hot-lossy', state: { order: new Order('o-1', 20) } })
    const backupKey = 'backup_hot-lossy'
    backupViaHotUpdate(source, backupKey)

    const stored = JSON.parse(String(rawStore[backupKey])) as { lossy?: string[] }
    expect(stored.lossy).toEqual(['state.order（类实例 Order，恢复后原型丢失）'])

    const restarted = createStore({ name: 'hot-lossy-restarted', state: { order: null as Order | null } })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(restoreFromHotUpdate(restarted, backupKey)).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('本次为有损恢复'), expect.anything())
    } finally {
      warnSpy.mockRestore()
    }

    const order = restarted.getState().order as unknown as { id: string; total: number }
    expect(order.id).toBe('o-1')
    expect(order.total).toBe(20)
  })

  it('旧格式备份（无标记的普通 JSON）仍可恢复，行为与改造前一致', () => {
    const backupKey = 'backup_legacy_store'
    rawStore[backupKey] = JSON.stringify({ timestamp: Date.now(), state: { counter: 9, list: [1, 2] }, version: '0.6.1' })
    rawStore[`${backupKey}__pending_update_launch`] = JSON.stringify(true)
    const restarted = createStore({ name: 'legacy-store', state: { counter: 0, list: [] as number[] } })

    expect(restoreFromHotUpdate(restarted, backupKey)).toBe(true)
    expect(restarted.getState()).toEqual({ counter: 9, list: [1, 2] })
  })
})

describe('R6-055 离线队列的自驱动重放', () => {
  beforeEach(() => {
    Object.keys(rawStore).forEach((key) => delete rawStore[key])
    networkListeners = []
  })

  it('在线执行失败后无需任何外部事件即被重放', async () => {
    let replays = 0
    const store = createStore({
      name: 'auto-replay',
      state: { x: 0 },
      actions: {
        submit(): void {
          replays++
        },
      },
    })
    const manager = new OfflineManager(store, 'q-auto', 5)

    // 服务端 5xx：execute 记日志后入队并返回 null（契约：失败不外抛）
    await expect(manager.execute('submit', async () => Promise.reject(new Error('500 internal error')))).resolves.toBeNull()

    // 全程没有网络状态变化、没有 App.onShow、没有手动 syncQueue
    await flush()
    // 修复前：replays 恒为 0——入队之后没有任何自驱动触发点，这条操作永远留在队列里
    expect(replays).toBe(1)
    expect(manager.getQueueLength()).toBe(0)
    manager.dispose()
  })

  it('全部失败且未到重试上限时不无限自驱（止损点）', async () => {
    let replays = 0
    const store = createStore({
      name: 'auto-stop',
      state: { x: 0 },
      actions: {
        always(): void {
          replays++
          throw new Error('still down')
        },
      },
    })
    const manager = new OfflineManager(store, 'q-stop', 5)

    await manager.execute('always', async () => Promise.reject(new Error('still down')))
    await flush()

    // 只补跑一轮（retryCount 1/5），此后因「本轮无推进」停住，等外部事件或手动 syncQueue
    expect(replays).toBe(1)
    expect(manager.getQueueLength()).toBe(1)
    manager.dispose()
  })

  it('一轮同步进行中新入队的操作，由该轮收尾补跑', async () => {
    // 用可写盒子而不是 `let manager!`：action 闭包要在构造之前引用到实例
    const holder: { manager: OfflineManagerForX | null } = { manager: null }
    let innerRuns = 0
    const store = createStore({
      name: 'q-inflight',
      state: { x: 0 },
      actions: {
        async outer(): Promise<void> {
          // 本轮同步进行中（syncing 为真）入队一条：此刻起不了新的轮，只能记一次标记
          await holder.manager?.execute('inner', async () => Promise.reject(new Error('in-flight failure')))
        },
        inner(): void {
          innerRuns++
        },
      },
    })
    const manager = new OfflineManager(store, 'q-inflight', 3)
    holder.manager = manager
    goOffline()
    await manager.execute('outer', async () => Promise.reject(new Error('offline at first')))
    expect(manager.getQueueLength()).toBe(1)

    // 网络恢复触发本轮：outer 在轮内入队 inner，收尾必须补跑一轮把它带走
    goOnline()
    await flush()

    expect(innerRuns).toBe(1)
    expect(manager.getQueueLength()).toBe(0)
    manager.dispose()
  })

  it('重试耗尽仍按原口径落死信并回调 onDrop，离线入队不自驱', async () => {
    const dropped: string[] = []
    const store = createStore({
      name: 'q-dead',
      state: { x: 0 },
      actions: {
        boom(): void {
          throw new Error('nope')
        },
      },
    })
    const manager = new OfflineManager(store, 'q-dead', 1, (action) => dropped.push(action.type))
    goOffline()

    await manager.execute('boom', async () => Promise.reject(new Error('nope')))
    expect(manager.getQueueLength()).toBe(1)
    await flush()
    // 离线态不起跑（外部事件仍由网络恢复回调 / App.onShow 负责）
    expect(dropped).toEqual([])

    goOnline()
    await flush()
    expect(dropped).toEqual(['boom'])
    expect(manager.getDeadLetters()).toHaveLength(1)
    manager.dispose()
  })
})

describe('R6-103 UI 反馈失败不得升级成同步失败', () => {
  const wxBag = mockWx as unknown as Record<string, unknown>

  beforeEach(() => {
    Object.keys(rawStore).forEach((key) => delete rawStore[key])
    networkListeners = []
  })
  afterEach(() => {
    wxBag.showToast = () => {}
  })

  /** 造一个「本轮有失败项」的队列：收尾时必然走到那条 showToast */
  async function managerWithFailedItem(name: string): Promise<OfflineManagerForX> {
    const store = createStore({
      name,
      state: { x: 0 },
      actions: {
        fail(): void {
          throw new Error('dispatch failed')
        },
      },
    })
    const manager = new OfflineManager(store, `q-${name}`, 5)
    goOffline()
    await manager.execute('fail', async () => Promise.reject(new Error('first failure')))
    return manager
  }

  it('showToast 抛错时 syncQueue 正常完成，只损失提示', async () => {
    const manager = await managerWithFailedItem('toast-throw')
    wxBag.showToast = () => {
      throw new Error('showToast boom：页面栈为空')
    }

    // 修复前：这条 toast 异常沿 syncQueue 变成 rejection，被两个调用方读成「同步失败」
    await expect(manager.syncQueue()).resolves.toBeUndefined()
    expect(manager.getQueueLength()).toBe(1)
    manager.dispose()
  })

  it('宿主根本没有 showToast 时同样不外抛', async () => {
    const manager = await managerWithFailedItem('toast-missing')
    delete wxBag.showToast

    await expect(manager.syncQueue()).resolves.toBeUndefined()
    manager.dispose()
  })
})

describe('R6-104 网络监听注册顺序', () => {
  const wxBag = mockWx as unknown as Record<string, unknown>
  const originalProbe = wxBag.getNetworkType

  beforeEach(() => {
    Object.keys(rawStore).forEach((key) => delete rawStore[key])
    networkListeners = []
  })
  afterEach(() => {
    wxBag.getNetworkType = originalProbe
  })

  it('宿主探测抛错时不再留下永远无法撤销的网络监听', () => {
    wxBag.getNetworkType = () => {
      throw new TypeError('wx.getNetworkType is not a function')
    }
    const store = createStore({ name: 'listener-leak', state: { x: 0 } })

    expect(() => new OfflineManager(store, 'q-leak')).toThrow(TypeError)
    // 修复前：先注册后探测 → 构造失败但监听已挂在宿主持有的闭包上，
    // dispose 永无机会被调用，账号每切换一次再漏一个
    expect(networkListeners).toHaveLength(0)
  })

  it('探测正常时监听仍如期注册，网络恢复会触发同步', async () => {
    let runs = 0
    const store = createStore({
      name: 'listener-ok',
      state: { x: 0 },
      actions: {
        ok(): void {
          runs++
        },
      },
    })
    const manager = new OfflineManager(store, 'q-ok')
    expect(networkListeners).toHaveLength(1)

    goOffline()
    await manager.execute('ok', async () => Promise.reject(new Error('offline')))
    goOnline()
    await flush()
    expect(runs).toBe(1)
    manager.dispose()
    expect(networkListeners).toHaveLength(0)
  })
})
