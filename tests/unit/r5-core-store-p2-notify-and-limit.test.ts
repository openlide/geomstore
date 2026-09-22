/**
 * 分片 core-store-p2 的回归锁（第五轮 `ocrreview.md`）
 *
 * 只钉 `tests/unit/store/modules/SubscriptionManager.test.ts` 里尚未覆盖的三条语义：
 * - R5-122：`cloneOnNotify=false` 时管理器**不做任何隐藏拷贝**，监听器之间的隔离责任
 *  归调用方（该边界写进了 `notify` 文档；库内 `Store._notifyListeners` 的接线见台账 NEEDS-MAIN）
 * - R5-122：`cloneOnNotify=true` 且本轮没有只读注册时，不再为「无人读的共用槽」白拷一份
 * - R5-123：`onLimit='throw'` 下重复注册同样进门禁，且抛错不留半截注册
 */

import { SubscriptionManager } from '@/core/store/SubscriptionManager.js'
import type { State } from '@/types/store.js'

describe('R5-122 notify 的载荷分配边界', () => {
  it('cloneOnNotify=false：全部注册共享调用方载荷，管理器不隐藏拷贝', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const manager = new SubscriptionManager<State>({ storeName: 'r5-p2' })
    const state: State = { nested: { n: 1 } }
    const received: unknown[] = []

    manager.add((s) => received.push(s))
    manager.add((s) => received.push(s), { readOnly: true })
    manager.notify(state, false)

    expect(received).toHaveLength(2)
    // 两条都直接是调用方给的那个对象：可写回调就地改载荷，后面的监听器就读到半成品，
    // 这正是「拷贝归属=false」的字面含义（要按注册隔离必须传 true）
    expect(received[0]).toBe(state)
    expect(received[1]).toBe(state)
    // 该组合在 dev 必须给出信号，而不是静默放行
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cloneOnNotify=false 与可写订阅者共存'))
    warnSpy.mockRestore()
  })

  it('cloneOnNotify=true 且本轮全是可写注册：不额外拷一份没人读的共用载荷', () => {
    const manager = new SubscriptionManager<State>({ storeName: 'r5-p2' })
    let traversals = 0
    const state = {
      get n() {
        traversals += 1
        return 1
      },
    }
    const seen: number[] = []

    manager.add((s) => seen.push((s as unknown as { n: number }).n))
    manager.add((s) => seen.push((s as unknown as { n: number }).n))
    manager.notify(state as unknown as State)

    // 每次深拷贝读一次源头的 getter：2 份独立克隆 = 2 次；
    // 若仍保留「整轮共用一份」的写法则是 3 次（2 份可写 + 1 份没人读的共用体）
    expect(traversals).toBe(2)
    expect(seen).toEqual([1, 1])
  })
})

describe('R5-123 上限门禁覆盖重复注册', () => {
  it('onLimit=throw：同一监听器的重复注册达上限时抛错，且不动既有注册', () => {
    const manager = new SubscriptionManager<State>({ storeName: 'r5-p2', maxSubscribers: 1, onLimit: 'throw' })
    const listener = jest.fn()
    const handle = manager.add(listener)

    expect(() => manager.add(listener)).toThrow(/Subscriber limit reached/)
    // 抛错路径不得留下半截注册
    expect(manager.size).toBe(1)
    expect(manager.delete(listener, handle)).toBe(true)
    expect(manager.size).toBe(0)
  })

  it('新注册与重复注册混排：size 始终不超上限，最后 3 份注册存活', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const manager = new SubscriptionManager<State>({ storeName: 'r5-p2', maxSubscribers: 3 })
    const listeners = Array.from({ length: 6 }, () => jest.fn())

    listeners.forEach((listener) => {
      // 每个监听器注册两次：修复前第二笔免检，size 会一路涨到 12
      manager.add(listener)
      manager.add(listener)
      expect(manager.size).toBeLessThanOrEqual(3)
    })

    expect(manager.size).toBe(3)
    manager.notify({ x: 1 })
    // 前三个各被后到的注册挤掉一次，最终只有后三个在册、各收到一次回调
    listeners.slice(0, 3).forEach((listener) => expect(listener).not.toHaveBeenCalled())
    listeners.slice(3).forEach((listener) => expect(listener).toHaveBeenCalledTimes(1))

    warnSpy.mockRestore()
  })
})
