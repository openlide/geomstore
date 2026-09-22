/**
 * @geomstore/benchmark - 常量定义
 */

import { defaultBenchmarkConfig } from './config.js'

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
 * 操作耗时门限的唯一事实源
 *
 * runner 判定读的是 `config.thresholds.operationTime`，本文件这张表从 index.ts 导出、
 * 被外部当成同一件事的参考值。两处各写一份数就会互相矛盾（原先 DISPATCH_AVG 抄成 0.2
 * 而配置里 dispatch 是 0.5、REPLACE_STATE_AVG 抄成 0.3 而配置里 $replaceState 是 1.0），
 * 「查表」与「按配置判定」给出不同结论。故 AVG 档全部取配置值，表里只额外提供配置
 * 没有的 P99 档与缓存档。
 */
const OPERATION_TIME = defaultBenchmarkConfig.thresholds.operationTime

/**
 * 时间阈值配置（毫秒）
 *
 * 组织维度是「操作」，不是「场景」：`SCENARIO_NAMES` 里的 cache-* / *-memory 系列场景
 * 不在此表逐条设阈，它们分别由 CACHE_THRESHOLDS（命中率）、MEMORY_THRESHOLDS
 * （每 Store / 每状态项 / 每订阅 / 每缓存项的字节数）与下面的 CACHE_AVG 覆盖。
 * 每个进入 runner 的操作都必须有 AVG 档，缺档即「该操作没有任何东西可校验」。
 *
 * P99 档写成「AVG × 余量倍数」而非独立字面量：倍数就是各条注释陈述的口径（4/5/10 倍），
 * 写成乘积后配置一改 P99 自动跟走，也不会出现 P99 低于 AVG 这种自相矛盾的数。
 */
export const TIME_THRESHOLDS = {
  /** setState 平均执行时间阈值 */
  SET_STATE_AVG: OPERATION_TIME.setState,
  /** setState P99 执行时间阈值（AVG × 10） */
  SET_STATE_P99: OPERATION_TIME.setState * 10,
  /** $patch 平均执行时间阈值 */
  PATCH_AVG: OPERATION_TIME.$patch,
  /** $patch P99 执行时间阈值（AVG × 4） */
  PATCH_P99: OPERATION_TIME.$patch * 4,
  /** $replaceState 平均执行时间阈值 */
  REPLACE_STATE_AVG: OPERATION_TIME.$replaceState,
  /**
   * $replaceState P99 执行时间阈值（AVG × 3）
   *
   * 整对象替换会重建状态引用并让全部订阅者重算，尾部主要由 GC 决定；
   * 对 AVG 取约 3 倍余量，与 PATCH_P99/PATCH_AVG 的 4 倍同一量级。
   */
  REPLACE_STATE_P99: OPERATION_TIME.$replaceState * 3,
  /** dispatch 平均执行时间阈值 */
  DISPATCH_AVG: OPERATION_TIME.dispatch,
  /** getter 平均执行时间阈值 */
  GETTER_AVG: OPERATION_TIME.getter,
  /**
   * subscribe 平均执行时间阈值
   *
   * 与 `config.thresholds.operationTime.subscribe` 取同一数值：两处描述的是同一个操作，
   * 一份 0.1 一份别的数就会让「按配置判定」和「按常量判定」给出不同结论。
   * 现在这个「同一数值」由赋值本身保证，不再靠注释维持。
   */
  SUBSCRIBE_AVG: OPERATION_TIME.subscribe,
  /**
   * subscribe P99 执行时间阈值（AVG × 5）
   *
   * 登记监听器是 O(1) 数组推入，尾部来自订阅者数组扩容，故余量取 5 倍，
   * 落在 PATCH 的 4 倍与 SET_STATE 的 10 倍之间。
   */
  SUBSCRIBE_P99: OPERATION_TIME.subscribe * 5,
  /**
   * 缓存操作平均执行时间阈值
   *
   * 配置侧没有这一档（`operationTime` 按公开操作分组，缓存读不单列门限），
   * 故本表只有这里是独立的字面量。
   */
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
 * 内存阈值配置（字节）—— 单个实体的绝对占用上限
 *
 * 与 `config.thresholds.memory` **不是同一个量**，故不跟它对齐（耗时那张表是同量重抄、
 * 必须同源，这里是两回事）：配置里的 `perStore` / `perStateItem` / `perSubscriber` 被
 * runner 拿去比 `result.results.memory.delta`，即「这个场景跑下来堆峰值涨了多少」；
 * 本表是「一个 Store 实例 / 一个状态项常驻多少字节」的绝对容量口径，包内没有读取方，
 * 供外部 harness 做常驻内存检查时参考。把两者当成一份数会得出荒谬结论（10KB 常驻不下
 * 一个 xlarge 档 Store）。
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
  // 除数守卫：AVG 档配成 0 时 `1000/0` 是 Infinity、配成负数时是负的有限值，
  // 两者都会静默进入对外导出的门限表（Infinity 意味着该档永不可达），
  // 而不是被发现成配置写错。非有限值同理，一并显式失败
  if (!(avgMs > 0) || !Number.isFinite(avgMs)) {
    throw new RangeError(`平均耗时阈值必须是正的有限值（ms/op），得到 ${avgMs}`)
  }
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
 * 缓存阈值配置 —— 命中率的「及格 / 优秀」评带，不是 runner 的判定门限
 *
 * 与 `config.thresholds.cacheHitRate`（单一 pass 门限，默认 90）是两种用途：本表给外部
 * 读报表的人一个分级参考，runner 判定走配置，缓存类场景另有 `CACHE_SCENARIO_MIN_HIT_RATE`
 * （那类场景刻意把键空间配得比容量大来制造淘汰，按全量门限判必然误报）。
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
 *
 * 包内没有读取方：runner 每轮都采一次快照、不做抽样，这张表是给自行抽样（例如
 * 逐万轮跑一次、想把内存样本数压在几百个内）的外部 harness 用的参考实现。
 */
export const SAMPLING_CONFIG = {
  /** 最大采样数量 */
  MAX_SAMPLES: MAX_MEMORY_SAMPLES,
  /**
   * 计算采样间隔
   *
   * 必须保证 `ceil(iterations / interval) <= MAX_MEMORY_SAMPLES`，即抽样后不超过
   * 上面的上限。取整方向用 `ceil`：`floor` 在 iterations 不足 MAX_MEMORY_SAMPLES 的
   * 两倍时恒为 1（150 轮 → 间隔 1 → 150 个样本 > 100），上限形同虚设。
   */
  getSampleInterval: (iterations: number): number =>
    Math.max(1, Math.ceil(iterations / MAX_MEMORY_SAMPLES)),
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
