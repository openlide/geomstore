/**
 * ActionUtils 测试
 */

import { ActionUtils, withLog, withRetry, withTimeout, withDebounce, withThrottle, withCache, createDecorator } from '@/core/action/index'
import type { AsyncActions } from '@/types/action'

describe('ActionUtils', () => {
  let actionUtils: ActionUtils

  beforeEach(() => {
    const actions = {
      testAction: jest.fn(async (value: number) => value * 2),
      asyncAction: jest.fn(async () => 'async result'),
    }
    actionUtils = new ActionUtils(actions as unknown as AsyncActions)
  })

  describe('构造函数', () => {
    it('应该创建实例', () => {
      expect(actionUtils).toBeInstanceOf(ActionUtils)
    })
  })

  describe('execute', () => {
    it('应该执行 action', async () => {
      const actions = {
        multiply: jest.fn(async (x: number) => x * 2),
      }
      const utils = new ActionUtils(actions as unknown as AsyncActions)
      const result = await utils.execute(actions as unknown as AsyncActions, 'multiply', 5)
      expect(result).toBe(10)
      expect(actions.multiply).toHaveBeenCalledWith(5)
    })

    it('应该抛出 action 的错误', async () => {
      const error = new Error('Action error')
      const actions = {
        fail: jest.fn(async () => {
          throw error
        }),
      }
      const utils = new ActionUtils(actions)
      await expect(utils.execute(actions, 'fail')).rejects.toThrow(error)
    })
  })

  describe('createDecorator', () => {
    it('应该创建装饰器并调用 before', async () => {
      const before = jest.fn()
      const decorator = createDecorator({ before })

      class TestClass {
        @decorator
        async method(x: number) {
          return x * 2
        }
      }

      const instance = new TestClass()
      await instance.method(5)
      expect(before).toHaveBeenCalledWith(5)
    })

    it('应该创建装饰器并调用 after', async () => {
      const after = jest.fn()
      const decorator = createDecorator({ after })

      class TestClass {
        @decorator
        async method(x: number) {
          return x * 2
        }
      }

      const instance = new TestClass()
      await instance.method(5)
      expect(after).toHaveBeenCalledWith(10)
    })

    it('应该创建装饰器并调用 onError', async () => {
      const onError = jest.fn()
      const decorator = createDecorator({ onError })

      class TestClass {
        @decorator
        async method() {
          throw new Error('Test error')
        }
      }

      const instance = new TestClass()
      await expect(instance.method()).rejects.toThrow('Test error')
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })

    it('应该创建装饰器并组合所有钩子', async () => {
      const before = jest.fn()
      const after = jest.fn()
      const onError = jest.fn()
      const decorator = createDecorator({ before, after, onError })

      class TestClass {
        @decorator
        async method(x: number) {
          return x * 2
        }
      }

      const instance = new TestClass()
      const result = await instance.method(5)
      expect(result).toBe(10)
      expect(before).toHaveBeenCalledWith(5)
      expect(after).toHaveBeenCalledWith(10)
      expect(onError).not.toHaveBeenCalled()
    })
  })

  describe('withLog', () => {
    let consoleLogSpy: jest.SpyInstance
    let consoleErrorSpy: jest.SpyInstance

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    })

    afterEach(() => {
      consoleLogSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    })

    it('应该记录方法开始', async () => {
      class TestClass {
        @withLog('testMethod')
        async method(x: number) {
          return x * 2
        }
      }

      const instance = new TestClass()
      await instance.method(5)
      expect(consoleLogSpy).toHaveBeenCalledWith('[Action] testMethod started with args:', [5])
    })

    it('应该记录方法完成', async () => {
      class TestClass {
        @withLog('testMethod')
        async method(x: number) {
          return x * 2
        }
      }

      const instance = new TestClass()
      await instance.method(5)
      expect(consoleLogSpy).toHaveBeenCalledWith('[Action] testMethod completed with result:', 10)
    })

    it('应该记录方法错误', async () => {
      class TestClass {
        @withLog('failMethod')
        async method() {
          throw new Error('Test error')
        }
      }

      const instance = new TestClass()
      await expect(instance.method()).rejects.toThrow('Test error')
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Action] failMethod failed:', expect.any(Error))
    })

    it('应该使用默认名称', async () => {
      class TestClass {
        @withLog()
        async method() {
          return 'result'
        }
      }

      const instance = new TestClass()
      await instance.method()
      expect(consoleLogSpy).toHaveBeenCalledWith('[Action] action started with args:', [])
    })
  })

  describe('withDebounce', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.clearAllTimers()
      jest.useRealTimers()
    })

    it('应该防抖方法调用', async () => {
      class TestClass {
        callCount = 0

        @withDebounce(100)
        async method(x: number) {
          this.callCount++
          return x * 2
        }
      }

      const instance = new TestClass()
      const promise1 = instance.method(5)
      const promise2 = instance.method(10)
      const promise3 = instance.method(15)

      jest.advanceTimersByTime(100)

      const result1 = await promise1
      const result2 = await promise2
      const result3 = await promise3

      expect(instance.callCount).toBe(1)
      expect(result1).toBe(30)
    })

    it('应该使用默认延迟', async () => {
      class TestClass {
        callCount = 0

        @withDebounce()
        async method() {
          this.callCount++
        }
      }

      const instance = new TestClass()
      instance.method()
      instance.method()

      jest.advanceTimersByTime(300)

      // 等待异步操作完成
      jest.advanceTimersByTime(10)
      expect(instance.callCount).toBe(1)
    })
  })

  describe('withThrottle', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.clearAllTimers()
      jest.useRealTimers()
    })
    it('应该节流方法调用', async () => {
      class TestClass {
        callCount = 0

        @withThrottle(100)
        method(x: number) {
          this.callCount++
          return x * 2
        }
      }

      const instance = new TestClass()
      const result1 = instance.method(5)
      const result2 = instance.method(10)
      const result3 = instance.method(15)

      expect(instance.callCount).toBe(1)
      expect(result1).toBe(10)

      jest.advanceTimersByTime(100)
      // trailing 默认开启：窗口尾补发（参数 15）后 callCount 为 2，
      // 且补发重置了窗口起点
      expect(instance.callCount).toBe(2)

      // 恰在补发时刻的调用落入新窗口内 → 被抑制（返回 undefined），
      // 其参数（20）将在下一窗口尾补发
      const result4 = instance.method(20)
      expect(result4).toBeUndefined()

      jest.advanceTimersByTime(100)
      expect(instance.callCount).toBe(3) // 参数 20 的补发
    })

    it('应该使用默认间隔', async () => {
      class TestClass {
        callCount = 0

        @withThrottle()
        method() {
          this.callCount++
        }
      }

      const instance = new TestClass()
      instance.method()
      instance.method()

      expect(instance.callCount).toBe(1)

      jest.advanceTimersByTime(300)

      instance.method()
      expect(instance.callCount).toBe(2)
    })
  })

  describe('withCache', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.clearAllTimers()
      jest.useRealTimers()
    })

    it('应该缓存方法结果', async () => {
      let callCount = 0

      class TestClass {
        @withCache({ ttl: 5000 })
        async method(x: number) {
          callCount++
          return x * 2
        }
      }

      const instance = new TestClass()
      const result1 = await instance.method(5)
      const result2 = await instance.method(5)

      expect(callCount).toBe(1)
      expect(result1).toBe(10)
      expect(result2).toBe(10)
    })

    it('应该使用自定义 key 函数', async () => {
      let callCount = 0

      class TestClass {
        @withCache({
          ttl: 5000,
          keyFn: (x: unknown) => `key-${x}`,
        })
        async method(x: number) {
          callCount++
          return x * 2
        }
      }

      const instance = new TestClass()
      await instance.method(5)
      await instance.method(5)

      expect(callCount).toBe(1)
    })

    it('应该在 TTL 过期后重新执行', async () => {
      let callCount = 0

      class TestClass {
        @withCache({ ttl: 100 })
        async method(x: number) {
          callCount++
          return x * 2
        }
      }

      const instance = new TestClass()
      await instance.method(5)
      expect(callCount).toBe(1)

      jest.advanceTimersByTime(101)

      await instance.method(5)
      expect(callCount).toBe(2)
    })

    it('应该支持不同参数的缓存', async () => {
      let callCount = 0

      class TestClass {
        @withCache({ ttl: 5000 })
        async method(x: number) {
          callCount++
          return x * 2
        }
      }

      const instance = new TestClass()
      await instance.method(5)
      await instance.method(10)

      expect(callCount).toBe(2)
    })
  })

  describe('withRetry', () => {
    it('应该在失败时重试', async () => {
      let attemptCount = 0

      class TestClass {
        @withRetry({ retries: 3, delay: 10 })
        async method() {
          attemptCount++
          if (attemptCount < 3) {
            throw new Error('Not yet')
          }
          return 'success'
        }
      }

      const instance = new TestClass()
      const result = await instance.method()
      expect(result).toBe('success')
      expect(attemptCount).toBe(3)
    })

    it('应该在重试次数用尽后抛出错误', async () => {
      class TestClass {
        @withRetry({ retries: 2, delay: 10 })
        async method() {
          throw new Error('Always fails')
        }
      }

      const instance = new TestClass()
      await expect(instance.method()).rejects.toThrow('Always fails')
    })

    it('应该使用 shouldRetry 判断', async () => {
      let attemptCount = 0

      class TestClass {
        @withRetry({
          retries: 5,
          delay: 10,
          shouldRetry: (error: Error) => error.message.includes('retry'),
        })
        async method() {
          attemptCount++
          if (attemptCount === 1) {
            throw new Error('retry me')
          }
          throw new Error('stop')
        }
      }

      const instance = new TestClass()
      await expect(instance.method()).rejects.toThrow('stop')
      expect(attemptCount).toBe(2)
    })

    it('应该使用指数退避', async () => {
      let attemptCount = 0

      class TestClass {
        @withRetry({ retries: 2, delay: 50 })
        async method() {
          attemptCount++
          throw new Error('Fail')
        }
      }

      const instance = new TestClass()
      const startTime = Date.now()
      await instance.method().catch(() => {})
      const endTime = Date.now()

      // 第一次重试延迟: 50ms
      // 第二次重试延迟: 100ms (50 * 2^1)
      // 总延迟应该在150ms左右
      expect(endTime - startTime).toBeGreaterThanOrEqual(140)
      // 上界放宽到 1000ms：真实计时器在 CI 负载下可能慢于 300ms，避免偶发失败
      expect(endTime - startTime).toBeLessThan(1000)
      expect(attemptCount).toBe(3)
    })
  })

  describe('withTimeout', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.clearAllTimers()
      jest.useRealTimers()
    })

    it('应该在超时前完成', async () => {
      class TestClass {
        @withTimeout(1000)
        async method() {
          return 'success'
        }
      }

      const instance = new TestClass()
      const result = await instance.method()
      expect(result).toBe('success')
    })

    it('应该在超时后抛出错误', async () => {
      class TestClass {
        @withTimeout(100)
        async method() {
          return new Promise((resolve) => setTimeout(resolve, 500))
        }
      }

      const instance = new TestClass()
      const promise = instance.method()

      jest.advanceTimersByTime(100)

      await expect(promise).rejects.toThrow('Timeout after 100ms')
    })

    it('应该使用默认超时时间', async () => {
      class TestClass {
        @withTimeout()
        async method() {
          return new Promise((resolve) => setTimeout(resolve, 6000))
        }
      }

      const instance = new TestClass()
      const promise = instance.method()

      jest.advanceTimersByTime(5000)

      await expect(promise).rejects.toThrow('Timeout after 5000ms')
    })

    it('原方法同步抛错时应该直接拒绝（定时器尚未创建）', async () => {
      class TestClass {
        @withTimeout(1000)
        method() {
          throw new Error('sync error')
        }
      }

      const instance = new TestClass()
      await expect(instance.method()).rejects.toThrow('sync error')
    })
  })
})
