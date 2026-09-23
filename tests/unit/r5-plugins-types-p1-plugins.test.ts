/**
 * 第五轮审查修复（分片 plugins-types-p1）：内置插件与 devtools/performance 插件的回归锁
 *
 * 覆盖 R5-300 / R5-301 / R5-302 / R5-297 / R5-298 / R5-299 / R5-306 / R5-307 /
 * R5-308 / R5-320 / R5-322 / R5-280。
 */

import { persistencePlugin, loggerPlugin, devtoolsPlugin } from '@/plugins/builtin.js'
import { timeTravelPlugin } from '@/plugins/devtools/timeTravelPlugin.js'
import { analyzerPlugin, createAnalyzerPlugin } from '@/plugins/performance/index.js'
import { registerGlobalEntry } from '@/plugins/globalRegistry.js'
import { WxStorageBackend } from '@/plugins/WxStorageBackend.js'
import { createStore } from '@/core/store/index.js'

/** globalThis 上的全局表按键存放，条目形态由用例决定（对象/原始值/Proxy 都要能塞） */
const g = globalThis as unknown as Record<string, unknown>

/** 读某个全局表的条目 */
function tableOf(key: string): Record<string, unknown> | undefined {
  return g[key] as Record<string, unknown> | undefined
}

/** timeTravel 挂在实例上的内部字段（非公开 API，测试按形状窄化） */
interface TimeTravelAPI {
  importHistory: (json: string) => void
  getSnapshotCount: () => number
  getCurrentIndex: () => number
  getSnapshots: () => Array<Record<string, unknown>>
  goTo: (index: number) => void
}

function timeTravelOf(store: unknown): TimeTravelAPI {
  return (store as { __timeTravel__: TimeTravelAPI }).__timeTravel__
}

/** 三个方法都可编程驱动的内存后端 */
function makeBackend(initial: string | null = null) {
  const saved = new Map<string, string>()
  if (initial !== null) {
    saved.set('k', initial)
  }

  return {
    saved,
    getItem: jest.fn((key: string) => saved.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      saved.set(key, value)
    }),
    removeItem: jest.fn((key: string) => {
      saved.delete(key)
    }),
  }
}

// ==================== R5-300：恢复失败必须有可编程信号 ====================

describe('R5-300 persistence 恢复失败转投 onError', () => {
  it('后端读取抛错时 console.error 与 onError 双通道', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const backend = makeBackend()
    backend.getItem.mockImplementation(() => {
      throw new Error('read boom')
    })
    const store = createStore({ name: 'r5-restore-throw', state: { count: 0 } })
    const onError = jest.fn()
    store.hooks.on('onError', onError)

    expect(() => store.use(persistencePlugin({ storage: backend, key: 'k' }))).not.toThrow()

    expect(errorSpy).toHaveBeenCalledWith('[GeomStore] Failed to restore state:', expect.any(Error))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'read boom' }), 'persistence')
    errorSpy.mockRestore()
  })

  it('载荷不是纯对象时跳过恢复也要上报', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const backend = makeBackend('[1,2]')
    const store = createStore({ name: 'r5-restore-array', state: { count: 0 } })
    const onError = jest.fn()
    store.hooks.on('onError', onError)

    store.use(persistencePlugin({ storage: backend, key: 'k' }))

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Restored state is not a plain object'))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('not a plain object') }), 'persistence')
    expect(store.getState().count).toBe(0)
    errorSpy.mockRestore()
  })

  it('validate 拒绝时跳过恢复也要上报', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const backend = makeBackend('{"count":10}')
    const store = createStore({ name: 'r5-restore-invalid', state: { count: 0 } })
    const onError = jest.fn()
    store.hooks.on('onError', onError)

    store.use(persistencePlugin({ storage: backend, key: 'k', validate: (state): state is object => (state as { count: number }).count > 100 }))

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Restored state failed validation'))
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('failed validation') }), 'persistence')
    expect(store.getState().count).toBe(0)
    errorSpy.mockRestore()
  })
})

// ==================== R5-302：恢复入口拒绝自带 __proto__ 的载荷 ====================

describe('R5-302 恢复入口的 __proto__ 准入', () => {
  it('JSON.parse 产出的自有 __proto__ 数据属性不得进入活状态', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const backend = makeBackend('{"__proto__":{"injected":1},"count":7}')
    const store = createStore({ name: 'r5-restore-proto', state: { count: 0 } })
    const onError = jest.fn()
    store.hooks.on('onError', onError)

    store.use(persistencePlugin({ storage: backend, key: 'k' }))

    expect(store.getState().count).toBe(0)
    expect(Object.prototype.hasOwnProperty.call(store.getState(), '__proto__')).toBe(false)
    expect(({} as Record<string, unknown>).injected).toBeUndefined()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('not a plain object') }), 'persistence')
    errorSpy.mockRestore()
  })
})

// ==================== R5-301：卸载必须摘掉待触发的定时器 ====================

describe('R5-301 卸载时的防抖定时器清理', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('clearOnUninstall 为真时也清掉待触发定时器，且不补写数据', () => {
    const backend = makeBackend()
    const store = createStore({ name: 'r5-clear-timer', state: { x: 1 } })
    const uninstall = store.use(persistencePlugin({ storage: backend, key: 'k', debounce: 1000, clearOnUninstall: true }))

    store.setState('x', 2)
    expect(jest.getTimerCount()).toBe(1)

    uninstall()

    expect(jest.getTimerCount()).toBe(0)
    expect(backend.setItem).not.toHaveBeenCalled()
    expect(backend.removeItem).toHaveBeenCalledWith('k')
  })

  it('定时器已触发后 debounceTimer 归零，卸载不再拿着旧句柄 clearTimeout', () => {
    const backend = makeBackend()
    const store = createStore({ name: 'r5-timer-reset', state: { x: 1 } })
    const uninstall = store.use(persistencePlugin({ storage: backend, key: 'k', debounce: 1000 }))

    store.setState('x', 2)
    jest.advanceTimersByTime(1000)
    expect(backend.setItem).toHaveBeenCalledWith('k', JSON.stringify({ x: 2 }))

    const clearSpy = jest.spyOn(globalThis, 'clearTimeout')
    uninstall()

    // 句柄已在回调里复位：卸载时不该再有一次「清一个早就触发完的定时器」的调用
    expect(clearSpy).not.toHaveBeenCalled()
    clearSpy.mockRestore()
  })

  it('clearOnUninstall 为真时仍不补写待落盘数据', () => {
    const backend = makeBackend()
    const store = createStore({ name: 'r5-clear-noflush', state: { x: 1 } })
    const uninstall = store.use(persistencePlugin({ storage: backend, key: 'k', debounce: 1000, clearOnUninstall: true }))

    store.setState('x', 2)
    uninstall()
    jest.advanceTimersByTime(5000)

    expect(backend.setItem).not.toHaveBeenCalled()
  })
})

// ==================== R5-297 / R5-298 / R5-299：timeTravel ====================

describe('R5-297 importHistory 对 JSON 语法错误的防御', () => {
  it('半个 JSON / 非 JSON 文本 / undefined 都静默跳过而不抛 SyntaxError', () => {
    const store = createStore({ name: 'r5-import-syntax', state: { count: 0 } })
    store.use(timeTravelPlugin())
    const api = timeTravelOf(store)
    const before = api.getSnapshotCount()

    for (const payload of ['{', '{"snapshots":[', '<html>404</html>', '', undefined as unknown as string]) {
      expect(() => api.importHistory(payload)).not.toThrow()
    }

    expect(api.getSnapshotCount()).toBe(before)
    expect(api.getCurrentIndex()).toBe(before - 1)
  })

  it('导入被截断后仍可继续正常导入合法载荷', () => {
    const store = createStore({ name: 'r5-import-recover', state: { count: 0 } })
    store.use(timeTravelPlugin())
    const api = timeTravelOf(store)

    api.importHistory('{"snapshots":[{"state":{"count":1},"timestam')
    api.importHistory('{"snapshots":[{"state":{"count":3},"timestamp":1}],"currentIndex":0}')

    expect(api.getSnapshotCount()).toBe(1)
    api.goTo(0)
    expect(store.getState().count).toBe(3)
  })
})

describe('R5-298 maxSize 归一为正整数', () => {
  const buildHistory = (maxSize: unknown, changes: number) => {
    const store = createStore({ name: `r5-maxsize-${String(maxSize)}-${changes}`, state: { count: 0 } })
    store.use(timeTravelPlugin({ maxSize: maxSize as never }))
    for (let i = 1; i <= changes; i++) {
      store.setState('count', i)
    }

    return timeTravelOf(store)
  }

  it.each([NaN, 0, -1, Infinity, -Infinity])('非法上限 %p 回退到默认 50（改前分别失效与恒空）', (bad) => {
    const api = buildHistory(bad, 60)
    expect(api.getSnapshotCount()).toBe(50)
    expect(api.getCurrentIndex()).toBe(49)
  })

  it('小数向下取整，合法整数原样生效', () => {
    expect(buildHistory(3.7, 10).getSnapshotCount()).toBe(3)
    expect(buildHistory(5, 10).getSnapshotCount()).toBe(5)
    expect(buildHistory(undefined, 60).getSnapshotCount()).toBe(50)
  })

  it('maxSize 为 0 时导入历史不再留下「空快照 + currentIndex=0」的非法态', () => {
    const store = createStore({ name: 'r5-import-zero', state: { count: 0 } })
    store.use(timeTravelPlugin({ maxSize: 0 }))
    const api = timeTravelOf(store)

    api.importHistory('{"snapshots":[{"state":{"count":1},"timestamp":1},{"state":{"count":2},"timestamp":2}],"currentIndex":1}')

    expect(api.getSnapshotCount()).toBe(2)
    expect(api.getCurrentIndex()).toBe(1)
    expect(() => api.goTo(api.getCurrentIndex())).not.toThrow()
  })
})

describe('R5-299/R5-321 全局入口日志与注册同源', () => {
  afterEach(() => {
    delete g.__GEOMSTORE_TIME_TRAVEL__
    delete g.__GEOMSTORE_ANALYZER__
  })

  it('timeTravel 的访问提示指向真正注册的全局表', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const store = createStore({ name: 'r5-tt-log', state: { count: 0 } })
    store.use(timeTravelPlugin())

    const hint = logSpy.mock.calls.map((call) => String(call[0])).find((line) => line.includes('Access at'))
    expect(hint).toContain('globalThis.__GEOMSTORE_TIME_TRAVEL__["r5-tt-log"]')
    expect(tableOf('__GEOMSTORE_TIME_TRAVEL__')?.['r5-tt-log']).toBeDefined()

    logSpy.mockRestore()
  })

  it('analyzer 的访问提示指向真正注册的全局表', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const store = createStore({ name: 'r5-an-log', state: { count: 0 } })
    store.use(createAnalyzerPlugin())

    const hint = logSpy.mock.calls.map((call) => String(call[0])).find((line) => line.includes('Access at'))
    expect(hint).toContain('globalThis.__GEOMSTORE_ANALYZER__["r5-an-log"]')
    expect(tableOf('__GEOMSTORE_ANALYZER__')?.['r5-an-log']).toBeDefined()

    logSpy.mockRestore()
  })
})

// ==================== R5-306 / R5-307 / R5-308：globalRegistry ====================

describe('R5-306 换掉容器时必须出声', () => {
  afterEach(() => {
    delete g.__R5_DISCARD__
  })

  it('既有容器不可扩展且仍有自有条目时告警，原始值容器不告警', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    g.__R5_DISCARD__ = Object.freeze({ 'other-store': { ping: 1 } })
    registerGlobalEntry('__R5_DISCARD__', 'mine', { ping: 2 })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('原有 1 个调试条目的容器不可复用'))

    warnSpy.mockClear()
    g.__R5_DISCARD__ = 'not-a-table'
    registerGlobalEntry('__R5_DISCARD__', 'mine', { ping: 3 })
    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('容器读取即抛错（Proxy trap）时降级为新表而非抛出', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    g.__R5_DISCARD__ = new Proxy(
      {},
      {
        isExtensible() {
          throw new Error('trap boom')
        },
      },
    ) as Record<string, unknown>

    const unregister = registerGlobalEntry('__R5_DISCARD__', 'mine', { ping: 4 })

    expect(tableOf('__R5_DISCARD__')?.['mine']).toEqual({ ping: 4 })
    expect(() => unregister()).not.toThrow()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('无法探测'), expect.any(Error))
    delete g.__R5_DISCARD__
    warnSpy.mockRestore()
  })
})

describe('R5-307 卸载只在容器仍是自己写入的那张表时才摘键', () => {
  afterEach(() => {
    delete g.__R5_IDENTITY__
  })

  it('外部把同名键换成另一张表后，卸载不得删掉别人的表', () => {
    const external = { foreign: 1 }
    const unregister = registerGlobalEntry('__R5_IDENTITY__', 'mine', { ping: 1 })

    // 条目被外部整体替换：本库的卸载只认自有属性 + 引用，两个判定都失败
    g.__R5_IDENTITY__ = external
    unregister()
    expect(g.__R5_IDENTITY__).toBe(external)

    // 外部换上一张「同名条目已删空」的新表：只判空就会把别人的表摘掉
    const emptyExternal: Record<string, unknown> = {}
    const second = registerGlobalEntry('__R5_IDENTITY__', 'second', { ping: 2 })
    g.__R5_IDENTITY__ = emptyExternal
    expect(() => second()).not.toThrow()
    expect(g.__R5_IDENTITY__).toBe(emptyExternal)
  })
})

describe('R5-308 键位归属不再依赖字符串拼接', () => {
  afterEach(() => {
    delete g['A\u0000B']
    delete g.A
  })

  it('globalKey/storeName 含 NUL 时两对键位互不侵占', () => {
    // 旧实现把两对拼成同一个 ownerKey：后一次注册会「接管」前一次的令牌，
    // 前一次的卸载函数就此变成空操作，条目永久留在全局表上
    const first = registerGlobalEntry('A\u0000B', 'C', { ping: 1 })
    const second = registerGlobalEntry('A', 'B\u0000C', { ping: 2 })

    expect(g['A\u0000B']?.['C']).toEqual({ ping: 1 })
    expect(g.A?.['B\u0000C']).toEqual({ ping: 2 })

    first()
    second()

    expect(g['A\u0000B']).toBeUndefined()
    expect(tableOf('A')).toBeUndefined()
  })
})

// ==================== R5-320 / R5-322：analyzer 的 getter 还原 ====================

describe('R5-320 卸载后不得在实例上留下自有的 getter 属性', () => {
  afterEach(() => {
    delete g.__GEOMSTORE_ANALYZER__
  })

  it('未被打孔时还原为原型方法：不再是可枚举自有属性，身份比较重新成立', () => {
    const store = createStore({
      name: 'r5-getter-restore',
      state: { count: 2 },
      getters: { double: (state: { count: number }) => state.count * 2 },
    })
    const prototypeGetter = Object.getPrototypeOf(store).getter

    const uninstall = store.use(createAnalyzerPlugin())
    expect(Object.prototype.hasOwnProperty.call(store, 'getter')).toBe(true)
    expect(store.getter('double')).toBe(4)

    uninstall()

    expect(Object.prototype.hasOwnProperty.call(store, 'getter')).toBe(false)
    expect(Object.keys(store)).not.toContain('getter')
    expect(store.getter).toBe(prototypeGetter)
    expect(store.getter('double')).toBe(4)
  })

  it('安装前实例上已有自有 getter 时按原值还原', () => {
    const store = createStore({ name: 'r5-getter-own', state: { count: 2 } })
    const ownGetter = (name: string): string => `own:${name}`
    ;(store as unknown as { getter: unknown }).getter = ownGetter

    const uninstall = store.use(createAnalyzerPlugin())
    uninstall()

    expect(Object.prototype.hasOwnProperty.call(store, 'getter')).toBe(true)
    expect((store as unknown as { getter: unknown }).getter).toBe(ownGetter)
  })
})

describe('R5-322 disposer 幂等', () => {
  afterEach(() => {
    delete g.__GEOMSTORE_ANALYZER__
  })

  it('第二次调用不再谎报「getter 被后续插件重新包装」', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createStore({ name: 'r5-disposer-idempotent', state: { count: 1 } })
    const uninstall = store.use(createAnalyzerPlugin())

    uninstall()
    warnSpy.mockClear()
    expect(() => uninstall()).not.toThrow()
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('包装确被后续插件重新持有时仍告警一次', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createStore({ name: 'r5-disposer-rewrap', state: { count: 1 } })
    const wrapped = store.getter
    const uninstall = store.use(createAnalyzerPlugin())
    ;(store as unknown as { getter: unknown }).getter = function (this: unknown, ...args: unknown[]): unknown {
      return (wrapped as (...a: unknown[]) => unknown).apply(this, args)
    }

    uninstall()

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('已被后续插件重新包装'))
    warnSpy.mockRestore()
  })
})

// ==================== R5-280：WxStorageBackend 的记录/重抛口径 ====================

describe('R5-280 WxStorageBackend 三个方法的错误口径同源', () => {
  it('每个方法都以自身名字记录后原样重抛', () => {
    const original = globalThis.wx
    const failure = new Error('wx boom')
    globalThis.wx = {
      getStorageSync: jest.fn(() => {
        throw failure
      }),
      setStorageSync: jest.fn(() => {
        throw failure
      }),
      removeStorageSync: jest.fn(() => {
        throw failure
      }),
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const backend = new WxStorageBackend()

    try {
      expect(() => backend.getItem('k')).toThrow(failure)
      expect(() => backend.setItem('k', 'v')).toThrow(failure)
      expect(() => backend.removeItem('k')).toThrow(failure)

      expect(errorSpy).toHaveBeenNthCalledWith(1, '[WxStorage] getItem error:', failure)
      expect(errorSpy).toHaveBeenNthCalledWith(2, '[WxStorage] setItem error:', failure)
      expect(errorSpy).toHaveBeenNthCalledWith(3, '[WxStorage] removeItem error:', failure)
    } finally {
      errorSpy.mockRestore()
      globalThis.wx = original
    }
  })
})

// 内置入口的等价性：analyzerPlugin 就是 createAnalyzerPlugin() 的默认实例
describe('R5-321 默认 analyzer 插件与工厂产物同构', () => {
  it('两者 name 与 install 行为一致（同一 installAnalyzer 实现）', () => {
    expect(analyzerPlugin.name).toBe(createAnalyzerPlugin().name)
    expect(typeof analyzerPlugin.install).toBe('function')
    expect(loggerPlugin.name).toBe('logger')
    expect(devtoolsPlugin.name).toBe('devtools')
  })
})

// registerGlobalEntry 的公开契约仍需可单独使用（供其它插件复用）
describe('registerGlobalEntry 基本语义未被本次改动破坏', () => {
  afterEach(() => {
    delete g.__R5_BASIC__
  })

  it('注册后条目可见，卸载后连空表一起摘掉', () => {
    const api = { ping: 1 }
    const unregister = registerGlobalEntry('__R5_BASIC__', 's', api)
    expect(tableOf('__R5_BASIC__')?.s).toBe(api)
    unregister()
    expect(tableOf('__R5_BASIC__')).toBeUndefined()
  })
})
