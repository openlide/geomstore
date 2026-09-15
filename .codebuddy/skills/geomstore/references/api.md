# GeomStore API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.5.0`
> - 内容来源：构建产物类型声明（`dist/**/*.d.ts`，随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
>
> 使用规则与快速上手见同目录 [`../SKILL.md`](../SKILL.md)；默认值、语义契约与易误用点见仓库 `docs/API.md`（不随包发布，仅仓库内可见）。
>
> **文件较大，请按符号名检索（例：`rg -n '^### `createSelector`' references/api.md`），不要整篇读取。**

## 入口一览

| 引入路径 | 类型声明 | 展开方式 |
| --- | --- | --- |
| `.` | `./dist/index.d.ts` | 完整声明 |
| `./core` | `./dist/core/index.d.ts` | 仅符号名 |
| `./extras` | `./dist/extras/index.d.ts` | 仅符号名 |
| `./extras/action` | `./dist/extras/action.d.ts` | 完整声明 |
| `./extras/enterprise` | `./dist/extras/enterprise.d.ts` | 完整声明 |
| `./extras/error` | `./dist/extras/error/index.d.ts` | 完整声明 |
| `./extras/performance` | `./dist/extras/performance.d.ts` | 完整声明 |
| `./extras/plugins` | `./dist/extras/plugins.d.ts` | 完整声明 |
| `./extras/selector` | `./dist/extras/selector.d.ts` | 完整声明 |
| `./extras/snapshot` | `./dist/extras/snapshot.d.ts` | 完整声明 |
| `./integrations` | `./dist/integrations/index.d.ts` | 完整声明 |

---

## `.`

> 类型声明：`./dist/index.d.ts`

### `ActionNames`

```ts
/**
 * 从 Actions 类型提取所有 action 名称
 */
export type ActionNames<A extends Actions> = keyof A & string;
```

### `Actions`

```ts
/**
 * Actions 类型约束
 * 用于约束 actions 参数类型
 */
export type Actions = Record<string, (...args: any[]) => any>;
```

### `AppOptions`

```ts
/**
 * `withAppStore` 处理的 App 配置对象
 *
 * 保留微信原生 App 生命周期与自定义字段，集成层在此基础上注入 store 相关能力。
 */
export interface AppOptions {
    /** 全局数据对象（微信原生字段） */
    globalData?: Record<string, unknown>;
    /**
     * 应用启动生命周期
     *
     * 这里**刻意不声明 `this`**：运行时传入的是增强后的 App 实例（globalData 上的映射状态、
     * 绑定的 action、调试 API），精确类型由 withAppStore 注入的 `AppThis` 提供。
     * 若在此写成 `this: AppOptions`，会覆盖注入结果，并使 `this.globalData` 退回可选。
     */
    onLaunch?(...args: unknown[]): void;
    /** 应用切前台生命周期 */
    onShow?(...args: unknown[]): void;
    /** 应用切后台生命周期 */
    onHide?(): void;
    /** 全局错误回调 */
    onError?(error: unknown): void;
    /** 允许业务扩展自定义字段 */
    [key: string]: unknown;
}
```

### `CacheOptions`

```ts
/**
 * 缓存配置选项
 *
 * @interface CacheOptions
 * @template K - 键类型
 * @template V - 值类型
 */
export interface CacheOptions<K = unknown, V = unknown> {
    /** 初始容量 */
    capacity?: number;
    /** 是否启用访问统计 */
    enableStats?: boolean;
    /** 是否记录访问时间 */
    trackAccessTime?: boolean;
    /** 自定义淘汰回调 */
    onEvict?: (key: K, value: V) => void;
}
```

### `CacheStats`

```ts
/**
 * 缓存统计信息
 */
export interface CacheStats {
    /** 是否启用缓存 */
    enabled: boolean;
    /** 缓存的键数量 */
    size: number;
    /** 缓存的键列表 */
    keys: Array<string>;
    /** 总缓存命中次数 */
    hits: number;
    /** 总缓存未命中次数 */
    misses: number;
    /** 缓存淘汰次数 */
    evictions?: number;
}
```

### `clone`

```ts
/**
 * 统一的克隆函数
 *
 * @param obj 要克隆的对象
 * @param options.mode 克隆模式（默认 'deep'）：
 * - `deep`：递归深拷贝，支持 Date/RegExp/Map/Set 与循环引用（复用 deepCloneState）
 * - `shallow`：仅复制一层（数组/Map/Set 展开复制，对象浅拷贝）
 * - `safe`：尽力深拷贝且绝不抛错——结构保真与 deep 相同（Date/Map/Set 正确克隆），
 *   仅在克隆器真正失败时降级返回原引用并告警。旧版 safe 的 JSON 序列化语义
 *   （Date 变字符串、Map/Set 变 `{}`、丢 undefined/函数）已移至显式命名的 `json` 模式
 * - `json`：JSON 序列化往返，产出可结构化克隆的纯数据副本（有损），
 *   序列化失败（循环引用等）时返回原引用
 * @returns 克隆后的对象
 */
export declare function clone<T>(obj: T, options?: {
    mode?: CloneMode;
}): T;
```

### `CloneMode`

```ts
/** 克隆模式 */
export type CloneMode = 'deep' | 'shallow' | 'safe' | 'json';
```

### `ComponentConfig`

```ts
/**
 * 组件增强配置的形状（`withComponentStore` 的返回类型）
 *
 * 与 `ComponentThis` 的分工：配置对象上的注入 action 位于 `methods` 内（集成层确实把它们
 * 合并进 `config.methods`，再由微信提升到实例），故这里不在顶层重复声明——否则返回类型会
 * 声明出配置对象上并不存在的顶层方法（`config.add()` 能编译却在运行时失败）。
 */
export type ComponentConfig<S extends State, A extends Actions, G extends Getters<S> = Getters<S>, M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>, ExtraMethods extends object = object> = {
    data: ExtractPageData<S, M, G>;
    methods: ExtraMethods & ExtractMappedActions<A, M>;
} & {
    setData: (data: Record<string, unknown>, callback?: () => void) => void;
};
```

### `ComponentOwnMethods`

```ts
/**
 * 从 Component 配置提取用户自定义方法对象（C.methods）
 * Component 自定义方法在 methods 命名空间内，直接提取
 */
export type ComponentOwnMethods<C> = C extends {
    methods: infer M;
} ? (M extends Record<string, unknown> ? M : object) : object;
```

### `ComponentThis`

```ts
/**
 * 组件方法 this 类型（原生精确推导）
 *
 * **仅用于注入方法内的 `this`**（由 `WithComponentThis` 挂到 methods / lifetimes /
 * pageLifetimes 各命名空间）。描述装饰器返回的配置形状请用 `ComponentConfig`。
 *
 * 关于「展平」：微信会把 `methods` 的条目提升到组件实例，所以运行时
 * `this.add(...)` 与 `this.methods.add(...)` **都可用**；若类型只在 `methods` 下提供注入成员，
 * 方法内就必须手写 `this` 标注。故此处把注入成员展平到顶层，同时保留 `methods` 命名空间。
 */
export type ComponentThis<S extends State, A extends Actions, G extends Getters<S> = Getters<S>, M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>, ExtraMethods extends object = object> = {
    data: ExtractPageData<S, M, G>;
} & ExtraMethods & ExtractMappedActions<A, M> & {
    /** 配置对象上的 methods 命名空间（微信 Component 写法）；实例上这些条目被提升为顶层方法 */
    methods: ExtraMethods & ExtractMappedActions<A, M>;
    setData: (data: Record<string, unknown>, callback?: () => void) => void;
};
```

### `ComposedStore`

```ts
/**
 * ComposedStore 类
 *
 * 组合多个 Store 为一个统一的 Store 实例
 * 使用类替代对象字面量，提供更好的性能和方法查找效率
 */
declare class ComposedStore<S extends State = State> implements Store<S> {
    readonly name: string;
    readonly actions: Record<string, (...args: unknown[]) => unknown>;
    /** 实例级钩子系统 - 组合 Store 透传到子 Store */
    readonly hooks: HookSystem;
    /** 销毁标记 */
    destroyed: boolean;
    /** 内部 Store 数组 */
    private _stores;
    /** 命名空间 */
    private _namespace;
    /** 严格模式 */
    private _strict;
    /** stores 引用（暴露给外部） */
    stores: Record<string, Store>;
    /** 防抖相关：实例级统一调度，避免多个订阅者各自维护标志导致非首个订阅者丢通知 */
    private _notificationScheduled;
    /** 当前活跃的订阅者：监听器 → 注册次数。
     *  与 SubscriptionManager 同语义——同一函数注册 N 次通知 N 次，退订只减一，
     *  减到 0 才真正移除。此前用 Set 会使「退订其中一份」直接删除整个监听器，
     *  用户仍持有的另一份退订句柄静默失效、永不再收到通知。 */
    private _composedListeners;
    /** 对子 Store 的订阅句柄（destroy 时统一退订，避免闭包残留） */
    private _storeUnsubscribers;
    /** 子 store 单路合并订阅是否已建立（构造期为缓存失效建立，组合层订阅复用，避免重复占额度） */
    private _childSubscriptionsReady;
    /** 已告警过的 state 键冲突组合（每个组合只告警一次，避免高频 getState 刷屏） */
    private _warnedStateKeyConflicts;
    /** 子 Store 钩子桥接的退订函数（destroy 时统一移除，防止闭包残留） */
    private _hookUnsubscribers;
    /** 自上次通知以来发生变更的子 store 名集合：命名空间模式下供 isStateKeyDirty 精确跳过 setData */
    private _dirtyStores;
    /** 合并状态缓存：非命名空间/命名空间两种读取形态各缓存一份，子 store 变化时失效 */
    private _mergedCache;
    /** 只读冻结形态的合并状态缓存（对应 state getter），与 _mergedCache 独立以免冻结影响 getState 消费者 */
    private _mergedCacheFrozen;
    /** 合并缓存是否启用：子 store 订阅失效回调建立失败时降级为每次读取重合并，保证不返回陈旧状态 */
    private _mergedCacheEnabled;
    constructor(stores: Store[], options?: ComposeOptions);
    /**
     * 建立（或复用）对子 store 的单路合并订阅：每个子 store 仅一份，
     * 回调同时完成「合并缓存失效 + 调度通知」。幂等：已建立则直接返回，
     * 保证构造期与组合层订阅期共用同一条订阅，不重复占用子 store 订阅额度。
     */
    private _ensureChildSubscriptions;
    /**
     * 销毁状态守卫：在调用任何公开方法前检查 Store 是否已销毁
     */
    private _ensureAlive;
    /** 使合并状态缓存失效：任一子 store 通知时调用（构造期订阅） */
    private _invalidateMergedCache;
    /**
     * 命名空间模式：按 store.name 归并各子 store 视图，语义与 getState/state/$snapshot 共用。
     *
     * 合并策略已拆至 ./merge.js
     */
    private _mergeNamespaced;
    getState(): S;
    /**
     * 非命名空间模式下平铺合并各 store 的 state 键。
     *
     * 合并策略与冲突告警已拆至 ./merge.js（warnedStateKeyConflicts 由实例持有以跨调用去重）
     */
    private _mergeStateMaps;
    get state(): S;
    setState<K extends keyof S>(key: K, value: S[K]): void;
    $patch(partialState: Partial<S>): void;
    $replaceState(newState: S): void;
    dispatch(actionName: string, ...args: unknown[]): unknown;
    /**
     * 合并后的 Getters 定义（只读）
     *
     * 键的合并规则与 getter() 的解析语义一致：命名空间模式下为 `storeName/getterName`，
     * 非命名空间模式为裸名（同名冲突取第一个 store 的定义）
     */
    get getters(): Getters<S>;
    /** 类型安全 getter（与 Store 接口重载签名保持一致） */
    getter<K extends keyof Getters<S>>(getterName: K): InferGetterReturn<Getters<S>, K>;
    /**
     * 获取所有子 Store 的 getter 名称列表。
     *
     * 若存在命名空间前缀，返回 `${storeName}/${getterName}` 形式；否则返回去重后的裸名。
     */
    getGetterNames(): string[];
    /**
     * 向所有活跃订阅者广播当前状态
     */
    private _notifyListeners;
    /**
     * 调度一次合并通知：同一微任务内的多次状态变化只触发一次广播
     */
    private _scheduleNotify;
    subscribe(listener: StateListener<S>): () => void;
    /**
     * 判断指定状态键自上次通知以来是否发生变更
     *
     * 组合 Store 将多个子 store 的状态按 store 名合并，键空间与子 store 不对应，
     * 无法精确映射到某个子 store 的脏键。这里保守返回 true（视为已变更），
     * 使绑定层在对象值上保持「宁多勿漏」行为，确保正确性；
     * 对象值的整体替换（引用变化）仍由引用比较兜底发送。
     *
     * @param _key - 组合层状态键（即子 store 名）
     * @returns 始终返回 true（保守：不跳过任何 setData）
     */
    isStateKeyDirty(key: string): boolean;
    /** 释放一份监听器注册：同一监听器减到 0 才真正移除。
     *
     *  注意：不再随「最后一个组合层监听器退订」撤销子 store 订阅——该订阅同时承担
     *  合并缓存失效（_invalidateMergedCache）职责，撤销后 getState() 会返回陈旧缓存，
     *  且 _childSubscriptionsReady 保持 true 使重新订阅无法重建通知（静默失效）。
     *  子 store 订阅与构造期建立对称，统一在 destroy() 释放。
     */
    private _releaseListener;
    use(plugin: Plugin): () => void;
    /**
     * 销毁组合 Store
     *
     * @param destroyStores - 是否级联销毁子 Store（默认 true，保持向后兼容）。
     *  当子 Store 在组合之外被独立持有并继续使用时，应传入 false：
     *  仅退订组合层订阅并清理钩子，避免牵连外部持有的子 Store
     */
    destroy(destroyStores?: boolean): void;
    getCached<K extends keyof S>(key: K): S[K];
    enableCache(keys?: Array<keyof S>): void;
    disableCache(): void;
    invalidateCache<K extends keyof S>(key?: K): void;
    getCacheStats(): CacheStats;
    startBatch(): void;
    /** 对各子 store 开启批量：已被独立销毁的子 store 跳过。
     *
     *  必须与 _endBatchOnStores 对称容错：此前裸循环在某个子 store 已销毁时抛错中断，
     *  已成功 startBatch 的子 store 批量深度悬置为 1 且再无 endBatch 到达，
     *  通知被永久抑制——对仍健康的子 store 是静默失效。跳过已销毁子 store 后
     *  start/end 两侧深度始终配对（被跳过者从未 start，收尾时同样被跳过）。
     */
    private _startBatchOnStores;
    endBatch(): void;
    /** 对各子 store 收尾批量深度：已被独立销毁的子 store 跳过 */
    private _endBatchOnStores;
    batch<T>(fn: () => T): T;
    $snapshot(): Readonly<S>;
    $restore(snapshot: Readonly<S>): void;
}
```

### `ComposeOptions`

```ts
/**
 * 组合选项
 */
export interface ComposeOptions {
    /** 命名空间模式：true 启用（默认分隔符 /），或指定前缀字符串 */
    namespace?: string | boolean;
    /** 延迟初始化 */
    lazy?: boolean;
    /** 严格模式（访问不存在的Store报错） */
    strict?: boolean;
    /** Store树结构 */
    tree?: boolean;
}
```

### `composeStore`

```ts
/**
 * Store组合函数 - 类型安全重载
 * 支持完整的类型推断，保留原始 Store 的类型信息
 */
declare function composeStore<Stores extends readonly StoreLike[]>(stores: [...Stores], options?: ComposeOptions): Store<ExtractStates<Stores>, ExtractActions<Stores>, ExtractGetters<Stores>>;
```

### `ConnectOptions`

```ts
/**
 * 连接选项
 *
 * 泛型参数均可由 withPageStore / withComponentStore 的 store 参数自动推断：
 * - `S`：约束 mapState 键/值须为状态键（拼错编译报错）
 * - `A`：约束 mapActions 键/值须为 action 名
 * - `G`：约束 mapGetters 键/值须为 getter 名
 */
export interface ConnectOptions<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> {
    /** 映射state */
    mapState?: readonly (keyof S)[] | Record<string, keyof S>;
    /** 映射getters */
    mapGetters?: readonly (keyof G)[] | Record<string, keyof G>;
    /** 映射actions（数组形式按 action 名映射；对象形式支持本地名重命名，值须为 action 名） */
    mapActions?: readonly (keyof A)[] | Record<string, keyof A>;
    /** 是否自动注入到页面/组件data（使用getCached） */
    autoInject?: boolean;
    /** 自动注入的字段映射（从store键到本地键） */
    injectMapping?: Record<string, string>;
    /** 是否在页面onShow/组件attached时更新注入（默认仅在onLoad时） */
    autoUpdateOnShow?: boolean;
}
```

### `createStore`

```ts
export declare function createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(options: FactoryStoreConfig<S, A, G>): Store<S, A, G>;
```

### `createStoreTree`

```ts
/**
 * 创建Store树
 */
export declare function createStoreTree(stores: Store[], options?: ComposeOptions): StoreTreeNode;
```

### `deepEqual`

```ts
/**
 * GeomStore - 深度相等比较
 *
 * 自 helpers.ts 拆出：深度比较两个值（迭代实现，含循环引用与 Set 无序语义）。
 *
 * @module utils/equality
 */
/**
 * 深度比较两个值（使用迭代实现避免栈溢出）
 *
 * 注意：超过 maxDepth 时本函数直接返回 false（并告警），而非抛错或视为相等。
 * 这是保守语义——深度未知/超限的结构按「不相等」处理，
 * 以避免误报相等导致缓存误命中。调用方如需比较超深结构，
 * 请显式传入更大的 maxDepth。
 *
 * @param a - 第一个值
 * @param b - 第二个值
 * @param maxDepth - 最大递归深度（默认1000），超限时返回 false
 * @returns 是否相等
 */
export declare function deepEqual(a: unknown, b: unknown, maxDepth?: number): boolean;
```

### `deepMerge`

```ts
/**
 * 深度合并对象
 *
 * 注意：此函数会修改 target 对象。对于非纯对象值（如数组），
 * 会进行深拷贝以防止 source 和 target 之间共享引用。
 */
export declare function deepMerge<T extends Record<string, unknown>>(target: T, ...sources: Partial<T>[]): T;
```

### `ExtractPageData`

```ts
/**
 * 从 ConnectOptions 提取完整的页面 data 类型
 *
 * 类型契约（严格）：
 * - `Partial<S>`：全部状态键均可访问，但未映射的键运行时不一定存在，故其类型为
 *   `T | undefined`，强制调用方判空，避免静默拿到 undefined。
 * - 已映射键（`ExtractMappedState` / `ExtractMappedGetters`）经交集收窄仍保持精确类型：
 *   `Partial<T> & T` 等于 `T`，故 Partial 不会削弱映射键。
 * - 不提供索引签名：拼错的键会直接编译报错，而非静默返回 `unknown`。
 *   data 上的动态键请在页面/应用的 `data`（或 `globalData`）字面量中显式声明；
 *   运行时的动态写入走 `setData`，它本来就接受 `Record<string, unknown>`。
 */
export type ExtractPageData<S extends State, M extends {
    mapState?: readonly (keyof S)[] | Record<string, keyof S>;
    mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey>;
}, G extends Getters<S> = Getters<S>> = Partial<S> & ExtractMappedState<S, M> & ExtractMappedGetters<M, G>;
```

### `get`

```ts
/**
 * 通过路径获取对象值
 */
export declare function get<T = unknown>(obj: T, path: string, defaultValue?: unknown): unknown;
```

### `Getters`

```ts
/**
 * Getters类型 - 支持类型推断
 */
export type Getters<S extends State = State> = {
    [K: string]: (state: S) => unknown;
};
```

### `globalRegistry`

```ts
globalRegistry: StoreRegistry
```

### `HookHandler`

```ts
/**
 * 钩子处理函数
 */
export type HookHandler<TArgs extends unknown[] = unknown[], TResult = void> = (...args: TArgs) => TResult;
```

### `HookName`

```ts
/**
 * 钩子名称枚举
 */
export type HookName = 'beforeSetState' | 'afterSetState' | 'beforePatch' | 'afterPatch' | 'beforeDispatch' | 'afterDispatch' | 'beforeReplaceState' | 'afterReplaceState' | 'onError';
```

### `HookSystem`

```ts
/** 钩子系统实现类，每个 Store 实例独立拥有一个 HookSystem 实例 */
export declare class HookSystem implements IHookSystem {
    private hooks;
    on(hookName: HookName, handler: HookHandler): () => void;
    emit(hookName: HookName, ...args: unknown[]): void;
    clear(hookName?: HookName): void;
    /**
     * 获取钩子数量
     *
     * 注意双语义：无参时返回已注册的钩子种类数；传入 hookName 时返回
     * 该钩子当前的监听器数量。如需语义明确，推荐使用 listenerCount()。
     */
    size(hookName?: HookName): number;
    /**
     * 获取指定钩子的监听器数量
     *
     * size() 的语义明确别名：避免无参/有参返回不同量纲导致的误用。
     */
    listenerCount(hookName: HookName): number;
}
```

### `identity`

```ts
/**
 * 返回参数的函数
 */
export declare function identity<T>(value: T): T;
```

### `IHookSystem`

```ts
/**
 * 钩子系统契约接口
 *
 * 由 core/hooks 的 HookSystem 类实现；类型层仅依赖此接口，
 * 避免 types 反向依赖实现类。
 */
export interface IHookSystem {
    /** 注册钩子处理器，返回取消注册函数 */
    on(hookName: HookName, handler: HookHandler): () => void;
    /** 触发钩子 */
    emit(hookName: HookName, ...args: unknown[]): void;
    /** 清除钩子（指定名称或全部） */
    clear(hookName?: HookName): void;
    /** 查询钩子数量：传入 hookName 返回该钩子的 handler 数，不传返回已注册的钩子名称数 */
    size(hookName?: HookName): number;
}
```

### `InferActionArgs`

```ts
/**
 * 推断Action参数类型
 */
export type InferActionArgs<A extends Actions, K extends keyof A> = A[K] extends (...args: infer Args) => unknown ? Args : never;
```

### `InferActionReturn`

```ts
/**
 * 推断Action返回类型
 */
export type InferActionReturn<A extends Actions, K extends keyof A> = A[K] extends (...args: never[]) => infer R ? R : never;
```

### `InferGetterReturn`

```ts
/**
 * 推断Getter返回类型
 */
export type InferGetterReturn<G extends Record<string, (state: any) => any>, K extends keyof G> = G[K] extends (...args: never[]) => infer R ? R : never;
```

### `isArray`

```ts
/**
 * 判断是否是数组
 */
export declare function isArray(value: unknown): value is unknown[];
```

### `isFunction`

```ts
/**
 * 判断是否是函数
 */
export declare function isFunction(value: unknown): value is (...args: unknown[]) => unknown;
```

### `isGeomStore`

```ts
/**
 * 检查是否是 GeomStore 实例
 *
 * 通过品牌 Symbol 精确识别，避免仅通过鸭子类型（属性存在性）误判。
 * @param value - 待检查的值
 */
export declare function isGeomStore<S extends State = State>(value: unknown): value is Store<S>;
```

### `isObject`

```ts
/**
 * GeomStore - 工具函数集合
 *
 * 提供常用的工具函数：
 * - 类型判断函数
 * - 对象操作函数
 * - 路径操作函数
 * - 克隆操作函数
 */
/**
 * 判断是否是对象
 *
 * 注意：Map/Set 不是普通对象，深合并/克隆场景需单独处理，
 * 否则会被展开成空普通对象导致静默数据损坏。
 */
export declare function isObject(value: unknown): value is Record<string, unknown>;
```

### `isPlainObject`

```ts
/**
 * 判断是否是纯对象（plain object）
 */
export declare function isPlainObject(value: unknown): boolean;
```

### `isPromise`

```ts
/**
 * 判断是否是Promise
 */
export declare function isPromise(value: unknown): value is Promise<unknown>;
```

### `LRUCache`

```ts
export declare class LRUCache<K, V> {
    /** 当前容量 */
    private capacity;
    /** 缓存存储（Map提供O(1)查找） */
    private cache;
    /** 虚拟头节点（简化边界处理） */
    private head;
    /** 虚拟尾节点（简化边界处理） */
    private tail;
    /** 当前缓存项数量 */
    private _size;
    /** 命中次数 */
    private hitCount;
    /** 未命中次数 */
    private missCount;
    /** 淘汰次数 */
    private evictionCount;
    /** 总访问时间（毫秒） */
    private totalAccessTime;
    /** 配置选项 */
    private options;
    /**
     * 创建LRU缓存实例
     *
     * @param {number | CacheOptions} config - 容量或配置选项
     *
     * @example
     * ```typescript
     * // 仅指定容量
     * const cache1 = new LRUCache<string, number>(100)
     *
     * // 指定配置
     * const cache2 = new LRUCache<string, number>({
     *   capacity: 100,
     *   enableStats: true,
     *   trackAccessTime: true
     * })
     * ```
     */
    constructor(config?: number | CacheOptions<K, V>);
    /**
     * 创建哨兵节点（虚拟头/尾节点）
     *
     * @private
     * @param {number} timestamp - 时间戳
     * @returns {LRUNode<K, V>} 哨兵节点
     */
    private createSentinelNode;
    /**
     * 创建新的缓存节点
     *
     * @private
     * @param {K} key - 键
     * @param {V} value - 值
     * @returns {LRUNode<K, V>} 新节点
     */
    private createNode;
    /**
     * 获取缓存值
     *
     * 如果键存在，将其移动到头部（标记为最近使用）并返回值。
     * 如果键不存在，返回undefined。
     *
     * 优化：减少 Date.now() 调用次数，只在必要时更新访问时间
     *
     * @param {K} key - 键
     * @returns {V | undefined} 值或undefined
     *
     * @example
     * ```typescript
     * const value = cache.get('user:123')
     * if (value !== undefined) {
     *   console.log('Cache hit:', value)
     * } else {
     *   console.log('Cache miss')
     * }
     * ```
     */
    get(key: K): V | undefined;
    /**
     * 设置缓存值
     *
     * 如果键已存在，更新值并将其移动到头部。
     * 如果键不存在，创建新节点并添加到头部。
     * 如果超出容量，淘汰最久未使用的节点。
     *
     * @param {K} key - 键
     * @param {V} value - 值
     * @returns {this} 支持链式调用
     *
     * @example
     * ```typescript
     * cache.set('user:123', { name: 'John', age: 30 })
     *        .set('user:456', { name: 'Jane', age: 25 })
     * ```
     */
    set(key: K, value: V): this;
    /**
     * 批量设置缓存值
     *
     * @param {Array<[K, V]>} entries - 键值对数组
     * @returns {this} 支持链式调用
     *
     * @example
     * ```typescript
     * cache.setMany([
     *   ['key1', value1],
     *   ['key2', value2],
     *   ['key3', value3]
     * ])
     * ```
     */
    setMany(entries: Array<[K, V]>): this;
    /**
     * 获取缓存值，如果不存在则计算并缓存
     *
     * @param {K} key - 键
     * @param {() => V} factory - 值工厂函数
     * @returns {V} 值
     *
     * @example
     * ```typescript
     * const user = cache.getOrSet('user:123', () => {
     *   return fetchUserFromDatabase(123)
     * })
     * ```
     */
    getOrSet(key: K, factory: () => V): V;
    /**
     * 检查键是否存在（不更新访问顺序）
     *
     * @param {K} key - 键
     * @returns {boolean} 是否存在
     */
    has(key: K): boolean;
    /**
     * 查看缓存值（不更新访问顺序）
     *
     * @param {K} key - 键
     * @returns {V | undefined} 值或undefined
     */
    peek(key: K): V | undefined;
    /**
     * 删除缓存项
     *
     * @param {K} key - 键
     * @returns {boolean} 是否删除成功
     */
    delete(key: K): boolean;
    /**
     * 清空缓存
     *
     * @returns {this} 支持链式调用
     */
    clear(): this;
    /**
     * 获取当前缓存大小
     *
     * @returns {number} 缓存项数量
     */
    size(): number;
    /**
     * 获取当前容量
     *
     * @returns {number} 容量
     */
    getCapacity(): number;
    /**
     * 动态调整容量
     *
     * 如果新容量小于当前大小，会淘汰最久未使用的项。
     *
     * @param {number} newCapacity - 新容量
     * @returns {this} 支持链式调用
     *
     * @example
     * ```typescript
     * cache.resize(50)  // 缩小到50
     * cache.resize(200) // 扩大到200
     * ```
     */
    resize(newCapacity: number): this;
    /**
     * 获取所有键（按最近使用顺序，最新的在前）
     *
     * @returns {K[]} 键数组
     */
    keys(): K[];
    /**
     * 获取所有值（按最近使用顺序，最新的在前）
     *
     * @returns {V[]} 值数组
     */
    values(): V[];
    /**
     * 获取所有条目（按最近使用顺序，最新的在前）
     *
     * @returns {Array<{key: K, value: V}>} 条目数组
     */
    entries(): Array<{
        key: K;
        value: V;
    }>;
    /**
     * 遍历缓存（按最近使用顺序）
     *
     * @param {(value: V, key: K) => void} callback - 回调函数
     */
    forEach(callback: (value: V, key: K) => void): void;
    /**
     * 获取缓存统计信息
     *
     * @returns {LRUCacheStats} 统计信息
     *
     * @example
     * ```typescript
     * const stats = cache.getStats()
     * console.log(`Hit rate: ${stats.hitRate}%`)
     * console.log(`Size: ${stats.size}/${stats.capacity}`)
     * ```
     */
    getStats(): LRUCacheStats;
    /**
     * 重置统计信息（不清除缓存数据）
     *
     * @returns {this} 支持链式调用
     */
    resetStats(): this;
    /**
     * 转换为普通对象
     *
     * @returns {Record<string, V>} 普通对象
     */
    toObject(): Record<string, V>;
    /**
     * 将节点移动到头部（标记为最近使用）
     *
     * @private
     * @param {LRUNode<K, V>} node - 节点
     */
    private moveToHead;
    /**
     * 添加节点到头部
     *
     * @private
     * @param {LRUNode<K, V>} node - 节点
     */
    private addToHead;
    /**
     * 从链表中移除节点
     *
     * @private
     * @param {LRUNode<K, V>} node - 节点
     */
    private removeFromList;
    /**
     * 淘汰最久未使用的节点（LRU策略核心）
     *
     * @private
     */
    private evictLRU;
}
```

### `LRUCacheStats`

```ts
/**
 * LRU缓存统计信息
 *
 * @interface LRUCacheStats
 */
export interface LRUCacheStats {
    /** 缓存容量 */
    capacity: number;
    /** 当前缓存项数量 */
    size: number;
    /** 缓存命中次数 */
    hits: number;
    /** 缓存未命中次数 */
    misses: number;
    /** 总访问次数 */
    totalAccesses: number;
    /** 命中率（百分比） */
    hitRate: number;
    /** 未命中率（百分比） */
    missRate: number;
    /** 淘汰的缓存项数量 */
    evictions: number;
    /** 当前缓存键列表（按最近使用顺序） */
    keys: string[];
    /** 平均访问时间（毫秒） */
    avgAccessTime: number;
    /** 缓存项平均存活时间（毫秒） */
    avgItemLifetime: number;
}
```

### `NamespaceConfig`

```ts
/**
 * 命名空间配置
 */
export interface NamespaceConfig {
    /** 命名空间分隔符 */
    separator?: string;
    /** 是否自动添加命名空间 */
    autoPrefix?: boolean;
}
```

### `noop`

```ts
/**
 * 空函数
 */
export declare function noop(): void;
```

### `PageConfig`

```ts
/**
 * 页面增强配置的形状（`withPageStore` 的返回类型）
 *
 * 与 `PageThis` 的分工：`PageThis` 描述**方法内的 `this`**（含映射 action，注入于页面实例），
 * 本类型描述**装饰器返回的配置对象**——注入的 action 运行时绑定在实例上、并不存在于配置对象，
 * 故这里只含 data 与框架成员。
 *
 * 之所以拆开：把「实例视角」直接当作「配置视角」会让返回类型声明出运行时并不存在的成员
 * （例如 `config.increment()` 能通过编译却在运行时失败）。
 */
export type PageConfig<S extends State, M extends {
    mapState?: readonly (keyof S)[] | Record<string, keyof S>;
    mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey>;
} = ConnectOptions<S, Actions, Getters<S>>, G extends Getters<S> = Getters<S>> = {
    data: ExtractPageData<S, M, G>;
    setData: (data: Record<string, unknown>, callback?: () => void) => void;
    getTabBar?: () => {
        syncSelectedTab?: () => void;
    } | undefined;
};
```

### `PageOwnMethods`

```ts
/**
 * 从 Page 配置提取用户自定义方法（排除保留键，方法 this 不检查以避免循环兼容性）
 */
export type PageOwnMethods<C> = {
    [K in keyof Omit<C, PageReservedKeys>]: C[K] extends (...args: infer P) => infer R ? (...args: P) => R : C[K];
};
```

### `PageReservedKeys`

```ts
/**
 * Page 保留键（框架生命周期 + 内部字段），不参与自定义方法提取
 */
export type PageReservedKeys = 'data' | 'setData' | 'onLoad' | 'onShow' | 'onHide' | 'onUnload' | 'onReady' | 'onPullDownRefresh' | 'onReachBottom' | 'onPageScroll' | 'onShareAppMessage' | 'onResize' | 'onTabItemTap' | '__geomUnbinds';
```

### `PageThis`

```ts
/**
 * 页面方法 this 类型（原生精确推导）
 *
 * 由 withPageStore 装饰器自动构造并注入方法签名，用户无需手动填写泛型参数。
 * 方法内 `this.data` 包含完整状态 + 映射的 state/getters（精确类型），
 * 映射的 action 以精确签名挂载到 this（参数/返回值类型不丢失），
 * 用户自定义方法（排除保留键）也作为 ExtraMethods 注入 this。
 *
 * @example
 * ```typescript
 * const store = createStore({ state: { count: 0 }, actions: { increment() { this.state.count++ } } })
 *
 * Page(withPageStore(store, { mapState: ['count'], mapActions: ['increment'] })({
 *   data: { localData: '...' },
 *   onLoad() {
 *     this.data.count // ✅ 自动推导为 number
 *     this.increment() // ✅ 精确签名
 *   }
 * }))
 * ```
 */
export type PageThis<S extends State, A extends Actions, G extends Getters<S> = Getters<S>, M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>, ExtraMethods extends object = object> = {
    data: ExtractPageData<S, M, G>;
} & ExtraMethods & ExtractMappedActions<A, M> & {
    setData: (data: Record<string, unknown>, callback?: () => void) => void;
    getTabBar?: () => {
        syncSelectedTab?: () => void;
    } | undefined;
};
```

### `Plugin`

```ts
/**
 * 插件接口
 *
 * ```ts
 * const plugin: Plugin<UserState> = {
 *   name: 'user-analytics',
 *   install(store) {            // store: Store<UserState, …>，getState() 类型精确
 *     store.subscribe((state) => track(state.userInfo))
 *   },
 * }
 * const uninstall = store.use(plugin)   // 无需断言
 * ```
 */
export interface Plugin<S extends State = State> {
    name: string;
    install: PluginHook<S>;
}
```

### `PluginHook`

```ts
/**
 * 插件安装钩子 - 返回可选的卸载函数
 *
 * 泛型只开放**状态类型 S**：插件实现几乎只需要精确的 state 形状（如 `filter: (state) => …`），
 * actions / getters 使用其默认约束即可。若把 A / G 也开放，调用方传具体 Store 时会因
 * 参数逆变而在每个使用点被迫断言。
 *
 * 省略类型参数即得「适用于任意 Store」的插件（`Plugin` = `Plugin<State>`），
 * 例如 logger / analyzer 这类与状态形状无关的插件。
 */
export type PluginHook<S extends State = State> = (store: Store<S, Actions, Getters<S>>) => void | (() => void);
```

### `set`

```ts
/**
 * 通过路径设置对象值
 */
export declare function set<T = unknown>(obj: T, path: string, value: unknown): void;
```

### `shallowEqual`

```ts
/**
 * 浅比较两个值
 */
export declare function shallowEqual(a: unknown, b: unknown): boolean;
```

### `State`

```ts
/**
 * GeomStore - Store类型定义
 * 采用 ThisType 方案消除循环依赖
 */
/**
 * 状态类型
 * 使用宽松对象约束，既兼容 Record<string, unknown> 的索引签名写法，
 * 也允许未声明索引签名的业务 interface 直接作为 State 类型自动推断。
 */
export type State = object;
```

### `StateListener`

```ts
/**
 * 状态监听器
 */
export type StateListener<S extends State = State> = (state: S) => void;
```

### `Store`

```ts
/**
 * Store 实现类（模块化重构版）
 *
 * @class Store
 * @template S - 状态类型
 * @implements StoreInterface<S, A, G>
 */
export declare class Store<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> implements StoreInterface<S, A, G> {
    /** Store名称 */
    readonly name: string;
    /** 真实状态（私有） */
    private _state;
    /** 内部访问标记 */
    private _isInternalAccess;
    /** 状态保护配置 */
    private _stateProtection;
    /** 状态保护启用标志（内联缓存） */
    private _stateProtectionEnabled;
    /** 通知前是否深拷贝（显式配置；undefined 表示自动：仅当存在可写订阅者时拷贝） */
    private _notifyClone;
    /** 是否显式配置了 notify.clone（用于区分「默认自动」与「用户显式关闭」） */
    private _notifyCloneExplicit;
    /** 是否启用 notify 异步合并（微任务合并多次通知为一次，减少 setData 次数） */
    private _notifyAsyncEnabled;
    /** 异步通知合并器（仅启用时创建） */
    private _asyncNotifier?;
    /** 脏键集合：记录自上次通知以来发生变更的状态键，供集成层精确跳过未变化的映射 */
    private _dirtyKeys;
    /** 是否仅在状态实际变化时通知（默认 false） */
    private _notifyOnlyOnChange;
    /** 状态变更计数器（脏跟踪：供 onlyOnChange 模式判断 dispatch 是否修改了状态） */
    private _mutationCount;
    /** 脏跟踪代理缓存（仅 onlyOnChange 模式使用，$replaceState 时重建） */
    private _dirtyProxyCache;
    /** Actions集合（公开） */
    actions: A;
    /** 插件集合（按本 Store 的状态类型约束，状态无关插件以 Plugin<State> 兼容） */
    private _plugins;
    /** 插件卸载函数集合 */
    private _pluginUninstallFns;
    /** dispatch跟踪标记 */
    private _dispatching;
    /** batch 首层开始时的变更计数基线（onlyOnChange 模式判断批量期间是否发生变更） */
    private _batchMutationBaseline;
    /** 最近一次通知已覆盖到的变更计数：供 dispatch 补发通知去重（onlyOnChange） */
    private _lastNotifiedMutationCount;
    /** 销毁标记 - 防止销毁后继续操作 */
    private _destroyed;
    /** Proxy缓存（构造/重建时赋值，见 _rebuildStateProxyManager） */
    private _proxyCache;
    /** 状态保护代理管理器（构造/重建时赋值，见 _rebuildStateProxyManager） */
    private _stateProxyManager;
    /** 订阅管理器 */
    private _subscriptionManager;
    /** 缓存管理器 */
    private _cacheManager;
    /** Action执行器 */
    private _actionManager;
    /** Getter执行器 */
    private _getterManager;
    /** 批量更新管理器 */
    private _batchManager;
    /** 实例级钩子系统（每个 Store 独立） */
    private _hooks;
    /** 公开的钩子系统访问器，供插件使用 */
    readonly hooks: HookSystem;
    /** Store计数器 */
    private static _storeCounter;
    constructor(options?: StoreOptions<S, A, G>);
    /**
     * 状态访问器 - 返回受保护的Proxy
     * 注意：state 是只读访问器，不支持直接赋值。请使用 setState()/$patch()/$replaceState() 来修改状态。
     */
    get state(): S;
    /** 获取当前状态的原始引用（内部使用）。
     *
     *  ⚠️ 注意：此方法返回的是内部状态的直接引用，修改返回值会直接影响 Store 状态，
     *  且不会触发订阅通知、钩子或缓存更新。
     *
     *  如果需要安全地读取状态，请使用 `store.state` getter（返回受保护的 Proxy）。
     *  此方法主要供高级场景和内部模块使用。
     */
    getState(): S;
    /**
     * 设置单个状态值
     * @param key - 状态键名（不能为空）
     * @param value - 状态值
     */
    setState<K extends keyof S>(key: K, value: S[K]): void;
    /**
     * 批量更新状态
     * @param partialState - 部分状态对象（不能为 null/undefined）
     */
    $patch(partialState: Partial<S>): void;
    /**
     * 替换整个状态
     * @param newState - 新状态对象或状态工厂函数（工厂函数写法：`() => ({...})`，返回值不能为 null/undefined）
     */
    $replaceState(newState: S | (() => S)): void;
    /**
     * 判断指定状态键自上次通知以来是否发生变更
     *
     * 供集成层（withPageStore / withComponentStore）在同步通知回调内精确判断某个映射键是否变化，
     * 从而跳过未变化对象值的冗余 setData。脏键在每次通知结束时清空。
     *
     * @param key - 状态键名
     * @returns 该键自上次通知后是否发生过变更
     */
    isStateKeyDirty(key: string): boolean;
    /**
     * 创建状态快照
     */
    $snapshot(): Readonly<S>;
    /**
     * 从快照恢复状态
     */
    $restore(snapshot: Readonly<S>): void;
    /**
     * 执行action - 类型安全实现
     * @throws 如果 Store 已销毁
     */
    dispatch<K extends keyof A>(actionName: K, ...args: InferActionArgs<A, K>): InferActionReturn<A, K>;
    dispatch(actionName: string, ...args: unknown[]): unknown;
    /**
     * 使用 getter - 类型安全实现
     * @throws 如果 Store 已销毁
     */
    getter<K extends keyof G>(getterName: K): InferGetterReturn<G, K>;
    getter(getterName: string): unknown;
    /**
     * Getters 定义对象（只读）
     *
     * 供类型系统推断 Getters 键集合（如 withPageStore 的 mapGetters 约束），
     * 亦可用于调试与运行时检查。允许在销毁后调用（只读，返回空对象）。
     */
    get getters(): G;
    /**
     * 获取所有 getter 的名称列表
     *
     * 用于 DevTools、调试与运行时反射。允许在销毁后调用（只读，返回空数组）。
     */
    getGetterNames(): string[];
    /**
     * 订阅状态变化
     * @param listener - 状态变化回调函数
     * @param options.readOnly 标记为只读订阅（仅读取状态、不修改）。当 Store 仅有只读订阅者时，
     *   通知路径会跳过整棵状态树的深拷贝，显著降低大状态下的通知开销。
     * @returns 取消订阅的函数
     * @throws 如果 Store 已销毁
     */
    subscribe(listener: StateListener<S>, options?: {
        readOnly?: boolean;
    }): () => void;
    /**
     * 安装插件
     * @param plugin - 插件实例
     * @returns 卸载插件的函数
     * @throws 如果 Store 已销毁
     */
    use(plugin: PluginType<NoInfer<S>>): () => void;
    /** 创建插件卸载句柄（实现已拆至 ./pluginSupport.js） */
    private _createPluginUninstaller;
    /**
     * 销毁Store - 释放所有资源
     *
     * 清理顺序（反向依赖）：
     * 1. 插件卸载（依赖 hooks/state）
     * 2. 订阅器清除
     * 3. 缓存禁用
     * 4. 钩子清除
     * 5. 批量管理器重置
     * 6. 销毁标记
     * 7. Proxy 缓存清空
     */
    destroy(): void;
    /**
     * 检查 Store 是否已被销毁
     */
    get destroyed(): boolean;
    /**
     * 从缓存获取状态值
     * @param key - 状态键名
     * @returns 缓存的值或当前状态值
     * @throws 如果 Store 已销毁
     */
    getCached<K extends keyof S>(key: K): S[K];
    /**
     * 启用缓存
     * @param keys - 需要缓存的键（可选，默认全部）
     * @throws 如果 Store 已销毁
     */
    enableCache(keys?: Array<keyof S>): void;
    /**
     * 禁用缓存
     * @throws 如果 Store 已销毁
     */
    disableCache(): void;
    /**
     * 清除缓存
     * @param key - 要清除的键（可选，不传则清除全部）
     * @throws 如果 Store 已销毁
     */
    invalidateCache<K extends keyof S>(key?: K): void;
    /**
     * 获取缓存统计信息
     * @returns 缓存统计对象
     */
    getCacheStats(): CacheStats;
    /**
     * 检查状态保护是否启用
     */
    isStateProtectionEnabled(): boolean;
    /**
     * 动态启用/禁用状态保护
     */
    setStateProtection(enabled: boolean): void;
    /**
     * 获取状态保护配置
     */
    getStateProtectionConfig(): Readonly<StateProtectionOptions>;
    /**
     * 开始批量更新
     */
    startBatch(): void;
    /**
     * 结束批量更新
     */
    endBatch(): void;
    /**
     * 在批量更新上下文中执行操作
     * @param fn - 要执行的函数
     * @returns 函数返回值
     */
    batch<T>(fn: () => T): T;
    /** 初始化状态 */
    private _initializeState;
    /** 初始化Actions和Getters */
    private _initializeActionsAndGetters;
    /** 初始化缓存 */
    private _initializeCache;
    /** 在内部访问模式下执行操作 */
    private _withInternalAccess;
    /**
     * 获取 action 上下文使用的状态
     *
     * - 默认模式：返回原始状态引用（零开销，与历史行为一致）
     * - onlyOnChange 模式：返回脏跟踪代理，写入（含数组变异方法）会递增变更计数，
     *   供 ActionManager 判断是否需要通知
     */
    private _getActionState;
    /**
     * 重建状态保护 Proxy 管理器（构造、$replaceState、setStateProtection 共用）。
     *
     * 强制新建 proxyCache：旧缓存中的 Proxy 闭包绑定旧状态对象树/旧 path，
     * 复用会让保护层指向已过期对象。
     */
    private _rebuildStateProxyManager;
    /** 创建允许写入的脏跟踪代理（实现已拆至 ./dirtyTracking.js） */
    private _createDirtyTrackingProxy;
    /** 批量结束通知：onlyOnChange 模式下批量期间无任何变更则跳过（与 dispatch 收尾语义一致） */
    private _onBatchEnd;
    /** 调度一次状态通知（同步或异步合并，取决于 notify.async 配置） */
    private _scheduleNotify;
    /** 通知状态变化 */
    private _notifyListeners;
}
```

### `StoreOptions`

```ts
/**
 * Store 构造配置（显式泛型场景）
 * actions 使用 `ActionsWithThis<S, A>` 注入 `this` 类型。
 */
export interface StoreOptions<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> {
    /** Store名称 */
    name?: string;
    /**
     * 初始状态
     * 支持对象字面量或工厂函数：`state: () => ({...})`
     */
    state?: S | (() => S);
    /** Actions - 使用 ThisType 注入 this 类型 */
    actions?: ActionsWithThis<S, A>;
    /** Getters */
    getters?: G;
    /** 是否启用缓存 */
    enableCache?: boolean;
    /** 需要缓存的state键（为空时缓存所有） */
    cacheKeys?: Array<keyof S>;
    /** 缓存配置（容量、TTL等） */
    cacheConfig?: CacheConfig;
    /** 状态保护配置 */
    stateProtection?: StateProtectionOptions;
    /** 订阅配置（上限数量、超限策略） */
    subscription?: SubscriptionOptions;
    /** 通知行为配置（深拷贝开关、仅变更时通知） */
    notify?: NotifyOptions;
}
```

### `StoreRegistry`

```ts
/**
 * Store注册表类
 *
 * 用于管理多个Store实例，提供统一的注册、访问和生命周期管理
 *
 * @class StoreRegistry
 *
 * @example
 * ```typescript
 * const registry = new StoreRegistry()
 *
 * // 注册Store
 * registry.register('user', userStore)
 * registry.register('product', productStore)
 *
 * // 批量注册
 * registry.registerAll({ cart, order, payment })
 *
 * // 获取Store
 * const store = registry.get('user')
 * const storeOrThrow = registry.getOrThrow('product')
 *
 * // 设置默认Store
 * registry.setDefault('user')
 * const default = registry.getDefault()
 * ```
 */
export declare class StoreRegistry {
    /**
     * Store映射
     * @private
     * @type {Map<string, Store>}
     */
    private stores;
    /**
     * 默认Store
     * @private
     * @type {Store | undefined}
     */
    private defaultStore?;
    /**
     * 注册Store
     *
     * 将Store实例注册到注册表中，如果同名Store已存在会覆盖
     *
     * @param {string} name - Store名称
     * @param {Store} store - Store实例
     * @throws {Error} 如果名称无效或store无效
     *
     * @example
     * ```typescript
     * const registry = new StoreRegistry()
     * const store = createStore({ state: { count: 0 } })
     *
     * // 注册单个Store
     * registry.register('counter', store)
     *
     * // 覆盖已存在的Store
     * const newStore = createStore({ state: { count: 10 } })
     * registry.register('counter', newStore) // 会覆盖
     * ```
     */
    register(name: string, store: Store): void;
    /**
     * 批量注册Store
     *
     * 将多个Store实例批量注册到注册表中
     *
     * @param {Record<string, Store>} stores - Store名称到实例的映射
     *
     * @example
     * ```typescript
     * const registry = new StoreRegistry()
     *
     * registry.registerAll({
     *   user: userStore,
     *   product: productStore,
     *   cart: cartStore
     * })
     *
     * // 检查注册结果
     * console.log(registry.size()) // 3
     * ```
     */
    registerAll(stores: Record<string, Store>): void;
    /**
     * 注销Store
     *
     * 从注册表中移除Store并调用其destroy方法
     *
     * @param {string} name - Store名称
     *
     * @example
     * ```typescript
     * const registry = new StoreRegistry()
     * registry.register('user', store)
     *
     * // 注销Store
     * registry.unregister('user')
     * // store.destroy() 会被调用
     * ```
     */
    unregister(name: string): void;
    /**
     * 获取Store
     *
     * 根据名称获取Store实例
     *
     * @param {string} name - Store名称
     * @returns {Store | undefined} Store实例，不存在则返回undefined
     *
     * @example
     * ```typescript
     * const store = registry.get('user')
     * if (store) {
     *   console.log('Store found:', store.getState())
     * } else {
     *   console.log('Store not found')
     * }
     * ```
     */
    get(name: string): Store | undefined;
    /**
     * 获取或抛出错误
     *
     * 根据名称获取Store，如果不存在则抛出错误
     *
     * @param {string} name - Store名称
     * @returns {Store} Store实例
     * @throws {Error} 如果Store不存在
     *
     * @example
     * ```typescript
     * try {
     *   const store = registry.getOrThrow('user')
     *   console.log(store.getState())
     * } catch (error) {
     *   console.error('Store not found:', error)
     * }
     * ```
     */
    getOrThrow(name: string): Store;
    /**
     * 检查Store是否存在
     *
     * @param {string} name - Store名称
     * @returns {boolean} 是否存在
     *
     * @example
     * ```typescript
     * if (registry.has('user')) {
     *   const store = registry.get('user')
     *   // 使用store
     * }
     * ```
     */
    has(name: string): boolean;
    /**
     * 获取所有Store
     *
     * @returns {Record<string, Store>} 所有Store的映射
     *
     * @example
     * ```typescript
     * const allStores = registry.getAll()
     * Object.entries(allStores).forEach(([name, store]) => {
     *   console.log(`${name}:`, store.getState())
     * })
     * ```
     */
    getAll(): Record<string, Store>;
    /**
     * 获取Store数量
     *
     * @returns {number} 注册的Store数量
     *
     * @example
     * ```typescript
     * console.log(`Total stores: ${registry.size()}`)
     * ```
     */
    size(): number;
    /**
     * 清空注册表
     *
     * 注销所有Store并清空注册表
     *
     *
     * @example
     * ```typescript
     * // 清空所有Store
     * registry.clear()
     * console.log(registry.size()) // 0
     * ```
     */
    clear(): void;
    /**
     * 设置默认Store
     *
     * 设置默认Store，用于快速访问
     *
     * @param {string} name - Store名称
     * @throws {Error} 如果Store不存在
     *
     * @example
     * ```typescript
     * registry.register('user', userStore)
     * registry.register('product', productStore)
     *
     * // 设置默认Store
     * registry.setDefault('user')
     *
     * // 获取默认Store
     * const defaultStore = registry.getDefault()
     * ```
     */
    setDefault(name: string): void;
    /**
     * 获取默认Store
     *
     * @returns {Store | undefined} 默认Store，未设置则返回undefined
     *
     * @example
     * ```typescript
     * const defaultStore = registry.getDefault()
     * if (defaultStore) {
     *   console.log('Default store:', defaultStore.getState())
     * }
     * ```
     */
    getDefault(): Store | undefined;
    /**
     * 获取Store名称列表
     *
     * @returns {string[]} 所有Store名称的数组
     *
     * @example
     * ```typescript
     * const names = registry.getNames()
     * console.log('Available stores:', names.join(', '))
     * ```
     */
    getNames(): string[];
    /**
     * 遍历所有Store
     *
     * 对每个注册的Store执行回调函数
     *
     * @param {(name: string, store: Store) => void} callback - 回调函数
     *
     * @example
     * ```typescript
     * registry.forEach((name, store) => {
     *   console.log(`Store ${name}:`, store.getState())
     * })
     * ```
     */
    forEach(callback: (name: string, store: Store) => void): void;
    /**
     * 创建Store快照
     *
     * 创建所有Store的状态快照
     *
     * @returns {Record<string, unknown>} Store名称到状态的映射
     *
     * @example
     * ```typescript
     * const snapshot = registry.createSnapshot()
     * console.log('All states:', snapshot)
     *
     * // 稍后恢复
     * registry.restoreSnapshot(snapshot)
     * ```
     */
    createSnapshot(): Record<string, unknown>;
    /**
     * 从快照恢复所有Store
     *
     * 根据快照恢复所有Store的状态
     *
     * @param {Record<string, unknown>} snapshot - Store快照
     *
     * @example
     * ```typescript
     * const snapshot = registry.createSnapshot()
     * // ... 修改状态
     *
     * // 恢复到快照
     * registry.restoreSnapshot(snapshot)
     * ```
     */
    restoreSnapshot(snapshot: Record<string, unknown>): void;
}
```

### `StoreTreeNode`

```ts
/**
 * Store树节点
 */
export interface StoreTreeNode {
    name: string;
    store: any;
    children?: Record<string, StoreTreeNode>;
}
```

### `uniqueId`

```ts
export declare function uniqueId(prefix?: string): string;
```

### `usePlugin`

```ts
/**
 * 安装插件到 Store（带日志与错误兜底）
 *
 * 泛型**只从 store 参数反推**（`plugin` 上的 S 用 `NoInfer` 排除）：该位置处于逆变，
 * 若参与推断会把 S 拉回约束 `State`，导致具体 Store 被判为不可赋值。
 *
 * 备选方案「独立类型参数 `P extends Plugin<S>`」已实测否决：宽插件（`Plugin<State>`）
 * 会在约束校验时因 `Store` 自身含 `use` 成员而递归比较失败。故保留 `NoInfer`，
 * 其最低 TS 版本要求（≥ 5.4）已在 README 与 CHANGELOG 中声明。
 *
 * `plugin` 需与 store 的状态类型匹配；状态无关的插件写作 `Plugin<State>`（如 `loggerPlugin`），
 * 对任意 Store 都适用。
 */
export declare function usePlugin<S extends State, A extends Actions, G extends Getters<S>>(plugin: Plugin<NoInfer<S>>, store: Store<S, A, G>): () => void;
```

### `withAppStore`

```ts
/**
 * App 集成函数
 *
 * 将 Store 连接到微信小程序 App，自动管理状态同步和订阅清理
 *
 * 类型推断：`S` / `A` / `G` 均从 store 参数自动推断，
 * mapState / mapGetters / mapActions 的键与值拼错时会在编译期报错；
 * 返回的装饰器保持传入 App 配置的原始类型（不擦除自定义方法/生命周期类型）。
 *
 * 生命周期内的 `this` 自动获得注入后的实例类型（`AppThis`）：映射的 state/getters
 * 出现在 `globalData` 上、映射的 action 与调试 API 直接挂在实例上，**无需手写 this 标注**。
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns App 装饰器（保持配置类型，并注入方法 this）
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { withAppStore } from '@openlide/geomstore/integrations'
 *
 * const store = createStore({
 *   name: 'app',
 *   state: { userInfo: null, config: {}, theme: 'light' },
 *   actions: {
 *     async initApp() {
 *       const config = await fetchConfig()
 *       this.setState('config', config)
 *     },
 *     setTheme(theme) {
 *       this.setState('theme', theme)
 *     }
 *   }
 * })
 *
 * // 简写：数组形式（this.globalData / 注入的 action 均有类型，无需手写 this）
 * App(withAppStore(store, {
 *   mapState: ['userInfo', 'config', 'theme'],
 *   mapActions: ['initApp', 'setTheme']
 * })({
 *   globalData: { otherData: '...' },
 *   onLaunch() {
 *     console.log(this.globalData.userInfo)
 *     this.initApp()
 *     this.setTheme('dark')
 *   }
 * }))
 *
 * // 高级用法：对象形式
 * App(withAppStore(store, {
 *   mapState: {
 *     user: 'userInfo',
 *     appConfig: 'config',
 *     currentTheme: 'theme'
 *   },
 *   mapActions: {
 *     doInit: 'initApp',
 *     changeTheme: 'setTheme'
 *   }
 * })({
 *   globalData: { otherData: '...' },
 *   onLaunch() {
 *     console.log(this.globalData.user)
 *     this.doInit()
 *     this.changeTheme('dark')
 *   }
 * }))
 *
 * // 调试 API
 * // 在其他 Page 或 Component 中访问：
 * const app = getApp()
 * app.getStore()           // 获取 store 实例
 * app.getState()           // 获取状态
 * app.dispatch('xxx')      // dispatch action
 * app.subscribe(callback)   // 订阅状态变化
 * ```
 */
export declare function withAppStore<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(store: Store<S, A, G>, options?: ConnectOptions<S, A, G>): <C extends AppOptions>(AppConfig: WithPageThis<C, AppThis<S, A, G, ConnectOptions<S, A, G>, C>> & ThisType<AppThis<S, A, G, ConnectOptions<S, A, G>, C>>) => C;
```

### `withComponentStore`

```ts
/**
 * Component 混入函数
 *
 * 将 Store 连接到微信小程序 Component，自动管理状态同步和订阅清理
 *
 * 类型推断：与 withPageStore 一致，`S` / `A` / `G` 从 store 参数自动推断，
 * `O` 保留 options 字面量类型用于精确推导；
 * mapState / mapGetters / mapActions 的键与值拼错时编译期报错；
 * 装饰器返回类型重写所有方法的 this 为 ComponentThis，使方法内 this.data / this.xxx 自动获得精确类型
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @template O - ConnectOptions 字面量类型（自动推断）
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns Component 装饰器：入参为「各命名空间内方法 `this` 已注入」（`WithComponentThis`）的配置，返回增强后的配置（形状见 `ComponentConfig`）
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { withComponentStore } from '@openlide/geomstore/integrations'
 *
 * const store = createStore({
 *   state: { count: 0, name: 'test' },
 *   actions: { increment() { this.state.count++ } }
 * })
 *
 * Component(withComponentStore(store, {
 *   mapState: ['count', 'name'],
 *   mapActions: ['increment']
 * })({
 *   methods: {
 *     handleTap() {
 *       this.data.count // ✅ 自动推导为 number
 *       this.increment() // ✅ 精确签名
 *     }
 *   }
 * }))
 * ```
 */
export declare function withComponentStore<S extends State, A extends Actions, G extends Getters<S>, O extends ConnectOptions<S, A, G>>(store: Store<S, A, G>, options?: O): <C extends ComponentOptions>(ComponentConfig: WithComponentThis<C, ComponentThis<S, A, G, O, ComponentOwnMethods<C>>>) => ComponentConfig<S, A, G, O, ComponentOwnMethods<C>> & Omit<C, 'data' | 'methods'> & {
    data: (C extends {
        data: infer D;
    } ? D : object) & ExtractPageData<S, O, G>;
};
```

### `withPageStore`

```ts
/**
 * Page 混入函数
 *
 * 将 Store 连接到微信小程序 Page，自动管理状态同步和订阅清理
 *
 * 类型推断：
 * - `S` / `A` / `G` 均从 store 参数自动推断
 * - `O` 保留 options 字面量类型，用于精确推导方法内 this.data 与 actions
 * - mapState / mapGetters / mapActions 的键与值拼错时会在编译期报错
 * - 装饰器返回类型重写所有方法的 this 为 PageThis，使方法内 this.data / this.xxx 自动获得精确类型
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @template O - ConnectOptions 字面量类型（自动推断）
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns Page 装饰器：入参为「方法 `this` 已注入」（`ThisType<PageThis>`）的配置，返回增强后的配置（形状见 `PageConfig`）
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { withPageStore } from '@openlide/geomstore/integrations'
 *
 * const store = createStore({
 *   state: { count: 0, name: 'test' },
 *   actions: { increment() { this.state.count++ } }
 * })
 *
 * Page(withPageStore(store, {
 *   mapState: ['count', 'name'],
 *   mapActions: ['increment']
 * })({
 *   data: { localData: '...' },
 *   onLoad() {
 *     this.data.count // ✅ 自动推导为 number
 *     this.increment() // ✅ 精确签名
 *   }
 * }))
 * ```
 */
export declare function withPageStore<S extends State, A extends Actions, G extends Getters<S>, O extends ConnectOptions<S, A, G>>(store: Store<S, A, G>, options?: O): <C extends PageOptions>(PageConfig: WithPageThis<C, PageThis<S, A, G, O>> & {
    data: object;
} & ThisType<PageThis<S, A, G, O>>) => PageConfig<S, O, G> & Omit<C, "data"> & {
    data: (C extends {
        data: infer D;
    } ? D : object) & ExtractPageData<S, O, G>;
};
```

### `WithPageThis`

```ts
/**
 * 方法 this 重写映射类型
 *
 * 将配置对象中所有函数属性的 this 参数重写为 T，非函数属性（含 data）保持原样不变。
 * 仅用于装饰器入参，使方法内 this 自动获得精确类型推导（含 data、actions、自定义方法），
 * 且不改变对象结构类型，从而仍满足 PageOptions / ComponentOptions 约束。
 */
export type WithPageThis<C, T> = {
    [K in keyof C]: C[K] extends (...args: infer P) => infer R ? (this: T, ...args: P) => R : C[K];
};
```

---

## `./core`

> 类型声明：`./dist/core/index.d.ts`

符号清单（详细声明见对应子入口）：

- `ActionNames`
- `Actions`
- `AppOptions`
- `CacheOptions`
- `CacheStats`
- `clone`
- `CloneMode`
- `ComponentConfig`
- `ComponentOwnMethods`
- `ComponentThis`
- `ComposedStore`
- `ComposeOptions`
- `composeStore`
- `ConnectOptions`
- `createStore`
- `createStoreTree`
- `deepEqual`
- `deepMerge`
- `ExtractPageData`
- `get`
- `Getters`
- `globalRegistry`
- `HookHandler`
- `HookName`
- `HookSystem`
- `identity`
- `IHookSystem`
- `InferActionArgs`
- `InferActionReturn`
- `InferGetterReturn`
- `isArray`
- `isFunction`
- `isGeomStore`
- `isObject`
- `isPlainObject`
- `isPromise`
- `LRUCache`
- `LRUCacheStats`
- `NamespaceConfig`
- `noop`
- `PageConfig`
- `PageOwnMethods`
- `PageReservedKeys`
- `PageThis`
- `Plugin`
- `PluginHook`
- `set`
- `shallowEqual`
- `State`
- `StateListener`
- `Store`
- `StoreOptions`
- `StoreRegistry`
- `StoreTreeNode`
- `uniqueId`
- `usePlugin`
- `withAppStore`
- `withComponentStore`
- `withPageStore`
- `WithPageThis`

---

## `./extras`

> 类型声明：`./dist/extras/index.d.ts`

符号清单（详细声明见对应子入口）：

- `ActionDecorator`
- `ActionExecutionContext`
- `ActionExecutor`
- `ActionLoader`
- `ActionLoaderOptions`
- `ActionResult`
- `ActionUtils`
- `ActionUtilsOptions`
- `analyzerPlugin`
- `AsyncActions`
- `AsyncSnapshotOptions`
- `BackgroundSyncConfig`
- `BackupData`
- `builtinPlugins`
- `CacheDecoratorOptions`
- `createAnalyzerPlugin`
- `createDecorator`
- `createEnterpriseApp`
- `createSnapshot`
- `createSnapshotAsync`
- `createUserStore`
- `DecoratorOptions`
- `devtoolsPlugin`
- `EnterpriseAppConfig`
- `HotUpdateConfig`
- `initBackgroundSync`
- `initHotUpdate`
- `loggerPlugin`
- `MetricsCollector`
- `MetricType`
- `OfflineAction`
- `OfflineManager`
- `PerformanceAnalyzer`
- `PerformanceMetrics`
- `PerformanceMonitor`
- `PerformanceOptions`
- `PerformanceStats`
- `PersistenceOptions`
- `persistencePlugin`
- `restoreFromHotUpdate`
- `RetryDecoratorOptions`
- `SnapshotDiff`
- `SnapshotError`
- `SnapshotManager`
- `SnapshotMetadata`
- `SnapshotOptions`
- `SnapshotProgress`
- `SnapshotResult`
- `SnapshotStats`
- `StorageBackend`
- `storeManager`
- `StoreManager`
- `ThrottleDecoratorOptions`
- `TimeTravelOptions`
- `timeTravelPlugin`
- `unregisterBackgroundSync`
- `UserInfo`
- `UserPreferences`
- `UserState`
- `UserStoreConfig`
- `withCache`
- `withDebounce`
- `withLoading`
- `withLog`
- `withRetry`
- `withThrottle`
- `withTimeout`
- `WxStorageBackend`

---

## `./extras/action`

> 类型声明：`./dist/extras/action.d.ts`

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

---

## `./extras/enterprise`

> 类型声明：`./dist/extras/enterprise.d.ts`

### `BackgroundSyncConfig`

```ts
/**
 * 单个 Store 的后台 / 前台同步配置
 */
export interface BackgroundSyncConfig<S extends State = State> {
    /** 需要做时效性检查的 Store */
    store: Store<S>;
    /** 允许的最长非活跃时长（毫秒）：切前台时超过该时长会触发 `refreshData`；默认 5 分钟 */
    maxInactiveTime?: number;
    /** 切前台回调（在时效性检查之后执行） */
    onForeground?: () => void;
    /** 切后台回调 */
    onBackground?: () => void;
}
```

### `BackupData`

```ts
/**
 * 热更新前保存的状态备份
 */
export interface BackupData {
    /** 备份生成时间戳，用于过期判定（超过 `BACKUP_EXPIRY_MS` 即作废） */
    timestamp: number;
    /** `store.$snapshot()` 产出的状态快照 */
    state: unknown;
    /** 备份时的库版本（`LIBRARY_VERSION`）；与当前不一致时仅告警，仍按合并语义恢复 */
    version: string;
}
```

### `createEnterpriseApp`

```ts
/**
 * 示例：在 App.ts 中使用以上所有功能
 * 账号切换/登出时自动 dispose 旧的 OfflineManager，避免监听泄漏
 */
export declare function createEnterpriseApp(config?: EnterpriseAppConfig): {
    globalData: {
        storeManager: import("./store-manager.js").StoreManager;
        store: Store<UserState, import("../../types/store.js").Actions, import("../../types/store.js").Getters<UserState>> | null;
        offlineManager: OfflineManager<UserState> | null;
    };
    onLaunch(): void;
    onShow(): void;
    login(userId: string): Store<UserState, import("../../types/store.js").Actions, import("../../types/store.js").Getters<UserState>>;
    logout(): void;
    getStore(): Store<UserState> | null;
    getOfflineManager(): OfflineManager<UserState> | null;
};
```

### `createUserStore`

```ts
/**
 * 创建用户隔离的 Store
 *
 * 每个用户拥有独立的 Store 实例与持久化键（store name 即 `user-store-${userId}`），
 * 登出时 StoreManager 按同一键清理持久化数据，保证键的写入与删除一致
 */
export declare function createUserStore(config: UserStoreConfig): Store<UserState>;
```

### `EnterpriseAppConfig`

```ts
/**
 * `createEnterpriseApp` 的配置项
 */
export interface EnterpriseAppConfig {
    /** 允许的最长非活跃时长（毫秒），透传给 `initBackgroundSync`；默认 10 分钟 */
    maxInactiveTime?: number;
}
```

### `HotUpdateConfig`

```ts
/**
 * `initHotUpdate` 的配置项
 */
export interface HotUpdateConfig<S extends State = State> {
    /** 需要保护状态的 Store */
    store: Store<S>;
    /** 备份存储键；缺省按 store 名派生，保证多账号/多实例互不覆盖 */
    backupKey?: string;
    /** 用户确认更新且备份成功后的回调（可用于落库或上报） */
    onBeforeUpdate?: () => void;
}
```

### `initBackgroundSync`

```ts
/**
 * 初始化后台/前台状态同步
 * 在小程序从后台返回前台时检查状态时效性
 *
 * 多次调用不会重复包装全局 App：
 * 若全局 App 仍为本模块安装的包装函数，则仅注册新的处理器；
 * 若全局 App 已被外部替换（如测试重置），则重新安装并重置注册表
 */
export declare function initBackgroundSync<S extends State = State>(config: BackgroundSyncConfig<S>): void;
```

### `initHotUpdate`

```ts
export declare function initHotUpdate<S extends State = State>(config: HotUpdateConfig<S>): void;
```

### `OfflineAction`

```ts
/**
 * 一条被离线缓存的待同步操作
 */
export interface OfflineAction {
    /** 唯一标识（时间戳 + 随机串） */
    id: string;
    /** Action 名称，同步时经 `store.dispatch` 执行 */
    type: string;
    /** 执行时透传给 Action 的载荷 */
    payload: unknown;
    /** 入队时间戳 */
    timestamp: number;
    /** 已失败次数；达到 `maxRetryCount` 后移入死信队列并触发 `onDrop` */
    retryCount: number;
}
```

### `OfflineManager`

```ts
/**
 * 离线状态管理器
 * 在离线时缓存操作，网络恢复后自动同步
 *
 * 生命周期：不再使用时调用 dispose() 释放网络监听，
 * 避免账号切换等场景下旧实例监听泄漏
 */
export declare class OfflineManager<S extends State = State> {
    private store;
    private actionQueue;
    private isOnline;
    /** 同步互斥标志：防止网络恢复回调与手动 syncQueue 并发重复执行队列 */
    private syncing;
    /** 同步进行中的队列中间状态：saveQueue 落盘时据此拼接完整联合视图。
     *  同步期间 enqueue 会触发 saveQueue，若只写 this.actionQueue，
     *  磁盘会被「仅剩新项」的队列覆写——进程恰在此窗口被杀时，
     *  未处理的旧操作永久丢失（at-least-once 被破坏）。syncQueue 结束后归空。 */
    private syncPending;
    private syncFailed;
    private syncNextIndex;
    private disposed;
    /** 网络监听回调引用，dispose 时用于精确移除。参数类型同时兼容 wx.on/offNetworkStatusChange 两种签名 */
    private networkHandler;
    private readonly maxRetryCount;
    private readonly queueKey;
    private readonly deadLetterKey;
    /** 死信队列容量上限：长期不处理死信时防止小程序 storage（10MB）被无界挤占 */
    private static readonly MAX_DEAD_LETTERS;
    /** 死信回调：操作超过重试上限被移入死信队列时通知调用方（业务层兜底/告警） */
    private readonly onDrop;
    constructor(store: Store<S>, queueKey?: string, maxRetryCount?: number, onDrop?: (action: OfflineAction) => void);
    /**
     * 执行操作（支持离线缓存）
     */
    execute<T>(type: string, action: () => Promise<T>, payload?: unknown): Promise<T | null>;
    /**
     * 同步离线队列（公开方法供外部调用）
     * syncing 互斥保证并发触发时队列不会被重复执行
     */
    syncQueue(): Promise<void>;
    /**
     * 清空队列
     *
     * 同步进行中调用同样生效：syncQueue 采用快照-清空模式，队列分散在
     * actionQueue（同步期间新入队）、syncPending（本轮待同步快照）、syncFailed（失败段）
     * 三段，其 finally 会把三段拼回 actionQueue 并落盘。只清 actionQueue 会让
     * 已「清空」的操作在同步结束时复活继续同步，故三段一并置空——
     * syncPending 清空后循环条件立即为假、同步停止；清空之后新入队的操作
     * 仍进 actionQueue，不受影响
     */
    clearQueue(): void;
    /**
     * 获取队列长度
     */
    getQueueLength(): number;
    /**
     * 释放资源：移除网络状态监听
     * 账号切换/登出重建 OfflineManager 前必须先调用，否则旧实例监听泄漏
     */
    dispose(): void;
    /**
     * 添加操作到队列
     */
    private enqueue;
    /**
     * 尝试执行单个操作
     */
    private tryExecuteAction;
    /**
     * 执行具体操作（可被子类重写）
     */
    protected executeAction(action: OfflineAction): Promise<void>;
    /**
     * 初始化网络监听
     * 保存回调引用，供 dispose 精确移除
     */
    private initNetworkListener;
    /**
     * 保存队列到存储
     *
     * 同步进行中时队列被拆为「已失败待重试 + 未处理剩余（含当前执行项）+ 新入队」三段，
     * 必须落盘完整联合视图：否则磁盘被仅含新项的队列覆写，
     * 进程在同步窗口内被杀会让未处理旧操作永久丢失（at-least-once）
     */
    private saveQueue;
    /**
     * 追加操作到死信队列（持久化，供业务层后续人工处理或上报）
     */
    private appendDeadLetter;
    /**
     * 获取死信队列中超过重试上限被丢弃的操作
     */
    getDeadLetters(): OfflineAction[];
    /**
     * 清空死信队列（业务层确认已处理丢失操作后调用）
     */
    clearDeadLetters(): void;
    /**
     * 从存储加载队列
     */
    private loadQueue;
}
```

### `restoreFromHotUpdate`

```ts
/**
 * 从热更新备份恢复状态
 */
export declare function restoreFromHotUpdate<S extends State = State>(store: Store<S>, backupKey?: string): boolean;
```

### `storeManager`

```ts
storeManager: StoreManager
```

### `StoreManager`

```ts
/**
 * Store 管理器：负责多账号 Store 的获取/创建、身份切换、登出与 LRU 淘汰
 *
 * 使用约束：
 * - `getUserStore` 只「取/建」指定账号的 store，**不改变当前登录身份**——
 *   只读预览其它账号时若顺带切换身份，后续 `logout()` 会清错账号的数据；
 *   身份切换请显式调用 `switchUser`
 * - 被 LRU 淘汰或 `logout()` 后的 store 已 `destroy()`，不可继续 dispatch
 */
export declare class StoreManager {
    private stores;
    private currentUserId;
    private readonly maxStores;
    constructor(maxStores?: number);
    /**
     * 获取或创建用户 Store
     *
     * 只负责「取/建某账号的 store」，**不改变当前登录身份**。
     * 此前未命中分支会顺带写 this.currentUserId，而命中分支不会——同一调用的身份
     * 副作用取决于 LRU 淘汰状态这一调用方不可见的实现细节；只读预览另一账号
     * （getUserStore('B')）会静默把身份切成 B，随后 logout() 清的是 B 的数据。
     * 身份切换与冷启动恢复一律走 switchUser 显式表达。
     */
    getUserStore(userId: string): Store<UserState>;
    /**
     * 切换用户
     */
    switchUser(userId: string): Store<UserState>;
    /**
     * 登出当前用户
     * 持久化键与 createUserStore 的存储键一致（均为 `user-store-${userId}`）
     */
    logout(): void;
    /**
     * 获取当前用户的 Store
     */
    getCurrentStore(): Store<UserState> | null;
    /**
     * 清理所有 Store
     */
    clearAll(): void;
    /**
     * LRU 清理最早的 Store
     */
    private cleanupOldestStore;
}
```

### `unregisterBackgroundSync`

```ts
/**
 * 注销指定 Store 的后台同步处理器
 *
 * 账号切换/登出时应调用，避免已销毁 Store 的处理器残留在注册表中，
 * 导致下次 onShow 触发 dispatch 抛错中断生命周期。
 */
export declare function unregisterBackgroundSync<S extends State = State>(store: Store<S>): void;
```

### `UserInfo`

```ts
/**
 * 用户信息（由服务端返回，业务可自行扩展字段）
 */
export interface UserInfo {
    /** 用户唯一标识 */
    id?: string | number;
    /** 昵称 */
    name?: string;
    /** 头像地址 */
    avatar?: string;
    [key: string]: unknown;
}
```

### `UserPreferences`

```ts
/**
 * 用户偏好设置（随账号隔离并持久化）
 */
export interface UserPreferences {
    /** 主题标识 */
    theme?: string;
    /** 语言标识 */
    language?: string;
    [key: string]: unknown;
}
```

### `UserState`

```ts
/**
 * 用户隔离 Store 的状态形状
 */
export interface UserState extends State {
    /** 当前用户信息；未登录或未同步时为 null */
    userInfo: UserInfo | null;
    /** 用户偏好设置 */
    preferences: UserPreferences;
    /** 最近一次与服务端同步的时间戳；未同步时为 null */
    lastSyncTime: number | null;
}
```

### `UserStoreConfig`

```ts
/**
 * `createUserStore` 的配置项
 */
export interface UserStoreConfig {
    /** 用户唯一标识：参与 Store 名称与持久化键（`user-store-${userId}`） */
    userId: string;
    /** 初始状态覆盖项（可选） */
    initialState?: Partial<UserState>;
}
```

---

## `./extras/error`

> 类型声明：`./dist/extras/error/index.d.ts`

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

### `ErrorAggregator`

```ts
/**
 * 错误聚合器
 *
 * 将相似的错误聚合成组，便于分析和报告
 */
export declare class ErrorAggregator {
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

### `getDefaultMonitoring`

```ts
/**
 * 获取全局默认的错误监控实例（惰性单例）
 *
 * @returns {ErrorMonitoring} 默认错误监控实例
 */
export declare function getDefaultMonitoring(): ErrorMonitoring;
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

---

## `./extras/performance`

> 类型声明：`./dist/extras/performance.d.ts`

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
 * // 访问全局API
 * const api = globalThis.__GEOMSTORE_ANALYZER__['user']
 *
 * // 获取指标
 * const allMetrics = api.getMetrics()
 * const allStats = api.getStats()
 *
 * // 分析性能瓶颈
 * const bottlenecks = api.analyzeBottlenecks(16)
 * bottlenecks.forEach(b => {
 *   console.log(`${b.operation}:`)
 *   console.log(`  Severity: ${b.severity}`)
 *   console.log(`  Avg: ${b.avgDuration.toFixed(2)}ms`)
 *   console.log(`  Max: ${b.maxDuration.toFixed(2)}ms`)
 * })
 *
 * // 清除指标
 * api.clear()
 *
 * // 在控制台直接访问
 * // globalThis.__GEOMSTORE_ANALYZER__['user'].getStats()
 * ```
 */
export declare function createAnalyzerPlugin(options?: PerformanceOptions): Plugin;
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
    /** 性能指标数组 */
    private metrics;
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
     * @param {PerformanceMetrics} metrics - 性能指标
     */
    collect(metrics: PerformanceMetrics): void;
    /**
     * 批量收集指标
     *
     * 一次性添加多个性能指标。
     *
     * @param {PerformanceMetrics[]} metricsList - 性能指标数组
     */
    collectBatch(metricsList: PerformanceMetrics[]): void;
    /**
     * 超出容量上限时淘汰最旧条目
     *
     * @private
     */
    private _trim;
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
     * @param {(metrics: PerformanceMetrics) => boolean} predicate - 筛选函数
     * @returns {MetricsCollector} 包含筛选结果的新采集器
     */
    filter(predicate: (metrics: PerformanceMetrics) => boolean): MetricsCollector;
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
     * @returns {number} 指定百分位数的持续时间
     */
    getPercentile(percentile: number): number;
    /**
     * 获取热路径（最频繁的操作）
     *
     * 返回最频繁操作列表，包含执行次数和平均耗时。
     *
     * @param {number} [limit=5] - 返回的热路径数量
     * @returns {Array<{operation: string, count: number, avgDuration: number}>} 热路径数组
     */
    getHotPaths(limit?: number): Array<{
        operation: string;
        count: number;
        avgDuration: number;
    }>;
}
```

### `MetricType`

```ts
/**
 * GeomStore - 性能类型定义
 */
/**
 * 性能指标类型
 */
export type MetricType = 'setState' | 'patch' | 'replaceState' | 'dispatch' | 'getter' | 'notify' | 'subscribe' | 'plugin' | 'state-update';
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
     * 识别超过阈值的性能瓶颈，按平均耗时相对阈值的倍数分级严重程度。
     *
     * @param {PerformanceMetrics[]} metrics - 性能指标数组
     * @param {number} [threshold=16] - 性能阈值（毫秒）
     * @returns {Array<{operation: string, count: number, avgDuration: number, maxDuration: number, severity: 'low' | 'medium' | 'high'}>} 瓶颈列表
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
     * @param {number} [threshold=0.2] - 退化阈值（比例，0.2 表示 20%）
     * @returns {Array<{operation: string, baselineDuration: number, currentDuration: number, change: number, changePercent: number}>} 退化列表
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
     * @returns {Record<string, number>} 按操作分组的平均持续时间
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
    /**
     * 获取高精度时间戳（兼容微信小程序）
     *
     * 契约：**返回值单位恒为毫秒**。全类下游一律按毫秒比较——threshold 默认 16
     * （一帧 16ms 预算）、MAX_OPERATION_AGE_MS 常量名自带 _MS、record 的 timestamp
     * 取 Date.now()、测试 mock 复用 Node performance.now()（同为毫秒）。
     * 若某基础库实测 wx.getPerformance().now() 返回微秒，归一化只能改本函数这一处
     * （除以 1000），下游不得各自换算，否则口径会分散失配。
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
     * 直接记录一个性能指标
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
     * 将所有指标和统计信息导出为JSON字符串
     *
     * @returns {string} JSON字符串
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
 */
export interface PerformanceOptions {
    /** 采样率（0-1） */
    sampleRate?: number;
    /** 超过阈值（毫秒）记录 */
    threshold?: number;
    /** 自定义日志记录器 */
    logger?: (metrics: PerformanceMetrics) => void;
    /** 最大记录数量 */
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
    /** 按操作分组统计 */
    byOperation: Record<string, {
        count: number;
        avgDuration: number;
        maxDuration: number;
    }>;
}
```

---

## `./extras/plugins`

> 类型声明：`./dist/extras/plugins.d.ts`

### `builtinPlugins`

```ts
builtinPlugins: Plugin<object>[]
```

### `devtoolsPlugin`

```ts
devtoolsPlugin: Plugin
```

### `loggerPlugin`

```ts
loggerPlugin: Plugin
```

### `PersistenceOptions`

```ts
/**
 * 持久化选项
 */
export interface PersistenceOptions<S extends State = State> {
    /** 存储key（字符串或函数） */
    key?: string | ((storeName: string) => string);
    /** 存储后端 */
    storage?: StorageBackend;
    /** 状态过滤器 */
    filter?: (state: S) => Partial<S>;
    /** 状态验证器（恢复前校验，返回 false 则拒绝恢复） */
    validate?: (state: unknown) => state is S;
    /** 是否恢复状态 */
    restore?: boolean;
    /**
     * 防抖延迟（毫秒），默认 0（每次变更立即落盘）。
     *
     * 默认立即写入可保证「变更即持久化」的可靠性，但每次通知都会执行一次
     * `JSON.stringify(整棵状态树)` + 同步 `wx.setStorageSync`（小程序内为阻塞 I/O）。
     * 高频更新场景（输入联想、拖拽、轮询）建议设为 300~500，或配合 `filter`
     * 只持久化必要子集；插件卸载时会自动补写防抖窗口内未落盘的最后一次变更。
     */
    debounce?: number;
    /** 卸载插件时是否清除存储数据（默认 false，仅停止监听，保留已持久化的数据） */
    clearOnUninstall?: boolean;
}
```

### `persistencePlugin`

```ts
persistencePlugin: Plugin & {
    <S extends State = State>(options?: PersistenceOptions<S>): Plugin;
}
```

### `StorageBackend`

```ts
/**
 * 存储后端接口
 *
 * 仅支持同步后端：persistencePlugin 的恢复与保存均为同步语义，
 * 异步后端（返回 Promise）会在运行时被检测并报错。
 * 如需异步持久化，请在外部自行订阅 store 并处理异步写入。
 */
export interface StorageBackend {
    /** 获取值（必须同步返回） */
    getItem(key: string): string | null;
    /** 设置值（必须同步返回） */
    setItem(key: string, value: string): void;
    /** 删除值（必须同步返回） */
    removeItem(key: string): void;
}
```

### `TimeTravelOptions`

```ts
/**
 * 时间旅行选项
 *
 * @interface TimeTravelOptions
 * @template S - 状态类型
 * @property {number} [maxSize=50] - 最大快照数量
 * @property {(state: S) => boolean} [filter] - 过滤函数，决定是否记录快照
 * @property {boolean} [autoRecord=true] - 是否自动记录快照
 *
 * @example
 * ```typescript
 * const options: TimeTravelOptions<MyState> = {
 *   maxSize: 100,                      // 最多保留100个快照
 *   filter: (state) => {               // 只记录特定状态的快照
 *     return state.isDirty || state.hasChanges
 *   },
 *   autoRecord: true                   // 自动记录所有状态变化
 * }
 * ```
 */
export interface TimeTravelOptions<S extends State = State> {
    /** 最大快照数量 */
    maxSize?: number;
    /** 过滤函数 */
    filter?: (state: S) => boolean;
    /** 是否自动记录 */
    autoRecord?: boolean;
}
```

### `timeTravelPlugin`

```ts
timeTravelPlugin: <S extends State = State>(options?: TimeTravelOptions<S>) => Plugin
```

### `WxStorageBackend`

```ts
/**
 * 微信存储后端
 */
export declare class WxStorageBackend implements StorageBackend {
    /** 经 globalThis 读取 wx，避免直接引用未声明的小程序全局标识符 */
    private get wxApi();
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}
```

---

## `./extras/selector`

> 类型声明：`./dist/extras/selector.d.ts`

### `AsyncRetrySelectorOptions`

```ts
/** 异步重试选择器选项 */
export interface AsyncRetrySelectorOptions extends RetrySelectorOptions {
    /**
     * 重试间延迟（毫秒）或按重试序号的退避函数（attempt 从 1 开始）。
     * 默认 0（立即重试）；同步重试选择器无法承载延迟，需要延迟请用本异步变体
     */
    delay?: number | ((attempt: number) => number);
}
```

### `createMemoizedSelector`

```ts
/**
 * 创建记忆化选择器
 *
 * 创建一个启用的缓存的选择器，默认缓存
 *
 * @template S - 状态类型
 * @template R - 返回值类型
 * @param {Selector<S, R>} selectorFn - 选择器函数
 * @param {(a: unknown, b: unknown) => boolean} [equalityFn] - 自定义相等性函数
 * @returns {Selector<S, R>} 记忆化选择器
 *
 * @example
 * ```typescript
 * const memoizedSelector = createMemoizedSelector(
 *   (state) => state.user.name,
 *   (a, b) => a === b
 * )
 *
 * // 相同输入只会计算一次
 * memoizedSelector(state) // 计算并缓存
 * memoizedSelector(state) // 使用缓存
 * ```
 */
export declare function createMemoizedSelector<S extends State, R>(selectorFn: Selector<S, R>, equalityFn?: (a: unknown, b: unknown) => boolean): Selector<S, R>;
```

### `createParametricSelector`

```ts
/**
 * 创建参数化选择器
 *
 * 创建一个接受参数的选择器，支持对不同参数的缓存
 *
 * @template S - 状态类型
 * @template P - 参数类型
 * @template R - 返回值类型
 * @param {(state: S, params: P) => R} selectorFn - 接受参数的选择器函数
 * @param {object} [options] - 缓存配置选项
 * @param {number} [options.ttl=5000] - 缓存生存时间（毫秒）。除 TTL 外，每次调用还会用
 *   deepEqual 校验 state 内容快照：Store 状态就地变异（引用不变）时立即作废该 state 下的
 *   全部参数缓存，不会在 TTL 内返回陈旧值
 * @param {number} [options.maxEntries=1000] - 单个 state 下原始类型参数的缓存条目上限
 * @returns {(state: S) => (params: P) => R} 参数化选择器工厂
 *
 * 限制：与 createSelector 相同——校验所用的 state 快照由 clone（deepCloneState）生成，
 * 它对不可克隆对象（类实例、Promise、WeakMap/WeakSet 等）保留原引用，因此这类对象被
 * 就地变异时校验会因引用相等判定「未变化」，TTL 内返回陈旧值。规避：用 setState/$patch
 * 整体替换该字段。
 *
 * @example
 * ```typescript
 * const getUserById = createParametricSelector(
 *   (state, userId) => state.users[userId],
 *   { ttl: 10000 } // 自定义缓存有效期
 * )
 *
 * const getState = (state) => state
 * const getUser = getUserById(getState)
 *
 * // 使用不同的参数
 * const user1 = getUser('user1')
 * const user2 = getUser('user2')
 * // 每个参数独立缓存
 * ```
 */
export declare function createParametricSelector<S extends State, P, R>(selectorFn: (state: S, params: P) => R, options?: {
    ttl?: number;
    maxEntries?: number;
}): (state: S) => (params: P) => R;
```

### `createSelector`

```ts
/**
 * 创建选择器
 *
 * 创建一个可缓存的选择器，用于从状态中派生数据
 *
 * 限制：缓存对状态的比较基于 `clone(state)` 快照，而 clone（即 deepCloneState）对
 * 不可克隆对象（类实例、Promise、WeakMap/WeakSet 等）保留原引用而非拷贝。因此若
 * state 里放了类实例并就地修改其字段，快照与活状态共享同一实例，比较会因引用相等
 * 判定「未变化」，TTL 内返回陈旧值。规避：用 setState/$patch 整体替换该字段，
 * 让状态树产生新的纯对象。纯对象/数组/Date/RegExp/Map/Set 会被正确深拷贝，不受影响。
 *
 * @template S - 状态类型
 * @template R - 返回值类型
 * @param {Selector<S, R>} selectorFn - 选择器函数
 * @param {SelectorOptions} [options] - 缓存选项
 * @returns {Selector<S, R>} 选择器函数
 *
 * @example
 * ```typescript
 * // 基础选择器
 * const doubleValue = createSelector(
 *   (state) => state.value * 2
 * )
 *
 * // 带选项的选择器
 * const cachedSelector = createSelector(
 *   (state) => state.user.name,
 *   {
 *     cache: true,
 *     cacheTTL: 10000,
 *     equalityFn: (a, b) => a === b
 *   }
 * )
 *
 * // 使用
 * const result = doubleValue({ value: 10 })
 * console.log(result) // 20
 * ```
 */
export declare function createSelector<S extends State, R>(selectorFn: Selector<S, R>, options?: SelectorOptions): Selector<S, R>;
```

### `createStructuredSelector`

```ts
/**
 * 创建组合选择器
 *
 * 从多个选择器组合成一个对象，便于批量获取派生状态
 *
 * @template S - 状态类型
 * @template R - 返回结构类型（默认从选择器映射推断）
 * @param {[K in keyof R]?: Selector<S, R[K]>} selectors - 选择器映射
 * @returns {Selector<S, R>} 组合选择器
 *
 * @example
 * ```typescript
 * // 也可显式指定状态类型：createStructuredSelector<AppState>({ ... })
 * const selector = createStructuredSelector({
 *   userName: (state) => state.user.name,
 *   userEmail: (state) => state.user.email,
 *   userAge: (state) => state.user.age
 * })
 *
 * const result = selector(state)
 * console.log(result) // { userName: '...', userEmail: '...', userAge: ... }
 * ```
 */
export declare function createStructuredSelector<S extends State, R extends object = Record<string, unknown>>(selectors: {
    [K in keyof R]?: Selector<S, R[K]>;
}): Selector<S, R>;
```

### `ParametricSelector`

```ts
/**
 * 参数化选择器
 */
export type ParametricSelector<S extends State, P, R> = (state: S, params: P) => R;
```

### `RetrySelectorOptions`

```ts
/** 同步重试选择器选项 */
export interface RetrySelectorOptions {
    /**
     * 重试次数（不含首次执行，总尝试次数 = retries + 1），默认 3。
     * 仅适用于依赖外部可变状态的 selector——纯函数对相同输入重试必然得到相同结果
     */
    retries?: number;
    /** 是否对该错误继续重试（attempt 为重试序号，从 1 开始） */
    shouldRetry?: (error: Error, attempt: number) => boolean;
}
```

### `Selector`

```ts
/**
 * 选择器函数类型
 *
 * 约束用 `State`（即 `object`）而非 `Record<string, unknown>`：与 Store 的状态约束口径保持一致，
 * 使**未声明索引签名的业务 interface**（如 `interface OrderState { … }`）可直接作为状态类型；
 * 后者只接受带索引签名的类型，会把这类 interface 拒之门外。
 * 默认值仍为 `Record<string, unknown>`，既有写法行为不变。
 */
export type Selector<S extends State = Record<string, unknown>, R = unknown> = (state: S) => R;
```

### `SelectorCacheItem`

```ts
/**
 * 选择器缓存项
 */
export interface SelectorCacheItem<R> {
    /** 缓存的值 */
    value: R;
    /** 缓存的时间戳 */
    timestamp: number;
    /** 缓存的state引用 */
    state: unknown;
    /**
     * 缓存条目对应的状态版本号（来自 Store 的变更计数）。
     * 有值时命中判定退化为 O(1) 整数比较，无需 deepEqual 全树比较；
     * 为 undefined 表示状态无版本标记（普通对象），回退到 equalityFn 比较。
     */
    version?: number;
}
```

### `SelectorComposer`

```ts
/**
 * 选择器组合器类
 *
 * 提供静态方法用于组合、管道和创建高级选择器
 *
 * @class SelectorComposer
 *
 * @example
 * ```typescript
 * // 组合多个选择器
 * const selector = SelectorComposer.combine({
 *   selectors: [
 *     (s) => s.value,
 *     (s) => s.multiplier
 *   ],
 *   combiner: (value, multiplier) => value * multiplier
 * })
 *
 * const result = selector(state) // value * multiplier
 * ```
 */
export declare class SelectorComposer {
    /**
     * 组合多个选择器
     *
     * 将多个选择器的结果组合成单个值
     *
     * @template S - 状态类型
     * @template R - 返回值类型
     * @param {SelectorComposerInput<S>} input - 选择器和组合器配置
     * @returns {Selector<S, R>} 组合后的选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.combine({
     *   selectors: [
     *     (s) => s.base,
     *     (s) => s.taxRate
     *     (s) => s.shipping
     *   ],
     *   combiner: (base, tax, shipping) => base * (1 + tax) + shipping
     * })
     *
     * const total = selector({ base: 100, taxRate: 0.1, shipping: 10 })
     * // 100 * 1.1 + 10 = 120
     * ```
     */
    static combine<S extends State, R = unknown, T extends readonly Selector<S, unknown>[] = readonly Selector<S, unknown>[]>(input: SelectorComposerInput<S, T>): Selector<S, R>;
    /**
     * 管道操作
     *
     * 将一个选择器的结果作为下一个选择器的输入
     *
     * @template S - 状态类型
     * @template T1 - 第一个选择器的返回类型
     * @template T2 - 第二个选择器的返回类型
     * @template T3 - 第三个选择器的返回类型（可选）
     * @param {Selector<S, T1>} selector1 - 第一个选择器
     * @param {(input: T1) => T2} selector2 - 第二个选择器
     * @param {(input: T2) => T3} selector3 - 第三个选择器（可选）
     * @returns {Selector<S, T4 | T3 | T2 | T1>} 管道选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.pipe(
     *   (s) => s.user,
     *   (user) => user.profile,
     *   (profile) => profile.avatar
     * )
     *
     * const avatar = selector(state)
     * // 相当于: state.user.profile.avatar
     * ```
     */
    static pipe<S extends State, T1, T2, T3, T4>(selector1: Selector<S, T1>, selector2: (input: T1) => T2, selector3: (input: T2) => T3, selector4: (input: T3) => T4): Selector<S, T4>;
    static pipe<S extends State, T1, T2, T3>(selector1: Selector<S, T1>, selector2: (input: T1) => T2, selector3: (input: T2) => T3): Selector<S, T3>;
    static pipe<S extends State, T1, T2>(selector1: Selector<S, T1>, selector2: (input: T1) => T2): Selector<S, T2>;
    static pipe<S extends State, T1>(selector1: Selector<S, T1>): Selector<S, T1>;
    /**
     * 创建派生选择器
     *
     * 通过管道操作创建派生选择器，pipe的别名
     *
     * @template S - 状态类型
     * @template R1 - 第一个返回类型
     * @template R2 - 第二个返回类型
     * @template R3 - 第三个返回类型（可选）
     * @param {Selector<S, R1>} selector1 - 第一个选择器
     * @param {(input: R1) => R2} selector2 - 第二个选择器
     * @param {(input: R2) => R3} selector3 - 第三个选择器（可选）
     * @returns {Selector<S, R3 | R2 | R1>} 派生选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createDerived(
     *   (s) => s.items,
     *   (items) => items.filter(i => i.active),
     *   (activeItems) => activeItems.length
     * )
     *
     * const count = selector(state)
     * // 计算活跃项目数量
     * ```
     */
    static createDerived<S extends State, R1, R2, R3>(selector1: Selector<S, R1>, selector2: (input: R1) => R2, selector3: (input: R2) => R3): Selector<S, R3>;
    static createDerived<S extends State, R1, R2>(selector1: Selector<S, R1>, selector2: (input: R1) => R2): Selector<S, R2>;
    /**
     * 创建数组选择器
     *
     * 对数组的每个元素应用选择器
     *
     * @template T - 数组元素类型
     * @template R - 返回元素类型
     * @param {(item: T) => R} itemSelector - 元素选择器
     * @returns {(array: T[]) => R[]} 数组选择器（输入为数组，不满足 Selector 的对象约束，故用函数类型）
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createArraySelector(
     *   (item) => item.value * 2
     * )
     *
     * const doubled = selector([1, 2, 3])
     * console.log(doubled) // [2, 4, 6]
     * ```
     */
    static createArraySelector<T, R>(itemSelector: (item: T) => R): (array: T[]) => R[];
    /**
     * 创建对象选择器
     *
     * 对对象的每个键应用选择器
     *
     * @template S - 状态类型
     * @template K - 键类型
     * @template R - 值类型
     * @param {(key: K) => Selector<S, R>} keySelector - 键选择器工厂
     * @returns {Selector<S, Record<K, R>>} 对象选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createObjectSelector(
     *   (key) => (s) => s[key].toUpperCase()
     * )
     *
     * const result = selector({ name: 'alice', city: 'beijing' })
     * console.log(result) // { name: 'ALICE', city: 'BEIJING' }
     * ```
     */
    static createObjectSelector<S extends State, K extends keyof S, R>(keySelector: (key: K) => Selector<S, R>): Selector<S, Record<K, R>>;
    /**
     * 创建条件选择器
     *
     * 根据条件选择执行哪个选择器
     *
     * @template S - 状态类型
     * @template R - 返回值类型
     * @param {(state: S) => boolean} condition - 条件函数
     * @param {Selector<S, R>} trueSelector - 条件为true时执行的选择器
     * @param {Selector<S, R>} falseSelector - 条件为false时执行的选择器
     * @returns {Selector<S, R>} 条件选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createConditionalSelector(
     *   (s) => s.userType === 'admin',
     *   (s) => s.adminPermissions,
     *   (s) => s.userPermissions
     * )
     *
     * const permissions = selector({ userType: 'admin', adminPermissions: [...], userPermissions: [...] })
     * // 返回 adminPermissions
     * ```
     */
    static createConditionalSelector<S extends State, R>(condition: (state: S) => boolean, trueSelector: Selector<S, R>, falseSelector: Selector<S, R>): Selector<S, R>;
    /**
     * 创建默认值选择器
     *
     * 选择器失败或返回undefined时使用默认值
     *
     * @template S - 状态类型
     * @template R - 返回值类型
     * @param {Selector<S, R>} selector - 原始选择器
     * @param {R} defaultValue - 默认值
     * @returns {Selector<S, R>} 带默认值的选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createDefaultSelector(
     *   (s) => s.optionalField,
     *   'N/A'
     * )
     *
     * const value1 = selector({ optionalField: 'exists' })
     * console.log(value1) // 'exists'
     *
     * const value2 = selector({ optionalField: undefined })
     * console.log(value2) // 'N/A'
     * ```
     */
    static createDefaultSelector<S extends State, R>(selector: Selector<S, R>, defaultValue: R): Selector<S, R>;
    static createRetrySelector<S extends State, R>(selector: Selector<S, R>, options?: RetrySelectorOptions): Selector<S, R>;
    static createRetrySelectorAsync<S extends State, R>(selector: Selector<S, R>, options?: AsyncRetrySelectorOptions): (state: S) => Promise<R>;
    /**
     * 创建防抖选择器
     *
     * 延迟执行选择器，在延迟期间多次调用只执行最后一次
     *
     * @template S - 状态类型
     * @template R - 返回值类型
     * @param {Selector<S, R>} selector - 原始选择器
     * @param {number} [delay=300] - 防抖延迟（毫秒）
     * @returns {Selector<S, Promise<R>>} 防抖选择器（返回Promise）
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createDebouncedSelector(
     *   (s) => s.value * 2,
     *   300
     * )
     *
     * // 多次调用在300ms内只有最后一次会执行
     * selector(state)
     * selector(state)
     * selector(state)
     * // 只执行一次
     * ```
     */
    static createDebouncedSelector<S extends State, R>(selector: Selector<S, R>, delay?: number): Selector<S, Promise<R>>;
    /**
     * 创建节流选择器
     *
     * 限制选择器执行频率，在指定间隔内只执行一次
     *
     * @template S - 状态类型
     * @template R - 返回值类型
     * @param {Selector<S, R>} selector - 原始选择器
     * @param {number} [interval=300] - 节流间隔（毫秒）
     * @returns {Selector<S, R>} 节流选择器
     *
     * @example
     * ```typescript
     * const selector = SelectorComposer.createThrottledSelector(
     *   (s) => s.value * 2,
     *   300
     * )
     *
     * // 在300ms内多次调用只执行一次
     * selector(state)
     * selector(state)
     * selector(state)
     * // 第一次执行，后两次返回缓存值
     * ```
     */
    static createThrottledSelector<S extends State, R>(selector: Selector<S, R>, interval?: number): Selector<S, R>;
}
```

### `SelectorComposerInput`

```ts
/**
 * 组合选择器参数
 */
export interface SelectorComposerInput<S extends State = Record<string, unknown>, T extends readonly Selector<S, unknown>[] = readonly Selector<S, unknown>[]> {
    /** 选择器数组 */
    selectors: [...T];
    /**
     * 组合函数
     *
     * 参数刻意保持 any[]：元组 mapped type 在严格泛型下推断失效
     * （combiner 实参类型由调用方泛型推断保证，见 compose.ts）
     */
    combiner: (...results: any[]) => unknown;
}
```

### `SelectorFactory`

```ts
/**
 * 选择器工厂类
 *
 * 管理选择器的执行、缓存和缓存策略
 *
 * @class SelectorFactory
 * @template S - 状态类型
 * @template R - 返回值类型
 *
 * @example
 * ```typescript
 * const factory = new SelectorFactory(
 *   (state) => state.value * 2,
 *   {
 *     cache: true,
 *     cacheSize: 10,
 *     cacheTTL: 5000,
 *     equalityFn: deepEqual
 *   }
 * )
 *
 * // 执行选择器
 * const result = factory.execute({ value: 10 })
 * console.log(result) // 20
 * ```
 */
export declare class SelectorFactory<S extends State = Record<string, unknown>, R = unknown> {
    /**
     * 选择器函数
     * @private
     * @type {Selector<S, R>}
     */
    private selector;
    /**
     * 当前缓存
     * @private
     * @type {SelectorCacheItem<R> | null}
     */
    private cache;
    /**
     * 缓存选项
     * @private
     * @type {Required<SelectorOptions>}
     */
    private options;
    /**
     * 缓存历史记录
     * @private
     * @type {SelectorCacheItem<R>[]}
     */
    private cacheHistory;
    /**
     * 创建选择器工厂实例
     *
     * @param {Selector<S, R>} selector - 选择器函数
     * @param {SelectorOptions} [options={}] - 缓存选项
     *
     * @example
     * ```typescript
     * const factory = new SelectorFactory(
     *   (state) => state.user.name,
     *   {
     *     cache: true,
     *     cacheSize: 10,
     *     cacheTTL: 5000
     *   }
     * )
     * ```
     */
    constructor(selector: Selector<S, R>, options?: SelectorOptions);
    /**
     * 执行选择器
     *
     * 根据缓存配置决定是使用缓存还是重新计算
     *
     * @param {S} state - 状态对象
     * @returns {R} 选择器结果
     *
     * @example
     * ```typescript
     * const factory = new SelectorFactory((s) => s.value * 2)
     * const result1 = factory.execute({ value: 10 })
     * const result2 = factory.execute({ value: 10 })
     * // 第二次执行会使用缓存
     * ```
     */
    execute(state: S): R;
    /**
     * 判断缓存条目是否命中（状态相等且未过期）
     *
     * @private
     */
    private isCacheHit;
    /**
     * 查找命中的缓存条目：最近一条优先，其次回溯 cacheHistory（最新在后），
     * 命中历史条目时将其提升为当前缓存（LRU 语义）
     *
     * @private
     * @returns 命中的缓存条目；未命中返回 null
     */
    private findCacheHit;
    /**
     * 更新缓存
     *
     * @private
     * @param {S} state - 状态对象
     * @param {R} value - 计算结果
     */
    private updateCache;
    /**
     * 清除缓存
     *
     * 清除所有缓存，下次执行会重新计算
     *
     * @example
     * ```typescript
     * factory.clearCache()
     * const result = factory.execute(state)
     * // 这次会重新计算，不使用缓存
     * ```
     */
    clearCache(): void;
    /**
     * 获取缓存状态
     *
     * @returns {{hasCache: boolean, cacheSize: number, cacheHit?: SelectorCacheItem<R>}} 缓存状态信息
     *
     * @example
     * ```typescript
     * const status = factory.getCacheStatus()
     * console.log('Has cache:', status.hasCache)
     * console.log('Cache size:', status.cacheSize)
     * console.log('Last cache hit:', status.cacheHit)
     * ```
     */
    getCacheStatus(): {
        hasCache: boolean;
        cacheSize: number;
        cacheHit?: SelectorCacheItem<R>;
    };
    /**
     * 创建带有缓存结果的选择器
     *
     * 返回的选择器会返回一个对象，包含值和是否来自缓存的信息
     *
     * @returns {Selector<S, SelectorResult<R>>} 包含缓存信息的选择器
     *
     * @example
     * ```typescript
     * const factory = new SelectorFactory((s) => s.value)
     * const resultSelector = factory.withCacheResult()
     *
     * const result1 = resultSelector(state)
     * console.log(result1.value, result1.fromCache) // 10, false
     *
     * const result2 = resultSelector(state)
     * console.log(result2.value, result2.fromCache) // 10, true
     * ```
     */
    withCacheResult(): Selector<S, SelectorResult<R>>;
}
```

### `SelectorOptions`

```ts
/**
 * 选择器选项
 */
export interface SelectorOptions {
    /** 是否启用缓存 */
    cache?: boolean;
    /** 缓存大小 */
    cacheSize?: number;
    /** 缓存过期时间（毫秒） */
    cacheTTL?: number;
    /** 比较函数 */
    equalityFn?: (a: unknown, b: unknown) => boolean;
}
```

### `SelectorResult`

```ts
/**
 * 选择器结果类型
 */
export type SelectorResult<R> = {
    value: R;
    fromCache: boolean;
};
```

---

## `./extras/snapshot`

> 类型声明：`./dist/extras/snapshot.d.ts`

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

---

## `./integrations`

> 类型声明：`./dist/integrations/index.d.ts`

### `BackgroundSyncConfig`

```ts
/**
 * 单个 Store 的后台 / 前台同步配置
 */
export interface BackgroundSyncConfig<S extends State = State> {
    /** 需要做时效性检查的 Store */
    store: Store<S>;
    /** 允许的最长非活跃时长（毫秒）：切前台时超过该时长会触发 `refreshData`；默认 5 分钟 */
    maxInactiveTime?: number;
    /** 切前台回调（在时效性检查之后执行） */
    onForeground?: () => void;
    /** 切后台回调 */
    onBackground?: () => void;
}
```

### `BackupData`

```ts
/**
 * 热更新前保存的状态备份
 */
export interface BackupData {
    /** 备份生成时间戳，用于过期判定（超过 `BACKUP_EXPIRY_MS` 即作废） */
    timestamp: number;
    /** `store.$snapshot()` 产出的状态快照 */
    state: unknown;
    /** 备份时的库版本（`LIBRARY_VERSION`）；与当前不一致时仅告警，仍按合并语义恢复 */
    version: string;
}
```

### `bindActions`

```ts
/**
 * 绑定 Actions 到目标实例
 *
 * 将 Store 的 actions 绑定到 Page/Component/App 实例方法
 *
 * @template S - 状态类型
 * @param target - 目标实例
 * @param mappings - 映射关系（本地方法名 → Action名）
 * @param store - Store 实例
 * @returns 取消绑定函数数组
 */
export declare function bindActions<S extends State = State>(target: Record<string, unknown>, mappings: Record<string, string>, store: Store<S>): Array<() => void>;
```

### `bindMappings`

```ts
/**
 * 绑定状态映射到目标对象
 *
 * 将 Store 的状态或 getters 映射到 Page/Component/App 实例，
 * 并自动订阅变化以实现双向同步。
 *
 * 所有映射的更新合并为一次批量 setter 调用：小程序 setData 调用开销较大，
 * 逐键调用会引发 N 次视图更新，合并后仅需一次。
 *
 * @template S - 状态类型
 * @param _target - 目标对象（Page/Component/App 实例）
 * @param mappings - 映射关系（本地键 → Store键）
 * @param getValue - 获取 Store 值的函数
 * @param setter - 批量设置本地值的函数（接收全部映射键的更新对象）
 * @param subscribeStore - 订阅 Store 变化的函数
 * @returns 取消绑定函数数组
 *
 * @example
 * ```typescript
 * const unbinds = bindMappings(
 *   pageInstance,
 *   { count: 'counter', name: 'userName' },
 *   (storeKey) => store.state[storeKey],
 *   (updates) => pageInstance.setData(updates),
 *   (callback) => store.subscribe(callback)
 * )
 * ```
 */
export declare function bindMappings(_target: unknown, mappings: Record<string, string>, getValue: (storeKey: string) => unknown, setter: (updates: Record<string, unknown>) => void, subscribeStore: (callback: () => void, options?: {
    readOnly?: boolean;
}) => () => void, 
/** 判断某状态键自上次通知以来是否变更（仅 state 映射可传入；getters 不提供，缺失时对象值保持「宁多勿漏」始终发送） */
changedKeys?: (storeKey: string) => boolean): Array<() => void>;
```

### `cleanupBindings`

```ts
/**
 * 清理所有绑定
 *
 * 执行所有取消绑定函数，清理订阅和引用
 *
 * @param unbinds - 取消绑定函数数组
 */
export declare function cleanupBindings(unbinds: Array<() => void>): void;
```

### `ConnectOptions`

```ts
/**
 * 连接选项
 *
 * 泛型参数均可由 withPageStore / withComponentStore 的 store 参数自动推断：
 * - `S`：约束 mapState 键/值须为状态键（拼错编译报错）
 * - `A`：约束 mapActions 键/值须为 action 名
 * - `G`：约束 mapGetters 键/值须为 getter 名
 */
export interface ConnectOptions<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> {
    /** 映射state */
    mapState?: readonly (keyof S)[] | Record<string, keyof S>;
    /** 映射getters */
    mapGetters?: readonly (keyof G)[] | Record<string, keyof G>;
    /** 映射actions（数组形式按 action 名映射；对象形式支持本地名重命名，值须为 action 名） */
    mapActions?: readonly (keyof A)[] | Record<string, keyof A>;
    /** 是否自动注入到页面/组件data（使用getCached） */
    autoInject?: boolean;
    /** 自动注入的字段映射（从store键到本地键） */
    injectMapping?: Record<string, string>;
    /** 是否在页面onShow/组件attached时更新注入（默认仅在onLoad时） */
    autoUpdateOnShow?: boolean;
}
```

### `createEnterpriseApp`

```ts
/**
 * 示例：在 App.ts 中使用以上所有功能
 * 账号切换/登出时自动 dispose 旧的 OfflineManager，避免监听泄漏
 */
export declare function createEnterpriseApp(config?: EnterpriseAppConfig): {
    globalData: {
        storeManager: import("./store-manager.js").StoreManager;
        store: Store<UserState, import("../../types/store.js").Actions, import("../../types/store.js").Getters<UserState>> | null;
        offlineManager: OfflineManager<UserState> | null;
    };
    onLaunch(): void;
    onShow(): void;
    login(userId: string): Store<UserState, import("../../types/store.js").Actions, import("../../types/store.js").Getters<UserState>>;
    logout(): void;
    getStore(): Store<UserState> | null;
    getOfflineManager(): OfflineManager<UserState> | null;
};
```

### `createUserStore`

```ts
/**
 * 创建用户隔离的 Store
 *
 * 每个用户拥有独立的 Store 实例与持久化键（store name 即 `user-store-${userId}`），
 * 登出时 StoreManager 按同一键清理持久化数据，保证键的写入与删除一致
 */
export declare function createUserStore(config: UserStoreConfig): Store<UserState>;
```

### `EnterpriseAppConfig`

```ts
/**
 * `createEnterpriseApp` 的配置项
 */
export interface EnterpriseAppConfig {
    /** 允许的最长非活跃时长（毫秒），透传给 `initBackgroundSync`；默认 10 分钟 */
    maxInactiveTime?: number;
}
```

### `exposeStoreAPI`

```ts
/**
 * 暴露 Store API 到目标实例
 *
 * 在 App 实例上暴露常用的 Store API 方法
 *
 * @template S - 状态类型
 * @param target - 目标实例（通常是 App 实例）
 * @param store - Store 实例
 * @returns 取消暴露函数
 *
 * @example
 * ```typescript
 * exposeStoreAPI(appInstance, store)
 * // 现在可以通过 appInstance.getStore() 访问 Store
 * ```
 */
export declare function exposeStoreAPI<S extends State = State>(target: Record<string, unknown>, store: Store<S>): () => void;
```

### `HotUpdateConfig`

```ts
/**
 * `initHotUpdate` 的配置项
 */
export interface HotUpdateConfig<S extends State = State> {
    /** 需要保护状态的 Store */
    store: Store<S>;
    /** 备份存储键；缺省按 store 名派生，保证多账号/多实例互不覆盖 */
    backupKey?: string;
    /** 用户确认更新且备份成功后的回调（可用于落库或上报） */
    onBeforeUpdate?: () => void;
}
```

### `initBackgroundSync`

```ts
/**
 * 初始化后台/前台状态同步
 * 在小程序从后台返回前台时检查状态时效性
 *
 * 多次调用不会重复包装全局 App：
 * 若全局 App 仍为本模块安装的包装函数，则仅注册新的处理器；
 * 若全局 App 已被外部替换（如测试重置），则重新安装并重置注册表
 */
export declare function initBackgroundSync<S extends State = State>(config: BackgroundSyncConfig<S>): void;
```

### `initHotUpdate`

```ts
export declare function initHotUpdate<S extends State = State>(config: HotUpdateConfig<S>): void;
```

### `OfflineAction`

```ts
/**
 * 一条被离线缓存的待同步操作
 */
export interface OfflineAction {
    /** 唯一标识（时间戳 + 随机串） */
    id: string;
    /** Action 名称，同步时经 `store.dispatch` 执行 */
    type: string;
    /** 执行时透传给 Action 的载荷 */
    payload: unknown;
    /** 入队时间戳 */
    timestamp: number;
    /** 已失败次数；达到 `maxRetryCount` 后移入死信队列并触发 `onDrop` */
    retryCount: number;
}
```

### `OfflineManager`

```ts
/**
 * 离线状态管理器
 * 在离线时缓存操作，网络恢复后自动同步
 *
 * 生命周期：不再使用时调用 dispose() 释放网络监听，
 * 避免账号切换等场景下旧实例监听泄漏
 */
export declare class OfflineManager<S extends State = State> {
    private store;
    private actionQueue;
    private isOnline;
    /** 同步互斥标志：防止网络恢复回调与手动 syncQueue 并发重复执行队列 */
    private syncing;
    /** 同步进行中的队列中间状态：saveQueue 落盘时据此拼接完整联合视图。
     *  同步期间 enqueue 会触发 saveQueue，若只写 this.actionQueue，
     *  磁盘会被「仅剩新项」的队列覆写——进程恰在此窗口被杀时，
     *  未处理的旧操作永久丢失（at-least-once 被破坏）。syncQueue 结束后归空。 */
    private syncPending;
    private syncFailed;
    private syncNextIndex;
    private disposed;
    /** 网络监听回调引用，dispose 时用于精确移除。参数类型同时兼容 wx.on/offNetworkStatusChange 两种签名 */
    private networkHandler;
    private readonly maxRetryCount;
    private readonly queueKey;
    private readonly deadLetterKey;
    /** 死信队列容量上限：长期不处理死信时防止小程序 storage（10MB）被无界挤占 */
    private static readonly MAX_DEAD_LETTERS;
    /** 死信回调：操作超过重试上限被移入死信队列时通知调用方（业务层兜底/告警） */
    private readonly onDrop;
    constructor(store: Store<S>, queueKey?: string, maxRetryCount?: number, onDrop?: (action: OfflineAction) => void);
    /**
     * 执行操作（支持离线缓存）
     */
    execute<T>(type: string, action: () => Promise<T>, payload?: unknown): Promise<T | null>;
    /**
     * 同步离线队列（公开方法供外部调用）
     * syncing 互斥保证并发触发时队列不会被重复执行
     */
    syncQueue(): Promise<void>;
    /**
     * 清空队列
     *
     * 同步进行中调用同样生效：syncQueue 采用快照-清空模式，队列分散在
     * actionQueue（同步期间新入队）、syncPending（本轮待同步快照）、syncFailed（失败段）
     * 三段，其 finally 会把三段拼回 actionQueue 并落盘。只清 actionQueue 会让
     * 已「清空」的操作在同步结束时复活继续同步，故三段一并置空——
     * syncPending 清空后循环条件立即为假、同步停止；清空之后新入队的操作
     * 仍进 actionQueue，不受影响
     */
    clearQueue(): void;
    /**
     * 获取队列长度
     */
    getQueueLength(): number;
    /**
     * 释放资源：移除网络状态监听
     * 账号切换/登出重建 OfflineManager 前必须先调用，否则旧实例监听泄漏
     */
    dispose(): void;
    /**
     * 添加操作到队列
     */
    private enqueue;
    /**
     * 尝试执行单个操作
     */
    private tryExecuteAction;
    /**
     * 执行具体操作（可被子类重写）
     */
    protected executeAction(action: OfflineAction): Promise<void>;
    /**
     * 初始化网络监听
     * 保存回调引用，供 dispose 精确移除
     */
    private initNetworkListener;
    /**
     * 保存队列到存储
     *
     * 同步进行中时队列被拆为「已失败待重试 + 未处理剩余（含当前执行项）+ 新入队」三段，
     * 必须落盘完整联合视图：否则磁盘被仅含新项的队列覆写，
     * 进程在同步窗口内被杀会让未处理旧操作永久丢失（at-least-once）
     */
    private saveQueue;
    /**
     * 追加操作到死信队列（持久化，供业务层后续人工处理或上报）
     */
    private appendDeadLetter;
    /**
     * 获取死信队列中超过重试上限被丢弃的操作
     */
    getDeadLetters(): OfflineAction[];
    /**
     * 清空死信队列（业务层确认已处理丢失操作后调用）
     */
    clearDeadLetters(): void;
    /**
     * 从存储加载队列
     */
    private loadQueue;
}
```

### `parseMapping`

```ts
/**
 * 解析映射配置，返回统一的键值对映射
 *
 * 支持数组形式和对象形式的映射配置：
 * - 数组: ['key1', 'key2'] → { key1: 'key1', key2: 'key2' }
 * - 对象: { local: 'store' } → { local: 'store' }
 *
 * 键经 String() 归一（类型层面接受 PropertyKey，实际状态键均为字符串）
 *
 * @param mapping - 映射配置（数组或对象）
 * @returns 统一格式的键值对映射
 *
 * @example
 * ```typescript
 * // 数组形式
 * parseMapping(['count', 'name'])
 * // → { count: 'count', name: 'name' }
 *
 * // 对象形式（别名映射）
 * parseMapping({ totalCount: 'count', userName: 'name' })
 * // → { totalCount: 'count', userName: 'name' }
 * ```
 */
export declare function parseMapping(mapping: ReadonlyArray<PropertyKey> | Record<string, PropertyKey>): Record<string, string>;
```

### `performAutoInject`

```ts
/**
 * 自动注入 Store 值到目标对象
 *
 * 根据注入映射，将 Store 缓存的值自动注入到目标对象
 *
 * @template S - 状态类型
 * @param target - 目标对象
 * @param injectMapping - 注入映射（源键 → 目标键）
 * @param store - Store 实例
 * @param setter - 设置值的函数
 *
 * @example
 * ```typescript
 * performAutoInject(
 *   pageInstance,
 *   { userInfo: 'user', config: 'appConfig' },
 *   store,
 *   (key, value) => pageInstance.setData({ [key]: value })
 * )
 * ```
 */
export declare function performAutoInject<S extends State = State>(_target: unknown, injectMapping: Record<string, string>, store: Store<S>, setter: (updates: Record<string, unknown>) => void): void;
```

### `restoreFromHotUpdate`

```ts
/**
 * 从热更新备份恢复状态
 */
export declare function restoreFromHotUpdate<S extends State = State>(store: Store<S>, backupKey?: string): boolean;
```

### `storeManager`

```ts
storeManager: StoreManager
```

### `StoreManager`

```ts
/**
 * Store 管理器：负责多账号 Store 的获取/创建、身份切换、登出与 LRU 淘汰
 *
 * 使用约束：
 * - `getUserStore` 只「取/建」指定账号的 store，**不改变当前登录身份**——
 *   只读预览其它账号时若顺带切换身份，后续 `logout()` 会清错账号的数据；
 *   身份切换请显式调用 `switchUser`
 * - 被 LRU 淘汰或 `logout()` 后的 store 已 `destroy()`，不可继续 dispatch
 */
export declare class StoreManager {
    private stores;
    private currentUserId;
    private readonly maxStores;
    constructor(maxStores?: number);
    /**
     * 获取或创建用户 Store
     *
     * 只负责「取/建某账号的 store」，**不改变当前登录身份**。
     * 此前未命中分支会顺带写 this.currentUserId，而命中分支不会——同一调用的身份
     * 副作用取决于 LRU 淘汰状态这一调用方不可见的实现细节；只读预览另一账号
     * （getUserStore('B')）会静默把身份切成 B，随后 logout() 清的是 B 的数据。
     * 身份切换与冷启动恢复一律走 switchUser 显式表达。
     */
    getUserStore(userId: string): Store<UserState>;
    /**
     * 切换用户
     */
    switchUser(userId: string): Store<UserState>;
    /**
     * 登出当前用户
     * 持久化键与 createUserStore 的存储键一致（均为 `user-store-${userId}`）
     */
    logout(): void;
    /**
     * 获取当前用户的 Store
     */
    getCurrentStore(): Store<UserState> | null;
    /**
     * 清理所有 Store
     */
    clearAll(): void;
    /**
     * LRU 清理最早的 Store
     */
    private cleanupOldestStore;
}
```

### `unregisterBackgroundSync`

```ts
/**
 * 注销指定 Store 的后台同步处理器
 *
 * 账号切换/登出时应调用，避免已销毁 Store 的处理器残留在注册表中，
 * 导致下次 onShow 触发 dispatch 抛错中断生命周期。
 */
export declare function unregisterBackgroundSync<S extends State = State>(store: Store<S>): void;
```

### `UserInfo`

```ts
/**
 * 用户信息（由服务端返回，业务可自行扩展字段）
 */
export interface UserInfo {
    /** 用户唯一标识 */
    id?: string | number;
    /** 昵称 */
    name?: string;
    /** 头像地址 */
    avatar?: string;
    [key: string]: unknown;
}
```

### `UserPreferences`

```ts
/**
 * 用户偏好设置（随账号隔离并持久化）
 */
export interface UserPreferences {
    /** 主题标识 */
    theme?: string;
    /** 语言标识 */
    language?: string;
    [key: string]: unknown;
}
```

### `UserState`

```ts
/**
 * 用户隔离 Store 的状态形状
 */
export interface UserState extends State {
    /** 当前用户信息；未登录或未同步时为 null */
    userInfo: UserInfo | null;
    /** 用户偏好设置 */
    preferences: UserPreferences;
    /** 最近一次与服务端同步的时间戳；未同步时为 null */
    lastSyncTime: number | null;
}
```

### `UserStoreConfig`

```ts
/**
 * `createUserStore` 的配置项
 */
export interface UserStoreConfig {
    /** 用户唯一标识：参与 Store 名称与持久化键（`user-store-${userId}`） */
    userId: string;
    /** 初始状态覆盖项（可选） */
    initialState?: Partial<UserState>;
}
```

### `withAppStore`

```ts
/**
 * App 集成函数
 *
 * 将 Store 连接到微信小程序 App，自动管理状态同步和订阅清理
 *
 * 类型推断：`S` / `A` / `G` 均从 store 参数自动推断，
 * mapState / mapGetters / mapActions 的键与值拼错时会在编译期报错；
 * 返回的装饰器保持传入 App 配置的原始类型（不擦除自定义方法/生命周期类型）。
 *
 * 生命周期内的 `this` 自动获得注入后的实例类型（`AppThis`）：映射的 state/getters
 * 出现在 `globalData` 上、映射的 action 与调试 API 直接挂在实例上，**无需手写 this 标注**。
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns App 装饰器（保持配置类型，并注入方法 this）
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { withAppStore } from '@openlide/geomstore/integrations'
 *
 * const store = createStore({
 *   name: 'app',
 *   state: { userInfo: null, config: {}, theme: 'light' },
 *   actions: {
 *     async initApp() {
 *       const config = await fetchConfig()
 *       this.setState('config', config)
 *     },
 *     setTheme(theme) {
 *       this.setState('theme', theme)
 *     }
 *   }
 * })
 *
 * // 简写：数组形式（this.globalData / 注入的 action 均有类型，无需手写 this）
 * App(withAppStore(store, {
 *   mapState: ['userInfo', 'config', 'theme'],
 *   mapActions: ['initApp', 'setTheme']
 * })({
 *   globalData: { otherData: '...' },
 *   onLaunch() {
 *     console.log(this.globalData.userInfo)
 *     this.initApp()
 *     this.setTheme('dark')
 *   }
 * }))
 *
 * // 高级用法：对象形式
 * App(withAppStore(store, {
 *   mapState: {
 *     user: 'userInfo',
 *     appConfig: 'config',
 *     currentTheme: 'theme'
 *   },
 *   mapActions: {
 *     doInit: 'initApp',
 *     changeTheme: 'setTheme'
 *   }
 * })({
 *   globalData: { otherData: '...' },
 *   onLaunch() {
 *     console.log(this.globalData.user)
 *     this.doInit()
 *     this.changeTheme('dark')
 *   }
 * }))
 *
 * // 调试 API
 * // 在其他 Page 或 Component 中访问：
 * const app = getApp()
 * app.getStore()           // 获取 store 实例
 * app.getState()           // 获取状态
 * app.dispatch('xxx')      // dispatch action
 * app.subscribe(callback)   // 订阅状态变化
 * ```
 */
export declare function withAppStore<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(store: Store<S, A, G>, options?: ConnectOptions<S, A, G>): <C extends AppOptions>(AppConfig: WithPageThis<C, AppThis<S, A, G, ConnectOptions<S, A, G>, C>> & ThisType<AppThis<S, A, G, ConnectOptions<S, A, G>, C>>) => C;
```

### `withComponentStore`

```ts
/**
 * Component 混入函数
 *
 * 将 Store 连接到微信小程序 Component，自动管理状态同步和订阅清理
 *
 * 类型推断：与 withPageStore 一致，`S` / `A` / `G` 从 store 参数自动推断，
 * `O` 保留 options 字面量类型用于精确推导；
 * mapState / mapGetters / mapActions 的键与值拼错时编译期报错；
 * 装饰器返回类型重写所有方法的 this 为 ComponentThis，使方法内 this.data / this.xxx 自动获得精确类型
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @template O - ConnectOptions 字面量类型（自动推断）
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns Component 装饰器：入参为「各命名空间内方法 `this` 已注入」（`WithComponentThis`）的配置，返回增强后的配置（形状见 `ComponentConfig`）
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { withComponentStore } from '@openlide/geomstore/integrations'
 *
 * const store = createStore({
 *   state: { count: 0, name: 'test' },
 *   actions: { increment() { this.state.count++ } }
 * })
 *
 * Component(withComponentStore(store, {
 *   mapState: ['count', 'name'],
 *   mapActions: ['increment']
 * })({
 *   methods: {
 *     handleTap() {
 *       this.data.count // ✅ 自动推导为 number
 *       this.increment() // ✅ 精确签名
 *     }
 *   }
 * }))
 * ```
 */
export declare function withComponentStore<S extends State, A extends Actions, G extends Getters<S>, O extends ConnectOptions<S, A, G>>(store: Store<S, A, G>, options?: O): <C extends ComponentOptions>(ComponentConfig: WithComponentThis<C, ComponentThis<S, A, G, O, ComponentOwnMethods<C>>>) => ComponentConfig<S, A, G, O, ComponentOwnMethods<C>> & Omit<C, 'data' | 'methods'> & {
    data: (C extends {
        data: infer D;
    } ? D : object) & ExtractPageData<S, O, G>;
};
```

### `withPageStore`

```ts
/**
 * Page 混入函数
 *
 * 将 Store 连接到微信小程序 Page，自动管理状态同步和订阅清理
 *
 * 类型推断：
 * - `S` / `A` / `G` 均从 store 参数自动推断
 * - `O` 保留 options 字面量类型，用于精确推导方法内 this.data 与 actions
 * - mapState / mapGetters / mapActions 的键与值拼错时会在编译期报错
 * - 装饰器返回类型重写所有方法的 this 为 PageThis，使方法内 this.data / this.xxx 自动获得精确类型
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @template O - ConnectOptions 字面量类型（自动推断）
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns Page 装饰器：入参为「方法 `this` 已注入」（`ThisType<PageThis>`）的配置，返回增强后的配置（形状见 `PageConfig`）
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { withPageStore } from '@openlide/geomstore/integrations'
 *
 * const store = createStore({
 *   state: { count: 0, name: 'test' },
 *   actions: { increment() { this.state.count++ } }
 * })
 *
 * Page(withPageStore(store, {
 *   mapState: ['count', 'name'],
 *   mapActions: ['increment']
 * })({
 *   data: { localData: '...' },
 *   onLoad() {
 *     this.data.count // ✅ 自动推导为 number
 *     this.increment() // ✅ 精确签名
 *   }
 * }))
 * ```
 */
export declare function withPageStore<S extends State, A extends Actions, G extends Getters<S>, O extends ConnectOptions<S, A, G>>(store: Store<S, A, G>, options?: O): <C extends PageOptions>(PageConfig: WithPageThis<C, PageThis<S, A, G, O>> & {
    data: object;
} & ThisType<PageThis<S, A, G, O>>) => PageConfig<S, O, G> & Omit<C, "data"> & {
    data: (C extends {
        data: infer D;
    } ? D : object) & ExtractPageData<S, O, G>;
};
```
