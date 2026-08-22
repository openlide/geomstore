/**
 * GeomStore v1.0 - 运行时类型校验工具
 *
 * 提供完整的运行时类型验证功能，包括：
 * - 基础类型验证
 * - 对象结构验证
 * - 数组验证
 * - 自定义验证器
 * - 验证错误信息
 */

import { ValidationError, ErrorCode, createError } from '../error/GeomStoreError'

/**
 * 类型描述符
 *
 * @type {TypeDescriptor}
 * @description
 * 描述期望的类型，用于运行时验证
 */
export type TypeDescriptor = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'function' | 'symbol' | 'bigint' | 'undefined' | 'null' | 'any' | TypeSchema

/**
 * 类型schema
 *
 * @interface TypeSchema
 * @description
 * 定义复杂类型的验证规则
 */
export interface TypeSchema {
  /** 类型描述符 */
  type: TypeDescriptor

  /** 是否必需 */
  required?: boolean

  /** 默认值 */
  defaultValue?: unknown

  /** 自定义验证函数 */
  validator?: (value: unknown) => boolean

  /** 验证失败时的错误消息 */
  errorMessage?: string

  /** 数组元素的schema（当type为'array'时） */
  items?: TypeSchema

  /** 对象属性schema（当type为'object'时） */
  properties?: Record<string, TypeSchema>

  /** 允许的额外属性 */
  additionalProperties?: boolean | TypeSchema

  /** 枚举值 */
  enum?: unknown[]

  /** 最小值（数字/数组长度） */
  min?: number

  /** 最大值（数字/数组长度） */
  max?: number

  /** 正则表达式（字符串） */
  pattern?: RegExp

  /** 自定义类型检查 */
  customCheck?: (value: unknown) => boolean | string
}

/**
 * 验证结果
 *
 * @interface ValidationResult
 * @description
 * 验证操作的返回值
 */
export interface ValidationResult {
  /** 是否验证通过 */
  valid: boolean

  /** 验证通过的值 */
  value: unknown

  /** 错误信息（如果验证失败） */
  errors?: ValidationError[]

  /** 警告信息 */
  warnings?: string[]
}

/**
 * 验证错误路径
 *
 * @interface ValidationPath
 * @description
 * 描述验证失败的位置
 */
export interface ValidationPath {
  /** 完整路径 */
  path: string

  /** 期望的类型 */
  expected: string

  /** 实际的值 */
  actual: unknown

  /** 错误消息 */
  message: string
}

/**
 * 类型验证器类
 *
 * @class TypeValidator
 * @description
 * 提供运行时类型验证功能
 *
 * @example
 * ```typescript
 * const validator = new TypeValidator()
 *
 * // 验证简单类型
 * const result1 = validator.validate('hello', 'string')
 * console.log(result1.valid) // true
 *
 * // 验证对象结构
 * const userSchema: TypeSchema = {
 *   type: 'object',
 *   properties: {
 *     name: { type: 'string', required: true },
 *     age: { type: 'number', min: 0, max: 150 },
 *     email: { type: 'string', pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }
 *   }
 * }
 *
 * const result2 = validator.validate({ name: 'Alice', age: 25 }, userSchema)
 * console.log(result2.valid) // true
 * ```
 */
export class TypeValidator {
  private errors: ValidationError[] = []
  private warnings: string[] = []
  private visitedObjects = new WeakSet<object>()
  /** 当前描述符链嵌套深度（防 schema.type 自引用栈溢出） */
  private schemaDepth = 0
  /** 已验证通过的 (值 → 描述符 → 结果) 记忆化：DAG 共享引用跳过重复完整展开 */
  private validatedPairs = new WeakMap<object, Map<unknown, unknown>>()

  /**
   * 验证值是否符合类型描述
   *
   * @param {unknown} value - 要验证的值
   * @param {TypeDescriptor} descriptor - 类型描述符
   * @returns {ValidationResult} 验证结果
   *
   * @example
   * ```typescript
   * const result = validator.validate('hello', 'string')
   * if (result.valid) {
   *   console.log(result.value) // 'hello'
   * } else {
   *   console.error(result.errors)
   * }
   * ```
   */
  validate(value: unknown, descriptor: TypeDescriptor): ValidationResult {
    this.errors = []
    this.warnings = []
    this.visitedObjects = new WeakSet<object>()
    this.validatedPairs = new WeakMap()
    this.schemaDepth = 0

    const validatedValue = this.validateValue(value, descriptor, '')

    return {
      valid: this.errors.length === 0,
      value: validatedValue,
      errors: this.errors.length > 0 ? this.errors : undefined,
      warnings: this.warnings.length > 0 ? this.warnings : undefined,
    }
  }

  /**
   * 验证值，递归方法
   *
   * 循环引用检测采用递归栈语义：进入递归前标记、返回后清除，
   * 只有真正的回边（祖先链上的重复引用）才短路返回；
   * 兄弟路径共享同一对象引用（DAG）时各自完整校验，
   * 避免第二次出现被静默跳过导致非法数据漏检。
   *
   * @private
   * @param {unknown} value - 要验证的值
   * @param {TypeDescriptor} descriptor - 类型描述符
   * @param {string} path - 当前路径
   * @returns {unknown} 验证后的值
   */
  private validateValue(value: unknown, descriptor: TypeDescriptor, path: string): unknown {
    if (typeof value === 'object' && value !== null) {
      if (this.visitedObjects.has(value)) {
        // 真回边（祖先链上的重复引用）：跳过递归展开防止栈溢出，
        // 但仍执行描述符的类型层校验——循环引用对 type: 'object' 合法，
        // 而期望 string/number 等原始类型时循环值应报错，不能静默放过
        return this.validateBackEdge(value, descriptor, path)
      }
      // 记忆化：同一 (值, 描述符) 组合校验通过后，兄弟路径再次出现时直接
      // 复用结论——避免菱形共享结构最坏 2^n 次重复完整展开（校验挂死）
      const memoized = this.validatedPairs.get(value)?.get(descriptor)
      if (memoized !== undefined) {
        return memoized
      }
      this.visitedObjects.add(value)
      const errorsBefore = this.errors.length
      try {
        const result = this.validateDescriptor(value, descriptor, path)
        if (this.errors.length === errorsBefore) {
          let memo = this.validatedPairs.get(value)
          if (!memo) {
            memo = new Map()
            this.validatedPairs.set(value, memo)
          }
          memo.set(descriptor, result)
        }
        return result
      } finally {
        this.visitedObjects.delete(value)
      }
    }
    return this.validateDescriptor(value, descriptor, path)
  }

  /**
   * 回边值的类型层校验：只检查描述符声明的类型是否与值兼容，
   * 不做属性/元素递归展开（展开会无限递归）
   *
   * @private
   * @param {unknown} value - 回边命中的循环引用值（必为对象）
   * @param {TypeDescriptor} descriptor - 该位置声明的类型描述符
   * @param {string} path - 当前路径
   * @returns {unknown} 原值
   */
  private validateBackEdge(value: unknown, descriptor: TypeDescriptor, path: string): unknown {
    if (typeof descriptor === 'string') {
      return this.validateBasicType(value, descriptor, path)
    }
    if (typeof descriptor === 'object' && descriptor !== null && typeof descriptor.type === 'string') {
      return this.validateBasicType(value, descriptor.type, path)
    }
    return value
  }

  /**
   * 按描述符类型分派校验逻辑
   *
   * @private
   * @param {unknown} value - 要验证的值
   * @param {TypeDescriptor} descriptor - 类型描述符
   * @param {string} path - 当前路径
   * @returns {unknown} 验证后的值
   */
  private validateDescriptor(value: unknown, descriptor: TypeDescriptor, path: string): unknown {
    // 如果是字符串描述符，检查基本类型
    if (typeof descriptor === 'string') {
      return this.validateBasicType(value, descriptor, path)
    }

    // 如果是TypeSchema，进行复杂验证
    if (typeof descriptor === 'object' && descriptor !== null) {
      return this.validateSchema(value, descriptor, path)
    }

    return value
  }

  /**
   * 验证基本类型
   *
   * @private
   * @param {unknown} value - 要验证的值
   * @param {string} type - 类型名称
   * @param {string} path - 当前路径
   * @returns {unknown} 验证后的值
   */
  private validateBasicType(value: unknown, type: string, path: string): unknown {
    let isValid = false

    switch (type) {
      case 'string':
        isValid = typeof value === 'string'
        break
      case 'number':
        isValid = typeof value === 'number' && !isNaN(value)
        break
      case 'boolean':
        isValid = typeof value === 'boolean'
        break
      case 'object':
        isValid = typeof value === 'object' && value !== null && !Array.isArray(value)
        break
      case 'array':
        isValid = Array.isArray(value)
        break
      case 'function':
        isValid = typeof value === 'function'
        break
      case 'symbol':
        isValid = typeof value === 'symbol'
        break
      case 'bigint':
        isValid = typeof value === 'bigint'
        break
      case 'undefined':
        isValid = value === undefined
        break
      case 'null':
        isValid = value === null
        break
      case 'any':
        // 任意类型都通过
        isValid = true
        break
    }

    if (!isValid) {
      this.addError(path, type, value, `Expected ${type}, got ${typeof value}`)
    }

    return value
  }

  /**
   * 验证Schema
   *
   * @private
   * @param {unknown} value - 要验证的值
   * @param {TypeSchema} schema - 类型schema
   * @param {string} path - 当前路径
   * @returns {unknown} 验证后的值
   */
  private validateSchema(value: unknown, schema: TypeSchema, path: string): unknown {
    // 描述符链深度守卫：validateDescriptor 链不经 validateValue 的回边守卫，
    // schema.type 直接/间接自引用时会无限递归栈溢出
    if (this.schemaDepth > 50) {
      this.addError(path, 'schema', value, 'Type schema nesting too deep (possible self-reference)')
      return value
    }
    this.schemaDepth++
    try {
      return this.validateSchemaInner(value, schema, path)
    } finally {
      this.schemaDepth--
    }
  }

  private validateSchemaInner(value: unknown, schema: TypeSchema, path: string): unknown {
    // 检查必需值
    if (value === undefined || value === null) {
      if (schema.required) {
        this.addError(path, 'required', value, 'Value is required')
      }
      // 如果有默认值，使用默认值
      if (schema.defaultValue !== undefined) {
        return schema.defaultValue
      }
      return value
    }

    // 自定义验证函数
    if (schema.validator && !schema.validator(value)) {
      this.addError(path, 'custom', value, schema.errorMessage || 'Custom validation failed')
      return schema.defaultValue
    }

    // 枚举验证
    if (schema.enum && !schema.enum.includes(value)) {
      this.addError(path, 'enum', value, `Value must be one of: ${schema.enum.join(', ')}`)
      return schema.defaultValue
    }

    // 自定义检查
    if (schema.customCheck) {
      const customResult = schema.customCheck(value)
      if (typeof customResult === 'string') {
        this.addError(path, 'custom', value, customResult)
        return schema.defaultValue
      } else if (!customResult) {
        this.addError(path, 'custom', value, 'Custom check failed')
        return schema.defaultValue
      }
    }

    // 验证类型。直接走 validateDescriptor 而非 validateValue：此处 value 仍在
    // 递归栈上，经 validateValue 会必然命中回边短路，导致 type 为嵌套 schema 时
    // 内层的 validator/enum/properties/items 约束全部被跳过；
    // validateDescriptor 对字符串描述符无递归，嵌套 schema 的再入仍会被回边截断，天然终止
    let validatedValue = this.validateDescriptor(value, schema.type, path)

    // 类型特定的验证
    if (typeof schema.type === 'string') {
      validatedValue = this.validateTypeConstraints(validatedValue, schema, path)
    }

    // 对象属性验证（包含 additionalProperties 检查）
    if (schema.type === 'object' && (schema.properties || schema.additionalProperties !== undefined)) {
      validatedValue = this.validateObjectProperties(validatedValue as Record<string, unknown>, schema as TypeSchema, path)
    }

    // 数组元素验证
    if (schema.type === 'array' && schema.items) {
      validatedValue = this.validateArrayItems(validatedValue as unknown[], schema as TypeSchema, path)
    }

    return validatedValue
  }

  /**
   * 验证类型约束
   *
   * @private
   * @param {unknown} value - 要验证的值
   * @param {TypeSchema} schema - 类型schema
   * @param {string} path - 当前路径
   * @returns {unknown} 验证后的值
   */
  private validateTypeConstraints(value: unknown, schema: TypeSchema, path: string): unknown {
    const type = schema.type as string

    // 数字范围验证
    if (type === 'number') {
      const num = value as number
      if (schema.min !== undefined && num < schema.min) {
        this.addError(path, 'number', value, `Value must be >= ${schema.min}`)
      }
      if (schema.max !== undefined && num > schema.max) {
        this.addError(path, 'number', value, `Value must be <= ${schema.max}`)
      }
    }

    // 字符串长度和模式验证
    if (type === 'string') {
      const str = value as string
      if (schema.min !== undefined && str.length < schema.min) {
        this.addError(path, 'string', value, `Length must be >= ${schema.min}`)
      }
      if (schema.max !== undefined && str.length > schema.max) {
        this.addError(path, 'string', value, `Length must be <= ${schema.max}`)
      }
      if (schema.pattern && !schema.pattern.test(str)) {
        this.addError(path, 'string', value, 'String does not match the required pattern')
      }
    }

    // 数组长度验证
    if (type === 'array') {
      const arr = value as unknown[]
      if (schema.min !== undefined && arr.length < schema.min) {
        this.addError(path, 'array', value, `Length must be >= ${schema.min}`)
      }
      if (schema.max !== undefined && arr.length > schema.max) {
        this.addError(path, 'array', value, `Length must be <= ${schema.max}`)
      }
    }

    return value
  }

  /**
   * 验证对象属性
   *
   * @private
   * @param {Record<string, unknown>} obj - 要验证的对象
   * @param {TypeSchema} schema - 类型schema
   * @param {string} path - 当前路径
   * @returns {Record<string, unknown>} 验证后的对象
   */
  private validateObjectProperties(obj: Record<string, unknown>, schema: TypeSchema, path: string): Record<string, unknown> {
    if (typeof obj !== 'object' || obj === null) {
      return obj
    }

    const result: Record<string, unknown> = { ...obj }

    // 验证定义的属性
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const propPath = path ? `${path}.${key}` : key
        result[key] = this.validateValue(result[key], propSchema, propPath)
      }
    }

    // 处理额外属性
    if (schema.additionalProperties === false) {
      const allowedKeys = schema.properties ? Object.keys(schema.properties) : []
      const extraKeys = Object.keys(result).filter((key) => !allowedKeys.includes(key))

      extraKeys.forEach((key) => {
        this.addWarning(path, `Additional property "${key}" is not allowed`)
        delete result[key]
      })
      // 如果有额外属性，验证失败
      if (extraKeys.length > 0) {
        this.addError(path, 'object', result, 'Additional properties are not allowed')
      }
    } else if (typeof schema.additionalProperties === 'object') {
      const allowedKeys = schema.properties ? Object.keys(schema.properties) : []
      const extraKeys = Object.keys(result).filter((key) => !allowedKeys.includes(key))

      extraKeys.forEach((key) => {
        const propPath = path ? `${path}.${key}` : key
        result[key] = this.validateValue(result[key], schema.additionalProperties as TypeSchema, propPath)
      })
    }

    return result
  }

  /**
   * 验证数组元素
   *
   * @private
   * @param {unknown[]} arr - 要验证的数组
   * @param {TypeSchema} schema - 类型schema
   * @param {string} path - 当前路径
   * @returns {unknown[]} 验证后的数组
   */
  private validateArrayItems(arr: unknown[], schema: TypeSchema, path: string): unknown[] {
    const items = schema.items
    if (!Array.isArray(arr) || !items) {
      return arr
    }

    return arr.map((item, index) => {
      const itemPath = `${path}[${index}]`
      return this.validateValue(item, items, itemPath)
    })
  }

  /**
   * 添加错误
   *
   * @private
   * @param {string} path - 路径
   * @param {string} expected - 期望的类型
   * @param {unknown} actual - 实际的值
   * @param {string} message - 错误消息
   */
  private addError(path: string, expected: string, actual: unknown, message: string): void {
    const error = createError(ErrorCode.VALIDATION_ERROR, message, {
      path,
      expected,
      actual,
    })
    this.errors.push(error)
  }

  /**
   * 添加警告
   *
   * @private
   * @param {string} path - 路径
   * @param {string} message - 警告消息
   */
  private addWarning(path: string, message: string): void {
    this.warnings.push(`[${path}] ${message}`)
  }

  /**
   * 验证并抛出错误（如果验证失败）
   *
   * @param {unknown} value - 要验证的值
   * @param {TypeDescriptor} descriptor - 类型描述符
   * @returns {unknown} 验证后的值
   * @throws {ValidationError} 如果验证失败
   *
   * @example
   * ```typescript
   * try {
   *   const validated = validator.validateAndThrow(input, userSchema)
   * } catch (error) {
   *   console.error('Validation failed:', error)
   * }
   * ```
   */
  validateAndThrow(value: unknown, descriptor: TypeDescriptor): unknown {
    const result = this.validate(value, descriptor)

    if (!result.valid) {
      throw result.errors?.[0] ?? new Error('Validation failed')
    }

    return result.value
  }
}

/**
 * 创建类型验证器实例
 *
 * @returns {TypeValidator} 类型验证器实例
 *
 * @example
 * ```typescript
 * const validator = createTypeValidator()
 * const result = validator.validate('hello', 'string')
 * ```
 */
export function createTypeValidator(): TypeValidator {
  return new TypeValidator()
}

/**
 * 导出全局默认实例
 */
export const defaultTypeValidator = createTypeValidator()

/**
 * 常用类型Schema
 */
export const CommonSchemas = {
  /** UUID字符串 */
  uuid: {
    type: 'string' as const,
    pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  } as TypeSchema,

  /** Email地址 */
  email: {
    type: 'string' as const,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  } as TypeSchema,

  /** URL */
  url: {
    type: 'string' as const,
    pattern: /^https?:\/\/.+/,
    customCheck: (value: unknown) => {
      try {
        // 小程序基础库无全局 URL 构造器，降级为正则校验
        if (typeof URL !== 'undefined') {
          new URL(value as string)
        } else if (typeof value !== 'string' || !/^https?:\/\/[^\s]+$/.test(value)) {
          return 'Invalid URL format'
        }
        return true
      } catch {
        return 'Invalid URL format'
      }
    },
  } as TypeSchema,

  /** 非空字符串 */
  nonEmptyString: {
    type: 'string' as const,
    min: 1,
  } as TypeSchema,

  /** 正整数 */
  positiveInteger: {
    type: 'number' as const,
    min: 1,
    customCheck: (value: unknown) => Number.isInteger(value),
  } as TypeSchema,

  /** 非负数 */
  nonNegativeNumber: {
    type: 'number' as const,
    min: 0,
  } as TypeSchema,

  /** 布尔值 */
  boolean: {
    type: 'boolean' as const,
  } as TypeSchema,

  /** 日期字符串 (ISO格式) */
  dateString: {
    type: 'string' as const,
    customCheck: (value: unknown) => {
      if (typeof value !== 'string') return false
      const date = new Date(value)
      return !isNaN(date.getTime())
    },
  } as TypeSchema,
} as const

/**
 * 类型守卫函数集合
 */
export const TypeGuards = {
  /** 检查是否为有效邮箱 */
  isEmail: (value: unknown): value is string => {
    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  },

  /** 检查是否为有效URL */
  isURL: (value: unknown): value is string => {
    if (typeof value !== 'string') return false
    // 小程序基础库无全局 URL 构造器，降级为正则校验
    if (typeof URL === 'undefined') {
      return /^https?:\/\/[^\s]+$/.test(value)
    }
    try {
      new URL(value)
      return true
    } catch {
      return false
    }
  },

  /** 检查是否为有效日期字符串 */
  isDateString: (value: unknown): value is string => {
    if (typeof value !== 'string') return false
    const date = new Date(value)
    return !isNaN(date.getTime())
  },

  /** 检查是否为有效UUID */
  isUUID: (value: unknown): value is string => {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  },

  /** 检查是否为整数 */
  isInteger: (value: unknown): value is number => {
    return typeof value === 'number' && Number.isInteger(value)
  },

  /** 检查是否为正数 */
  isPositive: (value: unknown): value is number => {
    return typeof value === 'number' && value > 0
  },

  /** 检查是否为非空字符串 */
  isNonEmptyString: (value: unknown): value is string => {
    return typeof value === 'string' && value.length > 0
  },

  /** 检查是否为数组 */
  isArray: <T = unknown>(value: unknown): value is T[] => {
    return Array.isArray(value)
  },

  /** 检查是否为纯对象 */
  isPlainObject: (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === '[object Object]'
  },
}
