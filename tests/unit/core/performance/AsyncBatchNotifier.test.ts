/**
 * GeomStore - AsyncBatchNotifier 测试
 *
 * 自原 Optimizations.test.ts 拆出：仅保留仍在生产使用的能力（AsyncBatchNotifier）。
 * 原文件中的 LRUCache / SubscriptionManager / iterativeDeepEqual 用例在
 * tests/unit/cache、tests/unit/store、tests/unit/core/utils 下已有覆盖。
 */
import { AsyncBatchNotifier } from '@/core/performance/AsyncBatchNotifier.js'

describe('AsyncBatchNotifier', () => {
  describe('基础功能', () => {
    it('PERF-020: 应该创建AsyncBatchNotifier实例', () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      expect(notifier).toBeDefined()
      expect(notifier).toBeInstanceOf(AsyncBatchNotifier)
    })

    it('PERF-021: subscribe应该返回取消订阅函数', () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const unsubscribe = notifier.subscribe(() => {})

      expect(typeof unsubscribe).toBe('function')
    })
  })

  describe('通知机制', () => {
    it('PERF-022: notify应该异步触发监听器', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener = jest.fn()
      notifier.subscribe(listener)

      notifier.notify({ count: 1 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener).toHaveBeenCalledWith({ count: 1 })
    })

    it('PERF-023: 多次连续notify应该只触发一次', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener = jest.fn()
      notifier.subscribe(listener)

      notifier.notify({ count: 1 })
      notifier.notify({ count: 2 })
      notifier.notify({ count: 3 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('PERF-024: 应该使用最后一次notify的状态', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener = jest.fn()
      notifier.subscribe(listener)

      notifier.notify({ count: 1 })
      notifier.notify({ count: 2 })
      notifier.notify({ count: 3 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener).toHaveBeenCalledWith({ count: 3 })
    })

    it('PERF-025: 多个监听器应该都被通知', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener1 = jest.fn()
      const listener2 = jest.fn()
      const listener3 = jest.fn()

      notifier.subscribe(listener1)
      notifier.subscribe(listener2)
      notifier.subscribe(listener3)

      notifier.notify({ count: 100 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener1).toHaveBeenCalledWith({ count: 100 })
      expect(listener2).toHaveBeenCalledWith({ count: 100 })
      expect(listener3).toHaveBeenCalledWith({ count: 100 })
    })
  })

  describe('取消订阅', () => {
    it('PERF-026: unsubscribe应该停止通知', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener = jest.fn()
      const unsubscribe = notifier.subscribe(listener)

      unsubscribe()

      notifier.notify({ count: 1 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener).not.toHaveBeenCalled()
    })

    it('PERF-027: 部分取消订阅后其他监听器仍应收到通知', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      const unsubscribe1 = notifier.subscribe(listener1)
      notifier.subscribe(listener2)

      unsubscribe1()

      notifier.notify({ count: 1 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).toHaveBeenCalledWith({ count: 1 })
    })
  })

  describe('管理功能', () => {
    it('PERF-028: size应该返回监听器数量', () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()

      expect(notifier.size()).toBe(0)

      notifier.subscribe(() => {})
      expect(notifier.size()).toBe(1)

      notifier.subscribe(() => {})
      expect(notifier.size()).toBe(2)
    })

    it('PERF-029: clear应该清空所有监听器', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      notifier.subscribe(listener1)
      notifier.subscribe(listener2)

      notifier.clear()
      notifier.notify({ count: 1 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener1).not.toHaveBeenCalled()
      expect(listener2).not.toHaveBeenCalled()
    })
  })

  describe('错误处理', () => {
    it('PERF-030: 监听器抛出错误不应影响其他监听器', async () => {
      const notifier = new AsyncBatchNotifier<{ count: number }>()
      const listener1 = jest.fn(() => {
        throw new Error('Listener error')
      })
      const listener2 = jest.fn()

      notifier.subscribe(listener1)
      notifier.subscribe(listener2)

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      notifier.notify({ count: 1 })

      await new Promise((resolve) => setImmediate(resolve))

      expect(listener1).toHaveBeenCalled()
      expect(listener2).toHaveBeenCalled()
      expect(consoleSpy).toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })
})

describe('AsyncBatchNotifier 边界情况', () => {
  it('PERF-082: flush 时 state 为 null 不应该触发监听器', async () => {
    const notifier = new AsyncBatchNotifier<{ count: number }>()
    const listener = jest.fn()
    notifier.subscribe(listener)

    // 使用内部方法清除 state
    const notifierAny = notifier as unknown as { latestState: null; flush: () => void }
    notifierAny.latestState = null

    // 手动触发 flush
    notifierAny.flush()

    expect(listener).not.toHaveBeenCalled()
  })
})
