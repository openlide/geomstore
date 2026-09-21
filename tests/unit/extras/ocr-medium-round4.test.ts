/**
 * 第四轮 ocr 复审 · 分组 G2-extras（medium 分片 1/3）修复的回归测试
 *
 * 用例名带 finding 编号（#N），与 .ocr-fix/groups/G2-extras-medium-p1.md 对照。
 */

import { ActionLoader, ActionUtils, ActionExecutor, type ActionStats } from '@/extras/action/index.js'
import { ActionHistoryTracker } from '@/extras/action/ActionHistory.js'
import { raceWithTimeout, retryWithBackoff, toError } from '@/extras/action/async-core.js'
import { createDecorator } from '@/extras/action/decorators/common.js'
import { withDebounce } from '@/extras/action/decorators/debounce.js'
import { withTimeout } from '@/extras/action/decorators/timeout.js'
import { withCache } from '@/extras/action/decorators/cache.js'
import { withLog } from '@/extras/action/decorators/log.js'
import type {
  LogSink,
  CacheDecoratorOptions,
  DecoratorOptions,
  LogDecoratorOptions,
  RetryDecoratorOptions,
  ThrottleDecoratorOptions,
} from '@/extras/action/decorators/index.js'
import { withErrorBoundary } from '@/extras/error/ErrorBoundary.js'
import { ErrorHandlerImpl } from '@/extras/error/ErrorHandler.js'
import { createErrorContext } from '@/types/error.js'
import type { ActionResult } from '@/types/action.js'

/** 造一条执行历史记录 */
function resultOf(data: unknown, startTime = 1): ActionResult {
  return { success: true, data, startTime, endTime: startTime + 1, duration: 1 }
}

/** 只关心「被调用」的 sink */
function createSink(): LogSink & { logMessages: Array<[string, unknown]> } {
  const sink = {
    logMessages: [] as Array<[string, unknown]>,
    log: (message: string, ...data: unknown[]): void => {
      sink.logMessages.push([message, data[0]])
    },
    error: jest.fn(),
  }

  return sink
}

/** 真实的 setTimeout：在装载本文件时捕获，避免与 spyOn 互相递归 */
const REAL_SET_TIMEOUT = globalThis.setTimeout

/** 让退避/超时的真实等待不发生，只记录宿主收到的延时数值 */
function recordTimeoutDelays(): unknown[] {
  const delays: unknown[] = []
  jest.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
    delays.push(ms)

    return REAL_SET_TIMEOUT(handler, 0, ...rest)
  }) as unknown as typeof setTimeout)

  return delays
}

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

describe('#180 ActionHistory 区分「未传名」与「空串名」', () => {
  it('#180 空串名的桶可读、可单独清除', () => {
    const tracker = new ActionHistoryTracker()
    tracker.record(resultOf('anonymous'), '')
    tracker.record(resultOf('named'), 'named')

    expect(tracker.getHistory('')).toHaveLength(1)
    expect(tracker.getHistory('')[0].data).toBe('anonymous')
    expect(tracker.getHistory()).toHaveLength(2)

    tracker.clear('')
    expect(tracker.getHistory('')).toEqual([])
    expect(tracker.getHistory('named')).toHaveLength(1)

    tracker.clear()
    expect(tracker.getHistory()).toEqual([])
  })
})

describe('#194 ActionUtils 的构造参数真正生效', () => {
  const actions = {
    double: async (value: number): Promise<number> => value * 2,
  }

  it('#194 execute 可省略 actions 首参，使用绑定的 Actions 对象', async () => {
    const utils = new ActionUtils(actions)

    await expect(utils.execute('double', 21)).resolves.toBe(42)
  })

  it('#194 显式传入 Actions 对象的老写法仍然可用', async () => {
    const utils = new ActionUtils(actions)

    await expect(utils.execute(actions, 'double', 21)).resolves.toBe(42)
  })
})

describe('#196 非 Error 抛出值在入口处规范化', () => {
  it('#196 历史记录中的 error 恒为 Error 实例，向外抛出的仍是原值', async () => {
    const executor = new ActionExecutor()
    const localActions = {
      throwString: async (): Promise<never> => {
        throw 'boom'
      },
    }

    await expect(executor.execute(localActions, 'throwString')).rejects.toBe('boom')

    const history = executor.getHistory('throwString')
    expect(history[0].error).toBeInstanceOf(Error)
    expect(history[0].error?.message).toBe('boom')
  })

  it('#196 executeSequential / executeParallel 的失败项也是 Error', async () => {
    const executor = new ActionExecutor()
    const localActions = {
      throwObject: async (): Promise<never> => {
        throw { code: 500 }
      },
    }

    const sequential = await executor.executeSequential(localActions, [{ action: 'throwObject', args: [] }])
    const parallel = await executor.executeParallel(localActions, [{ action: 'throwObject', args: [] }])

    expect(sequential[0]).toBeInstanceOf(Error)
    expect((sequential[0] as Error).message).toBe('{"code":500}')
    expect(parallel[0]).toBeInstanceOf(Error)
  })

  it('#196 重试内核把非 Error 抛出值规范化后再交给 shouldRetry', async () => {
    const shouldRetry = jest.fn().mockReturnValue(false)

    await expect(
      retryWithBackoff(
        async (): Promise<never> => {
          throw null
        },
        { retries: 3, delay: 1, shouldRetry },
      ),
    ).rejects.toBeNull()
    expect(shouldRetry).toHaveBeenCalledWith(expect.any(Error))
    expect((shouldRetry.mock.calls[0][0] as Error).message).toBe('null')
  })

  it('#196 ActionLoader 对字符串抛错同样产出可读的 errorData', async () => {
    const loader = new ActionLoader()
    const states: Record<string, unknown> = {}

    await expect(
      loader.wrap(
        async (): Promise<never> => {
          throw 'network down'
        },
        'fetch',
        (key, value) => {
          states[key] = value
        },
      ),
    ).rejects.toBe('network down')

    expect(loader.getError('fetch')).toBeInstanceOf(Error)
    expect((states.errorData as { message: string }).message).toBe('network down')
  })

  it('#196 toError 保留原 Error 身份并覆盖非 Error 值', () => {
    const original = new Error('keep me')
    expect(toError(original)).toBe(original)
    expect(toError('text').message).toBe('text')
    expect(toError(undefined).message).toBe('undefined')
    expect(toError({ a: 1 }).message).toBe('{"a":1}')

    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(toError(circular).message).toBe('[object Object]')
  })
})

describe('#197 重试按「一次逻辑调用」记一条历史', () => {
  it('#197 重试后成功：total=1 且 successRate=100', async () => {
    const executor = new ActionExecutor()
    let attempts = 0
    const localActions = {
      flaky: async (): Promise<string> => {
        attempts++
        if (attempts < 3) {
          throw new Error('not yet')
        }

        return 'ok'
      },
    }

    await expect(executor.executeWithRetry(localActions, 'flaky', [], { retries: 3, delay: 1 })).resolves.toBe('ok')

    expect(attempts).toBe(3)
    expect(executor.getHistory('flaky')).toHaveLength(1)
    expect(executor.getStats('flaky')).toMatchObject({ total: 1, success: 1, failure: 0, successRate: 100 })
  })

  it('#197 重试全失败：只记一条失败记录', async () => {
    const executor = new ActionExecutor()
    let attempts = 0
    const localActions = {
      alwaysFail: async (): Promise<never> => {
        attempts++
        throw new Error('down')
      },
    }

    await expect(executor.executeWithRetry(localActions, 'alwaysFail', [], { retries: 2, delay: 1 })).rejects.toThrow('down')

    expect(attempts).toBe(3)
    expect(executor.getHistory('alwaysFail')).toHaveLength(1)
    expect(executor.getStats('alwaysFail')).toMatchObject({ total: 1, failure: 1 })
  })
})

describe('#198 超时后底层调用的迟到结果不入历史', () => {
  it('#198 超时记为一条失败，迟到的成功不再补记', async () => {
    const executor = new ActionExecutor()
    const localActions = {
      slow: async (): Promise<string> => {
        await new Promise((resolve) => setTimeout(resolve, 40))

        return 'late-success'
      },
    }

    await expect(executor.executeWithTimeout(localActions, 'slow', [], 5)).rejects.toThrow('Action timeout after 5ms')
    expect(executor.getHistory('slow')).toHaveLength(1)
    expect(executor.getStats('slow')).toMatchObject({ total: 1, success: 0, failure: 1 })

    // 等底层 action 真正结算：调用方已观察到超时，不应再冒出第二条记录
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(executor.getHistory('slow')).toHaveLength(1)
    expect(executor.getStats('slow')).toMatchObject({ total: 1, success: 0 })
  })

  it('#198 未超时的调用仍记录真实结果', async () => {
    const executor = new ActionExecutor()
    const localActions = { fast: async (): Promise<string> => 'done' }

    await expect(executor.executeWithTimeout(localActions, 'fast', [], 1000)).resolves.toBe('done')
    expect(executor.getStats('fast')).toMatchObject({ total: 1, success: 1 })
  })
})

describe('#200 createDecorator 的 onError 不再吞掉原始失败', () => {
  it('#200 onError 自身抛错时被隔离，原始错误照常外抛', () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation()
    const decorator = createDecorator({
      onError: () => {
        throw new Error('callback broke')
      },
    })
    const descriptor: PropertyDescriptor = {
      value: () => {
        throw new Error('real failure')
      },
      writable: true,
      configurable: true,
      enumerable: true,
    }
    decorator({}, 'boom', descriptor)

    expect(() => (descriptor.value as () => void)()).toThrow('real failure')
    expect(consoleError).toHaveBeenCalledWith('[Action] onError callback threw:', expect.any(Error))
  })

  it('#200 onError 收到的是规范化的 Error（方法抛出非 Error 值时）', async () => {
    const onError = jest.fn()
    const decorator = createDecorator({ onError })
    const descriptor: PropertyDescriptor = {
      value: async (): Promise<never> => {
        throw 42
      },
      writable: true,
      configurable: true,
      enumerable: true,
    }
    decorator({}, 'load', descriptor)

    await expect((descriptor.value as () => Promise<unknown>)()).rejects.toBe(42)
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect((onError.mock.calls[0][0] as Error).message).toBe('42')
  })
})

describe('#201 async 的 before/after 被接续而非并发', () => {
  it('#201 async before 完成后才执行被装饰方法', async () => {
    const order: string[] = []
    const decorator = createDecorator({
      before: async () => {
        await Promise.resolve()
        order.push('before')
      },
    })
    const descriptor: PropertyDescriptor = {
      value: () => {
        order.push('method')
        return 'result'
      },
      writable: true,
      configurable: true,
      enumerable: true,
    }
    decorator({}, 'run', descriptor)

    const pending = (descriptor.value as () => unknown)()
    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).resolves.toBe('result')
    expect(order).toEqual(['before', 'method'])
  })

  it('#201 before 的 rejection 走 onError 并让返回值 reject', async () => {
    const onError = jest.fn()
    const method = jest.fn()
    const decorator = createDecorator({
      before: async () => {
        throw new Error('before failed')
      },
      onError,
    })
    const descriptor: PropertyDescriptor = { value: method, writable: true, configurable: true, enumerable: true }
    decorator({}, 'run', descriptor)

    await expect((descriptor.value as () => Promise<unknown>)()).rejects.toThrow('before failed')
    expect(method).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'before failed' }))
  })

  it('#201 异步方法上的 async after 被等待后才 resolve', async () => {
    const order: string[] = []
    const decorator = createDecorator({
      after: async () => {
        await Promise.resolve()
        order.push('after')
      },
    })
    const descriptor: PropertyDescriptor = {
      value: async () => {
        order.push('method')
        return 7
      },
      writable: true,
      configurable: true,
      enumerable: true,
    }
    decorator({}, 'run', descriptor)

    await expect((descriptor.value as () => Promise<unknown>)()).resolves.toBe(7)
    expect(order).toEqual(['method', 'after'])
  })

  it('#201 同步方法 + async after：保持同步返回，rejection 只记录日志', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation()
    const decorator = createDecorator({
      after: async () => {
        throw new Error('after failed')
      },
    })
    const descriptor: PropertyDescriptor = { value: () => 'sync', writable: true, configurable: true, enumerable: true }
    decorator({}, 'run', descriptor)

    expect((descriptor.value as () => unknown)()).toBe('sync')
    await Promise.resolve()
    await Promise.resolve()
    expect(consoleError).toHaveBeenCalledWith('[Action] async after callback rejected:', expect.any(Error))
  })
})

describe('#203 退避与超时数值归一', () => {
  it('#203 超出宿主可表达区间的 delay 截断为 2^31-1', async () => {
    const delays = recordTimeoutDelays()
    const fn = jest.fn().mockRejectedValueOnce(new Error('first')).mockRejectedValueOnce(new Error('second')).mockResolvedValue('ok')

    await expect(retryWithBackoff(fn, { retries: 2, delay: 2 ** 40 })).resolves.toBe('ok')
    // 修复前：2^40 与 2^41 都会被宿主钳制成 1ms（Node 还会抛 TimeoutOverflowWarning），
    // 退避直接消失
    expect(delays).toEqual([2 ** 31 - 1, 2 ** 31 - 1])
  })

  it('#203 delay 为 NaN / Infinity / 负数时按 0 处理（不产生 NaN 延时，也不会挂起）', async () => {
    for (const delay of [Number.NaN, Number.POSITIVE_INFINITY, -50]) {
      const delays = recordTimeoutDelays()
      const fn = jest.fn().mockRejectedValueOnce(new Error('first')).mockResolvedValue('ok')

      await expect(retryWithBackoff(fn, { retries: 1, delay })).resolves.toBe('ok')
      expect(delays).toEqual([0])
      jest.restoreAllMocks()
    }
  })

  it('#203 raceWithTimeout 拒绝非有限 / 非正数的 timeout', async () => {
    await expect(raceWithTimeout(Promise.resolve(1), 0, 'boom')).rejects.toThrow(RangeError)
    await expect(raceWithTimeout(Promise.resolve(1), Number.NaN, 'boom')).rejects.toThrow(RangeError)
    await expect(raceWithTimeout(Promise.resolve(1), Number.POSITIVE_INFINITY, 'boom')).rejects.toThrow(RangeError)
    await expect(raceWithTimeout(Promise.resolve(1), 1000, 'boom')).resolves.toBe(1)
  })
})

describe('#205 ActionLoader.clear 同步复位宿主状态', () => {
  it('#205 clear() 给仍在进行中的 loading 键补写 false', async () => {
    const loader = new ActionLoader()
    const states: Record<string, unknown> = {}
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const wrapped = loader.wrap(
      async (): Promise<string> => {
        await gate

        return 'done'
      },
      'fetch',
      (key, value) => {
        states[key] = value
      },
    )

    const running = wrapped()
    expect(states.loading).toBe(true)

    loader.clear()
    expect(states.loading).toBe(false)
    expect(loader.isLoading('fetch')).toBe(false)

    release()
    await running
    expect(states.loading).toBe(false)
  })

  it('#205 clear(setState) 可显式指定复位目标', async () => {
    const loader = new ActionLoader()
    const legacy: Record<string, unknown> = {}
    const target: Record<string, unknown> = {}
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const running = loader.wrap(
      async (): Promise<null> => {
        await gate

        return null
      },
      'fetch',
      (key, value) => {
        legacy[key] = value
      },
    )()
    expect(legacy.loading).toBe(true)

    loader.clear((key, value) => {
      target[key] = value
    })
    expect(target.loading).toBe(false)
    expect(legacy.loading).toBe(true)

    release()
    await running
  })

  it('#205 clear() 复位残留的错误与错误数据', async () => {
    const loader = new ActionLoader()
    const states: Record<string, unknown> = {}
    const setState = (key: string, value: unknown): void => {
      states[key] = value
    }

    await expect(
      loader.wrap(
        async (): Promise<never> => {
          throw new Error('failed')
        },
        'fetch',
        setState,
      ),
    ).rejects.toThrow('failed')
    expect(states.error).toBeInstanceOf(Error)

    loader.clear()
    expect(states.error).toBeNull()
    expect(states.errorData).toBeNull()
    expect(loader.getAllErrors()).toEqual({})
  })
})

describe('#206 isLoading 以共享引用计数为准', () => {
  it('#206 共享计数下先结束的实例不会永久停留在 true', async () => {
    const shared = new Map<string, number>()
    const loaderA = new ActionLoader({ sharedLoadingCounts: shared })
    const loaderB = new ActionLoader({ sharedLoadingCounts: shared, errorKey: 'otherError' })
    const gates: Array<() => void> = []
    const gate = (): Promise<void> =>
      new Promise<void>((resolve) => {
        gates.push(resolve)
      })
    const noop = (): void => {}

    const runningA = loaderA.wrap(async (): Promise<void> => gate(), 'work', noop)()
    const runningB = loaderB.wrap(async (): Promise<void> => gate(), 'work', noop)()
    expect(loaderA.isLoading('work')).toBe(true)
    expect(loaderB.isLoading('work')).toBe(true)

    gates[0]()
    await runningA
    // 计数仍有 1：两者都必须继续报告 loading
    expect(loaderA.isLoading('work')).toBe(true)

    gates[1]()
    await runningB
    expect(loaderA.isLoading('work')).toBe(false)
    expect(loaderB.isLoading('work')).toBe(false)
  })
})

describe('#207 换状态键的 setOptions 一并清理记账并复位旧键', () => {
  it('#207 进行中改 loadingKey 时旧键被补写 false，新键计数干净', async () => {
    const loader = new ActionLoader()
    const states: Record<string, unknown> = {}
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const setState = (key: string, value: unknown): void => {
      states[key] = value
    }

    const running = loader.wrap(
      async (): Promise<string> => {
        await gate

        return 'done'
      },
      'fetch',
      setState,
    )()
    expect(states.loading).toBe(true)

    loader.setOptions({ loadingKey: 'isLoading' })
    expect(states.loading).toBe(false)
    expect(loader.getAllLoading()).toEqual({})

    release()
    await running
    expect(loader.isLoading('fetch')).toBe(false)
    expect(states.loading).toBe(false)
  })

  it('#207 换键时残留的错误条目被清理', async () => {
    const loader = new ActionLoader()
    const states: Record<string, unknown> = {}
    const setState = (key: string, value: unknown): void => {
      states[key] = value
    }

    await expect(
      loader.wrap(
        async (): Promise<never> => {
          throw new Error('boom')
        },
        'fetch',
        setState,
      ),
    ).rejects.toThrow('boom')
    expect(loader.getError('fetch')).toBeInstanceOf(Error)

    loader.setOptions({ errorKey: 'requestError' })
    expect(states.error).toBeNull()
    expect(loader.getAllErrors()).toEqual({})
  })

  it('#207 键名未变时 setOptions 不清理在途记账', async () => {
    const loader = new ActionLoader()
    const states: Record<string, unknown> = {}
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const running = loader.wrap(
      async (): Promise<string> => {
        await gate

        return 'done'
      },
      'fetch',
      (key, value) => {
        states[key] = value
      },
    )()

    loader.setOptions({ perActionKeys: false, loadingKey: 'loading' })
    expect(states.loading).toBe(true)

    release()
    await running
    expect(states.loading).toBe(false)
  })
})

describe('#208 ActionLoader.wrap 接受带具体参数类型的 action', () => {
  it('#208 无需 as any 即可包装并保留原签名', async () => {
    const loader = new ActionLoader()
    const setState = jest.fn()
    const fetchUser = async (userId: string): Promise<{ id: string }> => ({ id: userId })

    const wrapped = loader.wrap(fetchUser, 'fetchUser', setState)
    const typed: (userId: string) => Promise<{ id: string }> = wrapped

    await expect(typed('u1')).resolves.toEqual({ id: 'u1' })
    expect(setState).toHaveBeenCalledWith('loading', true)
    expect(setState).toHaveBeenCalledWith('loading', false)
  })
})

describe('#213/#226 装饰器只接受方法，装饰阶段即失败', () => {
  const accessor: PropertyDescriptor = { get: () => 1, configurable: true, enumerable: true }

  it('#213 withDebounce 装饰访问器时抛 TypeError', () => {
    expect(() => withDebounce(10)({}, 'value', accessor)).toThrow(TypeError)
  })

  it('#226 withTimeout 装饰访问器时抛 TypeError', () => {
    expect(() => withTimeout(10)({}, 'value', accessor)).toThrow(TypeError)
  })

  it('#226 withErrorBoundary 装饰访问器时抛 TypeError', () => {
    expect(() => withErrorBoundary()({}, 'value', accessor)).toThrow(TypeError)
  })
})

describe('#214 防抖只以最后一次调用的参数执行', () => {
  it('#214 连续调用只在到期后执行一次，参数取最后一次', async () => {
    jest.useFakeTimers()
    const method = jest.fn(async (value: string): Promise<string> => value)
    const descriptor: PropertyDescriptor = { value: method, writable: true, configurable: true, enumerable: true }
    withDebounce(50)({}, 'search', descriptor)
    const host = { search: descriptor.value as (value: string) => Promise<string> }

    const first = host.search('a')
    const second = host.search('b')
    await jest.advanceTimersByTimeAsync(50)

    await expect(first).resolves.toBe('b')
    await expect(second).resolves.toBe('b')
    expect(method).toHaveBeenCalledTimes(1)
    expect(method).toHaveBeenCalledWith('b')
  })

  it('#214 无参数调用原样传空数组', async () => {
    jest.useFakeTimers()
    const descriptor: PropertyDescriptor = {
      value: async (...args: unknown[]): Promise<number> => args.length,
      writable: true,
      configurable: true,
      enumerable: true,
    }
    withDebounce(20)({}, 'count', descriptor)

    const running = (descriptor.value as (...args: unknown[]) => Promise<number>)()
    await jest.advanceTimersByTimeAsync(20)

    await expect(running).resolves.toBe(0)
  })
})

describe('#217 在途占位条目有有限期限', () => {
  it('#217 永不结算的请求不会让占位条目永久驻留', async () => {
    jest.useFakeTimers()
    class Host {
      executions = 0

      @withCache({ ttl: 100 })
      async load(): Promise<string> {
        this.executions++

        return new Promise<string>(() => {
          /* 永不结算 */
        })
      }
    }
    const host = new Host()

    void host.load()
    void host.load()
    expect(host.executions).toBe(1)

    // 超过在途期限后条目失效：同参调用重新执行，而不是继续复用死掉的 Promise
    jest.advanceTimersByTime(60_001)
    void host.load()
    expect(host.executions).toBe(2)
  })

  it('#217 短 TTL 下在途条目仍按最短期限存活', async () => {
    jest.useFakeTimers()
    class Host {
      executions = 0

      @withCache({ ttl: 5 })
      async load(): Promise<number> {
        this.executions++

        return new Promise<number>(() => {
          /* 永不结算 */
        })
      }
    }
    const host = new Host()

    void host.load()
    jest.advanceTimersByTime(10)
    void host.load()
    expect(host.executions).toBe(1)
  })

  it('#217/#218 占位到期并被新调用替换后，旧请求失败不得删掉新占位', async () => {
    jest.useFakeTimers()
    let rejectFirst!: (error: unknown) => void

    class Host {
      executions = 0

      @withCache({ ttl: 60_000 })
      async load(): Promise<string> {
        this.executions++

        return new Promise<string>((_resolve, reject) => {
          if (this.executions === 1) {
            rejectFirst = reject
          }
        })
      }
    }
    const host = new Host()

    const first = host.load()
    jest.advanceTimersByTime(60_001)
    const second = host.load()
    expect(host.executions).toBe(2)

    // 修复前：该分支被 istanbul 断言为「不可达」，实际条目已换成 second 的占位
    rejectFirst(new Error('stale request'))
    await expect(first).rejects.toThrow('stale request')

    void host.load()
    expect(host.executions).toBe(2)
  })
})

describe('#218 容量淘汰跳过在途占位条目', () => {
  it('#218 打满容量后同参并发调用仍走去重', async () => {
    const gates = new Map<number, () => void>()

    class Host {
      executed: number[] = []

      @withCache({ ttl: 60_000, keyFn: (key: unknown) => `cap:${String(key)}` })
      async get(key: number): Promise<number> {
        this.executed.push(key)
        if (key < 5) {
          await new Promise<void>((resolve) => {
            gates.set(key, resolve)
          })
        }

        return key
      }
    }
    const host = new Host()

    // 先建立 5 个在途占位（插入顺序最前）
    const pending = [0, 1, 2, 3, 4].map((key) => host.get(key))
    // 再用已完成的调用把容量打满，触发淘汰
    for (let key = 5; key < 1006; key++) {
      await host.get(key)
    }

    // 修复前：最旧的在途占位会被淘汰，同参调用重复执行原方法
    void host.get(0)
    expect(host.executed.filter((value) => value === 0)).toHaveLength(1)

    for (const release of gates.values()) {
      release()
    }
    await Promise.all(pending)
  })
})

describe('#219 Map/Set 的缓存键包装无法被参数伪造', () => {
  /** 每个用例一份独立宿主：缓存与计数都按宿主隔离 */
  function createHost(): { executions: number; lookup: (value: unknown) => Promise<number> } {
    class Host {
      executions = 0

      @withCache({ ttl: 5000 })
      async lookup(_value: unknown): Promise<number> {
        this.executions++

        return this.executions
      }
    }
    const host = new Host()

    return {
      get executions(): number {
        return host.executions
      },
      lookup: (value: unknown) => host.lookup(value),
    }
  }

  it('#219 new Map 与自带 __map 键的对象不撞键', async () => {
    const host = createHost()

    expect(await host.lookup(new Map([[1, 2]]))).toBe(1)
    // 修复前：{ __map: [[1,2]] } 序列化为与 Map 完全相同的键，这里会直接命中上一次的缓存
    expect(await host.lookup({ __map: [[1, 2]] })).toBe(2)
    expect(await host.lookup(new Map([[1, 2]]))).toBe(1)
  })

  it('#219 new Set 与自带 __set 键的对象不撞键', async () => {
    const host = createHost()

    expect(await host.lookup(new Set([1, 2]))).toBe(1)
    expect(await host.lookup({ __set: [1, 2] })).toBe(2)
    expect(await host.lookup(new Set([1, 2]))).toBe(1)
  })
})

describe('#221/#225 装饰器桶与 action 入口的类型导出', () => {
  it('#221 decorators/index 与 action/index 均导出四个装饰器选项类型', () => {
    const cache: CacheDecoratorOptions = { ttl: 1 }
    const retry: RetryDecoratorOptions = { retries: 1 }
    const decorator: DecoratorOptions = { before: () => {} }
    const throttle: ThrottleDecoratorOptions = { leading: true }
    const log: LogDecoratorOptions = { sink: { log: () => {}, error: () => {} } }

    expect([cache, retry, decorator, throttle, log]).toHaveLength(5)
  })

  it('#225 action 入口导出 getStats 的返回类型 ActionStats', () => {
    const stats: ActionStats = { total: 1, success: 1, failure: 0, avgDuration: 2, successRate: 100 }

    expect(stats.successRate).toBe(100)
  })
})

describe('#222/#224 withLog 可注入输出与脱敏', () => {
  it('#224 自定义 sink 接管输出（不再硬写 console）', async () => {
    const sink = createSink()

    class Host {
      @withLog('act', { sink })
      async run(value: number): Promise<number> {
        return value
      }
    }

    await expect(new Host().run(5)).resolves.toBe(5)
    expect(sink.logMessages).toEqual([
      ['[Action] act started with args:', [5]],
      ['[Action] act completed with result:', 5],
    ])
  })

  it('#222 redact 钩子决定落日志的内容', async () => {
    const sink = createSink()
    const options: LogDecoratorOptions = {
      sink,
      redact: (value, phase) => (phase === 'args' ? '[redacted]' : value),
    }

    class Host {
      @withLog('login', options)
      async run(password: string): Promise<string> {
        return 'token' + password
      }
    }

    await new Host().run('secret')
    expect(sink.logMessages[0]).toEqual(['[Action] login started with args:', '[redacted]'])
    expect(sink.logMessages[1]?.[1]).toBe('tokensecret')
  })

  it('#222 非生产构建默认原样输出，便于本地调试', async () => {
    const sink = createSink()

    class Host {
      @withLog('act', { sink })
      async run(value: string): Promise<string> {
        return value
      }
    }

    await new Host().run('plain')
    expect(sink.logMessages[0]).toEqual(['[Action] act started with args:', ['plain']])
  })

  it('#222 生产构建下默认降级为摘要，不输出参数内容', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    const logged: unknown[] = []

    try {
      await jest.isolateModulesAsync(async () => {
        const { withLog: productionWithLog } = await import('@/extras/action/decorators/log.js')
        const decorator = productionWithLog('act', {
          sink: { log: (_message: string, ...data: unknown[]) => logged.push(...data), error: () => {} },
        })
        const descriptor: PropertyDescriptor = {
          value: async (token: string) => token,
          writable: true,
          configurable: true,
          enumerable: true,
        }
        decorator({}, 'run', descriptor)
        await (descriptor.value as (token: string) => Promise<string>)('secret-token')
      })
    } finally {
      process.env.NODE_ENV = previous
    }

    expect(logged).toEqual(['Array(1)', 'string'])
  })

  it('#224 onError 走 sink.error', async () => {
    const sink = { log: jest.fn(), error: jest.fn() }

    class Host {
      @withLog('act', { sink })
      async fail(): Promise<never> {
        throw new Error('nope')
      }
    }

    await expect(new Host().fail()).rejects.toThrow('nope')
    expect(sink.error).toHaveBeenCalledWith('[Action] act failed:', expect.objectContaining({ message: 'nope' }))
  })
})

describe('#227 withTimeout 在装饰阶段校验 timeout', () => {
  it('#227 非法 timeout 直接抛 RangeError', () => {
    expect(() => withTimeout(0)).toThrow(RangeError)
    expect(() => withTimeout(-1)).toThrow(RangeError)
    expect(() => withTimeout(Number.NaN)).toThrow(RangeError)
    expect(() => withTimeout(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => withTimeout()).not.toThrow()
    expect(() => withTimeout(50)).not.toThrow()
  })

  it('#227 合法 timeout 下超时行为不变', async () => {
    const descriptor: PropertyDescriptor = {
      value: async (): Promise<string> => {
        await new Promise((resolve) => setTimeout(resolve, 50))

        return 'late'
      },
      writable: true,
      configurable: true,
      enumerable: true,
    }
    withTimeout(5)({}, 'load', descriptor)

    await expect((descriptor.value as () => Promise<unknown>)()).rejects.toThrow('Timeout after 5ms')
  })
})

describe('#234 错误查询接口返回副本', () => {
  beforeEach(() => {
    // 默认 handler 会把每条错误打到 console，这里只验证副本语义
    jest.spyOn(console, 'error').mockImplementation()
  })

  it('#234 修改返回的上下文不会污染内部日志与统计', () => {
    const handler = new ErrorHandlerImpl()
    handler.handle('user-store', 'action-execution', new Error('first'), 'error')

    const last = handler.getLastError()
    expect(last).toBeDefined()
    last!.level = 'critical'
    last!.storeName = 'tampered'
    expect(handler.getLastError()?.level).toBe('error')
    expect(handler.getLastError()?.storeName).toBe('user-store')

    const log = handler.getErrorLog()
    log[0].error = new Error('replaced')
    expect(handler.getErrorLog()[0].error.message).toBe('first')

    expect(handler.getErrorsByLevel('error')[0].storeName).toBe('user-store')
    expect(handler.getErrorsByOperation('action-execution')[0].storeName).toBe('user-store')
    expect(handler.getErrorStats().byLevel.error).toBe(1)
  })

  it('#234 返回的条目仍保留 error 的引用身份', () => {
    const handler = new ErrorHandlerImpl()
    const error = new Error('same instance')
    handler.handleError(createErrorContext('store', 'state-update', error))

    expect(handler.getLastError()?.error).toBe(error)
    expect(handler.getErrorLog()[0]?.error).toBe(error)
  })
})
