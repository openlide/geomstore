/**
 * 第六轮 f1-03 分片的回归锁（一）：结果构建 / 合并统计 / 适配器 / 格式化
 *
 * 覆盖 R6-020（datasetSize 反推）、R6-021（合并分位数口径）、R6-022（恒在的 getCached
 * 绕过 readKey 退化路径）、R6-072（异步预热静默不等待）、R6-075（formatNumber 非有限值）。
 * 每条都写成「旧实现会红、新实现绿」的形状；旧实现侧的实测输出记在
 * `.ocr-fix/verdicts6/f1-03.md` 的新旧对照探针里。
 */

import { ResultBuilder, executeWarmup, executeWarmupAsync, type TimeStats } from '../../packages/benchmark/src/helpers.js'
import { createBenchmarkAdapter } from '../../packages/benchmark/src/index.js'
import { benchmarkUtils } from '../../packages/benchmark/src/utils.js'
import type { BenchmarkResult, BenchmarkStore, State } from '../../packages/benchmark/src/types/index.js'

/** 一个够用的 BenchmarkStore 形状（各用例按需覆盖成员） */
function makeStore(overrides: Partial<BenchmarkStore> = {}): BenchmarkStore {
  const bag: Record<string, unknown> = { a: 1 }
  return {
    getState: () => bag as State,
    setState: (key: string, value: unknown) => {
      bag[String(key)] = value
    },
    $patch: (partial) => Object.assign(bag, partial),
    $replaceState: (next) => {
      for (const k of Object.keys(bag)) delete bag[k]
      Object.assign(bag, next)
    },
    actions: {},
    dispatch: () => undefined,
    subscribe: () => () => undefined,
    destroy: () => undefined,
    ...overrides,
  }
}

function stats(over: Partial<TimeStats> = {}): TimeStats {
  return { total: 1000, avg: 0.1, min: 0.001, max: 1, median: 0.1, p95: 0.2, p99: 0.3, stdDev: 0.05, ...over }
}

function resultOf(scenario: string, iterations: number, datasetSize: BenchmarkResult['datasetSize'], executionTime: TimeStats): BenchmarkResult {
  return {
    scenario,
    datasetSize,
    iterations,
    results: {
      executionTime,
      memory: { initial: 0, peak: 0, final: 0, delta: 0, avg: 0 },
      throughput: { opsPerSecond: 0, peakInstantRate: 0 },
      cache: { enabled: false, totalAccesses: 0, hits: 0, misses: 0, hitRate: 0, missRate: 0 },
    },
    passed: true,
  }
}

describe('R6-020 datasetSize 不再由迭代数反推（有真档位就用真的）', () => {
  it('createErrorResult 采信显式档位：1000 轮的 large 档不被标成 small', () => {
    const failed = ResultBuilder.createErrorResult('large-workload', 1000, new Error('测量前抛错'), 'large')
    expect(failed.datasetSize).toBe('large')
    expect(failed.iterations).toBe(1000)
    expect(failed.passed).toBe(false)
  })

  it('createResult 同样采信显式档位，未给时才回退反推', () => {
    const explicit = ResultBuilder.createResult({ scenario: 'basic-read', iterations: 10000, datasetSize: 'small', timeStats: stats() })
    expect(explicit.datasetSize).toBe('small')
    // 未给档位 ⟹ 退回「按迭代数反推」这级兜底（10000 轮 → large），口径与改前一致
    const inferred = ResultBuilder.createResult({ scenario: 'basic-read', iterations: 10000, timeStats: stats() })
    expect(inferred.datasetSize).toBe('large')
  })

  it('mergeResults：参与方档位一致时沿用，不再把 3×5000 轮 medium 标成 xlarge', () => {
    const runs = Array.from({ length: 3 }, () => resultOf('medium-workload', 5000, 'medium', stats()))
    expect(ResultBuilder.mergeResults('medium-workload', runs).datasetSize).toBe('medium')
  })

  it('mergeResults：档位互不一致时退回迭代数反推，显式参数优先于一切', () => {
    const mixed = [resultOf('x', 10000, 'small', stats()), resultOf('x', 10, 'xlarge', stats())]
    // 10000 + 10 轮 → 超过 LARGE_MAX(10000) ⟹ 反推为 xlarge（这条兜底本就只在没有唯一答案时用）
    expect(ResultBuilder.mergeResults('x', mixed).datasetSize).toBe('xlarge')
    expect(ResultBuilder.mergeResults('x', mixed, 'medium').datasetSize).toBe('medium')
  })
})

describe('R6-021 合并结果的分位数是「逐次操作」口径，不是各轮均值的分布', () => {
  /** 两份轮内抖动极大、轮均值很平的样本：轮均值的 p99 远小于真实操作 p99 */
  const sampleA = Array.from({ length: 5000 }, (_, i) => (i % 100 === 0 ? 5 : 0.1))
  const sampleB = Array.from({ length: 5000 }, (_, i) => (i % 50 === 0 ? 3 : 0.9))

  const statsA = benchmarkUtils.calculateTimeStats(sampleA)
  const statsB = benchmarkUtils.calculateTimeStats(sampleB)
  const pooled = benchmarkUtils.calculateTimeStats([...sampleA, ...sampleB])
  const merged = ResultBuilder.mergeResults('m', [resultOf('m', sampleA.length, 'small', statsA), resultOf('m', sampleB.length, 'small', statsB)]).results
    .executionTime

  it('参与方的轮均值序列会算出一个更小的 p99（这正是被悄悄放宽的那一侧）', () => {
    const avgSeriesP99 = benchmarkUtils.calculatePercentile([statsA.avg, statsB.avg], 99)
    expect(avgSeriesP99).toBeLessThan(pooled.p99)
  })

  it('合并 p95/p99 取参与方同一分位的最大值，是真实合并总体的上界', () => {
    expect(merged.p99).toBe(Math.max(statsA.p99, statsB.p99))
    expect(merged.p95).toBe(Math.max(statsA.p95, statsB.p95))
    expect(merged.p99).toBeGreaterThanOrEqual(pooled.p99)
  })

  it('合并 median 同样不再取「各轮 avg 的中位数」', () => {
    expect(merged.median).toBe(Math.max(statsA.median, statsB.median))
    expect(merged.median).not.toBe(benchmarkUtils.calculateMedian([statsA.avg, statsB.avg]))
  })

  it('合并 stdDev 按全方差公式精确合并（与真实合并总体的标准差一致）', () => {
    expect(merged.stdDev).toBeCloseTo(pooled.stdDev, 9)
  })

  it('min/max 仍是逐次操作的极值，avg 与吞吐同源', () => {
    expect(merged.min).toBeCloseTo(Math.min(statsA.min, statsB.min), 12)
    expect(merged.max).toBeCloseTo(Math.max(statsA.max, statsB.max), 12)
    const totalIterations = sampleA.length + sampleB.length
    expect(merged.avg).toBeCloseTo((statsA.total + statsB.total) / totalIterations, 12)
  })

  it('空数组与「0 轮却带耗时」的自相矛盾输入都不产出 NaN', () => {
    expect(ResultBuilder.mergeResults('none', []).datasetSize).toBe('small')
    const zeroRounds = ResultBuilder.mergeResults('z', [resultOf('z', 0, 'small', stats({ total: 100 }))])
    for (const value of Object.values(zeroRounds.results.executionTime)) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe('R6-022 适配器按存在性暴露 getCached，readKey 的退化路径在适配入口下可达', () => {
  it('成员随源对象的存在性走：没有 ⟹ undefined，挂上 ⟹ 可调用，撤掉 ⟹ 又缺席', () => {
    const store = makeStore()
    const adapted = createBenchmarkAdapter(store)
    expect(adapted.getCached).toBeUndefined()

    store.getCached = (key: string) => `cached:${key}`
    expect(adapted.getCached?.('k')).toBe('cached:k')

    delete (store as { getCached?: unknown }).getCached
    expect(adapted.getCached).toBeUndefined()
  })

  it('方法简写式的实现被调用时 this 仍绑回源对象', () => {
    class Legacy {
      private readonly tag = 'tagged:'

      getState(): State {
        return { a: 1 }
      }

      setState(): void {
        /* 本用例不写状态 */
      }

      $patch(): void {
        /* 本用例不 patch */
      }

      $replaceState(): void {
        /* 本用例不替换 */
      }

      actions = {}

      dispatch(): unknown {
        return undefined
      }

      subscribe(): () => void {
        return () => undefined
      }

      destroy(): void {
        /* 无资源 */
      }

      getCached(key: string): string {
        return this.tag + key
      }
    }

    const adapted = createBenchmarkAdapter(new Legacy() as unknown as BenchmarkStore)
    // 恒存在的箭头函数包装会把「一次什么都不做的调用」当成被计时的读；
    // 现在这一路必须真的打到实现上，且 this 指向源实例（脱附调用会 TypeError）
    expect(adapted.getCached?.('k')).toBe('tagged:k')
  })

  it('getCacheStats 的三态契约不受本次改动影响', () => {
    const store = makeStore()
    const adapted = createBenchmarkAdapter(store)
    expect(adapted.getCacheStats).toBeUndefined()
    store.getCacheStats = () => ({ enabled: true, hits: 3, misses: 1 })
    expect(adapted.getCacheStats?.().hits).toBe(3)
  })
})

describe('R6-072 预热入口不再静默吞下异步回调', () => {
  it('executeWarmup 对返回 Promise 的回调当场 TypeError（TS 层面这行照样编译得过来）', () => {
    const asyncWarm = async (): Promise<void> => {
      await Promise.resolve()
    }
    let caught: unknown
    try {
      executeWarmup(asyncWarm, 5)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(TypeError)
    expect((caught as Error).message).toContain('executeWarmupAsync')
  })

  it('预热体自身抛错不会留下 floating rejection（旧写法会把它交给 Node 默认策略终止整轮基准）', async () => {
    const rejecting = async (): Promise<void> => {
      await Promise.resolve()
      throw new Error('预热体里炸了')
    }
    const unhandled: unknown[] = []
    const onHide = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onHide)
    try {
      expect(() => executeWarmup(rejecting, 3)).toThrow(TypeError)
      // 让 microtask / 宏任务队列各跑空一轮：旧写法在这里就会把未捕获拒绝报出来
      await new Promise((resolve) => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', onHide)
    }
    expect(unhandled).toHaveLength(0)
  })

  it('同步回调照常跑满 iterations', () => {
    let runs = 0
    executeWarmup(() => {
      runs++
    }, 7)
    expect(runs).toBe(7)
    expect(() => executeWarmup(() => undefined, 0)).not.toThrow()
  })

  it('executeWarmupAsync 逐轮 await 到兑现才进下一轮', async () => {
    const order: string[] = []
    await executeWarmupAsync(async () => {
      order.push('start')
      await new Promise((resolve) => setImmediate(resolve))
      order.push('end')
    }, 3)
    expect(order).toEqual(['start', 'end', 'start', 'end', 'start', 'end'])
  })

  it('executeWarmupAsync 接受同步回调（await 一个 undefined 合法）', async () => {
    let runs = 0
    await executeWarmupAsync(() => {
      runs++
    }, 2)
    expect(runs).toBe(2)
  })
})

describe('R6-075 formatNumber 与 formatBytes/formatTime 同一口径收敛非有限值', () => {
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('%p → N/A', (value) => {
    expect(benchmarkUtils.formatNumber(value)).toBe('N/A')
  })

  it('正常值的千分位与小数位口径不变', () => {
    expect(benchmarkUtils.formatNumber(1234.5)).toBe('1,234.5')
    expect(benchmarkUtils.formatNumber(0)).toBe('0')
    expect(benchmarkUtils.formatNumber(-1500)).toBe('-1,500')
    expect(benchmarkUtils.formatNumber(1234.5678)).toBe('1,234.57')
  })
})
