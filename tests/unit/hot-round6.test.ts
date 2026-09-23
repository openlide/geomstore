/**
 * 第六轮审查（ocrreview6.md）critical + high 修复的回归锁
 *
 * 每条用例在标题里标出对应的 R6 编号，断言的是**修复后的语义**：修复前这些断言会失败，
 * 失败路径即报告描述的那条。
 */

import { createStore } from '@/index.js'
import { composeStore } from '@/core/compose/composeStore.js'
import { SnapshotManager } from '@/extras/snapshot/SnapshotManager.js'
import { initBackgroundSync, unregisterBackgroundSync } from '@/integrations/enterprise/background-sync.js'
import { createUserStore } from '@/integrations/enterprise/user-store.js'

describe('R6-007 setState 的原型链敏感键', () => {
  it('写 __proto__ 不得换掉状态对象的原型，须按自有数据属性承载（与 $patch 同口径）', () => {
    const store = createStore({ name: 'r6-007a', state: { a: 1 } })
    const state = store.getState()
    const protoBefore = Object.getPrototypeOf(state)

    store.setState('__proto__' as never, { inj: 1 } as never)

    expect(Object.getPrototypeOf(state)).toBe(protoBefore)
    expect(Object.prototype.hasOwnProperty.call(state, '__proto__')).toBe(true)
    // 注入的键不得经原型链出现在任意缺失键读取上
    expect((store.getState() as Record<string, unknown>).inj).toBeUndefined()
    expect((store.getState() as Record<string, unknown>).isAdmin).toBeUndefined()
    expect(Object.keys(store.getState())).toEqual(['a', '__proto__'])
  })

  it('写非对象值的 __proto__ 是一次真实写入，重复写同一值不再通知', () => {
    const store = createStore({ name: 'r6-007b', state: { a: 1 } })
    const seen: number[] = []
    const unsubscribe = store.subscribe(() => {
      seen.push(1)
    })
    const value = { inj: 1 }

    store.setState('__proto__' as never, value as never)
    expect(Object.prototype.hasOwnProperty.call(store.getState(), '__proto__')).toBe(true)
    expect(store.getState()['__proto__' as never] as unknown).toBe(value)

    // 同一引用再写一次：相等性短路，不得推进变更或广播
    store.setState('__proto__' as never, value as never)
    expect(seen.length).toBe(1)

    unsubscribe()
  })
})

describe('R6-006 StateProxy 深代理的 [[Get]] 不变量', () => {
  it('读冻结节点里的对象值不得抛 TypeError，且原样返回同一引用', () => {
    const store = createStore({ name: 'r6-006', state: { cfg: null as unknown } })
    const frozen = Object.freeze({ inner: { a: 1 } })

    // setState 按引用保存，不克隆 ⇒ 冻结原样留在状态树里（_initializeState 才会克隆掉冻结）
    store.setState('cfg' as never, frozen as never)

    // 修复前：'get' on proxy: property 'inner' is a read-only and non-configurable
    // data property on the proxy target but the proxy did not return its actual value
    const view = store.state.cfg as unknown as { inner: { a: number } }
    expect(() => view.inner).not.toThrow()
    expect(view.inner.a).toBe(1)
    expect(view.inner).toBe(frozen.inner)
  })

  it('经 $snapshot() 深冻结的子树写回 setState 后仍可逐层读取', () => {
    const src = createStore({ name: 'r6-006src', state: { user: { address: { city: 'CD' } } } })
    const store = createStore({ name: 'r6-006dst', state: { user: null as unknown } })

    store.setState('user' as never, src.$snapshot().user as never)

    const snapshot = src.$snapshot()
    expect(Object.isFrozen(snapshot.user)).toBe(true)
    expect(() => store.state.user).not.toThrow()
    expect((store.state.user as { address: { city: string } }).address.city).toBe('CD')
  })

  it('冻结数组的索引与元素属性同样按裸值返回', () => {
    const store = createStore({ name: 'r6-006arr', state: { list: null as unknown } })
    const list = Object.freeze([Object.freeze({ nested: { v: 1 } })])
    store.setState('list' as never, list as never)

    const view = store.state.list as unknown as Array<{ nested: { v: number } }>
    expect(() => view[0]).not.toThrow()
    expect(view[0].nested.v).toBe(1)
    expect(view[0]).toBe(list[0])
  })
})

describe('R6-005 组合层对已销毁子 store 的读路径容错', () => {
  it('命名空间模式：子 store 独立销毁后组合仍可读，死店并入空视图且只告警一次', () => {
    const a = createStore({ name: 'a', state: { x: 1 } })
    const b = createStore({ name: 'b', state: { y: 2 } })
    const composed = composeStore([a, b] as never, { namespace: true } as never)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    b.destroy()
    a.setState('x', 2)

    expect(() => composed.getState()).not.toThrow()
    const merged = composed.getState() as Record<string, Record<string, unknown>>
    expect(merged.a.x).toBe(2)
    expect(merged.b).toEqual({})
    const calls = warn.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    composed.getState()
    composed.getState()
    expect(warn.mock.calls.length).toBe(calls)

    warn.mockRestore()
    composed.destroy()
    a.destroy()
  })

  it('三条读路径口径一致：getState / state / $snapshot 都不因单个子店销毁而抛错', () => {
    const a = createStore({ name: 'c-a', state: { x: 1 } })
    const b = createStore({ name: 'c-b', state: { y: 2 } })
    const composed = composeStore([a, b] as never, { namespace: true } as never)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    b.destroy()
    a.setState('x', 3)

    expect(() => composed.getState()).not.toThrow()
    expect(() => composed.state).not.toThrow()
    expect(() => composed.$snapshot()).not.toThrow()
    // 死店不得在保护视图/快照里留下陈旧数据
    expect((composed.state as Record<string, unknown>)['c-b']).toEqual({})
    expect((composed.$snapshot() as Record<string, unknown>)['c-b']).toEqual({})

    warn.mockRestore()
    composed.destroy()
    a.destroy()
  })

  it('非命名空间模式：归属判定跳过死店，读键与写键都不再抛', () => {
    const a = createStore({ name: 'flat-a', state: { shared: 1 } })
    const b = createStore({ name: 'flat-b', state: { onlyB: 2 } })
    const composed = composeStore([a, b] as never)
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    b.destroy()

    expect(() => composed.getState()).not.toThrow()
    expect(composed.getCached('onlyB' as never) as unknown).toBeUndefined()
    // 修复前 findTargetStoreWithKey 的 matchingStores 过滤会对死店调 getState() 直接抛
    expect(() => composed.setState('onlyB' as never, 9 as never)).not.toThrow()

    warn.mockRestore()
    composed.destroy()
    a.destroy()
  })
})

describe('R6-008 快照克隆引擎与 core deepCloneState 合流', () => {
  class MyMap<K, V> extends Map<K, V> {
    first(): V | undefined {
      return this.values().next().value
    }
  }
  class Point {
    constructor(
      public x: number,
      public y: number,
    ) {}
  }

  // SnapshotResult.data 是 `T | undefined`（须先判 success），用例统一在这里收口：
  // 断言成功并交出带类型的 data
  const unwrap = <T>(snap: { success: boolean; data?: T }): T => {
    expect(snap.success).toBe(true)
    return snap.data as T
  }

  it('内建容器子类保留原引用，不被重建为基类副本', () => {
    const manager = new SnapshotManager()
    const m = new MyMap<string, number>([['a', 1]])

    const d = unwrap(manager.createSnapshot({ m }))

    expect(d.m).toBe(m)
    expect(d.m instanceof MyMap).toBe(true)
    expect(d.m.first()).toBe(1)
  })

  it('内部槽位承载值的内建类型一律保留原引用（空壳会缺槽位）', () => {
    const manager = new SnapshotManager()
    const p = Promise.resolve(7)
    const boxed = new Number(1)
    const bytes = new Uint8Array([7, 8])
    const err = new Error('boom')

    const d = unwrap(manager.createSnapshot({ p, boxed, bytes, err }))

    expect(d.p).toBe(p)
    expect(d.boxed).toBe(boxed)
    expect(Number(d.boxed)).toBe(1)
    expect(d.bytes).toBe(bytes)
    expect(d.bytes[0]).toBe(7)
    expect(d.bytes.byteLength).toBe(2)
    expect(d.err).toBe(err)
    expect(d.err.message).toBe('boom')
  })

  it('装箱值按内容判差异，相同引用不误报（diff 的内建值兜底）', () => {
    const manager = new SnapshotManager()

    // 报告外缺陷（修 R6-008 时发现）：两侧键集同为空、原型相同，通用对象分支会把
    // `new Number(1)` 与 `new Number(2)` 判成无差异
    expect(manager.compareSnapshots(manager.createSnapshot({ n: new Number(1) }), manager.createSnapshot({ n: new Number(2) })).changed).toBe(true)
    // 内容相同、实例不同：按 valueOf 判等，不误报
    expect(manager.compareSnapshots(manager.createSnapshot({ n: new Number(1) }), manager.createSnapshot({ n: new Number(1) })).changed).toBe(false)

    const shared = new Number(1)
    expect(manager.compareSnapshots(manager.createSnapshot({ n: shared }), manager.createSnapshot({ n: shared })).changed).toBe(false)
  })

  it('异步引擎同口径：子类与槽位值都保留原引用', async () => {
    const manager = new SnapshotManager()
    const m = new MyMap<string, number>([['a', 1]])
    const boxed = new Number(3)

    const d = unwrap(await manager.createSnapshotAsync({ m, boxed, plain: { k: 1 } }))

    expect(d.m).toBe(m)
    expect(d.boxed).toBe(boxed)
    expect(d.plain).not.toBe(undefined)
    expect(d.plain.k).toBe(1)
  })

  it('既有契约不破：普通对象仍深克隆、类实例仍重建为同类实例', () => {
    const manager = new SnapshotManager()
    const plain = { nested: { v: 1 } }
    const point = new Point(1, 2)

    const d = unwrap(manager.createSnapshot({ plain, point }))

    expect(d.plain).not.toBe(plain)
    expect(d.plain.nested.v).toBe(1)
    expect(d.point).toBeInstanceOf(Point)
    expect(d.point.x).toBe(1)
  })
})

describe('R6-001 组合层通知按微任务合并（示例口径）', () => {
  it('同 tick 退订会丢掉本轮广播；让出一个宏任务再退订才收得到', async () => {
    const settings = createStore({
      name: 'r6-001-settings',
      state: () => ({ theme: 'light' }),
      actions: {
        setTheme(value: string) {
          this.state.theme = value
        },
      },
    })
    const root = composeStore([settings] as never, { namespace: true } as never)

    const sameTick: string[] = []
    const unsubscribeEarly = root.subscribe((next) => {
      sameTick.push((next as Record<string, { theme: string }>)['r6-001-settings'].theme)
    })
    root.dispatch('r6-001-settings/setTheme' as never, 'dark' as never)
    unsubscribeEarly()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sameTick).toEqual([])

    const late: string[] = []
    const unsubscribeLate = root.subscribe((next) => {
      late.push((next as Record<string, { theme: string }>)['r6-001-settings'].theme)
    })
    root.dispatch('r6-001-settings/setTheme' as never, 'night' as never)
    await new Promise((resolve) => setTimeout(resolve, 10))
    unsubscribeLate()
    expect(late).toEqual(['night'])

    root.destroy()
    settings.destroy()
  })
})

describe('R6-009 前台刷新依赖的 refreshData 是隐式契约', () => {
  const g = global as unknown as { App?: unknown }
  const originalApp = g.App
  let captured: Record<string, () => void> | null = null

  const registerApp = (): Record<string, () => void> => {
    // 先取名再调用：`(g.App as ...)({})` 需要前置分号防 ASI，而 no-extra-semi 会把它判成多余分号
    const app = g.App as (options: Record<string, () => void>) => void
    app({})
    return captured as unknown as Record<string, () => void>
  }

  beforeEach(() => {
    captured = null
    g.App = (options: Record<string, () => void>) => {
      captured = options
    }
  })

  afterEach(() => {
    g.App = originalApp
  })

  it('store 未提供 refreshData：告警点名缺失的 action，且不再打印“刷新状态”', () => {
    const store = createStore({ name: 'r6-009-missing', state: { a: 1 } })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    initBackgroundSync({ store: store as never, maxInactiveTime: -1 })

    const options = registerApp()
    options.onShow()
    options.onShow()

    const missing = warn.mock.calls.filter((args) => String(args[0]).includes('未定义 action "refreshData"'))
    expect(missing).toHaveLength(1)
    expect(log.mock.calls.filter((args) => String(args[0]).includes('刷新状态'))).toHaveLength(0)

    warn.mockRestore()
    log.mockRestore()
    unregisterBackgroundSync(store as never)
    store.destroy()
  })

  it('store 提供 refreshData：按实际结果打印一次刷新日志并派发动作', () => {
    let refreshed = 0
    const store = createStore({
      name: 'r6-009-present',
      state: { a: 1 },
      actions: {
        refreshData() {
          refreshed++
        },
      },
    })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    initBackgroundSync({ store: store as never, maxInactiveTime: -1 })

    registerApp().onShow()

    expect(refreshed).toBe(1)
    expect(log.mock.calls.filter((args) => String(args[0]).includes('刷新状态'))).toHaveLength(1)
    expect(warn.mock.calls.filter((args) => String(args[0]).includes('未定义 action'))).toHaveLength(0)

    warn.mockRestore()
    log.mockRestore()
    unregisterBackgroundSync(store as never)
    store.destroy()
  })

  it('createUserStore 自带 refreshData：切前台真的走一次服务端同步', async () => {
    const wxGlobal = (globalThis as unknown as { wx: Record<string, unknown> }).wx
    const originalRequest = wxGlobal.request
    let requested = 0
    wxGlobal.request = (opts: Record<string, unknown>) => {
      requested++
      ;(opts.success as (res: unknown) => void)({ statusCode: 200, data: { userInfo: { id: 'u1', name: 'Ada' } } })
    }

    const store = createUserStore({ userId: 'r6-009', syncUrl: 'https://example.test/user' })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    initBackgroundSync({ store: store as never, maxInactiveTime: -1 })

    registerApp().onShow()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(requested).toBe(1)
    expect(store.getState().userInfo?.name).toBe('Ada')
    expect(warn.mock.calls.filter((args) => String(args[0]).includes('未定义 action'))).toHaveLength(0)

    warn.mockRestore()
    unregisterBackgroundSync(store as never)
    store.destroy()
    wxGlobal.request = originalRequest
  })
})
