# `./extras/snapshot` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.5.1`
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
    /** 每批次处理节点数 */
    batchSize?: number;
    /** 每批次间隔（毫秒） */
    batchInterval?: number;
    /** 超时时间（毫秒） */
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
    /** 已访问的弱引用集合（用于循环检测） */
    visited: WeakMap<object, unknown>;
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
 */
export interface SnapshotErrorContext {
    /** 当前路径 */
    path: string;
    /** 当前深度 */
    depth: number;
    /** 当前值 */
    value: unknown;
    /** 是否可恢复 */
    recoverable: boolean;
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
     * @param {SnapshotResult<T1>} snapshot1 - 第一个快照
     * @param {SnapshotResult<T2>} snapshot2 - 第二个快照（支持不同类型）
     * @returns {SnapshotDiff} 差异结果
     */
    compareSnapshots<T1, T2>(snapshot1: SnapshotResult<T1>, snapshot2: SnapshotResult<T2>): SnapshotDiff;
    /**
     * 生成快照ID
     *
     * @private
     */
    private generateSnapshotId;
    /**
     * 获取数据类型
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
    /** 节点数量 */
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
    /** 最大递归深度 */
    maxDepth?: number;
    /** 是否检测循环引用 */
    detectCircular?: boolean;
    /** 是否包含不可枚举属性 */
    includeNonEnumerable?: boolean;
    /** 自定义克隆函数 */
    customCloner?: (value: unknown, context: CloneContext) => unknown | undefined;
    /** 是否异步执行 */
    async?: boolean;
    /** 异步批次大小 */
    batchSize?: number;
    /** 进度回调 */
    onProgress?: (progress: SnapshotProgress) => void;
    /** 错误回调 */
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
    /** 总节点数（预估） */
    total: number;
    /** 进度百分比 */
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
 */
export interface SnapshotResult<T = unknown> {
    /** 快照数据 */
    data: T;
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
    /** 克隆操作次数 */
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
     * @param {SnapshotResult<T1>} snapshot1 - 第一个快照
     * @param {SnapshotResult<T2>} snapshot2 - 第二个快照（支持不同类型）
     * @returns {SnapshotDiff} 差异结果
     */
    compareSnapshots<T1, T2>(snapshot1: SnapshotResult<T1>, snapshot2: SnapshotResult<T2>): SnapshotDiff;
    /**
     * 生成快照ID
     *
     * @private
     */
    private generateSnapshotId;
    /**
     * 获取数据类型
     *
     * @private
     */
    private getDataType;
}
```
