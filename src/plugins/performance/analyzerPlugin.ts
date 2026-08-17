/**
 * GeomStore v1.0 - 性能分析插件
 *
 * 提供全面的性能监控和分析功能，包括：
 * - 操作性能监控
 * - 瓶颈分析
 * - 性能统计
 * - 实时分析
 *
 * @since 1.0.0
 */

import type { Store } from '../../types/store'
import type { Plugin } from '../../types/plugin'
import type { PerformanceOptions } from '../../types/performance'
import { PerformanceMonitor } from '../../core/performance/PerformanceMonitor'
import { PerformanceAnalyzer } from '../../core/performance/metrics'
import { isProduction } from '../../core/store/utils'

/**
 * 性能分析插件
 *
 * 自动监控所有Store操作的性能，并提供分析工具
 *
 * @type {Plugin}
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * import { createStore } from '@geomstore/core'
 * import { analyzerPlugin } from '@geomstore/plugins'
 *
 * const store = createStore({
 *   name: 'user',
 *   state: {
 *     userInfo: null,
 *     posts: []
 *   },
 *   actions: {
 *     async fetchUser(id) {
 *       const user = await api.getUser(id)
 *       this.setState('userInfo', user)
 *     },
 *     async fetchPosts(userId) {
 *       const posts = await api.getPosts(userId)
 *       this.setState('posts', posts)
 *     }
 *   },
 *   getters: {
 *     userPosts: (state) => state.posts
 *   }
 * })
 *
 * // 使用默认配置安装
 * store.use(analyzerPlugin)
 *
 * // 使用自定义配置安装
 * store.use(createAnalyzerPlugin({
 *   sampleRate: 1.0,      // 100%采样
 *   threshold: 16,        // 16ms阈值
 *   trackMemory: true,    // 跟踪内存
 *   maxSize: 1000         // 最多1000条记录
 * }))
 *
 * // 访问性能监控器
 * const monitor = store.__performanceMonitor__
 *
 * // 获取所有指标
 * const metrics = monitor.getMetrics()
 * console.log(`Total metrics: ${metrics.length}`)
 *
 * // 获取统计信息
 * const stats = monitor.getStats()
 * console.log(`平均耗时: ${stats.avgDuration.toFixed(2)}ms`)
 * console.log(`最大耗时: ${stats.maxDuration.toFixed(2)}ms`)
 * console.log(`超阈值次数: ${stats.thresholdExceeded}`)
 *
 * // 按类型筛选
 * const dispatchMetrics = monitor.getMetricsByType('dispatch')
 * const getterMetrics = monitor.getMetricsByType('getter')
 *
 * // 按操作筛选
 * const fetchUserMetrics = monitor.getMetricsByOperation('fetchUser')
 *
 * // 获取最近的指标
 * const recentMetrics = monitor.getRecentMetrics(10)
 *
 * // 导出为JSON
 * const report = monitor.exportJSON()
 *
 * // 访问全局API
 * const api = globalThis.__GEOMSTORE_ANALYZER__['user']
 *
 * // 获取指标
 * const allMetrics = api.getMetrics()
 * const allStats = api.getStats()
 *
 * // 分析性能瓶颈
 * const bottlenecks = api.analyzeBottlenecks(16)
 * bottlenecks.forEach(b => {
 *   console.log(`${b.operation}:`)
 *   console.log(`  Severity: ${b.severity}`)
 *   console.log(`  Avg: ${b.avgDuration.toFixed(2)}ms`)
 *   console.log(`  Max: ${b.maxDuration.toFixed(2)}ms`)
 * })
 *
 * // 清除指标
 * api.clear()
 *
 * // 在控制台直接访问
 * // globalThis.__GEOMSTORE_ANALYZER__['user'].getStats()
 * ```
 */
/**
 * 创建带自定义配置的性能分析插件
 *
 * @example
 * ```typescript
 * store.use(createAnalyzerPlugin({ sampleRate: 1.0, threshold: 16 }))
 * ```
 */
export function createAnalyzerPlugin(options: PerformanceOptions = {}): Plugin {
  return {
    name: 'analyzer',
    install(store: Store) {
      return installAnalyzer(store, options)
    },
  }
}

export const analyzerPlugin: Plugin = {
  name: 'analyzer',

  install(store: Store) {
    return installAnalyzer(store, {})
  },
}

/**
 * 性能分析插件的安装实现
 */
function installAnalyzer(store: Store, options: PerformanceOptions): (() => void) | undefined {
  // 创建性能监控器
  const monitor = new PerformanceMonitor(options)

  // 用于存储待完成的性能测量结束函数（before/after 钩子配对使用）。
  // 同类型操作可重入（如 action 内嵌套 dispatch 另一 action），
  // 使用栈结构配对（before push / after pop），避免内层覆盖外层导致外层指标丢失
  const pendingEnds = new Map<string, Array<() => void>>()

  const pushEnd = (key: string, end: () => void): void => {
    let stack = pendingEnds.get(key)
    if (!stack) {
      stack = []
      pendingEnds.set(key, stack)
    }
    stack.push(end)
  }

  const popEnd = (key: string): void => {
    const stack = pendingEnds.get(key)
    const end = stack?.pop()
    if (stack && stack.length === 0) {
      pendingEnds.delete(key)
    }
    end?.()
  }

  // 使用钩子系统替代 monkey-patching，避免多插件冲突
  // 监控 setState
  const unsubBeforeSetState = store.hooks.on('beforeSetState', (key: unknown) => {
    const end = monitor.start(`setState:${String(key)}`)
    // 将 end 函数存入闭包，在 afterSetState 中调用
    pushEnd('setState', end)
  })
  const unsubAfterSetState = store.hooks.on('afterSetState', () => {
    popEnd('setState')
  })

  // 监控 $patch
  const unsubBeforePatch = store.hooks.on('beforePatch', () => {
    const end = monitor.start('patch')
    pushEnd('patch', end)
  })
  const unsubAfterPatch = store.hooks.on('afterPatch', () => {
    popEnd('patch')
  })

  // 监控 $replaceState
  const unsubBeforeReplace = store.hooks.on('beforeReplaceState', () => {
    const end = monitor.start('replaceState')
    pushEnd('replaceState', end)
  })
  const unsubAfterReplace = store.hooks.on('afterReplaceState', () => {
    popEnd('replaceState')
  })

  // 监控 dispatch
  const unsubBeforeDispatch = store.hooks.on('beforeDispatch', (actionName: unknown) => {
    const end = monitor.start(`dispatch:${String(actionName)}`)
    pushEnd('dispatch', end)
  })
  const unsubAfterDispatch = store.hooks.on('afterDispatch', () => {
    popEnd('dispatch')
  })

  // getter 没有钩子，使用包装方式（仅监控，不修改原型）
  const originalGetter = store.getter.bind(store)
  const storeProxy = store as unknown as Record<string, unknown>
  storeProxy.getter = function (...args: unknown[]): unknown {
    const end = monitor.start(`getter:${String(args[0])}`)
    try {
      return (originalGetter as (...a: unknown[]) => unknown)(...args)
    } finally {
      end()
    }
  }

  // 暴露监控器API
  storeProxy.__performanceMonitor__ = monitor

  // 设置全局访问（生产环境不暴露，防止内部结构泄露）
  if (typeof globalThis !== 'undefined' && !isProduction()) {
    const globalObj = globalThis as unknown as Record<string, Record<string, unknown>>
    globalObj.__GEOMSTORE_ANALYZER__ = globalObj.__GEOMSTORE_ANALYZER__ || {}
    globalObj.__GEOMSTORE_ANALYZER__[store.name] = {
      monitor,
      getMetrics: () => monitor.getMetrics(),
      getStats: () => monitor.getStats(),
      analyzeBottlenecks: (threshold?: number) => PerformanceAnalyzer.analyzeBottlenecks(monitor.getMetrics(), threshold),
      clear: () => monitor.clear(),
    }

    console.log(`[GeomStore][analyzer] Performance monitoring enabled for store "${store.name}"`)
    console.log(`[GeomStore][analyzer] Access at: globalThis.__GEOMSTORE_ANALYZER__["${store.name}"]`)
  }

  return () => {
    // 清理钩子订阅
    unsubBeforeSetState()
    unsubAfterSetState()
    unsubBeforePatch()
    unsubAfterPatch()
    unsubBeforeReplace()
    unsubAfterReplace()
    unsubBeforeDispatch()
    unsubAfterDispatch()

    // 恢复 getter（仅 getter 使用了包装）
    storeProxy.getter = originalGetter as (...args: unknown[]) => unknown

    // 清理全局引用
    if (typeof globalThis !== 'undefined') {
      const globalObj = globalThis as unknown as Record<string, Record<string, unknown>>
      delete globalObj.__GEOMSTORE_ANALYZER__?.[store.name]
    }

    monitor.clear()
  }
}
