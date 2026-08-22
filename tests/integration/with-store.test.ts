/**
 * GeomStore v1.0.0 - 微信小程序集成测试
 * @file tests/integration/with-store.test.ts
 */

import { createStore, withPageStore, withComponentStore } from '@/index'

// Mock 微信小程序 setData
const mockSetData = jest.fn()

const mockPage: any = {
  data: {},
  setData(data: any) {
    mockSetData(data)
    Object.assign(this.data, data)
  },
  onLoad: jest.fn(),
  onUnload: jest.fn(),
}

const mockComponent: any = {
  data: {},
  setData(data: any) {
    mockSetData(data)
    Object.assign(this.data, data)
  },
  lifetimes: {
    attached: jest.fn(),
    detached: jest.fn(),
  },
  methods: {},
}

// 为所有测试禁用类型检查
declare global {
  namespace jest {
    interface Matchers<R> {
      toHaveBeenCalledTimes(n: number): R
      toHaveBeenCalled(): R
      toHaveBeenCalledWith(...args: any[]): R
      toHaveBeenCalledNthWith(n: number, ...args: any[]): R
      toThrow(): R
      toBe(expected: any): R
      toEqual(expected: any): R
      toBeDefined(): R
      toBeUndefined(): R
      toBeNull(): R
      toBeTruthy(): R
      toBeFalsy(): R
      toBeGreaterThan(n: number): R
      toBeLessThan(n: number): R
      toHaveLength(n: number): R
      toMatch(pattern: string | RegExp): R
      toContain(item: any): R
      toMatchObject(expected: any): R
    }
  }
}

describe('withPageStore - Page集成', () => {
  beforeEach(() => {
    mockSetData.mockClear()
    mockPage.data = {}
    mockPage.onLoad.mockClear()
    mockPage.onUnload.mockClear()
    mockComponent.data = {}
    mockComponent.lifetimes.attached.mockClear()
    mockComponent.lifetimes.detached.mockClear()
  })

  describe('基本功能', () => {
    it('INTEGRATION-001: 应该将store的state映射到page的data', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
      })

      const PageWithStore: any = withPageStore(store, {
        mapState: ['count', 'name'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      expect(mockPage.data.count).toBe(0)
      expect(mockPage.data.name).toBe('test')
    })

    it('INTEGRATION-002: state变化时应该自动更新page的data', () => {
      const store = createStore({
        state: { count: 0 },
      })

      const PageWithStore: any = withPageStore(store, {
        mapState: ['count'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      store.setState('count', 5)

      expect(mockPage.data.count).toBe(5)
    })

    it('INTEGRATION-003: $patch时应该更新所有映射的state', () => {
      const store = createStore({
        state: { count: 0, name: 'test', active: false },
      })

      const PageWithStore: any = withPageStore(store, {
        mapState: ['count', 'name', 'active'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      store.$patch({ count: 10, name: 'updated', active: true })

      expect(mockPage.data.count).toBe(10)
      expect(mockPage.data.name).toBe('updated')
      expect(mockPage.data.active).toBe(true)
    })

    it('INTEGRATION-004: $replaceState时应该处理映射的变化', () => {
      const store = createStore({
        state: { count: 0 },
      })

      const PageWithStore: any = withPageStore(store, {
        mapState: ['count'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      store.$replaceState({ count: 20 } as any)

      expect(mockPage.data.count).toBe(20)
    })
  })

  describe('mapState 对象映射', () => {
    it('INTEGRATION-005: 应该支持对象形式的mapState', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
      })

      const PageWithStore: any = withPageStore(store, {
        mapState: {
          pageCount: 'count',
          pageName: 'name',
        },
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      expect(mockPage.data.pageCount).toBe(0)
      expect(mockPage.data.pageName).toBe('test')
    })

    it('INTEGRATION-006: 对象映射state变化时应该更新', () => {
      const store = createStore({
        state: { count: 0 },
      })

      const PageWithStore: any = withPageStore(store, {
        mapState: {
          pageCount: 'count',
        },
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      store.setState('count', 10)

      expect(mockPage.data.pageCount).toBe(10)
    })
  })

  describe('mapGetters', () => {
    it('INTEGRATION-007: 应该将getters映射到page的data', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
        },
      })

      const PageWithStore: any = withPageStore(store, {
        mapGetters: ['double'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      expect(mockPage.data.double).toBe(0)
    })

    it('INTEGRATION-008: getters依赖的state变化时应该更新', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
        },
      })

      const PageWithStore: any = withPageStore(store, {
        mapGetters: ['double'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      store.setState('count', 5)

      expect(mockPage.data.double).toBe(10)
    })

    it('INTEGRATION-009: 应该支持对象形式的mapGetters', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
          triple(state) {
            return state.count * 3
          },
        },
      })

      const PageWithStore: any = withPageStore(store, {
        mapGetters: {
          pageDouble: 'double',
          pageTriple: 'triple',
        },
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      expect(mockPage.data.pageDouble).toBe(0)
      expect(mockPage.data.pageTriple).toBe(0)
    })
  })

  describe('mapActions', () => {
    it('INTEGRATION-010: 应该将actions映射到page的方法', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment(...args: unknown[]) {
            (this.state as any).count++
          },
        },
      })

      const PageWithStore: any = withPageStore(store, {
        mapActions: ['increment'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      expect(typeof mockPage.increment).toBe('function')
    })

    it('INTEGRATION-011: 调用映射的action应该执行store的action', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment(...args: unknown[]) {
            (this.state as any).count++
          },
        },
      })

      const PageWithStore: any = withPageStore(store, {
        mapActions: ['increment'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      mockPage.increment()

      expect(store.getState().count).toBe(1)
    })

    it('INTEGRATION-012: action应该接收参数', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          add(amount: number) {
            this.state.count += amount
          },
        },
      })

      const PageWithStore: any = withPageStore(store, {
        mapActions: ['add'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      mockPage.add(10)

      expect(store.getState().count).toBe(10)
    })

    it('INTEGRATION-013: action应该返回值', () => {
      const store = createStore({
        state: { count: 5 },
        actions: {
          double() {
            return this.state.count * 2
          },
        },
      })

      const PageWithStore: any = withPageStore(store, {
        mapActions: ['double'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      const result = mockPage.double()

      expect(result).toBe(10)
    })

    it('INTEGRATION-014: 应该支持对象形式的mapActions', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment() {
            this.state.count++
          },
          decrement() {
            this.state.count--
          },
        },
      })

      const PageWithStore: any = withPageStore(store, {
        mapActions: {
          pageIncrement: 'increment',
          pageDecrement: 'decrement',
        },
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      expect(typeof mockPage.pageIncrement).toBe('function')
      expect(typeof mockPage.pageDecrement).toBe('function')
    })
  })

  describe('生命周期', () => {
    it('INTEGRATION-015: onUnload应该取消所有订阅', () => {
      const store = createStore({
        state: { count: 0 },
      })

      const PageWithStore: any = withPageStore(store, {
        mapState: ['count'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)
      PageWithStore.onUnload.call(mockPage)

      mockSetData.mockClear()
      store.setState('count', 10)

      expect(mockSetData).not.toHaveBeenCalled()
    })

    it('INTEGRATION-016: 应该调用原始的onLoad', () => {
      const originalOnLoad = jest.fn()
      const store = createStore({
        state: { count: 0 },
      })

      const PageConfig = {
        ...mockPage,
        onLoad: originalOnLoad,
      }

      const PageWithStore: any = withPageStore(store, {
        mapState: ['count'],
      })(PageConfig)

      PageWithStore.onLoad.call(mockPage, 'arg1', 'arg2')

      expect(originalOnLoad).toHaveBeenCalledWith('arg1', 'arg2')
    })

    it('INTEGRATION-017: 应该调用原始的onUnload', () => {
      const originalOnUnload = jest.fn()
      const store = createStore({
        state: { count: 0 },
      })

      const PageConfig = {
        ...mockPage,
        onUnload: originalOnUnload,
      }

      const PageWithStore: any = withPageStore(store, {
        mapState: ['count'],
      })(PageConfig)

      PageWithStore.onLoad.call(mockPage)
      PageWithStore.onUnload.call(mockPage)

      expect(originalOnUnload).toHaveBeenCalled()
    })
  })

  describe('组合使用', () => {
    it('INTEGRATION-018: 应该同时支持mapState、mapGetters和mapActions', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
        },
        actions: {
          increment(...args: unknown[]) {
            (this.state as any).count++
          },
        },
      })

      const PageWithStore: any = withPageStore(store, {
        mapState: ['count'],
        mapGetters: ['double'],
        mapActions: ['increment'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      expect(mockPage.data.count).toBe(0)
      expect(mockPage.data.double).toBe(0)
      expect(typeof mockPage.increment).toBe('function')
    })

    it('INTEGRATION-019: 组合时应该正确更新所有映射', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
        },
        actions: {
          increment(...args: unknown[]) {
            (this.state as any).count++
          },
        },
      })

      const PageWithStore: any = withPageStore(store, {
        mapState: ['count'],
        mapGetters: ['double'],
        mapActions: ['increment'],
      })(mockPage)

      PageWithStore.onLoad.call(mockPage)

      mockPage.increment()

      expect(mockPage.data.count).toBe(1)
      expect(mockPage.data.double).toBe(2)
    })
  })
})

describe('withComponentStore - Component集成', () => {
  beforeEach(() => {
    mockSetData.mockClear()
    mockComponent.data = {}
    mockComponent.lifetimes.attached.mockClear()
    mockComponent.lifetimes.detached.mockClear()
  })

  describe('基本功能', () => {
    it('INTEGRATION-020: 应该将store的state映射到component的data', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
      })

      const ComponentWithStore = withComponentStore(store, {
        mapState: ['count', 'name'],
      })(mockComponent)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)

      expect(mockComponent.data.count).toBe(0)
      expect(mockComponent.data.name).toBe('test')
    })

    it('INTEGRATION-021: state变化时应该自动更新component的data', () => {
      const store = createStore({
        state: { count: 0 },
      })

      const ComponentWithStore = withComponentStore(store, {
        mapState: ['count'],
      })(mockComponent)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)

      store.setState('count', 5)

      expect(mockComponent.data.count).toBe(5)
    })
  })

  describe('mapGetters', () => {
    it('INTEGRATION-022: 应该将getters映射到component的data', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
        },
      })

      const ComponentWithStore = withComponentStore(store, {
        mapGetters: ['double'],
      })(mockComponent)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)

      expect(mockComponent.data.double).toBe(0)
    })

    it('INTEGRATION-023: getters依赖的state变化时应该更新', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
        },
      })

      const ComponentWithStore = withComponentStore(store, {
        mapGetters: ['double'],
      })(mockComponent)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)

      store.setState('count', 5)

      expect(mockComponent.data.double).toBe(10)
    })
  })

  describe('mapActions', () => {
    it('INTEGRATION-024: 应该将actions映射到component的methods', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment(...args: unknown[]) {
            (this.state as any).count++
          },
        },
      })

      const ComponentWithStore = withComponentStore(store, {
        mapActions: ['increment'],
      })(mockComponent)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)

      expect(typeof mockComponent.methods.increment).toBe('function')
    })

    it('INTEGRATION-025: 调用映射的action应该执行store的action', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment(...args: unknown[]) {
            (this.state as any).count++
          },
        },
      })

      const ComponentWithStore = withComponentStore(store, {
        mapActions: ['increment'],
      })(mockComponent)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)

      mockComponent.methods.increment()

      expect(store.getState().count).toBe(1)
    })

    it('INTEGRATION-026: action应该接收参数', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          add(amount: number) {
            this.state.count += amount
          },
        },
      })

      const ComponentWithStore = withComponentStore(store, {
        mapActions: ['add'],
      })(mockComponent)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)

      mockComponent.methods.add(10)

      expect(store.getState().count).toBe(10)
    })
  })

  describe('生命周期', () => {
    it('INTEGRATION-027: detached应该取消所有订阅', () => {
      const store = createStore({
        state: { count: 0 },
      })

      const ComponentWithStore = withComponentStore(store, {
        mapState: ['count'],
      })(mockComponent)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)
      ComponentWithStore.lifetimes?.detached?.call(mockComponent)

      mockSetData.mockClear()
      store.setState('count', 10)

      expect(mockSetData).not.toHaveBeenCalled()
    })

    it('INTEGRATION-028: 应该调用原始的attached', () => {
      const originalAttached = jest.fn()
      const store = createStore({
        state: { count: 0 },
      })

      const ComponentConfig = {
        ...mockComponent,
        lifetimes: {
          attached: originalAttached,
        },
      }

      const ComponentWithStore = withComponentStore(store, {
        mapState: ['count'],
      })(ComponentConfig)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)

      expect(originalAttached).toHaveBeenCalled()
    })

    it('INTEGRATION-029: 应该调用原始的detached', () => {
      const originalDetached = jest.fn()
      const store = createStore({
        state: { count: 0 },
      })

      const ComponentConfig = {
        ...mockComponent,
        lifetimes: {
          detached: originalDetached,
        },
      }

      const ComponentWithStore = withComponentStore(store, {
        mapState: ['count'],
      })(ComponentConfig)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)
      ComponentWithStore.lifetimes?.detached?.call(mockComponent)

      expect(originalDetached).toHaveBeenCalled()
    })
  })

  describe('组合使用', () => {
    it('INTEGRATION-030: 应该同时支持mapState、mapGetters和mapActions', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
        },
        actions: {
          increment(...args: unknown[]) {
            (this.state as any).count++
          },
        },
      })

      const ComponentWithStore = withComponentStore(store, {
        mapState: ['count'],
        mapGetters: ['double'],
        mapActions: ['increment'],
      })(mockComponent)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)

      expect(mockComponent.data.count).toBe(0)
      expect(mockComponent.data.double).toBe(0)
      expect(typeof mockComponent.methods.increment).toBe('function')
    })

    it('INTEGRATION-031: 组合时应该正确更新所有映射', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
        },
        actions: {
          increment(...args: unknown[]) {
            (this.state as any).count++
          },
        },
      })

      const ComponentWithStore = withComponentStore(store, {
        mapState: ['count'],
        mapGetters: ['double'],
        mapActions: ['increment'],
      })(mockComponent)

      ComponentWithStore.lifetimes?.attached?.call(mockComponent)

      mockComponent.methods.increment()

      expect(mockComponent.data.count).toBe(1)
      expect(mockComponent.data.double).toBe(2)
    })
  })
})

// ==================== 覆盖率补全测试 ====================

describe('withPageStore - 覆盖率补全', () => {
  beforeEach(() => {
    mockSetData.mockClear()
    mockPage.data = {}
    mockPage.onLoad.mockClear()
    mockPage.onUnload.mockClear()
    mockComponent.data = {}
    mockComponent.lifetimes.attached.mockClear()
    mockComponent.lifetimes.detached.mockClear()
  })

  it('COV-001: withPageStore不传options时应该正常工作', () => {
    const store = createStore({
      state: { count: 0 },
    })

    const PageWithStore: any = withPageStore(store)(mockPage)

    // 没有传 options，mapState/mapGetters/mapActions 都为空
    expect(PageWithStore).toBeDefined()
    expect(typeof PageWithStore.onLoad).toBe('function')
    expect(typeof PageWithStore.onUnload).toBe('function')

    // 调用 onLoad 不应该报错
    expect(() => PageWithStore.onLoad.call(mockPage)).not.toThrow()

    // 调用 onUnload 清理
    expect(() => PageWithStore.onUnload.call(mockPage)).not.toThrow()
  })

  it('COV-002: autoUpdateOnShow为true但autoInject为false时不应该扩展onShow', () => {
    const store = createStore({
      state: { count: 0 },
    })

    const originalOnShow = jest.fn()
    const pageConfig = {
      ...mockPage,
      onShow: originalOnShow,
    }

    const PageWithStore: any = withPageStore(store, {
      autoUpdateOnShow: true,
      autoInject: false,
    })(pageConfig)

    // autoUpdateOnShow && autoInject 都为 true 才会扩展 onShow
    // 这里 autoInject 为 false，所以 onShow 不应该被扩展
    // onShow 仍然是原始的
    expect(PageWithStore.onShow).toBe(originalOnShow)
  })

  it('COV-003: autoUpdateOnShow和autoInject都为true时应该扩展onShow', () => {
    const store = createStore({
      state: { count: 0, name: 'test' },
    })

    const originalOnShow = jest.fn()
    const pageConfig = {
      ...mockPage,
      onShow: originalOnShow,
    }

    const PageWithStore: any = withPageStore(store, {
      autoUpdateOnShow: true,
      autoInject: true,
      injectMapping: { count: 'pageCount' },
    })(pageConfig)

    // onShow 应该被扩展
    expect(PageWithStore.onShow).not.toBe(originalOnShow)

    // 调用 onLoad 初始化
    PageWithStore.onLoad.call(mockPage)

    // 调用 onShow 应该执行 autoInject 和原始 onShow
    PageWithStore.onShow.call(mockPage)

    expect(originalOnShow).toHaveBeenCalled()
  })

  it('COV-004: autoInject在onLoad中应该执行performAutoInject', () => {
    const store = createStore({
      state: { count: 0, name: 'test' },
    })

    const pageConfig = {
      ...mockPage,
    }

    const PageWithStore: any = withPageStore(store, {
      autoInject: true,
      injectMapping: { count: 'pageCount', name: 'pageName' },
    })(pageConfig)

    PageWithStore.onLoad.call(mockPage)

    // autoInject 应该将 store 的值注入到 page data
    expect(mockPage.data.pageCount).toBe(0)
    expect(mockPage.data.pageName).toBe('test')
  })

  it('COV-005: onShow没有原始函数时autoUpdateOnShow应该正常工作', () => {
    const store = createStore({
      state: { count: 0 },
    })

    const pageConfig = {
      ...mockPage,
      // 不提供 onShow
    }
    delete (pageConfig as any).onShow

    const PageWithStore: any = withPageStore(store, {
      autoUpdateOnShow: true,
      autoInject: true,
      injectMapping: { count: 'pageCount' },
    })(pageConfig)

    PageWithStore.onLoad.call(mockPage)

    // onShow 不存在原始函数，不应该报错
    expect(() => PageWithStore.onShow.call(mockPage)).not.toThrow()
  })
})

describe('withComponentStore - 覆盖率补全', () => {
  beforeEach(() => {
    mockSetData.mockClear()
    mockComponent.data = {}
    mockComponent.lifetimes.attached.mockClear()
    mockComponent.lifetimes.detached.mockClear()
  })

  it('COV-006: withComponentStore不传options时应该正常工作', () => {
    const store = createStore({
      state: { count: 0 },
    })

    const ComponentWithStore = withComponentStore(store)(mockComponent)

    expect(ComponentWithStore).toBeDefined()
    expect(typeof ComponentWithStore.lifetimes?.attached).toBe('function')
    expect(typeof ComponentWithStore.lifetimes?.detached).toBe('function')

    // 调用 attached 不应该报错
    expect(() => ComponentWithStore.lifetimes?.attached?.call(mockComponent)).not.toThrow()
    // 调用 detached 清理
    expect(() => ComponentWithStore.lifetimes?.detached?.call(mockComponent)).not.toThrow()
  })

  it('COV-007: component实例没有methods属性时应该正常工作', () => {
    const store = createStore({
      state: { count: 0 },
      actions: {
        increment(..._args: unknown[]) {
          (this.state as any).count++
        },
      },
    })

    const componentWithoutMethods: any = {
      data: {},
      setData(data: any) {
        mockSetData(data)
        Object.assign(this.data, data)
      },
      lifetimes: {
        attached: jest.fn(),
        detached: jest.fn(),
      },
      // 没有 methods 属性
    }

    const ComponentWithStore = withComponentStore(store, {
      mapActions: ['increment'],
    })(componentWithoutMethods)

    // 调用 attached 时 componentInstance.methods 不存在
    expect(() => ComponentWithStore.lifetimes?.attached?.call(componentWithoutMethods)).not.toThrow()

    // methods 应该在 enhancedConfig 中被创建
    expect(ComponentWithStore.methods).toBeDefined()
    expect(typeof ComponentWithStore.methods?.increment).toBe('function')
  })

  it('COV-008: component实例有methods属性时应该合并boundMethods', () => {
    const store = createStore({
      state: { count: 0 },
      actions: {
        increment(..._args: unknown[]) {
          (this.state as any).count++
        },
      },
    })

    const componentWithMethods: any = {
      data: {},
      setData(data: any) {
        mockSetData(data)
        Object.assign(this.data, data)
      },
      lifetimes: {
        attached: jest.fn(),
        detached: jest.fn(),
      },
      methods: {
        existingMethod: jest.fn(),
      },
    }

    const ComponentWithStore = withComponentStore(store, {
      mapActions: ['increment'],
    })(componentWithMethods)

    ComponentWithStore.lifetimes?.attached?.call(componentWithMethods)

    // 原有方法应该保留
    expect(componentWithMethods.methods.existingMethod).toBeDefined()
    // 新绑定的 action 应该被合并
    expect(typeof componentWithMethods.methods.increment).toBe('function')
  })

  it('COV-009: component的autoUpdateOnShow和autoInject应该扩展pageLifetimes.show', () => {
    const store = createStore({
      state: { count: 0, name: 'test' },
    })

    const originalShow = jest.fn()
    const componentConfig: any = {
      data: {},
      setData(data: any) {
        mockSetData(data)
        Object.assign(this.data, data)
      },
      lifetimes: {
        attached: jest.fn(),
        detached: jest.fn(),
      },
      pageLifetimes: {
        show: originalShow,
      },
    }

    const ComponentWithStore = withComponentStore(store, {
      autoUpdateOnShow: true,
      autoInject: true,
      injectMapping: { count: 'compCount' },
    })(componentConfig)

    // pageLifetimes.show（标准组件页面生命周期）应被扩展
    expect(ComponentWithStore.pageLifetimes?.show).not.toBe(originalShow)

    ComponentWithStore.lifetimes?.attached?.call(componentConfig)
    ComponentWithStore.pageLifetimes?.show?.call(componentConfig)

    // 原始 show 仍被调用
    expect(originalShow).toHaveBeenCalled()
    // 注入生效
    expect(componentConfig.data.compCount).toBe(0)
  })

  it('COV-010: component的autoInject在attached中应该执行performAutoInject', () => {
    const store = createStore({
      state: { count: 42 },
    })

    const componentConfig: any = {
      data: {},
      setData(data: any) {
        mockSetData(data)
        Object.assign(this.data, data)
      },
      lifetimes: {
        attached: jest.fn(),
        detached: jest.fn(),
      },
    }

    const ComponentWithStore = withComponentStore(store, {
      autoInject: true,
      injectMapping: { count: 'compCount' },
    })(componentConfig)

    ComponentWithStore.lifetimes?.attached?.call(componentConfig)

    expect(componentConfig.data.compCount).toBe(42)
  })

  it('COV-011: component pageLifetimes没有原始show时autoUpdateOnShow应该正常工作', () => {
    const store = createStore({
      state: { count: 0 },
    })

    const componentConfig: any = {
      data: {},
      setData(data: any) {
        mockSetData(data)
        Object.assign(this.data, data)
      },
      lifetimes: {
        attached: jest.fn(),
        detached: jest.fn(),
      },
      // 不提供 pageLifetimes
    }

    const ComponentWithStore = withComponentStore(store, {
      autoUpdateOnShow: true,
      autoInject: true,
      injectMapping: { count: 'compCount' },
    })(componentConfig)

    ComponentWithStore.lifetimes?.attached?.call(componentConfig)

    // 不存在原始 show，不应报错
    expect(() => ComponentWithStore.pageLifetimes?.show?.call(componentConfig)).not.toThrow()
  })

  it('COV-012: component的mapGetters应该正确映射到data', () => {
    const store = createStore({
      state: { count: 0 },
      getters: {
        double(state) {
          return state.count * 2
        },
      },
    })

    const componentConfig: any = {
      data: {},
      setData(data: any) {
        mockSetData(data)
        Object.assign(this.data, data)
      },
      lifetimes: {
        attached: jest.fn(),
        detached: jest.fn(),
      },
    }

    const ComponentWithStore = withComponentStore(store, {
      mapGetters: { compDouble: 'double' },
    })(componentConfig)

    ComponentWithStore.lifetimes?.attached?.call(componentConfig)

    expect(componentConfig.data.compDouble).toBe(0)

    store.setState('count', 5)
    expect(componentConfig.data.compDouble).toBe(10)
  })

  it('COV-013: withComponentStore扩展methods应该包含ComponentConfig原有methods', () => {
    const store = createStore({
      state: { count: 0 },
      actions: {
        increment(..._args: unknown[]) {
          (this.state as any).count++
        },
      },
    })

    const componentConfig = {
      data: {},
      setData(data: any) {
        mockSetData(data)
        Object.assign(this.data, data)
      },
      lifetimes: {
        attached: jest.fn(),
        detached: jest.fn(),
      },
      methods: {
        handleTap: jest.fn(),
      },
    }

    const ComponentWithStore = withComponentStore(store, {
      mapActions: ['increment'],
    })(componentConfig)

    // enhancedConfig.methods 应该包含原有 methods 和 boundMethods
    expect(ComponentWithStore.methods?.handleTap).toBeDefined()
    expect(ComponentWithStore.methods?.increment).toBeDefined()
    expect(typeof ComponentWithStore.methods?.increment).toBe('function')
  })

  it('COV-014: ComponentConfig 没有 lifetimes 属性时应该正常工作', () => {
    const store = createStore({
      state: { count: 0 },
    })

    // 创建没有 lifetimes 属性的 ComponentConfig
    const componentWithoutLifetimes: any = {
      data: {},
      setData(data: any) {
        mockSetData(data)
        Object.assign(this.data, data)
      },
      methods: {},
      // 没有 lifetimes 属性
    }

    const ComponentWithStore = withComponentStore(store, {
      mapState: ['count'],
    })(componentWithoutLifetimes)

    // lifetimes 应该被创建
    expect(ComponentWithStore.lifetimes).toBeDefined()
    expect(typeof ComponentWithStore.lifetimes?.attached).toBe('function')
    expect(typeof ComponentWithStore.lifetimes?.detached).toBe('function')

    // 调用 attached 和 detached 不应该报错
    expect(() => ComponentWithStore.lifetimes?.attached?.call(componentWithoutLifetimes)).not.toThrow()
    expect(() => ComponentWithStore.lifetimes?.detached?.call(componentWithoutLifetimes)).not.toThrow()
  })

  it('BUG-F5: multi-instance shared methods object must not be polluted by attached/detached', () => {
    // 修复前 attached 直接写入 this.methods（引用配置级共享对象），
    // 一个实例 detached 删除绑定方法会连带删掉其他实例仍在使用的方法
    const store = createStore({
      state: { count: 0 },
      actions: {
        increment(..._args: unknown[]) {
          (this.state as any).count++
        },
      },
    })

    const ComponentWithStore = withComponentStore(store, {
      mapActions: { doIncrement: 'increment' },
    })(mockComponent)

    // 模拟微信组件多实例：两个实例的 this.methods 引用同一配置级对象
    const sharedMethods = {
      ownMethod() {
        return 'own'
      },
    }
    const makeInstance = () => ({
      data: {},
      setData(data: any) {
        Object.assign(this.data, data)
      },
      methods: sharedMethods,
    })
    const instanceA: any = makeInstance()
    const instanceB: any = makeInstance()

    ComponentWithStore.lifetimes?.attached?.call(instanceA)
    ComponentWithStore.lifetimes?.attached?.call(instanceB)

    // 两个实例各自的 methods 拷贝上都有绑定方法，且共享配置对象未被污染
    expect(typeof instanceA.methods.doIncrement).toBe('function')
    expect(typeof instanceB.methods.doIncrement).toBe('function')
    expect(sharedMethods).not.toHaveProperty('doIncrement')

    // A 卸载：只删除自身拷贝中的绑定方法，不影响 B
    ComponentWithStore.lifetimes?.detached?.call(instanceA)
    expect(instanceA.methods.doIncrement).toBeUndefined()
    expect(instanceA.methods.ownMethod).toBeDefined()
    expect(typeof instanceB.methods.doIncrement).toBe('function')
    expect(sharedMethods).not.toHaveProperty('doIncrement')
  })
})
