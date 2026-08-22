/**
 * GeomStore v1.0 - metrics 测试
 */

import { MetricsCollector, PerformanceAnalyzer, PerformanceMetrics } from '@/core/performance/metrics'

describe('MetricsCollector', () => {
  let collector: MetricsCollector

  beforeEach(() => {
    collector = new MetricsCollector()
  })

  describe('基础功能', () => {
    test('应该能够创建collector实例', () => {
      expect(collector).toBeDefined()
      expect(collector).toBeInstanceOf(MetricsCollector)
    })

    test('初始状态应该为空', () => {
      expect(collector.count()).toBe(0)
      expect(collector.getAll()).toEqual([])
    })
  })

  describe('collect', () => {
    test('应该能够收集单个指标', () => {
      collector.collect({
        operation: 'fetchUser',
        type: 'dispatch',
        duration: 42.5,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      expect(collector.count()).toBe(1)
      expect(collector.getAll()).toHaveLength(1)
    })

    test('应该能够收集多个指标', () => {
      collector.collect({
        operation: 'fetchUser',
        type: 'dispatch',
        duration: 42.5,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'saveUser',
        type: 'dispatch',
        duration: 18.2,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      expect(collector.count()).toBe(2)
      expect(collector.getAll()).toHaveLength(2)
    })

    test('应该能够记录exceedThreshold标志', () => {
      collector.collect({
        operation: 'slowOperation',
        type: 'dispatch',
        duration: 100,
        timestamp: Date.now(),
        exceedThreshold: true,
      })

      const metrics = collector.getAll()
      expect(metrics[0].exceedThreshold).toBe(true)
    })
  })

  describe('collectBatch', () => {
    test('应该能够批量收集指标', () => {
      const batch: PerformanceMetrics[] = [
        {
          operation: 'fetchUser',
          type: 'dispatch',
          duration: 42.5,
          timestamp: Date.now(),
          exceedThreshold: false,
        },
        {
          operation: 'saveUser',
          type: 'dispatch',
          duration: 18.2,
          timestamp: Date.now(),
          exceedThreshold: false,
        },
        {
          operation: 'deleteUser',
          type: 'dispatch',
          duration: 15.8,
          timestamp: Date.now(),
          exceedThreshold: false,
        },
      ]

      collector.collectBatch(batch)

      expect(collector.count()).toBe(3)
      expect(collector.getAll()).toHaveLength(3)
    })

    test('应该能够处理空的batch', () => {
      collector.collectBatch([])
      expect(collector.count()).toBe(0)
    })
  })

  describe('getAll', () => {
    test('应该返回所有指标的副本', () => {
      collector.collect({
        operation: 'test1',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const all1 = collector.getAll()
      const all2 = collector.getAll()

      expect(all1).not.toBe(all2)
      expect(all1).toEqual(all2)
    })

    test('应该保持收集顺序', () => {
      collector.collect({
        operation: 'test1',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'test2',
        type: 'dispatch',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const all = collector.getAll()
      expect(all[0].operation).toBe('test1')
      expect(all[1].operation).toBe('test2')
    })
  })

  describe('clear', () => {
    test('应该能够清空所有指标', () => {
      collector.collect({
        operation: 'test',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      expect(collector.count()).toBe(1)

      collector.clear()

      expect(collector.count()).toBe(0)
      expect(collector.getAll()).toEqual([])
    })
  })

  describe('count', () => {
    test('应该返回已收集的指标数量', () => {
      expect(collector.count()).toBe(0)

      collector.collect({
        operation: 'test',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      expect(collector.count()).toBe(1)

      collector.collect({
        operation: 'test2',
        type: 'dispatch',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      expect(collector.count()).toBe(2)
    })
  })

  describe('calculateStats', () => {
    test('应该能够计算空指标的统计', () => {
      const stats = collector.calculateStats()

      expect(stats.avgDuration).toBe(0)
      expect(stats.maxDuration).toBe(0)
      expect(stats.minDuration).toBe(0)
      expect(stats.totalCount).toBe(0)
      expect(stats.thresholdExceeded).toBe(0)
      expect(stats.byOperation).toEqual({})
    })

    test('应该能够计算单个指标的统计', () => {
      collector.collect({
        operation: 'testOp',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const stats = collector.calculateStats()

      expect(stats.avgDuration).toBe(10)
      expect(stats.maxDuration).toBe(10)
      expect(stats.minDuration).toBe(10)
      expect(stats.totalCount).toBe(1)
      expect(stats.thresholdExceeded).toBe(0)
      expect(stats.byOperation.testOp).toBeDefined()
      expect(stats.byOperation.testOp.count).toBe(1)
      expect(stats.byOperation.testOp.avgDuration).toBe(10)
      expect(stats.byOperation.testOp.maxDuration).toBe(10)
    })

    test('应该能够计算多个指标的统计', () => {
      collector.collect({
        operation: 'testOp',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'testOp',
        type: 'dispatch',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'testOp',
        type: 'dispatch',
        duration: 30,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const stats = collector.calculateStats()

      expect(stats.avgDuration).toBe(20)
      expect(stats.maxDuration).toBe(30)
      expect(stats.minDuration).toBe(10)
      expect(stats.totalCount).toBe(3)
      expect(stats.byOperation.testOp.count).toBe(3)
      expect(stats.byOperation.testOp.avgDuration).toBe(20)
      expect(stats.byOperation.testOp.maxDuration).toBe(30)
    })

    test('应该能够正确统计exceedThreshold', () => {
      collector.collect({
        operation: 'testOp',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'testOp',
        type: 'dispatch',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: true,
      })

      collector.collect({
        operation: 'testOp',
        type: 'dispatch',
        duration: 30,
        timestamp: Date.now(),
        exceedThreshold: true,
      })

      const stats = collector.calculateStats()

      expect(stats.thresholdExceeded).toBe(2)
    })

    test('应该能够统计多个操作', () => {
      collector.collect({
        operation: 'op1',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op2',
        type: 'dispatch',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op1',
        type: 'dispatch',
        duration: 30,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const stats = collector.calculateStats()

      expect(stats.byOperation.op1.count).toBe(2)
      expect(stats.byOperation.op1.avgDuration).toBe(20)
      expect(stats.byOperation.op1.maxDuration).toBe(30)

      expect(stats.byOperation.op2.count).toBe(1)
      expect(stats.byOperation.op2.avgDuration).toBe(20)
      expect(stats.byOperation.op2.maxDuration).toBe(20)
    })
  })

  describe('filter', () => {
    test('应该能够按条件筛选', () => {
      collector.collect({
        operation: 'fastOp',
        type: 'dispatch',
        duration: 5,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'slowOp',
        type: 'dispatch',
        duration: 50,
        timestamp: Date.now(),
        exceedThreshold: true,
      })

      const filtered = collector.filter((m) => m.duration > 10)

      expect(filtered.count()).toBe(1)
      expect(filtered.getAll()[0].operation).toBe('slowOp')
    })

    test('应该能够按操作类型筛选', () => {
      collector.collect({
        operation: 'op1',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op2',
        type: 'getter',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const filtered = collector.filter((m) => m.type === 'dispatch')

      expect(filtered.count()).toBe(1)
      expect(filtered.getAll()[0].operation).toBe('op1')
    })

    test('应该能够按exceedThreshold筛选', () => {
      collector.collect({
        operation: 'op1',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op2',
        type: 'dispatch',
        duration: 50,
        timestamp: Date.now(),
        exceedThreshold: true,
      })

      const filtered = collector.filter((m) => m.exceedThreshold === true)

      expect(filtered.count()).toBe(1)
      expect(filtered.getAll()[0].operation).toBe('op2')
    })

    test('应该返回新的collector实例', () => {
      collector.collect({
        operation: 'test',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const filtered = collector.filter((m) => m.duration > 5)

      expect(filtered).not.toBe(collector)
      expect(collector.count()).toBe(1)
      expect(filtered.count()).toBe(1)
    })
  })

  describe('filterByTimeRange', () => {
    test('应该能够按时间范围筛选', () => {
      const now = Date.now()
      const oneHourAgo = now - 3600000

      collector.collect({
        operation: 'oldOp',
        type: 'dispatch',
        duration: 10,
        timestamp: oneHourAgo - 1000,
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'recentOp',
        type: 'dispatch',
        duration: 20,
        timestamp: now - 1000,
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'currentOp',
        type: 'dispatch',
        duration: 30,
        timestamp: now,
        exceedThreshold: false,
      })

      const recent = collector.filterByTimeRange(oneHourAgo, now)

      expect(recent.count()).toBe(2)
      const operations = recent.getAll().map((m) => m.operation)
      expect(operations).not.toContain('oldOp')
      expect(operations).toContain('recentOp')
      expect(operations).toContain('currentOp')
    })

    test('应该能够排除时间范围外的指标', () => {
      const now = Date.now()
      const startTime = now - 3600000 // 1小时前

      collector.collect({
        operation: 'op1',
        type: 'dispatch',
        duration: 10,
        timestamp: startTime - 1000, // 超出范围（早于startTime）
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op2',
        type: 'dispatch',
        duration: 20,
        timestamp: now + 1000, // 超出范围（晚于now）
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op3',
        type: 'dispatch',
        duration: 30,
        timestamp: startTime + 1800000, // 在范围内（30分钟前）
        exceedThreshold: false,
      })

      const filtered = collector.filterByTimeRange(startTime, now)

      expect(filtered.count()).toBe(1)
      expect(filtered.getAll()[0].operation).toBe('op3')
    })
  })

  describe('filterByOperation', () => {
    test('应该能够按操作名称筛选', () => {
      collector.collect({
        operation: 'fetchUser',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'saveUser',
        type: 'dispatch',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'fetchUser',
        type: 'dispatch',
        duration: 30,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const fetchUserMetrics = collector.filterByOperation('fetchUser')

      expect(fetchUserMetrics.count()).toBe(2)
      expect(fetchUserMetrics.getAll()[0].duration).toBe(10)
      expect(fetchUserMetrics.getAll()[1].duration).toBe(30)
    })

    test('应该能够返回新的collector实例', () => {
      collector.collect({
        operation: 'test',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const filtered = collector.filterByOperation('test')

      expect(filtered).not.toBe(collector)
    })

    test('不存在操作应该返回空collector', () => {
      collector.collect({
        operation: 'test',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const filtered = collector.filterByOperation('nonexistent')

      expect(filtered.count()).toBe(0)
      expect(filtered.getAll()).toEqual([])
    })
  })

  describe('sortByDuration', () => {
    test('应该能够按降序排序（默认）', () => {
      collector.collect({
        operation: 'op1',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op2',
        type: 'dispatch',
        duration: 30,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op3',
        type: 'dispatch',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const sorted = collector.sortByDuration(false) // 降序
      const metrics = sorted.getAll()

      expect(metrics[0].duration).toBe(30)
      expect(metrics[1].duration).toBe(20)
      expect(metrics[2].duration).toBe(10)
    })

    test('应该能够按升序排序', () => {
      collector.collect({
        operation: 'op1',
        type: 'dispatch',
        duration: 30,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op2',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const sorted = collector.sortByDuration(true) // 升序
      const metrics = sorted.getAll()

      expect(metrics[0].duration).toBe(10)
      expect(metrics[1].duration).toBe(30)
    })

    test('应该返回新的collector实例', () => {
      collector.collect({
        operation: 'test',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const sorted = collector.sortByDuration()

      expect(sorted).not.toBe(collector)
    })
  })

  describe('getPercentile', () => {
    test('应该能够计算P50（中位数）', () => {
      for (let i = 0; i < 100; i++) {
        collector.collect({
          operation: 'test',
          type: 'dispatch',
          duration: i,
          timestamp: Date.now(),
          exceedThreshold: false,
        })
      }

      const p50 = collector.getPercentile(50)

      expect(p50).toBe(50)
    })

    test('应该能够计算P95', () => {
      for (let i = 0; i < 100; i++) {
        collector.collect({
          operation: 'test',
          type: 'dispatch',
          duration: i,
          timestamp: Date.now(),
          exceedThreshold: false,
        })
      }

      const p95 = collector.getPercentile(95)

      expect(p95).toBe(95)
    })

    test('应该能够计算P99', () => {
      for (let i = 0; i < 100; i++) {
        collector.collect({
          operation: 'test',
          type: 'dispatch',
          duration: i,
          timestamp: Date.now(),
          exceedThreshold: false,
        })
      }

      const p99 = collector.getPercentile(99)

      expect(p99).toBe(99)
    })

    test('空指标应该返回0', () => {
      const percentile = collector.getPercentile(50)

      expect(percentile).toBe(0)
    })

    test('越界的 percentile 应该抛出 RangeError', () => {
      collector.collect({
        operation: 'test',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      expect(() => collector.getPercentile(-1)).toThrow(RangeError)
      expect(() => collector.getPercentile(101)).toThrow(RangeError)
      expect(() => collector.getPercentile(Number.NaN)).toThrow(RangeError)
    })
  })

  describe('容量上限', () => {
    test('超出 maxSize 时应淘汰最旧条目', () => {
      const small = new MetricsCollector(2)
      for (let i = 0; i < 3; i++) {
        small.collect({
          operation: `op${i}`,
          type: 'dispatch',
          duration: i,
          timestamp: Date.now(),
          exceedThreshold: false,
        })
      }

      expect(small.count()).toBe(2)
      expect(small.getAll().map((m) => m.operation)).toEqual(['op1', 'op2'])
    })
  })

  describe('getHotPaths', () => {
    test('应该能够获取最频繁的操作', () => {
      collector.collect({
        operation: 'fetchUser',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'fetchUser',
        type: 'dispatch',
        duration: 12,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'fetchUser',
        type: 'dispatch',
        duration: 11,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'saveUser',
        type: 'dispatch',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const hotPaths = collector.getHotPaths(5)

      expect(hotPaths).toHaveLength(2)
      expect(hotPaths[0].operation).toBe('fetchUser')
      expect(hotPaths[0].count).toBe(3)
      expect(hotPaths[0].avgDuration).toBe(11)
    })

    test('应该能够限制返回数量', () => {
      for (let i = 0; i < 10; i++) {
        collector.collect({
          operation: `op${i}`,
          type: 'dispatch',
          duration: i * 10,
          timestamp: Date.now(),
          exceedThreshold: false,
        })
      }

      const hotPaths = collector.getHotPaths(3)

      expect(hotPaths).toHaveLength(3)
    })

    test('应该按频率降序返回', () => {
      collector.collect({
        operation: 'op1',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op2',
        type: 'dispatch',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op2',
        type: 'dispatch',
        duration: 25,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'op3',
        type: 'dispatch',
        duration: 30,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const hotPaths = collector.getHotPaths()

      expect(hotPaths[0].operation).toBe('op2') // 执行次数最多
      expect(hotPaths[0].count).toBe(2)
    })

    test('应该正确计算平均耗时', () => {
      collector.collect({
        operation: 'testOp',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'testOp',
        type: 'dispatch',
        duration: 20,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'testOp',
        type: 'dispatch',
        duration: 30,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const hotPaths = collector.getHotPaths(1)

      expect(hotPaths[0].avgDuration).toBe(20)
    })
  })

  describe('复杂场景', () => {
    test('应该能够处理大量指标', () => {
      for (let i = 0; i < 1000; i++) {
        collector.collect({
          operation: 'testOp',
          type: 'dispatch',
          duration: Math.random() * 100,
          timestamp: Date.now(),
          exceedThreshold: Math.random() > 0.8,
        })
      }

      expect(collector.count()).toBe(1000)

      const stats = collector.calculateStats()
      expect(stats.totalCount).toBe(1000)
      expect(stats.avgDuration).toBeGreaterThan(0)
      expect(stats.maxDuration).toBeGreaterThan(stats.minDuration)
    })

    test('应该能够同时使用多种筛选', () => {
      const now = Date.now()
      const startTime = now - 3600000

      // 添加不同时间段和类型的指标
      collector.collect({
        operation: 'recentOp',
        type: 'dispatch',
        duration: 10,
        timestamp: now - 1000,
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'oldOp',
        type: 'dispatch',
        duration: 20,
        timestamp: startTime - 1000,
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'recentGetter',
        type: 'getter',
        duration: 15,
        timestamp: now - 500,
        exceedThreshold: false,
      })

      // 组合筛选：时间范围 + 操作名称
      const recentDispatch = collector.filterByTimeRange(startTime, now).filterByOperation('recentOp')

      expect(recentDispatch.count()).toBe(1)
      expect(recentDispatch.getAll()[0].type).toBe('dispatch')
    })

    test('应该能够在筛选后计算统计', () => {
      collector.collect({
        operation: 'fastOp',
        type: 'dispatch',
        duration: 5,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'slowOp',
        type: 'dispatch',
        duration: 50,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      collector.collect({
        operation: 'fastOp',
        type: 'dispatch',
        duration: 10,
        timestamp: Date.now(),
        exceedThreshold: false,
      })

      const slowMetrics = collector.filter((m) => m.duration > 20)
      const slowStats = slowMetrics.calculateStats()

      expect(slowStats.totalCount).toBe(1)
      expect(slowStats.avgDuration).toBe(50)
    })
  })
})

describe('PerformanceAnalyzer', () => {
  describe('analyzeBottlenecks', () => {
    test('应该能够分析性能瓶颈', () => {
      const metrics: PerformanceMetrics[] = [
        { operation: 'op1', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op2', type: 'dispatch', duration: 30, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op3', type: 'dispatch', duration: 50, timestamp: Date.now(), exceedThreshold: false },
      ]

      const bottlenecks = PerformanceAnalyzer.analyzeBottlenecks(metrics, 16)

      expect(bottlenecks).toHaveLength(3)
      expect(bottlenecks[0].operation).toBe('op3')
      expect(bottlenecks[0].severity).toBe('high') // 50 > 48 (16*3)
      expect(bottlenecks[1].operation).toBe('op2')
      expect(bottlenecks[1].severity).toBe('low') // 30 <= 32 (16*2)
      expect(bottlenecks[2].operation).toBe('op1')
      expect(bottlenecks[2].severity).toBe('low') // 10 <= 32 (16*2)
    })

    test('应该能够正确分类严重程度', () => {
      const metrics: PerformanceMetrics[] = [
        { operation: 'op1', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op2', type: 'dispatch', duration: 55, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op3', type: 'dispatch', duration: 49, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op4', type: 'dispatch', duration: 33, timestamp: Date.now(), exceedThreshold: false },
      ]

      const bottlenecks = PerformanceAnalyzer.analyzeBottlenecks(metrics, 16)

      expect(bottlenecks[0].severity).toBe('high') // 55 > 48 (16*3)
      expect(bottlenecks[1].severity).toBe('high') // 49 > 48 (16*3)
      expect(bottlenecks[2].severity).toBe('medium') // 33 > 32 (16*2) 且 33 <= 48
      expect(bottlenecks[3].severity).toBe('low') // 10 <= 32 (16*2)
    })

    test('应该使用默认的阈值', () => {
      const metrics: PerformanceMetrics[] = [{ operation: 'op1', type: 'dispatch', duration: 40, timestamp: Date.now(), exceedThreshold: false }]

      const bottlenecks = PerformanceAnalyzer.analyzeBottlenecks(metrics)

      // 默认阈值16，40 > 32 (16*2) 且 40 <= 48 (16*3)，所以是 medium
      expect(bottlenecks[0].avgDuration).toBeGreaterThan(16)
      expect(bottlenecks[0].severity).toBe('medium')
    })

    test('应该按严重程度排序', () => {
      const metrics: PerformanceMetrics[] = [
        { operation: 'op1', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op2', type: 'dispatch', duration: 50, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op3', type: 'dispatch', duration: 40, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op4', type: 'dispatch', duration: 25, timestamp: Date.now(), exceedThreshold: false },
      ]

      const bottlenecks = PerformanceAnalyzer.analyzeBottlenecks(metrics, 16)

      expect(bottlenecks[0].avgDuration).toBe(50)
      expect(bottlenecks[1].avgDuration).toBe(40)
      expect(bottlenecks[2].avgDuration).toBe(25)
      expect(bottlenecks[3].avgDuration).toBe(10)
    })
  })

  describe('detectRegression', () => {
    test('应该能够检测性能退化', () => {
      const baselineMetrics: PerformanceMetrics[] = [
        { operation: 'testOp', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'testOp', type: 'dispatch', duration: 12, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'testOp', type: 'dispatch', duration: 11, timestamp: Date.now(), exceedThreshold: false },
      ]

      const currentMetrics: PerformanceMetrics[] = [
        { operation: 'testOp', type: 'dispatch', duration: 15, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'testOp', type: 'dispatch', duration: 18, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'testOp', type: 'dispatch', duration: 20, timestamp: Date.now(), exceedThreshold: false },
      ]

      const regressions = PerformanceAnalyzer.detectRegression(currentMetrics, baselineMetrics, 0.2)

      expect(regressions).toHaveLength(1)
      expect(regressions[0].operation).toBe('testOp')
      expect(regressions[0].baselineDuration).toBe(11)
      expect(regressions[0].currentDuration).toBe(17.666666666666668) // (15+18+20)/3
      expect(regressions[0].changePercent).toBeGreaterThan(50) // 超过20%
    })

    test('应该能够忽略未退化的操作', () => {
      const baselineMetrics: PerformanceMetrics[] = [{ operation: 'testOp', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false }]

      const currentMetrics: PerformanceMetrics[] = [{ operation: 'testOp', type: 'dispatch', duration: 11, timestamp: Date.now(), exceedThreshold: false }]

      const regressions = PerformanceAnalyzer.detectRegression(currentMetrics, baselineMetrics, 0.2)

      expect(regressions).toHaveLength(0)
    })

    test('应该能够检测多个退化的操作', () => {
      const baselineMetrics: PerformanceMetrics[] = [
        { operation: 'op1', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op2', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false },
      ]

      const currentMetrics: PerformanceMetrics[] = [
        { operation: 'op1', type: 'dispatch', duration: 15, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op2', type: 'dispatch', duration: 20, timestamp: Date.now(), exceedThreshold: false },
      ]

      const regressions = PerformanceAnalyzer.detectRegression(currentMetrics, baselineMetrics, 0.2)

      expect(regressions).toHaveLength(2)
    })

    test('应该使用默认的退化阈值', () => {
      const baselineMetrics: PerformanceMetrics[] = [{ operation: 'testOp', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false }]

      const currentMetrics: PerformanceMetrics[] = [{ operation: 'testOp', type: 'dispatch', duration: 15, timestamp: Date.now(), exceedThreshold: false }]

      // 默认阈值0.2 (20%)
      const regressions = PerformanceAnalyzer.detectRegression(currentMetrics, baselineMetrics)

      expect(regressions[0].changePercent).toBe(50)
    })

    test('应该能够按退化程度排序', () => {
      const baselineMetrics: PerformanceMetrics[] = [
        { operation: 'op1', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op2', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false },
      ]

      const currentMetrics: PerformanceMetrics[] = [
        { operation: 'op1', type: 'dispatch', duration: 20, timestamp: Date.now(), exceedThreshold: false }, // 100%退化
        { operation: 'op2', type: 'dispatch', duration: 15, timestamp: Date.now(), exceedThreshold: false }, // 50%退化
      ]

      const regressions = PerformanceAnalyzer.detectRegression(currentMetrics, baselineMetrics, 0.2)

      expect(regressions[0].operation).toBe('op1') // 退化最严重
      expect(regressions[1].operation).toBe('op2')
    })

    test('应该能够计算准确的退化百分比', () => {
      const baselineMetrics: PerformanceMetrics[] = [{ operation: 'testOp', type: 'dispatch', duration: 100, timestamp: Date.now(), exceedThreshold: false }]

      const currentMetrics: PerformanceMetrics[] = [{ operation: 'testOp', type: 'dispatch', duration: 125, timestamp: Date.now(), exceedThreshold: false }]

      const regressions = PerformanceAnalyzer.detectRegression(currentMetrics, baselineMetrics, 0.2)

      expect(regressions[0].change).toBe(25) // 125 - 100
      expect(regressions[0].changePercent).toBe(25) // (25/100)*100
    })

    test('应该忽略在基准中不存在的操作', () => {
      const baselineMetrics: PerformanceMetrics[] = [{ operation: 'existingOp', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false }]

      const currentMetrics: PerformanceMetrics[] = [
        { operation: 'existingOp', type: 'dispatch', duration: 15, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'newOp', type: 'dispatch', duration: 100, timestamp: Date.now(), exceedThreshold: false }, // 新操作，不在基准中
      ]

      const regressions = PerformanceAnalyzer.detectRegression(currentMetrics, baselineMetrics, 0.2)

      // 只应该检测到 existingOp 的退化，newOp 应该被忽略
      expect(regressions).toHaveLength(1)
      expect(regressions[0].operation).toBe('existingOp')
    })
  })

  describe('复杂场景', () => {
    test('应该能够分析大量性能指标', () => {
      const metrics: PerformanceMetrics[] = []

      for (let i = 0; i < 1000; i++) {
        metrics.push({
          operation: `op${i % 10}`,
          type: 'dispatch',
          duration: Math.random() * 100,
          timestamp: Date.now(),
          exceedThreshold: Math.random() > 0.9,
        })
      }

      const bottlenecks = PerformanceAnalyzer.analyzeBottlenecks(metrics, 32)

      expect(bottlenecks.length).toBeGreaterThan(0)
    })

    test('应该能够在同一指标集合中检测退化', () => {
      const baselineMetrics: PerformanceMetrics[] = [
        { operation: 'op1', type: 'dispatch', duration: 10, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op2', type: 'dispatch', duration: 20, timestamp: Date.now(), exceedThreshold: false },
      ]

      const currentMetrics: PerformanceMetrics[] = [
        { operation: 'op1', type: 'dispatch', duration: 12, timestamp: Date.now(), exceedThreshold: false },
        { operation: 'op2', type: 'dispatch', duration: 15, timestamp: Date.now(), exceedThreshold: false },
      ]

      // 先检测瓶颈
      const bottlenecks = PerformanceAnalyzer.analyzeBottlenecks([...baselineMetrics, ...currentMetrics], 16)

      // 再检测退化
      const regressions = PerformanceAnalyzer.detectRegression(currentMetrics, baselineMetrics, 0.2)

      expect(bottlenecks.length).toBeGreaterThanOrEqual(0)
      expect(regressions.length).toBe(0) // 没有退化
    })
  })
})

// ==================== BUG 回归 ====================
describe('BUG 回归：大数组 spread 栈溢出', () => {
  it('collectBatch 处理 20 万条指标不应抛 RangeError', () => {
    const { MetricsCollector } = jest.requireActual('@/core/performance/metrics')
    const collector = new MetricsCollector(1000)
    const metric = { operation: 'bulk', type: 'dispatch', duration: 1, timestamp: Date.now(), exceedThreshold: false }
    const large = new Array(200000).fill(metric)

    expect(() => collector.collectBatch(large)).not.toThrow()
    expect(collector.getAll().length).toBe(1000)
  })
})
