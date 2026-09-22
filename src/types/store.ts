import type { Plugin, IHookSystem } from './plugin.js'

/**
 * GeomStore - Store类型定义
 * 采用 ThisType 方案消除循环依赖
 */

/**
 * 状态类型
 * 使用宽松对象约束，既兼容 Record<string, unknown> 的索引签名写法，
 * 也允许未声明索引签名的业务 interface 直接作为 State 类型自动推断。
 */
export type State = object

/**
 * 解析 State 类型
 * 将 `() => S` 工厂函数形式解析为返回的对象类型 `S`；
 * 普通对象字面量原样返回。用于支持 `state: () => ({...})` 工厂写法。
 *
 * `any[]` 是必要写法（不是偷懒）：这里的 `(...args: any[]) => infer R` 只做**形状匹配**，
 * 需要同时命中 0..n 元、任意形参类型的工厂，且不参与任何调用点的形参检查。
 * 换成 `unknown[]` 会因参数逆变而漏掉带形参的工厂（实测 `(seed: number) => { count: number }`
 * 不匹配 `(...args: unknown[]) => infer R`，`ResolveState` 于是原样返回函数类型，
 * `StoreConfig.getters` 等下游拿到的 state 形状整体走偏）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ResolveState<T> = T extends (...args: any[]) => infer R ? R : T

/**
 * 解析后的状态类型（`ResolveState` + 归一化）
 *
 * `state: () => ({...})` 工厂写法下 `S` 会被推断成函数类型，`ResolveState` 取其返回值；
 * 归一不到 `State`（如 `S = unknown` 的裸配置）时退回 `State`。
 * 该表达式此前在 actions / getters / cacheKeys 三处逐字复制（#421），任一处调整都要改三遍。
 */
export type ResolvedState<S> = ResolveState<S> extends State ? ResolveState<S> : State

/**
 * Action 上下文运行时基础结构 - 包含 Store 核心方法
 * 不包含 actions，避免循环依赖
 *
 * 注意：`dispatch` 仅为运行时 contextBase 的转发字段（ActionManager 绑定
 * action 的 `this.dispatch` 时经 Proxy 转发到 store.dispatch），保留宽松签名。
 * action 内部 `this.dispatch` 的类型安全版本由 `ActionContext` 提供，
 * 故此处通过 `Omit<ActionContextBase, 'dispatch'>` 排除，避免宽松签名
 * 在交叉类型中优先于泛型重载被解析（架空类型安全）。
 */
export interface ActionContextBase<S extends State = State> {
  /** Store 名称 */
  readonly name: string
  /** 状态访问器 */
  readonly state: S
  /** 设置单个状态值 */
  setState<K extends keyof S>(key: K, value: S[K]): void
  /** 批量更新状态 */
  $patch(partialState: Partial<S>): void
  /** 替换整个状态（支持对象或工厂函数：`() => ({...})`） */
  $replaceState(newState: S | (() => S)): void
  /** 获取状态值 */
  getState(): S
  /** 动态 dispatch（运行时 contextBase 转发字段，见上方说明） */
  dispatch(actionName: string, ...args: unknown[]): unknown
}

/**
 * Action 上下文类型 - action 方法中 this 的类型
 * 通过合并 A 类型实现直接访问其他 action
 *
 * `dispatch` 仅提供类型安全泛型重载（编译期校验 action 名与参数），
 * 不提供字符串兜底；动态 dispatch 场景请改用外部 `store.dispatch(actionName, ...)`。
 *
 * 与用户 action 同名的基础成员要**先从基座里剔掉**再交叉（#423）：交叉不会「覆盖」，
 * 同名成员会变成 `state: S & Fn` / `setState: BaseSig & UserSig` 这种重载/交叉体，
 * `this.state`、`this.setState` 解析到哪一个不确定，且会盖掉类型安全的 `dispatch` 重载。
 * 剔除只在 A 是**具体 action 集合**时进行：`Actions`（`Record<string, ...>`）的 `keyof A`
 * 是 `string | number`，无条件 `Omit<..., keyof A>` 会把基座整体清空（实测 action 内
 * `this.state` / `this.$patch` 全变 TS2339），故用 `ActionCollisionKeys` 放过索引签名。
 */
type ActionCollisionKeys<A extends Actions> = string extends keyof A ? never : keyof A

export type ActionContext<S extends State = State, A extends Actions = Actions> = Omit<ActionContextBase<S>, 'dispatch' | ActionCollisionKeys<A>> &
  A & {
    /** 类型安全的跨 action 调用（action 内 this.dispatch），仅接受已声明的 action 名称 */
    dispatch<K extends keyof A>(actionName: K, ...args: InferActionArgs<A, K>): InferActionReturn<A, K>
  }

/**
 * Actions 类型约束
 * 用于约束 actions 参数类型
 *
 * 两个 `any` 都是必要的（实测改 `unknown` 即破功）：本类型是「任意 action 集合」的**约束位点**，
 * 参数逆变会让 `(id: string) => void` 这类具体 action 不再满足 `(...args: unknown[]) => unknown`，
 * 返回值逆变会拒掉返回具体值的 async action；协变/逆变两侧都要放行，只能是 `any`。
 * 精确签名由 `InferActionArgs` / `InferActionReturn` 在具体 A 上恢复，`Actions` 从不出现在调用点。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Actions = Record<string, (...args: any[]) => any>

/**
 * 创建带 ThisType 的 Actions 类型
 * 这是方案3的核心：通过 ThisType 注入 this 类型
 */
/**
 * Actions + `ThisType` 注入
 *
 * 导出原因：`StoreOptions.actions` 的类型就是它，消费者要写「带 this 上下文的一组 action」
 * 的公共默认值/包装器时得能命名这个形状（此前只有 `StoreOptions` 可见，成员类型不可命名）。
 */
export type ActionsWithThis<S extends State, A extends Actions> = A & ThisType<ActionContext<S, A>>

/**
 * Getters类型 - 支持类型推断
 */
export type Getters<S extends State = State> = {
  [K: string]: (state: S) => unknown
}

// ==================== 类型推断工具 ====================

/**
 * 推断Action参数类型
 */
export type InferActionArgs<A extends Actions, K extends keyof A> = A[K] extends (...args: infer Args) => unknown ? Args : never

/**
 * 推断Action返回类型
 */
export type InferActionReturn<A extends Actions, K extends keyof A> = A[K] extends (...args: never[]) => infer R ? R : never

/**
 * 推断Getter返回类型
 *
 * 约束里的 `any` 必要：getter 以**具体状态类型**声明形参（`(state: UserState) => number`），
 * 参数逆变下 `state: State` / `state: unknown` 的约束会直接拒掉这类 getter；
 * 返回值同理需放行任意形状。此处只做提取，精确返回类型仍由 `infer R` 从具体 G 得到。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InferGetterReturn<G extends Record<string, (state: any) => any>, K extends keyof G> = G[K] extends (...args: never[]) => infer R ? R : never

/**
 * 从 Actions 类型提取所有 action 名称
 */
export type ActionNames<A extends Actions> = keyof A & string

// ==================== 免泛型自动推导支持 ====================

/**
 * 状态监听器
 */
export type StateListener<S extends State = State> = (state: S) => void

/**
 * 状态保护配置
 */
export interface StateProtectionOptions {
  /** 是否启用状态保护（默认 true） */
  enabled?: boolean
  /** 是否启用深层保护（递归保护嵌套对象，默认 true） */
  deep?: boolean
  /** 生产模式下非法修改的处理方式（默认 'warn'） */
  productionHandler?: 'error' | 'warn' | 'silent'
}

/**
 * 缓存配置选项
 */
export interface CacheConfig {
  /** 缓存最大容量（默认100） */
  capacity?: number
  /** 缓存生存时间TTL（毫秒，0表示不过期） */
  ttl?: number
  /** 是否追踪访问时间（默认 false，禁用可提升性能） */
  trackAccessTime?: boolean
  /** 是否采集命中/未命中统计（默认 true；性能敏感场景可关闭） */
  enableStats?: boolean
}

/**
 * 订阅者数量达到上限时的处理策略
 * - `evict-oldest`：警告并驱逐最早的订阅者（默认）
 * - `throw`：抛出错误，避免页面组件无声丢失状态更新
 */
export type SubscriberLimitPolicy = 'evict-oldest' | 'throw'

/**
 * 订阅配置选项
 *
 * 随 `StoreOptionsBase.subscription` 发布给消费者：需要集中管理默认订阅配置
 * （共享 defaults 对象、包装 createStore 转发 `subscription`）时必须能命名它。
 */
export interface SubscriptionOptions {
  /** 最大订阅者数量（默认 50） */
  maxSubscribers?: number
  /** 订阅者达到上限时的策略（默认 'evict-oldest'） */
  onLimit?: SubscriberLimitPolicy
}

/**
 * 通知行为配置选项
 *
 * 与 `SubscriptionOptions` 同理：`StoreOptionsBase.notify` 的成员类型，导出后消费者
 * 才能显式声明/复用一份通知策略。
 */
export interface NotifyOptions {
  /**
   * 通知监听器前是否深拷贝状态（默认 true）。
   * 设为 false 进入零拷贝模式：监听器收到只读保护 Proxy（状态保护关闭时为原始引用，
   * 监听器自行保证不修改），可显著降低大状态下的通知开销。
   */
  clone?: boolean
  /**
   * 是否仅在状态实际变化时才通知（默认 false）。
   * 启用后 action 执行期间通过脏跟踪代理检测写入，未修改状态的 dispatch 不触发通知。
   */
  onlyOnChange?: boolean
  /**
   * 是否启用通知的微任务合并（默认 false）。
   * 启用后，同一 tick 内的多次 setState/$patch/$replaceState 会被合并为一次通知，
   * 显著减少小程序 setData 次数。脏键跨批次累积，最终通知仍能精确反映全部变更。
   */
  async?: boolean
}

/**
 * Store 配置接口的共享部分（#421）
 *
 * `StoreConfig`（免泛型推断）与 `StoreOptions`（显式泛型）真正的差别只有
 * `actions` / `getters` / `cacheKeys` 三个成员的写法；其余 7 个选项此前各写一遍，
 * 新增一个选项必须记得改两处，否则静默漂移，故收敛到这里声明一次。
 *
 * `S` 刻意不加 `extends State` 约束：`StoreConfig` 的类型参数默认是 `unknown`
 * （推断位点，见其文档），带约束会让它无法满足本基接口。
 */
export interface StoreOptionsBase<S> {
  /** Store名称 */
  name?: string
  /**
   * 初始状态，支持两种写法：
   * - 对象字面量：`state: { count: 0 }`
   * - 工厂函数（Pinia 同款，避免共享引用 / 需惰性初始化时推荐）：`state: () => ({ count: 0 })`
   *
   * 工厂写法下 `S` 会被推断为函数类型，下游一律用 `ResolvedState<S>` 归一化，
   * actions/getters/cacheKeys 拿到的 state 类型不受影响。
   */
  state?: S | (() => S)
  /** 是否启用缓存 */
  enableCache?: boolean
  /** 缓存配置（容量、TTL等） */
  cacheConfig?: CacheConfig
  /** 状态保护配置 */
  stateProtection?: StateProtectionOptions
  /** 订阅配置（上限数量、超限策略） */
  subscription?: SubscriptionOptions
  /** 通知行为配置（深拷贝开关、仅变更时通知） */
  notify?: NotifyOptions
}

/**
 * Store 自动推导配置类型（免泛型推导专用）
 *
 * 类型参数默认 `unknown`，使 TS 能从对象字面量**精确反推** S/A/G，
 * 不被泛型约束吸收为 `any`。`actions` 通过 `ThisType` 注入 `this` 上下文
 * （基于推断出的 S/A）。共享选项见 `StoreOptionsBase`。
 */
export interface StoreConfig<S = unknown, A = unknown, G = unknown> extends StoreOptionsBase<S> {
  /** Actions（注入 this 上下文，字面量直接推断；action 内 this.dispatch 走类型安全泛型重载） */
  actions?: A & ThisType<ActionContext<ResolvedState<S>, A extends Actions ? A : Actions>>
  /**
   * Getters（字面量直接推断）
   * 每个 getter 接收 `state` 作为首个参数，其类型由推断出的 State 提供上下文，
   * 支持对象或工厂函数形式的 `state`（`ResolveState` 归一化），避免隐式 any。
   *
   * 归一失败时的兜底与 `ResolvedState` 不同：这里退化成 `Record<string, unknown>` 而不是
   * `State`（= `object`），使 `S = unknown` 的裸配置下 getter 仍能按键读状态。
   */
  getters?: G & Record<string, (state: ResolveState<S> extends State ? ResolveState<S> : Record<string, unknown>, ...args: unknown[]) => unknown>
  /** 需要缓存的state键（为空时缓存所有） */
  cacheKeys?: Array<keyof ResolvedState<S>>
}

/**
 * Store 构造配置（显式泛型场景）
 * actions 使用 `ActionsWithThis<S, A>` 注入 `this` 类型。共享选项见 `StoreOptionsBase`。
 */
export interface StoreOptions<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> extends StoreOptionsBase<S> {
  /** Actions - 使用 ThisType 注入 this 类型 */
  actions?: ActionsWithThis<S, A>
  /** Getters */
  getters?: G
  /** 需要缓存的state键（为空时缓存所有） */
  cacheKeys?: Array<keyof S>
}

/**
 * 缓存统计信息
 */
export interface CacheStats {
  /** 是否启用缓存 */
  enabled: boolean
  /** 缓存的键数量 */
  size: number
  /** 缓存的键列表 */
  keys: Array<string>
  /** 总缓存命中次数 */
  hits: number
  /** 总缓存未命中次数 */
  misses: number
  /** 缓存淘汰次数 */
  evictions?: number
}

/**
 * Store接口 - 支持完整类型推断
 */
export interface Store<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> {
  /** Store名称 */
  readonly name: string
  /** 当前状态 */
  readonly state: S
  /** Actions */
  readonly actions: A
  /** Getters 定义（只读；提供 Getters 键集合的类型推断位点，亦可用于调试检查） */
  readonly getters: G
  /** 实例级钩子系统（每个 Store 独立） */
  readonly hooks: IHookSystem

  /** 获取状态 */
  getState(): S
  /** 设置状态 */
  setState<K extends keyof S>(key: K, value: S[K]): void
  /** 批量更新状态 */
  $patch(partialState: Partial<S>): void
  /** 替换整个状态（支持对象或工厂函数：`() => ({...})`） */
  $replaceState(newState: S | (() => S)): void
  /** 创建状态快照 */
  $snapshot(): Readonly<S>
  /** 从快照恢复状态 */
  $restore(snapshot: Readonly<S>): void

  /** 执行action - 类型安全版本 */
  dispatch<K extends keyof A>(actionName: K, ...args: InferActionArgs<A, K>): InferActionReturn<A, K>

  /** 执行action - 字符串名称调用（动态场景） */
  dispatch(actionName: string, ...args: unknown[]): unknown

  /** 使用getter - 类型安全版本 */
  getter<K extends keyof G>(getterName: K): InferGetterReturn<G, K>

  /** 使用getter - 字符串名称调用（动态场景） */
  getter(getterName: string): unknown

  /** 获取所有 getter 名称列表（用于 DevTools / 调试） */
  getGetterNames(): string[]

  /** 订阅状态变化 */
  subscribe(listener: StateListener<S>, options?: { readOnly?: boolean }): () => void

  /** 判断指定状态键自上次通知以来是否发生变更（供集成层精确跳过未变化的映射） */
  isStateKeyDirty(key: string): boolean

  /** 开始批量更新 */
  startBatch(): void
  /** 结束批量更新 */
  endBatch(): void
  /** 在批量更新上下文中执行操作 */
  batch<T>(fn: () => T): T

  /**
   * 安装插件
   *
   * 接受的插件需与自身状态类型匹配：`Plugin<S>`；状态无关的插件（`Plugin<State>`，
   * 如 logger / analyzer）同样满足。返回卸载函数。
   *
   * 用 `NoInfer` 包住 S：该参数处于逆变位置，若参与推断，`withPageStore(store, …)`
   * 这类调用在收集 S 的候选时会同时拿到协变与逆变候选而退回默认约束（`object`）。
   *
   * 为什么不改成「独立类型参数 `P extends Plugin<S>`」：那样只是把逆变比较搬进约束校验，
   * 而 `Store` 自身含 `use` 成员 ⇒ 递归比较后失败——实测宽插件 `Plugin<State>` 会无法
   * 赋给 `Plugin<ConcreteState>`。故保留 `NoInfer`，并把最低 TS 版本写进文档。
   *
   * 联合 `Plugin<State>`（状态无关插件）：它不参与推断，也不会放宽校验——
   * `Plugin<具体状态>` 仍无法传入其他状态类型的 Store；但宽插件的可赋值性不再
   * 依赖「比较 Store 自身成员形成的循环假设」，签名被实例化时不会暴露为类型错误
   */
  use(plugin: Plugin<NoInfer<S>> | Plugin<State>): () => void

  /** 销毁Store */
  destroy(): void

  /** Store 是否已被销毁 */
  readonly destroyed: boolean

  /** 从缓存获取状态值（如果缓存启用） */
  getCached<K extends keyof S>(key: K): S[K]
  /** 启用缓存 */
  enableCache(keys?: Array<keyof S>): void
  /** 禁用缓存 */
  disableCache(): void
  /** 清除缓存（特定键或全部） */
  invalidateCache<K extends keyof S>(key?: K): void
  /** 获取缓存统计信息 */
  getCacheStats(): CacheStats
}
