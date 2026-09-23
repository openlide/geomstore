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
 *
 * 只是本包的**默认**状态形状，不再当泛型约束用（约束一律是 `object`，见下）。
 * TypeScript 只对类型别名/对象字面量类型推断「隐式索引签名」，`interface` 声明的状态类型
 * 不满足 `extends Record<string, unknown>`，会在 `BenchmarkStore<S>` 这一层被 TS2344 直接
 * 拒掉——外部 harness 恰恰普遍用 interface 写状态。故约束放开为 `object`，`State` 保留为默认值。
 */
export type State = Record<string, unknown>

/**
 * 递归只读视图
 *
 * `getState()` 的返回类型。浅 `Readonly<S>` 只锁得住顶层键（`state.count = 1` 报错），
 * 嵌套对象与数组照旧可写（`state.user.name = 'x'`、`state.list.push(...)` 都通过编译），
 * 而那正是绕过 setState/$patch 的两条路。这里递归加 `readonly` 把这类写入也纳入类型层。
 *
 * 三条边界（对适配方与调用方都成立，别把它当成运行时保证）：
 * - **纯编译期**：不 freeze、不包代理，`as` 断言或 JS 调用方照样能写；
 * - 递归规则：函数原样返回（映射过去会丢调用签名），数组映射成 `readonly` 视图
 *   （`push`/`sort` 等变异方法随之下线），`Map`/`Set` 映射成 `ReadonlyMap`/`ReadonlySet`，
 *   原始值原样返回，其余对象按键递归；
 * - 只锁得住**属性赋值**：`Date.setTime()`、`RegExp.lastIndex = …` 这类内建对象自带的
 *   变异方法照旧可调用（readonly 修饰符不影响方法本身），环形引用按 TS 的递归类型规则处理，
 *   展开深度与 `Readonly<T>` 同级。要堵这一层得靠运行时冻结，不在本契约范围内。
 */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends Map<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends Set<infer U>
        ? ReadonlySet<DeepReadonly<U>>
        : T extends object
          ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
          : T

/**
 * 单个 action 的签名
 *
 * `StoreConfig.actions` 与 `BenchmarkStore.actions` 共用此类型：此前两处各写一份，
 * 配置侧声明了 `this: { state: S }` 而取出来的 actions 没有，同一批函数两种形状。
 *
 * 约束写 `object` 而非 `State`：见 `State` 上关于 interface 状态类型的说明。
 */
export type StoreAction<S extends object = State> = (
  this: { state: S },
  ...args: unknown[]
) => unknown

/** action 名称到签名的映射 */
export type ActionMap<S extends object = State> = Record<string, StoreAction<S>>

/**
 * Store 抽象接口
 *
 * 定义基准测试所需的 Store 操作接口
 * 可以适配任何状态管理库
 */
export interface BenchmarkStore<S extends object = State> {
  /**
   * 获取当前状态
   *
   * 返回的是活引用的只读视图（`DeepReadonly<S>`，递归）：就地赋值会绕过
   * setState/$patch/$replaceState，让缓存失效与订阅通知双双失灵、测出来的数字失真，
   * 所以类型层要拦住。浅 `Readonly<S>` 拦不住 `state.user.name = 'x'` 与
   * `state.list.push(...)` 这类嵌套写入，而嵌套状态才是适配方的常态，故取递归版本。
   *
   * 这是**编译期**约束，不是运行时保证：本方法不 freeze、不包代理，绕过类型系统
   * （断言、JS 调用方）依然能写。需要运行时保证请配合被测库自身的状态保护配置。
   */
  getState(): DeepReadonly<S>

  /** 设置单个状态值 */
  setState<K extends keyof S>(key: K, value: S[K]): void

  /**
   * 批量更新状态
   *
   * 合并语义（口径必须写死，否则 patch 与 setState/$replaceState 的数字不可比）：
   * - **浅合并**：只覆盖 `partial` 里出现的**顶层**键，键的取值整体替换，
   *   不做深合并/递归逐字段比对（深合并与浅合并的每轮开销差一个状态尺寸量级）；
   * - `partial` 未出现的键保持原值，通知/缓存失效范围只覆盖实际写入的那些顶层键；
   * - **显式传入 `undefined` 算一次写入**（`{ key: undefined }` 把键写成 undefined），
   *   不得当成「未传」跳过——`Partial<S>` 允许这种写法，跳过与写入是两种不同的耗时；
   * - 空对象 `Partial<S>` 是合法调用，按「零个键被写入」处理，不抛错。
   */
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
export interface StoreConfig<S extends object = State> {
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
export type StoreFactory<S extends object = State> = (config: StoreConfig<S>) => BenchmarkStore<S>

/**
 * 组合 Store 函数类型
 *
 * 键即组合状态里的命名空间，因此按键名逐个推断成员 store 的状态类型。旧的
 * `BenchmarkStore<S>[] -> BenchmarkStore<Record<string, S>>` 形式既强迫所有成员共用
 * 同一个 S，也让组合结果取具体成员时完全没有类型。
 *
 * 成员的约束用 `Record<string, object>` 而不是 `Record<string, State>`：`object` 才容得下
 * interface 声明的状态类型（见 `State` 的说明）。命名空间容器本身仍要求是「字符串键 → 状态」
 * 的映射形状，按字面量传参（`compose({ users, cart })`）走的是对象字面量类型、自带隐式
 * 索引签名，因此不受影响；只有把容器本身声明成 `interface` 再整体传进来才会被约束拒掉。
 */
export type ComposeStoreFn = <T extends Record<string, object>>(
  stores: { [K in keyof T]: BenchmarkStore<T[K]> }
) => BenchmarkStore<T>
