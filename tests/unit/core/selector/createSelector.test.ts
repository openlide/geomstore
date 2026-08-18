/**
 * createSelector 测试
 */

import { createSelector, createMemoizedSelector, createParametricSelector, createStructuredSelector } from '@/core/selector'

describe('createSelector', () => {
  type TestState = {
    value: number
    name: string
  }

  let state: TestState

  beforeEach(() => {
    state = { value: 42, name: 'test' }
  })

  describe('基础功能', () => {
    it('应该创建选择器', () => {
      const selector = createSelector((s: TestState) => s.value * 2)
      expect(typeof selector).toBe('function')
    })

    it('应该执行选择器并返回结果', () => {
      const selector = createSelector((s: TestState) => s.value * 2)
      const result = selector(state)
      expect(result).toBe(84)
    })

    it('应该支持复杂的选择器逻辑', () => {
      const selector = createSelector((s: TestState) => ({
        doubled: s.value * 2,
        upperName: s.name.toUpperCase(),
      }))
      const result = selector(state)
      expect(result).toEqual({
        doubled: 84,
        upperName: 'TEST',
      })
    })
  })

  describe('缓存功能', () => {
    it('应该缓存相同 state 的结果', () => {
      let callCount = 0
      const selector = createSelector(
        (s: TestState) => {
          callCount++
          return s.value * 2
        },
        { cache: true },
      )

      const result1 = selector(state)
      const result2 = selector(state)
      const result3 = selector(state)

      expect(result1).toBe(84)
      expect(result2).toBe(84)
      expect(result3).toBe(84)
      expect(callCount).toBe(1)
    })

    it('应该在不同 state 时重新计算', () => {
      let callCount = 0
      const selector = createSelector(
        (s: TestState) => {
          callCount++
          return s.value * 2
        },
        { cache: true },
      )

      selector(state)
      // 使用相同值的对象，会使用缓存
      selector({ ...state })
      // 使用不同值的对象，会重新计算
      selector({ value: 10, name: 'test2' })

      expect(callCount).toBe(2)
    })

    it('应该支持禁用缓存', () => {
      let callCount = 0
      const selector = createSelector(
        (s: TestState) => {
          callCount++
          return s.value * 2
        },
        { cache: false },
      )

      selector(state)
      selector(state)
      selector(state)

      expect(callCount).toBe(3)
    })
  })

  describe('缓存大小', () => {
    it('应该限制缓存历史大小', () => {
      const selector = createSelector((s: TestState) => s.value, {
        cacheSize: 2,
      })

      selector(state)
      selector({ value: 1, name: 'a' })
      selector({ value: 2, name: 'b' })
      selector({ value: 3, name: 'c' })

      const cacheStatus = (selector as any).factory.getCacheStatus()
      expect(cacheStatus.cacheSize).toBeLessThanOrEqual(2)
    })

    it('BUG-F4: 交替状态输入应命中缓存历史（cacheSize 条目均参与命中）', () => {
      // 修复前仅命中单条当前缓存：两个状态交替输入时每次都 miss、反复重算，
      // cacheSize 形同虚设；修复后回溯 cacheHistory 命中并提升为当前缓存（LRU）
      let callCount = 0
      const selector = createSelector(
        (s: TestState) => {
          callCount++
          return s.value * 2
        },
        { cacheSize: 3 },
      )

      const s1 = { value: 1, name: 'a' }
      const s2 = { value: 2, name: 'b' }

      selector(s1) // miss：计算
      selector(s2) // miss：计算
      selector(s1) // 命中 cacheHistory
      selector(s2) // 命中 cacheHistory
      selector(s1) // 命中（已被 LRU 提升）

      expect(callCount).toBe(2)
    })

    it('BUG-F4: withCacheResult 交替输入时 fromCache 应为 true', () => {
      const selector = createSelector((s: TestState) => s.value * 2, { cacheSize: 2 })
      const cacheSelector = (selector as any).factory.withCacheResult()

      const s1 = { value: 1, name: 'a' }
      const s2 = { value: 2, name: 'b' }

      expect(cacheSelector(s1).fromCache).toBe(false)
      expect(cacheSelector(s2).fromCache).toBe(false)
      expect(cacheSelector(s1).fromCache).toBe(true)
      expect(cacheSelector(s2).fromCache).toBe(true)
    })
  })

  describe('缓存 TTL', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.clearAllTimers()
      jest.useRealTimers()
    })

    it('应该在 TTL 过期后重新计算', () => {
      let callCount = 0
      const selector = createSelector(
        (s: TestState) => {
          callCount++
          return s.value * 2
        },
        { cacheTTL: 100 },
      )

      selector(state)
      expect(callCount).toBe(1)

      jest.advanceTimersByTime(101)

      selector(state)
      expect(callCount).toBe(2)
    })

    it('应该在 TTL 未过期时使用缓存', () => {
      let callCount = 0
      const selector = createSelector(
        (s: TestState) => {
          callCount++
          return s.value * 2
        },
        { cacheTTL: 100 },
      )

      selector(state)
      expect(callCount).toBe(1)

      jest.advanceTimersByTime(50)

      selector(state)
      expect(callCount).toBe(1)
    })
  })

  describe('自定义 equalityFn', () => {
    it('应该使用自定义 equalityFn 判断缓存', () => {
      const selector = createSelector((s: TestState) => s.value, {
        equalityFn: (a, b) => {
          return typeof a === 'object' && typeof b === 'object' && (a as any).value === (b as any).value
        },
      })

      let callCount = 0
      const _countingSelector = createSelector(() => {
        callCount++
        return callCount
      })

      const _result1 = selector(state)
      const _result2 = selector(state)

      expect(callCount).toBeLessThan(2)
    })
  })

  describe('清除缓存', () => {
    it('应该清除缓存', () => {
      let callCount = 0
      const selector = createSelector((s: TestState) => {
        callCount++
        return s.value * 2
      })

      // 第一次调用
      selector(state)
      expect(callCount).toBe(1)

      // 第二次调用（使用缓存）
      selector(state)
      expect(callCount).toBe(1)

      // 清除缓存
      const factory = (selector as any).factory
      factory.clearCache()

      // 验证缓存状态已清除
      const status = factory.getCacheStatus()
      expect(status.hasCache).toBe(false)
      expect(status.cacheSize).toBe(0)

      // 第三次调用（应该重新计算）
      selector(state)
      expect(callCount).toBe(2)
    })

    it('getCacheStatus 应该返回正确的缓存状态', () => {
      const selector = createSelector((s: TestState) => s.value * 2)

      const factory = (selector as any).factory

      // 初始状态
      let status = factory.getCacheStatus()
      expect(status.hasCache).toBe(false)

      // 执行后
      selector(state)
      status = factory.getCacheStatus()
      expect(status.hasCache).toBe(true)
      expect(status.cacheSize).toBe(1)
      expect(status.cacheHit).toBeDefined()
      expect(status.cacheHit?.value).toBe(84)
    })
  })

  describe('withCacheResult', () => {
    it('应该返回带有缓存信息的结果', () => {
      const selector = createSelector((s: TestState) => s.value * 2)
      const cacheSelector = (selector as any).factory.withCacheResult()

      const result1 = cacheSelector(state)
      expect(result1.value).toBe(84)
      expect(result1.fromCache).toBe(false)

      const result2 = cacheSelector(state)
      expect(result2.value).toBe(84)
      expect(result2.fromCache).toBe(true)
    })

    it('equalityFn 为 falsy 时 withCacheResult 应该使用 === 比较', () => {
      // 使用 false 作为 equalityFn，?? 运算符不替换 false，所以 equalityFn 为 false（falsy）
      const selector = createSelector((s: TestState) => s.value * 2, {
        cache: true,
        equalityFn: false as any,
      })
      const cacheSelector = (selector as any).factory.withCacheResult()

      // 第一次执行，fromCache 为 false
      const result1 = cacheSelector(state)
      expect(result1.fromCache).toBe(false)

      // 相同引用的 state，=== 为 true，应使用缓存
      const result2 = cacheSelector(state)
      expect(result2.fromCache).toBe(true)

      // 不同引用的对象（即使内容相同），=== 为 false，fromCache 为 false
      const result3 = cacheSelector({ ...state })
      expect(result3.fromCache).toBe(false)
    })

    it('equalityFn 为 falsy 时 execute 应该使用 === 比较', () => {
      let callCount = 0
      const selector = createSelector(
        (s: TestState) => {
          callCount++
          return s.value * 2
        },
        {
          cache: true,
          equalityFn: false as any,
        },
      )

      // 相同引用，=== 为 true，使用缓存
      selector(state)
      selector(state)
      expect(callCount).toBe(1)

      // 不同引用（即使内容相同），=== 为 false，重新计算
      selector({ ...state })
      expect(callCount).toBe(2)
    })

    it('withCacheResult 在状态不相等时 fromCache 应该为 false', () => {
      const selector = createSelector((s: TestState) => s.value * 2, {
        cache: true,
      })
      const cacheSelector = (selector as any).factory.withCacheResult()

      // 第一次执行
      cacheSelector(state)
      // 用不同状态执行，stateEqual 为 false，fromCache 为 false
      const result = cacheSelector({ value: 99, name: 'different' })
      expect(result.fromCache).toBe(false)
      expect(result.value).toBe(198)
    })
  })
})

describe('createMemoizedSelector', () => {
  type TestState = {
    value: number
  }

  let state: TestState

  beforeEach(() => {
    state = { value: 42 }
  })

  it('应该创建记忆化选择器', () => {
    let callCount = 0
    const selector = createMemoizedSelector((s: TestState) => {
      callCount++
      return s.value * 2
    })

    selector(state)
    selector(state)
    selector(state)

    expect(callCount).toBe(1)
  })

  it('应该支持自定义 equalityFn', () => {
    const customEquality = jest.fn((a, b) => a === b)
    const selector = createMemoizedSelector((s: TestState) => s.value, customEquality)

    selector(state)
    selector(state)

    expect(customEquality).toHaveBeenCalled()
  })
})

describe('createParametricSelector', () => {
  type TestState = {
    items: number[]
    value?: number
  }

  let state: TestState

  beforeEach(() => {
    state = { items: [1, 2, 3, 4, 5], value: 42 }
  })

  it('应该创建参数化选择器', () => {
    const selector = createParametricSelector((s: TestState, index: number) => s.items[index])
    const getSecond = selector(state)

    expect(getSecond(0)).toBe(1)
    expect(getSecond(1)).toBe(2)
    expect(getSecond(2)).toBe(3)
  })

  it('应该缓存参数化结果', () => {
    let callCount = 0
    const selector = createParametricSelector((s: TestState, index: number) => {
      callCount++
      return s.items[index]
    })

    const getSecond = selector(state)
    getSecond(1)
    getSecond(1)
    getSecond(1)

    expect(callCount).toBe(1)
  })

  it('应该为不同参数缓存不同结果', () => {
    let callCount = 0
    const selector = createParametricSelector((s: TestState, index: number) => {
      callCount++
      return s.items[index]
    })

    const getItem = selector(state)
    getItem(0)
    getItem(1)
    getItem(2)

    expect(callCount).toBe(3)
  })

  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('应该在 TTL 过期后重新计算', () => {
    let callCount = 0
    const selector = createParametricSelector((s: TestState, index: number) => {
      callCount++
      return s.items[index]
    })

    const getItem = selector(state)
    getItem(1)
    expect(callCount).toBe(1)

    jest.advanceTimersByTime(5001)

    getItem(1)
    expect(callCount).toBe(2)
  })

  it('应该支持对象参数并使用 WeakMap 缓存', () => {
    let callCount = 0
    const selector = createParametricSelector((s: TestState, params: { index: number }) => {
      callCount++
      return s.items[params.index]
    })

    const getItem = selector(state)
    const params1 = { index: 0 }
    const params2 = { index: 1 }
    const params3 = { index: 0 } // 不同的对象，相同的内容

    // 第一次调用
    const result1 = getItem(params1)
    expect(result1).toBe(1)
    expect(callCount).toBe(1)

    // 相同对象参数应该使用缓存
    const result2 = getItem(params1)
    expect(result2).toBe(1)
    expect(callCount).toBe(1)

    // 不同对象参数应该重新计算
    const result3 = getItem(params2)
    expect(result3).toBe(2)
    expect(callCount).toBe(2)

    // 不同对象但相同内容（WeakMap 不关心内容相等，只关心引用）
    const result4 = getItem(params3)
    expect(result4).toBe(1)
    expect(callCount).toBe(3)
  })

  it('对象参数缓存应该在 TTL 过期后重新计算', () => {
    let callCount = 0
    const selector = createParametricSelector((s: TestState, params: { index: number }) => {
      callCount++
      return s.items[params.index]
    })

    const getItem = selector(state)
    const params = { index: 1 }

    getItem(params)
    expect(callCount).toBe(1)

    // TTL 过期
    jest.advanceTimersByTime(5001)

    getItem(params)
    expect(callCount).toBe(2)
  })

  it('应该处理各种原始类型参数', () => {
    // 字符串参数
    const strSelector = createParametricSelector((s: TestState, key: string) => {
      return `${key}-${s.items.length}`
    })
    const getByKey = strSelector(state)
    expect(getByKey('test')).toBe('test-5')
    expect(getByKey('test')).toBe('test-5') // 缓存

    // 数字参数
    const numSelector = createParametricSelector((s: TestState, num: number) => {
      return (s.value || 0) + num
    })
    const getByNum = numSelector(state)
    expect(getByNum(10)).toBe(52)
    expect(getByNum(10)).toBe(52) // 缓存

    // 布尔参数
    const boolSelector = createParametricSelector((s: TestState, flag: boolean) => {
      return flag ? s.value || 0 : 0
    })
    const getByBool = boolSelector(state)
    expect(getByBool(true)).toBe(42)
    expect(getByBool(false)).toBe(0)

    // null 参数
    const nullSelector = createParametricSelector((s: TestState, _: null) => {
      return s.items.length
    })
    const getNull = nullSelector(state)
    expect(getNull(null)).toBe(5)

    // undefined 参数
    const undefSelector = createParametricSelector((s: TestState, _: undefined) => {
      return s.value
    })
    const getUndef = undefSelector(state)
    expect(getUndef(undefined)).toBe(42)
  })

  describe('BUG-10: TTL 与缓存容量可配置', () => {
    it('ttl=0 时缓存应立即过期，每次调用重新计算', () => {
      let callCount = 0
      const selector = createParametricSelector(
        (s: TestState, index: number) => {
          callCount++
          return s.items[index]
        },
        { ttl: 0 },
      )

      const getItem = selector(state)
      expect(getItem(1)).toBe(2)
      expect(getItem(1)).toBe(2)
      // ttl=0：条目立即过期，不使用缓存
      expect(callCount).toBe(2)
    })

    it('自定义 ttl 应生效（长于默认 5000ms）', () => {
      let callCount = 0
      const selector = createParametricSelector(
        (s: TestState, index: number) => {
          callCount++
          return s.items[index]
        },
        { ttl: 10000 },
      )

      const getItem = selector(state)
      getItem(1)
      // 默认 ttl 5000 已过，但自定义 10000 未过：应命中缓存
      jest.advanceTimersByTime(5001)
      getItem(1)
      expect(callCount).toBe(1)

      // 自定义 ttl 也过期后重新计算
      jest.advanceTimersByTime(5001)
      getItem(1)
      expect(callCount).toBe(2)
    })

    it('maxEntries 应限制原始类型参数缓存容量', () => {
      const calls: number[] = []
      const selector = createParametricSelector(
        (_s: TestState, index: number) => {
          calls.push(index)
          return index * 10
        },
        { ttl: 60000, maxEntries: 3 },
      )

      const getItem = selector(state)
      getItem(1)
      getItem(2)
      getItem(3)
      getItem(4) // 超容量，最早写入的参数 1 被淘汰

      // 参数 1 已被淘汰，重新访问应重新计算
      expect(getItem(1)).toBe(10)
      expect(calls.filter((c) => c === 1).length).toBe(2)
    })
  })
})

describe('createStructuredSelector', () => {
  type TestState = {
    value: number
    name: string
    active: boolean
  }

  let state: TestState

  beforeEach(() => {
    state = { value: 42, name: 'test', active: true }
  })

  it('应该创建结构化选择器', () => {
    const selector = createStructuredSelector<TestState>({
      value: (s: TestState) => s.value * 2,
      upperName: (s: TestState) => s.name.toUpperCase(),
      isActive: (s: TestState) => s.active,
    })

    const result = selector(state)
    expect(result).toEqual({
      value: 84,
      upperName: 'TEST',
      isActive: true,
    })
  })

  it('应该支持部分选择器', () => {
    const selector = createStructuredSelector<TestState>({
      value: (s: TestState) => s.value * 2,
      name: (s: TestState) => s.name,
    })

    const result = selector(state)
    expect(result).toEqual({
      value: 84,
      name: 'test',
    })
  })

  it('应该处理未定义的选择器', () => {
    const selector = createStructuredSelector<TestState>({
      value: (s: TestState) => s.value * 2,
      name: undefined as any,
    })

    const result = selector(state)
    expect(result).toEqual({
      value: 84,
    })
  })

  it('应该使用原始 state 值当选择器不是函数', () => {
    const selector = createStructuredSelector<TestState>({
      value: (s: TestState) => s.value,
      name: null as any,
      active: undefined,
    })

    const result = selector(state)
    expect(result).toEqual({
      value: 42,
    })
  })
})
