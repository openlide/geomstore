/**
 * 第五轮 extras-selector 分片：参数化选择器的键分侧、容量与降级
 *
 * - R5-228：函数参数与对象参数同走 WeakMap，不再落进强引用的 Map
 * - R5-229：`maxEntries` 归一化（0 / 负数夹到 1，`NaN` / `Infinity` 回默认 1000）
 * - R5-230：非对象状态只降级不崩（WeakMap.set 会抛 TypeError）
 * - R5-231：版本化条目不再常驻一份用不到的状态快照，降级路径仍按快照 + deepEqual 收敛
 */
import { createParametricSelector } from '@/extras/selector/parametricSelector.js'
import { defineStateVersion } from '@/core/store/stateVersion.js'

type S = { value: number }

/** 状态上的版本标记键，与 core/store/stateVersion.ts 的 Symbol.for 同一个 */
const STATE_VERSION = Symbol.for('geomstore.stateVersion')

describe('函数参数走 WeakMap 侧（R5-228）', () => {
  it('函数参数不再被原始侧的容量淘汰挤掉', () => {
    let calls = 0
    const select = createParametricSelector<S, unknown, number>(
      (s, _params) => {
        calls += 1
        return s.value
      },
      { ttl: 60_000, maxEntries: 1 },
    )
    const byState = select({ value: 7 })
    const fn = () => 0

    expect(byState(fn)).toBe(7)
    // 修复前：函数被静默判给原始类型侧（那句 `as string | number | ...` 的断言骗过了编译器），
    // 于是受 maxEntries 的插入序淘汰——这次写入就把上面的函数键挤掉了
    expect(byState(42)).toBe(7)
    const callsAfterPrimitive = calls
    expect(byState(fn)).toBe(7)
    expect(calls).toBe(callsAfterPrimitive)
  })

  it('函数参数仍按 TTL 过期，且不同函数各自独立缓存', () => {
    jest.useFakeTimers()
    try {
      let calls = 0
      const select = createParametricSelector<S, () => number, number>(
        (s, params) => {
          calls += 1
          return s.value + params()
        },
        { ttl: 1000 },
      )
      const byState = select({ value: 1 })
      const a = () => 10
      const b = () => 20

      expect(byState(a)).toBe(11)
      expect(byState(a)).toBe(11)
      expect(byState(b)).toBe(21)
      expect(calls).toBe(2)

      jest.advanceTimersByTime(1001)
      expect(byState(a)).toBe(11)
      expect(calls).toBe(3)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('maxEntries 归一化（R5-229）', () => {
  it('NaN 回落到默认 1000：不再「淘汰到空表却仍写入一条」', () => {
    let calls = 0
    const select = createParametricSelector<S, number, number>(
      (s, params) => {
        calls += 1
        return s.value + params
      },
      { ttl: 60_000, maxEntries: Number.NaN },
    )
    const byState = select({ value: 1 })

    expect(byState(1)).toBe(2)
    expect(byState(2)).toBe(3)
    // 修复前：`cacheMap.size < NaN` 恒假 → 每次写入先把整表清空再写一条，
    // 上限形同虚设（等价于关缓存），参数 1 的条目被无端抹掉
    expect(byState(1)).toBe(2)
    expect(calls).toBe(2)
  })

  it('Infinity 不再让缓存无界增长：超过默认 1000 后按插入序淘汰', () => {
    const seen: number[] = []
    const select = createParametricSelector<S, number, number>(
      (s, params) => {
        seen.push(params)
        return s.value + params
      },
      { ttl: 60_000, maxEntries: Number.POSITIVE_INFINITY },
    )
    const byState = select({ value: 0 })

    for (let i = 1; i <= 1001; i++) {
      expect(byState(i)).toBe(i)
    }
    expect(byState(1)).toBe(1)
    // 修复前：`size < Infinity` 恒真 → 直接 return，条目只增不减（第一条目仍在）
    expect(seen.filter((p) => p === 1)).toHaveLength(2)
  })

  it('0 与负数夹到 1：仍保留最近一条（缓存不静默失效，也不越界多留）', () => {
    let calls = 0
    const select = createParametricSelector<S, number, number>(
      (s, params) => {
        calls += 1
        return s.value + params
      },
      { ttl: 60_000, maxEntries: 0 },
    )
    const byState = select({ value: 0 })

    expect(byState(1)).toBe(1)
    expect(byState(1)).toBe(1)
    expect(calls).toBe(1)

    expect(byState(2)).toBe(2)
    expect(byState(1)).toBe(1)
    expect(calls).toBe(3)
  })

  it('非整数上限先取整再用作容量（2.7 与 2 同形）', () => {
    let calls = 0
    const select = createParametricSelector<S, number, number>(
      (s, params) => {
        calls += 1
        return s.value + params
      },
      { ttl: 60_000, maxEntries: 2.7 },
    )
    const byState = select({ value: 0 })

    expect(byState(1)).toBe(1)
    expect(byState(2)).toBe(2)
    expect(byState(3)).toBe(3)
    expect(calls).toBe(3)
    // 容量是 floor(2.7) = 2 → 写第 3 条时最旧的 1 已被淘汰。
    // 未取整时 `size < 2.7` 允许表长到 3，这里会误判成「仍缓存着 1」
    expect(byState(1)).toBe(1)
    expect(calls).toBe(4)
  })
})

describe('非对象状态的降级（R5-230）', () => {
  it('null / 原始值状态不抛错，只是不缓存', () => {
    let calls = 0
    const select = createParametricSelector<S, number, number>(
      (_state, params) => {
        calls += 1
        return params * 2
      },
      { ttl: 60_000 },
    )

    for (const bad of [null, undefined, 42, 'state', true, Symbol('s')] as unknown as S[]) {
      const byState = select(bad)
      // 修复前：走到 `stateCache.set(state as object, cache)` 抛
      // `TypeError: Invalid value used as weak map key`，降级路径变成崩溃路径
      expect(byState(3)).toBe(6)
      expect(byState(3)).toBe(6)
    }
    expect(calls).toBe(12)
  })

  it('同一次工厂调用里，坏状态不影响随后正常对象的缓存', () => {
    let calls = 0
    const select = createParametricSelector<S, number, number>(
      (state, params) => {
        calls += 1
        // 容忍坏状态：本用例要证的是「工厂不崩、随后正常对象照旧缓存」
        return (state ? state.value : 0) + params
      },
      { ttl: 60_000 },
    )

    expect(select(null as unknown as S)(1)).toBe(1)
    const byState = select({ value: 10 })
    expect(byState(1)).toBe(11)
    expect(byState(1)).toBe(11)
    expect(calls).toBe(2)
  })
})

describe('状态快照只在无版本路径上驻留（R5-231）', () => {
  it('版本化条目不建快照；版本标记消失后按快照收敛，不反复重建', () => {
    let counter = 1
    const state: S = { value: 1 }
    defineStateVersion(state, () => counter)

    let calls = 0
    const select = createParametricSelector<S, number, number>(
      (s, params) => {
        calls += 1
        return s.value + params
      },
      { ttl: 60_000 },
    )
    const byState = select(state)

    expect(byState(1)).toBe(2)
    expect(calls).toBe(1)
    // 版本推进：参数缓存整体作废并重建
    counter = 2
    expect(byState(1)).toBe(2)
    expect(calls).toBe(2)
    // 同一版本内命中缓存，不做任何快照比较
    expect(byState(1)).toBe(2)
    expect(calls).toBe(2)

    // 状态「失去」版本标记（模拟被复制/剥离 getter 的降级）：必须按 miss 处理，
    // 版本化条目不再持有活引用快照可比，参数缓存也不能沿用
    delete (state as unknown as Record<symbol, unknown>)[STATE_VERSION]
    expect(byState(1)).toBe(2)
    expect(calls).toBe(3)

    // 降级后走「快照 + deepEqual」：内容未变即命中，不再每次重建快照
    expect(byState(1)).toBe(2)
    expect(calls).toBe(3)
    // 无版本路径上就地变异仍要可见——驻留的是内容拷贝，不是活引用
    state.value = 5
    expect(byState(1)).toBe(6)
    expect(calls).toBe(4)
  })
})
