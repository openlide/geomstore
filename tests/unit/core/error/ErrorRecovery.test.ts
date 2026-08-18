/**
 * GeomStore v1.0 - ErrorRecovery����
 *
 * ���Ը��ǣ�
 * - ����ָ���������
 * - ���Ի���
 * - ���˲���
 * - ���Բ���
 * - �ָ�����
 * - ��������
 */

import { ErrorRecovery, RecoveryStrategy, createDefaultErrorRecovery, defaultErrorRecovery, createError, ErrorCode, GeomStoreError } from '@/index'

describe('ErrorRecovery', () => {
  let recovery: ErrorRecovery

  beforeEach(() => {
    recovery = new ErrorRecovery()
    jest.useFakeTimers()
  })

  afterEach(() => {
    recovery.clearAllRetryCounts()
    jest.useRealTimers()
  })

  describe('��������', () => {
    it('RECOVERY-001: Ӧ�ô���ErrorRecoveryʵ��', () => {
      expect(recovery).toBeDefined()
      expect(recovery).toBeInstanceOf(ErrorRecovery)
    })

    it('RECOVERY-002: Ӧ�û�ȡ�յ�����', () => {
      const config = recovery.getConfig('ACTION_NOT_FOUND')
      expect(config).toBeUndefined()
    })

    it('RECOVERY-003: Ӧ�����ûָ�����', () => {
      const strategy: RecoveryStrategy = RecoveryStrategy.IGNORE
      recovery.configure({
        [ErrorCode.ACTION_NOT_FOUND]: {
          strategy,
        },
      })

      const config = recovery.getConfig(ErrorCode.ACTION_NOT_FOUND)
      expect(config).toBeDefined()
      expect(config?.strategy).toBe(strategy)
    })
  })

  describe('IGNORE ����', () => {
    it('RECOVERY-004: Ӧ�ú��Դ���', async () => {
      recovery.configure({
        [ErrorCode.ACTION_NOT_FOUND]: {
          strategy: RecoveryStrategy.IGNORE,
        },
      })

      const error = createError(ErrorCode.ACTION_NOT_FOUND, 'Action not found')
      const result = await recovery.recover(error)
      expect(result).toEqual({ ignored: true })
    })
  })

  describe('FALLBACK ����', () => {
    it('RECOVERY-005: Ӧ��ʹ�ûص�������Ϊ����', async () => {
      const fallbackFn = jest.fn().mockReturnValue('fallback value')
      recovery.configure({
        [ErrorCode.ACTION_NOT_FOUND]: {
          strategy: RecoveryStrategy.FALLBACK,
          fallbackFn,
        },
      })

      const error = createError(ErrorCode.ACTION_NOT_FOUND, 'Action not found')
      const result = await recovery.recover(error)
      expect(fallbackFn).toHaveBeenCalledWith(error)
      expect(result).toBe('fallback value')
    })

    it('RECOVERY-010: Ӧ��ʹ�þ�ֵ̬��Ϊ����', async () => {
      recovery.configure({
        [ErrorCode.STATE_KEY_NOT_FOUND]: {
          strategy: RecoveryStrategy.FALLBACK,
          fallback: { value: 'default' },
        },
      })

      const error = createError(ErrorCode.STATE_KEY_NOT_FOUND, 'Key not found')
      const result = await recovery.recover(error)
      expect(result).toEqual({ value: 'default' })
    })

    it('RECOVERY-011: û�����û���ֵ����ʱӦ���׳�����', async () => {
      recovery.configure({
        [ErrorCode.VALIDATION_ERROR]: {
          strategy: RecoveryStrategy.FALLBACK,
        },
      })

      const error = createError(ErrorCode.VALIDATION_ERROR, 'Validation failed')
      await expect(recovery.recover(error)).rejects.toThrow('[ErrorRecovery] No fallback value or function configured')
    })
  })

  describe('RETRY ����', () => {
    it('RECOVERY-006: Ӧ���������Բ���', () => {
      recovery.configure({
        [ErrorCode.ACTION_EXECUTION_ERROR]: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 3,
          retryDelay: 100,
        },
      })

      const config = recovery.getConfig(ErrorCode.ACTION_EXECUTION_ERROR)
      expect(config).toBeDefined()
      expect(config?.strategy).toBe(RecoveryStrategy.RETRY)
      expect(config?.maxRetries).toBe(3)
      expect(config?.retryDelay).toBe(100)
    })

    it('RECOVERY-012: Ӧ��ִ�����Բ��׳�����', async () => {
      const onRetry = jest.fn()
      recovery.configure({
        [ErrorCode.ACTION_TIMEOUT]: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 3,
          retryDelay: 100,
          exponentialBackoff: false,
          onRetry,
        },
      })

      const error = createError(ErrorCode.ACTION_TIMEOUT, 'Timeout')
      const promise = recovery.recover(error)

      // ���ʱ��
      jest.advanceTimersByTime(200)

      await expect(promise).rejects.toBe(error)
      expect(onRetry).toHaveBeenCalledWith(error, 1)
    })

    it('RECOVERY-013: Ӧ��ʹ��ָ���˱�', async () => {
      const onRetry = jest.fn()
      recovery.configure({
        [ErrorCode.ACTION_TIMEOUT]: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 3,
          retryDelay: 100,
          exponentialBackoff: true,
          onRetry,
        },
      })

      const error = createError(ErrorCode.ACTION_TIMEOUT, 'Timeout')
      const promise = recovery.recover(error)

      // ָ���˱�: 100 * 2^0 = 100ms
      jest.advanceTimersByTime(150)

      await expect(promise).rejects.toBe(error)
    })

    it('RECOVERY-014: Ӧ���ڳ���������Դ������׳�����', async () => {
      recovery.configure({
        [ErrorCode.ACTION_TIMEOUT]: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 2,
          retryDelay: 10,
          exponentialBackoff: false,
        },
      })

      const error = createError(ErrorCode.ACTION_TIMEOUT, 'Timeout')

      // ��һ������
      const promise1 = recovery.recover(error)
      jest.advanceTimersByTime(50)
      await expect(promise1).rejects.toBe(error)

      // �ڶ�������
      const promise2 = recovery.recover(error)
      jest.advanceTimersByTime(50)
      await expect(promise2).rejects.toBe(error)

      // ������Ӧ�ó�������
      const promise3 = recovery.recover(error)
      jest.advanceTimersByTime(50)
      await expect(promise3).rejects.toThrow('[ErrorRecovery] Max retries (2) exceeded')
    })

    it('RECOVERY-015: onRetry�ص�����ʱӦ�ò���', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const onRetry = jest.fn(() => {
        throw new Error('Callback error')
      })

      recovery.configure({
        [ErrorCode.ACTION_TIMEOUT]: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 3,
          retryDelay: 100,
          onRetry,
        },
      })

      const error = createError(ErrorCode.ACTION_TIMEOUT, 'Timeout')
      const promise = recovery.recover(error)

      jest.advanceTimersByTime(200)

      await expect(promise).rejects.toBe(error)
      expect(consoleErrorSpy).toHaveBeenCalledWith('[ErrorRecovery] Error in onRetry callback:', expect.any(Error))

      consoleErrorSpy.mockRestore()
    })

    it('RECOVERY-016: Ӧ��ʹ��Ĭ�ϵ���������', async () => {
      recovery.configure({
        [ErrorCode.ACTION_TIMEOUT]: {
          strategy: RecoveryStrategy.RETRY,
          // ������ maxRetries, retryDelay, exponentialBackoff
        },
      })

      const config = recovery.getConfig(ErrorCode.ACTION_TIMEOUT)
      expect(config?.maxRetries).toBe(3)
      expect(config?.retryDelay).toBe(1000)
      expect(config?.exponentialBackoff).toBe(true)
    })
  })

  describe('RECOVER ����', () => {
    it('RECOVERY-017: Ӧ��ִ�лָ�����', async () => {
      const recoverFn = jest.fn().mockResolvedValue('recovered')
      recovery.configure({
        [ErrorCode.STATE_UPDATE_ERROR]: {
          strategy: RecoveryStrategy.RECOVER,
          recoverFn,
        },
      })

      const error = createError(ErrorCode.STATE_UPDATE_ERROR, 'Update failed')
      const result = await recovery.recover(error)
      expect(recoverFn).toHaveBeenCalledWith(error)
      expect(result).toBe('recovered')
    })

    it('RECOVERY-018: û�����ûָ�����ʱӦ���׳�����', async () => {
      recovery.configure({
        [ErrorCode.STATE_UPDATE_ERROR]: {
          strategy: RecoveryStrategy.RECOVER,
        },
      })

      const error = createError(ErrorCode.STATE_UPDATE_ERROR, 'Update failed')
      await expect(recovery.recover(error)).rejects.toThrow('[ErrorRecovery] No recover function configured')
    })
  })

  describe('RESTART ����', () => {
    it('RECOVERY-019: Ӧ�÷��� undefined ��ʾ��Ҫ����', async () => {
      recovery.configure({
        [ErrorCode.STORE_COMPOSE_ERROR]: {
          strategy: RecoveryStrategy.RESTART,
        },
      })

      const error = createError(ErrorCode.STORE_COMPOSE_ERROR, 'Compose failed')
      const result = await recovery.recover(error)
      expect(result).toBeUndefined()
    })
  })

  describe('δ֪����', () => {
    it('RECOVERY-020: δ֪����Ӧ���׳�����', async () => {
      recovery.configure({
        [ErrorCode.UNKNOWN_ERROR]: {
          strategy: 'unknown' as any,
        },
      })

      const error = createError(ErrorCode.UNKNOWN_ERROR, 'Unknown')
      await expect(recovery.recover(error)).rejects.toThrow('[ErrorRecovery] Unknown recovery strategy')
    })
  })

  describe('shouldRecover ����', () => {
    it('RECOVERY-021: shouldRecover ���� false ʱӦ���׳�����', async () => {
      recovery.configure({
        [ErrorCode.ACTION_NOT_FOUND]: {
          strategy: RecoveryStrategy.IGNORE,
          shouldRecover: () => false,
        },
      })

      const error = createError(ErrorCode.ACTION_NOT_FOUND, 'Action not found')
      await expect(recovery.recover(error)).rejects.toBe(error)
    })

    it('RECOVERY-022: shouldRecover ���� true ʱӦ�������ָ�', async () => {
      recovery.configure({
        [ErrorCode.ACTION_NOT_FOUND]: {
          strategy: RecoveryStrategy.IGNORE,
          shouldRecover: () => true,
        },
      })

      const error = createError(ErrorCode.ACTION_NOT_FOUND, 'Action not found')
      const result = await recovery.recover(error)
      expect(result).toEqual({ ignored: true })
    })
  })

  describe('�ص�����', () => {
    it('RECOVERY-023: �ָ��ɹ�ʱӦ�õ��� onRecovery �ص�', async () => {
      const onRecovery = jest.fn()
      recovery.configure({
        [ErrorCode.ACTION_NOT_FOUND]: {
          strategy: RecoveryStrategy.IGNORE,
          onRecovery,
        },
      })

      const error = createError(ErrorCode.ACTION_NOT_FOUND, 'Action not found')
      await recovery.recover(error)
      expect(onRecovery).toHaveBeenCalledWith(error, { ignored: true })
    })

    it('RECOVERY-024: onRecovery �ص�����ʱӦ�ò���', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const onRecovery = jest.fn(() => {
        throw new Error('Recovery callback error')
      })

      recovery.configure({
        [ErrorCode.ACTION_NOT_FOUND]: {
          strategy: RecoveryStrategy.IGNORE,
          onRecovery,
        },
      })

      const error = createError(ErrorCode.ACTION_NOT_FOUND, 'Action not found')
      const result = await recovery.recover(error)
      expect(result).toEqual({ ignored: true })
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })

    it('RECOVERY-025: �ָ�ʧ��ʱӦ�õ��� onRecoveryFailed �ص�', async () => {
      const onRecoveryFailed = jest.fn()
      recovery.configure({
        [ErrorCode.STATE_KEY_NOT_FOUND]: {
          strategy: RecoveryStrategy.FALLBACK,
          onRecoveryFailed,
        },
      })

      const error = createError(ErrorCode.STATE_KEY_NOT_FOUND, 'Key not found')
      await expect(recovery.recover(error)).rejects.toThrow()
      expect(onRecoveryFailed).toHaveBeenCalledWith(error, expect.any(Error))
    })

    it('RECOVERY-026: onRecoveryFailed �ص�����ʱӦ�ò���', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const onRecoveryFailed = jest.fn(() => {
        throw new Error('Recovery failed callback error')
      })

      recovery.configure({
        [ErrorCode.STATE_KEY_NOT_FOUND]: {
          strategy: RecoveryStrategy.FALLBACK,
          onRecoveryFailed,
        },
      })

      const error = createError(ErrorCode.STATE_KEY_NOT_FOUND, 'Key not found')
      await expect(recovery.recover(error)).rejects.toThrow()
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
    })
  })

  describe('����������֤', () => {
    it('RECOVERY-027: �� GeomStoreError Ӧ���׳�����', async () => {
      const normalError = new Error('Normal error')
      await expect(recovery.recover(normalError)).rejects.toThrow('[ErrorRecovery] Can only recover GeomStoreError instances')
    })
  })

  describe('Ĭ��ʵ��', () => {
    it('RECOVERY-007: Ӧ���ṩĬ��ʵ��', () => {
      expect(defaultErrorRecovery).toBeDefined()
      expect(defaultErrorRecovery).toBeInstanceOf(ErrorRecovery)
    })

    it('RECOVERY-008: Ӧ�ô���Ĭ�����õ�ʵ��', () => {
      const instance = createDefaultErrorRecovery()
      expect(instance).toBeDefined()
      expect(instance).toBeInstanceOf(ErrorRecovery)
    })

    it('RECOVERY-028: createDefaultErrorRecovery Ӧ��Ӧ���Զ������', () => {
      const instance = createDefaultErrorRecovery({
        [ErrorCode.ACTION_TIMEOUT]: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 5,
        },
      })

      const config = instance.getConfig(ErrorCode.ACTION_TIMEOUT)
      expect(config?.maxRetries).toBe(5)
    })
  })

  describe('������', () => {
    it('RECOVERY-009: Ӧ�ô���δ���õĴ�����', async () => {
      const error = createError(ErrorCode.STATE_KEY_NOT_FOUND, 'Key not found')
      // δ���ô�����ʱ���׳�����
      await expect(recovery.recover(error)).rejects.toThrow()
    })
  })

  describe('clearAllRetryCounts', () => {
    it('RECOVERY-029: Ӧ������������Լ���', async () => {
      recovery.configure({
        [ErrorCode.ACTION_TIMEOUT]: {
          strategy: RecoveryStrategy.RETRY,
          maxRetries: 5,
          retryDelay: 10,
          exponentialBackoff: false,
        },
      })

      const error = createError(ErrorCode.ACTION_TIMEOUT, 'Timeout')

      // ��һ������
      const promise1 = recovery.recover(error)
      jest.advanceTimersByTime(50)
      await expect(promise1).rejects.toBe(error)

      // ������Լ���
      recovery.clearAllRetryCounts()

      // �ٴ�����Ӧ�ô� 0 ��ʼ
      const promise2 = recovery.recover(error)
      jest.advanceTimersByTime(50)
      await expect(promise2).rejects.toBe(error)
    })
  })

  describe('�������ĵĻָ�', () => {
    it('RECOVERY-030: Ӧ�ô��ݻָ�������', async () => {
      const recoverFn = jest.fn().mockResolvedValue('recovered')
      recovery.configure({
        [ErrorCode.STATE_UPDATE_ERROR]: {
          strategy: RecoveryStrategy.RECOVER,
          recoverFn,
        },
      })

      const error = createError(ErrorCode.STATE_UPDATE_ERROR, 'Update failed', {
        storeName: 'test-store',
        operation: 'update',
      })

      await recovery.recover(error, {
        storeName: 'custom-store',
        operation: 'custom-op',
      })

      expect(recoverFn).toHaveBeenCalledWith(error)
    })
  })

  describe('FALLBACK �������ȼ�', () => {
    it('RECOVERY-031: fallbackFn Ӧ�������� fallback', async () => {
      const fallbackFn = jest.fn().mockReturnValue('from function')
      recovery.configure({
        [ErrorCode.ACTION_NOT_FOUND]: {
          strategy: RecoveryStrategy.FALLBACK,
          fallback: 'static value',
          fallbackFn,
        },
      })

      const error = createError(ErrorCode.ACTION_NOT_FOUND, 'Action not found')
      const result = await recovery.recover(error)
      expect(result).toBe('from function')
      expect(fallbackFn).toHaveBeenCalled()
    })
  })

  describe('clearRetryCount exact match (BUG-F8)', () => {
    it('RECOVERY-F8-001: clearing one error code must not clear counts of prefix-sibling codes', () => {
      // 修复前用 startsWith(errorCode) 前缀匹配：当一个错误码是另一个的前缀
      // （如 'AUTH' 与 'AUTH_FAILED'）时，清除前者会连带误清后者的重试计数
      const internal = recovery as any

      internal.incrementRetryCount('AUTH:store:op')
      internal.incrementRetryCount('AUTH:store:op')
      internal.incrementRetryCount('AUTH_FAILED:store:op')

      internal.clearRetryCount('AUTH')

      // AUTH 的计数被精确清除
      expect(internal.getRetryCount('AUTH:store:op')).toBe(0)
      // AUTH_FAILED 的计数不受影响
      expect(internal.getRetryCount('AUTH_FAILED:store:op')).toBe(1)

      internal.clearRetryCount('AUTH_FAILED')
      expect(internal.getRetryCount('AUTH_FAILED:store:op')).toBe(0)
    })

    it('RECOVERY-F8-002: after AUTH exhausts retries, AUTH_FAILED quota must remain', async () => {
      // 行为级验证：AUTH 达到最大重试次数触发清零后，AUTH_FAILED 仍能重试
      recovery.configure({
        AUTH: { strategy: RecoveryStrategy.RETRY, maxRetries: 1, retryDelay: 10, exponentialBackoff: false },
        AUTH_FAILED: { strategy: RecoveryStrategy.RETRY, maxRetries: 3, retryDelay: 10, exponentialBackoff: false },
      } as any)

      const errorAuth = createError('AUTH' as any, 'auth failed')
      const errorAuthFailed = createError('AUTH_FAILED' as any, 'auth failed twice')

      // AUTH 第一次重试（计数 0 < 1）
      const p1 = recovery.recover(errorAuth)
      jest.advanceTimersByTime(50)
      await expect(p1).rejects.toBe(errorAuth)
      // AUTH 第二次：达到上限，清计数并抛“超出最大重试次数”
      await expect(recovery.recover(errorAuth)).rejects.toThrow('Max retries (1) exceeded')

      // AUTH_FAILED 不受 AUTH 清零影响，仍可重试（不抛 Max retries）
      const p2 = recovery.recover(errorAuthFailed)
      jest.advanceTimersByTime(50)
      await expect(p2).rejects.toBe(errorAuthFailed)
    })
  })
})
