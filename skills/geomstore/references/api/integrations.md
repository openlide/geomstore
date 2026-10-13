# `./integrations` API 参考（自动生成）

> **本文件由 `scripts/generate-skill-api-reference.mjs` 从 `dist/**/*.d.ts` 生成，请勿手工编辑。**
>
> - 来源版本：`@openlide/geomstore@0.8.3`
> - 内容来源：构建产物类型声明（随 npm 包发布，与安装版本必然一致）
> - 重新生成：`pnpm build && pnpm skill:api`
> - 引入路径：`./integrations`
> - 类型声明：`./dist/integrations/index.d.ts`
> - 返回索引：[`index.md`](./index.md)

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
    /** 自动注入的字段映射（从store键到本地键）。为空对象时视为「没有注入条目」，与未写等价 */
    injectMapping?: Record<string, string>;
    /**
     * 是否在页面 `onShow` / 组件 `pageLifetimes.show` / App `onShow` 时按 `getCached` 重新注入一次。
     *
     * 生效条件（三者同时，缺一即整项无效且**不会告警**，#R6-062）：
     * `autoUpdateOnShow && autoInject && Object.keys(injectMapping).length > 0`
     * —— 见 `with-store.ts` 的 page/component 两处判定与 `with-app-store.ts:267`，
     * 只写本项（或把 `injectMapping` 给成 `{}`）时连包装器都不安装。
     *
     * 挂载点口径（旧文案在此处有三处偏差，已按实现改写）：
     * - 页面：`onShow`（首次注入仍在 `onLoad`）
     * - 组件：`pageLifetimes.show`——组件配置上的 `onShow` **不是**组件生命周期，
     *   框架不会调用它；`attached` 是首次注入点（等价于页面的 `onLoad`），不是本项的挂载点
     * - App：`onShow`（`onLaunch` 是首次注入点；`globalData` 尚未建立时只转发用户 `onShow`）
     */
    autoUpdateOnShow?: boolean;
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

### `exposeStoreAPI`

```ts
/**
 * 暴露 Store API 到目标实例
 *
 * 在 App 实例上暴露常用的 Store API 方法，同时挂一份到 `__store__` 调试入口。
 * 注入按自有属性写入：返回的清理函数只移除本次新增的成员，宿主同名自有成员
 * 按其**原描述符**还原（访问器不会在还原后变成数据属性）；
 * 不可重定义的宿主成员（frozen / 非 configurable）跳过并汇总告警，不中断其余键
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

### `parseMapping`

```ts
/**
 * 解析映射配置，返回统一的键值对映射
 *
 * 支持数组形式和对象形式的映射配置：
 * - 数组: ['key1', 'key2'] → { key1: 'key1', key2: 'key2' }
 * - 对象: { local: 'store' } → { local: 'store' }
 *
 * 键与值均经 String() 归一（类型层面接受 PropertyKey，实际状态键均为字符串）
 *
 * @param mapping - 映射配置（数组或对象）
 * @returns 统一格式的键值对映射（新建对象，与入参不共享引用）
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
 * 根据注入映射，将 Store 缓存的值自动注入到目标对象。
 * 无缓存（含值本身为 undefined）的源键不注入并汇总告警：Store 只暴露 getCached、
 * 未提供 hasCached，无法区分「未缓存」与「值确为 undefined」，
 * 静默跳过会让宿主数据与注入映射长期不一致且无从排查
 *
 * @template S - 状态类型
 * @param target - 目标对象
 * @param injectMapping - 注入映射（源键 → 目标键）
 * @param store - Store 实例
 * @param setter - 设置值的函数（收到全部注入项的批量载荷；目标键由用户配置，
 *   可能含 `'__proto__'`，宿主侧写入需保持自有属性语义）
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

### `withAppStore`

```ts
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
 * 订阅生命周期与绑定失败的回滚口径同 withPageStore：按组件实例登记 `__geomUnbinds`、
 * detached 统一清理，attached 重入时先清理旧订阅
 *
 * action 绑定与组件自身 `methods` 同名时同 Page/App 侧 bindActions：一条覆盖告警 +
 * detached 恢复原值（映射的 action 在绑定期间始终优先，与 Page 一致）
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
export declare function withComponentStore<S extends State, A extends Actions, G extends Getters<S>, O extends ConnectOptions<S, A, G>>(store: Store<S, A, G>, options?: O): <C extends ComponentOptions>(componentConfig: WithComponentThis<C, ComponentThis<S, A, G, O, ComponentOwnMethods<C>>>) => ComponentConfig<S, A, G, O, ComponentOwnMethods<C>> & Omit<C, 'data' | 'methods'> & {
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
 * 订阅生命周期：绑定按页面实例登记在 `this.__geomUnbinds`，onUnload 统一清理；
 * onLoad 被重复调用时先清理旧订阅再重绑，绑定阶段抛错则回滚本次订阅并把错误抛回框架
 * （不转发用户 onLoad：映射未就绪的实例上跑用户逻辑只会产出第二个更难归因的错误）
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
export declare function withPageStore<S extends State, A extends Actions, G extends Getters<S>, O extends ConnectOptions<S, A, G>>(store: Store<S, A, G>, options?: O): <C extends PageOptions>(pageConfig: WithPageThis<C, PageThis<S, A, G, O>> & {
    data: object;
} & ThisType<PageThis<S, A, G, O>>) => PageConfig<S, O, G> & Omit<C, "data"> & {
    data: (C extends {
        data: infer D;
    } ? D : object) & ExtractPageData<S, O, G>;
};
```
