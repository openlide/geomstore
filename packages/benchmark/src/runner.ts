/**
 * @geomstore/benchmark - 基准测试运行器
 */

import os from 'node:os'

declare const process: { version: string; platform: string; arch: string }

import type { BenchmarkResult, BenchmarkReport, BenchmarkScenario, BenchmarkConfig, DatasetSize, MemorySnapshot, State, BenchmarkStore } from './types/index.js'
import { benchmarkUtils } from './utils.js'
import { defaultBenchmarkConfig, mergeConfig } from './config.js'
import { ResultBuilder, buildCacheResult, emptyCacheResult } from './helpers.js'

/**
 * 档位放宽倍数：数据集越大单次操作越贵，但耗时/内存不是按状态键数量线性增长
 * （写路径的成本在变更的键与订阅者上），故取值远小于状态键的 10 倍递增。
 * 键集即 DatasetSize，编译器保证四档全覆盖，无需再写回落值。
 */
const SIZE_MULTIPLIERS: Record<DatasetSize, number> = { small: 1, medium: 3, large: 10, xlarge: 50 }

/**
 * `quick-` 前缀场景（CI 冒烟用）的额外放宽：迭代数极少、采样抖动占比高，
 * 耗时与内存门限按此倍数再放宽（吞吐门限不套用，它只按档位倍数下调）
 */
const QUICK_MODE_HEADROOM = 5

/**
 * 耗时门限在档位倍数之外再放宽的量：一轮迭代执行的是 setState / $patch(≤5 键) /
 * getCached / dispatch 四者之一，而门限只有 setState 一档，$patch 与 dispatch
 * 天生比单键写贵
 */
const TIME_HEADROOM = 10

/**
 * 吞吐门限的松弛系数：ops/s 由「迭代数 ÷ 累计耗时」反推，比耗时本身更容易被
 * 单轮抖动放大，故在档位倍数之外再下调一个数量级
 */
const THROUGHPUT_RELAXATION = 0.1

/**
 * 缓存场景的命中率下限：这类场景刻意把键空间配得比容量大（keySpaceMultiplier > 1）
 * 来制造淘汰，未命中是设计目标，不能套用 `thresholds.cacheHitRate` 那种全量门限
 */
const CACHE_SCENARIO_MIN_HIT_RATE = 20

/**
 * 判定通过所需的检查项占比。
 *
 * 配合 `Math.ceil` 的实际语义：非缓存场景 3 项 ⇒ 需要 3 项全过，
 * 缓存场景 4 项 ⇒ 允许 1 项不达标。占比不是「按项加权」，而是刻意让
 * 只有耗时/内存/吞吐三项时没有任何豁免额度。
 */
const MIN_PASS_RATIO = 0.67

/**
 * 基准测试运行器
 */
export class BenchmarkRunner {
  private results: BenchmarkResult[] = []
  private config: BenchmarkConfig
  private memorySnapshots: MemorySnapshot[] = []
  private startTime = 0
  private createStore: <S extends State>(config: { state: S; actions?: Record<string, () => unknown>; enableCache?: boolean; cacheConfig?: { capacity?: number; ttl?: number }; cacheKeys?: string[] }) => BenchmarkStore<S>

  constructor(
    createStore: <S extends State>(config: { state: S; actions?: Record<string, () => unknown>; enableCache?: boolean; cacheConfig?: { capacity?: number; ttl?: number }; cacheKeys?: string[] }) => BenchmarkStore<S>,
    config?: Partial<BenchmarkConfig>
  ) {
    this.config = mergeConfig(defaultBenchmarkConfig, config)
    this.createStore = createStore
  }

  async runAll(): Promise<BenchmarkReport> {
    this.startTime = Date.now()
    this.results = []
    this.memorySnapshots = []

    console.log('\n=== GeomStore 基准测试开始 ===\n')

    if (this.config.general.enableWarmup) {
      await this.runWarmup()
    }

    for (const scenario of this.config.scenarios) {
      console.log(`\n运行场景: ${scenario.name}`)
      console.log(`描述: ${scenario.description}`)
      console.log(`数据集规模: ${scenario.datasetSize}`)
      console.log(`迭代次数: ${scenario.iterations}\n`)

      try {
        const result = await this.runScenario(scenario)
        this.results.push(result)
        this.memorySnapshots.push(benchmarkUtils.getMemorySnapshot())
        console.log(`✓ 场景 "${scenario.name}" 完成`)
      } catch (error) {
        console.error(`✗ 场景 "${scenario.name}" 失败:`, error)
        this.results.push(this.createErrorResult(scenario, error))
      }
    }

    const report = this.generateReport()
    console.log('\n=== 基准测试完成 ===\n')
    return report
  }

  private async runWarmup(): Promise<void> {
    console.log('预热中...\n')
    const iterations = this.config.general.warmupIterations

    for (let i = 0; i < iterations; i++) {
      const store = this.createStore({ state: { count: 0 } })
      store.setState('count', i)
      store.getState()
      store.destroy()
    }

    if (this.config.general.skipGC !== true) {
      benchmarkUtils.forceGC()
    }
    console.log('预热完成\n')
  }

  private async runScenario(scenario: BenchmarkScenario): Promise<BenchmarkResult> {
    const datasetConfig = this.config.datasets[scenario.datasetSize]
    // 空数据集时 keys.length === 0，取键会得到 undefined，整轮测量都是噪声；
    // 与其产出一份看似正常的假结果，不如让场景失败并计入 errors
    if (!datasetConfig || datasetConfig.stateKeys <= 0) {
      throw new Error(`场景 "${scenario.name}" 的数据集配置无效: ${scenario.datasetSize}`)
    }

    const durations: number[] = []
    const timestamps: number[] = []
    const memSnapshots: MemorySnapshot[] = []

    const store = this.createTestStore(datasetConfig.stateKeys, scenario)

    // 场景主体整体置于 try：迭代、getCacheStats() 或 checkThresholds() 任一抛错时
    // 也必须销毁 store，否则其订阅与定时器会泄漏并污染后续场景的内存测量
    try {
      const initialMemory = benchmarkUtils.getMemorySnapshot()
      let peakMemory = initialMemory.heapUsed

      if (scenario.warmup && scenario.warmupIterations) {
        await this.runWarmupIterations(store, scenario.warmupIterations)
      }

      for (let i = 0; i < scenario.iterations; i++) {
        const iterationStart = performance.now()
        const { duration, memoryAfter } = await this.runBenchmarkIteration(store, i, scenario)

        durations.push(duration)
        timestamps.push(iterationStart)

        if (memoryAfter > peakMemory) {
          peakMemory = memoryAfter
        }
        memSnapshots.push(benchmarkUtils.getMemorySnapshot())
      }

      const finalMemory = benchmarkUtils.getMemorySnapshot()
      const timeStats = benchmarkUtils.calculateTimeStats(durations)

      const totalTime = timeStats.total / 1000
      const throughput = {
        opsPerSecond: scenario.iterations / totalTime,
        peakInstantRate: this.calculatePeakInstantRate(timestamps),
      }

      const result: BenchmarkResult = {
        scenario: scenario.name,
        datasetSize: scenario.datasetSize,
        iterations: scenario.iterations,
        results: {
          executionTime: timeStats,
          memory: {
            initial: initialMemory.heapUsed,
            peak: peakMemory,
            final: finalMemory.heapUsed,
            // 门限比的是「峰值增量」而非首尾差：peakMemory 以初始值为起点、只在上探时抬高，
            // 因此 delta 恒 >= 0（迭代之间发生 GC 只会让 final 回落、动不了峰值），
            // 不存在负增量绕过内存门限的路径
            delta: peakMemory - initialMemory.heapUsed,
            avg: memSnapshots.reduce((sum, s) => sum + s.heapUsed, 0) / memSnapshots.length,
          },
          throughput,
          // getCacheStats 是可选契约：被适配的库没有缓存时省略它，此处按「缓存未启用」上报
          cache: store.getCacheStats ? buildCacheResult(store.getCacheStats()) : emptyCacheResult(),
        },
        passed: true,
      }

      result.passed = this.checkThresholds(result, scenario)
      return result
    } finally {
      store.destroy()
    }
  }

  private calculatePeakInstantRate(timestamps: number[]): number {
    if (timestamps.length === 0) return 0

    const windowSizeMs = 1
    let maxOps = 0
    let left = 0

    for (let right = 0; right < timestamps.length; right++) {
      while (timestamps[right] - timestamps[left] > windowSizeMs) {
        left++
      }
      const opsInWindow = right - left + 1
      if (opsInWindow > maxOps) {
        maxOps = opsInWindow
      }
    }

    return maxOps * 1000
  }

  private createTestStore(stateKeys: number, scenario?: BenchmarkScenario): BenchmarkStore<Record<string, unknown>> {
    const storeConfig = benchmarkUtils.createTestStoreConfig(stateKeys)
    const cacheTestConfig = scenario?.cacheConfig
    const explicitCapacity = cacheTestConfig?.capacity
    // 容量为 0（或 NaN/负数）的缓存永远不可能命中，测出来的命中率与淘汰数都是假的；
    // 显式配置给非法值就报错，推导值（stateKeys 过小会让 floor(N/2) === 0）兜到 1
    if (explicitCapacity !== undefined && (!Number.isFinite(explicitCapacity) || explicitCapacity < 1)) {
      throw new Error(`场景 "${scenario?.name}" 的 cacheConfig.capacity 无效: ${explicitCapacity}`)
    }
    const cacheCapacity = explicitCapacity ?? Math.max(1, Math.floor(stateKeys / 2))
    const cacheTTL = cacheTestConfig?.ttl ?? 0

    const store = this.createStore({
      state: storeConfig.state,
      actions: storeConfig.actions,
      enableCache: true,
      cacheConfig: { capacity: cacheCapacity, ttl: cacheTTL },
      cacheKeys: cacheTestConfig ? undefined : Object.keys(storeConfig.state).slice(0, Math.floor(stateKeys / 2)),
    })

    return store
  }

  private async runWarmupIterations(store: BenchmarkStore, iterations: number): Promise<void> {
    for (let i = 0; i < iterations; i++) {
      const state = store.getState()
      const keys = Object.keys(state)
      if (keys.length > 0) {
        const key = keys[i % keys.length]
        store.setState(key, Math.random())
        store.getState()
      }
    }
  }

  private async runBenchmarkIteration(
    store: BenchmarkStore,
    index: number,
    scenario: BenchmarkScenario
  ): Promise<{ duration: number; memoryAfter: number }> {
    const { duration } = benchmarkUtils.measureTime(() => {
      const state = store.getState()
      const keys = Object.keys(state)
      const allKeysCount = keys.length

      if (scenario.cacheConfig) {
        const { capacity = 50, keySpaceMultiplier = 1, readWriteRatio = 0.7 } = scenario.cacheConfig
        const keySpaceSize = Math.min(Math.floor(capacity * keySpaceMultiplier), allKeysCount)
        // 键空间为 0（capacity 或 keySpaceMultiplier 配成 0）时 `Math.random() * 0` 恒等于 0，
        // 空状态还会取到 undefined 键并喂给 setState；这一轮什么都不测，直接收尾
        if (keySpaceSize < 1) return store.getState()
        const isRead = Math.random() < readWriteRatio

        if (isRead) {
          const keyIndex = Math.floor(Math.random() * keySpaceSize)
          const key = keys[keyIndex]
          store.getCached?.(key)
        } else {
          const keyIndex = Math.floor(Math.random() * keySpaceSize)
          const key = keys[keyIndex]
          store.setState(key, Math.random())
        }
      } else {
        const operation = index % 4

        switch (operation) {
          case 0:
            if (keys.length > 0) {
              const key = keys[index % keys.length]
              store.setState(key, Math.random())
            }
            break

          case 1: {
            const patch: Record<string, unknown> = {}
            for (let i = 0; i < Math.min(5, keys.length); i++) {
              const key = keys[(index + i) % keys.length]
              patch[key] = Math.random()
            }
            store.$patch(patch)
            break
          }

          case 2:
            if (keys.length > 0) {
              const key = keys[index % keys.length]
              store.getCached?.(key)
            }
            break

          case 3: {
            const actions = store.actions as Record<string, () => unknown>
            const actionNames = Object.keys(actions)
            if (actionNames.length > 0) {
              const actionName = actionNames[index % actionNames.length]
              store.dispatch(actionName)
            }
            break
          }
        }
      }

      return store.getState()
    })

    const memoryAfter = benchmarkUtils.getMemorySnapshot().heapUsed
    return { duration, memoryAfter }
  }

  private createErrorResult(scenario: BenchmarkScenario, error: unknown): BenchmarkResult {
    return ResultBuilder.createErrorResult(scenario.name, scenario.iterations, error instanceof Error ? error : String(error))
  }

  private checkThresholds(result: BenchmarkResult, scenario: BenchmarkScenario): boolean {
    const thresholds = this.config.thresholds
    const r = result.results

    const sizeMultiplier = SIZE_MULTIPLIERS[scenario.datasetSize]
    const modeMultiplier = scenario.name.startsWith('quick-') ? QUICK_MODE_HEADROOM : 1

    const details: Array<{ passed: boolean }> = []

    const timeThreshold = thresholds.operationTime.setState * sizeMultiplier * modeMultiplier * TIME_HEADROOM
    details.push({ passed: r.executionTime.avg <= timeThreshold })

    const memoryThreshold = thresholds.memory.perStore * sizeMultiplier * modeMultiplier
    details.push({ passed: r.memory.delta <= memoryThreshold })

    const throughputThreshold = (thresholds.throughput.setState / sizeMultiplier) * THROUGHPUT_RELAXATION
    details.push({ passed: r.throughput.opsPerSecond >= throughputThreshold })

    if (r.cache.enabled) {
      const isCacheTestScenario = scenario.cacheConfig !== undefined
      const hitRateThreshold = isCacheTestScenario ? CACHE_SCENARIO_MIN_HIT_RATE : thresholds.cacheHitRate
      details.push({ passed: r.cache.hitRate >= hitRateThreshold })
    }

    const passedChecks = details.filter((d) => d.passed).length
    return passedChecks >= Math.ceil(details.length * MIN_PASS_RATIO)
  }

  private generateReport(): BenchmarkReport {
    const endTime = Date.now()
    const totalDuration = (endTime - this.startTime) / 1000
    const passedScenarios = this.results.filter((r) => r.passed).length
    const failedScenarios = this.results.filter((r) => !r.passed).length
    const totalMemoryUsage = this.results.reduce((sum, r) => sum + r.results.memory.delta, 0)

    return {
      metadata: {
        id: `benchmark-${Date.now()}`,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        nodeVersion: process.version,
        platform: process.platform,
        cpu: {
          model: process.arch,
          cores: os.cpus().length,
          speed: os.cpus()[0]?.speed || 0,
        },
        totalMemory: os.totalmem(),
      },
      config: this.config,
      results: this.results,
      summary: {
        totalScenarios: this.results.length,
        passedScenarios,
        failedScenarios,
        totalDuration,
        totalMemoryUsage,
      },
      recommendations: this.generateRecommendations(),
    }
  }

  private generateRecommendations(): string[] {
    const recommendations: string[] = []

    for (const result of this.results) {
      if (!result.passed) {
        const r = result.results

        if (r.executionTime.avg > this.config.thresholds.operationTime.setState) {
          recommendations.push(`场景 "${result.scenario}" 的平均执行时间过高 (${benchmarkUtils.formatTime(r.executionTime.avg)})，建议优化状态更新逻辑。`)
        }

        if (r.cache.enabled && r.cache.hitRate < this.config.thresholds.cacheHitRate) {
          recommendations.push(`场景 "${result.scenario}" 的缓存命中率较低 (${r.cache.hitRate.toFixed(2)}%)，建议检查缓存策略。`)
        }

        if (r.throughput.opsPerSecond < this.config.thresholds.throughput.setState / 10) {
          recommendations.push(`场景 "${result.scenario}" 的吞吐量较低 (${benchmarkUtils.formatNumber(r.throughput.opsPerSecond)} ops/s)，建议优化性能。`)
        }
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('所有基准测试场景均通过，性能表现良好。')
    }

    return recommendations
  }
}
