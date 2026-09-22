/**
 * G2-extras low 第 1 片（#202 / #204 / #216 / #220 / #236 / #253 / #264 / #275 / #280 / #281）的回归用例
 *
 * 逐条锁定本轮 low 波次里「判定成立且会改变可观察行为」的部分，
 * 以及几条纯重构（节流助手提升、上报投影合并、retries 校验收敛）的等价性护栏。
 * 纯文档/注释类判定（#181、#182、#195、#215、#229、#230、#232、#243、#256、#265、#270、#276、#278）
 * 不产生新行为，故不在本文件立测。
 */

import { isAsyncFunction } from '@/extras/action/decorators/common.js'
import { withCache } from '@/extras/action/decorators/cache.js'
import { withDebounce } from '@/extras/action/decorators/debounce.js'
import { withThrottle } from '@/extras/action/decorators/throttle.js'
import { retryWithBackoff } from '@/extras/action/async-core.js'
import { createRetrySelector, createRetrySelectorAsync } from '@/extras/selector/retrySelector.js'
import { DEFAULT_MAX_LOG_SIZE, ErrorHandlerImpl } from '@/extras/error/ErrorHandler.js'
import { ErrorBoundary } from '@/extras/error/ErrorBoundary.js'
import { HttpReporter } from '@/extras/error/reporters/HttpReporter.js'
import type { ErrorContext } from '@/types/error.js'

/** 执行一次并捕获抛出的值 */
async function capture(fn: () => unknown): Promise<Error & { attempts?: number }> {
  try {
    await fn()
  } catch (error) {
    return error as Error & { attempts?: number }
  }
  throw new Error('expected the call to throw')
}

describe('#202 isAsyncFunction 对 getPrototypeOf 抛错的宿主降级', () => {
  it('Proxy 的 getPrototypeOf 陷阱抛错时返回 false，而不是让装饰器崩掉', () => {
    const trapThrows = new Proxy(
      function () {
        /* 被装饰方法的替身 */
      },
      {
        getPrototypeOf(): never {
          throw new TypeError('getPrototypeOf trap')
        },
      },
    )

    expect(isAsyncFunction(trapThrows)).toBe(false)
    // 正常路径不受保护逻辑影响
    expect(isAsyncFunction(async () => undefined)).toBe(true)
    expect(isAsyncFunction(() => undefined)).toBe(false)
    expect(isAsyncFunction('not a function')).toBe(false)
  })

  it('bound async 函数仍判为 true（实测 V8/规范：bind 保留 %AsyncFunction.prototype% 原型）', () => {
    // 审计报告的「`asyncFn.bind(ctx)` 原型是 Function.prototype，故被误判为同步」并不成立：
    // BoundFunctionCreate 会按目标函数的 realm 取 %AsyncFunction% 作原型，
    // 因此这条误报不需要兜底；跨 realm 的原型身份差异才是真实边界
    expect(isAsyncFunction(async function () {}.bind({}))).toBe(true)
  })
})

describe('#204 retryWithBackoff 的 onRetry 异常不改变重试结果', () => {
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('onRetry 抛错时继续重试并返回成功结果', async () => {
    let calls = 0

    const result = await retryWithBackoff(
      async () => {
        calls += 1
        if (calls < 3) throw new Error('flaky')
        return 'ok'
      },
      {
        retries: 3,
        delay: 0,
        onRetry: () => {
          throw new Error('observer boom')
        },
      },
    )

    expect(result).toBe('ok')
    expect(calls).toBe(3)
    expect(errorSpy).toHaveBeenCalledWith('[retryWithBackoff] Error in onRetry callback:', expect.any(Error))
  })

  it('onRetry 抛错不会顶替最终失败原因', async () => {
    await expect(
      retryWithBackoff(
        async () => {
          throw new Error('real failure')
        },
        {
          retries: 1,
          delay: 0,
          onRetry: () => {
            throw new Error('observer boom')
          },
        },
      ),
    ).rejects.toThrow('real failure')
  })
})

describe('#216 宿主不可跟踪时 withDebounce 降级为「每次调用各自定时」', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('detached 调用不合并：两次调用各执行一次、各结算自己的 Promise', async () => {
    jest.useFakeTimers()
    const seen: number[] = []

    class DetachedHost {
      @withDebounce(50)
      async run(value: number) {
        seen.push(value)
        return value
      }
    }

    // 严格模式下脱离宿主调用：this === undefined → 走一次性状态分支
    const detached = new DetachedHost().run
    const first = detached(1)
    const second = detached(2)
    jest.runAllTimers()

    // 现状即「防抖失效」：两个定时器都在、两次执行都发生（JSDoc/注释已按此写明）
    expect(await Promise.all([first, second])).toEqual([1, 2])
    expect(seen).toEqual([1, 2])
  })
})

describe('#220 withCache 的用户 keyFn 抛错时降级为不缓存', () => {
  let debugSpy: jest.SpyInstance

  beforeEach(() => {
    debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined)
  })
  afterEach(() => {
    debugSpy.mockRestore()
  })

  it('keyFn 抛错不再让被装饰方法整体失败', async () => {
    let calls = 0

    class BrokenKeyHost {
      @withCache({
        ttl: 5000,
        keyFn: () => {
          throw new TypeError('keyFn boom')
        },
      })
      async load(id: string) {
        calls += 1
        return `data-${id}`
      }
    }

    const host = new BrokenKeyHost()
    await expect(host.load('a')).resolves.toBe('data-a')
    await expect(host.load('a')).resolves.toBe('data-a')
    // 每次都是唯一键 → 永不命中缓存，但也从不把键生成的故障外溢成业务失败
    expect(calls).toBe(2)
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[Cache] keyFn threw'), expect.any(Error))
  })

  it('keyFn 正常时缓存语义不变', async () => {
    let calls = 0

    class GoodKeyHost {
      @withCache({ ttl: 5000, keyFn: (id: unknown) => `k:${String(id)}` })
      async load(id: string) {
        calls += 1
        return `data-${id}`
      }
    }

    const host = new GoodKeyHost()
    await host.load('a')
    await host.load('a')
    expect(calls).toBe(1)
  })
})

describe('#253 withThrottle 助手提升到装饰阶段后的尾随语义', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('窗口内被抑制的调用以最新参数补发一次，宿主取自排程时传入的参数', () => {
    jest.useFakeTimers()

    class ScrollHost {
      calls: number[] = []

      @withThrottle(100)
      handle(position: number) {
        this.calls.push(position)
      }
    }

    const host = new ScrollHost()
    host.handle(1) // 新窗口 leading：立即执行
    host.handle(2) // 窗口内抑制：只记最新参数
    host.handle(3)
    jest.advanceTimersByTime(100)

    expect(host.calls).toEqual([1, 3])
  })

  it('连续抑制的多次调用只在窗口尾补发一次，不重复补发', () => {
    jest.useFakeTimers()

    class ScrollHost {
      calls: number[] = []

      @withThrottle(100)
      handle(position: number) {
        this.calls.push(position)
      }
    }

    const host = new ScrollHost()
    host.handle(1)
    host.handle(2) // 排程尾调用
    jest.advanceTimersByTime(100)
    expect(host.calls).toEqual([1, 2])

    // 补发已把 lastCallTime 推到窗口结束点，其后的调用继续落在新窗口内：
    // 反复重排只保留最后一次参数，且只触发一次
    host.handle(3)
    host.handle(4)
    jest.advanceTimersByTime(50)
    host.handle(5)
    jest.advanceTimersByTime(100)

    expect(host.calls).toEqual([1, 2, 5])
  })
})

describe('#236 ErrorHandler.setMaxLogSize 取整到实际容量', () => {
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('小数向下取整，非有限值回退默认值，且都保留最新若干条', () => {
    const handler = new ErrorHandlerImpl()
    handler.setMaxLogSize(5.9)
    for (let i = 0; i < 8; i++) {
      handler.handle('user-store', 'action-execution', new Error(`e${i}`))
    }
    expect(handler.getErrorLog()).toHaveLength(5)
    expect(handler.getErrorLog().map((ctx) => ctx.error.message)).toEqual(['e3', 'e4', 'e5', 'e6', 'e7'])

    handler.setMaxLogSize(Number.NaN)
    for (let i = 0; i < DEFAULT_MAX_LOG_SIZE + 3; i++) {
      handler.handle('user-store', 'action-execution', new Error(`f${i}`))
    }
    expect(handler.getErrorLog()).toHaveLength(DEFAULT_MAX_LOG_SIZE)
  })
})

describe('#264 ErrorBoundary 的历史上限与 ErrorHandler 同源', () => {
  it('超出上限时保留最新 DEFAULT_MAX_LOG_SIZE 条', () => {
    const boundary = new ErrorBoundary<{ n: number }>()

    for (let i = 0; i < DEFAULT_MAX_LOG_SIZE + 5; i++) {
      // 未配 fallback 且不可恢复：execute 记录后重抛原始错误
      expect(() =>
        boundary.execute(() => {
          throw new Error(`e${i}`)
        }),
      ).toThrow(`e${i}`)
    }

    const history = boundary.getErrorHistory()
    expect(history).toHaveLength(DEFAULT_MAX_LOG_SIZE)
    expect(history[0]?.message).toBe('e5')
    expect(history[history.length - 1]?.message).toBe(`e${DEFAULT_MAX_LOG_SIZE + 4}`)
  })
})

describe('#275 HttpReporter 单条与批量共用同一投影', () => {
  it('批量负载里的条目与单条上报的 body 结构一致', async () => {
    const bodies: string[] = []
    const reporter = new HttpReporter(
      'https://example.invalid/err',
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      async (_url: string, body: string) => {
        bodies.push(body)
      },
    )
    const context: ErrorContext = {
      storeName: 'user-store',
      operation: 'action-execution',
      error: new Error('boom'),
      level: 'error',
      timestamp: 1700000000000,
      payload: { actionName: 'login' },
    }

    await reporter.report(context)
    await reporter.reportBatch([context])

    expect(bodies).toHaveLength(2)
    const single = JSON.parse(String(bodies[0])) as Record<string, unknown>
    const batch = JSON.parse(String(bodies[1])) as { errors: Record<string, unknown>[] }
    expect(batch.errors).toHaveLength(1)
    expect(batch.errors[0]).toEqual(single)
  })
})

describe('#280 重试选择器的回调异常不顶替原始失败', () => {
  let errorSpy: jest.SpyInstance

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    errorSpy.mockRestore()
  })

  it('同步变体：shouldRetry 抛错按「不再重试」处理，原始错误仍带 attempts 标注', async () => {
    const selector = createRetrySelector<{ n: number }, number>(
      () => {
        throw new Error('original')
      },
      {
        retries: 3,
        shouldRetry: () => {
          throw new Error('predicate boom')
        },
      },
    )

    const caught = await capture(() => selector({ n: 1 }))

    expect(caught.message).toBe('original')
    expect(caught.attempts).toBe(1)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('shouldRetry threw'), expect.any(Error))
  })

  it('异步变体：delay 函数抛错时按 0 等待继续重试，尝试次数与标注不变', async () => {
    let calls = 0
    const selector = createRetrySelectorAsync<{ n: number }, number>(
      () => {
        calls += 1
        throw new Error('async original')
      },
      {
        retries: 2,
        delay: () => {
          throw new Error('delay boom')
        },
      },
    )

    const caught = await capture(() => selector({ n: 1 }))

    expect(caught.message).toBe('async original')
    expect(caught.attempts).toBe(3)
    expect(calls).toBe(3)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('delay threw'), expect.any(Error))
  })

  it('异步变体：shouldRetry 抛错时停止重试并抛出原始错误', async () => {
    let calls = 0
    const selector = createRetrySelectorAsync<{ n: number }, number>(
      () => {
        calls += 1
        throw new Error('async original')
      },
      {
        retries: 5,
        delay: 0,
        shouldRetry: () => {
          throw new Error('predicate boom')
        },
      },
    )

    const caught = await capture(() => selector({ n: 1 }))

    expect(caught.message).toBe('async original')
    expect(caught.attempts).toBe(1)
    expect(calls).toBe(1)
  })
})

describe('#281 两个重试工厂共用 retries 校验', () => {
  const message = '[SelectorComposer] retries 必须是非负整数，收到: -1'
  const selector = () => 1

  it('同步与异步变体对同一非法值给出同一条报错', () => {
    expect(() => createRetrySelector<{ n: number }, number>(selector, { retries: -1 })).toThrow(message)
    expect(() => createRetrySelectorAsync<{ n: number }, number>(selector, { retries: -1 })).toThrow(message)
    expect(() => createRetrySelector<{ n: number }, number>(selector, { retries: 1.5 })).toThrow(TypeError)
    expect(() => createRetrySelectorAsync<{ n: number }, number>(selector, { retries: 0 })).not.toThrow()
  })
})
