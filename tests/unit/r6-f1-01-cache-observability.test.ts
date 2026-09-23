/**
 * R6-013 回归锁：examples/cache/02-selective-cache.ts 的观测口径
 *
 * 该示例讲「只缓存 visibleRows；rawResponse 每次读取都从状态源取」，但读法一旦写成
 * `getState()` 就完全绕开缓存，`getCacheStats()` 恒为 0，示例自证不了结论。
 * 这里把两条读法的真实差异钉住：getState 不记统计、getCached 才记 hit/miss。
 */

import { createStore } from '../../src/index.js'

function makeStore() {
  return createStore({
    name: 'cache-selective-probe',
    cacheConfig: { enableStats: true },
    state: () => ({
      visibleRows: [{ id: 1, title: 'A' }],
      rawResponse: { huge: 'payload' },
    }),
  })
}

describe('缓存统计只由 getCached 记账（getState 绕过缓存）', () => {
  it('enableCache 预填后，getState() 连读两次不产生任何 hit/miss', () => {
    const store = makeStore()
    store.enableCache(['visibleRows'])

    store.getState().visibleRows
    store.getState().rawResponse

    expect(store.getCacheStats().hits).toBe(0)
    expect(store.getCacheStats().misses).toBe(0)
    // 报告断言的「示例只会给出 hits: 0, misses: 0」成立，而 keys/size 因预填非零
    expect(store.getCacheStats().keys).toEqual(['visibleRows'])
    expect(store.getCacheStats().size).toBe(1)
  })

  it('getCached 读缓存键记 hit，读非缓存键既不 hit 也不 miss 且每次回源', () => {
    const store = makeStore()
    store.enableCache(['visibleRows'])

    expect(store.getCached('visibleRows')).toEqual([{ id: 1, title: 'A' }])
    expect(store.getCacheStats()).toMatchObject({ hits: 1, misses: 0 })

    // 冷键被 _cacheKeys 过滤分支提前返回：不记任何统计，值直接来自状态源
    store.setState('rawResponse', { huge: 'payload2' })
    expect(store.getCached('rawResponse')).toEqual({ huge: 'payload2' })
    const afterCold = store.getCacheStats()
    expect(afterCold.hits).toBe(1)
    expect(afterCold.misses).toBe(0)
    expect(afterCold.keys).toEqual(['visibleRows'])
  })

  it('缓存键失效后重读 → 记一次 miss 并回填', () => {
    const store = makeStore()
    store.enableCache(['visibleRows'])
    store.getCached('visibleRows')
    store.invalidateCache('visibleRows')

    expect(store.getCached('visibleRows')).toEqual([{ id: 1, title: 'A' }])
    expect(store.getCacheStats()).toMatchObject({ hits: 1, misses: 1 })
  })

  it('示例 02-selective-cache 跑完自己就能观测到 hit 与 miss（改回 getState 读法即红）', async () => {
    const mod = await import('../../examples/cache/02-selective-cache.js')
    const stats = mod.dashboardStore.getCacheStats()
    expect(stats.enabled).toBe(true)
    // 示例讲的是「热键命中 / 冷键回源」：两条都必须留下记账痕迹。
    // 读法写成 getState() 时这里必然是 0/0（只有 enableCache 预填出的 keys/size 非零），
    // 也就是示例自相矛盾的那个状态。
    expect(stats.hits).toBeGreaterThanOrEqual(1)
    expect(stats.misses).toBeGreaterThanOrEqual(1)
    expect(stats.keys).toEqual(['visibleRows'])
  })
})
