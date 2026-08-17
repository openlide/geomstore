/**
 * SelectorComposer 测试
 */

import { SelectorComposer } from '@/core/selector'

describe('SelectorComposer', () => {
  // 使用类型别名而非 interface：对象类型字面量带隐式索引签名，可满足 Record<string, unknown> 约束
  type TestState = {
    value: number
    name: string
    items: number[]
  }

  let state: TestState

  beforeEach(() => {
    state = { value: 42, name: 'test', items: [1, 2, 3] }
  })

  describe('combine', () => {
    it('应该组合多个选择器', () => {
      const selector = SelectorComposer.combine<TestState, number>({
        selectors: [(s) => s.value, (s) => s.name.length],
        combiner: (value: number, nameLength: number) => value + nameLength,
      })

      const result = selector(state)
      expect(result).toBe(46) // 42 + 4
    })

    it('应该支持多个选择器的组合', () => {
      const selector = SelectorComposer.combine<TestState, number>({
        selectors: [(s) => s.value, (s) => s.name.length, (s) => s.items.length],
        combiner: (value: number, nameLength: number, itemsLength: number) => value + nameLength + itemsLength,
      })

      const result = selector(state)
      expect(result).toBe(49) // 42 + 4 + 3
    })

    it('应该处理复杂的数据转换', () => {
      const selector = SelectorComposer.combine<TestState, { sum: number; avg: number }>({
        selectors: [(s) => s.items.reduce((a, b) => a + b, 0), (s) => s.items.length],
        combiner: (sum: number, count: number) => ({ sum, avg: sum / count }),
      })

      const result = selector(state)
      expect(result).toEqual({ sum: 6, avg: 2 })
    })
  })

  describe('pipe', () => {
    it('应该管道操作一个选择器', () => {
      const selector = SelectorComposer.pipe(
        (s: TestState) => s.value,
        (value: number) => value * 2,
      )

      const result = selector(state)
      expect(result).toBe(84)
    })

    it('应该管道操作两个选择器', () => {
      const selector = SelectorComposer.pipe(
        (s: TestState) => s.value,
        (value: number) => value * 2,
        (value: number) => value.toString(),
      )

      const result = selector(state)
      expect(result).toBe('84')
    })

    it('应该管道操作三个选择器', () => {
      const selector = SelectorComposer.pipe(
        (s: TestState) => s.value,
        (value: number) => value * 2,
        (value: number) => value + 10,
        (value: number) => value / 2,
      )

      const result = selector(state)
      expect(result).toBe(47) // (42 * 2 + 10) / 2 = 47
    })

    it('应该支持复杂的数据转换链', () => {
      const selector = SelectorComposer.pipe(
        (s: TestState) => s.items,
        (items: number[]) => items.filter((x) => x > 1),
        (items: number[]) => items.map((x) => x * 2),
        (items: number[]) => items.reduce((a, b) => a + b, 0),
      )

      const result = selector(state)
      expect(result).toBe(10) // [1, 2, 3] -> [2, 3] -> [4, 6] -> 10
    })
  })

  describe('createDerived', () => {
    it('应该创建派生选择器', () => {
      const selector = SelectorComposer.createDerived(
        (s: TestState) => s.value,
        (value: number) => value * 2,
      )

      const result = selector(state)
      expect(result).toBe(84)
    })

    it('应该创建三个选择器的派生', () => {
      const selector = SelectorComposer.createDerived(
        (s: TestState) => s.value,
        (value: number) => value * 2,
        (value: number) => value + 10,
      )

      const result = selector(state)
      expect(result).toBe(94) // (42 * 2) + 10 = 94
    })

    it('应该与 pipe 功能相同', () => {
      const pipeSelector = SelectorComposer.pipe(
        (s: TestState) => s.value,
        (value: number) => value * 2,
      )
      const derivedSelector = SelectorComposer.createDerived(
        (s: TestState) => s.value,
        (value: number) => value * 2,
      )

      expect(pipeSelector(state)).toBe(derivedSelector(state))
    })
  })

  describe('createArraySelector', () => {
    it('应该创建数组选择器', () => {
      const itemSelector = (item: number) => item * 2
      const selector = SelectorComposer.createArraySelector(itemSelector)

      const result = selector(state.items)
      expect(result).toEqual([2, 4, 6])
    })

    it('应该处理空数组', () => {
      const itemSelector = (item: number) => item * 2
      const selector = SelectorComposer.createArraySelector(itemSelector)

      const result = selector([])
      expect(result).toEqual([])
    })

    it('应该处理复杂的项选择器', () => {
      const itemSelector = (item: number) => ({
        value: item,
        squared: item * item,
      })
      const selector = SelectorComposer.createArraySelector(itemSelector)

      const result = selector(state.items)
      expect(result).toEqual([
        { value: 1, squared: 1 },
        { value: 2, squared: 4 },
        { value: 3, squared: 9 },
      ])
    })
  })

  describe('createObjectSelector', () => {
    it('应该创建对象选择器', () => {
      const keySelector = (key: string) => (s: any) => s[key]
      const selector = SelectorComposer.createObjectSelector(keySelector)

      const result = selector(state)
      expect(result).toEqual({
        value: 42,
        name: 'test',
        items: [1, 2, 3],
      })
    })

    it('应该应用转换函数到每个键', () => {
      const keySelector = (key: string) => (s: any) => s[key].toString()
      const selector = SelectorComposer.createObjectSelector(keySelector)

      const result = selector(state)
      expect(result).toEqual({
        value: '42',
        name: 'test',
        items: '1,2,3',
      })
    })

    it('应该处理空对象', () => {
      const keySelector = (key: string) => () => key
      const selector = SelectorComposer.createObjectSelector(keySelector)

      const result = selector({})
      expect(result).toEqual({})
    })
  })

  describe('createConditionalSelector', () => {
    it('应该创建条件选择器', () => {
      const selector = SelectorComposer.createConditionalSelector(
        (s: TestState) => s.value > 50,
        (_s) => 'high',
        (_s) => 'low',
      )

      const result = selector(state)
      expect(result).toBe('low')
    })

    it('应该返回 true 选择器的结果当条件满足', () => {
      const highState = { ...state, value: 100 }
      const selector = SelectorComposer.createConditionalSelector(
        (s: TestState) => s.value > 50,
        (_s) => 'high',
        (_s) => 'low',
      )

      const result = selector(highState)
      expect(result).toBe('high')
    })

    it('应该返回 false 选择器的结果当条件不满足', () => {
      const lowState = { ...state, value: 10 }
      const selector = SelectorComposer.createConditionalSelector(
        (s: TestState) => s.value > 50,
        (_s) => 'high',
        (_s) => 'low',
      )

      const result = selector(lowState)
      expect(result).toBe('low')
    })

    it('应该支持复杂的条件逻辑', () => {
      const selector = SelectorComposer.createConditionalSelector(
        (s: TestState) => s.value > 50 && s.name.length > 5,
        (s) => s.value * 2,
        (s) => s.value / 2,
      )

      const result1 = selector({ value: 60, name: 'longname', items: [] })
      expect(result1).toBe(120)

      const result2 = selector({ value: 60, name: 'short', items: [] })
      expect(result2).toBe(30)
    })
  })

  describe('createDefaultSelector', () => {
    it('应该创建默认值选择器', () => {
      const selector = SelectorComposer.createDefaultSelector((s: TestState) => s.value, 0)

      const result = selector(state)
      expect(result).toBe(42)
    })

    it('应该返回默认值当选择器返回 undefined', () => {
      const selector = SelectorComposer.createDefaultSelector((s: TestState) => (s as any).nonexistent, 'default')

      const result = selector(state)
      expect(result).toBe('default')
    })

    it('应该处理选择器错误并返回默认值', () => {
      const selector = SelectorComposer.createDefaultSelector(() => {
        throw new Error('Error')
      }, 'fallback')

      const result = selector(state)
      expect(result).toBe('fallback')
    })
  })

  describe('createRetrySelector', () => {
    it('应该创建重试选择器', () => {
      let attemptCount = 0
      const selector = SelectorComposer.createRetrySelector((s: TestState) => {
        attemptCount++
        if (attemptCount < 3) {
          throw new Error('Not yet')
        }
        return s.value
      }, 3)

      const result = selector(state)
      expect(result).toBe(42)
      expect(attemptCount).toBe(3)
    })

    it('应该在重试次数用尽后抛出错误', () => {
      const selector = SelectorComposer.createRetrySelector(() => {
        throw new Error('Always fails')
      }, 2)

      expect(() => selector(state)).toThrow('Always fails')
    })

    it('应该使用默认重试次数', () => {
      let attemptCount = 0
      const selector = SelectorComposer.createRetrySelector((s: TestState) => {
        attemptCount++
        if (attemptCount < 4) {
          throw new Error('Not yet')
        }
        return s.value
      })

      const result = selector(state)
      expect(result).toBe(42)
      expect(attemptCount).toBe(4)
    })

    it('maxRetries为负数时应该抛出兜底错误', () => {
      // 循环体一次都不执行，lastError 保持 undefined，走防御性兜底分支
      const selector = SelectorComposer.createRetrySelector((s: TestState) => s.value, -1)

      expect(() => selector(state)).toThrow('[SelectorComposer] Retry selector failed without error')
    })
  })

  describe('createDebouncedSelector', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('应该创建防抖选择器', async () => {
      let callCount = 0
      const selector = SelectorComposer.createDebouncedSelector((s: TestState) => {
        callCount++
        return s.value
      }, 100)

      const promise1 = selector(state)
      const promise2 = selector(state)
      const promise3 = selector(state)

      // 快进时间到防抖延迟之后
      jest.advanceTimersByTime(150)

      const result1 = await promise1
      const result2 = await promise2
      const result3 = await promise3

      expect(callCount).toBe(1)
      expect(result1).toBe(42)
      expect(result2).toBe(42)
      expect(result3).toBe(42)
    })

    it('应该使用默认延迟', async () => {
      let callCount = 0
      const selector = SelectorComposer.createDebouncedSelector((s: TestState) => {
        callCount++
        return s.value
      })

      const promise1 = selector(state)
      const promise2 = selector(state)

      // 快进时间到默认防抖延迟之后
      jest.advanceTimersByTime(310)

      await promise1
      await promise2

      expect(callCount).toBe(1)
    })

    it('应该处理选择器错误', async () => {
      const error = new Error('Selector error')
      const selector = SelectorComposer.createDebouncedSelector(() => {
        throw error
      }, 100)

      const promise = selector(state)

      // 快进时间到防抖延迟之后
      jest.advanceTimersByTime(150)

      await expect(promise).rejects.toThrow('Selector error')
    })

    it('多次调用应该使用最新状态', async () => {
      const states: TestState[] = []
      const selector = SelectorComposer.createDebouncedSelector((s: TestState) => {
        states.push(s)
        return s.value
      }, 100)

      const state1 = { value: 1, name: 'a', items: [] }
      const state2 = { value: 2, name: 'b', items: [] }
      const state3 = { value: 3, name: 'c', items: [] }

      const promise1 = selector(state1)
      selector(state2)
      const promise3 = selector(state3)

      // 快进时间
      jest.advanceTimersByTime(150)

      await Promise.all([promise1, promise3])

      // 只应该使用最后一个状态执行
      expect(states.length).toBe(1)
      expect(states[0].value).toBe(3)
    })

    it('selector 递归调用时第二次回调 currentResolve 为 null 不应崩溃', async () => {
      // 创建一个在执行时会递归调用防抖选择器的 selector
      // 这样第一次 setTimeout 回调执行时，会触发第二次调用
      // 第二次调用复用了 currentPromise（因为还没执行到 finally）
      // 但 finally 执行后 currentResolve 被设为 null
      // 第二次 setTimeout 回调执行时 currentResolve 为 null
      // eslint-disable-next-line prefer-const -- 循环引用：innerSelector 需闭包引用 debouncedSelector，只能先声明后赋值
      let debouncedSelector: ReturnType<typeof SelectorComposer.createDebouncedSelector<TestState, number>>
      let recursiveCallCount = 0

      const innerSelector = (s: TestState): number => {
        recursiveCallCount++
        if (recursiveCallCount === 1 && debouncedSelector) {
          // 在第一次 setTimeout 回调中递归调用防抖选择器
          // 这会创建一个新的 setTimeout，但不会创建新的 Promise（因为 currentPromise 还存在）
          debouncedSelector(s)
        }
        return s.value
      }

      debouncedSelector = SelectorComposer.createDebouncedSelector(innerSelector, 50)

      const promise = debouncedSelector(state)

      // 触发第一次 setTimeout 回调
      jest.advanceTimersByTime(60)

      // 等待 Promise resolve
      const result = await promise
      expect(result).toBe(42)

      // 触发第二次 setTimeout 回调（由递归调用创建）
      // 此时 currentResolve 已被 finally 清除为 null
      jest.advanceTimersByTime(60)

      // 不应该崩溃
      expect(recursiveCallCount).toBeGreaterThanOrEqual(1)
    })

    it('selector 递归调用并抛出错误时第二次回调 currentReject 为 null 不应崩溃', async () => {
      // eslint-disable-next-line prefer-const -- 循环引用：innerSelector 需闭包引用 debouncedSelector，只能先声明后赋值
      let debouncedSelector: ReturnType<typeof SelectorComposer.createDebouncedSelector<TestState, number>>
      let recursiveCallCount = 0

      const innerSelector = (s: TestState): number => {
        recursiveCallCount++
        if (recursiveCallCount === 1 && debouncedSelector) {
          // 递归调用，创建第二个 setTimeout
          debouncedSelector(s)
        }
        // 总是抛出错误
        throw new Error('Always throws')
      }

      debouncedSelector = SelectorComposer.createDebouncedSelector(innerSelector, 50)

      const promise = debouncedSelector(state)

      // 触发第一次 setTimeout 回调
      jest.advanceTimersByTime(60)

      // 第一次应该 reject
      await expect(promise).rejects.toThrow('Always throws')

      // 触发第二次 setTimeout 回调（由递归调用创建）
      // 此时 currentReject 已被 finally 清除为 null
      jest.advanceTimersByTime(60)

      // 不应该崩溃
      expect(recursiveCallCount).toBeGreaterThanOrEqual(1)
    })

    it('state 为 null 时应该 reject 兜底错误', async () => {
      const selector = SelectorComposer.createDebouncedSelector((s: TestState) => s.value, 100)

      // 传入 null 使 currentState 为 null，触发防御性兜底分支
      const promise = selector(null as unknown as TestState)

      jest.advanceTimersByTime(150)

      await expect(promise).rejects.toThrow('[SelectorComposer] Debounced selector state missing')
    })
  })

  describe('createThrottledSelector', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('应该创建节流选择器', async () => {
      let callCount = 0
      const selector = SelectorComposer.createThrottledSelector((s: TestState) => {
        callCount++
        return s.value
      }, 100)

      const result1 = selector(state)
      const _result2 = selector(state)
      const _result3 = selector(state)

      expect(callCount).toBe(1)
      expect(result1).toBe(42)

      // 快进节流间隔时间
      jest.advanceTimersByTime(110)

      const result4 = selector(state)
      expect(callCount).toBe(2)
      expect(result4).toBe(42)
    })

    it('应该使用默认间隔', async () => {
      let callCount = 0
      const selector = SelectorComposer.createThrottledSelector((s: TestState) => {
        callCount++
        return s.value
      })

      selector(state)
      selector(state)

      expect(callCount).toBe(1)

      // 快进默认节流间隔时间
      jest.advanceTimersByTime(310)

      selector(state)
      expect(callCount).toBe(2)
    })
  })
})
