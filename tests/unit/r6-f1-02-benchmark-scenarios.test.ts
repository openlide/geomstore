/**
 * 第六轮 f1-02 回归锁：默认基准场景集只列 runner 真会测量的档（R6-019）
 *
 * `packages/benchmark/src/config.ts` 原先带着一条 `concurrent-access / 并发访问测试 /
 * concurrency: 10`，但 runner 的测量循环自始至终是 `for (let i = 0; i < iterations; i++)`
 * 的串行轮转，全包没有任何一处读取 `scenario.concurrency`（`benchmarkUtils.parallel`
 * 也从未被 runner 调用）。该档于是与 `medium-workload` 测同一件事，却以「并发」名义进报告，
 * 并把这个无效值随 `report.config` 一并发布。
 *
 * 用 `jest.requireActual` 取模块：`packages/**` 被 tsconfig.tests.json 的 exclude 挡在
 * 类型检查程序之外，运行期取它才不会顺带改变该包的类型检查口径。
 */

interface ScenarioLike {
  name: string
  datasetSize: string
  iterations: number
  concurrency?: number
}

interface BenchmarkConfigModule {
  defaultBenchmarkConfig: { scenarios: ScenarioLike[] }
  relaxedBenchmarkConfig: { scenarios: ScenarioLike[] }
}

const { defaultBenchmarkConfig, relaxedBenchmarkConfig } = jest.requireActual<BenchmarkConfigModule>('../../packages/benchmark/src/config')

/** runner 目前唯一会执行的场景集（`for` 循环串行轮转 + cacheConfig 分支） */
const supportedScenarioNames = ['basic-read', 'basic-write', 'medium-workload', 'large-workload', 'cache-efficiency', 'stress-test']

describe('R6-019: 无实现的并发档不再进入默认场景集', () => {
  it('默认场景集就是 runner 会逐条执行的那几档', () => {
    expect(defaultBenchmarkConfig.scenarios.map((scenario) => scenario.name)).toEqual(supportedScenarioNames)
  })

  it('两套配置都不再声明无人读取的 concurrency', () => {
    for (const scenarios of [defaultBenchmarkConfig.scenarios, relaxedBenchmarkConfig.scenarios]) {
      expect(scenarios.filter((scenario) => scenario.concurrency !== undefined)).toEqual([])
    }
  })

  it('宽松档与默认档场景一一对应（并发档不会只从一边消失）', () => {
    expect(relaxedBenchmarkConfig.scenarios.map((scenario) => scenario.name)).toEqual(supportedScenarioNames)
  })
})
