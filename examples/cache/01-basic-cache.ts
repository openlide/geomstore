/**
 * GeomStore 缓存示例 1：开启 Store 内置缓存
 *
 * 覆盖：enableCache()、变更后的失效、getCacheStats() 观察命中情况。
 */

import { createStore } from '../../src/index.js'

const userStore = createStore({
  name: 'cache-basic',
  // 采集缓存统计（hits/misses）会带来少量开销，按需开启
  cacheConfig: { enableStats: true },
  state: () => ({
    profile: { name: 'Ada', level: 3 },
    settings: { theme: 'light' },
  }),
})

// 不传 keys 表示缓存全部顶层状态键
userStore.enableCache()

// 重复读取走缓存，不再重复执行取值与保护代理包装
console.log('第一次读取:', userStore.getState().profile)
console.log('第二次读取:', userStore.getState().profile)

// 写入会失效对应键的缓存，下次读取重新计算
userStore.setState('profile', { name: 'Ada', level: 4 })
console.log('变更后读取:', userStore.getState().profile)

console.log('缓存统计:', userStore.getCacheStats())

console.log('\n✅ 缓存示例 1 完成')
