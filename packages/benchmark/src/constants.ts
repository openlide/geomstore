/**
 * @geomstore/benchmark - 常量定义
 */

/**
 * 预热迭代次数
 */
export const WARMUP_ITERATIONS = 100

/**
 * 默认迭代次数
 */
export const DEFAULT_ITERATIONS = 10000

/**
 * 时间阈值配置（毫秒）
 */
export const TIME_THRESHOLDS = {
  /** setState 平均执行时间阈值 */
  SET_STATE_AVG: 0.1,
  /** setState P99 执行时间阈值 */
  SET_STATE_P99: 1,
  /** $patch 平均执行时间阈值 */
  PATCH_AVG: 0.5,
  /** $patch P99 执行时间阈值 */
  PATCH_P99: 2,
  /** $replaceState 平均执行时间阈值 */
  REPLACE_STATE_AVG: 0.3,
  /** dispatch 平均执行时间阈值 */
  DISPATCH_AVG: 0.2,
  /** getter 平均执行时间阈值 */
  GETTER_AVG: 0.05,
  /** 缓存操作平均执行时间阈值 */
  CACHE_AVG: 0.01,
} as const

/**
 * 内存阈值配置（字节）
 */
export const MEMORY_THRESHOLDS = {
  /** 单个 Store 最大内存 */
  PER_STORE: 10 * 1024 * 1024, // 10MB
  /** 每个状态项最大内存 */
  PER_STATE_ITEM: 1024, // 1KB
  /** 每个订阅者最大内存 */
  PER_SUBSCRIBER: 512, // 512B
  /** 缓存每项最大内存 */
  PER_CACHE_ITEM: 1024, // 1KB
} as const

/**
 * 吞吐量阈值配置（操作/秒）
 */
export const THROUGHPUT_THRESHOLDS = {
  /** setState 最小吞吐量 */
  SET_STATE_MIN: 10000,
  /** dispatch 最小吞吐量 */
  DISPATCH_MIN: 5000,
  /** getter 最小吞吐量 */
  GETTER_MIN: 50000,
  /** 缓存操作最小吞吐量 */
  CACHE_MIN: 100000,
} as const

/**
 * 缓存阈值配置
 */
export const CACHE_THRESHOLDS = {
  /** 缓存命中率阈值（百分比） */
  HIT_RATE_MIN: 80,
  /** 高性能缓存命中率阈值（百分比） */
  HIT_RATE_HIGH: 95,
} as const

/**
 * 数据集规模阈值
 */
export const DATASET_SIZE_THRESHOLDS = {
  /** 小型数据集最大迭代数 */
  SMALL_MAX: 1000,
  /** 中型数据集最大迭代数 */
  MEDIUM_MAX: 5000,
  /** 大型数据集最大迭代数 */
  LARGE_MAX: 10000,
} as const

/**
 * 内存采样间隔配置
 */
export const SAMPLING_CONFIG = {
  /** 最大采样数量 */
  MAX_SAMPLES: 100,
  /** 计算采样间隔 */
  getSampleInterval: (iterations: number): number =>
    Math.max(1, Math.floor(iterations / SAMPLING_CONFIG.MAX_SAMPLES)),
} as const

/**
 * 场景名称常量
 */
export const SCENARIO_NAMES = {
  // Execution benchmarks
  SET_STATE: 'set-state',
  PATCH: 'patch',
  REPLACE_STATE: 'replace-state',
  DISPATCH: 'dispatch',
  GETTER: 'getter',
  SUBSCRIBE: 'subscribe',

  // Cache benchmarks
  CACHE_HIT_RATE: 'cache-hit-rate',
  CACHE_MISS_RATE: 'cache-miss-rate',
  CACHE_INVALIDATION: 'cache-invalidation',
  BATCH_CACHE_INVALIDATION: 'batch-cache-invalidation',
  CACHE_TOGGLE: 'cache-toggle',
  CACHE_CONCURRENCY: 'cache-concurrency',
  CACHE_MEMORY_IMPACT: 'cache-memory-impact',
  CACHE_STATE_UPDATE: 'cache-state-update',
  CACHE_FULL: 'cache-full',

  // Memory benchmarks
  STATE_UPDATES: 'state-updates',
  SUBSCRIBER_GROWTH: 'subscriber-growth',
  STORE_CREATION: 'store-creation',
  PATCH_MEMORY: 'patch-memory',
  COMPOSE_MEMORY: 'compose-memory',

  // Throughput benchmarks
  STATE_THROUGHPUT: 'state-throughput',
  DISPATCH_THROUGHPUT: 'dispatch-throughput',
  GETTER_THROUGHPUT: 'getter-throughput',
  SUBSCRIBE_THROUGHPUT: 'subscribe-throughput',
} as const
