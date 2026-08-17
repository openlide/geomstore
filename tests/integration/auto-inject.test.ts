/**
 * 自动注入功能测试
 *
 * 测试内容：
 * - Page 自动注入
 * - Component 自动注入
 * - App 自动注入
 * - 注入时机
 * - 缓存集成
 */

import { Store } from '../../src/core/store/Store'
import { withPageStore, withComponentStore } from '../../src/integrations/with-store'
import { withAppStore } from '../../src/integrations/with-app-store'

// 模拟微信小程序环境（App 类型由 src/types/global.ts 全局声明提供）
declare global {
  var Page: jest.Mock
  var Component: jest.Mock
}

// App 构造器为 jest.Mock（运行时由 beforeEach 注入 globalThis.App，需惰性获取）
const App = (): jest.Mock => (globalThis as any).App as jest.Mock

const mockPageCallback = jest.fn()
const mockComponentCallback = jest.fn()
const mockAppCallback = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()

  // 模拟 Page API
  global.Page = jest.fn((config) => {
    mockPageCallback(config)
    return config
  }) as jest.Mock

  // 模拟 Component API
  global.Component = jest.fn((config) => {
    mockComponentCallback(config)
    return config
  }) as jest.Mock

  // 模拟 App API（App 类型为只读声明，通过 any 绕过类型写入）
  ;(globalThis as any).App = jest.fn((config) => {
    mockAppCallback(config)
    return config
  }) as jest.Mock
})

describe('自动注入功能', () => {
  describe('withPageStore 自动注入', () => {
    it('应该在 onLoad 时自动注入状态', () => {
      const store = new Store<{
        navBarHeight: number
        statusBarHeight: number
        safeArea: Record<string, number>
      }>({
        name: 'device-store',
        state: {
          navBarHeight: 44,
          statusBarHeight: 47,
          safeArea: { top: 47, bottom: 34 },
        },
        enableCache: true,
      })

      const pageConfig = {
        data: {
          localData: 'test',
        },
        onLoad: jest.fn(function (this: any) {
          // setData 在微信小程序中是异步的，所以这里检查 setData 调用
          // 而不是直接检查 this.data
        }),
      }

      // 使用 withPageStore 并启用自动注入
      Page(
        withPageStore(store, {
          autoInject: true,
          injectMapping: {
            navBarHeight: 'navigationBarHeight',
            statusBarHeight: 'statusBar',
            safeArea: 'safeArea',
          },
        })(pageConfig),
      )

      // 模拟页面加载
      const enhancedConfig = mockPageCallback.mock.calls[0][0]
      const mockPageInstance = {
        data: { ...pageConfig.data } as Record<string, unknown>,
        setData: jest.fn((data: any) => {
          // 模拟 setData 同步更新 data（用于测试）
          Object.assign(mockPageInstance.data, data)
        }),
      }

      enhancedConfig.onLoad.call(mockPageInstance)

      // 验证 setData 被调用，注入了指定的状态
      expect(mockPageInstance.setData).toHaveBeenCalledWith({
        navigationBarHeight: 44,
        statusBar: 47,
        safeArea: { top: 47, bottom: 34 },
      })

      // 验证 data 被正确更新
      expect(mockPageInstance.data.navigationBarHeight).toBe(44)
      expect(mockPageInstance.data.statusBar).toBe(47)
      expect(mockPageInstance.data.safeArea).toEqual({ top: 47, bottom: 34 })

      // 验证原始 onLoad 被调用
      expect(pageConfig.onLoad).toHaveBeenCalled()
    })

    it('应该在 onShow 时更新注入（如果启用 autoUpdateOnShow）', () => {
      const store = new Store<{ navBarHeight: number; theme: string }>({
        name: 'device-store',
        state: {
          navBarHeight: 44,
          theme: 'light',
        },
        enableCache: true,
      })

      const pageConfig = {
        data: {} as Record<string, unknown>,
        onLoad: jest.fn(),
        onShow: jest.fn(),
      }

      // 使用 withPageStore 并启用自动注入和自动更新
      Page(
        withPageStore(store, {
          autoInject: true,
          injectMapping: {
            navBarHeight: 'navigationBarHeight',
          },
          autoUpdateOnShow: true,
        })(pageConfig),
      )

      const enhancedConfig = mockPageCallback.mock.calls[0][0]
      const mockPageInstance = {
        data: {} as Record<string, unknown>,
        setData: jest.fn((data: any) => {
          Object.assign(mockPageInstance.data, data)
        }),
      }

      // 模拟页面加载
      enhancedConfig.onLoad.call(mockPageInstance)
      expect(mockPageInstance.setData).toHaveBeenCalledWith({
        navigationBarHeight: 44,
      })
      expect(mockPageInstance.data.navigationBarHeight).toBe(44)
      mockPageInstance.setData.mockClear()

      // 修改状态
      store.setState('navBarHeight', 88)

      // 模拟页面显示
      enhancedConfig.onShow.call(mockPageInstance)
      expect(mockPageInstance.setData).toHaveBeenCalledWith({
        navigationBarHeight: 88,
      })
      expect(mockPageInstance.data.navigationBarHeight).toBe(88)
    })

    it('应该兼容现有的 mapState 功能', () => {
      const store = new Store<{ count: number; name: string }>({
        name: 'test-store',
        state: {
          count: 0,
          name: 'test',
        },
        enableCache: true,
      })

      const pageConfig = {
        data: {} as Record<string, unknown>,
        onLoad: jest.fn(),
      }

      // 同时使用 autoInject 和 mapState
      Page(
        withPageStore(store, {
          autoInject: true,
          injectMapping: {
            count: 'cachedCount',
          },
          mapState: ['name'],
        })(pageConfig),
      )

      const enhancedConfig = mockPageCallback.mock.calls[0][0]
      const mockPageInstance = {
        data: {} as Record<string, unknown>,
        setData: jest.fn((data: any) => {
          Object.assign(mockPageInstance.data, data)
        }),
      }

      enhancedConfig.onLoad.call(mockPageInstance)

      // autoInject 应该注入 cachedCount
      expect(mockPageInstance.setData).toHaveBeenCalledWith({
        cachedCount: 0,
      })
      expect(mockPageInstance.data.cachedCount).toBe(0)

      // mapState 应该注入 name
      expect(mockPageInstance.setData).toHaveBeenCalledWith({
        name: 'test',
      })
      expect(mockPageInstance.data.name).toBe('test')
    })
  })

  describe('withComponentStore 自动注入', () => {
    it('应该在 attached 时自动注入状态', () => {
      const store = new Store<{ theme: string; color: string }>({
        name: 'theme-store',
        state: {
          theme: 'light',
          color: '#ffffff',
        },
        enableCache: true,
      })

      const componentConfig = {
        data: {} as Record<string, unknown>,
        methods: {
          onTap: jest.fn(),
        },
        lifetimes: {
          attached: jest.fn(function (this: any) {
            // setData 在微信小程序中是异步的
          }),
        },
      }

      // 使用 withComponentStore 并启用自动注入
      Component(
        withComponentStore(store, {
          autoInject: true,
          injectMapping: {
            theme: 'currentTheme',
            color: 'textColor',
          },
        })(componentConfig),
      )

      const enhancedConfig = mockComponentCallback.mock.calls[0][0]
      const mockComponentInstance = {
        data: {} as Record<string, unknown>,
        setData: jest.fn((data: any) => {
          // 模拟 setData 同步更新 data（用于测试）
          Object.assign(mockComponentInstance.data, data)
        }),
        methods: {},
      }

      enhancedConfig.lifetimes.attached.call(mockComponentInstance)

      // 验证 setData 被调用，注入了指定的状态
      expect(mockComponentInstance.setData).toHaveBeenCalledWith({
        currentTheme: 'light',
        textColor: '#ffffff',
      })

      // 验证 data 被正确更新
      expect(mockComponentInstance.data.currentTheme).toBe('light')
      expect(mockComponentInstance.data.textColor).toBe('#ffffff')

      // 验证原始 attached 被调用
      expect(componentConfig.lifetimes.attached).toHaveBeenCalled()
    })

    it('应该与 methods 集成', () => {
      const store = new Store<{ count: number }>({
        name: 'counter-store',
        state: { count: 0 },
        actions: {
          increment() {
            this.setState('count', this.state.count + 1)
          },
        },
        enableCache: true,
      })

      const componentConfig = {
        data: {} as Record<string, unknown>,
        methods: {
          handleIncrement: jest.fn(),
        },
        lifetimes: {
          attached: jest.fn(),
        },
      }

      // 使用自动注入和 mapActions
      Component(
        withComponentStore(store, {
          autoInject: true,
          injectMapping: {
            count: 'currentCount',
          },
          mapActions: ['increment'],
        })(componentConfig),
      )

      const enhancedConfig = mockComponentCallback.mock.calls[0][0]
      const mockComponentInstance = {
        data: {} as Record<string, unknown>,
        setData: jest.fn((data: any) => {
          Object.assign(mockComponentInstance.data, data)
        }),
        methods: {} as Record<string, (...args: any[]) => void>,
      }

      enhancedConfig.lifetimes.attached.call(mockComponentInstance)

      // 验证 actions 被绑定到 methods
      expect(typeof enhancedConfig.methods.increment).toBe('function')
      expect(typeof mockComponentInstance.methods.increment).toBe('function')

      // 测试 action 可以正常调用
      mockComponentInstance.methods.increment()
      expect(store.state.count).toBe(1)
    })
  })

  describe('withAppStore 自动注入', () => {
    it('应该在 onLaunch 时自动注入状态到 globalData', () => {
      const store = new Store<{ config: Record<string, unknown>; theme: string }>({
        name: 'app-store',
        state: {
          config: { apiBaseUrl: 'https://api.example.com' },
          theme: 'light',
        },
        enableCache: true,
      })

      const appConfig = {
        globalData: {
          existingData: 'test',
        },
        onLaunch: jest.fn(function (this: any) {
          // onLaunch 应该在自动注入之后调用
          expect(this.globalData.appConfig).toEqual({ apiBaseUrl: 'https://api.example.com' })
          expect(this.globalData.currentTheme).toBe('light')
        }),
      }

      // 使用 withAppStore 并启用自动注入
      App()(
        withAppStore(store, {
          autoInject: true,
          injectMapping: {
            config: 'appConfig',
            theme: 'currentTheme',
          },
        })(appConfig),
      )

      const enhancedConfig = mockAppCallback.mock.calls[0][0]
      const mockAppInstance = {
        globalData: { ...appConfig.globalData } as Record<string, unknown>,
      }

      enhancedConfig.onLaunch.call(mockAppInstance)

      // 验证 globalData 被更新
      expect(mockAppInstance.globalData.appConfig).toEqual({ apiBaseUrl: 'https://api.example.com' })
      expect(mockAppInstance.globalData.currentTheme).toBe('light')
      expect(mockAppInstance.globalData.existingData).toBe('test')

      // 验证原始 onLaunch 被调用
      expect(appConfig.onLaunch).toHaveBeenCalled()
    })

    it('应该暴露 getCached 方法', () => {
      const store = new Store<{ device: Record<string, unknown> }>({
        name: 'device-store',
        state: {
          device: { platform: 'ios' },
        },
        enableCache: true,
      })

      const appConfig = {
        onLaunch: jest.fn(),
      }

      App()(withAppStore(store)(appConfig))

      const enhancedConfig = mockAppCallback.mock.calls[0][0]
      const mockAppInstance: Record<string, any> = {}

      enhancedConfig.onLaunch.call(mockAppInstance)

      // 验证 getCached 方法被暴露
      expect(typeof mockAppInstance.getCached).toBe('function')

      // 测试 getCached 方法
      const device = mockAppInstance.getCached('device')
      expect(device).toEqual({ platform: 'ios' })
    })
  })

  describe('缓存集成', () => {
    it('自动注入应该使用 getCached 方法', () => {
      let getCachedCallCount = 0
      const originalGetCached = Store.prototype.getCached

      Store.prototype.getCached = function (key) {
        getCachedCallCount++
        return originalGetCached.call(this, key)
      }

      try {
        const store = new Store<{ device: Record<string, unknown> }>({
          name: 'device-store',
          state: {
            device: { platform: 'ios' },
          },
          enableCache: true,
        })

        const pageConfig = {
          data: {} as Record<string, unknown>,
          onLoad: jest.fn(),
        }

        Page(
          withPageStore(store, {
            autoInject: true,
            injectMapping: {
              device: 'deviceInfo',
            },
          })(pageConfig),
        )

        const enhancedConfig = mockPageCallback.mock.calls[0][0]
        const mockPageInstance = {
          data: {} as Record<string, unknown>,
          setData: jest.fn(),
        }

        enhancedConfig.onLoad.call(mockPageInstance)

        // 验证使用了 getCached
        expect(getCachedCallCount).toBe(1)
      } finally {
        // 恢复原方法
        Store.prototype.getCached = originalGetCached
      }
    })

    it('缓存更新后重新注入应该获取新值', () => {
      const store = new Store<{ theme: string }>({
        name: 'theme-store',
        state: {
          theme: 'light',
        },
        enableCache: true,
      })

      const pageConfig = {
        data: {} as Record<string, unknown>,
        onLoad: jest.fn(),
      }

      Page(
        withPageStore(store, {
          autoInject: true,
          injectMapping: {
            theme: 'currentTheme',
          },
          autoUpdateOnShow: true,
        })(pageConfig),
      )

      const enhancedConfig = mockPageCallback.mock.calls[0][0]
      const mockPageInstance = {
        data: {} as Record<string, unknown>,
        setData: jest.fn((data: any) => {
          Object.assign(mockPageInstance.data, data)
        }),
      }

      // 首次加载
      enhancedConfig.onLoad.call(mockPageInstance)
      expect(mockPageInstance.setData).toHaveBeenCalledWith({ currentTheme: 'light' })
      expect(mockPageInstance.data.currentTheme).toBe('light')

      mockPageInstance.setData.mockClear()

      // 更新状态（缓存自动更新）
      store.setState('theme', 'dark')

      // 重新注入
      mockPageInstance.data.currentTheme = 'light' // 模拟之前的状态
      enhancedConfig.onShow.call(mockPageInstance)
      expect(mockPageInstance.setData).toHaveBeenCalledWith({ currentTheme: 'dark' })
      expect(mockPageInstance.data.currentTheme).toBe('dark')
    })
  })

  describe('未启用自动注入时', () => {
    it('autoInject 为 false 时不应该注入', () => {
      const store = new Store<{ device: Record<string, unknown> }>({
        name: 'device-store',
        state: {
          device: { platform: 'ios' },
        },
        enableCache: true,
      })

      const pageConfig = {
        data: {} as Record<string, unknown>,
        onLoad: jest.fn(),
      }

      Page(
        withPageStore(store, {
          autoInject: false,
          injectMapping: {
            device: 'deviceInfo',
          },
        })(pageConfig),
      )

      const enhancedConfig = mockPageCallback.mock.calls[0][0]
      const mockPageInstance = {
        data: {} as Record<string, unknown>,
        setData: jest.fn(),
      }

      enhancedConfig.onLoad.call(mockPageInstance)

      // setData 不应该被调用（因为 autoInject 为 false）
      expect(mockPageInstance.setData).not.toHaveBeenCalled()
    })

    it('未提供 injectMapping 时不应该注入', () => {
      const store = new Store<{ device: Record<string, unknown> }>({
        name: 'device-store',
        state: {
          device: { platform: 'ios' },
        },
        enableCache: true,
      })

      const pageConfig = {
        data: {} as Record<string, unknown>,
        onLoad: jest.fn(),
      }

      Page(withPageStore(store, { autoInject: true })(pageConfig))

      const enhancedConfig = mockPageCallback.mock.calls[0][0]
      const mockPageInstance = {
        data: {} as Record<string, unknown>,
        setData: jest.fn(),
      }

      enhancedConfig.onLoad.call(mockPageInstance)

      // setData 不应该被调用（因为没有 injectMapping）
      expect(mockPageInstance.setData).not.toHaveBeenCalled()
    })
  })

  describe('清理逻辑', () => {
    it('页面卸载时应该清理订阅', () => {
      const store = new Store<{ device: Record<string, unknown> }>({
        name: 'device-store',
        state: {
          device: { platform: 'ios' },
        },
        enableCache: true,
      })

      const pageConfig = {
        data: {} as Record<string, unknown>,
        onLoad: jest.fn(),
        onUnload: jest.fn(),
      }

      Page(
        withPageStore(store, {
          autoInject: true,
          injectMapping: {
            device: 'deviceInfo',
          },
        })(pageConfig),
      )

      const enhancedConfig = mockPageCallback.mock.calls[0][0]
      const mockPageInstance = {
        data: {} as Record<string, unknown>,
        setData: jest.fn(),
      }

      enhancedConfig.onLoad.call(mockPageInstance)

      // 卸载页面
      enhancedConfig.onUnload()
      expect(pageConfig.onUnload).toHaveBeenCalled()

      // 订阅应该被清理（这里只是测试逻辑执行，实际清理在内部）
    })

    it('组件 detached 时应该清理订阅', () => {
      const store = new Store<{ device: Record<string, unknown> }>({
        name: 'device-store',
        state: {
          device: { platform: 'ios' },
        },
        enableCache: true,
      })

      const componentConfig = {
        data: {} as Record<string, unknown>,
        methods: {},
        lifetimes: {
          attached: jest.fn(),
          detached: jest.fn(),
        },
      }

      Component(
        withComponentStore(store, {
          autoInject: true,
          injectMapping: {
            device: 'deviceInfo',
          },
        })(componentConfig),
      )

      const enhancedConfig = mockComponentCallback.mock.calls[0][0]
      const mockComponentInstance = {
        data: {} as Record<string, unknown>,
        setData: jest.fn(),
        methods: {},
      }

      enhancedConfig.lifetimes.attached.call(mockComponentInstance)

      // 分离组件
      enhancedConfig.lifetimes.detached()
      expect(componentConfig.lifetimes.detached).toHaveBeenCalled()
    })
  })
})
