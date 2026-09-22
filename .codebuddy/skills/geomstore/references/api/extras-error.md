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
 *
 * 失败传播是有意为之：本报告的输出若抛错（自定义 console、被 stub 的
 * `console.error`），异常向上交给 `ErrorMonitoring.doFlushReports`，由其折成
 * 「该报告器 fail」并让整批重新入队重试。此处静默吞掉的话，管线会把
 * 「一条都没落地」判成上报成功并丢弃批次（见其 `anyReporterSucceeded` 分支）。
 */
export declare class ConsoleReporter implements ErrorReporter {
    private readonly prefix;
    /**
     * 分组能力是否已在本次运行中被证实不可用
     *
     * `console.group` 存在但调用即抛的运行时（占位实现）只试探一次，
     * 之后直接走平铺路径；按实例记录，避免一个报告器的探测结果污染其他实例。
     */
    private groupUnavailable;
    /**
     * @param prefix 日志前缀，默认 `[ErrorMonitoring]`
     */
    constructor(prefix?: string);
    getName(): string;
    report(context: ErrorContext): Promise<void>;
    reportBatch(contexts: ErrorContext[]): Promise<void>;
    /**
     * 以分组方式执行 `grouped`，不具备分组能力（缺失或调用即抛）时执行 `flat`
     *
     * 组必须闭合：组内输出抛错时少一次 `groupEnd` 会让后续所有输出留在已打开的
     * 分组里，故闭合放在 finally；`grouped` 的异常本身继续向外传播（见类文档）。
     *
     * @param decorate 标签装饰器，分组路径原样输出（`'Error:'`），
     *        平铺路径由调用方加上头部信息（`'[prefix] ERROR Error:'`）
     * @private
     */
    private runGrouped;
    /**
     * 输出一条错误上下文的全部字段
     *
     * 分组与平铺两条路径共用同一份实现（此前复制了四遍，改格式要同步四处且已出现
     * 级别大小写漂移）。
     *
     * @private
     */
    private printContext;
    /**
     * 输出批量报告中的一条（分组与平铺路径同格式）
     *
     * @private
     */
    private printBatchEntry;
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
     * 按错误组保存的「Store → 该组内该 Store 的次数」
     *
     * 单独按次计数而非按组求和：错误组会把同一站点在不同 Store 的报错合并为一条，
     * 若把组 count 累加给每个受影响 Store，跨 Store 的组会重复计入，byStore 之和超过 totalErrors。
     * 计数随组一起存放，组被 maxGroups 驱逐时同步消失，因此
     * `sum(byStore) === totalErrors` 在驱逐后依旧成立（此前独立累计的口径会永久偏离）。
     */
    private readonly storeHits;
    /**
     * groupId → 指纹原文
     *
     * 组 ID 只由 32 位哈希压缩而来，必然存在碰撞概率；这里保留指纹原文，
     * 命中已有键时严格比对指纹，不同则向后探测新键，避免无关错误被静默折叠成
     * 同一组（那会让 `count` 与 `affectedStores` 从此失真且无从发现）。
     */
    private readonly fingerprints;
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
     * 记录一次「组内某 Store」的错误计数
     *
     * @private
     */
    private _countStoreHit;
    /**
     * 清理旧的错误组
     *
     * 只驱逐「最近最少出现」的一组，不复用 getGroups()：那会把整个 Map 复制成数组
     * 再排序（O(n log n) + n 个临时对象），而本方法在组数达到上限后的**每次** addError
     * 都会进入，属于错误高发期的热路径。线性扫描取最小 lastSeen 即可，不分配临时数组。
     * 新增一组最多越界一组，while 只是对 maxGroups 被改小等异常情形的兜底。
     *
     * @private
     */
    private cleanupOldGroups;
    /**
     * 构造判定「同一错误」的指纹
     *
     * 归并粒度维持 name + message + 堆栈前 `STACK_FINGERPRINT_CHARS` 个字符：
     * 「同一逻辑错误的多次抛出跨调用点归为一组」是本库对外承诺的聚合口径
     * （ErrorMonitoring 的 MONITOR-008/014/015/062 用例即固化了它），堆栈头部长度
     * 恰好落在 file:line 之前，改成全文堆栈会把同一逻辑错误按行号打散。
     * 真正的缺陷不在此而在「哈希相同即并入」，由 resolveGroupId 的指纹严格比对兜住。
     *
     * @private
     */
    private buildFingerprint;
    /**
     * 由指纹求出（无碰撞的）组 ID
     *
     * 哈希只用于压缩 Map 键长，不承担正确性：同一哈希已被别的指纹占用时按
     * `base~n` 线性探测，命中同指纹则复用原键。
     *
     * @private
     */
    private resolveGroupId;
    /**
     * 生成随组长期驻留的样本快照
     *
     * 组缓存可存活到进程结束，直接持有调用方交来的 ErrorContext 有两个后果：
     * `payload` 常引用 store 实例 / 页面节点，等于让缓存钉住整棵对象树；
     * 而 context 在报告链路上仍会被他人持有或改写，样本会随之漂移。
     * 故留一份只含标量字段 + error 引用的浅拷贝，时间戳取归一后的 `now`。
     * `error` 本体保留：它是诊断价值最高的部分，且 `ErrorGroup.sampleError` 的类型契约
     * 要求 Error 实例（GeomStoreError 的 code 等字段也挂在其上）。
     *
     * @private
     */
    private copySample;
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
    /**
     * 汇总现存各组的按 Store 计数
     *
     * @private
     */
    private _byStoreCounts;
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
     * @throws {Error} 错误且不可恢复时重抛原始错误；可恢复但 `fallback` 函数自身抛错时
     *   同样重抛**原始**错误（回退路径已失效，不返回 undefined），见 {@link ErrorBoundary.handleError}
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
    execute<T>(fn: () => T, currentState?: S): T | F | undefined;
    /**
     * 异步执行函数并捕获错误
     *
     * 如果函数执行抛出错误，根据配置决定是恢复还是重新抛出
     *
     * @template T - 返回值类型
     * @param {() => Promise<T>} fn - 要执行的异步函数
     * @param {S} [currentState] - 当前状态（用于回退）
     * @returns {Promise<T | undefined>} 函数执行结果，如果错误且可恢复则返回undefined
     * @throws {Error} 与 {@link ErrorBoundary.execute} 同：不可恢复、或可恢复但 fallback
     *   函数自身抛错时重抛原始错误
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
    executeAsync<T>(fn: () => Promise<T>, currentState?: S): Promise<T | F | undefined>;
    /**
     * 处理错误
     *
     * @private
     * @param {unknown} rawError - 被捕获的原始抛出值（非 Error 会归一化为 Error 记录）
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
/**
 * 错误处理器类
 *
 * 用于管理GeomStore运行过程中的错误处理、记录和统计
 *
 * @class ErrorHandlerImpl
 *
 * @example
 * ```typescript
 * const errorHandler = new ErrorHandlerImpl()
 *
 * // 自定义错误处理
 * errorHandler.setHandler((context) => {
 *   console.error(`[${context.level}] ${context.error.message}`)
 * })
 *
 * // 处理错误
 * errorHandler.handle('user-store', 'state-update', new Error('Failed'))
 *
 * // 获取错误统计
 * const stats = errorHandler.getErrorStats()
 * console.log(`Total errors: ${stats.total}`)
 * ```
 */
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
     *
     * @remarks 处理器抛错被隔离成一条 `[ErrorHandler] Error in error handler:` 的
     * `console.error`，不外溢给调用方：本方法是错误链路的最后一环，让坏掉的上报 handler
     * 把原始错误顶替成二次异常，会让现场只剩 handler 的堆栈。context 在调用 handler 之前
     * 已写入 errorLog，因此 handler 长期失效时仍可由 `getErrorLog()`/`getErrorStats()`
     * 观察到错误在累积——这是该取舍的兜底通道，也是不额外加 `onHandlerError` 钩子的理由
     * （钩子本身同样可能抛错，且要新增公开 API）。
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
     * 拷贝一条错误上下文
     *
     * 内部 errorLog 存的若是交给调用方的同一个对象，一句 `ctx.level = 'critical'`
     * 或 `ctx.error = ...` 就会污染此后所有查询与统计，故对外一律给副本。
     * 浅拷贝已足够：`error`/`payload` 按约定是外部持有的不可变引用。
     *
     * @private
     */
    private copyContext;
    /**
     * 获取错误日志
     *
     * 返回所有错误上下文的副本（数组与条目均可安全修改，不影响内部状态）
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
     * @param {number} size - 最大日志数量（必须 >= 1；小数向下取整，非有限值回退默认 100）
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
     * 两个分组字段都是**稀疏**的：只包含实际出现过的级别 / 操作类型，
     * 未出现过的键不存在（而非 0），因此按 `Partial` 暴露——
     * 把它们预置成 0 会让「`Object.keys(byLevel)` 的长度」这类聚合口径失真。
     * 读侧请写 `stats.byLevel.warn ?? 0`。
     *
     * @returns {{total: number, byLevel: Partial<Record<ErrorLevel, number>>, byOperation: Record<string, number>}} 错误统计对象
     *
     * 键类型为 `string`（而非 `OperationType`）是刻意的：`OperationType` 是开放字符串
     * 联合的聚合口径，调用方传入自定义 operation 时也会原样出现在这里。
     *
     * @example
     * ```typescript
     * const stats = errorHandler.getErrorStats()
     * console.log(`Total: ${stats.total}`)
     * console.log(`Critical: ${stats.byLevel.critical ?? 0}`)
     * console.log(`Action errors: ${stats.byOperation['action-execution'] ?? 0}`)
     * ```
     */
    getErrorStats(): {
        total: number;
        byLevel: Partial<Record<ErrorLevel, number>>;
        byOperation: Record<string, number>;
    };
}
```

### `ErrorLevel`

```ts
/**
 * 错误级别
 *
 * 规范集合为 `'error' | 'warning' | 'critical' | 'info'`：
 * - `'critical'` 不是 `'error'` 的同义词，它表示「需人工介入」的致命级别，
 *   默认处理器按 error 同级输出（含堆栈），级别标签保留 CRITICAL。
 * - `'warn'` 是 `'warning'` 的历史别名（同义拼写），并非独立级别：它已随
 *   `ErrorContext` 发布给外部调用方，且 `tests/unit/core/error/ErrorHandler.test.ts`
 *   的 #36 回归（「warn 别名走 warning 通道」）与 `error-boundaries.test.ts` 仍在断言它，
 *   删除即为破坏性变更。故保留兼容，但默认处理器与 `'warning'` 归入同一分支输出。
 *   新代码一律使用 `'warning'`。
 */
export type ErrorLevel = 'error' | 'warning' | 'critical' | 'info' | /** @deprecated 同义别名，请改用 `'warning'` */ 'warn';
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
     * 立即上报队列中的错误
     *
     * 语义边界：本次 flush 发送的是进入时快照的队列，flush 期间新入队的错误
     * 不在其中；已有 flush 在途时返回该 flush 的 Promise，resolve 仅代表那一批
     * 已处理完，当前队列可能仍有条目未发送。因此本方法**不是**「排空队列」的保证，
     * 需要排空语义请使用 shutdown()（它会等在途 flush 并做最终上报）
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
     *
     * 只清数据（队列、聚合统计、连续失败计数），不停止周期调度器、也不影响在途
     * flush——调度器仍会到期 flush 清除后新入队的错误；需要「停止」语义请用 shutdown()
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
     * 计数与周期窗必须一起清。只清计数会留下陈旧窗口，
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
     * `name` 由派生类显式传入而非取 `this.constructor.name`：产物经 esbuild/terser 压缩，
     * 类名会被改写，取构造器名会让生产构建里的 `error.name` 变成不可读的短标识。
     *
     * @param {string} message - 错误消息
     * @param {string} code - 错误代码
     * @param {Record<string, unknown>} [context] - 错误上下文
     * @param {string} [name] - 错误名称（派生类传入自身类名字面量，默认 'GeomStoreError'）
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
    constructor(message: string, code: string, context?: Record<string, unknown>, name?: string);
    /**
     * 将错误对象转换为JSON格式
     *
     * @remarks 返回值含完整 `stack`：本方法的契约是**开发者诊断/日志**用途（ERROR-008
     * 亦锁定了该形状），堆栈是排障必需信息，故不裁剪、也不按 NODE_ENV 分支（生产构建
     * 里堆栈同样重要）。**不要把结果直接回传客户端或写入持久化存储**——小程序包路径与
     * 内部实现细节会随之外泄；对外上报请只取 `name`/`message`/`code`/`context`。
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
 * 注意：环境能力差异见 createDefaultRequest —— wx 分支仅 method/header/data/timeout 生效。
 */
export declare class HttpReporter implements ErrorReporter {
    private readonly endpoint;
    private readonly options;
    private readonly requestImpl;
    constructor(endpoint: string, options?: HttpReporterOptions, requestImpl?: HttpRequestImpl);
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
    /**
     * 单个 ErrorContext 的上报投影
     *
     * 单条与批量两条路径共用：两处各写一份字段映射时，新增/改名字段只会落到其中一条，
     * 服务端收到的单条与批量负载就会静默漂移。
     *
     * @private
     */
    private serializeContext;
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
    /**
     * 最大重试次数（仅 RETRY 策略）
     *
     * 缺省默认 3（ErrorRecovery.configure / executeRetryStrategy 静默补值，读本接口即知实际额度）。
     * 取值范围：正整数。0 会使首次失败直接命中「Max retries exceeded」分支而完全放弃重试；
     * 负数与 0 同（`currentAttempt >= maxRetries` 恒成立），均非「无限重试」语义
     */
    maxRetries?: number;
    /**
     * 重试延迟（毫秒）（仅 RETRY 策略）
     *
     * 缺省默认 1000。取值范围：>= 0。0 表示不等待立即重试；负数传入 setTimeout 会被
     * 归一为 0（同样是立即重试），如需退避请配 exponentialBackoff
     */
    retryDelay?: number;
    /**
     * 是否使用指数退避（仅 RETRY 策略）
     *
     * 缺省默认 true。为 true 时实际延迟为 `retryDelay * 2^已试次数`；
     * 为 false 时每次固定 retryDelay
     */
    exponentialBackoff?: boolean;
    /**
     * 回退值（仅FALLBACK策略）
     *
     * 与 {@link RecoveryConfig.fallbackFn} 的优先级：**fallbackFn 在前**，配了 fallbackFn 时
     * 本字段被忽略；两者都没配则 FALLBACK 策略抛错（`No fallback value or function configured`）。
     *
     * 类型是 `unknown` 而非某个具体形状，因此「回退值就是 undefined」是合法配置，
     * 与「没配」在类型上无法区分；引擎按 **`'fallback' in config`** 判定是否配过
     * （见 `ErrorRecovery.executeFallbackStrategy`），故默认策略里 `fallback: undefined`
     * 表示「显式回退到 undefined」。反过来说：不要靠展开/序列化搬运 config 后还指望
     * 该键保留（删掉键就等于没配回退值）。做成 `{ value: unknown }` 之类的判别式联合
     * 能消除这层歧义，但会破坏已发布的公开配置形状，故保留现形并在此写明判据。
     */
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
    /**
     * 本次恢复进入策略时该重试键已消耗的尝试次数
     *
     * 由引擎填充：`recover()` 总是以 0 起算（调用方传入的同名字段会被覆盖，避免外部
     * 伪造计数），随后 `executeRetryStrategy` 按内部计数表把它写成该键已试次数（首次为 0），
     * 因此只有 RETRY 策略下会被更新；其余策略（FALLBACK/IGNORE/RECOVER/RESTART）不做
     * 重试记账，恒为 0。本字段仅供诊断，不参与策略判定，也不会作为参数传给任何用户回调
     */
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
 * - RESTART: 重启相关组件。刻意不接受任何配置、结果恒为 undefined：与 RETRY 同理，
 *   库内不持有组件引用，无法自行重启；undefined 即「需要调用方重启」的信号，
 *   重启动作与重启对象由调用方决定，故不提供 restartFn/restartTarget 之类的钩子
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
 *
 * `timestamp` 的缺省值目前有两处（本工厂的 `Date.now()` 与 `ErrorAggregator.collect` 的
 * `context.timestamp || Date.now()`）。以本工厂为准：`ErrorContext` 是随包发布的公开类型，
 * 处理器/订阅方拿到的上下文需要「字段齐全」（`tests/unit/core/error/ErrorHandler.test.ts`
 * 的「应该生成时间戳」用例即锁住这点），采集器的那一处只是手搓 context 绕过工厂时的兜底。
 * 单一真相源要把采集器那处删掉（属 `src/extras`，本轮未动），并给测试/回放留出注入时钟的口子。
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
