/**
 * 第五轮 integrations-p1 回归：后台/前台状态同步
 *
 * 锁定 R5-248（不可写 options 不得让 App 启动失败）、R5-249（App 未就位时处理器仍登记并留痕）、
 * R5-250（回调重入注销的处理器不得在同一轮继续被回调）。
 */

import { ensureAppLifecycleHooks, initBackgroundSync, unregisterBackgroundSync } from '@/integrations/enterprise/background-sync.js'
import type { Store } from '@/types/store.js'

interface FakeStore {
  name: string
  destroyed: boolean
  actions: Record<string, unknown>
  dispatch: jest.Mock
}

function fakeStore(name: string): FakeStore {
  return { name, destroyed: false, actions: {}, dispatch: jest.fn() }
}

const registered: FakeStore[] = []
const originalApp = (globalThis as { App?: unknown }).App

function installAppStub(): void {
  const g = globalThis as { App?: unknown }
  g.App = function App(options: Record<string, unknown> = {}) {
    return options
  }
}

function asStore(store: FakeStore): Store {
  return store as unknown as Store
}

/** 以宿主身份调用当前全局 App（可能已被本模块换成包装函数） */
function callApp(options?: unknown): Record<string, unknown> {
  return (globalThis as unknown as { App: (o?: unknown) => Record<string, unknown> }).App(options)
}

afterEach(() => {
  registered.splice(0).forEach((store) => unregisterBackgroundSync(asStore(store)))
  ;(globalThis as { App?: unknown }).App = originalApp
})

describe('R5-248 不可写的 options 不得让 App(options) 启动失败', () => {
  it('冻结的 options：不抛错、配置原样交给宿主、用户回调未被改写', () => {
    installAppStub()
    const store = fakeStore('r5-248-frozen')
    registered.push(store)
    initBackgroundSync({ store: asStore(store), maxInactiveTime: -1 })

    const userOnShow = jest.fn()
    const frozen = Object.freeze({ onShow: userOnShow })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(() => callApp(frozen)).not.toThrow()
      // 注入被放弃：宿主拿到的是同一个（未被改写的）配置对象
      expect(frozen.onShow).toBe(userOnShow)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('跳过该侧后台同步包装'), expect.anything())
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('onShow 为只读访问器时同样不抛错（赋值走 setter 缺失路径）', () => {
    installAppStub()
    const store = fakeStore('r5-248-accessor')
    registered.push(store)
    initBackgroundSync({ store: asStore(store), maxInactiveTime: -1 })

    const options: Record<string, unknown> = { onHide: jest.fn() }
    Object.defineProperty(options, 'onShow', { get: () => undefined })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      expect(() => callApp(options)).not.toThrow()
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('跳过该侧后台同步包装'), expect.anything())
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('对照：可写的 options 仍被正常包装（用户回调在检查之后执行）', () => {
    installAppStub()
    const store = fakeStore('r5-248-normal')
    registered.push(store)
    const onForeground = jest.fn()
    initBackgroundSync({ store: asStore(store), maxInactiveTime: -1, onForeground })

    const userOnShow = jest.fn()
    const options = callApp({ onShow: userOnShow })

    expect(options.onShow).not.toBe(userOnShow)
    ;(options.onShow as () => void)()
    expect(onForeground).toHaveBeenCalledTimes(1)
    expect(userOnShow).toHaveBeenCalledTimes(1)
  })
})

describe('R5-249 App 尚未就位时不再静默丢弃注册', () => {
  it('无 App 也登记处理器并告警；App 就位后由 ensureAppLifecycleHooks 补装拦截', () => {
    delete (globalThis as { App?: unknown }).App
    const store = fakeStore('r5-249-late-app')
    registered.push(store)
    const onForeground = jest.fn()
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      initBackgroundSync({ store: asStore(store), maxInactiveTime: -1, onForeground })
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('App 构造器当前不可用'))
    } finally {
      warnSpy.mockRestore()
    }

    installAppStub()
    ensureAppLifecycleHooks()
    const options = callApp({})
    ;(options.onShow as () => void)()

    // 修复前：无 App 时直接 return，这条注册永久丢失，后续安装包装也救不回来
    expect(onForeground).toHaveBeenCalledTimes(1)
  })
})

describe('R5-250 回调重入不得回调已注销的处理器', () => {
  it('同一轮里：前一个 handler 的回调注销的 store 不再被回调（前台与后台各自成对）', () => {
    installAppStub()
    const storeA = fakeStore('r5-250-a')
    const storeB = fakeStore('r5-250-b')
    const storeC = fakeStore('r5-250-c')
    const storeD = fakeStore('r5-250-d')
    registered.push(storeA, storeB, storeC, storeD)

    const onForegroundB = jest.fn()
    const onBackgroundB = jest.fn()
    const onForegroundD = jest.fn()
    const onBackgroundD = jest.fn()
    // A 只在前台回调里注销 B、C 只在后台回调里注销 D：两条循环各覆盖一次跳过分支
    initBackgroundSync({
      store: asStore(storeA),
      maxInactiveTime: -1,
      onForeground: () => unregisterBackgroundSync(asStore(storeB)),
    })
    initBackgroundSync({
      store: asStore(storeB),
      maxInactiveTime: -1,
      onForeground: onForegroundB,
      onBackground: onBackgroundB,
    })
    initBackgroundSync({
      store: asStore(storeC),
      maxInactiveTime: -1,
      onBackground: () => unregisterBackgroundSync(asStore(storeD)),
    })
    initBackgroundSync({
      store: asStore(storeD),
      maxInactiveTime: -1,
      onForeground: onForegroundD,
      onBackground: onBackgroundD,
    })

    const options = callApp({})
    ;(options.onShow as () => void)()
    expect(onForegroundB).not.toHaveBeenCalled()
    expect(onForegroundD).toHaveBeenCalledTimes(1)
    ;(options.onHide as () => void)()
    // 快照遍历 + 注册表已被前一轮改写：修复前 B / D 仍会在同一 tick 内被回调
    expect(onBackgroundB).not.toHaveBeenCalled()
    expect(onBackgroundD).not.toHaveBeenCalled()
  })
})
