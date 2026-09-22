/**
 * 第五轮 extras-selector 分片：重试选择器的回调口径与 attempts 标注
 *
 * - R5-221：`shouldRetry` 收到规范化的 `Error`（抛给调用方的仍是原值）
 * - R5-222：`attempts` 取 `Math.max`，嵌套重试不再报出偏小的次数、falsy 既有值同样参与合并
 * - R5-223：同步与异步两条循环共用同一判据，行为逐字对齐
 */
import { createRetrySelector, createRetrySelectorAsync } from '@/extras/selector/index.js'

type S = { value: number }

const state: S = { value: 1 }

const capture = (fn: () => unknown): unknown => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return 'NOT_THROWN'
}

/** annotateAttempts 写的是不可枚举属性，这里只读取 */
const attemptsOf = (error: unknown): number | undefined => (error as { attempts?: number }).attempts

describe('shouldRetry 收到规范化的 Error（R5-221）', () => {
  it('throw 字符串时回调拿到同等信息量的 Error，抛给调用方的仍是原值', () => {
    const seen: unknown[] = []
    const selector = createRetrySelector<S, number>(
      () => {
        throw 'boom'
      },
      {
        retries: 2,
        shouldRetry: (error, attempt) => {
          seen.push(error)
          return attempt < 2
        },
      },
    )

    expect(capture(() => selector(state))).toBe('boom')
    expect(seen).toHaveLength(2)
    // 修复前回调拿到的是裸字符串：error.message === undefined，
    // 按 message 判定的用户实现会静默放弃整个重试额度
    expect(seen[0]).toBeInstanceOf(Error)
    expect((seen[0] as Error).message).toBe('boom')
  })

  it('throw 非 Error 对象时按 JSON 取文本，重抛的仍是那个对象本身', () => {
    const thrown = { code: 500 }
    let seen: unknown
    const selector = createRetrySelector<S, number>(
      () => {
        throw thrown
      },
      {
        retries: 1,
        shouldRetry: (error) => {
          seen = error
          return false
        },
      },
    )

    expect(capture(() => selector(state))).toBe(thrown)
    expect(seen).toBeInstanceOf(Error)
    expect((seen as Error).message).toBe('{"code":500}')
  })

  it('Error 实例原样进回调，不被包一层', () => {
    const thrown = new Error('already an error')
    let seen: unknown
    const selector = createRetrySelector<S, number>(
      () => {
        throw thrown
      },
      {
        retries: 1,
        shouldRetry: (error) => {
          seen = error
          return false
        },
      },
    )

    expect(capture(() => selector(state))).toBe(thrown)
    expect(seen).toBe(thrown)
  })

  it('循环引用的抛出对象不会让回调前的规范化本身抛错：回退 String() 取文本', () => {
    const thrown: Record<string, unknown> = { name: 'circular' }
    thrown.self = thrown
    let seen: unknown
    const selector = createRetrySelector<S, number>(
      () => {
        throw thrown
      },
      {
        retries: 1,
        shouldRetry: (error) => {
          seen = error
          return false
        },
      },
    )

    expect(capture(() => selector(state))).toBe(thrown)
    // 序列化失败时不能让「规范化」这一步顶替真实失败
    expect(seen).toBeInstanceOf(Error)
    expect((seen as Error).message).toBe('[object Object]')
  })

  it('throw null 时规范化成 message 为 "null" 的 Error，重抛的仍是 null', () => {
    let seen: unknown
    const selector = createRetrySelector<S, number>(
      () => {
        throw null
      },
      {
        retries: 1,
        shouldRetry: (error) => {
          seen = error
          return false
        },
      },
    )

    expect(capture(() => selector(state))).toBeNull()
    expect(seen).toBeInstanceOf(Error)
    expect((seen as Error).message).toBe('null')
  })

  it('toJSON 返回 undefined 时（JSON.stringify 给出 undefined）回退 String()', () => {
    const thrown = { toJSON: () => undefined }
    let seen: unknown
    const selector = createRetrySelector<S, number>(
      () => {
        throw thrown
      },
      {
        retries: 1,
        shouldRetry: (error) => {
          seen = error
          return false
        },
      },
    )

    expect(capture(() => selector(state))).toBe(thrown)
    expect((seen as Error).message).toBe('[object Object]')
  })

  it('异步变体同口径：回调拿到 Error，rejection 原因仍是原值', async () => {
    const seen: unknown[] = []
    const selector = createRetrySelectorAsync<S, number>(
      () => {
        throw { code: 400 }
      },
      {
        retries: 1,
        shouldRetry: (error, attempt) => {
          seen.push(error)
          return attempt < 1
        },
      },
    )

    await expect(selector(state)).rejects.toEqual({ code: 400 })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBeInstanceOf(Error)
    expect((seen[0] as Error).message).toBe('{"code":400}')
  })
})

describe('attempts 标注取两者之大（R5-222）', () => {
  it('嵌套重试：外层跑满 5 次时不再沿用内层留下的 2', () => {
    const error = new Error('nested')
    const inner = createRetrySelector<S, number>(
      () => {
        throw error
      },
      { retries: 1 },
    )
    const outer = createRetrySelector<S, number>(inner, { retries: 4 })

    expect(capture(() => outer(state))).toBe(error)
    // 修复前：内层已标注 attempts = 2（真值）→ 外层直接停手，报出的次数只小不大
    expect(attemptsOf(error)).toBe(5)
  })

  it('既有 attempts 为 falsy（0）时同样被真实次数覆盖，不再是「falsy 覆盖、truthy 保留」', () => {
    const error = Object.assign(new Error('zero-annotated'), { attempts: 0 })
    const selector = createRetrySelector<S, number>(
      () => {
        throw error
      },
      { retries: 2 },
    )

    expect(capture(() => selector(state))).toBe(error)
    expect(attemptsOf(error)).toBe(3)
  })

  it('既有 attempts 更大时保留它（标注只增不减）', () => {
    const error = Object.assign(new Error('pre-annotated'), { attempts: 99 })
    const selector = createRetrySelector<S, number>(
      () => {
        throw error
      },
      { retries: 1 },
    )

    expect(capture(() => selector(state))).toBe(error)
    expect(attemptsOf(error)).toBe(99)
  })

  it('既有 attempts 不是数值时按「未标注」处理，写入真实次数', () => {
    const error = Object.assign(new Error('bogus-annotated'), { attempts: 'lots' })
    const selector = createRetrySelector<S, number>(
      () => {
        throw error
      },
      { retries: 1 },
    )

    expect(capture(() => selector(state))).toBe(error)
    expect(attemptsOf(error)).toBe(2)
  })

  it('标注落在原值上不影响非对象抛出值（falsy 抛出值仍原样抛出）', () => {
    const selector = createRetrySelector<S, number>(
      () => {
        throw 0
      },
      { retries: 1 },
    )

    const caught = capture(() => selector(state))
    expect(caught).toBe(0)
  })
})

describe('同步与异步两条循环行为对齐（R5-223）', () => {
  /** 前 `failures` 次抛 `error`，之后返回 value * 10；同时对外暴露真实调用次数 */
  const failingThenPassing = (error: Error, failures: number) => {
    let calls = 0
    return {
      fn: (): number => {
        calls += 1
        if (calls <= failures) throw error
        return state.value * 10
      },
      count: () => calls,
    }
  }

  it('同样的选项与失败序列下，两条路径的尝试次数一致', async () => {
    const sync = failingThenPassing(new Error('shared'), 2)
    const asyncSide = failingThenPassing(new Error('shared'), 2)
    const runSync = createRetrySelector<S, number>(sync.fn, { retries: 5 })
    const runAsync = createRetrySelectorAsync<S, number>(asyncSide.fn, { retries: 5 })

    expect(runSync(state)).toBe(10)
    await expect(runAsync(state)).resolves.toBe(10)
    expect(sync.count()).toBe(asyncSide.count())
    expect(sync.count()).toBe(3)
    // 中途成功时不做标注：标注只发生在额度耗尽的收尾（见 throwRetryExhausted）
  })

  it('额度耗尽时两条路径报出同样的 attempts', async () => {
    const syncError = new Error('exhausted sync')
    const asyncError = new Error('exhausted async')
    const runSync = createRetrySelector<S, number>(failingThenPassing(syncError, 99).fn, { retries: 3 })
    const runAsync = createRetrySelectorAsync<S, number>(failingThenPassing(asyncError, 99).fn, { retries: 3 })

    expect(capture(() => runSync(state))).toBe(syncError)
    await expect(runAsync(state)).rejects.toBe(asyncError)
    expect(attemptsOf(syncError)).toBe(4)
    expect(attemptsOf(asyncError)).toBe(4)
  })

  it('shouldRetry 抛错时两条路径都停止重试并抛出原错误（带真实 attempts）', async () => {
    const error = new Error('callback explodes')
    const boom = () => {
      throw error
    }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)

    const syncSelector = createRetrySelector<S, number>(boom, {
      retries: 4,
      shouldRetry: () => {
        throw new Error('callback blew up')
      },
    })
    expect(capture(() => syncSelector(state))).toBe(error)
    expect(attemptsOf(error)).toBe(1)

    const asyncError = new Error('async callback explodes')
    const asyncSelector = createRetrySelectorAsync<S, number>(
      () => {
        throw asyncError
      },
      {
        retries: 4,
        shouldRetry: () => {
          throw new Error('callback blew up')
        },
      },
    )
    await expect(asyncSelector(state)).rejects.toBe(asyncError)
    expect(attemptsOf(asyncError)).toBe(1)

    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('delay 函数抛错时按 0 等待继续，不影响 attempts 与总尝试数', async () => {
    const error = new Error('delayed failure')
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const selector = createRetrySelectorAsync<S, number>(
      () => {
        throw error
      },
      {
        retries: 2,
        delay: () => {
          throw new Error('delay blew up')
        },
      },
    )

    await expect(selector(state)).rejects.toBe(error)
    expect(attemptsOf(error)).toBe(3)
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})
