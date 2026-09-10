/**
 * 全局调试入口的两条 no-op 兜底路径
 *
 * - registerGlobalEntry：`globalThis` 缺失时返回 no-op 卸载函数
 *   （通过临时删除全局 globalThis 绑定触发：typeof 对未声明标识符返回 'undefined' 而不抛错）
 * - timeTravel 插件：生产模式下不注册全局入口，卸载器保持为初始 no-op
 *   （isProduction 有模块级缓存，需 isolateModules + NODE_ENV=production 才能命中）
 */
import { registerGlobalEntry } from '@/plugins/globalRegistry.js'
import { createStore } from '@/core/store/index.js'

describe('全局调试入口的 no-op 兜底', () => {
  it('globalThis 缺失时返回 no-op 卸载函数，调用不抛错', () => {
    const globalObj = globalThis as unknown as Record<string, unknown>
    const descriptor = Object.getOwnPropertyDescriptor(globalObj, 'globalThis')

    let sawUndefined = false
    let unregister: (() => void) | undefined

    // 删除窗口内只做「取值 → 调用」，避免测试框架自身访问 globalThis
    delete globalObj.globalThis
    try {
      sawUndefined = typeof globalThis === 'undefined'
      unregister = registerGlobalEntry('__GEOMSTORE_TEST__', 'store-a', { ping: () => 'pong' })
    } finally {
      if (descriptor) {
        Object.defineProperty(globalObj, 'globalThis', descriptor)
      }
    }

    expect(sawUndefined).toBe(true)
    expect(typeof unregister).toBe('function')
    expect(() => unregister?.()).not.toThrow()
    expect(globalObj.__GEOMSTORE_TEST__).toBeUndefined()
  })

  it('全局入口存在时正常注册，且卸载只清理仍属于本次注册的条目', () => {
    const api = { ping: () => 'pong' }
    const unregister = registerGlobalEntry('__GEOMSTORE_TEST_2__', 'store-b', api)

    const table = (globalThis as unknown as Record<string, Record<string, unknown>>).__GEOMSTORE_TEST_2__
    expect(table['store-b']).toBe(api)

    unregister()
    expect(table['store-b']).toBeUndefined()
  })

  it('生产模式下 timeTravel 不注册全局入口，卸载器为 no-op', async () => {
    const store = createStore({ name: 'prod-time-travel', state: { count: 1 } })
    const prevEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      await jest.isolateModulesAsync(async () => {
        const { timeTravelPlugin } = await import('@/plugins/devtools/timeTravelPlugin.js')
        const plugin = timeTravelPlugin({}) as unknown as {
          install: (target: unknown) => (() => void) | void
        }

        const uninstall = plugin.install(store)

        // 生产模式：不注册全局入口（unregisterGlobal 仍是初始 no-op）
        expect((globalThis as unknown as Record<string, unknown>).__GEOMSTORE_TIME_TRAVEL__).toBeUndefined()
        expect(typeof uninstall).toBe('function')
        // 调用 no-op 卸载器：既不得抛出，也不得访问全局表
        expect(() => (uninstall as () => void)()).not.toThrow()
      })
    } finally {
      process.env.NODE_ENV = prevEnv
    }

    expect((store as unknown as Record<string, unknown>).__timeTravel__).toBeUndefined()
  })
})
