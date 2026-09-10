/**
 * compose 的 state 合并策略单元测试
 *
 * 覆盖 mergeNamespaced（freeze 缺省值 / 冻结）与 mergeStateMaps
 * （同名键冲突去重告警、同 store 内重复键不告警）。
 */
import { mergeNamespaced, mergeStateMaps } from '@/core/compose/merge.js'
import type { Store } from '@/types/store.js'

interface FakeStore {
  name: string
  getState: () => Record<string, unknown>
}

function fakeStore(name: string, state: Record<string, unknown>): FakeStore {
  return { name, getState: () => state }
}

const asStores = (stores: FakeStore[]): Store[] => stores as unknown as Store[]
const pick = (store: Store): Record<string, unknown> => (store as unknown as FakeStore).getState()

describe('compose/merge', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  describe('mergeNamespaced', () => {
    it('按 store.name 归并，缺省不冻结（可继续写入）', () => {
      const a = fakeStore('a', { x: 1 })
      const b = fakeStore('b', { y: 2 })

      const result = mergeNamespaced(asStores([a, b]), pick)

      expect(result).toEqual({ a: { x: 1 }, b: { y: 2 } })
      expect(Object.isFrozen(result)).toBe(false)
    })

    it('freeze 为 true 时冻结顶层结果（state getter 需阻止顶层写入）', () => {
      const a = fakeStore('a', { x: 1 })

      const result = mergeNamespaced(asStores([a]), pick, true)

      expect(result).toEqual({ a: { x: 1 } })
      expect(Object.isFrozen(result)).toBe(true)
    })
  })

  describe('mergeStateMaps', () => {
    it('平铺合并各 store 的 state 键', () => {
      const a = fakeStore('a', { x: 1 })
      const b = fakeStore('b', { y: 2 })

      expect(mergeStateMaps(asStores([a, b]), pick, new Set())).toEqual({ x: 1, y: 2 })
    })

    it('同名键：后者覆盖前者并告警一次', () => {
      const a = fakeStore('a', { k: 1 })
      const b = fakeStore('b', { k: 2 })

      const result = mergeStateMaps(asStores([a, b]), pick, new Set())

      expect(result).toEqual({ k: 2 })
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"b" wins'))
    })

    it('同一冲突组合只告警一次：重复合并不再刷屏', () => {
      const a = fakeStore('a', { k: 1 })
      const b = fakeStore('b', { k: 2 })
      const warned = new Set<string>()
      const stores = asStores([a, b])

      mergeStateMaps(stores, pick, warned)
      mergeStateMaps(stores, pick, warned)

      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warned.size).toBe(1)
    })

    it('单个 store 内的重复键（同 owner）不告警', () => {
      // 同一 store 的键集合不会有重复，这里用「同名 store」构造 previousOwner === store.name 的路径
      const a1 = fakeStore('a', { k: 1 })
      const a2 = fakeStore('a', { k: 2 })

      const result = mergeStateMaps(asStores([a1, a2]), pick, new Set())

      expect(result).toEqual({ k: 2 })
      expect(warnSpy).not.toHaveBeenCalled()
    })

    it('无键的 store 不产生任何影响', () => {
      const empty = fakeStore('empty', {})

      expect(mergeStateMaps(asStores([empty]), pick, new Set())).toEqual({})
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
