/**
 * GeomStore - 性能类型定义
 */

/**
 * 性能指标类型
 */
export type MetricType = 'setState' | 'patch' | 'replaceState' | 'dispatch' | 'getter' | 'notify' | 'subscribe' | 'plugin' | 'state-update'

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  /** 操作名称 */
  operation: string
  /** 操作类型 */
  type: MetricType
  /** 执行时长（毫秒） */
  duration: number
  /** 时间戳 */
  timestamp: number
  /** 负载大小（字节） */
  payloadSize?: number
  /** 内存使用（字节） */
  memoryUsage?: number
  /** 是否超过阈值 */
  exceedThreshold?: boolean
}

/**
 * 性能选项
 */
export interface PerformanceOptions {
  /** 采样率（0-1） */
  sampleRate?: number
  /** 超过阈值（毫秒）记录 */
  threshold?: number
  /** 自定义日志记录器 */
  logger?: (metrics: PerformanceMetrics) => void
  /** 最大记录数量 */
  maxSize?: number
  /** 是否启用内存监控 */
  trackMemory?: boolean
}

/**
 * 性能统计
 */
export interface PerformanceStats {
  /** 平均执行时间 */
  avgDuration: number
  /** 最大执行时间 */
  maxDuration: number
  /** 最小执行时间 */
  minDuration: number
  /** 总调用次数 */
  totalCount: number
  /** 超过阈值次数 */
  thresholdExceeded: number
  /**
   * 按操作分组统计
   *
   * 与顶层的口径差异是刻意的：这里只保留「便宜且够用」的三项（次数 / 平均 / 最大）。
   * 顶层的 `minDuration` 需要一个按操作累加的极值，`thresholdExceeded` 需要把
   * `exceedThreshold` 一并下钻到分组（阈值是全局配置，分组级计数在调阈值后还得重算），
   * 二者都要改 `src/core/performance/metrics.ts` 的 `computePerformanceStats` 累加器，
   * 只在类型上补字段会让契约声明出运行时不存在的成员（实测 TS2322 顶在
   * `Object.fromEntries(byOperation)` 那一行）。
   *
   * 键数量不是无界的：分组由 `metrics` 数组派生，而该数组按 `PerformanceOptions.maxSize`
   * （默认 1000）溢出即 shift，故不同操作名最多累积 maxSize 项。
   */
  byOperation: Record<
    string,
    {
      count: number
      avgDuration: number
      maxDuration: number
    }
  >
}

/**
 * 性能监控器接口
 */
export interface PerformanceMonitor {
  /** 开始计时 */
  start(operation: string, type?: MetricType): () => void
  /** 记录指标 */
  record(metrics: PerformanceMetrics): void
  /**
   * 获取所有指标
   *
   * 契约：返回**快照**——实现不得把内部指标数组（或其切片）直接交出去，调用方拿到后可自由
   * 排序/过滤而不污染后续 `getStats()`。`PerformanceMonitor.getMetrics` 目前是逐元素复制
   * （浅拷贝数组仍共享元素，改 `m.duration` 会写脏内部数据）；`MetricsCollector.getAll` 只复制
   * 数组、元素仍为原引用，属已知差异。
   *
   * 返回类型刻意保持可变数组：本接口并未随包发布（`core/performance/index.ts` 只导出
   * `PerformanceMetrics/Options/Stats/MetricType` 与本模块的实现类），公开面是那个类的方法签名，
   * 只把这里改成 `readonly` 消费者一点也收不到，反而与类签名分叉。
   */
  getMetrics(): PerformanceMetrics[]
  /** 获取统计信息 */
  getStats(): PerformanceStats
  /** 清除指标 */
  clear(): void
  /** 设置选项 */
  setOptions(options: PerformanceOptions): void
}
