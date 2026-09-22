/**
 * @geomstore/benchmark - 基准测试类型定义
 */

export type {
  State,
  CacheStats,
  StoreAction,
  ActionMap,
  BenchmarkStore,
  StoreConfig,
  StoreFactory,
  ComposeStoreFn,
} from './store.js'

/**
 * 数据集规模
 */
export type DatasetSize = 'small' | 'medium' | 'large' | 'xlarge'

/**
 * 缓存测试配置
 */
export interface CacheTestConfig {
  /** 缓存容量（小于状态键数量时会产生淘汰） */
  capacity?: number
  /** 缓存TTL（毫秒） */
  ttl?: number
  /** 访问键空间倍数（相对于缓存容量的比例，>1 会产生未命中） */
  keySpaceMultiplier?: number
  /** 读写比例（读:写，如 0.8 表示 80% 读 20% 写） */
  readWriteRatio?: number
}

/**
 * 基准测试场景
 *
 * 迭代与预热参数只在场景这一层定义、也只在场景这一层生效：`general` 里的
 * `enableWarmup`/`warmupIterations` 管的是整轮运行开始前那次统一预热（把 JIT 跑热），
 * 与场景内的 `warmup`/`warmupIterations` 是两件事，彼此不继承、不覆盖。
 */
export interface BenchmarkScenario {
  /** 场景名称 */
  name: string
  /** 描述 */
  description: string
  /** 数据集规模 */
  datasetSize: DatasetSize
  /** 迭代次数（本场景独占，不从 general 回落） */
  iterations: number
  /** 并发数 */
  concurrency?: number
  /** 是否在本场景正式计数前额外预热一轮 */
  warmup?: boolean
  /** 本场景的预热迭代次数（`warmup` 为假时不参与任何计算） */
  warmupIterations?: number
  /** 缓存测试配置 */
  cacheConfig?: CacheTestConfig
}

/**
 * 基准测试配置
 */
export interface BenchmarkConfig {
  /** 总体配置 */
  general: {
    /**
     * 整轮运行开始前的统一预热次数
     *
     * 这里有意不放 iterations：迭代次数只由场景自己决定，留一个没有任何读取方的
     * 同名默认值只会让人以为场景可以省略它而回落。
     */
    warmupIterations: number
    /** 是否执行上面的统一预热 */
    enableWarmup: boolean
    /** 是否跳过 GC（如果可用） */
    skipGC?: boolean
  }

  /** 数据集配置 */
  datasets: {
    [key in DatasetSize]: {
      /** 状态键数量 */
      stateKeys: number
      /** Action 数量 */
      actions: number
      /** Getter 数量 */
      getters: number
      /** 订阅者数量 */
      subscribers: number
      /** 嵌套深度 */
      nestingDepth?: number
    }
  }

  /** 阈值配置 */
  thresholds: {
    /** 操作执行时间阈值（毫秒） */
    operationTime: {
      setState: number
      $patch: number
      $replaceState: number
      dispatch: number
      getter: number
      subscribe: number
    }

    /** 内存使用阈值（字节） */
    memory: {
      /** 单个 Store */
      perStore: number
      /** 每个状态项 */
      perStateItem: number
      /** 每个订阅 */
      perSubscriber: number
    }

    /** 吞吐量阈值（操作/秒） */
    throughput: {
      setState: number
      dispatch: number
      getter: number
    }

    /** 缓存命中率阈值（百分比） */
    cacheHitRate: number
  }

  /** 测试场景 */
  scenarios: BenchmarkScenario[]
}

/**
 * 逐层可选版本
 *
 * 数组分支按「整体替换」处理：`mergeConfig` 对 scenarios 就是整组覆盖语义，
 * 把元素也变可选只会让 `{ name?: string }` 这种半截场景通过编译、到运行时炸。
 */
export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

/**
 * 配置覆盖入参（`mergeConfig` 的第二参、`BenchmarkRunner` 构造函数的 config）
 *
 * 原先声明成 `Partial<BenchmarkConfig>`：那是浅 Partial，`general` / `datasets` /
 * `thresholds` 一旦给出就必须整组配齐，而 `mergeConfig` 做的是逐档位、逐分组的深合并。
 * 类型与运行时语义不一致时，`{ general: { warmupIterations: 5 } }` 这种合法写法直接被拒，
 * 调用方只好把默认值整份抄一遍——抄来的默认值就是下一轮漂移的来源。
 */
export type BenchmarkConfigOverride = DeepPartial<BenchmarkConfig>

/**
 * 基准测试结果
 */
export interface BenchmarkResult {
  /** 场景名称 */
  scenario: string
  /**
   * 数据集规模
   *
   * 必须是 DatasetSize：产出方（`scenario.datasetSize` 与 `ResultBuilder.inferDatasetSize`）
   * 给出的都是这个联合类型，写成 string 等于允许把报告里的规模名漂成 `datasets` 查不到的键。
   */
  datasetSize: DatasetSize
  /** 迭代次数 */
  iterations: number
  /** 执行结果 */
  results: {
    /** 操作执行时间 */
    executionTime: {
      /** 总耗时（毫秒） */
      total: number
      /** 平均耗时（毫秒） */
      avg: number
      /** 最小耗时（毫秒） */
      min: number
      /** 最大耗时（毫秒） */
      max: number
      /** 中位数耗时（毫秒） */
      median: number
      /** P95 耗时（毫秒） */
      p95: number
      /** P99 耗时（毫秒） */
      p99: number
      /** 标准差（毫秒） */
      stdDev: number
    }

    /** 内存使用 */
    memory: {
      /** 初始内存（字节） */
      initial: number
      /** 峰值内存（字节） */
      peak: number
      /** 结束内存（字节） */
      final: number
      /** 内存增量（字节） */
      delta: number
      /** 平均内存（字节） */
      avg: number
    }

    /** 吞吐量 */
    throughput: {
      /** 操作/秒 */
      opsPerSecond: number
      /** 峰值瞬时速率（1ms 滑动窗口，操作/秒） */
      peakInstantRate: number
    }

    /**
     * 缓存性能
     *
     * `hitRate` / `missRate` 是派生值，不是独立的第二个真相源：包内唯一产出这一段的三处
     * （`helpers.buildCacheResult`、`helpers.emptyCacheResult`、`ResultBuilder.mergeCacheStats`）
     * 都从 `hits` / `misses` 现算，恒有 `hits + misses === totalAccesses` 与
     * `hitRate + missRate === 100`（零访问时两者均为 0）。上游 `CacheStats` 压根没有比率入口，
     * 适配方无法注入与计数器矛盾的比率；自行拼装 BenchmarkResult 的 harness 必须走
     * `buildCacheResult`，不要手写这两个字段。
     *
     * `evictions` 有意保持可选（与 `BenchmarkStore.getCacheStats` 同一口径）：只有带淘汰
     * 策略的实现统计它，「未统计」与「0 次淘汰」是两回事，必填会逼实现方伪造 0，
     * `mergeCacheStats` 也就无法再区分二者（它按「任一参与方带值才求和」保留 undefined）。
     */
    cache: {
      /** 启用缓存 */
      enabled: boolean
      /** 总访问次数 */
      totalAccesses: number
      /** 缓存命中次数 */
      hits: number
      /** 缓存未命中次数 */
      misses: number
      /** 缓存命中率（百分比） */
      hitRate: number
      /** 缓存未命中率（百分比） */
      missRate: number
      /** 缓存淘汰次数 */
      evictions?: number
    }
  }

  /** 是否通过阈值检查 */
  passed: boolean

  /** 警告信息 */
  warnings?: string[]

  /** 错误信息 */
  errors?: string[]
}

/**
 * 内存快照
 */
export interface MemorySnapshot {
  /** 时间戳 */
  timestamp: number
  /** 堆总大小（字节） */
  heapTotal: number
  /** 已使用堆大小（字节） */
  heapUsed: number
  /** 堆限制（字节） */
  heapLimit: number
  /** 外部内存（字节） */
  external: number
}

/**
 * 性能指标快照
 */
export interface PerformanceSnapshot {
  /** 时间戳 */
  timestamp: number
  /** 内存快照 */
  memory: MemorySnapshot
  /** 操作计数 */
  operationCount: number
}

/**
 * 基准测试报告
 */
export interface BenchmarkReport {
  /** 报告元数据 */
  metadata: {
    /** 报告 ID */
    id: string
    /** 生成时间 */
    timestamp: string
    /** 版本 */
    version: string
    /** Node.js 版本 */
    nodeVersion: string
    /** 平台 */
    platform: string
    /** CPU 信息 */
    cpu: {
      model: string
      cores: number
      speed: number
    }
    /** 总内存（字节） */
    totalMemory: number
  }

  /** 配置 */
  config: BenchmarkConfig

  /** 结果 */
  results: BenchmarkResult[]

  /**
   * 汇总统计
   *
   * 没有「平均性能评分」这类字段：包内没有任何评分口径，所有产出点也不会给 score 赋值，
   * 留着只会在 JSON 报告里恒显 0。要加回来先定义归一化口径。
   */
  summary: {
    /** 总场景数 */
    totalScenarios: number
    /** 通过场景数 */
    passedScenarios: number
    /** 失败场景数 */
    failedScenarios: number
    /** 总执行时间（秒） */
    totalDuration: number
    /** 总内存增量（字节） */
    totalMemoryUsage: number
  }

  /** 建议 */
  recommendations: string[]
}

/**
 * 操作类型
 *
 * 与耗时阈值共用同一份名字来源：前六个成员直接取 `thresholds.operationTime` 的键，
 * 增删或改名一处不会再悄悄脱钩（阈值表对不上操作名时编译期就报错）。其余成员是
 * 生命周期/缓存类操作，本就没有耗时阈值，只能显式列出。
 */
export type OperationType =
  | keyof BenchmarkConfig['thresholds']['operationTime']
  | 'unsubscribe'
  | 'compose'
  | 'cacheGet'
  | 'cacheSet'
  | 'cacheInvalidate'

/**
 * 操作执行上下文
 */
export interface OperationContext {
  /** 操作类型 */
  type: OperationType
  /** 操作名称 */
  name: string
  /** 开始时间 */
  startTime: number
  /** 结束时间 */
  endTime: number
  /** 执行耗时（毫秒） */
  duration: number
  /** 成功标志 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** 内存使用（字节） */
  memoryUsage?: number
}

/**
 * 单轮迭代的产出
 *
 * 带着 error 而不是让某一轮抛错就把整次运行作废：基准测试要回答的正是「第几轮开始崩、
 * 崩之前的分布长什么样」，让一次失败连带丢掉已测量的所有轮次等于把答案扔掉再报错。
 * 失败轮的 duration 是「调用到抛出」的耗时，参与统计会偏小，需要统计时先过滤 error。
 */
export interface IterationOutcome<T> {
  /** 本轮返回值；本轮失败时为 undefined */
  result: T | undefined
  /** 本轮耗时（毫秒） */
  duration: number
  /** 本轮的失败原因，成功时不存在 */
  error?: string
}

/**
 * 基准测试工具函数接口
 *
 * 名字带 `Contract` 而不叫 `BenchmarkUtils`：入口 barrel 既 `export { BenchmarkUtils } from './utils.js'`
 * （类，同时占住值与类型两个含义）又 `export type * from './types/index.js'`，而显式导出优先级高于
 * 星号导出——旧名下这份接口在包外永远取不到（`import type { BenchmarkUtils }` 拿到的是类实例类型），
 * 且编译器对这种遮蔽一声不吭。改名后两个都可达，`BenchmarkUtils` 一名一义。
 *
 * 这里是「runner 实际用到的最小契约」，类可以比它多成员；把它当接口依赖的调用方不应
 * 假设能拿到 `calculateTimeStats` / `repeat` 这类实现侧扩展。
 */
export interface BenchmarkUtilsContract {
  /** 测量执行时间 */
  measureTime<T>(fn: () => T): { result: T; duration: number }

  /** 测量内存使用 */
  measureMemory<T>(fn: () => T): { result: T; memoryBefore: number; memoryAfter: number }

  /** 生成测试数据 */
  generateTestData(size: number): unknown

  /** 计算百分位数 */
  calculatePercentile(values: number[], percentile: number): number

  /** 计算中位数 */
  calculateMedian(values: number[]): number

  /** 计算标准差 */
  calculateStandardDeviation(values: number[], avg: number): number

  /** 强制垃圾回收（如果可用） */
  forceGC(): boolean

  /** 获取内存快照 */
  getMemorySnapshot(): MemorySnapshot

  /** 格式化字节大小 */
  formatBytes(bytes: number): string

  /** 格式化时间 */
  formatTime(ms: number): string

  /** 格式化数字 */
  formatNumber(num: number): string
}
