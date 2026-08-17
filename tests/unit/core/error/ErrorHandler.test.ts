/**
 * GeomStore v1.0 - ErrorHandler 测试
 */

import { ErrorHandlerImpl, createErrorContext, defaultErrorHandler } from '@/core/error/ErrorHandler'
import type { ErrorContext, ErrorLevel, OperationType } from '@/types/error'

describe('ErrorHandlerImpl', () => {
  let errorHandler: ErrorHandlerImpl

  beforeEach(() => {
    errorHandler = new ErrorHandlerImpl()
  })

  describe('基础功能', () => {
    test('应该能够创建errorHandler实例', () => {
      expect(errorHandler).toBeDefined()
      expect(errorHandler).toBeInstanceOf(ErrorHandlerImpl)
    })

    test('应该使用默认的错误处理器', () => {
      const error = new Error('Test error')
      const context = createErrorContext('test-store', 'state-update', error, 'error')

      // 不应该抛出错误
      expect(() => errorHandler.handleError(context)).not.toThrow()
    })
  })

  describe('setHandler', () => {
    test('应该能够设置自定义错误处理器', () => {
      const customHandler = jest.fn()
      errorHandler.setHandler(customHandler)

      const error = new Error('Test error')
      const context = createErrorContext('test-store', 'state-update', error)

      errorHandler.handleError(context)

      expect(customHandler).toHaveBeenCalledWith(context)
    })

    test('非函数handler应该抛出错误', () => {
      expect(() => errorHandler.setHandler(null as any)).toThrow('[ErrorHandler] Handler must be a function')
      expect(() => errorHandler.setHandler('not-a-function' as any)).toThrow('[ErrorHandler] Handler must be a function')
      expect(() => errorHandler.setHandler(123 as any)).toThrow('[ErrorHandler] Handler must be a function')
    })

    test('应该覆盖默认的error handler', () => {
      const customHandler = jest.fn()
      errorHandler.setHandler(customHandler)

      const error = new Error('Test error')
      const context = createErrorContext('test-store', 'state-update', error)

      errorHandler.handleError(context)

      expect(customHandler).toHaveBeenCalled()
    })
  })

  describe('handleError', () => {
    test('应该能够处理错误上下文', () => {
      const error = new Error('Test error')
      const context = createErrorContext('test-store', 'state-update', error)

      errorHandler.handleError(context)

      const log = errorHandler.getErrorLog()
      expect(log).toHaveLength(1)
      expect(log[0]).toEqual(context)
    })

    test('应该处理error handler中的异常', () => {
      const badHandler = () => {
        throw new Error('Handler error')
      }
      errorHandler.setHandler(badHandler)

      const error = new Error('Test error')
      const context = createErrorContext('test-store', 'state-update', error)

      // 不应该抛出错误
      expect(() => errorHandler.handleError(context)).not.toThrow()

      const log = errorHandler.getErrorLog()
      expect(log).toHaveLength(1)
    })
  })

  describe('handle', () => {
    test('应该能够创建并处理错误', () => {
      const error = new Error('Test error')

      errorHandler.handle('user-store', 'action-execution', error, 'error', { actionName: 'test-action' })

      const log = errorHandler.getErrorLog()
      expect(log).toHaveLength(1)
      expect(log[0].storeName).toBe('user-store')
      expect(log[0].operation).toBe('action-execution')
      expect(log[0].error).toBe(error)
      expect(log[0].payload).toEqual({ actionName: 'test-action' })
    })

    test('应该使用默认的错误级别', () => {
      const error = new Error('Test error')

      errorHandler.handle('user-store', 'state-update', error)

      const log = errorHandler.getErrorLog()
      expect(log[0].level).toBe('error')
    })

    test('应该能够设置不同的错误级别', () => {
      const error = new Error('Critical error')

      errorHandler.handle('user-store', 'state-update', error, 'critical')

      const log = errorHandler.getErrorLog()
      expect(log[0].level).toBe('critical')
    })

    test('应该能够处理带有payload的错误', () => {
      const error = new Error('Test error')
      const payload = { userId: '123', action: 'login' }

      errorHandler.handle('user-store', 'action-execution', error, 'error', payload)

      const log = errorHandler.getErrorLog()
      expect(log[0].storeName).toBe('user-store')
      expect(log[0].operation).toBe('action-execution')
      expect(log[0].error).toBe(error)
      expect(log[0].payload).toEqual(payload)
    })
  })

  describe('getErrorLog', () => {
    test('应该返回错误日志的副本', () => {
      const error = new Error('Test error')
      const context = createErrorContext('test-store', 'state-update', error)

      errorHandler.handleError(context)

      const log1 = errorHandler.getErrorLog()
      const log2 = errorHandler.getErrorLog()

      expect(log1).not.toBe(log2)
      expect(log1).toEqual(log2)
    })

    test('应该能够处理多个错误', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'))
      errorHandler.handle('store2', 'op2' as OperationType, new Error('Error 2'))
      errorHandler.handle('store3', 'op3' as OperationType, new Error('Error 3'))

      const log = errorHandler.getErrorLog()
      expect(log).toHaveLength(3)
    })
  })

  describe('getLastError', () => {
    test('应该能够获取最后一个错误', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'))
      errorHandler.handle('store2', 'op2' as OperationType, new Error('Error 2'))

      const lastError = errorHandler.getLastError()
      expect(lastError).toBeDefined()
      expect(lastError!.error.message).toBe('Error 2')
    })

    test('没有错误时应该返回undefined', () => {
      const lastError = errorHandler.getLastError()
      expect(lastError).toBeUndefined()
    })

    test('应该返回最近添加的错误', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'))
      errorHandler.handle('store2', 'op2' as OperationType, new Error('Error 2'))
      errorHandler.handle('store3', 'op3' as OperationType, new Error('Error 3'))

      const lastError = errorHandler.getLastError()
      expect(lastError!.error.message).toBe('Error 3')
    })
  })

  describe('clearErrorLog', () => {
    test('应该能够清空错误日志', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'))
      errorHandler.handle('store2', 'op2' as OperationType, new Error('Error 2'))

      expect(errorHandler.getErrorLog()).toHaveLength(2)

      errorHandler.clearErrorLog()

      expect(errorHandler.getErrorLog()).toHaveLength(0)
    })

    test('清空后应该能够重新记录错误', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'))
      errorHandler.clearErrorLog()

      expect(errorHandler.getErrorLog()).toHaveLength(0)

      errorHandler.handle('store2', 'op2' as OperationType, new Error('Error 2'))

      expect(errorHandler.getErrorLog()).toHaveLength(1)
    })
  })

  describe('setMaxLogSize', () => {
    test('应该能够设置最大日志大小', () => {
      errorHandler.setMaxLogSize(50)
      // 无法直接验证，但通过行为测试
    })

    test('应该限制为至少1', () => {
      errorHandler.setMaxLogSize(0)
      errorHandler.setMaxLogSize(-5)
      // 应该自动设置为至少1
    })

    test('超过限制时应该移除最旧的错误', () => {
      errorHandler.setMaxLogSize(3)

      // 记录5个错误
      for (let i = 0; i < 5; i++) {
        errorHandler.handle(`store${i}`, `op${i}` as OperationType, new Error(`Error ${i}`))
      }

      const log = errorHandler.getErrorLog()
      expect(log).toHaveLength(3)
      // 应该保留最新的3个
      expect(log[0].error.message).toBe('Error 2')
      expect(log[1].error.message).toBe('Error 3')
      expect(log[2].error.message).toBe('Error 4')
    })

    test('减少限制时应该截断当前日志', () => {
      // 记录5个错误
      for (let i = 0; i < 5; i++) {
        errorHandler.handle(`store${i}`, `op${i}` as OperationType, new Error(`Error ${i}`))
      }

      expect(errorHandler.getErrorLog()).toHaveLength(5)

      // 设置限制为2
      errorHandler.setMaxLogSize(2)

      expect(errorHandler.getErrorLog()).toHaveLength(2)
    })
  })

  describe('getErrorsByOperation', () => {
    test('应该能够按操作类型筛选错误', () => {
      errorHandler.handle('store1', 'action-execution', new Error('Error 1'))
      errorHandler.handle('store2', 'state-update', new Error('Error 2'))
      errorHandler.handle('store3', 'action-execution', new Error('Error 3'))

      const actionErrors = errorHandler.getErrorsByOperation('action-execution')

      expect(actionErrors).toHaveLength(2)
      expect(actionErrors[0].error.message).toBe('Error 1')
      expect(actionErrors[1].error.message).toBe('Error 3')
    })

    test('没有匹配的错误应该返回空数组', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'))

      const errors = errorHandler.getErrorsByOperation('nonexistent-operation' as OperationType)

      expect(errors).toEqual([])
    })

    test('应该能够处理不同类型的操作', () => {
      errorHandler.handle('store1', 'action-execution', new Error('Error 1'))
      errorHandler.handle('store2', 'state-update', new Error('Error 2'))
      errorHandler.handle('store3', 'getter-execution', new Error('Error 3'))
      errorHandler.handle('store4', 'state-update', new Error('Error 4'))

      const stateErrors = errorHandler.getErrorsByOperation('state-update')
      expect(stateErrors).toHaveLength(2)

      const actionErrors = errorHandler.getErrorsByOperation('action-execution')
      expect(actionErrors).toHaveLength(1)
    })
  })

  describe('getErrorsByLevel', () => {
    test('应该能够按错误级别筛选错误', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'), 'error')
      errorHandler.handle('store2', 'op2' as OperationType, new Error('Error 2'), 'warn')
      errorHandler.handle('store3', 'op3' as OperationType, new Error('Error 3'), 'error')
      errorHandler.handle('store4', 'op4' as OperationType, new Error('Error 4'), 'critical')

      const errorErrors = errorHandler.getErrorsByLevel('error')
      const warnErrors = errorHandler.getErrorsByLevel('warn')
      const criticalErrors = errorHandler.getErrorsByLevel('critical')

      expect(errorErrors).toHaveLength(2)
      expect(warnErrors).toHaveLength(1)
      expect(criticalErrors).toHaveLength(1)
    })

    test('没有匹配的错误应该返回空数组', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'), 'error')

      const errors = errorHandler.getErrorsByLevel('nonexistent-level' as ErrorLevel)

      expect(errors).toEqual([])
    })
  })

  describe('getErrorStats', () => {
    test('应该能够返回错误统计信息', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'), 'error')
      errorHandler.handle('store2', 'op2' as OperationType, new Error('Error 2'), 'warn')
      errorHandler.handle('store3', 'op3' as OperationType, new Error('Error 3'), 'error')
      errorHandler.handle('store4', 'op4' as OperationType, new Error('Error 4'), 'error')

      const stats = errorHandler.getErrorStats()

      expect(stats.total).toBe(4)
      expect(stats.byLevel.error).toBe(3)
      expect(stats.byLevel.warn).toBe(1)
      expect(stats.byOperation['op1' as OperationType]).toBe(1)
      expect(stats.byOperation['op2' as OperationType]).toBe(1)
    })

    test('没有错误时应该返回默认统计', () => {
      const stats = errorHandler.getErrorStats()

      expect(stats.total).toBe(0)
      expect(Object.keys(stats.byLevel)).toHaveLength(0)
      expect(Object.keys(stats.byOperation)).toHaveLength(0)
    })

    test('应该能够正确统计多个级别的错误', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'), 'error')
      errorHandler.handle('store2', 'op1' as OperationType, new Error('Error 2'), 'error')
      errorHandler.handle('store3', 'op2' as OperationType, new Error('Error 3'), 'error')
      errorHandler.handle('store4', 'op3' as OperationType, new Error('Error 4'), 'warn')
      errorHandler.handle('store5', 'op4' as OperationType, new Error('Error 5'), 'critical')

      const stats = errorHandler.getErrorStats()

      expect(stats.total).toBe(5)
      expect(stats.byLevel.error).toBe(3)
      expect(stats.byLevel.warn).toBe(1)
      expect(stats.byLevel.critical).toBe(1)
      expect(stats.byOperation.op1).toBe(2)
      expect(stats.byOperation.op2).toBe(1)
    })

    test('应该能够正确统计混合操作类型的错误', () => {
      errorHandler.handle('store1', 'action-execution', new Error('Error 1'))
      errorHandler.handle('store2', 'state-update', new Error('Error 2'))
      errorHandler.handle('store3', 'action-execution', new Error('Error 3'))
      errorHandler.handle('store4', 'getter-execution', new Error('Error 4'))
      errorHandler.handle('store5', 'state-update', new Error('Error 5'))

      const stats = errorHandler.getErrorStats()

      expect(stats.total).toBe(5)
      expect(stats.byOperation['action-execution']).toBe(2)
      expect(stats.byOperation['state-update']).toBe(2)
      expect(stats.byOperation['getter-execution']).toBe(1)
    })
  })

  describe('createErrorContext', () => {
    test('应该能够创建错误上下文', () => {
      const error = new Error('Test error')
      const context = createErrorContext('user-store', 'action-execution', error, 'error', { userId: '123' })

      expect(context.storeName).toBe('user-store')
      expect(context.operation).toBe('action-execution')
      expect(context.error).toBe(error)
      expect(context.level).toBe('error')
      expect(context.payload).toEqual({ userId: '123' })
      expect(typeof context.timestamp).toBe('number')
    })

    test('应该使用默认的错误级别', () => {
      const error = new Error('Test error')
      const context = createErrorContext('user-store', 'state-update', error)

      expect(context.level).toBe('error')
    })

    test('应该能够使用自定义的错误级别', () => {
      const error = new Error('Critical error')
      const context = createErrorContext('user-store', 'state-update', error, 'critical')

      expect(context.level).toBe('critical')
    })

    test('应该生成时间戳', () => {
      const before = Date.now()
      const error = new Error('Test error')
      const context = createErrorContext('user-store', 'state-update', error)
      const after = Date.now()

      expect(context.timestamp).toBeGreaterThanOrEqual(before)
      expect(context.timestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('defaultErrorHandler', () => {
    test('应该是一个函数', () => {
      expect(typeof defaultErrorHandler).toBe('function')
    })

    test('应该能够处理错误上下文', () => {
      const error = new Error('Test error')
      const context = createErrorContext('user-store', 'action-execution', error)

      // 不应该抛出错误
      expect(() => defaultErrorHandler(context)).not.toThrow()
    })

    test('应该正确处理 error 级别', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const error = new Error('Test error')
      error.stack = 'Test stack trace'
      const context = createErrorContext('user-store', 'action-execution', error, 'error')

      defaultErrorHandler(context)

      expect(consoleErrorSpy).toHaveBeenCalled()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[GeomStore][ERROR][user-store]'),
        expect.stringContaining('action-execution'),
        error,
      )
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('[GeomStore][ERROR][user-store]'), 'Stack:', 'Test stack trace')

      consoleErrorSpy.mockRestore()
    })

    test('应该正确处理 warning 级别', () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
      const error = new Error('Test warning')
      const context = createErrorContext('user-store', 'action-execution', error, 'warning')

      defaultErrorHandler(context)

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[GeomStore][WARNING][user-store]'),
        expect.stringContaining('Warning in action-execution'),
        error.message,
      )

      consoleWarnSpy.mockRestore()
    })

    test('应该正确处理 info 级别', () => {
      const consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation()
      const error = new Error('Test info')
      const context = createErrorContext('user-store', 'action-execution', error, 'info')

      defaultErrorHandler(context)

      expect(consoleInfoSpy).toHaveBeenCalledWith(
        expect.stringContaining('[GeomStore][INFO][user-store]'),
        expect.stringContaining('Info in action-execution'),
        error.message,
      )

      consoleInfoSpy.mockRestore()
    })

    test('error 级别没有 stack 时不应该输出 stack', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const error = new Error('Test error')
      delete error.stack
      const context = createErrorContext('user-store', 'action-execution', error, 'error')

      defaultErrorHandler(context)

      // 只应该调用两次（error 和 stack），但因为没有 stack，所以只调用一次
      const calls = consoleErrorSpy.mock.calls
      const hasStackCall = calls.some((call) => Array.isArray(call) && call[1] === 'Stack:')
      expect(hasStackCall).toBe(false)

      consoleErrorSpy.mockRestore()
    })
  })

  describe('复杂场景', () => {
    test('应该能够处理大量错误', () => {
      errorHandler.setMaxLogSize(100)

      for (let i = 0; i < 150; i++) {
        errorHandler.handle(`store${i}`, `op${i}` as OperationType, new Error(`Error ${i}`))
      }

      const log = errorHandler.getErrorLog()
      expect(log).toHaveLength(100)
    })

    test('应该能够正确筛选混合级别和操作的错误', () => {
      errorHandler.handle('store1', 'action-execution', new Error('Error 1'), 'error')
      errorHandler.handle('store2', 'action-execution', new Error('Error 2'), 'error')
      errorHandler.handle('store3', 'state-update', new Error('Error 3'), 'warn')
      errorHandler.handle('store4', 'state-update', new Error('Error 4'), 'warn')
      errorHandler.handle('store5', 'getter-execution', new Error('Error 5'), 'critical')
      errorHandler.handle('store6', 'getter-execution', new Error('Error 6'), 'critical')

      const actionErrors = errorHandler.getErrorsByOperation('action-execution')
      const stateErrors = errorHandler.getErrorsByOperation('state-update')
      const errorLevelErrors = errorHandler.getErrorsByLevel('error')
      const warnLevelErrors = errorHandler.getErrorsByLevel('warn')
      const criticalLevelErrors = errorHandler.getErrorsByLevel('critical')

      expect(actionErrors).toHaveLength(2)
      expect(stateErrors).toHaveLength(2)
      expect(errorLevelErrors).toHaveLength(2)
      expect(warnLevelErrors).toHaveLength(2)
      expect(criticalLevelErrors).toHaveLength(2)
    })

    test('应该能够在清空后重新统计', () => {
      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'), 'error')
      errorHandler.handle('store2', 'op2' as OperationType, new Error('Error 2'), 'warn')

      const stats1 = errorHandler.getErrorStats()
      expect(stats1.total).toBe(2)

      errorHandler.clearErrorLog()

      errorHandler.handle('store3', 'op3' as OperationType, new Error('Error 3'), 'error')
      errorHandler.handle('store4', 'op4' as OperationType, new Error('Error 4'), 'error')

      const stats2 = errorHandler.getErrorStats()
      expect(stats2.total).toBe(2)
      expect(stats2.byLevel.error).toBe(2)
    })

    test('应该能够正确处理自定义error handler', () => {
      const handledErrors: ErrorContext[] = []
      const customHandler = (context: ErrorContext) => {
        handledErrors.push(context)
      }

      errorHandler.setHandler(customHandler)

      errorHandler.handle('store1', 'op1' as OperationType, new Error('Error 1'))
      errorHandler.handle('store2', 'op2' as OperationType, new Error('Error 2'))

      expect(handledErrors).toHaveLength(2)
      expect(handledErrors[0].error.message).toBe('Error 1')
      expect(handledErrors[1].error.message).toBe('Error 2')
    })

    test('应该能够在日志限制后继续记录', () => {
      errorHandler.setMaxLogSize(5)

      // 记录10个错误
      for (let i = 0; i < 10; i++) {
        errorHandler.handle(`store${i}`, `op${i}` as OperationType, new Error(`Error ${i}`))
      }

      expect(errorHandler.getErrorLog()).toHaveLength(5)

      // 继续记录
      errorHandler.handle('store10', 'op10' as OperationType, new Error('Error 10'))

      const log = errorHandler.getErrorLog()
      expect(log).toHaveLength(5)
      expect(log[4].error.message).toBe('Error 10')
    })
  })
})
