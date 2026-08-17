/**
 * @geomstore/benchmark - 结果构建器
 */

import type { BenchmarkResult, DatasetSize, CacheStats } from './types'
import { DATASET_SIZE_THRESHOLDS } from './constants'

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
    const cache = cacheStats ? this.buildCacheResult(cacheStats) : this.emptyCacheStats()
    const memory = memoryStats ?? this.emptyMemoryStats()
    const passed = passedCheck?.() ?? true

    return {
      scenario,
      datasetSize: this.inferDatasetSize(iterations),
      iterations,
      results: { executionTime: timeStats, memory, throughput, cache },
      passed,
      warnings,
      errors,
    }
  }

  static emptyTimeStats(): TimeStats {
    return { total: 0, avg: 0, min: 0, max: 0, median: 0, p95: 0, p99: 0, stdDev: 0 }
  }

  static emptyMemoryStats(): MemoryStats {
    return { initial: 0, peak: 0, final: 0, delta: 0, avg: 0 }
  }

  private static emptyCacheStats(): BenchmarkResult['results']['cache'] {
    return { enabled: false, totalAccesses: 0, hits: 0, misses: 0, hitRate: 0, missRate: 0 }
  }

  private static buildCacheResult(stats: CacheStats): BenchmarkResult['results']['cache'] {
    const total = stats.hits + stats.misses
    const hitRate = total > 0 ? (stats.hits / total) * 100 : 0
    const missRate = total > 0 ? (stats.misses / total) * 100 : 0
    return { enabled: stats.enabled, totalAccesses: total, hits: stats.hits, misses: stats.misses, hitRate, missRate, evictions: stats.evictions }
  }

  private static calculateThroughput(iterations: number, timeStats: TimeStats): BenchmarkResult['results']['throughput'] {
    const totalSeconds = timeStats.total / 1000
    return { opsPerSecond: totalSeconds > 0 ? iterations / totalSeconds : 0, peakInstantRate: 0 }
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
        cache: this.emptyCacheStats(),
      },
      passed: false,
      errors: [error instanceof Error ? error.message : error],
    }
  }

  static mergeResults(scenario: string, results: BenchmarkResult[]): BenchmarkResult {
    if (results.length === 0) return this.createErrorResult(scenario, 0, 'No results to merge')

    const totalIterations = results.reduce((sum, r) => sum + r.iterations, 0)
    const passedCount = results.filter((r) => r.passed).length

    return {
      scenario,
      datasetSize: this.inferDatasetSize(totalIterations),
      iterations: totalIterations,
      results: {
        executionTime: this.mergeTimeStats(results.map((r) => r.results.executionTime)),
        memory: this.mergeMemoryStats(results.map((r) => r.results.memory)),
        throughput: this.calculateThroughput(totalIterations, this.mergeTimeStats(results.map((r) => r.results.executionTime))),
        cache: this.mergeCacheStats(results.map((r) => r.results.cache)),
      },
      passed: passedCount === results.length,
      warnings: results.flatMap((r) => r.warnings ?? []),
      errors: results.flatMap((r) => r.errors ?? []),
    }
  }

  private static mergeTimeStats(stats: TimeStats[]): TimeStats {
    if (stats.length === 0) return this.emptyTimeStats()
    const avgs = stats.map((s) => s.avg)
    return {
      total: stats.reduce((sum, s) => sum + s.total, 0),
      avg: avgs.reduce((sum, a) => sum + a, 0) / avgs.length,
      min: Math.min(...stats.map((s) => s.min)),
      max: Math.max(...stats.map((s) => s.max)),
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
      peak: Math.max(...stats.map((s) => s.peak)),
      final: stats[stats.length - 1].final,
      delta: stats[stats.length - 1].final - stats[0].initial,
      avg: stats.reduce((sum, s) => sum + s.avg, 0) / stats.length,
    }
  }

  private static mergeCacheStats(stats: BenchmarkResult['results']['cache'][]): BenchmarkResult['results']['cache'] {
    const enabledStats = stats.filter((s) => s.enabled)
    if (enabledStats.length === 0) return this.emptyCacheStats()
    const totalHits = enabledStats.reduce((sum, s) => sum + s.hits, 0)
    const totalMisses = enabledStats.reduce((sum, s) => sum + s.misses, 0)
    const total = totalHits + totalMisses
    return {
      enabled: true,
      totalAccesses: total,
      hits: totalHits,
      misses: totalMisses,
      hitRate: total > 0 ? (totalHits / total) * 100 : 0,
      missRate: total > 0 ? (totalMisses / total) * 100 : 0,
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
  store: { getCached: (key: string) => unknown; getState: () => S },
  iterations: number
): void {
  const state = store.getState()
  const keys = Object.keys(state)
  for (let i = 0; i < iterations; i++) {
    const key = keys[i % keys.length]
    store.getCached(key)
  }
}
