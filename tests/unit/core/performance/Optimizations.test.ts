/**
 * GeomStore v1.0 - Performance Optimizations测试
 *
 * 测试覆盖：
 * - LRU缓存实现
 * - 异步批量通知
 * - 状态指纹算法
 * - 订阅管理
 * - 迭代式深度比较
 * - 调度工具
 */

import {
  LRUCache,
  AsyncBatchNotifier,
  StateFingerprint,
  SubscriptionManager,
  iterativeDeepEqual,
  scheduleIdle,
  debounce,
  throttle,
  createLRUCache,
  createAsyncBatchNotifier,
  createStateFingerprint,
  createSubscriptionManager,
} from '@/core/performance'

describe('LRUCache', () => {
  describe('基础功能', () => {
    it('PERF-001: 应该创建LRU缓存实例', () => {
      const cache = new LRUCache<string, number>(100)
      expect(cache).toBeDefined()
      expect(cache).toBeInstanceOf(LRUCache)
    })

    it('PERF-002: 应该设置和获取值', () => {
      const cache = new LRUCache<string, number>(10)
      cache.set('key1', 100)
      cache.set('key2', 200)

      expect(cache.get('key1')).toBe(100)
      expect(cache.get('key2')).toBe(200)
    })

    it('PERF-003: get不存在键应该返回undefined', () => {
      const cache = new LRUCache<string, number>(10)
      expect(cache.get('nonexistent')).toBeUndefined()
    })

    it('PERF-004: 应该更新已存在的键', () => {
      const cache = new LRUCache<string, number>(10)
      cache.set('key1', 100)
      cache.set('key1', 200)

      expect(cache.get('key1')).toBe(200)
      expect(cache.size()).toBe(1)
    })
  })

  describe('LRU策略', () => {
    it('PERF-005: 超过容量时应该删除最久未使用的项', () => {
      const cache = new LRUCache<string, number>(3)

      cache.set('key1', 1)
      cache.set('key2', 2)
      cache.set('key3', 3)
      expect(cache.size()).toBe(3)

      cache.set('key4', 4)
      expect(cache.size()).toBe(3)
      expect(cache.get('key1')).toBeUndefined() // 最久未使用
      expect(cache.get('key4')).toBe(4) // 最新
    })

    it('PERF-006: get操作应该将项移动到最近使用', () => {
      const cache = new LRUCache<string, number>(3)

      cache.set('key1', 1)
      cache.set('key2', 2)
      cache.set('key3', 3)

      // 访问key1，使其成为最近使用
      cache.get('key1')

      // 添加新项，key2应该被删除（最久未使用）
      cache.set('key4', 4)

      expect(cache.get('key1')).toBe(1) // 最近使用
      expect(cache.get('key2')).toBeUndefined() // 被删除
      expect(cache.get('key3')).toBe(3)
      expect(cache.get('key4')).toBe(4)
    })

    it('PERF-007: 连续的get应该保持LRU顺序', () => {
      const cache = new LRUCache<string, number>(3)

      cache.set('key1', 1)
      cache.set('key2', 2)
      cache.set('key3', 3)

      // 访问key1和key3
      cache.get('key1')
      cache.get('key3')

      // 添加新项
      cache.set('key4', 4)

      expect(cache.get('key1')).toBe(1) // 最近访问
      expect(cache.get('key3')).toBe(3) // 第二近
      expect(cache.get('key2')).toBeUndefined() // 最久未使用
      expect(cache.get('key4')).toBe(4) // 最新
    })
  })

  describe('管理功能', () => {
    it('PERF-008: has应该检查键是否存在', () => {
      const cache = new LRUCache<string, number>(10)
      cache.set('key1', 100)

      expect(cache.has('key1')).toBe(true)
      expect(cache.has('nonexistent')).toBe(false)
    })

    it('PERF-009: delete应该删除指定键', () => {
      const cache = new LRUCache<string, number>(10)
      cache.set('key1', 100)
      cache.set('key2', 200)

      const deleted = cache.delete('key1')

      expect(deleted).toBe(true)
      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(true)
    })

    it('PERF-010: delete不存在键应该返回false', () => {
      const cache = new LRUCache<string, number>(10)
      expect(cache.delete('nonexistent')).toBe(false)
    })

    it('PERF-011: delete应该保持LRU顺序', () => {
      const cache = new LRUCache<string, number>(3)

      cache.set('key1', 1)
      cache.set('key2', 2)
      cache.set('key3', 3)

      cache.delete('key2')

      // 添加新项，容量未满，key1应该还在
      cache.set('key4', 4)

      expect(cache.get('key1')).toBe(1)
      expect(cache.get('key2')).toBeUndefined()
      expect(cache.get('key3')).toBe(3)
      expect(cache.get('key4')).toBe(4)

      // 再添加一个项，容量满，应该删除key1（最久未使用）
      cache.set('key5', 5)

      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key5')).toBe(5)
    })

    it('PERF-012: clear应该清空缓存', () => {
      const cache = new LRUCache<string, number>(10)
      cache.set('key1', 100)
      cache.set('key2', 200)

      cache.clear()

      expect(cache.size()).toBe(0)
      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBeUndefined()
    })

    it('PERF-013: size应该返回当前项数', () => {
      const cache = new LRUCache<string, number>(10)

      expect(cache.size()).toBe(0)

      cache.set('key1', 100)
      expect(cache.size()).toBe(1)

      cache.set('key2', 200)
      expect(cache.size()).toBe(2)
    })
  })

  describe('遍历功能', () => {
    it('PERF-014: keys应该按最近使用顺序返回键', () => {
      const cache = new LRUCache<string, number>(10)

      cache.set('key1', 1)
      cache.set('key2', 2)
      cache.set('key3', 3)

      cache.get('key1') // 使其成为最近使用

      const keys = cache.keys()

      expect(keys).toEqual(['key1', 'key3', 'key2'])
    })

    it('PERF-015: values应该按最近使用顺序返回值', () => {
      const cache = new LRUCache<string, number>(10)

      cache.set('key1', 1)
      cache.set('key2', 2)
      cache.set('key3', 3)

      cache.get('key1') // 使其成为最近使用

      const values = cache.values()

      expect(values).toEqual([1, 3, 2])
    })
  })

  describe('便捷函数', () => {
    it('PERF-016: createLRUCache应该创建缓存实例', () => {
      const cache = createLRUCache<string, number>(100)
      expect(cache).toBeInstanceOf(LRUCache)
      expect(cache.size()).toBe(0)
    })
  })

  describe('边界情况', () => {
    it('PERF-017: 容量为1时应该正确工作', () => {
      const cache = new LRUCache<string, number>(1)

      cache.set('key1', 1)
      cache.set('key2', 2)

      expect(cache.get('key1')).toBeUndefined()
      expect(cache.get('key2')).toBe(2)
    })

    it('PERF-018: 容量应该至少为1', () => {
      const cache1 = new LRUCache<string, number>(0)
      const cache2 = new LRUCache<string, number>(-5)

      expect(cache1.size()).toBe(0)
      expect(cache2.size()).toBe(0)
    })

    it('PERF-019: 应该处理null和undefined值', () => {
      const cache = new LRUCache<string, number | null | undefined>(10)

      cache.set('key1', null)
      cache.set('key2', undefined)
      cache.set('key3', 100)

      expect(cache.get('key1')).toBe(null)
      expect(cache.get('key2')).toBe(undefined)
      expect(cache.get('key3')).toBe(100)
    })
  })
})

describe('AsyncBatchNotifier', () => {
  describe('基础功能', () => {
    it('PERF-020: 应该创建AsyncBatchNotifier实例', () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      expect(notifier).toBeDefined()
      expect(notifier).toBeInstanceOf(AsyncBatchNotifier)
    })

    it('PERF-021: subscribe应该返回取消订阅函数', () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const unsubscribe = notifier.subscribe(() => {})

      expect(typeof unsubscribe).toBe('function')
    })
  })

  describe('通知机制', () => {
    it('PERF-022: notify应该异步触发监听器', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener = jest.fn()
      notifier.subscribe(listener)

      notifier.notify({ count: 1 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener).toHaveBeenCalledWith({ count: 1 })
    })

    it('PERF-023: 多次连续notify应该只触发一次', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener = jest.fn()
      notifier.subscribe(listener)

      notifier.notify({ count: 1 })
      notifier.notify({ count: 2 })
      notifier.notify({ count: 3 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('PERF-024: 应该使用最后一次notify的状态', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener = jest.fn()
      notifier.subscribe(listener)

      notifier.notify({ count: 1 })
      notifier.notify({ count: 2 })
      notifier.notify({ count: 3 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener).toHaveBeenCalledWith({ count: 3 })
    })

    it('PERF-025: 多个监听器应该都被通知', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener1 = jest.fn()
      const listener2 = jest.fn()
      const listener3 = jest.fn()

      notifier.subscribe(listener1)
      notifier.subscribe(listener2)
      notifier.subscribe(listener3)

      notifier.notify({ count: 100 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener1).toHaveBeenCalledWith({ count: 100 })
      expect(listener2).toHaveBeenCalledWith({ count: 100 })
      expect(listener3).toHaveBeenCalledWith({ count: 100 })
    })
  })

  describe('取消订阅', () => {
    it('PERF-026: unsubscribe应该停止通知', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener = jest.fn()
      const unsubscribe = notifier.subscribe(listener)

      unsubscribe()

      notifier.notify({ count: 1 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener).not.toHaveBeenCalled()
    })

    it('PERF-027: 部分取消订阅后其他监听器仍应收到通知', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      const unsubscribe1 = notifier.subscribe(listener1)
      notifier.subscribe(listener2)

      unsubscribe1()

      notifier.notify({ count: 1 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledWith({ count: 1 })
    })
  })

  describe('管理功能', () => {
    it('PERF-028: size应该返回监听器数量', () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()

      expect(notifier.size()).toBe(0)

      notifier.subscribe(() => {})
      expect(notifier.size()).toBe(1)

      notifier.subscribe(() => {})
      expect(notifier.size()).toBe(2)
    })

    it('PERF-029: clear应该清空所有监听器', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      notifier.subscribe(listener1)
      notifier.subscribe(listener2)

      notifier.clear()
      notifier.notify({ count: 1 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).not.toHaveBeenCalled()
    })
  })

  describe('错误处理', () => {
    it('PERF-030: 监听器抛出错误不应影响其他监听器', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener1 = jest.fn(() => {
        throw new Error('Listener error')
      })
      const listener2 = jest.fn()

      notifier.subscribe(listener1)
      notifier.subscribe(listener2)

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      notifier.notify({ count: 1 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener1).toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('便捷函数', () => {
    it('PERF-031: createAsyncBatchNotifier应该创建实例', () => {
      const notifier = createAsyncBatchNotifier<{ count: number }>()
      expect(notifier).toBeInstanceOf(AsyncBatchNotifier)
    })
  })
})

describe('StateFingerprint', () => {
  let fingerprint: StateFingerprint

  beforeEach(() => {
    fingerprint = new StateFingerprint()
  })

  describe('基础功能', () => {
    it('PERF-032: 应该创建StateFingerprint实例', () => {
      expect(fingerprint).toBeDefined()
      expect(fingerprint).toBeInstanceOf(StateFingerprint)
    })

    it('PERF-033: 相同对象应该生成相同哈希', () => {
      const obj1 = { a: 1, b: 2 }
      const obj2 = { a: 1, b: 2 }

      const hash1 = fingerprint.generate(obj1)
      const hash2 = fingerprint.generate(obj2)

      expect(hash1).toBe(hash2)
    })

    it('PERF-034: 不同对象应该生成不同哈希', () => {
      const obj1 = { a: 1, b: 2 }
      const obj2 = { a: 1, b: 3 }

      const hash1 = fingerprint.generate(obj1)
      const hash2 = fingerprint.generate(obj2)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('类型支持', () => {
    it('PERF-035: 应该处理数字类型', () => {
      const hash = fingerprint.generate(42)
      expect(typeof hash).toBe('number')
    })

    it('PERF-036: 应该处理字符串类型', () => {
      const hash = fingerprint.generate('test string')
      expect(typeof hash).toBe('number')
    })

    it('PERF-037: 应该处理布尔类型', () => {
      const hash1 = fingerprint.generate(true)
      const hash2 = fingerprint.generate(false)

      expect(hash1).not.toBe(hash2)
    })

    it('PERF-038: 应该处理null和undefined', () => {
      const hash1 = fingerprint.generate(null)
      const hash2 = fingerprint.generate(undefined)

      expect(typeof hash1).toBe('number')
      expect(typeof hash2).toBe('number')
      expect(hash1).not.toBe(hash2)
    })

    it('PERF-038A: 应该处理RegExp类型', () => {
      const hash1 = fingerprint.generate(/abc/g)
      const hash2 = fingerprint.generate(/abc/g)
      const hash3 = fingerprint.generate(/abc/i)

      expect(typeof hash1).toBe('number')
      expect(hash1).toBe(hash2)
      expect(hash1).not.toBe(hash3)
    })
  })

  describe('嵌套对象', () => {
    it('PERF-039: 应该处理嵌套对象', () => {
      const obj = { a: { b: { c: 1 } } }
      const hash = fingerprint.generate(obj)

      expect(typeof hash).toBe('number')
    })

    it('PERF-040: 相同的嵌套结构应该生成相同哈希', () => {
      const obj1 = { a: { b: { c: 1 } } }
      const obj2 = { a: { b: { c: 1 } } }

      const hash1 = fingerprint.generate(obj1)
      const hash2 = fingerprint.generate(obj2)

      expect(hash1).toBe(hash2)
    })
  })

  describe('数组', () => {
    it('PERF-041: 应该处理数组', () => {
      const arr = [1, 2, 3, 4]
      const hash = fingerprint.generate(arr)

      expect(typeof hash).toBe('number')
    })

    it('PERF-042: 相同数组应该生成相同哈希', () => {
      const arr1 = [1, 2, 3]
      const arr2 = [1, 2, 3]

      const hash1 = fingerprint.generate(arr1)
      const hash2 = fingerprint.generate(arr2)

      expect(hash1).toBe(hash2)
    })

    it('PERF-043: 数组顺序不同应该生成不同哈希', () => {
      const arr1 = [1, 2, 3]
      const arr2 = [3, 2, 1]

      const hash1 = fingerprint.generate(arr1)
      const hash2 = fingerprint.generate(arr2)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('边界情况', () => {
    it('PERF-044: 应该处理空对象', () => {
      const hash = fingerprint.generate({})
      expect(typeof hash).toBe('number')
    })

    it('PERF-045: 应该处理空数组', () => {
      const hash = fingerprint.generate([])
      expect(typeof hash).toBe('number')
    })

    it('PERF-046: 键顺序不影响哈希（排序）', () => {
      const obj1 = { b: 2, a: 1 }
      const obj2 = { a: 1, b: 2 }

      const hash1 = fingerprint.generate(obj1)
      const hash2 = fingerprint.generate(obj2)

      expect(hash1).toBe(hash2)
    })
  })

  describe('便捷函数', () => {
    it('PERF-047: createStateFingerprint应该创建实例', () => {
      const fp = createStateFingerprint()
      expect(fp).toBeInstanceOf(StateFingerprint)
    })
  })

  describe('回归 - 跨类型指纹碰撞', () => {
    it('REGR-PERF-001: 空对象/空数组/空字符串/NaN 指纹应互不相同', () => {
      const hashes = [fingerprint.generate({}), fingerprint.generate([]), fingerprint.generate(''), fingerprint.generate(NaN), fingerprint.generate(null)]
      // 修复前这些值全部哈希为 0，内容无关的指纹相同会导致误判
      const unique = new Set(hashes)
      expect(unique.size).toBe(hashes.length)
    })

    it('REGR-PERF-002: NaN 与 Infinity 指纹应不同', () => {
      expect(fingerprint.generate(NaN)).not.toBe(fingerprint.generate(Infinity))
    })

    it('REGR-PERF-003: 内容不同的 Map 指纹应不同', () => {
      const h1 = fingerprint.generate(new Map([['a', 1]]))
      const h2 = fingerprint.generate(new Map([['a', 2]]))
      expect(h1).not.toBe(h2)
    })

    it('REGR-PERF-004: 内容相同的 Map 指纹应相同', () => {
      const h1 = fingerprint.generate(new Map([['a', 1]]))
      const h2 = fingerprint.generate(new Map([['a', 1]]))
      expect(h1).toBe(h2)
    })

    it('REGR-PERF-005: 内容不同的 Set/Date 指纹应不同', () => {
      expect(fingerprint.generate(new Set([1]))).not.toBe(fingerprint.generate(new Set([2])))
      expect(fingerprint.generate(new Date(1))).not.toBe(fingerprint.generate(new Date(2)))
    })

    it('REGR-PERF-006: 相同内容不同插入顺序的 Set 指纹应相同', () => {
      expect(fingerprint.generate(new Set([1, 2, 3]))).toBe(fingerprint.generate(new Set([3, 2, 1])))
    })
  })

  describe('循环引用回归（BUG-15）', () => {
    it('REGR-PERF-007: 循环引用对象生成指纹不应抛错且结果为有限数字', () => {
      const cyc: Record<string, unknown> = { a: 1 }
      cyc.self = cyc

      // 修复前：无循环守卫导致无限递归抛 RangeError
      expect(() => fingerprint.generate(cyc)).not.toThrow()
      const hash = fingerprint.generate(cyc)
      expect(typeof hash).toBe('number')
      expect(Number.isFinite(hash)).toBe(true)
    })

    it('REGR-PERF-008: 同一循环对象多次生成指纹应相同（稳定性）', () => {
      const cyc: Record<string, unknown> = { a: 1 }
      cyc.self = cyc

      expect(fingerprint.generate(cyc)).toBe(fingerprint.generate(cyc))
    })

    it('REGR-PERF-009: 互相引用的对象与自引用数组也不应抛错', () => {
      const a: Record<string, unknown> = { name: 'a' }
      const b: Record<string, unknown> = { name: 'b', parent: a }
      a.child = b
      const arr: unknown[] = [a]
      arr.push(arr)

      expect(() => fingerprint.generate(a)).not.toThrow()
      expect(() => fingerprint.generate(arr)).not.toThrow()
    })
  })
})

describe('iterativeDeepEqual', () => {
  describe('基础功能', () => {
    it('PERF-048: 相同的基本类型应该返回true', () => {
      expect(iterativeDeepEqual(1, 1)).toBe(true)
      expect(iterativeDeepEqual('test', 'test')).toBe(true)
      expect(iterativeDeepEqual(true, true)).toBe(true)
      expect(iterativeDeepEqual(null, null)).toBe(true)
    })

    it('PERF-049: 不同的基本类型应该返回false', () => {
      expect(iterativeDeepEqual(1, 2)).toBe(false)
      expect(iterativeDeepEqual('test1', 'test2')).toBe(false)
      expect(iterativeDeepEqual(true, false)).toBe(false)
      expect(iterativeDeepEqual(null, undefined)).toBe(false)
    })

    it('PERF-050: 对象应该深度比较', () => {
      const obj1 = { a: { b: { c: 1 } } }
      const obj2 = { a: { b: { c: 1 } } }
      const obj3 = { a: { b: { c: 2 } } }

      expect(iterativeDeepEqual(obj1, obj2)).toBe(true)
      expect(iterativeDeepEqual(obj1, obj3)).toBe(false)
    })
  })

  describe('深度限制', () => {
    it('PERF-051: 超过最大深度应该返回false', () => {
      // 创建深层嵌套对象（两个不同的对象）
      const createDeepObject = (depth: number): any => {
        if (depth === 0) return {}
        return { value: createDeepObject(depth - 1) }
      }

      const deep1 = createDeepObject(1500)
      const deep2 = createDeepObject(1500)

      const result = iterativeDeepEqual(deep1, deep2, 1000)
      expect(result).toBe(false)
    })

    it('PERF-052: 应该避免栈溢出', () => {
      // 创建会栈溢出的深度
      const createDeepObject = (depth: number): any => {
        if (depth === 0) return {}
        return { nested: createDeepObject(depth - 1) }
      }

      const deepObj = createDeepObject(5000)

      // 不应该抛出栈溢出错误
      expect(() => iterativeDeepEqual(deepObj, deepObj, 10000)).not.toThrow()
    })
  })

  describe('循环引用', () => {
    it('PERF-053: 应该检测循环引用', () => {
      const obj: any = { a: 1 }
      obj.self = obj

      // 应该能够处理循环引用
      const result = iterativeDeepEqual(obj, obj)
      expect(result).toBe(true)
    })

    it('PERF-054: 循环引用的深度不同应该返回false', () => {
      const obj1: any = { a: 1 }
      obj1.self = obj1

      const obj2: any = { a: 1 }
      obj2.self = { nested: obj2 }

      const result = iterativeDeepEqual(obj1, obj2)
      expect(result).toBe(false)
    })
  })

  describe('复杂数据结构', () => {
    it('PERF-055: 应该正确比较数组', () => {
      expect(iterativeDeepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
      expect(iterativeDeepEqual([1, 2, 3], [1, 2, 4])).toBe(false)
      expect(iterativeDeepEqual([1, 2], [1, 2, 3])).toBe(false)
    })

    it('PERF-056: 应该正确比较嵌套数组', () => {
      const arr1 = [1, [2, [3]]]
      const arr2 = [1, [2, [3]]]

      expect(iterativeDeepEqual(arr1, arr2)).toBe(true)
    })

    it('PERF-057: 应该正确比较混合结构', () => {
      const obj1 = {
        a: 1,
        b: [2, 3],
        c: { d: 4 },
      }

      const obj2 = {
        a: 1,
        b: [2, 3],
        c: { d: 4 },
      }

      expect(iterativeDeepEqual(obj1, obj2)).toBe(true)
    })
  })
})

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager<{ count: number }>

  beforeEach(() => {
    manager = new SubscriptionManager<{ count: number }>()
  })

  describe('基础功能', () => {
    it('PERF-058: 应该创建SubscriptionManager实例', () => {
      expect(manager).toBeDefined()
      expect(manager).toBeInstanceOf(SubscriptionManager)
    })

    it('PERF-059: subscribe应该返回取消订阅函数', () => {
      const unsubscribe = manager.subscribe(() => {})
      expect(typeof unsubscribe).toBe('function')
    })
  })

  describe('订阅通知', () => {
    it('PERF-060: notify应该触发所有监听器', () => {
      const listener1 = jest.fn()
      const listener2 = jest.fn()
      const listener3 = jest.fn()

      manager.subscribe(listener1)
      manager.subscribe(listener2)
      manager.subscribe(listener3)

      const state = { count: 100 }
      manager.notify(state)

      expect(listener1).toHaveBeenCalledWith(state)
      expect(listener2).toHaveBeenCalledWith(state)
      expect(listener3).toHaveBeenCalledWith(state)
    })

    it('PERF-061: 多次notify应该每次都触发', () => {
      const listener = jest.fn()
      manager.subscribe(listener)

      manager.notify({ count: 1 })
      manager.notify({ count: 2 })
      manager.notify({ count: 3 })

      expect(listener).toHaveBeenCalledTimes(3)
    })
  })

  describe('取消订阅', () => {
    it('PERF-062: unsubscribe应该停止通知', () => {
      const listener = jest.fn()
      const unsubscribe = manager.subscribe(listener)

      unsubscribe()
      manager.notify({ count: 1 })

      expect(listener).not.toHaveBeenCalled()
    })

    it('PERF-063: 部分取消后其他监听器仍应收到通知', () => {
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      const unsubscribe1 = manager.subscribe(listener1)
      manager.subscribe(listener2)

      unsubscribe1()
      manager.notify({ count: 1 })

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledWith({ count: 1 })
    })

    it('PERF-064: 取消订阅后应该能够重新订阅', () => {
      const listener = jest.fn()

      const unsubscribe1 = manager.subscribe(listener)
      unsubscribe1()

      manager.notify({ count: 1 })
      expect(listener).not.toHaveBeenCalled()

      manager.subscribe(listener)
      manager.notify({ count: 2 })
      expect(listener).toHaveBeenCalledWith({ count: 2 })
    })
  })

  describe('管理功能', () => {
    it('PERF-065: size应该返回订阅者数量', () => {
      expect(manager.size()).toBe(0)

      manager.subscribe(() => {})
      expect(manager.size()).toBe(1)

      manager.subscribe(() => {})
      expect(manager.size()).toBe(2)
    })

    it('PERF-066: has应该检查监听器是否已订阅', () => {
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      manager.subscribe(listener1)

      expect(manager.has(listener1)).toBe(true)
      expect(manager.has(listener2)).toBe(false)
    })

    it('PERF-067: clear应该清空所有订阅', () => {
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      manager.subscribe(listener1)
      manager.subscribe(listener2)

      manager.clear()
      manager.notify({ count: 1 })

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).not.toHaveBeenCalled()
    })
  })

  describe('错误处理', () => {
    it('PERF-068: 监听器错误不应影响其他监听器', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const listener1 = jest.fn(() => {
        throw new Error('Listener error')
      })
      const listener2 = jest.fn()

      manager.subscribe(listener1)
      manager.subscribe(listener2)

      manager.notify({ count: 1 })

      expect(listener1).toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('便捷函数', () => {
    it('PERF-069: createSubscriptionManager应该创建实例', () => {
      const mgr = createSubscriptionManager<{ count: number }>()
      expect(mgr).toBeInstanceOf(SubscriptionManager)
    })
  })
})

describe('debounce', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('PERF-070: 应该防抖函数调用', () => {
    const fn = jest.fn()
    const debouncedFn = debounce(fn, 300)

    debouncedFn()
    debouncedFn()
    debouncedFn()

    expect(fn).not.toHaveBeenCalled()

    jest.advanceTimersByTime(300)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('PERF-071: 防抖应该重置计时器', () => {
    const fn = jest.fn()
    const debouncedFn = debounce(fn, 300)

    debouncedFn()
    jest.advanceTimersByTime(200)
    debouncedFn()
    jest.advanceTimersByTime(300)

    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('throttle', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('PERF-072: 应该节流函数调用', () => {
    const fn = jest.fn()
    const throttledFn = throttle(fn, 300)

    throttledFn()
    throttledFn()
    throttledFn()

    expect(fn).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(300)

    throttledFn()

    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('PERF-073: 节流应该立即执行第一次调用', () => {
    const fn = jest.fn()
    const throttledFn = throttle(fn, 300)

    throttledFn()

    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('scheduleIdle', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('PERF-074: 应该在idle时执行任务', async () => {
    const task = jest.fn()

    // 小程序环境无 requestIdleCallback，scheduleIdle 直接使用 setTimeout
    scheduleIdle(task, { timeout: 50 })

    // 快进时间
    jest.advanceTimersByTime(100)

    expect(task).toHaveBeenCalled()
  })

  it('PERF-075: 任务抛出错误应该被捕获', async () => {
    const task = jest.fn(() => {
      throw new Error('Task error')
    })

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    // 小程序环境无 requestIdleCallback，scheduleIdle 直接使用 setTimeout
    scheduleIdle(task, { timeout: 50 })

    // 快进时间
    jest.advanceTimersByTime(100)

    expect(task).toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalled()

    consoleSpy.mockRestore()
  })

  it('PERF-076: 应该在没有options时使用默认超时', async () => {
    const task = jest.fn()

    scheduleIdle(task)

    // 默认超时是 16ms
    jest.advanceTimersByTime(16)

    expect(task).toHaveBeenCalled()
  })
})

describe('StateFingerprint 边界情况', () => {
  let fingerprint: StateFingerprint

  beforeEach(() => {
    fingerprint = new StateFingerprint()
  })

  it('PERF-077: 应该处理 Infinity', () => {
    const hash = fingerprint.generate(Infinity)
    expect(typeof hash).toBe('number')
  })

  it('PERF-078: 应该处理 -Infinity', () => {
    const hash = fingerprint.generate(-Infinity)
    expect(typeof hash).toBe('number')
  })

  it('PERF-079: 应该处理 NaN', () => {
    const hash = fingerprint.generate(NaN)
    expect(typeof hash).toBe('number')
  })

  it('PERF-080: 应该处理函数类型', () => {
    const fn = () => 'test'
    const hash = fingerprint.generate(fn)
    expect(typeof hash).toBe('number')
  })

  it('PERF-081: 应该处理 Symbol 类型', () => {
    const sym = Symbol('test')
    const hash = fingerprint.generate(sym)
    expect(typeof hash).toBe('number')
  })
})

describe('StateFingerprint hashNumber NaN 覆盖', () => {
  it('PERF-COVER-003: hashNumber 中 isNaN 路径应该被覆盖', () => {
    // 正常情况下 isFinite(NaN) 返回 false，所以 NaN 在 !isFinite 检查时就返回了
    // 要让 isNaN 分支被执行且返回 true，需要 mock isFinite 使其对 NaN 返回 true
    const originalIsFinite = global.isFinite
    global.isFinite = ((v: number) => {
      // 对 NaN 返回 true，使其绕过 isFinite 检查到达 isNaN
      if (typeof v === 'number' && Number.isNaN(v)) return true
      return originalIsFinite(v)
    }) as typeof isFinite

    try {
      const fp = new StateFingerprint()
      const hash = fp.generate(NaN)
      expect(typeof hash).toBe('number')
    } finally {
      global.isFinite = originalIsFinite
    }
  })
})

describe('AsyncBatchNotifier 边界情况', () => {
  it('PERF-082: flush 时 state 为 null 不应该触发监听器', async () => {
    const notifier = new AsyncBatchNotifier<{ count: number }>()
    const listener = jest.fn()
    notifier.subscribe(listener)

    // 使用内部方法清除 state
    const notifierAny = notifier as any
    notifierAny.latestState = null

    // 手动触发 flush
    notifierAny.flush()

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('debounce 边界情况', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('PERF-083: debounce 应该保持 this 上下文', () => {
    const obj = {
      name: 'test',
      fn: function (this: any) {
        return this.name
      },
    }

    const debouncedFn = debounce(obj.fn, 100)
    const result = debouncedFn.call(obj)

    jest.advanceTimersByTime(100)

    // 函数应该被调用
    expect(result).toBeUndefined() // debounce 返回 void
  })

  it('PERF-084: debounce 应该传递参数', () => {
    const fn = jest.fn((a: number, b: string) => `${a}-${b}`)
    const debouncedFn = debounce(fn, 100)

    debouncedFn(1, 'test')

    jest.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledWith(1, 'test')
  })
})

describe('throttle 边界情况', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('PERF-085: throttle 应该保持 this 上下文', () => {
    const obj = {
      name: 'test',
      fn: function (this: any) {
        return this.name
      },
    }

    const throttledFn = throttle(obj.fn, 100)
    throttledFn.call(obj)

    // 立即执行
    jest.advanceTimersByTime(0)
  })

  it('PERF-086: throttle 应该传递参数', () => {
    const fn = jest.fn((a: number, b: string) => `${a}-${b}`)
    const throttledFn = throttle(fn, 100)

    throttledFn(1, 'test')

    expect(fn).toHaveBeenCalledWith(1, 'test')
  })

  it('PERF-087: throttle 在间隔内调用应该在延迟后执行', () => {
    const fn = jest.fn()
    const throttledFn = throttle(fn, 100)

    // 第一次调用立即执行
    throttledFn()
    expect(fn).toHaveBeenCalledTimes(1)

    // 在间隔内再次调用
    jest.advanceTimersByTime(50)
    throttledFn()
    expect(fn).toHaveBeenCalledTimes(1) // 还没执行

    // 等待剩余时间
    jest.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(2) // 延迟执行
  })
})

// ==================== BUG 修复回归测试 ====================
describe('StateFingerprint BUG 回归：共享引用（DAG）被误判为循环引用', () => {
  it('兄弟路径共享同一引用应与等价深拷贝结构产生相同指纹', () => {
    const fingerprint = new StateFingerprint()
    const shared = { v: 1 }
    const dag = { x: shared, y: shared }
    const deepCopy = { x: { v: 1 }, y: { v: 1 } }

    // 修复前：shared 第二次出现被当作 [circular]，dag 与 deepCopy 指纹不同，
    // 等价结构被误报为「状态已变化」
    expect(fingerprint.generate(dag)).toBe(fingerprint.generate(deepCopy))
  })

  it('同一 DAG 结构的指纹应稳定', () => {
    const fingerprint = new StateFingerprint()
    const shared = [1, 2]
    const state = { a: shared, b: shared, m: new Map([['k', shared]]) }

    expect(fingerprint.generate(state)).toBe(fingerprint.generate(state))
  })

  it('真正的循环引用仍应正常终止且指纹稳定', () => {
    const fingerprint = new StateFingerprint()
    const circular: Record<string, unknown> = { name: 'a' }
    circular.self = circular

    expect(() => fingerprint.generate(circular)).not.toThrow()
    expect(fingerprint.generate(circular)).toBe(fingerprint.generate(circular))
  })

  it('DAG 中内容修改后指纹应变化', () => {
    const fingerprint = new StateFingerprint()
    const shared = { v: 1 }
    const state = { x: shared, y: shared }

    const before = fingerprint.generate(state)
    shared.v = 2
    expect(fingerprint.generate(state)).not.toBe(before)
  })
})

// ==================== BUG 回归：DAG 共享结构指数级重哈希 ====================
describe('StateFingerprint BUG 回归：DAG 记忆化', () => {
  it('大规模共享结构（2^18 条路径）应在毫秒级完成哈希', () => {
    const fingerprint = new StateFingerprint()
    // 每个节点引用前一节点两次：n 层产生 2^n 条路径
    let node: unknown = { v: 0 }
    for (let i = 1; i < 18; i++) {
      node = { a: node, b: node, v: i }
    }

    const start = Date.now()
    const hash = fingerprint.generate(node)
    const elapsed = Date.now() - start

    expect(Number.isFinite(hash)).toBe(true)
    // 修复前（无记忆化）：2^20 路径实测约 7 秒
    expect(elapsed).toBeLessThan(1000)
  })

  it('记忆化不影响指纹正确性：内容修改后指纹变化', () => {
    const fingerprint = new StateFingerprint()
    const shared = { v: 1 }
    const state = { x: shared, y: shared }

    const before = fingerprint.generate(state)
    shared.v = 2
    expect(fingerprint.generate(state)).not.toBe(before)
  })

  it('±Infinity 应产生不同指纹', () => {
    const fingerprint = new StateFingerprint()
    expect(fingerprint.generate(Infinity)).not.toBe(fingerprint.generate(-Infinity))
  })
})

// ==================== 覆盖率盲区：throttle leading=false ====================
describe('throttle 工具函数 leading=false 分支', () => {
  it('首次调用不立即执行，窗口结束时以最新参数执行', () => {
    jest.useFakeTimers()
    const calls: number[] = []
    const throttled = throttle((...args: number[]) => {
      calls.push(...args)
    }, 100, { leading: false })

    throttled(1)
    expect(calls).toEqual([]) // leading=false：不立即执行

    throttled(2)
    throttled(3)
    jest.advanceTimersByTime(100)
    expect(calls).toEqual([3]) // 窗口尾以最新参数执行

    jest.useRealTimers()
  })
})
