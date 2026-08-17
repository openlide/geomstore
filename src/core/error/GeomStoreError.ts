/**
 * GeomStore v1.0 - 自定义错误类体系
 *
 * 提供完整的错误类型定义，包括：
 * - 基础错误类
 * - 特定领域的错误类型
 * - 错误上下文信息
 */

/**
 * GeomStore基础错误类
 *
 * @class GeomStoreError
 * @description
 * 所有GeomStore错误的基础类，提供统一的错误格式和上下文信息。
 * 包含错误代码、上下文数据和完整的堆栈跟踪。
 *
 * @example
 * ```typescript
 * const error = new GeomStoreError(
 *   'State update failed',
 *   'STATE_UPDATE_ERROR',
 *   {
 *     storeName: 'user-store',
 *     key: 'user',
 *     value: { name: 'Alice' }
 *   }
 * )
 *
 * console.log(error.message)    // 'State update failed'
 * console.log(error.code)        // 'STATE_UPDATE_ERROR'
 * console.log(error.context)     // { storeName: 'user-store', ... }
 * console.log(error.toJSON())   // 序列化的错误信息
 * ```
 */
export class GeomStoreError extends Error {
  /**
   * 错误代码，用于错误分类和识别
   * @type {string}
   */
  readonly code: string

  /**
   * 错误上下文信息，包含相关的状态和元数据
   * @type {Record<string, unknown> | undefined}
   */
  readonly context?: Record<string, unknown>

  /**
   * 创建GeomStore错误实例
   *
   * @param {string} message - 错误消息
   * @param {string} code - 错误代码
   * @param {Record<string, unknown>} [context] - 错误上下文
   *
   * @example
   * ```typescript
   * throw new GeomStoreError(
   *   'Action not found',
   *   'ACTION_NOT_FOUND',
   *   { actionName: 'missingAction', storeName: 'test-store' }
   * )
   * ```
   */
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message)
    this.name = 'GeomStoreError'
    this.code = code
    this.context = context

    // 确保正确的原型链
    Object.setPrototypeOf(this, GeomStoreError.prototype)
  }

  /**
   * 将错误对象转换为JSON格式
   *
   * @returns {Record<string, unknown>} 序列化的错误信息
   *
   * @example
   * ```typescript
   * const error = new GeomStoreError('Error', 'CODE', { key: 'value' })
   * const json = error.toJSON()
   * // {
   * //   name: 'GeomStoreError',
   * //   message: 'Error',
   * //   code: 'CODE',
   * //   context: { key: 'value' },
   * //   stack: '...'
   * // }
   * ```
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      context: this.context,
      stack: this.stack,
    }
  }

  /**
   * 获取用户友好的错误消息
   *
   * @returns {string} 格式化的错误消息
   *
   * @example
   * ```typescript
   * const error = new GeomStoreError(
   *   'Action failed',
   *   'ACTION_ERROR',
   *   { actionName: 'save', storeName: 'user-store' }
   * )
   * console.log(error.getFriendlyMessage())
   * // "Action failed in store 'user-store': save"
   * ```
   */
  getFriendlyMessage(): string {
    const storeName = this.context?.storeName as string
    const operation = this.context?.operation as string

    if (storeName && operation) {
      return `${this.message} in store '${storeName}': ${operation}`
    }

    if (storeName) {
      return `${this.message} in store '${storeName}'`
    }

    if (operation) {
      return `${this.message}: ${operation}`
    }

    return this.message
  }
}

/**
 * Action相关错误
 *
 * @class ActionError
 * @extends GeomStoreError
 * @description
 * 表示Action执行过程中发生的错误，包括：
 * - Action不存在
 * - Action执行失败
 * - Action参数错误
 *
 * @example
 * ```typescript
 * throw new ActionError(
 *   'Action "fetchData" failed: Network timeout',
 *   'ACTION_EXECUTION_ERROR',
 *   {
 *     actionName: 'fetchData',
 *     storeName: 'user-store',
 *     args: ['userId']
 *   }
 * )
 * ```
 */
export class ActionError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context)
    this.name = 'ActionError'
    Object.setPrototypeOf(this, ActionError.prototype)
  }
}

/**
 * State相关错误
 *
 * @class StateError
 * @extends GeomStoreError
 * @description
 * 表示状态操作过程中发生的错误，包括：
 * - 状态键不存在
 * - 状态值类型错误
 * - 状态更新失败
 *
 * @example
 * ```typescript
 * throw new StateError(
 *   'State key "user" does not exist',
 *   'STATE_KEY_NOT_FOUND',
 *   {
 *     storeName: 'user-store',
 *     key: 'user',
 *     availableKeys: ['name', 'email']
 *   }
 * )
 * ```
 */
export class StateError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context)
    this.name = 'StateError'
    Object.setPrototypeOf(this, StateError.prototype)
  }
}

/**
 * Selector相关错误
 *
 * @class SelectorError
 * @extends GeomStoreError
 * @description
 * 表示Selector执行过程中发生的错误，包括：
 * - Selector不存在
 * - Selector执行失败
 * - Selector参数错误
 *
 * @example
 * ```typescript
 * throw new SelectorError(
 *   'Selector "getUser" execution failed',
 *   'SELECTOR_EXECUTION_ERROR',
 *   {
 *     selectorName: 'getUser',
 *     state: { user: null }
 *   }
 * )
 * ```
 */
export class SelectorError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context)
    this.name = 'SelectorError'
    Object.setPrototypeOf(this, SelectorError.prototype)
  }
}

/**
 * Plugin相关错误
 *
 * @class PluginError
 * @extends GeomStoreError
 * @description
 * 表示插件操作过程中发生的错误，包括：
 * - 插件安装失败
 * - 插件执行失败
 * - 插件卸载失败
 *
 * @example
 * ```typescript
 * throw new PluginError(
 *   'Plugin "persistence" installation failed: Storage not available',
 *   'PLUGIN_INSTALLATION_ERROR',
 *   {
 *     pluginName: 'persistence',
 *     storeName: 'user-store'
 *   }
 * )
 * ```
 */
export class PluginError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context)
    this.name = 'PluginError'
    Object.setPrototypeOf(this, PluginError.prototype)
  }
}

/**
 * Compose相关错误
 *
 * @class ComposeError
 * @extends GeomStoreError
 * @description
 * 表示Store组合操作过程中发生的错误，包括：
 * - Store名称冲突
 * - Store依赖解析失败
 * - Store组合失败
 *
 * @example
 * ```typescript
 * throw new ComposeError(
 *   'Store name conflict: "user" already exists',
 *   'STORE_NAME_CONFLICT',
 *   {
 *     namespace: 'root',
 *     storeName: 'user',
 *     existingStore: 'root.user'
 *   }
 * )
 * ```
 */
export class ComposeError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context)
    this.name = 'ComposeError'
    Object.setPrototypeOf(this, ComposeError.prototype)
  }
}

/**
 * 验证错误
 *
 * @class ValidationError
 * @extends GeomStoreError
 * @description
 * 表示数据验证过程中发生的错误，包括：
 * - 参数验证失败
 * - 状态验证失败
 * - 类型验证失败
 *
 * @example
 * ```typescript
 * throw new ValidationError(
 *   'Invalid state value: expected number, got string',
 *   'VALIDATION_ERROR',
 *   {
 *     storeName: 'user-store',
 *     key: 'count',
 *     expectedType: 'number',
 *     receivedType: 'string',
 *     value: '10'
 *   }
 * )
 * ```
 */
export class ValidationError extends GeomStoreError {
  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message, code, context)
    this.name = 'ValidationError'
    Object.setPrototypeOf(this, ValidationError.prototype)
  }
}

/**
 * 错误代码枚举
 *
 * @description
 * 定义所有可能的错误代码，便于错误分类和处理。
 */
export enum ErrorCode {
  // Action错误
  ACTION_NOT_FOUND = 'ACTION_NOT_FOUND',
  ACTION_EXECUTION_ERROR = 'ACTION_EXECUTION_ERROR',
  ACTION_TIMEOUT = 'ACTION_TIMEOUT',
  ACTION_CANCELLED = 'ACTION_CANCELLED',

  // State错误
  STATE_KEY_NOT_FOUND = 'STATE_KEY_NOT_FOUND',
  STATE_UPDATE_ERROR = 'STATE_UPDATE_ERROR',
  STATE_TYPE_ERROR = 'STATE_TYPE_ERROR',

  // Selector错误
  SELECTOR_NOT_FOUND = 'SELECTOR_NOT_FOUND',
  SELECTOR_EXECUTION_ERROR = 'SELECTOR_EXECUTION_ERROR',
  SELECTOR_CACHE_ERROR = 'SELECTOR_CACHE_ERROR',

  // Plugin错误
  PLUGIN_NOT_FOUND = 'PLUGIN_NOT_FOUND',
  PLUGIN_INSTALLATION_ERROR = 'PLUGIN_INSTALLATION_ERROR',
  PLUGIN_EXECUTION_ERROR = 'PLUGIN_EXECUTION_ERROR',

  // Compose错误
  STORE_NAME_CONFLICT = 'STORE_NAME_CONFLICT',
  STORE_DEPENDENCY_ERROR = 'STORE_DEPENDENCY_ERROR',
  STORE_COMPOSE_ERROR = 'STORE_COMPOSE_ERROR',

  // 验证错误
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TYPE_ERROR = 'TYPE_ERROR',
  PARAMETER_ERROR = 'PARAMETER_ERROR',

  // 通用错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

/**
 * 错误类型守卫
 *
 * @description
 * 提供类型安全的错误检查函数，用于错误处理逻辑。
 */

/**
 * 检查是否为GeomStoreError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is GeomStoreError} 是否为GeomStoreError
 *
 * @example
 * ```typescript
 * try {
 *   store.dispatch('action')
 * } catch (error) {
 *   if (isGeomStoreError(error)) {
 *     console.log(error.code, error.context)
 *   } else {
 *     // 处理其他类型的错误
 *   }
 * }
 * ```
 */
export function isGeomStoreError(error: unknown): error is GeomStoreError {
  return error instanceof GeomStoreError
}

/**
 * 检查是否为ActionError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is ActionError} 是否为ActionError
 */
export function isActionError(error: unknown): error is ActionError {
  return error instanceof ActionError
}

/**
 * 检查是否为StateError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is StateError} 是否为StateError
 */
export function isStateError(error: unknown): error is StateError {
  return error instanceof StateError
}

/**
 * 检查是否为SelectorError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is SelectorError} 是否为SelectorError
 */
export function isSelectorError(error: unknown): error is SelectorError {
  return error instanceof SelectorError
}

/**
 * 检查是否为PluginError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is PluginError} 是否为PluginError
 */
export function isPluginError(error: unknown): error is PluginError {
  return error instanceof PluginError
}

/**
 * 检查是否为ValidationError
 *
 * @param {unknown} error - 要检查的错误对象
 * @returns {error is ValidationError} 是否为ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

/**
 * 根据错误代码创建错误实例
 *
 * @param {ErrorCode} code - 错误代码
 * @param {string} message - 错误消息
 * @param {Record<string, unknown>} [context] - 错误上下文
 * @returns {GeomStoreError} 对应的错误实例
 *
 * @example
 * ```typescript
 * const error = createError(
 *   ErrorCode.ACTION_NOT_FOUND,
 *   'Action not found',
 *   { actionName: 'missing' }
 * )
 * // 返回 ActionError 实例
 * ```
 */
export function createError(code: ErrorCode, message: string, context?: Record<string, unknown>): GeomStoreError {
  switch (code) {
    case ErrorCode.ACTION_NOT_FOUND:
    case ErrorCode.ACTION_EXECUTION_ERROR:
    case ErrorCode.ACTION_TIMEOUT:
    case ErrorCode.ACTION_CANCELLED:
      return new ActionError(message, code, context)

    case ErrorCode.STATE_KEY_NOT_FOUND:
    case ErrorCode.STATE_UPDATE_ERROR:
    case ErrorCode.STATE_TYPE_ERROR:
      return new StateError(message, code, context)

    case ErrorCode.SELECTOR_NOT_FOUND:
    case ErrorCode.SELECTOR_EXECUTION_ERROR:
    case ErrorCode.SELECTOR_CACHE_ERROR:
      return new SelectorError(message, code, context)

    case ErrorCode.PLUGIN_NOT_FOUND:
    case ErrorCode.PLUGIN_INSTALLATION_ERROR:
    case ErrorCode.PLUGIN_EXECUTION_ERROR:
      return new PluginError(message, code, context)

    case ErrorCode.STORE_NAME_CONFLICT:
    case ErrorCode.STORE_DEPENDENCY_ERROR:
    case ErrorCode.STORE_COMPOSE_ERROR:
      return new ComposeError(message, code, context)

    case ErrorCode.VALIDATION_ERROR:
    case ErrorCode.TYPE_ERROR:
    case ErrorCode.PARAMETER_ERROR:
      return new ValidationError(message, code, context)

    default:
      return new GeomStoreError(message, code, context)
  }
}
