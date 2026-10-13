/**
 * equality 内建类型比较修复验证
 *
 * 验证 deepEqual 对 Error/ArrayBuffer/TypedArray/Promise/WeakMap/WeakSet 的正确处理：
 * - Error 按 name + message 比较
 * - ArrayBuffer/TypedArray 按字节内容比较
 * - Promise/WeakMap/WeakSet 按引用比较
 */

import { deepEqual } from '../../src/core/utils/equality'

describe('equality 内建类型比较', () => {
  describe('Error', () => {
    it('相同 name + message 的 Error 判等', () => {
      const e1 = new Error('test error')
      const e2 = new Error('test error')
      expect(deepEqual(e1, e2)).toBe(true)
    })

    it('不同 message 的 Error 判不等', () => {
      const e1 = new Error('error a')
      const e2 = new Error('error b')
      expect(deepEqual(e1, e2)).toBe(false)
    })

    it('不同 name 的 Error 判不等', () => {
      const e1 = new Error('same message')
      e1.name = 'TypeError'
      const e2 = new Error('same message')
      e2.name = 'RangeError'
      expect(deepEqual(e1, e2)).toBe(false)
    })

    it('Error 子类带自有属性时，属性也参与比较', () => {
      class CustomError extends Error {
        code: number
        constructor(message: string, code: number) {
          super(message)
          this.name = 'CustomError'
          this.code = code
        }
      }
      const e1 = new CustomError('error', 100)
      const e2 = new CustomError('error', 100)
      const e3 = new CustomError('error', 200)
      expect(deepEqual(e1, e2)).toBe(true)
      expect(deepEqual(e1, e3)).toBe(false)
    })
  })

  describe('ArrayBuffer', () => {
    it('相同字节内容的 ArrayBuffer 判等', () => {
      const buf1 = new ArrayBuffer(4)
      const buf2 = new ArrayBuffer(4)
      const view1 = new Uint8Array(buf1)
      const view2 = new Uint8Array(buf2)
      view1.set([1, 2, 3, 4])
      view2.set([1, 2, 3, 4])
      expect(deepEqual(buf1, buf2)).toBe(true)
    })

    it('不同字节内容的 ArrayBuffer 判不等', () => {
      const buf1 = new ArrayBuffer(4)
      const buf2 = new ArrayBuffer(4)
      const view1 = new Uint8Array(buf1)
      const view2 = new Uint8Array(buf2)
      view1.set([1, 2, 3, 4])
      view2.set([1, 2, 3, 5])
      expect(deepEqual(buf1, buf2)).toBe(false)
    })

    it('不同大小的 ArrayBuffer 判不等', () => {
      const buf1 = new ArrayBuffer(4)
      const buf2 = new ArrayBuffer(8)
      expect(deepEqual(buf1, buf2)).toBe(false)
    })
  })

  describe('TypedArray', () => {
    it('相同字节内容的 Uint8Array 判等', () => {
      const arr1 = new Uint8Array([1, 2, 3, 4])
      const arr2 = new Uint8Array([1, 2, 3, 4])
      expect(deepEqual(arr1, arr2)).toBe(true)
    })

    it('不同字节内容的 Uint8Array 判不等', () => {
      const arr1 = new Uint8Array([1, 2, 3, 4])
      const arr2 = new Uint8Array([1, 2, 3, 5])
      expect(deepEqual(arr1, arr2)).toBe(false)
    })

    it('相同字节内容的 Int16Array 判等', () => {
      const arr1 = new Int16Array([100, 200, 300])
      const arr2 = new Int16Array([100, 200, 300])
      expect(deepEqual(arr1, arr2)).toBe(true)
    })

    it('不同字节内容的 Float32Array 判不等', () => {
      const arr1 = new Float32Array([1.0, 2.0, 3.0])
      const arr2 = new Float32Array([1.0, 2.0, 4.0])
      expect(deepEqual(arr1, arr2)).toBe(false)
    })

    it('不同长度的 TypedArray 判不等', () => {
      const arr1 = new Uint8Array([1, 2, 3])
      const arr2 = new Uint8Array([1, 2, 3, 4])
      expect(deepEqual(arr1, arr2)).toBe(false)
    })
  })

  describe('Promise/WeakMap/WeakSet', () => {
    it('不同 Promise 实例判不等', () => {
      const p1 = Promise.resolve(1)
      const p2 = Promise.resolve(1)
      expect(deepEqual(p1, p2)).toBe(false)
    })

    it('同一 Promise 实例判等', () => {
      const p = Promise.resolve(1)
      expect(deepEqual(p, p)).toBe(true)
    })

    it('不同 WeakMap 实例判不等', () => {
      const wm1 = new WeakMap()
      const wm2 = new WeakMap()
      expect(deepEqual(wm1, wm2)).toBe(false)
    })

    it('同一 WeakMap 实例判等', () => {
      const wm = new WeakMap()
      expect(deepEqual(wm, wm)).toBe(true)
    })

    it('不同 WeakSet 实例判不等', () => {
      const ws1 = new WeakSet()
      const ws2 = new WeakSet()
      expect(deepEqual(ws1, ws2)).toBe(false)
    })

    it('同一 WeakSet 实例判等', () => {
      const ws = new WeakSet()
      expect(deepEqual(ws, ws)).toBe(true)
    })
  })
})
