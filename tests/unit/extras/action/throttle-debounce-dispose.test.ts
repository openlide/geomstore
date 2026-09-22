/**
 * withThrottle / withDebounce 的宿主级收尾入口（cancel / flush / dispose）
 *
 * 背景（第四轮审查「另立波次」项）：两个装饰器都把挂起的调用排在 `setTimeout` 上，
 * 宿主（小程序 Page / Component 实例）卸载后无人可取消，到点仍会调用被装饰方法。
 * 本文件锁定新增公开入口的语义与边界：
 * - `cancel*`：丢弃挂起调用（不执行原方法），幂等；
 * - `flush*`：立即执行一次挂起调用，且「一次且只一次」，无挂起时不凭空执行；
 * - `dispose*`：取消 + 释放该宿主的整张状态表（比 cancel 多做窗口/队列归零）；
 * - 被取消调用的 Promise 有归宿（await 方看到 rejection，fire-and-forget 不成 unhandledRejection）；
 * - 装饰器产物是同类多实例共享的包装函数，入口按宿主寻址 → 多实例互不影响；
 * - fake timers 下入口调用后不留残定时器；
 * - 宿主为基本类型 / null / 无状态宿主时全部入口都是安全 no-op；
 * - 既有调用形态（`@withThrottle(100)`、`@withDebounce(300)`、`assumeAsync`）行为不变。
 */

import * as extrasIndex from '@/extras/index.js'
import {
  withDebounce,
  cancelDebouncedCalls,
  flushDebouncedCalls,
  disposeDebouncedState,
  withThrottle,
  cancelThrottledCalls,
  flushThrottledCalls,
  disposeThrottledState,
} from '@/extras/action/index.js'

/** 以描述符手工装饰（Symbol 键方法写不出装饰器语法） */
function decorate(host: Record<string | symbol, unknown>, key: string | symbol, decorator: MethodDecorator): void {
  const descriptor = Object.getOwnPropertyDescriptor(host, key) as PropertyDescriptor
  Object.defineProperty(host, key, decorator(host, key, descriptor) ?? descriptor)
}

/**
 * 取原型上被装饰方法的包装函数
 *
 * 用脱离 `this` 约束的函数类型收：直接 `host.method` 再 `.call(undefined)` 会被
 * `strictBindCallApply` 按类的 `this` 类型拒掉。
 */
function wrapperOf(prototype: object, key: string): (this: unknown, ...args: unknown[]) => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, key) as PropertyDescriptor
  return descriptor.value as (this: unknown, ...args: unknown[]) => unknown
}

/** 让已入队的微任务（含 rejection 判定）跑完 */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

describe('withThrottle：挂起补发的 cancel / flush / dispose', () => {
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  class Scroll {
    calls: number[] = []

    @withThrottle(100)
    handle(value: number): void {
      this.calls.push(value)
    }
  }

  it('cancel 入口：宿主卸载点之后窗口内挂起的 trailing 补发不再执行，且不留残定时器', () => {
    jest.useFakeTimers()
    const host = new Scroll()
    host.handle(1) // 新窗口 leading
    jest.advanceTimersByTime(10)
    host.handle(2) // 窗口内被抑制 → 排入补发
    expect(jest.getTimerCount()).toBe(1)

    cancelThrottledCalls(host)
    expect(jest.getTimerCount()).toBe(0)

    jest.advanceTimersByTime(500)
    expect(host.calls).toEqual([1])
  })

  it('cancel 幂等：重复 cancel、对无挂起宿主 cancel 都不再触发原方法', () => {
    jest.useFakeTimers()
    const host = new Scroll()
    host.handle(1)
    jest.advanceTimersByTime(10)
    host.handle(2)

    cancelThrottledCalls(host)
    cancelThrottledCalls(host)
    cancelThrottledCalls(new Scroll()) // 全新宿主：本就无状态
    jest.advanceTimersByTime(500)

    expect(host.calls).toEqual([1])
    expect(jest.getTimerCount()).toBe(0)
  })

  it('flush 入口：立即补发一次且只一次，之后再推进时钟不重复补发', () => {
    jest.useFakeTimers()
    const host = new Scroll()
    host.handle(1)
    jest.advanceTimersByTime(10)
    host.handle(2)

    flushThrottledCalls(host)
    expect(host.calls).toEqual([1, 2])
    expect(jest.getTimerCount()).toBe(0)

    flushThrottledCalls(host) // 二次 flush：挂起参数已清空
    jest.advanceTimersByTime(500)
    expect(host.calls).toEqual([1, 2])
  })

  it('flush 不凭空执行：只有 leading 发生、没有挂起调用时原方法调用次数不变', () => {
    jest.useFakeTimers()
    const host = new Scroll()
    host.handle(1) // leading 执行，无挂起
    flushThrottledCalls(host)
    jest.advanceTimersByTime(500)
    expect(host.calls).toEqual([1])
  })

  it('dispose 与 cancel 的差别：dispose 连窗口计时一起释放，cancel 保留窗口', () => {
    jest.useFakeTimers()
    class Pure {
      calls: number[] = []

      @withThrottle(100, { trailing: false })
      hit(value: number): void {
        this.calls.push(value)
      }
    }

    const cancelled = new Pure()
    cancelled.hit(1)
    jest.advanceTimersByTime(10)
    cancelThrottledCalls(cancelled)
    cancelled.hit(2) // 仍在旧窗口内 → 被抑制且无补发
    expect(cancelled.calls).toEqual([1])

    const disposed = new Pure()
    disposed.hit(1)
    jest.advanceTimersByTime(10)
    disposeThrottledState(disposed)
    disposed.hit(2) // 窗口计时已释放 → 按新窗口立即执行
    expect(disposed.calls).toEqual([1, 2])

    // dispose 同样丢掉了挂起的补发：不残留任何定时器
    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(500)
    expect(disposed.calls).toEqual([1, 2])
  })

  it('多实例互不影响：同一份共享包装函数下，cancel 只作用于目标宿主', () => {
    jest.useFakeTimers()
    const a = new Scroll()
    const b = new Scroll()
    a.handle(1)
    b.handle(1)
    jest.advanceTimersByTime(10)
    a.handle(2)
    b.handle(2)
    expect(jest.getTimerCount()).toBe(2)

    cancelThrottledCalls(a)
    expect(jest.getTimerCount()).toBe(1)

    jest.advanceTimersByTime(500)
    expect(a.calls).toEqual([1])
    expect(b.calls).toEqual([1, 2])
  })

  it('按方法名定位：flush/cancel 只作用于点名方法，点错名是 no-op', () => {
    jest.useFakeTimers()
    class Multi {
      firstCalls: number[] = []
      secondCalls: number[] = []

      @withThrottle(100)
      first(value: number): void {
        this.firstCalls.push(value)
      }

      @withThrottle(100)
      second(value: number): void {
        this.secondCalls.push(value)
      }
    }

    const host = new Multi()
    host.first(1)
    host.second(1)
    jest.advanceTimersByTime(10)
    host.first(2)
    host.second(2)
    expect(jest.getTimerCount()).toBe(2)

    cancelThrottledCalls(host, 'first')
    cancelThrottledCalls(host, 'notADecoratedMethod')
    expect(jest.getTimerCount()).toBe(1)

    flushThrottledCalls(host, 'second')
    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(500)
    expect(host.firstCalls).toEqual([1])
    expect(host.secondCalls).toEqual([1, 2])
  })

  it('Symbol 方法键按身份隔离：描述名相同的两个 Symbol 方法互不被对方 cancel', () => {
    jest.useFakeTimers()
    const runA = Symbol('run')
    const runB = Symbol('run')
    const aCalls: number[] = []
    const bCalls: number[] = []
    const host: Record<string | symbol, unknown> = {
      [runA](value: number) {
        aCalls.push(value)
      },
      [runB](value: number) {
        bCalls.push(value)
      },
    }
    const decorator = withThrottle(100)
    decorate(host, runA, decorator)
    decorate(host, runB, decorator)

    const call = (key: symbol, value: number): void => (host[key] as (this: unknown, v: number) => void).call(host, value)
    call(runA, 1)
    call(runB, 1)
    jest.advanceTimersByTime(10)
    call(runA, 2)
    call(runB, 2)

    cancelThrottledCalls(host, runA)
    jest.advanceTimersByTime(500)
    expect(aCalls).toEqual([1])
    expect(bCalls).toEqual([1, 2])
  })

  it('flush 的补发失败就地兜错：同步抛错与异步 rejection 都只走 console.error', async () => {
    jest.useFakeTimers()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    class Boom {
      hits: number[] = []

      @withThrottle(100)
      sync(value: number): void {
        this.hits.push(value)
        throw new Error('sync boom')
      }

      @withThrottle(100)
      async asyncMethod(value: number): Promise<void> {
        this.hits.push(value)
        throw new Error('async boom')
      }
    }

    const syncHost = new Boom()
    expect(() => syncHost.sync(1)).toThrow('sync boom') // leading：失败照旧抛给调用方
    jest.advanceTimersByTime(10)
    syncHost.sync(2) // 被抑制 → 挂起补发
    flushThrottledCalls(syncHost) // 补发抛错不可能回给调用方，必须就地兜住
    expect(syncHost.hits).toEqual([1, 2])

    const asyncHost = new Boom()
    await expect(asyncHost.asyncMethod(1)).rejects.toThrow('async boom')
    jest.advanceTimersByTime(10)
    void asyncHost.asyncMethod(2)
    flushThrottledCalls(asyncHost)
    await drainMicrotasks()

    expect(errorSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenCalledWith('[withThrottle] trailing invocation failed:', expect.any(Error))
    errorSpy.mockRestore()
    jest.useRealTimers()
  })

  it('宿主为基本类型时入口不抛错，detached 调用仍直接放行原方法', () => {
    jest.useFakeTimers()
    const seen: number[] = []
    // 方法体刻意不碰 `this`：宿主不可跟踪时装饰器按 undefined receiver 直接放行
    class Detachable {
      @withThrottle(100)
      handle(value: number): void {
        seen.push(value)
      }
    }
    const detached = wrapperOf(Detachable.prototype, 'handle')

    expect(() => detached.call(undefined, 7)).not.toThrow() // 不可跟踪宿主：直接放行
    expect(seen).toEqual([7])

    expect(() => cancelThrottledCalls(undefined)).not.toThrow()
    expect(() => flushThrottledCalls(null)).not.toThrow()
    expect(() => disposeThrottledState(42)).not.toThrow()
    expect(() => disposeThrottledState('a string')).not.toThrow()
    expect(() => cancelThrottledCalls({}, 'anything')).not.toThrow() // 有宿主、无状态表
    expect(() => disposeThrottledState({})).not.toThrow()
    jest.advanceTimersByTime(500)
    expect(jest.getTimerCount()).toBe(0)
  })

  it('静态方法宿主（函数）也能被 cancel / dispose 入口定位', () => {
    jest.useFakeTimers()
    class Statics {
      static calls: number[] = []

      @withThrottle(100)
      static hit(value: number): void {
        Statics.calls.push(value)
      }
    }

    Statics.hit(1)
    jest.advanceTimersByTime(10)
    Statics.hit(2)
    expect(jest.getTimerCount()).toBe(1)

    disposeThrottledState(Statics)
    expect(jest.getTimerCount()).toBe(0)
    jest.advanceTimersByTime(500)
    expect(Statics.calls).toEqual([1])
  })
})

describe('withDebounce：挂起调用的 cancel / flush / dispose', () => {
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  class Search {
    calls: string[] = []

    @withDebounce(50)
    async run(value: string): Promise<string> {
      this.calls.push(value)
      return value
    }
  }

  it('cancel 入口：dispose 点之后挂起的防抖不再执行，两个挂起 Promise 都以「已取消」结算', async () => {
    jest.useFakeTimers()
    const host = new Search()
    const first = host.run('a')
    const second = host.run('ab')
    expect(jest.getTimerCount()).toBe(1)

    cancelDebouncedCalls(host)
    expect(jest.getTimerCount()).toBe(0)

    await jest.advanceTimersByTimeAsync(500)
    expect(host.calls).toEqual([])
    await expect(first).rejects.toThrow('[withDebounce] pending call was cancelled')
    await expect(second).rejects.toThrow('[withDebounce] pending call was cancelled')
  })

  it('cancel 幂等：二次 cancel 是 no-op，只留下一条取消 rejection', async () => {
    jest.useFakeTimers()
    const host = new Search()
    const pending = host.run('a')

    cancelDebouncedCalls(host)
    cancelDebouncedCalls(host) // 队列已清空 → 早退
    await jest.advanceTimersByTimeAsync(500)

    await expect(pending).rejects.toThrow(/cancelled/)
    expect(host.calls).toEqual([])
    expect(jest.getTimerCount()).toBe(0)
  })

  it('dispose 的 rejection 有归宿：fire-and-forget 的挂起调用不冒泡成 unhandledRejection', async () => {
    jest.useFakeTimers()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const host = new Search()
      void host.run('a') // 调用方不留 handler：卸载点上最常见的形态
      void host.run('ab')
      disposeDebouncedState(host)
      await jest.advanceTimersByTimeAsync(500)
      await drainMicrotasks()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('flush 入口：立即执行一次且只一次，全部挂起 Promise 按同一次结果合并结算', async () => {
    jest.useFakeTimers()
    const host = new Search()
    const first = host.run('a')
    const second = host.run('ab')
    expect(jest.getTimerCount()).toBe(1)

    flushDebouncedCalls(host)
    await expect(Promise.all([first, second])).resolves.toEqual(['ab', 'ab'])
    expect(host.calls).toEqual(['ab'])
    expect(jest.getTimerCount()).toBe(0)

    flushDebouncedCalls(host) // 队列已空 → no-op
    await jest.advanceTimersByTimeAsync(500)
    expect(host.calls).toEqual(['ab'])
  })

  it('flush 不凭空执行：定时器已自然到期（无挂起）后 flush 不再调用原方法', async () => {
    jest.useFakeTimers()
    const host = new Search()
    const fired = host.run('a')
    await jest.advanceTimersByTimeAsync(50) // 自然到期
    await expect(fired).resolves.toBe('a')
    expect(host.calls).toEqual(['a'])

    flushDebouncedCalls(host)
    await jest.advanceTimersByTimeAsync(500)
    expect(host.calls).toEqual(['a'])
    expect(jest.getTimerCount()).toBe(0)
  })

  it('flush 保持原方法失败的既有语义：reject 挂起队列而不是静默兜住', async () => {
    jest.useFakeTimers()
    class Failing {
      @withDebounce(50)
      async go(): Promise<never> {
        throw new Error('real failure')
      }
    }
    const host = new Failing()
    const pending = host.go()
    flushDebouncedCalls(host)

    await expect(pending).rejects.toThrow('real failure')
    await drainMicrotasks()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('dispose 入口：取消挂起调用并释放状态，同一宿主之后仍能正常防抖', async () => {
    jest.useFakeTimers()
    const host = new Search()
    const pending = host.run('a')

    disposeDebouncedState(host)
    await expect(pending).rejects.toThrow(/cancelled/)
    expect(jest.getTimerCount()).toBe(0)

    const first = host.run('b')
    const second = host.run('c')
    await jest.advanceTimersByTimeAsync(50)
    await expect(first).resolves.toBe('c')
    await expect(second).resolves.toBe('c')
    expect(host.calls).toEqual(['c'])
  })

  it('多实例互不影响：cancel 一个宿主不会清掉同类另一宿主的挂起调用', async () => {
    jest.useFakeTimers()
    const a = new Search()
    const b = new Search()
    const pa = a.run('a')
    const pb = b.run('b')

    cancelDebouncedCalls(a)
    await expect(pa).rejects.toThrow(/cancelled/)
    await jest.advanceTimersByTimeAsync(50)

    expect(a.calls).toEqual([])
    expect(b.calls).toEqual(['b'])
    await expect(pb).resolves.toBe('b')
    expect(jest.getTimerCount()).toBe(0)
  })

  it('按方法名定位：只取消点名的方法，另一方法的挂起调用照常触发', async () => {
    jest.useFakeTimers()
    class TwoMethods {
      firstCalls: string[] = []
      secondCalls: string[] = []

      @withDebounce(50)
      async first(value: string): Promise<string> {
        this.firstCalls.push(value)
        return value
      }

      @withDebounce(50)
      async second(value: string): Promise<string> {
        this.secondCalls.push(value)
        return value
      }
    }

    const host = new TwoMethods()
    const p1 = host.first('a')
    const p2 = host.second('a')
    expect(jest.getTimerCount()).toBe(2)

    cancelDebouncedCalls(host, 'first')
    cancelDebouncedCalls(host, 'notADecoratedMethod') // 点错名：no-op
    await expect(p1).rejects.toThrow(/cancelled/)
    await jest.advanceTimersByTimeAsync(50)

    expect(host.firstCalls).toEqual([])
    expect(host.secondCalls).toEqual(['a'])
    await expect(p2).resolves.toBe('a')
  })

  it('宿主为基本类型时入口不抛错，detached 调用仍各自结算自己的 Promise', async () => {
    jest.useFakeTimers()
    const detachedCalls: string[] = []
    // 方法体刻意不碰 `this`：宿主不可跟踪时防抖会按 undefined receiver 执行原方法
    class Detachable {
      @withDebounce(50)
      async run(value: string): Promise<string> {
        detachedCalls.push(value)
        return value
      }
    }
    const detached = wrapperOf(Detachable.prototype, 'run')
    const pending = detached.call(undefined, 'x') // this === undefined → 一次性本地状态

    expect(() => cancelDebouncedCalls(undefined)).not.toThrow()
    expect(() => flushDebouncedCalls(null)).not.toThrow()
    expect(() => disposeDebouncedState('a string')).not.toThrow()
    expect(() => disposeDebouncedState(42)).not.toThrow()
    expect(() => disposeDebouncedState({})).not.toThrow() // 有宿主、无状态表

    await jest.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toBe('x')
    expect(detachedCalls).toEqual(['x'])
  })

  it('静态方法宿主（函数）也能被 flush / dispose 入口定位', async () => {
    jest.useFakeTimers()
    class Statics {
      static calls: string[] = []

      @withDebounce(50)
      static async run(value: string): Promise<string> {
        Statics.calls.push(value)
        return value
      }
    }

    const flushed = Statics.run('a')
    expect(jest.getTimerCount()).toBe(1)
    flushDebouncedCalls(Statics)
    await expect(flushed).resolves.toBe('a')
    expect(Statics.calls).toEqual(['a'])

    const second = Statics.run('b')
    disposeDebouncedState(Statics)
    await expect(second).rejects.toThrow(/cancelled/)
    expect(jest.getTimerCount()).toBe(0)
  })
})

describe('挂起调用收尾入口的导出面与既有用法', () => {
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('六个公开入口经 extras 子入口可达（与装饰器同处一个导出桶）', () => {
    expect(typeof extrasIndex.cancelThrottledCalls).toBe('function')
    expect(typeof extrasIndex.flushThrottledCalls).toBe('function')
    expect(typeof extrasIndex.disposeThrottledState).toBe('function')
    expect(typeof extrasIndex.cancelDebouncedCalls).toBe('function')
    expect(typeof extrasIndex.flushDebouncedCalls).toBe('function')
    expect(typeof extrasIndex.disposeDebouncedState).toBe('function')
  })

  it('不破坏既有用法：@withDebounce 合并语义与 @withThrottle 的 assumeAsync 返回形态不变', async () => {
    jest.useFakeTimers()
    const searchCalls: number[] = []
    const throttleCalls: number[] = []

    class Legacy {
      @withDebounce(30)
      async search(value: number): Promise<number> {
        searchCalls.push(value)
        return value
      }

      @withThrottle(100, { leading: false, assumeAsync: true })
      late(value: number): void {
        throttleCalls.push(value)
      }
    }

    const host = new Legacy()
    const merged = Promise.all([host.search(1), host.search(2)])
    await jest.advanceTimersByTimeAsync(30)
    await expect(merged).resolves.toEqual([2, 2])
    expect(searchCalls).toEqual([2])

    // leading=false 且非 async 语法：assumeAsync 保证被抑制的调用仍返回 Promise
    const suppressed: unknown = host.late(3)
    expect(suppressed).toBeInstanceOf(Promise)
    await expect(suppressed as Promise<unknown>).resolves.toBeUndefined()
    await jest.advanceTimersByTimeAsync(100)
    expect(throttleCalls).toEqual([3])
  })
})
