/**
 * GeomStore - 缓存模块类型定义
 *
 * 自 LRUCache.ts 拆出：LRU 链表节点、统计信息与配置选项。
 *
 * @module cache/types
 */

/**
 * LRU缓存节点
 *
 * 双向链表节点，用于维护访问顺序
 * @interface LRUNode
 * @template K - 键类型
 * @template V - 值类型
 */
export interface LRUNode<K, V> {
  /** 节点键 */
  key: K
  /** 节点值 */
  value: V
  /** 前一个节点 */
  prev: LRUNode<K, V> | null
  /** 后一个节点 */
  next: LRUNode<K, V> | null
  /** 节点创建时间 */
  createdAt: number
  /** 最后访问时间 */
  lastAccessedAt: number
  /** 访问次数 */
  accessCount: number
}

/**
 * LRU缓存统计信息
 *
 * @interface LRUCacheStats
 */
export interface LRUCacheStats {
  /** 缓存容量 */
  capacity: number
  /** 当前缓存项数量 */
  size: number
  /** 缓存命中次数 */
  hits: number
  /** 缓存未命中次数 */
  misses: number
  /** 总访问次数 */
  totalAccesses: number
  /** 命中率（百分比） */
  hitRate: number
  /** 未命中率（百分比） */
  missRate: number
  /** 淘汰的缓存项数量 */
  evictions: number
  /** 当前缓存键列表（按最近使用顺序） */
  keys: string[]
  /** 平均访问时间（毫秒） */
  avgAccessTime: number
  /** 缓存项平均存活时间（毫秒） */
  avgItemLifetime: number
}

/**
 * 缓存配置选项
 *
 * @interface CacheOptions
 * @template K - 键类型
 * @template V - 值类型
 */
export interface CacheOptions<K = unknown, V = unknown> {
  /** 初始容量 */
  capacity?: number
  /** 是否启用访问统计 */
  enableStats?: boolean
  /** 是否记录访问时间 */
  trackAccessTime?: boolean
  /** 自定义淘汰回调 */
  onEvict?: (key: K, value: V) => void
}
