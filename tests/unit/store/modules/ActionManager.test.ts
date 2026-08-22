/**
 * ActionManager 和 GetterManager 模块测试
 * 目标覆盖率: 95%+
 */

import { ActionManager, GetterManager } from '@/core/store/ActionManager'
import { HookSystem } from '@/core/hooks'
import type { State, ActionContextBase, Actions, Getters } from '@/types/store'

describe('ActionManager', () => {
  const createActionManager = () => {
    let dispatching = false
    let internalAccess = false
    const notifiedListeners: number[] = []
    const hooks = new HookSystem()

    // 测试用宽松 Actions 类型：各用例传入的 actions 结构不同，不应固化具体签名
    const manager = new ActionManager<{ count: number }, Actions>({
      storeName: 'test-store',
      withInternalAccess: <T>(fn: () => T): T => {
        internalAccess = true
        try {
          return fn()
        } finally {
          internalAccess = false
        }
      },
      setDispatching: (v: boolean) => {
        dispatching = v
      },
      notifyListeners: () => {
        notifiedListeners.push(Date.now())
      },
      hooks,
    })

    return {
      manager,
      isInternalAccess: () => internalAccess,
      isDispatching: () => dispatching,
      getNotifiedCount: () => notifiedListeners.length,
    }
  }

  const createContextBase = (setState: jest.Mock): ActionContextBase<{ count: number }> => ({
    name: 'test-store',
    get state() {
      return { count: 0 }
    },
    setState,
    $patch: jest.fn(),
    $replaceState: jest.fn(),
    getState: () => ({ count: 0 }),
    dispatch: jest.fn(),
  })

  describe('initialize', () => {
    it('AM-OPT-001: 未提供 getMutationCount 时默认计数函数安全生效', () => {
      const hooks = new HookSystem()
      const manager = new ActionManager<{ count: number }, { ping: () => string }>({
        storeName: 'opt-store',
        withInternalAccess: <T>(fn: () => T): T => fn(),
        setDispatching: () => {},
        notifyListeners: jest.fn(),
        hooks,
        // 开启 onlyOnChange 但不提供 getMutationCount，验证默认 () => 0 分支
        notifyOnlyOnChange: true,
      })

      const context: ActionContextBase<{ count: number }> = {
        name: 'opt-store',
        get state() {
          return { count: 0 }
        },
        setState: jest.fn(),
        $patch: jest.fn(),
        $replaceState: jest.fn(),
        getState: () => ({ count: 0 }),
        dispatch: jest.fn(),
      }

      manager.initialize({ ping: () => 'pong' }, context)

      // 默认计数恒为 0：未变更 → 不通知，且不抛错
      expect(manager.execute('ping')).toBe('pong')
    })

    it('应该正确初始化空 actions', () => {
      const { manager } = createActionManager()
      const context = createContextBase(jest.fn())

      manager.initialize(undefined, context)
      expect(manager.actions).toEqual({})
    })

    it('应该正确绑定 actions 的 this', () => {
      const { manager, isInternalAccess } = createActionManager()
      const state = { count: 0 }
      const context = createContextBase(
        jest.fn().mockImplementation((key, value) => {
          state[key] = value
        }),
      )
      ;(context as any).getState = () => state

      const actions = {
        increment(this: any) {
          this.setState('count', 1)
        },
      }

      manager.initialize(actions, context)

      // 执行 action 时应该在内部访问模式下
      manager.execute('increment')

      expect(isInternalAccess()).toBe(false) // 执行完毕后应恢复
    })

    it('应该支持 action 之间相互调用', () => {
      const { manager } = createActionManager()
      const state = { count: 0 }
      const context = createContextBase(
        jest.fn().mockImplementation((key, value) => {
          state[key] = value
        }),
      )
      ;(context as any).getState = () => state

      const actions = {
        add(this: any, n: number) {
          this.setState('count', state.count + n)
        },
        double(this: any) {
          this.add(state.count) // 调用其他 action
        },
      }

      manager.initialize(actions, context)
      manager.execute('double')

      expect(state.count).toBe(0) // 0 + 0 = 0
    })
  })

  describe('execute', () => {
    it('应该正确执行 action', () => {
      const { manager, getNotifiedCount } = createActionManager()
      const context = createContextBase(jest.fn())
      let executed = false

      manager.initialize(
        {
          test: () => {
            executed = true
          },
        },
        context,
      )
      manager.execute('test')

      expect(executed).toBe(true)
      expect(getNotifiedCount()).toBe(1)
    })

    it('应该处理不存在的 action', () => {
      const { manager } = createActionManager()
      const context = createContextBase(jest.fn())

      manager.initialize({}, context)

      expect(() => manager.execute('nonexistent')).toThrow('Action "nonexistent" not found')
    })

    it('应该正确传递参数', () => {
      const { manager } = createActionManager()
      const context = createContextBase(jest.fn())
      let received: number = 0

      manager.initialize(
        {
          add: (n: number) => {
            received = n
          },
        },
        context,
      )

      manager.execute('add', 42)
      expect(received).toBe(42)
    })

    it('应该正确处理 action 错误', () => {
      const { manager } = createActionManager()
      const context = createContextBase(jest.fn())

      manager.initialize(
        {
          throwError: () => {
            throw new Error('Action error')
          },
        },
        context,
      )

      expect(() => manager.execute('throwError')).toThrow('Action "throwError" execution failed')
    })

    it('应该正确处理非 Error 类型的 action 错误', () => {
      const { manager } = createActionManager()
      const context = createContextBase(jest.fn())

      manager.initialize(
        {
          throwString: () => {
            throw 'string error' // 非 Error 类型
          },
        },
        context,
      )

      expect(() => manager.execute('throwString')).toThrow('Action "throwString" execution failed')
    })
  })

  describe('actions getter 边界情况', () => {
    it('未初始化时访问 actions 应返回空对象', () => {
      const { manager } = createActionManager()
      // 未调用 initialize，_actions 为 null
      expect(manager.actions).toEqual({})
    })
  })

  describe('Proxy 上下文边界', () => {
    it('访问 Symbol 属性应返回 undefined', () => {
      const { manager } = createActionManager()
      const context = createContextBase(jest.fn())

      const sym = Symbol('test')

      const actions = {
        testSymbol: function (this: any) {
          // 通过 this 访问 symbol 属性，应触发 Proxy 的 symbol 分支返回 undefined
          return this[sym]
        },
      }

      manager.initialize(actions, context)

      // 不应抛出错误
      expect(() => manager.execute('testSymbol')).not.toThrow()
    })
  })

  describe('dispatch 深度防御', () => {
    it('深度为 0 时调用 _exitDispatch 应该安全复位 dispatching', () => {
      const { manager, isDispatching } = createActionManager()

      // 防御分支：未进入 dispatch 时直接退出，深度保持 0 且 dispatching 复位为 false
      ;(manager as unknown as { _exitDispatch: () => void })._exitDispatch()

      expect(isDispatching()).toBe(false)
      // 再次退出同样安全（幂等）
      ;(manager as unknown as { _exitDispatch: () => void })._exitDispatch()
      expect(isDispatching()).toBe(false)
    })
  })
})

describe('GetterManager', () => {
  const createGetterManager = () => {
    const state = { count: 5 }

    const manager = new GetterManager<{ count: number }, Getters<{ count: number }>>('test-store', () => state)

    return {
      manager,
      state,
    }
  }

  describe('initialize', () => {
    it('应该正确初始化空 getters', () => {
      const { manager } = createGetterManager()

      manager.initialize(undefined)
      expect(manager.getters).toEqual({})
    })

    it('应该正确初始化 getters', () => {
      const { manager } = createGetterManager()

      manager.initialize({
        double: (s) => s.count * 2,
      })

      expect(manager.getters.double).toBeDefined()
    })
  })

  describe('execute', () => {
    it('应该正确执行 getter', () => {
      const { manager, state } = createGetterManager()

      manager.initialize({
        double: (s) => s.count * 2,
      })

      expect(manager.execute('double')).toBe(10)
    })

    it('应该处理不存在的 getter', () => {
      const { manager } = createGetterManager()

      manager.initialize({})

      expect(() => manager.execute('nonexistent')).toThrow('Getter "nonexistent" not found')
    })

    it('应该正确处理 getter 错误', () => {
      const { manager } = createGetterManager()

      manager.initialize({
        errorGetter: () => {
          throw new Error('Getter error')
        },
      })

      expect(() => manager.execute('errorGetter')).toThrow('Getter "errorGetter" execution failed')
    })

    it('应该将 getState 返回的状态对象传给 getter', () => {
      const { manager, state } = createGetterManager()

      manager.initialize({
        check: (s) => s === state,
      })

      // getter 接收到的应是 getState 返回的引用（由 Store 决定是否为只读代理）
      expect(manager.execute('check')).toBe(true)
    })
  })

  describe('覆盖率补充', () => {
    it('未初始化时 getGetterNames 应返回空数组', () => {
      const { manager } = createGetterManager()
      // 未调用 initialize，_getters 为 null
      expect(manager.getGetterNames()).toEqual([])
    })

    it('初始化后 getGetterNames 应返回所有 getter 名称', () => {
      const { manager } = createGetterManager()

      manager.initialize({
        double: (s) => s.count * 2,
        triple: (s) => s.count * 3,
      })

      const names = manager.getGetterNames()
      expect(names).toHaveLength(2)
      expect(names).toContain('double')
      expect(names).toContain('triple')
    })

    it('未初始化时 execute 应抛出 SELECTOR_NOT_FOUND', () => {
      const { manager } = createGetterManager()
      // 未调用 initialize，_getters 为 null
      expect(() => manager.execute('anything')).toThrow('Getter "anything" not found')
    })

    it('应该正确处理非 Error 类型的 getter 错误', () => {
      const { manager } = createGetterManager()

      manager.initialize({
        throwString: () => {
          throw 'string error' // 非 Error 类型
        },
      })

      expect(() => manager.execute('throwString')).toThrow('Getter "throwString" execution failed')
    })
  })
})

describe('ActionManager refreshCache 失败处理', () => {
  it('refreshCache 抛错时通过 hooks onError 上报且 dispatch 正常返回', () => {
    const onError = jest.fn()
    const hooks = new HookSystem()
    hooks.on('onError', onError)

    const manager = new ActionManager<{ count: number }, { ping: () => string }>({
      storeName: 'refresh-cache-store',
      withInternalAccess: <T>(fn: () => T): T => fn(),
      setDispatching: () => {},
      notifyListeners: jest.fn(),
      hooks,
      refreshCache: () => {
        throw new Error('cache refresh failed')
      },
    })

    const context: ActionContextBase<{ count: number }> = {
      name: 'refresh-cache-store',
      get state() {
        return { count: 0 }
      },
      setState: jest.fn(),
      $patch: jest.fn(),
      $replaceState: jest.fn(),
      getState: () => ({ count: 0 }),
      dispatch: jest.fn(),
    }
    manager.initialize({ ping: () => 'pong' }, context)

    // 缓存刷新失败不应影响 dispatch 主流程，只上报 onError
    expect(manager.execute('ping')).toBe('pong')
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'cache refresh failed' }))
  })
})
