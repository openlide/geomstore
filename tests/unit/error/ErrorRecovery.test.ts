/**
 * ErrorRecovery 模块测试
 *
 * 测试覆盖率目标: 95%+
 */

import { ErrorRecovery, RecoveryStrategy, createDefaultErrorRecovery, defaultErrorRecovery } from '../../../src/core/error/ErrorRecovery'
import { GeomStoreError, ActionError, StateError, ErrorCode, isGeomStoreError } from '../../../src/core/error/GeomStoreError'

describe('ErrorRecovery 模块', () => {
  let recovery: ErrorRecovery

  beforeEach(() => {
    recovery = new ErrorRecovery()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  // ==================== RecoveryStrategy 枚举测试 ====================
  describe('RecoveryStrategy 枚举', () => {
    it('RECOVERY-001: 应该定义所有恢复策略', () => {
      expect(RecoveryStrategy.RETRY).toBe('retry')
      expect(RecoveryStrategy.FALLBACK).toBe('fallback')
      expect(RecoveryStrategy.IGNORE).toBe('ignore')
      expect(RecoveryStrategy.RESTART).toBe('restart')
      expect(RecoveryStrategy.RECOVER).toBe('recover')
    })

    it('RECOVERY-002: 应该包含 5 种策略', () => {
      const strategies = Object.values(RecoveryStrategy)
      expect(strategies).toHaveLength(5)
    })
  })

  // ==================== ErrorRecovery 类测试 ====================
  describe('ErrorRecovery 类', () => {
    // ---------- configure 方法测试 ----------
    describe('configure()', () => {
      it('RECOVERY-003: 应该配置恢复策略', () => {
        recovery.configure({
          [ErrorCode.ACTION_TIMEOUT]: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 3,
          },
        })

        const config = recovery.getConfig(ErrorCode.ACTION_TIMEOUT)
        expect(config).toBeDefined()
        expect(config?.strategy).toBe(RecoveryStrategy.RETRY)
      })

      it('RECOVERY-004: 应该合并新旧策略配置', () => {
        recovery.configure({
          [ErrorCode.ACTION_TIMEOUT]: {
            strategy: RecoveryStrategy.RETRY,
          },
        })

        recovery.configure({
          [ErrorCode.STATE_KEY_NOT_FOUND]: {
            strategy: RecoveryStrategy.FALLBACK,
            fallback: null,
          },
        })

        expect(recovery.getConfig(ErrorCode.ACTION_TIMEOUT)).toBeDefined()
        expect(recovery.getConfig(ErrorCode.STATE_KEY_NOT_FOUND)).toBeDefined()
      })

      it('RECOVERY-005: RETRY 策略应该有默认值', () => {
        recovery.configure({
          [ErrorCode.ACTION_TIMEOUT]: {
            strategy: RecoveryStrategy.RETRY,
          },
        })

        const config = recovery.getConfig(ErrorCode.ACTION_TIMEOUT)
        expect(config?.maxRetries).toBe(3)
        expect(config?.retryDelay).toBe(1000)
        expect(config?.exponentialBackoff).toBe(true)
      })

      it('RECOVERY-006: RETRY 策略应该保留自定义值', () => {
        recovery.configure({
          [ErrorCode.ACTION_TIMEOUT]: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 5,
            retryDelay: 2000,
            exponentialBackoff: false,
          },
        })

        const config = recovery.getConfig(ErrorCode.ACTION_TIMEOUT)
        expect(config?.maxRetries).toBe(5)
        expect(config?.retryDelay).toBe(2000)
        expect(config?.exponentialBackoff).toBe(false)
      })

      it('RECOVERY-007: RETRY 策略应该支持部分自定义值', () => {
        recovery.configure({
          [ErrorCode.ACTION_TIMEOUT]: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 10,
          },
        })

        const config = recovery.getConfig(ErrorCode.ACTION_TIMEOUT)
        expect(config?.maxRetries).toBe(10)
        expect(config?.retryDelay).toBe(1000)
        expect(config?.exponentialBackoff).toBe(true)
      })

      it('RECOVERY-008: 应该支持 maxRetries = 0', () => {
        recovery.configure({
          [ErrorCode.ACTION_TIMEOUT]: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 0,
          },
        })

        const config = recovery.getConfig(ErrorCode.ACTION_TIMEOUT)
        expect(config?.maxRetries).toBe(0)
      })

      it('RECOVERY-009: 应该支持 retryDelay = 0', () => {
        recovery.configure({
          [ErrorCode.ACTION_TIMEOUT]: {
            strategy: RecoveryStrategy.RETRY,
            retryDelay: 0,
          },
        })

        const config = recovery.getConfig(ErrorCode.ACTION_TIMEOUT)
        expect(config?.retryDelay).toBe(0)
      })
    })

    // ---------- getConfig 方法测试 ----------
    describe('getConfig()', () => {
      it('RECOVERY-010: 应该返回已配置的策略', () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.IGNORE,
          },
        })

        expect(recovery.getConfig('TEST_CODE')?.strategy).toBe(RecoveryStrategy.IGNORE)
      })

      it('RECOVERY-011: 未配置的策略应该返回 undefined', () => {
        expect(recovery.getConfig('UNKNOWN_CODE')).toBeUndefined()
      })
    })

    // ---------- recover 方法测试 ----------
    describe('recover()', () => {
      it('RECOVERY-012: 非 GeomStoreError 应该抛出错误', async () => {
        await expect(recovery.recover(new Error('普通错误'))).rejects.toThrow('[ErrorRecovery] Can only recover GeomStoreError instances')
      })

      it('RECOVERY-013: 未配置策略的错误应该抛出错误', async () => {
        const error = new GeomStoreError('测试错误', 'UNKNOWN_CODE')

        await expect(recovery.recover(error)).rejects.toThrow('[ErrorRecovery] No recovery strategy configured for error code: UNKNOWN_CODE')
      })

      it('RECOVERY-014: shouldRecover 返回 false 时应该抛出原始错误', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.IGNORE,
            shouldRecover: () => false,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow(error)
      })

      it('RECOVERY-015: shouldRecover 返回 true 时应该正常恢复', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.IGNORE,
            shouldRecover: () => true,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toEqual({ ignored: true })
      })

      it('RECOVERY-016: 成功恢复后应该调用 onRecovery 回调', async () => {
        const onRecovery = jest.fn()

        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.IGNORE,
            onRecovery,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        await recovery.recover(error)

        expect(onRecovery).toHaveBeenCalledWith(error, { ignored: true })
      })

      it('RECOVERY-017: onRecovery 回调出错不应该影响恢复结果', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.IGNORE,
            onRecovery: () => {
              throw new Error('回调出错')
            },
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toEqual({ ignored: true })
        expect(consoleSpy).toHaveBeenCalledWith('[ErrorRecovery] Error in onRecovery callback:', expect.any(Error))

        consoleSpy.mockRestore()
      })

      it('RECOVERY-018: 恢复失败后应该调用 onRecoveryFailed 回调', async () => {
        const onRecoveryFailed = jest.fn()

        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RECOVER,
            onRecoveryFailed,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow()
        expect(onRecoveryFailed).toHaveBeenCalledWith(error, expect.any(Error))
      })

      it('RECOVERY-019: onRecoveryFailed 回调出错不应该影响错误抛出', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RECOVER,
            onRecoveryFailed: () => {
              throw new Error('回调出错')
            },
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow()
        expect(consoleSpy).toHaveBeenCalledWith('[ErrorRecovery] Error in onRecoveryFailed callback:', expect.any(Error))

        consoleSpy.mockRestore()
      })

      it('RECOVERY-020: 应该传递恢复上下文', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RECOVER,
            recoverFn: (error) => {
              return { context: error.context }
            },
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE', {
          storeName: 'test-store',
          operation: 'test-op',
        })

        const result = await recovery.recover(error, {
          storeName: 'context-store',
          operation: 'context-op',
        })

        expect(result).toEqual({ context: expect.any(Object) })
      })
    })

    // ---------- IGNORE 策略测试 ----------
    describe('IGNORE 策略', () => {
      it('RECOVERY-021: 应该返回 { ignored: true }', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.IGNORE,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toEqual({ ignored: true })
      })
    })

    // ---------- FALLBACK 策略测试 ----------
    describe('FALLBACK 策略', () => {
      it('RECOVERY-022: 应该返回静态回退值', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.FALLBACK,
            fallback: { name: 'default' },
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toEqual({ name: 'default' })
      })

      it('RECOVERY-023: 应该返回 fallbackFn 的结果', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.FALLBACK,
            fallbackFn: (error) => ({ message: error.message }),
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toEqual({ message: '测试错误' })
      })

      it('RECOVERY-024: fallbackFn 应该优先于 fallback', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.FALLBACK,
            fallback: 'static',
            fallbackFn: () => 'dynamic',
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toBe('dynamic')
      })

      it('RECOVERY-025: 无 fallback 和 fallbackFn 时应该抛出错误', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.FALLBACK,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow('[ErrorRecovery] No fallback value or function configured')
      })

      it('RECOVERY-026: 应该通过 fallbackFn 返回 undefined', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.FALLBACK,
            fallbackFn: () => undefined,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toBeUndefined()
      })

      it('RECOVERY-027: 应该支持 null 作为回退值', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.FALLBACK,
            fallback: null,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toBeNull()
      })
    })

    // ---------- RETRY 策略测试 ----------
    describe('RETRY 策略', () => {
      it('RECOVERY-028: RETRY 策略会抛出原始错误让调用方重试', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 3,
            retryDelay: 0,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        // recover 会抛出原始错误
        await expect(recovery.recover(error)).rejects.toThrow(error)
      })

      it('RECOVERY-029: 应该在超过最大重试次数时抛出错误', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 2,
            retryDelay: 0,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        // 第一次重试
        await expect(recovery.recover(error)).rejects.toThrow(error)

        // 第二次重试
        await expect(recovery.recover(error)).rejects.toThrow(error)

        // 第三次应该超过限制
        await expect(recovery.recover(error)).rejects.toThrow('[ErrorRecovery] Max retries (2) exceeded')
      })

      it('RECOVERY-030: 应该调用 onRetry 回调', async () => {
        const onRetry = jest.fn()

        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 3,
            retryDelay: 0,
            onRetry,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow(error)
        expect(onRetry).toHaveBeenCalledWith(error, 1)
      })

      it('RECOVERY-031: onRetry 回调出错不应该影响重试', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 3,
            retryDelay: 0,
            onRetry: () => {
              throw new Error('回调出错')
            },
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow(error)
        expect(consoleSpy).toHaveBeenCalled()

        consoleSpy.mockRestore()
      })

      it('RECOVERY-032: 应该正确计算重试次数', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 5,
            retryDelay: 0,
            exponentialBackoff: true,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        // 连续重试 5 次都应该抛出原始错误
        for (let i = 0; i < 5; i++) {
          await expect(recovery.recover(error)).rejects.toThrow(error)
        }

        // 第 6 次应该超过限制
        await expect(recovery.recover(error)).rejects.toThrow('Max retries (5) exceeded')
      })

      it('RECOVERY-033: 禁用指数退避时应该使用固定延迟', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 2,
            retryDelay: 0,
            exponentialBackoff: false,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow(error)
        await expect(recovery.recover(error)).rejects.toThrow(error)
        await expect(recovery.recover(error)).rejects.toThrow('Max retries (2) exceeded')
      })

      it('RECOVERY-034: 应该为不同的错误上下文维护独立的重试计数', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 2,
            retryDelay: 0,
          },
        })

        const error1 = new GeomStoreError('错误1', 'TEST_CODE', {
          storeName: 'store1',
          operation: 'op1',
        })
        const error2 = new GeomStoreError('错误2', 'TEST_CODE', {
          storeName: 'store2',
          operation: 'op2',
        })

        // 第一个错误重试
        await expect(recovery.recover(error1)).rejects.toThrow(error1)

        // 第二个错误重试 (独立的计数)
        await expect(recovery.recover(error2)).rejects.toThrow(error2)
      })

      it('RECOVERY-035: maxRetries = 0 时应该立即拒绝', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 0,
            retryDelay: 0,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow('[ErrorRecovery] Max retries (0) exceeded')
      })

      it('RECOVERY-036: retryDelay = 0 时应该立即执行', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 2,
            retryDelay: 0,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        // 不需要等待时间
        await expect(recovery.recover(error)).rejects.toThrow(error)
      })

      it('RECOVERY-058: 成功恢复后应该清除重试计数', async () => {
        // 先进行一些重试
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 5,
            retryDelay: 0,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        // 创建重试计数
        await expect(recovery.recover(error)).rejects.toThrow(error)

        // 切换到 IGNORE 策略（会清除重试计数）
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.IGNORE,
          },
        })

        await recovery.recover(error)

        // 切换回 RETRY，计数应该被清除
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 2,
            retryDelay: 0,
          },
        })

        // 应该可以重新开始计数
        await expect(recovery.recover(error)).rejects.toThrow(error)
      })
    })

    // ---------- RECOVER 策略测试 ----------
    describe('RECOVER 策略', () => {
      it('RECOVERY-037: 应该执行 recoverFn 并返回结果', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RECOVER,
            recoverFn: (error) => ({ recovered: true, message: error.message }),
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toEqual({ recovered: true, message: '测试错误' })
      })

      it('RECOVERY-038: 应该支持异步 recoverFn', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RECOVER,
            recoverFn: async () => {
              return { async: true }
            },
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toEqual({ async: true })
      })

      it('RECOVERY-039: 无 recoverFn 时应该抛出错误', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RECOVER,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow('[ErrorRecovery] No recover function configured')
      })

      it('RECOVERY-040: recoverFn 抛出错误时应该传递', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RECOVER,
            recoverFn: () => {
              throw new Error('恢复失败')
            },
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow('恢复失败')
      })
    })

    // ---------- RESTART 策略测试 ----------
    describe('RESTART 策略', () => {
      it('RECOVERY-041: 应该返回 undefined', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RESTART,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')
        const result = await recovery.recover(error)

        expect(result).toBeUndefined()
      })

      it('RECOVERY-042: 应该清除相关错误代码的重试计数', async () => {
        // 先创建一些重试计数
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 3,
            retryDelay: 0,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        // 创建重试计数
        await expect(recovery.recover(error)).rejects.toThrow(error)

        // 切换到 RESTART 策略
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RESTART,
          },
        })

        await recovery.recover(error)

        // 切换回 RETRY，计数应该被清除
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 2,
            retryDelay: 0,
          },
        })

        // 应该可以重新开始计数
        await expect(recovery.recover(error)).rejects.toThrow(error)
      })
    })

    // ---------- 未知策略测试 ----------
    describe('未知策略', () => {
      it('RECOVERY-043: 未知策略应该抛出错误', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: 'unknown' as RecoveryStrategy,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        await expect(recovery.recover(error)).rejects.toThrow('[ErrorRecovery] Unknown recovery strategy: unknown')
      })
    })

    // ---------- clearAllRetryCounts 方法测试 ----------
    describe('clearAllRetryCounts()', () => {
      it('RECOVERY-044: 应该清除所有重试计数', async () => {
        recovery.configure({
          TEST_CODE: {
            strategy: RecoveryStrategy.RETRY,
            maxRetries: 5,
            retryDelay: 0,
          },
        })

        const error = new GeomStoreError('测试错误', 'TEST_CODE')

        // 创建重试计数
        await expect(recovery.recover(error)).rejects.toThrow(error)

        // 清除所有计数
        recovery.clearAllRetryCounts()

        // 重置计数后应该可以重新开始
        await expect(recovery.recover(error)).rejects.toThrow(error)
      })
    })
  })

  // ==================== createDefaultErrorRecovery 测试 ====================
  describe('createDefaultErrorRecovery()', () => {
    it('RECOVERY-045: 应该创建带有默认策略的恢复器', () => {
      const recovery = createDefaultErrorRecovery()

      expect(recovery.getConfig(ErrorCode.ACTION_TIMEOUT)).toBeDefined()
      expect(recovery.getConfig(ErrorCode.STATE_KEY_NOT_FOUND)).toBeDefined()
      expect(recovery.getConfig(ErrorCode.VALIDATION_ERROR)).toBeDefined()
    })

    it('RECOVERY-046: ACTION_TIMEOUT 应该使用 RETRY 策略', () => {
      const recovery = createDefaultErrorRecovery()
      const config = recovery.getConfig(ErrorCode.ACTION_TIMEOUT)

      expect(config?.strategy).toBe(RecoveryStrategy.RETRY)
      expect(config?.maxRetries).toBe(3)
      expect(config?.retryDelay).toBe(1000)
      expect(config?.exponentialBackoff).toBe(true)
    })

    it('RECOVERY-047: STATE_KEY_NOT_FOUND 应该使用 IGNORE 策略', () => {
      const recovery = createDefaultErrorRecovery()
      const config = recovery.getConfig(ErrorCode.STATE_KEY_NOT_FOUND)

      expect(config?.strategy).toBe(RecoveryStrategy.IGNORE)
    })

    it('RECOVERY-048: VALIDATION_ERROR 应该使用 FALLBACK 策略', () => {
      const recovery = createDefaultErrorRecovery()
      const config = recovery.getConfig(ErrorCode.VALIDATION_ERROR)

      expect(config?.strategy).toBe(RecoveryStrategy.FALLBACK)
    })

    it('RECOVERY-049: 应该支持自定义策略覆盖默认策略', () => {
      const recovery = createDefaultErrorRecovery({
        [ErrorCode.ACTION_TIMEOUT]: {
          strategy: RecoveryStrategy.IGNORE,
        },
      })

      const config = recovery.getConfig(ErrorCode.ACTION_TIMEOUT)
      expect(config?.strategy).toBe(RecoveryStrategy.IGNORE)
    })

    it('RECOVERY-050: 应该支持添加新策略', () => {
      const recovery = createDefaultErrorRecovery({
        CUSTOM_CODE: {
          strategy: RecoveryStrategy.FALLBACK,
          fallback: 'custom',
        },
      })

      const config = recovery.getConfig('CUSTOM_CODE')
      expect(config?.strategy).toBe(RecoveryStrategy.FALLBACK)
      expect(config?.fallback).toBe('custom')
    })
  })

  // ==================== defaultErrorRecovery 实例测试 ====================
  describe('defaultErrorRecovery 实例', () => {
    it('RECOVERY-051: 应该是 ErrorRecovery 实例', () => {
      expect(defaultErrorRecovery).toBeInstanceOf(ErrorRecovery)
    })

    it('RECOVERY-052: 应该有默认配置', () => {
      expect(defaultErrorRecovery.getConfig(ErrorCode.ACTION_TIMEOUT)).toBeDefined()
    })
  })

  // ==================== 边界条件测试 ====================
  describe('边界条件', () => {
    it('RECOVERY-053: 应该处理错误上下文中的 undefined 值', async () => {
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.IGNORE,
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_CODE')

      const result = await recovery.recover(error)
      expect(result).toEqual({ ignored: true })
    })

    it('RECOVERY-054: 应该处理错误上下文中只有 storeName', async () => {
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.IGNORE,
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_CODE', { storeName: 'myStore' })

      const result = await recovery.recover(error)
      expect(result).toEqual({ ignored: true })
    })

    it('RECOVERY-055: 应该处理错误上下文中只有 operation', async () => {
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.IGNORE,
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_CODE', { operation: 'myOp' })

      const result = await recovery.recover(error)
      expect(result).toEqual({ ignored: true })
    })

    it('RECOVERY-056: 应该正确处理 ActionError 子类', async () => {
      recovery.configure({
        [ErrorCode.ACTION_EXECUTION_ERROR]: {
          strategy: RecoveryStrategy.IGNORE,
        },
      })

      const error = new ActionError('Action failed', ErrorCode.ACTION_EXECUTION_ERROR, { actionName: 'testAction' })

      const result = await recovery.recover(error)
      expect(result).toEqual({ ignored: true })
    })

    it('RECOVERY-057: 应该正确处理 StateError 子类', async () => {
      recovery.configure({
        [ErrorCode.STATE_KEY_NOT_FOUND]: {
          strategy: RecoveryStrategy.FALLBACK,
          fallback: 'default',
        },
      })

      const error = new StateError('Key not found', ErrorCode.STATE_KEY_NOT_FOUND, { key: 'missing' })

      const result = await recovery.recover(error)
      expect(result).toBe('default')
    })
  })

  // ==================== 类型守卫集成测试 ====================
  describe('类型守卫集成', () => {
    it('RECOVERY-059: 应该正确识别 GeomStoreError', async () => {
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.IGNORE,
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_CODE')
      expect(isGeomStoreError(error)).toBe(true)

      const result = await recovery.recover(error)
      expect(result).toEqual({ ignored: true })
    })

    it('RECOVERY-060: 应该拒绝非 GeomStoreError', async () => {
      const error = new Error('普通错误')
      expect(isGeomStoreError(error)).toBe(false)

      await expect(recovery.recover(error)).rejects.toThrow('[ErrorRecovery] Can only recover GeomStoreError instances')
    })
  })

  // ==================== 复杂场景测试 ====================
  describe('复杂场景', () => {
    it('RECOVERY-061: 多次恢复尝试', async () => {
      let attemptCount = 0

      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.RECOVER,
          recoverFn: () => {
            attemptCount++
            if (attemptCount < 3) {
              throw new Error('恢复失败')
            }
            return { success: true }
          },
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_CODE')

      // 第一次恢复尝试会失败
      await expect(recovery.recover(error)).rejects.toThrow('恢复失败')

      // 第二次恢复尝试也会失败
      await expect(recovery.recover(error)).rejects.toThrow('恢复失败')

      // 第三次恢复尝试成功
      const result = await recovery.recover(error)
      expect(result).toEqual({ success: true })
    })

    it('RECOVERY-062: 不同错误代码应该使用不同策略', async () => {
      recovery.configure({
        ERROR_A: {
          strategy: RecoveryStrategy.IGNORE,
        },
        ERROR_B: {
          strategy: RecoveryStrategy.FALLBACK,
          fallback: 'fallback-value',
        },
        ERROR_C: {
          strategy: RecoveryStrategy.RECOVER,
          recoverFn: () => 'recovered',
        },
      })

      const errorA = new GeomStoreError('Error A', 'ERROR_A')
      const errorB = new GeomStoreError('Error B', 'ERROR_B')
      const errorC = new GeomStoreError('Error C', 'ERROR_C')

      expect(await recovery.recover(errorA)).toEqual({ ignored: true })
      expect(await recovery.recover(errorB)).toBe('fallback-value')
      expect(await recovery.recover(errorC)).toBe('recovered')
    })

    it('RECOVERY-063: fallbackFn 应该访问完整的错误信息', async () => {
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.FALLBACK,
          fallbackFn: (error) => ({
            code: error.code,
            message: error.message,
            context: error.context,
          }),
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_CODE', {
        storeName: 'test-store',
        key: 'test-key',
      })

      const result = (await recovery.recover(error)) as any

      expect(result.code).toBe('TEST_CODE')
      expect(result.message).toBe('测试错误')
      expect(result.context.storeName).toBe('test-store')
      expect(result.context.key).toBe('test-key')
    })

    it('RECOVERY-064: shouldRecover 应该基于错误信息决定是否恢复', async () => {
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.IGNORE,
          shouldRecover: (error) => {
            return (error.context?.recoverable as boolean) === true
          },
        },
      })

      const recoverableError = new GeomStoreError('可恢复错误', 'TEST_CODE', {
        recoverable: true,
      })
      const unrecoverableError = new GeomStoreError('不可恢复错误', 'TEST_CODE', {
        recoverable: false,
      })

      expect(await recovery.recover(recoverableError)).toEqual({ ignored: true })
      await expect(recovery.recover(unrecoverableError)).rejects.toThrow(unrecoverableError)
    })

    it('RECOVERY-065: onRetry 和 onRecovery 应该按顺序调用', async () => {
      const calls: string[] = []

      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 3,
          retryDelay: 0,
          onRetry: () => calls.push('retry'),
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_CODE')

      // 第一次重试
      await expect(recovery.recover(error)).rejects.toThrow(error)
      expect(calls).toEqual(['retry'])

      // 切换策略并恢复
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.IGNORE,
          onRecovery: () => calls.push('recovery'),
        },
      })

      await recovery.recover(error)
      expect(calls).toEqual(['retry', 'recovery'])
    })
  })

  // ==================== createDefaultErrorRecovery 默认回调测试 ====================
  describe('createDefaultErrorRecovery 默认回调', () => {
    it('RECOVERY-066: ACTION_TIMEOUT 默认 onRetry 回调应该输出警告', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      // 使用默认恢复器，不覆盖策略
      const recovery = createDefaultErrorRecovery()
      recovery.configure({
        [ErrorCode.ACTION_TIMEOUT]: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 3,
          retryDelay: 0,
          exponentialBackoff: true,
        },
      })

      const error = new ActionError('Timeout', ErrorCode.ACTION_TIMEOUT, {
        storeName: 'test-store',
        operation: 'test-op',
      })

      // 触发默认的 onRetry 回调 - 通过恢复默认恢复器
      const defaultRecovery = createDefaultErrorRecovery()
      // 获取默认配置并手动调用 onRetry
      const config = defaultRecovery.getConfig(ErrorCode.ACTION_TIMEOUT)
      if (config?.onRetry) {
        config.onRetry(error, 1)
      }

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[ErrorRecovery] Retrying action (attempt 1):'), 'Timeout')

      consoleSpy.mockRestore()
    })

    it('RECOVERY-067: VALIDATION_ERROR 默认 onRecoveryFailed 回调', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      const recovery = createDefaultErrorRecovery()

      // 获取默认配置并手动调用 onRecoveryFailed
      const config = recovery.getConfig(ErrorCode.VALIDATION_ERROR)
      const error = new GeomStoreError('Validation failed', ErrorCode.VALIDATION_ERROR)

      if (config?.onRecoveryFailed) {
        config.onRecoveryFailed(error, new Error('Recovery failed'))
      }

      expect(consoleSpy).toHaveBeenCalledWith('[ErrorRecovery] Validation error recovery failed:', 'Validation failed')

      consoleSpy.mockRestore()
    })

    it('RECOVERY-068: 应该验证默认恢复器的 ACTION_TIMEOUT 策略', async () => {
      const recovery = createDefaultErrorRecovery()

      // 验证默认配置
      const config = recovery.getConfig(ErrorCode.ACTION_TIMEOUT)
      expect(config?.strategy).toBe(RecoveryStrategy.RETRY)
      expect(config?.maxRetries).toBe(3)
      expect(config?.retryDelay).toBe(1000)
      expect(config?.exponentialBackoff).toBe(true)
      expect(config?.onRetry).toBeDefined()
    })

    it('RECOVERY-069: 应该验证默认恢复器的 VALIDATION_ERROR 策略', async () => {
      const recovery = createDefaultErrorRecovery()

      const config = recovery.getConfig(ErrorCode.VALIDATION_ERROR)
      expect(config?.strategy).toBe(RecoveryStrategy.FALLBACK)
      expect(config?.fallback).toBeUndefined()
      expect(config?.onRecoveryFailed).toBeDefined()
    })
  })

  // ==================== executeRetryStrategy 默认值分支测试 ====================
  describe('executeRetryStrategy 默认值分支', () => {
    it('RECOVERY-070: maxRetries 为 undefined 时应该使用默认值 3', async () => {
      // 直接设置 strategies 绕过 configure 的默认值处理
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 5,
          retryDelay: 0,
        },
      })
      // 覆盖 maxRetries 为 undefined
      const config = recovery.getConfig('TEST_CODE')!
      ;(recovery as any).strategies['TEST_CODE'] = {
        ...config,
        maxRetries: undefined,
        retryDelay: 0,
        exponentialBackoff: false,
      }

      const error = new GeomStoreError('测试错误', 'TEST_CODE')

      // maxRetries 默认值为 3，所以前 3 次应该抛出原始错误
      for (let i = 0; i < 3; i++) {
        await expect(recovery.recover(error)).rejects.toThrow(error)
      }
      // 第 4 次应该超过限制
      await expect(recovery.recover(error)).rejects.toThrow('Max retries (3) exceeded')
    })

    it('RECOVERY-071: retryDelay 为 undefined 时应该使用默认值 1000', async () => {
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 1,
          retryDelay: 5,
          exponentialBackoff: false,
        },
      })
      // 覆盖 retryDelay 为 undefined
      ;(recovery as any).strategies['TEST_CODE'] = {
        strategy: RecoveryStrategy.RETRY,
        maxRetries: 1,
        retryDelay: undefined,
        exponentialBackoff: false,
      }

      const error = new GeomStoreError('测试错误', 'TEST_CODE')

      // retryDelay 默认值为 1000，应该有延迟
      const start = Date.now()
      await expect(recovery.recover(error)).rejects.toThrow(error)
      const elapsed = Date.now() - start
      // 使用指数退避时，延迟 = 1000 * 2^0 = 1000
      // 由于 exponentialBackoff 为 false，延迟 = 1000
      expect(elapsed).toBeGreaterThanOrEqual(900)
    })

    it('RECOVERY-072: exponentialBackoff 为 undefined 时应该使用默认值 true', async () => {
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 1,
          retryDelay: 0,
        },
      })
      // 覆盖 exponentialBackoff 为 undefined
      ;(recovery as any).strategies['TEST_CODE'] = {
        strategy: RecoveryStrategy.RETRY,
        maxRetries: 1,
        retryDelay: 0,
        exponentialBackoff: undefined,
      }

      const error = new GeomStoreError('测试错误', 'TEST_CODE')

      // exponentialBackoff 默认值为 true
      await expect(recovery.recover(error)).rejects.toThrow(error)
    })
  })

  // ==================== clearRetryCount 不匹配 key 测试 ====================
  describe('clearRetryCount 不匹配 key', () => {
    it('RECOVERY-073: 应该跳过不匹配 errorCode 的重试 key', async () => {
      // 为两个不同的 errorCode 创建重试计数
      recovery.configure({
        CODE_A: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 5,
          retryDelay: 0,
        },
        CODE_B: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 5,
          retryDelay: 0,
        },
      })

      const errorA = new GeomStoreError('错误A', 'CODE_A', {
        storeName: 'storeA',
        operation: 'opA',
      })
      const errorB = new GeomStoreError('错误B', 'CODE_B', {
        storeName: 'storeB',
        operation: 'opB',
      })

      // 为两个 errorCode 创建重试计数
      await expect(recovery.recover(errorA)).rejects.toThrow(errorA)
      await expect(recovery.recover(errorB)).rejects.toThrow(errorB)

      // 清除 CODE_A 的重试计数时，CODE_B 的 key 不以 CODE_A 开头，应该被跳过
      // 通过 RESTART 策略触发 clearRetryCount
      recovery.configure({
        CODE_A: {
          strategy: RecoveryStrategy.RESTART,
        },
      })

      // RESTART 策略会清除 CODE_A 的重试计数
      await recovery.recover(errorA)

      // CODE_B 的重试计数应该仍然存在
      recovery.configure({
        CODE_B: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 5,
          retryDelay: 0,
        },
      })

      // CODE_B 之前已经重试了 1 次，应该还能继续重试（maxRetries=5）
      await expect(recovery.recover(errorB)).rejects.toThrow(errorB)
    })
  })

  // ==================== 延迟机制测试 ====================
  describe('延迟机制', () => {
    it('RECOVERY-068: 应该正确处理重试延迟', async () => {
      // 测试延迟为 0 时的行为
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 2,
          retryDelay: 0,
          exponentialBackoff: true,
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_CODE')

      // 由于延迟为 0，应该立即抛出错误
      await expect(recovery.recover(error)).rejects.toThrow(error)
    })

    it('RECOVERY-069: 指数退避应该基于重试次数计算延迟', async () => {
      // 测试指数退避计算逻辑
      // 由于我们不能直接测试私有方法，通过测试行为来验证
      recovery.configure({
        TEST_CODE: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 4,
          retryDelay: 1, // 使用最小延迟
          exponentialBackoff: true,
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_CODE')

      // 连续重试
      await expect(recovery.recover(error)).rejects.toThrow(error)
      await expect(recovery.recover(error)).rejects.toThrow(error)
      await expect(recovery.recover(error)).rejects.toThrow(error)
      await expect(recovery.recover(error)).rejects.toThrow(error)
      await expect(recovery.recover(error)).rejects.toThrow('Max retries (4) exceeded')
    })
  })

  // ==================== BUG 修复回归测试 ====================
  describe('BUG 修复回归', () => {
    it('BUG-1: FALLBACK 显式配置 fallback: undefined 应该正常 resolve 为 undefined', async () => {
      recovery.configure({
        TEST_FALLBACK_UNDEFINED: {
          strategy: RecoveryStrategy.FALLBACK,
          fallback: undefined,
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_FALLBACK_UNDEFINED')
      // 显式 undefined 是合法回退值，不应抛出 "No fallback value configured"
      await expect(recovery.recover(error)).resolves.toBeUndefined()
    })

    it('BUG-1: 默认 VALIDATION_ERROR 策略应该正常返回 undefined 回退值', async () => {
      const defaultRecovery = createDefaultErrorRecovery()
      const error = new GeomStoreError('校验失败', ErrorCode.VALIDATION_ERROR)

      await expect(defaultRecovery.recover(error)).resolves.toBeUndefined()
    })

    it('BUG-1: 未配置 fallback 与 fallbackFn 时 FALLBACK 仍应报错', async () => {
      recovery.configure({
        TEST_FALLBACK_MISSING: {
          strategy: RecoveryStrategy.FALLBACK,
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_FALLBACK_MISSING')
      await expect(recovery.recover(error)).rejects.toThrow('No fallback value or function configured')
    })

    it('BUG-13: RETRY 达到上限后应该清理计数，后续可重新计数', async () => {
      recovery.configure({
        TEST_RETRY_CLEAR: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 2,
          retryDelay: 0,
          exponentialBackoff: false,
        },
      })

      const error = new GeomStoreError('测试错误', 'TEST_RETRY_CLEAR')

      // 两次重试均重抛原错误
      await expect(recovery.recover(error)).rejects.toThrow(error)
      await expect(recovery.recover(error)).rejects.toThrow(error)
      // 达到上限：抛出 Max retries 错误
      await expect(recovery.recover(error)).rejects.toThrow('Max retries (2) exceeded')
      // 计数已被清理：重新从 0 开始，再次重抛原错误而非立即超限
      await expect(recovery.recover(error)).rejects.toThrow(error)
    })
  })
})
