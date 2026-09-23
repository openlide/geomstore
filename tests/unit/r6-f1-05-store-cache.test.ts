/**
 * 第六轮 f1-05 回归锁：LRU 静默淘汰不得把 TTL 时间戳留成永久孤儿（R6-040）
 *
 * `_cache` 由 LRUCache 在内部 `evictLRU()` 自行摘条目，Store 构造它时不传 `onEvict`，
 * StoreCacheManager 收不到淘汰通知 ⇒ `_timestamps` 的上界从 capacity 变成
 * 「历史上出现过的缓存键总数」。修复后由 `_pruneOrphanTimestamps` 在
 * `refreshFromState` 收尾与 `_writeEntry` 的摊还阈值两处回收孤儿。
 */

import { LRUCache } from '@/core/cache/LRUCache.js'
import { StoreCacheManager } from '@/core/store/StoreCache.js'

type DynState = Record<string, number>

const timestampsOf = (manager: StoreCacheManager<DynState>): Map<string, number> => (manager as unknown as { _timestamps: Map<string, number> })._timestamps

const createManager = (capacity: number, ttl: number) => {
  const cache = new LRUCache<string, number>({ capacity, enableStats: true })
  const state: DynState = {}
  const manager = new StoreCacheManager<DynState>({ cache, ttl })
  manager.enable(undefined, (key) => state[key] ?? 0, Object.keys(state))
  return { cache, manager, state }
}

describe('R6-040 _timestamps 随缓存收缩', () => {
  it('超出容量后被淘汰键的时间戳不再滞留（旧实现：50 个键留下 51 行时间戳）', () => {
    const { manager, state } = createManager(3, 1000)

    for (let i = 0; i < 50; i++) {
      state[`msg_${i}`] = i
      manager.set(`msg_${i}`, i)
    }

    expect(manager.getStats().size).toBe(3)
    // 旧实现这里是 50（时间戳随缓存键单调增长），新实现被摊还阈值钉住
    expect(timestampsOf(manager).size).toBeLessThanOrEqual(3 * 2 + 8 + 1)
    manager.refreshFromState((key) => state[key] ?? 0, Object.keys(state))
    expect(timestampsOf(manager).size).toBeLessThanOrEqual(3)
  })

  it('只写不 dispatch 的宿主也受摊还阈值保护（写入过程中即回收）', () => {
    const { manager, state } = createManager(3, 1000)

    for (let i = 0; i < 200; i++) {
      state[`k${i}`] = i
      manager.set(`k${i}`, i)
      // 摊还阈值 2×capacity + 8：任何时刻滞留量都被钉在这个上界内
      expect(timestampsOf(manager).size).toBeLessThanOrEqual(3 * 2 + 8 + 1)
    }
  })

  it('refreshFromState 收尾回收孤儿，且不影响在册条目的新鲜度', () => {
    const { cache, manager, state } = createManager(3, 1000)
    for (let i = 0; i < 10; i++) {
      state[`dyn_${i}`] = i
      manager.set(`dyn_${i}`, i)
    }

    manager.refreshFromState((key) => state[key] ?? 0, Object.keys(state))

    const timestamps = timestampsOf(manager)
    expect(timestamps.size).toBeLessThanOrEqual(cache.getCapacity())
    // 仍在缓存里的键时间戳必须保留，否则 TTL 检查会退化成「永远按已过期回读」
    for (const key of cache.keys()) {
      expect(timestamps.has(key)).toBe(true)
    }
  })

  it('行为不变：缓存命中仍返回缓存值，未命中仍回读状态源', () => {
    const { manager, state } = createManager(2, 1000)
    state.a = 1
    state.b = 2
    state.c = 3

    manager.set('a', 1)
    manager.set('b', 2)
    manager.set('c', 3) // 挤掉 a

    expect(manager.get('b', () => -1)).toBe(2)
    expect(manager.get('a', () => 42)).toBe(42)
    expect(manager.get('a', () => 42)).toBe(42)
    expect(timestampsOf(manager).has('a')).toBe(true)
  })

  it('ttl = 0 时不产生时间戳，prune 不改变任何东西', () => {
    const { manager, state } = createManager(2, 0)
    for (let i = 0; i < 10; i++) {
      state[`x${i}`] = i
      manager.set(`x${i}`, i)
    }
    expect(timestampsOf(manager).size).toBe(0)
    manager.refreshFromState((key) => state[key] ?? 0, Object.keys(state))
    expect(timestampsOf(manager).size).toBe(0)
  })
})
