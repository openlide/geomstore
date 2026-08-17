/**
 * GeomStore 缓存示例 - 基础缓存
 *
 * 演示如何使用 getCached 获取缓存数据
 */

import { createStore } from '../../src'

// 创建设备信息 Store，启用缓存
const deviceStore = createStore({
  name: 'device-store',
  state: {
    device: {
      platform: 'ios',
      model: 'iPhone 12',
      systemVersion: '15.0',
    },
    navBarHeight: 44,
    statusBarHeight: 47,
    theme: 'light',
  },
  // 启用缓存（缓存所有状态）
  enableCache: true,
})

console.log('=== 基础缓存功能 ===\n')

// 从缓存获取设备信息（首次：缓存未命中）
const device1 = deviceStore.getCached('device')
console.log('Device (first access):', device1)

// 再次从缓存获取（缓存命中）
const device2 = deviceStore.getCached('device')
console.log('Device (cached):', device2)

// 查看缓存统计
const stats = deviceStore.getCacheStats()
console.log('\nCache stats:', stats)
console.log('Cache hit rate:', ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) + '%')

console.log('\n✅ Basic cache example completed')
