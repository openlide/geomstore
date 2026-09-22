/**
 * 第五轮 extras-error 分片回归（R5-187 / R5-188 / R5-206 / R5-209 / R5-210 / R5-211 / R5-212）
 *
 * 覆盖的公开行为：
 * - ErrorHandler 交给 handler 的是副本，内部记录也与调用方的对象解耦
 * - async handler 的 rejection 被就地折成一条日志，不成为 unhandledRejection
 * - withErrorBoundary 只对「被包裹方法的原始返回值」做 thenable 判定
 * - clear() 作废在途 flush 的重入队
 * - 队列溢出丢弃量可被统计消费（getDroppedErrors），容量入参有下限
 */

import { ErrorHandlerImpl, createErrorContext, ErrorMonitoring, ErrorAggregator } from '@/extras/error/index.js'
import { withErrorBoundary } from '@/extras/error/ErrorBoundary.js'
import type { ErrorContext } from '@/types/error.js'

function context(overrides: Partial<ErrorContext> = {}): ErrorContext {
  return {
    storeName: 'probe-store',
    operation: 'dispatch',
    error: new Error('probe'),
    level: 'error',
    timestamp: 1,
    ...overrides,
  }
}

/** 把装饰器套到一个方法描述符上，返回宿主对象 */
function decorate(value: () => unknown, options?: Parameters<typeof withErrorBoundary>[0]): { call: () => unknown } {
  const descriptor: PropertyDescriptor = { value, writable: true, configurable: true, enumerable: true }
  withErrorBoundary(options)({}, 'loadData', descriptor)
  return { call: descriptor.value as () => unknown }
}

describe('R5-187 handler 收到副本', () => {
  it('改写 handler 拿到的上下文不影响 errorLog / 统计', () => {
    const handler = new ErrorHandlerImpl()
    const seen: ErrorContext[] = []
    handler.setHandler((ctx) => seen.push(ctx))

    const original = createErrorContext('user-store', 'action-execution', new Error('boom'), 'error')
    handler.handleError(original)

    expect(seen).toHaveLength(1)
    expect(seen[0]).not.toBe(original)
    seen[0].level = 'critical'
    seen[0].error = new Error('replaced')

    expect(handler.getLastError()?.level).toBe('error')
    expect(handler.getLastError()?.error.message).toBe('boom')
    expect(handler.getErrorStats().byLevel.error).toBe(1)
    expect(handler.getErrorStats().byLevel.critical).toBeUndefined()
  })

  it('调用方在 handleError 之后改写自己那份上下文同样不污染记录', () => {
    const handler = new ErrorHandlerImpl()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const original = createErrorContext('user-store', 'dispatch', new Error('boom'), 'error')

    handler.handleError(original)
    original.storeName = 'tampered'
    original.level = 'critical'

    expect(handler.getErrorLog()[0].storeName).toBe('user-store')
    expect(handler.getErrorLog()[0].level).toBe('error')
    expect(handler.getErrorsByLevel('critical')).toHaveLength(0)
    jest.restoreAllMocks()
  })
})

describe('R5-188 async handler 的 rejection 不外溢', () => {
  it('返回被拒绝的 Promise 时折成一条 console.error，且不产生未处理拒绝', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const handler = new ErrorHandlerImpl()
    const rejection = new Error('handler async boom')
    handler.setHandler(async () => {
      throw rejection
    })

    expect(() => handler.handle('user-store', 'dispatch', new Error('x'))).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    expect(errorSpy).toHaveBeenCalledWith('[ErrorHandler] Error in error handler:', rejection)
    errorSpy.mockRestore()
  })

  it('自定义 handler 仍收到同一条上下文（同步路径不因兜底而改变返回时机）', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const handler = new ErrorHandlerImpl()
    const seen: unknown[] = []
    handler.setHandler((ctx) => {
      seen.push(ctx)
    })

    handler.handle('s', 'dispatch', new Error('boom'))

    // 同步 handler 返回 undefined：不得被当成 thenable 建 Promise 链
    expect(seen).toHaveLength(1)
    expect(errorSpy).not.toHaveBeenCalledWith('[ErrorHandler] Error in error handler:', expect.any(Error))
    errorSpy.mockRestore()
  })
})

describe('R5-206 withErrorBoundary 只判定被包裹方法的原始返回值', () => {
  it('回退值自带 callable then 时按原值返回，不再被 re-wrap 成 Promise', () => {
    const fallback = { then: () => 'not-a-promise', value: 1 }
    const host = decorate(
      () => {
        throw new Error('boom')
      },
      { recoverable: true, fallback: fallback as never },
    )

    expect(host.call()).toBe(fallback)
  })

  it('方法自己的返回值是自定义 thenable 时仍被等待（#263 契约不因本修复回退）', async () => {
    const onError = jest.fn()
    const host = decorate(
      () => ({
        then: (_resolve: unknown, reject: (reason: unknown) => void) => reject(new Error('thenable boom')),
      }),

      { onError, recoverable: true, fallback: 'fb' },
    )

    const returned = host.call()
    expect(typeof (returned as Promise<unknown>).then).toBe('function')
    await expect(returned as Promise<unknown>).resolves.toBe('fb')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('被装饰的 async 方法的 rejection 仍被边界捕获', async () => {
    const onError = jest.fn()
    const host = decorate(
      () => Promise.reject(new Error('async boom')),

      { onError, recoverable: true, fallback: 'fb' },
    )

    await expect(Promise.resolve(host.call())).resolves.toBe('fb')
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0][0] as Error).message).toBe('async boom')
  })

  it('方法同步抛出时不会再对回退值走一次异步包裹', async () => {
    const host = decorate(
      () => {
        throw new Error('sync boom')
      },
      { recoverable: true, fallback: 0 },
    )

    expect(host.call()).toBe(0)
  })
})

describe('R5-209 clear() 作废在途 flush 的重入队', () => {
  it('在途批次全部报告器失败时既不重新入队，也不给连续失败计数加进度', async () => {
    jest.useFakeTimers()
    const internal = (monitoring: ErrorMonitoring) => monitoring as unknown as { errorQueue: ErrorContext[]; consecutiveFlushFailures: number }
    let release: () => void = () => {}
    let batchStarted = 0
    const reporter = {
      getName: () => 'slow-failing',
      report: async () => {},
      // 报告器挂起，直到用例放行：确保 clear() 发生在 flush 在途期间
      reportBatch: () => {
        batchStarted++
        return new Promise<void>((_resolve, reject) => {
          release = () => reject(new Error('endpoint down'))
        })
      },
    }
    // batchThreshold 取大值：flush 由用例显式发起，最后的「新周期」断言也不会顺带触发第二次在途请求
    const monitoring = new ErrorMonitoring({ reporters: [reporter], batchThreshold: 1_000_000, batchInterval: 3_600_000, enableConsoleLog: false })
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    // 必须先入队再 flush：空队列时 flushReports 走入口守卫直接返回，
    // 「clear() 与在途 flush 交错」这一场景根本没被构造出来（断言会空转）
    await monitoring.report(context({ storeName: 'old-generation' }))
    const flushed = monitoring.flushReports()
    await jest.advanceTimersByTimeAsync(1)
    // 确认 flush 真的在途（reportBatch 已被调用且尚未 settle），否则本用例又是空跑
    expect(batchStarted).toBe(1)

    monitoring.clear()
    release()
    await flushed
    await jest.advanceTimersByTimeAsync(1)

    // 修复前：失败批次被塞回已清空的队列（等于 clear() 没生效），
    // consecutiveFlushFailures 也从刚归零的 0 被带回 1（clear() 承诺不泄漏的进度又泄漏了）
    expect(internal(monitoring).errorQueue).toHaveLength(0)
    expect(internal(monitoring).consecutiveFlushFailures).toBe(0)

    // 新周期的数据只含 clear() 之后入队的那条
    await monitoring.report(context({ storeName: 'new-generation' }))
    expect(internal(monitoring).errorQueue.map((ctx) => ctx.storeName)).toEqual(['new-generation'])

    warnSpy.mockRestore()
    jest.restoreAllMocks()
    jest.useRealTimers()
  })
})

describe('R5-210 / R5-212 队列溢出口径与容量下限', () => {
  it('入队淘汰与重入队裁剪都计入 droppedErrors，clear() 归零', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const failingReporter = {
      getName: () => 'failing',
      report: async () => {},
      reportBatch: async () => {
        throw new Error('endpoint down')
      },
    }
    const monitoring = new ErrorMonitoring({
      reporters: [failingReporter],
      batchThreshold: 1_000_000,
      batchInterval: 3_600_000,
      enableConsoleLog: false,
      maxQueueSize: 3,
    })
    const internal = monitoring as unknown as { errorQueue: unknown[] }

    for (let i = 0; i < 5; i++) {
      await monitoring.report(context({ storeName: `s${i}` }))
    }
    expect(monitoring.getDroppedErrors()).toBe(2)
    expect(internal.errorQueue).toHaveLength(3)
    // totalErrors 的口径是「观测到的错误」：被丢弃的两条仍计入，但可单独查丢失量
    expect(monitoring.generateReport().summary.totalErrors).toBe(5)
    // 丢失量必须随报告快照一起出去（plugins-types-p1 交接项）：只有 getDroppedErrors() 可取时，
    // 拿到报告去写日志/上传/看板的下游读到的是「总数对得上」的报表，丢包在下游完全不可见
    expect(monitoring.generateReport().summary.droppedErrors).toBe(2)

    monitoring.clear()
    expect(monitoring.getDroppedErrors()).toBe(0)

    await monitoring.shutdown()
    warnSpy.mockRestore()
  })

  it('重入队超容量时的裁剪同样记账并告警', async () => {
    jest.useFakeTimers()
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const failingReporter = {
      getName: () => 'failing',
      report: async () => {},
      reportBatch: async () => {
        throw new Error('endpoint down')
      },
    }
    const monitoring = new ErrorMonitoring({
      reporters: [failingReporter],
      batchThreshold: 1_000_000,
      batchInterval: 3_600_000,
      enableConsoleLog: false,
      maxQueueSize: 5,
    })
    const internal = monitoring as unknown as { errorQueue: unknown[] }

    // 直接造出超容量的重入队态（report() 入口会先把队列裁到容量内）
    for (let i = 0; i < 7; i++) {
      internal.errorQueue.push(context({ storeName: `s${i}` }))
    }
    await monitoring.flushReports()
    await jest.advanceTimersByTimeAsync(1)

    expect(monitoring.getDroppedErrors()).toBe(2)
    expect(internal.errorQueue).toHaveLength(5)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dropped 2 oldest error(s)'))

    await monitoring.shutdown()
    warnSpy.mockRestore()
    jest.useRealTimers()
  })

  it('maxQueueSize 取 0/负数时夹到下限 1、非有限值回退缺省，而不是让链路近乎失效', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = {
      getName: () => 'probe',
      report: async () => {},
      reportBatch: async (contexts: ErrorContext[]) => {
        seen.push(contexts.length)
      },
    }
    const seen: number[] = []

    for (const [config, expected] of [
      [0, 1],
      [-5, 1],
      [Number.NaN, 1000],
      [Number.POSITIVE_INFINITY, 1000],
    ] as const) {
      const monitoring = new ErrorMonitoring({
        reporters: [reporter],
        batchThreshold: 1_000_000,
        batchInterval: 3_600_000,
        enableConsoleLog: false,
        maxQueueSize: config,
      })
      const internal = monitoring as unknown as { errorQueue: unknown[]; maxQueueSize: number }

      await monitoring.report(context({ storeName: 'a' }))
      await monitoring.report(context({ storeName: 'b' }))
      // 修复前：maxQueueSize 为 0 时 `length >= 0` 恒真，每条新错误都先 shift 掉上一条
      expect(internal.maxQueueSize).toBe(expected)
      expect(internal.errorQueue).toHaveLength(expected === 1 ? 1 : 2)
      expect(monitoring.getDroppedErrors()).toBe(expected === 1 ? 1 : 0)

      await monitoring.shutdown()
    }
    // 最终 flush 投递过 2 条的批次：容量下限没把批次清空
    expect(Math.max(...seen)).toBe(2)
    warnSpy.mockRestore()
    jest.restoreAllMocks()
  })

  it('maxFlushRetries 为负数时按 0 处理（首批失败即丢弃，而非提前丢弃）', async () => {
    jest.useFakeTimers()
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const failingReporter = {
      getName: () => 'failing',
      report: async () => {},
      reportBatch: async () => {
        throw new Error('endpoint down')
      },
    }
    const monitoring = new ErrorMonitoring({
      reporters: [failingReporter],
      batchThreshold: 1,
      batchInterval: 3_600_000,
      enableConsoleLog: false,
      maxFlushRetries: -3,
    })
    const internal = monitoring as unknown as { maxFlushRetries: number; errorQueue: unknown[] }

    expect(internal.maxFlushRetries).toBe(0)
    await monitoring.report(context())
    await jest.advanceTimersByTimeAsync(1)
    // 首批即达上限 → 丢弃本批，不留悬挂条目
    expect(internal.errorQueue).toHaveLength(0)

    await monitoring.shutdown()
    warnSpy.mockRestore()
    jest.useRealTimers()
  })
})

describe('R5-211 聚合结果对外是副本', () => {
  it('ErrorMonitoring.getErrorGroups / generateReport 改写不回内部状态', async () => {
    const reporter = { getName: () => 'noop', report: async () => {}, reportBatch: async () => {} }
    const monitoring = new ErrorMonitoring({ reporters: [reporter], batchThreshold: 1_000_000, batchInterval: 3_600_000, enableConsoleLog: false })
    await monitoring.report(context({ storeName: 's1' }))

    const groups = monitoring.getErrorGroups()
    groups[0].count = 999
    groups[0].affectedStores.push('tampered')
    groups[0].sampleError.level = 'critical'

    const report = monitoring.generateReport()
    expect(report.summary.totalErrors).toBe(1)
    expect(report.byStore.s1).toBe(1)
    expect(report.byStore.tampered).toBeUndefined()
    expect(report.topErrors[0].affectedStores).toEqual(['s1'])
    expect(monitoring.getAggregationStats().totalErrors).toBe(1)

    await monitoring.shutdown()
  })

  it('ErrorAggregator.getGroups 的副本彼此独立', () => {
    const aggregator = new ErrorAggregator(2)
    aggregator.addError(context({ storeName: 's1' }))

    const first = aggregator.getGroups()
    const second = aggregator.getGroups()
    expect(first[0]).not.toBe(second[0])
    expect(first[0].affectedStores).not.toBe(second[0].affectedStores)

    first[0].count = 42
    expect(aggregator.getStats().totalErrors).toBe(1)
  })
})
