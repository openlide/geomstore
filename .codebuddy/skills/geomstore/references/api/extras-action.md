# `./extras/action` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.5.2`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`./extras/action`
> - 类型声明：`./dist/extras/action.d.ts`
> - 返回索引：[`index.md`](./index.md)

### `ActionDecorator`

```ts
/**
 * Action装饰器类型
 *
 * 直接等同 lib 的 `MethodDecorator`：本项目所有公开装饰器的返回类型都是它
 * （`withLoading` / `withRetry` / `withCache` / `withDebounce` / `withThrottle` /
 * `withTimeout` / `withLog` / `createDecorator` 显式标注 `: MethodDecorator`，
 * `withErrorBoundary` 的 JSDoc 同口径）。此前自定义的 `(target: unknown, …)` 签名因参数逆变
 * 而**拒绝**这些装饰器的返回值（`const d: ActionDecorator = withRetry()` 编译不过），
 * 对外等于一个不可用的重复类型。
 */
export type ActionDecorator = MethodDecorator;
```

### `ActionErrorData`

```ts
/**
 * `errorData` 状态键的内容形态（{@link ActionLoader.getErrorData} 的返回类型）
 *
 * 由 `setError` 单点构造，因此可以给出具体形状：此前 `getErrorData` 返回 `unknown`，
 * 而它自己的文档示例就读 `errorData.timestamp` / `errorData.stack`——那在 `unknown` 上
 * 过不了类型检查，等于强制每个调用方自行 cast（正是 `unknown` 想避免的事）。
 */
export interface ActionErrorData {
    /** 规范化后错误对象的 `message` */
    message: string;
    /** 规范化后错误对象的 `stack`：无栈的实现下为 undefined */
    stack?: string;
    /** 记录时刻（`Date.now()`） */
    timestamp: number;
}
```

### `ActionExecutionContext`

```ts
/**
 * Action执行上下文
 *
 * 默认值约束到项目类型（而非 `unknown`）：`A = unknown` 会让 `ctx.actions.someAction()`
 * 退化为不可调用的 `unknown`、强制调用方断言，与本模块其余公开泛型的口径
 * （`ActionExecutor<A extends Actions = AsyncActions>`、`ActionUtils<A extends Actions = AsyncActions>`、
 * `Store<S, A extends Actions>`）不一致。
 *
 * 与上述类型相同的已知代价：`Actions` 带 `Record` 索引签名，以 `interface` 声明的 action 集合
 * 没有隐式索引签名、不满足约束，显式传类型实参时用 type alias（或对象字面量推断结果）。
 */
export interface ActionExecutionContext<S extends State = State, A extends Actions = Actions> {
    /** 当前state */
    state: S;
    /** 所有actions */
    actions: A;
    /** Action名称 */
    actionName: string;
    /** Action参数 */
    args: unknown[];
}
```

### `ActionExecutor`

```ts
/**
 * Action执行器类
 *
 * 负责管理异步Action的执行、重试、超时和性能监控
 *
 * @class ActionExecutor
 * @template A - Actions 类型（异步/同步均可；AsyncActions 仅作为默认值）
 *
 * @example
 * ```typescript
 * const executor = new ActionExecutor<MyActions>()
 *
 * // 定义异步Actions
 * const actions = {
 *   fetchData: async (id: string) => {
 *     const response = await fetch(`/api/data/${id}`)
 *     return response.json()
 *   },
 *   saveData: async (data: any) => {
 *     return await fetch('/api/data', {
 *       method: 'POST',
 *       body: JSON.stringify(data)
 *     }).then(r => r.json())
 *   }
 * }
 *
 * // 执行单个Action
 * const data = await executor.execute(actions, 'fetchData', '123')
 *
 * // 执行带重试的Action
 * const result = await executor.executeWithRetry(
 *   actions,
 *   'fetchData',
 *   ['123'],
 *   { retries: 3, delay: 1000, onRetry: (error, attempt) => {
 *     console.log(`Retry ${attempt}:`, error.message)
 *   }}
 * )
 *
 * // 执行带超时的Action
 * const fastResult = await executor.executeWithTimeout(
 *   actions,
 *   'fetchData',
 *   ['123'],
 *   5000 // 5秒超时
 * )
 *
 * // 获取执行统计
 * const stats = executor.getStats('fetchData')
 * console.log(`Success rate: ${stats.successRate}%`)
 * ```
 */
export declare class ActionExecutor<A extends Actions = AsyncActions> {
    /** 执行历史与统计（实现已拆至 ./ActionHistory.js） */
    private readonly history;
    /**
     * 执行Action
     *
     * 异步执行指定的Action，并记录执行结果
     *
     * @template K - Action名称类型
     * @param {A} actions - Actions对象
     * @param {K} actionName - 要执行的Action名称
     * @param {Parameters<A[K]>} args - Action参数
     * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果（异步 action 返回其 resolve 值，不会出现 Promise<Promise<T>>）
     * @throws {Error} 如果Action执行失败
     *
     * @example
     * ```typescript
     * try {
     *   const result = await executor.execute(actions, 'fetchData', 'user-123')
     *   console.log('Action succeeded:', result)
     * } catch (error) {
     *   console.error('Action failed:', error)
     * }
     * ```
     */
    execute<K extends keyof A>(actions: A, actionName: K, ...args: Parameters<A[K]>): Promise<Awaited<ReturnType<A[K]>>>;
    /**
     * 执行 Action 但不写历史
     *
     * 重试/超时等「一次逻辑调用可能对应多次底层执行」的路径用它，再由 `recordOutcome`
     * 就整体结果记一条：若直接用 `execute`，3 次重试会落 4 条记录，`getStats().total`
     * 变成尝试次数、`successRate` 对最终成功的调用报出 25%，中间失败还会挤掉其他
     * Action 的真实记录（历史按 maxHistory 有界）。
     *
     * @private
     */
    private run;
    /**
     * 围绕一次「逻辑调用」记录恰好一条历史
     *
     * `run` 只负责执行、不记账，记账统一收口在这里：错误经 `toError` 规范化后写入
     * `ActionResult.error`，向外抛出的仍是原始错误值。
     *
     * @private
     */
    private recordOutcome;
    /**
     * 并行执行多个Action
     *
     * 同时执行多个独立的Action，返回所有结果（包括错误）
     *
     * @template K - Action名称类型
     * @param {A} actions - Actions对象
     * @param {Array<{action: K, args: Parameters<A[K]>}>} tasks - 任务列表
     * @returns {Promise<Array<Awaited<ReturnType<A[K]>> | Error>>} 执行结果数组（成功返回结果，失败返回Error）
     *
     * @example
     * ```typescript
     * const results = await executor.executeParallel(actions, [
     *   { action: 'fetchUser', args: ['user-1'] },
     *   { action: 'fetchPosts', args: ['user-1'] },
     *   { action: 'fetchProfile', args: ['user-1'] }
     * ])
     *
     * results.forEach((result, index) => {
     *   if (result instanceof Error) {
     *     console.error(`Task ${index} failed:`, result)
     *   } else {
     *     console.log(`Task ${index} succeeded:`, result)
     *   }
     * })
     * ```
     */
    executeParallel<K extends keyof A>(actions: A, tasks: Array<{
        action: K;
        args: Parameters<A[K]>;
    }>): Promise<Array<Awaited<ReturnType<A[K]>> | Error>>;
    /**
     * 串行执行多个Action
     *
     * 依次执行多个Action，每个Action完成后才执行下一个
     *
     * @template K - Action名称类型
     * @param {A} actions - Actions对象
     * @param {Array<{action: K, args: Parameters<A[K]>}>} tasks - 任务列表
     * @returns {Promise<Array<Awaited<ReturnType<A[K]>> | Error>>} 执行结果数组
     *
     * @example
     * ```typescript
     * const results = await executor.executeSequential(actions, [
     *   { action: 'validateData', args: [data] },
     *   { action: 'transformData', args: [data] },
     *   { action: 'saveData', args: [data] }
     * ])
     *
     * // 检查是否有失败
     * const hasFailures = results.some(r => r instanceof Error)
     * if (hasFailures) {
     *   console.log('Some tasks failed, aborting...')
     * } else {
     *   console.log('All tasks completed successfully')
     * }
     * ```
     */
    executeSequential<K extends keyof A>(actions: A, tasks: Array<{
        action: K;
        args: Parameters<A[K]>;
    }>): Promise<Array<Awaited<ReturnType<A[K]>> | Error>>;
    /**
     * 重试Action执行
     *
     * 在Action失败时自动重试，支持指数退避策略
     *
     * @template K - Action名称类型
     * @param {A} actions - Actions对象
     * @param {K} actionName - Action名称
     * @param {Parameters<A[K]>} args - Action参数
     * @param {{retries?: number, delay?: number, onRetry?: (error: Error, attempt: number) => void}} options - 重试选项
     * @param {number} [options.retries=3] - 最大重试次数
     * @param {number} [options.delay=100] - 基础重试延迟（毫秒）
     * @param {(error: Error, attempt: number) => void} [options.onRetry] - 重试回调
     * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果
     * @throws {Error} 如果所有重试都失败
     *
     * @remarks 历史按「一次逻辑调用」记账：逐次重试不单独入历史，`getStats()` 的 total
     * 与 `successRate` 因此反映调用结果而非单次尝试结果。
     *
     * 同一条记录的 `duration`（以及派生的 `avgDuration`）是**端到端**耗时，包含
     * `retryWithBackoff` 的全部退避等待（`delay * 2^(i-1)`）：`retries: 3, delay: 100`
     * 的三次失败重试会给 `duration` 加上约 700ms。它衡量的是「这次调用等了多久」，
     * 不是 action 自身的执行延迟——把它当性能指标读之前先想想重试次数。
     *
     * @example
     * ```typescript
     * const result = await executor.executeWithRetry(
     *   actions,
     *   'fetchData',
     *   ['user-123'],
     *   {
     *     retries: 3,
     *     delay: 1000,
     *     onRetry: (error, attempt) => {
     *       console.log(`Attempt ${attempt} failed:`, error.message)
     *       if (attempt === 3) {
     *         // 最后一次重试，显示用户友好的错误
     *         showError('服务暂时不可用，请稍后重试')
     *       }
     *     }
     *   }
     * )
     * ```
     */
    executeWithRetry<K extends keyof A>(actions: A, actionName: K, args: Parameters<A[K]>, options?: {
        retries?: number;
        delay?: number;
        onRetry?: (error: Error, attempt: number) => void;
    }): Promise<Awaited<ReturnType<A[K]>>>;
    /**
     * 执行Action并设置超时
     *
     * 在指定时间内完成Action执行，超时则抛出错误
     *
     * @template K - Action名称类型
     * @param {A} actions - Actions对象
     * @param {K} actionName - Action名称
     * @param {Parameters<A[K]>} args - Action参数
     * @param {number} timeout - 超时时间（毫秒，必须为大于 0 的有限数值）
     * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果
     * @throws {Error} 如果超时或Action执行失败
     * @throws {RangeError} timeout 非法
     *
     * @remarks Promise 无法取消：超时只让本方法提前 reject，底层 action 仍会执行到结束，
     * 其迟到结果被丢弃且不写入历史（本方法按「一次调用一条记录」记为超时失败）。
     * 需要真正中断请在 action 内部使用 AbortController 等取消机制。
     *
     * 超时错误由公共内核 `raceWithTimeout` 统一构造，带 `code === TIMEOUT_ERROR_CODE`
     * （见 `./async-core.js`）：判定是否超时请按该 code，文案 `Action timeout after <n>ms`
     * 仅用于展示，不保证跨版本稳定。
     *
     * @example
     * ```typescript
     * try {
     *   const result = await executor.executeWithTimeout(
     *     actions,
     *     'fetchData',
     *     ['user-123'],
     *     5000 // 5秒超时
     *   )
     *   console.log('Data fetched:', result)
     * } catch (error) {
     *   if ((error as { code?: string }).code === TIMEOUT_ERROR_CODE) {
     *     console.error('Request timed out')
     *     showTimeoutError()
     *   } else {
     *     console.error('Request failed:', error)
     *   }
     * }
     * ```
     */
    executeWithTimeout<K extends keyof A>(actions: A, actionName: K, args: Parameters<A[K]>, timeout: number): Promise<Awaited<ReturnType<A[K]>>>;
    /**
     * 记录执行结果（实现已拆至 ./ActionHistory.js）
     *
     * @private
     */
    private recordResult;
    /**
     * 获取Action执行历史
     *
     * 返回指定Action或所有Action的执行历史
     *
     * @param {string} [actionName] - Action名称，如果未指定则返回所有Action的历史
     * @returns {ActionResult[]} 执行历史数组（按时间倒序）
     */
    getHistory(actionName?: string): ActionResult[];
    /**
     * 获取Action执行统计
     *
     * 计算指定Action的执行统计信息
     *
     * @param {string} actionName - Action名称
     * @returns {ActionStats} 统计信息
     */
    getStats(actionName: string): ActionStats;
    /**
     * 清除执行历史
     *
     * 删除指定Action或所有Action的执行历史
     *
     * @param {string} [actionName] - Action名称，如果未指定则清除所有历史
     */
    clearHistory(actionName?: string): void;
    /**
     * 设置最大历史记录数
     *
     * 设置每个Action最多保留的历史记录数量
     *
     * @param {number} size - 最大历史记录数（必须 >= 1）
     */
    setMaxHistory(size: number): void;
    /**
     * 获取所有Action的统计
     *
     * 返回所有已执行Action的统计信息
     *
     * @returns {Record<string, ActionStats>} 统计对象
     */
    getAllStats(): Record<string, ActionStats>;
}
```

### `ActionLoader`

```ts
/**
 * Action加载状态管理器
 *
 * 用于包装异步Action，自动管理其执行状态（loading、error、errorData）
 *
 * @class ActionLoader
 *
 * @example
 * ```typescript
 * // 缺省键名即 loading / error / errorData，只在需要改名时才传
 * const loader = new ActionLoader({
 *   loadingKey: 'isBusy',
 *   perActionKeys: true
 * })
 *
 * // 包装Action
 * const wrappedAction = loader.wrap(
 *   async (userId: string) => {
 *     return await fetchUser(userId)
 *   },
 *   'fetchUser',
 *   store.setState.bind(store)
 * )
 *
 * // 执行时自动设置loading状态
 * await wrappedAction('user123')
 * // loading: false, error: null, errorData: null
 * ```
 */
export declare class ActionLoader {
    /**
     * loading 引用计数（按 loading 键）：同一 action 重叠调用时，
     * 首个调用置 true、最后一个完成才置 false，避免共享布尔键的提前翻转。
     * 可注入共享存储（withLoading 场景）：同宿主上不同选项签名的装饰器
     * 对同一 loading 键的计数必须集中，否则仍会互相提前翻转。
     *
     * 该计数同时是 loading 状态的**唯一来源**：此前另有实例私有的布尔镜像，
     * 共享计数时另一实例的 increment 不会写本实例的镜像，本实例 decrement 到
     * 非零也不复位它，于是 `isLoading()` 会永久返回 true。
     * @private
     */
    private loadingRefCounts;
    /**
     * 错误映射
     * @private
     * @type {Map<string, Error | null>}
     */
    private errors;
    /**
     * 错误数据映射
     * @private
     * @type {Map<string, ActionErrorData>}
     */
    private errorData;
    /**
     * 记账代际：`clearInternalRecords()` 每次自增
     *
     * in-flight 调用在开始时捕获它的值，结算时比对：不一致就说明自己的 increment 记录
     * 已被丢弃（`clear()` 或换配置的 `setOptions()` 都已给旧键补写复位值），此时任何
     * 状态写入都只可能吞掉「重置之后新起的调用」的计数。见 {@link CallScope}
     * @private
     */
    private stateGeneration;
    /**
     * 最近一次 `wrap` 注入的 setState
     *
     * `clear()` 与换键的 `setOptions()` 据此给旧键补写复位值：内部记账被清空后已无
     * 在途调用来纠正 store，`loading: true` 会永久卡住。
     * 需要复位的键直接取自下面的几张表（键即状态键），无需另设登记表。
     * @private
     */
    private lastSetState;
    /**
     * 配置选项（由 {@link normalizeActionLoaderOptions} 补齐，缺省值见 {@link ACTION_LOADER_DEFAULTS}）
     * @private
     * @type {NormalizedActionLoaderOptions}
     */
    private options;
    /**
     * 创建Action加载器实例
     *
     * @param {ActionLoaderOptions} [options={}] - 配置选项
     *
     * @example
     * ```typescript
     * // 使用默认选项
     * const loader = new ActionLoader()
     *
     * // 自定义选项
     * const customLoader = new ActionLoader({
     *   autoLoading: true,
     *   loadingKey: 'isLoading',
     *   errorKey: 'myError',
     *   errorDataKey: 'errorDetails'
     * })
     * ```
     */
    constructor(options?: ActionLoaderOptions);
    /**
     * 包装Action，自动管理加载状态
     *
     * 执行时会自动设置loading状态，成功后清除loading和error，失败时设置error
     *
     * @template T - Action函数类型（参数类型不限，返回值须为 Promise）
     * @param {T} action - 要包装的异步Action函数
     * @param {string} actionName - Action名称（用于状态键）
     * @param {(key: string, value: unknown) => void} setState - 设置状态的函数
     * @returns {T} 包装后的Action（签名与被包装者一致）
     *
     * @remarks 约束用 `(...args: never[]) => Promise<unknown>` 而非 `unknown[]`：按参数逆变，
     * `unknown[]` 会拒掉类文档示例里 `(userId: string) => Promise<User>` 这类带具体参数类型的
     * action（调用方被迫写 `as any`），`never[]` 则放行且保留 T 的推导。
     *
     * 包装函数把自己的 receiver 原样转发给被包装的 action：本方法常被用来包一个**未绑定**的
     * 方法引用（`loader.wrap(store.fetchUser, 'fetchUser', store.setState.bind(store))`），
     * 那种写法下 `this` 就是宿主，丢掉它会让依赖 receiver 的 action 直接抛错。
     *
     * 派生状态（loading/error/errorData）的写入按「一次调用的配置快照 + 代际凭证」结算：
     * `autoLoading` 与三个状态键都在调用开始时求值一次，结算时只认这份快照，且只在
     * 代际未变时才写——见 {@link CallScope}。中途 `setOptions()`/`clear()` 之后进行的
     * 收尾写入既可能对错键、也会吞掉别人调用的计数，故一并跳过。
     *
     * @example
     * ```typescript
     * const fetchUserAction = async (userId: string) => {
     *   const user = await api.getUser(userId)
     *   return user
     * }
     *
     * const wrapped = loader.wrap(
     *   fetchUserAction,
     *   'fetchUser',
     *   store.setState.bind(store)
     * )
     *
     * // 执行时自动管理状态
     * await wrapped('user123')
     * // state.loading = false (执行时为true)
     * // state.error = null
     * ```
     */
    wrap<T extends (...args: never[]) => Promise<unknown>>(action: T, actionName: string, setState: (key: string, value: unknown) => void): T;
    /**
     * 取本次调用的配置快照与记账凭证
     *
     * @private
     */
    private captureCallScope;
    /**
     * 一次调用的收尾：把派生状态写回宿主
     *
     * `error === null` 是成功路径（清错误），否则记录错误。错误状态管理独立于
     * `autoLoading` 开关：即使关闭也应清掉/写上陈旧错误。
     *
     * 代际变了就直接返回：本调用的 increment 记录已被 `clear()`/换配置的 `setOptions()`
     * 丢弃，而那两处都已给旧键补写复位值——再减一次只会把「重置之后新起的调用」的计数
     * 吞掉、并在它仍在飞行时把共享键翻成 false。
     *
     * @private
     */
    private settleCall;
    /**
     * 执行辅助状态写入（loading/error/errorData），失败不外泄
     *
     * 这些是派生的 UI 状态，写入失败（典型场景：action 执行期间 store 被销毁，
     * setState 抛 "Cannot call setState on a destroyed Store"）不得掩盖主流程结果：
     * 成功路径冒泡会用新异常替换掉 action 的返回值，失败路径冒泡会替换掉 action 的
     * 原始错误，两种情况调用方看到的都是与真实故障无关的异常。
     *
     * 注意 incrementLoading 不走此助手：wrap 依赖它抛错来回滚已递增的引用计数。
     *
     * @private
     */
    private safeRunStateEffect;
    /**
     * 递增 loading 引用计数；首个进行中的调用才将 loading 置为 true
     *
     * @private
     */
    private incrementLoading;
    /**
     * 递减 loading 引用计数；最后一个完成的调用才将 loading 置为 false
     *
     * @private
     */
    private decrementLoading;
    /**
     * 回滚一次 increment（`setState` 抛错时），只退计数不写状态
     *
     * @private
     */
    private releaseLoadingSlot;
    /**
     * 写 error / errorData
     *
     * 键取自调用开始时的快照（{@link CallScope}），不在这里重算：中途 `setOptions()`
     * 换过键名的话，重算会让「按旧键写的账」跑到新键上去补一笔，而新键属于切换之后的调用。
     *
     * @private
     */
    private writeError;
    /**
     * 获取loading key
     *
     * @private
     * @param {string} actionName - Action名称
     * @returns {string} loading状态键（perActionKeys 模式下按 action 派生）
     */
    private getLoadingKey;
    /**
     * 获取error key
     *
     * @private
     * @param {string} actionName - Action名称
     * @returns {string} error状态键（perActionKeys 模式下按 action 派生）
     */
    private getErrorKey;
    /**
     * 获取error data key
     *
     * @private
     * @param {string} actionName - Action名称
     * @returns {string} error数据状态键（perActionKeys 模式下按 action 派生）
     */
    private getErrorDataKey;
    /**
     * 检查是否loading
     *
     * @param {string} actionName - Action名称
     * @returns {boolean} 是否正在加载
     *
     * @example
     * ```typescript
     * if (loader.isLoading('fetchUser')) {
     *   console.log('Fetching user...')
     * }
     * ```
     */
    isLoading(actionName: string): boolean;
    /**
     * 获取error
     *
     * @param {string} actionName - Action名称
     * @returns {Error | null} 错误对象，没有错误时返回null
     *
     * @example
     * ```typescript
     * const error = loader.getError('fetchUser')
     * if (error) {
     *   console.error('Failed to fetch user:', error.message)
     * }
     * ```
     */
    getError(actionName: string): Error | null;
    /**
     * 获取error data
     *
     * @param {string} actionName - Action名称
     * @returns {ActionErrorData | undefined} 错误数据（message/stack/timestamp），无错误时 undefined
     *
     * @example
     * ```typescript
     * const errorData = loader.getErrorData('fetchUser')
     * if (errorData) {
     *   console.log('Error occurred at:', new Date(errorData.timestamp))
     *   console.log('Stack trace:', errorData.stack)
     * }
     * ```
     */
    getErrorData(actionName: string): ActionErrorData | undefined;
    /**
     * 获取所有loading状态
     *
     * @returns {Record<string, boolean>} 所有loading状态的对象
     *
     * @example
     * ```typescript
     * const loadingStates = loader.getAllLoading()
     * console.log('All loading states:', loadingStates)
     * ```
     */
    getAllLoading(): Record<string, boolean>;
    /**
     * 获取所有errors
     *
     * @returns {Record<string, Error | null>} 所有错误的对象
     *
     * @example
     * ```typescript
     * const errors = loader.getAllErrors()
     * Object.entries(errors).forEach(([key, error]) => {
     *   if (error) {
     *     console.error(`${key}:`, error.message)
     *   }
     * })
     * ```
     */
    getAllErrors(): Record<string, Error | null>;
    /**
     * 清除所有状态
     *
     * 既丢内部记账，也把宿主 store 里的派生状态复位（loading→false、error/errorData→null）：
     * 只清内部的话，store 会永久停在最后一次写入的值上（典型表现 `loading: true` 卡死），
     * 此后已没有在途调用来纠正它。
     *
     * 注意：注入的共享 loading 计数会被一并清零，同宿主上其他 loader 实例的进行中调用
     * 因此失去计数（与 `setOptions` 换选项时的处理口径一致）。
     *
     * @param {(key: string, value: unknown) => void} [setState] - 复位写入用的 setState，
     *   缺省复用最近一次 `wrap` 注入的那个
     *
     * @example
     * ```typescript
     * // 重置所有状态（含 store 侧）
     * loader.clear()
     * ```
     */
    clear(setState?: (key: string, value: unknown) => void): void;
    /**
     * 给本实例写过的状态键补写复位值
     *
     * @private
     */
    private resetDerivedState;
    /**
     * 丢弃内部记账（store 侧的复位由 `resetDerivedState` 负责）
     *
     * 代际同时自增：进行中的调用据此认出自己的 increment 记录已不在，结算时不再改任何
     * 状态键（见 {@link CallScope}）。
     *
     * @private
     */
    private clearInternalRecords;
    /**
     * 设置选项
     *
     * 更新配置选项，未提供的选项保持不变
     *
     * @param {Partial<ActionLoaderOptions>} options - 要更新的选项
     *
     * @example
     * ```typescript
     * loader.setOptions({
     *   loadingKey: 'isLoading',
     *   autoLoading: false
     * })
     * ```
     */
    setOptions(options: Partial<ActionLoaderOptions>): void;
}
```

### `ActionLoaderOptions`

```ts
/**
 * Action加载状态选项
 */
export interface ActionLoaderOptions {
    /** 自动管理loading状态 */
    autoLoading?: boolean;
    /** loading状态字段名 */
    loadingKey?: string;
    /** error状态字段名 */
    errorKey?: string;
    /** error数据字段名 */
    errorDataKey?: string;
    /**
     * 是否按 action 名称派生独立状态键（默认 false）
     *
     * 启用后状态键为 `${baseKey}_${actionName}`（如 `loading_fetchUser`），
     * 解决同一 ActionLoader 包装多个异步 action 并发执行时
     * loading/error 状态互相覆盖的问题；单个异步 action 场景可保持默认
     */
    perActionKeys?: boolean;
    /**
     * 共享的 loading 引用计数存储
     *
     * 供 `withLoading` 装饰器按宿主 + loading 键注入：同一宿主上不同选项签名（如不同 `errorKey`）
     * 的装饰器实例各自持有计数时，对同一 loading 键的并发计数互不可见，
     * 先完成的调用会提前翻转共享布尔键。直接构造 `ActionLoader` 的调用方无需提供。
     *
     * 这是**公开可传**的选项（`docs/API.md` 的选项表里有它），不是类型层隐藏得了的内部件：
     * `@internal` 标签既不阻止 tsc 导出它，也不让 `src/extras/index.ts` 的再导出少掉它，
     * 留着只会让人以为它不该被碰。它的两条真实约束是：
     * - **只在构造期读一次**（`options.sharedLoadingCounts ?? new Map()`），`setOptions()` 忽略它——
     *   运行期换 Map 会让新旧两本计数同时存在，那比忽略更糟；
     * - 自造/复用同一 Map 给多个 loader 时，「首个调用置 true、末个完成置 false」的不变量由注入方负责。
     */
    sharedLoadingCounts?: Map<string, number>;
}
```

### `ActionResult`

```ts
/**
 * Action执行结果
 *
 * 以 `success` 判别的联合类型：`success: true` 只带 `data`、`success: false` 只带 `error`，
 * 非法组合（成功却带 error / 失败却带 data）不可表示。
 *
 * 两个分支都显式声明对方的键为可选 `undefined`（而非直接缺省），这样未收窄时
 * `result.data` / `result.error` 仍是 `T | undefined` / `Error | undefined` 可直接读取——
 * 历史消费方（含 `getHistory()` 的结果遍历）大多不做判别收窄。
 *
 * `duration` 与 `endTime - startTime` 由构造方同时给出（本类型无法强制二者一致），
 * 库内 `AsyncActionSupport` 的两条路径均以 `duration: endTime - startTime` 写入。
 *
 * 对按 `success` 收窄的调用方而言这是一次向更精确方向的收敛；对外部手工构造结果的
 * 调用方则是轻微破坏性变更（少给一个对方的键反而报错），故按 minor 版本对待。
 */
export type ActionResult<T = unknown> = {
    /** 是否成功 */
    success: true;
    /** 返回值 */
    data: T;
    /** 失败时才有值：成功分支上恒为 undefined */
    error?: undefined;
    /** 开始时间 */
    startTime: number;
    /** 结束时间 */
    endTime: number;
    /** 执行时长（= endTime - startTime） */
    duration: number;
} | {
    /** 是否成功 */
    success: false;
    /** 成功时才有值：失败分支上恒为 undefined */
    data?: undefined;
    /** 错误信息（已由 `toError` 归一化为 Error） */
    error: Error;
    /** 开始时间 */
    startTime: number;
    /** 结束时间 */
    endTime: number;
    /** 执行时长（= endTime - startTime） */
    duration: number;
};
```

### `ActionStats`

```ts
/** 单个 Action 的执行统计 */
export interface ActionStats {
    total: number;
    success: number;
    failure: number;
    avgDuration: number;
    successRate: number;
}
```

### `ActionUtils`

```ts
/**
 * Action工具类
 *
 * 提供Action执行功能
 *
 * @class ActionUtils
 * @template A - 异步Actions类型
 *
 * @example
 * ```typescript
 * const utils = new ActionUtils<MyActions>(actions)
 *
 * // 执行Action（复用构造时绑定的 actions）
 * const result = await utils.execute('fetchData', 'user-123')
 *
 * // 也可显式传入另一份 actions（如运行时才拿到的实例）
 * const other = await utils.execute(otherActions, 'fetchData', 'user-123')
 * ```
 */
export declare class ActionUtils<A extends Actions = AsyncActions> {
    /**
     * Action执行器
     * @private
     * @type {ActionExecutor<A>}
     */
    private executor;
    /**
     * 构造时绑定的 Actions 对象，供 `execute` 省略首参时使用
     * @private
     */
    private readonly actions;
    /**
     * 创建Action工具实例
     *
     * @param {A} actions - Actions对象：绑定为本实例的默认执行目标
     * @param {ActionUtilsOptions<A>} [options] - 配置选项（支持依赖注入）
     */
    constructor(actions: A, options?: ActionUtilsOptions<A>);
    /**
     * 执行Action（代理到executor）
     *
     * @template K - Action名称类型
     * @param {A} actions - Actions对象（省略时使用构造时绑定的 actions）
     * @param {K} actionName - Action名称
     * @param {Parameters<A[K]>} args - Action 参数
     * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果
     * @throws {TypeError} 入参形态不对（缺 actionName、actionName 在该 actions 上不存在或不是
     *   函数）时**就地**抛出：不经过执行器，因此不会在 `getStats`/`getHistory` 里留下记录
     * @throws 被装饰 action 自身抛出的错误会**原样**向上抛出（同 `ActionExecutor.execute`）：
     *   本方法只是门面，不做包装、也不转成「失败结果」。executor 已把该次执行按失败记入历史
     *   （`getStats`/`getHistory` 可见），随后 rethrow 原始值——调用方 `catch (e) => e === thrown`
     *   的身份判断成立
     *
     * @example
     * ```typescript
     * const result = await utils.execute(actions, 'fetchData', 'user-123')
     * const same = await utils.execute('fetchData', 'user-123')
     * ```
     */
    execute<K extends keyof A>(actionName: K, ...args: Parameters<A[K]>): Promise<Awaited<ReturnType<A[K]>>>;
    execute<K extends keyof A>(actions: A, actionName: K, ...args: Parameters<A[K]>): Promise<Awaited<ReturnType<A[K]>>>;
}
```

### `ActionUtilsOptions`

```ts
/**
 * ActionUtils 配置选项
 */
export interface ActionUtilsOptions<A extends Actions = AsyncActions> {
    /** 自定义执行器实例 */
    executor?: ActionExecutor<A>;
}
```

### `AsyncActions`

```ts
/**
 * 异步Actions类型（继承Actions）
 *
 * 索引签名的形参取 `any[]`，与基类型 `Actions`（`Record<string, (...args: any[]) => any>`）
 * 同口径：属性式函数类型在 `strictFunctionTypes`（本仓库 `strict: true`）下按**逆变**比较，
 * 写成 `unknown[]` 会让带标注的常见写法被拒——
 * `{ fetchUser: (id: string) => Promise<User> }` 不满足
 * `(...args: unknown[]) => Promise<unknown>`（`unknown` 不能赋给 `string`），
 * 调用方被迫去掉形参标注或整体断言，而同样形状的函数式声明却能通过。
 * 返回值保持 `Promise<unknown>`：返回类型是协变位置，具体类型可自由收窄，
 * 不需要（也不应该）放宽到 `any`。
 */
export interface AsyncActions extends Actions {
    [key: string]: (...args: any[]) => Promise<unknown>;
}
```

### `CacheDecoratorOptions`

```ts
/**
 * GeomStore - 缓存装饰器
 *
 * 缓存方法的执行结果，在TTL内重复调用时直接返回缓存结果
 *
 * 修复说明：原实现将 cache Map 声明在工厂函数作用域，导致同一装饰器装饰的
 * 所有方法/实例共享同一份缓存（闭包陷阱）。现改为按宿主对象（this）隔离缓存。
 *
 */
/**
 * 缓存装饰器选项
 */
export interface CacheDecoratorOptions {
    /** 缓存生存时间（毫秒） */
    ttl?: number;
    /** 自定义缓存键函数（参数与被装饰方法一致） */
    keyFn?: (...args: unknown[]) => string;
}
```

### `DecoratorOptions`

```ts
/**
 * 装饰器选项
 *
 * @remarks 三个回调都可以写成 `async`（TS 允许 async 函数满足 `=> void` 签名）：
 * `before` 返回 Promise 时整次调用降级为异步，被装饰方法一定等它 settle 之后才执行，
 * 其 rejection 走 `onError`；`after` 返回 Promise 时只有在被装饰方法本身是异步时才会被
 * 等待（同步方法必须保持同步返回，此时该 Promise 的 rejection 记日志并按 `onError` 上报，
 * 不外抛）。任一回调抛错/拒绝都会先经 `onError` 再按原有语义传播。
 */
export interface DecoratorOptions {
    /** 执行前的回调 */
    before?: (...args: unknown[]) => void;
    /** 执行成功后的回调 */
    after?: (result: unknown) => void;
    /** 执行失败的回调 */
    onError?: (error: Error) => void;
}
```

### `LogDecoratorOptions`

```ts
/**
 * 日志装饰器选项
 */
export interface LogDecoratorOptions {
    /**
     * 日志输出目标，缺省 `console`
     *
     * 生产构建里接入统一日志通道（或整体替换为 no-op）比在业务代码里到处删日志更可控，
     * 与 `PerformanceMonitor` 的 `logger` 选项同一思路。sink 自身抛错只告警，
     * 不会中断被装饰的 action，也不会把成功的调用改判成失败。
     */
    sink?: LogSink;
    /**
     * 输出前的脱敏钩子：决定参数 / 返回值 / 错误以什么形态进入日志
     *
     * 非生产构建下它的返回值就是最终输出。生产构建下**不**再接管输出：返回值仍要过一道
     * {@link summarize} 摘要，除非同时显式传 `summarizeInProduction: false`（见该选项）。
     */
    redact?: (value: unknown, phase: LogPhase) => unknown;
    /**
     * 生产构建下是否强制摘要输出，缺省 `true`
     *
     * `true`：进 sink 的一律是不含内容的摘要（{@link summarize}），自带 `redact` 也绕不过去
     * ——一个过于宽松或有 bug 的脱敏器不该能静默关掉这道防线。
     * 只有显式传 `false` 才表示「我确认过，sink 侧自行脱敏」，此时 `redact` 单独决定形态。
     *
     * 非生产构建默认原样输出（本地调试用）：staging 之类与生产同构的运行期由
     * `isProduction()` 的判定覆盖，需要收敛内容时同样传 `redact`。
     */
    summarizeInProduction?: boolean;
}
```

### `LogPhase`

```ts
/** 日志内容产生的阶段，供 `redact` 按阶段决定脱敏策略 */
export type LogPhase = 'args' | 'result' | 'error';
```

### `LogSink`

```ts
/**
 * GeomStore - 日志装饰器
 *
 * 在Action执行前后记录日志，便于调试
 *
 */
/** 日志输出口：与 console 的 (message, ...data) 形状一致，便于直接接入项目 logger */
export interface LogSink {
    log: (message: string, ...data: unknown[]) => void;
    error: (message: string, ...data: unknown[]) => void;
}
```

### `RetryDecoratorOptions`

```ts
/**
 * GeomStore - 重试装饰器
 *
 * 在方法失败时自动重试，支持指数退避和条件重试
 *
 */
/**
 * 重试装饰器选项
 */
export interface RetryDecoratorOptions {
    /**
     * 首次执行之外的最大重试次数（总尝试次数 = retries + 1），默认 3
     *
     * 非有限值/负数/小数在内核里归一到非负整数（即「只执行一次」），不会是无限重试
     */
    retries?: number;
    /** 基础重试延迟（毫秒） */
    delay?: number;
    /**
     * 判断是否应该重试的函数
     *
     * 入参恒为 `Error`：非 Error 的抛出值（`throw 'boom'` / `throw { code }`）在传给本函数前
     * 已由内核 `toError` 规范化，可安全读 `error.message`/`stack`；向外抛出的仍是原始值
     */
    shouldRetry?: (error: Error) => boolean;
}
```

### `RetryOptions`

```ts
/**
 * 指数退避重试选项
 *
 * `retryWithBackoff` 的入参契约，也是全库重试语义的唯一定义处：装饰器侧的
 * `RetryDecoratorOptions`（`decorators/retry.ts`）与 `ActionExecutor.executeWithRetry`
 * 的 options 都是它的子集/复用者，各写一份字段声明迟早与内核漂移。
 */
export interface RetryOptions {
    /** 最大重试次数（不含首次执行），默认 3 */
    retries?: number;
    /** 基础退避延迟（毫秒），第 n 次重试等待 delay * 2^(n-1)，默认 100 */
    delay?: number;
    /** 是否对某次错误继续重试（返回 false 立即抛出），默认全部重试 */
    shouldRetry?: (error: Error) => boolean;
    /** 每次实际重试前的回调（attempt 从 1 开始） */
    onRetry?: (error: Error, attempt: number) => void;
}
```

### `TIMEOUT_ERROR_CODE`

```ts
TIMEOUT_ERROR_CODE: "ACTION_TIMEOUT"
```

### `ThrottleDecoratorOptions`

```ts
/**
 * GeomStore - 节流装饰器
 *
 * 限制方法在指定时间间隔内只能执行一次，支持 leading / trailing 两种触发沿
 * （默认双开启，与 lodash throttle 语义对齐）：
 * - leading：新窗口的首次调用立即执行
 * - trailing：窗口内被抑制的调用在窗口结束时以最新参数补发（fire-and-forget，
 *   返回值不回传——节流场景调用方不应依赖被抑制调用的返回值）
 *
 * 宿主生命周期收尾：窗口内挂起的补发由 `setTimeout` 驱动，宿主（小程序 Page /
 * Component 实例）卸载后它仍会到期执行，最坏情况写入已销毁的 store。为此本模块
 * 提供三个语义互斥的公开入口（`cancelThrottledCalls` / `flushThrottledCalls` /
 * `disposeThrottledState`，见各自 JSDoc），在 `onUnload` / `detached` 里按宿主调用。
 *
 */
/**
 * 节流选项
 */
export interface ThrottleDecoratorOptions {
    /** 新窗口首次调用是否立即执行（默认 true） */
    leading?: boolean;
    /** 窗口结束时是否以最新参数补发被抑制的调用（默认 true） */
    trailing?: boolean;
    /**
     * 是否按异步方法处理返回值（默认 false）
     *
     * 用于「非 async 语法但返回 Promise」的方法（包装函数、手写 thenable）：这类方法
     * 首次调用若被抑制（leading=false），装饰器无从观测返回值，会按同步方法返回 undefined。
     * 置为 true 可强制被抑制的调用也返回 Promise，保证调用方 await/.then 不崩。
     */
    assumeAsync?: boolean;
}
```

### `TimeoutError`

```ts
/** 附带 `code` 的超时错误形状（`Error` + {@link TIMEOUT_ERROR_CODE}） */
export interface TimeoutError extends Error {
    code: typeof TIMEOUT_ERROR_CODE;
}
```

### `cancelDebouncedCalls`

```ts
/**
 * 取消宿主上挂起的防抖调用（**不执行**原方法）
 *
 * 每个被取消的调用返回的 Promise 以 `Error('[withDebounce] pending call was cancelled')`
 * 拒绝（理由见 `cancelPendingCalls` 的注释：不结算会永久挂起调用方）。幂等——重复调用、
 * 对没有挂起调用的宿主调用都是 no-op。
 *
 * @param host - 宿主（Page / Component 实例、类对象等）。基本类型 / null 时无从定位
 *        状态，静默返回（与装饰器自身的降级口径一致）
 * @param method - 只取消该名字的被装饰方法；省略时取消该宿主上所有防抖方法
 *
 * @example
 * ```typescript
 * class SearchPage {
 *   @withDebounce(300)
 *   async search(keyword: string) { return fetchSearch(keyword) }
 *
 *   onUnload() {
 *     cancelDebouncedCalls(this) // 等待中的搜索不再发请求
 *   }
 * }
 * ```
 */
export declare function cancelDebouncedCalls(host: unknown, method?: string | symbol): void;
```

### `cancelThrottledCalls`

```ts
/**
 * 取消宿主上挂起的节流补发（**不执行**原方法）
 *
 * 用于宿主卸载点：窗口内被抑制、正等着补发的调用就此丢弃。幂等——重复调用、
 * 对没有挂起调用的宿主调用都是 no-op；被抑制的那次调用当时返回的 Promise
 * （若有）已在调用时刻以 `undefined` 结算，不受影响。
 *
 * @param host - 宿主（Page / Component 实例、类对象等）。基本类型 / null 时无从
 *        定位状态，静默返回（与装饰器本身的降级口径一致）
 * @param method - 只取消该名字的被装饰方法；省略时取消该宿主上所有节流方法
 *
 * @example
 * ```typescript
 * class ScrollPage {
 *   @withThrottle(100)
 *   onScroll(position: number) { this.store.patch(position) }
 *
 *   onUnload() {
 *     cancelThrottledCalls(this) // 页面已销毁，挂起的补发不再执行
 *   }
 * }
 * ```
 */
export declare function cancelThrottledCalls(host: unknown, method?: string | symbol): void;
```

### `createDecorator`

```ts
/**
 * 创建Action装饰器
 *
 * 创建一个通用装饰器，可以在Action执行前后执行自定义逻辑
 *
 * @static
 * @param {DecoratorOptions} [options={}] - 装饰器选项
 * @returns {MethodDecorator} 方法装饰器
 *
 * @remarks 返回值类型跟随被装饰方法：同步方法仍同步返回，异步（或返回 Promise）方法
 * 返回 Promise；`after` 在结果确定后触发，`onError` 在同步抛错或 Promise reject 时触发。
 * 三个回调（`before`/`after`/被装饰方法）自身的失败都会先经 `onError` 再按原样传播，
 * 失败观测口径一致。`before`/`after` 返回 Promise 时按 {@link DecoratorOptions} 的约定
 * 接续，不会并发执行、也不会留下 unhandled rejection；`onError` 自身抛错不会顶替原始失败。
 *
 * @example
 * ```typescript
 * const auditDecorator = createDecorator({
 *   before: (...args) => {
 *     console.log('[Audit] Action called with:', args)
 *   },
 *   after: (result) => {
 *     console.log('[Audit] Action completed with result:', result)
 *   },
 *   onError: (error) => {
 *     console.error('[Audit] Action failed:', error)
 *   }
 * })
 *
 * class MyComponent {
 *   @auditDecorator
 *   async loadData(id: string) {
 *     return await fetchData(id)
 *   }
 * }
 * ```
 */
export declare function createDecorator(options?: DecoratorOptions): MethodDecorator;
```

### `disposeDebouncedState`

```ts
/**
 * 释放宿主上的全部防抖状态（取消挂起调用 + 删除该宿主的状态表）
 *
 * 相当于 `cancelDebouncedCalls(host)` 之后再删掉该宿主的整张状态表：挂起队列、
 * 定时器引用、方法槽位一并释放，此后若还有代码持有该宿主并调用被装饰方法，
 * 会从零重新建状态。卸载点上想「一切从简」可以只调本函数。
 *
 * 与 `cancelDebouncedCalls` 一样对任何入参安全：宿主为基本类型 / null、
 * 或本就没有防抖状态时都是 no-op（被取消的 Promise 同样以「已取消」拒绝）。
 *
 * @param host - 宿主
 */
export declare function disposeDebouncedState(host: unknown): void;
```

### `disposeThrottledState`

```ts
/**
 * 释放宿主上的全部节流状态（取消挂起补发 + 清空窗口计时）
 *
 * 相当于 `cancelThrottledCalls(host)` 之后再删掉该宿主的整张状态表：窗口计时
 * （`lastCallTime`）、异步观测标记（`sawPromise`）一并归零，此后若还有代码持有
 * 该宿主并调用被装饰方法，会按「新窗口」重新计状态。卸载点上想「一切从简」可以
 * 只调本函数，它比 cancel 多出的正是这份状态释放。
 *
 * 与 `cancelThrottledCalls` 一样对任何入参安全：宿主为基本类型 / null、
 * 或本就没有节流状态时都是 no-op。
 *
 * @param host - 宿主
 */
export declare function disposeThrottledState(host: unknown): void;
```

### `flushDebouncedCalls`

```ts
/**
 * 立即执行宿主上挂起的防抖调用（**至多一次**）
 *
 * 与 `cancelDebouncedCalls` 的区别是「现在就跑」而不是「丢弃」：适用于卸载前还想
 * 把最后一次输入提交出去的场合。语义与延迟自然到期一致：
 * - 一次调用只执行原方法一次，其挂起的全部 Promise 都按这次结果结算（合并语义不变）；
 * - 没有挂起调用时不凭空执行原方法（再次 flush 因队列已空而是 no-op）；
 * - 原方法失败仍按既有语义 reject 那些 Promise：`await` 了的调用方拿得到失败，
 *   fire-and-forget 的调用方也不会漏出 unhandledRejection（`runPendingCalls` 在 reject
 *   前给每个挂起 promise 补了 catch，与延迟自然到期完全同构）。
 *
 * @param host - 宿主；基本类型 / null 时为 no-op
 * @param method - 只立即执行该名字的被装饰方法；省略时覆盖该宿主上所有防抖方法
 */
export declare function flushDebouncedCalls(host: unknown, method?: string | symbol): void;
```

### `flushThrottledCalls`

```ts
/**
 * 立即补发宿主上挂起的节流调用（**至多一次**）
 *
 * 与 `cancelThrottledCalls` 的区别是「执行」而不是「丢弃」：适用于卸载前还想把
 * 最后一次输入/滚动位置落盘的场合。语义与窗口自然到期完全一致，因此：
 * - 每个槽位只补发一次（补发后挂起参数即被清空，再次 flush 是 no-op）；
 * - 没有挂起调用时不凭空执行原方法（只有被抑制过的调用才有补发资格）；
 * - 补发是 fire-and-forget，其返回值不回传、失败就地 `console.error`，
 *   不会把 rejection 漏成 unhandledRejection。
 *
 * @param host - 宿主；基本类型 / null 时为 no-op
 * @param method - 只补发该名字的被装饰方法；省略时补发该宿主上所有挂起的节流调用
 */
export declare function flushThrottledCalls(host: unknown, method?: string | symbol): void;
```

### `withCache`

```ts
/**
 * 创建缓存装饰器
 *
 * 缓存方法的执行结果，在TTL内重复调用时直接返回缓存结果
 *
 * @param {CacheDecoratorOptions} [options={}] - 缓存选项
 * @param {number} [options.ttl=5000] - 缓存生存时间（毫秒）
 * @param {(...args: unknown[]) => string} [options.keyFn] - 自定义缓存键函数
 *
 * @remarks `keyFn` 抛错（典型是其内部的 `JSON.stringify` 遇到循环引用/BigInt）不会让被装饰
 * 方法失败：该次调用退化为一次性唯一键、直接执行原方法且不入缓存，与内置默认键生成器的
 * 失败口径一致。开发期会有一条 `[Cache] keyFn threw...` 的 `console.debug` 点名原因。
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class UserComponent {
 *   @withCache({ ttl: 60000 }) // 缓存1分钟
 *   async getUser(id: string) {
 *     return await fetch(`/api/users/${id}`).then(r => r.json())
 *   }
 *
 *   @withCache({
 *     ttl: 5000,
 *     keyFn: (id, includeProfile) => `user:${id}:${includeProfile}`
 *   })
 *   async getUserWithProfile(id: string, includeProfile: boolean) {
 *     return await fetchUserWithProfile(id, includeProfile)
 *   }
 * }
 *
 * // 第一次调用：执行请求并缓存
 * const user1 = await userComponent.getUser('user-123')
 *
 * // 第二次调用：直接从缓存返回（60秒内）
 * const user2 = await userComponent.getUser('user-123')
 * ```
 */
export declare function withCache(options?: CacheDecoratorOptions): MethodDecorator;
```

### `withDebounce`

```ts
/**
 * GeomStore - 防抖装饰器
 *
 * 延迟执行方法，如果在延迟时间内再次调用，则重置定时器
 *
 * 修复说明：原实现将 timeoutId / pendingResolves 等状态声明在工厂函数作用域，
 * 导致同一装饰器装饰的所有方法/实例共享同一份状态（闭包陷阱）。
 * 现改为按宿主对象（this）隔离状态，每个实例拥有独立的定时器与 pending 队列。
 *
 * 宿主生命周期收尾：等待期由 `setTimeout` 驱动，宿主（小程序 Page / Component 实例）
 * 卸载后它仍会到期执行被装饰方法。为此本模块提供三个语义互斥的公开入口
 * （`cancelDebouncedCalls` / `flushDebouncedCalls` / `disposeDebouncedState`），
 * 在 `onUnload` / `detached` 里按宿主调用。
 *
 */
/**
 * 创建防抖装饰器
 *
 * 延迟执行方法，如果在延迟时间内再次调用，则重置定时器
 * 适用于搜索、输入框等场景
 *
 * @param {number} [delay=300] - 延迟时间（毫秒）；非有限值或 <=0 视为配置错误，
 *        回退为 300（`setTimeout(fn, NaN)` 与负延迟都按 ~0ms 触发、`Infinity` 在 Node 下
 *        溢出告警后按 1ms 处理，静默把防抖退化成一个近无操作；与 `withThrottle` 同口径）
 * @returns {MethodDecorator} 方法装饰器
 *
 * @remarks 包装函数的返回值**恒为 Promise**：延迟期内不能同步产出结果，只能先给一个
 * 等待结算的替身。因此本装饰器适用于 async 方法。TS 的旧式方法装饰器改不了声明签名，
 * 装饰一个同步方法 `sync(): T` 时类型仍是 `(): T` 而运行时拿到 `Promise<unknown>`
 * （`const v: T = host.sync()` 编译通过却拿错值），调用方必须按 Promise 消费。
 *
 * @example
 * ```typescript
 * class SearchComponent {
 *   @withDebounce(500)
 *   async search(query: string) {
 *     return await searchAPI(query)
 *   }
 *
 *   detached() {
 *     // 组件销毁：等待中的 search 调用以「已取消」结算，不再打接口
 *     cancelDebouncedCalls(this)
 *   }
 * }
 *
 * // 用户快速输入，只会在最后一次输入后500ms执行一次搜索
 * searchComponent.search('a')
 * searchComponent.search('ap')
 * searchComponent.search('app') // 只执行这次
 * ```
 */
export declare function withDebounce(delay?: number): MethodDecorator;
```

### `withLoading`

```ts
/**
 * 创建withLoading装饰器
 *
 * 用于装饰类方法，自动管理方法执行时的loading状态
 *
 * @param {ActionLoaderOptions} [options={}] - 配置选项
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class UserStore {
 *   state = {
 *     loading: false,
 *     error: null,
 *     errorData: null
 *   }
 *
 *   @withLoading({ loadingKey: 'loading' })
 *   async fetchUser(userId: string) {
 *     const user = await api.getUser(userId)
 *     return user
 *   }
 * }
 *
 * const store = new UserStore()
 * await store.fetchUser('user123')
 * // store.state.loading = false (执行时为true)
 * ```
 */
export declare function withLoading(options?: ActionLoaderOptions): MethodDecorator;
```

### `withLog`

```ts
/**
 * 创建日志装饰器
 *
 * 在Action执行前后记录日志，便于调试
 *
 * @param {string} [name] - Action名称（用于日志标识）
 * @param {LogDecoratorOptions} [options] - 输出目标与脱敏配置
 * @returns {MethodDecorator} 方法装饰器
 *
 * @remarks 默认把 `args`/`result` 原样写入日志，方便本地调试；生产构建（`isProduction()`）
 * 下改为摘要（类型 / 长度 / 键数，`Error` 只留 `name`），避免 token、密码、PII 随日志外泄。
 * 该摘要在生产构建下是**强制**的：自带 `redact` 只会先于摘要生效，不会取代它，
 * 除非显式传 `summarizeInProduction: false`（表示 sink 侧自行脱敏）。
 *
 * @example
 * ```typescript
 * class MyComponent {
 *   @withLog('fetchUserData')
 *   async fetchUser(id: string) {
 *     return await fetch(`/api/users/${id}`).then(r => r.json())
 *   }
 *
 *   // 接入项目 logger，并把参数整体替换为不含内容的占位
 *   // （非生产构建下日志里就是 '[credentials]'；生产构建下还要再过一道摘要，
 *   //   要让 redact 单独决定内容形态得同时传 summarizeInProduction: false）
 *   @withLog('login', {
 *     sink: appLogger,
 *     redact: (value, phase) => (phase === 'args' ? '[credentials]' : value),
 *   })
 *   async login(credentials: { user: string; password: string }) {
 *     return await api.login(credentials)
 *   }
 * }
 *
 * // 控制台输出：
 * // [Action] fetchUserData started with args: ['user-123']
 * // [Action] fetchUserData completed with result: { id: 'user-123', name: 'John' }
 * ```
 */
export declare function withLog(name?: string, options?: LogDecoratorOptions): MethodDecorator;
```

### `withRetry`

```ts
/**
 * 创建重试装饰器
 *
 * 在方法失败时自动重试，支持指数退避和条件重试
 *
 * @param {RetryDecoratorOptions} [options={}] - 重试选项
 * @param {number} [options.retries=3] - 首次执行之外的最大重试次数（总尝试 = retries + 1）
 * @param {number} [options.delay=100] - 基础重试延迟（毫秒），第 n 次重试等待 `delay * 2^(n-1)`
 * @param {(error: Error) => boolean} [options.shouldRetry] - 判断是否应该重试的函数
 * @returns {MethodDecorator} 方法装饰器
 *
 * @remarks 与 `ActionExecutor.executeWithRetry` 共用 `retryWithBackoff` 内核，退避与
 * 错误规范化语义一致；选项面**不**等价：本装饰器只暴露 retries/delay/shouldRetry，
 * 内核的 `onRetry`（每次重试前回调）目前只由 `ActionExecutor.executeWithRetry` 入口提供。
 * 需要逐次重试的通知，请在 `shouldRetry` 里自行计数或改用执行器入口。
 *
 * @remarks **返回类型会变**：包装函数是 `async`，原本同步返回 `T` 的方法装饰后返回
 * `Promise<T>`，原本同步抛出的失败也变成 rejection。这是退避的固有代价——重试之间要
 * `await setTimeout`，同步路径无法在不阻塞事件循环的前提下等待。因此调用方必须
 * `await`/`.then` 取结果，原先靠同步返回值或 `try/catch` 接结果的写法都要改写；
 * 不想改调用方就不要给同步方法加本装饰器。
 *
 * @example
 * ```typescript
 * class NetworkComponent {
 *   // 网络错误时重试，最多3次
 *   @withRetry({
 *     retries: 3,
 *     delay: 1000,
 *     shouldRetry: (error) => {
 *       // 只重试网络错误和超时错误
 *       return (
 *         error.message.includes('network') ||
 *         error.message.includes('timeout')
 *       )
 *     }
 *   })
 *   async fetchData(url: string) {
 *     return await fetch(url).then(r => r.json())
 *   }
 * }
 * ```
 */
export declare function withRetry(options?: RetryDecoratorOptions): MethodDecorator;
```

### `withThrottle`

```ts
/**
 * 创建节流装饰器
 *
 * @param {number} [interval=300] - 执行间隔（毫秒）；非有限值或 <=0 视为配置错误，
 *        回退为 300（NaN 会让窗口判断恒不成立、`Math.max(0, NaN)` 又被 `setTimeout`
 *        当作 0，节流形同失效）
 * @param {ThrottleDecoratorOptions} [options] - leading/trailing 配置（默认双开启）
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class ScrollComponent {
 *   // 默认 leading+trailing：首调立即执行，窗口尾最后一次调用以最新参数补发
 *   @withThrottle(100)
 *   handleScroll(position: number) {
 *     updateScrollPosition(position)
 *   }
 *
 *   // 纯 leading（旧行为）：窗口内的后续调用全部丢弃
 *   @withThrottle(100, { trailing: false })
 *   trackFirstHit(position: number) {}
 *
 *   detached() {
 *     // 卸载时丢弃窗口内尚未补发的调用（也可用 flushThrottledCalls 立即补发一次）
 *     cancelThrottledCalls(this)
 *   }
 * }
 * ```
 */
export declare function withThrottle(interval?: number, options?: ThrottleDecoratorOptions): MethodDecorator;
```

### `withTimeout`

```ts
/**
 * GeomStore - 超时装饰器
 *
 * 在指定时间内完成方法执行，超时则抛出错误
 *
 */
/**
 * 创建超时装饰器
 *
 * 在指定时间内完成方法执行，超时则抛出错误
 *
 * 注意：使用 Promise.race 实现，超时后底层异步任务不会被真正取消（仍会继续执行），
 * 仅是调用方提前得到超时拒绝。如需真正中断，请在被装饰的方法内部实现 AbortController
 * 等取消机制。超时抛出的错误不保证底层任务已清理。
 *
 * 超时错误由 `async-core.ts` 的 `createTimeoutError` 统一构造：它是普通 `Error` 加一个
 * `code === TIMEOUT_ERROR_CODE`（`'ACTION_TIMEOUT'`），**跨入口识别按这个 code，不要按消息文本**。
 * 消息文本 `Timeout after <n>ms` 仍是既有契约的一部分（调用方与
 * `tests/unit/extras/action/utils.test.ts` 都按它匹配），改动即破坏性变更；其中 `<n>` 是
 * **实际生效**的毫秒数（超过 2^31-1 ms 的配置会先被截到该上限再写入消息，
 * 故消息里的数字一定等于真正等待的时间）。
 * 另注意 `ActionExecutor.executeWithTimeout` 的文案是 `Action timeout after <n>ms`，
 * 两个入口的**文本**并不相同，但两者都经由 `raceWithTimeout` 拿到同一个 `code`，
 * 所以「是不是超时」在跨入口维度上是可判定的。
 *
 * @param {number} [timeout=5000] - 超时时间（毫秒，必须为大于 0 的有限数值；
 *        超过 2^31-1 ms 的值按该上限生效，与宿主 `setTimeout` 的可表达区间一致）
 * @returns {MethodDecorator} 方法装饰器
 * @throws {RangeError} timeout 非法（在装饰器工厂调用时就抛出，而不是等到方法执行）
 *
 * @example
 * ```typescript
 * class NetworkComponent {
 *   @withTimeout(5000) // 5秒超时
 *   async fetchData(url: string) {
 *     return await fetch(url).then(r => r.json())
 *   }
 * }
 *
 * try {
 *   const data = await networkComponent.fetchData('/api/data')
 * } catch (error) {
 *   // 先收窄再取 message：strict + useUnknownInCatchVariables 下 catch 形参是 unknown
 *   if (error instanceof Error && error.message.includes('Timeout after')) {
 *     console.error('Request timed out')
 *     showTimeoutMessage()
 *   }
 * }
 * ```
 */
export declare function withTimeout(timeout?: number): MethodDecorator;
```
