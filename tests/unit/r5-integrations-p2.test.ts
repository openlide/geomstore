/**
 * 第五轮 integrations-p2 回归测试
 *
 * 锁定 R5-276 / 277 / 278 / 285 / 286 / 287 / 288 / 289 / 290 / 291 十条判定，
 * 对象是 src/integrations/{utils,with-store,with-app-store}.ts。
 */

import { createStore, withPageStore, withComponentStore, withAppStore } from '@/index.js'
import { bindMappings, bindActions, performAutoInject, exposeStoreAPI, resolveMappings } from '@/integrations/utils.js'

/** 造一个只被 bindMappings 使用的最小宿主：返回订阅回调，便于手动通知 */
function bindHost(mappings: Record<string, string>, values: Record<string, unknown>) {
  const patches: Array<Record<string, unknown>> = []
  let notify: () => void = () => {}
  const unbinds = bindMappings(
    {},
    mappings,
    (storeKey) => values[storeKey],
    (patch) => patches.push(patch),
    (callback) => {
      notify = callback
      return () => {}
    },
  )
  return { patches, notify: () => notify(), unbinds }
}

describe('R5-276 bindMappings 的累积器不写穿 Object.prototype', () => {
  it('"__proto__" 作为本地键：首次注入即下发，载荷原型不被改坏', () => {
    const values: Record<string, unknown> = { count: { n: 1 } }
    const { patches } = bindHost({ ['__proto__']: 'count' }, values)

    expect(patches).toHaveLength(1)
    expect(Object.prototype.hasOwnProperty.call(patches[0], '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(patches[0])).toBe(Object.prototype)
  })

  it('"__proto__" 键在后续通知里仍参与脏检查与下发（不被静默丢弃）', () => {
    const values: Record<string, unknown> = { count: { n: 1 } }
    const { patches, notify } = bindHost({ ['__proto__']: 'count' }, values)
    patches.length = 0

    values.count = { n: 2 }
    notify()

    expect(patches).toHaveLength(1)
    expect((patches[0] as Record<string, unknown>)['__proto__']).toEqual({ n: 2 })
  })

  it('performAutoInject 的注入目标键同样按自有属性写入', () => {
    const store = createStore<{ count: number }>({ state: { count: 7 }, enableCache: true })
    const patches: Array<Record<string, unknown>> = []

    performAutoInject({}, { count: '__proto__' }, store, (patch) => patches.push(patch))

    expect(patches).toHaveLength(1)
    expect(Object.prototype.hasOwnProperty.call(patches[0], '__proto__')).toBe(true)
    expect(patches[0].__proto__).toBe(7)
  })
})

describe('R5-277 宿主成员以描述符为单位覆盖与还原', () => {
  it('exposeStoreAPI 取消暴露后恢复访问器描述符，而非降级成数据属性', () => {
    const store = createStore({ state: { count: 0 } })
    const target: Record<string, unknown> = {}
    Object.defineProperty(target, 'getState', {
      get: () => 'host-getter',
      set: () => {},
      configurable: true,
      enumerable: true,
    })

    const unexpose = exposeStoreAPI(target, store)
    expect(typeof target.getState).toBe('function')

    unexpose()

    const restored = Object.getOwnPropertyDescriptor(target, 'getState')
    expect(typeof restored?.get).toBe('function')
    expect(restored?.value).toBeUndefined()
    expect((target as { getState: unknown }).getState).toBe('host-getter')
  })

  it('exposeStoreAPI 跳过不可重定义的宿主成员并告警，其余键照常暴露', () => {
    const store = createStore({ state: { count: 0 } })
    const target: Record<string, unknown> = {}
    Object.defineProperty(target, 'store', { value: 'frozen-host', writable: false, configurable: false, enumerable: true })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    let unexpose!: () => void
    expect(() => {
      unexpose = exposeStoreAPI(target, store)
    }).not.toThrow()

    expect(target.store).toBe('frozen-host')
    expect(typeof target.getState).toBe('function')
    expect(typeof target.__store__).toBe('object')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"store"'))

    expect(() => unexpose()).not.toThrow()
    expect(target.store).toBe('frozen-host')
    expect(target.getState).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('exposeStoreAPI 在冻结宿主上整体降级为 no-op 而非抛错', () => {
    const store = createStore({ state: { count: 0 } })
    const target = Object.freeze({}) as Record<string, unknown>
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    let unexpose!: () => void
    expect(() => {
      unexpose = exposeStoreAPI(target, store)
    }).not.toThrow()
    expect(() => unexpose()).not.toThrow()
    expect(Object.keys(target)).toHaveLength(0)
    warnSpy.mockRestore()
  })

  it('bindActions 遇不可配置宿主成员只跳过该键，不中断整批绑定', () => {
    const store = createStore({
      state: { count: 0 },
      actions: {
        increment() {
          this.setState('count', this.state.count + 1)
        },
      },
    })
    const target: Record<string, unknown> = {}
    Object.defineProperty(target, 'blocked', { value: 'host-blocked', writable: false, configurable: false, enumerable: true })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const unbinds = bindActions(target, { blocked: 'increment', add: 'increment' }, store)

    expect(target.blocked).toBe('host-blocked')
    expect(typeof target.add).toBe('function')
    expect(unbinds).toHaveLength(1)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"blocked"'))

    unbinds.forEach((unbind) => unbind())
    expect(target.add).toBeUndefined()
    warnSpy.mockRestore()
  })

  it('bindActions 还原不可配置但可写的宿主成员时沿用其 configurable/enumerable', () => {
    const store = createStore({
      state: { count: 0 },
      actions: {
        increment() {
          this.setState('count', this.state.count + 1)
        },
      },
    })
    const target: Record<string, unknown> = {}
    Object.defineProperty(target, 'halfLocked', { value: 'original', writable: true, configurable: false, enumerable: false })
    const unbinds = bindActions(target, { halfLocked: 'increment' }, store)

    const bound = Object.getOwnPropertyDescriptor(target, 'halfLocked')
    expect(bound?.configurable).toBe(false)
    expect(bound?.enumerable).toBe(false)
    expect(typeof bound?.value).toBe('function')

    unbinds[0]()
    expect(Object.getOwnPropertyDescriptor(target, 'halfLocked')).toMatchObject({
      value: 'original',
      writable: true,
      configurable: false,
      enumerable: false,
    })
  })
})

describe('R5-278 resolveMappings 对 injectMapping 也返回副本', () => {
  it('返回的 injectMapping 与入参不共享引用，键值仍原样保留', () => {
    const options = { injectMapping: { count: 'cachedCount' } }
    const resolved = resolveMappings(options)

    expect(resolved.injectMapping).not.toBe(options.injectMapping)
    expect(resolved.injectMapping).toEqual({ count: 'cachedCount' })

    resolved.injectMapping.extraKey = 'mutated'
    expect(options.injectMapping).toEqual({ count: 'cachedCount' })
  })

  it('未提供 injectMapping 时仍是空对象', () => {
    expect(resolveMappings({}).injectMapping).toEqual({})
  })
})

describe('R5-285 App 接入 autoUpdateOnShow', () => {
  function makeStore() {
    return createStore<{ config: { v: number } }>({ state: { config: { v: 1 } }, enableCache: true })
  }

  it('onShow 重新注入 globalData 并转发用户 onShow', () => {
    const store = makeStore()
    const originalOnShow = jest.fn()
    const app = withAppStore(store, {
      autoInject: true,
      injectMapping: { config: 'appConfig' },
      autoUpdateOnShow: true,
    })({ onLaunch: jest.fn(), onShow: originalOnShow }) as any

    app.onLaunch()
    expect(app.globalData.appConfig).toEqual({ v: 1 })

    store.setState('config', { v: 7 })
    expect(app.globalData.appConfig).toEqual({ v: 1 })

    app.onShow()
    expect(app.globalData.appConfig).toEqual({ v: 7 })
    expect(originalOnShow).toHaveBeenCalledTimes(1)
  })

  it('onLaunch 之前 onShow 不创建 globalData，但仍转发用户 onShow', () => {
    const store = makeStore()
    const originalOnShow = jest.fn()
    const app = withAppStore(store, {
      autoInject: true,
      injectMapping: { config: 'appConfig' },
      autoUpdateOnShow: true,
    })({ onShow: originalOnShow }) as any
    const instance: any = {}

    app.onShow.call(instance)

    expect(instance.globalData).toBeUndefined()
    expect(originalOnShow).toHaveBeenCalledTimes(1)
  })

  it('未开 autoUpdateOnShow 时不包装 onShow', () => {
    const store = makeStore()
    const originalOnShow = jest.fn()
    const app = withAppStore(store, {
      autoInject: true,
      injectMapping: { config: 'appConfig' },
    })({ onLaunch: jest.fn(), onShow: originalOnShow }) as any

    expect(app.onShow).toBe(originalOnShow)
  })

  it('onShow 注入抛错时仍转发用户 onShow 且错误外抛', () => {
    const store = makeStore()
    const originalOnShow = jest.fn()
    const app = withAppStore(store, {
      autoInject: true,
      injectMapping: { config: 'appConfig' },
      autoUpdateOnShow: true,
    })({ onLaunch: jest.fn(), onShow: originalOnShow }) as any

    // 冻结的 globalData：写入必然失败，用来验证「注入抛错」不吞用户生命周期
    app.globalData = Object.freeze({})

    expect(() => app.onShow()).toThrow(TypeError)
    expect(originalOnShow).toHaveBeenCalledTimes(1)
  })
})

describe('R5-286 App 的 action 退订登记进重复绑定守卫', () => {
  function makeStore() {
    return createStore<{ count: number }>({
      state: { count: 0 },
      actions: {
        increment() {
          this.setState('count', this.state.count + 1)
        },
      },
    })
  }

  it('重复 onLaunch 不再对自家绑定的 action 报「宿主已有成员」', () => {
    const store = makeStore()
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const app = withAppStore(store, { mapState: ['count'], mapActions: ['increment'] })({ onLaunch: jest.fn() }) as any

    app.onLaunch()
    app.onLaunch()

    expect(warnSpy).not.toHaveBeenCalled()
    app.increment()
    expect(store.state.count).toBe(1)
    expect(app.globalData.count).toBe(1)
    // 状态订阅也只保留一份：一次通知一次写入
    warnSpy.mockRestore()
  })

  it('真宿主成员每次 launch 各告警一次，快照始终是用户原值', () => {
    const store = makeStore()
    const userMethod = () => 'user-original'
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const app = withAppStore(store, { mapActions: { increment: 'increment' } })({ onLaunch: jest.fn() }) as any
    const instance: any = { increment: userMethod }

    app.onLaunch.call(instance)
    expect(instance.increment).not.toBe(userMethod)
    app.onLaunch.call(instance)

    expect(warnSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy.mock.calls[1][0]).toContain('宿主已有成员')
    instance.increment()
    expect(store.state.count).toBe(1)
    warnSpy.mockRestore()
  })
})

describe('R5-287 globalData 覆盖宿主成员时告警', () => {
  it('映射键与 globalData 已有成员同名 → 告警点名冲突键', () => {
    const store = createStore<{ theme: string }>({
      state: { theme: 'dark' },
      getters: { label: (state) => `label:${state.theme}` },
    })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const app = withAppStore(store, { mapState: ['theme'], mapGetters: ['label'] })({
      globalData: { theme: 'light', label: 'host', keep: 1 },
      onLaunch: jest.fn(),
    }) as any

    app.onLaunch()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('theme')
    expect(warnSpy.mock.calls[0][0]).toContain('label')
    // store 是事实来源：覆盖仍然发生，只是不再静默
    expect(app.globalData.theme).toBe('dark')
    expect(app.globalData.label).toBe('label:dark')
    expect(app.globalData.keep).toBe(1)
    warnSpy.mockRestore()
  })

  it('无冲突时不产生告警', () => {
    const store = createStore<{ theme: string }>({ state: { theme: 'dark' } })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const app = withAppStore(store, { mapState: ['theme'] })({ globalData: { other: 1 }, onLaunch: jest.fn() }) as any

    app.onLaunch()

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('R5-288 生命周期重入时先清理旧订阅', () => {
  it('Page 重复 onLoad 只保留一份订阅', () => {
    const store = createStore<{ count: number }>({ state: { count: 0 } })
    const setData = jest.fn((updates: Record<string, unknown>) => Object.assign(instance.data, updates))
    const instance: any = { data: {}, setData }
    const config = withPageStore(store, { mapState: ['count'] })({ data: {}, onLoad: jest.fn() }) as any

    config.onLoad.call(instance)
    config.onLoad.call(instance)
    setData.mockClear()
    store.setState('count', 5)

    expect(setData).toHaveBeenCalledTimes(1)
    expect(instance.__geomUnbinds).toHaveLength(1)
  })

  it('Component 重复 attached 只保留一份订阅', () => {
    const store = createStore<{ count: number }>({ state: { count: 0 } })
    const setData = jest.fn((updates: Record<string, unknown>) => Object.assign(instance.data, updates))
    const instance: any = { data: {}, setData }
    const config = withComponentStore(store, { mapState: ['count'] })({
      data: {},
      lifetimes: { attached: jest.fn() },
    }) as any

    config.lifetimes.attached.call(instance)
    config.lifetimes.attached.call(instance)
    setData.mockClear()
    store.setState('count', 5)

    expect(setData).toHaveBeenCalledTimes(1)
    expect(instance.__geomUnbinds).toHaveLength(1)
  })

  it('Page onLoad → onUnload → onLoad 仍可正常重新绑定', () => {
    const store = createStore<{ count: number }>({ state: { count: 0 } })
    const instance: any = {
      data: {},
      setData: jest.fn((updates: Record<string, unknown>) => Object.assign(instance.data, updates)),
    }
    const config = withPageStore(store, { mapState: ['count'] })({ data: {}, onLoad: jest.fn() }) as any

    config.onLoad.call(instance)
    config.onUnload.call(instance)
    store.setState('count', 1)
    expect(instance.data.count).toBe(0)

    config.onLoad.call(instance)
    expect(instance.data.count).toBe(1)
    store.setState('count', 2)
    expect(instance.data.count).toBe(2)
  })
})

describe('R5-289 无注入条目时不安装包装器', () => {
  it('Page：injectMapping 为空对象时 onShow 保持原函数', () => {
    const store = createStore({ state: { count: 0 } })
    const originalOnShow = jest.fn()
    const config = withPageStore(store, {
      autoInject: true,
      autoUpdateOnShow: true,
      injectMapping: {},
    })({ data: {}, onLoad: jest.fn(), onShow: originalOnShow }) as any

    expect(config.onShow).toBe(originalOnShow)
  })

  it('Component：injectMapping 为空对象时 pageLifetimes.show 保持原函数', () => {
    const store = createStore({ state: { count: 0 } })
    const originalShow = jest.fn()
    const config = withComponentStore(store, {
      autoInject: true,
      autoUpdateOnShow: true,
      injectMapping: {},
    })({ data: {}, lifetimes: {}, pageLifetimes: { show: originalShow } }) as any

    expect(config.pageLifetimes.show).toBe(originalShow)
  })

  it('App：injectMapping 为空对象时 onShow 保持原函数', () => {
    const store = createStore({ state: { count: 0 } })
    const originalOnShow = jest.fn()
    const app = withAppStore(store, {
      autoInject: true,
      autoUpdateOnShow: true,
      injectMapping: {},
    })({ onLaunch: jest.fn(), onShow: originalOnShow }) as any

    expect(app.onShow).toBe(originalOnShow)
  })
})

describe('R5-290 注入抛不得吞掉用户生命周期', () => {
  it('Component pageLifetimes.show：注入抛错时仍转发原始 show', () => {
    const store = createStore<{ count: number }>({ state: { count: 42 }, enableCache: true })
    const originalShow = jest.fn()
    const instance: any = {
      data: {},
      setData: jest.fn(() => {
        throw new Error('setData boom')
      }),
    }
    const config = withComponentStore(store, {
      autoInject: true,
      autoUpdateOnShow: true,
      injectMapping: { count: 'compCount' },
    })({ data: {}, lifetimes: {}, pageLifetimes: { show: originalShow } }) as any

    expect(() => config.pageLifetimes.show.call(instance)).toThrow('setData boom')
    expect(originalShow).toHaveBeenCalledTimes(1)
  })

  it('Page onShow：注入抛错时仍转发原始 onShow', () => {
    const store = createStore<{ count: number }>({ state: { count: 42 }, enableCache: true })
    const originalOnShow = jest.fn()
    const instance: any = {
      data: {},
      setData: jest.fn(() => {
        throw new Error('setData boom')
      }),
    }
    const config = withPageStore(store, {
      autoInject: true,
      autoUpdateOnShow: true,
      injectMapping: { count: 'cached' },
    })({ data: {}, onLoad: jest.fn(), onShow: originalOnShow }) as any

    expect(() => config.onShow.call(instance)).toThrow('setData boom')
    expect(originalOnShow).toHaveBeenCalledTimes(1)
  })
})

describe('R5-291 绑定中途抛错时回滚已登记订阅', () => {
  it('Page onLoad：自动注入抛错 → 已登记的 state 订阅被回滚', () => {
    const store = createStore<{ count: number }>({ state: { count: 0 }, enableCache: true })
    const onLoad = jest.fn()
    const setData = jest.fn((updates: Record<string, unknown>) => {
      if ('cached' in updates) {
        throw new Error('inject failed')
      }
      Object.assign(instance.data, updates)
    })
    const instance: any = { data: {}, setData }
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const config = withPageStore(store, {
      mapState: ['count'],
      autoInject: true,
      injectMapping: { count: 'cached' },
    })({ data: {}, onLoad }) as any

    expect(() => config.onLoad.call(instance)).toThrow('inject failed')
    expect(instance.__geomUnbinds).toHaveLength(0)
    expect(onLoad).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('绑定映射失败'), expect.anything())

    setData.mockClear()
    store.setState('count', 9)
    expect(setData).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('Component attached：绑定抛错 → 订阅回滚且不转发用户 attached', () => {
    const store = createStore<{ count: number }>({
      state: { count: 0 },
      getters: {
        boom: (_state: { count: number }): number => {
          throw new Error('getter boom')
        },
      },
    })
    const attached = jest.fn()
    const setData = jest.fn((updates: Record<string, unknown>) => Object.assign(instance.data, updates))
    const instance: any = { data: {}, setData }
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const config = withComponentStore(store, {
      mapState: ['count'],
      mapGetters: ['boom'],
    })({ data: {}, lifetimes: { attached } }) as any

    expect(() => config.lifetimes.attached.call(instance)).toThrow('execution failed')
    expect(instance.__geomUnbinds).toHaveLength(0)
    expect(attached).not.toHaveBeenCalled()

    setData.mockClear()
    store.setState('count', 9)
    expect(setData).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('App onLaunch：绑定抛错 → 订阅回滚，用户 onLaunch 不在半初始化实例上执行', () => {
    const store = createStore<{ count: number }>({
      state: { count: 0 },
      getters: {
        boom: (_state: { count: number }): number => {
          throw new Error('getter boom')
        },
      },
    })
    const onLaunch = jest.fn()
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const config = withAppStore(store, { mapState: ['count'], mapGetters: ['boom'] })({ onLaunch }) as any
    const instance: any = { globalData: {} }

    expect(() => config.onLaunch.call(instance)).toThrow('execution failed')
    expect(onLaunch).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('绑定映射失败'), expect.anything())

    store.setState('count', 5)
    expect(instance.globalData.count).toBe(0)
    warnSpy.mockRestore()
  })
})
