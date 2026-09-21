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
  /** TTL（毫秒，0 表示不过期） */
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
    this._ttl = options.ttl ?? 0
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
    this._cache.clear()
    this._timestamps.clear()
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
      this._cache.delete(key)
      this._timestamps.delete(key)
    }
  }

  /**
   * 从当前状态强制刷新缓存
   *
   * 用于 dispatch 结束后同步缓存：action 可能通过 `this.state.xxx = ...`
   * 直接变异状态（绕过 setState/$patch），导致缓存与真实状态不一致，
   * 此方法按缓存键集合从状态源强制回写
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
    this._cache.clear()
    this._timestamps.clear()
  }

  /**
   * 清除缓存
   */
  invalidate<K extends keyof S>(key?: K): void {
    if (key !== undefined) {
      this._cache.delete(key)
      this._timestamps.delete(key)
    } else {
      this._cache.clear()
      this._timestamps.clear()
    }
  }

  /**
   * 清理旧状态缓存
   * 用于 $replaceState 时清理旧状态
   */
  clearOldState(stateKeys: Array<keyof S>): void {
    stateKeys.forEach((key) => {
      this._cache.delete(key)
      // TTL 时间戳一并清理：残留条目不影响 get 未命中路径，
      // 但会让内部 Map 滞留到 disable()/invalidate() 才释放
      this._timestamps.delete(key)
    })
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
