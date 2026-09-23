/**
 * 生产模式下的日志静默
 *
 * 库内多处 `if (!isProduction())` 的开发期日志/告警在生产构建下必须被跳过。
 * `isProduction()` 结果在模块实例内**永久缓存**，故本文件用 `jest.isolateModulesAsync`
 * 取得全新模块注册表、并在**加载期**临时置 `NODE_ENV=production`，使这些模块内的
 * 判定结果为生产模式；加载完即恢复环境变量，避免影响其余测试。
 *
 * 覆盖面：HookSystem(usePlugin 安装/卸载)、Store.use 重复安装、SubscriptionManager
 * 订阅上限与监听器抛错、订阅者驱逐上报通道、composeStore 子 store 重名、compose/helpers 已销毁子 store
 * 与写入竞态、withCache 命中/in-flight 去重、persistencePlugin 安装/无后端降级/恢复、
 * analyzerPlugin 卸载时 getter 已被重新包装。
 */

describe('生产模式下的日志静默', () => {
  let mod: Record<string, any>
  let debugSpy: jest.SpyInstance
  let warnSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance
  let errorSpy: jest.SpyInstance
  const originalWx = (globalThis as any).wx

  let prevEnv: string | undefined

  beforeAll(async () => {
    // NODE_ENV 必须保持到本文件全部用例结束：各模块的 isProduction() 在**首次被调用时**
    // 才读取并缓存 NODE_ENV，而首次调用发生在测试体内（而非模块加载期），
    // 若在加载后立即还原环境变量，判定会退回开发模式。
    prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    // 清空模块注册表：后续 import 重新加载全新模块实例，使 isProduction() 缓存按生产模式判定
    jest.resetModules()
    mod = {
      isProduction: (await import('@/core/store/utils.js')).isProduction,
      usePlugin: (await import('@/core/hooks/index.js')).usePlugin,
      HookSystem: (await import('@/core/hooks/index.js')).HookSystem,
      createStore: (await import('@/core/store/index.js')).createStore,
      SubscriptionManager: (await import('@/core/store/SubscriptionManager.js')).SubscriptionManager,
      composeStore: (await import('@/core/compose/index.js')).composeStore,
      dispatchByNamespace: (await import('@/core/compose/helpers.js')).dispatchByNamespace,
      withCache: (await import('@/extras/action/decorators/cache.js')).withCache,
      persistencePlugin: (await import('@/plugins/builtin.js')).persistencePlugin,
      createAnalyzerPlugin: (await import('@/plugins/performance/index.js')).createAnalyzerPlugin,
    }
  })

  afterAll(() => {
    process.env.NODE_ENV = prevEnv
  })

  beforeEach(() => {
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    debugSpy.mockRestore()
    warnSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
    ;(globalThis as any).wx = originalWx
  })

  it('前置自检：本次加载的模块确实按生产模式判定', () => {
    expect(mod.isProduction()).toBe(true)
  })

  it('usePlugin 安装与卸载均不输出调试日志', () => {
    const store = mod.createStore({ name: 'prod-plugin', state: { x: 1 } })
    const plugin = { name: 'noop', install: () => () => {} }

    const uninstall = mod.usePlugin(plugin, store)
    uninstall()

    expect(debugSpy).not.toHaveBeenCalled()
  })

  it('Store.use 重复安装同一插件实例时保持静默并幂等', () => {
    const store = mod.createStore({ name: 'prod-dup-plugin', state: { x: 1 } })
    const plugin = { name: 'dup', install: () => () => {} }

    store.use(plugin)
    const secondUninstall = store.use(plugin)

    expect(typeof secondUninstall).toBe('function')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('订阅者数量达上限时静默驱逐最旧监听器', () => {
    const store = mod.createStore({
      name: 'prod-sub-limit',
      state: { x: 1 },
      subscription: { maxSubscribers: 1, onLimit: 'evict-oldest' },
    })
    const first = jest.fn()
    const second = jest.fn()

    store.subscribe(first)
    store.subscribe(second)

    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('驱逐事件走宿主上报通道时控制台仍静默，通道自身抛错也不外泄', () => {
    const seen: unknown[] = []
    const manager = new mod.SubscriptionManager({
      storeName: 'prod-evict',
      maxSubscribers: 1,
      onSubscriberEvicted: (info: unknown) => {
        seen.push(info)
        throw new Error('eviction reporter down')
      },
      onListenerError: () => {
        throw new Error('listener reporter down')
      },
    })
    function earliestSubscriber() {}
    manager.add(earliestSubscriber)

    // 生产下既不打驱逐告警，也不让上报通道的抛错冒出来；事件本身仍送达
    expect(() => manager.add(() => {})).not.toThrow()
    expect(seen).toHaveLength(1)

    manager.add(() => {
      throw new Error('listener boom')
    })
    expect(() => manager.notify({ x: 1 })).not.toThrow()

    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('监听器抛错时静默吞掉（不输出详细日志），且不影响其余监听器', () => {
    const store = mod.createStore({ name: 'prod-listener-throw', state: { x: 1 } })
    const healthy = jest.fn()
    store.subscribe(() => {
      throw new Error('listener boom')
    })
    store.subscribe(healthy)

    store.$patch({ x: 2 })

    expect(healthy).toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('非命名空间模式下子 store 重名时静默（仅开发模式告警）', () => {
    const a = mod.createStore({ name: 'dup', state: { x: 1 } })
    const b = mod.createStore({ name: 'dup', state: { y: 2 } })

    expect(() => mod.composeStore([a, b])).not.toThrow()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('对已销毁子 store 的写入被静默跳过', () => {
    const alive = { name: 'a', destroyed: false, getState: () => ({ x: 1 }) }
    const dead = { name: 'b', destroyed: true, getState: () => ({ y: 2 }) }
    const handler = jest.fn()

    mod.dispatchByNamespace([alive, dead], undefined, { x: 1, y: 2 }, false, handler)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('子 store 在写入期间被销毁时静默吞掉竞态异常', () => {
    const racing = { name: 'c', destroyed: false, getState: () => ({ z: 3 }) }
    const handler = jest.fn((store: any) => {
      store.destroyed = true
      // 竞态吞掉的判据是「destroyed + 销毁守卫的固定文案」，非销毁类异常不得被静默
      throw new Error('[GeomStore] Cannot call $patch on a destroyed Store')
    })

    expect(() => mod.dispatchByNamespace([racing], undefined, { z: 3 }, false, handler)).not.toThrow()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('withCache 的 in-flight 去重与缓存命中均不输出调试日志', async () => {
    class Demo {
      calls = 0
      async load(this: Demo): Promise<number> {
        this.calls += 1
        return this.calls
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'load') as PropertyDescriptor
    mod.withCache()(Demo.prototype, 'load', descriptor)
    const host = new Demo()

    // 首次调用挂在 pending 上；第二次同参调用复用 in-flight Promise
    const first = descriptor.value.call(host) as Promise<number>
    const second = descriptor.value.call(host) as Promise<number>
    await expect(second).resolves.toBe(1)
    expect(second).toBe(first)

    // 结算后再次调用命中缓存，真实方法不再执行
    await expect(descriptor.value.call(host)).resolves.toBe(1)
    expect(host.calls).toBe(1)
    expect(debugSpy).not.toHaveBeenCalled()
  })

  it('persistencePlugin 直接安装时静默并完成恢复', () => {
    const storage = {
      getItem: (k: string) => (k.includes('prod-persist-restore') ? JSON.stringify({ x: 42 }) : null),
      setItem: () => {},
      removeItem: () => {},
    }
    const store = mod.createStore({ name: 'prod-persist-restore', state: { x: 1 }, actions: {} })

    store.use(mod.persistencePlugin({ storage }))

    expect(store.getState().x).toBe(42)
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('无可用的 storage 后端时静默降级为内存存储', () => {
    // 移除 wx：既无用户后端也无微信存储 → 走内存降级分支
    delete (globalThis as any).wx
    const store = mod.createStore({ name: 'prod-persist-memory', state: { x: 1 }, actions: {} })

    expect(() => store.use(mod.persistencePlugin())).not.toThrow()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('analyzerPlugin 卸载时 getter 已被重新包装也保持静默', () => {
    const store = mod.createStore({ name: 'prod-analyzer', state: { x: 1 } })

    const uninstall = store.use(mod.createAnalyzerPlugin())

    // 模拟后续插件重新包装 getter，触发「保留当前包装」的 else 分支
    const replacedGetter = () => undefined
    ;(store as any).getter = replacedGetter
    expect(() => uninstall()).not.toThrow()

    expect((store as any).getter).toBe(replacedGetter)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
