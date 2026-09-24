# `./extras/error` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.8.1`
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
    constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown);
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
    constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown);
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
     * 分组里，故闭合放在 grouped 之后无条件执行；`grouped` 的异常本身继续向外传播
     * （见类文档），且**不被闭合自身的异常掩盖**——否则监控层重试的是 groupEnd 的
     * 故障，真正的失败原因从现场消失。grouped 成功时，groupEnd 的异常仍是本报告器
     * 的一次真实失败，继续外抛（吞掉会把「一条都没落地」判成上报成功）
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
 *
 * 两套口径要分清（`getStats` 里同时给出）：
 * - **账目**（`totalErrors` / `byCode` / `byStore`）按条累计，自 `clear()` 起单调不减，
 *   与组是否被 `maxGroups` 驱逐无关；
 * - **分组视图**（`totalGroups` / `getGroups()` / `getGroupsByStore()`）只反映当前存活的组，
 *   会随驱逐变小，差额记在 `evictedGroups` / `evictedErrors` 里。
 */
export declare class ErrorAggregator {
    /** groupId → 组及其记账数据 */
    private readonly groups;
    /**
     * 指纹原文 → groupId 的反向索引
     *
     * 组 ID 只由 32 位哈希压缩而来，必然存在碰撞概率；这里保留「同一指纹 ⇒ 同一 ID」的
     * 映射，命中已有键时复用原 ID，未登记时才线性探测空闲槽位，避免无关错误被静默折叠成
     * 同一组（那会让 `count` 与 `affectedStores` 从此失真且无从发现）。
     *
     * 存**正向**表（groupId → 指纹）不足以保证该不变量：驱逐一组时只能删掉它的条目，
     * 于是排队探测到 `base~2` 的指纹会在占着 `base` 的邻居被驱逐后改判到 `base`，
     * 同一指纹从此分裂成两个组（旧组仍在 `base~2` 累计，新组从 count=1 重新起算）。
     * 反向表按指纹寻址，ID 一旦分配就不再改；条目与组同生命周期（建组时写入、驱逐/clear 时删除），
     * 故规模同样被 maxGroups 约束，不会单独增长。
     */
    private readonly groupIdByFingerprint;
    /** 存活组数量上限（只约束「组本体驻留多少组」，不约束账目，见 `getStats`） */
    private readonly maxGroups;
    /**
     * 自上次 `clear()` 以来观测到的错误条数（每次 `addError` 加一，驱逐不减）
     *
     * 这是 `totalErrors` 的唯一来源。此前它由「存活组的 count 求和」现算，于是 maxGroups
     * 驱逐会把已发生过的错误整笔抹掉：两次 `generateReport()` 之间 totalErrors 会**变小**，
     * 与它在 `ErrorMonitoring` 里被钉下的口径（「观测到的错误数」）相反。
     */
    private observedErrors;
    /** 按错误码的累计账目（键集合有限，无需上限） */
    private readonly observedByCode;
    /** 按 Store 的累计账目，Store 基数超上限后并入 `OTHER_STORES_BUCKET` */
    private readonly observedByStore;
    /** 因 maxGroups 驱逐而消失的组数（账目已转入 `observedByCode`/`observedByStore`，此处只是留痕） */
    private evictedGroups;
    /** 因 maxGroups 驱逐而消失的组内错误条数 */
    private evictedErrors;
    /** 首次驱逐时出声一次：之后再驱逐只累计计数，不在错误高发路径上重复刷屏 */
    private evictionWarned;
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
     * 按最近出现时间倒序，条目为浅拷贝（改返回值不影响内部状态）
     *
     * @returns {ErrorGroup[]} 错误组数组
     */
    getGroups(): ErrorGroup[];
    /**
     * 获取指定Store的组
     *
     * 口径限制：某组波及的 Store 数超过 `MAX_STORES_PER_GROUP` 后，后到的 Store 只以
     * `__others__` 桶计入该组的 `affectedStores`（计数照常累计，见 {@link getStats}），
     * 故对本方法而言「没返回某组」**不等于**该 Store 没在那组里报错。
     * 要按 Store 拿准确的错误条数请用 `getStats().byStore`。
     *
     * @param {string} storeName - Store名称
     * @returns {ErrorGroup[]} 错误组数组
     */
    getGroupsByStore(storeName: string): ErrorGroup[];
    /**
     * 记一条错误的账：总数、按错误码、按 Store 三张表同时推进
     *
     * 三处必须一起改，否则 `sum(byCode) === sum(byStore) === totalErrors` 的账目不变量就会破。
     * 单独按条计数而非「把存活组的 count 求和」：错误组会把同一站点在不同 Store 的报错合并为一条，
     * 若把整组 count 记给每个受影响 Store，跨 Store 的组会重复计入（那正是此前
     * `sum(byStore) > totalErrors` 的来源）；而按组求和还会让 maxGroups 驱逐把已发生过的
     * 错误整笔抹掉（totalErrors 倒退）。求和口径与驱逐留痕由此分开。
     *
     * @private
     */
    private _account;
    /**
     * 把一个 Store 逐个登记进某个组的 `affectedStores`
     *
     * 去重走 `entry.storeNames`（Set），不再是 `affectedStores.includes` 的线性扫描——
     * 本方法在 `report()` 的错误高发路径上，数组越长每次聚合越贵。
     * 达到 `MAX_STORES_PER_GROUP` 后只留一个 `__others__` 桶标记并出声一次：
     * 截断的是「列得全不全」这份诊断视图，条数账目由 `_account` 独立负责，不受影响。
     *
     * @private
     */
    private _recordGroupStore;
    /**
     * 清理旧的错误组
     *
     * 只驱逐「最近最少出现」的一组，不复用 getGroups()：那会把整个 Map 复制成数组
     * 再排序（O(n log n) + n 个临时对象），而本方法在组数达到上限后的**每次** addError
     * 都会进入，属于错误高发期的热路径。线性扫描取最小 lastSeen 即可，不分配临时数组。
     * 新增一组最多越界一组，while 只是对 maxGroups 被改小等异常情形的兜底。
     *
     * 驱逐同时留痕（`evictedGroups` / `evictedErrors`）：组本体的 count 随组消失，
     * 但条数账目早在 `addError` 里按条落定，故 totalErrors 不因此倒退。
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
     * 真正的缺陷不在此而在「哈希相同即并入」，由 resolveGroupId 的指纹→ID 反向索引兜住。
     *
     * @private
     */
    private buildFingerprint;
    /**
     * 由指纹求出（无碰撞的）组 ID
     *
     * 哈希只用于压缩 Map 键长，不承担正确性：先在反向索引里复用该指纹既有的 ID，
     * 未登记时按 `base~n` 线性探测一个**当前空闲**的槽位（被别的组占着就继续探），
     * 因此不同指纹永不共享同一组。ID 的实际占用与索引由 `addError` 的建组分支一起写入。
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
     * 清空所有错误组与全部账目
     *
     * 驱逐留痕一并归零：`evictedErrors`/`evictedGroups` 与 `getStats()` 各项的口径都是
     * 「自上次 `clear()` 以来」（与 `ErrorMonitoring.getDroppedErrors()` 同一约定）
     */
    clear(): void;
    /**
     * 获取统计信息
     *
     * 口径：`totalErrors` / `byCode` / `byStore` 是**自上次 `clear()` 以来观测到的全部错误**，
     * 与组是否被 maxGroups 驱逐无关，因此三者随时间单调不减，且恒有
     * `sum(byCode) === sum(byStore) === totalErrors`。
     * `totalGroups` 与 `getGroups()` 则只反映**当前存活**的组（驱逐后必然变小），
     * 两者的差额由 `evictedGroups` / `evictedErrors` 说明——聚合丢过数据在这里看得见。
     *
     * 返回的是新建对象，调用方改写不影响内部账目。
     *
     * @returns {object} 统计信息
     */
    getStats(): {
        totalGroups: number;
        totalErrors: number;
        byCode: {
            [k: string]: number;
        };
        byStore: {
            [k: string]: number;
        };
        evictedGroups: number;
        evictedErrors: number;
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
 * @template S - 状态类型（作为回退计算函数的上下文）
 * @template F - 回退值类型（与 S 解耦：回退值不必是状态对象）
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
     * @returns {T | F | undefined} 函数执行结果；错误且可恢复时返回回退值 `F`，
     *   可恢复但未配 fallback 时返回 undefined
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
     * @returns {Promise<T | F | undefined>} 函数执行结果，如果错误且可恢复则返回回退值（未配 fallback 时为 undefined）
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
     * @returns {F | undefined} 回退值（若配置）；未配置回退时返回 undefined
     * @throws {Error} 如果错误且不可恢复
     */
    private handleError;
    /**
     * 获取回退状态
     *
     * @returns {F | undefined} 回退值；若配置为计算函数则需结合错误上下文调用，此处返回undefined
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
     * @param {F} state - 新的回退值
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
 *
 * 返回类型写的是 `void`，但 TS 允许把 `async (ctx) => ...`（返回 `Promise<void>`）赋给它——
 * 同文件已发布的 {@link ErrorReporter} 就是异步的，`(ctx) => reporter.report(ctx)` 这类处理器
 * 看起来很自然地写得出来。
 *
 * 库内调用侧（`extras/error/ErrorHandler.ts` 的 `ErrorHandlerImpl.handleError`）会给返回的
 * thenable 补 `.catch`，异步失败归口到「处理器自身失败」的告警；但那层兜底**只覆盖库内入口**：
 * `ErrorHandler` 是公开类型，消费方自己组织的调用（交给聚合器、放进自建的 try/catch 循环）拿到的
 * 是一个被丢弃的 Promise，rejection 无人接即成 unhandledRejection（Node 下可直接终止进程）。
 * 所以处理器仍要自行吞掉失败（`.catch(...)` / try-await-catch），或干脆只把数据入队、
 * 由外部自己的周期任务去 flush——不要把「返回值会被别人接住」当前提
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
     * @remarks 允许传 async 函数（TS 的 void 返回签名并不排除它）：**被返回的那条 Promise**
     * 的 rejection 由 {@link ErrorHandlerImpl.handleError} 接住并折成一条 `console.error`，
     * 调用方拿不到「handler 失败」的信号；handler 内部另起而未返回的 Promise 不在保护范围内，
     * 需自行兜底。
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
     * 把原始错误顶替成二次异常，会让现场只剩 handler 的堆栈。异步 handler（返回 Promise 的
     * 函数可赋给 `(context) => void` 的签名）的 rejection 同样被接住并折成同一条日志——
     * 否则「上报错误」这条链路自己就能把进程搞崩（Node 下 unhandledRejection 可终止进程）。
     * context 在调用 handler 之前已写入 errorLog，因此 handler 长期失效时仍可由
     * `getErrorLog()`/`getErrorStats()` 观察到错误在累积——这是该取舍的兜底通道，也是不额外加
     * `onHandlerError` 钩子的理由（钩子本身同样可能抛错，且要新增公开 API）。
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
     * 或 `ctx.error = ...` 就会污染此后所有查询与统计，故对外一律给副本——
     * 交给 handler 的那一份同样如此（handler 是长期驻留的用户代码，最容易出现「顺手改一下」）。
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
     * @param {number} size - 最大日志数量（必须 >= 1；小数向下取整，非有限值回退 {@link DEFAULT_MAX_LOG_SIZE}）
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
    /** 本模块私有的一份报告器列表（构造期复制，见 `normalizeReporters`） */
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
    /** 防止队列无限增长的最大大小（由 MonitoringConfig.maxQueueSize 经下限裁剪得到） */
    private readonly maxQueueSize;
    /** 连续「全部报告器失败」的 flush 次数：用于给重入队加上限，见 doFlushReports */
    private consecutiveFlushFailures;
    /** 重入队重试上限：超过后丢弃该批并告警，避免永久失败批次无限空转 */
    private readonly maxFlushRetries;
    /**
     * 数据代际：`clear()` 递增
     *
     * 用于作废 clear() 之前发起的在途 flush——它的批次属于上一代数据，
     * 全部报告器失败时不得再重新入队（见 doFlushReports 的判定）
     */
    private generation;
    /** 因队列溢出被丢弃的错误条数（含入队淘汰与重入队裁剪两条路径） */
    private droppedErrors;
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
     * `summary.totalErrors` 的口径是「**观测到的**错误数」（聚合启用时取
     * `ErrorAggregator.getStats().totalErrors`，禁用时取 nonAggregatedErrorCount），其中：
     * - 因队列溢出被丢弃的部分从未投递给任何 reporter 却仍然计入——它们是真实发生过的错误；
     *   被丢弃的量随报告给出（`summary.droppedErrors`），不必再取
     *   {@link ErrorMonitoring.getDroppedErrors}；`summary.queuedErrors` 只表示仍在队列里的。
     * - 聚合组被 `maxGroups` 驱逐**不会**让它倒退：账目按条独立累计，驱逐量见
     *   `getAggregationStats()` 的 `evictedErrors` / `evictedGroups`。
     *
     * 三个字段是三个互不重叠的口径，**不能相加核对**：`droppedErrors` 记的是「被从队列里挤出去」
     * 的次数（被挤掉的那条在它自己那次 `report()` 里已经计入 `totalErrors`），
     * 而成功投递过的错误既不在 `queuedErrors` 里也不在 `droppedErrors` 里。
     *
     * 注意 `summary.totalGroups` / `topErrors` / `recentErrors` 只反映**当前存活**的组，
     * 与 `totalErrors` 不是同一口径（前者会随驱逐变小）。
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
     * 透传 `ErrorAggregator.getStats()`：除 `totalGroups`（存活组数）外的各项都是
     * 「自上次 clear() 以来观测到的」口径，另含驱逐留痕 `evictedGroups` / `evictedErrors`。
     *
     * @returns {object} 聚合统计
     */
    getAggregationStats(): {
        totalGroups: number;
        totalErrors: number;
        byCode: {
            [k: string]: number;
        };
        byStore: {
            [k: string]: number;
        };
        evictedGroups: number;
        evictedErrors: number;
    };
    /**
     * 获取错误组
     *
     * 返回浅拷贝（`affectedStores` 与 `sampleError` 也各拷一层）：内部组长期驻留且仍会随
     * 新错误继续累计，直接交出引用等于让调用方一句 `group.count = 0` 就改坏
     * `getAggregationStats()`/`byStore`/`byCode` 的账目
     *
     * @returns {ErrorGroup[]} 错误组
     */
    getErrorGroups(): ErrorGroup[];
    /**
     * 获取因队列溢出被丢弃的错误条数
     *
     * 两条路径都会累加：入队时容量已满（淘汰最旧一条）、失败批次重入队时超出容量
     * （裁掉队首）。`clear()` 会把它与其余数据一起归零，故该值表示「自上次 clear() 以来」
     * 的丢失量
     *
     * @returns {number} 被丢弃的错误条数
     *
     * @example
     * ```typescript
     * const dropped = monitoring.getDroppedErrors()
     * if (dropped > 0) console.warn(`上报链 overloaded, ${dropped} errors dropped`)
     * ```
     */
    getDroppedErrors(): number;
    /**
     * 清除所有数据
     *
     * 只清数据（队列、聚合统计、连续失败计数、丢弃计数），不停止周期调度器、也不影响在途
     * flush 的**网络请求本体**——但代际会切换，故在途 flush 不会再把它抓到的旧批次
     * 重新入队（见 doFlushReports）；调度器仍会到期 flush 清除后新入队的错误；
     * 需要「停止」语义请用 shutdown()
     */
    clear(): void;
    /**
     * 添加报告器
     *
     * 写的是本实例自己的那份数组（构造期已复制，见 `normalizeReporters`）：
     * 直接 push 进调用方传进来的数组会让同一份 config 复用给两个实例时一处注册跨实例生效
     *
     * @param {ErrorReporter} reporter - 错误报告器
     */
    addReporter(reporter: ErrorReporter): void;
    /**
     * 移除报告器
     *
     * 与 {@link addReporter} 一样只作用于构造期收下的私有副本，不再出现
     * 「add 改到调用方数组、remove 另起新数组」的方向差异
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
    /**
     * 错误码 → 恢复配置
     *
     * 用 `Map` 而非对象字面量：`error.code` 是开放字符串域（`code: string`），
     * 落在 `Object.prototype` 上的码名（`constructor` / `toString` / `__proto__`）会让
     * `strategies[code]` 命中原型链成员并被当作 `RecoveryConfig` 返回——`config.strategy`
     * 为 undefined，最终抛出误导方向的「Unknown recovery strategy: undefined」，
     * 而写入侧的 `obj.__proto__ = ...` 更是直接改原型而非建键。
     */
    private readonly strategies;
    private readonly retryCount;
    /**
     * 重试键 → 当前故障周期的**到期时刻**
     *
     * 存到期时刻而非起始时间：容量守卫判定「某个键是否还在自己的周期里」时无需知道它
     * 用的是哪个策略的退避参数（不同 code 的周期窗可差几个数量级），因此也不必拿一个
     * 硬编码下限去比——那会把仍在自身窗口内的活跃键连计数一起删掉（风控被削弱）。
     */
    private readonly retryCycleEnd;
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
     * @param {RecoveryContext} [context] - 本次恢复的调用上下文
     * @returns {string} 重试键
     *
     * @remarks 隔离粒度是「**被报出来的** Store/操作」，不是调用方身份：两处来源都缺时
     * 库内已无任何可区分的信息（`error.code` 已在键里，堆栈会把「同一逻辑故障在不同行
     * 构造」打散成多份额度，反而让防重试风暴失效——`REGR-RECOVERY-003` 锁的正是它们
     * 必须共用一份额度），此时**所有**未归因的调用共用一份额度，这是有意的粗粒度兜底。
     * 该桶在键名与抛出物里都写作 `unattributed` 并随 `retryKey` 一起回传，
     * 便于识别「被用满的是哪一份额度」；需要按 Store 隔离就由调用方传
     * `recover(error, { storeName, operation })`，或在 createError 的 context 里内嵌二者。
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
        /**
         * 上报队列溢出后被丢弃的错误条数（`ErrorMonitoring` 的 `droppedErrors`）。
         * 报告必须自带这一项：只有 `getDroppedErrors()` 可取时，拿到报告快照的调用方
         * （写日志、上传、看板）看到的是一个「总数对得上」的报表，而实际上报链已经丢过数据，
         * 丢包在下游完全不可见。
         */
        droppedErrors: number;
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
 * `context` 在构造期做浅拷贝、在 `toJSON()` 里做环路/BigInt 归一，
 * 二者共同保证：错误对象既不会被调用方事后改写的入参污染，也不会把
 * 「打印错误」变成第二次抛错。
 *
 * 包装底层异常时把原始抛出值作为第 5 个实参（派生类第 4 个）传入，它会保存在
 * `error.cause` 上并随 `toJSON()` 输出，不再像此前那样被丢弃。
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
     * 被本错误包装掉的原始抛出值（如果调用方提供了）
     *
     * target/lib 为 ES2020，`Error` 构造器没有 `cause` 选项签名，故按属性赋值补齐
     * （与 extras 的 attachCause 同口径）。缺省时不写入该属性。
     * @type {unknown}
     */
    readonly cause?: unknown;
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
     * @param {unknown} [cause] - 触发本错误的原始抛出值；不传则不挂 cause
     *
     * @example
     * ```typescript
     * throw new GeomStoreError(
     *   'Action not found',
     *   'ACTION_NOT_FOUND',
     *   { actionName: 'missingAction', storeName: 'test-store' }
     * )
     * ```
     *
     * @example
     * ```typescript
     * // 包装底层异常：原始错误与其堆栈随 cause 一并保留
     * try {
     *   fs.writeFileSync(file, data)
     * } catch (original) {
     *   throw new StateError('Persist state failed', 'STATE_UPDATE_ERROR', { file }, original)
     * }
     * ```
     */
    constructor(message: string, code: string, context?: Record<string, unknown>, name?: string, cause?: unknown);
    /**
     * 将错误对象转换为JSON格式
     *
     * @remarks 返回值含完整 `stack`：本方法的契约是**开发者诊断/日志**用途（ERROR-008
     * 亦锁定了该形状），堆栈是排障必需信息，故不裁剪、也不按 NODE_ENV 分支（生产构建
     * 里堆栈同样重要）。**不要把结果直接回传客户端或写入持久化存储**——小程序包路径与
     * 内部实现细节会随之外泄；对外上报请只取 `name`/`message`/`code`/`context`。
     *
     * @remarks `context` 在此处过一遍 `toSerializableValue`：环路/BigInt/取值即抛的访问器
     * 会被换成字符串标记，因此 `JSON.stringify(error)`（它会调用本方法）不会因这些值抛错，
     * 错误上报通道不会变成第二次故障。带 `toJSON` 的对象：序列化器给出原始值（Date 等）时
     * 按其自身序列化器处理（本方法返回值里仍是那个 Date 对象）；给出对象/数组时其结果继续
     * 走同一套深度/环路归一，序列化器自身抛错则换成 `'[Unreadable]'`——即本方法对 context
     * 的兜底**覆盖**自定义序列化器，深树与抛错的序列化器都不会再把故障升级成 RangeError/TypeError。
     *
     * @remarks `cause` 仅在构造期提供时才带上（未包装底层错误时输出形状不变，ERROR-008
     * 锁定的仍是 name/message/code/context/stack 五个键），并过同一套归一，
     * 使「是谁被包装掉了」在日志里可见。cause 带 `toJSON`（本库错误系即在此）时取其
     * `toJSON()` 的结果，故被包装者的 `code`/`context`/内层 cause 不丢。
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
     * 发出一次上报请求（单条与批量共用同一条传输路径）
     *
     * 失败一律向上抛出：ErrorMonitoring 的「全部报告器失败则重新入队重试」依赖
     * reportBatch reject 判定失败，此处吞错会让重试机制成为死代码，网络抖动/服务端 5xx
     * 时上报数据被静默丢弃。直接使用本类的调用方需自行 catch；内部批量管线
     * （doFlushReports）已对 rejection 兜底。两个入口若各写一遍参数拼装，
     * 调用签名变更时只会改到一处（另一处静默漂移），故收在这里
     */
    private send;
    /**
     * 由**对象**产出一份请求体 JSON 文本
     *
     * `JSON.stringify` 作用于对象字面量时结果至少为 `'{}'`，据此把返回值收窄为
     * {@link JsonBody}，使下游解析不必再做空串防御。批量体另有
     * {@link buildBatchBody}（拼接已序列化片段，不重新序列化）
     */
    private buildRequestBody;
    /**
     * 单个 ErrorContext 的上报投影（**未**序列化）
     *
     * 单条与批量两条路径共用：两处各写一份字段映射时，新增/改名字段只会落到其中一条，
     * 服务端收到的单条与批量负载就会静默漂移。
     *
     * 本方法**允许抛错**（例如某字段是只在第二次取值才失效的非幂等 getter），
     * 兜底在 {@link serializeContextItem}；序列化口径见 {@link toSerializableScalar}
     * 与 {@link toSerializablePayload}。
     *
     * @private
     */
    private serializeContext;
    /**
     * 一条上下文的完整序列化结果（单条上报的 body、批量上报的一个片段）
     *
     * 「不可序列化」的防线到这里才算闭合：投影阶段挡得住 BigInt / 循环引用，但挡不住
     * 只在**第二次**取值才失效的非幂等 getter / `toJSON`（先验证串一遍、再把原值交给外层
     * 重串，两次之间没有任何保证）。故每条上下文各自序列化**一次**，并单独兜底：
     * 本条导致整体不可序列化时只把这一条换成标记片段，批次其余条目照常交付，
     * `reportBatch` 不因单条畸形而 reject（那会被监控层判成网络失败并按 maxFlushRetries
     * 重入队，最终把整批丢弃，且丢弃原因显示为「报告器恒失败」而非「这条上下文畸形」）
     */
    private serializeContextItem;
    private serializeErrorBatch;
    /**
     * 由**已序列化的条目片段**拼出批量请求体
     *
     * 刻意不走 `JSON.stringify({ errors: [...] })`：那会把每个条目**再序列化一次**，
     * 于是投影阶段「验证一遍 + 外层重串」之间的空档又回来了，一条畸形上下文就足以让
     * 整个批次 reject。每个片段都出自一次成功的 `JSON.stringify`（失败者已被换成标记片段），
     * 拼接结果因此必是合法 JSON
     */
    private buildBatchBody;
    /**
     * 将 RequestInit.headers 归一化为普通键值对象，
     * 兼容 Headers / string[][] / Record 三种形式
     *
     * @remarks 本方法只做**形式归一**、不注入任何头：JSON content-type 的兜底发生在
     * 默认请求实现里（见 `withJsonContentType`），因为「发不发这个头」属于传输细节，
     * 而注入的 `HttpRequestImpl` 自行决定请求形态
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
    /**
     * 聚合组数量上限（`ErrorAggregator` 的存活组上限，缺省 100）
     *
     * 只约束「同时存活多少组」：被驱逐的组不再出现在 `getGroups()` / `summary.totalGroups`
     * 里，但其错误条数已按条累计，不会从 `totalErrors`/`byCode`/`byStore` 里消失，
     * 驱逐量单独记在 `getAggregationStats()` 的 `evictedGroups` / `evictedErrors`。
     * 非有限值 / 小于 1 归回缺省值。
     */
    maxGroups?: number;
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
    constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown);
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
     * 负数与 0 同（`currentAttempt >= maxRetries` 恒成立），均非「无限重试」语义。
     * 小数向下取整；**非有限值（NaN / Infinity）回落到默认 3**——`currentAttempt >= NaN`
     * 恒为 false会让上限彻底失效、Infinity 则永远达不到，两者都会让重试按调用方的失败
     * 循环一路跑下去，正是本字段要防的重试风暴
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
     * 表示「显式回退到 undefined」。会真正丢掉这个键的是 **JSON 序列化/反序列化**
     * （`JSON.parse(JSON.stringify(config))` 直接不写出 undefined 值属性）、**条件展开**
     * （`...(ok ? { fallback: v } : {})` 为假时整键消失）与解构改名，搬运 config 时避开它们。
     * 普通浅展开 `{ ...config }` 与 `Object.assign` 都保留自有可枚举键（值为 undefined
     * 也保留，`'fallback' in copy === true`），`configure()` 内部的归一化正是这么做的，
     * 不必绕路。做成 `{ value: unknown }` 之类的判别式联合能消除这层歧义，但会破坏已发布的
     * 公开配置形状，故保留现形并在此写明判据。
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
    constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown);
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
    constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown);
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
    constructor(message: string, code: string, context?: Record<string, unknown>, cause?: unknown);
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
 * `reporters` 只在调用方真给出数组时才覆盖默认值：`config` 是 `Partial<MonitoringConfig>`，
 * 显式写成 undefined 的 `reporters` 键（本库未开 `exactOptionalPropertyTypes`）会把默认的
 * {@link ConsoleReporter} 顶掉，故这里按「缺省 === 未配置」处理而不是无条件展开。
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
 * @param {unknown} [cause] - 触发本次失败的原始抛出值，随实例的 cause 保留
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
export declare function createError(code: ErrorCode, message: string, context?: Record<string, unknown>, cause?: unknown): GeomStoreError;
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
