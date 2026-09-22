/**
 * @geomstore/benchmark - 基准测试配置
 */

import type { DatasetSize, BenchmarkScenario, BenchmarkConfig, BenchmarkConfigOverride } from './types/index.js'

export type { DatasetSize, BenchmarkScenario, BenchmarkConfig, BenchmarkConfigOverride }

/**
 * 默认配置
 */
export const defaultBenchmarkConfig: BenchmarkConfig = {
  general: {
    warmupIterations: 1000,
    enableWarmup: true,
    skipGC: false,
  },

  datasets: {
    small: { stateKeys: 10, actions: 5, getters: 3, subscribers: 5, nestingDepth: 1 },
    medium: { stateKeys: 100, actions: 20, getters: 10, subscribers: 20, nestingDepth: 3 },
    large: { stateKeys: 1000, actions: 50, getters: 30, subscribers: 50, nestingDepth: 5 },
    xlarge: { stateKeys: 10000, actions: 100, getters: 50, subscribers: 100, nestingDepth: 7 },
  },

  thresholds: {
    operationTime: {
      setState: 0.1,
      $patch: 0.5,
      $replaceState: 1.0,
      dispatch: 0.5,
      getter: 0.05,
      subscribe: 0.1,
    },
    memory: {
      perStore: 10000,
      perStateItem: 100,
      perSubscriber: 500,
    },
    throughput: {
      setState: 100000,
      dispatch: 50000,
      getter: 200000,
    },
    cacheHitRate: 90,
  },

  scenarios: [
    { name: 'basic-read', description: '基本读取操作', datasetSize: 'small', iterations: 10000, warmup: true, warmupIterations: 1000 },
    { name: 'basic-write', description: '基本写入操作', datasetSize: 'small', iterations: 10000, warmup: true, warmupIterations: 1000 },
    { name: 'medium-workload', description: '中等规模混合负载', datasetSize: 'medium', iterations: 5000, warmup: true, warmupIterations: 500 },
    { name: 'large-workload', description: '大规模负载测试', datasetSize: 'large', iterations: 1000, warmup: true, warmupIterations: 100 },
    { name: 'concurrent-access', description: '并发访问测试', datasetSize: 'medium', iterations: 2000, concurrency: 10, warmup: true, warmupIterations: 200 },
    { name: 'cache-efficiency', description: '缓存效率测试', datasetSize: 'large', iterations: 5000, warmup: true, warmupIterations: 500, cacheConfig: { capacity: 50, keySpaceMultiplier: 3, readWriteRatio: 0.7 } },
    { name: 'stress-test', description: '压力测试', datasetSize: 'xlarge', iterations: 100, warmup: true, warmupIterations: 10 },
  ],
}

/**
 * 宽松配置的放宽倍数表（逐键 = 原手写 relaxed / default）
 *
 * 键集绑死在 `BenchmarkConfig['thresholds'][...]` 上：以后给任一阈值分组加键，
 * 漏登记倍数就是编译错误。原先 relaxed 手写一整套并行的完整阈值，新键只会出现在
 * 默认配置里，两套数就此脱钩。
 */
const OPERATION_TIME_RELAXATION: Record<keyof BenchmarkConfig['thresholds']['operationTime'], number> = {
  setState: 50,
  $patch: 20,
  $replaceState: 20,
  dispatch: 20,
  getter: 40,
  subscribe: 50,
}

const MEMORY_RELAXATION: Record<keyof BenchmarkConfig['thresholds']['memory'], number> = {
  perStore: 100,
  perStateItem: 100,
  perSubscriber: 10,
}

/** 耗时越长的操作吞吐越低，故吞吐放宽是乘小于 1 的系数（下调一个数量级） */
const THROUGHPUT_RELAXATION: Record<keyof BenchmarkConfig['thresholds']['throughput'], number> = {
  setState: 0.01,
  dispatch: 0.01,
  getter: 0.01,
}

/** 命中率是百分比门限，「90 的几倍」既不好读也不是整数，单独给绝对值 */
const RELAXED_CACHE_HIT_RATE = 50

/**
 * 宽松档的统一预热次数上限（整轮 warmup 与逐场景 warmup 共用同一个数）
 *
 * `general.warmupIterations` 管的是整轮开始前的那次统一预热，场景自己的
 * `warmupIterations` 由 runner 独立驱动、既不继承也不被 general 覆盖（见
 * `BenchmarkScenario` 注释）。只调 general 的话，宽松档在慢速 CI/开发机上仍会按
 * 默认场景跑满 1000/500/200 轮预热，达不到「用于开发环境或 CI」的加速意图，
 * 故场景级预热一并夹到同一个上限。
 */
const RELAXED_WARMUP_ITERATIONS = 100

/** 阈值分组逐键乘倍数（倍数 <1 表示下调门限） */
function relaxThresholds<K extends string>(base: Record<K, number>, factors: Record<K, number>): Record<K, number> {
  // 以 base 的键集为准：倍数表缺键在编译期就被 Record<K, number> 拦住，
  // 这里再按 base 取值，保证「默认配置里有的键」一个不丢
  const relaxed = {} as Record<K, number>
  for (const key of Object.keys(base) as K[]) {
    // 编译期的键集约束只对字面量构造有效：配置对象来自未类型化的外部 JS、或绕过
    // 本模块直接构造时，缺键会算成 `base[key] * undefined === NaN`。NaN 参与
    // `avg <= NaN` / `opsPerSecond >= NaN` 恒为 false，等于该门限被静默改成
    // 「永远不达标」，比在这里抛错难发现得多，故显式失败
    const factor = factors[key]
    if (typeof factor !== 'number' || !Number.isFinite(factor)) {
      throw new Error(`relaxThresholds: 缺少键 "${key}" 的放宽倍数（得到 ${String(factor)}）`)
    }
    relaxed[key] = base[key] * factor
  }
  return relaxed
}

/**
 * 宽松配置（用于开发环境或 CI）
 *
 * 由 mergeConfig 派生而非手写展开：阈值全部从 `defaultBenchmarkConfig` 乘倍数得到，
 * 只列出要放松的键；同时保证 datasets / scenarios 是新副本，不会与 defaultBenchmarkConfig
 * 共享引用。general 只给 `warmupIterations` 一个键即可——入参是深 Partial（见
 * `BenchmarkConfigOverride`），不必再抄一份默认值来凑完整对象。
 *
 * 预热要两处一起调：`general.warmupIterations` 与逐场景的 `warmupIterations` 是两套
 * 独立驱动的计数（见 RELAXED_WARMUP_ITERATIONS 注释），只改 general 的话场景预热
 * 仍按默认档跑满。
 */
export const relaxedBenchmarkConfig: BenchmarkConfig = mergeConfig(defaultBenchmarkConfig, {
  general: { warmupIterations: RELAXED_WARMUP_ITERATIONS },
  scenarios: defaultBenchmarkConfig.scenarios.map((scenario) => ({
    ...scenario,
    warmupIterations: Math.min(scenario.warmupIterations ?? RELAXED_WARMUP_ITERATIONS, RELAXED_WARMUP_ITERATIONS),
  })),
  thresholds: {
    operationTime: relaxThresholds(defaultBenchmarkConfig.thresholds.operationTime, OPERATION_TIME_RELAXATION),
    memory: relaxThresholds(defaultBenchmarkConfig.thresholds.memory, MEMORY_RELAXATION),
    throughput: relaxThresholds(defaultBenchmarkConfig.thresholds.throughput, THROUGHPUT_RELAXATION),
    cacheHitRate: RELAXED_CACHE_HIT_RATE,
  },
})

/**
 * 合并配置
 *
 * 返回值与各分组、每个数据集档位、每条 scenario 都是副本：单层展开只复制引用，
 * 调用方拿到配置后改一处就会污染模块级默认配置，后续所有基准的输入都被悄悄换掉。
 * scenarios 除数组本身外还逐元素复制（含嵌套的 cacheConfig），否则
 * `config.scenarios[0].iterations = 5` 就直接写进 `defaultBenchmarkConfig`。
 *
 * 入参是 `BenchmarkConfigOverride`（深 Partial），与本函数的逐层合并语义对齐；
 * scenarios 仍是整体替换（数组在类型层也不逐元素合并）。
 */
export function mergeConfig(base: BenchmarkConfig, custom?: BenchmarkConfigOverride): BenchmarkConfig {
  return {
    ...base,
    general: { ...base.general, ...custom?.general },
    // 逐档位合并：整档覆盖会让 `{ datasets: { medium: { stateKeys: 50 } } }`
    // 悄悄丢掉 actions / getters / subscribers / nestingDepth。
    // 档位清单取 `base.datasets` 的实际键集而非此处手抄四遍：DatasetSize 增删档位时
    // 手写清单只会以「缺少属性」的报错间接体现，报错点离根因很远
    datasets: Object.fromEntries(
      (Object.keys(base.datasets) as DatasetSize[]).map((size) => [
        size,
        { ...base.datasets[size], ...custom?.datasets?.[size] },
      ])
    ) as BenchmarkConfig['datasets'],
    thresholds: {
      ...base.thresholds,
      ...custom?.thresholds,
      operationTime: { ...base.thresholds.operationTime, ...custom?.thresholds?.operationTime },
      memory: { ...base.thresholds.memory, ...custom?.thresholds?.memory },
      throughput: { ...base.thresholds.throughput, ...custom?.thresholds?.throughput },
    },
    // scenarios 保持整组替换语义（自定义即覆盖默认场景集），但连元素一起复制，
    // 嵌套的 cacheConfig 同样复制一份
    scenarios: (custom?.scenarios ?? base.scenarios).map((scenario) => ({
      ...scenario,
      cacheConfig: scenario.cacheConfig ? { ...scenario.cacheConfig } : scenario.cacheConfig,
    })),
  }
}
