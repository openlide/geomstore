# `./extras/action` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.5.0`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`./extras/action`
> - 类型声明：`./dist/extras/action.d.ts`
> - 返回索引：[`index.md`](./index.md)

### `ActionDecorator`

```ts
/**
 * Action装饰器类型
 */
export type ActionDecorator = (target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor) => PropertyDescriptor | void;
```

### `ActionExecutionContext`

```ts
/**
 * Action执行上下文
 */
export interface ActionExecutionContext<S = unknown, A = unknown> {
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
     * @param {number} timeout - 超时时间（毫秒）
     * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果
     * @throws {Error} 如果超时或Action执行失败
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
     *   if (error.message.includes('timeout')) {
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
 * const loader = new ActionLoader({
 *   autoLoading: true,
 *   loadingKey: 'loading',
 *   errorKey: 'error',
 *   errorDataKey: 'errorData'
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
     * 加载状态映射
     * @private
     * @type {Map<string, boolean>}
     */
    private loadingStates;
    /**
     * loading 引用计数（按 loading 键）：同一 action 重叠调用时，
     * 首个调用置 true、最后一个完成才置 false，避免共享布尔键的提前翻转。
     * 可注入共享存储（withLoading 场景）：同宿主上不同选项签名的装饰器
     * 对同一 loading 键的计数必须集中，否则仍会互相提前翻转
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
     * @type {Map<string, unknown>}
     */
    private errorData;
    /**
     * 配置选项
     * @private
     * @type {Required<ActionLoaderOptions>}
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
     * @template T - Action函数类型
     * @param {T} action - 要包装的异步Action函数
     * @param {string} actionName - Action名称（用于状态键）
     * @param {(key: string, value: unknown) => void} setState - 设置状态的函数
     * @returns {T} 包装后的Action
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
    wrap<T extends (...args: unknown[]) => Promise<unknown>>(action: T, actionName: string, setState: (key: string, value: unknown) => void): T;
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
     * 设置error
     *
     * @private
     * @param {string} actionName - Action名称
     * @param {Error | null} error - 错误对象或null
     * @param {(key: string, value: unknown) => void} setState - 设置状态的函数
     */
    private setError;
    /**
     * 清除error
     *
     * @private
     * @param {string} actionName - Action名称
     * @param {(key: string, value: unknown) => void} setState - 设置状态的函数
     */
    private clearError;
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
     * @returns {unknown} 错误数据，包含message、stack、timestamp
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
    getErrorData(actionName: string): unknown;
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
     * 清除所有记录的loading、error和errorData状态
     *
     * @example
     * ```typescript
     * // 重置所有状态
     * loader.clear()
     * ```
     */
    clear(): void;
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
     * @internal 供 withLoading 装饰器按宿主 + loading 键注入：
     * 同一宿主上不同选项签名（如不同 errorKey）的装饰器实例各自持有计数时，
     * 对同一 loading 键的并发计数互不可见，先完成的调用会提前翻转共享布尔键。
     * 直接构造 ActionLoader 的调用方无需提供。
     */
    sharedLoadingCounts?: Map<string, number>;
}
```

### `ActionResult`

```ts
/**
 * Action执行结果
 */
export interface ActionResult<T = unknown> {
    /** 返回值 */
    data?: T;
    /** 是否成功 */
    success: boolean;
    /** 错误信息 */
    error?: Error;
    /** 开始时间 */
    startTime: number;
    /** 结束时间 */
    endTime: number;
    /** 执行时长 */
    duration: number;
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
 * // 执行Action
 * const result = await utils.execute(actions, 'fetchData', 'user-123')
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
     * 创建Action工具实例
     *
     * @param {A} _actions - Actions对象（保留用于扩展）
     * @param {ActionUtilsOptions<A>} [options] - 配置选项（支持依赖注入）
     */
    constructor(_actions: A, options?: ActionUtilsOptions<A>);
    /**
     * 执行Action（代理到executor）
     *
     * @template K - Action名称类型
     * @param {A} actions - Actions对象
     * @param {K} actionName - Action名称
     * @param {Parameters<A[K]>} args - Action参数
     * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果
     *
     * @example
     * ```typescript
     * const result = await utils.execute(actions, 'fetchData', 'user-123')
     * ```
     */
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
 */
export interface AsyncActions extends Actions {
    [key: string]: (...args: unknown[]) => Promise<unknown>;
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
    /** 最大重试次数 */
    retries?: number;
    /** 基础重试延迟（毫秒） */
    delay?: number;
    /** 判断是否应该重试的函数 */
    shouldRetry?: (error: Error) => boolean;
}
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
 */
/**
 * 创建防抖装饰器
 *
 * 延迟执行方法，如果在延迟时间内再次调用，则重置定时器
 * 适用于搜索、输入框等场景
 *
 * @param {number} [delay=300] - 延迟时间（毫秒）
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class SearchComponent {
 *   @withDebounce(500)
 *   async search(query: string) {
 *     return await searchAPI(query)
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
 * GeomStore - 日志装饰器
 *
 * 在Action执行前后记录日志，便于调试
 *
 */
/**
 * 创建日志装饰器
 *
 * 在Action执行前后记录日志，便于调试
 *
 * @param {string} [name] - Action名称（用于日志标识）
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class MyComponent {
 *   @withLog('fetchUserData')
 *   async fetchUser(id: string) {
 *     return await fetch(`/api/users/${id}`).then(r => r.json())
 *   }
 * }
 *
 * // 控制台输出：
 * // [Action] fetchUserData started with args: ['user-123']
 * // [Action] fetchUserData completed with result: { id: 'user-123', name: 'John' }
 * ```
 */
export declare function withLog(name?: string): MethodDecorator;
```

### `withRetry`

```ts
/**
 * 创建重试装饰器
 *
 * 在方法失败时自动重试，支持指数退避和条件重试
 *
 * @param {RetryDecoratorOptions} [options={}] - 重试选项
 * @param {number} [options.retries=3] - 最大重试次数
 * @param {number} [options.delay=100] - 基础重试延迟（毫秒）
 * @param {(error: Error) => boolean} [options.shouldRetry] - 判断是否应该重试的函数
 * @returns {MethodDecorator} 方法装饰器
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
 * @param {number} [interval=300] - 执行间隔（毫秒）
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
 * @param {number} [timeout=5000] - 超时时间（毫秒）
 * @returns {MethodDecorator} 方法装饰器
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
 *   if (error.message.includes('Timeout')) {
 *     console.error('Request timed out')
 *     showTimeoutMessage()
 *   }
 * }
 * ```
 */
export declare function withTimeout(timeout?: number): MethodDecorator;
```
