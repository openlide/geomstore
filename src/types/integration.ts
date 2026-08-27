/**
 * GeomStore v1.0.0 - 集成类型定义
 */

import type { State, Actions, Getters, InferActionArgs, InferActionReturn } from './store'

// 重新导出供集成模块使用
export type { Actions } from './store'

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
  /** 自动注入的字段映射（从store键到本地键） */
  injectMapping?: Record<string, string>
  /** 是否在页面onShow/组件attached时更新注入（默认仅在onLoad时） */
  autoUpdateOnShow?: boolean
}

/**
 * 从映射数组提取状态类型
 *
 * 数组形式：`mapState: ['count', 'name']` → `{ count: number, name: string }`
 * 对象形式（别名映射）：`mapState: { myCount: 'count' }` → `{ myCount: number }`（值受 keyof S 约束，类型精确）
 */
export type ExtractMappedState<
  S extends State = State,
  M extends { mapState?: readonly (keyof S)[] | Record<string, keyof S> } = { mapState?: readonly (keyof S)[] | Record<string, keyof S> },
> =
  Extract<M['mapState'], readonly unknown[]> extends infer Arr
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
export type ExtractMappedGetters<
  M extends { mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey> } = { mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey> },
  G extends { [K: string]: (state: never) => unknown } = { [K: string]: (state: never) => unknown },
> =
  Extract<M['mapGetters'], readonly PropertyKey[]> extends infer Arr
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
> =
  Extract<M['mapActions'], readonly unknown[]> extends infer Arr
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
 * 类型契约（有意宽松）：交叉 `S` 使方法内可访问全部状态键，覆盖
 * autoInject 注入、页面 data 手动声明同名初始值等场景；仅按需映射时，
 * 未映射键运行时并不一定存在于 data 中，直接访问得到 undefined。
 * 需要「仅映射键」的严格类型请改用 ExtractMappedState。
 */
export type ExtractPageData<
  S extends State,
  M extends { mapState?: readonly (keyof S)[] | Record<string, keyof S>; mapGetters?: readonly PropertyKey[] | Record<string, PropertyKey> },
  G extends Getters<S> = Getters<S>,
> = S & ExtractMappedState<S, M> & ExtractMappedGetters<M, G>

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
 * Page 保留键（框架生命周期 + 内部字段），不参与自定义方法提取
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
  | '__geomUnbinds'

/**
 * Component 保留键（框架生命周期 + 内部字段），不参与自定义方法提取
 */
export type ComponentReservedKeys =
  'data' | 'setData' | 'methods' | 'properties' | 'lifetimes' | 'pageLifetimes' | 'observers' | 'relations' | 'externalClasses' | 'options' | '__geomUnbinds'

/**
 * 从 Page 配置提取用户自定义方法（排除保留键，方法 this 不检查以避免循环兼容性）
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
export type PageThis<
  S extends State,
  A extends Actions,
  G extends Getters<S> = Getters<S>,
  M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>,
  ExtraMethods extends object = object,
> = {
  data: ExtractPageData<S, M, G>
} & ExtraMethods &
  ExtractMappedActions<A, M> & {
    setData: (data: Record<string, unknown>, callback?: () => void) => void
    getTabBar?: () => { syncSelectedTab?: () => void } | undefined
  }

/**
 * 组件方法 this 类型（原生精确推导）
 *
 * 与 PageThis 语义一致，由 withComponentStore 装饰器自动构造并注入。
 * Component 的自定义方法与 actions 均在 methods 命名空间内（与微信官方 Component API 一致）。
 */
export type ComponentThis<
  S extends State,
  A extends Actions,
  G extends Getters<S> = Getters<S>,
  M extends ConnectOptions<S, A, G> = ConnectOptions<S, A, G>,
  ExtraMethods extends object = object,
> = {
  data: ExtractPageData<S, M, G>
  methods: ExtraMethods & ExtractMappedActions<A, M>
} & {
  setData: (data: Record<string, unknown>, callback?: () => void) => void
}
