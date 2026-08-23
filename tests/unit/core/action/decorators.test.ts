/**
 * Action Decorators 测试
 *
 * 测试覆盖率目标: 95%+
 */

import { withDebounce } from '@/core/action/decorators/debounce'
import { withRetry } from '@/core/action/decorators/retry'
import { createDecorator } from '@/core/action/decorators/common'
import { withCache } from '@/core/action/decorators/cache'
import { withLog } from '@/core/action/decorators/log'
import { withThrottle } from '@/core/action/decorators/throttle'

describe('Action Decorators', () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  // ==================== withDebounce 装饰器测试 ====================
  describe('withDebounce', () => {
    it('DECORATOR-001: 应该使用默认延迟时间', async () => {
      jest.useFakeTimers()

      class DefaultDebounceClass {
        result: string | null = null

        @withDebounce() // 默认 300ms
        async method(value: string) {
          this.result = value
        }
      }

      const instance = new DefaultDebounceClass()
      instance.method('test')

      await jest.advanceTimersByTimeAsync(300)

      expect(instance.result).toBe('test')
    })

    it('DECORATOR-002: 应该延迟执行并只执行最后一次调用', async () => {
      jest.useFakeTimers()

      class DebounceClass {
        callCount = 0
        lastArgs: unknown[] = []

        @withDebounce(100)
        async doWork(...args: unknown[]) {
          this.callCount++
          this.lastArgs = args
          return args.join('-')
        }
      }

      const instance = new DebounceClass()

      instance.doWork('a')
      instance.doWork('b')
      instance.doWork('c')

      expect(instance.callCount).toBe(0)

      await jest.advanceTimersByTimeAsync(100)

      expect(instance.callCount).toBe(1)
      expect(instance.lastArgs).toEqual(['c'])
    })

    it('DECORATOR-003: 应该重置定时器后执行', async () => {
      jest.useFakeTimers()

      class DebounceClass {
        callCount = 0
        lastArgs: unknown[] = []

        @withDebounce(100)
        async doWork(...args: unknown[]) {
          this.callCount++
          this.lastArgs = args
          return args.join('-')
        }
      }

      const instance = new DebounceClass()

      instance.doWork('first')
      await jest.advanceTimersByTimeAsync(50) // 执行了一半时间

      instance.doWork('second') // 重置定时器
      await jest.advanceTimersByTimeAsync(50) // 又过了一半时间

      expect(instance.callCount).toBe(0) // 还没执行

      await jest.advanceTimersByTimeAsync(50) // 完成延迟

      expect(instance.callCount).toBe(1)
      expect(instance.lastArgs).toEqual(['second'])
    })
  })

  // ==================== withDebounce 补充覆盖 ====================
  describe('withDebounce 补充覆盖', () => {
    it('DECORATOR-DB-001: 原方法抛出错误时应该 reject 所有 pending promises', async () => {
      jest.useFakeTimers()

      class ErrorDebounceClass {
        @withDebounce(50)
        async method() {
          throw new Error('method error')
        }
      }

      const instance = new ErrorDebounceClass()
      const promise = instance.method()

      // 用 catch 捕获 advanceTimersByTimeAsync 中可能抛出的 rejection
      let caughtError: Error | null = null
      promise.catch((e: Error) => {
        caughtError = e
      })

      await jest.advanceTimersByTimeAsync(50)
      await Promise.resolve()

      expect(caughtError).toBeInstanceOf(Error)
      expect(caughtError!.message).toBe('method error')
    })

    it('DECORATOR-DB-002: 多次调用后原方法抛出错误时应该 reject 所有 pending promises', async () => {
      jest.useFakeTimers()

      class ErrorDebounceClass {
        @withDebounce(50)
        async method() {
          throw new Error('multi-call error')
        }
      }

      const instance = new ErrorDebounceClass()
      const p1 = instance.method()
      const p2 = instance.method()

      const caughtErrors: Error[] = []
      p1.catch((e: Error) => {
        caughtErrors.push(e)
      })
      p2.catch((e: Error) => {
        caughtErrors.push(e)
      })

      await jest.advanceTimersByTimeAsync(50)
      await Promise.resolve()

      expect(caughtErrors).toHaveLength(2)
      expect(caughtErrors.every((e) => e.message === 'multi-call error')).toBe(true)
    })

    it('DECORATOR-DB-003: 宿主不是对象时（如 undefined）应该使用一次性本地状态兜底', async () => {
      jest.useFakeTimers()

      class StandaloneClass {
        @withDebounce(50)
        async method(value: string) {
          return value
        }
      }

      // 通过 .call(undefined) 调用，使 this 为 undefined
      const descriptor = Object.getOwnPropertyDescriptor(StandaloneClass.prototype, 'method')!
      const wrappedFn = descriptor.value
      const promise = wrappedFn.call(undefined, 'test-value')

      await jest.advanceTimersByTimeAsync(50)

      const result = await promise
      expect(result).toBe('test-value')
    })

    it('DECORATOR-DB-004: 宿主为 null 时应该使用一次性本地状态兜底', async () => {
      jest.useFakeTimers()

      class StandaloneClass {
        @withDebounce(50)
        async method(value: number) {
          return value * 2
        }
      }

      // 通过 .call(null) 调用，使 this 为 null
      const descriptor = Object.getOwnPropertyDescriptor(StandaloneClass.prototype, 'method')!
      const wrappedFn = descriptor.value
      const promise = wrappedFn.call(null, 21)

      await jest.advanceTimersByTimeAsync(50)

      const result = await promise
      expect(result).toBe(42)
    })

    it('DECORATOR-DB-005: 当 runArgs 为空数组时应该使用 args 作为 fallback', async () => {
      jest.useFakeTimers()

      // 构造一个场景：pendingArgs 被清空后（空数组），fallback 到原始 args
      // 通过直接操作内部逻辑来触发 runArgs.length 为 falsy 的分支
      class EmptyArgsClass {
        @withDebounce(50)
        async method(...args: unknown[]) {
          return args.length
        }
      }

      const instance = new EmptyArgsClass()
      // 不传参数调用，args 为空数组，runArgs 也为空数组，触发 fallback
      const promise = instance.method()

      await jest.advanceTimersByTimeAsync(50)

      const result = await promise
      // args 为空，返回 length 0
      expect(result).toBe(0)
    })
  })

  // ==================== withRetry 装饰器测试 ====================
  describe('withRetry', () => {
    it('DECORATOR-004: 应该在成功后返回结果', async () => {
      class RetryClass {
        attempts = 0

        @withRetry({ retries: 3, delay: 1 })
        async flakyMethod() {
          this.attempts++
          if (this.attempts < 3) {
            throw new Error(`Attempt ${this.attempts} failed`)
          }
          return 'success'
        }
      }

      const instance = new RetryClass()
      const result = await instance.flakyMethod()

      expect(result).toBe('success')
      expect(instance.attempts).toBe(3)
    })

    it('DECORATOR-005: 应该在达到最大重试次数后抛出错误', async () => {
      class RetryClass {
        attempts = 0

        @withRetry({ retries: 2, delay: 1 })
        async alwaysFailMethod() {
          this.attempts++
          throw new Error(`Always fails - attempt ${this.attempts}`)
        }
      }

      const instance = new RetryClass()

      await expect(instance.alwaysFailMethod()).rejects.toThrow('Always fails - attempt 3')
      expect(instance.attempts).toBe(3)
    })

    it('DECORATOR-006: 应该使用默认重试次数和延迟', async () => {
      class DefaultRetryClass {
        attempts = 0

        @withRetry()
        async method() {
          this.attempts++
          if (this.attempts < 2) {
            throw new Error('fail')
          }
          return 'done'
        }
      }

      const instance = new DefaultRetryClass()
      const result = await instance.method()

      expect(result).toBe('done')
      expect(instance.attempts).toBe(2)
    })

    it('DECORATOR-007: shouldRetry 返回 true 时应该重试', async () => {
      class ConditionalRetryClass {
        attempts = 0

        @withRetry({
          retries: 3,
          delay: 1,
          shouldRetry: (error) => error.message.includes('retryable'),
        })
        async method(shouldRetry: boolean) {
          this.attempts++
          if (this.attempts < 2) {
            const error = new Error(shouldRetry ? 'retryable error' : 'non-retryable error')
            throw error
          }
          return 'success'
        }
      }

      const instance = new ConditionalRetryClass()
      const result = await instance.method(true)

      expect(result).toBe('success')
      expect(instance.attempts).toBe(2)
    })

    it('DECORATOR-008: shouldRetry 返回 false 时应该立即抛出错误', async () => {
      class ConditionalRetryClass {
        attempts = 0

        @withRetry({
          retries: 3,
          delay: 1,
          shouldRetry: (error) => error.message.includes('retryable'),
        })
        async method() {
          this.attempts++
          throw new Error('non-retryable error')
        }
      }

      const instance = new ConditionalRetryClass()

      await expect(instance.method()).rejects.toThrow('non-retryable error')
      // 由于 shouldRetry 返回 false，应该立即抛出错误，不会重试
      // 但是根据装饰器逻辑，初始调用会执行一次
      expect(instance.attempts).toBeGreaterThanOrEqual(1)
    })

    it('DECORATOR-009: 应该处理立即成功的情况', async () => {
      class ImmediateSuccessClass {
        @withRetry({ retries: 3, delay: 1 })
        async method() {
          return 'immediate'
        }
      }

      const instance = new ImmediateSuccessClass()
      const result = await instance.method()

      expect(result).toBe('immediate')
    })

    it('DECORATOR-010: 0次重试时应该直接执行', async () => {
      class ZeroRetryClass {
        attempts = 0

        @withRetry({ retries: 0, delay: 1 })
        async method() {
          this.attempts++
          throw new Error('fail')
        }
      }

      const instance = new ZeroRetryClass()
      await expect(instance.method()).rejects.toThrow('fail')
      expect(instance.attempts).toBe(1)
    })
  })

  // ==================== createDecorator 测试 ====================
  describe('createDecorator', () => {
    it('DECORATOR-011: 应该在执行前调用 before 回调', async () => {
      const beforeFn = jest.fn()

      class BeforeClass {
        @createDecorator({ before: beforeFn })
        async method(a: number, b: number) {
          return a + b
        }
      }

      const instance = new BeforeClass()
      await instance.method(1, 2)

      expect(beforeFn).toHaveBeenCalledWith(1, 2)
    })

    it('DECORATOR-012: 应该在执行后调用 after 回调', async () => {
      const afterFn = jest.fn()

      class AfterClass {
        @createDecorator({ after: afterFn })
        async method() {
          return 'result'
        }
      }

      const instance = new AfterClass()
      await instance.method()

      expect(afterFn).toHaveBeenCalledWith('result')
    })

    it('DECORATOR-013: 应该在错误时调用 onError 回调', async () => {
      const onErrorFn = jest.fn()

      class ErrorClass {
        @createDecorator({ onError: onErrorFn })
        async method() {
          throw new Error('test error')
        }
      }

      const instance = new ErrorClass()
      await expect(instance.method()).rejects.toThrow('test error')

      expect(onErrorFn).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'test error',
        }),
      )
    })

    it('DECORATOR-014: 应该同时使用 before 和 after 回调', async () => {
      const calls: string[] = []

      class CombinedClass {
        @createDecorator({
          before: () => calls.push('before'),
          after: () => calls.push('after'),
        })
        async method() {
          calls.push('method')
          return 'done'
        }
      }

      const instance = new CombinedClass()
      await instance.method()

      expect(calls).toEqual(['before', 'method', 'after'])
    })

    it('DECORATOR-015: 错误时不应该调用 after 回调', async () => {
      const afterFn = jest.fn()
      const onErrorFn = jest.fn()

      class ErrorAfterClass {
        @createDecorator({
          after: afterFn,
          onError: onErrorFn,
        })
        async method() {
          throw new Error('fail')
        }
      }

      const instance = new ErrorAfterClass()
      await expect(instance.method()).rejects.toThrow('fail')

      expect(afterFn).not.toHaveBeenCalled()
      expect(onErrorFn).toHaveBeenCalled()
    })

    it('DECORATOR-016: 没有选项时应该正常工作', async () => {
      class NoOptionsClass {
        @createDecorator()
        async method(value: number) {
          return value * 2
        }
      }

      const instance = new NoOptionsClass()
      const result = await instance.method(5)

      expect(result).toBe(10)
    })

    it('DECORATOR-017: 装饰器应该保持正确的 this 上下文', async () => {
      class ThisContextClass {
        private value = 10

        @createDecorator()
        async method() {
          return this.value * 2
        }
      }

      const instance = new ThisContextClass()
      const result = await instance.method()

      expect(result).toBe(20)
    })
  })

  // ==================== 边界条件测试 ====================
  describe('边界条件', () => {
    it('DECORATOR-018: withRetry 应该处理无选项调用', async () => {
      class NoOptionsRetryClass {
        @withRetry()
        async method() {
          return 'success'
        }
      }

      const instance = new NoOptionsRetryClass()
      const result = await instance.method()

      expect(result).toBe('success')
    })

    it('DECORATOR-019: createDecorator 应该处理空选项对象', async () => {
      class EmptyOptionsClass {
        @createDecorator({})
        async method() {
          return 'result'
        }
      }

      const instance = new EmptyOptionsClass()
      const result = await instance.method()

      expect(result).toBe('result')
    })
  })

  // ==================== withRetry 补充测试 ====================
  describe('withRetry 补充覆盖', () => {
    it('DECORATOR-020: shouldRetry 在最后一次重试返回 false 时应该立即抛出错误', async () => {
      // 当 i === retries 时，shouldRetry 返回 false，应触发 !canRetry 分支
      class LastAttemptNonRetryableClass {
        attempts = 0

        @withRetry({
          retries: 1,
          delay: 1,
          shouldRetry: () => false, // 始终返回 false
        })
        async method() {
          this.attempts++
          throw new Error('always non-retryable')
        }
      }

      const instance = new LastAttemptNonRetryableClass()
      await expect(instance.method()).rejects.toThrow('always non-retryable')
      expect(instance.attempts).toBe(1) // 没有重试
    })

    it('DECORATOR-021: shouldRetry 返回 false 时在非最后一次也应该立即抛出', async () => {
      class ConditionalNonRetryClass {
        attempts = 0

        @withRetry({
          retries: 5,
          delay: 1,
          shouldRetry: (error) => error.message.includes('retryable'),
        })
        async method() {
          this.attempts++
          throw new Error('fatal error')
        }
      }

      const instance = new ConditionalNonRetryClass()
      await expect(instance.method()).rejects.toThrow('fatal error')
      expect(instance.attempts).toBe(1)
    })

    it('DECORATOR-022: 指数退避延迟应该正确计算', async () => {
      // 使用真实定时器，验证指数退避确实被执行（通过验证总执行时间数量级）
      const delays: number[] = []
      const originalSetTimeout = global.setTimeout

      class ExponentialBackoffClass {
        attempts = 0

        @withRetry({ retries: 2, delay: 10 })
        async method() {
          this.attempts++
          if (this.attempts < 3) {
            throw new Error('retry')
          }
          return 'success'
        }
      }

      // 记录每次 setTimeout 的延迟，立即执行不等待
      const spy = jest.spyOn(global, 'setTimeout').mockImplementation((fn: any, delay?: number) => {
        if (delay) delays.push(delay)
        return originalSetTimeout(fn, 0) as any
      })

      try {
        const instance = new ExponentialBackoffClass()
        const result = await instance.method()

        // 尝试1失败 delay=10*2^0=10, 尝试2失败 delay=10*2^1=20, 尝试3成功
        expect(delays).toEqual([10, 20])
        expect(result).toBe('success')
        expect(instance.attempts).toBe(3)
      } finally {
        spy.mockRestore()
      }
    })

    it('DECORATOR-023: 装饰器应该正确传递 this 上下文和参数', async () => {
      class ThisContextRetryClass {
        private multiplier = 10

        @withRetry({ retries: 2, delay: 1 })
        async compute(a: number, b: number) {
          return (a + b) * this.multiplier
        }
      }

      const instance = new ThisContextRetryClass()
      const result = await instance.compute(3, 7)

      expect(result).toBe(100)
    })

    it('DECORATOR-024: 默认 shouldRetry (undefined) 时应该总是重试直到耗尽', async () => {
      class DefaultShouldRetryClass {
        attempts = 0

        @withRetry({ retries: 2, delay: 1 })
        async method() {
          this.attempts++
          throw new Error(`attempt ${this.attempts}`)
        }
      }

      const instance = new DefaultShouldRetryClass()
      await expect(instance.method()).rejects.toThrow('attempt 3')
      expect(instance.attempts).toBe(3) // 1次初始 + 2次重试
    })

    it('DECORATOR-025: retries 为负数时循环不执行，应该抛出 Retry failed without error', async () => {
      // 当 retries < 0 时，for 循环条件 i <= retries 不满足，循环体不执行
      // lastError 保持 undefined，进入 if (!lastError) 分支
      class NegativeRetryClass {
        @withRetry({ retries: -1, delay: 1 })
        async method() {
          throw new Error('should not reach')
        }
      }

      const instance = new NegativeRetryClass()
      await expect(instance.method()).rejects.toThrow('Retry failed without error')
    })

    it('DECORATOR-026: retries 为小数时循环正常结束后应该抛出 lastError', async () => {
      // 当 retries = 0.5 时，循环执行一次（i=0, 0<=0.5）
      // canRetry = 0 < 0.5 && true = true，不 throw
      // i++ → i=1, 1<=0.5 → false，循环正常退出
      // lastError 有值，进入 throw lastError 分支（line 85）
      class FractionalRetryClass {
        attempts = 0

        @withRetry({ retries: 0.5, delay: 1 })
        async method() {
          this.attempts++
          throw new Error('always fails')
        }
      }

      const instance = new FractionalRetryClass()
      await expect(instance.method()).rejects.toThrow('always fails')
      expect(instance.attempts).toBe(1)
    })
  })

  // ==================== withCache 装饰器测试 ====================
  describe('withCache', () => {
    afterEach(() => {
      jest.restoreAllMocks()
    })

    it('DECORATOR-CACHE-001: 应该使用默认 TTL (5000ms) 缓存方法结果', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      class CacheClass {
        callCount = 0

        @withCache() // 默认 ttl=5000
        async getValue(key: string) {
          this.callCount++
          return `value-${key}`
        }
      }

      const instance = new CacheClass()

      // 第一次调用：执行方法
      const result1 = await instance.getValue('test')
      expect(result1).toBe('value-test')
      expect(instance.callCount).toBe(1)

      // 第二次调用：命中缓存
      const result2 = await instance.getValue('test')
      expect(result2).toBe('value-test')
      expect(instance.callCount).toBe(1) // 没有再次执行

      // 验证缓存命中日志
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[Cache] Hit'))
    })

    it('DECORATOR-CACHE-002: 应该支持自定义 keyFn', async () => {
      class KeyFnCacheClass {
        callCount = 0

        @withCache({
          ttl: 5000,
          keyFn: (id: unknown, includeProfile: unknown) => `user:${id}:${includeProfile}`,
        })
        async getUser(id: string, includeProfile: boolean) {
          this.callCount++
          return { id, includeProfile }
        }
      }

      const instance = new KeyFnCacheClass()

      await instance.getUser('user-1', true)
      await instance.getUser('user-1', true) // 命中缓存

      expect(instance.callCount).toBe(1)

      // 不同参数应生成不同 key
      await instance.getUser('user-1', false)
      expect(instance.callCount).toBe(2)
    })

    it('DECORATOR-CACHE-003: 缓存过期后应该重新执行方法', async () => {
      jest.useFakeTimers()

      class ExpiringCacheClass {
        callCount = 0

        @withCache({ ttl: 100 })
        async getValue() {
          this.callCount++
          return `result-${this.callCount}`
        }
      }

      const instance = new ExpiringCacheClass()

      const result1 = await instance.getValue()
      expect(result1).toBe('result-1')
      expect(instance.callCount).toBe(1)

      // 在 TTL 内命中缓存
      const result2 = await instance.getValue()
      expect(result2).toBe('result-1')
      expect(instance.callCount).toBe(1)

      // 快进超过 TTL
      jest.advanceTimersByTime(200)

      // 缓存过期，重新执行
      const result3 = await instance.getValue()
      expect(result3).toBe('result-2')
      expect(instance.callCount).toBe(2)

      jest.useRealTimers()
    })

    it('DECORATOR-CACHE-004: 不同实例应该有独立缓存', async () => {
      class InstanceCacheClass {
        callCount = 0

        @withCache({ ttl: 5000 })
        async getValue() {
          this.callCount++
          return this.callCount
        }
      }

      const instance1 = new InstanceCacheClass()
      const instance2 = new InstanceCacheClass()

      const result1 = await instance1.getValue()
      const result2 = await instance2.getValue()

      expect(result1).toBe(1)
      expect(result2).toBe(1) // 不同实例独立计数

      // 同一实例第二次调用应命中缓存
      const result1b = await instance1.getValue()
      expect(result1b).toBe(1)
      expect(instance1.callCount).toBe(1)
      expect(instance2.callCount).toBe(1)
    })

    it('DECORATOR-CACHE-005: 不同参数应生成不同缓存键', async () => {
      class ArgsCacheClass {
        callCount = 0

        @withCache({ ttl: 5000 })
        async compute(a: number, b: number) {
          this.callCount++
          return a + b
        }
      }

      const instance = new ArgsCacheClass()

      await instance.compute(1, 2)
      await instance.compute(1, 2) // 命中缓存
      await instance.compute(3, 4) // 不同参数

      expect(instance.callCount).toBe(2)
    })

    it('DECORATOR-CACHE-006: 缓存命中但已过期时应重新执行方法', async () => {
      jest.useFakeTimers()

      class ExpiredCacheClass {
        callCount = 0

        @withCache({ ttl: 50 })
        async getValue() {
          this.callCount++
          return `call-${this.callCount}`
        }
      }

      const instance = new ExpiredCacheClass()

      // 第一次调用，缓存结果
      await instance.getValue()
      expect(instance.callCount).toBe(1)

      // 快进使缓存过期
      jest.advanceTimersByTime(100)

      // 缓存已过期，应重新执行
      const result = await instance.getValue()
      expect(result).toBe('call-2')
      expect(instance.callCount).toBe(2)

      jest.useRealTimers()
    })

    it('DECORATOR-CACHE-007: this 为 null 时应使用一次性 Map 不缓存', async () => {
      // 当 this 不是对象（如 null）时，getCache 返回一次性 Map，不会缓存
      class NullHostCacheClass {
        @withCache({ ttl: 5000 })
        async getValue(key: string) {
          return `value-${key}`
        }
      }

      const instance = new NullHostCacheClass()

      // 通过 .call(null, ...) 调用，使 this 为 null
      // 装饰器内部 getCache(null) 会返回一次性 Map，不会缓存
      const result1 = await (instance.getValue as unknown as Function).call(null, 'test')
      expect(result1).toBe('value-test')

      // 再次调用，因为每次都是新的 Map，不会命中缓存
      const result2 = await (instance.getValue as unknown as Function).call(null, 'test')
      expect(result2).toBe('value-test')
    })

    it('DECORATOR-CACHE-008: this 为 undefined 时应使用一次性 Map', async () => {
      class UndefinedHostCacheClass {
        @withCache({ ttl: 5000 })
        async getValue(key: string) {
          return `value-${key}`
        }
      }

      const instance = new UndefinedHostCacheClass()

      // 通过 .call(undefined, ...) 调用
      const result = await (instance.getValue as unknown as Function).call(undefined, 'test')
      expect(result).toBe('value-test')
    })

    it('DECORATOR-CACHE-009: keyFn 为 undefined 时应使用 JSON.stringify 生成缓存键', async () => {
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()

      class DefaultKeyFnCacheClass {
        callCount = 0

        @withCache({ ttl: 5000 }) // 不传 keyFn
        async compute(a: number, b: number) {
          this.callCount++
          return a + b
        }
      }

      const instance = new DefaultKeyFnCacheClass()

      await instance.compute(1, 2)
      await instance.compute(1, 2) // 命中缓存

      expect(instance.callCount).toBe(1)
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[Cache] Hit'))

      consoleLogSpy.mockRestore()
    })

    it('DECORATOR-CACHE-010: 超过容量上限时应该淘汰最早写入的条目', async () => {
      jest.spyOn(console, 'log').mockImplementation()

      class CapacityCacheClass {
        callCount = 0

        @withCache({ ttl: 60000, keyFn: (k: unknown) => `cap:${String(k)}` })
        async getValue(key: number) {
          this.callCount++
          return key
        }
      }

      const instance = new CapacityCacheClass()

      // 写入 1001 个不同键：超过容量上限 1000，最早的条目（key 0）被淘汰
      for (let i = 0; i <= 1000; i++) {
        await instance.getValue(i)
      }
      expect(instance.callCount).toBe(1001)

      // key 0 已被淘汰：未命中缓存，重新执行
      await instance.getValue(0)
      expect(instance.callCount).toBe(1002)

      // key 1000 仍在缓存中：命中缓存，不再执行
      await instance.getValue(1000)
      expect(instance.callCount).toBe(1002)
    })

    it('DECORATOR-CACHE-011: 对象参数键序不同时应命中同一缓存键', async () => {
      jest.spyOn(console, 'log').mockImplementation()

      class ObjectKeyCacheClass {
        callCount = 0

        @withCache({ ttl: 5000 })
        async find(user: { name: string; age: number }) {
          this.callCount++
          return `${user.name}:${user.age}`
        }
      }

      const instance = new ObjectKeyCacheClass()

      // 属性声明顺序不同的等价参数应生成相同的缓存键（sortKeysDeep 排序对象键）
      await instance.find({ name: 'a', age: 1 })
      await instance.find({ age: 1, name: 'a' })

      expect(instance.callCount).toBe(1)
    })

    it('DECORATOR-CACHE-012: 同步方法应同步返回缓存结果', () => {
      class SyncCacheClass {
        callCount = 0

        @withCache({ ttl: 5000 })
        compute(a: number, b: number) {
          this.callCount++
          return a + b
        }
      }

      const instance = new SyncCacheClass()

      const result1 = instance.compute(1, 2)
      const result2 = instance.compute(1, 2) // 命中缓存

      expect(result1).toBe(3)
      expect(result2).toBe(3)
      expect(instance.callCount).toBe(1)
    })

    it('DECORATOR-CACHE-013: async 方法缓存命中应返回 Promise（返回类型一致）', async () => {
      jest.spyOn(console, 'log').mockImplementation()

      class AsyncHitClass {
        callCount = 0

        @withCache({ ttl: 5000 })
        async getValue(id: string) {
          this.callCount++
          return `value:${id}`
        }
      }

      const instance = new AsyncHitClass()

      const first = instance.getValue('a')
      expect(first).toBeInstanceOf(Promise)
      await first

      // 缓存命中：两次调用返回类型必须一致（.then 可用，不抛 TypeError）
      const second = instance.getValue('a')
      expect(second).toBeInstanceOf(Promise)
      expect(await second).toBe('value:a')
      expect(instance.callCount).toBe(1)
    })

    it('DECORATOR-CACHE-014: 非 async 但返回 Promise 的方法命中缓存也应返回 Promise', async () => {
      jest.spyOn(console, 'log').mockImplementation()

      class PromiseStyleClass {
        callCount = 0

        @withCache({ ttl: 5000 })
        fetchValue(id: string) {
          this.callCount++
          return Promise.resolve(`value:${id}`)
        }
      }

      const instance = new PromiseStyleClass()

      await instance.fetchValue('a')
      // 首次执行观测到 Promise 语义，后续命中同样返回 Promise
      const second = instance.fetchValue('a')
      expect(second).toBeInstanceOf(Promise)
      expect(await second).toBe('value:a')
      expect(instance.callCount).toBe(1)
    })

    it('REGR-CACHE-001: 内容不同的 Map 参数应生成不同缓存键', async () => {
      jest.spyOn(console, 'log').mockImplementation()

      class MapCacheClass {
        callCount = 0

        @withCache({ ttl: 5000 })
        async lookup(map: Map<string, number>) {
          this.callCount++
          return map.get('a')
        }
      }

      const instance = new MapCacheClass()

      const result1 = await instance.lookup(new Map([['a', 1]]))
      const result2 = await instance.lookup(new Map([['a', 2]]))

      // 修复前：Object.keys(Map) 恒为空，所有 Map 参数折叠为 {} 串用同一缓存键
      expect(result1).toBe(1)
      expect(result2).toBe(2)
      expect(instance.callCount).toBe(2)
    })

    it('REGR-CACHE-002: 内容相同的 Map 参数第二次调用应命中缓存', async () => {
      jest.spyOn(console, 'log').mockImplementation()

      class MapHitClass {
        callCount = 0

        @withCache({ ttl: 5000 })
        async lookup(map: Map<string, number>) {
          this.callCount++
          return map.get('a')
        }
      }

      const instance = new MapHitClass()

      const result1 = await instance.lookup(new Map([['a', 7]]))
      const result2 = await instance.lookup(new Map([['a', 7]]))

      expect(result1).toBe(7)
      expect(result2).toBe(7)
      expect(instance.callCount).toBe(1)
    })

    it('REGR-CACHE-003: Map/Set/普通对象参数不得折叠为同一缓存键', async () => {
      jest.spyOn(console, 'log').mockImplementation()

      class MixedCacheClass {
        callCount = 0

        @withCache({ ttl: 5000 })
        async lookup(value: unknown) {
          this.callCount++
          return this.callCount
        }
      }

      const instance = new MixedCacheClass()

      // 修复前：Map/Set/普通对象全部折叠为 {}，三种调用串用同一缓存键
      await instance.lookup(new Map([['a', 1]]))
      await instance.lookup(new Set(['a']))
      await instance.lookup({ a: 1 })

      expect(instance.callCount).toBe(3)
    })

    it('DECORATOR-CACHE-015: 参数无法序列化（循环引用）时跳过缓存直接执行', async () => {
      class UnserializableClass {
        callCount = 0

        @withCache({ ttl: 1000 })
        async getValue(arg: unknown) {
          this.callCount++
          return `value-${this.callCount}`
        }
      }

      const instance = new UnserializableClass()
      const circular: Record<string, unknown> = { name: 'circular' }
      circular.self = circular

      // 序列化失败返回 __uncacheable__ 唯一键：等效跳过缓存
      const r1 = await instance.getValue(circular)
      const r2 = await instance.getValue(circular)
      expect(r1).toBe('value-1')
      expect(r2).toBe('value-2')
      expect(instance.callCount).toBe(2)
    })

    it('DECORATOR-CACHE-016: 写入新条目时回收已过期条目', async () => {
      jest.useFakeTimers()
      const deleteSpy = jest.spyOn(Map.prototype, 'delete')

      class ExpiringClass {
        callCount = 0

        @withCache({ ttl: 1000 })
        async getValue(key: string) {
          this.callCount++
          return `value-${key}-${this.callCount}`
        }
      }

      const instance = new ExpiringClass()
      await instance.getValue('a')
      jest.advanceTimersByTime(1500)
      await instance.getValue('b')

      // 写入 b 时循环回收已过期的 a，避免长生命周期宿主上 Map 持续累积
      expect(deleteSpy).toHaveBeenCalled()
      jest.useRealTimers()
    })
  })

  // ==================== withLog 装饰器测试 ====================
  describe('withLog', () => {
    it('DECORATOR-LOG-001: 应该在执行前后记录日志（使用自定义名称）', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation()
      const errorSpy = jest.spyOn(console, 'error').mockImplementation()

      class LogClass {
        @withLog('fetchData')
        async method(value: number) {
          return value * 2
        }
      }

      const instance = new LogClass()
      const result = await instance.method(21)

      expect(result).toBe(42)
      // 验证 before 日志使用了自定义名称
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[Action] fetchData started with args:'), [21])
      // 验证 after 日志使用了自定义名称
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[Action] fetchData completed with result:'), 42)

      logSpy.mockRestore()
      errorSpy.mockRestore()
    })

    it('DECORATOR-LOG-002: 应该在错误时记录错误日志（使用自定义名称）', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation()

      class ErrorLogClass {
        @withLog('dangerousAction')
        async method() {
          throw new Error('something went wrong')
        }
      }

      const instance = new ErrorLogClass()
      await expect(instance.method()).rejects.toThrow('something went wrong')

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Action] dangerousAction failed:'),
        expect.objectContaining({ message: 'something went wrong' }),
      )

      errorSpy.mockRestore()
    })

    it('DECORATOR-LOG-003: 不传名称时应该使用默认名称 "action"', async () => {
      const logSpy = jest.spyOn(console, 'log').mockImplementation()
      const errorSpy = jest.spyOn(console, 'error').mockImplementation()

      class DefaultNameLogClass {
        @withLog()
        async method() {
          return 'ok'
        }
      }

      const instance = new DefaultNameLogClass()
      await instance.method()

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[Action] action started with args:'), [])
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[Action] action completed with result:'), 'ok')

      logSpy.mockRestore()
      errorSpy.mockRestore()
    })

    it('DECORATOR-LOG-004: 不传名称时抛错应该使用默认名称 "action" 记录错误', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation()

      class DefaultNameErrorLogClass {
        @withLog()
        async method() {
          throw new Error('default name error')
        }
      }

      const instance = new DefaultNameErrorLogClass()
      await expect(instance.method()).rejects.toThrow('default name error')

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[Action] action failed:'), expect.objectContaining({ message: 'default name error' }))

      errorSpy.mockRestore()
    })
  })
  describe('withThrottle', () => {
    it('DECORATOR-THROTTLE-001: 应该在间隔内节流，返回 Promise.resolve()', async () => {
      jest.useFakeTimers()

      class ThrottleClass {
        callCount = 0

        @withThrottle(100)
        async method() {
          this.callCount++
          return 'executed'
        }
      }

      const instance = new ThrottleClass()

      // 第一次调用应该执行
      const result1 = await instance.method()
      expect(result1).toBe('executed')
      expect(instance.callCount).toBe(1)

      // 在间隔内再次调用，应该被节流
      const result2 = await instance.method()
      expect(result2).toBeUndefined() // Promise.resolve() 返回 undefined
      expect(instance.callCount).toBe(1) // 没有再次执行

      jest.useRealTimers()
    })

    it('DECORATOR-THROTTLE-002: 间隔过后应该允许再次执行', async () => {
      jest.useFakeTimers()

      class ThrottleClass {
        callCount = 0

        @withThrottle(100)
        async method() {
          this.callCount++
          return `call-${this.callCount}`
        }
      }

      const instance = new ThrottleClass()

      await instance.method()
      expect(instance.callCount).toBe(1)

      // 快进超过间隔
      jest.advanceTimersByTime(150)

      await instance.method()
      expect(instance.callCount).toBe(2)

      jest.useRealTimers()
    })

    it('DECORATOR-THROTTLE-003: 应该使用默认间隔 300ms', async () => {
      jest.useFakeTimers()

      class DefaultThrottleClass {
        callCount = 0

        @withThrottle() // 默认 300ms
        async method() {
          this.callCount++
        }
      }

      const instance = new DefaultThrottleClass()

      await instance.method()
      expect(instance.callCount).toBe(1)

      // 在 300ms 内再次调用应该被节流
      await instance.method()
      expect(instance.callCount).toBe(1)

      // 快进超过 300ms
      jest.advanceTimersByTime(350)
      await instance.method()
      expect(instance.callCount).toBe(2)

      jest.useRealTimers()
    })

    it('DECORATOR-THROTTLE-004: this 为 null 时应该使用本地变量兜底', async () => {
      jest.useFakeTimers()

      class StandaloneClass {
        @withThrottle(50)
        async method(value: string) {
          return value
        }
      }

      // 通过 .call(null) 调用，使 this 为 null
      const descriptor = Object.getOwnPropertyDescriptor(StandaloneClass.prototype, 'method')!
      const wrappedFn = descriptor.value

      // 第一次调用，this 为 null，应该正常执行（本地变量 lastCall=0）
      const result1 = await wrappedFn.call(null, 'test1')
      expect(result1).toBe('test1')

      // 第二次调用在间隔内，由于 this 为 null 不会存储 lastCall，
      // 所以 lastCall 始终为 0，应该再次执行
      const result2 = await wrappedFn.call(null, 'test2')
      expect(result2).toBe('test2')

      jest.useRealTimers()
    })

    it('DECORATOR-THROTTLE-005: this 为 undefined 时应该使用本地变量兜底', async () => {
      jest.useFakeTimers()

      class StandaloneClass {
        @withThrottle(50)
        async method(value: number) {
          return value * 3
        }
      }

      // 通过 .call(undefined) 调用
      const descriptor = Object.getOwnPropertyDescriptor(StandaloneClass.prototype, 'method')!
      const wrappedFn = descriptor.value

      const result = await wrappedFn.call(undefined, 7)
      expect(result).toBe(21)

      jest.useRealTimers()
    })

    it('DECORATOR-THROTTLE-006: 非 async 但返回 Promise 的方法被节流跳过时保持 Promise 语义', async () => {
      jest.useFakeTimers()

      class PromiseThrottleClass {
        @withThrottle(100)
        fetchData(value: number) {
          return Promise.resolve(value * 2)
        }
      }

      const instance = new PromiseThrottleClass()

      // 首次执行：观测到 Promise 语义
      const first = await instance.fetchData(21)
      expect(first).toBe(42)

      // 间隔内再次调用：被节流跳过，但应保持 Promise 语义而非 undefined
      const skipped = instance.fetchData(21)
      expect(skipped).toBeInstanceOf(Promise)
      expect(await skipped).toBeUndefined()

      jest.useRealTimers()
    })

    it('DECORATOR-THROTTLE-002: leading/trailing 双 false 退化为纯 leading', () => {
      jest.useFakeTimers()

      class PureLeadingClass {
        callCount = 0

        @withThrottle(100, { leading: false, trailing: false })
        method() {
          this.callCount++
          return 'executed'
        }
      }

      const instance = new PureLeadingClass()
      instance.method()
      expect(instance.callCount).toBe(1) // 双 false 退化：首次立即执行
      instance.method()
      expect(instance.callCount).toBe(1) // 窗口内丢弃
      jest.advanceTimersByTime(150)
      instance.method()
      expect(instance.callCount).toBe(2) // 新窗口执行
      jest.useRealTimers()
    })

    it('DECORATOR-THROTTLE-003: leading=false 首次调用延后到窗口结束补发', () => {
      jest.useFakeTimers()

      class TrailingOnlyClass {
        callCount = 0
        lastArgs: unknown[] = []

        @withThrottle(100, { leading: false })
        method(...args: unknown[]) {
          this.callCount++
          this.lastArgs = args
          return 'executed'
        }
      }

      const instance = new TrailingOnlyClass()
      const result = instance.method('first')
      expect(instance.callCount).toBe(0) // 首次调用延后
      expect(result).toBeUndefined() // 同步方法返回 undefined

      jest.advanceTimersByTime(100)
      expect(instance.callCount).toBe(1) // 窗口结束补发
      expect(instance.lastArgs).toEqual(['first'])
      jest.useRealTimers()
    })
  })

  // ==================== createDecorator 补充覆盖 ====================
  describe('createDecorator 补充覆盖', () => {
    it('DECORATOR-COMMON-001: 没有 onError 回调时错误应该直接抛出', async () => {
      // 覆盖 options.onError 为 falsy 的分支
      class NoErrorCallbackClass {
        @createDecorator({ before: undefined, after: undefined })
        async method() {
          throw new Error('no error callback')
        }
      }

      const instance = new NoErrorCallbackClass()
      await expect(instance.method()).rejects.toThrow('no error callback')
    })

    it('DECORATOR-COMMON-002: 只有 before 回调时应该正常工作', async () => {
      const beforeFn = jest.fn()

      class OnlyBeforeClass {
        @createDecorator({ before: beforeFn })
        async method(value: string) {
          return value.toUpperCase()
        }
      }

      const instance = new OnlyBeforeClass()
      const result = await instance.method('hello')

      expect(result).toBe('HELLO')
      expect(beforeFn).toHaveBeenCalledWith('hello')
    })

    it('DECORATOR-COMMON-003: 只有 after 回调时应该正常工作', async () => {
      const afterFn = jest.fn()

      class OnlyAfterClass {
        @createDecorator({ after: afterFn })
        async method() {
          return 42
        }
      }

      const instance = new OnlyAfterClass()
      const result = await instance.method()

      expect(result).toBe(42)
      expect(afterFn).toHaveBeenCalledWith(42)
    })
  })

  describe('withCache/withThrottle 异步检测（BUG-F6）', () => {
    // 修复前用 fn.constructor.name === 'AsyncFunction' 判定异步，
    // 压缩 mangle 后失效；现改为原型对象比较（压缩安全）+ 运行时观测兑底
    it('DECORATOR-F6-001: async 方法缓存命中时应恢复 Promise 语义', async () => {
      let callCount = 0
      class AsyncCacheClass {
        @withCache({ ttl: 5000 })
        async fetchValue(id: string): Promise<string> {
          callCount++
          return `value-${id}`
        }
      }
      const instance = new AsyncCacheClass()

      const first = await instance.fetchValue('a')
      expect(first).toBe('value-a')

      // 第二次命中缓存：返回 Promise（与首次类型一致），原方法不再执行
      const second = instance.fetchValue('a')
      expect(second).toBeInstanceOf(Promise)
      await expect(second).resolves.toBe('value-a')
      expect(callCount).toBe(1)
    })

    it('DECORATOR-F6-002: 非 async 但返回 Promise 的方法运行时观测后命中也应恢复 Promise 语义', async () => {
      let callCount = 0
      class PromiseReturningClass {
        @withCache({ ttl: 5000 })
        fetchValue(id: string): Promise<string> {
          callCount++
          return Promise.resolve(`value-${id}`)
        }
      }
      const instance = new PromiseReturningClass()

      await expect(instance.fetchValue('a')).resolves.toBe('value-a')
      const second = instance.fetchValue('a')
      expect(second).toBeInstanceOf(Promise)
      await expect(second).resolves.toBe('value-a')
      expect(callCount).toBe(1)
    })

    it('DECORATOR-F6-003: withThrottle 节流跳过 async 方法时应返回 Promise(undefined)', async () => {
      let callCount = 0
      class AsyncThrottleClass {
        @withThrottle(10000)
        async run(): Promise<number> {
          callCount++
          return callCount
        }
      }
      const instance = new AsyncThrottleClass()

      await expect(instance.run()).resolves.toBe(1)

      // 间隔内再次调用被节流：不执行原方法，返回 Promise(undefined) 而非裸 undefined
      const second = instance.run()
      expect(second).toBeInstanceOf(Promise)
      await expect(second).resolves.toBeUndefined()
      expect(callCount).toBe(1)
    })

    it('DECORATOR-F6-004: withThrottle 节流跳过非 async 方法时应返回 undefined', () => {
      let callCount = 0
      class SyncThrottleClass {
        @withThrottle(10000)
        run(): number {
          callCount++
          return callCount
        }
      }
      const instance = new SyncThrottleClass()

      expect(instance.run()).toBe(1)
      expect(instance.run()).toBeUndefined()
      expect(callCount).toBe(1)
    })
  })
})

// ==================== BUG 修复回归测试 ====================
describe('withCache BUG 回归：并发同参调用无 in-flight 去重', () => {
  it('DECORATOR-CACHE-BUG-001: 并发同参调用应复用进行中的 Promise 不重复执行', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    let executions = 0
    let resolveRequest!: (value: string) => void

    class Service {
      @withCache({ ttl: 5000 })
      async fetch(key: string): Promise<string> {
        executions++
        await new Promise<string>((resolve) => {
          resolveRequest = resolve
        })
        return `v-${key}`
      }
    }

    const service = new Service()
    const first = service.fetch('k')
    const second = service.fetch('k') // in-flight：应复用 first，不重复执行

    resolveRequest('done')
    expect(await first).toBe('v-k')
    expect(await second).toBe('v-k')
    expect(executions).toBe(1) // 修复前：两次调用都执行原方法

    consoleLogSpy.mockRestore()
  })

  it('DECORATOR-CACHE-BUG-002: in-flight 请求失败后应删除缓存条目，后续调用重新执行', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    let executions = 0
    let shouldFail = true

    class Service {
      @withCache({ ttl: 5000 })
      async fetch(): Promise<string> {
        executions++
        if (shouldFail) throw new Error('boom')
        return 'ok'
      }
    }

    const service = new Service()
    await expect(service.fetch()).rejects.toThrow('boom')

    shouldFail = false
    await expect(service.fetch()).resolves.toBe('ok') // 失败条目已删除，重新执行
    expect(executions).toBe(2)

    consoleLogSpy.mockRestore()
  })
})

// ==================== BUG 回归：装饰器状态按方法隔离 ====================
describe('BUG 回归：同一装饰器实例复用于多个方法时状态不应串扰', () => {
  it('DECORATOR-BUG: withCache 两个方法共享缓存会静默返回错误数据', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    const cached = withCache({ ttl: 5000 })

    class Service {
      m1Runs = 0
      m2Runs = 0

      @cached
      async m1(key: string): Promise<string> {
        this.m1Runs++
        return `m1:${key}`
      }

      @cached
      async m2(key: string): Promise<string> {
        this.m2Runs++
        return `m2:${key}`
      }
    }

    const service = new Service()
    await service.m1('same-arg')
    const result = await service.m2('same-arg')

    // 修复前：m2 命中 m1 的缓存条目，返回 'm1:same-arg' 且 m2Runs 为 0
    expect(result).toBe('m2:same-arg')
    expect(service.m1Runs).toBe(1)
    expect(service.m2Runs).toBe(1)

    consoleLogSpy.mockRestore()
  })

  it('DECORATOR-BUG: withDebounce 两个方法共享定时器会互相结算对方的调用', async () => {
    jest.useFakeTimers()
    const debounced = withDebounce(50)

    class Service {
      @debounced
      async m1(): Promise<string> {
        return 'r1'
      }

      @debounced
      async m2(): Promise<string> {
        return 'r2'
      }
    }

    const service = new Service()
    const p1 = service.m1()
    const p2 = service.m2()
    jest.advanceTimersByTime(60)

    // 修复前：共享 pending 队列，m1 的调用方拿到 m2 的结果 'r2'
    expect(await p1).toBe('r1')
    expect(await p2).toBe('r2')

    jest.useRealTimers()
  })

  it('DECORATOR-BUG: withThrottle 两个方法共享窗口会互吞调用', () => {
    const throttled = withThrottle(1000)

    class Service {
      m1Runs = 0
      m2Runs = 0

      @throttled
      m1(): string {
        this.m1Runs++
        return 'r1'
      }

      @throttled
      m2(): string {
        this.m2Runs++
        return 'r2'
      }
    }

    const service = new Service()
    expect(service.m1()).toBe('r1')
    // 修复前：m2 被 m1 的节流窗口吞掉，返回 undefined 且不执行
    expect(service.m2()).toBe('r2')
    expect(service.m1Runs).toBe(1)
    expect(service.m2Runs).toBe(1)
  })
})

// ==================== BUG 回归：Symbol 缓存键 ====================
describe('BUG 回归：同 description 的不同 Symbol 应生成不同缓存键', () => {
  it('两个同名 Symbol 参数不应串用缓存', async () => {
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation()
    const registry = new Map<symbol, string>()

    class Service {
      @withCache({ ttl: 5000 })
      async lookup(key: symbol): Promise<string> {
        const cached = registry.get(key)
        if (cached) return cached
        const value = `v-${Date.now()}-${Math.random()}`
        registry.set(key, value)
        return value
      }
    }

    const service = new Service()
    const symA = Symbol('channel')
    const symB = Symbol('channel')

    const resultA = await service.lookup(symA)
    const resultB = await service.lookup(symB)

    // 修复前：两个 Symbol 都序列化为 symbol:Symbol(channel)，B 命中 A 的缓存
    expect(resultB).not.toBe(resultA)
    // 相同 Symbol 的第二次调用仍命中缓存
    expect(await service.lookup(symA)).toBe(resultA)

    consoleLogSpy.mockRestore()
  })
})

// ==================== 0.x 设计变更：throttle trailing ====================
describe('设计变更：withThrottle trailing 补发', () => {
  it('窗口内被抑制的调用应在窗口结束时以最新参数补发', async () => {
    jest.useFakeTimers()

    class Scroll {
      positions: number[] = []

      @withThrottle(100)
      handleScroll(position: number) {
        this.positions.push(position)
      }
    }

    const scroll = new Scroll()
    scroll.handleScroll(1)
    scroll.handleScroll(2)
    scroll.handleScroll(3) // 被抑制，但作为窗口尾最新调用应被补发

    expect(scroll.positions).toEqual([1])

    await jest.advanceTimersByTimeAsync(100)
    // trailing 以最新参数（3）补发，而非首次被抑制的参数（2）
    expect(scroll.positions).toEqual([1, 3])

    jest.useRealTimers()
  })

  it('trailing: false 保持纯 leading 语义（窗口内调用全部丢弃）', async () => {
    jest.useFakeTimers()

    class PureLeading {
      runs = 0

      @withThrottle(100, { trailing: false })
      hit() {
        this.runs++
      }
    }

    const instance = new PureLeading()
    instance.hit()
    instance.hit()
    instance.hit()

    await jest.advanceTimersByTimeAsync(200)
    expect(instance.runs).toBe(1)

    jest.useRealTimers()
  })

  it('trailing 调用的异步 rejection 不应成为 unhandled rejection', async () => {
    jest.useFakeTimers()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation()

    class Failing {
      @withThrottle(50)
      async boom(): Promise<void> {
        throw new Error('trailing boom')
      }
    }

    const instance = new Failing()
    await instance.boom().catch(() => {}) // leading 执行，rejection 由调用方处理
    void instance.boom().catch(() => {}) // 窗口内被抑制，trailing 补发将 reject

    await jest.advanceTimersByTimeAsync(50)
    // trailing 补发的 rejection 被 withThrottle 记录而非成为 unhandled rejection
    expect(errorSpy).toHaveBeenCalledWith('[withThrottle] trailing invocation failed:', expect.any(Error))

    errorSpy.mockRestore()
    jest.useRealTimers()
  })
})

// ==================== #35 symbolIds 表容量上限回归 ====================
describe('withCache symbolIds 容量上限', () => {
  it('超限时整表重置且缓存键不串用', async () => {
    class Host {
      calls = 0
      @withCache({ ttl: 60000 })
      fetch(token: symbol): number {
        this.calls++
        return this.calls
      }
    }
    const host = new Host()

    // 常规 Symbol 参数命中缓存
    const symA = Symbol('a')
    await host.fetch(symA)
    const second = await host.fetch(symA)
    expect(second).toBe(1)

    // 大量一次性 Symbol（模拟请求令牌）把表推过上限
    for (let i = 0; i < 1100; i++) {
      await host.fetch(Symbol(`token-${i}`))
    }

    // 表被清空重建：symA 的旧键失配为 miss，重新执行返回新值（不串用旧结果）
    const afterReset = await host.fetch(symA)
    expect(afterReset).toBeGreaterThan(1)
  })
})
