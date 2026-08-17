/**
 * GeomStore v1.0 - GeomStoreError测试
 * 
 * 测试覆盖：
 * - 自定义错误类创建和使用
 * - 错误代码枚举
 * - 类型守卫函数
 * - 错误序列化
 * - 错误消息格式化
 */

import {
  GeomStoreError,
  ActionError,
  StateError,
  SelectorError,
  PluginError,
  ComposeError,
  ValidationError,
  ErrorCode,
  isGeomStoreError,
  isActionError,
  isStateError,
  isSelectorError,
  isPluginError,
  isValidationError,
  createError
} from '@/index'

describe('GeomStoreError', () => {
  describe('错误类创建', () => {
    it('ERROR-001: 应该创建基础GeomStoreError实例', () => {
      const error = new GeomStoreError(
        'Test error message',
        ErrorCode.UNKNOWN_ERROR,
        { key: 'value' }
      )

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(GeomStoreError)
      expect(error.name).toBe('GeomStoreError')
      expect(error.message).toBe('Test error message')
      expect(error.code).toBe(ErrorCode.UNKNOWN_ERROR)
      expect(error.context).toEqual({ key: 'value' })
      expect(error.stack).toBeDefined()
    })

    it('ERROR-002: 应该创建ActionError实例', () => {
      const error = new ActionError(
        'Action failed',
        ErrorCode.ACTION_EXECUTION_ERROR,
        { actionName: 'testAction' }
      )

      expect(error).toBeInstanceOf(GeomStoreError)
      expect(error).toBeInstanceOf(ActionError)
      expect(error.name).toBe('ActionError')
      expect(error.code).toBe(ErrorCode.ACTION_EXECUTION_ERROR)
    })

    it('ERROR-003: 应该创建StateError实例', () => {
      const error = new StateError(
        'State update failed',
        ErrorCode.STATE_UPDATE_ERROR,
        { key: 'user' }
      )

      expect(error).toBeInstanceOf(StateError)
      expect(error.name).toBe('StateError')
      expect(error.code).toBe(ErrorCode.STATE_UPDATE_ERROR)
    })

    it('ERROR-004: 应该创建SelectorError实例', () => {
      const error = new SelectorError(
        'Selector not found',
        ErrorCode.SELECTOR_NOT_FOUND,
        { selectorName: 'testSelector' }
      )

      expect(error).toBeInstanceOf(SelectorError)
      expect(error.name).toBe('SelectorError')
    })

    it('ERROR-005: 应该创建PluginError实例', () => {
      const error = new PluginError(
        'Plugin installation failed',
        ErrorCode.PLUGIN_INSTALLATION_ERROR,
        { pluginName: 'testPlugin' }
      )

      expect(error).toBeInstanceOf(PluginError)
      expect(error.name).toBe('PluginError')
    })

    it('ERROR-006: 应该创建ComposeError实例', () => {
      const error = new ComposeError(
        'Store name conflict',
        ErrorCode.STORE_NAME_CONFLICT,
        { storeName: 'testStore' }
      )

      expect(error).toBeInstanceOf(ComposeError)
      expect(error.name).toBe('ComposeError')
    })

    it('ERROR-007: 应该创建ValidationError实例', () => {
      const error = new ValidationError(
        'Validation failed',
        ErrorCode.VALIDATION_ERROR,
        { field: 'email' }
      )

      expect(error).toBeInstanceOf(ValidationError)
      expect(error.name).toBe('ValidationError')
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })
  })

  describe('错误序列化', () => {
    it('ERROR-008: toJSON应该返回完整的错误信息', () => {
      const error = new GeomStoreError(
        'Test error',
        ErrorCode.ACTION_NOT_FOUND,
        { actionName: 'missingAction' }
      )

      const json = error.toJSON()

      expect(json).toEqual({
        name: 'GeomStoreError',
        message: 'Test error',
        code: ErrorCode.ACTION_NOT_FOUND,
        context: { actionName: 'missingAction' },
        stack: expect.any(String)
      })
    })

    it('ERROR-009: toJSON应该处理没有context的错误', () => {
      const error = new GeomStoreError(
        'Test error',
        ErrorCode.UNKNOWN_ERROR
      )

      const json = error.toJSON()

      expect(json.name).toBe('GeomStoreError')
      expect(json.message).toBe('Test error')
      expect(json.code).toBe(ErrorCode.UNKNOWN_ERROR)
      expect(json.context).toBeUndefined()
    })
  })

  describe('错误消息格式化', () => {
    it('ERROR-010: getFriendlyMessage应该返回基本消息', () => {
      const error = new GeomStoreError(
        'Basic error',
        ErrorCode.UNKNOWN_ERROR
      )

      const friendlyMsg = error.getFriendlyMessage()
      expect(friendlyMsg).toBe('Basic error')
    })

    it('ERROR-011: getFriendlyMessage应该包含storeName和operation', () => {
      const error = new GeomStoreError(
        'Operation failed',
        ErrorCode.ACTION_EXECUTION_ERROR,
        { storeName: 'user-store', operation: 'login' }
      )

      const friendlyMsg = error.getFriendlyMessage()
      expect(friendlyMsg).toBe('Operation failed in store \'user-store\': login')
    })

    it('ERROR-012: getFriendlyMessage应该只包含storeName', () => {
      const error = new GeomStoreError(
        'Error occurred',
        ErrorCode.STATE_UPDATE_ERROR,
        { storeName: 'cart-store' }
      )

      const friendlyMsg = error.getFriendlyMessage()
      expect(friendlyMsg).toContain('cart-store')
      expect(friendlyMsg).toBe('Error occurred in store \'cart-store\'')
    })

    it('ERROR-034: getFriendlyMessage应该只包含operation', () => {
      const error = new GeomStoreError(
        'Action error',
        ErrorCode.ACTION_EXECUTION_ERROR,
        { operation: 'fetchData' }
      )

      const friendlyMsg = error.getFriendlyMessage()
      expect(friendlyMsg).toBe('Action error: fetchData')
    })
  })

  describe('错误工厂函数', () => {
    it('ERROR-013: createError应该创建ActionError', () => {
      const error = createError(
        ErrorCode.ACTION_NOT_FOUND,
        'Action missing',
        { actionName: 'test' }
      )

      expect(error).toBeInstanceOf(ActionError)
      expect(error.code).toBe(ErrorCode.ACTION_NOT_FOUND)
    })

    it('ERROR-014: createError应该创建StateError', () => {
      const error = createError(
        ErrorCode.STATE_KEY_NOT_FOUND,
        'State key missing',
        { key: 'user' }
      )

      expect(error).toBeInstanceOf(StateError)
      expect(error.code).toBe(ErrorCode.STATE_KEY_NOT_FOUND)
    })

    it('ERROR-015: createError应该创建SelectorError', () => {
      const error = createError(
        ErrorCode.SELECTOR_EXECUTION_ERROR,
        'Selector failed'
      )

      expect(error).toBeInstanceOf(SelectorError)
    })

    it('ERROR-016: createError应该创建PluginError', () => {
      const error = createError(
        ErrorCode.PLUGIN_INSTALLATION_ERROR,
        'Plugin failed'
      )

      expect(error).toBeInstanceOf(PluginError)
    })

    it('ERROR-017: createError应该创建ValidationError', () => {
      const error = createError(
        ErrorCode.VALIDATION_ERROR,
        'Validation failed'
      )

      expect(error).toBeInstanceOf(ValidationError)
    })

    it('ERROR-017a: createError应该创建ComposeError (STORE_NAME_CONFLICT)', () => {
      const error = createError(
        ErrorCode.STORE_NAME_CONFLICT,
        'Store name conflict',
        { storeName: 'testStore' }
      )

      expect(error).toBeInstanceOf(ComposeError)
      expect(error.code).toBe(ErrorCode.STORE_NAME_CONFLICT)
    })

    it('ERROR-017b: createError应该创建ComposeError (STORE_DEPENDENCY_ERROR)', () => {
      const error = createError(
        ErrorCode.STORE_DEPENDENCY_ERROR,
        'Store dependency error'
      )

      expect(error).toBeInstanceOf(ComposeError)
      expect(error.code).toBe(ErrorCode.STORE_DEPENDENCY_ERROR)
    })

    it('ERROR-017c: createError应该创建ComposeError (STORE_COMPOSE_ERROR)', () => {
      const error = createError(
        ErrorCode.STORE_COMPOSE_ERROR,
        'Store compose error'
      )

      expect(error).toBeInstanceOf(ComposeError)
      expect(error.code).toBe(ErrorCode.STORE_COMPOSE_ERROR)
    })

    it('ERROR-018: createError应该为未知代码创建GeomStoreError', () => {
      const error = createError(
        'UNKNOWN_CODE' as any,
        'Unknown error'
      )

      expect(error).toBeInstanceOf(GeomStoreError)
    })
  })

  describe('类型守卫函数', () => {
    it('ERROR-019: isGeomStoreError应该正确识别GeomStoreError', () => {
      const error = new GeomStoreError('Test', ErrorCode.UNKNOWN_ERROR)
      const normalError = new Error('Normal error')

      expect(isGeomStoreError(error)).toBe(true)
      expect(isGeomStoreError(normalError)).toBe(false)
      expect(isGeomStoreError(null)).toBe(false)
      expect(isGeomStoreError(undefined)).toBe(false)
      expect(isGeomStoreError({})).toBe(false)
    })

    it('ERROR-020: isActionError应该正确识别ActionError', () => {
      const actionError = new ActionError('Test', ErrorCode.ACTION_EXECUTION_ERROR)
      const stateError = new StateError('Test', ErrorCode.STATE_UPDATE_ERROR)

      expect(isActionError(actionError)).toBe(true)
      expect(isActionError(stateError)).toBe(false)
    })

    it('ERROR-021: isStateError应该正确识别StateError', () => {
      const stateError = new StateError('Test', ErrorCode.STATE_UPDATE_ERROR)
      const actionError = new ActionError('Test', ErrorCode.ACTION_EXECUTION_ERROR)

      expect(isStateError(stateError)).toBe(true)
      expect(isStateError(actionError)).toBe(false)
    })

    it('ERROR-022: isSelectorError应该正确识别SelectorError', () => {
      const selectorError = new SelectorError('Test', ErrorCode.SELECTOR_NOT_FOUND)
      const stateError = new StateError('Test', ErrorCode.STATE_UPDATE_ERROR)

      expect(isSelectorError(selectorError)).toBe(true)
      expect(isSelectorError(stateError)).toBe(false)
    })

    it('ERROR-023: isPluginError应该正确识别PluginError', () => {
      const pluginError = new PluginError('Test', ErrorCode.PLUGIN_INSTALLATION_ERROR)
      const actionError = new ActionError('Test', ErrorCode.ACTION_EXECUTION_ERROR)

      expect(isPluginError(pluginError)).toBe(true)
      expect(isPluginError(actionError)).toBe(false)
    })

    it('ERROR-024: isValidationError应该正确识别ValidationError', () => {
      const validationError = new ValidationError('Test', ErrorCode.VALIDATION_ERROR)
      const stateError = new StateError('Test', ErrorCode.STATE_UPDATE_ERROR)

      expect(isValidationError(validationError)).toBe(true)
      expect(isValidationError(stateError)).toBe(false)
    })
  })

  describe('错误代码枚举', () => {
    it('ERROR-025: 应该定义所有Action错误代码', () => {
      expect(ErrorCode.ACTION_NOT_FOUND).toBe('ACTION_NOT_FOUND')
      expect(ErrorCode.ACTION_EXECUTION_ERROR).toBe('ACTION_EXECUTION_ERROR')
      expect(ErrorCode.ACTION_TIMEOUT).toBe('ACTION_TIMEOUT')
      expect(ErrorCode.ACTION_CANCELLED).toBe('ACTION_CANCELLED')
    })

    it('ERROR-026: 应该定义所有State错误代码', () => {
      expect(ErrorCode.STATE_KEY_NOT_FOUND).toBe('STATE_KEY_NOT_FOUND')
      expect(ErrorCode.STATE_UPDATE_ERROR).toBe('STATE_UPDATE_ERROR')
      expect(ErrorCode.STATE_TYPE_ERROR).toBe('STATE_TYPE_ERROR')
    })

    it('ERROR-027: 应该定义所有Selector错误代码', () => {
      expect(ErrorCode.SELECTOR_NOT_FOUND).toBe('SELECTOR_NOT_FOUND')
      expect(ErrorCode.SELECTOR_EXECUTION_ERROR).toBe('SELECTOR_EXECUTION_ERROR')
      expect(ErrorCode.SELECTOR_CACHE_ERROR).toBe('SELECTOR_CACHE_ERROR')
    })

    it('ERROR-028: 应该定义所有Plugin错误代码', () => {
      expect(ErrorCode.PLUGIN_NOT_FOUND).toBe('PLUGIN_NOT_FOUND')
      expect(ErrorCode.PLUGIN_INSTALLATION_ERROR).toBe('PLUGIN_INSTALLATION_ERROR')
      expect(ErrorCode.PLUGIN_EXECUTION_ERROR).toBe('PLUGIN_EXECUTION_ERROR')
    })

    it('ERROR-029: 应该定义所有验证错误代码', () => {
      expect(ErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR')
      expect(ErrorCode.TYPE_ERROR).toBe('TYPE_ERROR')
      expect(ErrorCode.PARAMETER_ERROR).toBe('PARAMETER_ERROR')
    })
  })

  describe('边界情况', () => {
    it('ERROR-030: 应该处理空消息', () => {
      const error = new GeomStoreError('', ErrorCode.UNKNOWN_ERROR)
      expect(error.message).toBe('')
    })

    it('ERROR-031: 应该处理undefined context', () => {
      const error = new GeomStoreError('Test', ErrorCode.UNKNOWN_ERROR, undefined)
      expect(error.context).toBeUndefined()
    })

    it('ERROR-032: 应该处理空的context', () => {
      const error = new GeomStoreError('Test', ErrorCode.UNKNOWN_ERROR, {})
      expect(error.context).toEqual({})
    })

    it('ERROR-033: 应该处理嵌套的context', () => {
      const nestedContext = {
        level1: {
          level2: {
            level3: 'deep value'
          }
        },
        array: [1, 2, 3]
      }
      const error = new GeomStoreError('Test', ErrorCode.UNKNOWN_ERROR, nestedContext)
      expect(error.context).toEqual(nestedContext)
    })
  })
})
