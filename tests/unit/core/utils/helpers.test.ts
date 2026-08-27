/**
 * GeomStore v1.0.0 - 工具函数测试
 * @file tests/unit/helpers/helpers.test.ts
 */

import { isObject, isPlainObject, isFunction, isArray, isPromise, shallowEqual, deepEqual, deepMerge, get, set, noop, identity, uniqueId, clone } from '@/index'

describe('Helpers - 工具函数', () => {
  describe('类型判断函数', () => {
    describe('isObject', () => {
      it('HELPERS-001: 应该识别普通对象', () => {
        expect(isObject({})).toBe(true)
        expect(isObject({ a: 1 })).toBe(true)
        expect(isObject({ nested: { deep: true } })).toBe(true)
      })

      it('HELPERS-002: 不应该识别null', () => {
        expect(isObject(null)).toBe(false)
      })

      it('HELPERS-003: 不应该识别数组', () => {
        expect(isObject([])).toBe(false)
        expect(isObject([1, 2, 3])).toBe(false)
      })

      it('HELPERS-004: 不应该识别原始类型', () => {
        expect(isObject('string')).toBe(false)
        expect(isObject(123)).toBe(false)
        expect(isObject(true)).toBe(false)
        expect(isObject(undefined)).toBe(false)
      })

      it('HELPERS-005: 不应该识别函数', () => {
        expect(isObject(() => {})).toBe(false)
        expect(isObject(function () {})).toBe(false)
      })
    })

    describe('isPlainObject', () => {
      it('HELPERS-006: 应该识别纯对象', () => {
        expect(isPlainObject({})).toBe(true)
        expect(isPlainObject({ a: 1 })).toBe(true)
        expect(isPlainObject(Object.create(null))).toBe(true)
      })

      it('HELPERS-007: 不应该识别null', () => {
        expect(isPlainObject(null)).toBe(false)
      })

      it('HELPERS-008: 不应该识别数组', () => {
        expect(isPlainObject([])).toBe(false)
      })

      it('HELPERS-009: 不应该识别函数', () => {
        expect(isPlainObject(() => {})).toBe(false)
      })

      it('HELPERS-010: 不应该识别构造函数创建的实例', () => {
        class Test {}
        expect(isPlainObject(new Test())).toBe(false)
        expect(isPlainObject(new Date())).toBe(false)
        expect(isPlainObject(/regex/)).toBe(false)
      })
    })

    describe('isFunction', () => {
      it('HELPERS-011: 应该识别函数', () => {
        expect(isFunction(() => {})).toBe(true)
        expect(isFunction(function () {})).toBe(true)
        expect(isFunction(function* () {})).toBe(true)
        expect(isFunction(async () => {})).toBe(true)
      })

      it('HELPERS-012: 不应该识别非函数', () => {
        expect(isFunction({})).toBe(false)
        expect(isFunction([])).toBe(false)
        expect(isFunction('string')).toBe(false)
        expect(isFunction(123)).toBe(false)
        expect(isFunction(null)).toBe(false)
        expect(isFunction(undefined)).toBe(false)
      })
    })

    describe('isArray', () => {
      it('HELPERS-013: 应该识别数组', () => {
        expect(isArray([])).toBe(true)
        expect(isArray([1, 2, 3])).toBe(true)
        expect(isArray(['a', 'b', 'c'])).toBe(true)
        expect(isArray([{}])).toBe(true)
      })

      it('HELPERS-014: 不应该识别非数组', () => {
        expect(isArray({})).toBe(false)
        expect(isArray(null)).toBe(false)
        expect(isArray('string')).toBe(false)
        expect(isArray(123)).toBe(false)
      })
    })

    describe('isPromise', () => {
      it('HELPERS-015: 应该识别Promise', () => {
        expect(isPromise(Promise.resolve())).toBe(true)
        // 忽略rejection以避免unhandled promise rejection
        const rejected = Promise.reject()
        rejected.catch(() => {})
        expect(isPromise(rejected)).toBe(true)
        expect(isPromise(new Promise(() => {}))).toBe(true)
      })

      it('HELPERS-016: 应该识别thenable对象', () => {
        const thenable = {
          then: jest.fn(),
        }
        expect(isPromise(thenable)).toBe(true)
      })

      it('HELPERS-017: 不应该识别非Promise', () => {
        expect(isPromise({})).toBe(false)
        expect(isPromise({ then: 'not a function' })).toBe(false)
        expect(isPromise(null)).toBe(false)
        expect(isPromise(undefined)).toBe(false)
        expect(isPromise('string')).toBe(false)
      })
    })
  })

  describe('对象操作函数', () => {
    describe('shallowEqual', () => {
      it('HELPERS-018: 相同引用应该返回true', () => {
        const obj = { a: 1 }
        expect(shallowEqual(obj, obj)).toBe(true)
      })

      it('HELPERS-019: 相同值的对象应该返回true', () => {
        expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true)
        expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true)
      })

      it('HELPERS-020: 不同值的对象应该返回false', () => {
        expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false)
        expect(shallowEqual({ a: 1 }, { b: 1 })).toBe(false)
        expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false)
      })

      it('HELPERS-021: 不同key数量的对象应该返回false', () => {
        expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
        expect(shallowEqual({ a: 1, b: 2, c: 3 }, { a: 1, b: 2 })).toBe(false)
      })

      it('HELPERS-022: null和undefined的比较', () => {
        expect(shallowEqual(null, null)).toBe(true)
        expect(shallowEqual(undefined, undefined)).toBe(true)
        expect(shallowEqual(null, undefined)).toBe(false)
      })

      it('HELPERS-023: 原始值的比较', () => {
        expect(shallowEqual(1, 1)).toBe(true)
        expect(shallowEqual('string', 'string')).toBe(true)
        expect(shallowEqual(true, true)).toBe(true)
        expect(shallowEqual(1, 2)).toBe(false)
      })

      it('HELPERS-024: 深度嵌套对象的比较应该是浅比较', () => {
        const obj1 = { a: { b: 1 } }
        const obj2 = { a: { b: 1 } }
        expect(shallowEqual(obj1, obj2)).toBe(false) // 引用不同
      })
    })

    describe('deepEqual', () => {
      it('HELPERS-025: 相同引用应该返回true', () => {
        const obj = { a: { b: 1 } }
        expect(deepEqual(obj, obj)).toBe(true)
      })

      it('HELPERS-026: 深度相同的对象应该返回true', () => {
        expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true)
        expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true)
        expect(deepEqual({ a: { b: { c: 1 } } }, { a: { b: { c: 1 } } })).toBe(true)
      })

      it('HELPERS-027: 深度不同的对象应该返回false', () => {
        expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
        expect(deepEqual({ a: { b: 1 } }, { a: { c: 1 } })).toBe(false)
      })

      it('HELPERS-028: 数组的深度比较', () => {
        expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
        expect(deepEqual([1, { a: 2 }], [1, { a: 2 }])).toBe(true)
        expect(deepEqual([1, 2, 3], [1, 2, 4])).toBe(false)
      })

      it('HELPERS-029: null和undefined的比较', () => {
        expect(deepEqual(null, null)).toBe(true)
        expect(deepEqual(undefined, undefined)).toBe(true)
        expect(deepEqual(null, undefined)).toBe(false)
      })

      it('HELPERS-030: 原始值的比较', () => {
        expect(deepEqual(1, 1)).toBe(true)
        expect(deepEqual('string', 'string')).toBe(true)
        expect(deepEqual(true, true)).toBe(true)
      })

      it('HELPERS-031: 深度超过限制时应该回退到浅比较', () => {
        // 构造深度超过MAX_DEPTH的对象
        let obj1: any = { value: 1 }
        let obj2: any = { value: 1 }
        for (let i = 0; i < 1001; i++) {
          obj1 = { nested: obj1 }
          obj2 = { nested: obj2 }
        }

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
        deepEqual(obj1, obj2)
        expect(consoleSpy).toHaveBeenCalled()
        consoleSpy.mockRestore()
      })
    })

    describe('deepMerge', () => {
      it('HELPERS-032: 应该合并两个对象', () => {
        const target = { a: 1, b: 2 }
        const source = { c: 3, d: 4 }
        const result = deepMerge(target, source as any)

        expect(result).toEqual({ a: 1, b: 2, c: 3, d: 4 })
      })

      it('HELPERS-033: source应该覆盖target的同名属性', () => {
        const target = { a: 1, b: 2 }
        const source = { b: 20, c: 3 }
        const result = deepMerge(target, source)

        expect(result).toEqual({ a: 1, b: 20, c: 3 })
      })

      it('HELPERS-034: 应该深度合并嵌套对象', () => {
        const target = { a: { b: 1, c: 2 } }
        const source = { a: { c: 20, d: 3 } }
        const result = deepMerge(target, source as any)

        expect(result).toEqual({ a: { b: 1, c: 20, d: 3 } })
      })

      it('HELPERS-035: 应该合并多个source', () => {
        const target = { a: 1 }
        const source1 = { b: 2 }
        const source2 = { c: 3 }
        const source3 = { d: 4 }
        const result = deepMerge(target, source1 as any, source2 as any, source3 as any)

        expect(result).toEqual({ a: 1, b: 2, c: 3, d: 4 })
      })

      it('HELPERS-036: 空source不应该修改target', () => {
        const target = { a: 1, b: 2 }
        const result = deepMerge(target)

        expect(result).toEqual({ a: 1, b: 2 })
      })

      it('HELPERS-037: 应该原地修改target', () => {
        const target = { a: 1 }
        const source = { b: 2 }
        const result = deepMerge(target, source as any)

        expect(result).toBe(target)
        expect(target).toEqual({ a: 1, b: 2 })
      })

      it('HELPERS-COV-028: 合并数组属性时应深拷贝避免共享引用', () => {
        const arr = [1, { nested: true }]
        const result = deepMerge<{ arr?: unknown[] }>({}, { arr })

        expect(result.arr).toEqual(arr)
        expect(result.arr).not.toBe(arr)
        expect((result.arr as unknown[])[1]).not.toBe(arr[1])
      })

      it('HELPERS-COV-029: 合并 Map/Set 属性时应深拷贝为独立实例', () => {
        const map = new Map([['k', 'v']])
        const set = new Set([1, 2])
        const result = deepMerge<{ map?: Map<string, string>; set?: Set<number> }>({}, { map, set })

        expect(result.map).toEqual(map)
        expect(result.map).not.toBe(map)
        expect(result.set).toEqual(set)
        expect(result.set).not.toBe(set)
      })
    })
  })

  describe('路径操作函数', () => {
    describe('get', () => {
      it('HELPERS-038: 应该获取属性值', () => {
        const obj = { a: 1, b: 2 }
        expect(get(obj, 'a')).toBe(1)
        expect(get(obj, 'b')).toBe(2)
      })

      it('HELPERS-039: 应该获取嵌套属性值', () => {
        const obj = { a: { b: { c: 1 } } }
        expect(get(obj, 'a.b.c')).toBe(1)
      })

      it('HELPERS-040: 路径不存在时应该返回undefined', () => {
        const obj = { a: 1 }
        expect(get(obj, 'b')).toBeUndefined()
      })

      it('HELPERS-041: 嵌套路径不存在时应该返回undefined', () => {
        const obj = { a: { b: 1 } }
        expect(get(obj, 'a.c')).toBeUndefined()
      })

      it('HELPERS-042: 应该支持默认值', () => {
        const obj = { a: 1 }
        expect(get(obj, 'b', 'default')).toBe('default')
        expect(get(obj, 'a', 'default')).toBe(1)
      })

      it('HELPERS-043: 空路径应该返回默认值', () => {
        const obj = { a: 1 }
        expect(get(obj, '', 'default')).toBe('default')
        expect(get(obj, '   ', 'default')).toBe('default')
      })

      it('HELPERS-044: null或undefined对象应该返回默认值', () => {
        expect(get(null, 'a', 'default')).toBe('default')
        expect(get(undefined, 'a', 'default')).toBe('default')
      })
    })

    describe('set', () => {
      it('HELPERS-045: 应该设置属性值', () => {
        const obj: any = {}
        set(obj, 'a', 1)
        expect(obj.a).toBe(1)
      })

      it('HELPERS-046: 应该设置嵌套属性值', () => {
        const obj: any = {}
        set(obj, 'a.b.c', 1)
        expect(obj.a.b.c).toBe(1)
      })

      it('HELPERS-047: 应该创建中间对象', () => {
        const obj: any = {}
        set(obj, 'a.b', 1)
        expect(obj.a).toBeDefined()
        expect(obj.a.b).toBe(1)
      })

      it('HELPERS-048: 应该覆盖已存在的值', () => {
        const obj: any = { a: { b: 1 } }
        set(obj, 'a.b', 2)
        expect(obj.a.b).toBe(2)
      })

      it('HELPERS-049: 空路径应该不执行操作', () => {
        const obj: any = { a: 1 }
        set(obj, '', 2)
        expect(obj.a).toBe(1)
      })

      it('HELPERS-050: null或undefined对象应该不执行操作', () => {
        expect(() => {
          set(null as any, 'a', 1)
        }).not.toThrow()

        expect(() => {
          set(undefined as any, 'a', 1)
        }).not.toThrow()
      })

      it('HELPERS-051: 应该支持设置不同类型的值', () => {
        const obj: any = {}
        set(obj, 'a', 1)
        set(obj, 'b', 'string')
        set(obj, 'c', true)
        set(obj, 'd', { nested: true })
        set(obj, 'e', [1, 2, 3])

        expect(obj.a).toBe(1)
        expect(obj.b).toBe('string')
        expect(obj.c).toBe(true)
        expect(obj.d).toEqual({ nested: true })
        expect(obj.e).toEqual([1, 2, 3])
      })
    })
  })

  describe('其他工具函数', () => {
    describe('noop', () => {
      it('HELPERS-052: noop应该是一个空函数', () => {
        expect(noop()).toBeUndefined()
        expect(() => noop()).not.toThrow()
      })
    })

    describe('identity', () => {
      it('HELPERS-053: identity应该返回传入的参数', () => {
        expect(identity(1)).toBe(1)
        expect(identity('string')).toBe('string')
        expect(identity({ a: 1 })).toEqual({ a: 1 })
        expect(identity(null)).toBe(null)
        expect(identity(undefined)).toBe(undefined)
      })
    })

    describe('uniqueId', () => {
      it('HELPERS-054: uniqueId应该生成唯一ID', () => {
        const id1 = uniqueId()
        const id2 = uniqueId()
        const id3 = uniqueId()

        expect(id1).not.toBe(id2)
        expect(id2).not.toBe(id3)
        expect(id1).not.toBe(id3)
      })

      it('HELPERS-055: uniqueId应该支持前缀', () => {
        const id = uniqueId('prefix-')
        expect(id).toMatch(/^prefix-\d+_[a-z0-9]+$/)
      })

      it('HELPERS-056: uniqueId应该是数字递增的', () => {
        const id1 = uniqueId()
        const id2 = uniqueId()
        const id3 = uniqueId()

        // ID应该是递增的数字
        const num1 = parseInt(id1)
        const num2 = parseInt(id2)
        const num3 = parseInt(id3)

        expect(num2).toBe(num1 + 1)
        expect(num3).toBe(num2 + 1)
      })
    })
  })

  describe('克隆函数', () => {
    describe('clone - 基本功能', () => {
      it('HELPERS-057: 应该克隆对象', () => {
        const obj = { a: 1, b: 2 }
        const cloned = clone(obj)

        expect(cloned).toEqual(obj)
        expect(cloned).not.toBe(obj)
      })

      it('HELPERS-058: 应该克隆数组', () => {
        const arr = [1, 2, 3]
        const cloned = clone(arr)

        expect(cloned).toEqual(arr)
        expect(cloned).not.toBe(arr)
      })

      it('HELPERS-059: 应该深度克隆嵌套对象', () => {
        const obj = { a: { b: { c: 1 } } }
        const cloned = clone(obj)

        expect(cloned).toEqual(obj)
        expect(cloned).not.toBe(obj)
        expect(cloned.a).not.toBe(obj.a)
        expect(cloned.a.b).not.toBe(obj.a.b)
      })

      it('HELPERS-060: 应该克隆null和undefined', () => {
        expect(clone(null)).toBe(null)
        expect(clone(undefined)).toBe(undefined)
      })

      it('HELPERS-061: 应该克隆原始值', () => {
        expect(clone(1)).toBe(1)
        expect(clone('string')).toBe('string')
        expect(clone(true)).toBe(true)
      })
    })

    describe('clone - 选项', () => {
      it('HELPERS-062: shallow 模式应该是浅克隆', () => {
        const obj = { a: { b: 1 } }
        const cloned = clone(obj, { mode: 'shallow' })

        expect(cloned).toEqual(obj)
        expect(cloned).not.toBe(obj)
        expect(cloned.a).toBe(obj.a) // 嵌套对象是同一个引用
      })

      it('HELPERS-063: json 模式应该使用 JSON 序列化（旧 safe 语义）', () => {
        const obj = { a: 1, b: { c: 2 } }
        const cloned = clone(obj, { mode: 'json' })

        expect(cloned).toEqual(obj)
        expect(cloned).not.toBe(obj)
      })

      it('HELPERS-063b: safe 模式应保真克隆 Date/Map/Set（不再 JSON 化）', () => {
        const obj = { date: new Date(2024, 0, 1), map: new Map([['k', 1]]), set: new Set([1, 2]) }
        const cloned = clone(obj, { mode: 'safe' })

        expect(cloned).not.toBe(obj)
        expect(cloned.date).toEqual(new Date(2024, 0, 1))
        expect(cloned.date).toBeInstanceOf(Date) // json 模式会退化成字符串
        expect(cloned.map).toBeInstanceOf(Map)
        expect(cloned.set).toBeInstanceOf(Set)
      })

      it('HELPERS-063c: safe 模式应支持循环引用（克隆器原生支持，无需降级）', () => {
        const obj: Record<string, unknown> = { a: 1 }
        obj.self = obj
        const cloned = clone(obj, { mode: 'safe' })

        expect(cloned).not.toBe(obj)
        expect((cloned as Record<string, unknown>).self).toBe(cloned)
      })

      it('HELPERS-063d: 旧选项 deep/safe 发出废弃告警', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
        try {
          clone({ a: 1 }, { deep: true })
          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('已废弃'))
        } finally {
          warnSpy.mockRestore()
        }
      })

      it('HELPERS-063e: safe 模式深拷贝失败时降级返回原引用并告警', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation()
        try {
          // ownKeys 陷阱：instanceof 检查不触发（走原型链），
          // 错误发生在 deepCloneState 内部的 Object.keys，被 safe catch 捕获
          const hostile = new Proxy(
            { a: 1 },
            {
              ownKeys: () => {
                throw new Error('ownKeys boom')
              },
            },
          )
          const result = clone(hostile, { mode: 'safe' })
          expect(result).toBe(hostile)
          // console.warn 带两个参数（消息 + 原始错误）
          expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('降级返回原引用'), expect.any(Error))
        } finally {
          warnSpy.mockRestore()
        }
      })

      it('HELPERS-064: json 模式遇到循环引用应返回原引用', () => {
        const obj: any = { a: 1 }
        obj.self = obj

        const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
        const cloned = clone(obj, { mode: 'json' })

        // JSON序列化会抛出错误，应该返回原对象
        expect(cloned).toBe(obj)

        consoleSpy.mockRestore()
      })
    })

    describe('clone - 边界条件', () => {
      it('HELPERS-065: 应该克隆空对象', () => {
        const obj = {}
        const cloned = clone(obj)

        expect(cloned).toEqual({})
        expect(cloned).not.toBe(obj)
      })

      it('HELPERS-066: 应该克隆空数组', () => {
        const arr: unknown[] = []
        const cloned = clone(arr)

        expect(cloned).toEqual([])
        expect(cloned).not.toBe(arr)
      })

      it('HELPERS-067: 应该克隆包含各种类型的对象', () => {
        const obj = {
          number: 1,
          string: 'test',
          boolean: true,
          null: null,
          undefined: undefined,
          array: [1, 2, 3],
          object: { a: 1 },
        }
        const cloned = clone(obj)

        expect(cloned).toEqual(obj)
        expect(cloned).not.toBe(obj)
      })

      it('HELPERS-068: 深层嵌套对象应完整克隆（无深度限制）', () => {
        let obj: any = { value: 1 }
        for (let i = 0; i < 1001; i++) {
          obj = { nested: obj }
        }

        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
        const cloned = clone(obj)
        expect(consoleSpy).not.toHaveBeenCalled()
        consoleSpy.mockRestore()

        // 递归克隆（带循环引用守卫）无深度限制：应得到独立的全新结构
        expect(cloned).toEqual(obj)
        expect(cloned).not.toBe(obj)

        // 穿透到最深层验证独立性
        let originalCursor: any = obj
        let clonedCursor: any = cloned
        for (let i = 0; i < 1001; i++) {
          originalCursor = originalCursor.nested
          clonedCursor = clonedCursor.nested
        }
        expect(clonedCursor.value).toBe(1)
        expect(clonedCursor).not.toBe(originalCursor)
      })
    })
  })

  // ==================== 覆盖率补全测试 ====================

  describe('覆盖率补全 - deepEqual 边界条件', () => {
    it('HELPERS-COV-001: null和对象的比较应该返回false', () => {
      expect(deepEqual(null, { a: 1 })).toBe(false)
      expect(deepEqual({ a: 1 }, null)).toBe(false)
    })

    it('HELPERS-COV-002: undefined和对象的比较应该返回false', () => {
      expect(deepEqual(undefined, { a: 1 })).toBe(false)
      expect(deepEqual({ a: 1 }, undefined)).toBe(false)
    })

    it('HELPERS-COV-003: 类型不同的值应该返回false', () => {
      expect(deepEqual('string', 123)).toBe(false)
      expect(deepEqual(true, 'true')).toBe(false)
    })

    it('HELPERS-COV-004: 基本类型不相等应该返回false', () => {
      expect(deepEqual(1, 2)).toBe(false)
      expect(deepEqual('a', 'b')).toBe(false)
    })

    it('HELPERS-COV-005: 数组和对象的比较应该返回false', () => {
      expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false)
      expect(deepEqual({ 0: 1, 1: 2 }, [1, 2])).toBe(false)
    })

    it('HELPERS-COV-006: 键数量不同的对象应该返回false', () => {
      expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
      expect(deepEqual({ a: 1, b: 2, c: 3 }, { a: 1, b: 2 })).toBe(false)
    })

    it('HELPERS-COV-007: 键存在但值不同的对象应该返回false', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, c: 3 })).toBe(false)
    })

    it('HELPERS-COV-008: 循环引用对象的比较应该正确处理', () => {
      const obj1: any = { a: 1 }
      obj1.self = obj1
      const obj2: any = { a: 1 }
      obj2.self = obj2
      expect(deepEqual(obj1, obj2)).toBe(true)
    })

    it('HELPERS-COV-009: 空数组的比较应该返回true', () => {
      expect(deepEqual([], [])).toBe(true)
    })
  })

  describe('覆盖率补全 - deepMerge 边界条件', () => {
    it('HELPERS-COV-010: source中嵌套对象在target中不存在时应该创建', () => {
      const target: any = { a: 1 }
      const source = { b: { c: 2 } }
      const result = deepMerge(target, source)
      expect(result.b).toEqual({ c: 2 })
    })

    it('HELPERS-COV-011: source中非对象值应该直接赋值', () => {
      const target: any = { a: 1 }
      const source = { b: 'string', c: 123, d: true, e: null }
      const result = deepMerge(target, source)
      expect(result.b).toBe('string')
      expect(result.c).toBe(123)
      expect(result.d).toBe(true)
      expect(result.e).toBe(null)
    })

    it('HELPERS-COV-012: source为undefined时应该不修改target', () => {
      const target: any = { a: 1 }
      const result = deepMerge(target, undefined as any)
      expect(result).toEqual({ a: 1 })
    })

    it('HELPERS-COV-013: source为null时应该不修改target', () => {
      const target: any = { a: 1 }
      const result = deepMerge(target, null as any)
      expect(result).toEqual({ a: 1 })
    })

    it('HELPERS-COV-014: target为非对象时应该正常处理', () => {
      // target 不是 isObject 的对象时，source 的处理路径不同
      const target: any = [1, 2, 3]
      const source = { a: 1 }
      const result = deepMerge(target, source)
      // 数组不是 isObject，所以不会合并，但 result 仍然是 target
      expect(result).toBe(target)
    })
  })

  describe('覆盖率补全 - get 异常处理', () => {
    it('HELPERS-COV-015: get在遍历过程中抛出异常应该返回默认值', () => {
      // 使用一个会抛出异常的 proxy 对象
      const obj = new Proxy(
        { a: 1 },
        {
          get() {
            throw new Error('Proxy error')
          },
        },
      )
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const result = get(obj, 'a', 'default')
      expect(result).toBe('default')
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('覆盖率补全 - set 异常处理', () => {
    it('HELPERS-COV-016: set在设置过程中抛出异常应该被捕获', () => {
      // set 经 defineOwnProperty（Object.defineProperty 语义）写入，在 defineProperty 陷阱中抛错
      const obj = new Proxy({} as any, {
        defineProperty() {
          throw new Error('Proxy defineProperty error')
        },
      })
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      expect(() => set(obj, 'a', 1)).not.toThrow()
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('HELPERS-COV-017: set在空字符串路径上应该不执行操作', () => {
      const obj: any = { a: 1 }
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()
      set(obj, '  ', 2)
      expect(obj.a).toBe(1)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('HELPERS-COV-018 (BUG 回归): set中间路径为原始值时应放弃写入并保留原值', () => {
      const obj: any = { a: 1, list: [5] }
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      // 修复前：原始值被静默替换为 {}（a: 1 → {b: 2}，list[0]: 5 → 对象），破坏既有数据
      set(obj, 'a.b', 2)
      expect(obj.a).toBe(1)

      set(obj, 'list.0.done', true)
      expect(obj.list[0]).toBe(5)
      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('HELPERS-COV-018b: set中间路径为 null/缺失时仍应创建路径对象', () => {
      const obj: any = { a: null }
      set(obj, 'a.b', 2)
      expect(obj.a).toEqual({ b: 2 })

      set(obj, 'c.d', 3)
      expect(obj.c).toEqual({ d: 3 })
    })
  })

  describe('覆盖率补全 - clone 特殊类型', () => {
    it('HELPERS-COV-019: clone应该正确克隆Date对象', () => {
      const date = new Date('2024-01-01')
      const cloned = clone(date)
      expect(cloned).toEqual(date)
      expect(cloned).not.toBe(date)
      expect(cloned instanceof Date).toBe(true)
    })

    it('HELPERS-COV-020: clone应该正确克隆RegExp对象', () => {
      const regex = /test/gi
      const cloned = clone(regex)
      expect(cloned).toEqual(regex)
      expect(cloned).not.toBe(regex)
      expect(cloned instanceof RegExp).toBe(true)
      expect(cloned.flags).toBe('gi')
    })

    it('HELPERS-COV-021: clone浅克隆应该正确处理Date对象', () => {
      const date = new Date('2024-01-01')
      const cloned = clone(date, { mode: 'shallow' })
      expect(cloned).toEqual(date)
      expect(cloned).not.toBe(date)
    })

    it('HELPERS-COV-022: clone浅克隆应该正确处理RegExp对象', () => {
      const regex = /pattern/g
      const cloned = clone(regex, { mode: 'shallow' })
      expect(cloned).toEqual(regex)
      expect(cloned).not.toBe(regex)
    })

    it('HELPERS-COV-023: clone深克隆应该递归处理Date', () => {
      const obj = { date: new Date('2024-01-01') }
      const cloned = clone(obj)
      expect(cloned.date).toEqual(obj.date)
      expect(cloned.date).not.toBe(obj.date)
      expect(cloned.date instanceof Date).toBe(true)
    })

    it('HELPERS-COV-024: clone深克隆应该递归处理RegExp', () => {
      const obj = { regex: /test/g }
      const cloned = clone(obj)
      expect(cloned.regex).toEqual(obj.regex)
      expect(cloned.regex).not.toBe(obj.regex)
      expect(cloned.regex instanceof RegExp).toBe(true)
    })

    it('HELPERS-COV-025: clone深克隆应该递归处理嵌套数组中的对象', () => {
      const obj = { items: [{ a: 1 }, { b: { c: 2 } }] }
      const cloned = clone(obj)
      expect(cloned).toEqual(obj)
      expect(cloned.items).not.toBe(obj.items)
      expect(cloned.items[0]).not.toBe(obj.items[0])
      expect(cloned.items[1].b).not.toBe(obj.items[1].b)
    })

    it('HELPERS-COV-026: clone浅克隆数组应该返回新数组', () => {
      const arr = [1, 2, 3]
      const cloned = clone(arr, { mode: 'shallow' })
      expect(cloned).toEqual(arr)
      expect(cloned).not.toBe(arr)
      expect(Array.isArray(cloned)).toBe(true)
    })

    it('HELPERS-COV-027: clone非纯对象（自定义原型）应保留原引用', () => {
      // 创建一个有自定义原型的对象（非纯对象）
      const proto = { inherited: 'shared-proto' }
      const obj: Record<string, unknown> = Object.create(proto)
      obj.own = 'own-value'

      // 自定义原型对象无法安全克隆，保留原引用（与 deepCloneState 语义一致）
      const cloned = clone(obj)
      expect(cloned).toBe(obj)
      expect(cloned.own).toBe('own-value')
      expect(cloned.inherited).toBe('shared-proto')
    })

    it('HELPERS-COV-030: clone浅克隆 Map/Set 应返回独立实例', () => {
      const map = new Map([['k', 'v']])
      const set = new Set([1, 2])

      const clonedMap = clone(map, { mode: 'shallow' })
      const clonedSet = clone(set, { mode: 'shallow' })

      expect(clonedMap).toEqual(map)
      expect(clonedMap).not.toBe(map)
      expect(clonedSet).toEqual(set)
      expect(clonedSet).not.toBe(set)
    })
  })

  describe('回归 - deepEqual 内建类型内容比较', () => {
    it('REGR-HELPER-001: 内容不同的 Date 应不相等', () => {
      expect(deepEqual(new Date('2024-01-01'), new Date('2024-01-02'))).toBe(false)
      expect(deepEqual(new Date('2024-01-01'), new Date('2024-01-01'))).toBe(true)
    })

    it('REGR-HELPER-002: 内容不同的 RegExp 应不相等', () => {
      expect(deepEqual(/abc/gi, /abc/g)).toBe(false)
      expect(deepEqual(/abc/gi, /abc/gi)).toBe(true)
    })

    it('REGR-HELPER-003: 内容不同的 Map 应不相等', () => {
      expect(deepEqual(new Map([['a', 1]]), new Map([['a', 2]]))).toBe(false)
      expect(deepEqual(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(true)
      expect(deepEqual(new Map([['a', 1]]), new Map([['b', 1]]))).toBe(false)
    })

    it('REGR-HELPER-004: 内容不同的 Set 应不相等', () => {
      expect(deepEqual(new Set([1, 2]), new Set([1, 3]))).toBe(false)
      expect(deepEqual(new Set([1, 2]), new Set([1, 2]))).toBe(true)
      expect(deepEqual(new Set([1]), new Set([1, 2]))).toBe(false)
    })

    it('REGR-HELPER-004b: Set 比较应与插入顺序无关（集合语义）', () => {
      // 原始值：不同插入顺序仍应相等
      expect(deepEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true)
      expect(deepEqual(new Set([NaN]), new Set([NaN]))).toBe(true)
      // 对象元素：不同插入顺序仍应相等
      expect(deepEqual(new Set([{ a: 1 }, { b: 2 }]), new Set([{ b: 2 }, { a: 1 }]))).toBe(true)
      // 内容不同的对象元素仍应不相等
      expect(deepEqual(new Set([{ a: 1 }, { b: 2 }]), new Set([{ a: 1 }, { b: 3 }]))).toBe(false)
    })

    it('REGR-HELPER-005: Date 与普通对象比较应不相等', () => {
      expect(deepEqual(new Date(0), {})).toBe(false)
      expect(deepEqual({}, new Map())).toBe(false)
    })

    it('REGR-HELPER-006: NaN 应视为相等（SameValueZero）', () => {
      expect(deepEqual(NaN, NaN)).toBe(true)
      expect(deepEqual(NaN, 1)).toBe(false)
    })
  })

  describe('回归 - deepMerge 原型污染与类型冲突', () => {
    it('REGR-HELPER-006: __proto__ 键不应污染原型', () => {
      const target: any = {}
      const source = JSON.parse('{"__proto__": {"polluted": true}}')
      deepMerge(target, source)
      expect(({} as any).polluted).toBeUndefined()
      expect((Object.prototype as any).polluted).toBeUndefined()
      // 作为普通自有属性写入
      expect(target.__proto__).toEqual({ polluted: true })
    })

    it('REGR-HELPER-007: constructor 键不应改写原型 constructor', () => {
      const target: any = {}
      const source = JSON.parse('{"constructor": {"polluted": true}}')
      deepMerge(target, source)
      expect((Object.prototype as any).polluted).toBeUndefined()
      expect(target.constructor).toEqual({ polluted: true })
    })

    it('REGR-HELPER-008: 类型冲突时应整体替换而非静默丢弃', () => {
      const target: any = { a: 1 }
      deepMerge(target, { a: { b: 2 } })
      expect(target.a).toEqual({ b: 2 })

      const target2: any = { a: null }
      deepMerge(target2, { a: { b: 3 } })
      expect(target2.a).toEqual({ b: 3 })
    })

    it('REGR-HELPER-009: source 为 Map/Set 时应替换为独立实例', () => {
      const target: any = { a: 1 }
      const map = new Map([['k', 'v']])
      deepMerge(target, { a: map })
      expect(target.a).toBeInstanceOf(Map)
      expect(target.a.get('k')).toBe('v')
      expect(target.a).not.toBe(map)
    })

    it('REGR-HELPER-010: set 路径段不应通过 __proto__ 污染原型', () => {
      const obj: any = {}
      set(obj, '__proto__.polluted', true)
      // Object.prototype 未被污染
      expect((Object.prototype as any).polluted).toBeUndefined()
      // __proto__ 被遮蔽为自有数据属性（值为 { polluted: true }），原型链未被改动
      expect(obj.__proto__.polluted).toBe(true)
      expect(Object.getPrototypeOf(obj)).toBe(Object.prototype)
    })
  })
})

describe('Helpers - BUG-5: get 不应命中原型链属性', () => {
  it('HELPERS-BUG5-001: 原型链上的属性应返回默认值', () => {
    expect(get({}, 'toString', 'dft')).toBe('dft')
    expect(get(Object.create({ a: 1 }), 'a', 'dft')).toBe('dft')
  })

  it('HELPERS-BUG5-002: 自有属性仍正常读取', () => {
    expect(get({ a: 1 }, 'a', 'dft')).toBe(1)
    expect(get({ a: { b: 2 } }, 'a.b', 'dft')).toBe(2)
  })
})

describe('shallowEqual 内建对象内容比较（P1 回归）', () => {
  it('内容不同的 Date 应判不相等（修复前恒判相等）', () => {
    expect(shallowEqual(new Date(1), new Date(2))).toBe(false)
    expect(shallowEqual(new Date(1000), new Date(1000))).toBe(true)
  })

  it('内容不同的 Map/Set 应判不相等', () => {
    expect(shallowEqual(new Map([['a', 1]]), new Map())).toBe(false)
    expect(shallowEqual(new Map([['a', 1]]), new Map([['a', 1]]))).toBe(true)
    expect(shallowEqual(new Set([1]), new Set([2]))).toBe(false)
    expect(shallowEqual(new Set([1, 2]), new Set([2, 1]))).toBe(true)
  })

  it('内容不同的 RegExp 应判不相等', () => {
    expect(shallowEqual(/ab/g, /ab/i)).toBe(false)
    expect(shallowEqual(/ab/g, /ab/g)).toBe(true)
  })
})

// ==================== #18 deepMerge 循环引用防护回归 ====================
describe('deepMerge 循环引用防护', () => {
  it('source 自引用时合并终止且数据完整', () => {
    const source: Record<string, unknown> = { a: { x: 1 } }
    ;(source.a as Record<string, unknown>).self = source.a

    const target: Record<string, unknown> = {}
    expect(() => deepMerge(target, source as never)).not.toThrow()
    expect((target.a as Record<string, unknown>).x).toBe(1)
  })

  it('source 与 target 相互嵌套引用时不无限递归', () => {
    const target: Record<string, unknown> = { name: 't' }
    const source: Record<string, unknown> = { name: 's' }
    ;(target as Record<string, unknown>).link = source
    ;(source as Record<string, unknown>).back = target

    expect(() => deepMerge(target, source as never)).not.toThrow()
    expect(target.name).toBe('s')
  })

  it('菱形共享的源对象合并进不同目标不受防护影响', () => {
    const shared = { x: 1 }
    const source = { a: shared, b: shared }
    const target: Record<string, unknown> = {}

    deepMerge(target, source as never)
    expect((target.a as Record<string, unknown>).x).toBe(1)
    expect((target.b as Record<string, unknown>).x).toBe(1)
  })
})

// ==================== #18 回归补充：循环引用守卫短路分支 ====================
describe('deepMerge 循环引用守卫（#18 补充）', () => {
  it('HELPERS-CYCLE-001: source/target 互引时二次递归应被短路而非栈溢出', () => {
    const target: Record<string, unknown> = {}
    const source: Record<string, unknown> = { label: 'root' }
    // 构造「同一对 (source, target) 被再次递归合并」的最短路径：
    // 双方在同名键上互指自身，根层合并进行到 loop 键时会以相同对重入
    target.loop = target
    source.loop = source

    const merged = deepMerge(target, source as typeof target)
    expect(merged.label).toBe('root')
    // 引用保持：loop 槽位仍是目标自身（未触发无限递归/未拷贝出环）
    expect(merged.loop).toBe(merged)
  })
})

// ==================== BUG 回归：非纯对象源值与原型链判等 ====================
describe('deepMerge 非纯对象源值替换语义（BUG 回归）', () => {
  it('REGR-HELPER-011: Date 源值应整体替换而非静默保留旧值', () => {
    const target: Record<string, unknown> = { ts: new Date(1000) }
    const source = { ts: new Date(2000) }
    const result = deepMerge(target, source as never)
    expect((result.ts as Date).getTime()).toBe(2000)
    // 深拷贝为独立实例，不与 source 共享引用
    expect(result.ts).not.toBe(source.ts)
  })

  it('REGR-HELPER-012: RegExp 源值应整体替换', () => {
    const target: Record<string, unknown> = { pattern: /a/g }
    deepMerge(target, { pattern: /b/i } as never)
    expect((target.pattern as RegExp).source).toBe('b')
    expect((target.pattern as RegExp).flags).toBe('i')
  })

  it('REGR-HELPER-013: Date 与普通对象双向覆盖均应整体替换', () => {
    const target1: Record<string, unknown> = { a: { x: 1 } }
    deepMerge(target1, { a: new Date(3000) } as never)
    expect(target1.a).toBeInstanceOf(Date)
    expect((target1.a as Date).getTime()).toBe(3000)

    const target2: Record<string, unknown> = { a: new Date(1000) }
    deepMerge(target2, { a: { x: 1 } } as never)
    expect(target2.a).toEqual({ x: 1 })
  })

  it('REGR-HELPER-014: 类实例源值不应把数据合并进旧对象（应替换）', () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    const target: Record<string, unknown> = { p: { stale: true } }
    deepMerge(target, { p: new Point(1, 2) } as never)
    expect(target.p).toBeInstanceOf(Point)
    expect((target.p as unknown as Point).x).toBe(1)
    expect((target.p as unknown as Record<string, unknown>).stale).toBeUndefined()
  })
})

describe('shallowEqual/deepEqual 原型链键（BUG 回归）', () => {
  it('REGR-HELPER-015: b 侧同名键在原型上时 shallowEqual 不应误判相等', () => {
    const a = { z: 1 }
    const b = Object.assign(Object.create({ z: 1 }), { w: 2 })
    expect(shallowEqual(a, b)).toBe(false)
  })

  it('REGR-HELPER-016: deepEqual 不应通过 b 侧原型链取值', () => {
    const a = { a: 1 }
    const b = Object.assign(Object.create({ a: 1 }), { z: 5 })
    expect(deepEqual(a, b)).toBe(false)
  })

  it('自有键相同时仍应正常判相等', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(deepEqual({ a: { x: 1 } }, { a: { x: 1 } })).toBe(true)
  })
})
