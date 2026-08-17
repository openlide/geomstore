/**
 * GeomStore 高级示例 - 插件使用
 *
 * 演示如何使用和创建插件
 */

import { createStore, usePlugin, loggerPlugin, persistencePlugin } from '../../src'

// ==================== 使用内置插件 ====================

console.log('=== 插件示例 ===\n')

// 创建带有插件的 Store
const store = createStore({
  name: 'plugin-demo-store',
  state: {
    count: 0,
    message: '',
  },
  actions: {
    increment() {
      // @ts-ignore
      this.setState('count', this.state.count + 1)
    },
    setMessage(msg: string) {
      // @ts-ignore
      this.setState('message', msg)
    },
  },
})

// 使用日志插件
store.use(loggerPlugin({
  enabled: true,
  logLevel: 'info',
}))

// 使用持久化插件
store.use(persistencePlugin({
  key: 'demo-store',
  storage: localStorage,
  include: ['count'],
}))

// 触发自定义钩子
store.setState('count', 10)
store.dispatch('increment')
store.dispatch('setMessage', 'Hello from plugin!')

// ==================== 创建自定义插件 ====================

// 简单的日志插件
const myLoggerPlugin = {
  name: 'my-logger',
  install(store: any) {
    console.log('\n[MyLogger] Plugin installed')

    // 监听状态变化
    store.subscribe((state: any) => {
      console.log('[MyLogger] State changed:', state)
    })

    return {
      // 插件卸载时清理
      uninstall() {
        console.log('[MyLogger] Plugin uninstalled')
      },
    }
  },
}

// 使用自定义插件
usePlugin(myLoggerPlugin)

console.log('\n✅ Plugins example completed')
