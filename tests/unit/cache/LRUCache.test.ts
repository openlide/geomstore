/**
 * GeomStore v1.0 - LRU缓存单元测试
 */

import { LRUCache, LRUCacheStats } from '../../../src/core/cache/LRUCache'

describe('LRUCache', () => {
  describe('基本操作', () => {
    test('should set and get values', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)

      expect(cache.get('a')).toBe(1)
      expect(cache.get('b')).toBe(2)
    })

    test('should return undefined for non-existent key', () => {
      const cache = new LRUCache<string, number>(3)
      expect(cache.get('nonexistent')).toBeUndefined()
    })

    test('should update value for existing key', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('a', 100)

      expect(cache.get('a')).toBe(100)
    })

    test('should check if key exists', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)

      expect(cache.has('a')).toBe(true)
      expect(cache.has('b')).toBe(false)
    })

    test('should delete key', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)

      expect(cache.delete('a')).toBe(true)
      expect(cache.delete('a')).toBe(false)
      expect(cache.has('a')).toBe(false)
    })

    test('should clear all entries', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)

      cache.clear()

      expect(cache.size()).toBe(0)
      expect(cache.has('a')).toBe(false)
      expect(cache.has('b')).toBe(false)
    })
  })

  describe('LRU淘汰策略', () => {
    test('should evict least recently used item when capacity exceeded', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.set('d', 4) // Should evict 'a'

      expect(cache.has('a')).toBe(false)
      expect(cache.has('b')).toBe(true)
      expect(cache.has('c')).toBe(true)
      expect(cache.has('d')).toBe(true)
    })

    test('should move accessed item to most recently used position', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)

      // Access 'a', making it most recently used
      cache.get('a')

      // Now 'b' is least recently used
      cache.set('d', 4) // Should evict 'b'

      expect(cache.has('a')).toBe(true)
      expect(cache.has('b')).toBe(false)
      expect(cache.has('c')).toBe(true)
      expect(cache.has('d')).toBe(true)
    })

    test('should maintain correct order after multiple operations', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.get('a') // a is now MRU
      cache.set('d', 4) // b should be evicted

      expect(cache.keys()).toEqual(['d', 'a', 'c'])
    })
  })

  describe('动态容量控制', () => {
    test('should resize capacity down and evict items', () => {
      const cache = new LRUCache<string, number>(5)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.set('d', 4)
      cache.set('e', 5)

      cache.resize(2)

      expect(cache.getCapacity()).toBe(2)
      expect(cache.size()).toBe(2)
      expect(cache.keys()).toEqual(['e', 'd'])
    })

    test('should resize capacity up', () => {
      const cache = new LRUCache<string, number>(2)
      cache.set('a', 1)
      cache.set('b', 2)

      cache.resize(5)

      expect(cache.getCapacity()).toBe(5)
      expect(cache.size()).toBe(2)
      expect(cache.has('a')).toBe(true)
      expect(cache.has('b')).toBe(true)
    })

    test('should not allow capacity below 1', () => {
      const cache = new LRUCache<string, number>(3)
      cache.resize(0)

      expect(cache.getCapacity()).toBe(1)
    })
  })

  describe('命中率统计', () => {
    test('should track hit and miss counts', () => {
      const cache = new LRUCache<string, number>({ capacity: 3, enableStats: true })
      cache.set('a', 1)
      cache.set('b', 2)

      // Hits
      cache.get('a')
      cache.get('a')
      cache.get('b')

      // Misses
      cache.get('x')
      cache.get('y')

      const stats = cache.getStats()
      expect(stats.hits).toBe(3)
      expect(stats.misses).toBe(2)
      expect(stats.totalAccesses).toBe(5)
      expect(stats.hitRate).toBe(60)
    })

    test('should calculate hit rate correctly', () => {
      const cache = new LRUCache<string, number>({ capacity: 3, enableStats: true })

      // 8 hits, 2 misses = 80% hit rate
      for (let i = 0; i < 8; i++) {
        cache.set('a', i)
        cache.get('a')
      }
      cache.get('missing1')
      cache.get('missing2')

      const stats = cache.getStats()
      expect(stats.hitRate).toBe(80)
      expect(stats.missRate).toBe(20) // 实际返回 20，不是 0.2
    })

    test('should reset stats without clearing cache', () => {
      const cache = new LRUCache<string, number>({ capacity: 3, enableStats: true })
      cache.set('a', 1)
      cache.get('a')
      cache.get('missing')

      cache.resetStats()

      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
      expect(stats.misses).toBe(0)
      expect(stats.hitRate).toBe(0)
      expect(cache.has('a')).toBe(true)
    })
  })

  describe('批量操作', () => {
    test('should set multiple values', () => {
      const cache = new LRUCache<string, number>(5)
      cache.setMany([
        ['a', 1],
        ['b', 2],
        ['c', 3],
      ])

      expect(cache.get('a')).toBe(1)
      expect(cache.get('b')).toBe(2)
      expect(cache.get('c')).toBe(3)
    })

    test('should support getOrSet pattern', () => {
      const cache = new LRUCache<string, number>(3)
      const factory = jest.fn(() => 42)

      const value1 = cache.getOrSet('key', factory)
      const value2 = cache.getOrSet('key', factory)

      expect(value1).toBe(42)
      expect(value2).toBe(42)
      expect(factory).toHaveBeenCalledTimes(1)
    })
  })

  describe('遍历和转换', () => {
    test('should return keys in correct order', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)

      expect(cache.keys()).toEqual(['c', 'b', 'a'])
    })

    test('should return values in correct order', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)

      expect(cache.values()).toEqual([3, 2, 1])
    })

    test('should return entries in correct order', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)

      expect(cache.entries()).toEqual([
        { key: 'b', value: 2 },
        { key: 'a', value: 1 },
      ])
    })

    test('should iterate with forEach', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)

      const callback = jest.fn()
      cache.forEach(callback)

      expect(callback).toHaveBeenCalledTimes(2)
      expect(callback).toHaveBeenCalledWith(2, 'b')
      expect(callback).toHaveBeenCalledWith(1, 'a')
    })

    test('should convert to object', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)

      expect(cache.toObject()).toEqual({ b: 2, a: 1 })
    })
  })

  describe('特殊操作', () => {
    test('should peek without updating access order', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)
      cache.set('b', 2)

      cache.peek('a')

      expect(cache.keys()).toEqual(['b', 'a'])
    })

    test('should support chaining', () => {
      const cache = new LRUCache<string, number>(3)

      cache.set('a', 1).set('b', 2).set('c', 3)

      expect(cache.size()).toBe(3)
    })
  })

  describe('淘汰回调', () => {
    test('should call onEvict callback when item is evicted', () => {
      const onEvict = jest.fn()
      const cache = new LRUCache<string, number>({
        capacity: 2,
        onEvict,
      })

      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3) // Should evict 'a'

      expect(onEvict).toHaveBeenCalledWith('a', 1)
      expect(onEvict).toHaveBeenCalledTimes(1)
    })

    test('should call onEvict for all items when cleared', () => {
      const onEvict = jest.fn()
      const cache = new LRUCache<string, number>({
        capacity: 3,
        onEvict,
      })

      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3)
      cache.clear()

      expect(onEvict).toHaveBeenCalledTimes(3)
    })
  })

  describe('边界情况', () => {
    test('should handle empty cache operations', () => {
      const cache = new LRUCache<string, number>(3)

      expect(cache.size()).toBe(0)
      expect(cache.keys()).toEqual([])
      expect(cache.getStats().hitRate).toBe(0)
    })

    test('should handle single item cache', () => {
      const cache = new LRUCache<string, number>(1)

      cache.set('a', 1)
      cache.set('b', 2) // Should evict 'a'

      expect(cache.has('a')).toBe(false)
      expect(cache.has('b')).toBe(true)
      expect(cache.size()).toBe(1)
    })

    test('should handle same key updates without changing size', () => {
      const cache = new LRUCache<string, number>(3)

      cache.set('a', 1)
      cache.set('a', 2)
      cache.set('a', 3)

      expect(cache.size()).toBe(1)
      expect(cache.get('a')).toBe(3)
    })
  })

  describe('构造函数选项', () => {
    test('should work with no arguments', () => {
      const cache = new LRUCache<string, number>()
      expect(cache.getCapacity()).toBe(100)
    })

    test('should work with number argument', () => {
      const cache = new LRUCache<string, number>(50)
      expect(cache.getCapacity()).toBe(50)
    })

    test('should use default capacity when not specified', () => {
      const cache = new LRUCache<string, number>({ enableStats: true })
      expect(cache.getCapacity()).toBe(100)
    })

    test('should handle all options explicitly', () => {
      const onEvict = jest.fn()
      const cache = new LRUCache<string, number>({
        capacity: 1,
        enableStats: false,
        trackAccessTime: false,
        onEvict,
      })
      expect(cache.getCapacity()).toBe(1)
      cache.set('a', 1)
      cache.set('b', 2) // 触发淘汰
      expect(onEvict).toHaveBeenCalledWith('a', 1)
    })
  })

  describe('禁用统计选项', () => {
    test('should not track hits when enableStats is false', () => {
      const cache = new LRUCache<string, number>({ capacity: 3, enableStats: false })
      cache.set('a', 1)
      cache.get('a')

      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
    })

    test('should not track misses when enableStats is false', () => {
      const cache = new LRUCache<string, number>({ capacity: 3, enableStats: false })
      cache.get('nonexistent')

      const stats = cache.getStats()
      expect(stats.misses).toBe(0)
    })

    test('should not track access time when trackAccessTime is false', () => {
      const cache = new LRUCache<string, number>({ capacity: 3, trackAccessTime: false, enableStats: true })
      cache.set('a', 1)
      cache.get('a')

      const stats = cache.getStats()
      expect(stats.avgAccessTime).toBe(0)
    })

    test('should track hits when trackAccessTime is false but enableStats is true', () => {
      const cache = new LRUCache<string, number>({
        capacity: 3,
        trackAccessTime: false,
        enableStats: true,
      })
      cache.set('a', 1)
      cache.get('a')
      cache.get('a')

      const stats = cache.getStats()
      expect(stats.hits).toBe(2)
    })
  })

  describe('clear 无 onEvict 回调', () => {
    test('should clear without calling onEvict when not provided', () => {
      const cache = new LRUCache<string, number>({ capacity: 3 })
      cache.set('a', 1)
      cache.set('b', 2)

      // 不应该抛出错误
      cache.clear()

      expect(cache.size()).toBe(0)
    })
  })

  describe('分支覆盖率补充', () => {
    test('get 命中时 trackAccessTime=false 且 enableStats=false 不更新统计', () => {
      const cache = new LRUCache<string, number>({
        capacity: 3,
        trackAccessTime: false,
        enableStats: false,
      })
      cache.set('a', 1)

      // 命中时不应该更新统计
      const value = cache.get('a')
      expect(value).toBe(1)

      const stats = cache.getStats()
      expect(stats.hits).toBe(0)
    })

    test('addToHead 中 nextNode 为 null 时不崩溃', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)

      // 手动将 head.next 设为 null，模拟 nextNode 为 null 的边界情况
      const node = (cache as any).cache.get('a')
      const originalHeadNext = (cache as any).head.next
      ;(cache as any).head.next = null

      // 调用 addToHead，此时 nextNode 为 null
      expect(() => {
        (cache as any).addToHead(node)
      }).not.toThrow()

      // 恢复
      ;(cache as any).head.next = originalHeadNext
    })

    test('removeFromList 中 node.prev/next 为 null 时不崩溃', () => {
      const cache = new LRUCache<string, number>(3)
      cache.set('a', 1)

      // 获取节点并手动将 prev/next 设为 null（模拟已不在链表中）
      const node = (cache as any).cache.get('a')
      const savedPrev = node.prev
      const savedNext = node.next
      node.prev = null
      node.next = null

      // 调用 removeFromList，此时 prev 和 next 都为 null，应跳过
      expect(() => {
        (cache as any).removeFromList(node)
      }).not.toThrow()

      // 恢复
      node.prev = savedPrev
      node.next = savedNext
    })

    test('evictLRU 在缓存为空时不应淘汰哨兵节点', () => {
      const cache = new LRUCache<string, number>(3)

      // 缓存为空时直接调用 evictLRU
      // tail.prev === head，应该提前返回
      expect(() => {
        (cache as any).evictLRU()
      }).not.toThrow()

      // 缓存应该仍为空
      expect(cache.size()).toBe(0)
    })
  })

  describe('回归 - onEvict 时机', () => {
    test('REGR-LRU-001: 回调触发时被淘汰键应已移除（重入查询一致）', () => {
      const cache = new LRUCache<string, number>({
        capacity: 2,
        onEvict: (key) => {
          // 回调重入查询：修复前键仍在缓存中，与「已淘汰」语义不一致
          expect(cache.get(key)).toBeUndefined()
          expect(cache.has(key)).toBe(false)
        },
      })

      cache.set('a', 1)
      cache.set('b', 2)
      cache.set('c', 3) // 淘汰 'a'，触发回调

      expect(cache.has('a')).toBe(false)
    })

    test('REGR-LRU-002: onEvict 抛出异常不应中止淘汰且不应污染 set', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const cache = new LRUCache<string, number>({
        capacity: 2,
        onEvict: () => {
          throw new Error('evict callback failed')
        },
      })

      cache.set('a', 1)
      cache.set('b', 2)
      // 触发淘汰且回调抛错：set 应正常完成，容量不超限
      expect(() => cache.set('c', 3)).not.toThrow()
      expect(cache.size()).toBe(2)
      expect(cache.has('a')).toBe(false)
      expect(cache.get('c')).toBe(3)
      consoleErrorSpy.mockRestore()
    })
  })
})

// ==================== #24/#25/#26 修复回归 ====================
describe('LRUCache 防护与统计口径回归', () => {
  it('#24: NaN/Infinity 容量回退默认容量，不会变成无界缓存', () => {
    const cache = new LRUCache<string, number>({ capacity: NaN })
    expect(cache.getCapacity()).toBe(100)

    for (let i = 0; i < 150; i++) {
      cache.set(`k${i}`, i)
    }
    expect(cache.size()).toBe(100)

    const infCache = new LRUCache<string, number>({ capacity: Infinity })
    expect(infCache.getCapacity()).toBe(100)
  })

  it('#24: resize(NaN) 保持容量不变', () => {
    const cache = new LRUCache<string, number>(5)
    cache.resize(NaN)
    expect(cache.getCapacity()).toBe(5)
  })

  it('#25: forEach 回调中删除当前节点不中断遍历', () => {
    const cache = new LRUCache<string, number>(10)
    cache.set('a', 1).set('b', 2).set('c', 3)

    const seen: string[] = []
    cache.forEach((_v, k) => {
      seen.push(k)
      cache.delete(k)
    })

    // 迭代顺序为最近使用优先（head 侧）：set a→b→c 后遍历序为 c、b、a
    expect(seen).toEqual(['c', 'b', 'a'])
    expect(cache.size()).toBe(0)
  })

  it('#26: getOrSet 未命中计入 miss 统计', () => {
    const cache = new LRUCache<string, number>({ capacity: 10 })
    cache.getOrSet('k1', () => 1)
    expect(cache.getStats().misses).toBe(1)

    cache.getOrSet('k1', () => 2)
    expect(cache.getStats().hits).toBe(1)
  })

  it('#26: missRate 与 hits/misses 计数一致', () => {
    const cache = new LRUCache<string, number>({ capacity: 10 })
    cache.set('hit', 1)
    cache.get('hit') // hit
    cache.get('m1')
    cache.get('m2')
    cache.get('m3')

    const stats = cache.getStats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(3)
    expect(stats.missRate).toBe(75)
  })
})
