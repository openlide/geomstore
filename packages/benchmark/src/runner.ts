/**
 * @geomstore/benchmark - 基准测试运行器
 */

declare const process: { version: string; platform: string; arch: string }
declare const require: (module: string) => unknown

import type { BenchmarkResult, BenchmarkReport, BenchmarkScenario, BenchmarkConfig, MemorySnapshot, State, BenchmarkStore } from './types'
import { benchmarkUtils } from './utils'
import { defaultBenchmarkConfig, mergeConfig } from './config'
import { ResultBuilder } from './helpers'

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
    const durations: number[] = []
    const timestamps: number[] = []
    const memSnapshots: MemorySnapshot[] = []

    const store = this.createTestStore(datasetConfig.stateKeys, scenario)

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
    const cacheStats = store.getCacheStats()
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
          delta: peakMemory - initialMemory.heapUsed,
          avg: memSnapshots.reduce((sum, s) => sum + s.heapUsed, 0) / memSnapshots.length,
        },
        throughput,
        cache: {
          enabled: cacheStats.enabled,
          totalAccesses: cacheStats.hits + cacheStats.misses,
          hits: cacheStats.hits,
          misses: cacheStats.misses,
          hitRate: cacheStats.hits + cacheStats.misses > 0 ? (cacheStats.hits / (cacheStats.hits + cacheStats.misses)) * 100 : 0,
          missRate: cacheStats.hits + cacheStats.misses > 0 ? (cacheStats.misses / (cacheStats.hits + cacheStats.misses)) * 100 : 0,
          evictions: cacheStats.evictions,
        },
      },
      passed: true,
    }

    result.passed = this.checkThresholds(result, scenario)
    store.destroy()
    return result
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
    const cacheCapacity = cacheTestConfig?.capacity ?? Math.floor(stateKeys / 2)
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

    const sizeMultipliers: Record<string, number> = { small: 1, medium: 3, large: 10, xlarge: 50 }
    const sizeMultiplier = sizeMultipliers[scenario.datasetSize] || 1
    const isQuickMode = scenario.name.startsWith('quick-')
    const modeMultiplier = isQuickMode ? 5 : 1

    const details: Array<{ passed: boolean }> = []

    const timeThreshold = thresholds.operationTime.setState * sizeMultiplier * modeMultiplier * 10
    details.push({ passed: r.executionTime.avg <= timeThreshold })

    const memoryThreshold = thresholds.memory.perStore * sizeMultiplier * modeMultiplier
    details.push({ passed: r.memory.delta <= memoryThreshold })

    const throughputThreshold = (thresholds.throughput.setState / sizeMultiplier) * 0.1
    details.push({ passed: r.throughput.opsPerSecond >= throughputThreshold })

    if (r.cache.enabled) {
      const isCacheTestScenario = scenario.cacheConfig !== undefined
      const hitRateThreshold = isCacheTestScenario ? 20 : thresholds.cacheHitRate
      details.push({ passed: r.cache.hitRate >= hitRateThreshold })
    }

    const passedChecks = details.filter((d) => d.passed).length
    return passedChecks >= Math.ceil(details.length * 0.67)
  }

  private generateReport(): BenchmarkReport {
    const endTime = Date.now()
    const totalDuration = (endTime - this.startTime) / 1000
    const passedScenarios = this.results.filter((r) => r.passed).length
    const failedScenarios = this.results.filter((r) => !r.passed).length
    const scores = this.results.map((r) => r.score).filter((s): s is number => s !== undefined)
    const avgScore = scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 0
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
          cores: (require('os') as { cpus: () => { speed: number }[] }).cpus().length,
          speed: (require('os') as { cpus: () => { speed: number }[] }).cpus()[0]?.speed || 0,
        },
        totalMemory: (require('os') as { totalmem: () => number }).totalmem(),
      },
      config: this.config,
      results: this.results,
      summary: {
        totalScenarios: this.results.length,
        passedScenarios,
        failedScenarios,
        avgScore,
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
