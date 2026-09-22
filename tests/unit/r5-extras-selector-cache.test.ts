/**
 * 第五轮 extras-selector 分片：SelectorFactory 的缓存口径回归
 *
 * - R5-225：`cacheTTL` 的取值守卫（`NaN` / `0` / 负数 / 非数值回落默认，`Infinity` 显式允许）
 * - R5-226：跳过历史回溯所依赖的版本单调不变量——被破坏时只多算一次，不返回错值
 * - R5-227：`updateCache` 写入前剔除过期条目，过期项不再挤占仍有效条目的槽位
 */
import { createSelector, SelectorFactory } from '@/extras/selector/createSelector.js'
import { defineStateVersion } from '@/core/store/stateVersion.js'

type S = { value: number }

/** `createSelector` 的返回类型是裸 Selector，factory 由 Object.assign 附加（公开签名不含），按实际形状收窄 */
const factoryOf = (select: (state: S) => number): SelectorFactory<S, number> => (select as unknown as { factory: SelectorFactory<S, number> }).factory

describe('cacheTTL 的取值守卫（R5-225）', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  const counting = (options: { cacheTTL?: number }) => {
    let calls = 0
    const select = createSelector((s: S) => {
      calls += 1
      return s.value
    }, options)
    return { select, calls: () => calls }
  }

  it('NaN 回落到默认 5000ms：未守卫时 timestamp + NaN <= now 恒假，条目永不过期', () => {
    const { select, calls } = counting({ cacheTTL: Number.NaN })
    const state: S = { value: 1 }

    expect(select(state)).toBe(1)
    jest.advanceTimersByTime(5001)
    expect(select(state)).toBe(1)
    expect(calls()).toBe(2)
  })

  it('0 回落到默认 5000ms：未守卫时每条缓存写入即过期，静默退化成「不缓存但仍付快照成本」', () => {
    const { select, calls } = counting({ cacheTTL: 0 })
    const state: S = { value: 2 }

    expect(select(state)).toBe(2)
    expect(select(state)).toBe(2)
    expect(calls()).toBe(1)
  })

  it('负数同样回落到默认值', () => {
    const { select, calls } = counting({ cacheTTL: -1 })
    const state: S = { value: 3 }

    expect(select(state)).toBe(3)
    expect(select(state)).toBe(3)
    expect(calls()).toBe(1)
  })

  it('非数值（未类型化调用方传字符串）回落默认：字符串会让过期判定退化成字符串拼接', () => {
    const { select, calls } = counting({ cacheTTL: '60000' as unknown as number })
    const state: S = { value: 4 }

    expect(select(state)).toBe(4)
    jest.advanceTimersByTime(5001)
    expect(select(state)).toBe(4)
    expect(calls()).toBe(2)
  })

  it('Infinity 显式允许：不按时间过期，只由版本号 / equalityFn 失效', () => {
    const { select, calls } = counting({ cacheTTL: Number.POSITIVE_INFINITY })
    const state: S = { value: 5 }

    expect(select(state)).toBe(5)
    jest.advanceTimersByTime(60_000)
    expect(select(state)).toBe(5)
    expect(calls()).toBe(1)

    // 失效凭证仍在：状态内容变了要重算（Infinity 不等于「关掉失效」）
    state.value = 6
    expect(select(state)).toBe(6)
    expect(calls()).toBe(2)
  })
})

describe('历史回溯跳过与版本单调不变量（R5-226）', () => {
  it('版本号被重置到更小值时只多算一次，不返回错值', () => {
    let counter = 5
    const state: S = { value: 1 }
    // 手工装载版本 getter，以便模拟「同一对象上计数被重置」（对象池复用那类改动）
    defineStateVersion(state, () => counter)

    let calls = 0
    const select = createSelector(
      (s: S) => {
        calls += 1
        return s.value
      },
      { cacheTTL: 60_000, cacheSize: 4 },
    )

    expect(counter).toBe(5)
    expect(select(state)).toBe(1)
    expect(calls).toBe(1)

    counter = 0
    // 版本从 5 变 0：当前条目判 miss → 重算，结果仍是真实值
    expect(select(state)).toBe(1)
    expect(calls).toBe(2)

    // 新条目按重置后的版本命中，未命中的历史只浪费一次计算
    expect(select(state)).toBe(1)
    expect(calls).toBe(2)

    counter = 1
    state.value = 2
    expect(select(state)).toBe(2)
    expect(calls).toBe(3)
  })
})

describe('updateCache 写入前剔除过期条目（R5-227）', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  it('过期条目不再把仍有效的条目挤出 cacheSize', () => {
    let calls = 0
    const select = createSelector(
      (s: S) => {
        calls += 1
        return s.value
      },
      { cacheTTL: 100, cacheSize: 2 },
    )
    const factory = factoryOf(select)
    const a: S = { value: 1 }
    const b: S = { value: 2 }
    const c: S = { value: 3 }

    // t=0 写入 a
    select(a)
    // t=50 写入 b：history [a, b]
    jest.advanceTimersByTime(50)
    select(b)
    // t=60 命中 a（a 在 t=100 才过期）→ LRU 提升，history 变 [b, a]
    jest.advanceTimersByTime(10)
    select(a)
    expect(calls).toBe(2)

    // t=110 写入 c：a 已过期（0+100 <= 110）被剔除，仍有效的 b（50+100 > 110）留任
    jest.advanceTimersByTime(50)
    select(c)
    expect(factory.getCacheStatus().cacheSize).toBe(2)
    expect(calls).toBe(3)

    // b 没被过期条目挤掉：命中，不再多算一次
    jest.advanceTimersByTime(10)
    select(b)
    expect(calls).toBe(3)
  })
})
