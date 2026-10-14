/**
 * OCR medium 第四轮 p2 分片（G2-extras/error）回归用例
 *
 * 覆盖：#262 execute/executeAsync 诚实返回 undefined、
 * #263 装饰器对自定义 thenable 的捕获。
 */

import { ErrorBoundary } from '@/extras/error/index.js'
import { withErrorBoundary } from '@/extras/error/ErrorBoundary.js'

describe('#262 ErrorBoundary 返回类型诚实化', () => {
  it('#262 recoverable 且未配 fallback 时 execute 返回 undefined（F 显式非 undefined 亦如此）', () => {
    const boundary = new ErrorBoundary<{ count: number }, string>({ recoverable: true })

    const result = boundary.execute(() => {
      throw new Error('boom')
    })
    expect(result).toBeUndefined()
  })

  it('#262 executeAsync 同路径返回 undefined 而非谎称 T | F', async () => {
    const boundary = new ErrorBoundary<{ count: number }, string>({ recoverable: true })

    const result = await boundary.executeAsync(async () => {
      throw new Error('boom')
    })
    expect(result).toBeUndefined()
  })

  it('#262 setFallbackState(undefined) 撤销回退值后返回 undefined', () => {
    const boundary = new ErrorBoundary<undefined, string>({ recoverable: true, fallback: 'fb' })
    boundary.setFallbackState(undefined as unknown as string)

    expect(
      boundary.execute(() => {
        throw new Error('boom')
      }),
    ).toBeUndefined()
  })
})

describe('#263 withErrorBoundary 捕获跨 realm/自定义 thenable 的 rejection', () => {
  it('#263 被装饰方法返回非 Promise 的 thenable 时，其 rejection 仍走边界而非成为未处理拒绝', async () => {
    const onError = jest.fn()
    const descriptor: PropertyDescriptor = {
      value: function () {
        // 模拟自定义 thenable（instanceof Promise 为 false）
        return {
          then(_resolve: unknown, reject: (reason: unknown) => void) {
            reject(new Error('thenable boom'))
          },
        }
      },
      writable: true,
      configurable: true,
      enumerable: true,
    }
    withErrorBoundary({ onError, recoverable: true } as any)({}, 'loadData', descriptor)
    const host = { loadData: descriptor.value as () => Promise<unknown> }

    await expect(host.loadData()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0][0] as Error).message).toBe('thenable boom')
  })

  it('#263 返回普通对象（非 thenable）不被误包装，原样透传', async () => {
    const descriptor: PropertyDescriptor = {
      value: function () {
        return { count: 1 }
      },
      writable: true,
      configurable: true,
      enumerable: true,
    }
    withErrorBoundary({ recoverable: true } as any)({}, 'loadData', descriptor)
    const host = { loadData: descriptor.value as () => unknown }

    expect(host.loadData()).toEqual({ count: 1 })
  })
})
