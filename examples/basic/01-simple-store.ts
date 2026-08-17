/**
 * GeomStore 基础示例 - 创建简单 Store
 *
 * 演示如何创建和使用基本的 Store 实例
 */

import { createStore } from '../../src'

// 创建一个简单的计数器 Store
const counterStore = createStore({
  name: 'counter',
  state: {
    count: 0,
    message: 'Hello GeomStore!',
  },
})

// 获取状态
console.log('Initial state:', counterStore.getState())

// 更新状态
counterStore.setState('count', 10)
console.log('After setState:', counterStore.getState())

// 批量更新
counterStore.$patch({ count: 20, message: 'Updated!' })
console.log('After $patch:', counterStore.getState())

// 订阅状态变化
const unsubscribe = counterStore.subscribe((state) => {
  console.log('State changed:', state)
})

// 触发更新
counterStore.setState('count', 30)

// 取消订阅
unsubscribe()

console.log('\n✅ Simple store example completed')
