/**
 * @geomstore/benchmark - 基准测试工具包
 *
 * 提供全面的性能基准测试功能，可独立使用或与 GeomStore 集成
 */

// 类型定义
export type * from './types/index.js'

import type { ActionMap, BenchmarkStore, CacheStats } from './types/index.js'

// 核心类
export { BenchmarkRunner } from './runner.js'
export { BenchmarkReporter, benchmarkReporter } from './reporter.js'
export type { ReportFormat } from './reporter.js'

// 配置
export { defaultBenchmarkConfig, relaxedBenchmarkConfig, mergeConfig } from './config.js'

// 常量
export {
  WARMUP_ITERATIONS,
  DEFAULT_ITERATIONS,
  TIME_THRESHOLDS,
  MEMORY_THRESHOLDS,
  THROUGHPUT_THRESHOLDS,
  CACHE_THRESHOLDS,
  DATASET_SIZE_THRESHOLDS,
  SAMPLING_CONFIG,
  SCENARIO_NAMES,
} from './constants.js'

// 工具函数
export { benchmarkUtils, BenchmarkUtils } from './utils.js'

// 辅助函数
export {
  ResultBuilder,
  calculateCacheHitRate,
  buildCacheResult,
  emptyCacheResult,
  executeWarmup,
  warmupCache,
} from './helpers.js'
export type { TimeStats, MemoryStats, ResultBuilderOptions } from './helpers.js'

/**
 * 创建适配器 - 将 GeomStore Store 适配为 BenchmarkStore
 */
export function createBenchmarkAdapter<S extends Record<string, unknown>>(
  store: {
    getState: () => S
    setState: <K extends keyof S>(key: K, value: S[K]) => void
    $patch: (partial: Partial<S>) => void
    $replaceState: (state: S) => void
    actions: ActionMap<S>
    dispatch: (name: string, ...args: unknown[]) => unknown
    subscribe: (listener: () => void) => () => void
    getCached?: (key: string) => unknown
    getCacheStats?: () => CacheStats
    destroy: () => void
  }
): BenchmarkStore<S> {
  const { getCacheStats } = store
  return {
    getState: () => store.getState(),
    setState: (key, value) => store.setState(key, value),
    $patch: (partial) => store.$patch(partial),
    $replaceState: (state) => store.$replaceState(state),
    get actions() {
      return store.actions
    },
    dispatch: (name, ...args) => store.dispatch(name, ...args),
    subscribe: (listener) => store.subscribe(listener),
    // getCached 每次调用现取：被适配的库常在 enableCache()/懒初始化之后才挂上它，
    // 构造期做特性探测会把「当时没有」固化成永久 undefined，缓存读分支于是静默空转
    getCached: (key) => store.getCached?.(key),
    // getCacheStats 相反地保持构造期判定：它的「有没有」本身就是 runner 用来上报
    // 「缓存未启用」的契约信号（见 BenchmarkStore.getCacheStats 注释），改成恒有值会让
    // 没有缓存的库被当成有缓存统计
    getCacheStats: getCacheStats ? () => getCacheStats.call(store) : undefined,
    destroy: () => store.destroy(),
  }
}
