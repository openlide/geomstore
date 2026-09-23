/**
 * GeomStore - 集成类型定义
 */

import type { State, Actions, Getters, Store, InferActionArgs, InferActionReturn } from './store.js'

// 重新导出供集成模块使用
export type { Actions } from './store.js'

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
  mapState?: readonly (keyof S)[] | Record<string, keyof S>
  /** 映射getters */
  mapGetters?: readonly (keyof G)[] | Record<string, keyof G>
  /** 映射actions（数组形式按 action 名映射；对象形式支持本地名重命名，值须为 action 名） */
  mapActions?: readonly (keyof A)[] | Record<string, keyof A>
  /** 是否自动注入到页面/组件data（使用getCached） */
  autoInject?: boolean
  /** 自动注入的字段映射（从store键到本地键）。为空对象时视为「没有注入条目」，与未写等价 */
  injectMapping?: Record<string, string>
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
  autoUpdateOnShow?: boolean
}

/**
 * 从映射数组提取状态类型
 *
 * 数组形式：`mapState: ['count', 'name']` → `{ count: number, name: string }`
 * 对象形式（别名映射）：`mapState: { myCount: 'count' }` → `{ myCount: number }`（值受 keyof S 约束，类型精确）
 *
 * `mapState` 可选且未声明时（`M` 为约束类型 `ConnectOptions<…>` 即此情形）其类型含 `undefined`，
 * `Extract<…, readonly unknown[]>` 会保留联合里的数组成员，于是「未声明」被当成「全量映射」，
 * 与 ExtractPageData 承诺的「未映射键带 | undefined」相反（编译通过、运行时 undefined）。
 * 故先排除未声明，返回 `object` 让 Partial<S> 的口径生效。
 */
type ExtractMappedState<
  S extends State = State,
  M extends { mapState?: readonly (keyof S)[] | Record<string, keyof S> } = { mapState?: readonly (keyof S)[] | Record<string, keyof S> },
> = undefined extends M['mapState']
  ? object
  : Extract<M['mapState'], readonly unknown[]> extends infer Arr
    ? [Arr] extends [never]
      ? Extract<M['mapState'], Record<string, keyof S>> extends infer R
        ? [R] extends [never]
          ? object
          : { [P in keyof R & string]: S[R[P] & keyof S] }
        : object
      : Arr extends readonly unknown[]
        ? { [P in Arr[number] & keyof S]: S[P] }
        : object
    : object

/**
 * 从映射数组提取计算属性类型
 *
 * 可选传入 `G`（Getters 类型）以获得精确返回值类型；
 * 未传时（默认 `Getters`）映射值收敛为 `unknown`
 */
type ExtractMappedGetters<
  M extends { mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey> } = { mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey> },
  G extends { [K: string]: (state: never) => unknown } = { [K: string]: (state: never) => unknown },
> = undefined extends M['mapGetters']
  ? object
  : Extract<M['mapGetters'], readonly PropertyKey[]> extends infer Arr
    ? [Arr] extends [never]
      ? Extract<M['mapGetters'], Record<PropertyKey, PropertyKey>> extends infer R
        ? [R] extends [never]
          ? object
          : { [P in keyof R & string]: ReturnType<G[Extract<R[P], keyof G>]> }
        : object
      : Arr extends readonly unknown[]
        ? { [P in Arr[number] & keyof G]: ReturnType<G[P]> }
        : object
    : object

/**
 * 从映射配置提取 actions 类型（精确签名）
 *
 * 数组形式：`mapActions: ['login', 'logout']` → `{ login: (...args) => R, logout: (...args) => R }`
 * 对象形式：`mapActions: { doLogin: 'login' }` → `{ doLogin: (...args) => R }`
 */
export type ExtractMappedActions<
  A extends Actions = Actions,
  M extends { mapActions?: readonly (keyof A)[] | Record<string, keyof A> } = { mapActions?: readonly (keyof A)[] | Record<string, keyof A> },
> = undefined extends M['mapActions']
  ? object
  : Extract<M['mapActions'], readonly unknown[]> extends infer Arr
    ? [Arr] extends [never]
      ? Extract<M['mapActions'], Record<string, keyof A>> extends infer R
        ? [R] extends [never]
          ? object
          : {
              [P in keyof R & string]: (...args: InferActionArgs<A, R[P] & keyof A>) => InferActionReturn<A, R[P] & keyof A>
            }
        : object
      : Arr extends readonly unknown[]
        ? { [P in Arr[number] & keyof A]: (...args: InferActionArgs<A, P>) => InferActionReturn<A, P> }
        : object
    : object

/**
 * 从 ConnectOptions 提取完整的页面 data 类型
 *
 * 类型契约（严格）：
 * - `Partial<S>`：全部状态键均可访问，但未映射的键运行时不一定存在，故其类型为
 *   `T | undefined`，强制调用方判空，避免静默拿到 undefined。
 * - 已映射键（`ExtractMappedState` / `ExtractMappedGetters`）经交集收窄仍保持精确类型：
 *   `Partial<T> & T` 等于 `T`，故 Partial 不会削弱映射键。**这只在两侧键不相交时成立**，
 *   见下一条。
 * - 同一个本地键被 `mapState` 与 `mapGetters` 同时映射时，取值以 **getter 为准**：
 *   两侧写的是同一个本地键命名空间（页面/组件走 `setData`，App 走 `writeGlobalData`，
 *   见 `with-store.ts` / `with-app-store.ts` 的 `onLoad` / `onLaunch`），且绑定顺序固定是
 *   state 先、getters 后，后写的 getter 覆盖前写的 state。
 *   故 `Partial<S>` 与 `ExtractMappedState` 两侧的撞名键都被 `Omit` 掉——直接求交会得到
 *   `number & string` 即 `never`，那个键编译期读不出任何值，运行期却好好放着 getter 的结果
 *   （`Partial<S>` 那一份也要剔：getter 名恰好是状态键时，即使没写进 `mapState`，
 *   它同样覆盖 `T | undefined` 那份兜底形状）。
 *   这不是「撞名被禁止」：类型按运行时给，但两份来源本就互斥，需要 state 原值时请换本地别名。
 * - 不提供索引签名：拼错的键会直接编译报错，而非静默返回 `unknown`。
 *   data 上的动态键请在页面/应用的 `data`（或 `globalData`）字面量中显式声明；
 *   运行时的动态写入走 `setData`，它本来就接受 `Record<string, unknown>`。
 */
export type ExtractPageData<
  S extends State,
  M extends { mapState?: readonly (keyof S)[] | Record<string, keyof S>; mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey> },
  G extends Getters<S> = Getters<S>,
> = Omit<Partial<S>, keyof ExtractMappedGetters<M, G>> & Omit<ExtractMappedState<S, M>, keyof ExtractMappedGetters<M, G>> & ExtractMappedGetters<M, G>

/**
 * 页面/组件实例上「由集成层注入的框架成员」基类型（#429）
 *
 * `data` 与 `setData` 此前在 `PageThis` / `ComponentThis` 两处逐字重复，任一处单独改动都会
 * 让两侧漂移，而漂移的表现正是本文件反复防范的那类错误：类型声明出运行时不存在的成员
 * （或漏掉确实注入了的成员），编译通过、运行时炸。
 *
 * **只服务实例视角**（#R6-063）：本基类型带着必选的 `setData`，因为只有页面/组件**实例**
 * 上框架才恒有 `setData`。配置视角见 {@link InjectedConfigDataShape}——把两侧共用一份基类型时，
 * 「配置对象上有 setData」这种谎会顺着复用直接传播到 `withPageStore` 的返回类型上。
 *
 * `getTabBar` 不在基类型里：它只出现在页面侧的两个类型上（组件侧原本就没声明）。
 * 本类型刻意不导出——它是内部的去重手段，不是公开契约面；公开面仍是那四个类型。
 */
type InjectedDataShape<
  S extends State,
  M extends { mapState?: readonly (keyof S)[] | Record<string, keyof S>; mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey> },
  G extends Getters<S> = Getters<S>,
> = {
  /** 注入/合并后的 data：映射的 state + getters（口径见 {@link ExtractPageData}） */
  data: ExtractPageData<S, M, G>
  /** 框架的 setData：实例上恒可用（本库不改其语义，全库也只经 `this.setData` 写状态） */
  setData: (data: Record<string, unknown>, callback?: () => void) => void
}

/**
 * 配置对象视角的 `data`（#R6-063，与实例视角 {@link InjectedDataShape} 拆开）
 *
 * 差在**不声明 `setData`**：`withPageStore` / `withComponentStore` 返回的是
 * `enhancedConfig = { ...用户配置 }` 这一份浅拷贝，整条链路上只在生命周期里调
 * `this.setData(...)`，从不往配置对象上写 `setData`。同文件的内部类型本来就分了两档
 * （`with-store.ts:34` 与 `:85` 的 `setData?` 可选、`:48` 与 `:96` 的实例侧必选，
 * 注释写明「配置对象侧 setData 可选，故实例侧用交叉类型收敛为必选」），
 * 而基类型曾把必选版复用给配置视角，于是
 * `const cfg = withPageStore(store, { mapState: ['count'] })({ data: {} }); cfg.setData({ count: 1 })`
 * 编译通过、运行时 `TypeError`。现在配置对象上没有这个成员，调用点直接编译报错；
 * 用户在配置字面量里自己声明了 `setData` 时，它仍按原样从 `C` 保留。
 *
 * `data` 沿用 {@link ExtractPageData} 口径，但请读清它描述的是**实例** data 的形状：
 * 配置对象上的 `data` 运行时只是用户字面量的浅拷贝，映射键要等 `onLoad` / `attached`
 * 才经 `setData` 写进实例，故 `cfg.data.count` 在装饰器返回的那一刻读到的是 `undefined`。
 * 把这一项也收成真·用户字面量 `D`（返回类型里的 `C extends { data: infer D }`）
 * 需要改 `src/integrations/with-store.ts` 的两处返回类型，不在本分片，已记 NEEDS-MAIN。
 */
type InjectedConfigDataShape<
  S extends State,
  M extends { mapState?: readonly (keyof S)[] | Record<string, keyof S>; mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey> },
  G extends Getters<S> = Getters<S>,
> = {
  /** 实例 data 的口径（映射的 state + getters）；配置对象上运行时只有用户字面量，见上方说明 */
  data: ExtractPageData<S, M, G>
}

/**
 * 组件 `methods` 命名空间的形状（#429）
 *
 * `ComponentThis` 与 `ComponentConfig` 都声明同一个 `ExtraMethods & ExtractMappedActions<A, M>`，
 * 差别只在这个键出现在实例的顶层与配置对象里各一次（微信会把 methods 条目提升到实例）。
 */
type ComponentMethodsShape<ExtraMethods extends object, A extends Actions, M extends { mapActions?: readonly (keyof A)[] | Record<string, keyof A> }> = {
  /** 配置对象上的 methods 命名空间（微信 Component 写法）；组件实例上这些条目会被提升为顶层方法 */
  methods: ExtraMethods & ExtractMappedActions<A, M>
}

/**
 * 方法 this 重写映射类型
 *
 * 将配置对象中所有函数属性的 this 参数重写为 T，非函数属性（含 data）保持原样不变。
 * 仅用于装饰器入参，使方法内 this 自动获得精确类型推导（含 data、actions、自定义方法），
 * 且不改变对象结构类型，从而仍满足 PageOptions / ComponentOptions 约束。
 */
export type WithPageThis<C, T> = {
  [K in keyof C]: C[K] extends (...args: infer P) => infer R ? (this: T, ...args: P) => R : C[K]
}

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
 * - `onRouteDone`：页面路由切换完成（基础库 2.31.0+）
 * - `options`：页面级配置项（非函数，但同样是框架键，不应被当作自定义方法）
 *
 * 清单按基础库的 Page 事件表逐项维护，新增/删除键要同步 `tests/types/integration-types.typecheck.ts`
 * 的 `PageCfgShape` 夹具——那里有「每个保留键都被夹具覆盖一次」的断言兜着（本清单没有运行时代码可校验）。
 * 漏收一个键的后果目前只在直接使用 `PageOwnMethods` 的调用方身上显形（`withPageStore` 还没把它接进
 * `PageThis` 的 `ExtraMethods`，见 #428），接线之后就是页面 `this` 上多出一个被剥掉 `this` 的假自定义方法。
 */
export type PageReservedKeys =
  | 'data'
  | 'setData'
  | 'onLoad'
  | 'onShow'
  | 'onHide'
  | 'onUnload'
  | 'onReady'
  | 'onPullDownRefresh'
  | 'onReachBottom'
  | 'onPageScroll'
  | 'onShareAppMessage'
  | 'onResize'
  | 'onTabItemTap'
  | 'onShareTimeline'
  | 'onAddToFavorites'
  | 'onSaveExitState'
  | 'onRouteDone'
  | 'options'
  | '__geomUnbinds'

/**
 * 从 Page 配置提取用户自定义方法（排除保留键，方法 this 不检查以避免循环兼容性）
 *
 * 现状（#428）：`withPageStore` 目前实例化的是 `PageThis<S, A, G, O>`，**没有**把本映射作为
 * 第 5 个泛型 `ExtraMethods` 传进去（组件侧 `withComponentStore` 则确实传了 `ComponentOwnMethods<C>`），
 * 故页面方法内的 `this` 暂时看不到同页自定义方法。保留键清单见 `PageReservedKeys`。
 * 与 Component 对齐的接线在集成层（`src/integrations/with-store.ts`），不在类型层。
 */
export type PageOwnMethods<C> = {
  [K in keyof Omit<C, PageReservedKeys>]: C[K] extends (...args: infer P) => infer R ? (...args: P) => R : C[K]
}

/**
 * 从 Component 配置提取用户自定义方法对象（C.methods）
 * Component 自定义方法在 methods 命名空间内，直接提取
 */
export type ComponentOwnMethods<C> = C extends { methods: infer M } ? (M extends Record<string, unknown> ? M : object) : object

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
export type PageThis<
  S extends State,
  A extends Actions,
  G extends Getters<S> = Getters<S>,
  M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>,
  ExtraMethods extends object = object,
> = InjectedDataShape<S, M, G> &
  ExtraMethods &
  ExtractMappedActions<A, M> & {
    getTabBar?: () => { syncSelectedTab?: () => void } | undefined
  }

/**
 * 页面增强配置的形状（`withPageStore` 的返回类型）
 *
 * 与 `PageThis` 的分工：`PageThis` 描述**方法内的 `this`**（含映射 action，注入于页面实例），
 * 本类型描述**装饰器返回的配置对象**——注入的 action 运行时绑定在实例上、并不存在于配置对象，
 * 故这里不含 action；`setData` 同理（#R6-063：框架只在实例上提供它，配置对象是用户字面量的
 * 浅拷贝，见 {@link InjectedConfigDataShape}）。
 *
 * 读法约定：本类型的 `data` 是**实例 data** 的口径（映射值并入后的形状），
 * 不代表「在装饰器返回的那一刻就能从配置对象上读到」——那时映射还没跑，读到的会是 `undefined`。
 *
 * 之所以拆开：把「实例视角」直接当作「配置视角」会让返回类型声明出运行时并不存在的成员
 * （例如 `config.increment()` 能通过编译却在运行时失败）。
 */
export type PageConfig<
  S extends State,
  M extends { mapState?: readonly (keyof S)[] | Record<string, keyof S>; mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey> } = ConnectOptions<
    S,
    Actions,
    Getters<S>
  >,
  G extends Getters<S> = Getters<S>,
> = InjectedConfigDataShape<S, M, G> & {
  getTabBar?: () => { syncSelectedTab?: () => void } | undefined
}

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
export type ComponentThis<
  S extends State,
  A extends Actions,
  G extends Getters<S> = Getters<S>,
  M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>,
  ExtraMethods extends object = object,
> = InjectedDataShape<S, M, G> & ExtraMethods & ExtractMappedActions<A, M> & ComponentMethodsShape<ExtraMethods, A, M>

/**
 * 组件增强配置的形状（`withComponentStore` 的返回类型）
 *
 * 与 `ComponentThis` 的分工：配置对象上的注入 action 位于 `methods` 内（集成层确实把它们
 * 合并进 `config.methods`，再由微信提升到实例），故这里不在顶层重复声明——否则返回类型会
 * 声明出配置对象上并不存在的顶层方法（`config.add()` 能编译却在运行时失败）。
 *
 * 同样不声明 `setData`（#R6-063），`data` 的读法约定见 {@link InjectedConfigDataShape}。
 */
export type ComponentConfig<
  S extends State,
  A extends Actions,
  G extends Getters<S> = Getters<S>,
  M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>,
  ExtraMethods extends object = object,
> = InjectedConfigDataShape<S, M, G> & ComponentMethodsShape<ExtraMethods, A, M>

/**
 * Component 配置的 this 注入类型
 *
 * 与 WithPageThis 的差别：Component 的用户方法与生命周期嵌套在 `methods` / `lifetimes` /
 * `pageLifetimes` 命名空间内，而 `ThisType<T>` 只作用于**它所标注的那个对象字面量**——
 * 挂在配置顶层不会下传到嵌套字面量。因此这里把标记挂到各命名空间本身。
 *
 * 用「与 `C` 交叉」而不是把 `C` 映射一遍：映射写法会让 `C` 的推断退化
 * （`lifetimes` 等成员丢失，调用方拿到的增强配置类型不再保留原成员）。
 */
export type WithComponentThis<C, T> = C & {
  methods?: ThisType<T>
  lifetimes?: ThisType<T>
  pageLifetimes?: ThisType<T>
}

/**
 * `exposeStoreAPI` 注入的调试方法本体（不含 `store` 自身）
 *
 * 运行时这五个方法只定义一次（`integrations/utils.ts` 的 `api` 字面量），既逐个展平到宿主实例，
 * 又整份挂到 `__store__` 别名上（同一对象），故这里声明一次、两侧共用，避免两个入口的形状漂移。
 *
 * 刻意不导出：与 `InjectedDataShape` 同理，公开面是 {@link HostStoreApi}；成员名要能被
 * `keyof HostStoreApi<S>` 数到（`AppThis` 用它把撞名 action 让位给调试 API）。
 */
interface HostStoreDebugApi<S extends State = State> {
  getStore(): Store<S>
  getState(): S
  getCached<K extends keyof S>(key: K): S[K]
  dispatch(actionName: string, ...args: unknown[]): unknown
  /**
   * 订阅状态变化（默认按只读订阅登记，与 `exposeStoreAPI` 的实现一致：
   * 未传 options 时补 `{ readOnly: true }`，避免翻转 Store 的全局 needsClone 判定）。
   * 确需就地改载荷的调用方显式传 `{ readOnly: false }`。
   */
  subscribe(callback: (state: S) => void, options?: { readOnly?: boolean }): () => void
}

/**
 * 集成层挂到宿主实例上的 Store 调试 API
 *
 * 由 integrations/utils.ts 的 exposeStoreAPI 注入（App 集成中使用）：
 * `store`、五个调试方法与 `__store__` 别名共七个键，逐个经 `canOwnKey` 判定后用
 * `defineOwnValue`（`Object.defineProperty`）写入——**不是无条件覆写**：
 * 能重写的宿主成员才被覆盖（卸载按原描述符整体回放），
 * 不可重定义的键跳过整批注入中的这一项，并汇总一条
 * `[exposeStoreAPI] 宿主成员 "x" 不可重定义，已跳过暴露` 告警。
 */
export interface HostStoreApi<S extends State = State> extends HostStoreDebugApi<S> {
  /** Store 实例 */
  store: Store<S>
  /** 上面五个调试方法的第二份挂载点（调试入口），运行时与展平成员是同一个对象 */
  readonly __store__: HostStoreDebugApi<S>
}

/**
 * App 方法 this 类型（原生精确推导）
 *
 * 运行时注入（见 with-app-store.ts）：映射的 state / getters 写入 `this.globalData`，
 * 映射的 action（bindActions）与 exposeStoreAPI 的调试方法直接挂在 App 实例上。
 * 交叉 `Extra`（调用处传入用户配置类型 C）以保留 `globalData` 的自定义字段。
 *
 * 名字撞车时谁赢：`onLaunch` 先 `bindActions`（with-app-store.ts:242）后 `exposeStoreAPI`
 * （同文件 :251，二者在同一个 try 块内按此顺序）。exposeStoreAPI 的七个键逐个经 `canOwnKey`
 * 判定、再用 `defineOwnValue` 以 `Object.defineProperty` 写入（utils.ts；键集合与值同源于那张
 * `members` 表，已无 `exposedKeys` 常量、也不再是 `Object.assign`），卸载时按**原描述符整体回放**
 * （访问器成员不会被降级成数据属性），而不是「还原原值」。因此：
 * - 宿主该键可重写（含同名 action 刚写入的那份）→ 留下的是调试 API。所以 action 名恰为
 *   `store` / `getStore` / `getState` / `getCached` / `dispatch` / `subscribe` / `__store__`
 *   之一时，实例上读到的仍是调试 API，本类型据此让映射 action 避让（`Omit` 掉
 *   `keyof HostStoreApi<S>`），`HostStoreApi<S>` 保持完整。
 * - 宿主该键**不可重定义**（非 configurable 且非 writable，或宿主被 seal/freeze）→ 两侧都留不下，
 *   只剩一条 `[exposeStoreAPI] 宿主成员 "x" 不可重定义，已跳过暴露` 告警；
 *   此时 `bindActions` 那份也有自己的同判据跳过分支（utils.ts 的
 *   `[bindActions] 宿主成员 "x" 不可重定义…已跳过 action "y" 的绑定`）。
 *   「撞名一定留下调试 API」只在该键可重写时成立，别把它当无条件保证。
 * 此前两侧直接求交，同名成员变成
 * 函数交叉（重载集）：`this.getState()` 会解析到先声明的那个签名，调用方拿到的返回类型与运行时
 * 实际值不符。反过来 Omit 调试 API 既与运行时相反，又会把 `getCached<K extends keyof S>` 这种带泛型的
 * 成员经过一次映射类型（精度另有一次损失风险）。
 *
 * `globalData` 一并加入避让清单，但方向相反：它是 `bindActions` 的**受害者**而非赢家
 * （宿主 `globalData` 上的该键通常可重写，于是 `onLaunch` 刚写进去的映射 state/getters
 * 会整包被那个函数顶掉，只剩一个可调用的 action；该键不可重定义时 `bindActions` 改为跳过并告警，
 * 顶掉不成立、action 也没绑上）。
 * 求交写法会把这种踩雷同时声成两种形状：`this.globalData()` 与 `this.globalData.count`
 * 都能编译，前者才符合运行时——即本文件反复防范的「声明成员与运行时值不符」。
 * 类型侧只保留数据形状（`this.globalData()` 报错），运行时另有 `bindActions` 的
 * 「宿主已有成员将被覆盖」告警；本地名请改用别名形式避开：`mapActions: { setGlobalData: 'globalData' }`。
 */
export type AppThis<
  S extends State,
  A extends Actions,
  G extends Getters<S> = Getters<S>,
  M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>,
  Extra extends object = object,
> = Extra & {
  globalData: ExtractPageData<S, M, G>
} & Omit<ExtractMappedActions<A, M>, keyof HostStoreApi<S> | 'globalData'> &
  HostStoreApi<S>
