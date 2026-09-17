/**
 * 错误子系统的后续修复回归：重试额度按调用上下文隔离、上报超时定时器回收、
 * 性能监控容量收缩立即生效
 */

import { ErrorRecovery, ErrorCode, RecoveryStrategy, createError, ErrorMonitoring } from '@/extras/error/index.js'
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
