/**
 * GeomStore - 性能监控器
 *
 * 提供全面的性能监控功能，包括：
 * - 操作计时
 * - 性能指标记录
 * - 性能统计分析
 * - 阈值预警
 * - 内存使用监控
 * - 数据导出
 *
 */

import type {
  PerformanceMonitor as PerformanceMonitorInterface,
  PerformanceMetrics,
  PerformanceOptions,
  PerformanceStats,
  MetricType,
} from '../../types/performance.js'
import { computePerformanceStats } from './metrics.js'

/**
 * 性能监控器实现类
 *
 * 用于监控Store操作的性能，记录和分析执行时间
 *
 * @class PerformanceMonitor
 * @implements PerformanceMonitor
 *
 * @example
 * ```typescript
 * const monitor = new PerformanceMonitor({
 *   sampleRate: 1.0,       // 100%采样率
 *   threshold: 16,        // 16ms阈值（60fps）
 *   trackMemory: true,    // 跟踪内存使用
 *   maxSize: 1000         // 最多保留1000条记录
 * })
 *
 * // 监控操作
 * const endDispatch = monitor.start('fetchData', 'dispatch')
 * await store.dispatch('fetchData', 'user-123')
 * endDispatch()
 *
 * // 或直接记录
 * monitor.record({
 *   operation: 'setState',
 *   type: 'dispatch',
 *   duration: 5.2,
 *   timestamp: Date.now(),
 *   exceedThreshold: false
 * })
 *
 * // 获取统计信息
 * const stats = monitor.getStats()
 * console.log(`平均耗时: ${stats.avgDuration.toFixed(2)}ms`)
 * console.log(`最大耗时: ${stats.maxDuration.toFixed(2)}ms`)
 * console.log(`超阈值次数: ${stats.thresholdExceeded}`)
 *
 * // 按操作类型筛选
 * const dispatchMetrics = monitor.getMetricsByType('dispatch')
 *
 * // 按操作名称筛选
 * const fetchDataMetrics = monitor.getMetricsByOperation('fetchData')
 *
 * // 导出为JSON
 * const report = monitor.exportJSON()
 * console.log(report)
 * ```
 */
export class PerformanceMonitor implements PerformanceMonitorInterface {
  /**
   * 性能指标数组
   * @private
   * @type {PerformanceMetrics[]}
   */
  private metrics: PerformanceMetrics[] = []

  /**
   * 监控器配置
   * @private
   * @type {Required<PerformanceOptions>}
   */
  private options: Required<PerformanceOptions>

  /**
   * 当前操作计时器
   * @private
   * @type {Map<string, number>}
   */
  private currentOperations: Map<string, number> = new Map()

  /**
   * 操作序号计数器：使 start/end 配对的 key 唯一，
   * 避免同名操作并发/嵌套时 start 时间互相覆盖或残留条目
   * @private
   * @type {number}
   */
  private operationSeq = 0

  /**
   * 创建性能监控器
   *
   * @param {PerformanceOptions} [options={}] - 配置选项
   * @param {number} [options.sampleRate=1.0] - 采样率（0-1），1.0表示100%采样
   * @param {number} [options.threshold=16] - 性能阈值（毫秒），超过此值会触发警告
   * @param {(metrics: PerformanceMetrics) => void} [options.logger] - 自定义日志记录器
   * @param {number} [options.maxSize=1000] - 最大保留指标数量
   * @param {boolean} [options.trackMemory=false] - 是否跟踪内存使用
   *
   * @example
   * ```typescript
   * const monitor = new PerformanceMonitor({
   *   sampleRate: 0.5,    // 只采样50%的操作
   *   threshold: 50,      // 50ms阈值
   *   logger: (metrics) => {
   *     sendToAnalytics(metrics)
   *   }
   * })
   * ```
   */
  constructor(options: PerformanceOptions = {}) {
    this.options = {
      sampleRate: PerformanceMonitor.normalizeSampleRate(options.sampleRate, 1.0),
      threshold: PerformanceMonitor.normalizeThreshold(options.threshold, 16),
      logger: options.logger ?? this.defaultLogger.bind(this),
      maxSize: PerformanceMonitor.normalizeMaxSize(options.maxSize, PerformanceMonitor.DEFAULT_MAX_SIZE),
      trackMemory: options.trackMemory ?? false,
    }
  }

  /** 默认指标容量上限 */
  private static readonly DEFAULT_MAX_SIZE = 1000

  /**
   * 规范化采样率
   *
   * 留存判据是 `Math.random() < sampleRate`（见 record()）：未校验的 NaN 与负值都会让
   * 条件恒假，「采样」静默退化成一条都不留，而调用方以为自己在监控。文档口径是 0-1，
   * 故统一夹到该区间，非有限值回退默认。
   *
   * @private
   */
  private static normalizeSampleRate(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback
    return Math.min(1, Math.max(0, value))
  }

  /**
   * 规范化阈值
   *
   * NaN 阈值会让 `duration > NaN` 恒为 false，超阈值预警静默失效；负值等价于 0
   * （凡有耗时的操作都预警），夹到 0 保持「预警不被关掉」的直觉语义。
   *
   * @private
   */
  private static normalizeThreshold(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback
    return Math.max(0, value)
  }

  /**
   * 规范化容量上限
   *
   * maxSize 直接来自调用方，未校验会让 `while (length > maxSize) shift()`
   * 在负数时于空数组上死循环、NaN 时条件恒 false 使缓冲永不收敛，
   * 故统一收敛为「有限、非负、整数」。
   *
   * @private
   */
  private static normalizeMaxSize(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback
    return Math.max(0, Math.floor(value))
  }

  /**
   * 缓存的 wx 性能实例（undefined＝未探测，null＝探测过且不可用）
   *
   * @private
   */
  private cachedWxPerformance?: { now(): number } | null

  /**
   * 获取高精度时间戳（兼容微信小程序）
   *
   * 契约：**返回值单位恒为毫秒**。全类下游一律按毫秒比较——threshold 默认 16
   * （一帧 16ms 预算）、MAX_OPERATION_AGE_MS 常量名自带 _MS、record 的 timestamp
   * 取 Date.now()、测试 mock 复用 Node performance.now()（同为毫秒）。
   * 若某基础库实测 wx.getPerformance().now() 返回微秒，归一化只能改本函数这一处
   * （除以 1000），下游不得各自换算，否则口径会分散失配。
   *
   * 同一监控器实例只向 wx 取一次性能对象并缓存：start()/end()/pruneStaleOperations()
   * 处于计时热路径，每点都重新读 globalThis + 调工厂既产生额外分配，
   * 更关键的是缓存保证了「整轮计时共用同一实例、同一计时原点」，
   * endTime - startTime 与 MAX_OPERATION_AGE_MS 的差值才不会因原点不同而失真。
   * 缓存按实例而非模块级：多个监控器（含测试）各自独立探测，互不污染。
   *
   * @private
   */
  private _getTimestamp(): number {
    if (this.cachedWxPerformance === undefined) {
      // wx 经 globalThis 读取，避免直接引用未声明的小程序全局标识符
      const wxGlobal = (globalThis as { wx?: { getPerformance?: () => unknown } }).wx
      let resolved: { now(): number } | null = null
      if (wxGlobal && typeof wxGlobal.getPerformance === 'function') {
        try {
          // 部分基础库未声明 now()（甚至返回 undefined），只认「now 为函数」的实例，
          // 缓存下不可用的对象会让后续每次计时都抛 TypeError
          const instance = wxGlobal.getPerformance() as { now?: unknown } | null | undefined
          if (instance && typeof instance.now === 'function') {
            resolved = instance as { now(): number }
          }
        } catch {
          // 工厂本身抛错（旧基础库占位实现）：本次与后续都走 Date.now 兜底
          resolved = null
        }
      }
      this.cachedWxPerformance = resolved
    }

    const perf = this.cachedWxPerformance
    if (perf) {
      const value = perf.now()
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value
      }
      // 读数非有限数（NaN/Infinity）说明该实例不可信：撤下缓存降级到 Date.now，
      // 否则 NaN 会让 duration 恒为 NaN、exceedThreshold 恒 false、预警整体失效。
      this.cachedWxPerformance = null
      // 降级同时切换了时钟基准：currentOperations 里在途的 startTime 来自 wx 时钟
      // （进程相对的小值），与 Date.now()（epoch ms）混算会得到 ~1.7e12 的 duration，
      // 每条都会被记成「超阈值」并永久污染 getStats()/exportJSON()，pruneStaleOperations
      // 也会把所有在途条目判为过期。基准变了就是在途测量作废，宁可留下监控缺口
      // （disposer 走「计时条目缺失」分支告警），也不写入跨基准的脏数据。
      if (this.currentOperations.size > 0) {
        console.debug(`[GeomStore][Performance] 时钟基准降级，${this.currentOperations.size} 条在途计时已作废（不可跨基准比较）`)
        this.currentOperations.clear()
      }
    }

    // 旧基础库（无 wx.getPerformance）与降级路径统一用 Date.now（同为毫秒）
    return Date.now()
  }

  /**
   * 开始计时
   *
   * 开始监控一个操作的性能，返回一个结束计时的函数
   *
   * @param {string} operation - 操作名称
   * @param {MetricType} [type='dispatch'] - 操作类型
   * @returns {() => void} 结束计时的函数
   *
   * @example
   * ```typescript
   * // 监控dispatch操作
   * const endDispatch = monitor.start('fetchUser', 'dispatch')
   * const result = await store.dispatch('fetchUser', 'user-123')
   * endDispatch()
   *
   * // 监控getter操作
   * const endGetter = monitor.start('userInfo', 'getter')
   * const info = store.getter('userInfo')
   * endGetter()
   *
   * // 使用try-finally确保总是结束计时
   * const end = monitor.start('saveData', 'dispatch')
   * try {
   *   return await store.dispatch('saveData', data)
   * } finally {
   *   end()
   * }
   * ```
   */
  start(operation: string, type: MetricType = 'dispatch'): () => void {
    // key 追加自增序号保证唯一：并发/嵌套的同名操作各自独立配对计时
    const key = `${type}:${operation}#${++this.operationSeq}`
    const startTime = this._getTimestamp()

    // 清扫必须落在 start()：只靠 record() 路径的兜底，在「反复 start、从不 end、
    // 也不再 record」的调用方（计时被中途丢弃的场景）下永不触发，条目随调用无限累积。
    // 放在 set 之前，本轮新建的条目不会被自己扫掉；复用刚取到的 startTime 作为「现在」，
    // 省去一次时钟读取，也保证与条目同一基准
    this.pruneStaleOperations(startTime)

    this.currentOperations.set(key, startTime)

    return () => {
      const endTime = this._getTimestamp()
      const recordedStartTime = this.currentOperations.get(key)

      if (recordedStartTime !== undefined) {
        const duration = endTime - recordedStartTime
        this.record({
          operation,
          type,
          duration,
          timestamp: Date.now(),
          exceedThreshold: duration > this.options.threshold,
        })

        this.currentOperations.delete(key)
      } else {
        // 条目已被 pruneStaleOperations()/clear() 摘除，或同一 disposer 被调用了两次：
        // 这条测量会无声消失，调用方无从解释监控数据的缺口。降级为可观测但不抛出
        console.debug(`[GeomStore][Performance] 计时条目缺失，${type}:${operation} 本次未记录（可能被清理或 end() 重复调用）`)
      }
    }
  }

  /**
   * 记录指标
   *
   * 直接记录一个性能指标。入参对象**不会被留存**：缓冲区与 logger 拿到的都是它的副本，
   * 调用方复用/改写该对象不会篡改已记录的历史指标。
   *
   * @param {PerformanceMetrics} metrics - 性能指标
   *
   * @example
   * ```typescript
   * monitor.record({
   *   operation: 'fetchUser',
   *   type: 'dispatch',
   *   duration: 42.5,
   *   timestamp: Date.now(),
   *   exceedThreshold: true
   * })
   * ```
   */
  record(metrics: PerformanceMetrics): void {
    // 顺手清理超时未结束的计时条目：调用方缺 try/finally 时 end() 永不执行，
    // currentOperations 会随错误次数无限增长。
    // 必须置于采样判断之前——清理是监控器自身的内存维护，与「本条指标是否被采样」
    // 无关；放在采样之后会让 sampleRate 很低（尤其为 0）时清理永不执行，泄漏照旧
    this.pruneStaleOperations(this._getTimestamp())

    // 采样只决定是否**留存**这条指标；阈值预警不受采样影响（见下方 logger 调用）
    // 严格小于：Math.random() ∈ [0,1)，sampleRate=0 时 `<= 0` 仍会在随机数恰好为 0
    // 的那一次留存指标，而 0 的契约是「一条都不留」；sampleRate=1 时 `< 1` 恒真，
    // 100% 采样的口径不变
    const sampled = Math.random() < this.options.sampleRate

    // 内存信息写在副本上：写入副本而非调用方传入的对象，避免副作用泄漏到调用方
    // （复用/比较该对象的代码受影响）。副本是**无条件**的——若只在 trackMemory 生效时
    // 才复制，缓冲区与 logger 在其余场合仍持有调用方对象引用，调用方后续改动会改写
    // 历史指标，getMetrics()/getMetricsByType() 的元素复制就白做了
    // 局部变量刻意不叫 record：与方法名 record() 同名会遮住方法、读起来像自递归
    const metricRecord: PerformanceMetrics = { ...metrics }
    if (this.options.trackMemory) {
      try {
        // 经 globalThis 读取：与 _getTimestamp 读 wx 同一口径。裸 `performance` 标识符在
        // 没有该全局的基础库里抛 ReferenceError，被下面的 catch 吞掉后 trackMemory
        // 静默失效且无从分辨；globalThis 取值只会得到 undefined
        const perf = (globalThis as { performance?: { memory?: { usedJSHeapSize?: number } } }).performance
        const memory = perf?.memory
        if (memory && memory.usedJSHeapSize !== undefined) {
          metricRecord.memoryUsage = memory.usedJSHeapSize
        }
      } catch {
        // memory 取值本身可能抛错（宿主对象的 getter）：内存监控是可选项，不影响计时
      }
    }

    // 记录指标
    if (sampled) {
      this.metrics.push(metricRecord)

      // 限制数量：一次性 splice 裁剪（容量已由构造器/setOptions 规范化，
      // 这里不再需要 while+shift 逐步收敛）
      this.trimToMaxSize()
    }

    // 日志记录：threshold 的契约是「超过此值会触发警告」，若与采样同生灭，
    // sampleRate<1 时超阈值操作只有被抽到的才预警、sampleRate=0 时预警整体失效——
    // 而预警正是低采样场景下唯一还该保留的信号。
    // 传副本 metricRecord 而非入参 metrics：logger 看到的与缓冲区留存的是同一份内容，
    // 否则启用内存监控时 logger 永远看不到 memoryUsage
    if (metricRecord.exceedThreshold) {
      this.options.logger(metricRecord)
    }
  }

  /**
   * 超出容量上限时淘汰最旧条目
   *
   * @private
   */
  private trimToMaxSize(): void {
    const overflow = this.metrics.length - this.options.maxSize
    if (overflow > 0) {
      this.metrics.splice(0, overflow)
    }
  }

  /**
   * 获取所有指标
   *
   * 返回所有已记录的性能指标
   *
   * @returns {PerformanceMetrics[]} 性能指标数组的副本
   *
   * @example
   * ```typescript
   * const allMetrics = monitor.getMetrics()
   * console.log(`Total metrics: ${allMetrics.length}`)
   *
   * // 计算平均耗时
   * const avgDuration = allMetrics.reduce((sum, m) => sum + m.duration, 0) / allMetrics.length
   * console.log(`Average duration: ${avgDuration.toFixed(2)}ms`)
   * ```
   */
  getMetrics(): PerformanceMetrics[] {
    // 元素逐个复制：数组浅拷贝仍指向内部同一批指标对象，
    // 调用方改 m.duration 会污染内部数据与后续 getStats()/exportJSON()
    return this.metrics.map((m) => ({ ...m }))
  }

  /** 清理超时未结束的计时条目（调用方遗漏 end() 时的兜底，防止 Map 无限增长） */
  private pruneStaleOperations(now: number): void {
    if (this.currentOperations.size === 0) return
    // now 必须由调用方传入本轮 _getTimestamp() 的读数：条目按该时钟基准写入，
    // 与 Date.now 混用会把新条目误判为超时（performance.now 是进程相对的小值）
    for (const [key, startTime] of this.currentOperations) {
      if (now - startTime > PerformanceMonitor.MAX_OPERATION_AGE_MS) {
        this.currentOperations.delete(key)
      }
    }
  }

  /** 计时条目的最大保留时长：超过视为调用方遗漏 end() 的泄漏条目 */
  private static readonly MAX_OPERATION_AGE_MS = 10 * 60 * 1000

  /**
   * 获取统计信息
   *
   * 计算并返回性能统计信息
   *
   * @returns {PerformanceStats} 性能统计对象
   *
   * @example
   * ```typescript
   * const stats = monitor.getStats()
   * console.log(`平均耗时: ${stats.avgDuration.toFixed(2)}ms`)
   * console.log(`最大耗时: ${stats.maxDuration.toFixed(2)}ms`)
   * console.log(`最小耗时: ${stats.minDuration.toFixed(2)}ms`)
   * console.log(`总次数: ${stats.totalCount}`)
   * console.log(`超阈值次数: ${stats.thresholdExceeded}`)
   *
   * // 按操作查看统计
   * for (const [operation, opStats] of Object.entries(stats.byOperation)) {
   *   console.log(`${operation}:`)
   *   console.log(`  执行次数: ${opStats.count}`)
   *   console.log(`  平均耗时: ${opStats.avgDuration.toFixed(2)}ms`)
   *   console.log(`  最大耗时: ${opStats.maxDuration.toFixed(2)}ms`)
   * }
   * ```
   */
  getStats(): PerformanceStats {
    return computePerformanceStats(this.metrics)
  }

  /**
   * 清除所有指标
   *
   * 清空所有已记录的性能指标
   *
   * @example
   * ```typescript
   * // 在开始新的测试前清除之前的指标
   * monitor.clear()
   *
   * // 运行测试
   * // ...
   *
   * // 获取新的统计
   * const stats = monitor.getStats()
   * ```
   */
  clear(): void {
    this.metrics = []
    this.currentOperations.clear()
  }

  /**
   * 设置配置选项
   *
   * 更新监控器的配置选项
   *
   * @param {PerformanceOptions} options - 新的配置选项
   *
   * @example
   * ```typescript
   * // 调整采样率
   * monitor.setOptions({ sampleRate: 0.5 })
   *
   * // 调整阈值
   * monitor.setOptions({ threshold: 50 })
   *
   * // 启用内存监控
   * monitor.setOptions({ trackMemory: true })
   * ```
   */
  setOptions(options: PerformanceOptions): void {
    Object.assign(this.options, {
      sampleRate: PerformanceMonitor.normalizeSampleRate(options.sampleRate, this.options.sampleRate),
      threshold: PerformanceMonitor.normalizeThreshold(options.threshold, this.options.threshold),
      logger: options.logger ?? this.options.logger,
      maxSize: PerformanceMonitor.normalizeMaxSize(options.maxSize, this.options.maxSize),
      trackMemory: options.trackMemory ?? this.options.trackMemory,
    })
    // 缩小容量时立即裁剪：仅靠 record 路径的逐条淘汰，缓冲区会长期保留
    // 超过新上限的旧记录（每次写入只挤掉一条，长度停在旧上限）
    this.trimToMaxSize()
  }

  /**
   * 默认日志记录器
   *
   * @private
   * @param {PerformanceMetrics} metrics - 性能指标
   */
  private defaultLogger(metrics: PerformanceMetrics): void {
    console.warn(`[GeomStore][Performance] ${metrics.operation} took ${metrics.duration.toFixed(2)}ms ` + `(threshold: ${this.options.threshold}ms)`)
  }

  /**
   * 按类型筛选指标
   *
   * 获取指定类型的所有性能指标
   *
   * @param {MetricType} type - 指标类型（'dispatch'、'getter'、'state-update'等）
   * @returns {PerformanceMetrics[]} 匹配的性能指标数组
   *
   * @example
   * ```typescript
   * // 获取所有dispatch操作的指标
   * const dispatchMetrics = monitor.getMetricsByType('dispatch')
   *
   * // 计算dispatch的平均耗时
   * const avgDispatchDuration = dispatchMetrics.reduce((sum, m) => sum + m.duration, 0) / dispatchMetrics.length
   * console.log(`Average dispatch duration: ${avgDispatchDuration.toFixed(2)}ms`)
   *
   * // 获取所有getter操作的指标
   * const getterMetrics = monitor.getMetricsByType('getter')
   * ```
   */
  getMetricsByType(type: MetricType): PerformanceMetrics[] {
    // 元素副本：filter 只复制数组外壳，返回原对象会让调用方改写内部指标
    return this.metrics.filter((m) => m.type === type).map((m) => ({ ...m }))
  }

  /**
   * 按操作筛选指标
   *
   * 获取指定操作名称的所有性能指标
   *
   * @param {string} operation - 操作名称
   * @returns {PerformanceMetrics[]} 匹配的性能指标数组
   *
   * @example
   * ```typescript
   * // 获取fetchUser操作的所有指标
   * const fetchUserMetrics = monitor.getMetricsByOperation('fetchUser')
   *
   * // 分析特定操作的性能趋势
   * const durations = fetchUserMetrics.map(m => m.duration)
   * const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length
   * const max = Math.max(...durations)
   * const min = Math.min(...durations)
   *
   * console.log(`fetchUser performance:`)
   * console.log(`  Average: ${avg.toFixed(2)}ms`)
   * console.log(`  Max: ${max.toFixed(2)}ms`)
   * console.log(`  Min: ${min.toFixed(2)}ms`)
   * ```
   */
  getMetricsByOperation(operation: string): PerformanceMetrics[] {
    // 元素副本：filter 只复制数组外壳，返回原对象会让调用方改写内部指标
    return this.metrics.filter((m) => m.operation === operation).map((m) => ({ ...m }))
  }

  /**
   * 获取最近的指标
   *
   * 获取最近N条性能指标
   *
   * @param {number} [count=10] - 要获取的指标数量
   * @returns {PerformanceMetrics[]} 最近的性能指标数组
   *
   * @example
   * ```typescript
   * // 获取最近10条指标
   * const recentMetrics = monitor.getRecentMetrics(10)
   *
   * // 查看最近的性能趋势
   * recentMetrics.forEach((metric, index) => {
   *   console.log(`${index + 1}. ${metric.operation}: ${metric.duration.toFixed(2)}ms`)
   * })
   * ```
   */
  getRecentMetrics(count: number = 10): PerformanceMetrics[] {
    // 先取整再判空：Math.floor(0.5) === 0 而 slice(-0) === slice(0)，
    // (0,1) 之间的小数会让「最近 0.5 条」返回全部指标
    const n = Math.floor(count)
    if (!Number.isFinite(count) || n <= 0) {
      return []
    }
    return this.metrics.slice(-n).map((m) => ({ ...m }))
  }

  /**
   * 导出为JSON
   *
   * 将所有指标和统计信息导出为JSON字符串。
   *
   * @remarks `options` 段刻意不含 `logger`：它是函数，JSON.stringify 会静默丢键，
   * 与其让报告形状「恰好」少一个字段，不如显式给出可序列化的那部分——
   * 消费方据此知道报告里的 options 是配置的投影，而非构造入参的完整回放。
   *
   * @returns {string} JSON字符串，含 `metrics`（指标快照）、`stats`、`options`（不含 logger）
   *
   * @example
   * ```typescript
   * // 导出性能报告
   * const report = monitor.exportJSON()
   *
   * // 保存到文件
   * fs.writeFileSync('performance-report.json', report)
   *
   * // 发送到服务器
   * await fetch('/api/performance', {
   *   method: 'POST',
   *   body: report,
   *   headers: { 'Content-Type': 'application/json' }
   * })
   * ```
   */
  exportJSON(): string {
    const { logger: _logger, ...reportOptions } = this.options

    return JSON.stringify(
      {
        // 与 getMetrics()/getStats() 同源：直接序列化内部数组虽然不被 JSON.stringify 改写，
        // 但会让导出口径依赖「序列化不写回」这一实现细节
        metrics: this.getMetrics(),
        stats: this.getStats(),
        options: reportOptions,
      },
      null,
      2,
    )
  }
}

/**
 * 默认导出
 */
export type { PerformanceMetrics, PerformanceOptions, PerformanceStats, MetricType } from '../../types/performance.js'
