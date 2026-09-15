# `./integrations` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.5.0`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`./integrations`
> - 类型声明：`./dist/integrations/index.d.ts`
> - 返回索引：[`index.md`](./index.md)

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
