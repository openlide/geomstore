/**
 * GeomStore 缓存示例 1：开启 Store 内置缓存
 *
 * 覆盖：enableCache()、经 getCached() 读取才计入命中、写入按写穿更新、invalidateCache() 显式失效。
 */

import { createStore } from '../../src/index.js'

const userStore = createStore({
  name: 'cache-basic',
  // 命中/未命中统计默认就是开着的（`cacheConfig.enableStats` 默认 true），这里显式写出来
  // 只是声明意图；方向相反的开关才需要「按需」：性能敏感场景传 false，
  // 关掉后 getCacheStats() 的 hits/misses 恒为 0（键列表与体积统计不受影响）
  cacheConfig: { enableStats: true },
  state: () => ({
    profile: { name: 'Ada', level: 3 },
    settings: { theme: 'light' },
  }),
})

// 不传 keys 表示缓存全部顶层状态键
userStore.enableCache()

// 只有 getCached() 查缓存：getState() 直接返回状态本身，既不算命中也不算未命中
console.log('第一次读取(未命中):', userStore.getCached('profile'))
console.log('第二次读取(命中):', userStore.getCached('profile'))

// 写入是写穿：setState 把新值同步更新进缓存，下一次读取仍是命中、拿到的是新值
userStore.setState('profile', { name: 'Ada', level: 4 })
console.log('写穿后读取:', userStore.getCached('profile'))

// 需要让某个键重新取值时显式失效（$replaceState 会整体清空缓存）
userStore.invalidateCache('profile')
console.log('失效后读取(未命中):', userStore.getCached('profile'))

console.log('缓存统计:', userStore.getCacheStats())

console.log('\n✅ 缓存示例 1 完成')
