/**
 * @geomstore/benchmark - 基准测试工具类
 */

// Node.js 环境类型声明
declare const process: {
  memoryUsage(): { heapTotal: number; heapUsed: number; external: number }
  /**
   * Node 22.3+ 的同步内置模块入口。刻意用它而不是 `import v8 from 'node:v8'`：
   * 静态 import 在模块**链接**阶段就解析 specifier，取不到 `node:v8` 的宿主
   * （浏览器 / edge / 非 Node runtime）会在 import 那一行就炸，而本模块大半成员
   * （`formatTime`、`calculatePercentile`…）跟内存毫无关系。
   */
  getBuiltinModule?(id: string): unknown
}

import type { IterationOutcome, MemorySnapshot, BenchmarkUtilsContract } from './types/index.js'

/** 数值升序比较器：`sort()` 默认按字符串比较，`[10, 9]` 会被排成 `[10, 9]` */
const ASCENDING = (a: number, b: number): number => a - b

/** `node:v8` 里本模块用到的最小形状 */
type V8HeapStatisticsProvider = { getHeapStatistics(): { heap_size_limit: number } }

/**
 * 进程真实的 V8 堆上限（字节），首次需要时解析、之后连失败结果一起复用
 *
 * 堆上限在进程启动时就定下，解析一次即可缓存（`getMemorySnapshot()` 在热循环里每轮都调）。
 * 旧实现把 `v8.getHeapStatistics()` 放到模块顶层求值，等于把一次宿主能力探测提前到 import
 * 时刻，且失败无法兜住。另一个口径问题是它曾被编造为 `heapTotal * 2`：本机实测
 * heapTotal*2 ≈ 104MB 而真实 `heap_size_limit` ≈ 4.1GB，用它算「还剩多少堆」差一个数量级，
 * 所以宁可报「取不到」也不能编一个数。
 *
 * 取不到（宿主没有 `getBuiltinModule`、没有 `node:v8`、或调用抛错）时返回 `0`，
 * 语义是「本宿主读不到堆上限」——真实的堆上限不可能是 0，两者可区分。
 */
let cachedHeapLimit = 0
let heapLimitResolved = false

function heapSizeLimit(): number {
  if (!heapLimitResolved) {
    heapLimitResolved = true
    try {
      const v8 = process.getBuiltinModule?.('node:v8') as V8HeapStatisticsProvider | undefined
      const limit = v8?.getHeapStatistics().heap_size_limit
      cachedHeapLimit = typeof limit === 'number' && Number.isFinite(limit) ? limit : 0
    } catch {
      cachedHeapLimit = 0
    }
  }
  return cachedHeapLimit
}

/**
 * 计数类入参的统一口径（`repeat` 的 iterations、`parallel` 的 total / concurrency）
 *
 * 非有限值（NaN / ±Infinity）是调用方把计数算错了，不是「0 次」的同义词：静默夹成 0
 * 会让整轮测量凭空消失，旧 `parallel` 甚至一个 worker 都不开、直接给回空数组。
 * 小数向下取整：旧 `parallel` 在 `total = 10.5` 时下标 10 照样被执行，多跑一轮。
 */
function toCount(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} 必须是有限数值，收到 ${value}`)
  }
  return Math.floor(value)
}

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

  /**
   * 测一段同步代码的堆增量
   *
   * 两侧各压一次 GC：`heapUsed` 是「采样瞬间的存活字节数」，不先扫干净的话，基线里挂着
   * 上一轮尚未回收的垃圾、收尾里挂着本轮待回收的临时对象，两个噪声相加后得到的增量
   * 与被测代码到底留存了多少无关——热循环里噪声远大于信号，报出来的 before/after 是误导。
   * GC 之后两侧度量的都是「回收后仍然存活」的字节，差值即本轮净留存（`fn` 的返回值被
   * 调用方持有，故它不会被这一步收掉）。
   *
   * 依赖 `--expose-gc`：没有该 flag 时 `forceGC()` 返回 false、本方法就地退化成
   * 「不压 GC 的前后采样」，此时增量只能当方向参考，别拿去比阈值。这里刻意不把 false
   * 变成抛错或告警：能不能压 GC 由启动参数决定，不是调用方在运行期能补救的失败。
   * 另注意 `BenchmarkConfig.general.skipGC` 管不到这里——那个开关只控制 runner 整轮
   * 开始前的一次预热 GC；本方法始终尝试压 GC，因为不压的两侧采样根本不具可比性。
   */
  measureMemory<T>(fn: () => T): { result: T; memoryBefore: number; memoryAfter: number } {
    this.forceGC()
    const memoryBefore = this.getMemorySnapshot().heapUsed
    const result = fn()
    this.forceGC()
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

  /**
   * 总体标准差（除以 `values.length`，不是样本标准差的 n-1）
   *
   * 单循环累加，不再 `map` 出第二份数组：`calculateTimeStats` 拿整轮耗时数组调这里
   * （xlarge 档是十万量级元素），那份中间数组纯属白分配。
   * `diff * diff` 与 `Math.pow(diff, 2)` 对有限浮点逐位相同，取前者省一次函数调用。
   */
  calculateStandardDeviation(values: number[], avg: number): number {
    if (values.length === 0) return 0
    let sumSquaredDiff = 0
    for (const value of values) {
      const diff = value - avg
      sumSquaredDiff += diff * diff
    }
    return Math.sqrt(sumSquaredDiff / values.length)
  }

  /**
   * 触发一次完整 GC
   *
   * 只有带 `--expose-gc` 启动时 `globalThis.gc` 才存在（Node 的 `global` 就是 `globalThis`，
   * 读 globalThis 而不是读模块顶部那句 `declare const global` 式的名字：后者只是编译期的
   * 一厢情愿，没有该全局的宿主里取它直接 ReferenceError）。取不到就返回 false，不抛——
   * 能不能压 GC 由启动参数决定，调用方按返回值决定口径，不是本方法能补救的失败。
   */
  forceGC(): boolean {
    const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc
    if (typeof gc === 'function') {
      gc()
      return true
    }
    return false
  }

  getMemorySnapshot(): MemorySnapshot {
    const memory = process.memoryUsage()
    return {
      timestamp: Date.now(),
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      heapLimit: heapSizeLimit(),
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

  /**
   * 格式化时长（入参单位：毫秒）
   *
   * 与 `formatBytes` 同口径，两处例外都得挡住：
   * - 非有限值返回 `N/A`。旧实现里 `NaN`/`Infinity` 比任何上限都大，一路掉到分钟分支，
   *   实测打成 `NaNm NaNs` / `Infinitym NaNs`，报告里看着像「跑了无穷久」；
   * - 负值按绝对值选单位、符号留在前面。旧实现的第一个分支 `ms < 0.001` 对所有负数成立，
   *   实测 `-1500` 被打成 `-1500000000.00ns`（本应是 `-1.50s`）。负耗时在基准里是真实
   *   信号（时钟回退、跨轮采样顺序错乱），夹成 0 会把问题抹掉，所以保号。
   */
  formatTime(ms: number): string {
    if (!Number.isFinite(ms)) return 'N/A'
    const sign = ms < 0 ? '-' : ''
    const size = Math.abs(ms)
    if (size < 0.001) return `${sign}${(size * 1000000).toFixed(2)}ns`
    if (size < 1) return `${sign}${(size * 1000).toFixed(2)}µs`
    if (size < 1000) return `${sign}${size.toFixed(2)}ms`
    if (size < 60000) return `${sign}${(size / 1000).toFixed(2)}s`
    const minutes = Math.floor(size / 60000)
    const seconds = ((size % 60000) / 1000).toFixed(2)
    return `${sign}${minutes}m ${seconds}s`
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

  /**
   * 串行跑 `iterations` 轮
   *
   * 计数口径见 `toCount`：NaN/±Infinity 抛 RangeError，小数向下取整，`<= 0` 是「什么都不测」
   * 的合法退化（返回空数组）。
   */
  async repeat<T>(fn: () => T | Promise<T>, iterations: number): Promise<IterationOutcome<T>[]> {
    const count = Math.max(0, toCount(iterations, 'repeat 的 iterations'))
    const results: IterationOutcome<T>[] = []
    for (let i = 0; i < count; i++) {
      results.push(await this.measureIteration(fn))
    }
    return results
  }

  /**
   * 以固定并发跑满 `total` 次
   *
   * 槽位预约（先取 `completed++` 再判上界）保证执行次数不超过工作量，但旧实现对退化入参
   * 是**静默给错结果**（实测）：
   * - `concurrency = 0 / 负数 / NaN` 而 `total = 100`：`Math.min` 得非正数，一个 worker 都开不出来，
   *   调用方拿到 `[]`，看起来像「这套 store 快得测不出来」；
   * - `total = 10.5`：`index >= total` 放行下标 10，实跑 11 轮（返回 11 条结果）。
   * 现口径：
   * - `total` / `concurrency` 先过 `toCount`（非有限值抛 RangeError、小数取整）；
   * - 夹取后 `total <= 0` 返回空数组——请求的工作量本就是 0，不抛；
   * - `total > 0` 而 `concurrency < 1` 抛 RangeError：活确实被请求过，却一个 worker 都没有，
   *   这是调用方的参数错误，静默返回空数组等于把配错的并发数伪装成测量结果；
   * - worker 数与工作量取小，多开的 worker 只会立刻空转退出。
   */
  async parallel<T>(
    fn: () => T | Promise<T>,
    concurrency: number,
    total: number
  ): Promise<IterationOutcome<T>[]> {
    const workItems = Math.max(0, toCount(total, 'parallel 的 total'))
    if (workItems === 0) return []
    const workerCount = toCount(concurrency, 'parallel 的 concurrency')
    if (workerCount < 1) {
      throw new RangeError(
        `parallel 的 concurrency 至少为 1 才能跑满 ${workItems} 项工作，收到 ${concurrency}`
      )
    }

    const results: IterationOutcome<T>[] = []
    const workers: Promise<void>[] = []
    let completed = 0

    for (let i = 0; i < Math.min(workerCount, workItems); i++) {
      workers.push(
        (async () => {
          while (true) {
            // 同步预约槽位：先读 completed、await 之后再自增会让多个 worker 同时通过
            // `completed < total` 判断，实际执行次数超过 total，结果条数与时序都不确定。
            // 上界用夹取后的 workItems，而不是原始 total：小数 total 会多放一槽
            const index = completed++
            if (index >= workItems) return
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
