/**
 * SubscriptionManager 模块测试
 * 目标覆盖率: 95%+
 */

import { SubscriptionManager, createSubscribeFunction } from '@/core/store/SubscriptionManager.js'
import type { State } from '@/types/store.js'

describe('SubscriptionManager', () => {
  const createManager = (maxSubscribers = 50) => {
    return new SubscriptionManager({
      storeName: 'test-store',
      maxSubscribers,
    })
  }

  describe('基本功能', () => {
    it('应该正确添加监听器', () => {
      const manager = createManager()
      const listener = jest.fn()

      manager.add(listener)
      expect(manager.size).toBe(1)
    })

    it('应该正确移除监听器', () => {
      const manager = createManager()
      const listener = jest.fn()

      manager.add(listener)
      expect(manager.size).toBe(1)

      manager.delete(listener)
      expect(manager.size).toBe(0)
    })

    it('应该正确清空所有监听器', () => {
      const manager = createManager()
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      manager.add(listener1)
      manager.add(listener2)
      expect(manager.size).toBe(2)

      manager.clear()
      expect(manager.size).toBe(0)
    })

    it('应该正确获取监听器数量', () => {
      const manager = createManager()
      expect(manager.size).toBe(0)

      manager.add(jest.fn())
      expect(manager.size).toBe(1)

      manager.add(jest.fn())
      expect(manager.size).toBe(2)
    })

    it('不传 maxSubscribers 时应该使用默认值 50', () => {
      // 覆盖 options.maxSubscribers ?? 50 的 ?? 右侧分支
      const manager = new SubscriptionManager({
        storeName: 'test-store',
        // 不传 maxSubscribers
      } as any)
      const maxSubscribers = (manager as any)._maxSubscribers
      expect(maxSubscribers).toBe(50)

      // 验证可以正常添加监听器
      manager.add(jest.fn())
      expect(manager.size).toBe(1)
    })
  })

  describe('notify', () => {
    it('应该通知所有监听器', () => {
      const manager = createManager()
      const listener1 = jest.fn()
      const listener2 = jest.fn()
      const state = { count: 1 }

      manager.add(listener1)
      manager.add(listener2)
      manager.notify(state)

      expect(listener1).toHaveBeenCalledWith(state)
      expect(listener2).toHaveBeenCalledWith(state)
    })

    it('应该为每个监听器创建状态快照', () => {
      const manager = createManager()
      const state = { count: 1 }
      let receivedState: any = null

      manager.add((s) => {
        receivedState = s
      })
      manager.notify(state)

      // 修改原状态不应影响已接收的状态
      state.count = 999
      expect(receivedState.count).toBe(1)
    })

    it('应该处理监听器中的错误', () => {
      const manager = createManager()
      const errorListener = jest.fn(() => {
        throw new Error('Listener error')
      })
      const normalListener = jest.fn()
      const state = { count: 1 }

      manager.add(errorListener)
      manager.add(normalListener)
      manager.notify(state)

      // 即使有错误，其他监听器也应该被调用
      expect(errorListener).toHaveBeenCalled()
      expect(normalListener).toHaveBeenCalled()
    })
  })

  describe('最大订阅者限制', () => {
    it('应该在达到上限时打印警告', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const manager = createManager(2)

      manager.add(jest.fn())
      manager.add(jest.fn())
      manager.add(jest.fn()) // 应该触发警告

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('订阅者数量已达到上限'))
      warnSpy.mockRestore()
    })

    it('应该在达到上限时移除最早的监听器', () => {
      const manager = createManager(2)
      const listener1 = jest.fn()
      const listener2 = jest.fn()
      const listener3 = jest.fn()

      manager.add(listener1)
      manager.add(listener2)
      manager.add(listener3) // 应该移除 listener1

      // listener1 应该被移除
      manager.notify({} as State)
      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()
      expect(listener3).toHaveBeenCalled()
    })

    it('REGR-SUB-001: 驱逐只应减一份，被驱逐监听器的其余注册仍然有效', () => {
      const manager = createManager(2)
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      manager.add(listener1)
      manager.add(listener1) // 同一监听器两份注册，size=2 已达上限
      manager.add(listener2) // 触发驱逐

      // 修复前整条删除 listener1（两份一起没），用户仍持有的退订句柄全部变成
      // 静默 no-op，也与本类「注册 N 次通知 N 次、退订只减一」的计数语义不一致
      manager.notify({} as State)
      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
      expect(manager.size).toBe(2)

      // 剩余那一份的退订句柄仍然有效
      manager.delete(listener1)
      manager.notify({} as State)
      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(2)

      warnSpy.mockRestore()
    })

    it('应该处理 firstListener 为 undefined 的情况', () => {
      const manager = createManager(1)
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

      // 直接替换内部 Map（模拟极端腐坏情况）：
      // size 迭代计出 2（超过上限），但 keys().next().value 为 undefined
      const mockMap = {
        forEach: (cb: (count: number) => void) => cb(2),
        get: () => undefined,
        has: () => false,
        keys: () => ({ next: () => ({ value: undefined, done: true }) }),
        set: () => mockMap,
        delete: () => true,
      }
      ;(manager as any)._listeners = mockMap
      // size 现由 O(1) 计数字段 _totalCount 提供（不再遍历 _listeners 求和），
      // 需同步设置计数，才能让 size(2) >= maxSubscribers(1) 进入驱逐分支
      ;(manager as any)._totalCount = 2

      // 驱逐循环遇到 undefined firstListener 必须跳过而不是抛错
      expect(() => manager.add(jest.fn())).not.toThrow()

      warnSpy.mockRestore()
    })

    it('firstListener 为 undefined 时不应调用 delete', () => {
      // 确保覆盖 if (firstListener) 为 false 的分支
      const manager = createManager(0) // maxSubscribers = 0，任何 add 都会触发上限逻辑
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

      // 先用真实的空 Set 触发：size=0 >= maxSubscribers=0
      // 但此时 listeners 为空，values().next().value 为 undefined
      const listener = jest.fn()
      manager.add(listener)

      // 不应抛出错误，且 listener 应该被添加
      expect(manager.size).toBe(1)

      warnSpy.mockRestore()
    })
  })

  describe('notify 错误处理', () => {
    it('应该在生产环境静默处理监听器错误', () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      const manager = createManager()
      const errorListener = jest.fn(() => {
        throw new Error('Listener error')
      })
      const normalListener = jest.fn()
      const state = { count: 1 }

      manager.add(errorListener)
      manager.add(normalListener)
      manager.notify(state)

      // 即使有错误，其他监听器也应该被调用
      expect(errorListener).toHaveBeenCalled()
      expect(normalListener).toHaveBeenCalled()

      process.env.NODE_ENV = originalEnv
    })
  })
})

describe('createSubscribeFunction', () => {
  it('应该返回取消订阅函数', () => {
    const manager = new SubscriptionManager({
      storeName: 'test',
      maxSubscribers: 50,
    })
    const subscribe = createSubscribeFunction(manager as any)
    const listener = jest.fn()

    const unsubscribe = subscribe(listener)
    expect(manager.size).toBe(1)

    unsubscribe()
    expect(manager.size).toBe(0)
  })

  it('取消订阅函数应该能够多次调用', () => {
    const manager = new SubscriptionManager({
      storeName: 'test',
      maxSubscribers: 50,
    })
    const subscribe = createSubscribeFunction(manager as any)
    const listener = jest.fn()

    const unsubscribe = subscribe(listener)
    unsubscribe()
    unsubscribe() // 再次调用不应报错

    expect(manager.size).toBe(0)
  })
})

// ==================== #14 引用计数语义回归 ====================
describe('SubscriptionManager 引用计数语义', () => {
  const createManager = (maxSubscribers = 50) =>
    new SubscriptionManager({
      storeName: 'test-store',
      maxSubscribers,
    })

  it('同一监听器注册 N 次按次数通知，部分退订只减一', () => {
    const manager = createManager()
    const listener = jest.fn()

    manager.add(listener)
    manager.add(listener)
    manager.add(listener)
    expect(manager.size).toBe(3)

    manager.notify({} as State)
    expect(listener).toHaveBeenCalledTimes(3)

    // 任一份退订只减少一份注册
    expect(manager.delete(listener)).toBe(true)
    expect(manager.size).toBe(2)

    manager.notify({} as State)
    expect(listener).toHaveBeenCalledTimes(5)

    // 未注册的监听器退订返回 false
    expect(manager.delete(jest.fn())).toBe(false)
  })

  it('上限对每一次注册生效：重复注册不再越界，新监听器仍按全局最旧驱逐', () => {
    const manager = createManager(2)
    const listenerA = jest.fn()
    const listenerB = jest.fn()
    const listenerC = jest.fn()
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

    manager.add(listenerA)
    manager.add(listenerB)
    // 已达上限的重复注册：让位的是 B 自己最早的一份注册，A 不受牵连
    manager.add(listenerB)
    expect(manager.size).toBe(2)

    // 新监听器达到上限：驱逐全局最早的 A
    manager.add(listenerC)
    manager.notify({} as State)

    expect(listenerA).not.toHaveBeenCalled()
    expect(listenerB).toHaveBeenCalledTimes(1)
    expect(listenerC).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })

  it('循环订阅同一监听器不会让注册总数无界增长（泄漏护栏）', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const manager = createManager(4)
    const subscribe = createSubscribeFunction(manager)
    const shared = jest.fn()

    // 每次 subscribe 都产出一个新句柄且从不退订：修复前 registrations 子 Map
    // 与 _totalCount 会一路涨到 200，maxSubscribers 在这条路径上完全失效
    for (let i = 0; i < 200; i++) {
      subscribe(shared)
    }

    expect(manager.size).toBe(4)
    expect((manager as unknown as { _listeners: Map<unknown, { registrations: Map<object, boolean> }> })._listeners.get(shared)!.registrations.size).toBe(4)
    warnSpy.mockRestore()
  })

  it('readOnly 按注册判定：仅存的注册可写时必须报告存在可写订阅者', () => {
    const manager = createManager(3)
    const shared = jest.fn()

    // 同一函数先以只读、后以可写注册；再驱逐掉最早的（只读）那一份
    manager.add(shared, { readOnly: true })
    manager.add(shared)
    manager.add(jest.fn(), { readOnly: true })
    manager.add(jest.fn(), { readOnly: true })
    expect(manager.hasWritableListeners()).toBe(true)

    // 驱逐一份只读注册后，shared 的可写注册仍在
    expect(manager.hasWritableListeners()).toBe(true)
  })

  it('纯只读订阅不报告可写订阅者（零拷贝路径保持）', () => {
    const manager = createManager(3)
    const listener = jest.fn()
    manager.add(listener, { readOnly: true })
    manager.add(jest.fn(), { readOnly: true })
    expect(manager.hasWritableListeners()).toBe(false)
    manager.delete(listener)
    expect(manager.hasWritableListeners()).toBe(false)
  })
})

// ==================== R5-122：监听器之间的载荷隔离 ====================
describe('SubscriptionManager 通知载荷隔离', () => {
  const createManager = (maxSubscribers = 50) => new SubscriptionManager({ storeName: 'test-store', maxSubscribers })

  it('可写监听器各得一份独立克隆，先执行者的就地改动不被后面的监听器看到', () => {
    const manager = createManager()
    const state = { nested: { n: 1 } }
    const received: Array<{ nested: { n: number } }> = []

    manager.add((s) => {
      const payload = s as typeof state
      received.push(payload)
      payload.nested.n = 999
    })
    manager.add((s) => received.push(s as typeof state))

    manager.notify(state)

    expect(received).toHaveLength(2)
    expect(received[0]).not.toBe(received[1])
    // 修复前两个回调共享同一份克隆，第二个读到的是被改过的中间态
    expect(received[1].nested.n).toBe(1)
    // 载荷与活状态同样隔离
    expect(state.nested.n).toBe(1)
  })

  it('只读注册之间共享同一份克隆（不为不会改载荷的订阅放大深拷贝开销）', () => {
    const manager = createManager()
    const received: unknown[] = []

    manager.add((s) => received.push(s), { readOnly: true })
    manager.add((s) => received.push(s), { readOnly: true })
    manager.notify({ a: 1 })

    expect(received).toHaveLength(2)
    expect(received[0]).toBe(received[1])
  })

  it('只读订阅与可写订阅混排时各自拿到独立载荷', () => {
    const manager = createManager()
    const received: Array<{ nested: { n: number } }> = []

    manager.add((s) => {
      const payload = s as { nested: { n: number } }
      received.push(payload)
      payload.nested.n = 42
    })
    manager.add((s) => received.push(s as { nested: { n: number } }), { readOnly: true })

    manager.notify({ nested: { n: 1 } })

    expect(received).toHaveLength(2)
    expect(received[0]).not.toBe(received[1])
    expect(received[1].nested.n).toBe(1)
  })

  it('cloneOnNotify=false 时全部回调共享调用方载荷（零拷贝快路径不变）', () => {
    const manager = createManager()
    const state = { a: 1 }
    const received: unknown[] = []

    manager.add((s) => received.push(s), { readOnly: true })
    manager.add((s) => received.push(s), { readOnly: true })
    manager.notify(state, false)

    expect(received).toHaveLength(2)
    expect(received[0]).toBe(state)
    expect(received[1]).toBe(state)
  })
})

// ==================== R5-124：驱逐事件上报 ====================
describe('SubscriptionManager 驱逐上报通道', () => {
  it('onSubscriberEvicted 收到被驱逐的监听器与额度信息', () => {
    const events: Array<{ listener: unknown; maxSubscribers: number; size: number }> = []
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const manager = new SubscriptionManager({
      storeName: 'limit-store',
      maxSubscribers: 1,
      onSubscriberEvicted: (info) => events.push(info),
    })
    function earliestSubscriber() {}

    manager.add(earliestSubscriber)
    manager.add(() => {})

    expect(events).toHaveLength(1)
    expect(events[0].listener).toBe(earliestSubscriber)
    expect(events[0].maxSubscribers).toBe(1)
    // size 是「驱逐后、新注册写入前」的注册总数
    expect(events[0].size).toBe(0)
    warnSpy.mockRestore()
  })

  it('开发期驱逐告警带上被驱逐监听器的标识', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const manager = new SubscriptionManager({ storeName: 'limit-store', maxSubscribers: 1 })
    function innocentVictim() {}

    manager.add(innocentVictim)
    manager.add(jest.fn())

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('订阅者数量已达到上限'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('innocentVictim'))
    warnSpy.mockRestore()
  })

  it('重复注册让位自己最早的一份注册，并同样上报', () => {
    const events: Array<{ listener: unknown }> = []
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const manager = new SubscriptionManager({
      storeName: 'limit-store',
      maxSubscribers: 1,
      onSubscriberEvicted: (info) => events.push(info),
    })
    const shared = jest.fn()
    const keptHandle = manager.add(shared)

    // 已达上限且监听器在册：不该牵连其它监听器，改由自己的最早注册让位
    manager.add(shared)

    expect(events).toHaveLength(1)
    expect(events[0].listener).toBe(shared)
    // 被驱逐那份注册的句柄随之失效，新句柄仍有效
    expect(manager.delete(shared, keptHandle)).toBe(false)
    warnSpy.mockRestore()
  })

  it('上报通道自身抛错不得让 add 失败', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation()
    const manager = new SubscriptionManager({
      storeName: 'limit-store',
      maxSubscribers: 1,
      onSubscriberEvicted: () => {
        throw new Error('reporter boom')
      },
    })

    manager.add(jest.fn())
    expect(() => manager.add(jest.fn())).not.toThrow()
    expect(manager.size).toBe(1)

    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('onLimit=throw 时抛错而非驱逐，不产生驱逐事件', () => {
    const events: unknown[] = []
    const manager = new SubscriptionManager({
      storeName: 'limit-store',
      maxSubscribers: 1,
      onLimit: 'throw',
      onSubscriberEvicted: (info) => events.push(info),
    })

    manager.add(jest.fn())
    expect(() => manager.add(jest.fn())).toThrow(/Subscriber limit reached/)
    expect(events).toHaveLength(0)
  })
})
