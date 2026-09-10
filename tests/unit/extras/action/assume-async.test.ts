/**
 * withThrottle 的 assumeAsync 选项
 *
 * 针对「非 async 语法但返回 Promise」的方法：`leading=false` 时首次调用即被抑制，
 * 装饰器无从观测返回值，默认按同步语义返回 undefined。这会让调用方的
 * `await` / `.then()` 在首次调用就拿到 undefined。assumeAsync 可强制返回 Promise。
 *
 * 注：withCache 无需该选项——缓存命中必然发生在一次真实执行之后，
 * 届时运行时已通过 observesPromise 自动识别出 Promise 语义。
 */

import { withThrottle } from '@/extras/action/decorators/throttle.js'

/** 非 async 语法、但返回 Promise 的方法（静态判定为同步，需运行时观测兜底） */
class PromiseReturningDemo {
  calls = 0

  run(this: PromiseReturningDemo): Promise<number> {
    this.calls += 1
    return Promise.resolve(42)
  }
}

function decorateRun(options: { leading: boolean; trailing: boolean; assumeAsync?: boolean }): () => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(PromiseReturningDemo.prototype, 'run') as PropertyDescriptor
  withThrottle(1000, options)(PromiseReturningDemo.prototype, 'run', descriptor)
  const host = new PromiseReturningDemo()
  return () => (descriptor.value as (...args: unknown[]) => unknown).call(host)
}

describe('withThrottle 的 assumeAsync', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('未开启时：leading=false 的首次调用按同步语义返回 undefined（既有行为）', () => {
    jest.useFakeTimers()
    const invoke = decorateRun({ leading: false, trailing: true })

    expect(invoke()).toBeUndefined()
  })

  it('开启后：被抑制的调用返回 Promise，且窗口结束时仍会补发一次', async () => {
    jest.useFakeTimers()
    const invoke = decorateRun({ leading: false, trailing: true, assumeAsync: true })

    const first = invoke()
    expect(first).toBeInstanceOf(Promise)

    // 窗口结束：尾调用补发（fire-and-forget，不影响首次调用的返回值）
    await jest.advanceTimersByTimeAsync(1000)

    await expect(first).resolves.toBeUndefined()
  })
})
