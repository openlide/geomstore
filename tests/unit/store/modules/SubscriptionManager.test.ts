/**
 * SubscriptionManager 模块测试
 * 目标覆盖率: 95%+
 */

import { SubscriptionManager, createSubscribeFunction } from '@/core/store/SubscriptionManager'
import type { State } from '@/types/store'

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

    it('应该处理 firstListener 为 undefined 的情况', () => {
      const manager = createManager(1)
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

      // 直接替换内部 Map（模拟极端腐坏情况）：
      // size 迭代计出 2（超过上限），但 keys().next().value 为 undefined
      const mockMap = {
        forEach: (cb: (count: number) => void) => cb(2),
        get: () => undefined,
        keys: () => ({ next: () => ({ value: undefined, done: true }) }),
        set: () => mockMap,
        delete: () => true,
      }
      ;(manager as any)._listeners = mockMap

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

  it('引用计数不影响上限驱逐语义：新监听器仍按最旧驱逐', () => {
    const manager = createManager(2)
    const listenerA = jest.fn()
    const listenerB = jest.fn()
    const listenerC = jest.fn()

    manager.add(listenerA)
    manager.add(listenerB)
    // 重复注册已有监听器：仅递增计数，不参与上限判定与驱逐
    manager.add(listenerB)
    expect(manager.size).toBe(3)

    // 新监听器达到上限：驱逐最早的 A
    manager.add(listenerC)
    manager.notify({} as State)

    expect(listenerA).not.toHaveBeenCalled()
    expect(listenerB).toHaveBeenCalledTimes(2)
    expect(listenerC).toHaveBeenCalledTimes(1)
  })
})
