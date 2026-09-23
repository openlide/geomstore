/**
 * @geomstore/benchmark - 基准测试运行器
 */

import os from 'node:os'

import type { BenchmarkResult, BenchmarkReport, BenchmarkScenario, BenchmarkConfig, BenchmarkConfigOverride, DatasetSize, State, BenchmarkStore } from './types/index.js'
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
 * 是不是「带 then 方法的对象/函数」——即 `dispatch` 返回了可等待的续段
 *
 * `BenchmarkStore.dispatch` 的返回类型是 `unknown`，适配真实库时它经常是个 Promise
 * （GeomStore 自身的文档也以 `await store.dispatch(...)` 为常态用法）。
 * 本包 helpers.ts 里有一份同形状的私有判定，那是模块私有的，故此处按同一判据再来一份。
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as PromiseLike<unknown>).then === 'function'
}

/**
 * 执行一次「读」
 *
 * 原先两处读都写成 `store.getCached?.(key)`：没有缓存的实现省略了这个成员（`BenchmarkStore`
 * 里它是可选的），于是这 1/4 的迭代只付了外层 `getState()` 的钱——平均耗时被人为压低、
 * 吞吐虚高，测出的不是「一次读」而是「什么都不做」。缺 `getCached` 时退化成读同一个键的
 * 状态值，保证被计时的始终是一次真实读取；返回值让这次读取处在被消费的位置。
 *
 * 「成员在不在」只是**必要条件**：这条探测面对包内适配器成立（`createBenchmarkAdapter`
 * 已改成按存在性动态解析），对任何把 `getCached` 包成恒存在箭头函数的 harness 却不成立——
 * 那种包装下成员恒为真值，而被适配的库没有缓存时它返回 undefined 且什么都不读，
 * 老缺陷正好从这条路回来。故多出 `useCacheRead` 一个入参：它是 `hasRealCacheRead`
 * 探针的结论（成员存在**且真的产生了一次缓存访问**才走缓存读），否则照常退化成状态读。
 */
function readKey(store: BenchmarkStore, state: Readonly<State>, key: string, useCacheRead: boolean): unknown {
  return useCacheRead && store.getCached ? store.getCached(key) : state[key]
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
 * 一次 `runAll()` 的私有累加状态
 *
 * 这三份数据原先挂在**实例**上（`results` / `thresholdIssues` / `startTime`），
 * 而 `runAll` 是 public async、没有任何重入或单飞保护。同一实例上第二次 `runAll()`
 * 只要与第一次有时间交叠（很常见的用法：同一个 runner 先跑 defaultBenchmarkConfig
 * 再跑 relaxedBenchmarkConfig，或两个场景集并行编排），第 124 行的 `this.results = []`
 * 就会抹掉另一轮已 push 的结果，而另一轮后续 push 的样本又落进这一轮；
 * 两份 `generateReport()` 都按「当时的数组快照」出 summary，场景数 / passed 计数 /
 * `totalMemoryUsage` 全是两轮混合值，`totalDuration` 还用被后一次覆盖的 `startTime` 算
 * （Date.now() 单调，先启动那轮的时长被算短；`startTime` 被更晚一轮覆盖时为负值）。
 * `thresholdIssues` 也在每次 runAll 开头被 clear，另一轮还没出报告的建议就此消失。
 * 现在累加状态随每次运行创建、只经该次运行的私有方法串接，两次 runAll 互不可见。
 */
interface BenchmarkRun {
  /** 本次运行已完成（含失败）的场景结果 */
  readonly results: BenchmarkResult[]
  /** 本次运行的 结果 → 未达标项建议（键用结果对象本身：同名场景重复跑时按名字回查会张冠李戴） */
  readonly thresholdIssues: Map<BenchmarkResult, string[]>
  /** 本次运行的起点（`Date.now()`，只用于 totalDuration） */
  readonly startTime: number
}

/**
 * 基准测试运行器
 */
export class BenchmarkRunner {
  private config: BenchmarkConfig
  private createStore: <S extends State>(config: { state: S; actions?: Record<string, () => unknown>; getters?: Record<string, (state: S) => unknown>; enableCache?: boolean; cacheConfig?: { capacity?: number; ttl?: number }; cacheKeys?: string[] }) => BenchmarkStore<S>

  constructor(
    createStore: <S extends State>(config: { state: S; actions?: Record<string, () => unknown>; getters?: Record<string, (state: S) => unknown>; enableCache?: boolean; cacheConfig?: { capacity?: number; ttl?: number }; cacheKeys?: string[] }) => BenchmarkStore<S>,
    config?: BenchmarkConfigOverride
  ) {
    this.config = mergeConfig(defaultBenchmarkConfig, config)
    this.createStore = createStore
  }

  async runAll(): Promise<BenchmarkReport> {
    const run: BenchmarkRun = { results: [], thresholdIssues: new Map(), startTime: Date.now() }

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
        const result = await this.runScenario(scenario, run)
        run.results.push(result)
        console.log(`✓ 场景 "${scenario.name}" 完成`)
      } catch (error) {
        console.error(`✗ 场景 "${scenario.name}" 失败:`, error)
        run.results.push(this.createErrorResult(scenario, error))
      }
    }

    const report = this.generateReport(run)
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

  private async runScenario(scenario: BenchmarkScenario, run: BenchmarkRun): Promise<BenchmarkResult> {
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
    // 迭代数同样要在测量前校验：0 轮时 durations / memSamples 都是空数组，
    // `0 / (0/1000)` 与 `0 / 0` 让 opsPerSecond、memory.avg 双双变 NaN（实测），
    // NaN 参与门限比较恒为 false，整个场景会被判成「什么都不达标」。
    // 非整数 / NaN / Infinity 同理——按 dataset 校验的同一口径抛错计入 errors
    if (!Number.isInteger(scenario.iterations) || scenario.iterations < 1) {
      throw new Error(`场景 "${scenario.name}" 的 iterations 无效: ${scenario.iterations}`)
    }
    // 建店维度也在校验期兜住：这两个数现在真的有读取方（动作注册表按 actions 生成、
    // 订阅者按 subscribers 挂），非整数会让下面两个循环跑不出配置声称的形状
    for (const [field, value] of [['actions', datasetConfig.actions], ['subscribers', datasetConfig.subscribers]] as const) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`场景 "${scenario.name}" 的数据集配置无效: ${scenario.datasetSize}（${field} 须为非负整数，得到 ${String(value)}）`)
      }
    }

    const durations: number[] = []
    const timestamps: number[] = []
    // 每轮「本轮操作之后」的 heapUsed 采样。内存统计只有三个消费方（均值、峰值、下界），
    // 原先却每轮调两次 `getMemorySnapshot()`（一次在 runBenchmarkIteration 里、一次在这里），
    // 等于每轮多付一次 process.memoryUsage() 去采样一个本身就会被它扰动量
    const memSamples: number[] = []

    const { store, cacheCapacity, cacheReadWorks } = this.createTestStore(datasetConfig, scenario)
    /** 场景挂上的订阅退订句柄（收尾时先全部退订再销毁 store） */
    const unsubscribers: Array<() => void> = []

    // 场景主体整体置于 try：迭代、getCacheStats() 或阈值检查任一抛错时
    // 也必须销毁 store，否则其订阅与定时器会泄漏并污染后续场景的内存测量
    try {
      // `datasets[size].subscribers` 原先没有任何读取方：实际建的店恒是零订阅，
      // 而 `thresholds.memory.perSubscriber` 判的是「每个订阅多少常驻内存」，
      // 那份门限比的因此是一份根本不存在的形状。现在按配置数把监听器挂上
      // （空回调：测的是订阅关系的常驻成本，不是回调耗时）
      for (let i = 0; i < datasetConfig.subscribers; i++) {
        unsubscribers.push(store.subscribe(() => undefined))
      }

      // 取基线前先扫一次堆。原先 `peakMemory` 以**未压 GC** 的基线播种、只在上探时抬高，
      // 而整轮之内除 `runWarmup` 那次（还受 skipGC 管辖）之外没有任何一次 GC，两个方向都会读错：
      // ① 假绿——基线里挂着上一个场景尚未回收的垃圾时，本轮只要发生一次 GC，之后每个样本都
      //    低于这个脏基线，peak 就永远停在 initial，delta 恒等于 0，`delta <= perStore × 档位倍数`
      //    无条件通过，内存真实泄漏被读成 0 字节；
      // ② 假红——`skipGC: true`（或没有 --expose-gc）时 heapUsed 单调上涨，peak 就是最后一轮的
      //    采样，delta 实际是「本轮攒了多少垃圾」而非「净留存」，与 V8 何时回收有关、跨机器不可复现。
      // 两道一起治：基线前先 forceGC（`benchmarkUtils.measureMemory` 已是这个口径，且它同样不受
      // skipGC 管辖——那个开关只管整轮开始前那次统一预热），并把增量按「本轮样本下界」而不是
      // 基线起算（见下面 delta），这样 0 只能由「堆在两次采样之间真的没动过」产生。
      // 诚实记录一处残留：没有 --expose-gc 时 forceGC 是 no-op，样本下界退化成基线本身，
      // ② 那类噪声仍在——此时增量只能当方向参考，与 `measureMemory` 的注释同一结论。
      benchmarkUtils.forceGC()
      const initialMemory = benchmarkUtils.getMemorySnapshot()
      let peakMemory = initialMemory.heapUsed
      let lowWaterMemory = initialMemory.heapUsed

      if (scenario.warmup && scenario.warmupIterations) {
        this.runWarmupIterations(store, scenario.warmupIterations)
      }

      for (let i = 0; i < scenario.iterations; i++) {
        const iterationStart = performance.now()
        const iteration = this.runBenchmarkIteration(store, i, scenario, cacheCapacity, cacheReadWorks)
        let { duration, memoryAfter } = iteration

        if (iteration.asyncTail !== undefined) {
          // 异步动作的续段计入本轮耗时：`measureTime` 是同步 API，只量得到同步前缀，
          // 不补这一段就等于「dispatch 档门限判的是一个 async 动作里最便宜的那截」。
          // 也正因为这里 await 了，reject 不会被丢成 floating rejection（Node 默认
          // `--unhandled-rejections=throw` 会让整轮基准当场终止，且终止点在一个已经
          // push 了一半样本的循环里），而是冒泡到 runAll 的 catch ⟹ 场景计入 errors。
          duration += await iteration.asyncTail
          // 续段的分配落在本轮与下一轮之间：等完再补采一次，否则这一轮的样本
          // 描述的是「同步前缀结束时」的堆，与 duration 描述的时段不是同一件事
          memoryAfter = benchmarkUtils.getMemorySnapshot().heapUsed
        }

        durations.push(duration)
        timestamps.push(iterationStart)

        if (memoryAfter > peakMemory) {
          peakMemory = memoryAfter
        }
        if (memoryAfter < lowWaterMemory) {
          lowWaterMemory = memoryAfter
        }
        memSamples.push(memoryAfter)
      }

      const finalMemory = benchmarkUtils.getMemorySnapshot()
      const timeStats = benchmarkUtils.calculateTimeStats(durations)

      const totalTime = timeStats.total / 1000
      const throughput = {
        // iterations >= 1 已在入口校验，但 totalTime 仍可能整轮为 0（计时精度低于单次操作耗时），
        // 那时 `n / 0` 是 Infinity；与 helpers.calculateThroughput 的兜底口径保持一致。
        // memSamples 与 durations 逐轮同步 push，长度 === iterations >= 1，均值不会 0/0
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
            // 门限比的是「峰值相对本轮堆用量下界的增量」，不是首尾差、也不是「峰值减基线」：
            // - 相对基线会让脏基线把 delta 夹成 0（基线高、样本低时 peak 从不动，
            //   delta ≡ 0 ⟹ 无条件通过），那正是 ① 假绿的形状；
            // - 样本下界是「GC 之后仍然存活的那条线」，peak − 下界 ⟹ 本轮堆真实摆动过的量，
            //   delta 仍恒 >= 0（不存在负增量绕过门限），而 0 只能由真没涨产生。
            delta: peakMemory - lowWaterMemory,
            avg: memSamples.reduce((sum, sample) => sum + sample, 0) / memSamples.length,
          },
          throughput,
          // getCacheStats 是可选契约：被适配的库没有缓存时省略它，此处按「缓存未启用」上报
          cache: store.getCacheStats ? buildCacheResult(store.getCacheStats()) : emptyCacheResult(),
        },
        ...(cacheReadWorks === false
          ? {
              warnings: [
                'store.getCached 成员存在却没有产生任何可观测的缓存访问（一次探针调用后 hits+misses 未变化）：' +
                  '读档已退化为真实状态读。按 BenchmarkStore 契约，无缓存的实现应**省略**该成员而不是包一层什么都不读的函数。',
              ],
            }
          : {}),
      }

      const evaluation = this.checkThresholds(measured, scenario)
      const result: BenchmarkResult = { ...measured, passed: evaluation.passed }
      run.thresholdIssues.set(result, evaluation.issues)
      return result
    } finally {
      // 先退订再销毁：让「场景挂上的订阅」这条生命周期与 store 自身的销毁顺序明确
      for (const unsubscribe of unsubscribers) {
        unsubscribe()
      }
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
   * 建场景用的 store，并回传它**实际拿到的**缓存容量与「getCached 是否真读」的探针结论
   *
   * `cacheCapacity` 必须随 store 一起返回：测量轮要按容量决定随机键空间
   * （见 `runBenchmarkIteration`），原先那里自己再写一份默认值 50，与这里的
   * `Math.max(1, Math.floor(stateKeys / 2))` 是同一个参数的两套默认值。
   * 小/中档 dataset 下两者立刻背离（stateKeys=10 → 真实容量 5、键空间 50），
   * 测出来的命中率与淘汰行为对应的根本不是被配置的那个缓存。
   *
   * 动作注册表按 `datasets[size].actions` 生成、getters 一并下发（原先这两个配置维度
   * 在 runner 里没有读取方，报告却把它们随 `report.config` 原样发布，见
   * `unmeasuredConfigNote`）：工具类那份 `createTestStoreConfig(stateKeys)` 的动作数是
   * 硬编码的 `Math.min(stateKeys, 20)`，与配置里的 small=5 / xlarge=100 都对不上，
   * dispatch 档门限判的因此是一个没人配置过的动作集。
   */
  private createTestStore(
    dataset: BenchmarkConfig['datasets'][DatasetSize],
    scenario?: BenchmarkScenario
  ): { store: BenchmarkStore<Record<string, unknown>>; cacheCapacity: number; cacheReadWorks: boolean } {
    const stateKeys = dataset.stateKeys
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
      actions: this.createActionRegistry(dataset.actions),
      getters: storeConfig.getters,
      enableCache: true,
      cacheConfig: { capacity: cacheCapacity, ttl: cacheTTL },
      cacheKeys: cacheTestConfig ? undefined : Object.keys(storeConfig.state).slice(0, cacheCapacity),
    })

    return { store, cacheCapacity, cacheReadWorks: this.probeCacheRead(store) }
  }

  /**
   * 按配置的动作数生成 action 注册表
   *
   * 形状与被替换掉的那份工具类生成器一致（`actionN` → 返回一个定值，不碰状态），
   * 只有数量改由 `datasets[size].actions` 决定；0 是合法值（测「没有 action 可派」的退化形状）。
   * 动作名与 `Object.keys(store.actions)` 的取键方式保持同构，dispatch 分支无需改动。
   */
  private createActionRegistry(count: number): Record<string, () => unknown> {
    const actions: Record<string, () => unknown> = {}
    for (let i = 0; i < count; i++) {
      const index = i
      actions[`action${index}`] = () => `result${index}`
    }
    return actions
  }

  /**
   * 探针：这个 store 的 `getCached` 会不会真的读一次缓存
   *
   * `readKey` 只能按「成员在不在」决定走缓存读还是退化成真实状态读，而这条探测面
   * 容易被包装层击穿：把 `getCached` 包成恒存在的箭头函数（`(key) => store.getCached?.(key)`）
   * 之后，成员对任何被包过一次的 store 都恒为真值，被适配的库没有缓存时它返回 undefined
   * 且什么都不读 —— 那 1/4 的迭代就只付了一次空函数调用的钱，平均耗时被人为压低、吞吐虚高。
   * （包内适配器 `createBenchmarkAdapter` 自身的同一缺陷已改成按存在性动态解析，
   * 这里守的是外部 harness 与手写包装这条仍敞开的入口。）
   *
   * 判据用缓存计数器：一次 `getCached(key)` 之后 hits+misses 没有前进 ⟹ 没有读取发生。
   * 探针只在建店后跑一次，不进被计时的循环（代价是一次额外的缓存访问 + 一次 getCacheStats）。
   * store 不暴露 `getCacheStats` 时无从证伪，只能按契约信任该成员存在（返回 true）。
   */
  private probeCacheRead(store: BenchmarkStore): boolean {
    if (!store.getCached || !store.getCacheStats) {
      return true
    }
    const key = pickKey(Object.keys(store.getState()), 0)
    if (key === undefined) {
      return true
    }
    const before = store.getCacheStats()
    store.getCached(key)
    const after = store.getCacheStats()
    return after.hits + after.misses > before.hits + before.misses
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
   * 函数体本身仍是同步的：`measureTime` / `getMemorySnapshot` 都是同步 API，把这里标成
   * async 会让热循环里每轮多分配一个 promise、多一次 microtask 跳，还误导调用方
   * 「这里有异步工作」。异步契约改由返回值里的 `asyncTail` 表达——**只有**被测库的
   * `dispatch` 真的返回了 thenable 时才给出，同步库一条都不产生。
   *
   * 为什么必须有这一段：`BenchmarkStore.dispatch` 的返回类型是 `unknown`，适配真实库时
   * 经常是 Promise（本包适配器就是纯转发，GeomStore 的文档也以 `await dispatch(...)` 为
   * 常态用法）。原先这一支把返回值直接丢弃，于是三个后果：①这一轮被计时的只有同步前缀，
   * 异步段完全在 `measureTime` 之外，平均耗时被压低、吞吐虚高，而 `thresholds.operationTime.dispatch`
   * 判的就是这个数；②reject 出去就是 floating rejection，Node 默认 `--unhandled-rejections=throw`
   * 让整轮基准当场终止，终止点还在一个已 push 了一半样本的循环里；③续段跑完时
   * `runScenario` 的 finally 早已 `store.destroy()`，违背 `BenchmarkStore.destroy` 写死的
   * 生命周期契约（销毁后不得再有 action 求值路径可达）。调用方对 `asyncTail` 的 await
   * 一次覆盖这三条：耗时补齐、拒绝冒泡成场景错误、销毁发生在续段之后。
   */
  private runBenchmarkIteration(
    store: BenchmarkStore,
    index: number,
    scenario: BenchmarkScenario,
    cacheCapacity: number,
    cacheReadWorks: boolean
  ): { duration: number; memoryAfter: number; asyncTail?: Promise<number> } {
    // dispatch 的返回值要带出 measureTime：闭包的返回位已被「消费一次读取」的惯用法占用
    // （末尾 `return store.getState()`），改它就等于改被计时的操作集合
    let dispatched: unknown
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
            readKey(store, state, key, cacheReadWorks)
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
              readKey(store, state, key, cacheReadWorks)
            }
            break
          }

          case 3: {
            const actions = store.actions as Record<string, () => unknown>
            const actionNames = Object.keys(actions)
            const actionName = pickKey(actionNames, index)
            if (actionName !== undefined) {
              dispatched = store.dispatch(actionName)
            }
            break
          }
        }
      }

      return store.getState()
    })

    const memoryAfter = benchmarkUtils.getMemorySnapshot().heapUsed

    if (!isThenable(dispatched)) {
      return { duration, memoryAfter }
    }
    // 计时起点取的是同步段结束那一刻，调用方把返回的这段时长加到本轮上；
    // 不 catch：拒绝必须由 runScenario 的 try 抓到（见方法注释的 ②③）
    const tailStart = performance.now()
    const asyncTail = Promise.resolve(dispatched).then(() => performance.now() - tailStart)
    return { duration, memoryAfter, asyncTail }
  }

  /**
   * 构造一份「场景失败」结果
   *
   * 三个字段都是刻意定的：
   * - `datasetSize` 取场景自己声明的那一档。不传给 `ResultBuilder.createErrorResult` 时它
   *   只能按迭代数反推（`inferDatasetSize`），于是默认配置里 small 档 10000 迭代的
   *   `basic-read` 一失败就被标成 large、large 档 5000 迭代的 `cache-efficiency` 被标成
   *   medium——同一份报告里正常结果用真档位、失败结果用反推档位，横向对比与
   *   「哪个档位挂了」的结论都失真。
   * - `iterations` 记 **0** 而不是 `scenario.iterations`：失败结果的耗时/内存/吞吐全是 0，
   *   照抄 10000 会让读者读成「测了 10000 轮、每轮都很快」，而事实是「一轮都没测完」。
   * - 声明值随 `warnings` 一起给出，两个数都不丢（reporter 的「迭代次数」一列从此是实测数）。
   */
  private createErrorResult(scenario: BenchmarkScenario, error: unknown): BenchmarkResult {
    return {
      ...ResultBuilder.createErrorResult(
        scenario.name,
        0,
        error instanceof Error ? error : String(error),
        scenario.datasetSize
      ),
      warnings: [`场景声明 ${scenario.iterations} 轮，实测完成 0 轮（进入测量前或测量中抛错，全部指标为空）`],
    }
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

    // 第 4 判定项只属于缓存场景。非缓存场景的 store 同样开着缓存（写穿路径本身就是要测的
    // 成本之一），但它的键空间是按容量随便切的前 N 个键，命中率纯粹是访问顺序的副产品：
    // 把它计入判定，既会按 thresholds.cacheHitRate（90%）这种全量门限误伤成假红，
    // 又会把项数撑到 4 项——`Math.ceil(4 * 0.67) === 3` 于是给「耗时/内存/吞吐任一档
    // 单独崩掉」发了一张豁免券，与上面 MIN_PASS_RATIO 注释承诺的「3 项 ⇒ 必须全过」相反。
    if (r.cache.enabled && scenario.cacheConfig !== undefined) {
      const cachePassed = r.cache.hitRate >= CACHE_SCENARIO_MIN_HIT_RATE
      details.push({ passed: cachePassed })
      if (!cachePassed) {
        issues.push(
          `场景 "${scenario.name}" 的缓存命中率 ${r.cache.hitRate.toFixed(2)}% 低于门限 ${CACHE_SCENARIO_MIN_HIT_RATE}%（缓存场景按刻意制造未命中的下限判定），建议检查缓存策略。`,
        )
      }
    }

    const passedChecks = details.filter((d) => d.passed).length
    const passed = passedChecks >= Math.ceil(details.length * MIN_PASS_RATIO)
    // 判定通过就不留建议：缓存场景允许 1 项不达标（MIN_PASS_RATIO），
    // 那些单项提示留在这里会让「passed 的场景」也往报告里灌告警
    return { passed, issues: passed ? [] : issues }
  }

  private generateReport(run: BenchmarkRun): BenchmarkReport {
    const endTime = Date.now()
    const totalDuration = (endTime - run.startTime) / 1000
    const passedScenarios = run.results.filter((r) => r.passed).length
    const failedScenarios = run.results.filter((r) => !r.passed).length
    const totalMemoryUsage = run.results.reduce((sum, r) => sum + r.results.memory.delta, 0)

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
      results: run.results,
      summary: {
        totalScenarios: run.results.length,
        passedScenarios,
        failedScenarios,
        totalDuration,
        totalMemoryUsage,
      },
      recommendations: this.generateRecommendations(run),
    }
  }

  /**
   * 汇总建议
   *
   * 直接取 `checkThresholds` 判定当时记下的未达标项：门限、放宽系数与判定同源，
   * 不再在此重算一套裸配置阈值。
   */
  private generateRecommendations(run: BenchmarkRun): string[] {
    const recommendations: string[] = []

    for (const result of run.results) {
      if (result.passed) continue

      const issues = run.thresholdIssues.get(result)
      if (issues && issues.length > 0) {
        recommendations.push(...issues)
      } else {
        // 没有阈值评估记录 = 场景在进入测量前就抛错（runAll 的 catch 走 createErrorResult）。
        // 这类结果的耗时/内存/吞吐全是 0，原先会被拿来和裸阈值比较，凭空给一条
        // 「吞吐量较低」的建议，把真正的运行错误盖掉
        const reason = result.errors && result.errors.length > 0 ? result.errors.join('；') : '未知原因'
        recommendations.push(`场景 "${result.scenario}" 未能完成，先按 errors 修复运行错误再解读性能：${reason}`)
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('所有基准测试场景均通过，性能表现良好。')
    }

    const gaps = this.unmeasuredConfigNote()
    if (gaps !== undefined) {
      recommendations.push(gaps)
    }

    return recommendations
  }

  /**
   * 本轮**没有**测量、却仍会随 `report.config` 原样发布的配置维度
   *
   * `report.config` 是「这次运行用了什么配置」的唯一出口，读者无从分辨
   * 「已测量」与「只是声明着」。与其留着让报告宣称它测过，不如在报告里点名：
   * 本轮真的接进测量的维度（`datasets[*].stateKeys` / `actions` / `subscribers`、
   * `scenarios[*].iterations` / `datasetSize` / `warmup*` / `cacheConfig`）不进这份清单，
   * 其余按实际声明值列出来。全部条件都取配置本身，不依赖运行结果，
   * 因此同一份配置每次运行的提示一致。
   */
  private unmeasuredConfigNote(): string | undefined {
    const gaps: string[] = []

    if (this.config.scenarios.some((scenario) => scenario.concurrency !== undefined)) {
      gaps.push('scenario.concurrency（测量循环是 index % 4 的串行轮转，`benchmarkUtils.parallel` 未被调用）')
    }

    const sizes = Object.keys(this.config.datasets) as DatasetSize[]
    if (sizes.some((size) => (this.config.datasets[size].getters ?? 0) > 0)) {
      gaps.push('datasets[*].getters（getters 已下发给被测 store，但四类被计时的操作里没有 getter 读取档，' + 'thresholds.operationTime.getter / thresholds.throughput.getter 没有产出物可比）')
    }
    if (sizes.some((size) => (this.config.datasets[size].nestingDepth ?? 0) > 1)) {
      gaps.push('datasets[*].nestingDepth（测试状态由 `generateTestState` 生成，恒为一层扁平键，不做嵌套）')
    }

    if (gaps.length === 0) {
      return undefined
    }
    return `report.config 里以下维度是「声明值」而非「本轮已测量」，请勿把它们当成性能结论的数据源：${gaps.join('；')}。`
  }
}
