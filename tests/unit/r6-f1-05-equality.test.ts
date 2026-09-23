/**
 * 第六轮 f1-05 回归锁：deepEqual 的装箱原始值判定不得裸引用 BigInt / Symbol 全局
 *
 * R6-042：`currentA instanceof BigInt` 里 BigInt 是未声明全局标识符，取值即抛
 * ReferenceError，而该表达式位于**所有同原型对象对**的必经路径上（前三个 instanceof
 * 对普通对象全为 false，短路停不下来）。不提供 BigInt 全局的运行时里，比较两个普通
 * 对象就会崩，异常从比较器外溢到 createSelector / notify 去重 / 快照 diff 全部调用方。
 */

import { deepEqual } from '@/core/utils/equality.js'

/** 临时下线某个全局构造器（`delete` 运算符要求操作数可选，故走 Reflect），返回恢复函数 */
const withGlobalDeleted = (name: 'BigInt' | 'Symbol'): (() => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Reflect.deleteProperty(globalThis, name)
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
  }
}

describe('R6-042 deepEqual 对 BigInt / Symbol 全局做能力探测', () => {
  it('运行时无 BigInt 全局时，比较普通对象不再抛 ReferenceError', () => {
    const restore = withGlobalDeleted('BigInt')
    try {
      expect(() => deepEqual({ a: 1 }, { a: 1 })).not.toThrow()
      expect(deepEqual({ a: 1 }, { a: 1 })).toBe(true)
      expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false)
      // 必经路径不止一条：数组、Map/Set、循环引用同样不得因为取 BigInt 而炸
      expect(deepEqual([{ a: 1 }, { b: 2 }], [{ a: 1 }, { b: 2 }])).toBe(true)
      expect(deepEqual(new Map([['k', { v: 1 }]]), new Map([['k', { v: 1 }]]))).toBe(true)
      const cyclic: Record<string, unknown> = { n: 1 }
      cyclic.self = cyclic
      expect(deepEqual(cyclic, { n: 1, self: cyclic })).toBe(true)
    } finally {
      restore()
    }
  })

  it('BigInt 全局缺席时仍按装箱值内容比较（[[Class]] 标签兜底，不按普通对象判等）', () => {
    const restore = withGlobalDeleted('BigInt')
    try {
      const box = (value: bigint): object => Object(value)
      expect(deepEqual(box(1n), box(1n))).toBe(true)
      expect(deepEqual(box(1n), box(2n))).toBe(false)
    } finally {
      restore()
    }
  })

  it('全局在场时原有语义不回退：包装类子类仍按 valueOf 区分', () => {
    class MyNumber extends Number {
      constructor(value: number) {
        super(value)
      }
    }
    expect(deepEqual(new MyNumber(1), new MyNumber(1))).toBe(true)
    expect(deepEqual(new MyNumber(1), new MyNumber(2))).toBe(false)
    expect(deepEqual(new Number(1), new Number(2))).toBe(false)
    expect(deepEqual(Object(Symbol.for('tag')), Object(Symbol.for('tag')))).toBe(true)
    expect(deepEqual(Object(Symbol('anon')), Object(Symbol('anon')))).toBe(false)
    // 装箱子类另带自有属性时仍要走通用键比较（不 continue 的既有口径）
    const left = new MyNumber(1) as MyNumber & { extra?: number }
    const right = new MyNumber(1) as MyNumber & { extra?: number }
    left.extra = 1
    right.extra = 2
    expect(deepEqual(left, right)).toBe(false)
  })

  it('Symbol 全局缺席时也不抛错（同样走能力探测）', () => {
    const restore = withGlobalDeleted('Symbol')
    try {
      expect(deepEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true)
    } finally {
      restore()
    }
  })
})
