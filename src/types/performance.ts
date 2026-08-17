/**
 * GeomStore v1.0 - 性能类型定义
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
  /** 按操作分组统计 */
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
  /** 获取所有指标 */
  getMetrics(): PerformanceMetrics[]
  /** 获取统计信息 */
  getStats(): PerformanceStats
  /** 清除指标 */
  clear(): void
  /** 设置选项 */
  setOptions(options: PerformanceOptions): void
}
