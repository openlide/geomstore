/**
 * ErrorBoundary 测试
 */

import { ErrorBoundary, withErrorBoundary } from '@/core/error'

describe('ErrorBoundary', () => {
  let errorBoundary: ErrorBoundary<{ count: number }>
  let testState: { count: number }

  beforeEach(() => {
    testState = { count: 0 }
    errorBoundary = new ErrorBoundary({
      fallback: testState,
      recoverable: true,
      onError: jest.fn(),
    })
  })

  describe('构造函数', () => {
    it('应该使用默认选项', () => {
      const boundary = new ErrorBoundary()
      expect(boundary.getFallbackState()).toBeUndefined()
      expect(boundary.hasError()).toBe(false)
    })

    it('应该接受自定义选项', () => {
      const fallback = { value: 42 }
      const onError = jest.fn()
      const boundary = new ErrorBoundary({
        fallback,
        recoverable: true,
        onError,
      })
      expect(boundary.getFallbackState()).toBe(fallback)
    })
  })

  describe('execute', () => {
    it('应该成功执行函数', () => {
      const fn = jest.fn(() => 'success')
      const result = errorBoundary.execute(fn, testState)
      expect(result).toBe('success')
      expect(fn).toHaveBeenCalled()
    })

    it('应该捕获错误并返回回退状态', () => {
      const error = new Error('Test error')
      const fn = jest.fn(() => {
        throw error
      })
      const result = errorBoundary.execute(fn, testState)
      // 配置了 fallback 时应返回回退状态而非 undefined
      expect(result).toBe(testState)
      expect(fn).toHaveBeenCalled()
      expect(errorBoundary.hasError()).toBe(true)
      expect(errorBoundary.getLastError()).toBe(error)
    })

    it('应该在不可恢复时重新抛出错误', () => {
      const error = new Error('Test error')
      const boundary = new ErrorBoundary({ recoverable: false })
      const fn = jest.fn(() => {
        throw error
      })
      expect(() => boundary.execute(fn, testState)).toThrow(error)
    })

    it('应该调用错误回调', () => {
      const onError = jest.fn()
      const boundary = new ErrorBoundary({ onError })
      const error = new Error('Test error')
      const fn = jest.fn(() => {
        throw error
      })
      boundary.execute(fn, testState)
      expect(onError).toHaveBeenCalledWith(error)
    })

    it('应该处理错误回调中的错误', () => {
      const onError = jest.fn(() => {
        throw new Error('Callback error')
      })
      const boundary = new ErrorBoundary({ onError, recoverable: true })
      const error = new Error('Test error')
      const fn = jest.fn(() => {
        throw error
      })
      const result = boundary.execute(fn, testState)
      expect(result).toBeUndefined()
      expect(onError).toHaveBeenCalled()
    })
  })

  describe('executeAsync', () => {
    it('应该成功执行异步函数', async () => {
      const fn = jest.fn(async () => 'async success')
      const result = await errorBoundary.executeAsync(fn, testState)
      expect(result).toBe('async success')
      expect(fn).toHaveBeenCalled()
    })

    it('应该捕获异步错误并返回回退状态', async () => {
      const error = new Error('Async test error')
      const fn = jest.fn(async () => {
        throw error
      })
      const result = await errorBoundary.executeAsync(fn, testState)
      // 配置了 fallback 时应返回回退状态而非 undefined
      expect(result).toBe(testState)
      expect(fn).toHaveBeenCalled()
      expect(errorBoundary.hasError()).toBe(true)
      expect(errorBoundary.getLastError()).toBe(error)
    })

    it('应该在不可恢复时重新抛出异步错误', async () => {
      const error = new Error('Async test error')
      const boundary = new ErrorBoundary({ recoverable: false })
      const fn = jest.fn(async () => {
        throw error
      })
      await expect(boundary.executeAsync(fn, testState)).rejects.toThrow(error)
    })
  })

  describe('回退状态管理', () => {
    it('应该获取回退状态', () => {
      const fallback = { count: 100 }
      const boundary = new ErrorBoundary({ fallback })
      expect(boundary.getFallbackState()).toBe(fallback)
    })

    it('应该设置回退状态', () => {
      const newFallback = { count: 200 }
      errorBoundary.setFallbackState(newFallback)
      expect(errorBoundary.getFallbackState()).toBe(newFallback)
    })
  })

  describe('错误历史管理', () => {
    it('应该记录错误历史', () => {
      const error1 = new Error('Error 1')
      const error2 = new Error('Error 2')
      const fn = jest.fn(() => {
        throw error1
      })
      errorBoundary.execute(fn, testState)
      fn.mockImplementation(() => {
        throw error2
      })
      errorBoundary.execute(fn, testState)
      const history = errorBoundary.getErrorHistory()
      expect(history.length).toBe(2)
      expect(history[0]).toBe(error1)
      expect(history[1]).toBe(error2)
    })

    it('应该清除错误历史', () => {
      const error = new Error('Test error')
      const fn = jest.fn(() => {
        throw error
      })
      errorBoundary.execute(fn, testState)
      expect(errorBoundary.hasError()).toBe(true)
      errorBoundary.clearErrorHistory()
      expect(errorBoundary.hasError()).toBe(false)
      expect(errorBoundary.getErrorHistory()).toEqual([])
    })

    it('应该检查是否有错误', () => {
      expect(errorBoundary.hasError()).toBe(false)
      const error = new Error('Test error')
      const fn = jest.fn(() => {
        throw error
      })
      errorBoundary.execute(fn, testState)
      expect(errorBoundary.hasError()).toBe(true)
    })

    it('应该获取最后一个错误', () => {
      expect(errorBoundary.getLastError()).toBeUndefined()
      const error1 = new Error('Error 1')
      const error2 = new Error('Error 2')
      const fn = jest.fn(() => {
        throw error1
      })
      errorBoundary.execute(fn, testState)
      expect(errorBoundary.getLastError()).toBe(error1)
      fn.mockImplementation(() => {
        throw error2
      })
      errorBoundary.execute(fn, testState)
      expect(errorBoundary.getLastError()).toBe(error2)
    })

    it('应该返回错误历史的副本', () => {
      const error = new Error('Test error')
      const fn = jest.fn(() => {
        throw error
      })
      errorBoundary.execute(fn, testState)
      const history1 = errorBoundary.getErrorHistory()
      const history2 = errorBoundary.getErrorHistory()
      expect(history1).not.toBe(history2)
      expect(history1).toEqual(history2)
    })
  })
})

describe('withErrorBoundary 装饰器', () => {
  class TestClass {
    value: number = 0

    @withErrorBoundary({ recoverable: true })
    methodThatSucceeds(x: number) {
      this.value = x
      return this.value
    }

    @withErrorBoundary({ recoverable: true })
    methodThatFails() {
      throw new Error('Method error')
    }
  }

  it('应该包装方法并捕获错误', () => {
    const instance = new TestClass()
    expect(() => instance.methodThatFails()).not.toThrow()
  })

  it('应该允许成功的方法执行', () => {
    const instance = new TestClass()
    const result = instance.methodThatSucceeds(42)
    expect(result).toBe(42)
  })

  it('应该使用共享的错误边界', () => {
    const onError = jest.fn()
    class AnotherClass {
      @withErrorBoundary({ onError, recoverable: true })
      method() {
        throw new Error('Error')
      }
    }
    const instance = new AnotherClass()
    instance.method()
    expect(onError).toHaveBeenCalled()
  })

  it('async 方法的 rejection 应该被边界捕获而不是泄露为 unhandled rejection', async () => {
    const onError = jest.fn()
    class AsyncClass {
      @withErrorBoundary({ onError, recoverable: true })
      async loadData() {
        await Promise.resolve()
        throw new Error('async failure')
      }

      @withErrorBoundary({ onError, recoverable: true })
      async loadOk() {
        return 'ok'
      }
    }

    const instance = new AsyncClass()

    // rejection 被捕获：可恢复时 resolve 为 undefined
    await expect(instance.loadData()).resolves.toBeUndefined()
    // 成功的 async 方法返回值透传
    await expect(instance.loadOk()).resolves.toBe('ok')
    expect(onError).toHaveBeenCalled()
  })
})

describe('ErrorBoundary 边界条件', () => {
  it('应该在同时有 fallbackState 和 currentState 时输出警告', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const fallbackState = { count: 0 }
    const currentState = { count: 10 }
    const boundary = new ErrorBoundary({
      fallback: fallbackState,
      recoverable: true,
    })

    const error = new Error('Test error')
    const fn = () => {
      throw error
    }

    boundary.execute(fn, currentState)

    expect(warnSpy).toHaveBeenCalledWith('[ErrorBoundary] Returning fallback state due to error:', error.message)

    warnSpy.mockRestore()
  })

  it('应该在没有 currentState 时仍返回 fallback 并输出警告', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const fallbackState = { count: 0 }
    const boundary = new ErrorBoundary({
      fallback: fallbackState,
      recoverable: true,
    })

    const error = new Error('Test error')
    const fn = () => {
      throw error
    }

    // fallback 返回不再依赖 currentState
    const result = boundary.execute(fn)
    expect(result).toBe(fallbackState)
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('应该在没有 fallbackState 时不输出警告', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const boundary = new ErrorBoundary({
      recoverable: true,
    })

    const error = new Error('Test error')
    const fn = () => {
      throw error
    }

    boundary.execute(fn, { count: 10 })

    expect(warnSpy).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('异步执行应该在同时有 fallbackState 和 currentState 时输出警告', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const fallbackState = { count: 0 }
    const currentState = { count: 10 }
    const boundary = new ErrorBoundary({
      fallback: fallbackState,
      recoverable: true,
    })

    const error = new Error('Async test error')
    const fn = async () => {
      throw error
    }

    await boundary.executeAsync(fn, currentState)

    expect(warnSpy).toHaveBeenCalledWith('[ErrorBoundary] Returning fallback state due to error:', error.message)

    warnSpy.mockRestore()
  })

  it('REGR-ERRB-001: 函数型 fallback 应根据错误与当前状态动态计算', () => {
    const boundary = new ErrorBoundary<{ count: number }>({
      fallback: (error, currentState) => ({ count: (currentState?.count ?? 0) + 1 }),
      recoverable: true,
    })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

    const fn = () => {
      throw new Error('boom')
    }

    const result = boundary.execute(fn, { count: 41 })
    expect(result).toEqual({ count: 42 })
    warnSpy.mockRestore()
  })

  it('REGR-ERRB-002: 未配置 fallback 时仍返回 undefined', () => {
    const boundary = new ErrorBoundary<{ count: number }>({ recoverable: true })
    const fn = () => {
      throw new Error('boom')
    }

    expect(boundary.execute(fn, { count: 1 })).toBeUndefined()
  })
})
