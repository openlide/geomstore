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

/** 阈值分组逐键乘倍数（倍数 <1 表示下调门限） */
function relaxThresholds<K extends string>(base: Record<K, number>, factors: Record<K, number>): Record<K, number> {
  // 以 base 的键集为准：倍数表缺键在编译期就被 Record<K, number> 拦住，
  // 这里再按 base 取值，保证「默认配置里有的键」一个不丢
  const relaxed = {} as Record<K, number>
  for (const key of Object.keys(base) as K[]) {
    relaxed[key] = base[key] * factors[key]
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
 */
export const relaxedBenchmarkConfig: BenchmarkConfig = mergeConfig(defaultBenchmarkConfig, {
  general: { warmupIterations: 100 },
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
 * 返回值与各分组、每个数据集档位、scenarios 数组都是副本：单层展开只复制引用，
 * 调用方拿到配置后改一处就会污染模块级默认配置，后续所有基准的输入都被悄悄换掉。
 *
 * 入参是 `BenchmarkConfigOverride`（深 Partial），与本函数的逐层合并语义对齐；
 * scenarios 仍是整体替换（数组在类型层也不逐元素合并）。
 */
export function mergeConfig(base: BenchmarkConfig, custom?: BenchmarkConfigOverride): BenchmarkConfig {
  return {
    ...base,
    general: { ...base.general, ...custom?.general },
    // 逐档位合并：整档覆盖会让 `{ datasets: { medium: { stateKeys: 50 } } }`
    // 悄悄丢掉 actions / getters / subscribers / nestingDepth
    datasets: {
      small: { ...base.datasets.small, ...custom?.datasets?.small },
      medium: { ...base.datasets.medium, ...custom?.datasets?.medium },
      large: { ...base.datasets.large, ...custom?.datasets?.large },
      xlarge: { ...base.datasets.xlarge, ...custom?.datasets?.xlarge },
    },
    thresholds: {
      ...base.thresholds,
      ...custom?.thresholds,
      operationTime: { ...base.thresholds.operationTime, ...custom?.thresholds?.operationTime },
      memory: { ...base.thresholds.memory, ...custom?.thresholds?.memory },
      throughput: { ...base.thresholds.throughput, ...custom?.thresholds?.throughput },
    },
    // scenarios 保持整组替换语义（自定义即覆盖默认场景集），但返回副本
    scenarios: [...(custom?.scenarios ?? base.scenarios)],
  }
}
