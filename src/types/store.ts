import type { Plugin, IHookSystem } from './plugin'

/**
 * GeomStore v1.0.0 - Store类型定义
 * 采用 ThisType 方案消除循环依赖
 */

/**
 * 状态类型
 */
export type State = Record<string, unknown>

/**
 * Action 上下文基础接口 - 包含 Store 核心方法
 * 不包含 actions，避免循环依赖
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
  /** 替换整个状态 */
  $replaceState(newState: S): void
  /** 获取状态值 */
  getState(): S
  /** 动态 dispatch */
  dispatch(actionName: string, ...args: unknown[]): unknown
}

/**
 * Action 上下文类型 - action 方法中 this 的类型
 * 通过合并 A 类型实现直接访问其他 action
 */
export type ActionContext<
  S extends State = State,
  A extends Record<string, (...args: unknown[]) => unknown> = Record<string, (...args: unknown[]) => unknown>,
> = ActionContextBase<S> & A

/**
 * Actions 类型约束
 * 用于约束 actions 参数类型
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Actions = Record<string, (...args: any[]) => any>

/**
 * 创建带 ThisType 的 Actions 类型
 * 这是方案3的核心：通过 ThisType 注入 this 类型
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
export type InferActionReturn<A extends Actions, K extends keyof A> = A[K] extends (...args: unknown[]) => infer R ? R : never

/**
 * 推断Getter返回类型
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InferGetterReturn<G extends Record<string, (state: any) => any>, K extends keyof G> = G[K] extends (...args: any[]) => infer R ? R : never

/**
 * 从 Actions 类型提取所有 action 名称
 */
export type ActionNames<A extends Actions> = keyof A & string

/**
 * 从 Getters 类型提取所有 getter 名称
 */
export type GetterNames<G extends Getters> = keyof G & string

/**
 * 创建类型安全的 Actions 映射
 * 用于 mapActions 的类型推断
 */
export type MappedActions<A extends Actions, M extends (keyof A)[]> = {
  [K in M[number] as K extends string ? K : never]: (...args: InferActionArgs<A, K>) => InferActionReturn<A, K>
}

/**
 * 创建类型安全的 Getters 映射
 * 用于 mapGetters 的类型推断
 */
export type MappedGetters<S extends State, G extends Getters<S>, M extends (keyof G)[]> = {
  [K in M[number] as K extends string ? K : never]: InferGetterReturn<G, K>
}

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
 */
export interface SubscriptionOptions {
  /** 最大订阅者数量（默认 50） */
  maxSubscribers?: number
  /** 订阅者达到上限时的策略（默认 'evict-oldest'） */
  onLimit?: SubscriberLimitPolicy
}

/**
 * 通知行为配置选项
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
}

/**
 * Store配置选项 - 支持完整类型推断
 * 方案3核心：actions 使用 ActionsWithThis<S, A> 注入 this 类型
 */
export interface StoreOptions<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> {
  /** Store名称 */
  name?: string
  /** 初始状态 */
  state?: S
  /** Actions - 使用 ThisType 注入 this 类型 */
  actions?: ActionsWithThis<S, A>
  /** Getters */
  getters?: G
  /** 是否启用缓存 */
  enableCache?: boolean
  /** 需要缓存的state键（为空时缓存所有） */
  cacheKeys?: Array<keyof S>
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
  /** 替换整个状态 */
  $replaceState(newState: S): void
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
  subscribe(listener: StateListener<S>): () => void

  /** 开始批量更新 */
  startBatch(): void
  /** 结束批量更新 */
  endBatch(): void
  /** 在批量更新上下文中执行操作 */
  batch<T>(fn: () => T): T

  /** 安装插件 */
  use(plugin: Plugin): () => void

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
