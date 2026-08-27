/**
 * GeomStore v1.0.0 - Store核心功能测试
 * @file tests/unit/store/store.test.ts
 */

import { createStore, isGeomStore } from '@/index'

describe('Store - 核心功能', () => {
  describe('创建和初始化', () => {
    it('STORE-001: 应该创建一个基本的Store实例', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
      })

      expect(store).toBeDefined()
      expect(isGeomStore(store)).toBe(true)
      expect(store.getState()).toEqual({ count: 0, name: 'test' })
    })

    it('STORE-002: 应该支持自定义Store名称', () => {
      const store = createStore({
        name: 'my-store',
        state: { count: 0 },
      })

      expect(store.name).toBe('my-store')
    })

    it('STORE-003: 应该为未指定名称的Store生成默认名称', () => {
      const store1 = createStore({ state: { count: 0 } })
      const store2 = createStore({ state: { count: 0 } })

      expect(store1.name).toBeDefined()
      expect(store2.name).toBeDefined()
      expect(store1.name).not.toBe(store2.name)
    })

    it('STORE-004: 应该支持空状态', () => {
      const store = createStore({ state: {} })
      expect(store.getState()).toEqual({})
    })

    it('STORE-005: 应该支持复杂的状态结构', () => {
      const complexState = {
        user: {
          name: 'John',
          age: 30,
          address: {
            city: 'Beijing',
            country: 'China',
          },
        },
        items: [1, 2, 3],
        settings: {
          theme: 'dark',
          notifications: true,
        },
      }

      const store = createStore({ state: complexState })
      expect(store.getState()).toEqual(complexState)
    })
  })

  describe('状态管理 - getState', () => {
    it('STORE-006: getState应该返回当前状态', () => {
      const store = createStore({ state: { count: 0 } })
      expect(store.getState()).toEqual({ count: 0 })
    })

    it('STORE-007: getState应该返回状态的引用（不是克隆）', () => {
      const state = { count: 0 }
      const store = createStore({ state })

      const state1 = store.getState()
      const state2 = store.getState()

      expect(state1).toBe(state2)
    })
  })

  describe('状态管理 - setState', () => {
    it('STORE-008: setState应该更新单个状态', () => {
      const store = createStore({ state: { count: 0, name: 'test' } })
      store.setState('count', 5)

      expect(store.getState().count).toBe(5)
      expect(store.getState().name).toBe('test')
    })

    it('STORE-009: setState应该支持字符串类型', () => {
      const store = createStore({ state: { name: 'John' } })
      store.setState('name', 'Jane')

      expect(store.getState().name).toBe('Jane')
    })

    it('STORE-010: setState应该支持布尔类型', () => {
      const store = createStore({ state: { active: false } })
      store.setState('active', true)

      expect(store.getState().active).toBe(true)
    })

    it('STORE-011: setState应该支持对象类型', () => {
      const store = createStore({ state: { user: { name: 'John' } } })
      const newUser = { name: 'Jane', age: 25 }
      store.setState('user', newUser as any)

      expect(store.getState().user).toEqual(newUser)
    })

    it('STORE-012: setState应该支持数组类型', () => {
      const store = createStore({ state: { items: [1, 2, 3] } })
      const newItems = [4, 5, 6]
      store.setState('items', newItems as any)

      expect(store.getState().items).toEqual(newItems)
    })

    it('STORE-013: setState应该支持null值', () => {
      const store = createStore({ state: { data: 'some-data' } })
      store.setState('data', null as any)

      expect(store.getState().data).toBeNull()
    })

    it('STORE-014: setState应该支持undefined值', () => {
      const store = createStore({ state: { data: 'some-data' } })
      store.setState('data', undefined as any)

      expect(store.getState().data).toBeUndefined()
    })
  })

  describe('状态管理 - $patch', () => {
    it('STORE-015: $patch应该批量更新状态', () => {
      const store = createStore({ state: { count: 0, name: 'test', active: false } })
      store.$patch({ count: 10, name: 'updated' })

      expect(store.getState()).toEqual({ count: 10, name: 'updated', active: false })
    })

    it('STORE-016: $patch应该支持部分更新', () => {
      const store = createStore({ state: { count: 0, name: 'test', age: 20 } })
      store.$patch({ count: 5 })

      expect(store.getState()).toEqual({ count: 5, name: 'test', age: 20 })
    })

    it('STORE-017: $patch应该支持嵌套对象', () => {
      const store = createStore({
        state: {
          user: { name: 'John', age: 30 },
          items: [1, 2, 3],
        },
      })

      store.$patch({ user: { name: 'Jane' } as any })

      expect(store.getState().user.name).toBe('Jane')
      expect(store.getState().user.age).toBe(30)
    })

    it('STORE-018: $patch应该支持空对象', () => {
      const store = createStore({ state: { count: 0 } })
      const initialState = store.getState()

      store.$patch({})

      expect(store.getState()).toEqual(initialState)
    })

    it('REGR-STORE-001: $patch 更新 Date 字段应替换生效而非静默保留旧值', () => {
      const store = createStore({ state: { ts: new Date(1000) } as never })
      store.$patch({ ts: new Date(2000) } as never)
      expect((store.getState() as { ts: Date }).ts.getTime()).toBe(2000)
    })

    it('REGR-STORE-002: $patch 用普通对象覆盖 Date 字段应整体替换', () => {
      const store = createStore({ state: { a: new Date(1000) } as never })
      store.$patch({ a: { x: 1 } } as never)
      expect((store.getState() as { a: { x: number } }).a).toEqual({ x: 1 })
    })
  })

  describe('状态管理 - $replaceState', () => {
    it('STORE-019: $replaceState应该替换整个状态', () => {
      const store = createStore({ state: { count: 0, name: 'test' } })
      store.$replaceState({ newCount: 10, newName: 'new' } as any)

      expect(store.getState()).toEqual({ newCount: 10, newName: 'new' })
    })

    it('STORE-020: $replaceState应该删除旧的状态键', () => {
      const store = createStore({ state: { count: 0, name: 'test', age: 20 } })
      store.$replaceState({ newCount: 10 } as any)

      expect(store.getState()).toEqual({ newCount: 10 })
      expect('count' in store.getState()).toBe(false)
    })

    it('STORE-021: $replaceState应该支持完全不同的状态结构', () => {
      const store = createStore({ state: { a: 1, b: 2 } })
      store.$replaceState({
        x: 'string',
        y: { nested: true },
        z: [1, 2, 3],
      } as any)

      expect(store.getState()).toEqual({
        x: 'string',
        y: { nested: true },
        z: [1, 2, 3],
      })
    })

    it('STORE-022: $replaceState应该支持空状态', () => {
      const store = createStore({ state: { count: 0, name: 'test' } })
      store.$replaceState({} as any)

      expect(store.getState()).toEqual({})
    })

    it('STORE-022B: batch 中调用 $replaceState 应只在 batch 结束时通知一次', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()
      store.subscribe(listener)

      store.batch(() => {
        store.$replaceState({ count: 1 } as any)
        expect(listener).not.toHaveBeenCalled() // 批量期间跳过通知
      })

      expect(listener).toHaveBeenCalledTimes(1) // batch 结束统一通知一次
    })

    it('STORE-022C: action 中调用 $replaceState 应由 dispatch 收尾统一通知', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          replaceInAction(this: any) {
            this.$replaceState({ count: 99 })
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      store.dispatch('replaceInAction')

      expect(store.getState().count).toBe(99)
      expect(listener).toHaveBeenCalledTimes(1) // dispatch 收尾统一通知
    })
  })

  describe('Actions', () => {
    it('STORE-023: 应该支持定义actions', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment(..._args: unknown[]) {
            (this.state as any).count++
          },
        },
      })

      expect(store.actions.increment).toBeDefined()
      expect(typeof store.actions.increment).toBe('function')
    })

    it('STORE-024: dispatch应该执行指定的action', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          increment(..._args: unknown[]) {
            (this.state as any).count++
          },
        },
      })

      store.dispatch('increment')
      expect(store.getState().count).toBe(1)
    })

    it('STORE-025: action应该接收参数', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          add(...args: unknown[]) {
            const [amount] = args as [number]
            ;(this.state as any).count += amount
          },
        },
      })

      store.dispatch('add', 10)
      expect(store.getState().count).toBe(10)
    })

    it('STORE-026: action应该支持多个参数', () => {
      const store = createStore({
        state: { message: '' },
        actions: {
          greet(...args: unknown[]) {
            const [greeting, name] = args as [string, string]
            ;(this.state as any).message = `${greeting}, ${name}!`
          },
        },
      })

      store.dispatch('greet', 'Hello', 'World')
      expect(store.getState().message).toBe('Hello, World!')
    })

    it('STORE-027: action应该返回值', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          double(..._args: unknown[]) {
            return (this.state as any).count * 2
          },
        },
      })

      const result = store.dispatch('double')
      expect(result).toBe(0)
    })

    it('STORE-028: dispatch应该抛出未找到action的错误', () => {
      const store = createStore({ state: { count: 0 } })

      expect(() => {
        store.dispatch('nonexistent')
      }).toThrow('Action "nonexistent" not found')
    })

    it('STORE-029: action中this应该绑定到store实例', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
        actions: {
          updateState(...args: unknown[]) {
            const [newCount, newName] = args as [number, string]
            ;(this.state as any).count = newCount
            ;(this.state as any).name = newName
            return this.getState()
          },
        },
      })

      const result = store.dispatch('updateState', 5, 'updated')
      expect(result).toEqual({ count: 5, name: 'updated' })
    })

    it('STORE-030: 应该支持多个actions', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
        actions: {
          increment(..._args: unknown[]) {
            (this.state as any).count++
          },
          decrement(..._args: unknown[]) {
            (this.state as any).count--
          },
          setName(...args: unknown[]) {
            const [name] = args as [string]
            ;(this.state as any).name = name
          },
        },
      })

      store.dispatch('increment')
      store.dispatch('increment')
      store.dispatch('decrement')
      store.dispatch('setName', 'updated')

      expect(store.getState()).toEqual({ count: 1, name: 'updated' })
    })

    it('STORE-031: 应该支持空的actions', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {},
      })

      expect(store.actions).toEqual({})
    })
  })

  describe('Getters', () => {
    it('STORE-032: 应该支持定义getters', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
        },
      })

      expect(store.getter('double')).toBe(0)
    })

    it('STORE-033: getter应该基于最新state计算', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          double(state) {
            return state.count * 2
          },
        },
      })

      store.setState('count', 5)
      expect(store.getter('double')).toBe(10)
    })

    it('STORE-034: getter应该支持复杂计算', () => {
      const store = createStore({
        state: { items: [1, 2, 3, 4, 5] },
        getters: {
          sum(state) {
            return state.items.reduce((a, b) => a + b, 0)
          },
          average(state) {
            return state.items.length > 0 ? state.items.reduce((a, b) => a + b, 0) / state.items.length : 0
          },
        },
      })

      expect(store.getter('sum')).toBe(15)
      expect(store.getter('average')).toBe(3)
    })

    it('STORE-035: getter应该支持嵌套状态', () => {
      const store = createStore({
        state: {
          user: { name: 'John', age: 30 },
        },
        getters: {
          userInfo(state) {
            return `${state.user.name} is ${state.user.age} years old`
          },
        },
      })

      expect(store.getter('userInfo')).toBe('John is 30 years old')
    })

    it('STORE-036: getter应该抛出未找到getter的错误', () => {
      const store = createStore({ state: { count: 0 } })

      expect(() => {
        store.getter('nonexistent')
      }).toThrow('Getter "nonexistent" not found')
    })

    it('STORE-037: 应该支持多个getters', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
        getters: {
          double(state) {
            return state.count * 2
          },
          triple(state) {
            return state.count * 3
          },
          greeting(state) {
            return `Hello, ${state.name}!`
          },
        },
      })

      expect(store.getter('double')).toBe(0)
      expect(store.getter('triple')).toBe(0)
      expect(store.getter('greeting')).toBe('Hello, test!')
    })
  })

  describe('订阅机制', () => {
    it('STORE-038: subscribe应该订阅状态变化', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()

      store.subscribe(listener)
      store.setState('count', 5)

      expect(listener).toHaveBeenCalledWith({ count: 5 })
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('STORE-039: subscribe应该返回取消订阅函数', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()

      const unsubscribe = store.subscribe(listener)
      unsubscribe()
      store.setState('count', 5)

      expect(listener).not.toHaveBeenCalled()
    })

    it('STORE-040: 应该支持多个订阅者', () => {
      const store = createStore({ state: { count: 0 } })
      const listener1 = jest.fn()
      const listener2 = jest.fn()
      const listener3 = jest.fn()

      store.subscribe(listener1)
      store.subscribe(listener2)
      store.subscribe(listener3)
      store.setState('count', 5)

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
      expect(listener3).toHaveBeenCalledTimes(1)
    })

    it('STORE-041: 订阅者应该在$patch后触发', () => {
      const store = createStore({ state: { count: 0, name: 'test' } })
      const listener = jest.fn()

      store.subscribe(listener)
      store.$patch({ count: 10, name: 'updated' })

      expect(listener).toHaveBeenCalledWith({ count: 10, name: 'updated' })
    })

    it('STORE-042: 订阅者应该在$replaceState后触发', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()

      store.subscribe(listener)
      store.$replaceState({ newCount: 20 } as any)

      expect(listener).toHaveBeenCalledWith({ newCount: 20 })
    })

    it('STORE-043: 订阅者应该接收最新的state', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()

      store.subscribe(listener)
      store.setState('count', 1)
      store.setState('count', 2)
      store.setState('count', 3)

      // 订阅者会收到每次状态变化
      expect(listener).toHaveBeenCalledTimes(3)
      const calls = listener.mock.calls
      expect(calls[0]).toEqual([{ count: 1 }])
      expect(calls[1]).toEqual([{ count: 2 }])
      expect(calls[2]).toEqual([{ count: 3 }])
    })

    it('STORE-044: 取消订阅应该不影响其他订阅者', () => {
      const store = createStore({ state: { count: 0 } })
      const listener1 = jest.fn()
      const listener2 = jest.fn()
      const listener3 = jest.fn()

      const unsubscribe2 = store.subscribe(listener1)
      store.subscribe(listener2)
      store.subscribe(listener3)

      unsubscribe2()
      store.setState('count', 5)

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledTimes(1)
      expect(listener3).toHaveBeenCalledTimes(1)
    })

    it('STORE-045: 订阅者错误不应该影响其他订阅者', () => {
      const store = createStore({ state: { count: 0 } })
      const listener1 = jest.fn(() => {
        throw new Error('Test error')
      })
      const listener2 = jest.fn()

      store.subscribe(listener1)
      store.subscribe(listener2)
      store.setState('count', 5)

      expect(listener1).toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()
    })

    it('STORE-046: 同一个订阅者多次注册按注册次数通知，退订只减一（#14 引用计数语义）', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()

      const unsub1 = store.subscribe(listener)
      const unsub2 = store.subscribe(listener)
      const unsub3 = store.subscribe(listener)
      store.setState('count', 5)

      // 与 Redux/Vuex 一致：同一函数注册 N 次收到 N 次回调
      expect(listener).toHaveBeenCalledTimes(3)

      // 任一份退订只减少一份注册（剩两份，各收到一次回调）
      unsub1()
      store.setState('count', 6)
      expect(listener).toHaveBeenCalledTimes(5)

      // 剩余两份全部退订后才不再收到通知
      unsub2()
      unsub3()
      store.setState('count', 7)
      expect(listener).toHaveBeenCalledTimes(5)
    })
  })

  describe('生命周期管理', () => {
    it('STORE-047: destroy后调用setState应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()

      store.subscribe(listener)
      store.destroy()

      // P2-3 行为变更：销毁后的 Store 拒绝任何操作，防止数据损坏
      expect(() => store.setState('count', 5)).toThrow('[GeomStore] Cannot call setState on a destroyed Store')
      expect(listener).not.toHaveBeenCalled()
    })

    it('STORE-048: destroy后state仍然可访问', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()

      expect(store.getState()).toEqual({ count: 0 })
    })

    it('STORE-049: destroy可以多次调用', () => {
      const store = createStore({ state: { count: 0 } })

      expect(() => {
        store.destroy()
        store.destroy()
        store.destroy()
      }).not.toThrow()
    })
  })

  describe('插件管理', () => {
    it('STORE-050: use应该安装插件', () => {
      const store = createStore({ state: { count: 0 } })
      const install = jest.fn()

      const plugin = {
        name: 'test-plugin',
        install,
      }

      store.use(plugin)
      expect(install).toHaveBeenCalledWith(store)
    })

    it('STORE-051: 插件install可以返回卸载函数', () => {
      const store = createStore({ state: { count: 0 } })
      const uninstall = jest.fn()

      const plugin = {
        name: 'test-plugin',
        install() {
          return uninstall
        },
      }

      store.use(plugin)
      // 卸载函数由插件自行管理
    })

    it('STORE-052: 插件install不是函数应该不报错', () => {
      const store = createStore({ state: { count: 0 } })

      const plugin = {
        name: 'test-plugin',
      } as any

      expect(() => {
        store.use(plugin)
      }).not.toThrow()
    })
  })

  describe('边界条件', () => {
    it('STORE-053: state值为null', () => {
      const store = createStore({ state: { data: null } })
      expect(store.getState().data).toBeNull()
    })

    it('STORE-054: state值为undefined', () => {
      const store = createStore({ state: { data: undefined } })
      expect(store.getState().data).toBeUndefined()
    })

    it('STORE-055: state值为0', () => {
      const store = createStore({ state: { count: 0 } })
      expect(store.getState().count).toBe(0)
    })

    it('STORE-056: state值为空字符串', () => {
      const store = createStore({ state: { name: '' } })
      expect(store.getState().name).toBe('')
    })

    it('STORE-057: state值为false', () => {
      const store = createStore({ state: { active: false } })
      expect(store.getState().active).toBe(false)
    })

    it('STORE-058: state值为空数组', () => {
      const store = createStore({ state: { items: [] } })
      expect(store.getState().items).toEqual([])
    })

    it('STORE-059: $patch传入undefined应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })

      // P2-5 行为变更：null/undefined 参数不再静默忽略，而是抛出 TypeError
      expect(() => {
        store.$patch(undefined as any)
      }).toThrow(TypeError)
    })

    it('STORE-060: $replaceState传入undefined应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })

      expect(() => {
        store.$replaceState(undefined as any)
      }).toThrow(TypeError)
    })

    it('STORE-061: dispatch未定义的action', () => {
      const store = createStore({ state: { count: 0 } })

      expect(() => {
        store.dispatch('undefinedAction')
      }).toThrow('Action "undefinedAction" not found')
    })

    it('STORE-062: getter未定义的getter', () => {
      const store = createStore({ state: { count: 0 } })

      expect(() => {
        store.getter('undefinedGetter')
      }).toThrow('Getter "undefinedGetter" not found')
    })
  })

  describe('类型检查', () => {
    it('STORE-063: isGeomStore应该正确识别Store实例', () => {
      const store = createStore({ state: { count: 0 } })
      const notStore = { count: 0 }

      expect(isGeomStore(store)).toBe(true)
      expect(isGeomStore(notStore)).toBe(false)
      expect(isGeomStore(null)).toBe(false)
      expect(isGeomStore(undefined)).toBe(false)
      expect(isGeomStore({})).toBe(false)
    })
  })

  describe('操作队列串行化', () => {
    it('STORE-064: 异步操作应该串行化执行', async () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          async increment() {
            await new Promise((resolve) => setTimeout(resolve, 10))
            this.setState('count', this.state.count + 1)
          },
        },
      })

      // 并发执行多个异步操作
      await Promise.all([store.dispatch('increment'), store.dispatch('increment'), store.dispatch('increment')])

      // 由于串行化，最终结果应该是3
      expect(store.state.count).toBe(3)
    })

    it('STORE-065: 异步操作错误应该被捕获', async () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          async errorAction() {
            throw new Error('Async action error')
          },
        },
      })

      try {
        await store.dispatch('errorAction')
        fail('应该抛出错误')
      } catch (error) {
        expect(error).toBeDefined()
      }
    })
  })

  describe('快照功能', () => {
    it('STORE-066: $snapshot应该创建不可变的快照', () => {
      const store = createStore({
        state: { count: 0, user: { name: 'Alice' } },
      })

      const snapshot = store.$snapshot()

      expect(snapshot).toEqual({ count: 0, user: { name: 'Alice' } })
      expect(Object.isFrozen(snapshot)).toBe(true)
    })

    it('STORE-072 (BUG-F11): $snapshot应该递归深冻结嵌套对象和数组', () => {
      const store = createStore({
        state: {
          user: { name: 'Alice', profile: { city: 'Beijing' } },
          items: [{ id: 1 }, { id: 2 }],
        },
      })

      const snapshot = store.$snapshot()

      // 顶层与嵌套纯对象均被冻结
      expect(Object.isFrozen(snapshot)).toBe(true)
      expect(Object.isFrozen(snapshot.user)).toBe(true)
      expect(Object.isFrozen(snapshot.user.profile)).toBe(true)
      // 数组及其元素对象也被递归冻结
      expect(Object.isFrozen(snapshot.items)).toBe(true)
      expect(Object.isFrozen(snapshot.items[0])).toBe(true)
      expect(Object.isFrozen(snapshot.items[1])).toBe(true)
    })

    it('STORE-073 (BUG-F11): 快照深冻结不影响原state的可变性', () => {
      const store = createStore({
        state: { user: { name: 'Alice' }, items: [] as number[] },
      })

      const snapshot = store.$snapshot()

      // 原状态仍可正常修改（冻结只作用于快照副本）
      store.setState('user', { name: 'Bob' })
      expect(store.state.user.name).toBe('Bob')

      // 快照保持创建时的内容且持续冻结
      expect(snapshot.user).toEqual({ name: 'Alice' })
      expect(Object.isFrozen(snapshot.user)).toBe(true)
    })

    it('STORE-067: $restore应该从快照恢复状态', () => {
      const store = createStore({
        state: { count: 0, user: { name: 'Alice' } },
      })

      const snapshot = store.$snapshot()

      store.setState('count', 10)
      store.setState('user', { name: 'Bob' })

      store.$restore(snapshot)

      expect(store.state.count).toBe(0)
      expect(store.state.user).toEqual({ name: 'Alice' })
    })

    it('STORE-068: 恢复后应该触发订阅', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()

      store.subscribe(listener)
      const snapshot = store.$snapshot()

      store.setState('count', 5)
      listener.mockClear()

      store.$restore(snapshot)

      expect(listener).toHaveBeenCalled()
    })
  })

  describe('错误处理边界', () => {
    it('STORE-069: dispatch执行action时抛出错误应该正确处理', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          errorAction() {
            throw new Error('Action error')
          },
        },
      })

      expect(() => {
        store.dispatch('errorAction')
      }).toThrow('Action "errorAction" execution failed')
    })

    it('STORE-070: getter执行时抛出错误应该正确处理', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          errorGetter: () => {
            throw new Error('Getter error')
          },
        },
      })

      expect(() => {
        store.getter('errorGetter')
      }).toThrow('Getter "errorGetter" execution failed')
    })
  })

  describe('订阅者数量限制', () => {
    it('STORE-071: 订阅者超过50个应该自动移除最早的', () => {
      const store = createStore({ state: { count: 0 } })
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      const listeners: Array<() => void> = []

      // 创建51个订阅者
      for (let i = 0; i < 51; i++) {
        listeners.push(store.subscribe(() => {}))
      }

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('订阅者数量已达到上限'))

      consoleSpy.mockRestore()
    })

    it('STORE-072: 移除最早订阅者后新订阅者应该正常工作', () => {
      const store = createStore({ state: { count: 0 } })
      const newListener = jest.fn()

      // 创建51个订阅者
      for (let i = 0; i < 50; i++) {
        store.subscribe(() => {})
      }

      const unsubscribe = store.subscribe(newListener)
      store.setState('count', 1)

      expect(newListener).toHaveBeenCalled()

      unsubscribe()
    })
  })

  describe('插件错误处理', () => {
    it('STORE-073: 插件卸载时抛出错误应该被捕获', () => {
      const errorPlugin = {
        name: 'error-plugin',
        install: () => {
          return () => {
            throw new Error('Plugin uninstall error')
          }
        },
      }

      const store = createStore({ state: { count: 0 } })
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      store.use(errorPlugin)
      store.destroy()

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error uninstalling plugin'), expect.any(Error))

      consoleSpy.mockRestore()
    })
  })

  describe('批量更新', () => {
    it('STORE-074: startBatch/endBatch 应该阻止中间状态通知', () => {
      const store = createStore({ state: { count: 0, name: 'test' } })
      const listener = jest.fn()
      store.subscribe(listener)

      // 开始批量更新
      store.startBatch()

      // 多次 setState
      store.setState('count', 1)
      store.setState('count', 2)
      store.setState('name', 'updated')

      // 批量更新中不应该触发通知
      expect(listener).not.toHaveBeenCalled()

      // 结束批量更新
      store.endBatch()

      // 应该只触发一次通知
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ count: 2, name: 'updated' }))
    })

    it('STORE-075: batch 方法应该自动管理批量更新上下文', () => {
      const store = createStore({ state: { count: 0, name: 'test' } })
      const listener = jest.fn()
      store.subscribe(listener)

      // 使用 batch 方法
      const result = store.batch(() => {
        store.setState('count', 5)
        store.setState('name', 'batched')
        return 'success'
      })

      // 验证返回值
      expect(result).toBe('success')

      // 应该只触发一次通知
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ count: 5, name: 'batched' }))
    })

    it('STORE-076: 嵌套批量更新应该正确处理', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()
      store.subscribe(listener)

      // 嵌套批量更新
      store.startBatch()
      store.setState('count', 1)

      store.startBatch()
      store.setState('count', 2)
      store.endBatch() // 内层结束，不应该触发通知

      expect(listener).not.toHaveBeenCalled()

      store.endBatch() // 外层结束，应该触发通知

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('STORE-077: 多次 endBatch 不应该产生副作用', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()
      store.subscribe(listener)

      store.startBatch()
      store.setState('count', 1)
      store.endBatch()

      expect(listener).toHaveBeenCalledTimes(1)

      // 多余的 endBatch 应该被忽略
      store.endBatch()
      store.endBatch()

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('STORE-078: batch 方法应该正确处理异常', () => {
      const store = createStore({ state: { count: 0 } })
      const listener = jest.fn()
      store.subscribe(listener)

      // batch 中抛出异常
      expect(() => {
        store.batch(() => {
          store.setState('count', 5)
          throw new Error('Test error')
        })
      }).toThrow('Test error')

      // 即使抛出异常，endBatch 也应该被调用（通过 finally）
      // 状态已经被修改为 5，且 endBatch 触发了通知
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith({ count: 5 })

      // 验证批量更新深度已重置（可以再次使用 batch）
      store.batch(() => {
        store.setState('count', 10)
      })

      expect(listener).toHaveBeenCalledTimes(2)
      expect(listener).toHaveBeenLastCalledWith({ count: 10 })
    })
  })

  describe('分支覆盖测试', () => {
    it('STORE-079: constructor 应该使用默认名称当 options.name 未提供', () => {
      const store1 = createStore({ state: { count: 0 } })
      const store2 = createStore({ state: { count: 0 } })

      // 验证自动生成的名称
      expect(store1.name).toMatch(/^store-\d+$/)
      expect(store2.name).toMatch(/^store-\d+$/)
      expect(store1.name).not.toBe(store2.name)
    })

    it('STORE-080: constructor 应该使用提供的 options.name', () => {
      const store = createStore({ state: { count: 0 }, name: 'custom-store' })

      expect(store.name).toBe('custom-store')
    })

    it('STORE-081: _cacheKeySet 应该提供 O(1) 查找性能', () => {
      const store = createStore({
        state: { a: 1, b: 2, c: 3, d: 4, e: 5 },
        enableCache: true,
        cacheKeys: ['a', 'b', 'c'],
      })
      const storeAny = store as any

      // 验证 _cacheManager 存在且 cacheKeys 为 Set 类型
      expect(storeAny._cacheManager).toBeDefined()
      expect(storeAny._cacheManager.cacheKeys).toBeInstanceOf(Set)
      expect(storeAny._cacheManager.cacheKeys.size).toBe(3)

      // 验证 O(1) 查找
      expect(storeAny._cacheManager.cacheKeys.has('a')).toBe(true)
      expect(storeAny._cacheManager.cacheKeys.has('d')).toBe(false)
    })

    it('STORE-082: $patch 应该跳过 undefined 值的缓存更新', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
        enableCache: true,
        cacheKeys: ['count', 'name'],
      }) as any

      // 设置初始值
      store.setState('count', 5)
      store.setState('name', 'initial')

      // 获取缓存统计来验证
      const statsBefore = store.getCacheStats()
      expect(statsBefore.enabled).toBe(true)

      // 使用 $patch 更新，包含 undefined 值
      store.$patch({ count: 10, name: undefined })

      // 验证 count 被更新
      expect(store.getState().count).toBe(10)
      // 验证缓存仍然启用
      const statsAfter = store.getCacheStats()
      expect(statsAfter.enabled).toBe(true)
    })

    it('REGR-STORE-001: $patch 嵌套合并后缓存应写入合并后的值', () => {
      const store = createStore({
        state: { user: { name: 'a', age: 1 } },
        enableCache: true,
        cacheKeys: ['user'],
      }) as any

      store.$patch({ user: { name: 'b' } })

      // 状态：deepMerge 后 { name: 'b', age: 1 }
      expect(store.getState().user).toEqual({ name: 'b', age: 1 })
      // 缓存应写入合并后的状态值，而非 partial 值 { name: 'b' }
      expect(store.getCached('user')).toEqual({ name: 'b', age: 1 })
    })

    it('REGR-STORE-002: getter 拿到的状态应为只读保护代理', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          tryMutate(state: any) {
            // 非 production 模式下保护层对写入抛错
            expect(() => {
              state.count = 1
            }).toThrow()
            return state.count
          },
        },
      })

      expect(store.getter('tryMutate')).toBe(0)
      // 写入被拦截，状态未被修改
      expect(store.getState().count).toBe(0)
    })

    it('STORE-083: $patch 在 dispatch 中不应该立即通知监听器', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          testAction() {
            this.$patch({ count: 5 })
          },
        },
      })

      const listener = jest.fn()
      store.subscribe(listener)

      // 在 action 中调用 $patch
      store.dispatch('testAction')

      // 验证监听器只被调用一次（由 dispatch 后的 _notifyListeners 触发）
      // 而不是两次（dispatch 中的 $patch 不应触发）
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('STORE-084: dispatch 应该处理非 Error 类型的错误', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          throwString() {
            throw 'String error'
          },
          throwObject() {
            throw { message: 'Object error' }
          },
          throwNumber() {
            throw 42
          },
        },
      })

      // 测试抛出字符串 - 验证错误被包装并包含原始错误信息
      let error1: any
      try {
        store.dispatch('throwString')
      } catch (e) {
        error1 = e
      }
      expect(error1).toBeDefined()
      expect(error1.message).toContain('throwString')
      expect(error1.context?.originalError).toBe('String error')

      // 测试抛出对象
      let error2: any
      try {
        store.dispatch('throwObject')
      } catch (e) {
        error2 = e
      }
      expect(error2.context?.originalError).toBe('[object Object]')

      // 测试抛出数字
      let error3: any
      try {
        store.dispatch('throwNumber')
      } catch (e) {
        error3 = e
      }
      expect(error3.context?.originalError).toBe('42')
    })

    it('STORE-085: getter 应该处理非 Error 类型的错误', () => {
      const store = createStore({
        state: { count: 0 },
        getters: {
          throwString() {
            throw 'Getter string error'
          },
          throwObject() {
            throw { message: 'Getter object error' }
          },
          throwNumber() {
            throw 123
          },
        },
      })

      // 测试 getter 抛出字符串
      let error1: any
      try {
        store.getter('throwString')
      } catch (e) {
        error1 = e
      }
      expect(error1).toBeDefined()
      expect(error1.message).toContain('throwString')
      expect(error1.context?.originalError).toBe('Getter string error')

      // 测试 getter 抛出对象
      let error2: any
      try {
        store.getter('throwObject')
      } catch (e) {
        error2 = e
      }
      expect(error2.context?.originalError).toBe('[object Object]')

      // 测试 getter 抛出数字
      let error3: any
      try {
        store.getter('throwNumber')
      } catch (e) {
        error3 = e
      }
      expect(error3.context?.originalError).toBe('123')
    })

    it('STORE-086: subscribe 应该在 listeners 为空时正确处理', () => {
      const store = createStore({ state: { count: 0 } })

      // 添加第一个监听器
      const listener1 = jest.fn()
      const unsubscribe1 = store.subscribe(listener1)

      // 触发状态变化
      store.setState('count', 1)
      expect(listener1).toHaveBeenCalledTimes(1)

      // 测试取消订阅
      unsubscribe1()
      store.setState('count', 2)
      // 监听器不应该再次被调用
      expect(listener1).toHaveBeenCalledTimes(1)
    })

    it('STORE-087: destroy 应该处理插件卸载函数的多种类型', () => {
      const store = createStore({ state: { count: 0 } })
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      // 创建不同类型的卸载函数
      const plugin1 = {
        name: 'valid-plugin',
        install: () => () => {},
      }

      const plugin2 = {
        name: 'null-uninstall-plugin',
        install: () => null,
      }

      const plugin3 = {
        name: 'undefined-uninstall-plugin',
        install: () => undefined,
      }

      const plugin4 = {
        name: 'error-uninstall-plugin',
        install: () => () => {
          throw new Error('Uninstall error')
        },
      }

      // 安装所有插件
      store.use(plugin1)
      store.use(plugin2 as any)
      store.use(plugin3)
      store.use(plugin4)

      // 销毁 store
      store.destroy()

      // 验证错误被捕获
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error uninstalling plugin'), expect.any(Error))

      consoleSpy.mockRestore()
    })

    it('STORE-088: constructor 应该处理空字符串名称', () => {
      // 空字符串是 falsy 值，应该使用默认名称
      const store = createStore({ state: { count: 0 }, name: '' })

      // 空字符串被视为 falsy，应该生成默认名称
      expect(store.name).toMatch(/^store-\d+$/)
    })

    it('STORE-089: use 返回的卸载函数应该处理插件不在列表中的情况', () => {
      const store = createStore({ state: { count: 0 } })

      const plugin = {
        name: 'test-plugin',
        install: () => () => {},
      }

      // 安装插件并获取卸载函数
      const uninstall = store.use(plugin)

      // 从插件列表中手动移除（模拟异常情况）
      const storeAny = store as any
      const originalPlugins = [...storeAny._plugins]
      storeAny._plugins = []

      // 调用卸载函数（此时插件不在列表中）
      expect(() => uninstall()).not.toThrow()

      // 恢复插件列表
      storeAny._plugins = originalPlugins
    })

    it('STORE-090: use 返回的卸载函数应该处理非函数类型的卸载函数', () => {
      const store = createStore({ state: { count: 0 } })

      // 创建返回 null 卸载函数的插件
      const plugin = {
        name: 'null-uninstall-plugin',
        install: () => null,
      }

      // 安装插件
      const uninstall = store.use(plugin as any)

      // 调用卸载函数（此时卸载函数是 null，不是函数）
      expect(() => uninstall()).not.toThrow()

      // 验证插件已从列表移除
      const storeAny = store as any
      expect(storeAny._plugins).not.toContain(plugin)
    })

    it('STORE-091: use 返回的卸载函数应该正确清理映射', () => {
      const store = createStore({ state: { count: 0 } })
      const storeAny = store as any

      const plugin = {
        name: 'test-plugin',
        install: () => () => {},
      }

      // 安装插件
      const uninstall = store.use(plugin)

      // 验证插件在映射中
      expect(storeAny._pluginUninstallFns.has(plugin)).toBe(true)

      // 卸载插件
      uninstall()

      // 验证插件已从映射中移除
      expect(storeAny._pluginUninstallFns.has(plugin)).toBe(false)
    })

    it('STORE-092: subscribe 应该在超过最大订阅者时打印警告', () => {
      // 创建一个最大订阅者为 2 的 store
      const store = createStore({ state: { count: 0 } }) as any
      // 通过内部管理器设置最大订阅者
      store._subscriptionManager = new (require('@/core/store/SubscriptionManager').SubscriptionManager)({
        storeName: store.name,
        maxSubscribers: 2,
      })

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      // 添加两个监听器
      const listener1 = jest.fn()
      const listener2 = jest.fn()
      store.subscribe(listener1)
      store.subscribe(listener2)

      // 添加第三个监听器应该触发警告
      const listener3 = jest.fn()
      store.subscribe(listener3)

      // 验证警告被打印
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('STORE-093: plugin.install 可能返回 undefined', () => {
      const store = createStore({ state: { count: 0 } })
      const storeAny = store as any

      // 创建不返回任何值的插件
      const plugin = {
        name: 'no-return-plugin',
        install: () => {
          // 不返回任何东西（隐式返回 undefined）
        },
      }

      // 安装插件
      const uninstall = store.use(plugin)

      // 验证插件被添加
      expect(storeAny._plugins).toContain(plugin)

      // 验证卸载函数在映射中是 undefined
      expect(storeAny._pluginUninstallFns.get(plugin)).toBeUndefined()

      // 卸载应该正常执行
      expect(() => uninstall()).not.toThrow()
    })

    it('STORE-094: subscribe 应该正确处理订阅者数量达到上限的情况', () => {
      const store = createStore({ state: { count: 0 } }) as any
      // 通过内部管理器设置最大订阅者
      store._subscriptionManager = new (require('@/core/store/SubscriptionManager').SubscriptionManager)({
        storeName: store.name,
        maxSubscribers: 1,
      })

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      // 添加第一个监听器
      const listener1 = jest.fn()
      store.subscribe(listener1)

      // 添加第二个监听器应该触发警告并移除第一个
      const listener2 = jest.fn()
      store.subscribe(listener2)

      // 验证警告被打印
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('STORE-095: constructor 直接调用测试覆盖声明行', () => {
      // 直接访问 Store 类并实例化，不使用 createStore 辅助函数
      const { Store } = require('@/core/store')

      // 不传递任何参数（使用默认值）
      const store = new Store()

      // 验证 store 被正确创建
      expect(store).toBeDefined()
      expect(store.name).toMatch(/^store-\d+$/)
      expect(store.getState()).toEqual({})
    })
  })

  // ==================== 状态保护和缓存功能测试已迁移到独立测试文件 ====================
  // 状态保护功能测试请参见: tests/unit/store/state-protection.test.ts
  // 状态代理模块测试请参见: tests/unit/store/modules/StateProxy.test.ts
  // 缓存功能测试请参见: tests/unit/store/cache.test.ts
  // 缓存模块测试请参见: tests/unit/store/modules/StoreCache.test.ts

  describe('覆盖率补全 - destroy 后方法调用', () => {
    it('STORE-COV-001: destroy后调用$patch应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()
      expect(() => store.$patch({ count: 1 })).toThrow('[GeomStore] Cannot call $patch on a destroyed Store')
    })

    it('STORE-COV-002: destroy后调用$replaceState应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()
      expect(() => store.$replaceState({ count: 1 } as any)).toThrow('[GeomStore] Cannot call $replaceState on a destroyed Store')
    })

    it('STORE-COV-003: destroy后调用$snapshot应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()
      expect(() => store.$snapshot()).toThrow('[GeomStore] Cannot call $snapshot on a destroyed Store')
    })

    it('STORE-COV-004: destroy后调用$restore应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()
      expect(() => store.$restore({} as any)).toThrow('[GeomStore] Cannot call $restore on a destroyed Store')
    })

    it('STORE-COV-005: destroy后调用dispatch应该抛出错误', () => {
      const store = createStore({ state: { count: 0 }, actions: { foo() {} } })
      store.destroy()
      expect(() => store.dispatch('foo')).toThrow('[GeomStore] Cannot call dispatch on a destroyed Store')
    })

    it('STORE-COV-006: destroy后调用getter应该抛出错误', () => {
      const store = createStore({ state: { count: 0 }, getters: { foo: () => 1 } })
      store.destroy()
      expect(() => store.getter('foo')).toThrow('[GeomStore] Cannot call getter on a destroyed Store')
    })

    it('STORE-COV-007: destroy后调用getGetterNames应该返回空数组', () => {
      const store = createStore({
        state: { count: 0 },
        getters: { double: (s: any) => s.count * 2 },
      })
      expect(store.getGetterNames()).toEqual(['double'])
      store.destroy()
      expect(store.getGetterNames()).toEqual([])
    })

    it('STORE-COV-008: destroy后调用subscribe应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()
      expect(() => store.subscribe(() => {})).toThrow('[GeomStore] Cannot call subscribe on a destroyed Store')
    })

    it('STORE-COV-009: destroy后调用use应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()
      expect(() => store.use({ name: 'p', install: () => {} } as any)).toThrow('[GeomStore] Cannot call use on a destroyed Store')
    })

    it('STORE-COV-010: destroy后调用getCached应该抛出错误', () => {
      const store = createStore({ state: { count: 0 }, enableCache: true })
      store.destroy()
      expect(() => store.getCached('count')).toThrow('[GeomStore] Cannot call getCached on a destroyed Store')
    })

    it('STORE-COV-011: destroy后调用enableCache应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()
      expect(() => store.enableCache()).toThrow('[GeomStore] Cannot call enableCache on a destroyed Store')
    })

    it('STORE-COV-012: destroy后调用disableCache应该抛出错误', () => {
      const store = createStore({ state: { count: 0 }, enableCache: true })
      store.destroy()
      expect(() => store.disableCache()).toThrow('[GeomStore] Cannot call disableCache on a destroyed Store')
    })

    it('STORE-COV-013: destroy后调用invalidateCache应该抛出错误', () => {
      const store = createStore({ state: { count: 0 }, enableCache: true })
      store.destroy()
      expect(() => store.invalidateCache('count')).toThrow('[GeomStore] Cannot call invalidateCache on a destroyed Store')
    })

    it('STORE-COV-014: destroy后调用startBatch应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()
      expect(() => store.startBatch()).toThrow('[GeomStore] Cannot call startBatch on a destroyed Store')
    })

    it('STORE-COV-015: destroy后调用endBatch应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()
      expect(() => store.endBatch()).toThrow('[GeomStore] Cannot call endBatch on a destroyed Store')
    })

    it('STORE-COV-016: destroy后调用batch应该抛出错误', () => {
      const store = createStore({ state: { count: 0 } })
      store.destroy()
      expect(() => store.batch(() => {})).toThrow('[GeomStore] Cannot call batch on a destroyed Store')
    })

    it('STORE-COV-017: destroyed getter应该返回正确值', () => {
      const store = createStore({ state: { count: 0 } })
      expect(store.destroyed).toBe(false)
      store.destroy()
      expect(store.destroyed).toBe(true)
    })

    it('STORE-COV-018: getCacheStats在destroy后仍然可用', () => {
      const store = createStore({ state: { count: 0 }, enableCache: true })
      store.destroy()
      expect(() => store.getCacheStats()).not.toThrow()
    })
  })

  describe('覆盖率补全 - setState key 校验', () => {
    it('STORE-COV-019: setState传入null key应该抛出TypeError', () => {
      const store = createStore({ state: { count: 0 } })
      expect(() => store.setState(null as any, 1)).toThrow(TypeError)
      expect(() => store.setState(null as any, 1)).toThrow('key must not be null or undefined')
    })

    it('STORE-COV-020: setState传入undefined key应该抛出TypeError', () => {
      const store = createStore({ state: { count: 0 } })
      expect(() => store.setState(undefined as any, 1)).toThrow(TypeError)
      expect(() => store.setState(undefined as any, 1)).toThrow('key must not be null or undefined')
    })
  })

  describe('覆盖率补全 - $replaceState 类型检查', () => {
    it('STORE-COV-021: $replaceState传入数组应该抛出TypeError', () => {
      const store = createStore({ state: { count: 0 } })
      expect(() => store.$replaceState([1, 2, 3] as any)).toThrow(TypeError)
      expect(() => store.$replaceState([1, 2, 3] as any)).toThrow('must be a plain object')
    })

    it('STORE-COV-022: $replaceState传入null应该抛出TypeError', () => {
      const store = createStore({ state: { count: 0 } })
      expect(() => store.$replaceState(null as any)).toThrow(TypeError)
    })

    it('STORE-COV-023: $replaceState在缓存启用时正确清理和重建缓存', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
        enableCache: true,
        cacheKeys: ['count', 'name'],
      })
      // 建立缓存
      store.getCached('count')
      expect(store.getCacheStats().size).toBeGreaterThan(0)
      // 替换状态（会清理旧缓存、重建新缓存）
      store.$replaceState({ count: 10, name: 'new' })
      expect(store.getState().count).toBe(10)
      expect(store.getState().name).toBe('new')
    })
  })

  describe('覆盖率补全 - destroy 异常处理', () => {
    it('STORE-COV-024: destroy过程中抛出异常应该被捕获且仍标记为已销毁', () => {
      const store = createStore({ state: { count: 0 } })
      const storeAny = store as any

      // 让 _subscriptionManager.clear 抛出异常
      storeAny._subscriptionManager.clear = () => {
        throw new Error('Clear error')
      }

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      store.destroy()

      // 即使出错也标记为已销毁
      expect(store.destroyed).toBe(true)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Error during Store destruction'), expect.any(Error))

      consoleSpy.mockRestore()
    })
  })

  describe('覆盖率补全 - setStateProtection 禁用分支', () => {
    it('STORE-COV-025: setStateProtection(false)应该重建proxy管理器', () => {
      const store = createStore({ state: { count: 0 } })
      // 默认启用
      expect(store.isStateProtectionEnabled()).toBe(true)

      // 禁用状态保护
      store.setStateProtection(false)
      expect(store.isStateProtectionEnabled()).toBe(false)

      // 验证 state 返回原始对象（非 Proxy）
      const state = store.state
      expect(state).toEqual({ count: 0 })

      // 重新启用
      store.setStateProtection(true)
      expect(store.isStateProtectionEnabled()).toBe(true)
    })

    it('STORE-COV-026: getStateProtectionConfig应该返回配置副本', () => {
      const store = createStore({
        state: { count: 0 },
        stateProtection: { enabled: true, deep: false, productionHandler: 'error' },
      })
      const config = store.getStateProtectionConfig()
      expect(config.enabled).toBe(true)
      expect(config.deep).toBe(false)
      expect(config.productionHandler).toBe('error')
    })
  })

  describe('覆盖率补全 - action中调用dispatch', () => {
    it('STORE-COV-027: action内部调用dispatch另一个action', () => {
      const store = createStore({
        state: { count: 0, total: 0 },
        actions: {
          increment(..._args: unknown[]) {
            (this.state as any).count++
          },
          incrementAndSum(..._args: unknown[]) {
            this.dispatch('increment')
            ;(this.state as any).total = (this.state as any).count * 10
          },
        },
      })

      store.dispatch('incrementAndSum')
      expect(store.getState().count).toBe(1)
      expect(store.getState().total).toBe(10)
    })
  })

  describe('覆盖率补全 - $patch 类型校验', () => {
    it('STORE-COV-028: $patch传入null应该抛出TypeError', () => {
      const store = createStore({ state: { count: 0 } })
      expect(() => store.$patch(null as any)).toThrow(TypeError)
    })

    it('STORE-COV-029: $patch传入原始类型应该抛出TypeError', () => {
      const store = createStore({ state: { count: 0 } })
      expect(() => store.$patch('string' as any)).toThrow(TypeError)
      expect(() => store.$patch(123 as any)).toThrow(TypeError)
    })
  })

  describe('覆盖率补全 - $replaceState 后访问 state 触发 proxy', () => {
    it('STORE-COV-030: $replaceState后访问store.state应该触发新proxy管理器的isInternalAccess', () => {
      const store = createStore({
        state: { count: 0, name: 'test' },
        stateProtection: { enabled: true, deep: true },
      })

      // 先访问 state 建立 proxy
      const state1 = store.state
      expect(state1.count).toBe(0)

      // 替换状态后访问 state，触发新 proxy 管理器
      store.$replaceState({ count: 10, name: 'new' })
      const state2 = store.state
      expect(state2.count).toBe(10)
      expect(state2.name).toBe('new')

      // 尝试通过 proxy 修改状态，触发 set 拦截器中的 isInternalAccess
      // 在开发模式下，直接修改 state 会抛出错误
      expect(() => {
        (state2 as any).count = 999
      }).toThrow('prohibited')
    })
  })

  describe('覆盖率补全 - setStateProtection 重新启用后访问 state', () => {
    it('STORE-COV-031: 禁用后重新启用状态保护应该触发新proxy管理器的isInternalAccess', () => {
      const store = createStore({
        state: { count: 0 },
        stateProtection: { enabled: true, deep: true },
      })

      // 先访问 state
      const s1 = store.state
      expect(s1.count).toBe(0)

      // 禁用状态保护
      store.setStateProtection(false)

      // 重新启用状态保护
      store.setStateProtection(true)

      // 访问 state 触发新 proxy 管理器的 isInternalAccess
      const s2 = store.state
      expect(s2.count).toBe(0)

      // 修改状态后再次访问
      store.setState('count', 5)
      const s3 = store.state
      expect(s3.count).toBe(5)

      // 尝试通过 proxy 修改状态，触发 set 拦截器中的 isInternalAccess
      // 在开发模式下，直接修改 state 会抛出错误
      expect(() => {
        (s3 as any).count = 999
      }).toThrow('prohibited')
    })
  })

  // ==================== BUG 修复回归测试 ====================
  describe('BUG 回归：异步 action 通知与嵌套 dispatch', () => {
    it('BUG: 异步 action 在 await 后直接变异状态应触发通知（默认模式）', async () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          async load(this: any) {
            await Promise.resolve()
            // 默认模式 action 上下文拿到的是裸状态：异步续段中的直接写入
            // 修复前既不通知也不刷新缓存
            this.state.count = 42
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      await store.dispatch('load')

      expect(store.getState().count).toBe(42)
      // 通知统一延迟到 Promise 完成时补发（同步段不单独通知，避免三重通知）
      expect(listener).toHaveBeenCalledTimes(1)
      expect((listener.mock.calls[0][0] as { count: number }).count).toBe(42)
    })

    it('BUG: onlyOnChange 模式下异步 action 应按变更计数精确补发通知', async () => {
      const store = createStore({
        state: { count: 0 },
        notify: { onlyOnChange: true },
        actions: {
          async load(this: any) {
            await Promise.resolve()
            // 脏跟踪代理递增变更计数
            this.state.count = 42
          },
          async untouched(this: any) {
            await Promise.resolve()
            // 不修改任何状态
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      await store.dispatch('untouched')
      expect(listener).not.toHaveBeenCalled()

      await store.dispatch('load')
      expect(listener).toHaveBeenCalledTimes(1)
      expect((listener.mock.calls[0][0] as { count: number }).count).toBe(42)
    })

    it('BUG: 嵌套 dispatch 内层结束不应提前通知中间状态', () => {
      const received: number[] = []
      const store = createStore({
        state: { count: 0 },
        actions: {
          inner(this: any) {
            this.setState('count', this.state.count + 1)
          },
          outer(this: any) {
            this.dispatch('inner')
            this.setState('count', this.state.count + 1)
          },
        },
      })
      store.subscribe((state) => received.push((state as { count: number }).count))

      store.dispatch('outer')

      expect(store.getState().count).toBe(2)
      // 修复前内层 action 结束即通知中间态（count=1），破坏批量语义
      expect(received).toEqual([2])
    })
  })

  describe('BUG 回归：原型链属性', () => {
    it('BUG: action 上下文的原型方法应可用', () => {
      const store = createStore({
        state: { count: 0 },
        actions: {
          probe(this: unknown) {
            // 修复前 'toString' in boundActions 命中原型链，返回 undefined
            return typeof (this as { toString?: unknown }).toString
          },
        },
      })

      expect(store.dispatch('probe')).toBe('function')
    })

    it('BUG: dispatch 原型链属性名应报 ACTION_NOT_FOUND 而非 TypeError', () => {
      const store = createStore({
        state: { count: 0 },
        actions: { increment: () => undefined },
      })

      expect(() => store.dispatch('toString')).toThrow('Action "toString" not found')
    })

    it('BUG: getter 原型链属性名应报 SELECTOR_NOT_FOUND 而非静默返回继承方法结果', () => {
      const store = createStore({
        state: { count: 1 },
        getters: {
          double: (state: { count: number }) => state.count * 2,
        },
      })

      // 修复前 getter('toString') 会调用 Object.prototype.toString 并返回错误结果
      expect(() => store.getter('toString')).toThrow('Getter "toString" not found')
    })
  })
})

  // ==================== BUG 回归：失败路径的状态变更通知 ====================
  describe('BUG 回归：action 失败路径的状态变更通知', () => {
    it('同步 action 抛错前已写入的状态应通知监听器', () => {
      const store = createStore({
        state: { loading: false },
        actions: {
          fail(this: { setState: (k: 'loading', v: boolean) => void }) {
            this.setState('loading', true)
            throw new Error('boom')
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      expect(() => store.dispatch('fail')).toThrow()

      // 修复前：失败路径不通知，监听器永远看不到 loading=true 的中间状态
      expect(listener).toHaveBeenCalledTimes(1)
      expect((listener.mock.calls[0][0] as { loading: boolean }).loading).toBe(true)
    })

    it('异步 action 拒绝前已写入的状态应通知监听器', async () => {
      const store = createStore({
        state: { loading: false },
        actions: {
          async fail(this: { setState: (k: 'loading', v: boolean) => void }) {
            this.setState('loading', true)
            await Promise.resolve()
            throw new Error('boom')
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      await expect(store.dispatch('fail')).rejects.toThrow('boom')

      const lastState = listener.mock.calls[listener.mock.calls.length - 1][0] as { loading: boolean }
      expect(lastState.loading).toBe(true)
    })

    it('onlyOnChange 模式下 action 内 defineProperty 变更也应触发通知', () => {
      const store = createStore({
        state: { count: 0 },
        notify: { onlyOnChange: true },
        actions: {
          mutate(this: { state: Record<string, unknown> }) {
            Object.defineProperty(this.state, 'count', { value: 7, writable: true, enumerable: true, configurable: true })
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      store.dispatch('mutate')

      expect(store.getState().count).toBe(7)
      // 修复前：脏跟踪代理缺 defineProperty 陷阱，计数不增长 → 不通知
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  // ==================== BUG 回归：订阅判重 ====================
  describe('BUG 回归：重复订阅不应驱逐无辜监听器', () => {
    it('已达上限时重复订阅已有监听器不驱逐无辜监听器（#14 引用计数语义）', () => {
      const store = createStore({
        name: 'dedupe-store',
        state: { v: 0 },
        subscription: { maxSubscribers: 2 },
      })
      const listenerA = jest.fn()
      const listenerB = jest.fn()
      store.subscribe(listenerA)
      store.subscribe(listenerB)

      // 修复前会先驱逐 A（最旧）再对 B 做 no-op add，A 静默丢失；
      // 现在重复订阅 B 仅递增计数，A 不受影响，B 按两份注册收到两次回调
      store.subscribe(listenerB)
      store.setState('v', 1)

      expect(listenerA).toHaveBeenCalledTimes(1)
      expect(listenerB).toHaveBeenCalledTimes(2)
    })

    it('onlyOnChange 模式下无变更的 batch 结束不应通知', async () => {
      const store = createStore({
        name: 'batch-silent-store',
        state: { v: 0 },
        notify: { onlyOnChange: true },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      store.batch(() => {
        // 批量期间无任何状态变更
      })
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(listener).not.toHaveBeenCalled()
    })
  })

  // ==================== 本轮修复回归：通知去重与 batch 语义 ====================
  describe('BUG 回归：通知去重与 batch 语义', () => {
    it('onlyOnChange 模式下异步续段 setState 不再重复通知', async () => {
      const store = createStore({
        state: { v: 0 },
        notify: { onlyOnChange: true },
        actions: {
          async save(this: { setState: (k: 'v', val: number) => void }) {
            await Promise.resolve()
            this.setState('v', 1) // 续段 setState：自身已通知
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      await store.dispatch('save')

      // 修复前：setState 自发通知 1 次 + 完成补发 1 次（计数已超过 syncEnd 基线）
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('batch() 记录基线：此前有历史变更时空 batch 也不通知（onlyOnChange）', () => {
      const store = createStore({
        state: { v: 0 },
        notify: { onlyOnChange: true },
      })
      store.setState('v', 1) // 历史变更使计数 > 0
      const listener = jest.fn()
      store.subscribe(listener)

      store.batch(() => {
        // 无任何变更
      })

      // 修复前：batch() 绕过 startBatch 的基线记录，用陈旧基线 0 判定有变更而误通知
      expect(listener).not.toHaveBeenCalled()
    })

    it('同步 dispatch 在 batch 中不中途通知，由 batch 收尾统一通知', () => {
      const store = createStore({
        state: { v: 0 },
        actions: {
          set(this: { setState: (k: 'v', val: number) => void }) {
            this.setState('v', 5)
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      store.batch(() => {
        store.dispatch('set')
        // 修复前：dispatch 收尾在 batch 中途立即通知一次
        expect(listener).not.toHaveBeenCalled()
      })

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('batch 中的 action 抛错不在中途泄漏通知', () => {
      const store = createStore({
        state: { v: 0 },
        actions: {
          fail(this: { setState: (k: 'v', val: number) => void }) {
            this.setState('v', 9)
            throw new Error('boom')
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      expect(() =>
        store.batch(() => {
          expect(() => store.dispatch('fail')).toThrow()
          expect(listener).not.toHaveBeenCalled()
        }),
      ).not.toThrow()

      // batch 收尾统一通知（默认模式收尾必通知）
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  // ==================== P0 回归：脏跟踪代理内建对象豁免 ====================
  describe('BUG 回归：onlyOnChange 脏跟踪代理不包装内建对象', () => {
    it('action 内读取 Date/Map/Set 状态不应崩溃', () => {
      const store = createStore({
        name: 'dirty-builtin-store',
        state: {
          when: new Date(1000) as unknown as object,
          tags: new Map([['a', 1]]) as unknown as object,
        },
        notify: { onlyOnChange: true },
        actions: {
          readBuiltins(this: { state: { when: Date; tags: Map<string, number> } }) {
            // 修复前：Date/Map 被脏代理包装，getTime/get 以 Proxy 为 receiver
            // 抛 "this is not a Date/Map object"
            return this.state.when.getTime() + (this.state.tags.get('a') ?? 0)
          },
        },
      })

      expect(store.dispatch('readBuiltins')).toBe(1001)
      store.destroy()
    })

    it('内建对象豁免不影响普通嵌套对象的变更计数通知', () => {
      const store = createStore({
        name: 'dirty-builtin-mixed',
        state: {
          nested: { v: 0 },
          when: new Date(0) as unknown as object,
        },
        notify: { onlyOnChange: true },
        actions: {
          bump(this: { state: { nested: { v: number } } }) {
            this.state.nested.v++
          },
        },
      })
      const listener = jest.fn()
      store.subscribe(listener)

      store.dispatch('bump')

      expect(listener).toHaveBeenCalledTimes(1)
      store.destroy()
    })
  })

    it('异步 action 失败也应触发 onError 钩子（P1 回归）', async () => {
      const store = createStore({
        name: 'async-onerror-store',
        state: { v: 0 },
        actions: {
          async fail() {
            await Promise.resolve()
            throw new Error('network down')
          },
        },
      })
      const onError = jest.fn()
      store.hooks.on('onError', onError)

      // reject 是 action 最常见的失败形态，监控插件对其不可失明
      await expect(store.dispatch('fail')).rejects.toThrow('network down')
      expect(onError).toHaveBeenCalledTimes(1)
      expect((onError.mock.calls[0][0] as Error).message).toBe('network down')
      store.destroy()
    })

// ==================== P2 store 批修复回归（#11/#12/#16） ====================
describe('P2 修复回归：batch/dispatch 守卫与插件回滚', () => {
  it('STORE-055 (#11): action 体内使用 batch 不应提前通知中间态', () => {
    // 自引用：action 体内需访问尚未创建完成的 store；batch 不在 action 上下文
    // （contextBase）上，必须经外层持有器引用 store 实例（声明与赋值分离，let 为必需）
    // eslint-disable-next-line prefer-const
    let storeRef!: { batch: (fn: () => void) => void; setState: (key: 'v', value: number) => void }
    const store = createStore({
      name: 'batch-in-dispatch-store',
      state: { v: 0 },
      actions: {
        step() {
          // dispatch 进行中开启批：批收尾必须被守卫跳过，由 dispatch 收尾统一通知
          storeRef.batch(() => {
            storeRef.setState('v', 1)
          })
          storeRef.setState('v', 2)
        },
      },
    })
    storeRef = store
    const listener = jest.fn()
    store.subscribe(listener)

    store.dispatch('step')

    expect(store.state.v).toBe(2)
    // 修复前：批收尾在 dispatch 进行中就通知 v=1，dispatch 收尾再通知 v=2 → 两次回调且泄漏中间态
    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0][0] as { v: number }).v).toBe(2)
    store.destroy()
  })

  it('STORE-056 (#12): batch 收到异步回调时开发模式应告警', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createStore({ name: 'async-batch-warn-store', state: { v: 0 } })

    const result = store.batch(async () => {
      await Promise.resolve()
      return 'done'
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('batch() 收到异步回调：批保护仅覆盖同步段'),
    )
    expect(await result).toBe('done')

    warnSpy.mockRestore()
    store.destroy()
  })

  it('STORE-057 (#16): 插件安装失败应回滚入列并上抛错误', () => {
    const store = createStore({ name: 'plugin-rollback-store', state: { v: 1 } })
    const badPlugin = {
      name: 'bad-plugin',
      install: () => {
        throw new Error('install boom')
      },
    }

    expect(() => store.use(badPlugin)).toThrow('install boom')
    // 半安装插件不得常驻列表，否则重试 use() 会累积重复条目
    expect((store as unknown as { _plugins: unknown[] })._plugins).toHaveLength(0)

    const goodPlugin = { name: 'good-plugin', install: jest.fn() }
    store.use(goodPlugin)
    expect((store as unknown as { _plugins: unknown[] })._plugins).toEqual([goodPlugin])
    store.destroy()
  })
})
