/**
 * @geomstore/benchmark - 常量定义
 */

/**
 * 预热迭代次数
 */
export const WARMUP_ITERATIONS = 100

/**
 * 默认迭代次数
 *
 * 只是对外导出的参考值，包内没有任何读取方：`defaultBenchmarkConfig.scenarios` 的迭代数
 * 是逐条字面量，runner 判档位取 `scenario.datasetSize`，都不读这个常量。它恰好与
 * `DATASET_SIZE_THRESHOLDS.LARGE_MAX` 同为 10000，改它不会重分类任何默认场景（详见该表注释）。
 */
export const DEFAULT_ITERATIONS = 10000

/**
 * 时间阈值配置（毫秒）
 *
 * 组织维度是「操作」，不是「场景」：`SCENARIO_NAMES` 里的 cache-* / *-memory 系列场景
 * 不在此表逐条设阈，它们分别由 CACHE_THRESHOLDS（命中率）、MEMORY_THRESHOLDS
 * （每 Store / 每状态项 / 每订阅 / 每缓存项的字节数）与下面的 CACHE_AVG 覆盖。
 * 每个进入 runner 的操作都必须有 AVG 档，缺档即「该操作没有任何东西可校验」。
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
  /**
   * $replaceState P99 执行时间阈值
   *
   * 整对象替换会重建状态引用并让全部订阅者重算，尾部主要由 GC 决定；
   * 对 AVG 取约 3 倍余量，与 PATCH_P99/PATCH_AVG 的 4 倍同一量级。
   */
  REPLACE_STATE_P99: 1,
  /** dispatch 平均执行时间阈值 */
  DISPATCH_AVG: 0.2,
  /** getter 平均执行时间阈值 */
  GETTER_AVG: 0.05,
  /**
   * subscribe 平均执行时间阈值
   *
   * 与 `config.thresholds.operationTime.subscribe` 取同一数值：两处描述的是同一个操作，
   * 一份 0.1 一份别的数就会让「按配置判定」和「按常量判定」给出不同结论。
   */
  SUBSCRIBE_AVG: 0.1,
  /**
   * subscribe P99 执行时间阈值
   *
   * 登记监听器是 O(1) 数组推入，尾部来自订阅者数组扩容，故余量取 5 倍，
   * 落在 PATCH 的 4 倍与 SET_STATE 的 10 倍之间。
   */
  SUBSCRIBE_P99: 0.5,
  /** 缓存操作平均执行时间阈值 */
  CACHE_AVG: 0.01,
} as const

/**
 * 字节单位
 *
 * 内存阈值里有两处「1KB」（每状态项 / 每缓存项）和一处「10MB」，原先各写各的
 * `1024` / `1024 * 1024` 字面量：调一处、忘另一处就会静默脱钩，写成 `10 * MB`
 * 也和注释里的「10MB」对得上了。
 */
const KB = 1024
const MB = 1024 * KB

/**
 * 内存阈值配置（字节）
 */
export const MEMORY_THRESHOLDS = {
  /** 单个 Store 最大内存 */
  PER_STORE: 10 * MB, // 10MB
  /** 每个状态项最大内存 */
  PER_STATE_ITEM: KB, // 1KB
  /** 每个订阅者最大内存 */
  PER_SUBSCRIBER: 512, // 512B
  /** 缓存每项最大内存 */
  PER_CACHE_ITEM: KB, // 1KB
} as const

/**
 * 吞吐量安全系数：由 TIME_THRESHOLDS 推导下限时的余量
 *
 * 原先两组阈值各写各的，AVG 与对应 MIN 恰好互为倒数（0.01 ↔ 100000）甚至互相矛盾
 * （GETTER_AVG 0.05ms ⇒ 20000 ops/s，却要求 GETTER_MIN 50000），零余量让测量抖动
 * 就能使两项检查给出相反结论。现由耗时阈值单向推导，并留出 50% 抖动余量。
 */
const THROUGHPUT_SAFETY_FACTOR = 0.5

/** 由平均耗时阈值（ms/op）推导吞吐量下限（ops/s） */
function deriveThroughputMin(avgMs: number): number {
  return Math.floor((1000 / avgMs) * THROUGHPUT_SAFETY_FACTOR)
}

/**
 * 吞吐量阈值配置（操作/秒）——全部由 TIME_THRESHOLDS 推导，勿手工赋值
 */
export const THROUGHPUT_THRESHOLDS = {
  /** setState 最小吞吐量 */
  SET_STATE_MIN: deriveThroughputMin(TIME_THRESHOLDS.SET_STATE_AVG),
  /** dispatch 最小吞吐量 */
  DISPATCH_MIN: deriveThroughputMin(TIME_THRESHOLDS.DISPATCH_AVG),
  /** getter 最小吞吐量 */
  GETTER_MIN: deriveThroughputMin(TIME_THRESHOLDS.GETTER_AVG),
  /** subscribe 最小吞吐量（SUBSCRIBE 场景的校验依据，缺档即该场景无门限可比） */
  SUBSCRIBE_MIN: deriveThroughputMin(TIME_THRESHOLDS.SUBSCRIBE_AVG),
  /** 缓存操作最小吞吐量 */
  CACHE_MIN: deriveThroughputMin(TIME_THRESHOLDS.CACHE_AVG),
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
 *
 * 唯一的读取方是 `ResultBuilder.inferDatasetSize`：它只在结果自己不带 datasetSize 时
 * （createErrorResult / mergeResults）按迭代数兜底推断档位。runner 正常产出的结果直接取
 * `scenario.datasetSize`，不经过这张表，所以「默认跑正好压在 large/xlarge 边界」不成立。
 */
export const DATASET_SIZE_THRESHOLDS = {
  /** 小型数据集最大迭代数 */
  SMALL_MAX: 1000,
  /** 中型数据集最大迭代数 */
  MEDIUM_MAX: 5000,
  /** 大型数据集最大迭代数：边界取闭区间，等于此值仍判 large */
  LARGE_MAX: 10000,
} as const

/**
 * 单次场景最多保留的内存采样条数
 *
 * 先抽成独立常量再喂给 SAMPLING_CONFIG：让常量对象里的箭头函数反过来读自己的宿主，
 * 只是靠「函数体延迟求值」才没出问题，一旦在初始化早期调用、或把 SAMPLING_CONFIG
 * 拆开重排就会拿到 undefined。
 */
const MAX_MEMORY_SAMPLES = 100

/**
 * 内存采样间隔配置
 */
export const SAMPLING_CONFIG = {
  /** 最大采样数量 */
  MAX_SAMPLES: MAX_MEMORY_SAMPLES,
  /** 计算采样间隔 */
  getSampleInterval: (iterations: number): number =>
    Math.max(1, Math.floor(iterations / MAX_MEMORY_SAMPLES)),
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
