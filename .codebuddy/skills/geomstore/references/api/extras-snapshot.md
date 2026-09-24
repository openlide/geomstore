# `./extras/snapshot` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.8.0`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`./extras/snapshot`
> - 类型声明：`./dist/extras/snapshot.d.ts`
> - 返回索引：[`index.md`](./index.md)

### `AsyncSnapshotOptions`

```ts
/**
 * 异步快照配置
 */
export interface AsyncSnapshotOptions extends SnapshotOptions {
    /** 异步模式 */
    async: true;
    /**
     * 每批次间隔（毫秒）：0 / 负数 / 非有限值都按 0 处理，即批间用 `setTimeout(fn, 0)`
     * 让出控制权（本库不提供「暂停超过一宿」的语义）
     */
    batchInterval?: number;
    /**
     * 超时时间（毫秒）：只有有限正数会武装定时器；0 / 负数 / Infinity / NaN 一律表示
     * **不设超时**。注意 0 不是「立即超时」——`setTimeout(fn, 0)` 会在第一个宏任务就判超时，
     * 那不是本选项的含义
     */
    timeout?: number;
}
```

### `CloneContext`

```ts
/**
 * 克隆上下文
 */
export interface CloneContext {
    /** 当前路径 */
    path: string;
    /** 当前深度 */
    depth: number;
    /** 父对象 */
    parent: unknown;
    /** 属性键 */
    key: string | number;
    /**
     * 已访问节点登记表：源对象 → 该节点**已建好的克隆**（不是 WeakSet 式的纯成员集合）。
     *
     * 循环检测命中时读回的是这个克隆本身，从而让环上的多处引用指向同一实例
     * （clone.ts / clone-async.ts 每建好一个容器壳就 `set(value, cloned)`）。
     * 值限定为 object：写入方只有 Date/RegExp 之外的容器与对象壳，原语与自定义克隆器
     * 的返回值都不登记；此前记作 unknown 会让读回方无从知道拿到的是可用克隆
     */
    visited: WeakMap<object, object>;
}
```

### `SnapshotDiff`

```ts
/**
 * 快照差异
 */
export interface SnapshotDiff {
    /** 是否发生变化 */
    changed: boolean;
    /** 变化列表（kind 缺省为 'changed'；集合差异使用 'added' / 'removed'） */
    changes: Array<{
        path: string;
        oldValue: unknown;
        newValue: unknown;
        kind?: 'changed' | 'added' | 'removed';
    }>;
    /** 第一个快照时间戳 */
    timestamp1: number;
    /** 第二个快照时间戳 */
    timestamp2: number;
    /**
     * 两份输入是否都可作为比对依据：任一来源 `success: false` 即为 false。
     *
     * 失败快照的 `data` 按 types.ts 的契约可能是 `undefined` 或部分构建的半成品，
     * 而两份半成品之间的真实差异恰好落在「两侧都还没填上的键」上——逐路径比较会静默漏报。
     * 故本值为 false 时 `changed` 恒为 true（宁多勿漏的整树报告），
     * 它表达的是「输入不可信」而不是「内容确有差异」；要做回滚判定/去重，
     * 先判本值再读 `changes`
     */
    inputTrusted: boolean;
}
```

### `SnapshotError`

```ts
/**
 * 快照错误
 */
export interface SnapshotError {
    /** 错误类型 */
    type: 'circular' | 'maxDepth' | 'cloneError' | 'timeout' | 'unknown';
    /** 错误消息 */
    message: string;
    /** 发生错误的路径 */
    path: string;
    /** 原始错误 */
    originalError?: Error;
}
```

### `SnapshotErrorContext`

```ts
/**
 * 快照错误上下文
 *
 * 刻意不带「是否可恢复」这类标记：本库只有两处咨询点（`cloneError` / `circular`），
 * 两处的降级路径都存在，故该标记恒为真，既不参与走向判定也没有分流价值；
 * 回调要按错误种类分流请读 {@link SnapshotError#type}
 */
export interface SnapshotErrorContext {
    /** 当前路径 */
    path: string;
    /** 当前深度 */
    depth: number;
    /** 当前值 */
    value: unknown;
}
```

### `SnapshotManager`

```ts
/**
 * 增强型快照管理器
 *
 * 提供高性能、可配置的状态快照功能。
 *
 * @class SnapshotManager
 *
 * @example
 * ```typescript
 * const manager = new SnapshotManager()
 *
 * // 基础快照
 * const result = manager.createSnapshot(state)
 *
 * // 异步快照
 * const asyncResult = await manager.createSnapshotAsync(state, {
 *   onProgress: (p) => console.log(`${p.percentage}%`)
 * })
 * ```
 */
export declare class SnapshotManager {
    private defaultOptions;
    private snapshotIdCounter;
    private readonly snapshotIdSuffix;
    constructor(options?: Partial<SnapshotOptions>);
    /**
     * 创建同步快照
     *
     * @param {T} data - 要快照的数据
     * @param {SnapshotOptions} options - 配置选项
     * @returns {SnapshotResult<T>} 快照结果
     *
     * @example
     * ```typescript
     * const result = manager.createSnapshot(state)
     * console.log(result.metadata.nodeCount)
     * ```
     */
    createSnapshot<T>(data: T, options?: SnapshotOptions): SnapshotResult<T>;
    /**
     * 创建异步快照
     *
     * 非阻塞式快照创建，支持进度回调和取消。
     * 克隆按节点分片入队，每批次处理 batchSize 个节点，
     * 批间让出控制权，避免大对象同步递归阻塞主线程。
     *
     * 超时口径：`timeout` 翻位时只有「队列仍有未处理任务」或「超时后丢掉过入队任务」
     * 才使结果 `success: false` 并落一条 `timeout` 错误——完好克隆不因定时器晚到而判失败。
     *
     * @param {T} data - 要快照的数据
     * @param {AsyncSnapshotOptions} options - 异步配置选项
     * @returns {Promise<SnapshotResult<T>>} 快照结果Promise
     *
     * @example
     * ```typescript
     * const result = await manager.createSnapshotAsync(largeState, {
     *   batchSize: 100,
     *   onProgress: (p) => updateProgressBar(p.percentage)
     * })
     * ```
     */
    createSnapshotAsync<T>(data: T, options?: Partial<AsyncSnapshotOptions>): Promise<SnapshotResult<T>>;
    /**
     * 对比两个快照
     *
     * 契约同 diff.ts 的 `compareSnapshots`（实现已拆至 ./diff.js，纯函数，不依赖管理器实例状态）：
     * 两侧 `success` 不必先判，但任一侧为 false 时结果里的 `inputTrusted` 会是 false，
     * 此时 `changed: true` 只是「输入不可信 → 宁多勿漏」的报告形状，不代表两份 data 真有差异
     *
     * @param {SnapshotResult<T1>} snapshot1 - 第一个快照
     * @param {SnapshotResult<T2>} snapshot2 - 第二个快照（支持不同类型）
     * @returns {SnapshotDiff} 差异结果
     */
    compareSnapshots<T1, T2>(snapshot1: SnapshotResult<T1>, snapshot2: SnapshotResult<T2>): SnapshotDiff;
    /**
     * 失败结果的统一构造（同步 / 异步两条 catch 共用）
     *
     * 两条失败分支此前各写一份 metadata 与 stats：异步那份还把 stats 换成全零新对象，
     * 而引擎在抛出前已经往共享 stats 里累加过 cloneOperations / circularReferences /
     * maxDepthHits，于是同一份输入在两条路径上的失败统计对不上。现在两条都交出共享 stats
     * （数值与实际工作量一致），metadata 的规模项仍归零——失败结果的 data 不可信，
     * 按它统计出的 size / nodeCount / maxDepth 同样不可信
     *
     * @param source 调用方传入的原始数据：只用于 dataType，**不会**进 data
     */
    private buildFailureResult;
    /**
     * 生成快照ID
     *
     * @private
     */
    private generateSnapshotId;
    /**
     * 获取数据类型
     *
     * 原型不可探测的值（Proxy 的 getPrototypeOf 陷阱抛错、已 revoke 的 Proxy）按 `typeof`
     * 归类：本方法在结果组装阶段被调用（成功路径与失败路径各一次），抛出会把 cloneDeep
     * 已按 onError 契约降级好的结果整个变成异常，等于在出口处重新制造 #288 那个洞；
     * 失败路径上它还在 catch 里，抛出会让 createSnapshot 连失败结果都不交付、直接向调用方抛
     *
     * `Array.isArray` 也在兜范围内：它与 `instanceof` 同走 [[Get]] / [[Class]] 内部方法，
     * 对 revoked Proxy 一样抛 TypeError。`value === null` 与兜底的 `typeof` 永不抛，留在外面
     *
     * @private
     */
    private getDataType;
}
```

### `SnapshotMetadata`

```ts
/**
 * 快照元数据
 */
export interface SnapshotMetadata {
    /** 快照ID */
    id: string;
    /** 创建时间戳 */
    timestamp: number;
    /** 原始数据类型 */
    dataType: string;
    /** 数据大小（字节，估算） */
    size: number;
    /**
     * 节点数量：本次实际进入克隆的节点数（同步 / 异步两条路径同口径）。
     * 不含因超出 maxDepth 而在计数前返回的节点。
     */
    nodeCount: number;
    /** 最大深度 */
    maxDepth: number;
    /** 是否包含循环引用 */
    hasCircular: boolean;
}
```

### `SnapshotOptions`

```ts
/**
 * GeomStore - 快照类型定义
 *
 * 自 SnapshotManager.ts 拆出（纯类型，无运行期代码）。
 */
/**
 * 快照配置选项
 */
export interface SnapshotOptions {
    /**
     * 最大递归深度（包含式边界：深度大于该值的节点降级为占位值）
     *
     * 同步路径另受一个与选项无关的栈安全硬上限约束（见 clone.ts 的 `HARD_MAX_CLONE_DEPTH`）：
     * 递归克隆的栈深度等于数据深度，只按本选项设限时会以 `RangeError` 的形态伪装成某条
     * 属性上的 `cloneError`。超出硬上限的部分按 `maxDepth` 降级报告，需要更深的结构走异步路径
     */
    maxDepth?: number;
    /** 是否检测循环引用 */
    detectCircular?: boolean;
    /** 是否包含不可枚举属性 */
    includeNonEnumerable?: boolean;
    /**
     * 自定义克隆函数：命中该节点时返回其克隆结果。
     *
     * 「已处理 / 交回默认克隆」的契约以**返回值与抛错**表达，而非返回类型（返回 undefined
     * 同样落在 `unknown` 内）：
     * - 返回 `undefined`：视为未命中，按 Date/RegExp/Map/Set/数组/对象的默认规则继续克隆；
     * - 返回其他值：作为该节点的克隆结果直接使用；
     * - 抛错：落账一条 `cloneError` 并咨询 {@link SnapshotOptions#onError}——
     *   返回 true 则丢弃该节点（**不会**把活引用兜底进快照），返回 false 则整个快照以
     *   SnapshotAbortError 中止、交付失败结果。
     */
    customCloner?: (value: unknown, context: CloneContext) => unknown;
    /** 是否异步执行 */
    async?: boolean;
    /** 异步批次大小 */
    batchSize?: number;
    /**
     * 进度回调（仅异步路径）。抛错不会污染快照结果：异常被就地记为一条 `unknown`
     * 错误（不影响 `success`）并停止后续上报
     */
    onProgress?: (progress: SnapshotProgress) => void;
    /**
     * 错误回调：**降级决策的作出方**而非上报方，故不对其抛错做静默兜底：
     * 同步路径下异常冲出克隆、整个快照以失败结果交付；异步路径下该节点被记为 cloneError，
     * `success` 随之为 false。
     *
     * 返回值按**真值**解释（判定写法是 `if (!shouldContinue)`，与 `=== false` 不等价）：
     * - truthy：忽略该错误，按各错误种类的降级口径继续；
     * - falsy（`false` / `null` / `undefined`，含回调不写 return 的 `void` 写法）：拒绝继续。
     *   因此 `(e) => { logger.warn(e) }` 这种只观测不表态的箭头函数会中止整个快照，
     *   纯观测请显式 `return true` 或改用 {@link SnapshotOptions#onProgress}。
     *
     * 「拒绝继续」的后果按错误种类分岔，并非统一的「中止整个快照」：
     * - `cloneError`（customCloner 抛错、ownKeys / 属性描述符 / 属性读取抛错）：抛
     *   SnapshotAbortError，同步与异步两条路径都以 `success: false` 的失败结果交付；
     * - `circular`：该位置写入 `'[Circular Reference]'` 占位字符串并继续，快照仍可 `success: true`。
     *
     * `maxDepth` 与 `timeout` 两类错误不经本回调（前者在克隆前置判定处直接返回占位值，
     * 后者由队列驱动在结果上直接落账）
     */
    onError?: (error: SnapshotError, context: SnapshotErrorContext) => boolean | void;
}
```

### `SnapshotProgress`

```ts
/**
 * 快照进度
 */
export interface SnapshotProgress {
    /** 已处理节点数 */
    processed: number;
    /**
     * 总节点数（预估）：由入口的一次有界前序遍历得出（估算深度上限独立于 maxDepth），
     * 深于该上限的结构按叶子截断计数，故对深层数据**系统性偏小**
     */
    total: number;
    /**
     * 进度百分比（0-100）：processed / total 的近似值，上限截到 100。
     * total 偏小的深层数据会提前到 100（见 {@link SnapshotProgress#total}），不可当完成判据
     */
    percentage: number;
    /** 当前处理路径 */
    currentPath: string;
    /** 已用时间（毫秒） */
    elapsedTime: number;
    /** 预计剩余时间（毫秒） */
    estimatedTimeRemaining: number;
}
```

### `SnapshotResult`

```ts
/**
 * 快照结果
 *
 * 三字段的组合口径以现有实现为准（三条不变量均有回归用例锁定）：
 * - `success: true` 时 `errors` **可以非空**：只有 `cloneError` 参与 success 判定，
 *   `circular` / `maxDepth` 与 onProgress 抛错记的 `unknown` 都属「已降级的可恢复项」；
 * - `success: false` 时 `errors` **必非空**：三个失败来源（cloneError、超时、顶层异常）
 *   都先落账再返回，不存在「失败但无原因」的结果；
 * - `data` 只在 `success: true` 时是完整克隆：失败路径下它可能是 `undefined`（中止 / 顶层异常 /
 *   根节点被丢弃）或部分构建的半成品（异步超时），**消费前必须先判 `success`**。
 *
 * `data` 之所以声明为 `T | undefined` 而不是 `T`：三条失败来源交付的就是 `undefined`，
 * 写成 `T` 得靠 `undefined as T` 断言圆场，而 strict 下 `result.data.x` 在 `success: false`
 * 时也照样编译通过——上面那条「必须先判 success」在类型侧就无人把关了。
 * 刻意不做成 `data?: T`（可选）也不做成以 `success` 判别的联合类型：失败分支的 `data` 未必为空
 * （异步超时交的是半成品），把它收窄成「false 时必空」是另一种失真；接口一旦改成联合，
 * 任何以 `success: boolean` 自行组装结果的调用方都会无收益转红
 */
export interface SnapshotResult<T = unknown> {
    /** 快照数据：`success: false` 时可能是 `undefined` 或部分构建的半成品，用前先判 success */
    data: T | undefined;
    /** 快照元数据 */
    metadata: SnapshotMetadata;
    /** 是否成功 */
    success: boolean;
    /** 错误列表 */
    errors: SnapshotError[];
    /** 性能统计 */
    stats: SnapshotStats;
}
```

### `SnapshotStats`

```ts
/**
 * 快照统计
 */
export interface SnapshotStats {
    /** 总耗时（毫秒） */
    duration: number;
    /**
     * 克隆操作次数：产出了独立克隆值的节点数——容器（对象/数组/Map/Set）、Date/RegExp
     * 这类需重建的内建对象，以及按 onError 意愿丢弃节点的失败降级。
     * 原语与函数按引用直返、不构成一次克隆操作，故不计
     */
    cloneOperations: number;
    /** 遇到的循环引用数 */
    circularReferences: number;
    /** 达到最大深度的节点数 */
    maxDepthHits: number;
}
```

### `createSnapshot`

```ts
/**
 * 创建快照（便捷函数）
 */
export declare function createSnapshot<T>(data: T, options?: SnapshotOptions): SnapshotResult<T>;
```

### `createSnapshotAsync`

```ts
/**
 * 创建异步快照（便捷函数）
 */
export declare function createSnapshotAsync<T>(data: T, options?: Partial<AsyncSnapshotOptions>): Promise<SnapshotResult<T>>;
```

### `default`

```ts
/**
 * 增强型快照管理器
 *
 * 提供高性能、可配置的状态快照功能。
 *
 * @class SnapshotManager
 *
 * @example
 * ```typescript
 * const manager = new SnapshotManager()
 *
 * // 基础快照
 * const result = manager.createSnapshot(state)
 *
 * // 异步快照
 * const asyncResult = await manager.createSnapshotAsync(state, {
 *   onProgress: (p) => console.log(`${p.percentage}%`)
 * })
 * ```
 */
export declare class SnapshotManager {
    private defaultOptions;
    private snapshotIdCounter;
    private readonly snapshotIdSuffix;
    constructor(options?: Partial<SnapshotOptions>);
    /**
     * 创建同步快照
     *
     * @param {T} data - 要快照的数据
     * @param {SnapshotOptions} options - 配置选项
     * @returns {SnapshotResult<T>} 快照结果
     *
     * @example
     * ```typescript
     * const result = manager.createSnapshot(state)
     * console.log(result.metadata.nodeCount)
     * ```
     */
    createSnapshot<T>(data: T, options?: SnapshotOptions): SnapshotResult<T>;
    /**
     * 创建异步快照
     *
     * 非阻塞式快照创建，支持进度回调和取消。
     * 克隆按节点分片入队，每批次处理 batchSize 个节点，
     * 批间让出控制权，避免大对象同步递归阻塞主线程。
     *
     * 超时口径：`timeout` 翻位时只有「队列仍有未处理任务」或「超时后丢掉过入队任务」
     * 才使结果 `success: false` 并落一条 `timeout` 错误——完好克隆不因定时器晚到而判失败。
     *
     * @param {T} data - 要快照的数据
     * @param {AsyncSnapshotOptions} options - 异步配置选项
     * @returns {Promise<SnapshotResult<T>>} 快照结果Promise
     *
     * @example
     * ```typescript
     * const result = await manager.createSnapshotAsync(largeState, {
     *   batchSize: 100,
     *   onProgress: (p) => updateProgressBar(p.percentage)
     * })
     * ```
     */
    createSnapshotAsync<T>(data: T, options?: Partial<AsyncSnapshotOptions>): Promise<SnapshotResult<T>>;
    /**
     * 对比两个快照
     *
     * 契约同 diff.ts 的 `compareSnapshots`（实现已拆至 ./diff.js，纯函数，不依赖管理器实例状态）：
     * 两侧 `success` 不必先判，但任一侧为 false 时结果里的 `inputTrusted` 会是 false，
     * 此时 `changed: true` 只是「输入不可信 → 宁多勿漏」的报告形状，不代表两份 data 真有差异
     *
     * @param {SnapshotResult<T1>} snapshot1 - 第一个快照
     * @param {SnapshotResult<T2>} snapshot2 - 第二个快照（支持不同类型）
     * @returns {SnapshotDiff} 差异结果
     */
    compareSnapshots<T1, T2>(snapshot1: SnapshotResult<T1>, snapshot2: SnapshotResult<T2>): SnapshotDiff;
    /**
     * 失败结果的统一构造（同步 / 异步两条 catch 共用）
     *
     * 两条失败分支此前各写一份 metadata 与 stats：异步那份还把 stats 换成全零新对象，
     * 而引擎在抛出前已经往共享 stats 里累加过 cloneOperations / circularReferences /
     * maxDepthHits，于是同一份输入在两条路径上的失败统计对不上。现在两条都交出共享 stats
     * （数值与实际工作量一致），metadata 的规模项仍归零——失败结果的 data 不可信，
     * 按它统计出的 size / nodeCount / maxDepth 同样不可信
     *
     * @param source 调用方传入的原始数据：只用于 dataType，**不会**进 data
     */
    private buildFailureResult;
    /**
     * 生成快照ID
     *
     * @private
     */
    private generateSnapshotId;
    /**
     * 获取数据类型
     *
     * 原型不可探测的值（Proxy 的 getPrototypeOf 陷阱抛错、已 revoke 的 Proxy）按 `typeof`
     * 归类：本方法在结果组装阶段被调用（成功路径与失败路径各一次），抛出会把 cloneDeep
     * 已按 onError 契约降级好的结果整个变成异常，等于在出口处重新制造 #288 那个洞；
     * 失败路径上它还在 catch 里，抛出会让 createSnapshot 连失败结果都不交付、直接向调用方抛
     *
     * `Array.isArray` 也在兜范围内：它与 `instanceof` 同走 [[Get]] / [[Class]] 内部方法，
     * 对 revoked Proxy 一样抛 TypeError。`value === null` 与兜底的 `typeof` 永不抛，留在外面
     *
     * @private
     */
    private getDataType;
}
```
