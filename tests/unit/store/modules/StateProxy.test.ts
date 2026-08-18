/**
 * StateProxy 模块测试
 * 目标覆盖率: 95%+
 */

import { StateProxyManager, createProxyCache } from '@/core/store/StateProxy'
import type { InternalStateProtectionConfig } from '@/core/store/types'

describe('StateProxyManager', () => {
  // 默认配置
  const defaultProtection: InternalStateProtectionConfig = {
    enabled: true,
    deep: true,
    productionHandler: 'warn',
  }

  // 创建管理器实例
  const createManager = (protection: Partial<InternalStateProtectionConfig> = {}) => {
    const proxyCache = createProxyCache()
    let isInternal = false
    return {
      manager: new StateProxyManager({
        protection: { ...defaultProtection, ...protection },
        proxyCache,
        isInternalAccess: () => isInternal,
      }),
      setInternal: (v: boolean) => {
        isInternal = v
      },
      proxyCache,
    }
  }

  describe('createStateProxy', () => {
    it('应该返回非对象值本身', () => {
      const { manager } = createManager()
      expect(manager.createStateProxy('string' as any, '')).toBe('string')
      expect(manager.createStateProxy(123 as any, '')).toBe(123)
      expect(manager.createStateProxy(null as any, '')).toBe(null)
      expect(manager.createStateProxy(undefined as any, '')).toBe(undefined)
    })

    it('应该使用缓存返回相同的 Proxy', () => {
      const { manager } = createManager()
      const state = { count: 0 }
      const proxy1 = manager.createStateProxy(state, '')
      const proxy2 = manager.createStateProxy(state, '')
      expect(proxy1).toBe(proxy2)
    })

    it('应该创建浅层 Proxy 当 deep=false', () => {
      const { manager } = createManager({ deep: false })
      const state = { nested: { value: 1 } }
      const proxy = manager.createStateProxy(state, '') as any

      // 浅层代理下，嵌套对象不应该是 Proxy
      const nested = proxy.nested
      expect(typeof nested).toBe('object')
    })

    it('浅层代理应该阻止外部修改', () => {
      const { manager } = createManager({ deep: false })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        proxy.count = 1
      }).toThrow('Direct mutation of state')
    })

    it('浅层代理应该阻止外部删除', () => {
      const { manager } = createManager({ deep: false })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        delete proxy.count
      }).toThrow('Direct mutation of state')
    })

    it('浅层代理应该允许内部访问修改', () => {
      const { manager, setInternal } = createManager({ deep: false })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      proxy.count = 1
      expect(proxy.count).toBe(1)

      delete proxy.count
      expect(proxy.count).toBeUndefined()
    })
  })

  describe('内建对象不代理', () => {
    it('根状态为内建对象时应该返回原始引用', () => {
      const { manager } = createManager()
      const date = new Date('2024-01-01')

      const proxy = manager.createStateProxy(date as any, '')

      // Date 经 Proxy 包装会破坏内部槽位，应直接返回原始引用
      expect(proxy).toBe(date)
    })

    it('属性值为内建对象时应该返回原始引用', () => {
      const { manager } = createManager()
      const date = new Date('2024-01-01')
      const state = { date, count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      expect(proxy.date).toBe(date)
    })

    it('数组元素为内建对象时应该返回原始引用', () => {
      const { manager } = createManager()
      const date = new Date('2024-01-01')
      const state = { list: [date] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(proxy.list[0]).toBe(date)
    })
  })

  describe('深层 Proxy 保护', () => {
    it('应该允许读取属性', () => {
      const { manager } = createManager()
      const state = { count: 0, name: 'test', nested: { value: 1 } }
      const proxy = manager.createStateProxy(state, '') as any

      expect(proxy.count).toBe(0)
      expect(proxy.name).toBe('test')
      expect(proxy.nested.value).toBe(1)
    })

    it('应该阻止外部修改属性', () => {
      const { manager } = createManager()
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        proxy.count = 1
      }).toThrow('Direct mutation of state')
    })

    it('应该允许内部访问修改属性', () => {
      const { manager, setInternal } = createManager()
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      expect(() => {
        proxy.count = 1
      }).not.toThrow()
      expect(proxy.count).toBe(1)
    })

    it('应该阻止外部删除属性', () => {
      const { manager } = createManager()
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        delete proxy.count
      }).toThrow('Direct mutation of state')
    })

    it('应该阻止外部 defineProperty', () => {
      const { manager } = createManager()
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        Object.defineProperty(proxy, 'newProp', { value: 1 })
      }).toThrow('Direct mutation of state')
    })

    it('应该正确处理嵌套对象的 Proxy 缓存', () => {
      const { manager } = createManager()
      const state = { nested: { value: 1 } }
      const proxy = manager.createStateProxy(state, '') as any

      // 多次访问同一嵌套对象应该返回相同的 Proxy
      const nested1 = proxy.nested
      const nested2 = proxy.nested
      expect(nested1).toBe(nested2)
    })
  })

  describe('数组 Proxy 保护', () => {
    it('应该正确读取数组元素', () => {
      const { manager } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(proxy.items[0]).toBe(1)
      expect(proxy.items[1]).toBe(2)
      expect(proxy.items.length).toBe(3)
    })

    it('应该阻止外部调用数组变异方法', () => {
      const { manager } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        proxy.items.push(4)
      }).toThrow('Direct mutation of state')

      expect(() => {
        proxy.items.pop()
      }).toThrow('Direct mutation of state')
    })

    it('应该允许内部访问调用数组变异方法', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      proxy.items.push(4)
      expect(proxy.items.length).toBe(4)
      expect(proxy.items[3]).toBe(4)
    })

    it('应该正确处理数组中的对象元素', () => {
      const { manager } = createManager()
      const state = { items: [{ id: 1 }, { id: 2 }] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(proxy.items[0].id).toBe(1)
      expect(proxy.items[1].id).toBe(2)
    })

    it('应该阻止外部修改数组元素', () => {
      const { manager } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        proxy.items[0] = 10
      }).toThrow('Direct mutation of state')
    })

    it('应该阻止外部删除数组元素', () => {
      const { manager } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        delete proxy.items[0]
      }).toThrow('Direct mutation of state')
    })

    it('应该正确返回 Symbol 属性', () => {
      const { manager } = createManager()
      const sym = Symbol('test')
      const state = { items: [1, 2, 3] }
      ;(state.items as any)[sym] = 'symbol-value'
      const proxy = manager.createStateProxy(state, '') as any

      expect(proxy.items[sym]).toBe('symbol-value')
    })

    it('应该正确处理数组非变异方法', () => {
      const { manager } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      // map, filter, find 等不应被拦截
      const mapped = proxy.items.map((x: number) => x * 2)
      expect(mapped).toEqual([2, 4, 6])

      const found = proxy.items.find((x: number) => x === 2)
      expect(found).toBe(2)
    })
  })

  describe('生产环境处理', () => {
    const originalEnv = process.env.NODE_ENV

    beforeEach(() => {
      // 重新加载模块以清除 isProduction 缓存
      jest.resetModules()
      process.env.NODE_ENV = 'production'
    })

    afterEach(() => {
      process.env.NODE_ENV = originalEnv
    })

    // 生产模式下创建 manager 的辅助函数
    const createProductionManager = (protection: Partial<InternalStateProtectionConfig> = {}) => {
      const { StateProxyManager, createProxyCache } = require('@/core/store/StateProxy')
      const proxyCache = createProxyCache()
      let isInternal = false
      return {
        manager: new StateProxyManager({
          protection: { enabled: true, deep: true, ...protection },
          proxyCache,
          isInternalAccess: () => isInternal,
        }),
        setInternal: (v: boolean) => {
          isInternal = v
        },
        proxyCache,
      }
    }

    it('productionHandler=warn 应该打印警告并允许操作', () => {
      const { manager } = createProductionManager({ productionHandler: 'warn' })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      proxy.count = 1 // 应该不抛出错误，只打印警告

      expect(warnSpy).toHaveBeenCalled()
      expect(state.count).toBe(1)
      warnSpy.mockRestore()
    })

    it('productionHandler=silent 应该静默允许操作', () => {
      const { manager } = createProductionManager({ productionHandler: 'silent' })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      proxy.count = 1 // 应该不抛出错误，不打印警告

      expect(warnSpy).not.toHaveBeenCalled()
      expect(state.count).toBe(1)
      warnSpy.mockRestore()
    })

    it('productionHandler=error 应该抛出错误', () => {
      const { manager } = createProductionManager({ productionHandler: 'error' })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        proxy.count = 1
      }).toThrow('Direct mutation of state')
    })

    it('productionHandler=warn 应该允许删除属性', () => {
      const { manager } = createProductionManager({ productionHandler: 'warn' })
      const state = { count: 0, name: 'test' }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      delete proxy.name

      expect(warnSpy).toHaveBeenCalled()
      expect(state.name).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('productionHandler=silent 应该允许删除属性', () => {
      const { manager } = createProductionManager({ productionHandler: 'silent' })
      const state = { count: 0, name: 'test' }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      delete proxy.name

      expect(warnSpy).not.toHaveBeenCalled()
      expect(state.name).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('productionHandler=warn 应该允许 defineProperty', () => {
      const { manager } = createProductionManager({ productionHandler: 'warn' })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      Object.defineProperty(proxy, 'newProp', { value: 123, configurable: true })

      expect(warnSpy).toHaveBeenCalled()
      expect((state as any).newProp).toBe(123)
      warnSpy.mockRestore()
    })

    it('productionHandler=silent 应该允许数组变异方法', () => {
      const { manager } = createProductionManager({ productionHandler: 'silent' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      proxy.items.push(4)

      expect(warnSpy).not.toHaveBeenCalled()
      expect(state.items).toEqual([1, 2, 3, 4])
      warnSpy.mockRestore()
    })

    it('productionHandler=warn 应该允许数组变异方法', () => {
      const { manager } = createProductionManager({ productionHandler: 'warn' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      proxy.items.pop()

      expect(warnSpy).toHaveBeenCalled()
      expect(state.items).toEqual([1, 2])
      warnSpy.mockRestore()
    })

    it('productionHandler=silent 应该允许修改数组元素', () => {
      const { manager } = createProductionManager({ productionHandler: 'silent' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      proxy.items[0] = 10

      expect(warnSpy).not.toHaveBeenCalled()
      expect(state.items[0]).toBe(10)
      warnSpy.mockRestore()
    })

    it('productionHandler=silent 应该允许删除数组元素', () => {
      const { manager } = createProductionManager({ productionHandler: 'silent' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      delete proxy.items[0]

      expect(warnSpy).not.toHaveBeenCalled()
      expect(state.items[0]).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('浅层代理: productionHandler=warn 应该允许修改', () => {
      const { manager } = createProductionManager({ deep: false, productionHandler: 'warn' })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      proxy.count = 1

      expect(warnSpy).toHaveBeenCalled()
      expect(state.count).toBe(1)
      warnSpy.mockRestore()
    })

    it('浅层代理: productionHandler=silent 应该允许删除', () => {
      const { manager } = createProductionManager({ deep: false, productionHandler: 'silent' })
      const state = { count: 0, name: 'test' }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      delete proxy.name

      expect(warnSpy).not.toHaveBeenCalled()
      expect(state.name).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('数组代理: productionHandler=warn 应该允许数组方法返回结果', () => {
      const { manager } = createProductionManager({ productionHandler: 'warn' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const result = proxy.items.push(4)

      expect(warnSpy).toHaveBeenCalled()
      expect(result).toBe(4) // push 返回新长度
      warnSpy.mockRestore()
    })
  })

  describe('invalidateCache', () => {
    it('应该删除指定对象的 Proxy 缓存', () => {
      const { manager, proxyCache } = createManager()
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '')

      // 缓存应该存在
      expect(proxyCache.get(state)).toBeDefined()

      // 使缓存失效
      manager.invalidateCache(state)

      // 缓存应该被删除
      expect(proxyCache.get(state)).toBeUndefined()
    })
  })
})

describe('createProxyCache', () => {
  it('应该创建有效的 Proxy 缓存', () => {
    const cache = createProxyCache()
    const obj = { key: 'value' }
    const proxy = { key: 'proxied' }

    // 测试 set 和 get
    cache.set(obj, proxy)
    expect(cache.get(obj)).toBe(proxy)

    // 测试 delete
    cache.delete(obj)
    expect(cache.get(obj)).toBeUndefined()
  })

  it('ProxyCache 接口不包含 clear 方法（WeakMap 无法枚举，需重新创建实例）', () => {
    const cache = createProxyCache()
    expect(cache.get).toBeInstanceOf(Function)
    expect(cache.set).toBeInstanceOf(Function)
    expect(cache.delete).toBeInstanceOf(Function)
    expect('clear' in cache).toBe(false)
  })
})

// ==================== 补充覆盖率测试 ====================

describe('StateProxyManager 补充覆盖', () => {
  // 默认配置
  const defaultProtection: InternalStateProtectionConfig = {
    enabled: true,
    deep: true,
    productionHandler: 'warn',
  }

  const createManager = (protection: Partial<InternalStateProtectionConfig> = {}) => {
    const proxyCache = createProxyCache()
    let isInternal = false
    return {
      manager: new StateProxyManager({
        protection: { ...defaultProtection, ...protection },
        proxyCache,
        isInternalAccess: () => isInternal,
      }),
      setInternal: (v: boolean) => {
        isInternal = v
      },
      proxyCache,
    }
  }

  describe('invalidateCache 无参数调用', () => {
    it('应该支持无参数调用 invalidateCache', () => {
      const { manager } = createManager()
      expect(() => manager.invalidateCache()).not.toThrow()
    })
  })

  describe('非法修改的拒绝与放行语义（_handleIllegalMutation 返回 void）', () => {
    // 新语义（v1.0 起）：_handleIllegalMutation 拒绝路径总是抛错（开发模式与生产 'error'），
    // 生产 warn/silent 处理后返回 void、由调用方放行操作。
    // 此前返回 boolean 且调用方依据 false 拦截的分支为不可达死代码，已移除。
    // 测试环境 NODE_ENV=test，isProduction() === false，全部拒绝路径应抛错。

    it('深层代理: 外部 set 应该抛错且不修改状态', () => {
      const { manager } = createManager()
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => Reflect.set(proxy, 'count', 1)).toThrow(/prohibited/)
      expect(state.count).toBe(0) // 没有被修改
    })

    it('深层代理: 外部 deleteProperty 应该抛错且不删除', () => {
      const { manager } = createManager()
      const state = { count: 0, name: 'test' }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => Reflect.deleteProperty(proxy, 'name')).toThrow(/prohibited/)
      expect(state.name).toBe('test') // 没有被删除
    })

    it('深层代理: 外部 defineProperty 应该抛错且不定义', () => {
      const { manager } = createManager()
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => Reflect.defineProperty(proxy, 'newProp', { value: 123, configurable: true })).toThrow(/prohibited/)
      expect((state as any).newProp).toBeUndefined() // 没有被定义
    })

    it('浅层代理: 外部 set 应该抛错且不修改状态', () => {
      const { manager } = createManager({ deep: false })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => Reflect.set(proxy, 'count', 1)).toThrow(/prohibited/)
      expect(state.count).toBe(0)
    })

    it('浅层代理: 外部 deleteProperty 应该抛错且不删除', () => {
      const { manager } = createManager({ deep: false })
      const state = { count: 0, name: 'test' }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => Reflect.deleteProperty(proxy, 'name')).toThrow(/prohibited/)
      expect(state.name).toBe('test')
    })

    it('数组代理: 外部变异方法应该抛错且数组不变', () => {
      const { manager } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => proxy.items.push(4)).toThrow(/prohibited/)
      expect(state.items).toEqual([1, 2, 3]) // 数组没变
    })

    it('数组代理: 外部 set 应该抛错且不修改', () => {
      const { manager } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => Reflect.set(proxy.items, 0, 10)).toThrow(/prohibited/)
      expect(state.items[0]).toBe(1) // 没有被修改
    })

    it('数组代理: 外部 deleteProperty 应该抛错且不删除', () => {
      const { manager } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => Reflect.deleteProperty(proxy.items, 0)).toThrow(/prohibited/)
      expect(state.items[0]).toBe(1) // 没有被删除
    })

    it('_handleIllegalMutation 放行（不抛错）时操作应该被放行且写入生效', () => {
      // 模拟生产 warn/silent 处理器：_handleIllegalMutation 处理后返回 void（不抛错），
      // 调用方放行写入——返回值不再参与拦截判断
      const { manager } = createManager()
      ;(manager as any)._handleIllegalMutation = jest.fn()
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      const result = Reflect.set(proxy, 'count', 1)
      expect(result).toBe(true)
      expect(state.count).toBe(1) // 放行后写入生效
      expect((manager as any)._handleIllegalMutation).toHaveBeenCalled()
    })

    it('内部访问时不应调用 _handleIllegalMutation', () => {
      const { manager, setInternal } = createManager()
      const spy = jest.spyOn(manager as any, '_handleIllegalMutation')
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      proxy.count = 5
      expect(spy).not.toHaveBeenCalled()
      expect(state.count).toBe(5)
    })
  })

  describe('深层 Proxy 内部访问路径补充', () => {
    it('内部访问设置嵌套属性时应该正确删除缓存', () => {
      const { manager, setInternal, proxyCache } = createManager()
      const state = { nested: { value: 1 } }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      proxy.nested.value = 2
      expect(proxy.nested.value).toBe(2)
      expect(state.nested.value).toBe(2)
    })

    it('内部访问删除嵌套属性时应该正确删除缓存', () => {
      const { manager, setInternal } = createManager()
      const state = { nested: { value: 1, extra: 2 } }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      delete proxy.nested.extra
      expect(proxy.nested.extra).toBeUndefined()
    })

    it('内部访问 defineProperty 应该正常工作', () => {
      const { manager, setInternal } = createManager()
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      Object.defineProperty(proxy, 'newProp', { value: 123, configurable: true })
      expect(proxy.newProp).toBe(123)
    })

    it('内部访问设置顶层属性时应该清除缓存', () => {
      const { manager, setInternal, proxyCache } = createManager()
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      proxy.count = 5
      expect(proxy.count).toBe(5)
    })

    it('内部访问删除顶层属性时应该清除缓存', () => {
      const { manager, setInternal } = createManager()
      const state = { count: 0, name: 'test' }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      delete proxy.name
      expect(proxy.name).toBeUndefined()
    })
  })

  describe('数组 Proxy 补充覆盖', () => {
    it('内部访问修改数组元素时应该正确删除缓存', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      proxy.items[0] = 10
      expect(proxy.items[0]).toBe(10)
    })

    it('内部访问删除数组元素时应该正确工作', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      delete proxy.items[0]
      expect(proxy.items[0]).toBeUndefined()
    })

    it('数组中的对象元素应该使用缓存', () => {
      const { manager } = createManager()
      const state = { items: [{ id: 1 }] }
      const proxy = manager.createStateProxy(state, '') as any

      // 第一次访问创建缓存
      const item1 = proxy.items[0]
      // 第二次访问应该使用缓存
      const item2 = proxy.items[0]
      expect(item1).toBe(item2)
    })

    it('内部访问调用数组变异方法时应该返回结果', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      const result = proxy.items.push(4)
      expect(result).toBe(4)
      expect(proxy.items.length).toBe(4)
    })

    it('内部访问调用 shift 方法应该返回结果', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      const result = proxy.items.shift()
      expect(result).toBe(1)
      expect(proxy.items.length).toBe(2)
    })

    it('内部访问调用 unshift 方法应该返回结果', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      const result = proxy.items.unshift(0)
      expect(result).toBe(4)
      expect(proxy.items[0]).toBe(0)
    })

    it('内部访问调用 splice 方法应该返回结果', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      const result = proxy.items.splice(1, 1)
      expect(result).toEqual([2])
      expect(proxy.items).toEqual([1, 3])
    })

    it('内部访问调用 sort 方法应该返回结果', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [3, 1, 2] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      const result = proxy.items.sort()
      expect(result).toEqual([1, 2, 3])
    })

    it('内部访问调用 reverse 方法应该返回结果', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      const result = proxy.items.reverse()
      expect(result).toEqual([3, 2, 1])
    })

    it('内部访问调用 fill 方法应该返回结果', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      const result = proxy.items.fill(0)
      expect(result).toEqual([0, 0, 0])
    })

    it('内部访问调用 copyWithin 方法应该返回结果', () => {
      const { manager, setInternal } = createManager()
      const state = { items: [1, 2, 3, 4, 5] }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      const result = proxy.items.copyWithin(0, 3)
      expect(result).toEqual([4, 5, 3, 4, 5])
    })
  })

  describe('浅层 Proxy 补充覆盖', () => {
    it('内部访问设置属性时应该正确工作', () => {
      const { manager, setInternal } = createManager({ deep: false })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      proxy.count = 42
      expect(proxy.count).toBe(42)
    })

    it('内部访问删除属性时应该正确工作', () => {
      const { manager, setInternal } = createManager({ deep: false })
      const state = { count: 0, name: 'test' }
      const proxy = manager.createStateProxy(state, '') as any

      setInternal(true)
      delete proxy.name
      expect(proxy.name).toBeUndefined()
    })

    it('浅层代理应该读取嵌套对象的原始值', () => {
      const { manager } = createManager({ deep: false })
      const state = { nested: { value: 1 } }
      const proxy = manager.createStateProxy(state, '') as any

      expect(proxy.nested.value).toBe(1)
    })
  })

  describe('路径参数非空时的分支覆盖', () => {
    it('深层代理: 非空 path 下 defineProperty 应正确构建 fullPath', () => {
      const { manager, setInternal } = createManager()
      const state = { count: 0 }
      // 传入非空 path，使 defineProperty 中的 path ? ... : ... 走 true 分支
      const proxy = manager.createStateProxy(state, 'root') as any

      setInternal(true)
      Object.defineProperty(proxy, 'newProp', { value: 123, configurable: true })
      expect(proxy.newProp).toBe(123)
    })

    it('浅层代理: 非空 path 下 set 应正确构建 fullPath', () => {
      const { manager, setInternal } = createManager({ deep: false })
      const state = { count: 0 }
      // 传入非空 path，使浅层 set 中的 path ? ... : ... 走 true 分支
      const proxy = manager.createStateProxy(state, 'root') as any

      setInternal(true)
      proxy.count = 42
      expect(proxy.count).toBe(42)
    })

    it('浅层代理: 非空 path 下 deleteProperty 应正确构建 fullPath', () => {
      const { manager, setInternal } = createManager({ deep: false })
      const state = { count: 0, name: 'test' }
      // 传入非空 path，使浅层 deleteProperty 中的 path ? ... : ... 走 true 分支
      const proxy = manager.createStateProxy(state, 'root') as any

      setInternal(true)
      delete proxy.name
      expect(proxy.name).toBeUndefined()
    })
  })

  describe('生产环境补充覆盖', () => {
    const originalEnv = process.env.NODE_ENV

    beforeEach(() => {
      jest.resetModules()
      process.env.NODE_ENV = 'production'
    })

    afterEach(() => {
      process.env.NODE_ENV = originalEnv
    })

    const createProductionManager = (protection: Partial<InternalStateProtectionConfig> = {}) => {
      const { StateProxyManager, createProxyCache } = require('@/core/store/StateProxy')
      const proxyCache = createProxyCache()
      let isInternal = false
      return {
        manager: new StateProxyManager({
          protection: { enabled: true, deep: true, ...protection },
          proxyCache,
          isInternalAccess: () => isInternal,
        }),
        setInternal: (v: boolean) => {
          isInternal = v
        },
        proxyCache,
      }
    }

    it('深层代理: productionHandler=silent 应该允许 defineProperty', () => {
      const { manager } = createProductionManager({ productionHandler: 'silent' })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      Object.defineProperty(proxy, 'newProp', { value: 123, configurable: true })

      expect(warnSpy).not.toHaveBeenCalled()
      expect((state as any).newProp).toBe(123)
      warnSpy.mockRestore()
    })

    it('深层代理: productionHandler=warn 应该允许删除属性', () => {
      const { manager } = createProductionManager({ productionHandler: 'warn' })
      const state = { count: 0, name: 'test' }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      delete proxy.name

      expect(warnSpy).toHaveBeenCalled()
      expect(state.name).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('深层代理: productionHandler=warn 应该允许 defineProperty', () => {
      const { manager } = createProductionManager({ productionHandler: 'warn' })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      Object.defineProperty(proxy, 'newProp', { value: 123, configurable: true })

      expect(warnSpy).toHaveBeenCalled()
      expect((state as any).newProp).toBe(123)
      warnSpy.mockRestore()
    })

    it('深层代理: productionHandler=silent 应该允许设置嵌套属性', () => {
      const { manager } = createProductionManager({ productionHandler: 'silent' })
      const state = { nested: { value: 1 } }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      proxy.nested.value = 99

      expect(warnSpy).not.toHaveBeenCalled()
      expect(state.nested.value).toBe(99)
      warnSpy.mockRestore()
    })

    it('深层代理: productionHandler=silent 应该允许删除嵌套属性', () => {
      const { manager } = createProductionManager({ productionHandler: 'silent' })
      const state = { nested: { value: 1, extra: 2 } }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      delete proxy.nested.extra

      expect(warnSpy).not.toHaveBeenCalled()
      expect(state.nested.extra).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('浅层代理: productionHandler=silent 应该允许设置属性', () => {
      const { manager } = createProductionManager({ deep: false, productionHandler: 'silent' })
      const state = { count: 0 }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      proxy.count = 1

      expect(warnSpy).not.toHaveBeenCalled()
      expect(state.count).toBe(1)
      warnSpy.mockRestore()
    })

    it('浅层代理: productionHandler=warn 应该允许删除属性', () => {
      const { manager } = createProductionManager({ deep: false, productionHandler: 'warn' })
      const state = { count: 0, name: 'test' }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      delete proxy.name

      expect(warnSpy).toHaveBeenCalled()
      expect(state.name).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('浅层代理: productionHandler=silent 应该允许删除属性', () => {
      const { manager } = createProductionManager({ deep: false, productionHandler: 'silent' })
      const state = { count: 0, name: 'test' }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      delete proxy.name

      expect(warnSpy).not.toHaveBeenCalled()
      expect(state.name).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('数组代理: productionHandler=error 应该抛出错误（数组 set）', () => {
      const { manager } = createProductionManager({ productionHandler: 'error' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        proxy.items[0] = 10
      }).toThrow('Direct mutation of state')
    })

    it('数组代理: productionHandler=warn 应该允许修改数组元素', () => {
      const { manager } = createProductionManager({ productionHandler: 'warn' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      proxy.items[0] = 10

      expect(warnSpy).toHaveBeenCalled()
      expect(state.items[0]).toBe(10)
      warnSpy.mockRestore()
    })

    it('数组代理: productionHandler=warn 应该允许删除数组元素', () => {
      const { manager } = createProductionManager({ productionHandler: 'warn' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      delete proxy.items[0]

      expect(warnSpy).toHaveBeenCalled()
      expect(state.items[0]).toBeUndefined()
      warnSpy.mockRestore()
    })

    it('数组代理: productionHandler=error 应该抛出错误（数组 delete）', () => {
      const { manager } = createProductionManager({ productionHandler: 'error' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        delete proxy.items[0]
      }).toThrow('Direct mutation of state')
    })

    it('数组代理: productionHandler=error 应该抛出错误（数组方法）', () => {
      const { manager } = createProductionManager({ productionHandler: 'error' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      expect(() => {
        proxy.items.push(4)
      }).toThrow('Direct mutation of state')
    })

    it('数组代理: productionHandler=silent 应该允许 splice 方法', () => {
      const { manager } = createProductionManager({ productionHandler: 'silent' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const result = proxy.items.splice(1, 1)

      expect(warnSpy).not.toHaveBeenCalled()
      expect(result).toEqual([2])
      expect(state.items).toEqual([1, 3])
      warnSpy.mockRestore()
    })

    it('数组代理: productionHandler=silent 应该允许 shift 方法', () => {
      const { manager } = createProductionManager({ productionHandler: 'silent' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const result = proxy.items.shift()

      expect(warnSpy).not.toHaveBeenCalled()
      expect(result).toBe(1)
      expect(state.items).toEqual([2, 3])
      warnSpy.mockRestore()
    })

    it('数组代理: productionHandler=warn 应该允许数组方法返回结果', () => {
      const { manager } = createProductionManager({ productionHandler: 'warn' })
      const state = { items: [1, 2, 3] }
      const proxy = manager.createStateProxy(state, '') as any

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const result = proxy.items.unshift(0)

      expect(warnSpy).toHaveBeenCalled()
      expect(result).toBe(4)
      expect(state.items).toEqual([0, 1, 2, 3])
      warnSpy.mockRestore()
    })
  })
})
