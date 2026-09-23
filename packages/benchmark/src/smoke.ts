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
import { benchmarkUtils } from './utils.js'
import { createBenchmarkAdapter } from './index.js'
import { ResultBuilder, executeWarmup, executeWarmupAsync, type TimeStats } from './helpers.js'
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
  // 判据不再重算 `os.cpus().length`：那份表达式与 runner.ts 里产出这个字段的那一行逐字相同，
  // 除极端口径外不可能失败（等于恒真断言）。改成对产物性质的判定：字段名叫 cores，就必须是
  // 非负整数且不高于 1024 —— 填错数据源都会在此露馅（os.totalmem() 是 10^10 量级、
  // process.arch 是字符串、os.cpus()[0].speed 是小数）。刻意不写 `>= 1`：容器/精简环境里
  // os.cpus() 可能是空数组，那种情形下 0 是正当产出，不该被判成回归
  const cores = report.metadata.cpu.cores
  check('metadata.cpu.cores 是合理核数（非负整数且 ≤1024，不再重算 os.cpus().length）', Number.isInteger(cores) && cores >= 0 && cores <= 1024, String(cores))

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
  // 只判「合并结果里带 cacheConfig 这个字段」是恒真断言（mergeConfig 必然把该键并进来），
  // 守不住它要守的回归点：config.ts 里那句 `cacheConfig: scenario.cacheConfig ? { ...scenario.cacheConfig } : ...`
  // 一旦被删回 `...scenario`，写穿的就是模块级默认配置，而本检查照旧全绿。
  // 按上面两条副本检查的同一写法补一步：真的改一份副本，再看默认配置那条有没有动。
  const defaultCacheScenario = defaultBenchmarkConfig.scenarios.find((s) => s.cacheConfig)
  const originalCapacity = defaultCacheScenario?.cacheConfig?.capacity
  check('默认配置里确有带 cacheConfig 的场景（否则下面无从比对）', originalCapacity !== undefined, String(originalCapacity))
  const withCache = mergeConfig(defaultBenchmarkConfig).scenarios.find((s) => s.cacheConfig)
  if (withCache?.cacheConfig && defaultCacheScenario?.cacheConfig) {
    withCache.cacheConfig.capacity = 1
    check(
      '嵌套 cacheConfig 也是副本（改副本不写穿 defaultBenchmarkConfig）',
      defaultCacheScenario.cacheConfig.capacity === originalCapacity,
      `默认侧 capacity=${String(defaultCacheScenario.cacheConfig.capacity)}，期望保持 ${String(originalCapacity)}`
    )
  } else {
    check('嵌套 cacheConfig 也是副本（改副本不写穿 defaultBenchmarkConfig）', false, '合并结果或默认配置里找不到 cacheConfig')
  }
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
  // 失败原因是两种报表都必须传达的信息：HTML 曾是「只渲染六行指标 + 一个 ❌ 图标」，
  // 于是本包最常见的失败路径在 HTML 里长成一张红边卡片、指标全 0、看不到任何原因，
  // 而 HTML 恰恰是给非工程同事看的那一份。断言两边都带上同一条 errors 文本
  const badMarkdown = reporter.generate(badDataset, 'markdown')
  const badHtml = reporter.generate(badDataset, 'html')
  const badReason = String(bad?.errors?.[0] ?? '')
  check(
    'Markdown 与 HTML 都带失败原因（两种格式共用同一份附加段）',
    badReason.includes('stateKeys') && badMarkdown.includes('错误') && badHtml.includes('错误') && badHtml.includes('的数据集配置无效'),
    badReason.slice(0, 60)
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
  // 落点数量由下面那个 SLOW_WRITE_MS 推出来（改代码就照着这里一起改，别看旧注释的另一个数）：
  //   四个操作槽轮转、只有 setState 那一槽忙等 ⇒ 平均耗时 = SLOW_WRITE_MS / 4 = 0.25 ms/op
  //   ⇒ 约 4000 ops/s（实测 3900~4200；忙等按墙钟推进，故与机器快慢无关）。
  // 断言区间 (2000, 10000) 的两端就是「吞吐门限放宽后 / 放宽前」的两个值，算式取自 runner：
  //   下界 = 100000（thresholds.throughput.setState，small 档 ×1）÷ quick 档 5 × 松弛 0.1 = 2000
  //   上界 = 同一算式去掉 quick 档那一项 ⟹ 100000 × 0.1 = 10000
  // 样本必须夹在中间：高于下界 ⟹ 下面那条「quick 放宽生效时不判未达标」有牙齿；
  // 低于上界 ⟹ 一旦 QUICK_MODE_HEADROOM 被删掉，该条断言就会转红（而不是恒绿地守着一件没人改的事）。
  // 这两个数是 runner.ts 私有的 QUICK_MODE_HEADROOM / THROUGHPUT_RELAXATION 口径，那边改了
  // 这里就得跟着改（本入口刻意不 import 私有常量，宁可显式写数并留这段推导）。
  // 断言看的是「吞吐有没有被判为未达标项」而不是 result.passed：passed 还受内存/耗时两档
  // 影响（首轮跑新代码路径的分配抖动就足以让内存档失败），用它会把这条回归测成噪声。
  const SLOW_WRITE_MS = 1
  const slowRun = await new BenchmarkRunner(
    <S extends State>(config: CreateStoreConfig<S>): BenchmarkStore<S> => {
      const bag: Record<string, unknown> = { ...config.state }
      return {
        getState: () => bag as unknown as ReturnType<BenchmarkStore<S>['getState']>,
        setState: () => {
          const until = performance.now() + SLOW_WRITE_MS
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

  // —— 6b. 档位标签：有真档位就别按迭代数反推 ——
  // 1000 轮的 large 档场景失败时，旧写法会把它标成 small（reporter 逐条打这一列，
  // 外部按档位对比耗时的第一列就是它）
  const failedLarge = ResultBuilder.createErrorResult('large-workload', 1000, new Error('测量前就炸了'), 'large')
  check('createErrorResult 采信显式档位（不再按迭代数反推成 small）', failedLarge.datasetSize === 'large', failedLarge.datasetSize)
  check('未给档位时才回退到迭代数反推', ResultBuilder.createErrorResult('unknown', 1000, 'boom').datasetSize === 'small')
  const threeMedium = Array.from({ length: 3 }, () =>
    ResultBuilder.createResult({ scenario: 'm', iterations: 5000, datasetSize: 'medium', timeStats: timeStatsOf(100, 0.02, 0.01, 0.1) })
  )
  const mergedMedium = ResultBuilder.mergeResults('m', threeMedium)
  check(
    'mergeResults 沿用参与方一致的档位（3×5000 轮 medium 不再被标成 xlarge）',
    mergedMedium.datasetSize === 'medium',
    `${mergedMedium.datasetSize} / ${mergedMedium.iterations} 轮`
  )
  check(
    'mergeResults 的显式档位优先于一切',
    ResultBuilder.mergeResults('m', [runA, runB], 'xlarge').datasetSize === 'xlarge'
  )

  // —— 6c. 合并结果的分位数必须是「逐次操作」口径 ——
  // 两份轮内抖动极大、轮均值很平的统计：按「各轮 avg」算 p99 会得到 0.1 量级（比真实操作
  // P99 小两个数量级），而 TIME_THRESHOLDS.*_P99 是按同名字段导出的门限，那就等于把门限放宽
  const spiky = (p99: number): TimeStats => ({ total: 1000, avg: 0.1, min: 0.001, max: p99, median: 0.12, p95: 0.5, p99, stdDev: 0.4 })
  const mergedSpiky = ResultBuilder.mergeResults('spiky', [
    ResultBuilder.createResult({ scenario: 's', iterations: 10000, timeStats: spiky(1) }),
    ResultBuilder.createResult({ scenario: 's', iterations: 10000, timeStats: spiky(9) }),
  ])
  const spikyTime = mergedSpiky.results.executionTime
  check('合并结果的 p99 是参与方同一分位的上界（9），不是轮均值的分布（0.1 量级）', spikyTime.p99 === 9, String(spikyTime.p99))
  check('合并结果的 median/p95 同口径（取参与方最大值）', spikyTime.median === 0.12 && spikyTime.p95 === 0.5, `median=${spikyTime.median} p95=${spikyTime.p95}`)
  check('合并结果的 stdDev 按全方差公式精确合并（等权 0.4 ⟹ 仍为 0.4）', Math.abs(spikyTime.stdDev - 0.4) < 1e-9, String(spikyTime.stdDev))
  check('合并结果仍与 avg 同源可比', Math.abs(spikyTime.avg - 2000 / 20000) < 1e-12, String(spikyTime.avg))

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
  // getCached 与 getCacheStats 同一套「按存在性动态暴露」：包成恒存在的箭头函数会让 runner 的
  // readKey 恒走 `store.getCached(key)` → 一次什么都不做的调用，5b 那条退化路径在适配入口下
  // 整段失效（被计时的仍是空转）
  check('无 getCached 的 store 适配后该成员缺席（readKey 退化路径可达）', adapted.getCached === undefined, typeof adapted.getCached)
  bare.getCached = (key) => `cached:${key}`
  check('构造之后才挂上的 getCached 同样按访问时解析', adapted.getCached?.('a') === 'cached:a', String(adapted.getCached?.('a')))
  delete (bare as { getCached?: unknown }).getCached
  check('源对象上撤掉 getCached 后适配器也跟着缺席', adapted.getCached === undefined, typeof adapted.getCached)

  // —— 8. 预热入口：异步回调不能静默不等待 ——
  // `() => void` 的返回位按 TS 规则接受任何返回 Promise 的函数（下面这行编译得过来，
  // 正是本条缺陷的形状）：旧实现循环里不 await，预热全在测量开始后才完成，
  // 且留下 N 个 floating promise（Node 22 默认策略下以 UnhandledPromiseRejection 终止整轮基准）
  const rejectingWarmup = async (): Promise<void> => {
    await Promise.resolve()
    throw new Error('预热体里炸了')
  }
  let warmupError = ''
  try {
    executeWarmup(rejectingWarmup, 3)
  } catch (error) {
    warmupError = error instanceof Error ? error.message : String(error)
  }
  check(
    'executeWarmup 拒绝异步回调并指到异步版本',
    warmupError.includes('executeWarmupAsync') && warmupError.includes('同步回调'),
    warmupError || '未抛错：异步预热被静默吞下'
  )
  let warmupRuns = 0
  executeWarmup(() => {
    warmupRuns++
  }, 5)
  check('同步回调仍照常跑满 iterations', warmupRuns === 5, String(warmupRuns))
  let asyncRuns = 0
  await executeWarmupAsync(async () => {
    await Promise.resolve()
    asyncRuns++
  }, 4)
  check('executeWarmupAsync 逐轮 await 到兑现', asyncRuns === 4, String(asyncRuns))

  // —— 9. 格式化三位一体：非有限值一律收敛成 N/A ——
  // reporter 用它打「吞吐量 X ops/s」、runner 用它打门限，门限被算成 NaN 时报告里会出现
  // 「低于门限 ∞ ops/s」这种既读不出量纲也认不出是配置错误的行
  check(
    'formatNumber 对 NaN/Infinity 收敛成 N/A（与 formatBytes/formatTime 同口径）',
    benchmarkUtils.formatNumber(Number.NaN) === 'N/A' && benchmarkUtils.formatNumber(Number.POSITIVE_INFINITY) === 'N/A',
    `Infinity → ${benchmarkUtils.formatNumber(Number.POSITIVE_INFINITY)}`
  )
  check(
    'formatNumber 正常值的千分位不变',
    benchmarkUtils.formatNumber(1234.5) === '1,234.5' && benchmarkUtils.formatNumber(-1500) === '-1,500',
    benchmarkUtils.formatNumber(1234.5)
  )

  console.log(`\n=== 冒烟结果：${failures.length === 0 ? '全部通过' : `${failures.length} 项失败`} ===`)
  for (const f of failures) console.error(`FAIL ${f}`)
  process.exitCode = failures.length === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('冒烟入口异常终止:', error)
  process.exitCode = 1
})
