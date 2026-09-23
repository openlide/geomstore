/**
 * 第五轮审查（ocrreview.md）分片 core-misc-p2 的回归锁 —— 克隆与比较侧
 *
 * 覆盖 R5-136 / R5-137 / R5-138 / R5-139 / R5-143 / R5-144 / R5-164 / R5-165 / R5-166。
 * 其中 R5-138 / R5-139 / R5-165 是文档口径项：用例锁定的是**写进文档的那条限制本身**
 * （共享引用、对象键 Map 克隆后不等），让文档无法在无人察觉时被代码改动推翻。
 */

import { deepCloneState } from '@/core/utils/clone.js'
import { deepEqual } from '@/core/utils/equality.js'
import { clone, deepMerge } from '@/core/utils/helpers.js'

const hasOwn = (target: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(target, key)

afterEach(() => {
  jest.restoreAllMocks()
})

// ==================== R5-136 数组克隆的结构 ====================

describe('R5-136 数组克隆保留空洞与附加属性', () => {
  it('空洞保持为空洞、length 保留，副本与源在 deepEqual 下等价', () => {
    const source = [1, undefined, 3]
    delete source[1]

    const cloned = deepCloneState(source)

    // 修复前逐位 push：空洞被补成值为 undefined 的实槽位，1 in clone 与源不一致
    expect(cloned.length).toBe(3)
    expect(hasOwn(cloned, '0')).toBe(true)
    expect(hasOwn(cloned, '1')).toBe(false)
    expect(hasOwn(cloned, '2')).toBe(true)
    expect(cloned[2]).toBe(3)
    expect(deepEqual(cloned, source)).toBe(true)
  })

  it('显式 undefined 槽位仍是自有属性（与空洞区分开）', () => {
    const source = [1, undefined, 3]

    const cloned = deepCloneState(source)

    expect(hasOwn(cloned, '1')).toBe(true)
    expect(deepEqual(cloned, source)).toBe(true)
  })

  it('非下标的自有可枚举属性被一并克隆（不再整体丢弃）', () => {
    const source: unknown[] & { meta?: { n: number } } = [{ n: 1 }]
    source.meta = { n: 2 }

    const cloned = deepCloneState(source)

    expect(cloned.meta).toEqual({ n: 2 })
    expect(cloned.meta).not.toBe(source.meta)
    expect(cloned[0]).not.toBe(source[0])
    expect(deepEqual(cloned, source)).toBe(true)
  })

  it('数组上的自有 __proto__ 键按自有数据属性复刻，副本原型不变', () => {
    const source: unknown[] = [1]
    Object.defineProperty(source, '__proto__', { value: { injected: true }, enumerable: true, writable: true, configurable: true })

    const cloned = deepCloneState(source)

    expect(Object.getPrototypeOf(cloned)).toBe(Array.prototype)
    expect(hasOwn(cloned, '__proto__')).toBe(true)
    expect((cloned as unknown as Record<string, unknown>).injected).toBeUndefined()
    expect(deepEqual(cloned, source)).toBe(true)
  })

  it('状态里嵌稀疏数组时 clone 快照与源仍等价（选择器/变更检测不再持续失配）', () => {
    const holey = [1, undefined, 3]
    delete holey[1]
    const state = { list: holey, nested: { matrix: [[1], [2, 3]] } }

    const cloned = deepCloneState(state)

    expect(deepEqual(cloned, state)).toBe(true)
    expect(cloned.list).not.toBe(state.list)
  })
})

// ==================== R5-137 内建类型子类 ====================

describe('R5-137 内建类型的子类实例保留原引用', () => {
  class MyMap extends Map<string, number> {
    extra = 7
    describe(): string {
      return 'my-map'
    }
  }
  class MySet extends Set<number> {
    tag = 'my-set'
  }
  class MyDate extends Date {
    label = 'my-date'
  }
  class MyRegExp extends RegExp {
    note = 'my-regexp'
  }
  class MyArray extends Array<number> {
    note = 'my-array'
  }

  it('子类实例不再被静默降级成基类副本：方法与自有字段都还在', () => {
    const map = new MyMap([['a', 1]])
    const set = new MySet([1])
    const date = new MyDate(1000)
    const regexp = new MyRegExp('ab', 'g')
    const arr = new MyArray(2)
    const state = { map, set, date, regexp, arr }

    const cloned = deepCloneState(state)

    expect(cloned.map).toBe(map)
    expect(cloned.map.describe()).toBe('my-map')
    expect(cloned.map.extra).toBe(7)
    expect(cloned.set).toBe(set)
    expect(cloned.set.tag).toBe('my-set')
    expect(cloned.date).toBe(date)
    expect(cloned.date.label).toBe('my-date')
    expect(cloned.regexp).toBe(regexp)
    expect(cloned.regexp.note).toBe('my-regexp')
    expect(cloned.arr).toBe(arr)
    expect(cloned.arr.note).toBe('my-array')
    // Array 子类此前被降级成 Array.prototype 副本，deepEqual 的原型一致性检查判不等
    expect(deepEqual(cloned, state)).toBe(true)
  })

  it('内建类型本身仍按内容新建副本（未把守卫扩到基类）', () => {
    const state = { d: new Date(1000), r: /ab/g, m: new Map([['k', 1]]), s: new Set([1]), a: [1, 2] }

    const cloned = deepCloneState(state)

    expect(cloned.d).not.toBe(state.d)
    expect(cloned.d.getTime()).toBe(1000)
    expect(cloned.r).not.toBe(state.r)
    expect(cloned.r.source).toBe('ab')
    expect(cloned.m).not.toBe(state.m)
    expect(cloned.m.get('k')).toBe(1)
    expect(cloned.s).not.toBe(state.s)
    expect(cloned.s.has(1)).toBe(true)
    expect(cloned.a).not.toBe(state.a)
    expect(cloned.a).toEqual([1, 2])
    expect(deepEqual(cloned, state)).toBe(true)
  })
})

// ==================== R5-138 / R5-139 文档口径（锁定声明的限制本身） ====================

describe('R5-138 对象键 Map 的键身份随克隆改变（文件头声明的窄口径）', () => {
  it('克隆后按引用匹配的键不再命中，deepEqual 判不等', () => {
    const key = { id: 1 }
    const state = { lookup: new Map([[key, 'v']]) }

    const cloned = deepCloneState(state)

    expect(cloned.lookup.get(key)).toBeUndefined()
    expect(deepEqual(cloned, state)).toBe(false)
    // 原始值键不受影响：这是文档给出的规避方式
    const primitiveKeyed = { lookup: new Map([['a', 'v']]) }
    expect(deepEqual(deepCloneState(primitiveKeyed), primitiveKeyed)).toBe(true)
  })
})

describe('R5-139 字节缓冲属共享引用节点（文件头声明的窄口径）', () => {
  it('ArrayBuffer/TypedArray/DataView 按原引用返回，副本与活状态共享', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const buffer = bytes.buffer
    const view = new DataView(buffer)
    const state = { bytes, buffer, view }

    const cloned = deepCloneState(state)

    expect(cloned.bytes).toBe(bytes)
    expect(cloned.buffer).toBe(buffer)
    expect(cloned.view).toBe(view)
    // 文档写明的事实：改写副本会串改进活状态
    cloned.bytes[0] = 9
    expect(bytes[0]).toBe(9)
  })
})

// ==================== R5-143 深度上限与自反性 ====================

describe('R5-143 引用快路径先于深度检查', () => {
  it('同一引用/同一原始值在任何深度都判相等', () => {
    const shared = { deep: { a: 1 } }

    // 修复前：深度检查在前，恰好落在 maxDepth 上的同一引用（含 1 与 1）也被判不等
    expect(deepEqual(1, 1, 0)).toBe(true)
    expect(deepEqual(NaN, NaN, 0)).toBe(true)
    expect(deepEqual(shared, shared, 0)).toBe(true)
    expect(deepEqual({ a: shared }, { a: shared }, 1)).toBe(true)
  })

  it('需要继续下钻的深层结构仍保守返回 false', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})

    expect(deepEqual({ x: { a: 1 } }, { x: { a: 2 } }, 1)).toBe(false)
    expect(deepEqual({ x: { a: 1 } }, { x: { a: 1 } }, 1)).toBe(false)
    expect(deepEqual({ x: { a: 1 } }, { x: { a: 1 } }, 2)).toBe(true)
  })
})

// ==================== R5-144 告警状态随比较创建 ====================

describe('R5-144 deepEqual 可重入：内层比较不再吞掉外层告警', () => {
  let warnings: string[] = []
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnings = []
    warnSpy = jest.spyOn(console, 'warn').mockImplementation((msg?: unknown) => {
      warnings.push(String(msg))
    })
  })

  it('内层再入的 deepEqual 告过警后，外层命中深度上限时仍各自出一条', () => {
    const innerA = { v: { leaf: 1 } }
    const innerB = { v: { leaf: 2 } }
    const outerA: Record<string, unknown> = { deep: { leaf: 1 }, probe: 0 }
    const outerB = { deep: { leaf: 2 }, probe: 0 }
    let innerResult: boolean | undefined

    // 读取 probe 时在 getter 里再入一次 deepEqual（文档承认的 Proxy/取值器场景）
    Object.defineProperty(outerA, 'probe', {
      enumerable: true,
      get(): number {
        innerResult = deepEqual(innerA, innerB, 1)
        return 0
      },
    })

    const outerResult = deepEqual(outerA, outerB, 1)

    expect(innerResult).toBe(false)
    expect(outerResult).toBe(false)
    // 修复前：内层调用把模块级标记复位并消费掉，外层的这一条告警被静默吞掉
    expect(warnings.filter((m) => m.includes('Maximum depth'))).toHaveLength(2)
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })

  it('同一次顶层比较命中多处超深时仍只警一条，下一次比较重新计一条', () => {
    const a = { p: { x: 1 }, q: { y: 1 } }
    const b = { p: { x: 2 }, q: { y: 2 } }

    expect(deepEqual(a, b, 1)).toBe(false)
    expect(warnings.filter((m) => m.includes('Maximum depth'))).toHaveLength(1)

    expect(deepEqual(a, b, 1)).toBe(false)
    expect(warnings.filter((m) => m.includes('Maximum depth'))).toHaveLength(2)
  })
})

// ==================== R5-164 / R5-165 / R5-166 deepMerge 与 clone ====================

describe('R5-164 非纯对象源值只剩一条替换分支', () => {
  it('数组/Map/Set/Date 仍整体替换为克隆副本', () => {
    const source = { list: [{ n: 1 }], map: new Map([['k', 1]]), set: new Set([1]), date: new Date(1000) }
    const target = deepMerge({} as Record<string, unknown>, source as never)

    expect(target.list).not.toBe(source.list)
    expect((target.list as unknown[])[0]).not.toBe(source.list[0])
    expect(target.map).not.toBe(source.map)
    expect((target.map as Map<string, number>).get('k')).toBe(1)
    expect(target.set).not.toBe(source.set)
    expect((target.set as Set<number>).has(1)).toBe(true)
    expect(target.date).not.toBe(source.date)
    expect((target.date as Date).getTime()).toBe(1000)
  })
})

describe('R5-165 deepMerge 的隔离范围（JSDoc 声明的口径）', () => {
  it('不可安全克隆的源值按引用并入，可克隆的值仍隔离', () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    const point = new Point(1, 2)
    const bytes = new Uint8Array([1, 2])
    const target = deepMerge({} as Record<string, unknown>, { point, bytes, plain: { n: 1 } } as never)

    // 与函数文档同口径：这两类值不隔离，需要隔离的载荷由调用方自行构造副本
    expect(target.point).toBe(point)
    expect(target.bytes).toBe(bytes)
    ;(target.point as Point).x = 9
    expect(point.x).toBe(9)

    // 可安全克隆的纯对象仍隔离：改 target 不影响 source
    const src = { plain: { n: 1 } }
    const merged = deepMerge({} as Record<string, unknown>, src as never)
    expect(merged.plain).not.toBe(src.plain)
    ;(merged.plain as Record<string, unknown>).n = 2
    expect(src.plain.n).toBe(1)
  })
})

describe('R5-166 shallow 模式只展开可保类型的对象', () => {
  it('非纯对象保留原引用，不再返回被抽空的 {}', () => {
    class Holder {
      v = 1
      get doubled(): number {
        return this.v * 2
      }
    }
    const error = new Error('x')
    const holder = new Holder()
    const weak = new WeakMap<object, number>()

    expect(clone(error, { mode: 'shallow' })).toBe(error)
    expect(clone(holder, { mode: 'shallow' })).toBe(holder)
    expect(clone(weak, { mode: 'shallow' })).toBe(weak)
    // 修复前 { ...holder } 丢掉原型与方法，且自有键也可能为空
    expect(clone(holder, { mode: 'shallow' }).doubled).toBe(2)
  })

  it('纯对象仍是一层副本，且原型与自有 __proto__ 键都保住', () => {
    const nested = { a: { b: 1 } }
    const copied = clone(nested, { mode: 'shallow' })
    expect(copied).not.toBe(nested)
    expect(copied.a).toBe(nested.a)

    const nullProto = Object.create(null) as Record<string, unknown>
    nullProto.k = 1
    const copiedNull = clone(nullProto, { mode: 'shallow' })
    expect(copiedNull).not.toBe(nullProto)
    expect(Object.getPrototypeOf(copiedNull)).toBeNull()
    expect(copiedNull.k).toBe(1)

    const withProtoKey = JSON.parse('{"__proto__":{"inj":true},"ok":1}') as Record<string, unknown>
    const copiedProtoKey = clone(withProtoKey, { mode: 'shallow' })
    expect(hasOwn(copiedProtoKey, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(copiedProtoKey)).toBe(Object.prototype)
    expect(copiedProtoKey.inj).toBeUndefined()
  })
})
