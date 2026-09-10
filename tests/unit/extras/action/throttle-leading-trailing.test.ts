/**
 * withThrottle：leading / trailing 的边界时序与返回形态
 */

import { withThrottle } from '@/extras/action/decorators/throttle.js'

describe('withThrottle 的尾调用与返回形态', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('leading 调用清空参数后，残留尾调用定时器触发时走空参数分支', async () => {
    jest.useFakeTimers()
    // 起始时刻须显著大于节流器初始 lastCallTime(0)，否则首次调用会被判为「窗口内」而抑制
    jest.setSystemTime(10_000)
    const calls: number[] = []
    class Demo {
      run(this: Demo, value: number): number {
        calls.push(value)
        return value
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'run') as PropertyDescriptor
    withThrottle(100, { leading: true, trailing: true })(Demo.prototype, 'run', descriptor)
    const host = new Demo()
    const invoke = (value: number): number => (descriptor.value as any).call(host, value)

    invoke(1) // t=10000：新窗口 → leading
    jest.setSystemTime(10_010)
    invoke(2) // 窗口内被抑制 → 排入尾调用（定时器到期于 t=10100）

    // 关键：用微任务制造「leading 早于尾调用回调」的次序——微任务先于定时器执行。
    // 若直接 setSystemTime(10100) 或 advanceTimers，尾调用会先带着参数 2 跑掉
    jest.setSystemTime(10_100)
    await Promise.resolve().then(() => {
      invoke(3) // 恰为窗口末尾 → 新窗口 leading，清空 pendingArgs
    })

    jest.advanceTimersByTime(1) // 残留尾调用定时器触发：pendingArgs 已为 null，不应补发

    // 只有两次 leading 调用：参数 2 未被尾调用补发
    expect(calls).toEqual([1, 3])
  })

  it('leading=false：同步方法返回 undefined，异步方法返回 Promise', () => {
    jest.useFakeTimers()
    class Demo {
      sync(this: Demo): number {
        return 1
      }
      async asyncMethod(this: Demo): Promise<number> {
        return 2
      }
    }
    const syncDescriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'sync') as PropertyDescriptor
    const asyncDescriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'asyncMethod') as PropertyDescriptor
    withThrottle(1000, { leading: false, trailing: true })(Demo.prototype, 'sync', syncDescriptor)
    withThrottle(1000, { leading: false, trailing: true })(Demo.prototype, 'asyncMethod', asyncDescriptor)
    const host = new Demo()

    expect((syncDescriptor.value as any).call(host)).toBeUndefined()
    expect((asyncDescriptor.value as any).call(host)).toBeInstanceOf(Promise)
  })
})
