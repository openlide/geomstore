# `./extras/performance` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.7.0`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`./extras/performance`
> - 类型声明：`./dist/extras/performance.d.ts`
> - 返回索引：[`index.md`](./index.md)

### `MetricType`

```ts
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
export type MetricType = 'setState' | 'patch' | 'replaceState' | 'dispatch' | 'getter' | 'notify' | 'subscribe' | 'plugin' | 'state-update';
```

### `MetricsCollector`

```ts
/**
 * 性能指标采集器
 *
 * 用于收集和管理性能指标数据。
 */
export declare class MetricsCollector {
    /** 默认指标容量上限：超出后淘汰最旧条目，防止长生命周期采集无限增长 */
    static readonly DEFAULT_MAX_SIZE = 10000;
    /**
     * 环形缓冲：定长数组 + 最旧元素游标 + 有效长度。
     *
     * 取代「push + 满员后 splice(0, 1)」：满员后每条指标都要前移整个 10000 元素数组
     * （O(n)），而采集器正处在被监控操作的热路径上。环形写入是 O(1)。
     */
    private buffer;
    /** 最旧元素下标（缓冲未满时恒为 0） */
    private oldest;
    /** 有效条目数 */
    private _count;
    /** 容量上限 */
    private readonly _maxSize;
    /**
     * @param maxSize - 容量上限（默认 10000，超出后淘汰最旧条目）
     */
    constructor(maxSize?: number);
    /**
     * 收集指标
     *
     * 添加单个性能指标到采集器。
     *
     * @param {PerformanceMetrics} metric - 单条性能指标（形参名与私有字段 `metrics` 区分，
     *   复数命名会让调用方误以为可传数组）
     */
    collect(metric: PerformanceMetrics): void;
    /**
     * 批量收集指标
     *
     * 一次性添加多个性能指标。
     *
     * @param {PerformanceMetrics[]} metricsList - 性能指标数组
     */
    collectBatch(metricsList: PerformanceMetrics[]): void;
    /**
     * 按写入顺序展开环形缓冲
     *
     * 读取路径统一走此方法，调用方拿不到内部数组，
     * 也就无法通过原地改写缓冲数组绕过容量约束
     *
     * @private
     */
    private _ordered;
    /**
     * 获取所有指标
     *
     * 返回所有已收集性能指标的副本。
     *
     * @returns {PerformanceMetrics[]} 指标数组副本
     */
    getAll(): PerformanceMetrics[];
    /** 清空所有指标 */
    clear(): void;
    /**
     * 获取指标数量
     *
     * @returns {number} 已收集的指标数量
     */
    count(): number;
    /**
     * 计算统计信息
     *
     * 计算平均/最大/最小耗时、总次数、超阈值次数，并按操作分组统计。
     *
     * @returns {PerformanceStats} 性能统计对象
     */
    calculateStats(): PerformanceStats;
    /**
     * 筛选指标
     *
     * 根据谓词函数筛选指标，返回包含筛选结果的新采集器。
     *
     * @param {(metric: PerformanceMetrics) => boolean} predicate - 筛选函数
     * @returns {MetricsCollector} 包含筛选结果的新采集器
     */
    filter(predicate: (metric: PerformanceMetrics) => boolean): MetricsCollector;
    /**
     * 按时间范围筛选
     *
     * 筛选指定时间范围内（含端点）的所有指标。
     *
     * @param {number} startTime - 开始时间戳
     * @param {number} endTime - 结束时间戳
     * @returns {MetricsCollector} 包含筛选结果的新采集器
     */
    filterByTimeRange(startTime: number, endTime: number): MetricsCollector;
    /**
     * 按操作筛选
     *
     * 筛选指定操作名称的所有指标。
     *
     * @param {string} operation - 操作名称
     * @returns {MetricsCollector} 包含筛选结果的新采集器
     */
    filterByOperation(operation: string): MetricsCollector;
    /**
     * 排序指标
     *
     * 按持续时间排序，返回包含排序结果的新采集器。
     *
     * @param {boolean} [ascending=false] - 是否升序（默认降序）
     * @returns {MetricsCollector} 包含排序结果的新采集器
     */
    sortByDuration(ascending?: boolean): MetricsCollector;
    /**
     * 获取百分位数
     *
     * 计算指定百分位数的持续时间。
     *
     * @param {number} percentile - 百分位数（0-100）
     * @returns {number} 指定百分位数的持续时间；采集器为空时返回 0
     * @throws {RangeError} percentile 非有限数或落在 [0,100] 之外
     */
    getPercentile(percentile: number): number;
    /**
     * 获取热路径（最频繁的操作）
     *
     * 返回最频繁操作列表，包含执行次数和平均耗时。
     *
     * @param {number} [limit=5] - 返回的热路径数量；小数向下取整，非有限值（NaN/Infinity）、
     *   0 与负数一律按 0 处理（返回空数组），与 PerformanceMonitor.getRecentMetrics 同口径
     * @returns {Array<{operation: string, count: number, avgDuration: number}>} 热路径数组
     */
    getHotPaths(limit?: number): Array<{
        operation: string;
        count: number;
        avgDuration: number;
    }>;
}
```

### `PerformanceAnalyzer`

```ts
/**
 * 性能分析工具
 *
 * 提供静态方法用于分析性能数据（瓶颈识别与退化检测）。
 */
export declare class PerformanceAnalyzer {
    /**
     * 分析性能瓶颈
     *
     * 按操作分组统计，并以 threshold 的倍数标定严重程度。
     *
     * @remarks 返回值**不是**「超阈值操作的子集」：入参中出现过的每个操作都会各出一条，
     * 未超阈值（`avgDuration <= threshold * 2`）的以 `severity: 'low'` 一并返回，
     * 结果按 avgDuration 降序排列。调用方若只要瓶颈，请自行按 severity 过滤，
     * 不能把列表长度当作「超标操作数」。
     *
     * @param {PerformanceMetrics[]} metrics - 性能指标数组
     * @param {number} [threshold=16] - 性能阈值（毫秒）：avgDuration > 2×threshold 记 medium、
     *   > 3×threshold 记 high，否则 low（threshold 本身不是过滤门槛）。
     *   非有限值（NaN/Infinity）回落默认 16、负值夹到 0，见 {@link normalizeThreshold}
     * @returns {Array<{operation: string, count: number, avgDuration: number, maxDuration: number, severity: 'low' | 'medium' | 'high'}>} 全部操作的分组列表（按 avgDuration 降序），含未超阈值项
     */
    static analyzeBottlenecks(metrics: PerformanceMetrics[], threshold?: number): Array<{
        operation: string;
        count: number;
        avgDuration: number;
        maxDuration: number;
        severity: 'low' | 'medium' | 'high';
    }>;
    /**
     * 检测性能退化
     *
     * 对比当前与基准指标，返回平均耗时增长超过阈值的操作列表。
     *
     * @param {PerformanceMetrics[]} currentMetrics - 当前性能指标
     * @param {PerformanceMetrics[]} baselineMetrics - 基准性能指标
     * @param {number} [threshold=0.2] - 退化阈值（比例，0.2 表示 20%）。
     *   非有限值回落默认 0.2、负值夹到 0，见 {@link normalizeThreshold}
     * @returns {Array<{operation: string, baselineDuration: number, currentDuration: number, change: number, changePercent: number}>} 退化列表。
     *   基线为 0 而当前有耗时时无比例可算，changePercent 取 Infinity 哨兵（幅度按无限恶化处理）
     */
    static detectRegression(currentMetrics: PerformanceMetrics[], baselineMetrics: PerformanceMetrics[], threshold?: number): Array<{
        operation: string;
        baselineDuration: number;
        currentDuration: number;
        change: number;
        changePercent: number;
    }>;
    /**
     * 计算平均持续时间
     *
     * @private
     * @param {PerformanceMetrics[]} metrics - 性能指标数组
     * @returns {Map<string, number>} 按操作分组的平均持续时间
     */
    private static calculateAvgDurations;
}
```

### `PerformanceMetrics`

```ts
/**
 * 性能指标
 */
export interface PerformanceMetrics {
    /** 操作名称 */
    operation: string;
    /** 操作类型 */
    type: MetricType;
    /** 执行时长（毫秒） */
    duration: number;
    /** 时间戳 */
    timestamp: number;
    /** 负载大小（字节） */
    payloadSize?: number;
    /** 内存使用（字节） */
    memoryUsage?: number;
    /** 是否超过阈值 */
    exceedThreshold?: boolean;
}
```

### `PerformanceMonitor`

```ts
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
export declare class PerformanceMonitor implements PerformanceMonitorInterface {
    /**
     * 性能指标数组
     * @private
     * @type {PerformanceMetrics[]}
     */
    private metrics;
    /**
     * 监控器配置
     * @private
     * @type {Required<PerformanceOptions>}
     */
    private options;
    /**
     * 当前操作计时器
     * @private
     * @type {Map<string, number>}
     */
    private currentOperations;
    /**
     * 操作序号计数器：使 start/end 配对的 key 唯一，
     * 避免同名操作并发/嵌套时 start 时间互相覆盖或残留条目
     * @private
     * @type {number}
     */
    private operationSeq;
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
    constructor(options?: PerformanceOptions);
    /** 默认指标容量上限 */
    private static readonly DEFAULT_MAX_SIZE;
    /**
     * 规范化采样率
     *
     * 留存判据是 `Math.random() < sampleRate`（见 record()）：未校验的 NaN 与负值都会让
     * 条件恒假，「采样」静默退化成一条都不留，而调用方以为自己在监控。文档口径是 0-1，
     * 故统一夹到该区间，非有限值回退默认。
     *
     * @private
     */
    private static normalizeSampleRate;
    /**
     * 规范化阈值
     *
     * NaN 阈值会让 `duration > NaN` 恒为 false，超阈值预警静默失效；负值等价于 0
     * （凡有耗时的操作都预警），夹到 0 保持「预警不被关掉」的直觉语义。
     *
     * @private
     */
    private static normalizeThreshold;
    /**
     * 规范化容量上限
     *
     * maxSize 直接来自调用方，未校验会让 `while (length > maxSize) shift()`
     * 在负数时于空数组上死循环、NaN 时条件恒 false 使缓冲永不收敛，
     * 故统一收敛为「有限、非负、整数」。
     *
     * @private
     */
    private static normalizeMaxSize;
    /**
     * 缓存的 wx 性能实例（undefined＝未探测，null＝探测过且不可用）
     *
     * @private
     */
    private cachedWxPerformance?;
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
    private _getTimestamp;
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
    start(operation: string, type?: MetricType): () => void;
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
    record(metrics: PerformanceMetrics): void;
    /**
     * 超出容量上限时淘汰最旧条目
     *
     * @private
     */
    private trimToMaxSize;
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
    getMetrics(): PerformanceMetrics[];
    /** 清理超时未结束的计时条目（调用方遗漏 end() 时的兜底，防止 Map 无限增长） */
    private pruneStaleOperations;
    /** 计时条目的最大保留时长：超过视为调用方遗漏 end() 的泄漏条目 */
    private static readonly MAX_OPERATION_AGE_MS;
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
    getStats(): PerformanceStats;
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
    clear(): void;
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
    setOptions(options: PerformanceOptions): void;
    /**
     * 默认日志记录器
     *
     * @private
     * @param {PerformanceMetrics} metrics - 性能指标
     */
    private defaultLogger;
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
    getMetricsByType(type: MetricType): PerformanceMetrics[];
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
    getMetricsByOperation(operation: string): PerformanceMetrics[];
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
    getRecentMetrics(count?: number): PerformanceMetrics[];
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
    exportJSON(): string;
}
```

### `PerformanceOptions`

```ts
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
    sampleRate?: number;
    /**
     * 超过阈值（毫秒）记录
     *
     * `NaN` 会让 `duration > threshold` 恒假、预警静默失效；负值等价于 0。内置实现夹到 `>= 0`。
     */
    threshold?: number;
    /** 自定义日志记录器 */
    logger?: (metrics: PerformanceMetrics) => void;
    /**
     * 最大记录数量
     *
     * 环形缓冲按整数下标运算：小数/负数会取到空洞下标（静默丢数据或无界增长）。
     * 内置实现归一为「有限、非负、整数」，非有限值回退默认（监控器 1000 / 采集器 10000）。
     */
    maxSize?: number;
    /** 是否启用内存监控 */
    trackMemory?: boolean;
}
```

### `PerformanceStats`

```ts
/**
 * 性能统计
 */
export interface PerformanceStats {
    /** 平均执行时间 */
    avgDuration: number;
    /** 最大执行时间 */
    maxDuration: number;
    /** 最小执行时间 */
    minDuration: number;
    /** 总调用次数 */
    totalCount: number;
    /** 超过阈值次数 */
    thresholdExceeded: number;
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
    byOperation: Record<string, {
        count: number;
        avgDuration: number;
        maxDuration: number;
    }>;
}
```

### `analyzerPlugin`

```ts
analyzerPlugin: Plugin
```

### `createAnalyzerPlugin`

```ts
/**
 * 性能分析插件
 *
 * 自动监控所有Store操作的性能，并提供分析工具
 *
 * @type {Plugin}
 *
 * @example
 * ```typescript
 * import { createStore } from '@geomstore/core'
 * import { analyzerPlugin } from '@geomstore/plugins'
 *
 * const store = createStore({
 *   name: 'user',
 *   state: {
 *     userInfo: null,
 *     posts: []
 *   },
 *   actions: {
 *     async fetchUser(id) {
 *       const user = await api.getUser(id)
 *       this.setState('userInfo', user)
 *     },
 *     async fetchPosts(userId) {
 *       const posts = await api.getPosts(userId)
 *       this.setState('posts', posts)
 *     }
 *   },
 *   getters: {
 *     userPosts: (state) => state.posts
 *   }
 * })
 *
 * // 使用默认配置安装
 * store.use(analyzerPlugin)
 *
 * // 使用自定义配置安装
 * store.use(createAnalyzerPlugin({
 *   sampleRate: 1.0,      // 100%采样
 *   threshold: 16,        // 16ms阈值
 *   trackMemory: true,    // 跟踪内存
 *   maxSize: 1000         // 最多1000条记录
 * }))
 *
 * // 访问性能监控器
 * const monitor = store.__performanceMonitor__
 *
 * // 获取所有指标
 * const metrics = monitor.getMetrics()
 * console.log(`Total metrics: ${metrics.length}`)
 *
 * // 获取统计信息
 * const stats = monitor.getStats()
 * console.log(`平均耗时: ${stats.avgDuration.toFixed(2)}ms`)
 * console.log(`最大耗时: ${stats.maxDuration.toFixed(2)}ms`)
 * console.log(`超阈值次数: ${stats.thresholdExceeded}`)
 *
 * // 按类型筛选
 * const dispatchMetrics = monitor.getMetricsByType('dispatch')
 * const getterMetrics = monitor.getMetricsByType('getter')
 *
 * // 按操作筛选
 * const fetchUserMetrics = monitor.getMetricsByOperation('fetchUser')
 *
 * // 获取最近的指标
 * const recentMetrics = monitor.getRecentMetrics(10)
 *
 * // 导出为JSON
 * const report = monitor.exportJSON()
 *
 * // 访问全局API（仅在非生产环境注册；未安装插件或 store 名不符时为 undefined）
 * const api = globalThis.__GEOMSTORE_ANALYZER__?.['user']
 *
 * // 获取指标
 * const allMetrics = api?.getMetrics()
 * const allStats = api?.getStats()
 *
 * // 分析性能瓶颈
 * const bottlenecks = api?.analyzeBottlenecks(16) ?? []
 * bottlenecks.forEach(b => {
 *   console.log(`${b.operation}:`)
 *   console.log(`  Severity: ${b.severity}`)
 *   console.log(`  Avg: ${b.avgDuration.toFixed(2)}ms`)
 *   console.log(`  Max: ${b.maxDuration.toFixed(2)}ms`)
 * })
 *
 * // 清除指标
 * api?.clear()
 *
 * // 在控制台直接访问（自行判空）
 * // globalThis.__GEOMSTORE_ANALYZER__?.['user']?.getStats()
 * ```
 */
export declare function createAnalyzerPlugin(options?: PerformanceOptions): Plugin;
```
