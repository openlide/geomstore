/**
 * 状态版本号（stateVersion）单元测试
 *
 * 覆盖 getStateVersion 的非对象/无标记回退路径，以及 defineStateVersion 的
 * 不可枚举性与冻结容错——这些是选择器 O(1) 失效判定的正确性前提。
 */
import { defineStateVersion, getStateVersion } from '@/core/store/stateVersion.js'

describe('stateVersion', () => {
  describe('getStateVersion', () => {
    it('对非对象值返回 undefined（状态保护 Proxy 对原语直接透传）', () => {
      expect(getStateVersion(null)).toBeUndefined()
      expect(getStateVersion(undefined)).toBeUndefined()
      expect(getStateVersion(42)).toBeUndefined()
      expect(getStateVersion('str')).toBeUndefined()
      expect(getStateVersion(true)).toBeUndefined()
    })

    it('对没有版本标记的对象返回 undefined（回退 deepEqual 比较）', () => {
      expect(getStateVersion({})).toBeUndefined()
      expect(getStateVersion({ nested: { a: 1 } })).toBeUndefined()
      expect(getStateVersion([])).toBeUndefined()
    })

    it('标记值不是 number 时返回 undefined', () => {
      const state: Record<PropertyKey, unknown> = {}
      Object.defineProperty(state, Symbol.for('geomstore.stateVersion'), {
        value: '1',
        enumerable: false,
      })
      expect(getStateVersion(state)).toBeUndefined()
    })
  })

  describe('defineStateVersion', () => {
    it('以 getter 动态读取版本号（无需在每条写入路径同步更新）', () => {
      let version = 0
      const state: Record<string, unknown> = { count: 0 }
      defineStateVersion(state, () => version)

      expect(getStateVersion(state)).toBe(0)
      version = 7
      expect(getStateVersion(state)).toBe(7)
    })

    it('版本属性不可枚举：不污染 keys / JSON 序列化 / 快照', () => {
      const state = { count: 1 }
      defineStateVersion(state, () => 3)

      expect(Object.keys(state)).toEqual(['count'])
      expect(JSON.stringify(state)).toBe('{"count":1}')
      expect({ ...state }).toEqual({ count: 1 })
    })

    it('状态对象被冻结时静默忽略，不抛出', () => {
      const state = Object.freeze({ count: 1 })
      expect(() => defineStateVersion(state, () => 1)).not.toThrow()
      expect(getStateVersion(state)).toBeUndefined()
    })
  })
})
