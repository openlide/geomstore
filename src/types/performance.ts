/**
 * GeomStore - 性能类型定义
 */

/**
 * 性能指标类型
 *
 * 这份联合比内置插桩实际产出的标签更宽，按「谁会写它」分两组
 * （产标签的唯一内置路径是 `src/plugins/performance/analyzerPlugin.ts` 里的 `monitor.start(...)`）：
 *
 * - 内置插桩产出：`'setState'`、`'patch'`、`'replaceState'`、`'dispatch'`、`'getter'`。
 *   接内置监控器时，`getMetricsByType(type)` 只在这五个键上能看到真实流量。
 * - 内置插桩**不**产出，留给自定义上报：`'notify'`、`'subscribe'`、`'plugin'`、`'state-update'`。
 *   `PerformanceMonitor.record` 是公开入口，消费者可自行按这些维度写入并据此过滤；
 *   类型不收窄正是为了放行这种自定义标签，别把它们当成内置一定会给的东西。
 *
 * `'state-update'` 与 `'setState'` 不是同一个桶，别混用：前者是「一次状态更新」的逻辑分类
 * （与 `src/types/error.ts` 的 `OperationType` 同名成员同一口径），后者是 `setState()`
 * 这次调用的计时。按类型统计时它们是两个独立分组，内置路径只会写后者。
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
 *
 * 数值域刻意不在类型上收窄（品牌类型/区间类型会把公开签名变成会报错的形状），
 * 因此**归一化是实现层的义务**：越界值不会编译报错、也不会抛错，只会静默降级。
 * 内置 `PerformanceMonitor` 在构造与 `setOptions` 两处都按下面的口径夹过
 * （见 `src/core/performance/PerformanceMonitor.ts` 的三个 `normalize*`），
 * `MetricsCollector` 的环形缓冲也按同一口径规范化 `maxSize`；自定义实现若不做归一，
 * 表现如各条注释所述。
 */
export interface PerformanceOptions {
  /**
   * 采样率（0-1）
   *
   * 未夹取值时 > 1 等于全采样、负数与 `NaN` 让留存判据 `Math.random() < sampleRate` 恒假
   * （一条都不留，而调用方以为自己在监控）。内置实现夹到 `[0, 1]`，非有限值回退默认 1。
   */
  sampleRate?: number
  /**
   * 超过阈值（毫秒）记录
   *
   * `NaN` 会让 `duration > threshold` 恒假、预警静默失效；负值等价于 0。内置实现夹到 `>= 0`。
   */
  threshold?: number
  /** 自定义日志记录器 */
  logger?: (metrics: PerformanceMetrics) => void
  /**
   * 最大记录数量
   *
   * 环形缓冲按整数下标运算：小数/负数会取到空洞下标（静默丢数据或无界增长）。
   * 内置实现归一为「有限、非负、整数」，非有限值回退默认（监控器 1000 / 采集器 10000）。
   */
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
   * 契约一句话：**交出去的是独立副本**——数组是新的，元素也是新的（`{ ...metric }`），
   * 调用方排序、过滤、改写返回对象（含 `m.duration`）都不会写脏内部数据，
   * 后续 `getStats()` 仍看到原样。实现若只复制数组而共享元素，就不满足本契约。
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
