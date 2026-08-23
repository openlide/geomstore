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

import type { State, CacheStats } from '../../types/store'
import type { LRUCache } from '../cache/LRUCache'

/**
 * 缓存管理器配置
 */
export interface StoreCacheOptions<S extends State = State> {
  /** LRU 缓存实例 */
  cache: LRUCache<keyof S, S[keyof S]>
  /** 缓存容量 */
  capacity?: number
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
        if (timestamp && Date.now() - timestamp > this._ttl) {
          // 缓存已过期，刷新
          const value = getState()
          // 只缓存非 undefined 值，避免将 undefined 值当作有效缓存
          if (value !== undefined) {
            this._cache.set(key, value)
            this._timestamps.set(key, Date.now())
          } else {
            // 值是 undefined，删除缓存条目
            this._cache.delete(key)
            this._timestamps.delete(key)
          }
          return value
        }
      }
      return cachedValue as S[K]
    }

    // 缓存未命中，从状态获取并缓存
    const value = getState()
    // 只缓存非 undefined 值
    if (value !== undefined) {
      this._cache.set(key, value)
      // 只在 TTL > 0 时记录时间戳
      if (this._ttl > 0) {
        this._timestamps.set(key, Date.now())
      }
    }
    return value
  }

  /**
   * 更新缓存值
   */
  set<K extends keyof S>(key: K, value: S[K]): void {
    if (this._enabled) {
      if (!this._cacheKeys || this._cacheKeys.has(key)) {
        // 与 get/refreshFromState 保持一致：undefined 值不缓存，并清理旧条目
        if (value !== undefined) {
          this._cache.set(key, value)
          // 只在 TTL > 0 时记录时间戳
          if (this._ttl > 0) {
            this._timestamps.set(key, Date.now())
          }
        } else {
          this._cache.delete(key)
          this._timestamps.delete(key)
        }
      }
    }
  }

  /**
   * 删除缓存值
   */
  delete<K extends keyof S>(key: K): void {
    this._cache.delete(key)
    this._timestamps.delete(key)
  }

  /**
   * 启用缓存
   */
  enable(keys: Array<keyof S> | undefined, getState: (key: keyof S) => S[keyof S], stateKeys?: Array<keyof S>): void {
    this._enabled = true
    this._cacheKeys = keys ? new Set(keys) : undefined
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
    const keys: Iterable<keyof S> = this._cacheKeys ?? stateKeys

    for (const key of keys) {
      const value = getState(key)
      // 与 get/set 保持一致：undefined 值不缓存，并清理旧条目
      if (value !== undefined) {
        this._cache.set(key, value)
        // 与 set/_writeEntry 对齐：TTL=0（永不过期）不写时间戳，
        // 否则 get() 的过期判定会把条目永久判为过期，每次 get 都回读状态源
        if (this._ttl > 0) {
          this._timestamps.set(key, now)
        }
      } else {
        this._cache.delete(key)
        this._timestamps.delete(key)
      }
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

  /**
   * 获取缓存键集合
   */
  get cacheKeys(): Set<keyof S> | undefined {
    return this._cacheKeys
  }
}
