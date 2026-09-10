/**
 * SelectorFactory.withCacheResult：缓存开关两侧的命中标记
 */

import { SelectorFactory } from '@/extras/selector/index.js'

describe('SelectorFactory.withCacheResult', () => {
  it('cache=true 时复用缓存并标注 fromCache', () => {
    const factory = new SelectorFactory((state: { count: number }) => state.count)
    const select = factory.withCacheResult()
    const state = { count: 3 }

    expect(select(state)).toEqual({ value: 3, fromCache: false })
    expect(select(state)).toEqual({ value: 3, fromCache: true })
  })

  it('cache=false 时既不查缓存也不写缓存', () => {
    let calls = 0
    const factory = new SelectorFactory(
      (state: { count: number }) => {
        calls += 1
        return state.count
      },
      { cache: false },
    )
    const select = factory.withCacheResult()
    const state = { count: 3 }

    expect(select(state)).toEqual({ value: 3, fromCache: false })
    expect(select(state)).toEqual({ value: 3, fromCache: false })
    expect(calls).toBe(2)
  })
})
