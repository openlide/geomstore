/**
 * @geomstore/benchmark - Store 抽象接口
 *
 * 定义 Store 的抽象接口，使 benchmark 包可以独立使用
 */

/**
 * 缓存统计信息
 *
 * 只在实现方真的有缓存时上报；没有缓存的 store 省略 `BenchmarkStore.getCacheStats`
 * 即可，不需要伪造 `{ enabled: false, hits: 0, misses: 0 }`。
 */
export interface CacheStats {
  /** 是否启用缓存 */
  enabled: boolean
  /** 缓存命中次数 */
  hits: number
  /** 缓存未命中次数 */
  misses: number
  /** 缓存淘汰次数 */
  evictions?: number
}

/**
 * 状态类型
 */
export type State = Record<string, unknown>

/**
 * 单个 action 的签名
 *
 * `StoreConfig.actions` 与 `BenchmarkStore.actions` 共用此类型：此前两处各写一份，
 * 配置侧声明了 `this: { state: S }` 而取出来的 actions 没有，同一批函数两种形状。
 */
export type StoreAction<S extends State = State> = (this: { state: S }, ...args: unknown[]) => unknown

/** action 名称到签名的映射 */
export type ActionMap<S extends State = State> = Record<string, StoreAction<S>>

/**
 * Store 抽象接口
 *
 * 定义基准测试所需的 Store 操作接口
 * 可以适配任何状态管理库
 */
export interface BenchmarkStore<S extends State = State> {
  /**
   * 获取当前状态
   *
   * 返回的是活引用的只读视图：就地赋值会绕过 setState/$patch/$replaceState，
   * 让缓存失效与订阅通知双双失灵、测出来的数字失真，所以类型层先拦住。
   */
  getState(): Readonly<S>

  /** 设置单个状态值 */
  setState<K extends keyof S>(key: K, value: S[K]): void

  /** 批量更新状态 */
  $patch(partial: Partial<S>): void

  /** 替换整个状态 */
  $replaceState(state: S): void

  /** 获取 actions */
  readonly actions: ActionMap<S>

  /**
   * 分发 action
   *
   * 有意按名称动态派发（`unknown[]` 而非 keyof A 的类型映射）：基准测试的动作名来自
   * `Object.keys(store.actions)` 的运行时结果，编译期没有可收窄的字面量名；
   * 名称/参数不匹配由 runner 的 dispatch 分支在场景执行时暴露。
   */
  dispatch(name: string, ...args: unknown[]): unknown

  /**
   * 订阅状态变化
   *
   * 生命周期契约（适配方必须满足；基准 harness 自身不调用它，但 `subscribe` 档的
   * 耗时/吞吐门限正是测这件事的，口径不明就会把「订阅泄漏」当成性能问题）：
   * - 返回的退订函数**幂等**：重复调用是 no-op，不得抛错，也不得连带失效同一监听器的
   *   其他注册或别人的注册（同一次 `subscribe` 的句柄只减自己那一笔）；
   * - 通知按「进入本轮通知时在册的订阅者」快照派发：回调内退订自己、或新增订阅都不影响
   *   本轮（新订阅从下一轮起生效）。实现不得边派发边收缩在册集合——那会让同一轮里各
   *   监听器看到的变更集合取决于回调内部行为，测量结果不可复现；
   * - 允许同一监听器函数多次注册，每次注册各自计数、各自需要各自的退订。
   */
  subscribe(listener: () => void): () => void

  /** 获取缓存数据，无缓存的实现可省略 */
  getCached?(key: string): unknown

  /** 获取缓存统计，无缓存的实现可省略（省略即按「缓存未启用」上报） */
  getCacheStats?(): CacheStats

  /**
   * 销毁 Store
   *
   * 生命周期契约：
   * - **幂等**：重复调用不抛错、不重复释放。本包每个 store 实例只销毁一次（预热循环
   *   建一个立刻销毁一个，场景结束在 `finally` 里销毁），但把实例缓存起来复用的外部
   *   harness 必然二次触达，实现必须兜住；
   * - 返回后不得再触发任何监听器回调，也不得再有 action / getter 求值路径可达；
   * - 必须释放订阅与缓存：之后 `getCached` 不得返回旧值（返回 undefined 即可）；
   *   `getCacheStats` 若实现选择销毁后仍可调用，要报「已清零」而不是抛错——本包在销毁前
   *   就读完并拷成了普通对象，抛错只会打到自行编排时序的 harness；
   * - 释放要限本实例：基准每个场景都新建一份 store，跨实例串味会把上一个实例的占用
   *   记到下一个场景的内存增量上。
   */
  destroy(): void
}

/**
 * Store 配置接口
 */
export interface StoreConfig<S extends State = State> {
  /** Store 名称 */
  name?: string
  /** 初始状态 */
  state: S
  /** Actions */
  actions?: ActionMap<S>
  /** Getters */
  getters?: Record<string, (state: S) => unknown>
  /** 是否启用缓存 */
  enableCache?: boolean
  /** 缓存配置 */
  cacheConfig?: {
    capacity?: number
    ttl?: number
  }
  /** 缓存键列表 */
  cacheKeys?: string[]
}

/**
 * Store 工厂函数类型
 */
export type StoreFactory<S extends State = State> = (config: StoreConfig<S>) => BenchmarkStore<S>

/**
 * 组合 Store 函数类型
 *
 * 键即组合状态里的命名空间，因此按键名逐个推断成员 store 的状态类型。旧的
 * `BenchmarkStore<S>[] -> BenchmarkStore<Record<string, S>>` 形式既强迫所有成员共用
 * 同一个 S，也让组合结果取具体成员时完全没有类型。
 */
export type ComposeStoreFn = <T extends Record<string, State>>(
  stores: { [K in keyof T]: BenchmarkStore<T[K]> }
) => BenchmarkStore<T>
