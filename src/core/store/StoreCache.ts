/**
 * StoreCache - Store 缓存管理器模块
 *
 * 职责：
 * - 管理状态值的 LRU 缓存
 * - 支持 TTL 过期
 * - 提供缓存统计信息
 *
 * @module StoreCache
 */

import type { State, CacheStats } from '../../types/store.js'
import type { LRUCache } from '../cache/LRUCache.js'
import { isProduction } from './utils.js'

/**
 * 缓存管理器配置
 */
export interface StoreCacheOptions<S extends State = State> {
  /** LRU 缓存实例 */
  cache: LRUCache<keyof S, S[keyof S]>
  /**
   * TTL（毫秒，0 表示不过期）
   *
   * 非有限值（NaN/Infinity）与负数在构造期归一为 0 并留开发期告警：
   * 类内过期判定统一写作 `ttl > 0`，NaN 会让它恒为 false（配置失效且无信号）
   */
  ttl?: number
}

/**
 * Store 缓存管理器
 *
 * 提供状态值的缓存功能，优化频繁读取场景
 */
export class StoreCacheManager<S extends State = State> {
  private readonly _cache: LRUCache<keyof S, S[keyof S]>
  private _enabled = false
  private _cacheKeys?: Set<keyof S>
  private readonly _ttl: number
  private readonly _timestamps: Map<keyof S, number> = new Map()

  constructor(options: StoreCacheOptions<S>) {
    this._cache = options.cache
    // 与 LRUCache 的 capacity 守卫同口径（Number.isFinite + 归一到「默认值」）：
    // 类内所有 TTL 判定都写成 `this._ttl > 0`，NaN 会让它恒为 false，
    // 配置里明明写了 ttl 却被静默丢弃、缓存永不过期；Infinity/负数同理
    // （永不过期本就该用 ttl: 0 表达）。归一时留一条开发期告警：
    // 只改数值不改语义的话，配置里算错的 ttl 依旧不会有任何信号
    const ttl = options.ttl ?? 0
    this._ttl = Number.isFinite(ttl) && ttl >= 0 ? ttl : 0
    if (this._ttl === 0 && ttl !== 0 && !isProduction()) {
      console.warn(`[GeomStore] cacheConfig.ttl=${ttl} 不是有效的过期时长（需为有限非负数），已按 0（不过期）处理`)
    }
  }

  /**
   * 缓存是否启用
   */
  get enabled(): boolean {
    return this._enabled
  }

  /**
   * 从缓存获取状态值
   *
   * 优化点：
   * - 使用 Set 进行 O(1) 查找
   * - TTL=0 时跳过时间戳操作
   * - 缓存未命中时惰性设置时间戳
   */
  get<K extends keyof S>(key: K, getState: () => S[K]): S[K] {
    // 快速路径：缓存未启用
    if (!this._enabled) {
      return getState()
    }

    // 快速路径：不在缓存键集合中
    if (this._cacheKeys && !this._cacheKeys.has(key)) {
      return getState()
    }

    const cachedValue = this._cache.get(key)

    // 缓存命中
    if (cachedValue !== undefined) {
      // 只在 TTL > 0 时检查过期
      if (this._ttl > 0) {
        const timestamp = this._timestamps.get(key)
        // 时间戳缺失（含 0）按已过期处理：新鲜度未知时宁可回读状态源，
        // 也不能像真值判断那样静默跳过检查、把这条旧值无限读下去
        if (timestamp === undefined || Date.now() - timestamp > this._ttl) {
          // 缓存已过期，刷新
          const value = getState()
          this._writeEntry(key, value, Date.now())
          return value
        }
      }
      return cachedValue as S[K]
    }

    // 缓存未命中，从状态获取并缓存（统一走 _writeEntry，避免同一套写入语义多处漂移）
    const value = getState()
    this._writeEntry(key, value, Date.now())
    return value
  }

  /**
   * 更新缓存值
   */
  set<K extends keyof S>(key: K, value: S[K]): void {
    if (this._enabled && (!this._cacheKeys || this._cacheKeys.has(key))) {
      this._writeEntry(key, value, Date.now())
    }
  }

  /**
   * 启用缓存
   */
  enable(keys: Array<keyof S> | undefined, getState: (key: keyof S) => S[keyof S], stateKeys?: Array<keyof S>): void {
    this._enabled = true
    this._cacheKeys = keys ? new Set(keys) : undefined
    // 空键集是「缓存全部关闭」而非「缓存全部键」：_cacheKeys 非 undefined 会让 get/set
    // 把所有键都过滤掉，而 enabled 仍报 true，配置与观测不一致最难排查。
    // 不把它当作未指定 keys——显式传空数组通常来自一个算出空集的配置，
    // 反向解释成全量缓存会引入用户没要的旧值风险
    if (keys && keys.length === 0 && !isProduction()) {
      console.warn('[GeomStore] cacheKeys 为空数组：缓存不会命中任何键，enableCache 形同关闭（需要缓存全部键请传 undefined）')
    }
    // 重新配置即重建：先清掉上一轮键集的残留条目。否则收窄 cacheKeys 后旧条目仍
    // 留在 LRU 里占用容量（导致新键集内的有效键被提前淘汰）并被 getStats() 报告，
    // 而 get() 已因 _cacheKeys 过滤永远读不到它们。清空后条目立即从状态源回填，无数据丢失
    this._clearEntries()
    const now = Date.now()

    if (keys) {
      keys.forEach((key) => {
        this._writeEntry(key, getState(key), now)
      })
    } else if (stateKeys) {
      // 初始化所有状态键
      stateKeys.forEach((key) => {
        this._writeEntry(key, getState(key), now)
      })
    }
  }

  /**
   * 写入缓存条目：统一 undefined 不缓存约定与 TTL 时间戳规则
   *
   * @private
   */
  private _writeEntry<K extends keyof S>(key: K, value: S[K], now: number): void {
    if (value !== undefined) {
      this._cache.set(key, value)
      // 只在 TTL > 0 时记录时间戳
      if (this._ttl > 0) {
        this._timestamps.set(key, now)
      }
    } else {
      // 值为 undefined：不缓存，并清理残留条目
      this._deleteEntry(key)
    }
  }

  /**
   * 删除单个键的缓存条目与 TTL 时间戳
   *
   * `_cache` 与 `_timestamps` 是两张必须同步收缩的 Map：任何一处只删一边都会让
   * 时间戳条目滞留（只能等 disable()/invalidate() 才释放），历史上门槛最低的
   * 写法就是散在各调用点各删各的。删除语义收在这一个方法里，调用点不再各写两行
   *
   * @private
   */
  private _deleteEntry(key: keyof S): void {
    this._cache.delete(key)
    this._timestamps.delete(key)
  }

  /**
   * 清空全部缓存条目与 TTL 时间戳（`_deleteEntry` 的整表版本，同一套同步约束）
   *
   * @private
   */
  private _clearEntries(): void {
    this._cache.clear()
    this._timestamps.clear()
  }

  /**
   * 从当前状态强制刷新缓存
   *
   * 用于 dispatch 结束后同步缓存：action 可能通过 `this.state.xxx = ...`
   * 直接变异状态（绕过 setState/$patch），导致缓存与真实状态不一致，
   * 此方法按缓存键集合从状态源强制回写
   *
   * @remarks TTL 语义是「距最后一次与状态源对齐的时长」，不是「距条目首次写入的时长」：
   * 本方法在每次 dispatch 收尾把全部缓存键的值重读自状态源并重置时间戳，
   * 因此高频 dispatch 下热点条目事实上不会过期——这不是缺陷，被重置的条目里存的
   * 就是刚刚读出的当前值，让它按墙钟过期只会多一次同样返回该值的回读。
   * 需要知道的边界：ttl 只在「状态被 dispatch 之外的途径改写」时兜陈旧读，
   * 且该兜底会在高频 dispatch 下被不断推迟，**不是硬过期上限**；
   * 要求「写入后最长存活」的调用方不要依赖 ttl 达成
   *
   * @param getState - 从状态源读取值的函数
   * @param stateKeys - 当前状态的全部键（未配置 cacheKeys 时作为刷新范围）
   */
  refreshFromState(getState: (key: keyof S) => S[keyof S], stateKeys: Array<keyof S>): void {
    if (!this._enabled) {
      return
    }

    const now = Date.now()
    // 刷新范围必须是「缓存中已有键 ∪ 当前状态键」：action 内 delete 状态键后，
    // 该键不在 stateKeys 里，仅遍历 stateKeys 永远走不到删除分支，
    // TTL=0 时过期条目将永久滞留并被 getCached 读到
    const keys = new Set<keyof S>(this._cacheKeys ?? [])
    for (const key of this._cache.keys()) {
      keys.add(key)
    }
    if (!this._cacheKeys) {
      for (const key of stateKeys) {
        keys.add(key)
      }
    }

    for (const key of keys) {
      this._writeEntry(key, getState(key), now)
    }
  }

  /**
   * 禁用缓存
   */
  disable(): void {
    this._enabled = false
    this._cacheKeys = undefined
    this._clearEntries()
  }

  /**
   * 清除缓存
   *
   * 不传 key 时整表清空：`$replaceState` 走的正是这条路径——整树替换后旧状态的键
   * （含 action 内已 delete 的键）都不在新状态里，按键清理会漏掉它们
   */
  invalidate<K extends keyof S>(key?: K): void {
    if (key !== undefined) {
      this._deleteEntry(key)
    } else {
      this._clearEntries()
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    const stats = this._cache.getStats()
    return {
      enabled: this._enabled,
      size: stats.size,
      keys: stats.keys,
      hits: stats.hits,
      misses: stats.misses,
      evictions: stats.evictions,
    }
  }
}
