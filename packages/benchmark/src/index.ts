/**
 * @geomstore/benchmark - 基准测试工具包
 *
 * 提供全面的性能基准测试功能，可独立使用或与 GeomStore 集成
 */

// 类型定义
export type * from './types/index.js'

import type { CacheStats, BenchmarkStore } from './types/index.js'

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
// `BenchmarkUtils` 一名只指这个类（值 + 类型）。它原先与 types/index.ts 里的同名接口相撞：
// 显式导出优先级高于上面的 `export type *`，那份接口在包名下取不到、又被静默遮蔽，
// 现已把接口改名为 `BenchmarkUtilsContract`（见 types/index.ts）。
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
 *
 * 入参直接引用 `BenchmarkStore<S>`，不再手抄成员清单：抄的那份与接口各自演化时，
 * 接口加必填成员只有返回值一侧会报错；而且抄的写法把成员写成了属性式箭头函数
 * （`strictFunctionTypes` 下参数按逆变严格比对），接口侧是方法简写（双变比对），
 * 一个已经满足 `BenchmarkStore` 的 store 反而可能被这份参数拒掉。
 * 报告建议的 `Pick<BenchmarkStore<S>, ...>` 列的是该接口全部成员，与接口本身等价，
 * 故直接取接口名。
 *
 * 约束取 `object` 而非 `State`（= `Record<string, unknown>`）：与 R5-069 同口径——
 * `Record<string, unknown>` 只接受带索引签名的类型，业务侧以 `interface MyState { … }`
 * 声明的状态会被本函数拒收（TS2345），而 `BenchmarkStore` 自身早已放开为 `object`，
 * 适配器这一层再收紧等于把刚放开的门又关上。
 */
export function createBenchmarkAdapter<S extends object>(store: BenchmarkStore<S>): BenchmarkStore<S> {
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
    // getCacheStats 同理不能在设计期定死引用：库常在 enableCache()/懒初始化之后才挂上
    // 缓存统计，构造期解构出来的 undefined 会让 runner 永远按「缓存未启用」上报，
    // 产出一份错的缓存报告而不是报错。
    // 与 getCached 的差别要保住：runner 拿「这个成员在不在」当「有没有缓存统计」的
    // 三态契约信号（见 BenchmarkStore.getCacheStats 注释），所以不能像 getCached 那样
    // 包一层恒存在的箭头函数；用 getter 每次访问时现解析，缺席时返回 undefined，
    // 「有没有」与「实现是谁」都保持动态。
    get getCacheStats(): (() => CacheStats) | undefined {
      const fn = store.getCacheStats
      return fn ? () => fn.call(store) : undefined
    },
    destroy: () => store.destroy(),
  }
}
