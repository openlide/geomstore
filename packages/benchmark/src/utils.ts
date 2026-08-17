/**
 * @geomstore/benchmark - 基准测试工具类
 */

// Node.js 环境类型声明
declare const global: typeof globalThis & { gc?: () => void }
declare const process: {
  memoryUsage(): { heapTotal: number; heapUsed: number; external: number }
}

import type { MemorySnapshot, BenchmarkUtils as IBenchmarkUtils } from './types'

/**
 * 基准测试工具类实现
 */
export class BenchmarkUtils implements IBenchmarkUtils {
  measureTime<T>(fn: () => T): { result: T; duration: number } {
    const startTime = performance.now()
    const result = fn()
    const endTime = performance.now()
    return { result, duration: endTime - startTime }
  }

  async measureTimeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const startTime = performance.now()
    const result = await fn()
    const endTime = performance.now()
    return { result, duration: endTime - startTime }
  }

  measureMemory<T>(fn: () => T): { result: T; memoryBefore: number; memoryAfter: number } {
    const memoryBefore = this.getMemorySnapshot().heapUsed
    const result = fn()
    const memoryAfter = this.getMemorySnapshot().heapUsed
    return { result, memoryBefore, memoryAfter }
  }

  generateTestData(size: number): Record<string, unknown> {
    const data: Record<string, unknown> = {}
    for (let i = 0; i < size; i++) {
      data[`key${i}`] = {
        id: i,
        value: `value${i}`,
        nested: { level1: { level2: { level3: `deep${i}` } } },
      }
    }
    return data
  }

  generateTestState(size: number): Record<string, unknown> {
    const state: Record<string, unknown> = {}
    for (let i = 0; i < size; i++) {
      state[`field${i}`] = Math.random()
    }
    return state
  }

  calculatePercentile(values: number[], percentile: number): number {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.ceil((percentile / 100) * sorted.length) - 1
    return sorted[index]
  }

  calculateMedian(values: number[]): number {
    return this.calculatePercentile(values, 50)
  }

  calculateStandardDeviation(values: number[], avg: number): number {
    if (values.length === 0) return 0
    const squaredDiffs = values.map((value) => Math.pow(value - avg, 2))
    const avgSquaredDiff = squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length
    return Math.sqrt(avgSquaredDiff)
  }

  forceGC(): boolean {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof (global as any).gc === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (global as any).gc()
        return true
      }
    } catch {
      // GC 不可用
    }
    return false
  }

  getMemorySnapshot(): MemorySnapshot {
    const memory = process.memoryUsage()
    return {
      timestamp: Date.now(),
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      heapLimit: memory.heapTotal * 2,
      external: memory.external,
    }
  }

  getAverageMemorySnapshot(samples = 10): MemorySnapshot {
    const snapshots: MemorySnapshot[] = []
    for (let i = 0; i < samples; i++) {
      snapshots.push(this.getMemorySnapshot())
    }
    return {
      timestamp: Date.now(),
      heapTotal: Math.round(snapshots.reduce((sum, s) => sum + s.heapTotal, 0) / samples),
      heapUsed: Math.round(snapshots.reduce((sum, s) => sum + s.heapUsed, 0) / samples),
      heapLimit: snapshots[0].heapLimit,
      external: Math.round(snapshots.reduce((sum, s) => sum + s.external, 0) / samples),
    }
  }

  formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = bytes
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`
  }

  formatTime(ms: number): string {
    if (ms < 0.001) return `${(ms * 1000000).toFixed(2)}ns`
    if (ms < 1) return `${(ms * 1000).toFixed(2)}µs`
    if (ms < 1000) return `${ms.toFixed(2)}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
    const minutes = Math.floor(ms / 60000)
    const seconds = ((ms % 60000) / 1000).toFixed(2)
    return `${minutes}m ${seconds}s`
  }

  formatNumber(num: number): string {
    return num.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }

  async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async repeat<T>(fn: () => T | Promise<T>, iterations: number): Promise<Array<{ result: T; duration: number }>> {
    const results: Array<{ result: T; duration: number }> = []
    for (let i = 0; i < iterations; i++) {
      const { result, duration } = await this.measureTimeAsync(async () => await fn())
      results.push({ result, duration })
    }
    return results
  }

  async parallel<T>(
    fn: () => T | Promise<T>,
    concurrency: number,
    total: number
  ): Promise<Array<{ result: T; duration: number }>> {
    const results: Array<{ result: T; duration: number }> = []
    const workers: Promise<void>[] = []
    let completed = 0

    for (let i = 0; i < Math.min(concurrency, total); i++) {
      workers.push(
        (async () => {
          while (completed < total) {
            const { result, duration } = await this.measureTimeAsync(async () => await fn())
            results.push({ result, duration })
            completed++
          }
        })()
      )
    }

    await Promise.all(workers)
    return results
  }

  calculateTimeStats(durations: number[]): {
    total: number
    avg: number
    min: number
    max: number
    median: number
    p95: number
    p99: number
    stdDev: number
  } {
    if (durations.length === 0) {
      return { total: 0, avg: 0, min: 0, max: 0, median: 0, p95: 0, p99: 0, stdDev: 0 }
    }

    const total = durations.reduce((sum, d) => sum + d, 0)
    const avg = total / durations.length
    const min = Math.min(...durations)
    const max = Math.max(...durations)
    const median = this.calculateMedian(durations)
    const p95 = this.calculatePercentile(durations, 95)
    const p99 = this.calculatePercentile(durations, 99)
    const stdDev = this.calculateStandardDeviation(durations, avg)

    return { total, avg, min, max, median, p95, p99, stdDev }
  }

  createTestStoreConfig(stateKeys: number) {
    const state: Record<string, unknown> = this.generateTestState(stateKeys)
    const actions: Record<string, () => unknown> = {}
    const getters: Record<string, (state: Record<string, unknown>) => unknown> = {}

    for (let i = 0; i < Math.min(stateKeys, 20); i++) {
      actions[`action${i}`] = () => `result${i}`
    }

    for (let i = 0; i < Math.min(stateKeys, 10); i++) {
      getters[`getter${i}`] = (state: Record<string, unknown>) => state[`field${i}`]
    }

    return { state, actions, getters }
  }
}

export const benchmarkUtils = new BenchmarkUtils()
