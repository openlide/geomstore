# `./extras/error` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.8.3`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`./extras/error`
> - 类型声明：`./dist/extras/error/index.d.ts`
> - 返回索引：[`index.md`](./index.md)

### `ActionError`

````ts
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
````

### `ComposeError`

````ts
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
````

### `ErrorBoundary`

````ts
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
 * // 两个实参都要显式给：第二参 F 是回退值类型，默认 `undefined`，
 * // 只写 S 时 `fallback` 会被要求符合 `undefined`
 * const boundary = new ErrorBoundary<MyState, MyState>({
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
     * // safeResult 是回退值（本例为 { count: 0, user: null }）；
     * // 只有「显式 recoverable: true 且不配 fallback」时才是 undefined，
     * // 未配 fallback 又未显式 recoverable 时错误原样重抛
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
````

### `ErrorBoundaryOptions`

```ts
/**
 * 错误边界选项
 *
 * @template S - 状态类型（传入 fallback 计算函数的上下文）
 * @template F - 回退值类型（与状态类型解耦：回退值不必是状态对象）
 */
export interface ErrorBoundaryOptions<S = unknown, F = unknown> {
    /** 回退状态：固定值或计算函数（`F` 可为函数类型时的二义见 {@link ErrorFallback}） */
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

### `ErrorFallback`

```ts
/**
 * GeomStore - 错误类型定义
 *
 * 0.9.0 起只保留错误边界的契约类型。此前的错误处理/监控/恢复契约
 * （ErrorContext / ErrorHandler / ErrorReporter / MonitoringConfig 等）已随
 * `extras/error` 精简一并移除。
 */
/**
 * 回退状态：支持固定值或根据错误/当前状态动态计算
 *
 * **`F` 本身可调用时这个联合是二义的**：消费侧一律以 `typeof fallback === 'function'` 判别形态
 * （见 `ErrorBoundary.handleError` 与 `getFallbackState`：二者都以 `typeof fallback === 'function'`
 * 判别形态），因此「恰好是函数的**静态**回退值」
 * 会被当成计算函数、以 `(error, currentState)` 调用，而不是原样返回。需要把函数本身当回退值时
 * 请包一层对象（如 `{ fn }`），别直接传裸函数。
 *
 * 另：`withErrorBoundary()` 不传泛型时 `F` 落回 `unknown`，而 `unknown | X` 仍是 `unknown`，
 * 类型层连「两种形态」都表达不出来，此时判别只剩运行时 `typeof`。
 *
 * **注意参数顺序**：`ErrorFallback<F, S>` 的回退值类型 `F` 在前、状态类型 `S` 在后；
 * 而 `ErrorBoundaryOptions<S, F>` 的顺序相反（状态在前）。桥接点 `ErrorBoundaryOptions.fallback`
 * 的类型是 `ErrorFallback<F, S>`（按本类型的顺序传参）。消费者手写泛型时注意不要混淆。
 */
export type ErrorFallback<F = unknown, S = unknown> = F | ((error: Error, currentState: S | undefined) => F);
```

### `GeomStoreError`

````ts
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
     *   { operation: 'save', storeName: 'user-store' }
     * )
     * console.log(error.getFriendlyMessage())
     * // "Action failed in store 'user-store': save"
     * ```
     */
    getFriendlyMessage(): string;
}
````

### `PluginError`

````ts
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
````

### `SelectorError`

````ts
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
````

### `StateError`

````ts
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
````

### `ValidationError`

````ts
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
````

### `createError`

````ts
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
````

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

````ts
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
````

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

````ts
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
````
