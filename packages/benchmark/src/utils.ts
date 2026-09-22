/**
 * @geomstore/benchmark - 基准测试工具类
 */

import v8 from 'node:v8'

// Node.js 环境类型声明
declare const global: typeof globalThis & { gc?: () => void }
declare const process: {
  memoryUsage(): { heapTotal: number; heapUsed: number; external: number }
}

import type { IterationOutcome, MemorySnapshot, BenchmarkUtilsContract } from './types/index.js'

/** 数值升序比较器：`sort()` 默认按字符串比较，`[10, 9]` 会被排成 `[10, 9]` */
const ASCENDING = (a: number, b: number): number => a - b

/**
 * 在「已排序」的数组上取百分位
 *
 * 与 `BenchmarkUtils.calculatePercentile` 的越界夹取口径完全一致（下标算式一字未改），
 * 只是不再自己拷贝排序：`calculateTimeStats` 要一次取 p50/p95/p99，共用一份有序数组即可。
 */
function percentileOfSorted(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0
  // 百分位与下标都要夹住：percentile <= 0 时下标算成 -1、> 100 时越出右边界，
  // 两种越界都让 sorted[index] 取到 undefined，直接违背签名的 number；
  // NaN 走 Math.min/Math.max 也会得 NaN，单独贴到 0 一侧（±Infinity 仍按夹取走两端）
  const clamped = Number.isNaN(percentile) ? 0 : Math.min(100, Math.max(0, percentile))
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((clamped / 100) * sorted.length) - 1)
  )
  return sorted[index]
}

/**
 * 进程真实的 V8 堆上限（字节）
 *
 * 堆上限在进程启动时就定下，取一次缓存即可（getMemorySnapshot 在热循环里每轮都调）。
 * 原先编造为 `heapTotal * 2`：本机实测 heapTotal*2 ≈ 104MB，而真实
 * `heap_size_limit` ≈ 4.1GB，用它算「还剩多少堆」会差一个数量级。
 */
const HEAP_SIZE_LIMIT = v8.getHeapStatistics().heap_size_limit

/**
 * 基准测试工具类实现
 */
export class BenchmarkUtils implements BenchmarkUtilsContract {
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
    return percentileOfSorted([...values].sort(ASCENDING), percentile)
  }

  /**
   * 中位数 = 第 50 百分位
   *
   * 走百分位的下标口径，偶数长度取「下中位数」而非两中值平均（`[1,2,3,4]` → 2）。
   * `ResultBuilder.calculateMedian` 取的是平均（同一输入给 2.5）——两处口径确实不同，
   * 但 BenchmarkResult 的 median/p95/p99 必须同源可比，这里保持百分位口径不动，
   * 只把差异写清楚，免得有人把两份数当成同一回事对比。
   */
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
      heapLimit: HEAP_SIZE_LIMIT,
      external: memory.external,
    }
  }

  /**
   * 取若干次采样的平均快照
   *
   * `samples` 为 0 / 负数 / NaN 时原先一次循环都不跑：`snapshots[0].heapLimit` 直接
   * TypeError（实测），三处求平均也全成 0/0 = NaN。夹到至少 1 次，语义退化为「就取当前这一次」。
   */
  getAverageMemorySnapshot(samples = 10): MemorySnapshot {
    const count = Number.isFinite(samples) ? Math.max(1, Math.floor(samples)) : 1
    const snapshots: MemorySnapshot[] = []
    for (let i = 0; i < count; i++) {
      snapshots.push(this.getMemorySnapshot())
    }
    return {
      timestamp: Date.now(),
      heapTotal: Math.round(snapshots.reduce((sum, s) => sum + s.heapTotal, 0) / count),
      heapUsed: Math.round(snapshots.reduce((sum, s) => sum + s.heapUsed, 0) / count),
      heapLimit: snapshots[0].heapLimit,
      external: Math.round(snapshots.reduce((sum, s) => sum + s.external, 0) / count),
    }
  }

  /**
   * 格式化字节数
   *
   * 非有限值没有可显示的量纲，返回 `N/A`：原先 NaN 打成 `NaN B`、Infinity 一路升到
   * `Infinity TB`（while 循环每轮都满足 `>= 1024`，直到单位耗尽）。
   * 负值按绝对值选单位、把符号留在前面（-1536 → `-1.50 KB`）：原先 `size >= 1024` 对负数
   * 恒不成立，实测 `-1536` 会原样打成 `-1536.00 B`；把它夹成 `0.00 B` 又会抹掉
   * 「内存增量为负」这类真实信号，所以选保号而不是夹零。
   */
  formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes)) return 'N/A'
    const sign = bytes < 0 ? '-' : ''
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    let size = Math.abs(bytes)
    let unitIndex = 0
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }
    return `${sign}${size.toFixed(2)} ${units[unitIndex]}`
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

  /**
   * 跑一轮，并把该轮的异常收进结果而不是往上抛
   *
   * 单次 fn 抛错原本会让整个 repeat/parallel 一起 reject、已测量的每一轮数据全丢；
   * 基准测试要回答的恰恰是「第几轮开始崩、崩之前的分布长什么样」，故在此就地吸收。
   */
  private async measureIteration<T>(fn: () => T | Promise<T>): Promise<IterationOutcome<T>> {
    const startTime = performance.now()
    try {
      const result = await fn()
      return { result, duration: performance.now() - startTime }
    } catch (error) {
      return {
        result: undefined,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async repeat<T>(fn: () => T | Promise<T>, iterations: number): Promise<IterationOutcome<T>[]> {
    const results: IterationOutcome<T>[] = []
    for (let i = 0; i < iterations; i++) {
      results.push(await this.measureIteration(fn))
    }
    return results
  }

  async parallel<T>(
    fn: () => T | Promise<T>,
    concurrency: number,
    total: number
  ): Promise<IterationOutcome<T>[]> {
    const results: IterationOutcome<T>[] = []
    const workers: Promise<void>[] = []
    let completed = 0

    for (let i = 0; i < Math.min(concurrency, total); i++) {
      workers.push(
        (async () => {
          while (true) {
            // 同步预约槽位：先读 completed、await 之后再自增会让多个 worker 同时通过
            // `completed < total` 判断，实际执行次数超过 total，结果条数与时序都不确定
            const index = completed++
            if (index >= total) return
            results[index] = await this.measureIteration(fn)
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
    // 分位数只排一次序：原先 calculateMedian 与 calculatePercentile(95)/(99) 各自
    // `[...values].sort()`，实测一次 calculateTimeStats 触发 3 份拷贝 + 3 次排序
    // （O(3n log n)），而 xlarge 档的迭代数正是十万量级
    const sorted = [...durations].sort(ASCENDING)
    // 单次遍历取极值：`Math.min(...durations)` 会把每个元素变成一个实参，实测
    // 12.8 万轮迭代就抛 RangeError: Maximum call stack size exceeded，
    // 而 xlarge 档跑满迭代数正是这个量级
    let min = Infinity
    let max = -Infinity
    for (const d of durations) {
      if (d < min) min = d
      if (d > max) max = d
    }
    const median = percentileOfSorted(sorted, 50)
    const p95 = percentileOfSorted(sorted, 95)
    const p99 = percentileOfSorted(sorted, 99)
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
