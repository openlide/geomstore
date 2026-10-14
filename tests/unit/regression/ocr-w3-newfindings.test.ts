/**
 * OCR W3 回归：N1/N2/N4 新发现缺陷锁定
 *
 * N1: equality.ts 跨 realm Promise/WeakMap/WeakSet 按 tag 判定（不再 instanceof）
 * N2: equality.ts 跨 realm ArrayBuffer/SharedArrayBuffer 按 tag 判定 + 字节比较
 * N4: 快照数组默认模式保留可枚举符号键（与对象分支同口径）
 */

import { deepEqual } from '@/core/utils/equality.js'
import { createSnapshot } from '@/extras/snapshot/SnapshotManager.js'

describe('W3-N1: 跨 realm Promise/WeakMap/WeakSet 按引用判等', () => {
  it('两个不同的 Promise（同原型、引用不同）判不等', () => {
    const p1 = Promise.resolve(1)
    const p2 = Promise.resolve(1)
    expect(deepEqual(p1, p2)).toBe(false)
  })

  it('两个不同的 WeakMap（同原型、引用不同）判不等', () => {
    const wm1 = new WeakMap()
    const wm2 = new WeakMap()
    expect(deepEqual(wm1, wm2)).toBe(false)
  })

  it('两个不同的 WeakSet（同原型、引用不同）判不等', () => {
    const ws1 = new WeakSet()
    const ws2 = new WeakSet()
    expect(deepEqual(ws1, ws2)).toBe(false)
  })

  it('同一个 Promise 与自身判等（引用相同快速路径）', () => {
    const p = Promise.resolve(1)
    expect(deepEqual(p, p)).toBe(true)
  })
})

describe('W3-N2: 跨 realm ArrayBuffer/SharedArrayBuffer 按字节比较', () => {
  it('字节不同的两个 ArrayBuffer 判不等', () => {
    const a = new ArrayBuffer(4)
    const b = new ArrayBuffer(4)
    new Uint8Array(a).set([1, 2, 3, 4])
    new Uint8Array(b).set([5, 6, 7, 8])
    expect(deepEqual(a, b)).toBe(false)
  })

  it('字节相同的两个 ArrayBuffer 判等', () => {
    const a = new ArrayBuffer(4)
    const b = new ArrayBuffer(4)
    new Uint8Array(a).set([1, 2, 3, 4])
    new Uint8Array(b).set([1, 2, 3, 4])
    expect(deepEqual(a, b)).toBe(true)
  })

  it('byteLength 不同的两个 ArrayBuffer 判不等', () => {
    const a = new ArrayBuffer(4)
    const b = new ArrayBuffer(8)
    expect(deepEqual(a, b)).toBe(false)
  })

  it('字节不同的两个 SharedArrayBuffer 判不等', () => {
    const a = new SharedArrayBuffer(4)
    const b = new SharedArrayBuffer(4)
    new Uint8Array(a).set([1, 2, 3, 4])
    new Uint8Array(b).set([5, 6, 7, 8])
    expect(deepEqual(a, b)).toBe(false)
  })

  it('字节相同的两个 SharedArrayBuffer 判等', () => {
    const a = new SharedArrayBuffer(4)
    const b = new SharedArrayBuffer(4)
    new Uint8Array(a).set([1, 2, 3, 4])
    new Uint8Array(b).set([1, 2, 3, 4])
    expect(deepEqual(a, b)).toBe(true)
  })
})

describe('W3-N4: 快照数组默认模式保留可枚举符号键', () => {
  it('数组上的可枚举符号键被快照保留', () => {
    const arr = [1, 2, 3] as number[] & Record<symbol, unknown>
    const sym = Symbol('tag')
    arr[sym] = 'metadata'

    const result = createSnapshot(arr)
    expect(result.success).toBe(true)
    const data = result.data as number[] & Record<symbol, unknown>
    expect(data[sym]).toBe('metadata')
  })

  it('数组上的多个符号键都被保留', () => {
    const arr = [1, 2] as number[] & Record<symbol, unknown>
    const s1 = Symbol('a')
    const s2 = Symbol('b')
    arr[s1] = 'x'
    arr[s2] = 'y'

    const result = createSnapshot(arr)
    expect(result.success).toBe(true)
    const data = result.data as number[] & Record<symbol, unknown>
    expect(data[s1]).toBe('x')
    expect(data[s2]).toBe('y')
  })

  it('符号键与字符串附加键共存时都被保留', () => {
    const arr = [1, 2, 3] as number[] & { meta?: string } & Record<symbol, unknown>
    arr.meta = 'v2'
    const sym = Symbol('version')
    arr[sym] = 1

    const result = createSnapshot(arr)
    expect(result.success).toBe(true)
    const data = result.data as number[] & { meta?: string } & Record<symbol, unknown>
    expect(data.meta).toBe('v2')
    expect(data[sym]).toBe(1)
  })

  it('不可枚举符号键在默认模式下不被保留（与对象分支同口径）', () => {
    const arr = [1, 2] as number[] & Record<symbol, unknown>
    const sym = Symbol('hidden')
    Object.defineProperty(arr, sym, { value: 'secret', enumerable: false })

    const result = createSnapshot(arr)
    expect(result.success).toBe(true)
    const data = result.data as number[] & Record<symbol, unknown>
    expect(data[sym]).toBeUndefined()
  })

  it('includeNonEnumerable 模式下不可枚举符号键也被保留', () => {
    const arr = [1, 2] as number[] & Record<symbol, unknown>
    const sym = Symbol('hidden')
    Object.defineProperty(arr, sym, { value: 'secret', enumerable: false })

    const result = createSnapshot(arr, { includeNonEnumerable: true })
    expect(result.success).toBe(true)
    const data = result.data as number[] & Record<symbol, unknown>
    expect(data[sym]).toBe('secret')
  })
})
