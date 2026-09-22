/**
 * @geomstore/benchmark - 结果构建器
 */

import type { BenchmarkResult, DatasetSize, CacheStats } from './types/index.js'
import { DATASET_SIZE_THRESHOLDS } from './constants.js'

export interface TimeStats {
  total: number
  avg: number
  min: number
  max: number
  median: number
  p95: number
  p99: number
  stdDev: number
}

export interface MemoryStats {
  initial: number
  peak: number
  final: number
  delta: number
  avg: number
}

export interface ResultBuilderOptions {
  scenario: string
  iterations: number
  timeStats: TimeStats
  memoryStats?: MemoryStats
  cacheStats?: CacheStats
  passedCheck?: () => boolean
  warnings?: string[]
  errors?: string[]
}

export class ResultBuilder {
  static createResult(options: ResultBuilderOptions): BenchmarkResult {
    const { scenario, iterations, timeStats, memoryStats, cacheStats, passedCheck, warnings, errors } = options

    const throughput = this.calculateThroughput(iterations, timeStats)
    const cache = cacheStats ? buildCacheResult(cacheStats) : emptyCacheResult()
    const memory = memoryStats ?? this.emptyMemoryStats()

    // passedCheck 是调用方给的回调：它抛错时不能把异常直接透出（那会绕过本函数所有
    // 调用方的编排、也与 createErrorResult 的降级口径不一致），而是降级成「不通过 +
    // 记下原因」。判定结果按 `=== true` 严格取：签名写的是 `() => boolean`，返回
    // undefined（漏写 return）或字符串都是违约，让违约落到「通过」一侧就是把坏数据
    // 报成绿灯；未给回调才是「无判定可做」，默认通过。
    let passed = true
    let checkFailure: string | undefined
    if (passedCheck) {
      try {
        passed = passedCheck() === true
      } catch (error) {
        passed = false
        checkFailure = error instanceof Error ? error.message : String(error)
      }
    }

    const allErrors = checkFailure === undefined ? errors : [...(errors ?? []), `passedCheck 执行失败：${checkFailure}`]

    return {
      scenario,
      datasetSize: this.inferDatasetSize(iterations),
      iterations,
      results: { executionTime: timeStats, memory, throughput, cache },
      passed,
      warnings,
      errors: allErrors,
    }
  }

  static emptyTimeStats(): TimeStats {
    return { total: 0, avg: 0, min: 0, max: 0, median: 0, p95: 0, p99: 0, stdDev: 0 }
  }

  static emptyMemoryStats(): MemoryStats {
    return { initial: 0, peak: 0, final: 0, delta: 0, avg: 0 }
  }

  /**
   * 由迭代数与耗时反推吞吐量
   *
   * `peakInstantRate` 只有 runner 在逐轮记时间戳时才测得出来（`calculatePeakInstantRate`），
   * 单点构造与合并都造不出这个量：createResult 无输入可给，mergeResults 传的是
   * 参与合并各方的最大值。默认 0 而不是省略，因为该字段在类型上是必填。
   */
  private static calculateThroughput(
    iterations: number,
    timeStats: TimeStats,
    peakInstantRate = 0
  ): BenchmarkResult['results']['throughput'] {
    const totalSeconds = timeStats.total / 1000
    return { opsPerSecond: totalSeconds > 0 ? iterations / totalSeconds : 0, peakInstantRate }
  }

  private static inferDatasetSize(iterations: number): DatasetSize {
    if (iterations <= DATASET_SIZE_THRESHOLDS.SMALL_MAX) return 'small'
    if (iterations <= DATASET_SIZE_THRESHOLDS.MEDIUM_MAX) return 'medium'
    if (iterations <= DATASET_SIZE_THRESHOLDS.LARGE_MAX) return 'large'
    return 'xlarge'
  }

  static createErrorResult(scenario: string, iterations: number, error: Error | string): BenchmarkResult {
    return {
      scenario,
      datasetSize: this.inferDatasetSize(iterations),
      iterations,
      results: {
        executionTime: this.emptyTimeStats(),
        memory: this.emptyMemoryStats(),
        throughput: { opsPerSecond: 0, peakInstantRate: 0 },
        cache: emptyCacheResult(),
      },
      passed: false,
      errors: [error instanceof Error ? error.message : error],
    }
  }

  static mergeResults(scenario: string, results: BenchmarkResult[]): BenchmarkResult {
    if (results.length === 0) return this.createErrorResult(scenario, 0, 'No results to merge')

    const totalIterations = results.reduce((sum, r) => sum + r.iterations, 0)
    const passedCount = results.filter((r) => r.passed).length
    // 只合并一次：executionTime 与 throughput 必须来自同一份耗时统计，
    // 原先两处各调一次 mergeTimeStats（排序 + 标准差全做两遍），改一处就会让两者背离
    const mergedTimeStats = this.mergeTimeStats(
      results.map((r) => r.results.executionTime),
      totalIterations
    )
    // 峰值瞬时速率取参与合并各方的最大值：它不是可累加量（合并后的总速率由
    // totalIterations / total 另行给出），丢掉就等于合并报告里这一档恒为 0
    const peakInstantRate = results.reduce((m, r) => Math.max(m, r.results.throughput.peakInstantRate), 0)

    return {
      scenario,
      datasetSize: this.inferDatasetSize(totalIterations),
      iterations: totalIterations,
      results: {
        executionTime: mergedTimeStats,
        memory: this.mergeMemoryStats(results.map((r) => r.results.memory)),
        throughput: this.calculateThroughput(totalIterations, mergedTimeStats, peakInstantRate),
        cache: this.mergeCacheStats(results.map((r) => r.results.cache)),
      },
      passed: passedCount === results.length,
      warnings: results.flatMap((r) => r.warnings ?? []),
      errors: results.flatMap((r) => r.errors ?? []),
    }
  }

  /**
   * 合并多轮耗时统计
   *
   * `avg` 是「每次操作的平均耗时」，必须与同一份结果里的 throughput 互推得上：
   * throughput 按 `totalIterations / (total/1000)` 反推，等价的人均耗时就是
   * `total / totalIterations`。原先取各轮 avg 的算术平均，各轮迭代数不同（合并的
   * 常态）时两个数就会背离——10000 轮的一轮和 10 轮的一轮各占一半权重。
   * median/p95/p99/stdDev 仍按「各轮 avg」统计，它们描述的是轮间离散度。
   */
  private static mergeTimeStats(stats: TimeStats[], totalIterations: number): TimeStats {
    if (stats.length === 0) return this.emptyTimeStats()
    const avgs = stats.map((s) => s.avg)
    const total = stats.reduce((sum, s) => sum + s.total, 0)
    return {
      total,
      avg: total > 0 && totalIterations > 0 ? total / totalIterations : 0,
      // 单次遍历取极值：`Math.min(...arr)` 会把每个元素摊成实参，参与合并的结果数
      // 不受控（自行编排 harness 会按动作/场景分桶后全部并进来），上万条即
      // RangeError: Maximum call stack size exceeded
      min: stats.reduce((m, s) => Math.min(m, s.min), Number.POSITIVE_INFINITY),
      max: stats.reduce((m, s) => Math.max(m, s.max), Number.NEGATIVE_INFINITY),
      median: this.calculateMedian(avgs),
      p95: this.calculatePercentile(avgs, 95),
      p99: this.calculatePercentile(avgs, 99),
      stdDev: this.calculateStdDev(avgs),
    }
  }

  private static mergeMemoryStats(stats: MemoryStats[]): MemoryStats {
    if (stats.length === 0) return this.emptyMemoryStats()
    return {
      initial: stats[0].initial,
      // 同 mergeTimeStats：不用 `Math.max(...arr)`，避免实参数量随结果条数线性增长
      peak: stats.reduce((m, s) => Math.max(m, s.peak), Number.NEGATIVE_INFINITY),
      final: stats[stats.length - 1].final,
      delta: stats[stats.length - 1].final - stats[0].initial,
      avg: stats.reduce((sum, s) => sum + s.avg, 0) / stats.length,
    }
  }

  private static mergeCacheStats(stats: BenchmarkResult['results']['cache'][]): BenchmarkResult['results']['cache'] {
    const enabledStats = stats.filter((s) => s.enabled)
    if (enabledStats.length === 0) return emptyCacheResult()
    const totalHits = enabledStats.reduce((sum, s) => sum + s.hits, 0)
    const totalMisses = enabledStats.reduce((sum, s) => sum + s.misses, 0)
    const total = totalHits + totalMisses
    // evictions 是可选字段：任一参与合并的结果带该字段时求和后保留，
    // 全部缺失则维持 undefined（而非把「未统计」写成「0 次淘汰」）
    const hasEvictions = enabledStats.some((s) => s.evictions !== undefined)
    return {
      enabled: true,
      totalAccesses: total,
      hits: totalHits,
      misses: totalMisses,
      hitRate: total > 0 ? (totalHits / total) * 100 : 0,
      missRate: total > 0 ? (totalMisses / total) * 100 : 0,
      ...(hasEvictions ? { evictions: enabledStats.reduce((sum, s) => sum + (s.evictions ?? 0), 0) } : {}),
    }
  }

  private static calculateMedian(values: number[]): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }

  private static calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[Math.max(0, index)]
  }

  private static calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length
    const squaredDiffs = values.map((v) => Math.pow(v - avg, 2))
    return Math.sqrt(squaredDiffs.reduce((sum, d) => sum + d, 0) / values.length)
  }
}

/**
 * 计算缓存命中率
 */
export function calculateCacheHitRate(hits: number, misses: number): number {
  const total = hits + misses
  return total > 0 ? (hits / total) * 100 : 0
}

/**
 * 构建缓存结果
 */
export function buildCacheResult(stats: CacheStats): BenchmarkResult['results']['cache'] {
  const total = stats.hits + stats.misses
  return {
    enabled: stats.enabled,
    totalAccesses: total,
    hits: stats.hits,
    misses: stats.misses,
    hitRate: calculateCacheHitRate(stats.hits, stats.misses),
    missRate: total > 0 ? (stats.misses / total) * 100 : 0,
    evictions: stats.evictions,
  }
}

/**
 * 空缓存结果
 */
export function emptyCacheResult(): BenchmarkResult['results']['cache'] {
  return { enabled: false, totalAccesses: 0, hits: 0, misses: 0, hitRate: 0, missRate: 0 }
}

/**
 * 执行预热
 */
export function executeWarmup(fn: () => void, iterations: number): void {
  for (let i = 0; i < iterations; i++) {
    fn()
  }
}

/**
 * 预热缓存
 */
export function warmupCache<S extends Record<string, unknown>>(
  store: { getCached?: (key: string) => unknown; getState: () => S },
  iterations: number
): void {
  // 取属性式判定而非结构收窄：`BenchmarkStore.getCached` 是可选成员，
  // 声明成必填会让「直接把 BenchmarkStore 传进来」这一最常见写法编译不过（TS2345），
  // 而缓存未启用时它本来就该是 no-op
  if (!store.getCached) return
  const getCached = store.getCached
  const state = store.getState()
  const keys = Object.keys(state)
  // 空状态时 `i % 0` 得到 NaN，取出的键是 undefined，预热就变成了用 undefined 打缓存
  if (keys.length === 0) return
  for (let i = 0; i < iterations; i++) {
    const key = keys[i % keys.length]
    getCached.call(store, key)
  }
}
