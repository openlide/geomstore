/**
 * 重试选择器单元测试
 *
 * 覆盖同步/异步两套重试选择器的分支：缺省参数、shouldRetry 提前退出、
 * 重试耗尽、参数校验，以及 attempts 标注（已标注时不覆盖）。
 */
import { createRetrySelector, createRetrySelectorAsync } from '@/extras/selector/retrySelector.js'
import type { Selector } from '@/types/selector.js'

type S = { value: number }

const state: S = { value: 1 }
/** annotateAttempts 写入的是不可枚举属性，这里只读取 */
const attemptsOf = (error: unknown): number | undefined => (error as { attempts?: number }).attempts

describe('createRetrySelector（同步）', () => {
  it('首次成功直接返回，不触发重试（不传 options 时走缺省值）', () => {
    const selector = jest.fn((s: S) => s.value + 1)

    const result = createRetrySelector(selector as Selector<S, number>)(state)

    expect(result).toBe(2)
    expect(selector).toHaveBeenCalledTimes(1)
  })

  it('失败后按 retries 重试直至成功', () => {
    let calls = 0
    const selector = (s: S): number => {
      calls++
      if (calls < 3) throw new Error(`fail ${calls}`)
      return s.value
    }

    expect(createRetrySelector(selector, { retries: 3 })(state)).toBe(1)
    expect(calls).toBe(3)
  })

  it('shouldRetry 返回 false 时立即退出，并标注真实尝试次数', () => {
    const error = new Error('fatal')
    const selector = jest.fn((): number => {
      throw error
    })

    expect(() => createRetrySelector(selector, { retries: 5, shouldRetry: () => false })(state)).toThrow(error)
    expect(selector).toHaveBeenCalledTimes(1)
    expect(attemptsOf(error)).toBe(1)
  })

  it('重试耗尽后抛出最后一次错误，attempts = retries + 1', () => {
    const error = new Error('always fails')
    const selector = jest.fn((): number => {
      throw error
    })

    expect(() => createRetrySelector(selector, { retries: 2 })(state)).toThrow(error)
    expect(selector).toHaveBeenCalledTimes(3)
    expect(attemptsOf(error)).toBe(3)
  })

  it('retries 为 0 时只尝试一次', () => {
    const selector = jest.fn((): number => {
      throw new Error('once')
    })

    expect(() => createRetrySelector(selector, { retries: 0 })(state)).toThrow('once')
    expect(selector).toHaveBeenCalledTimes(1)
  })

  it('retries 为非负整数校验：负数抛 TypeError', () => {
    expect(() => createRetrySelector(jest.fn(), { retries: -1 })).toThrow(TypeError)
    expect(() => createRetrySelector(jest.fn(), { retries: 1.5 })).toThrow(TypeError)
  })

  it('错误已带 attempts 标注时不覆盖既有值', () => {
    const error = Object.assign(new Error('pre-annotated'), { attempts: 9 })
    const selector = jest.fn((): number => {
      throw error
    })

    expect(() => createRetrySelector(selector, { retries: 0 })(state)).toThrow(error)
    expect(attemptsOf(error)).toBe(9)
  })
})

describe('createRetrySelectorAsync（可延迟重试）', () => {
  it('缺省参数下立即重试并最终成功', async () => {
    let calls = 0
    const selector = (s: S): number => {
      calls++
      if (calls < 2) throw new Error('transient')
      return s.value * 10
    }

    await expect(createRetrySelectorAsync(selector)(state)).resolves.toBe(10)
    expect(calls).toBe(2)
  })

  it('delay 为数字时按固定间隔等待', async () => {
    let calls = 0
    const selector = (s: S): number => {
      calls++
      if (calls < 2) throw new Error('transient')
      return s.value
    }

    await expect(createRetrySelectorAsync(selector, { retries: 2, delay: 1 })(state)).resolves.toBe(1)
    expect(calls).toBe(2)
  })

  it('delay 为退避函数时按 attempt 计算；返回值 <= 0 时不等待', async () => {
    const attempts: number[] = []
    let calls = 0
    const selector = (s: S): number => {
      calls++
      if (calls < 3) throw new Error('transient')
      return s.value
    }

    await expect(
      createRetrySelectorAsync(selector, {
        retries: 3,
        delay: (attempt) => {
          attempts.push(attempt)
          return 0
        },
      })(state),
    ).resolves.toBe(1)
    expect(attempts).toEqual([1, 2])
  })

  it('shouldRetry 返回 false 时停止重试并标注 attempts', async () => {
    const error = new Error('fatal')
    const selector = jest.fn((): number => {
      throw error
    })

    await expect(createRetrySelectorAsync(selector, { retries: 5, shouldRetry: () => false })(state)).rejects.toThrow('fatal')
    expect(selector).toHaveBeenCalledTimes(1)
    expect(attemptsOf(error)).toBe(1)
  })

  it('重试耗尽后抛出最后一次错误，attempts = retries + 1', async () => {
    const error = new Error('always fails')
    const selector = jest.fn((): number => {
      throw error
    })

    await expect(createRetrySelectorAsync(selector, { retries: 2, delay: 0 })(state)).rejects.toThrow('always fails')
    expect(selector).toHaveBeenCalledTimes(3)
    expect(attemptsOf(error)).toBe(3)
  })

  it('retries 为非负整数校验：负数抛 TypeError', () => {
    expect(() => createRetrySelectorAsync(jest.fn(), { retries: -1 })).toThrow(TypeError)
  })
})

describe('annotateAttempts 对不可标注抛出值的安全性', () => {
  it('抛出冻结的 Error 时原样重抛，不被 defineProperty 的 TypeError 顶替', () => {
    const frozen = Object.freeze(new Error('frozen boom'))
    const selector = jest.fn((): number => {
      throw frozen
    })

    expect(() => createRetrySelector(selector as Selector<S, number>, { retries: 1 })(state)).toThrow(frozen)
  })

  it('抛出非对象值（字符串）时原样重抛该值', () => {
    const selector = jest.fn((): number => {
      throw 'plain string boom'
    })

    try {
      createRetrySelector(selector as Selector<S, number>, { retries: 1 })(state)
      throw new Error('selector 未抛出，用例失效')
    } catch (caught) {
      expect(caught).toBe('plain string boom')
    }
  })

  it('异步路径抛出冻结 Error 时同样原样 reject', async () => {
    const frozen = Object.freeze(new Error('async frozen boom'))
    const selector = jest.fn(async (): Promise<number> => {
      throw frozen
    })

    await expect(createRetrySelectorAsync(selector as Selector<S, number>, { retries: 1, delay: 0 })(state)).rejects.toBe(frozen)
  })
})
