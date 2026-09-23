/**
 * 第六轮 f1-05 回归锁：SubscriptionManager 的上限守卫与对外接口形状
 *
 * R6-041：`maxSubscribers` 非有限值（NaN/Infinity）让门禁 `_totalCount >= _maxSubscribers`
 * 恒假 ⇒ 驱逐逻辑永不触发、护栏静默消失。
 * R6-088：`SubscriptionManagerInterface` 把 `add` 写成返回 void、`delete` 写成只接受监听器，
 * 按接口编程的调用方拿不到注册句柄，只能走「退最早一份」的误用面。
 */

import { SubscriptionManager } from '@/core/store/SubscriptionManager.js'
import type { SubscriptionManagerInterface } from '@/core/store/types.js'

type TestState = { count: number }

const makeManager = (maxSubscribers?: number): SubscriptionManager<TestState> => new SubscriptionManager<TestState>({ storeName: 'r6-f1-05', maxSubscribers })

describe('R6-041 maxSubscribers 非法值守卫', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation()
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ] as const)('%s 上限回落到默认 50 并告警', (_label, value) => {
    const manager = makeManager(value)
    for (let i = 0; i < 300; i++) {
      manager.add(() => {})
    }
    // 旧实现：`300 >= NaN` / `300 >= Infinity` 恒假 → size 一路涨到 300
    expect(manager.size).toBe(50)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('不是有效的订阅者上限'))
  })

  it('小数上限向下取整（2.5 ⇒ 最多 2 份注册）', () => {
    const manager = makeManager(2.5)
    manager.add(() => {})
    manager.add(() => {})
    manager.add(() => {})
    expect(manager.size).toBe(2)
    // 合法值不出产非法值告警（第三条走的是正常的驱逐告警，见下面用例）
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('不是有效的订阅者上限'))
  })

  it('未配置与合法配置的行为不变', () => {
    const byDefault = makeManager(undefined)
    expect(byDefault.size).toBe(0)
    for (let i = 0; i < 60; i++) byDefault.add(() => {})
    expect(byDefault.size).toBe(50)

    const strict = makeManager(2)
    strict.add(() => {})
    strict.add(() => {})
    strict.add(() => {})
    expect(strict.size).toBe(2)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('订阅者数量已达到上限'))
  })

  it('0 与负数保留既有语义（首个订阅仍成功，不额外拒绝）', () => {
    const zero = makeManager(0)
    zero.add(() => {})
    expect(zero.size).toBe(1)
    zero.add(() => {})
    expect(zero.size).toBe(1)
  })
})

describe('R6-088 SubscriptionManagerInterface 与实现同形状', () => {
  it('按接口编程也能持有句柄，并只退订自己要退的那一份', () => {
    const manager = makeManager(10)
    const iface: SubscriptionManagerInterface<TestState> = manager
    const seen: number[] = []
    const listener = (state: TestState): void => {
      seen.push(state.count)
    }

    const first = iface.add(listener, { readOnly: true })
    const second = iface.add(listener)
    expect(iface.size).toBe(2)
    expect(typeof iface.hasWritableListeners()).toBe('boolean')

    expect(iface.delete(listener, second)).toBe(true)
    expect(iface.size).toBe(1)
    // 句柄退订不受「同身份另一份注册」影响
    expect(iface.delete(listener, second)).toBe(false)
    expect(iface.size).toBe(1)
    iface.notify({ count: 7 })
    expect(seen).toEqual([7])
    expect(iface.delete(listener, first)).toBe(true)
    expect(iface.size).toBe(0)
  })

  it('接口侧 delete(listener) 明确是「退最早一份」的窄化语义', () => {
    const manager = makeManager(10)
    const iface: SubscriptionManagerInterface<TestState> = manager
    const listener = (): void => {}
    const first = iface.add(listener)
    iface.add(listener)
    expect(iface.delete(listener)).toBe(true)
    expect(iface.size).toBe(1)
    // 剩下的那一份就是原先的 first 之后新加的，first 句柄此时已失效
    expect(iface.delete(listener, first)).toBe(false)
  })
})
