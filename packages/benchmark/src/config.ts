/**
 * @geomstore/benchmark - 基准测试配置
 */

import type { DatasetSize, BenchmarkScenario, BenchmarkConfig } from './types'

export type { DatasetSize, BenchmarkScenario, BenchmarkConfig }

/**
 * 默认配置
 */
export const defaultBenchmarkConfig: BenchmarkConfig = {
  general: {
    iterations: 10000,
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
 * 宽松配置（用于开发环境或 CI）
 */
export const relaxedBenchmarkConfig: BenchmarkConfig = {
  ...defaultBenchmarkConfig,
  thresholds: {
    operationTime: { setState: 5, $patch: 10, $replaceState: 20, dispatch: 10, getter: 2, subscribe: 5 },
    memory: { perStore: 1000000, perStateItem: 10000, perSubscriber: 5000 },
    throughput: { setState: 1000, dispatch: 500, getter: 2000 },
    cacheHitRate: 50,
  },
  general: { ...defaultBenchmarkConfig.general, warmupIterations: 100 },
}

/**
 * 合并配置
 */
export function mergeConfig(base: BenchmarkConfig, custom?: Partial<BenchmarkConfig>): BenchmarkConfig {
  if (!custom) return base

  return {
    ...base,
    ...custom,
    general: { ...base.general, ...custom.general },
    datasets: { ...base.datasets, ...custom.datasets },
    thresholds: {
      ...base.thresholds,
      ...custom.thresholds,
      operationTime: { ...base.thresholds.operationTime, ...custom.thresholds?.operationTime },
      memory: { ...base.thresholds.memory, ...custom.thresholds?.memory },
      throughput: { ...base.thresholds.throughput, ...custom.thresholds?.throughput },
    },
    scenarios: custom.scenarios || base.scenarios,
  }
}
