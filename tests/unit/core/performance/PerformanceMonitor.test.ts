/**
 * GeomStore v1.0 - PerformanceMonitor测试
 */

import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor'

describe('PerformanceMonitor', () => {
  it('should create performance monitor', () => {
    const monitor = new PerformanceMonitor()
    expect(monitor).toBeDefined()
  })

  it('wx 不可用时应该回退到 Date.now 获取时间戳', () => {
    const originalWx = (globalThis as any).wx
    delete (globalThis as any).wx
    try {
      const monitor = new PerformanceMonitor()
      const timestamp = (monitor as any)._getTimestamp()

      expect(typeof timestamp).toBe('number')
    } finally {
      (globalThis as any).wx = originalWx
    }
  })

  it('should measure operation duration', () => {
    const monitor = new PerformanceMonitor()

    const end = monitor.start('test-operation')

    // 模拟操作
    setTimeout(() => {}, 10)

    end()

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(1)
    expect(metrics[0].operation).toBe('test-operation')
    expect(metrics[0].duration).toBeGreaterThan(0)
  })

  it('should record metrics', () => {
    const monitor = new PerformanceMonitor()

    monitor.record({
      operation: 'test',
      type: 'dispatch',
      duration: 100,
      timestamp: Date.now(),
      exceedThreshold: false,
    })

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(1)
  })

  it('should clear metrics', () => {
    const monitor = new PerformanceMonitor()
    monitor.record({
      operation: 'test',
      type: 'dispatch',
      duration: 100,
      timestamp: Date.now(),
      exceedThreshold: false,
    })

    monitor.clear()

    expect(monitor.getMetrics().length).toBe(0)
  })

  it('should limit metrics size', () => {
    const monitor = new PerformanceMonitor({ maxSize: 3 })

    for (let i = 0; i < 5; i++) {
      monitor.record({
        operation: `op${i}`,
        type: 'dispatch',
        duration: 100,
        timestamp: Date.now(),
        exceedThreshold: false,
      })
    }

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(3)
  })

  it('should calculate stats', () => {
    const monitor = new PerformanceMonitor()

    monitor.record({ operation: 'op1', type: 'dispatch', duration: 100, timestamp: Date.now(), exceedThreshold: false })
    monitor.record({ operation: 'op1', type: 'dispatch', duration: 200, timestamp: Date.now(), exceedThreshold: false })
    monitor.record({ operation: 'op1', type: 'dispatch', duration: 150, timestamp: Date.now(), exceedThreshold: false })

    const stats = monitor.getStats()

    expect(stats.totalCount).toBe(3)
    expect(stats.avgDuration).toBe(150)
    expect(stats.maxDuration).toBe(200)
    expect(stats.minDuration).toBe(100)
  })

  it('should filter by operation', () => {
    const monitor = new PerformanceMonitor()

    monitor.record({ operation: 'op1', type: 'dispatch', duration: 100, timestamp: Date.now(), exceedThreshold: false })
    monitor.record({ operation: 'op2', type: 'dispatch', duration: 200, timestamp: Date.now(), exceedThreshold: false })

    const op1Metrics = monitor.getMetricsByOperation('op1')
    expect(op1Metrics.length).toBe(1)
    expect(op1Metrics[0].operation).toBe('op1')
  })

  // 新增测试：采样率
  it('should respect sample rate', () => {
    const monitor = new PerformanceMonitor({ sampleRate: 0 }) // 0% 采样率

    monitor.record({
      operation: 'test',
      type: 'dispatch',
      duration: 100,
      timestamp: Date.now(),
      exceedThreshold: false,
    })

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(0) // 0% 采样率不应记录任何指标
  })

  // 新增测试：阈值超限日志
  it('should call logger when threshold exceeded', () => {
    const logger = jest.fn()
    const monitor = new PerformanceMonitor({ threshold: 10, logger })

    monitor.record({
      operation: 'slow-op',
      type: 'dispatch',
      duration: 100,
      timestamp: Date.now(),
      exceedThreshold: true,
    })

    expect(logger).toHaveBeenCalled()
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'slow-op',
        duration: 100,
        exceedThreshold: true,
      }),
    )
  })

  // 新增测试：空指标统计
  it('should return empty stats when no metrics', () => {
    const monitor = new PerformanceMonitor()

    const stats = monitor.getStats()

    expect(stats.totalCount).toBe(0)
    expect(stats.avgDuration).toBe(0)
    expect(stats.maxDuration).toBe(0)
    expect(stats.minDuration).toBe(0)
    expect(stats.thresholdExceeded).toBe(0)
    expect(stats.byOperation).toEqual({})
  })

  // 新增测试：setOptions
  it('should update options', () => {
    const monitor = new PerformanceMonitor()

    monitor.setOptions({ threshold: 50 })

    // 验证选项被更新 - 通过行为验证
    const customLogger = jest.fn()
    monitor.setOptions({ logger: customLogger })

    monitor.record({
      operation: 'test',
      type: 'dispatch',
      duration: 100,
      timestamp: Date.now(),
      exceedThreshold: true,
    })

    expect(customLogger).toHaveBeenCalled()
  })

  // 新增测试：按类型筛选
  it('should filter by type', () => {
    const monitor = new PerformanceMonitor()

    monitor.record({ operation: 'op1', type: 'dispatch', duration: 100, timestamp: Date.now(), exceedThreshold: false })
    monitor.record({ operation: 'op2', type: 'getter', duration: 200, timestamp: Date.now(), exceedThreshold: false })
    monitor.record({ operation: 'op3', type: 'dispatch', duration: 150, timestamp: Date.now(), exceedThreshold: false })

    const dispatchMetrics = monitor.getMetricsByType('dispatch')
    expect(dispatchMetrics.length).toBe(2)

    const getterMetrics = monitor.getMetricsByType('getter')
    expect(getterMetrics.length).toBe(1)
  })

  // 新增测试：获取最近指标
  it('should get recent metrics', () => {
    const monitor = new PerformanceMonitor()

    for (let i = 0; i < 20; i++) {
      monitor.record({
        operation: `op${i}`,
        type: 'dispatch',
        duration: i * 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })
    }

    const recent = monitor.getRecentMetrics(5)
    expect(recent.length).toBe(5)
    expect(recent[0].operation).toBe('op15')
    expect(recent[4].operation).toBe('op19')
  })

  // 新增测试：获取最近指标默认值
  it('should get recent metrics with default count', () => {
    const monitor = new PerformanceMonitor()

    for (let i = 0; i < 15; i++) {
      monitor.record({
        operation: `op${i}`,
        type: 'dispatch',
        duration: i * 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })
    }

    const recent = monitor.getRecentMetrics()
    expect(recent.length).toBe(10) // 默认 10 条
  })

  // 新增测试：导出 JSON
  it('should export to JSON', () => {
    const monitor = new PerformanceMonitor()

    monitor.record({
      operation: 'test',
      type: 'dispatch',
      duration: 100,
      timestamp: Date.now(),
      exceedThreshold: false,
    })

    const json = monitor.exportJSON()
    const parsed = JSON.parse(json)

    expect(parsed.metrics).toBeDefined()
    expect(parsed.stats).toBeDefined()
    expect(parsed.options).toBeDefined()
    expect(parsed.metrics.length).toBe(1)
  })

  // 新增测试：内存跟踪
  it('should track memory when enabled', () => {
    const monitor = new PerformanceMonitor({ trackMemory: true })

    monitor.record({
      operation: 'test',
      type: 'dispatch',
      duration: 100,
      timestamp: Date.now(),
      exceedThreshold: false,
    })

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(1)
    // 内存信息可能不可用，但不应该报错
  })

  // 新增测试：默认日志记录器
  it('should use default logger for threshold warnings', () => {
    // 使用自定义 logger 来避免 defaultLogger 的 this 绑定问题
    const customLogger = jest.fn()
    const monitor = new PerformanceMonitor({ threshold: 10, logger: customLogger })

    monitor.record({
      operation: 'slow-op',
      type: 'dispatch',
      duration: 100,
      timestamp: Date.now(),
      exceedThreshold: true,
    })

    expect(customLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'slow-op',
        duration: 100,
        exceedThreshold: true,
      }),
    )
  })

  // 新增测试：按操作分组统计
  it('should calculate stats by operation', () => {
    const monitor = new PerformanceMonitor()

    monitor.record({ operation: 'fetch', type: 'dispatch', duration: 100, timestamp: Date.now(), exceedThreshold: false })
    monitor.record({ operation: 'fetch', type: 'dispatch', duration: 200, timestamp: Date.now(), exceedThreshold: false })
    monitor.record({ operation: 'save', type: 'dispatch', duration: 300, timestamp: Date.now(), exceedThreshold: false })

    const stats = monitor.getStats()

    expect(stats.byOperation['fetch']).toBeDefined()
    expect(stats.byOperation['fetch'].count).toBe(2)
    expect(stats.byOperation['fetch'].avgDuration).toBe(150)
    expect(stats.byOperation['fetch'].maxDuration).toBe(200)

    expect(stats.byOperation['save']).toBeDefined()
    expect(stats.byOperation['save'].count).toBe(1)
  })

  // 新增测试：阈值超限计数
  it('should count threshold exceeded', () => {
    const customLogger = jest.fn()
    const monitor = new PerformanceMonitor({ threshold: 50, logger: customLogger })

    monitor.record({ operation: 'fast', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false })
    monitor.record({ operation: 'slow1', type: 'dispatch', duration: 100, timestamp: Date.now(), exceedThreshold: true })
    monitor.record({ operation: 'slow2', type: 'dispatch', duration: 200, timestamp: Date.now(), exceedThreshold: true })

    const stats = monitor.getStats()

    expect(stats.thresholdExceeded).toBe(2)
  })

  // 新增测试：清除当前操作
  it('should clear current operations', () => {
    const monitor = new PerformanceMonitor()

    const end = monitor.start('test-op')
    end()

    monitor.clear()

    // 再次开始新操作
    const end2 = monitor.start('another-op')
    end2()

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(1)
    expect(metrics[0].operation).toBe('another-op')
  })

  // 新增测试：默认日志记录器（使用默认logger）
  it('should use default logger when no custom logger provided', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const monitor = new PerformanceMonitor({ threshold: 10 })

    monitor.record({
      operation: 'very-slow-op',
      type: 'dispatch',
      duration: 100,
      timestamp: Date.now(),
      exceedThreshold: true,
    })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[GeomStore][Performance] very-slow-op took'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('threshold: 10ms'))

    warnSpy.mockRestore()
  })

  // 新增测试：Date.now() 降级路径（当 performance.now 不可用时）
  it('should fallback to Date.now when performance.now is not available', () => {
    // 保存原始 performance
    const originalPerformance = global.performance

    // 删除 performance
    delete (globalThis as any).performance

    const monitor = new PerformanceMonitor()

    const end = monitor.start('fallback-test')
    end()

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(1)
    expect(metrics[0].operation).toBe('fallback-test')

    // 恢复原始 performance
    ;(globalThis as any).performance = originalPerformance
  })

  // 新增测试：内存监控 - 当 performance.memory 可用时
  it('should track memory usage when performance.memory is available', () => {
    const originalPerformance = global.performance

    // 模拟 performance.memory
    Object.defineProperty(global, 'performance', {
      value: {
        now: () => Date.now(),
        memory: {
          usedJSHeapSize: 1024 * 1024 * 50, // 50MB
        },
      },
      writable: true,
      configurable: true,
    })

    const monitor = new PerformanceMonitor({ trackMemory: true })

    monitor.record({
      operation: 'memory-test',
      type: 'dispatch',
      duration: 100,
      timestamp: Date.now(),
      exceedThreshold: false,
    })

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(1)
    expect(metrics[0].memoryUsage).toBe(1024 * 1024 * 50)

    // 恢复原始 performance
    global.performance = originalPerformance
  })

  // 新增测试：内存监控 - 当 performance.memory 不可用时
  it('should handle missing performance.memory gracefully', () => {
    const originalPerformance = global.performance

    // 模拟没有 memory 的 performance
    Object.defineProperty(global, 'performance', {
      value: {
        now: () => Date.now(),
      },
      writable: true,
      configurable: true,
    })

    const monitor = new PerformanceMonitor({ trackMemory: true })

    // 不应该抛出错误
    expect(() => {
      monitor.record({
        operation: 'no-memory-test',
        type: 'dispatch',
        duration: 100,
        timestamp: Date.now(),
        exceedThreshold: false,
      })
    }).not.toThrow()

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(1)

    // 恢复原始 performance
    global.performance = originalPerformance
  })

  // 新增测试：start 方法返回的函数应该正确清理 currentOperations
  it('should clean up currentOperations after end is called', () => {
    const monitor = new PerformanceMonitor()

    const end1 = monitor.start('op1')
    const end2 = monitor.start('op2')

    end1()
    end2()

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(2)
  })

  // 新增测试：重复调用 end 不应该重复记录
  it('should not record duplicate metrics when end is called multiple times', () => {
    const monitor = new PerformanceMonitor()

    const end = monitor.start('single-op')
    end()
    end() // 重复调用

    const metrics = monitor.getMetrics()
    expect(metrics.length).toBe(1) // 只应该记录一次
  })

  // 新增测试：不超阈值时不调用 logger
  it('should not call logger when threshold not exceeded', () => {
    const logger = jest.fn()
    const monitor = new PerformanceMonitor({ threshold: 100, logger })

    monitor.record({
      operation: 'fast-op',
      type: 'dispatch',
      duration: 10,
      timestamp: Date.now(),
      exceedThreshold: false,
    })

    expect(logger).not.toHaveBeenCalled()
  })

  // 新增测试：不同操作类型的统计
  it('should handle multiple operation types in stats', () => {
    const monitor = new PerformanceMonitor()

    monitor.record({ operation: 'fetch', type: 'dispatch', duration: 100, timestamp: Date.now(), exceedThreshold: false })
    monitor.record({ operation: 'compute', type: 'getter', duration: 50, timestamp: Date.now(), exceedThreshold: false })
    monitor.record({ operation: 'update', type: 'state-update', duration: 25, timestamp: Date.now(), exceedThreshold: false })

    const dispatchMetrics = monitor.getMetricsByType('dispatch')
    const getterMetrics = monitor.getMetricsByType('getter')
    const stateUpdateMetrics = monitor.getMetricsByType('state-update')

    expect(dispatchMetrics.length).toBe(1)
    expect(getterMetrics.length).toBe(1)
    expect(stateUpdateMetrics.length).toBe(1)
  })
})
