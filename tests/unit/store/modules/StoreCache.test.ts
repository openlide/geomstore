/**
 * StoreCache 模块测试
 * 目标覆盖率: 95%+
 */

import { StoreCacheManager } from '@/core/store/StoreCache.js'
import { LRUCache } from '@/core/cache/LRUCache.js'

describe('StoreCacheManager', () => {
  const createCacheManager = (ttl = 0) => {
    const cache = new LRUCache<'count' | 'name', string | number>({
      capacity: 100,
      enableStats: true,
    })
    return new StoreCacheManager<{ count: number; name: string }>({
      cache,
      ttl,
    })
  }

  describe('基本功能', () => {
    it('应该正确获取和设置缓存值', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }

      manager.enable(undefined, (key) => state[key], ['count', 'name'])

      // 获取缓存
      expect(manager.get('count', () => state.count)).toBe(1)
      expect(manager.get('name', () => state.name)).toBe('test')
    })

    it('应该在禁用时直接返回状态值', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }

      // 未启用缓存
      expect(manager.enabled).toBe(false)
      expect(manager.get('count', () => state.count)).toBe(1)
    })

    it('应该正确启用缓存', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }

      manager.enable(undefined, (key) => state[key], ['count', 'name'])
      expect(manager.enabled).toBe(true)
    })

    it('应该正确禁用缓存', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }

      manager.enable(undefined, (key) => state[key], ['count', 'name'])
      expect(manager.enabled).toBe(true)

      manager.disable()
      expect(manager.enabled).toBe(false)
    })
  })

  describe('缓存键过滤', () => {
    it('应该只缓存指定的键', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }

      // 只缓存 count
      manager.enable(['count'], (key) => state[key])

      // count 应该从缓存获取
      const countGetter = jest.fn(() => state.count)
      manager.get('count', countGetter)
      expect(countGetter).not.toHaveBeenCalled() // 使用了缓存

      // name 不在缓存键集合中，应该直接返回
      const nameGetter = jest.fn(() => state.name)
      manager.get('name', nameGetter)
      expect(nameGetter).toHaveBeenCalled() // 未使用缓存
    })

    it('REGR-CACHE-KEYS-001: 收窄键集后不应残留上一轮条目', () => {
      // 共享助手把 state 固定为 {count, name}，四键场景需自建同参数管理器
      const manager = new StoreCacheManager<{ a: number; b: number; c: number; d: number }>({
        cache: new LRUCache<'a' | 'b' | 'c' | 'd', number>({ capacity: 100, enableStats: true }),
        ttl: 0,
      })
      const state = { a: 1, b: 2, c: 3, d: 4 }

      manager.enable(undefined, (key) => state[key], ['a', 'b', 'c', 'd'])
      expect(manager.getStats().size).toBe(4)

      // 修复前：收窄到 ['a'] 后 b/c/d 仍留在 LRU 中占用容量（挤掉有效键）
      // 并被 getStats 报告，而 get() 已因 _cacheKeys 过滤永远读不到它们
      manager.enable(['a'], (key) => state[key])

      const stats = manager.getStats()
      expect(stats.size).toBe(1)
      expect(stats.keys).toEqual(['a'])

      // 新键集内的键仍能命中缓存
      const getter = jest.fn(() => state.a)
      manager.get('a', getter)
      expect(getter).not.toHaveBeenCalled()
    })
  })

  describe('TTL 过期', () => {
    it('应该在 TTL 过期后刷新缓存', async () => {
      const manager = createCacheManager(10) // 10ms TTL
      let countValue = 1

      manager.enable(undefined, () => countValue, ['count'])
      expect(manager.get('count', () => countValue)).toBe(1)

      // 等待 TTL 过期
      await new Promise((r) => setTimeout(r, 20))

      // 更新值
      countValue = 2

      // 应该获取新值（因为缓存已过期）
      expect(manager.get('count', () => countValue)).toBe(2)
    })

    it('应该在 TTL 未过期时返回缓存值', () => {
      const manager = createCacheManager(10000) // 10s TTL
      let countValue = 1

      manager.enable(undefined, () => countValue, ['count'])
      expect(manager.get('count', () => countValue)).toBe(1)

      // 更新值但不影响缓存
      countValue = 2

      // 应该返回缓存值
      expect(manager.get('count', () => countValue)).toBe(1)
    })

    it('应该在 TTL=0 时跳过时间戳操作', () => {
      const manager = createCacheManager(0) // TTL=0
      const state = { count: 1 }

      manager.enable(undefined, (key) => state[key], ['count'])

      // 获取缓存应该正常工作
      expect(manager.get('count', () => state.count)).toBe(1)

      // 再次获取应该返回缓存值
      expect(manager.get('count', () => state.count)).toBe(1)
    })

    it('应该在设置时记录时间戳（TTL > 0）', () => {
      const manager = createCacheManager(1000)
      const state = { count: 1 }

      manager.enable(undefined, (key) => state[key], ['count'])

      // 手动设置值
      manager.set('count', 5)
      expect(manager.get('count', () => state.count)).toBe(5)
    })
  })

  describe('set 和 delete', () => {
    it('应该正确设置缓存值', () => {
      const manager = createCacheManager()
      manager.enable(undefined, () => 0, ['count'])

      manager.set('count', 5)
      expect(manager.get('count', () => 0)).toBe(5)
    })

    it('在禁用时不应该设置缓存', () => {
      const manager = createCacheManager()
      // 未启用

      manager.set('count', 5)
      expect(manager.get('count', () => 0)).toBe(0)
    })
  })

  describe('invalidate', () => {
    it('应该清除指定键的缓存', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }

      manager.enable(undefined, (key) => state[key], ['count', 'name'])

      manager.invalidate('count')

      // count 缓存被清除，应该重新获取
      const countGetter = jest.fn(() => state.count)
      manager.get('count', countGetter)
      expect(countGetter).toHaveBeenCalled()
    })

    it('应该清除所有缓存', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }

      manager.enable(undefined, (key) => state[key], ['count', 'name'])

      manager.invalidate()

      // 所有缓存被清除
      const countGetter = jest.fn(() => state.count)
      const nameGetter = jest.fn(() => state.name)
      manager.get('count', countGetter)
      manager.get('name', nameGetter)
      expect(countGetter).toHaveBeenCalled()
      expect(nameGetter).toHaveBeenCalled()
    })
  })

  describe('getStats', () => {
    it('应该返回正确的缓存统计信息', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }

      manager.enable(undefined, (key) => state[key], ['count', 'name'])

      // 触发缓存命中
      manager.get('count', () => state.count)
      manager.get('count', () => state.count)

      const stats = manager.getStats()
      expect(stats.enabled).toBe(true)
      expect(stats.size).toBe(2)
    })
  })

  describe('覆盖率补充', () => {
    it('构造函数不传 ttl 时应默认为 0', () => {
      // 不传 ttl，覆盖 options.ttl ?? 0 的 ?? 分支
      const cache = new LRUCache<'count', number>({ capacity: 100, enableStats: true })
      const manager = new StoreCacheManager<{ count: number }>({ cache })
      const state = { count: 1 }

      manager.enable(undefined, (key) => state[key], ['count'])
      // TTL=0 时缓存应该命中
      expect(manager.get('count', () => state.count)).toBe(1)
    })

    it('refreshFromState 对 undefined 值应该删除陈旧缓存条目', () => {
      const manager = createCacheManager()
      let countValue: number | undefined = 1
      // 运行时模拟状态源值被删除（返回 undefined），
      // 类型上经 unknown 中转，避免赋值 undefined 后控制流缩窄触发 TS2352
      const readCount = () => countValue as unknown as number

      manager.enable(undefined, readCount, ['count'])
      expect(manager.get('count', readCount)).toBe(1)

      // 状态源变为 undefined：refreshFromState 应该删除对应条目
      countValue = undefined
      manager.refreshFromState(readCount, ['count'])

      // 若陈旧值 1 未被删除，get 会命中缓存返回 1
      expect(manager.get('count', readCount)).toBeUndefined()
    })

    it('TTL 过期后 getState 返回 undefined 时应删除缓存条目', async () => {
      const manager = createCacheManager(10) // 10ms TTL
      let countValue: number | undefined = 1
      // 运行时模拟状态源值被删除（返回 undefined），
      // 类型上经 unknown 中转，避免赋值 undefined 后控制流缩窄触发 TS2352
      const readCount = () => countValue as unknown as number

      manager.enable(undefined, readCount, ['count'])
      expect(manager.get('count', readCount)).toBe(1)

      // 等待 TTL 过期
      await new Promise((r) => setTimeout(r, 20))

      // getState 返回 undefined
      countValue = undefined

      // 缓存过期 + 值为 undefined，应走删除分支（第 86-88 行）
      expect(manager.get('count', readCount)).toBeUndefined()

      // 再次获取时不应命中旧缓存
      countValue = 5
      expect(manager.get('count', readCount)).toBe(5)
    })

    it('缓存未命中且 TTL > 0 时应记录时间戳', () => {
      const manager = createCacheManager(10000) // TTL > 0
      const state = { count: 42 }

      // 不通过 enable 预缓存，直接 get 触发缓存未命中路径
      manager.enable(['count'], (key) => state[key])

      // 先 invalidate 确保 count 不在缓存中
      manager.invalidate('count')

      // 再次 get 触发缓存未命中 + TTL > 0 记录时间戳（第 101-103 行）
      const getter = jest.fn(() => state.count)
      const result = manager.get('count', getter)
      expect(result).toBe(42)
      expect(getter).toHaveBeenCalled()

      // 第二次 get 应命中缓存
      const getter2 = jest.fn(() => 0)
      expect(manager.get('count', getter2)).toBe(42)
      expect(getter2).not.toHaveBeenCalled()
    })

    it('enable 传入 keys 时不应走 stateKeys 分支', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }
      const stateKeys: Array<'count' | 'name'> = ['count', 'name']

      // 传入 keys 时走 keys.forEach 分支，不走 else if (stateKeys) 分支：
      // 仅 'count' 被纳入缓存，'name' 的读取应回落 getter
      manager.enable(['count'], (key) => state[key], stateKeys)
      expect(manager.get('count', () => 0)).toBe(1)

      const nameGetter = jest.fn(() => state.name)
      expect(manager.get('name', nameGetter)).toBe('test')
      expect(nameGetter).toHaveBeenCalled()
    })

    it('enable 不传 keys 但传 stateKeys 时应初始化所有状态键', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }

      // 不传 keys，传 stateKeys，覆盖 else if (stateKeys) 分支（第 141-147 行）
      manager.enable(undefined, (key) => state[key], ['count', 'name'])
      expect(manager.enabled).toBe(true)

      // 验证所有状态键都被缓存了
      expect(manager.get('count', () => 0)).toBe(1)
      expect(manager.get('name', () => '')).toBe('test')
    })

    it('enable 不传 keys 也不传 stateKeys 时不应初始化任何键', () => {
      const manager = createCacheManager()
      const state = { count: 1 }

      // 不传 keys 也不传 stateKeys
      manager.enable(undefined, (key) => state[key])
      expect(manager.enabled).toBe(true)

      // 缓存应该为空，get 时从 state 获取
      const getter = jest.fn(() => state.count)
      expect(manager.get('count', getter)).toBe(1)
      expect(getter).toHaveBeenCalled()
    })

    it('set 在启用但不在 cacheKeys 时不应设置缓存', () => {
      const manager = createCacheManager()
      const state = { count: 1, name: 'test' }

      // 只缓存 count
      manager.enable(['count'], (key) => state[key])

      // set 'name' 不在 cacheKeys 中，不应设置
      manager.set('name', 'new-value')
      const getter = jest.fn(() => state.name)
      expect(manager.get('name', getter)).toBe('test')
      expect(getter).toHaveBeenCalled()
    })

    it('disable 后缓存应被禁用', () => {
      const manager = createCacheManager()
      manager.enable(['count'], () => 1)

      manager.disable()
      expect(manager.enabled).toBe(false)
    })

    it('BUG-4: TTL=0 时 refreshFromState 后连续 get 应直接命中缓存', () => {
      const manager = createCacheManager() // ttl=0（永不过期）
      const state = { count: 1, name: 'test' }

      manager.enable(undefined, (key) => state[key], ['count', 'name'])

      // 模拟 dispatch 结束后的强制刷新（action 直接变异状态的路径）
      manager.refreshFromState((key) => state[key], ['count', 'name'])

      // TTL=0：刷新后连续读取应直接命中缓存，不回读状态源
      const getter = jest.fn(() => state.count)
      expect(manager.get('count', getter)).toBe(1)
      expect(manager.get('count', getter)).toBe(1)
      expect(getter).not.toHaveBeenCalled()
    })
  })
})

// ==================== #15 时间戳清理回归 ====================
// 原用例直接调 clearOldState（该方法已删：src 内无调用方，$replaceState 走 invalidate()）。
// 这里改由仍然在线的公开入口复验同一条不变量：_cache 与 _timestamps 必须同步收缩
describe('StoreCacheManager 时间戳同步清理', () => {
  const createCacheManager = (ttl = 0) =>
    new StoreCacheManager<{ count: number; name: string }>({
      cache: new LRUCache<'count' | 'name', string | number>({ capacity: 100, enableStats: true }),
      ttl,
    })

  const timestampsOf = (manager: StoreCacheManager<{ count: number; name: string }>) => (manager as unknown as { _timestamps: Map<string, number> })._timestamps

  it('invalidate(key) 同步删除缓存条目与时间戳', () => {
    const manager = createCacheManager(1000)
    const state = { count: 1, name: 'test' }

    manager.enable(undefined, (key) => state[key], ['count', 'name'])
    manager.get('count', () => state.count)
    manager.get('name', () => state.name)
    expect(timestampsOf(manager).size).toBe(2)

    manager.invalidate('count')

    expect(timestampsOf(manager).has('count')).toBe(false)
    expect(manager.getStats().size).toBe(1)
  })

  it('写入 undefined 值时同步删除时间戳（不留滞留条目）', () => {
    const manager = createCacheManager(1000)
    const state = { count: 1, name: 'test' }

    manager.enable(undefined, (key) => state[key], ['count', 'name'])
    expect(timestampsOf(manager).size).toBe(2)

    manager.refreshFromState((key) => (key === 'count' ? undefined : state[key]) as string | number, ['count', 'name'])

    expect(timestampsOf(manager).has('count')).toBe(false)
    expect(timestampsOf(manager).has('name')).toBe(true)
  })

  it('disable() 与 invalidate() 清空两表，不滞留时间戳', () => {
    const disabled = createCacheManager(1000)
    disabled.enable(undefined, (key) => ({ count: 1, name: 'test' })[key], ['count', 'name'])
    disabled.disable()
    expect(timestampsOf(disabled).size).toBe(0)

    const cleared = createCacheManager(1000)
    cleared.enable(undefined, (key) => ({ count: 1, name: 'test' })[key], ['count', 'name'])
    cleared.invalidate()
    expect(timestampsOf(cleared).size).toBe(0)
  })
})

// ==================== R5-111：非法 ttl 归一 ====================
describe('StoreCacheManager ttl 有效性守卫', () => {
  const makeManager = (ttl: number) => {
    const cache = new LRUCache<'count', number>({ capacity: 100, enableStats: true })
    return new StoreCacheManager<{ count: number }>({ cache, ttl })
  }
  const ttlOf = (manager: StoreCacheManager<{ count: number }>) => (manager as unknown as { _ttl: number })._ttl

  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['负数', -1000],
  ])('%s 归一为 0（不过期）并留开发期告警', (_label, ttl) => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

    const manager = makeManager(ttl)

    expect(ttlOf(manager)).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cacheConfig.ttl'))
    warnSpy.mockRestore()
  })

  it('归一为不过期后缓存仍能命中（不因 NaN 让 ttl 判定静默失效）', () => {
    const manager = makeManager(NaN)
    let value = 1
    manager.enable(undefined, () => value, ['count'])

    value = 2
    const getter = jest.fn(() => value)
    expect(manager.get('count', getter)).toBe(1)
    expect(getter).not.toHaveBeenCalled()
  })

  it.each([
    ['0', 0],
    ['有限正数', 1000],
  ])('合法 ttl=%s 原样保留且不告警', (_label, ttl) => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

    expect(ttlOf(makeManager(ttl))).toBe(ttl)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('不传 ttl 时保持 0 且不告警', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const cache = new LRUCache<'count', number>({ capacity: 100, enableStats: true })

    const manager = new StoreCacheManager<{ count: number }>({ cache })

    expect(ttlOf(manager)).toBe(0)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
