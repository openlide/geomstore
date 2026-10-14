/**
 * G2-extras medium 第 1 片（#250-#252）的审计回归用例
 *
 * 逐条锁定「报告成立后新固化的行为」：节流器的按宿主 Promise 标记、
 * 新窗口作废尾调用定时器、interval 规范化。
 */

import { withThrottle } from '@/extras/action/decorators/throttle.js'

describe('#250 返回形态按 (宿主, 方法) 判定', () => {
  it('一个实例返回 Promise 不会把其他实例的抑制调用也变成 Promise', () => {
    jest.useFakeTimers()
    jest.setSystemTime(10_000)
    // 同一装饰器实例装饰两个宿主：非 async 语法但返回 Promise 的方法会置起标记
    const decorator = withThrottle(1000, { leading: true, trailing: false })

    class PromiseHost {
      run(): Promise<number> {
        return Promise.resolve(1)
      }
    }
    class SyncHost {
      run(): number {
        return 2
      }
    }

    const asyncDescriptor = Object.getOwnPropertyDescriptor(PromiseHost.prototype, 'run') as PropertyDescriptor
    const syncDescriptor = Object.getOwnPropertyDescriptor(SyncHost.prototype, 'run') as PropertyDescriptor
    decorator(PromiseHost.prototype, 'run', asyncDescriptor)
    decorator(SyncHost.prototype, 'run', syncDescriptor)

    const asyncHost = new PromiseHost()
    const syncHost = new SyncHost()
    const callAsync = () => (asyncDescriptor.value as (this: unknown) => unknown).call(asyncHost)
    const callSync = () => (syncDescriptor.value as (this: unknown) => unknown).call(syncHost)

    expect(callAsync()).toBeInstanceOf(Promise)
    // 同宿主被抑制的调用返回 Promise：调用方 await 不会崩
    expect(callAsync()).toBeInstanceOf(Promise)
    expect(callSync()).toBe(2)
    // 另一宿主从未观测到 Promise，被抑制的调用仍必须是 undefined 而不是 Promise
    expect(callSync()).toBeUndefined()

    jest.useRealTimers()
  })
})

describe('#251 新窗口作废上一窗口的尾调用定时器', () => {
  it('残留定时器被清除，尾调用只在正确时刻补发一次', () => {
    jest.useFakeTimers()
    jest.setSystemTime(10_000)
    const calls: number[] = []
    class Demo {
      run(value: number): number {
        calls.push(value)
        return value
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'run') as PropertyDescriptor
    withThrottle(100, { leading: true, trailing: true })(Demo.prototype, 'run', descriptor)
    const host = new Demo()
    const invoke = (value: number) => (descriptor.value as (this: unknown, v: number) => unknown).call(host, value)

    invoke(1) // t=10000：leading
    jest.setSystemTime(10_010)
    invoke(2) // 窗口内被抑制 → 尾定时器到期于 10100
    expect(jest.getTimerCount()).toBe(1)

    jest.setSystemTime(10_100)
    invoke(3) // 恰为窗口末尾 → 新窗口 leading
    // 修复前此处仍挂着 1 个「参数已被清空、但仍会抹掉新定时器引用」的空转定时器
    expect(jest.getTimerCount()).toBe(0)

    jest.setSystemTime(10_110)
    invoke(4) // 新窗口内被抑制 → 到期于 10200
    jest.advanceTimersByTime(89) // t=10199
    expect(calls).toEqual([1, 3])
    jest.advanceTimersByTime(1) // t=10200：有且仅有一次补发
    expect(calls).toEqual([1, 3, 4])
    expect(jest.getTimerCount()).toBe(0)

    jest.useRealTimers()
  })
})

describe('#252 interval 规范化', () => {
  it.each([0, -100, Number.NaN, Number.POSITIVE_INFINITY])('interval=%p 回退为 300ms 窗口', (interval) => {
    jest.useFakeTimers()
    jest.setSystemTime(1000)
    const calls: number[] = []
    class Demo {
      run(value: number): number {
        calls.push(value)
        return value
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'run') as PropertyDescriptor
    withThrottle(interval, { leading: true, trailing: true })(Demo.prototype, 'run', descriptor)
    const host = new Demo()
    const invoke = (value: number) => (descriptor.value as (this: unknown, v: number) => unknown).call(host, value)

    invoke(1) // t=1000：新窗口 leading
    jest.setSystemTime(1010)
    invoke(2) // 窗口内 → 尾调用到期于 1300
    // 修复前：窗口判断恒不成立，且 `setTimeout(fn, NaN|Infinity)` 退化为立即执行
    jest.advanceTimersByTime(289) // t=1299
    expect(calls).toEqual([1])
    jest.advanceTimersByTime(1) // t=1300
    expect(calls).toEqual([1, 2])

    jest.useRealTimers()
  })
})
