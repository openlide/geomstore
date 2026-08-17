/**
 * @geomstore/benchmark - 基准测试类型定义
 */

export type { State, CacheStats, BenchmarkStore, StoreConfig, StoreFactory, ComposeStoreFn } from './store'

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
 */
export interface BenchmarkScenario {
  /** 场景名称 */
  name: string
  /** 描述 */
  description: string
  /** 数据集规模 */
  datasetSize: DatasetSize
  /** 迭代次数 */
  iterations: number
  /** 并发数 */
  concurrency?: number
  /** 是否预热 */
  warmup?: boolean
  /** 预热迭代次数 */
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
    /** 迭代次数 */
    iterations: number
    /** 预热次数 */
    warmupIterations: number
    /** 是否启用预热 */
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
 * 基准测试结果
 */
export interface BenchmarkResult {
  /** 场景名称 */
  scenario: string
  /** 数据集规模 */
  datasetSize: string
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

    /** 缓存性能 */
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

  /** 性能评分（0-100） */
  score?: number

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

  /** 汇总统计 */
  summary: {
    /** 总场景数 */
    totalScenarios: number
    /** 通过场景数 */
    passedScenarios: number
    /** 失败场景数 */
    failedScenarios: number
    /** 平均性能评分 */
    avgScore: number
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
 */
export type OperationType =
  | 'setState'
  | '$patch'
  | '$replaceState'
  | 'dispatch'
  | 'getter'
  | 'subscribe'
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
 * 基准测试工具函数接口
 */
export interface BenchmarkUtils {
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
