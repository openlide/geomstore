/**
 * GeomStore 缓存示例 3：运行时开关缓存
 *
 * 覆盖：批量写入/长循环前关闭缓存、结束后重新开启，避免中间态反复失效与重建。
 */

import { createStore } from '../../src/index.js'

// 先定义状态类型：空数组不必写 `as Array<…>` 断言
interface Row {
  id: number
  score: number
}

interface ListState {
  rows: Row[]
  cursor: number
}

const listStore = createStore({
  name: 'cache-dynamic',
  cacheConfig: { enableStats: true },
  state: (): ListState => ({
    rows: [],
    cursor: 0,
  }),
})

// 场景：一次性灌入大量数据 —— 期间每次都失效缓存没有意义
listStore.disableCache()
for (let i = 0; i < 1000; i++) {
  listStore.setState('cursor', i)
}
listStore.enableCache(['rows']) // 热点键重新开启

listStore.setState('rows', [
  { id: 1, score: 90 },
  { id: 2, score: 85 },
])

console.log('行数:', listStore.getState().rows.length)
console.log('游标:', listStore.getState().cursor)
console.log('缓存统计:', listStore.getCacheStats())

console.log('\n✅ 缓存示例 3 完成')
