/**
 * OCR medium 第四轮 p2 分片（G2-extras/error）回归用例
 *
 * 覆盖：#260 clear() 重置连续失败计数、#262 execute/executeAsync 诚实返回 undefined、
 * #263 装饰器对自定义 thenable 的捕获、#267 重试额度键级清除、#268 前置校验错误可回溯、
 * #271 wx 分支 timeout 透传、#273 wx 分支 data 直传 JSON 字符串。
 */

import { ErrorBoundary, ErrorMonitoring, ErrorRecovery, HttpReporter, RecoveryStrategy, isGeomStoreError, ErrorCode } from '@/extras/error/index.js'
import { GeomStoreError } from '@/core/errors/GeomStoreError.js'
import { withErrorBoundary } from '@/extras/error/ErrorBoundary.js'

/** 供 report/HttpReporter 使用的最小错误上下文 */
function errorContext(overrides: Record<string, unknown> = {}): any {
  return {
    level: 'error',
    error: new Error('probe'),
    storeName: 'probe-store',
    operation: 'probe-op',
    timestamp: 1,
    ...overrides,
  }
}

/** 备份/还原全局键（setup.ts 注入了全局 wx，用例必须自还原） */
function withGlobalWx(wx: unknown, run: () => Promise<void>): Promise<void> {
  const backup = (globalThis as any).wx
  Object.assign(globalThis, { wx })
  return run().finally(() => {
    if (backup === undefined) {
      Reflect.deleteProperty(globalThis, 'wx')
    } else {
      Object.assign(globalThis, { wx: backup })
    }
  })
}

describe('#260 ErrorMonitoring.clear() 重置连续失败计数', () => {
  const failingReporter = {
    getName: () => 'failing',
    report: async () => {},
    reportBatch: async () => {
      throw new Error('endpoint down')
    },
  }

  it('#260 clear() 后的新批次重新获得完整 maxFlushRetries 额度', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const monitoring = new ErrorMonitoring({
      reporters: [failingReporter],
      batchThreshold: 100,
      batchInterval: 1_000_000,
      reportTimeout: 0,
      maxFlushRetries: 1,
      enableConsoleLog: false,
    } as any)

    try {
      await monitoring.report(errorContext())
      await monitoring.flushReports()
      // 第 1 次失败：1 > 1 不成立 → 重入队，不丢弃
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('丢弃'))

      monitoring.clear()

      await monitoring.report(errorContext({ error: new Error('post-clear') }))
      await monitoring.flushReports()
      // 修复前：clear() 前累计的计数残留，此处 2 > 1 直接触发丢弃告警
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('丢弃'))
      // clear() 只清数据，新批次应仍在队列中等待下次 flush（额度未被提前烧掉）
      expect((monitoring as unknown as { errorQueue: unknown[] }).errorQueue.length).toBeGreaterThan(0)
    } finally {
      await monitoring.shutdown()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})

describe('#262 ErrorBoundary 返回类型诚实化', () => {
  it('#262 recoverable 且未配 fallback 时 execute 返回 undefined（F 显式非 undefined 亦如此）', () => {
    const boundary = new ErrorBoundary<{ count: number }, string>({ recoverable: true })

    const result = boundary.execute(() => {
      throw new Error('boom')
    })
    expect(result).toBeUndefined()
  })

  it('#262 executeAsync 同路径返回 undefined 而非谎称 T | F', async () => {
    const boundary = new ErrorBoundary<{ count: number }, string>({ recoverable: true })

    const result = await boundary.executeAsync(async () => {
      throw new Error('boom')
    })
    expect(result).toBeUndefined()
  })

  it('#262 setFallbackState(undefined) 撤销回退值后返回 undefined', () => {
    const boundary = new ErrorBoundary<undefined, string>({ recoverable: true, fallback: 'fb' })
    boundary.setFallbackState(undefined as unknown as string)

    expect(
      boundary.execute(() => {
        throw new Error('boom')
      }),
    ).toBeUndefined()
  })
})

describe('#263 withErrorBoundary 捕获跨 realm/自定义 thenable 的 rejection', () => {
  it('#263 被装饰方法返回非 Promise 的 thenable 时，其 rejection 仍走边界而非成为未处理拒绝', async () => {
    const onError = jest.fn()
    const descriptor: PropertyDescriptor = {
      value: function () {
        // 模拟自定义 thenable（instanceof Promise 为 false）
        return {
          then(_resolve: unknown, reject: (reason: unknown) => void) {
            reject(new Error('thenable boom'))
          },
        }
      },
      writable: true,
      configurable: true,
      enumerable: true,
    }
    withErrorBoundary({ onError, recoverable: true } as any)({}, 'loadData', descriptor)
    const host = { loadData: descriptor.value as () => Promise<unknown> }

    await expect(host.loadData()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0][0] as Error).message).toBe('thenable boom')
  })

  it('#263 返回普通对象（非 thenable）不被误包装，原样透传', async () => {
    const descriptor: PropertyDescriptor = {
      value: function () {
        return { count: 1 }
      },
      writable: true,
      configurable: true,
      enumerable: true,
    }
    withErrorBoundary({ recoverable: true } as any)({}, 'loadData', descriptor)
    const host = { loadData: descriptor.value as () => unknown }

    expect(host.loadData()).toEqual({ count: 1 })
  })
})

describe('#267 重试额度按当前键清除，不按 error.code 级联', () => {
  it('#267 恢复成功只清当前 (store, operation) 键，同码其他进行中的额度保留', async () => {
    const recovery = new ErrorRecovery()
    recovery.configure({ PROBE_CODE: { strategy: RecoveryStrategy.RETRY, maxRetries: 2, retryDelay: 0 } })

    // A 用掉第 1 次尝试（RETRY 重抛原错误，message 恰为 'boom'）
    await expect(recovery.recover(new GeomStoreError('boom', 'PROBE_CODE'), { storeName: 'A', operation: 'op' })).rejects.toThrow(/^boom$/)

    // 同码重配为 RECOVER：B 恢复成功，不得级联抹掉 A 已累计的尝试
    recovery.configure({ PROBE_CODE: { strategy: RecoveryStrategy.RECOVER, recoverFn: () => 'ok' } })
    await expect(recovery.recover(new GeomStoreError('other', 'PROBE_CODE'), { storeName: 'B', operation: 'op' })).resolves.toBe('ok')

    recovery.configure({ PROBE_CODE: { strategy: RecoveryStrategy.RETRY, maxRetries: 2, retryDelay: 0 } })
    // A 剩余额度只有 1 次：第 2 次重抛原错误，第 3 次即触发 max-retries 保护
    await expect(recovery.recover(new GeomStoreError('boom', 'PROBE_CODE'), { storeName: 'A', operation: 'op' })).rejects.toThrow(/^boom$/)
    await expect(recovery.recover(new GeomStoreError('boom', 'PROBE_CODE'), { storeName: 'A', operation: 'op' })).rejects.toThrow(/Max retries/)
  })

  it('#267 RESTART 成功同样仅清自身键，不误放同码其他键的重试风暴保护', async () => {
    const recovery = new ErrorRecovery()
    recovery.configure({ PROBE_CODE: { strategy: RecoveryStrategy.RETRY, maxRetries: 2, retryDelay: 0 } })
    await expect(recovery.recover(new GeomStoreError('boom', 'PROBE_CODE'), { storeName: 'A', operation: 'op' })).rejects.toThrow(/^boom$/)

    recovery.configure({ PROBE_CODE: { strategy: RecoveryStrategy.RESTART } })
    await expect(recovery.recover(new GeomStoreError('x', 'PROBE_CODE'), { storeName: 'B', operation: 'op' })).resolves.toBeUndefined()

    recovery.configure({ PROBE_CODE: { strategy: RecoveryStrategy.RETRY, maxRetries: 2, retryDelay: 0 } })
    await expect(recovery.recover(new GeomStoreError('boom', 'PROBE_CODE'), { storeName: 'A', operation: 'op' })).rejects.toThrow(/^boom$/)
    await expect(recovery.recover(new GeomStoreError('boom', 'PROBE_CODE'), { storeName: 'A', operation: 'op' })).rejects.toThrow(/Max retries/)
  })
})

describe('#268 recover 前置校验错误可回溯', () => {
  it('#268 非 GeomStoreError 抛出为带 PARAMETER_ERROR 码的 GeomStoreError，原始值挂 cause', async () => {
    const recovery = new ErrorRecovery()
    const original = new Error('plain outer')

    const thrown = await recovery.recover(original).catch((e: unknown) => e)
    expect(isGeomStoreError(thrown)).toBe(true)
    expect((thrown as GeomStoreError).code).toBe(ErrorCode.PARAMETER_ERROR)
    expect((thrown as Error & { cause?: unknown }).cause).toBe(original)
    expect((thrown as Error).message).toContain('[ErrorRecovery] Can only recover GeomStoreError instances')
  })

  it('#268 未配置策略时抛出保留 originalCode 并挂入错错误为 cause', async () => {
    const recovery = new ErrorRecovery()
    const error = new GeomStoreError('boom', 'NO_SUCH_CODE')

    const thrown = await recovery.recover(error).catch((e: unknown) => e)
    expect(isGeomStoreError(thrown)).toBe(true)
    expect((thrown as GeomStoreError).code).toBe(ErrorCode.INTERNAL_ERROR)
    expect((thrown as GeomStoreError).context).toEqual({ originalCode: 'NO_SUCH_CODE' })
    expect((thrown as Error & { cause?: unknown }).cause).toBe(error)
    expect((thrown as Error).message).toContain('No recovery strategy configured for error code: NO_SUCH_CODE')
  })
})

describe('#271/#273 HttpReporter wx.request 分支的请求构造', () => {
  it('#271 配置的 timeout 透传给 wx.request，未配置时不注入该键', async () => {
    const calls: any[] = []
    await withGlobalWx(
      {
        request: (opts: any) => {
          calls.push(opts)
          opts.success?.({ statusCode: 200 })
        },
      },
      async () => {
        const withTimeout = new HttpReporter('https://example.com/report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          timeout: 3000,
        })
        await withTimeout.report(errorContext())
        expect(calls[0].timeout).toBe(3000)

        const withoutTimeout = new HttpReporter('https://example.com/report')
        await withoutTimeout.report(errorContext())
        expect('timeout' in calls[1]).toBe(false)
      },
    )
  })

  it('#273 data 为原始 JSON 字符串，不再经 JSON.parse 往返', async () => {
    const calls: any[] = []
    await withGlobalWx(
      {
        request: (opts: any) => {
          calls.push(opts)
          opts.success?.({ statusCode: 200 })
        },
      },
      async () => {
        const reporter = new HttpReporter('https://example.com/report')
        await reporter.reportBatch([errorContext({ storeName: 's1', operation: 'op1' })])

        const sent = calls[0]
        expect(typeof sent.data).toBe('string')
        // 线上字节与旧路径（parse 后由 wx 再序列化）等价：合法 JSON 且内容一致
        expect(JSON.parse(sent.data)).toMatchObject({ errors: [expect.objectContaining({ storeName: 's1', operation: 'op1' })] })
        expect(sent.header).toEqual({ 'Content-Type': 'application/json' })
      },
    )
  })
})
