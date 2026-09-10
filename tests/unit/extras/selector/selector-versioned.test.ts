/**
 * 选择器的版本化失效（与真实 Store 配合）
 *
 * 选择器缓存提供「版本化快路径」（O(1) 整数比较）与「无版本回退」（deepEqual），
 * 本文件针对版本化路径：命中快捷返回、版本变更后整体作废、以及参数缓存的
 * 过期清理与容量淘汰。
 */
import { createStore } from '@/core/store/index.js'
import { createSelector } from '@/extras/selector/createSelector.js'
import { createParametricSelector } from '@/extras/selector/parametricSelector.js'

describe('选择器的版本化缓存失效', () => {
  it('createSelector：版本未变时命中缓存，版本变化后重算', () => {
    const store = createStore({ name: 'selector-version', state: { count: 1 } })
    const select = createSelector((s: { count: number }) => s.count * 2)
    const calls: number[] = []
    const counting = createSelector((s: { count: number }) => {
      calls.push(s.count)
      return s.count * 2
    })

    expect(select(store.state)).toBe(2)
    // 第二次命中：item.version === stateVersion 的 O(1) 快路径
    expect(select(store.state)).toBe(2)

    store.$patch({ count: 5 })
    expect(select(store.state)).toBe(10)

    // 计算函数只在版本变化时重跑
    expect(counting(store.state)).toBe(10)
    expect(counting(store.state)).toBe(10)
    expect(calls).toEqual([5])
  })

  it('createSelector：一致的相同输入返回同一结果引用（记忆中）', () => {
    const store = createStore({ name: 'selector-memo', state: { list: [1, 2, 3] } })
    const select = createSelector((s: { list: number[] }) => ({ sum: s.list.reduce((a, b) => a + b, 0) }))

    const first = select(store.state)
    const second = select(store.state)

    expect(first).toEqual({ sum: 6 })
    expect(second).toBe(first)
  })

  it('createParametricSelector：状态就地变异后作废该 state 下的全部参数缓存', () => {
    const store = createStore({ name: 'param-version', state: { base: 1 } })
    const select = createParametricSelector((s: { base: number }, factor: number) => s.base * factor)
    const byState = select(store.state)

    expect(byState(2)).toBe(2)
    expect(byState(3)).toBe(3)

    // 就地变异（WeakMap 键引用不变），版本号递增 → 两份参数缓存全部作废
    store.$patch({ base: 10 })

    expect(byState(2)).toBe(20)
    expect(byState(3)).toBe(30)
  })

  it('createParametricSelector：对象参数走 WeakMap 缓存并随状态变化失效', () => {
    const store = createStore({ name: 'param-object', state: { base: 2 } })
    const select = createParametricSelector((s: { base: number }, params: { factor: number }) => s.base * params.factor)
    const byState = select(store.state)
    const params = { factor: 4 }

    expect(byState(params)).toBe(8)
    expect(byState(params)).toBe(8)

    store.$patch({ base: 3 })
    expect(byState(params)).toBe(12)
  })

  it('createParametricSelector：参数缓存达上限后清理过期条目并淘汰最旧', () => {
    const nowSpy = jest.spyOn(Date, 'now')
    let now = 1_000
    nowSpy.mockReturnValue(now)

    try {
      const store = createStore({ name: 'param-ttl', state: { base: 1 } })
      const select = createParametricSelector((s: { base: number }, factor: number) => s.base * factor, { ttl: 10, maxEntries: 1 })
      const byState = select(store.state)

      expect(byState(1)).toBe(1)

      // 越过 ttl：下次写入前会清理过期条目（容量已达上限才会进入维护）
      now += 100
      expect(byState(2)).toBe(2)
      expect(byState(2)).toBe(2)

      // 再过期一次，覆盖容量淘汰循环
      now += 100
      expect(byState(3)).toBe(3)
    } finally {
      nowSpy.mockRestore()
    }
  })
})
