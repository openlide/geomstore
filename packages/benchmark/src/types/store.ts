/**
 * @geomstore/benchmark - Store 抽象接口
 *
 * 定义 Store 的抽象接口，使 benchmark 包可以独立使用
 */

/**
 * 缓存统计信息
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
 * Store 抽象接口
 *
 * 定义基准测试所需的 Store 操作接口
 * 可以适配任何状态管理库
 */
export interface BenchmarkStore<S extends State = State> {
  /** 获取当前状态 */
  getState(): S

  /** 设置单个状态值 */
  setState<K extends keyof S>(key: K, value: S[K]): void

  /** 批量更新状态 */
  $patch(partial: Partial<S>): void

  /** 替换整个状态 */
  $replaceState(state: S): void

  /** 获取 actions */
  readonly actions: Record<string, (...args: unknown[]) => unknown>

  /** 分发 action */
  dispatch(name: string, ...args: unknown[]): unknown

  /** 订阅状态变化 */
  subscribe(listener: () => void): () => void

  /** 获取缓存数据 */
  getCached?(key: string): unknown

  /** 获取缓存统计 */
  getCacheStats(): CacheStats

  /** 销毁 Store */
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
  actions?: Record<string, (this: { state: S }, ...args: unknown[]) => unknown>
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
 */
export type ComposeStoreFn = <S extends State>(stores: BenchmarkStore<S>[]) => BenchmarkStore<Record<string, S>>
