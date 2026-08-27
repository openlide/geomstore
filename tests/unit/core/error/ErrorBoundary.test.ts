/**
 * ErrorBoundary 测试
 */

import { ErrorBoundary, withErrorBoundary } from '@/core/error'

describe('ErrorBoundary', () => {
  let errorBoundary: ErrorBoundary<{ count: number }, { count: number }>
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
      // 无 fallback 时默认 fail-loud（重抛），但错误回调仍应被调用
      const boundary = new ErrorBoundary({ onError })
      const error = new Error('Test error')
      const fn = jest.fn(() => {
        throw error
      })
      // 无 fallback 默认 fail-loud：重抛错误，但 onError 回调仍被调用
      expect(() => boundary.execute(fn, testState)).toThrow(error)
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

  it('BUG-F3: 不同实例的 boundary 应按宿主隔离（不共享错误历史）', () => {
    // 修复前 boundary 在工厂闭包创建，同一装饰器装饰的所有实例共享同一份错误历史/恢复状态；
    // 修复后按宿主（this）懒创建隔离，互不影响各自的回退与捕获行为
    const fallback = { recovered: true }

    class Widget {
      constructor(public id: string) {}

      @withErrorBoundary({ recoverable: true, fallback })
      fail(): { recovered: boolean } {
        throw new Error(`fail from ${this.id}`)
      }
    }

    const a = new Widget('a')
    const b = new Widget('b')

    // a 连续多次出错：每次都返回自己的 fallback
    expect(a.fail()).toBe(fallback)
    expect(a.fail()).toBe(fallback)
    // b 首次出错不受 a 的影响，正常返回 fallback
    expect(b.fail()).toBe(fallback)
  })

  it('BUG-F3: 同一实例的多个被装饰方法共享同一 boundary（宿主级隔离粒度）', () => {
    let errorCount = 0
    class Shared {
      @withErrorBoundary({ recoverable: true, onError: () => errorCount++ })
      failA(): void {
        throw new Error('a')
      }

      @withErrorBoundary({ recoverable: true, onError: () => errorCount++ })
      failB(): void {
        throw new Error('b')
      }
    }

    const instance = new Shared()
    expect(() => instance.failA()).not.toThrow()
    expect(() => instance.failB()).not.toThrow()
    expect(errorCount).toBe(2)
  })

  it('BUG-F3: 宿主非对象时（如解绑定调用）应每次用一次性 boundary 不抛错', () => {
    const decorator = withErrorBoundary({ recoverable: true })
    const original = () => {
      throw new Error('bare')
    }
    const descriptor = { value: original, writable: true, enumerable: true, configurable: true }
    const wrapped = decorator(undefined, 'method', descriptor)

    // apply(this=undefined)：宿主非对象，退化为一次性 boundary，不跨调用串扰
    expect(() => (wrapped.value as () => void).apply(undefined)).not.toThrow()
    expect(() => (wrapped.value as () => void).apply(undefined)).not.toThrow()
    expect(() => (wrapped.value as () => void).apply(null)).not.toThrow()
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

    expect(warnSpy).toHaveBeenCalledWith('[ErrorBoundary] Returning fallback state due to error:', error)

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

    expect(warnSpy).toHaveBeenCalledWith('[ErrorBoundary] Returning fallback state due to error:', error)

    warnSpy.mockRestore()
  })

  it('REGR-ERRB-001: 函数型 fallback 应根据错误与当前状态动态计算', () => {
    const boundary = new ErrorBoundary<{ count: number }, { count: number }>({
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

// ==================== 0.x 设计变更：fail-loud 默认与类型诚实泛型 ====================
describe('设计变更：恢复意图由 fallback 推导', () => {
  it('无 fallback 时默认重抛（fail-loud），不再吞错返回 undefined', () => {
    const boundary = new ErrorBoundary()
    expect(() => boundary.execute(() => { throw new Error('boom') })).toThrow('boom')
  })

  it('提供 fallback 即声明恢复意图：吞错并返回 fallback', () => {
    const boundary = new ErrorBoundary<unknown, { count: number }>({ fallback: { count: 0 } })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

    const result = boundary.execute(() => { throw new Error('boom') })
    expect(result).toEqual({ count: 0 })

    warnSpy.mockRestore()
  })

  it('显式 recoverable 仍然优先于推导', () => {
    // 有 fallback 但显式要求不可恢复 → 重抛
    const boundary = new ErrorBoundary({ fallback: { count: 0 }, recoverable: false })
    expect(() => boundary.execute(() => { throw new Error('boom') })).toThrow('boom')

    // 无 fallback 但显式可恢复 → 吞错返回 undefined
    const swallow = new ErrorBoundary({ recoverable: true })
    expect(swallow.execute(() => { throw new Error('boom') })).toBeUndefined()
  })

  it('吞错路径的 warn 应包含完整错误对象（含堆栈）', () => {
    const boundary = new ErrorBoundary<unknown, number>({ fallback: 42 })
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const error = new Error('with stack')

    boundary.execute(() => { throw error })

    expect(warnSpy).toHaveBeenCalledWith('[ErrorBoundary] Returning fallback state due to error:', error)
    warnSpy.mockRestore()
  })

  it('withErrorBoundary 无选项时默认重抛而非静默吞错', () => {
    class LoudClass {
      @((withErrorBoundary as unknown as () => MethodDecorator)())
      method(): number {
        throw new Error('should propagate')
      }
    }
    expect(() => new LoudClass().method()).toThrow('should propagate')
  })
})

// ==================== 本轮修复回归 ====================
describe('BUG 回归：事后 setFallbackState 应生效', () => {
  it('构造时无 fallback、事后设置 fallback 应切换为恢复模式', () => {
    const boundary = new ErrorBoundary<unknown, number>()
    // 构造时无 fallback：默认 fail-loud
    expect(() => boundary.execute(() => { throw new Error('first') })).toThrow('first')

    boundary.setFallbackState(42)
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation()

    // 事后提供 fallback 即声明恢复意图
    expect(boundary.execute(() => { throw new Error('second') })).toBe(42)

    warnSpy.mockRestore()
  })

  it('显式 recoverable: false 不被 setFallbackState 翻转', () => {
    const boundary = new ErrorBoundary<unknown, number>({ recoverable: false })
    boundary.setFallbackState(42)

    expect(() => boundary.execute(() => { throw new Error('boom') })).toThrow('boom')
  })
})

// ==================== BUG 回归：fallback 函数抛错不应顶替原错误 ====================
describe('fallback 函数自身抛错（BUG 回归）', () => {
  it('REGR-BOUNDARY-001: fallback 抛错时应重抛原错误而非 fallback 的异常', () => {
    const original = new Error('original error')
    const boundary = new ErrorBoundary<Record<string, unknown>, Record<string, unknown>>({
      recoverable: true,
      fallback: () => {
        throw new Error('fallback boom')
      },
    })
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

    expect(() =>
      boundary.execute(() => {
        throw original
      }),
    ).toThrow(original)

    consoleErrorSpy.mockRestore()
  })

  it('REGR-BOUNDARY-002: fallback 正常返回时行为不变', async () => {
    const fallback = { safe: true }
    const boundary = new ErrorBoundary<Record<string, unknown>, Record<string, unknown>>({
      recoverable: true,
      fallback: () => fallback,
    })

    const result = await boundary.executeAsync(() => Promise.reject(new Error('boom')))
    expect(result).toEqual(fallback)
  })
})
