/**
 * GeomStore v1.0.0 - 状态保护机制单元测试
 *
 * 测试内容：
 * - Proxy状态保护
 * - 递归嵌套对象保护
 * - 数组保护
 * - 内部访问权限
 * - 配置选项
 */

import { createStore } from '../../../src/index'

describe('状态保护机制', () => {
  describe('基本保护', () => {
    it('PROTECT-001: 应该阻止外部直接修改顶层状态', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0, name: 'test' },
      })

      expect(() => {
        store.state.count = 100
      }).toThrow('Direct mutation of state')
    })

    it('PROTECT-002: 应该允许通过setState修改状态', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
      })

      store.setState('count', 100)
      expect(store.state.count).toBe(100)
    })

    it('PROTECT-003: 应该允许通过$patch修改状态', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0, name: 'test' },
      })

      store.$patch({ count: 10, name: 'updated' })
      expect(store.state.count).toBe(10)
      expect(store.state.name).toBe('updated')
    })

    it('PROTECT-004: 应该允许actions内部修改状态', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
        actions: {
          increment() {
            this.state.count++
          },
          setCount(val: number) {
            this.state.count = val
          },
        },
      })

      store.dispatch('increment')
      expect(store.state.count).toBe(1)

      store.dispatch('setCount', 100)
      expect(store.state.count).toBe(100)
    })

    it('PROTECT-005: 应该允许读取状态', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 42, nested: { value: 'hello' } },
      })

      expect(store.state.count).toBe(42)
      expect(store.state.nested.value).toBe('hello')
    })
  })

  describe('嵌套对象保护', () => {
    it('PROTECT-006: 应该阻止外部修改嵌套对象', () => {
      const store = createStore({
        name: 'test-store',
        state: {
          user: {
            name: 'Alice',
            profile: {
              age: 25,
            },
          },
        },
      })

      expect(() => {
        store.state.user.name = 'Bob'
      }).toThrow('Direct mutation of state')

      expect(() => {
        store.state.user.profile.age = 30
      }).toThrow('Direct mutation of state')
    })

    it('PROTECT-007: 应该允许actions内部修改嵌套对象', () => {
      const store = createStore({
        name: 'test-store',
        state: {
          user: {
            name: 'Alice',
            profile: {
              age: 25,
            },
          },
        },
        actions: {
          updateName(name: string) {
            this.state.user.name = name
          },
          updateAge(age: number) {
            this.state.user.profile.age = age
          },
        },
      })

      store.dispatch('updateName', 'Bob')
      expect(store.state.user.name).toBe('Bob')

      store.dispatch('updateAge', 30)
      expect(store.state.user.profile.age).toBe(30)
    })

    it('PROTECT-008: 应该阻止删除嵌套属性', () => {
      const store = createStore({
        name: 'test-store',
        state: {
          user: { name: 'Alice' },
        },
      })

      expect(() => {
        delete (store.state.user as Record<string, unknown>).name
      }).toThrow('Direct mutation of state')
    })
  })

  describe('数组保护', () => {
    it('PROTECT-009: 应该阻止外部直接修改数组元素', () => {
      const store = createStore({
        name: 'test-store',
        state: {
          items: ['a', 'b', 'c'],
        },
      })

      expect(() => {
        store.state.items[0] = 'x'
      }).toThrow('Direct mutation of state')
    })

    it('PROTECT-010: 应该阻止外部调用数组变异方法', () => {
      const store = createStore({
        name: 'test-store',
        state: {
          items: ['a', 'b', 'c'],
        },
      })

      expect(() => {
        store.state.items.push('d')
      }).toThrow('Direct mutation of state')

      expect(() => {
        store.state.items.pop()
      }).toThrow('Direct mutation of state')
    })

    it('PROTECT-011: 应该允许actions内部修改数组', () => {
      const store = createStore({
        name: 'test-store',
        state: {
          items: [] as string[],
        },
        actions: {
          addItem(item: string) {
            this.state.items.push(item)
          },
          updateItem(index: number, value: string) {
            this.state.items[index] = value
          },
        },
      })

      store.dispatch('addItem', 'a')
      store.dispatch('addItem', 'b')
      expect(store.state.items).toEqual(['a', 'b'])

      store.dispatch('updateItem', 0, 'x')
      expect(store.state.items[0]).toBe('x')
    })

    it('PROTECT-012: 应该保护数组中的对象元素', () => {
      const store = createStore({
        name: 'test-store',
        state: {
          todos: [{ id: 1, text: 'Task 1', done: false }],
        },
      })

      expect(() => {
        store.state.todos[0].done = true
      }).toThrow('Direct mutation of state')
    })
  })

  describe('配置选项', () => {
    it('PROTECT-013: 应该支持禁用状态保护', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
        stateProtection: { enabled: false },
      })

      // 禁用保护后应该允许直接修改
      expect(() => {
        store.state.count = 100
      }).not.toThrow()
      expect(store.state.count).toBe(100)
    })

    it('PROTECT-014: 应该支持禁用深层保护', () => {
      const store = createStore({
        name: 'test-store',
        state: {
          user: { name: 'Alice' },
        },
        stateProtection: { enabled: true, deep: false },
      })

      // 顶层保护仍然有效
      expect(() => {
        (store.state as any).count = 100
      }).toThrow('Direct mutation of state')

      // 深层保护已禁用，可以修改嵌套对象
      expect(() => {
        store.state.user.name = 'Bob'
      }).not.toThrow()
      expect(store.state.user.name).toBe('Bob')
    })

    it('PROTECT-015: 默认应该启用状态保护和深层保护', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
      })

      expect(store.isStateProtectionEnabled()).toBe(true)
      const config = store.getStateProtectionConfig()
      expect(config.enabled).toBe(true)
      expect(config.deep).toBe(true)
    })

    it('PROTECT-016: 应该支持动态切换保护状态', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
      })

      // 默认启用保护
      expect(() => {
        store.state.count = 100
      }).toThrow()

      // 动态禁用保护
      store.setStateProtection(false)
      expect(store.isStateProtectionEnabled()).toBe(false)

      // 现在应该可以修改
      expect(() => {
        store.state.count = 100
      }).not.toThrow()
      expect(store.state.count).toBe(100)

      // 重新启用保护
      store.setStateProtection(true)
      expect(store.isStateProtectionEnabled()).toBe(true)
    })
  })

  describe('扩展接口', () => {
    it('PROTECT-017: isStateProtectionEnabled应该返回当前保护状态', () => {
      const store1 = createStore({
        name: 'store1',
        state: { count: 0 },
      })
      expect(store1.isStateProtectionEnabled()).toBe(true)

      const store2 = createStore({
        name: 'store2',
        state: { count: 0 },
        stateProtection: { enabled: false },
      })
      expect(store2.isStateProtectionEnabled()).toBe(false)
    })

    it('PROTECT-018: getStateProtectionConfig应该返回保护配置', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
        stateProtection: {
          enabled: true,
          deep: false,
          productionHandler: 'silent',
        },
      })

      const config = store.getStateProtectionConfig()
      expect(config.enabled).toBe(true)
      expect(config.deep).toBe(false)
      expect(config.productionHandler).toBe('silent')
    })

    it('PROTECT-019: 返回的配置应该是只读的', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
      })

      const config = store.getStateProtectionConfig()
      // TypeScript会阻止修改，但运行时也应该返回副本
      expect(() => {
        (config as any).enabled = false
      }).not.toThrow() // 修改副本不影响原配置
      expect(store.isStateProtectionEnabled()).toBe(true)
    })
  })

  describe('错误信息', () => {
    it('PROTECT-020: 错误信息应该包含属性路径', () => {
      const store = createStore({
        name: 'test-store',
        state: {
          user: { profile: { age: 25 } },
        },
      })

      try {
        store.state.user.profile.age = 30
        fail('应该抛出错误')
      } catch (error) {
        expect((error as Error).message).toContain('user.profile.age')
      }
    })

    it('PROTECT-021: 错误信息应该建议使用正确的API', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
      })

      try {
        store.state.count = 100
        fail('应该抛出错误')
      } catch (error) {
        expect((error as Error).message).toContain('setState()')
        expect((error as Error).message).toContain('$patch()')
      }
    })
  })

  describe('性能优化验证', () => {
    it('PROTECT-022: Proxy应该被缓存避免重复创建', () => {
      const store = createStore({
        name: 'test-store',
        state: { user: { name: 'Alice' } },
      })

      // 多次访问应该返回缓存的同一个Proxy
      const proxy1 = store.state.user
      const proxy2 = store.state.user

      // 注意：由于每次访问都会尝试创建Proxy，但会从缓存中返回
      // 所以两次访问的结果应该是同一个Proxy实例
      expect(proxy1).toBe(proxy2)
    })

    it('PROTECT-023: 内部访问时应该跳过Proxy创建', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
        actions: {
          getCount(): unknown {
            // 内部访问应该直接返回原始状态
            return (this as any).state
          },
        },
      })

      const result = store.dispatch('getCount')
      // 结果应该是原始状态对象，不是Proxy
      expect(result).toEqual({ count: 0 })
    })
  })

  describe('边界情况', () => {
    it('PROTECT-024: 空对象状态应该正常工作', () => {
      const store = createStore({
        name: 'test-store',
        state: {},
      })

      expect(store.state).toEqual({})
      ;(store as any).setState('newKey', 'value')
      expect((store.state as any).newKey).toBe('value')
    })

    it('PROTECT-025: null值属性应该正常处理', () => {
      const store = createStore({
        name: 'test-store',
        state: { value: null as string | null },
      })

      expect(store.state.value).toBeNull()
      store.setState('value', 'not null')
      expect(store.state.value).toBe('not null')
    })

    it('PROTECT-026: 数组状态应该正常工作', () => {
      const store = createStore({
        name: 'test-store',
        state: { items: [1, 2, 3] },
      })

      expect(store.state.items).toEqual([1, 2, 3])
    })

    it('PROTECT-027: $replaceState应该正常工作', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
      })

      store.$replaceState({ count: 100, newKey: 'value' } as any)
      expect(store.state.count).toBe(100)
      expect((store.state as any).newKey).toBe('value')
    })

    it('PROTECT-028: $snapshot应该返回只读快照', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
      })

      const snapshot = store.$snapshot()
      expect(Object.isFrozen(snapshot)).toBe(true)
    })

    it('PROTECT-029: $restore应该正常工作', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 0 },
      })

      store.setState('count', 100)
      const snapshot = store.$snapshot()

      store.setState('count', 200)
      expect(store.state.count).toBe(200)

      store.$restore(snapshot)
      expect(store.state.count).toBe(100)
    })
  })

  describe('getters访问', () => {
    it('PROTECT-030: getters应该能正常读取状态', () => {
      const store = createStore({
        name: 'test-store',
        state: { count: 10 },
        getters: {
          doubleCount: (state) => state.count * 2,
        },
      })

      expect(store.getter('doubleCount')).toBe(20)
    })

    it('PROTECT-031: getters应该访问嵌套状态', () => {
      const store = createStore({
        name: 'test-store',
        state: {
          user: { name: 'Alice', age: 25 },
        },
        getters: {
          userName: (state) => state.user.name,
          userInfo: (state) => `${state.user.name} (${state.user.age})`,
        },
      })

      expect(store.getter('userName')).toBe('Alice')
      expect(store.getter('userInfo')).toBe('Alice (25)')
    })
  })

  describe('数组代理数字键严格校验（BUG-3）', () => {
    it('PROTECT-032: 非严格十进制整数字符串键不应被当作数组索引', () => {
      const items = Array.from({ length: 110 }, (_, i) => i)
      const store = createStore({
        name: 'test-store',
        state: { items },
      })
      const proxy = store.state.items as unknown as Record<string, unknown> & { [n: number]: number }

      // 修复前 Number('') === 0，proxy[''] 会错误地返回首元素
      expect(proxy['']).toBeUndefined()
      // 修复前 Number('1e2') === 100，会错误命中索引 100
      expect(proxy['1e2']).toBeUndefined()
      expect(proxy['100']).toBe(100)
      // 前导零不应命中对应索引
      expect(proxy['01']).toBeUndefined()
      expect(proxy['1']).toBe(1)
      // 正常索引访问不受影响
      expect(proxy.length).toBe(110)
    })
  })
})
