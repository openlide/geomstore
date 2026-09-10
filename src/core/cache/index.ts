/**
 * GeomStore - 缓存模块
 *
 * 提供高性能的缓存实现，包括：
 * - 增强型LRU缓存（严格的LRU淘汰策略、动态容量控制、命中率统计）
 */

export { LRUCache } from './LRUCache.js'
export type { LRUCacheStats, CacheOptions } from './LRUCache.js'
