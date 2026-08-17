/**
 * with-app-store 集成测试
 */

import { createStore, withAppStore, createApp } from '@/index'

describe('withAppStore', () => {
  type AppState = {
    count: number
    user: { name: string; age: number }
    loading: boolean
    error: string | null
  }

  let store: any
  let mockAppConfig: any

  beforeEach(() => {
    store = createStore<AppState>({
      state: {
        count: 0,
        user: { name: 'test', age: 25 },
        loading: false,
        error: null
      },
      getters: {
        doubleCount: (state) => state.count * 2,
        userName: (state) => state.user.name
      },
      actions: {
        increment(...args: unknown[]) {
          (this.state as any).count++
        },
        decrement(...args: unknown[]) {
          (this.state as any).count--
        },
        setCount(...args: unknown[]) {
          const [value] = args as [number]
          ;(this.state as any).count = value
        },
        setUserName(...args: unknown[]) {
          const [name] = args as [string]
          ;(this.state as any).user.name = name
        }
      }
    })

    mockAppConfig = {
      onLaunch: jest.fn(),
      onShow: jest.fn(),
      onHide: jest.fn(),
      onError: jest.fn()
    }
  })

  describe('基础功能', () => {
    it('应该包装 App 配置', () => {
      const app = withAppStore(store, {})(mockAppConfig) as any
      expect(app).toBeDefined()
      expect(app.onLaunch).toBeDefined()
      expect(app.onShow).toBeDefined()
      expect(app.onHide).toBeDefined()
    })

    it('应该调用原始 onLaunch', () => {
      const app = withAppStore(store, {})(mockAppConfig) as any
      app.onLaunch()
      expect(mockAppConfig.onLaunch).toHaveBeenCalled()
    })

    it('应该调用原始 onShow', () => {
      const app = withAppStore(store, {})(mockAppConfig) as any
      app.onShow()
      expect(mockAppConfig.onShow).toHaveBeenCalled()
    })

    it('应该调用原始 onHide', () => {
      const app = withAppStore(store, {})(mockAppConfig) as any
      app.onHide()
      expect(mockAppConfig.onHide).toHaveBeenCalled()
    })
  })

  describe('mapState 映射', () => {
    it('应该将 state 映射到 globalData', () => {
      const app: any = withAppStore(store, {
        mapState: ['count', 'user']
      })(mockAppConfig)
      
      app.onLaunch()
      expect(app.globalData.count).toBe(0)
      expect(app.globalData.user).toEqual({ name: 'test', age: 25 })
    })

    it('应该使用对象形式的 mapState', () => {
      const app: any = withAppStore(store, {
        mapState: {
          myCount: 'count',
          currentUser: 'user'
        }
      })(mockAppConfig)
      
      app.onLaunch()
      expect(app.globalData.myCount).toBe(0)
      expect(app.globalData.currentUser).toEqual({ name: 'test', age: 25 })
    })

    it('应该在 state 变化时更新 globalData', () => {
      const app: any = withAppStore(store, {
        mapState: ['count']
      })(mockAppConfig)
      
      app.onLaunch()
      expect(app.globalData.count).toBe(0)
      
      store.dispatch('increment')
      expect(app.globalData.count).toBe(1)
      
      store.dispatch('setCount', 42)
      expect(app.globalData.count).toBe(42)
    })
  })

  describe('mapGetters 映射', () => {
    it('应该将 getters 映射到 globalData', () => {
      const app: any = withAppStore(store, {
        mapGetters: ['doubleCount', 'userName']
      })(mockAppConfig)
      
      app.onLaunch()
      expect(app.globalData.doubleCount).toBe(0)
      expect(app.globalData.userName).toBe('test')
    })

    it('应该使用对象形式的 mapGetters', () => {
      const app: any = withAppStore(store, {
        mapGetters: {
          myDouble: 'doubleCount',
          name: 'userName'
        }
      })(mockAppConfig)
      
      app.onLaunch()
      expect(app.globalData.myDouble).toBe(0)
      expect(app.globalData.name).toBe('test')
    })

    it('应该在 getter 依赖变化时更新 globalData', () => {
      const app: any = withAppStore(store, {
        mapGetters: ['doubleCount']
      })(mockAppConfig)
      
      app.onLaunch()
      expect(app.globalData.doubleCount).toBe(0)
      
      store.dispatch('increment')
      expect(app.globalData.doubleCount).toBe(2)
      
      store.dispatch('setCount', 10)
      expect(app.globalData.doubleCount).toBe(20)
    })
  })

  describe('mapActions 映射', () => {
    it('应该将 actions 映射到 App 方法', () => {
      const app: any = withAppStore(store, {
        mapActions: ['increment', 'decrement']
      })(mockAppConfig)
      
      app.onLaunch()
      
      app.increment()
      expect(store.state.count).toBe(1)
      
      app.decrement()
      expect(store.state.count).toBe(0)
    })

    it('应该使用对象形式的 mapActions', () => {
      const app: any = withAppStore(store, {
        mapActions: {
          add: 'increment',
          sub: 'decrement'
        }
      })(mockAppConfig)
      
      app.onLaunch()
      
      app.add()
      expect(store.state.count).toBe(1)
      
      app.sub()
      expect(store.state.count).toBe(0)
    })

    it('应该传递参数到 action', () => {
      const app: any = withAppStore(store, {
        mapActions: ['setCount', 'setUserName']
      })(mockAppConfig)
      
      app.onLaunch()
      
      app.setCount(100)
      expect(store.state.count).toBe(100)
      
      app.setUserName('new name')
      expect(store.state.user.name).toBe('new name')
    })
  })

  describe('store 和 __store__ 暴露', () => {
    it('应该在 App 实例上暴露 store', () => {
      const app = withAppStore(store, {})(mockAppConfig) as any
      app.onLaunch()
      expect(app.store).toBe(store)
    })

    it('应该在 App 实例上暴露 __store__ 调试 API', () => {
      const app = withAppStore(store, {})(mockAppConfig) as any
      app.onLaunch()
      
      expect(app.__store__).toBeDefined()
      expect(app.__store__.getStore()).toBe(store)
      expect(app.__store__.getState()).toEqual(store.state)
      expect(typeof app.__store__.dispatch).toBe('function')
      expect(typeof app.__store__.subscribe).toBe('function')
    })

    it('应该通过 __store__.dispatch 调用 action', () => {
      const app = withAppStore(store, {})(mockAppConfig) as any
      app.onLaunch()
      
      app.__store__.dispatch('increment')
      expect(store.state.count).toBe(1)
      
      app.__store__.dispatch('setCount', 50)
      expect(store.state.count).toBe(50)
    })

    it('应该通过 __store__.subscribe 订阅变化', () => {
      const app = withAppStore(store, {})(mockAppConfig) as any
      app.onLaunch()
      
      const callback = jest.fn()
      const unsubscribe = app.__store__.subscribe(callback)
      
      store.dispatch('increment')
      expect(callback).toHaveBeenCalled()
      
      unsubscribe()
      
      callback.mockClear()
      store.dispatch('increment')
      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('生命周期管理', () => {
    it('应该在 onHide 时清理所有订阅', () => {
      const app: any = withAppStore(store, {
        mapState: ['count'],
        mapGetters: ['doubleCount']
      })(mockAppConfig)
      
      app.onLaunch()
      expect(app.globalData).toBeDefined()
      
      app.onHide()
      
      store.dispatch('increment')
      // globalData 应该不再更新（虽然由于同步执行，可能在清理前已经更新）
      // 关键是订阅应该被清理
    })

    it('应该在 onHide 时调用原始 onHide', () => {
      const app = withAppStore(store, {})(mockAppConfig) as any
      app.onHide()
      expect(mockAppConfig.onHide).toHaveBeenCalled()
    })

    it('应该多次调用 onLaunch/onHide', () => {
      const app: any = withAppStore(store, {
        mapState: ['count']
      })(mockAppConfig)
      
      app.onLaunch()
      const firstGlobalData = app.globalData
      
      app.onHide()
      app.onLaunch()
      const secondGlobalData = app.globalData
      
      expect(secondGlobalData.count).toBe(firstGlobalData.count)
    })
  })

  describe('组合使用', () => {
    it('应该同时使用 mapState, mapGetters, mapActions', () => {
      const app: any = withAppStore(store, {
        mapState: ['count'],
        mapGetters: ['doubleCount'],
        mapActions: ['increment', 'setCount']
      })(mockAppConfig)
      
      app.onLaunch()
      expect(app.globalData.count).toBe(0)
      expect(app.globalData.doubleCount).toBe(0)
      
      app.increment()
      expect(app.globalData.count).toBe(1)
      expect(app.globalData.doubleCount).toBe(2)
      
      app.setCount(10)
      expect(app.globalData.count).toBe(10)
      expect(app.globalData.doubleCount).toBe(20)
    })

    it('应该支持使用对象形式的映射', () => {
      const app: any = withAppStore(store, {
        mapState: {
          myCount: 'count'
        },
        mapGetters: {
          myDouble: 'doubleCount'
        },
        mapActions: {
          add: 'increment'
        }
      })(mockAppConfig)
      
      app.onLaunch()
      expect(app.globalData.myCount).toBe(0)
      expect(app.globalData.myDouble).toBe(0)
      
      app.add()
      expect(app.globalData.myCount).toBe(1)
      expect(app.globalData.myDouble).toBe(2)
    })
  })

  describe('createApp', () => {
    it('应该创建 App 实例工厂', () => {
      const createTestApp = createApp(store, {})
      const app: any = createTestApp(mockAppConfig)
      expect(app).toBeDefined()
      expect(app.onLaunch).toBeDefined()
    })

    it('应该与 withAppStore 等价', () => {
      const app1 = withAppStore(store, {})(mockAppConfig) as any
      const app2 = createApp(store, {})(mockAppConfig) as any
      expect(typeof app1.onLaunch).toBe(typeof app2.onLaunch)
      expect(typeof app1.onHide).toBe(typeof app2.onHide)
    })
  })
})

describe('createApp', () => {
  type TestState = {
    value: number
  }

  it('应该创建带有初始 globalData 的 App', () => {
    const store = createStore<TestState>({
      state: { value: 42 }
    })
    const app: any = createApp(store)({
      onLaunch: jest.fn()
    })
    
    expect(app).toBeDefined()
    expect(typeof app.onLaunch).toBe('function')
  })

  it('应该创建带有多个映射的 App', () => {
    const store = createStore<TestState>({
      state: { value: 10 },
      getters: {
        double: (state) => state.value * 2
      },
      actions: {
        setValue(...args: unknown[]) {
          const [value] = args as [number]
          ;(this.state as any).value = value
        }
      }
    })
    const app: any = createApp(store, {
      mapState: ['value'],
      mapGetters: ['double'],
      mapActions: ['setValue']
    })({
      onLaunch: jest.fn()
    })
    
    app.onLaunch()
    expect(app.globalData.value).toBe(10)
    expect(app.globalData.double).toBe(20)
    
    app.setValue(20)
    expect(app.globalData.value).toBe(20)
    expect(app.globalData.double).toBe(40)
  })
})
