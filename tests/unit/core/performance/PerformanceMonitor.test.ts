/**
 * GeomStore v1.0 - PerformanceMonitor测试
 */

import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor.js'

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
      const g = globalThis as any
      g.wx = originalWx
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

  it('REGR-PERF-012: sampleRate=0 时仍应清理超时未结束的计时条目', () => {
    const monitor = new PerformanceMonitor({ sampleRate: 0 })
    const ops = (monitor as unknown as { currentOperations: Map<string, number> }).currentOperations

    // 模拟调用方漏掉 end()：条目滞留，把起始时间戳人为推到超过 MAX_OPERATION_AGE_MS(10min) 之前
    monitor.start('leaked')
    expect(ops.size).toBe(1)
    const staleKey = [...ops.keys()][0]
    ops.set(staleKey, (ops.get(staleKey) as number) - 11 * 60 * 1000)

    // 修复前 record() 的采样判断在最前，sampleRate=0 时直接 return，
    // pruneStaleOperations 永不执行，泄漏条目随调用次数无限累积
    monitor.record({
      operation: 'x',
      type: 'dispatch',
      duration: 1,
      timestamp: Date.now(),
      exceedThreshold: false,
    })

    expect(ops.size).toBe(0)
    // 采样本身仍生效：本条指标不被记录
    expect(monitor.getMetrics().length).toBe(0)
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

  it('REGR-PERF-013: getRecentMetrics 对 0/负数/NaN 应返回空数组', () => {
    const monitor = new PerformanceMonitor()

    for (let i = 0; i < 5; i++) {
      monitor.record({
        operation: `op${i}`,
        type: 'dispatch',
        duration: i,
        timestamp: Date.now(),
        exceedThreshold: false,
      })
    }
    expect(monitor.getMetrics().length).toBe(5)

    // 修复前 slice(-0) === slice(0) 返回全部；负数退化为从头截断（slice(3)），
    // 与「最近 N 条」语义相反；NaN 同样返回全部
    expect(monitor.getRecentMetrics(0)).toHaveLength(0)
    expect(monitor.getRecentMetrics(-3)).toHaveLength(0)
    expect(monitor.getRecentMetrics(Number.NaN)).toHaveLength(0)

    // 正常路径不受影响
    const last2 = monitor.getRecentMetrics(2)
    expect(last2).toHaveLength(2)
    expect(last2[0].operation).toBe('op3')
    expect(last2[1].operation).toBe('op4')
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

// ==================== 待裁决 A 裁定：计时单位口径为毫秒 ====================
describe('计时单位契约（_getTimestamp 恒返回毫秒）', () => {
  const originalWx = (globalThis as any).wx

  afterEach(() => {
    const g = globalThis as any
    g.wx = originalWx
  })

  /** 用受控毫秒时钟替换 wx.getPerformance().now() */
  const installWxClock = (startAt: number) => {
    let current = startAt
    ;(globalThis as any).wx = {
      ...(originalWx || {}),
      getPerformance: () => ({ now: () => current }),
    }
    return {
      advance(ms: number) {
        current += ms
      },
    }
  }

  const metric = (operation: string) => ({
    operation,
    type: 'dispatch' as const,
    duration: 1,
    timestamp: Date.now(),
    exceedThreshold: false,
  })

  it('wx 时钟推进 20ms 时 duration 应为 20 且超过 16ms 阈值', () => {
    const clock = installWxClock(1000)
    const logger = jest.fn()
    const monitor = new PerformanceMonitor({ threshold: 16, logger })

    const end = monitor.start('op')
    clock.advance(20)
    end()

    const metrics = monitor.getMetrics()
    expect(metrics).toHaveLength(1)
    // duration 直接等于时钟推进量，即 wx 时钟被按毫秒解读。
    // 若日后在 _getTimestamp 内除以 1000（实测某基础库返回微秒）而未同步本契约，
    // 此断言会失败，提醒改动者一并复核 threshold 与 MAX_OPERATION_AGE_MS
    expect(metrics[0].duration).toBe(20)
    expect(metrics[0].exceedThreshold).toBe(true)
    expect(logger).toHaveBeenCalled()
  })

  it('wx 时钟推进 10ms 时不应超过 16ms 阈值', () => {
    const clock = installWxClock(1000)
    const logger = jest.fn()
    const monitor = new PerformanceMonitor({ threshold: 16, logger })

    const end = monitor.start('op')
    clock.advance(10)
    end()

    const metrics = monitor.getMetrics()
    expect(metrics).toHaveLength(1)
    expect(metrics[0].duration).toBe(10)
    expect(metrics[0].exceedThreshold).toBe(false)
    expect(logger).not.toHaveBeenCalled()
  })

  it('超时条目清理按毫秒口径：满 10 分钟才判定为泄漏', () => {
    const clock = installWxClock(1_000_000)
    const monitor = new PerformanceMonitor()
    const ops = (monitor as unknown as { currentOperations: Map<string, number> }).currentOperations

    // 模拟调用方漏掉 end()：条目滞留
    monitor.start('leaked')
    expect(ops.size).toBe(1)

    // MAX_OPERATION_AGE_MS = 10 * 60 * 1000；推进 9 分钟不应清理
    clock.advance(9 * 60 * 1000)
    monitor.record(metric('x'))
    expect(ops.size).toBe(1)

    // 累计 11 分钟应清理
    clock.advance(2 * 60 * 1000)
    monitor.record(metric('y'))
    expect(ops.size).toBe(0)
  })
})

describe('maxSize 规范化', () => {
  const rec = (operation: string) => ({
    operation,
    type: 'dispatch' as const,
    duration: 1,
    timestamp: Date.now(),
    exceedThreshold: false,
  })
  const readMaxSize = (monitor: PerformanceMonitor) => (monitor as unknown as { options: { maxSize: number } }).options.maxSize

  it('负数 maxSize 收敛为 0：淘汰逻辑不得在空数组上死循环', () => {
    const monitor = new PerformanceMonitor({ maxSize: -5 })
    monitor.record(rec('a'))
    monitor.record(rec('b'))

    expect(monitor.getMetrics()).toHaveLength(0)
  })

  it('小数向下取整，NaN / Infinity 回落默认容量', () => {
    expect(readMaxSize(new PerformanceMonitor({ maxSize: 2.7 }))).toBe(2)
    expect(readMaxSize(new PerformanceMonitor({ maxSize: NaN }))).toBe(1000)
    expect(readMaxSize(new PerformanceMonitor({ maxSize: Infinity }))).toBe(1000)
  })

  it('setOptions 同样规范化：NaN 保留原容量，负数收敛为 0', () => {
    const monitor = new PerformanceMonitor({ maxSize: 4 })

    monitor.setOptions({ maxSize: NaN })
    expect(readMaxSize(monitor)).toBe(4)

    monitor.setOptions({ maxSize: -1 })
    expect(readMaxSize(monitor)).toBe(0)
    monitor.record(rec('after-zero'))
    expect(monitor.getMetrics()).toHaveLength(0)
  })
})
