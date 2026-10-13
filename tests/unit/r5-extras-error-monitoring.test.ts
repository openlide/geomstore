/**
 * 第五轮 extras-error 分片回归（R5-206）
 *
 * 覆盖的公开行为：
 * - withErrorBoundary 只对「被包裹方法的原始返回值」做 thenable 判定
 */

import { withErrorBoundary } from '@/extras/error/ErrorBoundary.js'

/** 把装饰器套到一个方法描述符上，返回宿主对象 */
function decorate(value: () => unknown, options?: Parameters<typeof withErrorBoundary>[0]): { call: () => unknown } {
  const descriptor: PropertyDescriptor = { value, writable: true, configurable: true, enumerable: true }
  withErrorBoundary(options)({}, 'loadData', descriptor)
  return { call: descriptor.value as () => unknown }
}

describe('R5-206 withErrorBoundary 只判定被包裹方法的原始返回值', () => {
  it('回退值自带 callable then 时按原值返回，不再被 re-wrap 成 Promise', () => {
    const fallback = { then: () => 'not-a-promise', value: 1 }
    const host = decorate(
      () => {
        throw new Error('boom')
      },
      { recoverable: true, fallback: fallback as never },
    )

    expect(host.call()).toBe(fallback)
  })

  it('方法自己的返回值是自定义 thenable 时仍被等待（#263 契约不因本修复回退）', async () => {
    const onError = jest.fn()
    const host = decorate(
      () => ({
        then: (_resolve: unknown, reject: (reason: unknown) => void) => reject(new Error('thenable boom')),
      }),

      { onError, recoverable: true, fallback: 'fb' },
    )

    const returned = host.call()
    expect(typeof (returned as Promise<unknown>).then).toBe('function')
    await expect(returned as Promise<unknown>).resolves.toBe('fb')
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('被装饰的 async 方法的 rejection 仍被边界捕获', async () => {
    const onError = jest.fn()
    const host = decorate(
      () => Promise.reject(new Error('async boom')),

      { onError, recoverable: true, fallback: 'fb' },
    )

    await expect(Promise.resolve(host.call())).resolves.toBe('fb')
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0][0] as Error).message).toBe('async boom')
  })

  it('方法同步抛出时不会再对回退值走一次异步包裹', async () => {
    const host = decorate(
      () => {
        throw new Error('sync boom')
      },
      { recoverable: true, fallback: 0 },
    )

    expect(host.call()).toBe(0)
  })
})
