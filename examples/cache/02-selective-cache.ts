/**
 * GeomStore 缓存示例 2：只缓存热点状态
 *
 * 覆盖：enableCache(keys) 的按需缓存——大对象/低频键不缓存，避免无谓开销。
 */

import { createStore } from '../../src/index.js'

const dashboardStore = createStore({
  name: 'cache-selective',
  cacheConfig: { enableStats: true },
  state: () => ({
    // 热点：列表页高频读取
    visibleRows: [{ id: 1, title: 'A' }],
    // 冷数据：仅在详情弹窗偶发读取，缓存收益低
    rawResponse: { huge: 'payload' },
  }),
})

// 只缓存 visibleRows；rawResponse 每次读取都从状态源取
dashboardStore.enableCache(['visibleRows'])

console.log('热点键读取:', dashboardStore.getState().visibleRows)
console.log('冷键读取:', dashboardStore.getState().rawResponse)
console.log('缓存统计:', dashboardStore.getCacheStats())

console.log('\n✅ 缓存示例 2 完成')
