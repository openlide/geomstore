/**
 * @geomstore/benchmark - 基准测试工具包
 *
 * 提供全面的性能基准测试功能，可独立使用或与 GeomStore 集成
 */

// 类型定义
export type * from './types'

// 核心类
export { BenchmarkRunner } from './runner'
export { BenchmarkReporter, benchmarkReporter } from './reporter'
export type { ReportFormat } from './reporter'

// 配置
export { defaultBenchmarkConfig, relaxedBenchmarkConfig, mergeConfig } from './config'

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
} from './constants'

// 工具函数
export { benchmarkUtils, BenchmarkUtils } from './utils'

// 辅助函数
export {
  ResultBuilder,
  calculateCacheHitRate,
  buildCacheResult,
  emptyCacheResult,
  executeWarmup,
  warmupCache,
} from './helpers'
export type { TimeStats, MemoryStats, ResultBuilderOptions } from './helpers'

/**
 * 创建适配器 - 将 GeomStore Store 适配为 BenchmarkStore
 */
export function createBenchmarkAdapter<S extends Record<string, unknown>>(
  store: {
    getState: () => S
    setState: <K extends keyof S>(key: K, value: S[K]) => void
    $patch: (partial: Partial<S>) => void
    $replaceState: (state: S) => void
    actions: Record<string, (...args: unknown[]) => unknown>
    dispatch: (name: string, ...args: unknown[]) => unknown
    subscribe: (listener: () => void) => () => void
    getCached?: (key: string) => unknown
    getCacheStats: () => { enabled: boolean; hits: number; misses: number; evictions?: number }
    destroy: () => void
  }
): import('./types').BenchmarkStore<S> {
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
    getCached: store.getCached ? (key) => store.getCached?.(key) : undefined,
    getCacheStats: () => store.getCacheStats(),
    destroy: () => store.destroy(),
  }
}
