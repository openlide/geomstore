/**
 * G2 extras medium 补审计（#180/#194/#196-#234 无判定记录的 25 条）的回归用例
 *
 * 逐条锁定「已落盘修复」的行为；#226 的 withRetry 守卫为本轮补做。
 * 用例名带 finding 编号，便于对照 .ocr-fix/verdicts/G2-extras-medium-p1-recheck.md。
 */

import { ActionHistoryTracker } from '@/extras/action/ActionHistory.js'
import type { ActionResult } from '@/types/action.js'
import { ActionUtils } from '@/extras/action/ActionUtils.js'
import { ActionExecutor } from '@/extras/action/AsyncActionSupport.js'
import { raceWithTimeout, retryWithBackoff } from '@/extras/action/async-core.js'
import { ActionLoader } from '@/extras/action/ActionLoader.js'
import { createDecorator } from '@/extras/action/decorators/common.js'
import { withDebounce } from '@/extras/action/decorators/debounce.js'
import { withCache } from '@/extras/action/decorators/cache.js'
import { withRetry } from '@/extras/action/decorators/retry.js'
import { withTimeout } from '@/extras/action/decorators/timeout.js'
import { withLog } from '@/extras/action/decorators/log.js'
import { ErrorHandlerImpl } from '@/extras/error/ErrorHandler.js'
// #221/#225：装饰器选项类型必须能且仅能从桶入口取到（编译期断言）
import type {
  DecoratorOptions,
  CacheDecoratorOptions,
  RetryDecoratorOptions,
  ThrottleDecoratorOptions,
  LogDecoratorOptions,
} from '@/extras/action/decorators/index.js'
// 同一批类型也必须能经 action 总入口取到（#225 消除深链）
import type { ActionStats, CacheDecoratorOptions as BarrelCacheOptions, LogDecoratorOptions as BarrelLogOptions } from '@/extras/action/index.js'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function okResult(): ActionResult {
  return { success: true, data: undefined, startTime: 1, endTime: 2, duration: 1 }
}

/** 把装饰器手工应用到宿主对象的方法上，返回类型化的包装函数 */
function decorate(host: Record<string, (...args: never[]) => unknown>, key: string, decorator: MethodDecorator): void {
  const descriptor = Object.getOwnPropertyDescriptor(host, key)
  if (!descriptor) {
    throw new Error(`宿主缺少方法 ${key}`)
  }
  decorator(host, key, descriptor)
  Object.defineProperty(host, key, descriptor)
}

describe('#180 ActionHistoryTracker 空串桶名与 clear 语义', () => {
  it("getHistory('')/clear('') 不再被真值判断吞成「聚合/全清」", () => {
    const tracker = new ActionHistoryTracker()
    tracker.record(okResult(), '')
    tracker.record(okResult(), 'keep')

    expect(tracker.getHistory('')).toHaveLength(1)
    tracker.clear('')
    expect(tracker.getHistory('')).toHaveLength(0)
    // clear('') 只清空名桶，其他桶必须还在
    expect(tracker.getHistory('keep')).toHaveLength(1)
    expect(tracker.getStats('keep').total).toBe(1)
  })
})

describe('#194 ActionUtils 构造参数不再是死参数', () => {
  it('execute 省略首参时用构造时绑定的 actions，显式传入仍可用', async () => {
    const bound = { fetch: async (n: number) => n * 2 }
    const other = { fetch: async (n: number) => n + 1 }
    const utils = new ActionUtils(bound)

    await expect(utils.execute('fetch', 21)).resolves.toBe(42)
    await expect(utils.execute(other, 'fetch', 4)).resolves.toBe(5)
  })
})

describe('#196 非 Error 抛出值在记录/回调侧被规范化', () => {
  it('历史里 error 是 Error 且保留文本，对外抛出的仍是原始值', async () => {
    const executor = new ActionExecutor()
    const actions = {
      boom: async () => {
        throw 'boom-string'
      },
    }

    await expect(executor.execute(actions, 'boom')).rejects.toBe('boom-string')
    const [entry] = executor.getHistory('boom')
    expect(entry?.error).toBeInstanceOf(Error)
    expect(entry?.error?.message).toBe('boom-string')
  })

  it('shouldRetry 回调收到的是 Error（字符串抛出场景，withRetry 装饰器）', async () => {
    const seen: boolean[] = []
    const dec = withRetry({
      retries: 3,
      delay: 1,
      shouldRetry: (e) => {
        seen.push(e instanceof Error)
        return false
      },
    })
    const host: Record<string, (...args: never[]) => unknown> = {
      m: (async () => {
        throw { code: 500 }
      }) as (...args: never[]) => unknown,
    }
    decorate(host, 'm', dec)

    await expect((host.m as () => Promise<unknown>).call(host)).rejects.toEqual({ code: 500 })
    expect(seen).toEqual([true])
  })
})

describe('#197 重试按「一次逻辑调用」记一条历史', () => {
  it('两次失败后成功的调用：total=1、successRate=100', async () => {
    const executor = new ActionExecutor()
    let attempts = 0
    const actions = {
      flaky: async () => {
        attempts += 1
        if (attempts < 3) {
          throw new Error(`attempt-${attempts}`)
        }
        return 'done'
      },
    }

    await expect(executor.executeWithRetry(actions, 'flaky', [], { retries: 3, delay: 1 })).resolves.toBe('done')
    expect(attempts).toBe(3)
    const stats = executor.getStats('flaky')
    expect(stats.total).toBe(1)
    expect(stats.success).toBe(1)
    expect(stats.successRate).toBe(100)
    expect(executor.getHistory('flaky')).toHaveLength(1)
  })
})

describe('#198 超时后底层迟到结算不再补写历史', () => {
  it('超时记一条失败；action 随后成功也不新增记录', async () => {
    const executor = new ActionExecutor()
    let release: (v: string) => void = () => undefined
    const actions = {
      slow: async () =>
        await new Promise<string>((resolve) => {
          release = resolve
        }),
    }

    await expect(executor.executeWithTimeout(actions, 'slow', [], 5)).rejects.toThrow('Action timeout after 5ms')
    release('late-success')
    await sleep(30)

    const stats = executor.getStats('slow')
    expect(stats.total).toBe(1)
    expect(stats.failure).toBe(1)
    const [entry] = executor.getHistory('slow')
    expect(entry?.success).toBe(false)
  })
})

describe('#200 onError 抛错不顶替原始错误，回调收到规范化 Error', () => {
  it('onError 自身抛错：原始错误照常外抛，回调异常只进 console.error', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const dec = createDecorator({
        onError: () => {
          throw new Error('callback-boom')
        },
      })
      const host = {
        m: () => {
          throw new Error('original-failure')
        },
      }
      decorate(host, 'm', dec)

      expect(() => host.m()).toThrow('original-failure')
      expect(spy).toHaveBeenCalledWith('[Action] onError callback threw:', expect.any(Error))
    } finally {
      spy.mockRestore()
    }
  })

  it('抛出字符串时 onError 收到 Error 实例，外抛保持原始值', () => {
    const received: unknown[] = []
    const dec = createDecorator({
      onError: (e) => {
        received.push(e)
      },
    })
    const host = {
      m: () => {
        throw 'string-error'
      },
    }
    decorate(host, 'm', dec)

    expect(() => host.m()).toThrow('string-error')
    expect(received[0]).toBeInstanceOf(Error)
    expect((received[0] as Error).message).toBe('string-error')
  })
})

describe('#201 async before/after 被接续而非并发', () => {
  it('async before 完成后被装饰方法才执行；rejection 走 onError', async () => {
    const order: string[] = []
    const dec = createDecorator({
      before: async () => {
        order.push('before:start')
        await sleep(10)
        order.push('before:end')
      },
    })
    const host = {
      m: async () => {
        order.push('method')
        return 'ok'
      },
    }
    decorate(host, 'm', dec)

    await expect(host.m()).resolves.toBe('ok')
    expect(order).toEqual(['before:start', 'before:end', 'method'])

    const seen: unknown[] = []
    const failing = createDecorator({
      before: async () => {
        throw new Error('before-fail')
      },
      onError: (e) => {
        seen.push(e)
      },
    })
    const host2 = { m: async () => 'never' }
    decorate(host2, 'm', failing)
    await expect(host2.m()).rejects.toThrow('before-fail')
    expect(seen).toHaveLength(1)
  })
})

describe('#203 delay/timeout 数值规范化', () => {
  it('raceWithTimeout 拒绝 0/负数/NaN/Infinity（RangeError），有限值截断到 2^31-1', async () => {
    await expect(raceWithTimeout(Promise.resolve(1), 0, 'x')).rejects.toBeInstanceOf(RangeError)
    await expect(raceWithTimeout(Promise.resolve(1), -5, 'x')).rejects.toBeInstanceOf(RangeError)
    await expect(raceWithTimeout(Promise.resolve(1), Number.NaN, 'x')).rejects.toBeInstanceOf(RangeError)
    await expect(raceWithTimeout(Promise.resolve(1), Number.POSITIVE_INFINITY, 'x')).rejects.toBeInstanceOf(RangeError)
    await expect(raceWithTimeout(Promise.resolve(1), 10, 'x')).resolves.toBe(1)
  })

  it('retryWithBackoff：NaN/负 delay 不挂起，正常 delay 真实等待', async () => {
    let attempts = 0
    const start = Date.now()
    const value = await retryWithBackoff(
      async () => {
        attempts += 1
        if (attempts < 3) {
          throw new Error('nope')
        }
        return 'ok'
      },
      { retries: 5, delay: Number.NaN },
    )
    expect(value).toBe('ok')
    expect(Date.now() - start).toBeLessThan(500)

    attempts = 0
    const t0 = Date.now()
    await retryWithBackoff(
      async () => {
        attempts += 1
        if (attempts < 2) {
          throw new Error('again')
        }
        return 'ok'
      },
      { retries: 2, delay: 20 },
    )
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15)
  })
})

describe('#205 clear() 复位宿主 store 状态', () => {
  it('在途调用未落定时 clear 给 loading 键补写 false', async () => {
    const loader = new ActionLoader()
    const writes: Array<[string, unknown]> = []
    const setState = (key: string, value: unknown): void => {
      writes.push([key, value])
    }
    let release: (v: string) => void = () => undefined
    const wrapped = loader.wrap(
      async () =>
        await new Promise<string>((resolve) => {
          release = resolve
        }),
      'a',
      setState,
    )

    const p = wrapped()
    expect(loader.isLoading('a')).toBe(true)
    loader.clear()

    expect(writes).toContainEqual(['loading', false])
    expect(loader.isLoading('a')).toBe(false)
    release('x')
    await p
  })
})

describe('#206 共享计数下 isLoading 以计数为准', () => {
  it('A 先结束时 A.isLoading 仍为 true（B 在途），B 结束一起归零', async () => {
    const shared = new Map<string, number>()
    const loaderA = new ActionLoader({ sharedLoadingCounts: shared })
    const loaderB = new ActionLoader({ sharedLoadingCounts: shared })
    const gate = (): [(v: string) => void, Promise<string>] => {
      let release: (v: string) => void = () => undefined
      const p = new Promise<string>((resolve) => {
        release = resolve
      })
      return [release, p]
    }
    const [releaseA, promiseA] = gate()
    const [releaseB, promiseB] = gate()
    const wrappedA = loaderA.wrap(
      async () => await promiseA,
      'a',
      () => undefined,
    )
    const wrappedB = loaderB.wrap(
      async () => await promiseB,
      'b',
      () => undefined,
    )

    const pa = wrappedA()
    const pb = wrappedB()
    expect(shared.get('loading')).toBe(2)

    releaseA('A')
    await pa
    // 旧实现里 A 的私有镜像永不复位；现在直接看共享计数
    expect(loaderA.isLoading('a')).toBe(true)
    expect(loaderB.isLoading('b')).toBe(true)

    releaseB('B')
    await pb
    expect(loaderA.isLoading('a')).toBe(false)
    expect(loaderB.isLoading('b')).toBe(false)
  })
})

describe('#207 setOptions 换键名时给旧键补写复位值', () => {
  it('在途时改 loadingKey：旧键收到 false，不再卡住', async () => {
    const loader = new ActionLoader()
    const writes: Array<[string, unknown]> = []
    let release: (v: string) => void = () => undefined
    const wrapped = loader.wrap(
      async () =>
        await new Promise<string>((resolve) => {
          release = resolve
        }),
      'a',
      (key, value) => {
        writes.push([key, value])
      },
    )

    const p = wrapped()
    loader.setOptions({ loadingKey: 'isLoading' })
    expect(writes).toContainEqual(['loading', false])

    release('done')
    await p
    // R5-160/R5-161：换键后这次调用的记账凭证失效，收尾不再写任何状态键——
    // 修复前它会按**新**键减一次（本调用从未加过），把新键的 loading 提前翻成 false。
    // 「不卡住」的保证者是上面那笔旧键复位
    expect(writes).not.toContainEqual(['isLoading', false])
    expect(loader.isLoading('a')).toBe(false)
  })
})

describe('#208 wrap 接受带具体参数类型的 action', () => {
  it('无需 as any：typed action 直接传入且返回值类型保持', async () => {
    const loader = new ActionLoader()
    const fetchUser = async (userId: string): Promise<{ id: string }> => ({ id: userId })
    const wrapped = loader.wrap(fetchUser, 'fetchUser', () => undefined)

    await expect(wrapped('u-1')).resolves.toEqual({ id: 'u-1' })
  })
})

describe('#213/#226 非方法描述符在装饰阶段即报错', () => {
  it('withDebounce/withRetry/withTimeout 对 getter 描述符抛 TypeError', () => {
    const accessor: PropertyDescriptor = { get: () => undefined, configurable: true }
    expect(() => withDebounce(10)({}, 'm', accessor)).toThrow(TypeError)
    expect(() => withRetry({ retries: 1 })({}, 'm', { ...accessor })).toThrow(TypeError)
    expect(() => withTimeout(10)({}, 'm', { ...accessor })).toThrow(TypeError)
  })

  it('#227 withTimeout 工厂阶段拒绝非法 timeout（RangeError）', () => {
    expect(() => withTimeout(0)).toThrow(RangeError)
    expect(() => withTimeout(-1)).toThrow(RangeError)
    expect(() => withTimeout(Number.NaN)).toThrow(RangeError)
    expect(() => withTimeout(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(typeof withTimeout(50)).toBe('function')
  })
})

describe('#214 debounce 触发时用最后一次调用的参数', () => {
  it('两次快呼只执行一次，且带最后一个参数', async () => {
    const calls: unknown[][] = []
    const host: Record<string, (...args: never[]) => unknown> = {
      m: ((...args: unknown[]) => {
        calls.push(args)
        return Promise.resolve('ok')
      }) as (...args: never[]) => unknown,
    }
    decorate(host, 'm', withDebounce(20) as MethodDecorator)
    // 必须以宿主方法调用形态进入包装器：裸函数调用会丢 this，state 落空
    const invoke = (...args: unknown[]): Promise<unknown> => (host.m as (...a: unknown[]) => Promise<unknown>).call(host, ...args)

    void invoke('first')
    void invoke('second')
    await sleep(80)
    expect(calls).toEqual([['second']])
  })
})

describe('#217 在途占位条目有有限期限', () => {
  it('永不结算的 Promise 占位会在 max(ttl, 60s) 后被回收，同参调用重新执行', () => {
    jest.useFakeTimers()
    try {
      const calls: string[] = []
      const host: Record<string, (...args: never[]) => unknown> = {
        m: (async (tag: string) =>
          await new Promise<string>(() => {
            calls.push(tag)
          })) as (...args: never[]) => unknown,
      }
      decorate(host, 'm', withCache({ ttl: 70_000 }) as MethodDecorator)
      const invoke = (tag: string): Promise<string> => (host.m as (t: string) => Promise<string>).call(host, tag)

      void invoke('x')
      expect(calls).toEqual(['x'])
      // 未过期：复用同一个永不结算的占位
      void invoke('x')
      expect(calls).toHaveLength(1)

      jest.advanceTimersByTime(70_001)
      void invoke('x')
      // 占位过期 → 重新执行原方法，而不是永久把调用方挂死
      expect(calls).toHaveLength(2)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('#218 容量淘汰跳过在途占位', () => {
  it('塞满 1000 条后，最旧的 pending 占位不被淘汰，同参并发仍去重', async () => {
    let release: (v: string) => void = () => undefined
    let gatedCalls = 0
    const host: Record<string, (...args: never[]) => unknown> = {
      m: (async (tag: string) => {
        if (tag === 'gated') {
          gatedCalls += 1
          return await new Promise<string>((resolve) => {
            release = resolve
          })
        }
        return tag
      }) as (...args: never[]) => unknown,
    }
    decorate(host, 'm', withCache() as MethodDecorator)
    const invoke = (tag: string): Promise<string> => (host.m as (t: string) => Promise<string>).call(host, tag)

    const first = invoke('gated')
    expect(gatedCalls).toBe(1)
    for (let i = 0; i < 1_001; i += 1) {
      await invoke(`pad-${i}`)
    }

    const second = invoke('gated')
    expect(gatedCalls).toBe(1)
    release('done')
    await expect(first).resolves.toBe('done')
    await expect(second).resolves.toBe('done')
  })
})

describe('#219 Map/Set 包装键无法被用户参数伪造', () => {
  it('{__map:...} 与 new Map 不再撞键串用结果', async () => {
    const seen: unknown[] = []
    const host: Record<string, (...args: never[]) => unknown> = {
      m: ((arg: unknown) => {
        seen.push(arg)
        return `r${seen.length}`
      }) as (...args: never[]) => unknown,
    }
    decorate(host, 'm', withCache({ ttl: 60_000 }) as MethodDecorator)
    const invoke = (arg: unknown): string => (host.m as (a: unknown) => string).call(host, arg)

    expect(invoke(new Map([[1, 2]]))).toBe('r1')
    expect(invoke(new Map([[1, 2]]))).toBe('r1')
    // 伪造体必须走自己的桶：既不能命中 Map 的缓存，也不能被 Map 命中
    expect(invoke({ __map: [[1, 2]] })).toBe('r2')
    expect(invoke(new Map([[1, 2]]))).toBe('r1')
    expect(invoke(new Set([1, 2]))).toBe('r3')
    expect(invoke({ __set: [1, 2] })).toBe('r4')
    expect(seen).toHaveLength(4)
  })
})

describe('#221/#225 桶入口类型聚合', () => {
  it('四个选项类型 + ActionStats 均可从公共入口取到', () => {
    const cacheOptions: CacheDecoratorOptions = { ttl: 1 }
    const retryOptions: RetryDecoratorOptions = { retries: 1 }
    const commonOptions: DecoratorOptions = {}
    const throttleOptions: ThrottleDecoratorOptions = {}
    const logOptions: LogDecoratorOptions = {}
    const stats: ActionStats = { total: 0, success: 0, failure: 0, avgDuration: 0, successRate: 0 }
    const viaBarrel: [BarrelCacheOptions, BarrelLogOptions] = [{ ttl: 2 }, {}]

    expect([cacheOptions, retryOptions, commonOptions, throttleOptions, logOptions, stats, viaBarrel]).toHaveLength(7)
  })
})

describe('#222/#224 withLog 支持 sink 注入与 redact', () => {
  it('日志走自定义 sink；redact 决定入日志的形态，原始载荷不外泄', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const errors: unknown[] = []
    try {
      const sink = {
        log: jest.fn(),
        error: (message: string, ...data: unknown[]): void => {
          errors.push([message, ...data])
        },
      }
      const dec = withLog('login', {
        sink,
        redact: (value, phase) => (phase === 'args' ? '[credentials]' : value),
      })
      const host: Record<string, (...args: never[]) => unknown> = {
        m: (async (credentials: { user: string; password: string }) => {
          throw credentials.user.length
        }) as (...args: never[]) => unknown,
      }
      decorate(host, 'm', dec)
      const invoke = host.m as (credentials: { user: string; password: string }) => Promise<number>

      await expect(invoke({ user: 'bob', password: 'hunter2' })).rejects.toBe(3)
      const started = sink.log.mock.calls[0]
      expect(started?.[1]).toBe('[credentials]')
      expect(JSON.stringify(started ?? '')).not.toContain('hunter2')
      expect(errors).toHaveLength(1)
      expect(consoleSpy).not.toHaveBeenCalled()
    } finally {
      consoleSpy.mockRestore()
    }
  })
})

describe('#234 错误查询出口返回防御性拷贝', () => {
  it('改 getLastError/getErrorsBy*/getErrorLog 的结果不污染内部日志', () => {
    const handler = new ErrorHandlerImpl()
    handler.handle('store1', 'action-execution', new Error('e1'), 'error')
    handler.handle('store1', 'patch', new Error('e2'), 'warn')

    const last = handler.getLastError()
    expect(last).toBeDefined()
    if (last) {
      last.level = 'critical'
      last.error = new Error('tampered')
    }

    expect(handler.getLastError()?.level).toBe('warn')
    expect(handler.getLastError()?.error.message).toBe('e2')

    const byOp = handler.getErrorsByOperation('action-execution')
    expect(byOp).toHaveLength(1)
    if (byOp[0]) {
      byOp[0].storeName = 'tampered-store'
    }
    expect(handler.getErrorsByOperation('action-execution')[0]?.storeName).toBe('store1')

    const byLevel = handler.getErrorsByLevel('error')
    if (byLevel[0]) {
      byLevel[0].timestamp = 0
    }
    expect(handler.getErrorsByLevel('error')[0]?.timestamp).not.toBe(0)

    const log = handler.getErrorLog()
    expect(log).toHaveLength(2)
    if (log[0]) {
      log[0].storeName = 'tampered-store'
    }
    expect(handler.getErrorLog()[0]?.storeName).toBe('store1')
  })
})
