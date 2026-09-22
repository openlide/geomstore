/**
 * 第五轮 extras-action-p1 分片回归（async-core / cache / common / debounce / log）
 *
 * 每条用例断言的是**修复后**的语义，修复前这些断言全部会失败。
 * 编号对应 `.ocr-fix/groups5/extras-action-p1.md`。
 */

import { retryWithBackoff, toError, type RetryOptions } from '@/extras/action/async-core.js'
import { withCache } from '@/extras/action/decorators/cache.js'
import { createDecorator, isThenable } from '@/extras/action/decorators/common.js'
import { withDebounce, flushDebouncedCalls } from '@/extras/action/decorators/debounce.js'

/** 以描述符手工装饰（对象字面量上的方法写不出装饰器语法） */
function decorate(host: Record<string | symbol, unknown>, key: string | symbol, decorator: MethodDecorator): void {
  const descriptor = Object.getOwnPropertyDescriptor(host, key) as PropertyDescriptor
  Object.defineProperty(host, key, decorator(host, key, descriptor) ?? descriptor)
}

/** 取装饰后的方法并调用 */
function callMethod(host: Record<string | symbol, unknown>, key: string, ...args: unknown[]): unknown {
  return (host[key] as (...callArgs: unknown[]) => unknown)(...args)
}

/** 收集一个宏任务窗口内的 unhandledRejection */
function captureRejections(): { reasons: unknown[]; stop: () => void } {
  const reasons: unknown[] = []
  const handler = (reason: unknown): void => {
    reasons.push(reason)
  }
  process.on('unhandledRejection', handler)

  return {
    reasons,
    stop: (): void => {
      process.off('unhandledRejection', handler)
    },
  }
}

const tick = (ms = 20): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

describe('R5-147 shouldRetry 抛错不得顶掉真实失败', () => {
  it('回调异常原样抛出，但被它掩盖的原始抛出值挂在 cause 上', async () => {
    const real = new Error('root cause')
    const callbackError = new Error('shouldRetry blew up')

    await expect(
      retryWithBackoff(
        async (): Promise<never> => {
          throw real
        },
        {
          retries: 2,
          delay: 0,
          shouldRetry: () => {
            throw callbackError
          },
        },
      ),
    ).rejects.toBe(callbackError)
    expect((callbackError as Error & { cause?: unknown }).cause).toBe(real)
  })

  it('已有 cause 时不覆盖更精确的那条链', async () => {
    const existing = new Error('existing')
    const callbackError = Object.assign(new Error('shouldRetry blew up'), { cause: existing })

    await expect(
      retryWithBackoff(
        async (): Promise<never> => {
          throw new Error('root')
        },
        {
          retries: 1,
          delay: 0,
          shouldRetry: () => {
            throw callbackError
          },
        },
      ),
    ).rejects.toBe(callbackError)
    expect((callbackError as Error & { cause?: unknown }).cause).toBe(existing)
  })

  it('冻结的回调异常挂不上 cause 也照常抛出', async () => {
    const callbackError = Object.freeze(new Error('frozen callback'))

    await expect(
      retryWithBackoff(
        async (): Promise<never> => {
          throw new Error('root')
        },
        {
          retries: 1,
          delay: 0,
          shouldRetry: () => {
            throw callbackError
          },
        },
      ),
    ).rejects.toBe(callbackError)
  })

  it('回调抛出非 Error 时保持抛出物身份（不为了挂 cause 改判类型）', async () => {
    await expect(
      retryWithBackoff(
        async (): Promise<never> => {
          throw new Error('root')
        },
        {
          retries: 1,
          delay: 0,
          shouldRetry: () => {
            throw 'raw-string'
          },
        },
      ),
    ).rejects.toBe('raw-string')
  })
})

describe('R5-149 抛出的对象只做一层原始字段投影', () => {
  it('嵌套内容以占位落地，且不执行 toJSON / getter', () => {
    let toJSONCalls = 0
    let getterCalls = 0
    const thrown = {
      code: 500,
      req: { token: 'secret-token' },
      tag: 'plain',
      toJSON: () => {
        toJSONCalls += 1

        return 'forged'
      },
      get lazy(): number {
        getterCalls += 1

        return 1
      },
    }

    expect(toError(thrown).message).toBe('{"code":500,"req":"[details omitted]","tag":"plain"}')
    expect(toJSONCalls).toBe(0)
    expect(getterCalls).toBe(0)
    expect(toError(thrown).message).not.toContain('secret-token')
  })

  it('BigInt 字段转文本（JSON.stringify 会直接抛 TypeError）', () => {
    expect(toError({ id: BigInt(9) }).message).toBe('{"id":"9n"}')
  })

  it('连 ownKeys 都被陷阱打断时只留下「抛出了对象」这个事实', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys(): never {
          throw new TypeError('trap')
        },
      },
    )

    expect(toError(hostile).message).toBe('[thrown object could not be inspected]')
  })
})

describe('R5-150 RetryOptions 可被引用', () => {
  it('导出的接口就是 retryWithBackoff 的入参契约', async () => {
    const options: RetryOptions = {
      retries: 1,
      delay: 0,
      shouldRetry: (error) => error.message === 'retry me',
      onRetry: () => undefined,
    }
    let calls = 0

    await expect(
      retryWithBackoff(async (): Promise<string> => {
        calls += 1
        if (calls === 1) throw new Error('retry me')

        return 'ok'
      }, options),
    ).resolves.toBe('ok')
    expect(calls).toBe(2)
  })
})

describe('R5-153 isThenable 判定不被宿主异常带崩', () => {
  const hostile = new Proxy(
    {},
    {
      get(): never {
        throw new TypeError('get trap')
      },
    },
  )

  it('读取 .then 抛错时按「非 thenable」降级', () => {
    expect(isThenable(hostile)).toBe(false)
    expect(isThenable(Promise.resolve(1))).toBe(true)
    expect(isThenable({ then: () => undefined })).toBe(true)
    expect(isThenable(null)).toBe(false)
    expect(isThenable(7)).toBe(false)
  })

  it('被装饰方法返回该宿主对象时，调用方看到的是原值而不是 trap 异常', () => {
    const host: Record<string | symbol, unknown> = { load: () => hostile }
    decorate(host, 'load', createDecorator({}))

    expect(callMethod(host, 'load')).toBe(hostile)
  })
})

describe('R5-154 after 回调的失败也要经 onError', () => {
  it('同步抛错：先上报 onError，再按原样抛出', async () => {
    const onError = jest.fn()
    const thrown = new Error('after threw')
    const host: Record<string | symbol, unknown> = {
      load: (): string => 'value',
    }
    decorate(
      host,
      'load',
      createDecorator({
        after: () => {
          throw thrown
        },
        onError,
      }),
    )

    expect(() => callMethod(host, 'load')).toThrow('after threw')
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(thrown)
  })

  it('after 返回 rejected Promise：异步路径上报 onError 且拒绝仍传给调用方', async () => {
    const onError = jest.fn()
    const reason = new Error('after rejected')
    const host: Record<string | symbol, unknown> = {
      load: async (): Promise<string> => 'value',
    }
    decorate(
      host,
      'load',
      createDecorator({
        after: () => Promise.reject(reason),
        onError,
      }),
    )

    await expect(callMethod(host, 'load')).rejects.toBe(reason)
    expect(onError).toHaveBeenCalledWith(reason)
  })

  it('after 返回 rejected Promise：同步路径就地留痕并同样上报', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const onError = jest.fn()
    const host: Record<string | symbol, unknown> = {
      load: (): string => 'sync',
    }
    decorate(
      host,
      'load',
      createDecorator({
        after: () => Promise.reject(new Error('after rejected')),
        onError,
      }),
    )

    expect(callMethod(host, 'load')).toBe('sync')
    await tick(0)
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    expect(consoleError).toHaveBeenCalledWith('[Action] async after callback rejected:', expect.any(Error))
  })
})

describe('R5-167 在途占位也受容量硬上限约束', () => {
  it('全部条目都在途时，超出上限的最旧占位会被淘汰（此前 Map 无界增长）', async () => {
    let executions = 0
    const host: Record<string | symbol, unknown> = {
      // 永不结算：占位在 inFlightExpiry（60s）内都不会被过期回收
      load: (_tag: number): Promise<string> => {
        executions += 1

        return new Promise<string>(() => undefined)
      },
    }
    decorate(host, 'load', withCache({ ttl: 5000 }))

    for (let i = 0; i < 1005; i++) {
      void callMethod(host, 'load', i)
    }
    expect(executions).toBe(1005)

    // 修复前：淘汰循环对占位无条件 continue，容量保护等于不存在，
    // 最旧的 key=0 占位仍在表里 → 这次调用会复用它、不再执行原方法
    void callMethod(host, 'load', 0)
    expect(executions).toBe(1006)
  })
})

describe('R5-168 过期回收按写入次数摊销', () => {
  it('少数几次写入不再全表扫描删除，跨过回收窗口后才回收', async () => {
    jest.useFakeTimers()
    const deleteSpy = jest.spyOn(Map.prototype, 'delete')
    let calls = 0
    const host: Record<string | symbol, unknown> = {
      load: async (_tag: string): Promise<string> => {
        calls += 1

        return `v${calls}`
      },
    }
    decorate(host, 'load', withCache({ ttl: 1000 }))

    await (callMethod(host, 'load', 'a') as Promise<string>)
    jest.advanceTimersByTime(1500)

    const before = deleteSpy.mock.calls.length
    await (callMethod(host, 'load', 'b') as Promise<string>)
    await (callMethod(host, 'load', 'c') as Promise<string>)
    // 修复前：这里就已经把过期的 a 删掉了（每次写入一遍全表扫描）
    expect(deleteSpy.mock.calls.length).toBe(before)

    for (let i = 0; i < 20; i++) {
      await (callMethod(host, 'load', `k${i}`) as Promise<string>)
    }
    expect(deleteSpy.mock.calls.length).toBeGreaterThan(before)
    jest.useRealTimers()
  })
})

describe('R5-169 值语义路径带类型标签', () => {
  it('自有键相同但原型不同的参数不再串用同一个缓存条目', async () => {
    const results: string[] = []
    let calls = 0
    const host: Record<string | symbol, unknown> = {
      load: (_value: unknown): string => {
        calls += 1
        results.push(`r${calls}`)

        return `r${calls}`
      },
    }
    decorate(host, 'load', withCache({ ttl: 5000 }))

    const typed = callMethod(host, 'load', new Uint8Array([1, 2]))
    const plain = callMethod(host, 'load', { 0: 1, 1: 2 })
    const boxed = callMethod(host, 'load', new Number(12))

    // 修复前：三者都落进 {"0":"n:1","1":"n:2"} 同一个键，后两次直接拿第一次的结果
    expect(typed).toBe('r1')
    expect(plain).toBe('r2')
    expect(calls).toBe(3)
    expect(typeof boxed).toBe('string')
  })

  it('纯对象与 null 原型对象仍按值等价共用缓存', () => {
    let calls = 0
    const host: Record<string | symbol, unknown> = {
      load: (_value: unknown): string => {
        calls += 1

        return `r${calls}`
      },
    }
    decorate(host, 'load', withCache({ ttl: 5000 }))
    const nullProto = Object.assign(Object.create(null), { a: 1 })

    expect(callMethod(host, 'load', { a: 1 })).toBe('r1')
    expect(callMethod(host, 'load', nullProto)).toBe('r1')
    expect(calls).toBe(1)
  })
})

describe('R5-170 keyFn 返回非字符串时按不缓存降级', () => {
  for (const [label, returned] of [
    ['undefined（箭头函数漏写 return）', undefined],
    ['对象', { id: 1 }],
  ] as Array<[string, unknown]>) {
    it(`keyFn 返回${label}：各次调用互不串用`, () => {
      const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined)
      let calls = 0
      const host: Record<string | symbol, unknown> = {
        load: (_id: number): string => {
          calls += 1

          return `r${calls}`
        },
      }
      decorate(host, 'load', withCache({ ttl: 5000, keyFn: (() => returned) as unknown as (...args: unknown[]) => string }))

      // 修复前：String() 把两者都折成同一个常量 → 第二次调用拿到第一次的结果
      expect(callMethod(host, 'load', 1)).toBe('r1')
      expect(callMethod(host, 'load', 2)).toBe('r2')
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('keyFn returned a non-string key'), returned)
    })
  }

  it('keyFn 返回数字时按字符串键正常缓存', () => {
    let calls = 0
    const host: Record<string | symbol, unknown> = {
      load: (_id: number): string => {
        calls += 1

        return `r${calls}`
      },
    }
    decorate(host, 'load', withCache({ ttl: 5000, keyFn: (id: unknown) => Number(id) as unknown as string }))

    expect(callMethod(host, 'load', 7)).toBe('r1')
    expect(callMethod(host, 'load', 7)).toBe('r1')
    expect(callMethod(host, 'load', 8)).toBe('r2')
  })
})

describe('R5-193 连带项：withCache 用 isThenable 判定异步性', () => {
  it('返回手写 thenable 的同步方法走在途占位，结果只结算一次', async () => {
    let thenCalls = 0
    let release: (value: string) => void = () => undefined
    const host: Record<string | symbol, unknown> = {
      load: (_id: number): unknown =>
        // 非 Promise 实例（跨 realm 的 Promise 同理）：`instanceof Promise` 会漏判
        ({
          then: (onFulfill?: (v: string) => void) => {
            thenCalls += 1
            release = onFulfill ?? ((): void => undefined)
          },
        }),
    }
    decorate(host, 'load', withCache({ ttl: 5000 }))

    const first = callMethod(host, 'load', 1) as Promise<string>
    const second = callMethod(host, 'load', 1) as Promise<string>
    expect(first).toBe(second)
    // Promise.resolve(thenable) 在微任务里才调用它的 then，先让出一个宏任务窗口
    await tick(0)
    expect(thenCalls).toBe(1)
    release('done')
    expect(await first).toBe('done')
    // 修复前：thenable 被当成同步返回值整体缓存，每次命中都要再走一遍它的 then
    expect(thenCalls).toBe(1)

    const third = (await (callMethod(host, 'load', 1) as Promise<string>)) as string
    expect(third).toBe('done')
    expect(thenCalls).toBe(1)
  })
})

describe('R5-173 withDebounce 的 delay 归一化', () => {
  /** 返回「被装饰方法的实际执行次数」探测器：装饰会替换掉 descriptor.value，不能直接 spy 它 */
  function createHost(): { host: Record<string | symbol, unknown>; calls: () => number } {
    let calls = 0
    const host: Record<string | symbol, unknown> = {
      run: async (): Promise<string> => {
        calls += 1

        return 'x'
      },
    }

    return { host, calls: () => calls }
  }

  for (const [bad, expected] of [
    [Number.NaN, 300],
    [-50, 300],
    [Number.POSITIVE_INFINITY, 300],
    [50, 50],
  ] as Array<[number, number]>) {
    it(`delay=${String(bad)} 归一为 ${expected}ms`, () => {
      jest.useFakeTimers()
      const { host, calls } = createHost()
      decorate(host, 'run', withDebounce(bad))

      void callMethod(host, 'run')
      jest.advanceTimersByTime(expected - 1)
      expect(calls()).toBe(0)
      jest.advanceTimersByTime(1)
      expect(calls()).toBe(1)
    })
  }
})

describe('R5-172 到期/flush 的失败不得漏成 unhandledRejection', () => {
  it('fire-and-forget 的调用在延迟到期时失败：无全局未处理告警', async () => {
    const seen = captureRejections()
    const host: Record<string | symbol, unknown> = {
      run: jest.fn(async (): Promise<never> => {
        throw new Error('real failure')
      }),
    }
    decorate(host, 'run', withDebounce(1))

    void callMethod(host, 'run')
    await tick()
    seen.stop()
    expect(seen.reasons).toHaveLength(0)
  })

  it('flushDebouncedCalls 触发的失败同样被兜住，await 的调用方仍拿得到', async () => {
    const seen = captureRejections()
    const host: Record<string | symbol, unknown> = {
      run: jest.fn(async (): Promise<never> => {
        throw new Error('flush failure')
      }),
    }
    decorate(host, 'run', withDebounce(1000))

    const awaited = callMethod(host, 'run') as Promise<unknown>
    void callMethod(host, 'run')
    flushDebouncedCalls(host)

    await expect(awaited).rejects.toThrow('flush failure')
    await tick()
    seen.stop()
    expect(seen.reasons).toHaveLength(0)
  })
})
