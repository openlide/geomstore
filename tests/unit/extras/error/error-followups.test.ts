/**
 * 错误子系统的后续修复回归：重试额度按调用上下文隔离、上报超时定时器回收、
 * 性能监控容量收缩、聚合器驱逐后的统计一致性、控制台分组闭合、
 * reportTimeout=0 语义、非 Error 抛出值归一化、恢复上下文受控字段
 */

import {
  ErrorRecovery,
  ErrorCode,
  RecoveryStrategy,
  createError,
  ErrorMonitoring,
  ErrorAggregator,
  ConsoleReporter,
  ErrorBoundary,
} from '@/extras/error/index.js'
import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor.js'

describe('ErrorRecovery 重试额度按调用上下文隔离', () => {
  it('recover 第二参数传入的 storeName/operation 参与重试键', async () => {
    const recovery = new ErrorRecovery()
    recovery.configure({
      [ErrorCode.ACTION_EXECUTION_ERROR]: { strategy: RecoveryStrategy.RETRY, maxRetries: 1, retryDelay: 0 },
    })
    const recoverOnce = (storeName: string) => recovery.recover(createError(ErrorCode.ACTION_EXECUTION_ERROR, 'failed'), { storeName, operation: 'sync' })

    // A 用掉自己的额度后应被 max-retries 保护拦下
    await expect(recoverOnce('storeA')).rejects.toThrow()
    await expect(recoverOnce('storeA')).rejects.toThrow(/Max retries/i)
    // B 不应被 A 的额度挤占（此前两处都落到 unknown:unknown 共用预算）
    await expect(recoverOnce('storeB')).rejects.not.toThrow(/Max retries/i)
  })
})

describe('ErrorMonitoring 上报超时定时器回收', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('上报先落地时取消未到期的超时定时器', async () => {
    jest.useFakeTimers()
    const reporter = { getName: () => 'ok', report: async () => {}, reportBatch: async () => {} }
    const monitoring = new ErrorMonitoring({
      reporters: [reporter],
      reportTimeout: 60_000,
      batchThreshold: 1,
      batchInterval: 3_600_000,
    })

    await monitoring.report({ level: 'error', error: new Error('probe'), storeName: 's', operation: 'op' } as never)
    await jest.advanceTimersByTimeAsync(1)

    const pendingTimeouts = jest.getTimerCount()
    await monitoring.shutdown()
    // 周期调度器允许存在；上报超时定时器不得随 flush 残留
    expect(pendingTimeouts).toBeLessThanOrEqual(1)
  })
})

describe('PerformanceMonitor 容量收缩', () => {
  it('setOptions 缩小 maxSize 时立即裁剪已有记录', () => {
    const monitor = new PerformanceMonitor({ maxSize: 5 })
    for (let i = 0; i < 5; i++) {
      const end = monitor.start(`op${i}`)
      end()
    }
    expect(monitor.getMetrics()).toHaveLength(5)

    monitor.setOptions({ maxSize: 2 })
    expect(monitor.getMetrics()).toHaveLength(2)

    const end = monitor.start('op-later')
    end()
    expect(monitor.getMetrics().length).toBeLessThanOrEqual(2)
  })
})

describe('ErrorAggregator 组驱逐后的统计一致性', () => {
  const ctx = (storeName: string, message: string) =>
    ({ level: 'error', error: createError(ErrorCode.ACTION_EXECUTION_ERROR, message), storeName, operation: 'op', timestamp: 1 } as never)

  it('超出 maxGroups 驱逐旧组时，byStore 随组一并收缩且求和等于 totalErrors', () => {
    const aggregator = new ErrorAggregator(2)

    aggregator.addError(ctx('s1', 'a'))
    aggregator.addError(ctx('s2', 'b'))
    aggregator.addError(ctx('s1', 'c'))
    aggregator.addError(ctx('s2', 'd'))

    const stats = aggregator.getStats()
    expect(stats.totalGroups).toBeLessThanOrEqual(2)
    expect(Object.values(stats.byStore).reduce((sum, n) => sum + n, 0)).toBe(stats.totalErrors)
  })
})

describe('ConsoleReporter 分组闭合', () => {
  it('组内 console.error 抛错时仍然 groupEnd', async () => {
    const group = jest.spyOn(console, 'group').mockImplementation(() => {})
    const groupEnd = jest.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console boom')
    })
    const reporter = new ConsoleReporter()
    const context = { level: 'error', error: new Error('x'), storeName: 's', operation: 'op', timestamp: 1 } as never

    await expect(reporter.report(context)).rejects.toThrow('console boom')
    expect(groupEnd).toHaveBeenCalledTimes(1)

    await expect(reporter.reportBatch([context])).rejects.toThrow('console boom')
    expect(groupEnd).toHaveBeenCalledTimes(2)

    group.mockRestore()
    groupEnd.mockRestore()
    errorSpy.mockRestore()
  })
})

describe('ErrorMonitoring reportTimeout <= 0 表示不超时', () => {
  it('reportTimeout 为 0 时等待真实异步上报，不判为超时', async () => {
    let resolveReport: () => void = () => {}
    const reporter = {
      getName: () => 'slow',
      report: async () => {},
      reportBatch: () => new Promise<void>((resolve) => { resolveReport = resolve }),
    }
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const monitoring = new ErrorMonitoring({ reporters: [reporter], reportTimeout: 0, batchThreshold: 1, batchInterval: 3_600_000 })

    const flushed = monitoring.flushReports()
    await Promise.resolve()
    // 修复前：setTimeout(resolve, 0) 在下一个宏任务先到期，慢速上报被判超时并重入队
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('timed out'))
    resolveReport()
    await flushed

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('timed out'))
    await monitoring.shutdown()
    warnSpy.mockRestore()
  })
})

describe('ErrorBoundary 非 Error 抛出值', () => {
  it('抛出字符串时按 Error 归一化记录，重抛仍为原值', () => {
    const onError = jest.fn()
    const boundary = new ErrorBoundary<string>({ recoverable: false, onError })

    expect(() =>
      boundary.execute(() => {
        throw 'plain string'
      }),
    ).toThrow('plain string')

    expect(onError).toHaveBeenCalledTimes(1)
    const recorded = onError.mock.calls[0][0] as Error
    expect(recorded).toBeInstanceOf(Error)
    expect(recorded.message).toBe('plain string')
    expect(boundary.getErrorHistory()[0]).toBeInstanceOf(Error)
  })

  it('可恢复场景下 fallback 函数拿到的也是归一化 Error', () => {
    const fallback = jest.fn(() => 'fb')
    const boundary = new ErrorBoundary<undefined, string>({ recoverable: true, fallback })

    const result = boundary.execute(
      () => {
        throw 42
      },
      undefined,
    )

    expect(result).toBe('fb')
    expect(fallback).toHaveBeenCalledWith(expect.objectContaining({ message: '42' }), undefined)
  })
})

describe('ErrorRecovery 受控字段不被调用方覆盖', () => {
  it('context 传入 config/error 时仍以本方法按 code 查到的为准', async () => {
    const recovery = new ErrorRecovery()
    const onRecovery = jest.fn()
    recovery.configure({
      [ErrorCode.ACTION_EXECUTION_ERROR]: { strategy: RecoveryStrategy.IGNORE, onRecovery },
    })
    const error = createError(ErrorCode.ACTION_EXECUTION_ERROR, 'boom')

    // 伪造 config（RETRY 会重抛）与 error（不同 code），二者都必须被框架值覆盖
    await expect(
      recovery.recover(error, {
        config: { strategy: RecoveryStrategy.RETRY, maxRetries: 1, retryDelay: 0 },
        error: createError(ErrorCode.STATE_UPDATE_ERROR, 'forged'),
        attempt: 99,
      } as never),
    ).resolves.toEqual({ ignored: true })

    expect(onRecovery).toHaveBeenCalledWith(error, { ignored: true })
  })
})
