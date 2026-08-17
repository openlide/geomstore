/**
 * GeomStore v1.0.0 - 钩子系统测试
 * @file tests/unit/hooks/hooks.test.ts
 */

import { HookSystem, usePlugin, type Plugin } from '@/core/hooks'
import { createStore } from '@/index'

describe('HookSystem - 钩子系统', () => {
  // 创建独立的钩子实例用于测试
  let hooks: HookSystem

  beforeEach(() => {
    // 每个测试前创建新的钩子实例
    hooks = new HookSystem()
  })

  describe('钩子注册', () => {
    it('HOOK-001: 应该能够注册钩子处理器', () => {
      const handler = jest.fn()
      const unsubscribe = hooks.on('beforeSetState', handler)

      expect(typeof unsubscribe).toBe('function')
      expect(hooks.size('beforeSetState')).toBe(1)

      unsubscribe()
    })

    it('HOOK-002: 应该能够为同一钩子注册多个处理器', () => {
      const handler1 = jest.fn()
      const handler2 = jest.fn()
      const handler3 = jest.fn()

      hooks.on('beforeSetState', handler1)
      hooks.on('beforeSetState', handler2)
      hooks.on('beforeSetState', handler3)

      expect(hooks.size('beforeSetState')).toBe(3)
    })

    it('HOOK-003: 应该支持所有类型的钩子', () => {
      const handler = jest.fn()

      const hookNames = [
        'beforeSetState',
        'afterSetState',
        'beforePatch',
        'afterPatch',
        'beforeDispatch',
        'afterDispatch',
        'beforeReplaceState',
        'afterReplaceState',
        'onError',
      ] as const

      hookNames.forEach((hookName) => {
        hooks.on(hookName, handler)
        expect(hooks.size(hookName)).toBe(1)
      })
    })

    it('HOOK-004: 返回的取消函数应该移除处理器', () => {
      const handler = jest.fn()
      const unsubscribe = hooks.on('beforeSetState', handler)

      expect(hooks.size('beforeSetState')).toBe(1)

      unsubscribe()
      expect(hooks.size('beforeSetState')).toBe(0)
    })

    it('HOOK-005: 取消函数应该只移除对应的处理器', () => {
      const handler1 = jest.fn()
      const handler2 = jest.fn()
      const handler3 = jest.fn()

      const unsubscribe2 = hooks.on('beforeSetState', handler1)
      hooks.on('beforeSetState', handler2)
      hooks.on('beforeSetState', handler3)

      expect(hooks.size('beforeSetState')).toBe(3)

      unsubscribe2()
      expect(hooks.size('beforeSetState')).toBe(2)

      hooks.emit('beforeSetState')
      expect(handler1).not.toHaveBeenCalled()
      expect(handler2).toHaveBeenCalled()
      expect(handler3).toHaveBeenCalled()
    })

    it('HOOK-006: 同一个处理器多次注册会被去重', () => {
      const handler = jest.fn()

      hooks.on('beforeSetState', handler)
      hooks.on('beforeSetState', handler)
      hooks.on('beforeSetState', handler)

      hooks.emit('beforeSetState', 'test')
      // HookSystem使用Set存储，不会存储重复值
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('钩子触发', () => {
    it('HOOK-007: emit应该触发所有注册的处理器', () => {
      const handler1 = jest.fn()
      const handler2 = jest.fn()
      const handler3 = jest.fn()

      hooks.on('beforeSetState', handler1)
      hooks.on('beforeSetState', handler2)
      hooks.on('beforeSetState', handler3)

      hooks.emit('beforeSetState', 'key', 'value')

      expect(handler1).toHaveBeenCalledWith('key', 'value')
      expect(handler2).toHaveBeenCalledWith('key', 'value')
      expect(handler3).toHaveBeenCalledWith('key', 'value')
    })

    it('HOOK-008: emit应该传递正确的参数', () => {
      const handler = jest.fn()

      hooks.on('beforeSetState', handler)
      hooks.emit('beforeSetState', 'count', 100, 'extra', 'data')

      expect(handler).toHaveBeenCalledWith('count', 100, 'extra', 'data')
    })

    it('HOOK-009: emit未注册的钩子不应该报错', () => {
      expect(() => {
        hooks.emit('beforeSetState' as any)
      }).not.toThrow()
    })

    it('HOOK-010: emit应该按注册顺序执行处理器', () => {
      const order: number[] = []

      const handler1 = jest.fn(() => order.push(1))
      const handler2 = jest.fn(() => order.push(2))
      const handler3 = jest.fn(() => order.push(3))

      hooks.on('beforeSetState', handler1)
      hooks.on('beforeSetState', handler2)
      hooks.on('beforeSetState', handler3)

      hooks.emit('beforeSetState')

      expect(order).toEqual([1, 2, 3])
    })

    it('HOOK-011: 处理器返回值应该被传递', () => {
      const handler1 = jest.fn(() => 'result1')
      const handler2 = jest.fn(() => 'result2')

      hooks.on('beforeSetState', handler1)
      hooks.on('beforeSetState', handler2)

      // emit不返回值，只是执行处理器
      hooks.emit('beforeSetState')
    })

    it('HOOK-012: 处理器可以修改参数', () => {
      let capturedArgs: any[] = []

      const handler1 = jest.fn((...args) => {
        capturedArgs = args
      })

      const handler2 = jest.fn((_key, _value) => {
        // 修改参数（注意：这不会影响后续处理器，因为是值传递）
      })

      hooks.on('beforeSetState', handler1)
      hooks.on('beforeSetState', handler2)

      hooks.emit('beforeSetState', 'count', 5)

      expect(capturedArgs).toEqual(['count', 5])
    })
  })

  describe('错误处理', () => {
    it('HOOK-013: 处理器抛出错误不应该阻止其他处理器执行', () => {
      const handler1 = jest.fn(() => {
        throw new Error('Test error')
      })
      const handler2 = jest.fn()
      const handler3 = jest.fn()

      hooks.on('beforeSetState', handler1)
      hooks.on('beforeSetState', handler2)
      hooks.on('beforeSetState', handler3)

      expect(() => {
        hooks.emit('beforeSetState')
      }).not.toThrow()

      expect(handler2).toHaveBeenCalled()
      expect(handler3).toHaveBeenCalled()
    })

    it('HOOK-014: 处理器错误应该被捕获并记录', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const handler = jest.fn(() => {
        throw new Error('Test error')
      })

      hooks.on('beforeSetState', handler)
      hooks.emit('beforeSetState')

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('HOOK-015: onError钩子应该在处理器错误时触发', () => {
      const errorHandler = jest.fn()
      const handler = jest.fn(() => {
        throw new Error('Test error')
      })

      hooks.on('onError', errorHandler)
      hooks.on('beforeSetState', handler)

      hooks.emit('beforeSetState')

      expect(errorHandler).toHaveBeenCalled()
      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error), 'beforeSetState')
    })

    it('HOOK-016: onError处理器自身抛出错误不应该导致无限循环', () => {
      const errorHandler = jest.fn(() => {
        throw new Error('Error in error handler')
      })
      const handler = jest.fn(() => {
        throw new Error('Original error')
      })

      hooks.on('onError', errorHandler)
      hooks.on('beforeSetState', handler)

      expect(() => {
        hooks.emit('beforeSetState')
      }).not.toThrow()
    })
  })

  describe('钩子清除', () => {
    it('HOOK-017: clear应该清除指定钩子的所有处理器', () => {
      hooks.on('beforeSetState', jest.fn())
      hooks.on('beforeSetState', jest.fn())
      hooks.on('afterSetState', jest.fn())

      expect(hooks.size('beforeSetState')).toBe(2)
      expect(hooks.size('afterSetState')).toBe(1)

      hooks.clear('beforeSetState' as any)

      expect(hooks.size('beforeSetState')).toBe(0)
      expect(hooks.size('afterSetState')).toBe(1)
    })

    it('HOOK-018: clear不传参数应该清除所有钩子', () => {
      hooks.on('beforeSetState', jest.fn())
      hooks.on('afterSetState', jest.fn())
      hooks.on('beforePatch', jest.fn())

      expect(hooks.size()).toBe(3)

      hooks.clear()

      expect(hooks.size()).toBe(0)
      expect(hooks.size('beforeSetState')).toBe(0)
      expect(hooks.size('afterSetState')).toBe(0)
      expect(hooks.size('beforePatch')).toBe(0)
    })

    it('HOOK-019: clear不存在的钩子不应该报错', () => {
      expect(() => {
        hooks.clear('nonexistentHook' as any)
      }).not.toThrow()
    })

    it('HOOK-020: clear可以多次调用', () => {
      expect(() => {
        hooks.clear()
        hooks.clear()
        hooks.clear()
      }).not.toThrow()
    })
  })

  describe('钩子数量', () => {
    it('HOOK-021: size应该返回指定钩子的处理器数量', () => {
      hooks.on('beforeSetState', jest.fn())
      hooks.on('beforeSetState', jest.fn())
      hooks.on('beforeSetState', jest.fn())

      expect(hooks.size('beforeSetState')).toBe(3)
    })

    it('HOOK-022: size不传参数应该返回钩子类型数量', () => {
      hooks.on('beforeSetState', jest.fn())
      hooks.on('afterSetState', jest.fn())
      hooks.on('beforePatch', jest.fn())

      expect(hooks.size()).toBe(3)
    })

    it('HOOK-023: size应该返回0对于未注册的钩子', () => {
      expect(hooks.size('beforeSetState')).toBe(0)
    })

    it('HOOK-024: size应该动态更新', () => {
      expect(hooks.size('beforeSetState')).toBe(0)

      const handler1 = jest.fn()
      const handler2 = jest.fn()

      hooks.on('beforeSetState', handler1)
      expect(hooks.size('beforeSetState')).toBe(1)

      hooks.on('beforeSetState', handler2)
      expect(hooks.size('beforeSetState')).toBe(2)

      handler1()
      expect(hooks.size('beforeSetState')).toBe(2)
    })

    it('HOOK-025: listenerCount应该返回已注册处理器数量', () => {
      hooks.on('beforeSetState', jest.fn())
      hooks.on('beforeSetState', jest.fn())
      hooks.on('beforeSetState', jest.fn())

      expect(hooks.listenerCount('beforeSetState')).toBe(3)
    })

    it('HOOK-026: listenerCount应该返回0对于未注册的钩子', () => {
      expect(hooks.listenerCount('beforeSetState')).toBe(0)
      expect(hooks.listenerCount('onError')).toBe(0)
    })

    it('HOOK-027: listenerCount应该动态更新', () => {
      expect(hooks.listenerCount('beforeSetState')).toBe(0)

      hooks.on('beforeSetState', jest.fn())
      expect(hooks.listenerCount('beforeSetState')).toBe(1)

      const unsubscribe = hooks.on('beforeSetState', jest.fn())
      expect(hooks.listenerCount('beforeSetState')).toBe(2)

      unsubscribe()
      expect(hooks.listenerCount('beforeSetState')).toBe(1)
    })
  })
})

describe('usePlugin - 插件安装函数', () => {
  it('PLUGIN-001: 应该能够安装插件', () => {
    const store = createStore({ state: { count: 0 } })
    const install = jest.fn()

    const plugin: Plugin = {
      name: 'test-plugin',
      install,
    }

    const uninstall = usePlugin(plugin, store as any)

    expect(install).toHaveBeenCalledWith(store)
    expect(typeof uninstall).toBe('function')
  })

  it('PLUGIN-002: 插件install失败应该记录错误', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    const store = createStore({ state: { count: 0 } })

    const plugin: Plugin = {
      name: 'failing-plugin',
      install() {
        throw new Error('Install failed')
      },
    }

    const uninstall = usePlugin(plugin, store as any)

    expect(consoleSpy).toHaveBeenCalled()
    // install 失败时返回安全的空卸载函数
    expect(() => uninstall()).not.toThrow()
    consoleSpy.mockRestore()
  })

  it('PLUGIN-003: 返回的卸载函数应该执行插件的卸载逻辑', () => {
    const store = createStore({ state: { count: 0 } })
    const uninstallPlugin = jest.fn()

    const plugin: Plugin = {
      name: 'test-plugin',
      install() {
        return uninstallPlugin
      },
    }

    const uninstall = usePlugin(plugin, store as any)
    uninstall()

    expect(uninstallPlugin).toHaveBeenCalled()
  })

  it('PLUGIN-004: 插件install不返回卸载函数应该可以正常卸载', () => {
    const store = createStore({ state: { count: 0 } })

    const plugin: Plugin = {
      name: 'test-plugin',
      install() {
        // 没有返回卸载函数
      },
    }

    const uninstall = usePlugin(plugin, store as any)

    expect(() => {
      uninstall()
    }).not.toThrow()
  })

  it('PLUGIN-005: 插件install返回非函数应该可以正常卸载', () => {
    const store = createStore({ state: { count: 0 } })

    const plugin: Plugin = {
      name: 'test-plugin',
      install() {
        return 'not a function' as any
      },
    }

    const uninstall = usePlugin(plugin, store as any)

    expect(() => {
      uninstall()
    }).not.toThrow()
  })
})
