/**
 * 第六轮 f2-12 分片回归锁：benchmark runner 的编排、内存口径与失败结果
 *
 * 覆盖 R6-025（runAll 重入把两轮样本混成一份报告）、R6-026（脏基线把内存增量夹成 0 的假绿）、
 * R6-027（datasets[*].actions / subscribers 此前无人读取）、R6-028（dispatch 的异步段被丢在
 * measureTime 之外）、R6-073（失败结果按迭代数反推档位、iterations 照抄声明值）、
 * R6-024（成员存在却不读取的 getCached 绕过退化路径）。
 *
 * `packages/**` 被 tsconfig.tests.json 的 exclude 挡在类型检查程序之外，这里只在运行期取它，
 * 不改变该包的类型检查口径（与 r6-f1-03-* 两份锁同一写法）。
 */

import type { BenchmarkStore, State } from '../../packages/benchmark/src/types/index.js'
import { BenchmarkRunner } from '../../packages/benchmark/src/runner.js'

interface CreateStoreConfig {
  state: Record<string, unknown>
  actions?: Record<string, () => unknown>
  enableCache?: boolean
  cacheConfig?: { capacity?: number; ttl?: number }
  cacheKeys?: string[]
}

type CreateStoreFn = (config: CreateStoreConfig) => BenchmarkStore<Record<string, unknown>>

/**
 * `BenchmarkRunner` 构造器第一个形参的形状（runner.ts:146 是内联写的，这里按同一形状命名一份）。
 * 注意它对被注入的实现是**多态**的（`<S extends State>` 返回 `BenchmarkStore<S>`），而本文件的
 * 最小桩 store 一律以 `Record<string, unknown>` 作状态 ⟹ `CreateStoreFn` 与它并不相容
 * （`BenchmarkStore<Record<string, unknown>>` 的 `getState()` 给不出 `DeepReadonly<S>`）。
 * 交给构造器时按「先到 unknown 再到目标类型」双重断言，而不是 `as never` 把实参检查整个关掉。
 */
type RunnerCreateStoreFn = <S extends State>(config: {
  state: S
  actions?: Record<string, () => unknown>
  getters?: Record<string, (state: S) => unknown>
  enableCache?: boolean
  cacheConfig?: { capacity?: number; ttl?: number }
  cacheKeys?: string[]
}) => BenchmarkStore<S>

/** 一个够用的最小 store：状态放在闭包里，缓存按需模拟 */
function makeStore(bag: Record<string, unknown>, options: { cache?: boolean; noopGetCached?: boolean } = {}): BenchmarkStore<Record<string, unknown>> {
  const hits = { value: 0 }
  const misses = { value: 0 }
  return {
    getState: () => bag as State,
    setState: (key, value) => {
      bag[String(key)] = value
    },
    $patch: (partial) => Object.assign(bag, partial),
    $replaceState: (next) => {
      for (const key of Object.keys(bag)) delete bag[key]
      Object.assign(bag, next)
    },
    actions: {},
    dispatch: () => undefined,
    subscribe: () => () => undefined,
    getCached: options.noopGetCached
      ? // 被包装层「伪装成有缓存」的形状：成员恒在，但什么都不读、计数器一步不动
        () => undefined
      : options.cache
        ? (key: string) => {
            if (key in bag) {
              hits.value++
              return bag[key]
            }
            misses.value++
            return undefined
          }
        : undefined,
    getCacheStats: () => ({ enabled: Boolean(options.cache || options.noopGetCached), hits: hits.value, misses: misses.value }),
    destroy: () => undefined,
  }
}

/** 每轮 runAll 用独立的场景名，便于判断报告里混进了谁 */
function runnerFor(createStore: CreateStoreFn, scenarioNames: string[], extra: Record<string, unknown> = {}) {
  return new BenchmarkRunner(
    createStore as never,
    {
      general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
      datasets: { small: { stateKeys: 4, actions: 3, getters: 1, subscribers: 2, nestingDepth: 1 } },
      scenarios: scenarioNames.map((name) => ({ name, description: name, datasetSize: 'small', iterations: 12 })),
      ...extra,
    } as never,
  )
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('R6-025 runAll 的累加状态属于每次运行', () => {
  it('先后两次 runAll 各自从空数组起步（第二次不再累加第一次的结果）', async () => {
    const runner = new BenchmarkRunner(
      makeStore as never,
      {
        general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
        datasets: { small: { stateKeys: 4, actions: 3, getters: 1, subscribers: 2, nestingDepth: 1 } },
        scenarios: [{ name: 'solo', description: 'solo', datasetSize: 'small', iterations: 8 }],
      } as never,
    )

    const first = await runner.runAll()
    const second = await runner.runAll()

    expect(first.summary.totalScenarios).toBe(1)
    expect(second.results.map((r) => r.scenario)).toEqual(['solo'])
  })

  it('同一实例并发 runAll：两份报告的条目数与耗时都不串味', async () => {
    const runner = new BenchmarkRunner(
      makeStore as never,
      {
        general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
        datasets: { small: { stateKeys: 4, actions: 3, getters: 1, subscribers: 2, nestingDepth: 1 } },
        scenarios: [
          { name: 'x-1', description: 'x1', datasetSize: 'small', iterations: 20 },
          { name: 'x-2', description: 'x2', datasetSize: 'small', iterations: 20 },
        ],
      } as never,
    )

    const [a, b] = await Promise.all([runner.runAll(), runner.runAll()])

    for (const report of [a, b]) {
      // 旧实现：`this.results = []` 会抹掉另一轮已 push 的结果、另一轮后续 push 又落进这一轮，
      // 于是两份报告的 totalScenarios 可能是 2/3/4 的任意组合、条目名互相穿插
      expect(report.summary.totalScenarios).toBe(2)
      expect(report.results.map((r) => r.scenario).sort()).toEqual(['x-1', 'x-2'])
      expect(report.summary.totalDuration).toBeGreaterThanOrEqual(0)
      expect(report.summary.passedScenarios + report.summary.failedScenarios).toBe(2)
    }
    // 两轮的建议也各自独立（旧实现第二次的 thresholdIssues.clear() 会抹掉第一轮未出报告的建议）
    expect(a.recommendations.length).toBeGreaterThan(0)
    expect(b.recommendations.length).toBeGreaterThan(0)
  })
})

describe('R6-026 内存增量以本轮样本下界为基准', () => {
  const snapshot = (heapUsed: number) => ({ heapTotal: heapUsed * 2, heapUsed, external: 0 })

  it('脏基线（基线高于本轮所有样本）不再把 delta 夹成 0', async () => {
    // 采到的序列刻意构造成「基线脏 → GC → 之后每个样本都低于基线」：
    // 旧口径 delta = peak − initial，peak 以脏基线播种且只在上探时抬高 ⟹ 恒为 0，
    // 内存门限 `delta <= perStore × 档位倍数` 无条件通过（假绿）
    const samples = [10_000_000, 8_000_000, 8_100_000, 8_200_000, 8_300_000]
    let cursor = 0
    const usage = jest.spyOn(process, 'memoryUsage').mockImplementation(() => {
      const heapUsed = samples[Math.min(cursor, samples.length - 1)]
      cursor++
      return snapshot(heapUsed) as never
    })

    const report = await new BenchmarkRunner(
      makeStore as never,
      {
        general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
        datasets: { small: { stateKeys: 4, actions: 3, getters: 1, subscribers: 2, nestingDepth: 1 } },
        scenarios: [{ name: 'dirty-baseline', description: '脏基线', datasetSize: 'small', iterations: 3 }],
      } as never,
    ).runAll()
    usage.mockRestore()

    const memory = report.results[0].results.memory
    expect(memory.initial).toBe(10_000_000)
    // 新口径：peak − 本轮样本下界 = 10_000_000 − 8_000_000
    expect(memory.delta).toBe(2_000_000)
    expect(memory.delta).toBeGreaterThan(0)
  })

  it('堆完全没动时 delta 仍是 0（0 只能由真没涨产生）', async () => {
    const usage = jest.spyOn(process, 'memoryUsage').mockImplementation(() => snapshot(5_000_000) as never)
    const report = await new BenchmarkRunner(
      makeStore as never,
      {
        general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
        datasets: { small: { stateKeys: 4, actions: 3, getters: 1, subscribers: 2, nestingDepth: 1 } },
        scenarios: [{ name: 'flat-heap', description: '堆不动', datasetSize: 'small', iterations: 6 }],
      } as never,
    ).runAll()
    usage.mockRestore()

    expect(report.results[0].results.memory.delta).toBe(0)
  })
})

describe('R6-027 数据集配置里真被读取的维度', () => {
  it('动作注册表按 datasets[*].actions 生成，subscribers 真的有挂上监听器', async () => {
    const dispatched: string[] = []
    let subscribed = 0
    let unsubscribed = 0

    const createStore: CreateStoreFn = (config) => {
      const store = makeStore({ ...config.state }, { cache: true })
      const actionCount = Object.keys(config.actions ?? {}).length
      // 配置声明 3 个动作（stateKeys 是 4）：旧实现拿工具类硬编码的 min(stateKeys,20)，
      // 与配置对不上，dispatch 档门限判的是一个没人配置过的动作集
      expect(actionCount).toBe(3)
      return {
        ...store,
        actions: config.actions ?? {},
        dispatch: (name: string) => {
          dispatched.push(name)
          return undefined
        },
        subscribe: (listener: () => void) => {
          subscribed++
          void listener
          return () => {
            unsubscribed++
          }
        },
      }
    }

    const report = await new BenchmarkRunner(
      createStore as never,
      {
        general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
        datasets: { small: { stateKeys: 4, actions: 3, getters: 1, subscribers: 2, nestingDepth: 1 } },
        scenarios: [{ name: 'shape', description: '形状', datasetSize: 'small', iterations: 12 }],
      } as never,
    ).runAll()

    expect(report.summary.totalScenarios).toBe(1)
    // dispatch 槽（index % 4 === 3）在 12 轮里跑过，且只可能点到这 3 个动作
    expect(new Set(dispatched).size).toBeGreaterThan(0)
    expect([...new Set(dispatched)].every((name) => /^action[0-2]$/.test(name))).toBe(true)
    expect(subscribed).toBe(2)
    // 场景收尾必须退订（否则订阅常驻成本被记到后续场景的内存增量上）
    expect(unsubscribed).toBe(2)
  })

  it('报告点名「声明但未测量」的维度，不再让配置宣称它测过', async () => {
    const report = await runnerFor(makeStore as unknown as CreateStoreFn, ['note'], {
      scenarios: [{ name: 'note', description: 'n', datasetSize: 'small', iterations: 8, concurrency: 4 }],
    } as never).runAll()

    const note = report.recommendations.find((line) => line.includes('声明值'))
    expect(note).toBeDefined()
    expect(note).toContain('scenario.concurrency')
    expect(note).toContain('datasets[*].getters')
    expect(note).toContain('nestingDepth')
    // 已经接进测量的维度不在清单里
    expect(note).not.toContain('subscribers')
  })
})

describe('R6-028 dispatch 的异步段计入本轮并被等待', () => {
  it('返回 Promise 的动作：耗时含续段，且销毁发生在续段之后', async () => {
    const events: string[] = []
    let destroyed = false

    const createStore: CreateStoreFn = (config) => {
      const store = makeStore({ ...config.state })
      return {
        ...store,
        actions: { action0: () => undefined },
        dispatch: () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              events.push(destroyed ? 'resolve-after-destroy' : 'resolve-before-destroy')
              resolve()
            }, 30)
            return undefined
          }),
        destroy: () => {
          destroyed = true
          events.push('destroy')
        },
      }
    }

    const report = await new BenchmarkRunner(
      createStore as never,
      {
        general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
        datasets: { small: { stateKeys: 4, actions: 3, getters: 1, subscribers: 2, nestingDepth: 1 } },
        // 4 轮覆盖 index % 4 的四个槽，其中一轮是 dispatch
        scenarios: [{ name: 'async-dispatch', description: '异步动作', datasetSize: 'small', iterations: 4 }],
      } as never,
    ).runAll()

    const time = report.results[0].results.executionTime
    // 旧实现：被计时的只有同步前缀（avg 与同步槽同量级、微秒级），30ms 的续段整个落在外面
    expect(time.avg).toBeGreaterThanOrEqual(5)
    expect(events).toContain('resolve-before-destroy')
    expect(events).not.toContain('resolve-after-destroy')
  })

  it('动作 reject 时不再留下 floating rejection，而是把场景计入 errors', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    const createStore: CreateStoreFn = (config) => {
      const store = makeStore({ ...config.state })
      return {
        ...store,
        actions: { action0: () => undefined },
        dispatch: () => Promise.reject(new Error('动作里炸了')),
      }
    }

    try {
      const report = await new BenchmarkRunner(
        createStore as never,
        {
          general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
          datasets: { small: { stateKeys: 4, actions: 3, getters: 1, subscribers: 2, nestingDepth: 1 } },
          scenarios: [{ name: 'rejecting', description: 'reject', datasetSize: 'small', iterations: 8 }],
        } as never,
      ).runAll()

      const failed = report.results[0]
      expect(failed.passed).toBe(false)
      expect((failed.errors ?? []).join(' ')).toContain('动作里炸了')
      // Node 默认 --unhandled-rejections=throw 会让整轮基准当场终止；await 之后不会再生成
      await new Promise((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })
})

describe('R6-024 getCached 成员存在但不读取时退化为真实状态读', () => {
  it('空转的 getCached 被探针识别，结果里带上原因', async () => {
    const report = await new BenchmarkRunner(
      ((config: CreateStoreConfig) => makeStore({ ...config.state }, { noopGetCached: true })) as unknown as RunnerCreateStoreFn,
      {
        general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
        datasets: { small: { stateKeys: 4, actions: 3, getters: 1, subscribers: 2, nestingDepth: 1 } },
        scenarios: [{ name: 'noop-cache', description: '假缓存成员', datasetSize: 'small', iterations: 8, cacheConfig: { capacity: 2 } }],
      } as never,
    ).runAll()

    const result = report.results[0]
    expect((result.warnings ?? []).join(' ')).toContain('hits+misses 未变化')
    expect(result.results.cache.hits + result.results.cache.misses).toBe(0)
  })

  it('真读缓存的 store 不被误判（无退化告警）', async () => {
    const report = await new BenchmarkRunner(
      ((config: CreateStoreConfig) => {
        const bag: Record<string, unknown> = { ...config.state, hit: 1 }
        return makeStore(bag, { cache: true })
      }) as unknown as RunnerCreateStoreFn,
      {
        general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
        datasets: { small: { stateKeys: 4, actions: 3, getters: 1, subscribers: 2, nestingDepth: 1 } },
        scenarios: [{ name: 'real-cache', description: '真缓存', datasetSize: 'small', iterations: 8, cacheConfig: { capacity: 2 } }],
      } as never,
    ).runAll()

    const result = report.results[0]
    expect(result.warnings ?? []).toEqual([])
    expect(result.results.cache.hits + result.results.cache.misses).toBeGreaterThan(0)
  })
})

describe('R6-073 失败结果用真档位、迭代数记实测值', () => {
  it('测量前抛错的场景：datasetSize 用场景声明的那档，iterations 记 0', async () => {
    const report = await new BenchmarkRunner(
      makeStore as never,
      {
        general: { warmupIterations: 0, enableWarmup: false, skipGC: true },
        // 非法 stateKeys ⟹ runScenario 在测量前抛错
        datasets: { large: { stateKeys: 2.5 } },
        // 12345 轮在旧的 `inferDatasetSize` 表里落在 xlarge，而真实档位是 large
        scenarios: [{ name: 'boom', description: '测量前抛错', datasetSize: 'large', iterations: 12345 }],
      } as never,
    ).runAll()

    const failed = report.results[0]
    expect(failed.passed).toBe(false)
    expect(failed.datasetSize).toBe('large')
    expect(failed.iterations).toBe(0)
    expect((failed.warnings ?? []).join(' ')).toContain('12345')
    expect((failed.warnings ?? []).join(' ')).toContain('实测完成 0 轮')
  })
})
