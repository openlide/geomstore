/**
 * @geomstore/benchmark - 结果构建器
 */

import type { BenchmarkResult, DatasetSize, CacheStats } from './types/index.js'
import { DATASET_SIZE_THRESHOLDS } from './constants.js'

/**
 * 一组耗时统计
 *
 * 字段口径（唯一事实源，别按名字猜）：`median` / `p95` / `p99` / `stdDev` 一律描述
 * **逐次操作**的分布，即单轮 `benchmarkUtils.calculateTimeStats(durations)` 的那一片总体。
 * 合并多份结果时（`mergeResults`）拿不到逐次采样，这几个字段按「合并总体的保守上界 /
 * 精确值」给出（见 `mergeTimeStats` 的推导），**不会**退化成「各轮均值的分布」——
 * `TIME_THRESHOLDS` 导出的 `*_P99` 门限就是按同名字段对齐的，两套总体一旦混用，
 * 拿合并结果比门限就等于把检查悄悄放宽。
 */
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
  /**
   * 本结果实际测的那一档数据集
   *
   * 不给则按迭代数兜底推断（见 `inferDatasetSize`）。调用方手里几乎总有 `scenario.datasetSize`，
   * 显式传下来才不会再出现「1000 轮的 large-workload 被标成 small」这种标签与数据脱节。
   */
  datasetSize?: DatasetSize
  timeStats: TimeStats
  memoryStats?: MemoryStats
  cacheStats?: CacheStats
  passedCheck?: () => boolean
  warnings?: string[]
  errors?: string[]
}

export class ResultBuilder {
  static createResult(options: ResultBuilderOptions): BenchmarkResult {
    const { scenario, iterations, datasetSize, timeStats, memoryStats, cacheStats, passedCheck, warnings, errors } = options

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
      datasetSize: datasetSize ?? this.inferDatasetSize(iterations),
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

  /**
   * 由迭代数兜底反推档位
   *
   * 只在调用方**没有**给出 datasetSize 时才走这里，是最后一级兜底而不是默认口径：
   * 迭代数与档位本就是两回事（`large-workload` 是 large 档却只跑 1000 轮、
   * `basic-read` 是 small 档却跑 10000 轮），拿前者推后者必然指错对比桶，
   * 而 reporter 会把这一列逐条打进报告。有真档位就传真的。
   */
  private static inferDatasetSize(iterations: number): DatasetSize {
    if (iterations <= DATASET_SIZE_THRESHOLDS.SMALL_MAX) return 'small'
    if (iterations <= DATASET_SIZE_THRESHOLDS.MEDIUM_MAX) return 'medium'
    if (iterations <= DATASET_SIZE_THRESHOLDS.LARGE_MAX) return 'large'
    return 'xlarge'
  }

  /**
   * 合并结果的档位：显式给定 > 参与方档位一致时沿用 > 按总迭代数兜底推断
   *
   * 中间那一档是这条修复的主体：合并的常态是「同一场景重复跑几轮再并起来」，参与方档位
   * 本就相同，此时把迭代数相加再反推必然把标签推向更大的桶（3 次 medium 档各 5000 轮
   * 合并成 15000 轮 → 被标成 `xlarge`，而被测数据一直是 medium）。档位不一致时
   * （跨档合并，报告里这一列本就没有唯一答案）才退回迭代数反推，并由调用方显式覆盖。
   */
  private static resolveMergedDatasetSize(results: BenchmarkResult[], totalIterations: number, explicit?: DatasetSize): DatasetSize {
    if (explicit) return explicit
    const sizes = new Set<DatasetSize>(results.map((r) => r.datasetSize))
    if (sizes.size === 1) return results[0].datasetSize
    return this.inferDatasetSize(totalIterations)
  }

  /**
   * 构造一份「场景失败」结果
   *
   * `datasetSize` 可选但**该传**：调用方（runner 的 catch 分支）手里正拿着 `scenario.datasetSize`，
   * 不传就只能按迭代数反推，于是失败的 large 档被标成 small、失败的 small 档被标成 large，
   * 而报告读者拿不到任何判定依据（失败结果的耗时/内存/吞吐全是 0）。
   */
  static createErrorResult(scenario: string, iterations: number, error: Error | string, datasetSize?: DatasetSize): BenchmarkResult {
    return {
      scenario,
      datasetSize: datasetSize ?? this.inferDatasetSize(iterations),
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

  static mergeResults(scenario: string, results: BenchmarkResult[], datasetSize?: DatasetSize): BenchmarkResult {
    if (results.length === 0) return this.createErrorResult(scenario, 0, 'No results to merge')

    const totalIterations = results.reduce((sum, r) => sum + r.iterations, 0)
    const passedCount = results.filter((r) => r.passed).length
    // 只合并一次：executionTime 与 throughput 必须来自同一份耗时统计，
    // 原先两处各调一次 mergeTimeStats（排序 + 标准差全做两遍），改一处就会让两者背离
    const mergedTimeStats = this.mergeTimeStats(
      results.map((r) => ({ stats: r.results.executionTime, iterations: r.iterations })),
      totalIterations
    )
    // 峰值瞬时速率取参与合并各方的最大值：它不是可累加量（合并后的总速率由
    // totalIterations / total 另行给出），丢掉就等于合并报告里这一档恒为 0
    const peakInstantRate = results.reduce((m, r) => Math.max(m, r.results.throughput.peakInstantRate), 0)

    return {
      scenario,
      datasetSize: this.resolveMergedDatasetSize(results, totalIterations, datasetSize),
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
   *
   * `median` / `p95` / `p99` / `stdDev` 与 `TimeStats` 的注释同口径：描述的是**被合并的
   * 那批操作**，不是「各轮 avg 的分布」。原先这四项按 `stats.map((s) => s.avg)` 统计，
   * 于是合并结果的 p99 系统性地远小于真实操作 P99（轮均值把上万次抖动摊平），而
   * `TIME_THRESHOLDS.SET_STATE_P99 / PATCH_P99 / REPLACE_STATE_P99 / SUBSCRIBE_P99`
   * 是按同名字段导出的门限，外部 harness 拿合并结果去比这些门限时，检查被悄悄放宽到
   * 几乎不可能失败。合并输入只有各轮自己的聚合量，故两项各自的处理是：
   * - 分位数取参与方同一分位的**最大值**，它是合并总体该分位的合法上界——混合分布的
   *   CDF 为 `F_pool(x) = Σ wᵢ·Fᵢ(x)`，取 `x ≥ maxᵢ qᵢ(p)` 时每一档都有 `Fᵢ(x) ≥ p`，
   *   加权后仍 `≥ p`，故合并分布的 p 分位越不过它。方向上是保守的（宁可能误报慢，
   *   也不能假绿），且与权重无关，跨档合并同样成立；
   * - 标准差按全方差公式 `σ² = Σ wᵢ(σᵢ² + μᵢ²) − μ²` 精确合并
   *   （wᵢ = 该方迭代数占比，μ = 同一权重下的加权均值），不需要逐次采样。
   */
  private static mergeTimeStats(samples: Array<{ stats: TimeStats; iterations: number }>, totalIterations: number): TimeStats {
    if (samples.length === 0) return this.emptyTimeStats()
    const stats = samples.map((s) => s.stats)
    const total = stats.reduce((sum, s) => sum + s.total, 0)
    const avg = total > 0 && totalIterations > 0 ? total / totalIterations : 0
    // totalIterations 为 0 只可能来自「0 轮却带着耗时统计」的自相矛盾输入
    // （空档的 createErrorResult 参与合并），此时退化为等权：至少给一个可解释的数，
    // 而不是把权重全算成 0、让均值与标准差一起塌成 0/0 = NaN
    const weightOf = (iterations: number): number => (totalIterations > 0 ? iterations / totalIterations : 1 / samples.length)
    let weightedMean = 0
    let secondMoment = 0
    for (const { stats: s, iterations } of samples) {
      const w = weightOf(iterations)
      weightedMean += w * s.avg
      secondMoment += w * (s.stdDev * s.stdDev + s.avg * s.avg)
    }
    // 浮点累加误差可能把方差压成一个极小负数，夹回 0 才开不出 NaN
    const stdDev = Math.sqrt(Math.max(0, secondMoment - weightedMean * weightedMean))
    const worst = (pick: (s: TimeStats) => number): number => stats.map(pick).reduce((a, b) => (b > a ? b : a))
    return {
      total,
      avg,
      // 单次遍历取极值：`Math.min(...arr)` 会把每个元素摊成实参，参与合并的结果数
      // 不受控（自行编排 harness 会按动作/场景分桶后全部并进来），上万条即
      // RangeError: Maximum call stack size exceeded
      min: stats.reduce((m, s) => Math.min(m, s.min), Number.POSITIVE_INFINITY),
      max: stats.reduce((m, s) => Math.max(m, s.max), Number.NEGATIVE_INFINITY),
      median: worst((s) => s.median),
      p95: worst((s) => s.p95),
      p99: worst((s) => s.p99),
      stdDev,
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
 * 是不是「带 then 方法的对象/函数」——即 TS 里能被塞进 `() => void` 返回位的异步回调
 *
 * TS 的返回类型置空规则：`(): void` 接受**任何**返回值的函数，`async () => {...}` 赋给
 * `() => void` 编译通过、一声不吭。所以这一层只能运行期判。
 */
function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as Promise<unknown>).then === 'function'
}

/**
 * 执行预热（只接受同步回调，且运行期真的挡住异步）
 *
 * 循环不 await 的异步回调会留下两条后果：预热动作全部在测量已经开始之后才陆续完成
 * （没跑热的 JIT/缓存进入正式计时，预热形同失效），以及 N 个 floating promise——
 * 预热体内任一 rejection 在 Node 22 默认策略下以 UnhandledPromiseRejection 直接终止整轮
 * 基准，与调用方的退出码归因毫无关系。故返回值一旦是 thenable 就当场 TypeError，
 * 并把异步版本指给调用方。
 */
export function executeWarmup(fn: () => void, iterations: number): void {
  for (let i = 0; i < iterations; i++) {
    const outcome: unknown = fn()
    if (isPromiseLike(outcome)) {
      // 这一次已经在飞的 promise 就地兜掉 rejection：可执行的报错由下面那句 TypeError 给出，
      // 留着不管会让 Node 的默认策略用一条未捕获拒绝终止进程，把真正的成因盖掉
      outcome.catch(() => undefined)
      throw new TypeError('executeWarmup 只接受同步回调：预热动作返回了 Promise 而这里不会等待它。异步预热请改用 executeWarmupAsync。')
    }
  }
}

/**
 * 执行预热（可异步）
 *
 * 每轮 `await` 到兑现才进下一轮：预热跑完才返回，测量起点之前不存在「还没完成的预热」。
 * 同步回调同样能传（`await` 一个 undefined 合法），所以异步 harness 一律用这一份即可。
 */
export async function executeWarmupAsync(fn: () => void | Promise<void>, iterations: number): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    await fn()
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
