/**
 * GeomStore 缓存示例 3：运行时开关缓存
 *
 * 覆盖：批量写入前关闭缓存、结束后重新开启。
 *
 * 成本模型要说准：写入**不失效**缓存，所以别按「反复失效与重建」理解这段收益。
 * - `setState` / `$patch` 命中缓存键时是**写穿**（`StoreCacheManager.set` 覆盖同一个键），
 *   循环期间关掉的是 N 次写穿，不是 N 次失效。
 * - 「重建」只有一次：`enableCache()` 会清整表、再按键集从状态源预填一遍。
 * - 关缓存只对**落在缓存键集里的键**有意义——不在键集的键在 `set()` 里本来就被早退。
 * - 前提是缓存先前真的开着：建店时没有 `enableCache: true`、也没调过 `enableCache()` 的话，
 *   `StoreCacheManager._enabled` 一直是 false，`disableCache()` 就是空操作。
 */

import { createStore } from '../../src/index.js'
import type { CacheStats } from '../../src/types/store.js'

// 先定义状态类型：空数组不必写 `as Array<…>` 断言
interface Row {
  id: number
  score: number
}

interface ListState {
  rows: Row[]
  cursor: number
}

export const listStore = createStore({
  name: 'cache-dynamic',
  // 建店即开缓存（不配 cacheKeys = 全部状态键），否则下面的 disableCache() 无从关起
  enableCache: true,
  cacheConfig: { enableStats: true },
  state: (): ListState => ({
    rows: [],
    cursor: 0,
  }),
})

/**
 * 一次性灌入大量数据：期间每次都写穿缓存没有意义，收尾整表重建一次
 *
 * 写入的是 `cursor`——它在缓存键集里（`enableCache()` 不传 keys 即全部状态键），所以这
 * `count` 次「跳过写穿」是真的省下了；换成一个不在键集的键，关与不关都没有差别。
 * 返回关缓存前后的统计，好让人看清 `enabled` 与表内容各变了什么。
 */
export function bulkImportCursor(count: number): BulkImportStats {
  const before = listStore.getCacheStats()
  listStore.disableCache()
  for (let i = 0; i < count; i++) {
    listStore.setState('cursor', i)
  }
  // 重新开启：清表 + 按键集预填（整轮仅此一次重建）
  listStore.enableCache()
  return { before, after: listStore.getCacheStats() }
}

/** 一轮批量导入前后的缓存统计 */
export interface BulkImportStats {
  before: CacheStats
  after: CacheStats
}

export const bulkImportResult = bulkImportCursor(1000)

listStore.setState('rows', [
  { id: 1, score: 90 },
  { id: 2, score: 85 },
])

// 读缓存走 getCached（`getState` 是直接读状态源，不计命中/未命中）
listStore.getCached('cursor')
listStore.getCached('rows')

console.log('行数:', listStore.getState().rows.length)
console.log('游标:', listStore.getState().cursor)
console.log('缓存统计:', listStore.getCacheStats())

console.log('\n✅ 缓存示例 3 完成')
