/**
 * 状态类型为「未声明索引签名的业务 interface」时的可用性回归测试
 *
 * 背景：`State` 约束定义为 `object`（见 types/store.ts），本意是允许业务 interface
 * 直接作为状态类型；但 `StoreLike.state`（composeStore）与选择器族的签名曾写作
 * `Record<string, unknown>`，而 interface 没有隐式索引签名，会被拒之门外。
 *
 * 该缺陷只在类型层可见，故用测试锁住：ts-jest 会报告类型错误，比仅依赖
 * typecheck:examples 更早失败。
 *
 * 文件同时承载 src/types 里**带运行时实现**的导出的回归用例（`types/error.ts` 的
 * `defaultErrorHandler` 见 #385，`types/persistence.ts` 的 `WxStorageBackend` 见 #390），
 * 因为 types 层没有独立的测试目录（`tests/unit/core/error/` 那类路径属实现层）。
 * 末尾另有一组针对测试基础设施自身（`tests/setup.ts` 的 wx mock / 定时器 / 进程监听器，
 * 见 #414/#415/#416）的用例：它们与上面的类型契约同属「只在编译期或全局装配阶段暴露」的缺陷。
 */

import { composeStore, createStore } from '../../src/index.js'
import { createParametricSelector, createSelector } from '../../src/extras/selector.js'
import { createErrorContext, defaultErrorHandler } from '../../src/types/error.js'
import { WxStorageBackend } from '../../src/types/persistence.js'

interface UserState {
  id: number
  name: string
}

interface CartState {
  items: Array<{ id: number; price: number }>
}

describe('状态类型为业务 interface（无索引签名）', () => {
  it('createSelector / createParametricSelector 可直接接收 interface 状态', () => {
    const store = createStore({
      name: 'iface-selector',
      state: (): UserState => ({ id: 1, name: 'Ada' }),
    })

    const selectName = createSelector((state: UserState) => state.name)
    expect(selectName(store.getState())).toBe('Ada')

    // 参数化选择器：按参数分别缓存
    const selectNameById = createParametricSelector(
      (state: UserState, id: number) => (state.id === id ? state.name : ''),
      { ttl: 1000, maxEntries: 8 },
    )(store.getState())
    expect(selectNameById(1)).toBe('Ada')
    expect(selectNameById(2)).toBe('')
  })

  it('composeStore 可组合状态为 interface 的 Store', () => {
    const userStore = createStore({
      name: 'user',
      state: (): UserState => ({ id: 7, name: 'Bob' }),
      actions: {
        rename(this: { $patch: (patch: Partial<UserState>) => void }, name: string): void {
          this.$patch({ name })
        },
      },
    })
    const cartStore = createStore({
      name: 'cart',
      state: (): CartState => ({ items: [] }),
    })

    const root = composeStore([userStore, cartStore], { namespace: true })

    // 命名空间模式下运行时的状态是按 name 嵌套的，而 getState() 的静态类型为
    // 各子 store 状态的交叉类型 —— 与 examples/advanced/compose-stores.ts 同处理
    const readState = (): { user: UserState; cart: CartState } => root.getState() as unknown as { user: UserState; cart: CartState }

    expect(readState().user.name).toBe('Bob')
    expect(readState().cart.items).toEqual([])

    root.dispatch('user/rename', 'Carol')
    expect(readState().user.name).toBe('Carol')

    root.destroy()
  })
})

// ==================== #385：defaultErrorHandler 对非 Error 抛值的兜底 ====================

describe('defaultErrorHandler 对非 Error 抛值的兜底（#385）', () => {
  const asError = (value: unknown): Error => value as Error

  it('throw null 时 warning 分支不再在处理器内部抛 TypeError', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const context = createErrorContext('user-store', 'dispatch', asError(null), 'warning')

    expect(() => defaultErrorHandler(context)).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WARNING][user-store]'),
      expect.stringContaining('Warning in dispatch'),
      'null',
    )

    warnSpy.mockRestore()
  })

  it('throw 字符串时按字符串输出，而不是 undefined', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {})
    const context = createErrorContext('user-store', 'dispatch', asError('boom'), 'info')

    expect(() => defaultErrorHandler(context)).not.toThrow()
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('[INFO][user-store]'), expect.stringContaining('Info in dispatch'), 'boom')

    infoSpy.mockRestore()
  })

  it('error / critical 分支取 stack 时同样不抛（缺失或为非 Error 值）', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => defaultErrorHandler(createErrorContext('user-store', 'dispatch', asError(undefined), 'critical'))).not.toThrow()
    expect(() => defaultErrorHandler(createErrorContext('user-store', 'dispatch', asError({ code: 500 }), 'error'))).not.toThrow()

    // 原始值仍被完整打印（便于定位），且不会输出 'Stack:' 行
    const printed = errorSpy.mock.calls.map((call) => call[call.length - 1])
    expect(printed).toContain(undefined)
    expect(printed.some((arg) => typeof arg === 'object' && arg !== null && 'code' in arg)).toBe(true)
    expect(errorSpy.mock.calls.some((call) => call.includes('Stack:'))).toBe(false)

    errorSpy.mockRestore()
  })

  it('真实 Error 的输出保持原样（message 逐字透传，有 stack 才输出 Stack 行）', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const error = new Error('Test warning')
    error.stack = 'Test stack trace'

    defaultErrorHandler(createErrorContext('user-store', 'dispatch', error, 'warning'))
    defaultErrorHandler(createErrorContext('user-store', 'dispatch', error, 'error'))

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[WARNING][user-store]'),
      expect.stringContaining('Warning in dispatch'),
      'Test warning',
    )
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[ERROR][user-store]'), 'Stack:', 'Test stack trace')

    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })
})

// ==================== #390：WxStorageBackend 三个方法的错误语义一致 ====================

describe('WxStorageBackend 读写删失败一律重抛（#390）', () => {
  const writableGlobal = globalThis as unknown as { wx?: unknown }

  afterEach(() => {
    delete writableGlobal.wx
  })

  it('getItem 失败：记录日志并重抛，不退化成「键无数据」', () => {
    writableGlobal.wx = {
      getStorageSync: () => {
        throw new Error('storage broken')
      },
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => new WxStorageBackend().getItem('k')).toThrow('storage broken')
    expect(errorSpy).toHaveBeenCalledWith('[WxStorage] getItem error:', expect.any(Error))

    errorSpy.mockRestore()
  })

  it('removeItem 失败：记录日志并重抛，clearOnUninstall 不会谎报已清除', () => {
    writableGlobal.wx = {
      removeStorageSync: () => {
        throw new Error('remove denied')
      },
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => new WxStorageBackend().removeItem('k')).toThrow('remove denied')
    expect(errorSpy).toHaveBeenCalledWith('[WxStorage] removeItem error:', expect.any(Error))

    errorSpy.mockRestore()
  })

  it('setItem 维持既有口径（日志 + 重抛）', () => {
    writableGlobal.wx = {
      setStorageSync: () => {
        throw new Error('quota exceeded')
      },
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => new WxStorageBackend().setItem('k', 'v')).toThrow('quota exceeded')
    expect(errorSpy).toHaveBeenCalledWith('[WxStorage] setItem error:', expect.any(Error))

    errorSpy.mockRestore()
  })

  it('「键不存在」仍按 null 返回：与读取失败区分开', () => {
    writableGlobal.wx = { getStorageSync: () => '' }

    expect(new WxStorageBackend().getItem('k')).toBeNull()
  })
})

// ==================== 测试基础设施：wx 全局 mock 的默认行为（#416） ====================

describe('tests/setup.ts 的 wx mock 默认行为（#416）', () => {
  const wx = (globalThis as unknown as { wx: Record<string, jest.Mock> }).wx

  it('存储读写删是真实往返：写入后能读回，删除后读不到', () => {
    wx.setStorageSync('roundtrip', 'v1')
    expect(wx.getStorageSync('roundtrip')).toBe('v1')

    wx.removeStorageSync('roundtrip')
    expect(wx.getStorageSync('roundtrip')).toBeUndefined()
  })

  it('区分「无数据」与「mock 恒返回 undefined」：裸 jest.fn() 做不到这一点', () => {
    expect(wx.getStorageSync('never-written')).toBeUndefined()
    wx.setStorageSync('written-then-read', 'x')
    expect(wx.getStorageSync('written-then-read')).toBe('x')
    wx.removeStorageSync('written-then-read')
    expect(wx.getStorageSync('written-then-read')).toBeUndefined()
  })

  it('clearStorageSync 清空全部键', () => {
    wx.setStorageSync('to-clear', 1)
    wx.clearStorageSync()
    expect(wx.getStorageSync('to-clear')).toBeUndefined()
  })

  it('request 默认走 success(200) 分支，且用例仍可逐次覆盖实现', () => {
    const success = jest.fn()
    wx.request({ success })
    expect(success).toHaveBeenCalledWith({ statusCode: 200, data: {}, errMsg: 'request:ok' })

    wx.request({})
    expect(success).toHaveBeenCalledTimes(1)

    const fail = jest.fn()
    wx.request.mockImplementationOnce((options: { fail?: (e: unknown) => void }) => options?.fail?.(new Error('network down')))
    wx.request({ fail })
    expect(fail).toHaveBeenCalledWith(expect.any(Error))
  })

  it('无参调用 request 不抛错', () => {
    expect(() => wx.request()).not.toThrow()
  })
})

// ==================== 测试基础设施：定时器与进程级监听器（#414 / #415） ====================

describe('tests/setup.ts 的定时器与进程监听器清理（#414 / #415）', () => {
  it('#414：未启用 fake timers 时 clearAllTimers 同样不抛错，故 afterEach 的 try/catch 是死代码', () => {
    expect(() => jest.clearAllTimers()).not.toThrow()
    jest.useFakeTimers()
    expect(() => jest.clearAllTimers()).not.toThrow()
  })

  it('#414：本用例排定但不执行的 fake 定时器交给全局 afterEach 清理', () => {
    jest.useFakeTimers()
    const leaked = jest.fn()
    setTimeout(leaked, 1000)
    expect(jest.getTimerCount()).toBe(1)
  })

  it('#414：重新启用 fake timers 后只推进本用例的定时器，遗留回调不会补跑', () => {
    jest.useFakeTimers()
    const own = jest.fn()
    setTimeout(own, 1000)
    jest.advanceTimersByTime(1000)
    expect(own).toHaveBeenCalledTimes(1)

    jest.clearAllTimers()
    jest.advanceTimersByTime(10_000)
    expect(own).toHaveBeenCalledTimes(1)
  })

  it('#415：setup 不再注册只 console.error 的进程级错误监听器（吞异常 + 每文件叠加泄漏）', () => {
    // @types/node 的 process.listeners 只列了 Signals 重载，这两个事件名走通用的
    // EventTarget 形状读取（返回值仅用于 String() 比对源码）
    const listenersOf = (event: 'unhandledRejection' | 'uncaughtException'): unknown[] =>
      (process as unknown as { listeners(name: string): unknown[] }).listeners(event)
    const setupHandlers = (event: 'unhandledRejection' | 'uncaughtException') =>
      listenersOf(event)
        .map((handler) => String(handler))
        .filter((source) => source.includes('[Test Setup]'))

    expect(setupHandlers('unhandledRejection')).toEqual([])
    expect(setupHandlers('uncaughtException')).toEqual([])
  })
})
