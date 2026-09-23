/**
 * 第五轮 core-store-p1 分片：ActionManager 的上报归口与 action 表容器
 *
 * R5-108：`_safeRefreshCache` / 异步拒绝分支上的裸 `emit('onError')` 会让「上报动作本身」
 * 顶掉上游错误并吞掉补发通知；R5-110：以任意 action 名为键的普通对象字面量会被
 * `__proto__` 命中继承来的 setter。
 */
import { ActionManager } from '@/core/store/ActionManager.js'
import { createStore } from '@/core/store/factory.js'
import type { ActionContextBase, State } from '@/types/store.js'

/** 可控抛错的钩子系统替身：IHookSystem 不保证 emit 内部吞掉处理器异常 */
function createHooks(options: { throwOn?: string[] } = {}) {
  const calls: Array<[string, number]> = []
  const emit = (name: string): void => {
    calls.push([name, calls.length])
    if (options.throwOn?.includes(name)) {
      throw new Error(`hook ${name} boom`)
    }
  }
  return {
    emit,
    off: (): void => {},
    clear: (): void => {},
    size: (): number => 0,
    calls,
    namesOf: (name: string): number => calls.filter((entry) => entry[0] === name).length,
  }
}

function createContext(name = 'r5-am'): ActionContextBase<State> {
  return {
    name,
    get state() {
      return { count: 0 }
    },
    setState: () => {},
    $patch: () => {},
    $replaceState: () => {},
    getState: () => ({ count: 0 }),
    dispatch: () => {},
  } as unknown as ActionContextBase<State>
}

function createManager(hooks: unknown, extra: Record<string, unknown> = {}) {
  const manager = new ActionManager<State, Record<string, (...args: unknown[]) => unknown>>({
    storeName: 'r5-am',
    withInternalAccess: <T>(fn: () => T): T => fn(),
    setDispatching: () => {},
    notifyListeners: () => {},
    hooks: hooks as never,
    ...extra,
  })
  manager.initialize({}, createContext())
  return manager
}

describe('R5-108 收尾上报归口', () => {
  it('同步 action 失败且 onError 处理器抛错时，仍抛 ACTION_EXECUTION_ERROR 并补发通知', () => {
    const hooks = createHooks({ throwOn: ['onError'] })
    const notifyListeners = jest.fn()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const manager = createManager(hooks, {
      notifyListeners,
      refreshCache: () => {},
    })
    manager.initialize(
      {
        boom: () => {
          throw new Error('action boom')
        },
      },
      createContext(),
    )

    try {
      // 修复前：catch 块里的裸 emit 抛错，会拿「上报异常」顶掉正要抛的
      // ACTION_EXECUTION_ERROR，并跳过后面的补刷缓存 + 补发通知
      expect(() => manager.execute('boom')).toThrow(/execution failed/)
      expect(notifyListeners).toHaveBeenCalledTimes(1)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('异步 reject 且 onError 处理器抛错时，补发通知不被跳过且只报一次', async () => {
    const hooks = createHooks({ throwOn: ['onError'] })
    const notifyListeners = jest.fn()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    const manager = createManager(hooks, { notifyListeners })
    manager.initialize(
      {
        fail: async () => {
          throw new Error('reject boom')
        },
      },
      createContext(),
    )

    try {
      await expect(manager.execute('fail')).rejects.toThrow('reject boom')
      await new Promise((resolve) => setTimeout(resolve, 0))
      // 修复前：拒绝分支先裸 emit（抛错）→ onSettled 永不执行 → 终端 catch 又就同一错误
      // 报一次 onError：通知整段丢失 + 重复上报
      expect(notifyListeners).toHaveBeenCalledTimes(1)
      expect(hooks.namesOf('onError')).toBe(1)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      errorSpy.mockRestore()
    }
  })

  it('refreshCache 抛错且 onError 也抛错时，dispatch 正常返回且通知照常', () => {
    const hooks = createHooks({ throwOn: ['onError'] })
    const notifyListeners = jest.fn()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const manager = createManager(hooks, {
      notifyListeners,
      refreshCache: () => {
        throw new Error('cache refresh boom')
      },
    })
    manager.initialize({ ping: () => 'pong' }, createContext())

    try {
      expect(manager.execute('ping')).toBe('pong')
      expect(notifyListeners).toHaveBeenCalledTimes(1)
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('refreshCache 失败仍经 onError 钩子归口（不改变第四轮口径）', () => {
    const hooks = createHooks()
    const manager = createManager(hooks, {
      refreshCache: () => {
        throw new Error('cache refresh boom')
      },
    })
    manager.initialize({ ping: () => 'pong' }, createContext())

    expect(manager.execute('ping')).toBe('pong')
    expect(hooks.namesOf('onError')).toBe(1)
  })

  it('宿主 thenable 的 .then 返回已 rejected 的 promise 时，终端 catch 就地报告且不逸成 unhandledRejection', async () => {
    const hooks = createHooks()
    const notifyListeners = jest.fn()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const manager = createManager(hooks, { notifyListeners })
      // 非 Promise 的宿主 thenable：then(...) 的返回值由它自己给出，这里给一个已拒绝的 promise
      const derived = Promise.reject(new Error('derived boom'))
      derived.catch(() => undefined)
      const thenable = {
        then: () => derived,
      }
      manager.initialize({ weird: () => thenable }, createContext())

      // 返回给调用方的仍是原始对象，异常语义不变
      expect(manager.execute('weird')).toBe(thenable)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(hooks.namesOf('onError')).toBe(1)
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      errorSpy.mockRestore()
    }
  })

  it('失败路径的收尾（补刷缓存 + 补发通知）自身抛错时不得顶掉 action 的原始错误', () => {
    const hooks = createHooks()
    const manager = createManager(hooks, {
      notifyListeners: () => {
        throw new Error('notify boom')
      },
      refreshCache: () => {},
    })
    manager.initialize(
      {
        boom: () => {
          throw new Error('action boom')
        },
      },
      createContext(),
    )

    expect(() => manager.execute('boom')).toThrow(/execution failed/)
    // 一次是 action 的错误，一次是收尾链路的错误，两笔都归口到 onError
    expect(hooks.namesOf('onError')).toBe(2)
  })
})

describe('R5-110 action 表不得被键名命中原型成员', () => {
  it("'__proto__' 命名的 action 可正常 dispatch，且容器是空原型", () => {
    const hooks = createHooks()
    const manager = createManager(hooks)
    const hit = jest.fn(() => 'proto-hit')
    manager.initialize({ ['__proto__']: hit, constructor: () => 'ctor-hit' } as never, createContext())

    // 修复前 boundActions 是普通对象字面量：`boundActions['__proto__'] = fn` 命中
    // Object.prototype 的 setter，属性写不进去 ⇒ dispatch('__proto__') 抛 ACTION_NOT_FOUND
    expect(manager.execute('__proto__')).toBe('proto-hit')
    expect(manager.execute('constructor')).toBe('ctor-hit')
    expect(Object.prototype.hasOwnProperty.call(manager.actions, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(manager.actions)).toBeNull()
  })

  it('Store 侧：__proto__ action 经 dispatch 生效', () => {
    const store = createStore({
      state: { n: 0 },
      actions: {
        ['__proto__'](this: { setState: (key: string, value: number) => void }) {
          this.setState('n', 7)
        },
      } as never,
    })
    try {
      expect(store.dispatch('__proto__')).toBeUndefined()
      expect(store.getState().n).toBe(7)
    } finally {
      store.destroy()
    }
  })
})
