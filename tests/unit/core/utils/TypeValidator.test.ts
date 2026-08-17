/**
 * GeomStore v1.0 - TypeValidator测试
 *
 * 测试覆盖：
 * - 基础类型验证
 * - 对象结构验证
 * - 数组元素验证
 * - 枚举值验证
 * - 范围验证
 * - 正则表达式验证
 * - 自定义验证函数
 * - 错误消息生成
 * - 类型守卫
 */

import { TypeValidator, TypeSchema, CommonSchemas, TypeGuards, createTypeValidator, defaultTypeValidator } from '@/core/utils'

describe('TypeValidator', () => {
  let validator: TypeValidator

  beforeEach(() => {
    validator = new TypeValidator()
  })

  describe('基础功能', () => {
    it('VALIDATOR-001: 应该创建TypeValidator实例', () => {
      expect(validator).toBeDefined()
      expect(validator).toBeInstanceOf(TypeValidator)
    })

    it('VALIDATOR-002: validate应该返回ValidationResult', () => {
      const result = validator.validate('test', 'string')

      expect(result).toHaveProperty('valid')
      expect(result).toHaveProperty('value')
      expect(result).toHaveProperty('errors')
      expect(result).toHaveProperty('warnings')
    })
  })

  describe('基本类型验证', () => {
    it('VALIDATOR-003: 应该验证字符串类型', () => {
      const result = validator.validate('hello', 'string')

      expect(result.valid).toBe(true)
      expect(result.value).toBe('hello')
    })

    it('VALIDATOR-004: 非字符串应该验证失败', () => {
      const result = validator.validate(123, 'string')

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors?.[0].context?.path).toBe('')
    })

    it('VALIDATOR-005: 应该验证数字类型', () => {
      const result = validator.validate(42, 'number')

      expect(result.valid).toBe(true)
      expect(result.value).toBe(42)
    })

    it('VALIDATOR-006: 应该验证布尔类型', () => {
      const result1 = validator.validate(true, 'boolean')
      const result2 = validator.validate(false, 'boolean')

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(true)
      expect(result1.value).toBe(true)
      expect(result2.value).toBe(false)
    })

    it('VALIDATOR-007: 应该验证null和undefined', () => {
      const result1 = validator.validate(null, 'null')
      const result2 = validator.validate(undefined, 'undefined')

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(true)
    })

    it('VALIDATOR-008: 应该验证数组类型', () => {
      const result = validator.validate([1, 2, 3], 'array')

      expect(result.valid).toBe(true)
      expect(result.value).toEqual([1, 2, 3])
    })

    it('VALIDATOR-009: 应该验证对象类型', () => {
      const result = validator.validate({ a: 1, b: 2 }, 'object')

      expect(result.valid).toBe(true)
      expect(result.value).toEqual({ a: 1, b: 2 })
    })
  })

  describe('Schema验证', () => {
    it('VALIDATOR-010: 应该验证对象属性', () => {
      const schema: TypeSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: true },
        },
      }

      const result = validator.validate({ name: 'John', age: 30 }, schema)

      expect(result.valid).toBe(true)
    })

    it('VALIDATOR-011: 缺少required属性应该失败', () => {
      const schema: TypeSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: true },
        },
      }

      const result = validator.validate({ name: 'John' }, schema)

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors?.[0].message).toContain('required')
    })

    it('VALIDATOR-012: 应该验证嵌套对象', () => {
      const schema: TypeSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string', required: true },
              address: {
                type: 'object',
                properties: {
                  city: { type: 'string' },
                },
              },
            },
          },
        },
      }

      const result = validator.validate(
        {
          user: {
            name: 'John',
            address: { city: 'Beijing' },
          },
        },
        schema,
      )

      expect(result.valid).toBe(true)
    })

    it('VALIDATOR-COV-001: any 类型 schema 应接受任意值', () => {
      const schema: TypeSchema = { type: 'any' }

      expect(validator.validate(42, schema).valid).toBe(true)
      expect(validator.validate('str', schema).valid).toBe(true)
      expect(validator.validate({ a: 1 }, schema).valid).toBe(true)
      expect(validator.validate(null, schema).valid).toBe(true)
    })
  })

  describe('数组验证', () => {
    it('VALIDATOR-013: 应该验证数组元素', () => {
      const schema: TypeSchema = {
        type: 'array',
        items: { type: 'number' },
      }

      const result = validator.validate([1, 2, 3], schema)

      expect(result.valid).toBe(true)
    })

    it('VALIDATOR-014: 数组元素类型错误应该失败', () => {
      const schema: TypeSchema = {
        type: 'array',
        items: { type: 'number' },
      }

      const result = validator.validate([1, 'two', 3], schema)

      expect(result.valid).toBe(false)
      expect(result.errors).toBeDefined()
    })

    it('VALIDATOR-015: 应该验证数组长度', () => {
      const schema: TypeSchema = {
        type: 'array',
        items: { type: 'string' },
        min: 1,
        max: 5,
      }

      const result1 = validator.validate(['a', 'b', 'c'], schema)
      expect(result1.valid).toBe(true)

      const result2 = validator.validate([] as any, schema)
      expect(result2.valid).toBe(false)

      const result3 = validator.validate([1, 2, 3, 4, 5, 6] as any, schema)
      expect(result3.valid).toBe(false)
    })
  })

  describe('枚举验证', () => {
    it('VALIDATOR-016: 应该验证枚举值', () => {
      const schema: TypeSchema = {
        type: 'string',
        enum: ['red', 'green', 'blue'],
      }

      const result1 = validator.validate('red', schema)
      const result2 = validator.validate('yellow', schema)

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
      expect(result2.errors?.[0].message).toContain('must be one of')
    })
  })

  describe('范围验证', () => {
    it('VALIDATOR-017: 应该验证数字范围', () => {
      const schema: TypeSchema = {
        type: 'number',
        min: 0,
        max: 100,
      }

      const result1 = validator.validate(50, schema)
      const result2 = validator.validate(-1, schema)
      const result3 = validator.validate(101, schema)

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
      expect(result3.valid).toBe(false)
    })

    it('VALIDATOR-018: 应该验证字符串长度', () => {
      const schema: TypeSchema = {
        type: 'string',
        min: 3,
        max: 20,
      }

      const result1 = validator.validate('hello', schema)
      const result2 = validator.validate('hi', schema)
      const result3 = validator.validate('this string is way too long', schema)

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
      expect(result3.valid).toBe(false)
    })

    it('VALIDATOR-019: 应该验证数组长度', () => {
      const schema: TypeSchema = {
        type: 'array',
        items: { type: 'number' },
        min: 1,
        max: 10,
      }

      const result1 = validator.validate([1, 2, 3], schema)
      const result2 = validator.validate([], schema)

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
    })
  })

  describe('正则表达式验证', () => {
    it('VALIDATOR-020: 应该验证正则表达式', () => {
      const schema: TypeSchema = {
        type: 'string',
        pattern: /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
      }

      const result1 = validator.validate('user@example.com', schema)
      const result2 = validator.validate('invalid email', schema)

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
      expect(result2.errors?.[0].message).toContain('pattern')
    })
  })

  describe('自定义验证', () => {
    it('VALIDATOR-021: 应该使用自定义验证函数', () => {
      const customValidator = jest.fn((value: unknown) => {
        return typeof value === 'string' && value.length >= 5
      })

      const schema: TypeSchema = {
        type: 'string',
        validator: customValidator,
      }

      const result1 = validator.validate('hello', schema)
      const result2 = validator.validate('hi', schema)

      expect(customValidator).toHaveBeenCalledTimes(2)
      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
    })

    it('VALIDATOR-022: 应该使用自定义错误消息', () => {
      const schema: TypeSchema = {
        type: 'string',
        validator: (value: unknown) => typeof value === 'string',
        errorMessage: 'Invalid string value',
      }

      const result = validator.validate(123, schema)

      expect(result.valid).toBe(false)
      expect(result.errors?.[0].message).toBe('Invalid string value')
    })

    it('VALIDATOR-023: 应该支持自定义检查', () => {
      const schema: TypeSchema = {
        type: 'string',
        customCheck: (value: unknown) => {
          if (typeof value !== 'string') return 'Must be string'
          if (value.length < 3) return 'Too short'
          return true
        },
      }

      const result1 = validator.validate('abc', schema)
      const result2 = validator.validate('ab', schema)
      const result3 = validator.validate(123, schema)

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
      expect(result2.errors?.[0].message).toBe('Too short')
      expect(result3.valid).toBe(false)
    })
  })

  describe('额外属性处理', () => {
    it('VALIDATOR-024: additionalProperties为false时应该拒绝额外属性', () => {
      const schema: TypeSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      }

      const result = validator.validate({ name: 'John', extra: 'value' }, schema)

      expect(result.valid).toBe(false)
      expect(result.warnings).toBeDefined()
      expect(result.warnings?.[0]).toContain('not allowed')
    })

    it('VALIDATOR-025: additionalProperties为true时应该接受额外属性', () => {
      const schema: TypeSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: true,
      }

      const result = validator.validate({ name: 'John', extra: 'value' }, schema)

      expect(result.valid).toBe(true)
    })

    it('VALIDATOR-026: additionalProperties为schema时应该验证额外属性', () => {
      const schema: TypeSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: {
          type: 'string',
          min: 2,
        },
      }

      const result1 = validator.validate({ name: 'John', extra: 'ok' }, schema)
      const result2 = validator.validate({ name: 'John', extra: 'x' }, schema)

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
    })
  })

  describe('默认值', () => {
    it('VALIDATOR-027: 应该使用默认值', () => {
      const schema: TypeSchema = {
        type: 'string',
        defaultValue: 'default',
      }

      const result = validator.validate(undefined, schema)

      expect(result.valid).toBe(true)
      expect(result.value).toBe('default')
    })

    it('VALIDATOR-028: 有值时应该不使用默认值', () => {
      const schema: TypeSchema = {
        type: 'string',
        defaultValue: 'default',
      }

      const result = validator.validate('custom', schema)

      expect(result.valid).toBe(true)
      expect(result.value).toBe('custom')
    })
  })

  describe('validateAndThrow', () => {
    it('VALIDATOR-029: 验证成功时应该返回值', () => {
      const result = validator.validateAndThrow('hello', 'string')
      expect(result).toBe('hello')
    })

    it('VALIDATOR-030: 验证失败时应该抛出错误', () => {
      expect(() => {
        validator.validateAndThrow(123, 'string')
      }).toThrow()
    })
  })
})

describe('CommonSchemas', () => {
  let validator: TypeValidator

  beforeEach(() => {
    validator = new TypeValidator()
  })

  it('VALIDATOR-031: UUID schema应该验证UUID', () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000'
    const invalidUUID = 'not-a-uuid'

    const result1 = validator.validate(validUUID, CommonSchemas.uuid)
    const result2 = validator.validate(invalidUUID, CommonSchemas.uuid)

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(false)
  })

  it('VALIDATOR-032: Email schema应该验证email', () => {
    const validEmail = 'user@example.com'
    const invalidEmail = 'not-an-email'

    const result1 = validator.validate(validEmail, CommonSchemas.email)
    const result2 = validator.validate(invalidEmail, CommonSchemas.email)

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(false)
  })

  it('VALIDATOR-033: URL schema应该验证URL', () => {
    const validURL = 'https://example.com'
    const invalidURL = 'not-a-url'

    const result1 = validator.validate(validURL, CommonSchemas.url)
    const result2 = validator.validate(invalidURL, CommonSchemas.url)

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(false)
  })

  it('VALIDATOR-034: nonEmptyString schema应该验证非空字符串', () => {
    const result1 = validator.validate('hello', CommonSchemas.nonEmptyString)
    const result2 = validator.validate('', CommonSchemas.nonEmptyString)

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(false)
  })

  it('VALIDATOR-035: positiveInteger schema应该验证正整数', () => {
    const result1 = validator.validate(42, CommonSchemas.positiveInteger)
    const result2 = validator.validate(-1, CommonSchemas.positiveInteger)
    const result3 = validator.validate(1.5, CommonSchemas.positiveInteger)

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(false)
    expect(result3.valid).toBe(false)
  })

  it('VALIDATOR-036: nonNegativeNumber schema应该验证非负数', () => {
    const result1 = validator.validate(0, CommonSchemas.nonNegativeNumber)
    const result2 = validator.validate(42, CommonSchemas.nonNegativeNumber)
    const result3 = validator.validate(-1, CommonSchemas.nonNegativeNumber)

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(true)
    expect(result3.valid).toBe(false)
  })

  it('VALIDATOR-037: boolean schema应该验证布尔值', () => {
    const result1 = validator.validate(true, CommonSchemas.boolean)
    const result2 = validator.validate(false, CommonSchemas.boolean)
    const result3 = validator.validate(1, CommonSchemas.boolean)

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(true)
    expect(result3.valid).toBe(false)
  })

  it('VALIDATOR-038: dateString schema应该验证日期字符串', () => {
    const result1 = validator.validate('2024-01-01T00:00:00Z', CommonSchemas.dateString)
    const result2 = validator.validate('not-a-date', CommonSchemas.dateString)

    expect(result1.valid).toBe(true)
    expect(result2.valid).toBe(false)
  })

  it('VALIDATOR-COV-002: 无全局 URL 构造器时 URL schema 应降级为正则校验', () => {
    const globalObject = globalThis as { URL?: unknown }
    const originalURL = globalObject.URL
    delete globalObject.URL

    try {
      const result1 = validator.validate('https://example.com', CommonSchemas.url)
      const result2 = validator.validate('not-a-url', CommonSchemas.url)

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
    } finally {
      globalObject.URL = originalURL
    }
  })
})

describe('TypeGuards', () => {
  it('VALIDATOR-039: isEmail应该正确识别email', () => {
    expect(TypeGuards.isEmail('user@example.com')).toBe(true)
    expect(TypeGuards.isEmail('not-an-email')).toBe(false)
    expect(TypeGuards.isEmail(null)).toBe(false)
    expect(TypeGuards.isEmail(undefined)).toBe(false)
  })

  it('VALIDATOR-040: isURL应该正确识别URL', () => {
    expect(TypeGuards.isURL('https://example.com')).toBe(true)
    expect(TypeGuards.isURL('http://example.com')).toBe(true)
    expect(TypeGuards.isURL('not-a-url')).toBe(false)
  })

  it('VALIDATOR-041: isDateString应该正确识别日期字符串', () => {
    expect(TypeGuards.isDateString('2024-01-01')).toBe(true)
    expect(TypeGuards.isDateString('2024-01-01T00:00:00Z')).toBe(true)
    expect(TypeGuards.isDateString('not-a-date')).toBe(false)
  })

  it('VALIDATOR-042: isUUID应该正确识别UUID', () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000'
    const invalidUUID = 'not-a-uuid'

    expect(TypeGuards.isUUID(validUUID)).toBe(true)
    expect(TypeGuards.isUUID(invalidUUID)).toBe(false)
  })

  it('VALIDATOR-043: isInteger应该正确识别整数', () => {
    expect(TypeGuards.isInteger(42)).toBe(true)
    expect(TypeGuards.isInteger(-1)).toBe(true)
    expect(TypeGuards.isInteger(1.5)).toBe(false)
    expect(TypeGuards.isInteger('42' as any)).toBe(false)
  })

  it('VALIDATOR-044: isPositive应该正确识别正数', () => {
    expect(TypeGuards.isPositive(42)).toBe(true)
    expect(TypeGuards.isPositive(0.1)).toBe(true)
    expect(TypeGuards.isPositive(0)).toBe(false)
    expect(TypeGuards.isPositive(-1)).toBe(false)
  })

  it('VALIDATOR-045: isNonEmptyString应该正确识别非空字符串', () => {
    expect(TypeGuards.isNonEmptyString('hello')).toBe(true)
    expect(TypeGuards.isNonEmptyString('')).toBe(false)
    expect(TypeGuards.isNonEmptyString(' ')).toBe(true)
  })

  it('VALIDATOR-046: isArray应该正确识别数组', () => {
    expect(TypeGuards.isArray([1, 2, 3])).toBe(true)
    expect(TypeGuards.isArray([])).toBe(true)
    expect(TypeGuards.isArray({})).toBe(false)
    expect(TypeGuards.isArray(null)).toBe(false)
  })

  it('VALIDATOR-047: isPlainObject应该正确识别纯对象', () => {
    expect(TypeGuards.isPlainObject({})).toBe(true)
    expect(TypeGuards.isPlainObject({ a: 1 })).toBe(true)
    expect(TypeGuards.isPlainObject([])).toBe(false)
    expect(TypeGuards.isPlainObject(null)).toBe(false)
    expect(TypeGuards.isPlainObject(new Date())).toBe(false)
  })

  it('VALIDATOR-COV-003: 无全局 URL 构造器时 isURL 应降级为正则校验', () => {
    const globalObject = globalThis as { URL?: unknown }
    const originalURL = globalObject.URL
    delete globalObject.URL

    try {
      expect(TypeGuards.isURL('https://example.com')).toBe(true)
      expect(TypeGuards.isURL('http://example.com')).toBe(true)
      expect(TypeGuards.isURL('not-a-url')).toBe(false)
    } finally {
      globalObject.URL = originalURL
    }
  })
})

describe('便捷函数', () => {
  it('VALIDATOR-048: createTypeValidator应该创建实例', () => {
    const validator = createTypeValidator()
    expect(validator).toBeInstanceOf(TypeValidator)
  })

  it('VALIDATOR-049: defaultTypeValidator应该是单例', () => {
    expect(defaultTypeValidator).toBeDefined()
    expect(defaultTypeValidator).toBeInstanceOf(TypeValidator)
  })
})

describe('边界情况', () => {
  let validator: TypeValidator

  beforeEach(() => {
    validator = new TypeValidator()
  })

  it('VALIDATOR-050: 应该处理null值', () => {
    const result = validator.validate(null, 'null')
    expect(result.valid).toBe(true)
    expect(result.value).toBe(null)
  })

  it('VALIDATOR-051: 应该处理undefined值', () => {
    const result = validator.validate(undefined, 'undefined')
    expect(result.valid).toBe(true)
    expect(result.value).toBe(undefined)
  })

  it('VALIDATOR-052: 应该处理空对象', () => {
    const schema: TypeSchema = {
      type: 'object',
      properties: {},
    }

    const result = validator.validate({}, schema)
    expect(result.valid).toBe(true)
  })

  it('VALIDATOR-053: 应该处理空数组', () => {
    const schema: TypeSchema = {
      type: 'array',
      items: { type: 'string' },
    }

    const result = validator.validate([], schema)
    expect(result.valid).toBe(true)
  })

  it('VALIDATOR-054: 应该处理深度嵌套结构', () => {
    const schema: TypeSchema = {
      type: 'object',
      properties: {
        level1: {
          type: 'object',
          properties: {
            level2: {
              type: 'object',
              properties: {
                level3: {
                  type: 'string',
                },
              },
            },
          },
        },
      },
    }

    const result = validator.validate({ level1: { level2: { level3: 'value' } } }, schema)

    expect(result.valid).toBe(true)
  })

  it('VALIDATOR-055: 应该处理循环引用', () => {
    const obj: any = { name: 'John' }
    obj.self = obj

    const schema: TypeSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        self: { type: 'any' },
      },
    }

    // 应该不会无限循环
    const result = validator.validate(obj, schema)
    expect(result.valid).toBe(true)
  })
})

describe('覆盖率补充测试', () => {
  let validator: TypeValidator

  beforeEach(() => {
    validator = new TypeValidator()
  })

  describe('基本类型补充', () => {
    it('VALIDATOR-SUP-001: 应该验证 function 类型', () => {
      const result1 = validator.validate(() => {}, 'function')
      const result2 = validator.validate('not-a-fn', 'function')

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
      expect(result2.errors?.[0].message).toContain('function')
    })

    it('VALIDATOR-SUP-002: 应该验证 symbol 类型', () => {
      const result1 = validator.validate(Symbol('test'), 'symbol')
      const result2 = validator.validate('not-a-symbol', 'symbol')

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
      expect(result2.errors?.[0].message).toContain('symbol')
    })

    it('VALIDATOR-SUP-003: 应该验证 bigint 类型', () => {
      const result1 = validator.validate(BigInt(123), 'bigint')
      const result2 = validator.validate(123, 'bigint')

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
      expect(result2.errors?.[0].message).toContain('bigint')
    })

    it('VALIDATOR-SUP-004: 应该验证 NaN 不是 number', () => {
      const result = validator.validate(NaN, 'number')

      expect(result.valid).toBe(false)
      expect(result.errors?.[0].message).toContain('number')
    })

    it('VALIDATOR-SUP-005: 应该验证 null 不是 object', () => {
      const result = validator.validate(null, 'object')

      expect(result.valid).toBe(false)
    })

    it('VALIDATOR-SUP-006: 应该验证数组不是 object', () => {
      const result = validator.validate([1, 2], 'object')

      expect(result.valid).toBe(false)
    })
  })

  describe('validateValue 补充', () => {
    it('VALIDATOR-SUP-007: descriptor 既不是 string 也不是 object 时应直接返回值', () => {
      // 使用 number 作为 descriptor（不是 string 也不是 object）
      // 通过传入一个非标准 descriptor 来触发 fallback
      const result = validator.validate('test', 123 as any)
      expect(result.valid).toBe(true)
      expect(result.value).toBe('test')
    })
  })

  describe('validateSchema 补充', () => {
    it('VALIDATOR-SUP-008: schema.type 为非 string 类型时（如 schema）应跳过类型约束验证', () => {
      // schema.type 为 TypeSchema 而非 string 时，typeof schema.type !== 'string'，跳过 validateTypeConstraints
      const schema: TypeSchema = {
        type: { type: 'string' } as any, // type 是一个 schema 对象而非字符串
      }

      const result = validator.validate('hello', schema)
      expect(result).toBeDefined()
    })

    it('VALIDATOR-SUP-009: value 为 undefined 且无 required 和无 defaultValue 时应返回 undefined', () => {
      const schema: TypeSchema = {
        type: 'string',
      }

      const result = validator.validate(undefined, schema)
      expect(result.valid).toBe(true)
      expect(result.value).toBe(undefined)
    })

    it('VALIDATOR-SUP-010: value 为 null 且无 required 和有 defaultValue 时应返回 defaultValue', () => {
      const schema: TypeSchema = {
        type: 'string',
        defaultValue: 'fallback',
      }

      const result = validator.validate(null, schema)
      expect(result.valid).toBe(true)
      expect(result.value).toBe('fallback')
    })

    it('VALIDATOR-SUP-011: value 为 null 且 required 时应报错且返回 value', () => {
      const schema: TypeSchema = {
        type: 'string',
        required: true,
      }

      const result = validator.validate(null, schema)
      expect(result.valid).toBe(false)
      expect(result.value).toBe(null)
    })

    it('VALIDATOR-SUP-012: customCheck 返回 false 时应报错并返回 defaultValue', () => {
      const schema: TypeSchema = {
        type: 'string',
        customCheck: () => false,
        defaultValue: 'default',
      }

      const result = validator.validate('hello', schema)
      expect(result.valid).toBe(false)
      expect(result.value).toBe('default')
    })

    it('VALIDATOR-SUP-013: validator 返回 false 且无 defaultValue 时应返回 undefined', () => {
      const schema: TypeSchema = {
        type: 'string',
        validator: () => false,
      }

      const result = validator.validate('hello', schema)
      expect(result.valid).toBe(false)
      expect(result.value).toBe(undefined)
    })

    it('VALIDATOR-SUP-014: enum 验证失败且无 defaultValue 时应返回 undefined', () => {
      const schema: TypeSchema = {
        type: 'string',
        enum: ['a', 'b'],
      }

      const result = validator.validate('c', schema)
      expect(result.valid).toBe(false)
      expect(result.value).toBe(undefined)
    })
  })

  describe('validateObjectProperties 补充', () => {
    it('VALIDATOR-SUP-015: obj 不是对象时应直接返回', () => {
      // 构造一个场景使 validateObjectProperties 被调用但 obj 不是对象
      // 当 schema.type === 'object' 且 schema.properties 存在时，
      // 如果验证的值本身不是对象（如 string），validateBasicType 会报错，
      // 但 validatedValue 仍是原始值（string），然后传入 validateObjectProperties
      const schema: TypeSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      }

      const result = validator.validate('not-an-object', schema)
      expect(result.valid).toBe(false)
      // validateObjectProperties 检查 typeof obj !== 'object' || obj === null，直接返回
    })

    it('VALIDATOR-SUP-016: additionalProperties 为 false 且 properties 为空时应拒绝所有属性', () => {
      const schema: TypeSchema = {
        type: 'object',
        properties: {}, // 空对象 → allowedKeys = []
        additionalProperties: false,
      }

      const result = validator.validate({ extra: 'value' }, schema)
      expect(result.valid).toBe(false)
      expect(result.warnings).toBeDefined()
    })

    it('VALIDATOR-SUP-017: additionalProperties 为 schema 且 properties 为空时应验证所有属性', () => {
      const schema: TypeSchema = {
        type: 'object',
        properties: {}, // 空对象 → allowedKeys = []
        additionalProperties: { type: 'string', min: 2 },
      }

      const result1 = validator.validate({ key1: 'ok' }, schema)
      const result2 = validator.validate({ key1: 'x' }, schema) // 太短

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
    })

    it('VALIDATOR-SUP-018: additionalProperties 为 schema 且路径为空时应使用 key 作为 propPath', () => {
      const schema: TypeSchema = {
        type: 'object',
        additionalProperties: { type: 'string' },
      }

      // 顶层对象验证，path 为空字符串，propPath = key
      const result = validator.validate({ extra: 'value' }, schema)
      expect(result.valid).toBe(true)
    })
  })

  describe('validateArrayItems 补充', () => {
    it('VALIDATOR-SUP-019: arr 不是数组时应直接返回', () => {
      const schema: TypeSchema = {
        type: 'array',
        items: { type: 'number' },
      }

      // 传入一个非数组值
      const result = validator.validate('not-an-array', schema)
      expect(result.valid).toBe(false)
      // validateArrayItems 检查 !Array.isArray(arr)，直接返回
    })

    it('VALIDATOR-SUP-020: schema 没有 items 时应直接返回数组', () => {
      const schema: TypeSchema = {
        type: 'array',
        // 不设置 items
      }

      const result = validator.validate([1, 2, 3], schema)
      expect(result.valid).toBe(true)
      expect(result.value).toEqual([1, 2, 3])
    })
  })

  describe('TypeGuards 非字符串输入补充', () => {
    it('VALIDATOR-SUP-021: isURL 接收非字符串应返回 false', () => {
      expect(TypeGuards.isURL(null)).toBe(false)
      expect(TypeGuards.isURL(undefined)).toBe(false)
      expect(TypeGuards.isURL(123)).toBe(false)
      expect(TypeGuards.isURL({})).toBe(false)
    })

    it('VALIDATOR-SUP-022: isDateString 接收非字符串应返回 false', () => {
      expect(TypeGuards.isDateString(null)).toBe(false)
      expect(TypeGuards.isDateString(undefined)).toBe(false)
      expect(TypeGuards.isDateString(123)).toBe(false)
    })

    it('VALIDATOR-SUP-023: isUUID 接收非字符串应返回 false', () => {
      expect(TypeGuards.isUUID(null)).toBe(false)
      expect(TypeGuards.isUUID(undefined)).toBe(false)
      expect(TypeGuards.isUUID(123)).toBe(false)
    })
  })

  describe('validateObjectProperties 分支补充', () => {
    it('VALIDATOR-SUP-024: additionalProperties=false 且无 properties 时应拒绝所有属性', () => {
      // schema 没有 properties 属性（falsy），只有 additionalProperties: false
      // 覆盖 line 398 if(schema.properties) false 分支和 line 407 schema.properties ? ... : [] false 分支
      const schema: TypeSchema = {
        type: 'object',
        additionalProperties: false,
      }

      const result = validator.validate({ extra: 'value' }, schema)
      expect(result.valid).toBe(false)
      expect(result.warnings).toBeDefined()
    })

    it('VALIDATOR-SUP-025: additionalProperties=false 且无额外属性时应通过验证', () => {
      // 覆盖 line 415 if (extraKeys.length > 0) false 分支
      const schema: TypeSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      }

      const result = validator.validate({ name: 'John' }, schema)
      expect(result.valid).toBe(true)
    })

    it('VALIDATOR-SUP-026: additionalProperties 为 schema 且无 properties 时应验证所有属性', () => {
      // 覆盖 line 419 schema.properties ? ... : [] false 分支
      const schema: TypeSchema = {
        type: 'object',
        additionalProperties: { type: 'string' },
      }

      const result1 = validator.validate({ key1: 'ok' }, schema)
      const result2 = validator.validate({ key1: 123 }, schema)

      expect(result1.valid).toBe(true)
      expect(result2.valid).toBe(false)
    })

    it('VALIDATOR-SUP-027: 嵌套对象中 additionalProperties 为 schema 且有 path 时应构建完整 propPath', () => {
      // 覆盖 line 423 path ? `${path}.${key}` : key 的 true 分支
      const schema: TypeSchema = {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
      }

      const result = validator.validate({ nested: { extra: 'value' } }, schema)
      expect(result.valid).toBe(true)
    })
  })

  describe('CommonSchemas.dateString 补充', () => {
    it('VALIDATOR-SUP-028: dateString customCheck 接收非字符串应返回 false', () => {
      // 覆盖 line 586 if (typeof value !== 'string') return false 的 true 分支
      const result = validator.validate(123, CommonSchemas.dateString)
      expect(result.valid).toBe(false)
    })
  })
})

describe('共享引用与循环引用回归（BUG-14）', () => {
  let validator: TypeValidator

  beforeEach(() => {
    validator = new TypeValidator()
  })

  it('REGR-VALIDATOR-001: 同一共享对象在不同路径应分别校验（不再被静默跳过）', () => {
    const shared = { a: 'hello' }
    const schema: TypeSchema = {
      type: 'object',
      properties: {
        y: { type: 'object', properties: { a: { type: 'number' } } },
        x: { type: 'object', properties: { a: { type: 'string' } } },
      },
    }

    // 修复前：首条路径通过后 shared 被永久标记，y 路径的 a:number 校验被静默跳过
    const result = validator.validate({ x: shared, y: shared }, schema)

    expect(result.valid).toBe(false)
    expect(result.errors?.some((e) => e.context?.path === 'y.a')).toBe(true)
  })

  it('REGR-VALIDATOR-002: schema 属性顺序翻转后共享引用错误仍应被拦截（消除顺序依赖）', () => {
    const shared = { a: 'hello' }
    const schema: TypeSchema = {
      type: 'object',
      properties: {
        x: { type: 'object', properties: { a: { type: 'string' } } },
        y: { type: 'object', properties: { a: { type: 'number' } } },
      },
    }

    const result = validator.validate({ x: shared, y: shared }, schema)

    expect(result.valid).toBe(false)
    expect(result.errors?.some((e) => e.context?.path === 'y.a')).toBe(true)
  })

  it('REGR-VALIDATOR-003: 循环引用不应栈溢出也不应重复报错', () => {
    const cyc: { name?: string; self?: unknown } = { name: 'ok' }
    cyc.self = cyc
    const schema: TypeSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        self: { type: 'object', properties: { name: { type: 'string' }, self: { type: 'any' } } },
      },
    }

    // 回边（true 循环）仍短路：不栈溢出、不重复报错
    const result = validator.validate(cyc, schema)

    expect(result.valid).toBe(true)
    expect(result.errors ?? []).toHaveLength(0)
  })
})
