# `.` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.5.1`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`.`
> - 类型声明：`./dist/index.d.ts`
> - 返回索引：[`index.md`](./index.md)

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
 *
 * 两个 `any` 都是必要的（实测改 `unknown` 即破功）：本类型是「任意 action 集合」的**约束位点**，
 * 参数逆变会让 `(id: string) => void` 这类具体 action 不再满足 `(...args: unknown[]) => unknown`，
 * 返回值逆变会拒掉返回具体值的 async action；协变/逆变两侧都要放行，只能是 `any`。
 * 精确签名由 `InferActionArgs` / `InferActionReturn` 在具体 A 上恢复，`Actions` 从不出现在调用点。
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
export type ComponentConfig<S extends State, A extends Actions, G extends Getters<S> = Getters<S>, M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>, ExtraMethods extends object = object> = InjectedDataShape<S, M, G> & ComponentMethodsShape<ExtraMethods, A, M>;
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
export type ComponentThis<S extends State, A extends Actions, G extends Getters<S> = Getters<S>, M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>, ExtraMethods extends object = object> = InjectedDataShape<S, M, G> & ExtraMethods & ExtractMappedActions<A, M> & ComponentMethodsShape<ExtraMethods, A, M>;
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
    /**
     * 合并后的 action 注册表：键与 dispatch 的命名规则一致（命名空间模式为
     * `storeName/actionName`，非命名空间模式为裸名，同名取第一个 store）。
     */
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
    /** 当前活跃的订阅者：监听器 → 注册次数与其中可写份数。
     *  与 SubscriptionManager 同语义——同一函数注册 N 次通知 N 次，退订只减一，
     *  减到 0 才真正移除。此前用 Set 会使「退订其中一份」直接删除整个监听器，
     *  用户仍持有的另一份退订句柄静默失效、永不再收到通知。 */
    private _composedListeners;
    /** 可写（非只读）注册总次数：>0 时通知载荷必须是深拷贝（见 _notifyListeners 的隔离说明） */
    private _composedWritableCount;
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
    /**
     * 通知期间新产生的脏子 store（回调内的重入写入）：与 Store._deferredDirtyKeys 同语义，
     * 不能随本轮收尾一起清空，否则下一轮 isStateKeyDirty 会把已变更的子 store 判为未变化
     */
    private _deferredDirtyStores;
    /** 是否正在通知：决定脏子 store 标记是否需要同时留给下一轮 */
    private _notifying;
    /** 合并状态缓存：非命名空间/命名空间两种读取形态各缓存一份，子 store 变化时失效 */
    private _mergedCache;
    /** 只读冻结形态的合并状态缓存（对应 state getter），与 _mergedCache 独立以免冻结影响 getState 消费者 */
    private _mergedCacheFrozen;
    /** 合并缓存是否启用：子 store 订阅失效回调建立失败时降级为每次读取重合并，保证不返回陈旧状态 */
    private _mergedCacheEnabled;
    /**
     * 缓存建立时各子 store 的状态版本号快照：读取时逐一比对，不一致即失效。
     *
     * 子 store 的失效回调依赖「通知」，但批处理会推迟通知、notify:{async:true} 会
     * 延迟通知——仅靠通知失效会让批内的读改写读到缓存里的过期值（丢失更新）。
     * 版本号 getter 在子 store 的每条写入路径上同步递增，此处读取时校验
     * 不受通知时序影响。无版本号的子 store（含嵌套组合）每次读取时保守失效。
     */
    private _cachedChildVersions;
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
     * 读取前校验合并缓存新鲜度：逐一比对各子 store 当前状态版本号与缓存建立时的
     * 快照，任一不一致即失效。覆盖批处理推迟通知、异步通知未 flush 等窗口——
     * 这些场景下子 store 状态已变但失效回调尚未执行。
     */
    private _ensureMergedCacheFresh;
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
    /** 记录当前各子 store 的状态版本号，供读取时校验缓存新鲜度 */
    private _recordChildVersions;
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
     * 标记子 store 为脏；通知进行中（回调内的重入写入）同时记入下一轮集合
     */
    private _markDirtyStore;
    /**
     * 调度一次合并通知：同一微任务内的多次状态变化只触发一次广播
     */
    private _scheduleNotify;
    subscribe(listener: StateListener<S>, options?: {
        readOnly?: boolean;
    }): () => void;
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
    private _createUnsubscribe;
    /**
     * 释放一份监听器注册：同一监听器减到 0 才真正移除。
     *
     * 句柄捕获自己那一次注册的 readOnly 标记：同一函数可能既被只读注册（视图绑定）
     * 又被可写注册（用户订阅），退订时必须按各自的标记回收可写计数。
     */
    private _releaseListener;
    use(plugin: Plugin<S> | Plugin<State>): () => void;
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

### `Getters`

```ts
/**
 * Getters类型 - 支持类型推断
 */
export type Getters<S extends State = State> = {
    [K: string]: (state: S) => unknown;
};
```

### `HookHandler`

```ts
/**
 * 钩子处理函数
 *
 * 返回值一律被忽略（`emit` 的返回类型是 `void`，实现层调用 `handler(...args)` 后不收集结果），
 * 故本类型不带结果泛型：钩子只用于观察/改写载荷，需要「拦截并否决」的语义请走
 * `beforeXxx` 内的异常抛出（`onError` 通道）。此前存在的 `TResult = void` 参数
 * 会让 `HookHandler<[], boolean>` 这类写法看起来可被观察，实际永远拿不到返回值。
 *
 * 默认 `TArgs = unknown[]` 是实现层（core/hooks 的 `Map<HookName, Set<HookHandler>>`）
 * 用来擦除钩子差异的内部形状；面向插件作者的签名是 {@link HookHandlerFor}。
 */
export type HookHandler<TArgs extends unknown[] = unknown[]> = (...args: TArgs) => void;
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

### `IHookSystem`

```ts
/**
 * 钩子系统契约接口
 *
 * 由 core/hooks 的 HookSystem 类实现；类型层仅依赖此接口，
 * 避免 types 反向依赖实现类。
 *
 * `on` / `emit` 都按 `HookName` 关联 {@link HookArgsMap}：处理器可写出精确形参
 * （`on('beforeDispatch', (name, args) => …)` 中 `name: string`，无需再写 `unknown`），
 * `emit` 的实参顺序/个数也在编译期受检。
 *
 * 为什么 `on` 的处理器形参要经过 {@link HookHandlerFor} 的联合分支判定，而不是直接
 * `handler: (...args: HookArgsMap[K]) => void`：实现类 `HookSystem.on` 的形参是类型擦除的
 * `HookHandler`（`Map<HookName, Set<HookHandler>>` 的存储形状），精确元组在参数逆变下无法满足
 * 接口成员（实测 TS2416）；而写成 `HookHandlerFor<K> | HookHandler` 虽然通过实现检查，却会让
 * 联合形参失去上下文类型推断（实测无标注箭头形参全部退化为隐式 any），正好丢掉本次修复的目的。
 * `IsUnion` 分支让两端同时成立：调用点传字面量钩子名得到精确签名，实现类与组合层桥接
 * （传 `HookName` 联合变量）走擦除分支。
 */
export interface IHookSystem {
    /** 注册钩子处理器，返回取消注册函数；处理器形参由 HookArgsMap 按钩子名给出 */
    on<K extends HookName>(hookName: K, handler: HookHandlerFor<K>): () => void;
    /**
     * 触发钩子：实参元组由 HookArgsMap 按钩子名给出，顺序/个数不符即编译报错
     *
     * **处理器抛错时的语义**（插件作者据此决定要不要自己兜异常）：
     * - 单个处理器抛错既不中断本次触发的其余处理器，也**不会传播给 `emit` 的调用方**
     *   （返回 `void`，实现按快照逐个 try/catch）。
     * - 错误先 `console.error` 记录，再转投 `onError` 钩子（`emit('onError', error, hookName)`），
     *   故 `onError` 是钩子系统唯一的上报通道；要接监控系统，注册 `onError` 处理器即可。
     * - `onError` 自身抛错只落 `console.error`，不再递归转投自己。
     * - 需要「让抛错冒泡到业务调用方」的语义不能靠钩子实现，请走 action 的错误边界。
     */
    emit<K extends HookName>(hookName: K, ...args: HookArgsMap[K]): void;
    /** 清除钩子（指定名称或全部） */
    clear(hookName?: HookName): void;
    /**
     * 计数，**量纲随入参变化**：传 `hookName` 返回该钩子的 handler 数，不传返回已注册的钩子名称数。
     *
     * 双语义易误用（无参时的「种类数」和有参时的「监听器数」不是同一个量），
     * 只想数某个钩子上挂了几个处理器时请改用无歧义的 {@link IHookSystem.listenerCount}。
     * 本方法保留：已随 `IHookSystem` 发布，且 `size()` 的无参语义有既有调用方。
     */
    size(hookName?: HookName): number;
    /**
     * 指定钩子当前的处理器数量（未注册返回 0），语义单一。
     *
     * `size(hookName)` 的明确别名：本方法此前只在实现类 `HookSystem` 上存在，
     * 而 `Store.hooks` 的声明类型是本接口，插件作者经 `store.hooks` 拿不到它。
     */
    listenerCount(hookName: HookName): number;
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
 *
 * 约束里的 `any` 必要：getter 以**具体状态类型**声明形参（`(state: UserState) => number`），
 * 参数逆变下 `state: State` / `state: unknown` 的约束会直接拒掉这类 getter；
 * 返回值同理需放行任意形状。此处只做提取，精确返回类型仍由 `infer R` 从具体 G 得到。
 */
export type InferGetterReturn<G extends Record<string, (state: any) => any>, K extends keyof G> = G[K] extends (...args: never[]) => infer R ? R : never;
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
    /**
     * 淘汰进行中：onEvict 回调重入 set()/resize() 时不再启动第二层淘汰循环。
     * 重入的写入交给外层循环消化（回调返回后外层 while 会重新核对容量），
     * 否则「回调内回填刚被逐出的键」会一层套一层递归，直到 RangeError 栈溢出。
     */
    private evicting;
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
     * 优化：时钟调用只在「开启统计且开启计时」的命中路径发生，未命中不取时钟
     *
     * @remarks `trackAccessTime` 只影响 `avgAccessTime` 的采样，不影响 LRU 顺序：
     * 顺序始终由 `moveToHead`（访问即最近使用）决定。
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
     * @remarks 清空按「逐条淘汰」口径记账：每个条目触发一次 `onEvict`，
     * 并累计计入 `getStats().evictions`（该字段的契约是「onEvict 触发次数」，
     * 而非「因容量上限被挤出的条目数」）。因此把 `clear()` 用于配置性重建
     * （如 `StoreCacheManager.enable()`）时，`evictions` 会包含这部分非容量淘汰；
     * 需要区分两类淘汰的调用方，可在配置性清空前后各读一次 `evictions` 求差。
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
    /**
     * 缓存容量：实现保证的是「有限值且 >= 1」，**不保证整数**。
     *
     * 规范化只发生在写入 capacity 的两处（构造器与 `resize()`）：非有限值（NaN/±Infinity）
     * 分别回退默认 100 与保持旧值，小于 1 的值夹到 1；小数上限不会被取整，
     * 淘汰判定 `size > capacity` 因而等价于「最多容纳 floor(capacity) 个条目」。
     * 这里读到的是生效容量，不是用户传入的原值。
     */
    capacity: number;
    /** 当前缓存项数量 */
    size: number;
    /** 缓存命中次数 */
    hits: number;
    /** 缓存未命中次数 */
    misses: number;
    /** 总访问次数 */
    totalAccesses: number;
    /**
     * 命中率：**0–100 的百分比数值**（非 0–1 比例），保留两位小数。
     *
     * 哨兵语义：`totalAccesses === 0` 时返回 `0`，表示「无访问数据」而非「0% 命中」。
     * 调用方需区分两者时请按 `totalAccesses > 0` 判定，不要用 `hitRate === 0` 判「全未命中」。
     */
    hitRate: number;
    /**
     * 未命中率：**0–100 的百分比数值**，保留两位小数，口径与 `hitRate` 一致
     * （两者按各自计数独立求值，和为 100，仅有两位小数的舍入误差）。
     *
     * 哨兵语义：`totalAccesses === 0` 时返回 `0`，表示「无访问数据」而非「0% 未命中」。
     */
    missRate: number;
    /** 淘汰的缓存项数量 */
    evictions: number;
    /**
     * 当前缓存键列表（按最近使用顺序）
     *
     * 键经 `String(key)` 序列化：非字符串键会丢失类型信息，对象键会塌缩为
     * `[object Object]`、数字 1 与字符串 '1' 不可区分。仅用于调试展示，
     * 不得用作键的身份判定（需要原始键请用 `LRUCache.keys()`）。
     */
    keys: string[];
    /**
     * 平均访问时间（毫秒，保留三位小数）：仅统计命中路径的收尾成本。
     *
     * 哨兵语义：`0` 有两种来源——「无命中」（hits === 0）与「未开启计时/统计」
     * （`trackAccessTime` 或 `enableStats` 为 false），**不表示访问耗时真是 0ms**。
     * 展示前请先确认 `hits > 0` 且构造时开启了计时。
     */
    avgAccessTime: number;
    /**
     * 缓存项平均存活时间（毫秒，四舍五入到整数）：`now - createdAt` 的均值。
     *
     * 哨兵语义：空缓存（`size === 0`）返回 `0`，表示「无条目」而非「存活 0ms」。
     */
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
} = ConnectOptions<S, Actions, Getters<S>>, G extends Getters<S> = Getters<S>> = InjectedDataShape<S, M, G> & {
    getTabBar?: () => {
        syncSelectedTab?: () => void;
    } | undefined;
};
```

### `PageOwnMethods`

```ts
/**
 * 从 Page 配置提取用户自定义方法（排除保留键，方法 this 不检查以避免循环兼容性）
 *
 * 现状（#428）：`withPageStore` 目前实例化的是 `PageThis<S, A, G, O>`，**没有**把本映射作为
 * 第 5 个泛型 `ExtraMethods` 传进去（组件侧 `withComponentStore` 则确实传了 `ComponentOwnMethods<C>`），
 * 故页面方法内的 `this` 暂时看不到同页自定义方法。保留键清单见 `PageReservedKeys`。
 * 与 Component 对齐的接线在集成层（`src/integrations/with-store.ts`），不在类型层。
 */
export type PageOwnMethods<C> = {
    [K in keyof Omit<C, PageReservedKeys>]: C[K] extends (...args: infer P) => infer R ? (...args: P) => R : C[K];
};
```

### `PageReservedKeys`

```ts
/**
 * Page 保留键（框架生命周期 + 页面事件处理函数 + 内部字段），不参与自定义方法提取
 *
 * 页面事件处理函数一栏来自小程序基础库、**仓库内没有任何地方声明**（本库不依赖 miniprogram-api-typings），
 * 因此只能在这里逐个列全：漏掉的键会被 `PageOwnMethods` 当成用户自定义方法，
 * 其方法签名里的 `this` 被剥离（该映射刻意去掉 this），并作为 ExtraMethods 并入 `this`，污染页面类型。
 *
 * - `onShareTimeline`：分享到朋友圈（基础库 2.11.3+）
 * - `onAddToFavorites`：添加到收藏（基础库 2.8.1+）
 * - `onSaveExitState`：退出时保存状态（基础库 2.11.0+）
 * - `options`：页面级配置项（非函数，但同样是框架键，不应被当作自定义方法）
 */
export type PageReservedKeys = 'data' | 'setData' | 'onLoad' | 'onShow' | 'onHide' | 'onUnload' | 'onReady' | 'onPullDownRefresh' | 'onReachBottom' | 'onPageScroll' | 'onShareAppMessage' | 'onResize' | 'onTabItemTap' | 'onShareTimeline' | 'onAddToFavorites' | 'onSaveExitState' | 'options' | '__geomUnbinds';
```

### `PageThis`

```ts
/**
 * 页面方法 this 类型（原生精确推导）
 *
 * 由 withPageStore 装饰器自动构造并注入方法签名，用户无需手动填写泛型参数。
 * 方法内 `this.data` 包含完整状态 + 映射的 state/getters（精确类型），
 * 映射的 action 以精确签名挂载到 this（参数/返回值类型不丢失）。
 *
 * 第 5 个泛型 `ExtraMethods` 是「同页自定义方法」的注入位点，默认 `object`（即不注入）：
 * `withPageStore` 目前正是按默认值实例化本类型的（见 #428 与 `PageOwnMethods` 的说明），
 * 所以页面方法内的 `this` 尚看不到自定义方法；接线需在集成层传 `PageOwnMethods<C>`。
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
export type PageThis<S extends State, A extends Actions, G extends Getters<S> = Getters<S>, M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>, ExtraMethods extends object = object> = InjectedDataShape<S, M, G> & ExtraMethods & ExtractMappedActions<A, M> & {
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
    /**
     * 通知期间新产生的脏键（重入写入）：回调内写入会触发下一轮通知，
     * 其脏键不能随本轮收尾一起清空，否则下一轮会被集成层当作「未变化」跳过
     */
    private _deferredDirtyKeys;
    /** 是否正在通知：决定脏键写入是否需要同时记入下一轮 */
    private _notifying;
    /** 是否仅在状态实际变化时通知（默认 false） */
    private _notifyOnlyOnChange;
    /** 状态变更计数器（脏跟踪：供 onlyOnChange 模式判断 dispatch 是否修改了状态） */
    private _mutationCount;
    /** Action 脏跟踪缓存（代理与原对象的双向映射；$replaceState 时重建） */
    private _dirtyProxyCache;
    /** Actions集合（公开） */
    actions: A;
    /** 插件集合（按本 Store 的状态类型约束，状态无关插件以 Plugin<State> 兼容） */
    private _plugins;
    /** 插件卸载函数集合 */
    private _pluginUninstallFns;
    /** 插件当前安装的代际令牌：卸载句柄据此识别自己是否仍对应最新一次安装 */
    private _pluginInstallations;
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
     *
     * @returns 深克隆后**部分冻结**的副本：纯对象与数组链上为深度只读，
     *   但经 Date/RegExp/Map/Set 或非纯对象（class 实例等）触达的节点仍是活的
     *   可变对象——`Readonly<S>` 只到类型层面，别把它当作深度不可变的保证。
     *   另注意 Date/RegExp 在克隆时总新建实例，别名关系不保留
     *   （详见 core/utils/clone.ts 的 deepCloneState 文档）
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
     * 亦可用于调试与运行时检查。允许在销毁后调用（只读，不抛错）。
     *
     * @remarks 销毁后返回的**不是空对象**：destroy() 不注销 getter 定义，
     *   这里给出的是初始化时登记的那份（`getter(name)` 则会在销毁后抛错，
     *   两者对「已销毁」的严格程度不同）。销毁后仍调用返回对象里的函数时，
     *   它会经 `store.state` 读到保留未释放的 `_state`——需要「销毁即失联」
     *   的语义请显式判 `store.destroyed`
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
    use(plugin: PluginType<NoInfer<S>> | PluginType<State>): () => void;
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
     *
     * 与其他写接口同口径拒绝销毁后调用：destroy() 已经重建过 Proxy 管理器，
     * 这里再改配置会把「已销毁」的 Store 拉回可变状态并白造一个新管理器。
     * 只读侧（isStateProtectionEnabled / getStateProtectionConfig）不在此列
     * @throws 如果 Store 已销毁
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
    /** Action 写入始终跟踪脏键；onlyOnChange 额外使用变更计数决定是否通知。 */
    private _getActionState;
    /**
     * 重建状态保护 Proxy 管理器（构造、$replaceState、setStateProtection 共用）。
     *
     * 强制新建 proxyCache：旧缓存中的 Proxy 闭包绑定旧状态对象树/旧 path，
     * 复用会让保护层指向已过期对象。
     */
    private _rebuildStateProxyManager;
    /** 创建允许写入的脏跟踪代理（实现已拆至 ./dirtyTracking.js）
     *
     *  onMutate 回调同时做两件事：
     *  1. 递增变更计数（onlyOnChange 判断 dispatch/batch 是否修改了状态）
     *  2. 标记受影响的顶层状态键（dirtyKeys）——action 直接变异嵌套对象/数组/Map/Set
     *     时不再只有计数、没有脏键，集成层的批量/脏过滤路径（isStateKeyDirty）才能跳过未变化映射
     */
    private _createDirtyTrackingProxy;
    /** 批量结束通知：onlyOnChange 模式下批量期间无任何变更则跳过（与 dispatch 收尾语义一致） */
    private _onBatchEnd;
    /** 调度一次状态通知（同步或异步合并，取决于 notify.async 配置） */
    private _scheduleNotify;
    /**
     * 标记与补丁键共享对象引用的其他顶层键
     *
     * `$patch` 的 deepMerge 会就地改写被补丁对象；若该对象同时被别的顶层键引用
     * （如 `state.current = state.list[0]`），那些键的内容同样变了却没有被标记，
     * 只映射它们的页面将永远看不到更新。仅在补丁值为对象时做可达性扫描，
     * 与 `$replaceState` 的「整树所有键视为已变更」相比只覆盖确实受影响的部分。
     */
    private _markAliasedKeys;
    /**
     * 判断某值可达对象中是否包含任一目标对象
     *
     * 迭代实现（与脏追踪代理的归属解析同口径）：不进入内建对象、不求值访问器，
     * 命中即提前返回。
     */
    private _reachesAny;
    /**
     * 标记状态键为脏
     *
     * 通知进行中（含回调内的重入写入）同时记入下一轮：那部分变更会触发新一轮通知，
     * 若只写当前集合，本轮收尾就会把它清掉，下一轮被集成层当作「未变化」跳过
     */
    private _markDirtyKey;
    /** 通知状态变化 */
    private _notifyListeners;
}
```

### `StoreOptions`

```ts
/**
 * Store 构造配置（显式泛型场景）
 * actions 使用 `ActionsWithThis<S, A>` 注入 `this` 类型。共享选项见 `StoreOptionsBase`。
 */
export interface StoreOptions<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> extends StoreOptionsBase<S> {
    /** Actions - 使用 ThisType 注入 this 类型 */
    actions?: ActionsWithThis<S, A>;
    /** Getters */
    getters?: G;
    /** 需要缓存的state键（为空时缓存所有） */
    cacheKeys?: Array<keyof S>;
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
     * 将多个Store实例批量注册到注册表中。整体语义为「全成功或全不注册」：
     * 先整体校验再写入，任一条目非法都会在改动注册表之前抛出，不会留下半注册状态
     *
     * @param {Record<string, Store>} stores - Store名称到实例的映射
     * @throws {Error} 任一名称或 store 无效（此时注册表未被修改）
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
 *
 * `store` 为 `Store | null`（根节点不绑定具体 Store）：树节点持有的就是本库的 Store 实例，
 * 原先写作 `any` 会让 `node.store.xxx` 的拼写错误与误用全部静默通过。
 */
export interface StoreTreeNode {
    name: string;
    store: Store | null;
    children?: Record<string, StoreTreeNode>;
}
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

### `composeStore`

```ts
/**
 * Store组合函数 - 类型安全重载
 * 支持完整的类型推断，保留原始 Store 的类型信息
 */
declare function composeStore<Stores extends readonly StoreLike[]>(stores: [...Stores], options?: ComposeOptions): Store<ExtractStates<Stores>, ExtractActions<Stores>, ExtractGetters<Stores>>;
```

### `createStore`

```ts
/**
 * 创建 Store 实例，支持完整的类型推断
 *
 * 独立于根入口存放，避免集成层（integrations）反向依赖根入口形成循环引用。
 *
 * @param options - Store 配置项，包含 state、actions、getters
 * @returns 返回新建的 Store 实例，类型完整推断
 *
 * @example
 * ```typescript
 * // ✅ 免泛型自动推导（推荐）：类型由字面量自动推断
 * const store = createStore({
 *   state: { count: 0, name: 'test' },
 *   actions: {
 *     // action 通过 this.state 读写状态，参数为调用时传入的用户参数
 *     increment() { this.state.count++ },
 *     add(n: number) { this.state.count += n }
 *   },
 *   getters: {
 *     double(state) { return state.count * 2 },
 *     greeting(state) { return `Hello, ${state.name}` }
 *   }
 * })
 *
 * // 类型推断：
 * store.dispatch('add', 10)      // 参数类型自动推断为 number
 * store.dispatch('increment')    // 无参数 action
 * const doubled = store.getter('double')  // 返回类型自动推断为 number
 * const msg = store.getter('greeting')    // 返回类型自动推断为 string
 * ```
 */
export declare function createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(options: FactoryStoreConfig<S, A, G>): Store<S, A, G>;

export declare function createStore<S extends State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(options: LiteralStoreConfig<S, A, G>): Store<S, A, G>;
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
 * 超深结构下告警**每次顶层比较只出第一条**（见 `depthWarningEmitted` 的注释），
 * 后续命中静默按同样的 false 语义处理，别让日志噪音掩盖真正的问题。
 *
 * 深度累加口径：所有跨容器边界（对象键、数组元素、Map 值、Set 元素）都算一层，
 * 同一 maxDepth 预算在整棵树上连续消耗，不会因穿过 Set 而重新计数。
 *
 * @param a - 第一个值
 * @param b - 第二个值
 * @param maxDepth - 最大递归深度（默认1000），超限时返回 false
 * @returns 是否相等。比较范围：原型一致 + 自有可枚举字符串键逐项（数组含 length）；
 *   symbol 键与不可枚举属性不参与比较（状态上的版本号标记即属此类，不应影响相等判定）
 *
 * @remarks **Map 的键按引用（SameValueZero）匹配，只有值做深度比较**——这是有意的
 *   窄口径（键的深匹配要解「一个键配多个候选」的匹配问题，超出本工具职责），
 *   对调用方是硬约束：两个 Map 若键集「结构相同但引用不同」（典型来源是反序列化、
 *   跨 store 克隆、JSON 往返后的对象键），即便内容完全等价也会判为不相等，
 *   表现为选择器/缓存永不命中而非报错。规避方式：Map 只用原始值（string/number）
 *   或跨比较稳定的同一引用作键，或把这类映射改建为以 key 字符串索引的普通对象。
 *   Set 则相反，元素按深度相等做无序配对，不受引用影响。
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

### `get`

```ts
/**
 * 通过路径获取对象值
 */
export declare function get<T = unknown>(obj: T, path: string, defaultValue?: unknown): unknown;
```

### `globalRegistry`

```ts
globalRegistry: StoreRegistry
```

### `identity`

```ts
/**
 * 返回参数的函数
 */
export declare function identity<T>(value: T): T;
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

### `noop`

```ts
/**
 * 空函数
 */
export declare function noop(): void;
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
 *
 * 语义边界：只有「双方都是纯对象」或「双方都是数组」时才按自有可枚举键逐项浅比较；
 * 其余对象（类实例、Error/URL/Promise/装箱原始值等）没有可信的浅层身份，
 * 要求引用相等。这类值本函数判不等（保守方向：最多让 createSelector 多做一次
 * 结果分发，不会把陈旧值当新值返回）。
 */
export declare function shallowEqual(a: unknown, b: unknown): boolean;
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
export declare function usePlugin<S extends State, A extends Actions, G extends Getters<S>>(plugin: Plugin<NoInfer<S>> | Plugin<State>, store: Store<S, A, G>): () => void;
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
export declare function withAppStore<S extends State, A extends Actions, G extends Getters<S>, O extends ConnectOptions<S, A, G>>(store: Store<S, A, G>, options?: O): <C extends AppOptions>(AppConfig: WithPageThis<C, AppThis<S, A, G, O, C>> & ThisType<AppThis<S, A, G, O, C>>) => C;
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
