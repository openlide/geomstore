/**
 * GeomStore 缓存示例 - 动态控制缓存
 *
 * 演示如何动态启用、禁用和清除缓存
 */

import { createStore } from '../../src'

console.log('=== 动态缓存控制 ===\n')

// 创建主题 Store，默认不启用缓存
const themeStore = createStore({
  name: 'theme-store',
  state: {
    theme: 'light',
    primaryColor: '#007AFF',
    fontSize: 16,
  },
})

console.log('Initial cache enabled:', themeStore.getCacheStats().enabled)

// 动态启用缓存
themeStore.enableCache(['theme', 'primaryColor'])
console.log('After enableCache:', themeStore.getCacheStats().enabled)
console.log('Cache size:', themeStore.getCacheStats().size)

// 获取值（缓存）
themeStore.getCached('theme')
themeStore.getCached('primaryColor')
console.log('Cache hits:', themeStore.getCacheStats().hits)

// 清除特定缓存
themeStore.invalidateCache('theme')
console.log('After invalidate theme, cache size:', themeStore.getCacheStats().size)

// 禁用缓存
themeStore.disableCache()
console.log('After disableCache:', themeStore.getCacheStats().enabled)

console.log('\n✅ Dynamic cache example completed')
