/**
 * ActionLoader 测试
 */

import { ActionLoader, withLoading } from '@/core/action'

describe('ActionLoader', () => {
  let loader: ActionLoader
  let setStateMock: jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
    loader = new ActionLoader({
      autoLoading: true,
      loadingKey: 'loading',
      errorKey: 'error',
      errorDataKey: 'errorData',
    })
    setStateMock = jest.fn()
  })

  afterEach(() => {
    jest.useRealTimers()
    loader.clear()
  })

  describe('构造函数', () => {
    it('应该使用默认选项', () => {
      const defaultLoader = new ActionLoader()
      const options = (defaultLoader as any).options
      expect(options.autoLoading).toBe(true)
      expect(options.loadingKey).toBe('loading')
      expect(options.errorKey).toBe('error')
      expect(options.errorDataKey).toBe('errorData')
    })

    it('应该接受自定义选项', () => {
      const customLoader = new ActionLoader({
        autoLoading: false,
        loadingKey: 'isLoading',
        errorKey: 'myError',
        errorDataKey: 'myErrorData',
      })
      const options = (customLoader as any).options
      expect(options.autoLoading).toBe(false)
      expect(options.loadingKey).toBe('isLoading')
      expect(options.errorKey).toBe('myError')
      expect(options.errorDataKey).toBe('myErrorData')
    })
  })

  describe('wrap', () => {
    it('应该包装成功的 action', async () => {
      const action = jest.fn(async (value: number) => value * 2)
      const wrapped = loader.wrap(action as any, 'testAction', setStateMock)
      const result = await wrapped(5)
      expect(result).toBe(10)
      expect(action).toHaveBeenCalledWith(5)
    })

    it('应该设置 loading 状态', async () => {
      const action = jest.fn(async () => new Promise((resolve) => setTimeout(resolve, 10)))
      const wrapped = loader.wrap(action, 'testAction', setStateMock)
      const promise = wrapped()
      expect(setStateMock).toHaveBeenCalledWith('loading', true)
      jest.advanceTimersByTime(10)
      await promise
      expect(setStateMock).toHaveBeenCalledWith('loading', false)
    })

    it('应该处理 action 错误', async () => {
      const error = new Error('Action failed')
      const action = jest.fn(async () => {
        throw error
      })
      const wrapped = loader.wrap(action, 'testAction', setStateMock)
      await expect(wrapped()).rejects.toThrow(error)
    })

    it('应该在错误时清除 loading 并设置 error', async () => {
      const error = new Error('Action failed')
      const action = jest.fn(async () => {
        throw error
      })
      const wrapped = loader.wrap(action, 'testAction', setStateMock)
      await expect(wrapped()).rejects.toThrow()
      expect(setStateMock).toHaveBeenCalledWith('loading', false)
      expect(setStateMock).toHaveBeenCalledWith('error', error)
    })

    it('应该设置错误数据', async () => {
      const error = new Error('Action failed')
      const action = jest.fn(async () => {
        throw error
      })
      const wrapped = loader.wrap(action, 'testAction', setStateMock)
      await expect(wrapped()).rejects.toThrow()
      const errorDataCall = setStateMock.mock.calls.find((call) => call[0] === 'errorData')
      expect(errorDataCall).toBeDefined()
      expect(errorDataCall![1]).toMatchObject({
        message: 'Action failed',
        timestamp: expect.any(Number),
      })
    })

    it('应该在成功后清除错误', async () => {
      const error = new Error('Previous error')
      const action = jest.fn(async () => 'success')
      const wrapped = loader.wrap(action, 'testAction', setStateMock)

      // 首次执行失败
      action.mockImplementationOnce(async () => {
        throw error
      })
      await expect(wrapped()).rejects.toThrow()

      // 重置 mock
      setStateMock.mockClear()
      action.mockImplementation(async () => 'success')

      // 再次执行成功
      await wrapped()
      const errorDataCall = setStateMock.mock.calls.find((call) => call[0] === 'errorData')
      expect(errorDataCall![1]).toBe(null)
    })

    it('应该支持 autoLoading: false', async () => {
      const noAutoLoader = new ActionLoader({ autoLoading: false })
      const action = jest.fn(async () => 'success')
      const wrapped = noAutoLoader.wrap(action, 'testAction', setStateMock)
      await wrapped()
      // autoLoading 关闭时不写 loading 键
      expect(setStateMock).not.toHaveBeenCalledWith('loading', expect.anything())
      // 错误状态管理独立于 loading 开关：成功时仍清除陈旧错误
      expect(setStateMock).toHaveBeenCalledWith('error', null)
      expect(setStateMock).toHaveBeenCalledWith('errorData', null)
    })

    it('REGR-LOAD-001: 同一 action 并发调用时引用计数归零才清除 loading', async () => {
      let releaseFirst!: () => void
      let releaseSecond!: () => void
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve
      })
      const secondGate = new Promise<void>((resolve) => {
        releaseSecond = resolve
      })
      const action = jest.fn(async (tag: string) => {
        if (tag === 'first') {
          await firstGate
        }
        if (tag === 'second') {
          await secondGate
        }
        return tag
      })
      const wrapped = loader.wrap(action as any, 'concurrentAction', setStateMock)

      const promise1 = wrapped('first')
      const promise2 = wrapped('second')
      expect(loader.isLoading('concurrentAction')).toBe(true)

      // 第一个调用完成：引用计数 2 -> 1，loading 必须保持 true
      releaseFirst()
      await promise1
      expect(loader.isLoading('concurrentAction')).toBe(true)

      // 最后一个调用完成：计数归零才置 false
      releaseSecond()
      await promise2
      expect(loader.isLoading('concurrentAction')).toBe(false)

      // 修复前：首个调用完成即置 false，第二个调用期间 loading 状态错误
      const loadingCalls = setStateMock.mock.calls.filter((call) => call[0] === 'loading')
      expect(loadingCalls.filter((call) => call[1] === true)).toHaveLength(1)
      expect(loadingCalls.filter((call) => call[1] === false)).toHaveLength(1)
    })
  })

  describe('状态查询方法', () => {
    it('应该查询 loading 状态', async () => {
      const action = jest.fn(async () => new Promise((resolve) => setTimeout(resolve, 10)))
      const wrapped = loader.wrap(action, 'testAction', setStateMock)
      const promise = wrapped()
      expect(loader.isLoading('testAction')).toBe(true)
      jest.advanceTimersByTime(10)
      await promise
      expect(loader.isLoading('testAction')).toBe(false)
    })

    it('应该查询 error', async () => {
      const error = new Error('Test error')
      const action = jest.fn(async () => {
        throw error
      })
      const wrapped = loader.wrap(action, 'testAction', setStateMock)
      await expect(wrapped()).rejects.toThrow()
      expect(loader.getError('testAction')).toBe(error)
    })

    it('应该查询 error data', async () => {
      const error = new Error('Test error')
      const action = jest.fn(async () => {
        throw error
      })
      const wrapped = loader.wrap(action, 'testAction', setStateMock)
      await expect(wrapped()).rejects.toThrow()
      const errorData = loader.getErrorData('testAction')
      expect(errorData).toMatchObject({
        message: 'Test error',
        timestamp: expect.any(Number),
      })
    })

    it('应该获取所有 loading 状态', async () => {
      const action1 = jest.fn(async () => new Promise((resolve) => setTimeout(resolve, 5)))
      const action2 = jest.fn(async () => new Promise((resolve) => setTimeout(resolve, 10)))

      const wrapped1 = loader.wrap(action1, 'action1', setStateMock)
      const wrapped2 = loader.wrap(action2, 'action2', setStateMock)

      const promise1 = wrapped1()
      const promise2 = wrapped2()

      const allLoading = loader.getAllLoading()
      expect(allLoading['loading']).toBe(true)

      jest.advanceTimersByTime(10)
      await Promise.all([promise1, promise2])
    })

    it('应该获取所有 errors', async () => {
      const error = new Error('Test error')
      const action = jest.fn(async () => {
        throw error
      })
      const wrapped = loader.wrap(action, 'testAction', setStateMock)
      await expect(wrapped()).rejects.toThrow()
      const allErrors = loader.getAllErrors()
      expect(allErrors['error']).toBe(error)
    })
  })

  describe('状态管理', () => {
    it('应该清除所有状态', async () => {
      const action = jest.fn(async () => 'success')
      const wrapped = loader.wrap(action, 'testAction', setStateMock)
      await wrapped()
      loader.clear()
      expect(loader.getAllLoading()).toEqual({})
      expect(loader.getAllErrors()).toEqual({})
    })

    it('应该更新选项', () => {
      loader.setOptions({
        loadingKey: 'newLoading',
        errorKey: 'newError',
        autoLoading: false,
      })
      const options = (loader as any).options
      expect(options.loadingKey).toBe('newLoading')
      expect(options.errorKey).toBe('newError')
      expect(options.autoLoading).toBe(false)
    })

    it('应该部分更新选项', () => {
      loader.setOptions({ loadingKey: 'customLoading' })
      const options = (loader as any).options
      expect(options.loadingKey).toBe('customLoading')
      expect(options.errorKey).toBe('error')
      expect(options.autoLoading).toBe(true)
    })

    it('setOptions 传入 undefined 值时应保持原有选项不变', () => {
      // 覆盖 ?? 操作符的 falsy 分支：当 options.xxx 为 undefined 时使用 this.options.xxx
      loader.setOptions({
        loadingKey: undefined,
        errorKey: undefined,
        errorDataKey: undefined,
        autoLoading: undefined,
      })
      const options = (loader as any).options
      expect(options.loadingKey).toBe('loading')
      expect(options.errorKey).toBe('error')
      expect(options.errorDataKey).toBe('errorData')
      expect(options.autoLoading).toBe(true)
    })
  })

  describe('autoLoading: false 补充覆盖', () => {
    it('autoLoading 为 false 时 action 抛错不写 loading 键但记录错误', async () => {
      const noAutoLoader = new ActionLoader({ autoLoading: false })
      const error = new Error('fail')
      const action = jest.fn(async () => {
        throw error
      })
      const wrapped = noAutoLoader.wrap(action, 'testAction', setStateMock)
      await expect(wrapped()).rejects.toThrow(error)
      // autoLoading 关闭时不写 loading 键
      expect(setStateMock).not.toHaveBeenCalledWith('loading', expect.anything())
      // 错误状态管理独立于 loading 开关：错误仍被记录
      expect(setStateMock).toHaveBeenCalledWith('error', error)
      expect(setStateMock).toHaveBeenCalledWith('errorData', expect.objectContaining({ message: 'fail' }))
    })

    it('autoLoading 为 false 时 action 成功不写 loading 键但清除错误', async () => {
      const noAutoLoader = new ActionLoader({ autoLoading: false })
      const action = jest.fn(async () => 'success')
      const wrapped = noAutoLoader.wrap(action, 'testAction', setStateMock)
      const result = await wrapped()
      expect(result).toBe('success')
      // autoLoading 关闭时不写 loading 键
      expect(setStateMock).not.toHaveBeenCalledWith('loading', expect.anything())
      // 错误状态管理独立于 loading 开关：成功时仍清除陈旧错误
      expect(setStateMock).toHaveBeenCalledWith('error', null)
    })
  })

  describe('状态查询方法补充覆盖', () => {
    it('isLoading 查询不存在的 action 应返回 false', () => {
      // 覆盖 loadingStates.get(key) ?? false 的 ?? 分支
      expect(loader.isLoading('nonExistentAction')).toBe(false)
    })

    it('getError 查询不存在的 action 应返回 null', () => {
      // 覆盖 errors.get(key) ?? null 的 ?? 分支
      expect(loader.getError('nonExistentAction')).toBeNull()
    })

    it('getErrorData 查询不存在的 action 应返回 undefined', () => {
      expect(loader.getErrorData('nonExistentAction')).toBeUndefined()
    })
  })
})

describe('withLoading 装饰器', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  class TestStore {
    state: any = {}
    setStateCalls: any[] = []

    setState(key: string, value: unknown) {
      this.setStateCalls.push({ key, value })
      this.state[key] = value
    }

    @withLoading()
    async loadData(value: number) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      return value * 2
    }
  }

  it('应该装饰方法并管理 loading 状态', async () => {
    const store = new TestStore()
    const promise = store.loadData(5)

    expect(store.state.loading).toBe(true)
    expect(store.state.error).toBeUndefined()

    jest.advanceTimersByTime(10)

    const result = await promise
    expect(result).toBe(10)
    expect(store.state.loading).toBe(false)
  })

  it('应该处理方法错误', async () => {
    class ErrorStore {
      state: any = {}
      setStateCalls: any[] = []

      setState(key: string, value: unknown) {
        this.setStateCalls.push({ key, value })
        this.state[key] = value
      }

      @withLoading()
      async failMethod() {
        throw new Error('Method failed')
      }
    }

    const store = new ErrorStore()
    await expect(store.failMethod()).rejects.toThrow('Method failed')
    expect(store.state.loading).toBe(false)
    expect(store.state.error).toBeInstanceOf(Error)
  })

  it('应该在没有 setState 时抛出错误', () => {
    class BadStore {
      @withLoading()
      async method() {
        return 'success'
      }
    }

    const store = new BadStore()
    expect(store.method()).rejects.toThrow('[withLoading] Method must be used in a Store instance')
  })

  it('应该支持自定义选项', async () => {
    class CustomStore {
      state: any = {}

      setState(key: string, value: unknown) {
        this.state[key] = value
      }

      @withLoading({ loadingKey: 'isLoading', errorKey: 'myError' })
      async customMethod(value: number) {
        return value
      }
    }

    const store = new CustomStore()
    await store.customMethod(42)
    expect(store.state).toMatchObject({
      isLoading: false,
      myError: null,
    })
  })

  it('BUG-F7-1: withLoading 的 loading 状态应按宿主实例隔离', async () => {
    // 修复前 loaderInstance 在装饰器函数体创建（按方法共享）：两个实例并发调用时
    // 共享引用计数，先完成实例的 loading 会永久卡在 true
    // 注意：本 describe 启用了 fake timers，用受控 Promise 代替定时器
    class HostStore {
      state: Record<string, unknown> = {}

      setState(key: string, value: unknown) {
        this.state[key] = value
      }

      @withLoading()
      fetch(deferred: Promise<void>) {
        return deferred.then(() => 'ok')
      }
    }

    const a = new HostStore()
    const b = new HostStore()

    let resolveA!: () => void
    let resolveB!: () => void
    const pa = a.fetch(
      new Promise<void>((resolve) => {
        resolveA = resolve
      }),
    )
    const pb = b.fetch(
      new Promise<void>((resolve) => {
        resolveB = resolve
      }),
    )

    resolveB()
    await pb
    // b 先完成：b 的 loading 归 false，a 的仍为 true
    expect(b.state.loading).toBe(false)
    expect(a.state.loading).toBe(true)

    resolveA()
    await pa
    expect(a.state.loading).toBe(false)
  })

  it('BUG-F7-2: setOptions 中途切换 autoLoading 应重置计数避免 loading 永久卡住', async () => {
    const loader = new ActionLoader({ autoLoading: true })
    const states: Record<string, unknown> = {}
    const setState = (key: string, value: unknown) => {
      states[key] = value
    }

    let resolveFirst!: () => void
    const firstWrapped = loader.wrap(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve
        }),
      'fetch',
      setState,
    )
    const first = firstWrapped()
    expect(states.loading).toBe(true)

    // 进行中切换 autoLoading：残留计数应被重置
    loader.setOptions({ autoLoading: false })
    resolveFirst()
    await first

    // 切回 autoLoading：新调用 loading 正常从 true 到 false，不被残留计数卡住
    loader.setOptions({ autoLoading: true })
    const second = loader.wrap(() => Promise.resolve('done'), 'fetch', setState)()
    await expect(second).resolves.toBe('done')
    expect(states.loading).toBe(false)
  })

  it('BUG-F7-3: 错误时 setState 收到的 errorData 与内部存储应是同一引用（单次构建）', async () => {
    const loader = new ActionLoader()
    const states: Record<string, unknown> = {}
    const setState = (key: string, value: unknown) => {
      states[key] = value
    }

    const failure = new Error('f7 failure')
    await expect(
      loader.wrap(
        () => {
          throw failure
        },
        'fetch',
        setState,
      ),
    ).rejects.toBe(failure)

    const internal = loader as any
    // state 中的 errorData 与内部存储的 errorData 为同一对象（单次构建、引用一致）
    expect(states.errorData).toBe(internal.errorData.get('errorData'))
    expect((states.errorData as any).message).toBe('f7 failure')
    expect(typeof (states.errorData as any).timestamp).toBe('number')
  })
})
