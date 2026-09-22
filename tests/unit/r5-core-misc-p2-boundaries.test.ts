/**
 * core/utils 三个纯工具（clone / equality / helpers）的边界用例
 *
 * 主控追加项：把此前只靠代码审查、没有用例承载的边界写死。
 * 与 r5-core-misc-p2-clone.test.ts 的分工：那边锁第五轮修复的行为，
 * 这里锁「修复后仍然成立、但一改就会静默漂移」的边界语义（循环图、别名、SameValueZero、
 * 键可见性、类型判别）。断言的都是**当前设计的口径**，其中刻意保守/收窄的部分在注释里写明。
 *
 * 无需改 jest 配置：roots 指向 <rootDir>/tests，testMatch 的 `?(*.)+(spec|test).ts`
 * 已覆盖本文件（`npx jest --listTests` 可见）。
 */

import { deepCloneState } from '@/core/utils/clone.js'
import { deepEqual } from '@/core/utils/equality.js'
import { clone, isArray, isFunction, isObject, isPlainObject, isPromise, shallowEqual } from '@/core/utils/helpers.js'

type Loopy = Record<string, unknown> & { self?: unknown }

afterEach(() => {
  jest.restoreAllMocks()
})

// ==================== clone.ts ====================

describe('deepCloneState 边界', () => {
  it('循环图在四条容器分支上都终止，且副本内部自成闭环', () => {
    const source: Loopy = { list: [], map: new Map<string, unknown>(), set: new Set<unknown>() }
    source.self = source
    ;(source.list as unknown[]).push(source)
    ;(source.map as Map<string, unknown>).set('k', source)
    ;(source.set as Set<unknown>).add(source)

    const cloned = deepCloneState(source)

    // 守卫登记在递归之前：任何一条分支漏掉，自引用就会写成 {self: <外层副本>} 之外的另一份拷贝
    expect(cloned.self).toBe(cloned)
    expect((cloned.list as unknown[])[0]).toBe(cloned)
    expect((cloned.map as Map<string, unknown>).get('k')).toBe(cloned)
    expect((cloned.set as Set<unknown>).has(cloned)).toBe(true)
    expect(cloned).not.toBe(source)
  })

  it('别名图在克隆后仍共享同一副本，而源对象不受影响', () => {
    const shared = { n: 1 }
    const cloned = deepCloneState({ a: shared, b: shared, list: [shared] })

    expect(cloned.a).toBe(cloned.b)
    expect(cloned.list[0]).toBe(cloned.a)
    expect(cloned.a).not.toBe(shared)
    ;(cloned.a as { n: number }).n = 2
    expect(shared.n).toBe(1)
  })

  it('Date/RegExp 按文档口径不参与别名共享（每次新建实例）', () => {
    const date = new Date(1000)
    const regexp = /a/g
    const cloned = deepCloneState({ a: date, b: date, r: regexp })

    expect(cloned.a).not.toBe(cloned.b)
    expect(cloned.a.getTime()).toBe(1000)
    expect(cloned.r).not.toBe(regexp)
    expect(cloned.r.source).toBe('a')
  })

  it('不可克隆值一律按引用返回，不产生半成品副本', () => {
    const fn = (): number => 1
    const weak = new WeakMap<object, number>()
    const promise = Promise.resolve(1)
    const boxed = new Number(3)
    const error = new Error('boom')
    const cloned = deepCloneState({ fn, weak, promise, boxed, error })

    expect(cloned.fn).toBe(fn)
    expect(cloned.weak).toBe(weak)
    expect(cloned.promise).toBe(promise)
    expect(cloned.boxed).toBe(boxed)
    expect(cloned.error).toBe(error)
  })

  it('空容器与 null 原型在各层都被保真', () => {
    const nullProto = Object.create(null) as Record<string, unknown>
    nullProto.child = Object.create(null) as Record<string, unknown>
    const source = { np: nullProto, map: new Map<string, unknown>(), set: new Set<unknown>(), arr: [], obj: {} }

    const cloned = deepCloneState(source)

    expect(Object.getPrototypeOf(cloned.np)).toBeNull()
    expect(Object.getPrototypeOf(cloned.np.child)).toBeNull()
    expect(cloned.map.size).toBe(0)
    expect(cloned.map).toBeInstanceOf(Map)
    expect(cloned.set).toBeInstanceOf(Set)
    expect(cloned.arr).toEqual([])
    expect(cloned.obj).toEqual({})
    expect(cloned).not.toBe(source)
  })

  it('Map 的键与值、Set 的元素都被递归克隆', () => {
    const key = { id: 1 }
    const value = { deep: { n: 1 } }
    const member = { m: [1, 2] }
    const cloned = deepCloneState({ map: new Map([[key, value]]), set: new Set([member]) })

    const [firstKey] = [...cloned.map.keys()]
    const firstValue = cloned.map.get(firstKey) as typeof value

    expect(firstKey).not.toBe(key)
    expect(firstValue).not.toBe(value)
    expect(firstValue.deep.n).toBe(1)
    const [firstMember] = [...cloned.set]
    expect(firstMember).not.toBe(member)
    expect(firstMember.m).toEqual([1, 2])
  })

  it('clone 的 deep 与 safe 模式共用同一套边界语义', () => {
    const source: Loopy = { d: new Date(0), list: [1] }
    source.self = source

    expect(clone(source)).toEqual(deepCloneState(source))
    expect(clone(source, { mode: 'safe' })).toEqual(deepCloneState(source))
    // json 模式是唯一有损的显式出口：Date 变字符串、Map/Set 变 {}
    const lossy = clone({ d: new Date(0), m: new Map([['k', 1]]) }, { mode: 'json' }) as { d: unknown; m: unknown }
    expect(lossy.d).toBe('1970-01-01T00:00:00.000Z')
    expect(lossy.m).toEqual({})
  })
})

// ==================== equality.ts ====================

describe('deepEqual 边界', () => {
  it('原始值按 SameValueZero：NaN 自等，0 与 -0 同值，null 不等于 undefined', () => {
    expect(deepEqual(NaN, NaN)).toBe(true)
    expect(deepEqual(0, -0)).toBe(true)
    expect(deepEqual(null, undefined)).toBe(false)
    expect(deepEqual(undefined, undefined)).toBe(true)
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual('1', 1)).toBe(false)
    expect(deepEqual(1, true)).toBe(false)
  })

  it('数组与同键集的类数组对象、长度不同的数组都判不等', () => {
    expect(deepEqual([1], { 0: 1, length: 1 })).toBe(false)
    expect(deepEqual([1, 2], [1, 2, undefined])).toBe(false)
    expect(deepEqual({ 0: 1, length: 1 }, { 0: 1, length: 1 })).toBe(true)
  })

  it('symbol 键与不可枚举属性不参与比较（@returns 声明的收窄口径）', () => {
    const versioned: Record<string | symbol, unknown> = { a: 1 }
    Object.defineProperty(versioned, Symbol.for('geomstore.stateVersion'), { value: 9, enumerable: true })
    Object.defineProperty(versioned, 'hidden', { value: 'x', enumerable: false })

    expect(deepEqual(versioned, { a: 1 })).toBe(true)
  })

  it('Map 只比 size 与按键引用的值语义，Set 与插入顺序无关', () => {
    expect(
      deepEqual(
        new Map([['a', 1]]),
        new Map([
          ['a', 1],
          ['b', 2],
        ]),
      ),
    ).toBe(false)
    expect(deepEqual(new Map<string, unknown>([['a', undefined]]), new Map<string, unknown>([['a', undefined]]))).toBe(true)
    // Map 的迭代序不是相等条件，Set 更不是
    const m1 = new Map([
      ['a', 1],
      ['b', 2],
    ])
    const m2 = new Map([
      ['b', 2],
      ['a', 1],
    ])
    expect(deepEqual(m1, m2)).toBe(true)
    expect(deepEqual(new Set([{ v: 1 }, { v: 2 }]), new Set([{ v: 2 }, { v: 1 }]))).toBe(true)
    expect(deepEqual(new Set([NaN]), new Set([NaN]))).toBe(true)
  })

  it('内建类型与普通对象互判不等，循环结构在两个方向都判等', () => {
    expect(deepEqual(new Date(0), { getTime: () => 0 })).toBe(false)
    expect(deepEqual(new Map(), new Set())).toBe(false)
    expect(deepEqual(new Set(), [])).toBe(false)

    const a: Loopy = {}
    a.self = a
    const b: Loopy = { self: null }
    b.self = b
    expect(deepEqual(a, b)).toBe(true)
    expect(deepEqual(b, a)).toBe(true)
  })

  it('shallowEqual 与 deepEqual 的语义分界：一层同值 vs 递归同值', () => {
    const inner = { n: 1 }
    expect(shallowEqual({ a: inner }, { a: inner })).toBe(true)
    expect(shallowEqual({ a: { n: 1 } }, { a: { n: 1 } })).toBe(false)
    expect(deepEqual({ a: { n: 1 } }, { a: { n: 1 } })).toBe(true)
    // 内建实例没有可信的浅层身份：Map/Set/Date 复用 deepEqual 的内容口径
    expect(shallowEqual(new Map([['k', { n: 1 }]]), new Map([['k', { n: 1 }]]))).toBe(true)
    expect(shallowEqual(new Date(0), new Date(0))).toBe(true)
    expect(shallowEqual(new Date(0), new Date(1))).toBe(false)
  })
})

// ==================== helpers.ts 类型判别 ====================

describe('类型判别的边界', () => {
  it('isObject 排除数组/Map/Set/函数/null，isPlainObject 再排除类实例但接受 null 原型', () => {
    class Point {}

    expect(isObject({})).toBe(true)
    expect(isObject(Object.create(null))).toBe(true)
    expect(isObject([])).toBe(false)
    expect(isObject(new Map())).toBe(false)
    expect(isObject(new Set())).toBe(false)
    expect(isObject(null)).toBe(false)
    expect(isObject(undefined)).toBe(false)
    expect(isObject(() => 1)).toBe(false)
    expect(isObject(new Date(0))).toBe(true)

    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject(Object.create(null))).toBe(true)
    expect(isPlainObject(new Point())).toBe(false)
    // 判据是「原型为 Object.prototype 或 null」，故原型为 null 的 Object.prototype 本身也算纯对象：
    // null 原型是 Object.create(null) 状态映射的合法形状（见 clone.ts 的原型保真口径），
    // 本函数无法也不试图把「恰好是根原型」那一个值挑出来
    expect(isPlainObject(Object.prototype)).toBe(true)
  })

  it('isFunction / isArray / isPromise 只认形状不认出身', () => {
    expect(isFunction(class C {})).toBe(true)
    expect(isFunction({ call: 1 })).toBe(false)
    expect(isArray([])).toBe(true)
    expect(isArray({ length: 0 })).toBe(false)
    expect(isArray(argumentsLike())).toBe(false)
    expect(isPromise(Promise.resolve(1))).toBe(true)
    expect(isPromise({ then: () => undefined })).toBe(true)
    expect(isPromise({ then: 1 })).toBe(false)
    expect(isPromise(null)).toBe(false)
    expect(isPromise(undefined)).toBe(false)
  })
})

/** 类数组但非数组的对象（旧实现靠 Object.prototype.toString 判类别，这里只认 Array.isArray） */
function argumentsLike(): { length: number; 0: string } {
  return { length: 1, 0: 'a' }
}
