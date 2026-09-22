/**
 * deepEqual 的内建类型口径：原型一致性优先 + 装箱原始值按 valueOf
 *
 * 锁两件此前判错的事（都是「假相等」方向，会把选择器/缓存变成返回陈旧值）：
 * 1. Date/RegExp/Map/Set 的按内容分支原先跑在原型检查之前并直接 continue，
 *    于是空的 `class MyMap extends Map` 实例与空 `Map` 判等；
 * 2. 装箱原始值的 Object.keys 恒为空，于是 `new Number(1)` 与 `new Number(2)` 判等。
 */
import { deepEqual } from '@/core/utils/equality.js'

class MyMap extends Map<string, unknown> {}
class MySet extends Set<number> {}
class MyDate extends Date {}
class MyRegExp extends RegExp {
  constructor() {
    super('abc', 'gi')
  }
}
class MyNumber extends Number {}

describe('deepEqual - 内建类型的子类与基类判不等（原型检查先于内容分支）', () => {
  it('空 MyMap 与空 Map 判不等（此前因 size 相等直接 continue 而判等）', () => {
    expect(deepEqual(new MyMap(), new Map())).toBe(false)
  })

  it('同原型的两个空 MyMap 判等（内容分支本身没坏）', () => {
    expect(deepEqual(new MyMap(), new MyMap())).toBe(true)
  })

  it('MyMap 与 Map 有相同条目时仍判不等', () => {
    const a = new MyMap([
      ['x', 1],
      ['y', 2],
    ])
    const b = new Map([
      ['x', 1],
      ['y', 2],
    ])
    expect(deepEqual(a, b)).toBe(false)
  })

  it('空 MySet 与空 Set 判不等，两个空 MySet 判等', () => {
    expect(deepEqual(new MySet(), new Set())).toBe(false)
    expect(deepEqual(new MySet(), new MySet())).toBe(true)
  })

  it('MyDate 与同一时刻的 Date 判不等，两个同刻 MyDate 判等', () => {
    const ts = 1_700_000_000_000
    expect(deepEqual(new MyDate(ts), new Date(ts))).toBe(false)
    expect(deepEqual(new MyDate(ts), new MyDate(ts))).toBe(true)
  })

  it('MyRegExp 与同 source/flags 的 RegExp 判不等', () => {
    expect(deepEqual(new MyRegExp(), /abc/gi)).toBe(false)
    expect(deepEqual(new MyRegExp(), new MyRegExp())).toBe(true)
  })

  it('嵌套在普通对象里的子类同样判不等', () => {
    expect(deepEqual({ list: new MyMap() }, { list: new Map() })).toBe(false)
    expect(deepEqual({ list: new Set([1]) }, { list: new MySet([1]) })).toBe(false)
  })

  it('Map 的值仍按深度比较、键仍按引用匹配（改动未削弱原有语义）', () => {
    const key = { id: 1 }
    const same = new Map([[key, { v: 1 }]])
    expect(deepEqual(same, new Map([[key, { v: 1 }]]))).toBe(true)
    expect(deepEqual(same, new Map([[key, { v: 2 }]]))).toBe(false)
    // 键结构相同但引用不同：@remarks 写明的窄口径
    expect(deepEqual(new Map([[{ id: 1 }, 'a']]), new Map([[{ id: 1 }, 'a']]))).toBe(false)
  })

  it('跨种类内建对象判不等（原先靠双侧 instanceof 守卫，现在由原型检查负责）', () => {
    expect(deepEqual(new Map(), new Set())).toBe(false)
    expect(deepEqual(new Date(0), new Map())).toBe(false)
    expect(deepEqual(/a/g, new Date(0))).toBe(false)
  })

  it('数组与 Object.create(Array.prototype) 判不等（同原型但 isArray 分歧）', () => {
    const fakeArray = Object.create(Array.prototype)
    expect(Array.isArray(fakeArray)).toBe(false)
    expect(deepEqual([], fakeArray)).toBe(false)
  })
})

describe('deepEqual - 装箱原始值按 valueOf 比较', () => {
  it('new Number 值不同判不等（此前 Object.keys 为空而判等）', () => {
    expect(deepEqual(new Number(1), new Number(2))).toBe(false)
    expect(deepEqual(new Number(1), new Number(1))).toBe(true)
  })

  it('new String / new Boolean 值不同判不等', () => {
    expect(deepEqual(new String('a'), new String('b'))).toBe(false)
    expect(deepEqual(new String('a'), new String('a'))).toBe(true)
    expect(deepEqual(new Boolean(true), new Boolean(false))).toBe(false)
    expect(deepEqual(new Boolean(true), new Boolean(true))).toBe(true)
  })

  it('BigInt 与 Symbol 装箱同样按 valueOf', () => {
    expect(deepEqual(Object(10n), Object(11n))).toBe(false)
    expect(deepEqual(Object(10n), Object(10n))).toBe(true)
    const sym = Symbol('s')
    expect(deepEqual(Object(sym), Object(Symbol('s')))).toBe(false)
    expect(deepEqual(Object(sym), Object(sym))).toBe(true)
  })

  it('NaN 装箱按 Object.is 判等（与顶层 SameValueZero 快速路径同口径）', () => {
    expect(deepEqual(new Number(NaN), new Number(NaN))).toBe(true)
  })

  it('装箱子类：原始值相同但自有属性不同判不等，两侧都带则判等', () => {
    const withExtra = Object.assign(new MyNumber(1), { tag: 'a' })
    const sameValue = new MyNumber(1)
    expect(deepEqual(withExtra, sameValue)).toBe(false)
    expect(deepEqual(withExtra, Object.assign(new MyNumber(1), { tag: 'a' }))).toBe(true)
    // 原始值分歧优先于「自有键集相同」
    expect(deepEqual(Object.assign(new MyNumber(1), { tag: 'a' }), Object.assign(new MyNumber(2), { tag: 'a' }))).toBe(false)
  })

  it('装箱对象与普通对象、与未装箱原始值都判不等', () => {
    expect(deepEqual(new Number(1), {})).toBe(false)
    // 原始值一侧：typeof 分歧，不进入对象分支
    expect(deepEqual(new Number(1), 1)).toBe(false)
  })
})

describe('deepEqual - 回归：循环与深度语义未被重排打坏', () => {
  it('自引用对象与其副本判等', () => {
    const a: Record<string, unknown> = { n: 1 }
    a.self = a
    const b: Record<string, unknown> = { n: 1 }
    b.self = b
    expect(deepEqual(a, b)).toBe(true)
  })

  it('含子类的循环结构仍判等', () => {
    const m1 = new MyMap()
    const m2 = new MyMap()
    m1.set('me', m1)
    m2.set('me', m2)
    expect(deepEqual(m1, m2)).toBe(true)
  })

  it('同一引用在耗尽 maxDepth 的那一层仍判等（快速路径先于深度检查）', () => {
    const shared = new MyMap()
    expect(deepEqual({ a: shared }, { a: shared }, 1)).toBe(true)
  })

  it('需要下钻的结构超限时按保守语义判不等', () => {
    expect(deepEqual({ a: new MyMap([['k', 1]]) }, { a: new MyMap([['k', 1]]) }, 1)).toBe(false)
  })
})
