/**
 * 第六轮 R6-033 回归锁：LRUCache.forEach 的迭代口径
 *
 * 修复前是「活指针遍历 + 预取当前节点的后继」，回调内删除/读取**非当前键**会同时产生
 * 两类静默失真：已删条目仍被回调一次（拿到缓存里已不存在的陈旧值），且后继被摘链后
 * `next === null` 让循环提前终止（剩余条目整体被跳过）。
 *
 * 本文件锁定修复后的新口径（与 `clear()` 一致的键快照语义）：
 * 1. 进入遍历先按当前链序取一份键快照，随后逐个按键取「回调时刻的当前值」；
 * 2. 回调内删除的键（无论是不是当前键）不再参与回调，其余键一个不丢；
 * 3. 回调内 `get` 其他键导致的 moveToHead 重排不改变本次访问集合与顺序；
 * 4. 回调内新写入的键本次不访问；
 * 5. 值不取快照：遍历期间被改写的条目以新值参与回调。
 */

import { LRUCache } from '@/core/cache/LRUCache.js'

/** MRU 链 d→c→b→a（set 顺序即访问顺序，最后写入者在链首） */
function buildCache(): LRUCache<string, number> {
  const cache = new LRUCache<string, number>(10)
  cache.set('a', 1).set('b', 2).set('c', 3).set('d', 4)
  return cache
}

describe('R6-033 LRUCache.forEach 迭代语义', () => {
  it('回调内删除紧邻的下一个键：已删条目不再被访问，其后条目不被截断', () => {
    const cache = buildCache()
    const seen: Array<[string, number]> = []

    cache.forEach((value, key) => {
      seen.push([key, value])
      if (key === 'd') {
        cache.delete('c')
      }
    })

    // 修复前实得 [['d',4],['c',3]]：c 已被删除却仍收到回调（陈旧值 3），且因
    // removeFromList 把 c.next 置 null 而提前终止，b / a 被静默跳过
    expect(seen).toEqual([
      ['d', 4],
      ['b', 2],
      ['a', 1],
    ])
    expect(cache.size()).toBe(3)
    expect(cache.keys()).toEqual(['d', 'b', 'a'])
  })

  it('回调内 get 其他键（触发 moveToHead 重排）：每个快照键恰好访问一次', () => {
    const cache = buildCache()
    const seen: string[] = []

    cache.forEach((_value, key) => {
      seen.push(key)
      if (key === 'd') {
        cache.get('a')
      }
    })

    // 修复前实得 ['d', 'c', 'b']：被移到链首的 a 永远不会被访问
    expect(seen).toEqual(['d', 'c', 'b', 'a'])
    expect(new Set(seen).size).toBe(4)
  })

  it('回调内删除当前键（既有口径）：不中断遍历', () => {
    const cache = buildCache()
    const seen: string[] = []

    cache.forEach((_value, key) => {
      seen.push(key)
      cache.delete(key)
    })

    expect(seen).toEqual(['d', 'c', 'b', 'a'])
    expect(cache.size()).toBe(0)
  })

  it('回调内 clear()：本次遍历不再访问任何剩余键', () => {
    const cache = buildCache()
    const seen: string[] = []

    cache.forEach((_value, key) => {
      seen.push(key)
      if (key === 'd') {
        cache.clear()
      }
    })

    expect(seen).toEqual(['d'])
    expect(cache.size()).toBe(0)
  })

  it('回调内新写入的键不参与本次遍历', () => {
    const cache = buildCache()
    const seen: string[] = []

    cache.forEach((_value, key) => {
      seen.push(key)
      cache.set('e', 5)
    })

    expect(seen).toEqual(['d', 'c', 'b', 'a'])
    expect(cache.has('e')).toBe(true)
  })

  it('值取回调时刻的当前值，不取进入遍历时的快照', () => {
    const cache = buildCache()
    const pairs: Array<[string, number | undefined]> = []

    cache.forEach((value, key) => {
      if (key === 'c') {
        cache.set('a', 111)
      }
      pairs.push([key, value])
    })

    expect(pairs).toEqual([
      ['d', 4],
      ['c', 3],
      ['b', 2],
      ['a', 111],
    ])
  })

  it('无 onEvict 回调、纯读取式遍历结果与 keys() 顺序一致', () => {
    const cache = buildCache()
    cache.get('b')

    const seen: string[] = []
    cache.forEach((_value, key) => seen.push(key))

    expect(seen).toEqual(cache.keys())
  })
})
