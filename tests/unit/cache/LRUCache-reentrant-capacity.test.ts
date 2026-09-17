import { LRUCache } from '@/core/cache/LRUCache.js'

describe('LRUCache capacity invariant under reentrant callbacks', () => {
  it('resize leaves the cache within the new capacity when onEvict re-enters set', () => {
    let reentered = false
    const cache = new LRUCache<string, number>({
      capacity: 3,
      onEvict: () => {
        if (!reentered) {
          reentered = true
          cache.set('replacement', 4)
        }
      },
    })
    cache.set('a', 1).set('b', 2).set('c', 3)

    cache.resize(1)

    expect(cache.size()).toBeLessThanOrEqual(1)
    // 后续写入也必须维持新容量
    cache.set('d', 5)
    cache.set('e', 6)
    expect(cache.size()).toBeLessThanOrEqual(1)
  })

  it('set trims until within capacity even when onEvict adds entries', () => {
    let added = 0
    const cache = new LRUCache<string, number>({
      capacity: 2,
      onEvict: () => {
        if (added < 1) {
          added++
          cache.set(`extra${added}`, added)
        }
      },
    })
    cache.set('a', 1).set('b', 2)
    cache.set('c', 3)

    expect(cache.size()).toBeLessThanOrEqual(2)
  })
})
