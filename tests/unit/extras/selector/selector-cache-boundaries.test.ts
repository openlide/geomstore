/**
 * 选择器缓存的边界：无版本回退、equalityFn、cache=false、参数化选择器 TTL
 */

import { createSelector } from '@/extras/selector/createSelector.js'
import { createParametricSelector } from '@/extras/selector/parametricSelector.js'
import { SelectorComposer } from '@/extras/selector/index.js'

describe('选择器的无版本回退与缓存开关', () => {
  it('无版本标记的普通对象状态走引用比较（未配置 equalityFn）', () => {
    const select = createSelector((s: { count: number }) => s.count * 2)
    const plain = { count: 3 }

    expect(select(plain)).toBe(6)
    expect(select(plain)).toBe(6)
  })

  it('配置 equalityFn 时按自定义等价比较判定缓存命中', () => {
    const equalityFn = jest.fn(() => true)
    const select = createSelector((s: { count: number }) => s.count, { equalityFn } as any)
    const first = { count: 1 }

    expect(select(first)).toBe(1)
    // 换一个引用但内容等价：equalityFn 判定相等 → 命中缓存
    expect(select({ count: 1 })).toBe(1)
    expect(equalityFn).toHaveBeenCalled()
  })

  it('cache=false 时不缓存，每次都重新计算', () => {
    let calls = 0
    const select = createSelector(
      (s: { count: number }) => {
        calls += 1
        return s.count
      },
      { cache: false } as any,
    )
    const state = { count: 1 }

    expect(select(state)).toBe(1)
    expect(select(state)).toBe(1)
    expect(calls).toBe(2)
  })

  it('SelectorComposer 的异步重试选择器不传选项时走缺省值', async () => {
    const selector = (s: { ready: boolean; value: number }) => {
      if (!s.ready) throw new Error('not ready')
      return s.value
    }

    await expect(SelectorComposer.createRetrySelectorAsync(selector as any)({ ready: true, value: 7 } as any)).resolves.toBe(7)
  })
})

describe('参数化选择器的 TTL 维护', () => {
  it('ttl=0 表示立即过期（等同禁用缓存）：读取侧每次重算，仅受容量淘汰约束', () => {
    let callCount = 0
    const select = createParametricSelector(
      (s: { base: number }, factor: number) => {
        callCount++
        return s.base * factor
      },
      { ttl: 0, maxEntries: 1 },
    )
    const byState = select({ base: 2 })

    expect(byState(1)).toBe(2)
    expect(byState(2)).toBe(4)
    expect(byState(1)).toBe(2)
    // ttl=0：条目立即过期，三次调用都应重新执行（不返回缓存值）；容量淘汰仍生效
    expect(callCount).toBe(3)
  })

  it('ttl>0 且容量达上限时清理过期条目并淘汰最旧', () => {
    const nowSpy = jest.spyOn(Date, 'now')
    let now = 1_000
    nowSpy.mockImplementation(() => now)

    try {
      const select = createParametricSelector((s: { base: number }, factor: number) => s.base * factor, { ttl: 10, maxEntries: 1 })
      const byState = select({ base: 1 })

      expect(byState(1)).toBe(1)

      // 越过 ttl：写入前会清理过期条目
      now += 100
      expect(byState(2)).toBe(2)

      // 再次过期：容量淘汰循环
      now += 100
      expect(byState(3)).toBe(3)
    } finally {
      nowSpy.mockRestore()
    }
  })
})
