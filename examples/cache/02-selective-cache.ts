/**
 * GeomStore 缓存示例 - 选择性缓存
 *
 * 演示如何只缓存部分状态键
 */

import { createStore } from '../../src'

console.log('=== 选择性缓存 ===\n')

// 创建用户 Store，只缓存特定键
const userStore = createStore({
  name: 'user-store',
  state: () => ({
    userInfo: { id: 1, name: 'Alice' },
    preferences: { theme: 'light', language: 'en' },
    session: { token: 'xxx', expires: '2024-12-31' },
  }),
  // 只缓存部分状态
  enableCache: true,
  cacheKeys: ['userInfo', 'preferences'], // 不缓存 session
})

// 缓存的键会被缓存
const userInfo1 = userStore.getCached('userInfo')
console.log('User info (first):', userInfo1)

const userInfo2 = userStore.getCached('userInfo')
console.log('User info (cached):', userInfo2)

// 未缓存的键不会被缓存
const session1 = userStore.getCached('session')
console.log('\nSession (first):', session1)

const session2 = userStore.getCached('session')
console.log('Session (not cached):', session2)

const userStats = userStore.getCacheStats()
console.log('\nCache stats:', userStats)

console.log('\n✅ Selective cache example completed')
