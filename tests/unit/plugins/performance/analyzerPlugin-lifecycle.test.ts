/**
 * 性能分析插件：卸载时的 monitor 归属守卫
 */

import { createAnalyzerPlugin } from '@/plugins/performance/index.js'
import { createStore } from '@/core/store/index.js'

describe('analyzer 插件卸载的归属守卫', () => {
  it('monitor 已被后续实例覆盖时保留当前引用', () => {
    const store = createStore({ name: 'analyzer-guard', state: { x: 1 } })

    const uninstall = store.use(createAnalyzerPlugin())
    // 模拟后续插件覆盖了 monitor 引用
    const other = { replaced: true }
    ;(store as any).__performanceMonitor__ = other

    expect(() => uninstall()).not.toThrow()
    expect((store as any).__performanceMonitor__).toBe(other)
  })
})
