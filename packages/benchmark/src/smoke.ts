/**
 * @geomstore/benchmark - 可运行冒烟入口
 *
 * 存在理由：本包的 `build` / `typecheck` 只把源码编译成产物，跑不出任何行为——
 * runner / reporter / helpers 的回归此前完全无人执行（仓库根 CI 只在根包上跑 jest）。
 * 这里用一份内存实现的最小 `BenchmarkStore`，把 `BenchmarkRunner.runAll()` →
 * `BenchmarkReporter.generate()` 的完整链路真跑一遍，并对可判定的不变量做断言。
 *
 * 运行：`npm run bench`（= `tsc && node dist/smoke.js`）。断言失败时 exit code 非 0。
 *
 * 刻意不断言「场景是否达标」：门限判定依赖被测机速度，这里只断结构不变量与
 * 已修缺陷的回归点，保证本入口不会因为机器慢而红。
 */

import os from 'node:os'

import { BenchmarkRunner } from './runner.js'
import { BenchmarkReporter } from './reporter.js'
import { createBenchmarkAdapter } from './index.js'
import { ResultBuilder } from './helpers.js'
import { defaultBenchmarkConfig, mergeConfig, relaxedBenchmarkConfig } from './config.js'
import { SAMPLING_CONFIG, TIME_THRESHOLDS } from './constants.js'
import type { BenchmarkScenario, BenchmarkStore, CacheStats, State } from './types/index.js'

/** 与 `BenchmarkRunner` 构造函数入参同形的工厂签名（不借用 `StoreFactory`，其 actions 类型更严） */
interface CreateStoreConfig<S extends State> {
  state: S
  actions?: Record<string, () => unknown>
  enableCache?: boolean
  cacheConfig?: { capacity?: number; ttl?: number }
  cacheKeys?: string[]
}
type CreateStoreFn = <S extends State>(config: CreateStoreConfig<S>) => BenchmarkStore<S>

/** 每次建 store 时留下的探针：记录实际下发的容量与被测量轮真正碰过的键 */
interface StoreProbe {
  capacity: number | undefined
  touched: Set<string>
}
const probes: StoreProbe[] = []

/**
 * 最小可用 store：满足 `BenchmarkStore` 的全部契约，缓存按 FIFO 淘汰并统计命中/未命中
 */
const createStoreForBenchmark: CreateStoreFn = <S extends State>(config: CreateStoreConfig<S>) => {
  const bag: Record<string, unknown> = { ...config.state }
  const capacity = Math.max(1, Math.floor(config.cacheConfig?.capacity ?? 1))
  const cache = new Map<string, unknown>()
  const listeners: Array<() => void> = []
  const stats: CacheStats = { enabled: Boolean(config.enableCache), hits: 0, misses: 0, evictions: 0 }
  const probe: StoreProbe = { capacity: config.cacheConfig?.capacity, touched: new Set<string>() }
  probes.push(probe)

  for (const key of config.cacheKeys ?? []) {
    if (key in bag) cache.set(key, bag[key])
  }

  const evictIfNeeded = (): void => {
    while (cache.size > capacity) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) return
      cache.delete(oldest)
      stats.evictions = (stats.evictions ?? 0) + 1
    }
  }

  const store: BenchmarkStore<S> = {
    getState: () => bag as unknown as ReturnType<BenchmarkStore<S>['getState']>,
    setState: (key, value) => {
      bag[String(key)] = value
      cache.set(String(key), value)
      probe.touched.add(String(key))
      evictIfNeeded()
    },
    $patch: (partial) => {
      Object.assign(bag, partial)
    },
    $replaceState: (next) => {
      for (const key of Object.keys(bag)) delete bag[key]
      Object.assign(bag, next)
      cache.clear()
    },
    actions: config.actions ?? {},
    dispatch: (name, ...args) =>
      (config.actions?.[name] as ((...a: unknown[]) => unknown) | undefined)?.(...args),
    subscribe: (listener) => {
      listeners.push(listener)
      let released = false
      return () => {
        if (released) return
        released = true
        const at = listeners.indexOf(listener)
        if (at >= 0) listeners.splice(at, 1)
      }
    },
    getCached: (key) => {
      probe.touched.add(key)
      if (cache.has(key)) {
        stats.hits++
        return cache.get(key)
      }
      stats.misses++
      cache.set(key, bag[key])
      evictIfNeeded()
      return bag[key]
    },
    getCacheStats: () => ({ ...stats }),
    destroy: () => {
      listeners.length = 0
      cache.clear()
    },
  }
  return store
}

const failures: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures.push(name)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` [${detail}]` : ''}`)
}

/** 单份结果的自洽性：`avg[ms/op] × opsPerSecond` 必须回到 1000，否则耗时与吞吐各说各话 */
function assertConsistent(label: string, avg: number, opsPerSecond: number): void {
  if (avg === 0 && opsPerSecond === 0) {
    check(`${label}: avg 与 throughput 互推一致`, true, '两者均为 0')
    return
  }
  const product = avg * opsPerSecond
  check(`${label}: avg 与 throughput 互推一致`, Math.abs(product / 1000 - 1) < 1e-9, `avg*ops=${product}`)
}

const timeStatsOf = (total: number, avg: number, min: number, max: number): BenchmarkResultTime => ({
  total,
  avg,
  min,
  max,
  median: avg,
  p95: max,
  p99: max,
  stdDev: 0,
})

interface BenchmarkResultTime {
  total: number
  avg: number
  min: number
  max: number
  median: number
  p95: number
  p99: number
  stdDev: number
}

const scenarios: BenchmarkScenario[] = [
  {
    name: 'quick-smoke-mixed',
    description: '混合读写',
    datasetSize: 'small',
    iterations: 200,
    warmup: true,
    warmupIterations: 40,
  },
  {
    name: 'quick-smoke-cache',
    description: '缓存读写',
    datasetSize: 'small',
    iterations: 200,
    warmup: true,
    warmupIterations: 40,
    cacheConfig: { capacity: 6, keySpaceMultiplier: 2, readWriteRatio: 0.8 },
  },
  // 场景名会进 Markdown 标题与 HTML 卡片：这一条专门验证转义没漏
  { name: '<script>alert("inj")</script>|#注入', description: '注入面', datasetSize: 'small', iterations: 60 },
]

const smokeConfig = {
  general: { warmupIterations: 3, enableWarmup: true, skipGC: true },
  datasets: { small: { stateKeys: 8, actions: 4, getters: 2, subscribers: 2, nestingDepth: 1 } },
} as const

async function main(): Promise<void> {
  // —— 1. 完整链路：runAll → generate ——
  const report = await new BenchmarkRunner(createStoreForBenchmark, { ...smokeConfig, scenarios }).runAll()
  const reporter = new BenchmarkReporter()
  const markdown = reporter.generate(report, 'markdown')
  const html = reporter.generate(report, 'html')
  const json = reporter.generate(report, 'json')

  check('runAll 跑完全部场景', report.summary.totalScenarios === scenarios.length, String(report.summary.totalScenarios))
  check(
    '汇总计数自洽',
    report.summary.passedScenarios + report.summary.failedScenarios === report.summary.totalScenarios
  )
  check('JSON 报告可回读', JSON.parse(json).summary.totalScenarios === scenarios.length)
  check(
    'metadata.cpu.model 是 CPU 型号而非架构',
    report.metadata.cpu.model === (os.cpus()[0]?.model || 'unknown') && report.metadata.cpu.model !== process.arch,
    report.metadata.cpu.model
  )
  check('metadata.cpu.cores 是核数', report.metadata.cpu.cores === os.cpus().length)

  for (const result of report.results) {
    assertConsistent(`runner/${result.scenario.slice(0, 20)}`, result.results.executionTime.avg, result.results.throughput.opsPerSecond)
    check(
      `${result.scenario.slice(0, 20)}: 各轮极值落在 total 之内`,
      Number.isFinite(result.results.executionTime.avg) &&
        result.results.executionTime.min <= result.results.executionTime.max
    )
  }

  const cacheScenario = report.results.find((r) => r.scenario === 'quick-smoke-cache')
  check('缓存场景被识别为启用缓存', cacheScenario?.results.cache.enabled === true)
  check(
    '缓存计数器与派生比率自洽',
    !!cacheScenario &&
      cacheScenario.results.cache.hits + cacheScenario.results.cache.misses ===
        cacheScenario.results.cache.totalAccesses &&
      Math.abs(cacheScenario.results.cache.hitRate + cacheScenario.results.cache.missRate - 100) < 1e-9,
    cacheScenario ? `hits=${cacheScenario.results.cache.hits} misses=${cacheScenario.results.cache.misses}` : 'missing'
  )
  check('缓存场景有真实命中与未命中（不是空转）', !!cacheScenario && cacheScenario.results.cache.hits > 0 && cacheScenario.results.cache.misses > 0)

  // —— 2. 报告转义 ——
  check('HTML 不含未转义的注入标签', !html.includes('<script>alert'))
  check('Markdown 不含未转义的注入标签', !markdown.includes('<script>alert'))
  check('Markdown 里的表格竖线被转义', markdown.includes('\\|'))
  check('HTML 与 Markdown 都带版本号', html.includes('版本:') && markdown.includes('**版本**'))

  // —— 3. 配置：副本语义 / 单一事实源 / 宽松档 ——
  const merged = mergeConfig(defaultBenchmarkConfig)
  merged.scenarios[0].iterations = 7
  merged.datasets.small.stateKeys = 7
  check('mergeConfig 返回的 scenario 元素是副本', defaultBenchmarkConfig.scenarios[0].iterations !== 7)
  check('mergeConfig 返回的档位是副本', defaultBenchmarkConfig.datasets.small.stateKeys !== 7)
  check(
    'mergeConfig 逐档位键集完整（DatasetSize 四档齐全）',
    (Object.keys(merged.datasets) as string[]).sort().join(',') === 'large,medium,small,xlarge'
  )
  const withCache = mergeConfig(defaultBenchmarkConfig).scenarios.find((s) => s.cacheConfig)
  check('嵌套 cacheConfig 也是副本', !!withCache && withCache.cacheConfig !== undefined)
  check(
    'relaxed 档把场景级预热一并夹到上限',
    relaxedBenchmarkConfig.scenarios.every((s) => (s.warmupIterations ?? 0) <= 100) &&
      relaxedBenchmarkConfig.general.warmupIterations === 100
  )
  check(
    'TIME_THRESHOLDS 不再是配置的第二事实源',
    TIME_THRESHOLDS.DISPATCH_AVG === defaultBenchmarkConfig.thresholds.operationTime.dispatch &&
      TIME_THRESHOLDS.REPLACE_STATE_AVG === defaultBenchmarkConfig.thresholds.operationTime.$replaceState &&
      TIME_THRESHOLDS.SET_STATE_P99 > TIME_THRESHOLDS.SET_STATE_AVG
  )

  // —— 4. 非法输入必须显式失败，而不是静默产出假绿灯 ——
  const badDataset = await new BenchmarkRunner(createStoreForBenchmark, {
    general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
    datasets: { small: { stateKeys: 2.5 } },
    scenarios: [{ name: 'quick-bad-dataset', description: '非整数 stateKeys', datasetSize: 'small', iterations: 10 }],
  }).runAll()
  const bad = badDataset.results[0]
  check(
    '非整数 stateKeys 被拒并计入 errors',
    bad?.passed === false && (bad?.errors?.length ?? 0) > 0,
    String(bad?.errors?.[0])
  )

  // —— 5. 缓存容量单点推导：键空间必须跟随 store 实际容量 ——
  const probesBeforeCapacity = probes.length
  await new BenchmarkRunner(createStoreForBenchmark, {
    general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
    datasets: smokeConfig.datasets,
    scenarios: [
      {
        name: 'quick-capacity',
        description: '未显式配置 capacity 时键空间按推导容量收敛',
        datasetSize: 'small',
        iterations: 150,
        cacheConfig: { keySpaceMultiplier: 1, readWriteRatio: 0.5 },
      },
    ],
  }).runAll()
  // 上面显式关掉了统一预热（enableWarmup: false），本轮只会有场景那一个 store
  const capacityProbe = probes[probes.length - 1]
  check('该场景只建了一个 store（探针选取无歧义）', probes.length === probesBeforeCapacity + 1, `新增 ${probes.length - probesBeforeCapacity}`)
  // stateKeys = 8 → 实际下发容量 = max(1, floor(8/2)) = 4；旧实现在测量轮里另写一份
  // `capacity = 50` 的默认值，键空间会被算成 min(50, 8) = 8，把 8 个键全摸一遍
  check('未显式配置时 store 拿到推导容量 4', capacityProbe?.capacity === 4, String(capacityProbe?.capacity))
  check(
    '测量轮使用的键空间与实际容量一致（不再固定 50）',
    !!capacityProbe && capacityProbe.touched.size >= 2 && capacityProbe.touched.size <= 4,
    `touched=${String(capacityProbe?.touched.size)}`
  )

  // —— 5b. 无缓存实现的 store：读那一轮必须退化成真实读取，而不是空转 ——
  const cachelessReport = await new BenchmarkRunner(
    <S extends State>(config: CreateStoreConfig<S>) => {
      const store = createStoreForBenchmark(config)
      delete (store as { getCached?: unknown }).getCached
      delete (store as { getCacheStats?: unknown }).getCacheStats
      return store
    },
    {
      ...smokeConfig,
      scenarios: [
        { name: 'quick-cacheless', description: '无 getCached 的 store', datasetSize: 'small', iterations: 80 },
      ],
    }
  ).runAll()
  const cacheless = cachelessReport.results[0]
  check('无缓存 store 按「缓存未启用」上报', cacheless?.results.cache.enabled === false)
  check(
    '无缓存 store 的读轮仍产出有效测量（退化为状态读，不再空转）',
    !!cacheless && cacheless.iterations === 80 && cacheless.results.throughput.opsPerSecond > 0 && (cacheless.errors ?? []).length === 0,
    cacheless ? `ops=${Math.round(cacheless.results.throughput.opsPerSecond)}` : 'missing'
  )

  // —— 5c. quick 档的吞吐门限必须与耗时门限同步放宽（R5-065 的回归点）——
  // 单次写刻意忙等 ~1.2ms；四个操作槽轮转 ⇒ 平均 ~0.3ms/op ⇒ 约 3300 ops/s。
  // 该速度高于「放宽后」的 2000 ops/s、低于「放宽前」的 10000 ops/s（两侧各 2 倍余量），
  // 忙等按墙钟推进，故与机器快慢无关。
  // 断言看的是「吞吐有没有被判为未达标项」而不是 result.passed：passed 还受内存/耗时两档
  // 影响（首轮跑新代码路径的分配抖动就足以让内存档失败），用它会把这条回归测成噪声。
  const slowRun = await new BenchmarkRunner(
    <S extends State>(config: CreateStoreConfig<S>): BenchmarkStore<S> => {
      const bag: Record<string, unknown> = { ...config.state }
      return {
        getState: () => bag as unknown as ReturnType<BenchmarkStore<S>['getState']>,
        setState: () => {
          const until = performance.now() + 1
          while (performance.now() < until) {
            /* 忙等，模拟慢写入 */
          }
        },
        $patch: () => undefined,
        $replaceState: () => undefined,
        actions: {},
        dispatch: () => undefined,
        subscribe: () => () => undefined,
        destroy: () => undefined,
      }
    },
    {
      general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
      datasets: smokeConfig.datasets,
      scenarios: [
        { name: 'quick-slow-write', description: '刻意慢的写', datasetSize: 'small', iterations: 32 },
      ],
    }
  ).runAll()
  const slow = slowRun.results[0]
  const slowOps = slow?.results.throughput.opsPerSecond ?? 0
  check('慢写场景的吞吐落在判据区分区间 (2000, 10000) 内', slowOps > 2000 && slowOps < 10000, `ops=${Math.round(slowOps)}`)
  check(
    'quick 档吞吐门限已按 modeMultiplier 放宽（未被判为未达标项）',
    !slowRun.recommendations.some((r) => r.includes('吞吐量')),
    slowRun.recommendations.join(' | ').slice(0, 110)
  )

  // —— 6. ResultBuilder 合并 ——
  const runA = ResultBuilder.createResult({
    scenario: 'a',
    iterations: 10000,
    timeStats: timeStatsOf(1000, 0.1, 0.01, 1),
  })
  const runB = ResultBuilder.createResult({
    scenario: 'b',
    iterations: 10,
    timeStats: timeStatsOf(100, 10, 1, 50),
  })
  const mergedPair = ResultBuilder.mergeResults('ab', [runA, runB])
  assertConsistent('mergeResults', mergedPair.results.executionTime.avg, mergedPair.results.throughput.opsPerSecond)
  check(
    'mergeResults 的 avg 按迭代数加权（非各轮算术平均）',
    Math.abs(mergedPair.results.executionTime.avg - 1100 / 10010) < 1e-9,
    String(mergedPair.results.executionTime.avg)
  )
  const withPeak = ResultBuilder.mergeResults('ab', [
    { ...runA, results: { ...runA.results, throughput: { opsPerSecond: 100, peakInstantRate: 1234 } } },
    { ...runB, results: { ...runB.results, throughput: { opsPerSecond: 100, peakInstantRate: 9999 } } },
  ])
  check('mergeResults 保留峰值瞬时速率（取最大值，不再清零）', withPeak.results.throughput.peakInstantRate === 9999)

  let stackError = ''
  try {
    // 实测本机 Node 22.22：`Math.min(...arr)` 在 10 万实参下仍可通过、15 万起抛
    // RangeError: Maximum call stack size exceeded，故取 20 万条
    ResultBuilder.mergeResults(
      'many',
      Array.from({ length: 200000 }, (_, i) => ({
        ...runA,
        results: { ...runA.results, executionTime: { ...runA.results.executionTime, min: i, max: i } },
      }))
    )
  } catch (error) {
    stackError = error instanceof Error ? error.message : String(error)
  }
  check('mergeResults 在 20 万条输入下不爆栈', stackError === '', stackError)

  const throwing = ResultBuilder.createResult({
    scenario: 'boom',
    iterations: 10,
    timeStats: runA.results.executionTime,
    passedCheck: () => {
      throw new Error('检查器炸了')
    },
  })
  check(
    'passedCheck 抛错时降级为不通过并记 errors',
    throwing.passed === false && (throwing.errors ?? []).some((e) => e.includes('检查器炸了'))
  )
  const undefinedCheck = ResultBuilder.createResult({
    scenario: 'sneaky',
    iterations: 10,
    timeStats: runA.results.executionTime,
    // 违约实现：声明返回 boolean 却不返回
    passedCheck: (() => undefined) as unknown as () => boolean,
  })
  check('passedCheck 未返回布尔时按不通过处理', undefinedCheck.passed === false)
  check(
    '未给 passedCheck 时仍按通过处理',
    ResultBuilder.createResult({ scenario: 'no-check', iterations: 10, timeStats: runA.results.executionTime }).passed === true
  )

  // —— 7. 抽样上限 / 适配器懒解析 ——
  check(
    '抽样间隔保证样本数不超过 MAX_SAMPLES',
    [1, 99, 150, 199, 1000, 10001].every(
      (n) => Math.ceil(n / SAMPLING_CONFIG.getSampleInterval(n)) <= SAMPLING_CONFIG.MAX_SAMPLES
    ),
    `150 → interval ${SAMPLING_CONFIG.getSampleInterval(150)}`
  )

  const bare: BenchmarkStore = {
    getState: () => ({ a: 1 }),
    setState: () => undefined,
    $patch: () => undefined,
    $replaceState: () => undefined,
    actions: {},
    dispatch: () => undefined,
    subscribe: () => () => undefined,
    destroy: () => undefined,
  }
  const adapted = createBenchmarkAdapter(bare)
  check('无缓存统计的 store 仍报「未启用」', adapted.getCacheStats === undefined)
  bare.getCacheStats = () => ({ enabled: true, hits: 3, misses: 1 })
  const lateStats = adapted.getCacheStats?.()
  check('构造之后才挂上的 getCacheStats 不会被固化成 undefined', lateStats?.hits === 3, String(lateStats?.hits))

  console.log(`\n=== 冒烟结果：${failures.length === 0 ? '全部通过' : `${failures.length} 项失败`} ===`)
  for (const f of failures) console.error(`FAIL ${f}`)
  process.exitCode = failures.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('冒烟入口异常终止:', error)
  process.exitCode = 1
})
