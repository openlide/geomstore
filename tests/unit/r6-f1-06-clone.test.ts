/**
 * 第六轮分片 f1-06 回归锁 —— clone 的内建子类准入门槛（R6-043）
 *
 * 每条用例断言的是**修复后**的语义，在修复前的实现上全部会失败
 * （修复前 `clone()` 顶部的 Date/RegExp 特判与 shallow 的 Array/Map/Set 分支只看
 * `instanceof`，子类实例被静默降级成基类副本）。
 */

import { deepCloneState } from '@/core/utils/clone.js'
import { clone } from '@/core/utils/helpers.js'

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

describe('R6-043 clone 对内建类型子类不再降级成基类副本', () => {
  it('shallow：五类内建子类都按原引用返回，方法与自有字段完好', () => {
    const map = new MyMap([['a', 1]])
    const set = new MySet([1])
    const date = new MyDate(1000)
    const regexp = new MyRegExp('ab', 'g')
    const arr = new MyArray(2)

    for (const value of [map, set, date, regexp, arr] as const) {
      const copied = clone(value, { mode: 'shallow' })
      const proto = Object.getPrototypeOf(value) as { constructor: Function }
      expect(copied).toBe(value)
      expect(Object.getPrototypeOf(copied)).toBe(proto)
      expect(copied).toBeInstanceOf(proto.constructor)
    }

    // 修复前的症状：拿到基类副本后调子类方法直接 TypeError
    const copiedMap = clone(map, { mode: 'shallow' }) as MyMap
    expect(copiedMap.describe()).toBe('my-map')
    expect(copiedMap.extra).toBe(7)
    expect(clone(arr, { mode: 'shallow' }).note).toBe('my-array')
    expect(clone(date, { mode: 'shallow' }).label).toBe('my-date')
  })

  it('deep/safe：顶层内建子类与嵌套处同口径（都是原引用），且与 deepCloneState 一致', () => {
    const date = new MyDate(1000)
    const map = new MyMap([['a', 1]])
    const arr = new MyArray(2)

    for (const mode of ['deep', 'safe'] as const) {
      expect(clone(date, { mode })).toBe(date)
      expect(clone(map, { mode })).toBe(map)
      expect(clone(arr, { mode })).toBe(arr)
      // 本条 finding 的核心不变量：同一次 clone(x,{mode:'deep'}) 对「顶层 Date 子类」和
      // 「嵌在对象里的 Date 子类」给出两套结果，现在两侧都等于 deepCloneState 的降级口径
      expect(clone(date, { mode })).toBe(deepCloneState(date))
      expect(deepCloneState({ date, map, arr }).date).toBe(date)
    }
  })

  it('内建类型本身仍按内容新建副本（门槛没有扩到基类）', () => {
    const date = new Date(1000)
    const regexp = /ab/g
    const map = new Map([['k', 1]])
    const set = new Set([1])
    const arr = [1, 2]

    for (const mode of ['deep', 'shallow', 'safe'] as const) {
      expect(clone(date, { mode })).not.toBe(date)
      expect(clone(date, { mode }).getTime()).toBe(1000)
      expect(clone(regexp, { mode })).not.toBe(regexp)
      expect(clone(regexp, { mode }).source).toBe('ab')
      expect(clone(map, { mode })).not.toBe(map)
      expect(clone(set, { mode })).not.toBe(set)
      expect(clone(arr, { mode })).not.toBe(arr)
    }

    expect(clone(map, { mode: 'shallow' }).get('k')).toBe(1)
    expect(clone(set, { mode: 'shallow' }).has(1)).toBe(true)
    expect(clone(arr, { mode: 'shallow' })).toEqual([1, 2])
  })

  it('json 模式仍是有损往返（子类实例的自有可枚举键被保留、原型丢失）', () => {
    const date = new MyDate(1000)
    const arr = new MyArray()
    arr.push(1, 2)

    expect(clone(date, { mode: 'json' })).toBe('1970-01-01T00:00:01.000Z')
    expect(clone(arr, { mode: 'json' })).toEqual([1, 2])
  })
})
