# `./extras/error` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.5.1`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`./extras/error`
> - 类型声明：`./dist/extras/error/index.d.ts`
> - 返回索引：[`index.md`](./index.md)

### `ActionError`

```ts
/**
 * Action相关错误
 *
 * @class ActionError
 * @extends GeomStoreError
 * @description
 * 表示Action执行过程中发生的错误，包括：
 * - Action不存在
 * - Action执行失败
 * - Action参数错误
 *
 * @example
 * ```typescript
 * throw new ActionError(
 *   'Action "fetchData" failed: Network timeout',
 *   'ACTION_EXECUTION_ERROR',
 *   {
 *     actionName: 'fetchData',
 *     storeName: 'user-store',
 *     args: ['userId']
 *   }
 * )
 * ```
 */
export declare class ActionError extends GeomStoreError {
    constructor(message: string, code: string, context?: Record<string, unknown>);
}
```

### `ComposeError`

```ts
/**
 * Compose相关错误
 *
 * @class ComposeError
 * @extends GeomStoreError
 * @description
 * 表示Store组合操作过程中发生的错误，包括：
 * - Store名称冲突
 * - Store依赖解析失败
 * - Store组合失败
 *
 * @example
 * ```typescript
 * throw new ComposeError(
 *   'Store name conflict: "user" already exists',
 *   'STORE_NAME_CONFLICT',
 *   {
 *     namespace: 'root',
 *     storeName: 'user',
 *     existingStore: 'root.user'
 *   }
 * )
 * ```
 */
export declare class ComposeError extends GeomStoreError {
    constructor(message: string, code: string, context?: Record<string, unknown>);
}
```

### `ConsoleReporter`

```ts
/**
 * 控制台错误报告器（开发环境首选）
 *
 * 按级别将错误信息输出到 console；在缺少 `console.group` 的基础库上
 * 自动降级为平铺输出，保证报告不因 API 缺失而失败。
 */
export declare class ConsoleReporter implements ErrorReporter {
    private readonly prefix;
    /**
     * @param prefix 日志前缀，默认 `[ErrorMonitoring]`
     */
    constructor(prefix?: string);
    getName(): string;
    report(context: ErrorContext): Promise<void>;
    reportBatch(contexts: ErrorContext[]): Promise<void>;
}
```

### `ErrorAggregator`

```ts
/**
 * 错误聚合器
 *
 * 将相似的错误聚合成组，便于分析和报告
 */
export declare class ErrorAggregator {
    /**
     * 各 Store 的错误发生次数
     *
     * 单独按次计数：错误组会把同一站点在不同 Store 的报错合并为一条，
     * 若按组计数求和（组 count 累加给每个受影响 Store），跨 Store 的组
     * 会把整组次数重复计入每个 Store，byStore 之和超过 totalErrors
     */
    private readonly storeCounts;
    private groups;
    private readonly maxGroups;
    constructor(maxGroups?: number);
    /**
     * 添加错误到聚合器
     *
     * @param {ErrorContext} context - 错误上下文
     * @returns {ErrorGroup | undefined} 错误组（如果是新创建的）
     */
    addError(context: ErrorContext): ErrorGroup | undefined;
    /**
     * 获取所有错误组
     *
     * @returns {ErrorGroup[]} 错误组数组
     */
    getGroups(): ErrorGroup[];
    /**
     * 获取指定Store的组
     *
     * @param {string} storeName - Store名称
     * @returns {ErrorGroup[]} 错误组数组
     */
    getGroupsByStore(storeName: string): ErrorGroup[];
    /**
     * 清理旧的错误组
     *
     * @private
     */
    private cleanupOldGroups;
    /**
     * 生成错误组ID
     *
     * @private
     * @param {ErrorContext} context - 错误上下文
     * @returns {string} 组ID
     */
    private generateGroupId;
    /**
     * 清空所有错误组
     */
    clear(): void;
    /**
     * 获取统计信息
     *
     * @returns {object} 统计信息
     */
    getStats(): {
        totalGroups: number;
        totalErrors: number;
        byCode: Record<string, number>;
        byStore: Record<string, number>;
    };
}
```

### `ErrorBoundary`

```ts
/**
 * 错误边界类
 *
 * 用于捕获和处理函数执行过程中的错误，支持错误恢复和回退状态
 *
 * @class ErrorBoundary
 * @template S - 状态类型
 *
 * @example
 * ```typescript
 * const boundary = new ErrorBoundary<MyState>({
 *   fallback: { count: 0, user: null },
 *   recoverable: true,
 *   onError: (error) => {
 *     console.error('Error occurred:', error)
 *   }
 * })
 *
 * // 执行可能出错的函数
 * const result = boundary.execute(() => {
 *   return riskyOperation()
 * }, currentState)
 *
 * // 异步执行
 * const asyncResult = await boundary.executeAsync(async () => {
 *   return await riskyAsyncOperation()
 * })
 * ```
 */
export declare class ErrorBoundary<S = unknown, F = undefined> {
    /**
     * 回退状态（固定值或计算函数）
     * @private
     * @type {ErrorFallback<F, S> | undefined}
     */
    private fallback?;
    /**
     * 错误回调函数
     * @private
     * @type {(error: Error) => void | undefined}
     */
    private onErrorCallback?;
    /**
     * 是否可恢复
     * @private
     * @type {boolean}
     */
    private recoverable;
    /** recoverable 是否被显式设置（未显式时事后提供 fallback 视为恢复意图） */
    private recoverableExplicit;
    /**
     * 错误历史记录
     * @private
     * @type {Error[]}
     */
    private errorHistory;
    /**
     * 创建错误边界实例
     *
     * @param {ErrorBoundaryOptions} [options={}] - 配置选项
     *
     * @example
     * ```typescript
     * const boundary = new ErrorBoundary({
     *   fallback: { count: 0 },
     *   recoverable: true,
     *   onError: (error) => alert(error.message)
     * })
     * ```
     */
    constructor(options?: ErrorBoundaryOptions<S, F>);
    /**
     * 执行函数并捕获错误
     *
     * 如果函数执行抛出错误，根据配置决定是恢复还是重新抛出
     *
     * @template T - 返回值类型
     * @param {() => T} fn - 要执行的函数
     * @param {S} [currentState] - 当前状态（用于回退）
     * @returns {T | undefined} 函数执行结果，如果错误且可恢复则返回undefined
     * @throws {Error} 如果错误且不可恢复则重新抛出
     *
     * @example
     * ```typescript
     * const result = boundary.execute(() => {
     *   return state.value * 2
     * }, state)
     *
     * // 处理可能出错的操作
     * const safeResult = boundary.execute(() => {
     *   throw new Error('Error')
     * }, state)
     * // safeResult will be undefined, error is handled
     * ```
     */
    execute<T>(fn: () => T, currentState?: S): T | F;
    /**
     * 异步执行函数并捕获错误
     *
     * 如果函数执行抛出错误，根据配置决定是恢复还是重新抛出
     *
     * @template T - 返回值类型
     * @param {() => Promise<T>} fn - 要执行的异步函数
     * @param {S} [currentState] - 当前状态（用于回退）
     * @returns {Promise<T | undefined>} 函数执行结果，如果错误且可恢复则返回undefined
     * @throws {Error} 如果错误且不可恢复则重新抛出
     *
     * @example
     * ```typescript
     * const result = await boundary.executeAsync(async () => {
     *   return await fetchData()
     * }, state)
     *
     * // 处理可能出错的异步操作
     * const safeResult = await boundary.executeAsync(async () => {
     *   throw new Error('Error')
     * }, state)
     * ```
     */
    executeAsync<T>(fn: () => Promise<T>, currentState?: S): Promise<T | F>;
    /**
     * 处理错误
     *
     * @private
     * @param {Error} error - 错误对象
     * @param {S} [currentState] - 当前状态
     * @returns {S | undefined} 回退状态（若配置）；未配置回退时返回 undefined
     * @throws {Error} 如果错误且不可恢复
     */
    private handleError;
    /**
     * 获取回退状态
     *
     * @returns {S | undefined} 回退状态；若配置为计算函数则需结合错误上下文调用，此处返回undefined
     *
     * @example
     * ```typescript
     * const fallback = boundary.getFallbackState()
     * if (fallback) {
     *   console.log('Fallback state:', fallback)
     * }
     * ```
     */
    getFallbackState(): F | undefined;
    /**
     * 设置回退状态
     *
     * @param {S} state - 新的回退状态
     *
     * @example
     * ```typescript
     * boundary.setFallbackState({ count: 0, user: null })
     * ```
     */
    setFallbackState(state: F): void;
    /**
     * 获取错误历史
     *
     * 返回错误历史的副本，不影响原始数据
     *
     * @returns {Error[]} 错误历史数组的副本
     *
     * @example
     * ```typescript
     * const history = boundary.getErrorHistory()
     * history.forEach(error => {
     *   console.log(error.message)
     * })
     * ```
     */
    getErrorHistory(): Error[];
    /**
     * 清除错误历史
     *
     * 删除所有已记录的错误
     *
     * @example
     * ```typescript
     * boundary.clearErrorHistory()
     * console.log(boundary.hasError()) // false
     * ```
     */
    clearErrorHistory(): void;
    /**
     * 检查是否有错误
     *
     * @returns {boolean} 如果错误历史不为空则返回true
     *
     * @example
     * ```typescript
     * if (boundary.hasError()) {
     *   const lastError = boundary.getLastError()
     *   console.error('Last error:', lastError?.message)
     * }
     * ```
     */
    hasError(): boolean;
    /**
     * 获取最后一个错误
     *
     * @returns {Error | undefined} 最后一个错误，如果没有则返回undefined
     *
     * @example
     * ```typescript
     * const lastError = boundary.getLastError()
     * if (lastError) {
     *   console.error('Most recent error:', lastError.message)
     * }
     * ```
     */
    getLastError(): Error | undefined;
}
```

### `ErrorBoundaryOptions`

```ts
/**
 * 错误边界选项
 *
 * @template S - 状态类型（传入 fallback 计算函数的上下文）
 * @template F - 回退值类型（与状态类型解耦：回退值不必是状态对象）
 */
export interface ErrorBoundaryOptions<S = unknown, F = unknown> {
    /** 回退状态：固定值或计算函数 */
    fallback?: ErrorFallback<F, S>;
    /** 错误回调 */
    onError?: (error: Error) => void;
    /**
     * 是否恢复（吞错返回 fallback / undefined）而非重抛。
     * 默认由 fallback 推导：提供了 fallback 即声明"我要恢复"；
     * 未提供 fallback 时默认重抛（fail-loud——吞错返回 undefined 是
     * 最难排查的故障模式，错误会在远离根因处变成二次异常）
     */
    recoverable?: boolean;
}
```

### `ErrorCode`

```ts
/**
 * 错误代码枚举
 *
 * @description
 * 定义所有可能的错误代码，便于错误分类和处理。
 */
export declare enum ErrorCode {
    ACTION_NOT_FOUND = "ACTION_NOT_FOUND",
    ACTION_EXECUTION_ERROR = "ACTION_EXECUTION_ERROR",
    ACTION_TIMEOUT = "ACTION_TIMEOUT",
    ACTION_CANCELLED = "ACTION_CANCELLED",
    STATE_KEY_NOT_FOUND = "STATE_KEY_NOT_FOUND",
    STATE_UPDATE_ERROR = "STATE_UPDATE_ERROR",
    STATE_TYPE_ERROR = "STATE_TYPE_ERROR",
    SELECTOR_NOT_FOUND = "SELECTOR_NOT_FOUND",
    SELECTOR_EXECUTION_ERROR = "SELECTOR_EXECUTION_ERROR",
    SELECTOR_CACHE_ERROR = "SELECTOR_CACHE_ERROR",
    PLUGIN_NOT_FOUND = "PLUGIN_NOT_FOUND",
    PLUGIN_INSTALLATION_ERROR = "PLUGIN_INSTALLATION_ERROR",
    PLUGIN_EXECUTION_ERROR = "PLUGIN_EXECUTION_ERROR",
    STORE_NAME_CONFLICT = "STORE_NAME_CONFLICT",
    STORE_DEPENDENCY_ERROR = "STORE_DEPENDENCY_ERROR",
    STORE_COMPOSE_ERROR = "STORE_COMPOSE_ERROR",
    VALIDATION_ERROR = "VALIDATION_ERROR",
    TYPE_ERROR = "TYPE_ERROR",
    PARAMETER_ERROR = "PARAMETER_ERROR",
    UNKNOWN_ERROR = "UNKNOWN_ERROR",
    INTERNAL_ERROR = "INTERNAL_ERROR"
}
```

### `ErrorContext`

```ts
/**
 * 错误上下文
 */
export interface ErrorContext {
    /** Store名称 */
    storeName: string;
    /** 操作类型 */
    operation: OperationType;
    /** 错误对象 */
    error: Error;
    /** 错误级别 */
    level: ErrorLevel;
    /** 操作参数 */
    payload?: unknown;
    /** 时间戳（缺省时由采集器使用当前时间） */
    timestamp?: number;
}
```

### `ErrorFallback`

```ts
/**
 * 回退状态：支持固定值或根据错误/当前状态动态计算
 */
export type ErrorFallback<F = unknown, S = unknown> = F | ((error: Error, currentState: S | undefined) => F);
```

### `ErrorGroup`

```ts
/**
 * 错误组 - 表示一组相似的错误聚合
 */
export interface ErrorGroup {
    /** 组标识（基于错误消息和堆栈的哈希） */
    groupId: string;
    /** 错误类型 */
    type: string;
    /** 错误代码 */
    code: string;
    /** 错误消息 */
    message: string;
    /** 组内错误数量 */
    count: number;
    /** 首次出现时间 */
    firstSeen: number;
    /** 最后出现时间 */
    lastSeen: number;
    /** 受影响的Store列表 */
    affectedStores: string[];
    /** 示例错误上下文 */
    sampleError: ErrorContext;
}
```

### `ErrorHandler`

```ts
/**
 * 错误处理器
 */
export type ErrorHandler = (context: ErrorContext) => void;
```

### `ErrorHandlerImpl`

```ts
export declare class ErrorHandlerImpl {
    /**
     * 错误处理函数
     * @private
     * @type {ErrorHandler}
     */
    private handler;
    /**
     * 错误日志
     * @private
     * @type {ErrorContext[]}
     */
    private errorLog;
    /**
     * 最大日志大小
     * @private
     * @type {number}
     */
    private maxLogSize;
    /**
     * 设置错误处理器
     *
     * 覆盖默认的错误处理行为
     *
     * @param {ErrorHandler} handler - 错误处理函数
     * @throws {Error} 如果handler不是函数
     *
     * @example
     * ```typescript
     * errorHandler.setHandler((context) => {
     *   // 发送错误到监控服务
     *   errorTrackingService.log(context)
     *
     *   // 根据级别采取不同措施
     *   if (context.level === 'critical') {
     *     alertUser('发生严重错误')
     *   }
     * })
     * ```
     */
    setHandler(handler: ErrorHandler): void;
    /**
     * 处理错误上下文
     *
     * 记录错误并调用当前处理器
     *
     * @param {ErrorContext} context - 错误上下文对象
     *
     * @example
     * ```typescript
     * const context: ErrorContext = {
     *   storeName: 'user-store',
     *   operation: 'action-execution',
     *   error: new Error('Action failed'),
     *   level: 'error',
     *   timestamp: Date.now(),
     *   payload: { actionName: 'login' }
     * }
     * errorHandler.handleError(context)
     * ```
     */
    handleError(context: ErrorContext): void;
    /**
     * 创建并处理错误
     *
     * 便捷方法，自动创建错误上下文并处理
     *
     * @param {string} storeName - Store名称
     * @param {OperationType} operation - 操作类型
     * @param {Error} error - 错误对象
     * @param {ErrorLevel} [level='error'] - 错误级别
     * @param {unknown} [payload] - 附加载荷数据
     *
     * @example
     * ```typescript
     * try {
     *   store.dispatch('login', 'user', 'pass')
     * } catch (error) {
     *   errorHandler.handle(
     *     'user-store',
     *     'action-execution',
     *     error as Error,
     *     'error',
     *     { actionName: 'login', username: 'user' }
     *   )
     * }
     * ```
     */
    handle(storeName: string, operation: OperationType, error: Error, level?: ErrorLevel, payload?: unknown): void;
    /**
     * 记录错误
     *
     * @private
     * @param {ErrorContext} context - 错误上下文
     */
    private logError;
    /**
     * 获取错误日志
     *
     * 返回所有错误上下文的副本
     *
     * @returns {ErrorContext[]} 错误日志数组的副本
     *
     * @example
     * ```typescript
     * const logs = errorHandler.getErrorLog()
     * logs.forEach(log => {
     *   console.log(`[${log.level}] ${log.error.message}`)
     * })
     * ```
     */
    getErrorLog(): ErrorContext[];
    /**
     * 获取最近的错误
     *
     * @returns {ErrorContext | undefined} 最后一个错误上下文，如果没有则返回undefined
     *
     * @example
     * ```typescript
     * const lastError = errorHandler.getLastError()
     * if (lastError) {
     *   console.log('Last error:', lastError.error.message)
     * }
     * ```
     */
    getLastError(): ErrorContext | undefined;
    /**
     * 清除错误日志
     *
     * 删除所有已记录的错误
     *
     * @example
     * ```typescript
     * // 清空日志
     * errorHandler.clearErrorLog()
     * ```
     */
    clearErrorLog(): void;
    /**
     * 设置最大日志大小
     *
     * 当日志超过指定大小时，最旧的错误会被移除
     *
     * @param {number} size - 最大日志数量（必须 >= 1）
     *
     * @example
     * ```typescript
     * // 只保留最近50条错误
     * errorHandler.setMaxLogSize(50)
     * ```
     */
    setMaxLogSize(size: number): void;
    /**
     * 按操作类型筛选错误
     *
     * @param {OperationType} operation - 操作类型
     * @returns {ErrorContext[]} 匹配的错误列表
     *
     * @example
     * ```typescript
     * // 获取所有action相关的错误
     * const actionErrors = errorHandler.getErrorsByOperation('action-execution')
     * console.log(`Action errors: ${actionErrors.length}`)
     * ```
     */
    getErrorsByOperation(operation: OperationType): ErrorContext[];
    /**
     * 按错误级别筛选错误
     *
     * @param {ErrorLevel} level - 错误级别
     * @returns {ErrorContext[]} 匹配的错误列表
     *
     * @example
     * ```typescript
     * // 获取所有严重错误
     * const criticalErrors = errorHandler.getErrorsByLevel('critical')
     * if (criticalErrors.length > 0) {
     *   // 通知管理员
     *   alertAdmin(criticalErrors)
     * }
     * ```
     */
    getErrorsByLevel(level: ErrorLevel): ErrorContext[];
    /**
     * 获取错误统计信息
     *
     * 返回按级别和操作类型分组的错误统计
     *
     * @returns {{total: number, byLevel: Record<ErrorLevel, number>, byOperation: Record<OperationType, number>}} 错误统计对象
     *
     * @example
     * ```typescript
     * const stats = errorHandler.getErrorStats()
     * console.log(`Total: ${stats.total}`)
     * console.log(`Critical: ${stats.byLevel.critical}`)
     * console.log(`Action errors: ${stats.byOperation['action-execution']}`)
     * ```
     */
    getErrorStats(): {
        total: number;
        byLevel: Record<ErrorLevel, number>;
        byOperation: Record<string, number>;
    };
}
```

### `ErrorLevel`

```ts
/**
 * 错误级别
 */
export type ErrorLevel = 'error' | 'warning' | 'info' | 'warn' | 'critical';
```

### `ErrorMonitoring`

```ts
/**
 * 错误监控系统
 *
 * @class ErrorMonitoring
 * @description
 * 统一的错误监控系统，支持多个报告器、批量上报和错误聚合
 *
 * @example
 * ```typescript
 * const monitoring = new ErrorMonitoring({
 *   reporters: [
 *     new ConsoleReporter(),
 *     new HttpReporter('https://api.example.com/errors')
 *   ],
 *   batchInterval: 5000,
 *   batchThreshold: 10,
 *   enableAggregation: true,
 *   enableConsoleLog: true
 * })
 *
 * // 上报错误
 * await monitoring.report(errorContext)
 *
 * // 获取错误报告
 * const report = monitoring.generateReport()
 * console.log(report)
 * ```
 */
export declare class ErrorMonitoring {
    private reporters;
    private batchInterval;
    private batchThreshold;
    private enableAggregation;
    private enableConsoleLog;
    private reportTimeout;
    private errorQueue;
    private aggregator;
    private batchTimer?;
    private isFlushing;
    /** 在途 flush 的 Promise（shutdown 等待其完成后再做最终上报） */
    private inFlightFlush;
    private isShuttingDown;
    private nonAggregatedErrorCount;
    /** 防止队列无限增长的最大大小（可由 MonitoringConfig.maxQueueSize 覆盖） */
    private readonly maxQueueSize;
    /** 连续「全部报告器失败」的 flush 次数：用于给重入队加上限，见 doFlushReports */
    private consecutiveFlushFailures;
    /** 重入队重试上限：超过后丢弃该批并告警，避免永久失败批次无限空转 */
    private readonly maxFlushRetries;
    constructor(config: MonitoringConfig);
    /**
     * 上报错误
     *
     * @param {ErrorContext} context - 错误上下文
     * @returns {Promise<void>}
     *
     * @example
     * ```typescript
     * await monitoring.report(errorContext)
     * ```
     */
    report(context: ErrorContext): Promise<void>;
    /**
     * 立即上报所有队列中的错误
     *
     * @returns {Promise<void>}
     */
    flushReports(): Promise<void>;
    /**
     * 执行批量上报（flushReports 已设置 isFlushing 与 inFlightFlush）
     *
     * @private
     */
    private doFlushReports;
    /**
     * 生成错误报告
     *
     * @returns {ErrorReport} 错误报告
     *
     * @example
     * ```typescript
     * const report = monitoring.generateReport()
     * console.log('Total Errors:', report.summary.totalErrors)
     * console.log('Top Errors:', report.topErrors)
     * ```
     */
    generateReport(): ErrorReport;
    /**
     * 获取聚合统计
     *
     * @returns {object} 聚合统计
     */
    getAggregationStats(): {
        totalGroups: number;
        totalErrors: number;
        byCode: Record<string, number>;
        byStore: Record<string, number>;
    };
    /**
     * 获取错误组
     *
     * @returns {ErrorGroup[]} 错误组
     */
    getErrorGroups(): ErrorGroup[];
    /**
     * 清除所有数据
     */
    clear(): void;
    /**
     * 添加报告器
     *
     * @param {ErrorReporter} reporter - 错误报告器
     */
    addReporter(reporter: ErrorReporter): void;
    /**
     * 移除报告器
     *
     * @param {string} name - 报告器名称
     */
    removeReporter(name: string): void;
    /**
     * 关闭监控系统
     *
     * @returns {Promise<void>}
     */
    shutdown(): Promise<void>;
    /**
     * 启动批量调度器
     *
     * @private
     */
    private startBatchScheduler;
    /**
     * 延迟执行
     *
     * @private
     * @param {number} ms - 延迟毫秒数
     * @returns {Promise<void>}
     */
    private delay;
}
```

### `ErrorRecovery`

```ts
/**
 * 错误恢复器类
 *
 * @class ErrorRecovery
 * @description
 * 实现自动错误恢复机制，支持多种恢复策略
 *
 * @example
 * ```typescript
 * const recovery = new ErrorRecovery()
 *
 * // 配置重试策略
 * recovery.configure({
 *   [ErrorCode.ACTION_EXECUTION_ERROR]: {
 *     strategy: RecoveryStrategy.RETRY,
 *     maxRetries: 3,
 *     retryDelay: 1000,
 *     exponentialBackoff: true,
 *     onRetry: (error, attempt) => {
 *       console.log(`Retry attempt ${attempt} for error:`, error.message)
 *     }
 *   }
 * })
 *
 * // 尝试恢复错误
 * const result = await recovery.recover(error, {
 *   storeName: 'user-store',
 *   operation: 'fetchData'
 * })
 * ```
 */
export declare class ErrorRecovery {
    private strategies;
    private retryCount;
    private retryWindowStart;
    /**
     * 配置错误恢复策略
     *
     * @param {RecoveryStrategyMap} strategies - 错误代码到恢复配置的映射
     *
     * @example
     * ```typescript
     * recovery.configure({
     *   [ErrorCode.ACTION_TIMEOUT]: {
     *     strategy: RecoveryStrategy.RETRY,
     *     maxRetries: 5,
     *     retryDelay: 2000
     *   },
     *   [ErrorCode.STATE_KEY_NOT_FOUND]: {
     *     strategy: RecoveryStrategy.FALLBACK,
     *     fallback: undefined
     *   }
     * })
     * ```
     */
    configure(strategies: RecoveryStrategyMap): void;
    /**
     * 获取错误恢复配置
     *
     * @param {string} errorCode - 错误代码
     * @returns {RecoveryConfig | undefined} 恢复配置
     */
    getConfig(errorCode: string): RecoveryConfig | undefined;
    /**
     * 尝试恢复错误
     *
     * @param {unknown} error - 错误对象
     * @param {Partial<RecoveryContext>} context - 恢复上下文
     * @returns {Promise<unknown>} 恢复结果
     * @throws {Error} 如果无法恢复错误
     *
     * @example
     * ```typescript
     * try {
     *   await store.dispatch('fetchData')
     * } catch (error) {
     *   const result = await recovery.recover(error, {
     *     storeName: 'user-store',
     *     operation: 'fetchData'
     *   })
     *   // 如果成功恢复，result包含恢复后的值
     * }
     * ```
     */
    recover(error: unknown, context?: Partial<RecoveryContext>): Promise<unknown>;
    /**
     * 执行恢复策略
     *
     * @private
     * @param {RecoveryContext} context - 恢复上下文
     * @returns {Promise<unknown>} 恢复结果
     */
    private executeRecovery;
    /**
     * 执行重试策略
     *
     * 语义：按退避延迟后重抛原错误，由调用方捕获后自行重试原操作
     * （ErrorRecovery 不持有原操作引用，无法在库内自动重试）。
     *
     * @private
     * @param {RecoveryContext} context - 恢复上下文
     * @returns {Promise<unknown>} 重试结果（实际总是重抛原错误）
     */
    private executeRetryStrategy;
    /**
     * 执行回退策略
     *
     * @private
     * @param {RecoveryContext} context - 恢复上下文
     * @returns {unknown} 回退值
     */
    private executeFallbackStrategy;
    /**
     * 执行恢复策略
     *
     * @private
     * @param {RecoveryContext} context - 恢复上下文
     * @returns {Promise<unknown>} 恢复结果
     */
    private executeRecoverStrategy;
    /**
     * 执行重启策略
     *
     * @private
     * @param {RecoveryContext} context - 恢复上下文
     * @returns {unknown} 重启结果
     */
    private executeRestartStrategy;
    /**
     * 获取重试计数
     *
     * @private
     * @param {string} key - 重试键
     * @returns {number} 当前重试次数
     */
    private getRetryCount;
    /**
     * 增加重试计数
     *
     * @private
     * @param {string} key - 重试键
     */
    private incrementRetryCount;
    /**
     * 清除重试计数与对应周期窗
     *
     * @private
     * @param {string} errorCode - 错误代码
     */
    private clearRetryCount;
    /**
     * 生成重试键
     *
     * @private
     * @param {GeomStoreError} error - 错误对象
     * @returns {string} 重试键
     */
    private getRetryKey;
    /**
     * 延迟执行
     *
     * @private
     * @param {number} ms - 延迟毫秒数
     * @returns {Promise<void>}
     */
    private delay;
    /**
     * 清除所有重试计数
     *
     * 与私有 clearRetryCount 同口径：计数与周期窗必须一起清。只清计数会留下陈旧窗口，
     * 该窗口在中途过期时触发额度重置，使 max-retries 防重试风暴保护被击穿
     * （原本应被拦截的重试被放行），且残留窗口条目再无释放路径。
     *
     * @example
     * ```typescript
     * recovery.clearAllRetryCounts()
     * ```
     */
    clearAllRetryCounts(): void;
}
```

### `ErrorReport`

```ts
/**
 * 错误报告 - 错误监控系统的报告格式
 */
export interface ErrorReport {
    /** 生成时间戳 */
    generatedAt: number;
    /** 摘要信息 */
    summary: {
        totalGroups: number;
        totalErrors: number;
        queuedErrors: number;
    };
    /** 按错误代码统计 */
    byCode: Record<string, number>;
    /** 按Store统计 */
    byStore: Record<string, number>;
    /** Top 10 错误 */
    topErrors: ErrorGroup[];
    /** 最近10个错误 */
    recentErrors: ErrorGroup[];
}
```

### `ErrorReporter`

```ts
/**
 * 错误报告器接口
 *
 * 定义错误报告器的行为，用于将错误发送到远程监控系统
 */
export interface ErrorReporter {
    /** 上报单个错误 */
    report(context: ErrorContext): Promise<void>;
    /** 批量上报错误 */
    reportBatch(contexts: ErrorContext[]): Promise<void>;
    /** 获取报告器名称 */
    getName(): string;
}
```

### `GeomStoreError`

```ts
/**
 * GeomStore - 自定义错误类体系
 *
 * 提供完整的错误类型定义，包括：
 * - 基础错误类
 * - 特定领域的错误类型
 * - 错误上下文信息
 */
/**
 * GeomStore基础错误类
 *
 * @class GeomStoreError
 * @description
 * 所有GeomStore错误的基础类，提供统一的错误格式和上下文信息。
 * 包含错误代码、上下文数据和完整的堆栈跟踪。
 *
 * @example
 * ```typescript
 * const error = new GeomStoreError(
 *   'State update failed',
 *   'STATE_UPDATE_ERROR',
 *   {
 *     storeName: 'user-store',
 *     key: 'user',
 *     value: { name: 'Alice' }
 *   }
 * )
 *
 * console.log(error.message)    // 'State update failed'
 * console.log(error.code)        // 'STATE_UPDATE_ERROR'
 * console.log(error.context)     // { storeName: 'user-store', ... }
 * console.log(error.toJSON())   // 序列化的错误信息
 * ```
 */
export declare class GeomStoreError extends Error {
    /**
     * 错误代码，用于错误分类和识别
     * @type {string}
     */
    readonly code: string;
    /**
     * 错误上下文信息，包含相关的状态和元数据
     * @type {Record<string, unknown> | undefined}
     */
    readonly context?: Record<string, unknown>;
    /**
     * 创建GeomStore错误实例
     *
     * @param {string} message - 错误消息
     * @param {string} code - 错误代码
     * @param {Record<string, unknown>} [context] - 错误上下文
     *
     * @example
     * ```typescript
     * throw new GeomStoreError(
     *   'Action not found',
     *   'ACTION_NOT_FOUND',
     *   { actionName: 'missingAction', storeName: 'test-store' }
     * )
     * ```
     */
    constructor(message: string, code: string, context?: Record<string, unknown>);
    /**
     * 将错误对象转换为JSON格式
     *
     * @returns {Record<string, unknown>} 序列化的错误信息
     *
     * @example
     * ```typescript
     * const error = new GeomStoreError('Error', 'CODE', { key: 'value' })
     * const json = error.toJSON()
     * // {
     * //   name: 'GeomStoreError',
     * //   message: 'Error',
     * //   code: 'CODE',
     * //   context: { key: 'value' },
     * //   stack: '...'
     * // }
     * ```
     */
    toJSON(): Record<string, unknown>;
    /**
     * 获取用户友好的错误消息
     *
     * @returns {string} 格式化的错误消息
     *
     * @example
     * ```typescript
     * const error = new GeomStoreError(
     *   'Action failed',
     *   'ACTION_ERROR',
     *   { actionName: 'save', storeName: 'user-store' }
     * )
     * console.log(error.getFriendlyMessage())
     * // "Action failed in store 'user-store': save"
     * ```
     */
    getFriendlyMessage(): string;
}
```

### `HttpReporter`

```ts
/**
 * HTTP错误报告器
 *
 * @class HttpReporter
 * @implements ErrorReporter
 * @description
 * 将错误通过HTTP发送到远程服务器。
 * 默认自动适配运行环境（小程序 wx.request / 浏览器 fetch），
 * 也可通过构造参数注入自定义请求实现。
 */
export declare class HttpReporter implements ErrorReporter {
    private readonly endpoint;
    private readonly options;
    private readonly requestImpl;
    constructor(endpoint: string, options?: RequestInit, requestImpl?: HttpRequestImpl);
    getName(): string;
    report(context: ErrorContext): Promise<void>;
    reportBatch(contexts: ErrorContext[]): Promise<void>;
    /**
     * 构造上报请求体（唯一的 body 产出点）。
     *
     * `JSON.stringify` 作用于对象字面量时结果至少为 `'{}'`，据此把返回值收窄为
     * {@link JsonBody}，使下游解析不必再做空串防御。
     */
    private buildRequestBody;
    private serializeErrorMessage;
    private serializeErrorBatch;
    /**
     * 将 RequestInit.headers 归一化为普通键值对象，
     * 兼容 Headers / string[][] / Record 三种形式
     */
    private normalizeHeaders;
}
```

### `MonitoringConfig`

```ts
/**
 * 错误监控配置
 */
export interface MonitoringConfig {
    /** 错误报告器列表 */
    reporters: ErrorReporter[];
    /** 批量上报间隔（毫秒） */
    batchInterval?: number;
    /** 批量上报阈值 */
    batchThreshold?: number;
    /** 是否启用错误聚合 */
    enableAggregation?: boolean;
    /** 是否在控制台输出日志 */
    enableConsoleLog?: boolean;
    /** 错误上报超时（毫秒） */
    reportTimeout?: number;
    /**
     * 队列容量上限（默认 1000）
     *
     * 超容量后按「最旧优先」淘汰：入队路径 shift 丢弃最旧错误，重入队路径裁剪队列头部。
     * 调大可容纳突发流量，调小可约束内存占用。
     */
    maxQueueSize?: number;
    /**
     * 「全部报告器连续失败」的重入队上限（默认 3）
     *
     * 超过后丢弃该批并告警，避免永久失败的批次随 batchInterval 无限空转
     */
    maxFlushRetries?: number;
}
```

### `OperationType`

```ts
/**
 * GeomStore - 错误类型定义
 */
/**
 * 操作类型
 */
export type OperationType = 'setState' | 'patch' | 'replaceState' | 'dispatch' | 'getter' | 'init' | 'state-update' | 'action-execution' | 'getter-execution';
```

### `PluginError`

```ts
/**
 * Plugin相关错误
 *
 * @class PluginError
 * @extends GeomStoreError
 * @description
 * 表示插件操作过程中发生的错误，包括：
 * - 插件安装失败
 * - 插件执行失败
 * - 插件卸载失败
 *
 * @example
 * ```typescript
 * throw new PluginError(
 *   'Plugin "persistence" installation failed: Storage not available',
 *   'PLUGIN_INSTALLATION_ERROR',
 *   {
 *     pluginName: 'persistence',
 *     storeName: 'user-store'
 *   }
 * )
 * ```
 */
export declare class PluginError extends GeomStoreError {
    constructor(message: string, code: string, context?: Record<string, unknown>);
}
```

### `RecoveryConfig`

```ts
/**
 * 错误恢复配置
 *
 * @interface RecoveryConfig
 * @description
 * 定义错误恢复的配置选项
 */
export interface RecoveryConfig {
    /** 恢复策略 */
    strategy: RecoveryStrategy;
    /** 最大重试次数（仅RETRY策略） */
    maxRetries?: number;
    /** 重试延迟（毫秒）（仅RETRY策略） */
    retryDelay?: number;
    /** 是否使用指数退避（仅RETRY策略） */
    exponentialBackoff?: boolean;
    /** 回退值（仅FALLBACK策略） */
    fallback?: unknown;
    /** 回退函数（仅FALLBACK策略） */
    fallbackFn?: (error: GeomStoreError) => unknown;
    /** 恢复函数（仅RECOVER策略） */
    recoverFn?: (error: GeomStoreError) => unknown;
    /** 是否需要恢复的条件函数 */
    shouldRecover?: (error: GeomStoreError) => boolean;
    /** 重试前的回调 */
    onRetry?: (error: GeomStoreError, attempt: number) => void;
    /** 恢复成功的回调 */
    onRecovery?: (error: GeomStoreError, result: unknown) => void;
    /** 恢复失败的回调 */
    onRecoveryFailed?: (error: GeomStoreError, recoveryError: Error) => void;
}
```

### `RecoveryContext`

```ts
/**
 * 恢复上下文
 *
 * @interface RecoveryContext
 * @description
 * 提供错误恢复过程中的上下文信息
 */
export interface RecoveryContext {
    /** 原始错误 */
    error: GeomStoreError;
    /** 恢复配置 */
    config: RecoveryConfig;
    /** 当前重试次数 */
    attempt: number;
    /** Store名称（如果适用） */
    storeName?: string;
    /** 操作名称（如果适用） */
    operation?: string;
}
```

### `RecoveryStrategy`

```ts
/**
 * 错误恢复策略类型
 *
 * @enum {string}
 * @description
 * 定义不同的错误恢复策略：
 * - RETRY: 延迟后重抛原错误，由调用方重试（库内无原操作引用，无法自动重试）
 * - FALLBACK: 使用回退值
 * - IGNORE: 忽略错误
 * - RESTART: 重启相关组件
 * - RECOVER: 执行自定义恢复逻辑
 */
export declare enum RecoveryStrategy {
    RETRY = "retry",
    FALLBACK = "fallback",
    IGNORE = "ignore",
    RESTART = "restart",
    RECOVER = "recover"
}
```

### `RecoveryStrategyMap`

```ts
/**
 * 错误恢复策略映射
 *
 * @type {RecoveryStrategyMap}
 * @description
 * 将错误代码映射到恢复配置
 */
export type RecoveryStrategyMap = Record<string, RecoveryConfig>;
```

### `SelectorError`

```ts
/**
 * Selector相关错误
 *
 * @class SelectorError
 * @extends GeomStoreError
 * @description
 * 表示Selector执行过程中发生的错误，包括：
 * - Selector不存在
 * - Selector执行失败
 * - Selector参数错误
 *
 * @example
 * ```typescript
 * throw new SelectorError(
 *   'Selector "getUser" execution failed',
 *   'SELECTOR_EXECUTION_ERROR',
 *   {
 *     selectorName: 'getUser',
 *     state: { user: null }
 *   }
 * )
 * ```
 */
export declare class SelectorError extends GeomStoreError {
    constructor(message: string, code: string, context?: Record<string, unknown>);
}
```

### `StateError`

```ts
/**
 * State相关错误
 *
 * @class StateError
 * @extends GeomStoreError
 * @description
 * 表示状态操作过程中发生的错误，包括：
 * - 状态键不存在
 * - 状态值类型错误
 * - 状态更新失败
 *
 * @example
 * ```typescript
 * throw new StateError(
 *   'State key "user" does not exist',
 *   'STATE_KEY_NOT_FOUND',
 *   {
 *     storeName: 'user-store',
 *     key: 'user',
 *     availableKeys: ['name', 'email']
 *   }
 * )
 * ```
 */
export declare class StateError extends GeomStoreError {
    constructor(message: string, code: string, context?: Record<string, unknown>);
}
```

### `ValidationError`

```ts
/**
 * 验证错误
 *
 * @class ValidationError
 * @extends GeomStoreError
 * @description
 * 表示数据验证过程中发生的错误，包括：
 * - 参数验证失败
 * - 状态验证失败
 * - 类型验证失败
 *
 * @example
 * ```typescript
 * throw new ValidationError(
 *   'Invalid state value: expected number, got string',
 *   'VALIDATION_ERROR',
 *   {
 *     storeName: 'user-store',
 *     key: 'count',
 *     expectedType: 'number',
 *     receivedType: 'string',
 *     value: '10'
 *   }
 * )
 * ```
 */
export declare class ValidationError extends GeomStoreError {
    constructor(message: string, code: string, context?: Record<string, unknown>);
}
```

### `createDefaultErrorRecovery`

```ts
/**
 * 创建默认的错误恢复器
 *
 * @param {RecoveryStrategyMap} [strategies] - 自定义策略
 * @returns {ErrorRecovery} 错误恢复器实例
 *
 * @example
 * ```typescript
 * const recovery = createDefaultErrorRecovery({
 *   [ErrorCode.ACTION_TIMEOUT]: {
 *     strategy: RecoveryStrategy.RETRY,
 *     maxRetries: 3,
 *     retryDelay: 1000
 *   }
 * })
 * ```
 */
export declare function createDefaultErrorRecovery(strategies?: RecoveryStrategyMap): ErrorRecovery;
```

### `createDefaultMonitoring`

```ts
/**
 * 创建默认的错误监控系统
 *
 * @param {Partial<MonitoringConfig>} [config] - 配置选项
 * @returns {ErrorMonitoring} 错误监控系统实例
 *
 * @example
 * ```typescript
 * const monitoring = createDefaultMonitoring({
 *   enableConsoleLog: true,
 *   batchInterval: 10000
 * })
 * ```
 */
export declare function createDefaultMonitoring(config?: Partial<MonitoringConfig>): ErrorMonitoring;
```

### `createError`

```ts
/**
 * 根据错误代码创建错误实例
 *
 * @param {ErrorCode} code - 错误代码
 * @param {string} message - 错误消息
 * @param {Record<string, unknown>} [context] - 错误上下文
 * @returns {GeomStoreError} 对应的错误实例
 *
 * @example
 * ```typescript
 * const error = createError(
 *   ErrorCode.ACTION_NOT_FOUND,
 *   'Action not found',
 *   { actionName: 'missing' }
 * )
 * // 返回 ActionError 实例
 * ```
 */
export declare function createError(code: ErrorCode, message: string, context?: Record<string, unknown>): GeomStoreError;
```

### `createErrorContext`

```ts
/**
 * 创建错误上下文
 */
export declare function createErrorContext(storeName: string, operation: OperationType, error: Error, level?: ErrorLevel, payload?: unknown): ErrorContext;
```

### `defaultErrorHandler`

```ts
defaultErrorHandler: ErrorHandler
```

### `defaultErrorRecovery`

```ts
defaultErrorRecovery: ErrorRecovery
```

### `getDefaultMonitoring`

```ts
/**
 * 获取全局默认的错误监控实例（惰性单例）
 *
 * @returns {ErrorMonitoring} 默认错误监控实例
 */
export declare function getDefaultMonitoring(): ErrorMonitoring;
```

### `isActionError`

```ts
/**
 * 检查是否为ActionError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is ActionError} 是否为ActionError
 */
export declare function isActionError(error: unknown): error is ActionError;
```

### `isComposeError`

```ts
/**
 * 检查是否为ComposeError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is ComposeError} 是否为ComposeError
 */
export declare function isComposeError(error: unknown): error is ComposeError;
```

### `isGeomStoreError`

```ts
/**
 * 错误类型守卫
 *
 * @description
 * 提供类型安全的错误检查函数，用于错误处理逻辑。
 */
/**
 * 检查是否为GeomStoreError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is GeomStoreError} 是否为GeomStoreError
 *
 * @example
 * ```typescript
 * try {
 *   store.dispatch('action')
 * } catch (error) {
 *   if (isGeomStoreError(error)) {
 *     console.log(error.code, error.context)
 *   } else {
 *     // 处理其他类型的错误
 *   }
 * }
 * ```
 */
export declare function isGeomStoreError(error: unknown): error is GeomStoreError;
```

### `isPluginError`

```ts
/**
 * 检查是否为PluginError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is PluginError} 是否为PluginError
 */
export declare function isPluginError(error: unknown): error is PluginError;
```

### `isSelectorError`

```ts
/**
 * 检查是否为SelectorError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is SelectorError} 是否为SelectorError
 */
export declare function isSelectorError(error: unknown): error is SelectorError;
```

### `isStateError`

```ts
/**
 * 检查是否为StateError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is StateError} 是否为StateError
 */
export declare function isStateError(error: unknown): error is StateError;
```

### `isValidationError`

```ts
/**
 * 检查是否为ValidationError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is ValidationError} 是否为ValidationError
 */
export declare function isValidationError(error: unknown): error is ValidationError;
```

### `withErrorBoundary`

```ts
/**
 * 创建错误边界装饰器
 *
 * 用于装饰类方法，自动处理方法执行时的错误
 *
 * @param {ErrorBoundaryOptions} [options] - 配置选项
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class MyComponent {
 *   @withErrorBoundary({
 *     fallback: { count: 0 },
 *     onError: (error) => console.error(error)
 *   })
 *   async loadData() {
 *     return await fetchData()
 *   }
 * }
 * ```
 */
export declare function withErrorBoundary(options?: ErrorBoundaryOptions): (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor) => PropertyDescriptor;
```
