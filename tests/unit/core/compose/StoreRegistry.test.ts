/**
 * StoreRegistry 测试
 */

import { StoreRegistry, globalRegistry } from '@/core/compose'

describe('StoreRegistry', () => {
  let registry: StoreRegistry
  let mockStore: any

  beforeEach(() => {
    registry = new StoreRegistry()
    mockStore = {
      getState: jest.fn(() => ({ value: 42 })),
      destroy: jest.fn(),
      $replaceState: jest.fn(),
    }
  })

  afterEach(() => {
    registry.clear()
  })

  describe('构造函数', () => {
    it('应该创建空的注册表', () => {
      expect(registry.size()).toBe(0)
      expect(registry.getDefault()).toBeUndefined()
    })
  })

  describe('register', () => {
    it('应该注册 store', () => {
      registry.register('test', mockStore)
      expect(registry.has('test')).toBe(true)
      expect(registry.get('test')).toBe(mockStore)
      expect(registry.size()).toBe(1)
    })

    it('应该覆盖已存在的 store', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      registry.register('test', mockStore)
      const anotherStore = { ...mockStore, getState: jest.fn() }
      registry.register('test', anotherStore)
      expect(registry.get('test')).toBe(anotherStore)
      expect(consoleWarnSpy).toHaveBeenCalled()
      consoleWarnSpy.mockRestore()
    })

    it('应该在无效名称时抛出错误', () => {
      expect(() => registry.register('', mockStore)).toThrow('[StoreRegistry] Store name must be a non-empty string')
      expect(() => registry.register('test', { invalid: true } as any)).toThrow('[StoreRegistry] Invalid store object')
    })

    it('应该拒绝无效的 store', () => {
      expect(() => registry.register('test', null as any)).toThrow('[StoreRegistry] Invalid store object')
      expect(() => registry.register('test', {} as any)).toThrow('[StoreRegistry] Invalid store object')
      expect(() => registry.register('test', { getState: 'not a function' } as any)).toThrow('[StoreRegistry] Invalid store object')
    })

    it('覆盖已存在 store 时如果旧 store 没有 destroy 方法应该只打印 overwriting 警告', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      // 先注册一个没有 destroy 方法的 store
      const storeWithoutDestroy = { getState: jest.fn() } as any
      registry.register('test', storeWithoutDestroy)
      // 再注册一个新 store 覆盖
      const newStore = { ...mockStore }
      registry.register('test', newStore)
      // 应该打印 "already registered, overwriting" 而不是 "destroying old store"
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered, overwriting'))
      consoleWarnSpy.mockRestore()
    })

    it('覆盖已存在 store 时如果旧 store 的 destroyed 为 true 应该只打印 overwriting 警告', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      // 先注册一个 destroyed=true 的 store
      const destroyedStore = { getState: jest.fn(), destroy: jest.fn(), destroyed: true } as any
      registry.register('test', destroyedStore)
      // 再注册一个新 store 覆盖
      const newStore = { ...mockStore }
      registry.register('test', newStore)
      // 应该打印 "already registered, overwriting" 而不是调用 destroy
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('already registered, overwriting'))
      expect(destroyedStore.destroy).not.toHaveBeenCalled()
      consoleWarnSpy.mockRestore()
    })
  })

  describe('registerAll', () => {
    it('应该批量注册 stores', () => {
      const store1 = { ...mockStore, getState: jest.fn(() => ({ value: 1 })) }
      const store2 = { ...mockStore, getState: jest.fn(() => ({ value: 2 })) }
      registry.registerAll({ store1, store2 })
      expect(registry.size()).toBe(2)
      expect(registry.get('store1')).toBe(store1)
      expect(registry.get('store2')).toBe(store2)
    })

    it('应该处理空的 stores 对象', () => {
      registry.registerAll({})
      expect(registry.size()).toBe(0)
    })
  })

  describe('unregister', () => {
    it('应该注销 store', () => {
      registry.register('test', mockStore)
      registry.unregister('test')
      expect(registry.has('test')).toBe(false)
      expect(registry.size()).toBe(0)
    })

    it('应该在注销时调用 destroy', () => {
      registry.register('test', mockStore)
      registry.unregister('test')
      expect(mockStore.destroy).toHaveBeenCalled()
    })

    it('应该在 store 不存在时发出警告', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      registry.unregister('nonexistent')
      expect(consoleWarnSpy).toHaveBeenCalledWith('[StoreRegistry] Store "nonexistent" not found')
      consoleWarnSpy.mockRestore()
    })

    it('应该在 destroy 失败时继续', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const errorStore = {
        ...mockStore,
        destroy: jest.fn(() => {
          throw new Error('Destroy failed')
        }),
      }
      registry.register('test', errorStore)
      registry.unregister('test')
      expect(registry.has('test')).toBe(false)
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('get', () => {
    it('应该获取注册的 store', () => {
      registry.register('test', mockStore)
      expect(registry.get('test')).toBe(mockStore)
    })

    it('应该在 store 不存在时返回 undefined', () => {
      expect(registry.get('nonexistent')).toBeUndefined()
    })
  })

  describe('getOrThrow', () => {
    it('应该获取注册的 store', () => {
      registry.register('test', mockStore)
      expect(registry.getOrThrow('test')).toBe(mockStore)
    })

    it('应该在 store 不存在时抛出错误', () => {
      expect(() => registry.getOrThrow('nonexistent')).toThrow('[StoreRegistry] Store "nonexistent" not found')
    })
  })

  describe('has', () => {
    it('应该检查 store 是否存在', () => {
      expect(registry.has('test')).toBe(false)
      registry.register('test', mockStore)
      expect(registry.has('test')).toBe(true)
    })
  })

  describe('getAll', () => {
    it('应该获取所有 stores', () => {
      const store1 = { ...mockStore, getState: jest.fn(() => ({ value: 1 })) }
      const store2 = { ...mockStore, getState: jest.fn(() => ({ value: 2 })) }
      registry.registerAll({ store1, store2 })
      const all = registry.getAll()
      expect(all).toEqual({ store1, store2 })
    })

    it('应该返回空对象当没有 stores 时', () => {
      expect(registry.getAll()).toEqual({})
    })
  })

  describe('size', () => {
    it('应该返回 stores 数量', () => {
      expect(registry.size()).toBe(0)
      registry.register('test', mockStore)
      expect(registry.size()).toBe(1)
      registry.register('test2', { ...mockStore })
      expect(registry.size()).toBe(2)
    })
  })

  describe('clear', () => {
    it('应该清空注册表', () => {
      const store1 = { ...mockStore, destroy: jest.fn() }
      const store2 = { ...mockStore, destroy: jest.fn() }
      registry.registerAll({ store1, store2 })
      registry.clear()
      expect(registry.size()).toBe(0)
      expect(registry.has('store1')).toBe(false)
      expect(registry.has('store2')).toBe(false)
    })

    it('应该在清空时调用所有 stores 的 destroy', () => {
      const store1 = { ...mockStore, destroy: jest.fn() }
      const store2 = { ...mockStore, destroy: jest.fn() }
      registry.registerAll({ store1, store2 })
      registry.clear()
      expect(store1.destroy).toHaveBeenCalled()
      expect(store2.destroy).toHaveBeenCalled()
    })

    it('应该清除默认 store', () => {
      registry.register('test', mockStore)
      registry.setDefault('test')
      registry.clear()
      expect(registry.getDefault()).toBeUndefined()
    })

    it('应该在 destroy 失败时继续', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const errorStore = {
        ...mockStore,
        destroy: jest.fn(() => {
          throw new Error('Destroy failed')
        }),
      }
      registry.register('test', errorStore)
      registry.clear()
      expect(registry.size()).toBe(0)
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('setDefault 和 getDefault', () => {
    it('应该设置默认 store', () => {
      registry.register('test', mockStore)
      registry.setDefault('test')
      expect(registry.getDefault()).toBe(mockStore)
    })

    it('应该在 store 不存在时抛出错误', () => {
      expect(() => registry.setDefault('nonexistent')).toThrow('[StoreRegistry] Store "nonexistent" not found')
    })

    it('应该在注销默认 store 时清除引用', () => {
      registry.register('test', mockStore)
      registry.setDefault('test')
      registry.unregister('test')
      expect(registry.getDefault()).toBeUndefined()
    })

    it('注销非默认 store 时应该保留默认 store 引用', () => {
      const otherStore = { ...mockStore }
      registry.register('default', mockStore)
      registry.register('other', otherStore)
      registry.setDefault('default')

      registry.unregister('other')

      expect(registry.has('other')).toBe(false)
      expect(registry.getDefault()).toBe(mockStore)
    })

    it('应该获取默认 store', () => {
      expect(registry.getDefault()).toBeUndefined()
      registry.register('test', mockStore)
      registry.setDefault('test')
      expect(registry.getDefault()).toBe(mockStore)
    })
  })

  describe('getNames', () => {
    it('应该获取所有 store 名称', () => {
      const store1 = { ...mockStore }
      const store2 = { ...mockStore }
      registry.registerAll({ store1, store2 })
      const names = registry.getNames()
      expect(names).toContain('store1')
      expect(names).toContain('store2')
      expect(names.length).toBe(2)
    })

    it('应该返回空数组当没有 stores 时', () => {
      expect(registry.getNames()).toEqual([])
    })
  })

  describe('forEach', () => {
    it('应该遍历所有 stores', () => {
      const store1 = { ...mockStore }
      const store2 = { ...mockStore }
      registry.registerAll({ store1, store2 })
      const callback = jest.fn()
      registry.forEach(callback)
      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenCalledWith('store1', store1)
      expect(callback).toHaveBeenCalledWith('store2', store2)
    })

    it('应该不执行回调当没有 stores 时', () => {
      const callback = jest.fn()
      registry.forEach(callback)
      expect(callback).not.toHaveBeenCalled()
    })
  })

  describe('createSnapshot', () => {
    it('应该创建所有 stores 的快照', () => {
      const store1 = { ...mockStore, getState: jest.fn(() => ({ value: 1 })) }
      const store2 = { ...mockStore, getState: jest.fn(() => ({ value: 2 })) }
      registry.registerAll({ store1, store2 })
      const snapshot = registry.createSnapshot()
      expect(snapshot).toEqual({
        store1: { value: 1 },
        store2: { value: 2 },
      })
    })

    it('应该处理 getState 失败', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const errorStore = {
        ...mockStore,
        getState: jest.fn(() => {
          throw new Error('GetState failed')
        }),
      }
      registry.register('errorStore', errorStore)
      const snapshot = registry.createSnapshot()
      expect(snapshot.errorStore).toBeUndefined()
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })

    it('应该返回空对象当没有 stores 时', () => {
      expect(registry.createSnapshot()).toEqual({})
    })
  })

  describe('restoreSnapshot', () => {
    it('应该从快照恢复所有 stores', () => {
      registry.register('test', mockStore)
      const snapshot = { test: { value: 100 }, other: { value: 200 } }
      registry.restoreSnapshot(snapshot)
      expect(mockStore.$replaceState).toHaveBeenCalledWith({ value: 100 })
    })

    it('应该在 store 不存在时发出警告', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const snapshot = { nonexistent: { value: 42 } }
      registry.restoreSnapshot(snapshot)
      expect(consoleWarnSpy).toHaveBeenCalled()
      consoleWarnSpy.mockRestore()
    })

    it('应该处理 $replaceState 失败', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const errorStore = {
        ...mockStore,
        $replaceState: jest.fn(() => {
          throw new Error('Replace failed')
        }),
      }
      registry.register('test', errorStore)
      const snapshot = { test: { value: 42 } }
      registry.restoreSnapshot(snapshot)
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('回归 - 幂等重注册与 defaultStore', () => {
    it('REGR-REG-001: 同一实例重复注册不应销毁自身', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const store = { ...mockStore, destroy: jest.fn(), destroyed: false }
      registry.register('a', store)
      registry.register('a', store)

      // 注册表应仍持有未销毁的同一实例
      expect(registry.get('a')).toBe(store)
      expect(store.destroy).not.toHaveBeenCalled()
      consoleWarnSpy.mockRestore()
    })

    it('REGR-REG-002: 覆盖注册后 defaultStore 不应悬空', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const storeA = { ...mockStore, destroy: jest.fn(), destroyed: false }
      const storeB = { ...mockStore, destroy: jest.fn(), destroyed: false }
      registry.register('user', storeA)
      registry.setDefault('user')

      registry.register('user', storeB)

      expect(storeA.destroy).toHaveBeenCalled()
      expect(registry.getDefault()).toBe(storeB)
      consoleWarnSpy.mockRestore()
    })

    it('REGR-REG-003: 同名不同实例覆盖注册应销毁旧实例', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const storeA = { ...mockStore, destroy: jest.fn(), destroyed: false }
      const storeB = { ...mockStore, destroy: jest.fn(), destroyed: false }
      registry.register('x', storeA)
      registry.register('x', storeB)

      expect(storeA.destroy).toHaveBeenCalled()
      expect(registry.get('x')).toBe(storeB)
      consoleWarnSpy.mockRestore()
    })
  })
})

describe('globalRegistry', () => {
  let mockStore: any

  beforeEach(() => {
    mockStore = {
      getState: jest.fn(() => ({ value: 42 })),
      destroy: jest.fn(),
      $replaceState: jest.fn(),
    }
    globalRegistry.clear()
  })

  it('应该是全局可用的', () => {
    expect(globalRegistry).toBeInstanceOf(StoreRegistry)
  })

  it('应该注册和获取 stores', () => {
    globalRegistry.register('test', mockStore)
    expect(globalRegistry.get('test')).toBe(mockStore)
  })
})
