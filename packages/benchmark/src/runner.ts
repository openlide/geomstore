/**
 * @geomstore/benchmark - 基准测试运行器
 */

import os from 'node:os'

import type { BenchmarkResult, BenchmarkReport, BenchmarkScenario, BenchmarkConfig, BenchmarkConfigOverride, DatasetSize, MemorySnapshot, State, BenchmarkStore } from './types/index.js'
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
 * 耗时 / 内存 / 吞吐三项门限都按此倍数再放宽。
 *
 * 吞吐原先不套用，理由是「它只按档位倍数下调」——但三项判定要同时通过
 * （`Math.ceil(3 * MIN_PASS_RATIO) === 3`），耗时档放着 `× modeMultiplier × TIME_HEADROOM`
 * 的余量、吞吐档一点不给，`quick-` 场景就会只栽在吞吐上而失败，
 * 与「快速冒烟、门限从宽」的意图相反。
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
 * 按下标环形取键：`items[index % items.length]`
 *
 * 这处「取第 index 次要操作的键」原本在 setState 分支、getCached 分支、$patch 的连续键、
 * dispatch 的动作名以及 runWarmupIterations 里各写了一遍，取模与空数组守卫散成五个版本，
 * 改一处就会漏其余。空键集在这里统一兜底为 `undefined`（`i % 0` 得 NaN、取出 undefined
 * 再喂给 setState 就是拿假数据做测量），调用方按返回值是否存在决定这一轮做不做。
 */
function pickKey<T>(items: readonly T[], index: number): T | undefined {
  if (items.length === 0) return undefined
  return items[index % items.length]
}

/**
 * 执行一次「读」
 *
 * 原先两处读都写成 `store.getCached?.(key)`：没有缓存的实现省略了这个成员（`BenchmarkStore`
 * 里它是可选的），于是这 1/4 的迭代只付了外层 `getState()` 的钱——平均耗时被人为压低、
 * 吞吐虚高，测出的不是「一次读」而是「什么都不做」。缺 `getCached` 时退化成读同一个键的
 * 状态值，保证被计时的始终是一次真实读取；返回值让这次读取处在被消费的位置。
 */
function readKey(store: BenchmarkStore, state: Readonly<State>, key: string): unknown {
  return store.getCached ? store.getCached(key) : state[key]
}

/**
 * 一次阈值评估的结果
 */
interface ThresholdEvaluation {
  /** 是否达到 `MIN_PASS_RATIO` 规定的达标项占比 */
  passed: boolean
  /**
   * 未达标项对应的建议文案
   *
   * 与 `passed` 用同一份放宽后的阈值算出，判定与建议不会再各说各话；
   * 判定通过时恒为空数组。
   */
  issues: string[]
}

/**
 * 基准测试运行器
 */
export class BenchmarkRunner {
  private results: BenchmarkResult[] = []
  private config: BenchmarkConfig
  /**
   * 结果 → 未达标项建议
   *
   * 键用结果对象本身而不是场景名：同名场景重复跑（并发/多次 merge）时按名字回查会张冠李戴。
   * 与 `results` 同生命周期，runAll 开头一起清空。
   */
  private readonly thresholdIssues = new Map<BenchmarkResult, string[]>()
  private startTime = 0
  private createStore: <S extends State>(config: { state: S; actions?: Record<string, () => unknown>; enableCache?: boolean; cacheConfig?: { capacity?: number; ttl?: number }; cacheKeys?: string[] }) => BenchmarkStore<S>

  constructor(
    createStore: <S extends State>(config: { state: S; actions?: Record<string, () => unknown>; enableCache?: boolean; cacheConfig?: { capacity?: number; ttl?: number }; cacheKeys?: string[] }) => BenchmarkStore<S>,
    config?: BenchmarkConfigOverride
  ) {
    this.config = mergeConfig(defaultBenchmarkConfig, config)
    this.createStore = createStore
  }

  async runAll(): Promise<BenchmarkReport> {
    this.startTime = Date.now()
    this.results = []
    this.thresholdIssues.clear()

    console.log('\n=== GeomStore 基准测试开始 ===\n')

    if (this.config.general.enableWarmup) {
      this.runWarmup()
    }

    for (const scenario of this.config.scenarios) {
      console.log(`\n运行场景: ${scenario.name}`)
      console.log(`描述: ${scenario.description}`)
      console.log(`数据集规模: ${scenario.datasetSize}`)
      console.log(`迭代次数: ${scenario.iterations}\n`)

      try {
        const result = await this.runScenario(scenario)
        this.results.push(result)
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

  /** 整轮开始前的统一预热：同步执行（体内没有任何 await，标 async 只会多一次 promise 跳） */
  private runWarmup(): void {
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
    // 与其产出一份看似正常的假结果，不如让场景失败并计入 errors。
    // stateKeys 必须是正整数：非整数 / NaN 溜进来时 `generateTestState(NaN)` 一次都不循环、
    // 得到空状态，于是每轮 pickKey 都返回 undefined、整轮测量变成 no-op，
    // 最终报出「约 0 耗时 + 0 内存」甚至判通过（下面的 iterations 校验同一口径）
    if (!datasetConfig || !Number.isInteger(datasetConfig.stateKeys) || datasetConfig.stateKeys <= 0) {
      throw new Error(
        `场景 "${scenario.name}" 的数据集配置无效: ${scenario.datasetSize}（stateKeys 须为正整数，得到 ${String(datasetConfig?.stateKeys)}）`
      )
    }
    // 迭代数同样要在测量前校验：0 轮时 durations / memSnapshots 都是空数组，
    // `0 / (0/1000)` 与 `0 / 0` 让 opsPerSecond、memory.avg 双双变 NaN（实测），
    // NaN 参与门限比较恒为 false，整个场景会被判成「什么都不达标」。
    // 非整数 / NaN / Infinity 同理——按 dataset 校验的同一口径抛错计入 errors
    if (!Number.isInteger(scenario.iterations) || scenario.iterations < 1) {
      throw new Error(`场景 "${scenario.name}" 的 iterations 无效: ${scenario.iterations}`)
    }

    const durations: number[] = []
    const timestamps: number[] = []
    const memSnapshots: MemorySnapshot[] = []

    const { store, cacheCapacity } = this.createTestStore(datasetConfig.stateKeys, scenario)

    // 场景主体整体置于 try：迭代、getCacheStats() 或阈值检查任一抛错时
    // 也必须销毁 store，否则其订阅与定时器会泄漏并污染后续场景的内存测量
    try {
      const initialMemory = benchmarkUtils.getMemorySnapshot()
      let peakMemory = initialMemory.heapUsed

      if (scenario.warmup && scenario.warmupIterations) {
        this.runWarmupIterations(store, scenario.warmupIterations)
      }

      for (let i = 0; i < scenario.iterations; i++) {
        const iterationStart = performance.now()
        const { duration, memoryAfter } = this.runBenchmarkIteration(store, i, scenario, cacheCapacity)

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
        // iterations >= 1 已在入口校验，但 totalTime 仍可能整轮为 0（计时精度低于单次操作耗时），
        // 那时 `n / 0` 是 Infinity；与 helpers.calculateThroughput 的兜底口径保持一致。
        // memSnapshots 与 durations 逐轮同步 push，长度 === iterations >= 1，均值不会 0/0
        opsPerSecond: totalTime > 0 ? scenario.iterations / totalTime : 0,
        peakInstantRate: this.calculatePeakInstantRate(timestamps),
      }

      // passed 不给占位值：先测量、再一次成型。原先 `passed: true` 建好即被下一行的
      // checkThresholds 覆盖，是纯死状态，还会让「忘了赋值」看起来像通过
      const measured: Omit<BenchmarkResult, 'passed'> = {
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
      }

      const evaluation = this.checkThresholds(measured, scenario)
      const result: BenchmarkResult = { ...measured, passed: evaluation.passed }
      this.thresholdIssues.set(result, evaluation.issues)
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

  /**
   * 建场景用的 store，并回传它**实际拿到的**缓存容量
   *
   * `cacheCapacity` 必须随 store 一起返回：测量轮要按容量决定随机键空间
   * （见 `runBenchmarkIteration`），原先那里自己再写一份默认值 50，与这里的
   * `Math.max(1, Math.floor(stateKeys / 2))` 是同一个参数的两套默认值。
   * 小/中档 dataset 下两者立刻背离（stateKeys=10 → 真实容量 5、键空间 50），
   * 测出来的命中率与淘汰行为对应的根本不是被配置的那个缓存。
   */
  private createTestStore(
    stateKeys: number,
    scenario?: BenchmarkScenario
  ): { store: BenchmarkStore<Record<string, unknown>>; cacheCapacity: number } {
    const storeConfig = benchmarkUtils.createTestStoreConfig(stateKeys)
    const cacheTestConfig = scenario?.cacheConfig
    const explicitCapacity = cacheTestConfig?.capacity
    // 容量为 0（或 NaN/负数）的缓存永远不可能命中，测出来的命中率与淘汰数都是假的；
    // 显式配置给非法值就报错，推导值（stateKeys 过小会让 floor(N/2) === 0）兜到 1
    if (explicitCapacity !== undefined && (!Number.isInteger(explicitCapacity) || explicitCapacity < 1)) {
      throw new Error(`场景 "${scenario?.name}" 的 cacheConfig.capacity 无效: ${explicitCapacity}`)
    }
    const cacheCapacity = explicitCapacity ?? Math.max(1, Math.floor(stateKeys / 2))
    const cacheTTL = cacheTestConfig?.ttl ?? 0

    const store = this.createStore({
      state: storeConfig.state,
      actions: storeConfig.actions,
      enableCache: true,
      cacheConfig: { capacity: cacheCapacity, ttl: cacheTTL },
      cacheKeys: cacheTestConfig ? undefined : Object.keys(storeConfig.state).slice(0, cacheCapacity),
    })

    return { store, cacheCapacity }
  }

  /** 场景正式计数前的额外预热轮（同步：体内没有 await） */
  private runWarmupIterations(store: BenchmarkStore, iterations: number): void {
    for (let i = 0; i < iterations; i++) {
      const state = store.getState()
      const keys = Object.keys(state)
      const key = pickKey(keys, i)
      if (key === undefined) continue // 空数据集：这一轮没有可写的键，与原先的 keys.length > 0 守卫同语义
      store.setState(key, Math.random())
      store.getState()
    }
  }

  /**
   * 单次测量轮
   *
   * 同步：`measureTime` / `getMemorySnapshot` 都是同步 API，标成 async 只会让热循环里
   * 每轮多分配一个 promise、多一次 microtask 跳，还误导调用方「这里有异步工作」。
   */
  private runBenchmarkIteration(
    store: BenchmarkStore,
    index: number,
    scenario: BenchmarkScenario,
    cacheCapacity: number
  ): { duration: number; memoryAfter: number } {
    const { duration } = benchmarkUtils.measureTime(() => {
      const state = store.getState()
      const keys = Object.keys(state)
      const allKeysCount = keys.length

      if (scenario.cacheConfig) {
        // 容量用 createTestStore 实际下发给 store 的那一个（含未显式配置时的推导值），
        // 原先这里另写一份 `capacity = 50` 的默认值，与 store 真正的容量是两个数
        const { keySpaceMultiplier = 1, readWriteRatio = 0.7 } = scenario.cacheConfig
        const keySpaceSize = Math.min(Math.floor(cacheCapacity * keySpaceMultiplier), allKeysCount)
        // 键空间为 0（capacity 或 keySpaceMultiplier 配成 0）时 `Math.random() * 0` 恒等于 0，
        // 空状态还会取到 undefined 键并喂给 setState；这一轮什么都不测，直接收尾
        if (keySpaceSize < 1) return store.getState()
        const isRead = Math.random() < readWriteRatio
        const key = pickKey(keys, Math.floor(Math.random() * keySpaceSize))
        if (key !== undefined) {
          if (isRead) {
            readKey(store, state, key)
          } else {
            store.setState(key, Math.random())
          }
        }
      } else {
        const operation = index % 4

        switch (operation) {
          case 0: {
            const key = pickKey(keys, index)
            if (key !== undefined) {
              store.setState(key, Math.random())
            }
            break
          }

          case 1: {
            const patch: Record<string, unknown> = {}
            for (let i = 0; i < Math.min(5, keys.length); i++) {
              const key = pickKey(keys, index + i)
              if (key !== undefined) {
                patch[key] = Math.random()
              }
            }
            store.$patch(patch)
            break
          }

          case 2: {
            const key = pickKey(keys, index)
            if (key !== undefined) {
              readKey(store, state, key)
            }
            break
          }

          case 3: {
            const actions = store.actions as Record<string, () => unknown>
            const actionNames = Object.keys(actions)
            const actionName = pickKey(actionNames, index)
            if (actionName !== undefined) {
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

  /**
   * 阈值判定，并顺带产出未达标项的建议文案
   *
   * 建议与判定共用同一份放宽后的阈值（`SIZE_MULTIPLIERS` / `QUICK_MODE_HEADROOM` /
   * `TIME_HEADROOM` / `THROUGHPUT_RELAXATION` / 缓存场景专用下限）：原先
   * `generateRecommendations` 拿裸配置值比较，同一场景可以「判定用 10ms 门限、建议用 0.1ms
   * 门限」，于是不达标却给不出建议、或给出的原因与实际判据对不上。
   */
  private checkThresholds(
    result: Pick<BenchmarkResult, 'results'>,
    scenario: BenchmarkScenario
  ): ThresholdEvaluation {
    const thresholds = this.config.thresholds
    const r = result.results
    const issues: string[] = []

    const sizeMultiplier = SIZE_MULTIPLIERS[scenario.datasetSize]
    const modeMultiplier = scenario.name.startsWith('quick-') ? QUICK_MODE_HEADROOM : 1

    const details: Array<{ passed: boolean }> = []

    const timeThreshold = thresholds.operationTime.setState * sizeMultiplier * modeMultiplier * TIME_HEADROOM
    const timePassed = r.executionTime.avg <= timeThreshold
    details.push({ passed: timePassed })
    if (!timePassed) {
      issues.push(
        `场景 "${scenario.name}" 的平均执行时间 ${benchmarkUtils.formatTime(r.executionTime.avg)} 超过门限 ${benchmarkUtils.formatTime(timeThreshold)}（档位 ×${sizeMultiplier}${modeMultiplier > 1 ? ` × quick 模式 ×${modeMultiplier}` : ''}），建议优化状态更新逻辑。`
      )
    }

    const memoryThreshold = thresholds.memory.perStore * sizeMultiplier * modeMultiplier
    const memoryPassed = r.memory.delta <= memoryThreshold
    details.push({ passed: memoryPassed })
    if (!memoryPassed) {
      // 原先的建议清单里根本没有内存这一档：只栽在内存上的场景会「不通过却零建议」
      issues.push(
        `场景 "${scenario.name}" 的峰值内存增量 ${benchmarkUtils.formatBytes(r.memory.delta)} 超过门限 ${benchmarkUtils.formatBytes(memoryThreshold)}，建议检查状态体积与订阅泄漏。`
      )
    }

    // 吞吐门限同样按 quick 档下调（除以 modeMultiplier 即放宽）：耗时/内存都吃
    // QUICK_MODE_HEADROOM 而吞吐不吃时，`quick-` 冒烟场景可以只在吞吐这一档失败，
    // 而它的耗时判定是按 5 倍余量放行的——三项全过（`Math.ceil(3 * 0.67) === 3`）
    // 于是变成一个与性能无关的假失败
    const throughputThreshold =
      (thresholds.throughput.setState / (sizeMultiplier * modeMultiplier)) * THROUGHPUT_RELAXATION
    const throughputPassed = r.throughput.opsPerSecond >= throughputThreshold
    details.push({ passed: throughputPassed })
    if (!throughputPassed) {
      issues.push(
        `场景 "${scenario.name}" 的吞吐量 ${benchmarkUtils.formatNumber(r.throughput.opsPerSecond)} ops/s 低于门限 ${benchmarkUtils.formatNumber(throughputThreshold)} ops/s（档位 ÷${sizeMultiplier}${modeMultiplier > 1 ? ` ÷ quick 模式 ×${modeMultiplier}` : ''}），建议优化性能。`
      )
    }

    if (r.cache.enabled) {
      const isCacheTestScenario = scenario.cacheConfig !== undefined
      const hitRateThreshold = isCacheTestScenario ? CACHE_SCENARIO_MIN_HIT_RATE : thresholds.cacheHitRate
      const cachePassed = r.cache.hitRate >= hitRateThreshold
      details.push({ passed: cachePassed })
      if (!cachePassed) {
        issues.push(
          `场景 "${scenario.name}" 的缓存命中率 ${r.cache.hitRate.toFixed(2)}% 低于门限 ${hitRateThreshold}%${isCacheTestScenario ? '（缓存场景按刻意制造未命中的下限判定）' : ''}，建议检查缓存策略。`
        )
      }
    }

    const passedChecks = details.filter((d) => d.passed).length
    const passed = passedChecks >= Math.ceil(details.length * MIN_PASS_RATIO)
    // 判定通过就不留建议：缓存场景允许 1 项不达标（MIN_PASS_RATIO），
    // 那些单项提示留在这里会让「passed 的场景」也往报告里灌告警
    return { passed, issues: passed ? [] : issues }
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
          // CPU 型号取自 os.cpus()：原先这里填的是 `process.arch`，字段名叫 model 却
          // 装着架构（x64/arm64），跨机器对比报告时这一档毫无意义，而下一行的
          // `os.cpus()[0]?.speed` 已经证明数据源本该是 os。容器/精简环境下 cpus() 可能为空
          model: os.cpus()[0]?.model || 'unknown',
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

  /**
   * 汇总建议
   *
   * 直接取 `checkThresholds` 判定当时记下的未达标项：门限、放宽系数与判定同源，
   * 不再在此重算一套裸配置阈值。
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = []

    for (const result of this.results) {
      if (result.passed) continue

      const issues = this.thresholdIssues.get(result)
      if (issues && issues.length > 0) {
        recommendations.push(...issues)
      } else {
        // 没有阈值评估记录 = 场景在进入测量前就抛错（runScenario 的 catch 走 createErrorResult）。
        // 这类结果的耗时/内存/吞吐全是 0，原先会被拿来和裸阈值比较，凭空给一条
        // 「吞吐量较低」的建议，把真正的运行错误盖掉
        const reason = result.errors && result.errors.length > 0 ? result.errors.join('；') : '未知原因'
        recommendations.push(`场景 "${result.scenario}" 未能完成，先按 errors 修复运行错误再解读性能：${reason}`)
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('所有基准测试场景均通过，性能表现良好。')
    }

    return recommendations
  }
}
