/**
 * GeomStore 缓存示例 2：只缓存热点状态
 *
 * 覆盖：enableCache(keys) 的按需缓存——大对象/低频键不缓存，避免无谓开销。
 * 读法要点：**只有 `getCached(key)` 走缓存**，`getState()` 直接返回内部状态、
 * 既不查缓存也不记统计，所以「命中/回源」必须用 getCached 才观测得到。
 */

import { createStore } from '../../src/index.js'

// 导出句柄只为让回归锁能断言示例讲的东西真的成立：
// tests/unit/r6-f1-01-cache-observability.test.ts
export const dashboardStore = createStore({
  name: 'cache-selective',
  cacheConfig: { enableStats: true },
  state: () => ({
    // 热点：列表页高频读取
    visibleRows: [{ id: 1, title: 'A' }],
    // 冷数据：仅在详情弹窗偶发读取，缓存收益低
    rawResponse: { huge: 'payload' },
  }),
})

// 只缓存 visibleRows；rawResponse 每次读取都回源取
dashboardStore.enableCache(['visibleRows'])

// enableCache 会把白名单里的键预填进缓存 → 第一次读就是命中
console.log('热点键读取:', dashboardStore.getCached('visibleRows'))
// 不在 cacheKeys 里的键由过滤分支提前返回：每次直接读状态源，且不记 hit/miss
console.log('冷键读取:', dashboardStore.getCached('rawResponse'))
// 让热键失效后重读，才会记到一次 miss（回源并重新写入缓存）
dashboardStore.invalidateCache('visibleRows')
console.log('失效后重读:', dashboardStore.getCached('visibleRows'))

console.log('缓存统计:', dashboardStore.getCacheStats())

console.log('\n✅ 缓存示例 2 完成')
