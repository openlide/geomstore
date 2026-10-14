/**
 * 错误子系统的后续修复回归：性能监控容量收缩、非 Error 抛出值归一化。
 */

import { ErrorBoundary } from '@/extras/error/index.js'
import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor.js'

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

    const result = boundary.execute(() => {
      throw 42
    }, undefined)

    expect(result).toBe('fb')
    expect(fallback).toHaveBeenCalledWith(expect.objectContaining({ message: '42' }), undefined)
  })
})
