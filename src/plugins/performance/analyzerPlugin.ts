/**
 * GeomStore - 性能分析插件
 *
 * 提供全面的性能监控和分析功能，包括：
 * - 操作性能监控
 * - 瓶颈分析
 * - 性能统计
 * - 实时分析
 *
 */

import type { Store } from '../../types/store.js'
import type { Plugin } from '../../types/plugin.js'
import type { PerformanceOptions } from '../../types/performance.js'
import { PerformanceMonitor } from '../../core/performance/PerformanceMonitor.js'
import { PerformanceAnalyzer } from '../../core/performance/metrics.js'
import { registerGlobalEntry } from '../globalRegistry.js'
import { isProduction } from '../../core/store/utils.js'

/**
 * 性能分析插件
 *
 * 自动监控所有Store操作的性能，并提供分析工具
 *
 * @type {Plugin}
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
export function createAnalyzerPlugin(options: PerformanceOptions = {}): Plugin {
  return {
    name: 'analyzer',
    install(store: Store) {
      return installAnalyzer(store, options)
    },
  }
}

/**
 * 性能分析插件（默认配置）
 *
 * 等价于 `createAnalyzerPlugin()`；需要自定义采样率、阈值等请改用
 * `createAnalyzerPlugin(options)`。
 */
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

  /**
   * 钩子名 → 计时配对键
   *
   * `HookSystem.emit` 在处理器抛错时会以第二参把出错的 hookName 回传
   * （`this.emit('onError', error, hookName)`，见 core/hooks/HookSystem.ts），
   * 据此可把清理范围收敛到出错的那一类操作。
   */
  const HOOK_TO_OPERATION = new Map<string, string>([
    ['beforeSetState', 'setState'],
    ['afterSetState', 'setState'],
    ['beforePatch', 'patch'],
    ['afterPatch', 'patch'],
    ['beforeReplaceState', 'replaceState'],
    ['afterReplaceState', 'replaceState'],
    ['beforeDispatch', 'dispatch'],
    ['afterDispatch', 'dispatch'],
  ])

  // 错误路径（如 action 执行抛错）不会触发 afterXxx 钩子，
  // 若不清理，配对栈中的残留 end 会导致后续同类型操作的配对错位（内层 pop 到外层的计时），
  // 且 monitor 内部计时条目会随错误次数持续泄漏。
  // onError 的处理是结束「到错误发生为止」的耗时（对定位错误操作的性能开销有参考价值）
  // 并弹出该栈项，保证后续配对正确。
  //
  // 清理范围按 source 收敛（此前对所有类型各弹一条）：onError 并不只代表「当前正在计时的
  // 操作出错」——缓存刷新失败、persistence 保存失败、任意第三方钩子处理器抛错都走同一钩子，
  // 一律弹栈顶会把与错误无关、仍在进行中的外层计时提前结束（例如 patch 内部触发
  // beforeSetState 时某处理器抛错，会连带终止 patch 自己的计时），
  // 后续 after* 钩子因此 pop 到错误的配对项、指标时长失真。三类来源：
  // - source 本身就是配对键（如 'setState'）或可归一到配对键的钩子名 → 只弹该类型
  // - 与计时无关的 source（如 persistencePlugin 传的 'persistence'）→ 一条都不弹
  // - 无 source：当前唯一的无源发射点是 ActionManager 的 dispatch 失败路径
  //   （core/store/ActionManager.ts 的三处 emit 都不带第二参），故按 dispatch 处理
  const discardPendingEnds = (source?: string): void => {
    if (source === undefined) {
      popEnd('dispatch')
      return
    }
    const key: string | undefined = pendingEnds.has(source) ? source : HOOK_TO_OPERATION.get(source)
    if (key !== undefined) {
      popEnd(key)
    }
  }

  // 使用钩子系统替代 monkey-patching，避免多插件冲突
  // 每处 start 都必须显式传 MetricType：start 的第二参默认 'dispatch'，
  // 漏传会让 setState/patch/replaceState/getter 的指标全部被标成 dispatch，
  // getMetricsByType('getter') 等恒返回空数组、瓶颈分析失去类型维度
  // 监控 setState
  const unsubBeforeSetState = store.hooks.on('beforeSetState', (key: unknown) => {
    const end = monitor.start(`setState:${String(key)}`, 'setState')
    // 将 end 函数存入闭包，在 afterSetState 中调用
    pushEnd('setState', end)
  })
  const unsubAfterSetState = store.hooks.on('afterSetState', () => {
    popEnd('setState')
  })

  // 监控 $patch
  const unsubBeforePatch = store.hooks.on('beforePatch', () => {
    const end = monitor.start('patch', 'patch')
    pushEnd('patch', end)
  })
  const unsubAfterPatch = store.hooks.on('afterPatch', () => {
    popEnd('patch')
  })

  // 监控 $replaceState
  const unsubBeforeReplace = store.hooks.on('beforeReplaceState', () => {
    const end = monitor.start('replaceState', 'replaceState')
    pushEnd('replaceState', end)
  })
  const unsubAfterReplace = store.hooks.on('afterReplaceState', () => {
    popEnd('replaceState')
  })

  // 监控 dispatch
  const unsubBeforeDispatch = store.hooks.on('beforeDispatch', (actionName: unknown) => {
    const end = monitor.start(`dispatch:${String(actionName)}`, 'dispatch')
    pushEnd('dispatch', end)
  })
  const unsubAfterDispatch = store.hooks.on('afterDispatch', () => {
    popEnd('dispatch')
  })

  // getter 没有钩子，使用包装方式（仅监控，不修改原型）
  const originalGetter = store.getter.bind(store)
  const storeProxy = store as unknown as Record<string, unknown>
  // getter 计时开关：卸载时置 false。仅靠 `store.getter === wrappedGetter` 的身份判断
  // 不足以停掉监控——后续插件把 wrappedGetter 包在链里时身份判断会保留该包装，
  // 而包装闭包仍持有 monitor：此后每次 store.getter(...) 都会向一个已 clear()、
  // 外部再无任何引用入口（__performanceMonitor__ 与全局条目均已清理）的 monitor
  // 持续写入指标，既产生无效开销，也让「已卸载」的插件继续留存数据（幽灵监控）
  let getterActive = true
  const wrappedGetter = function (...args: unknown[]): unknown {
    if (!getterActive) {
      // 已卸载：直接透传安装前的实现，不再产生任何计时
      return (originalGetter as (...a: unknown[]) => unknown)(...args)
    }
    const end = monitor.start(`getter:${String(args[0])}`, 'getter')
    try {
      return (originalGetter as (...a: unknown[]) => unknown)(...args)
    } finally {
      end()
    }
  }
  storeProxy.getter = wrappedGetter

  // 暴露监控器API
  storeProxy.__performanceMonitor__ = monitor

  // 设置全局访问（生产环境不暴露，防止内部结构泄露）
  // 卸载按身份守卫清理（registerGlobalEntry 内实现，避免误删后装实例的接口）
  let unregisterAnalyzerGlobal: () => void = () => {}
  if (!isProduction()) {
    const analyzerAPI = {
      monitor,
      getMetrics: () => monitor.getMetrics(),
      getStats: () => monitor.getStats(),
      analyzeBottlenecks: (threshold?: number) => PerformanceAnalyzer.analyzeBottlenecks(monitor.getMetrics(), threshold),
      clear: () => monitor.clear(),
    }
    unregisterAnalyzerGlobal = registerGlobalEntry('__GEOMSTORE_ANALYZER__', store.name, analyzerAPI)

    console.log(`[GeomStore][analyzer] Performance monitoring enabled for store "${store.name}"`)
    console.log(`[GeomStore][analyzer] Access at: globalThis.__GEOMSTORE_ANALYZER__["${store.name}"]`)
  }

  // 错误时丢弃与之相关的未完成配对计时（清理范围按 source 收敛，见 discardPendingEnds 注释）
  const unsubOnError = store.hooks.on('onError', (_error: unknown, source?: string) => {
    discardPendingEnds(source)
  })

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
    unsubOnError()

    // 关闭 getter 计时开关：即使本插件的包装被后续插件继续持有，卸载后也不再写入
    // 下面即将 clear() 的 monitor（见 wrappedGetter 处的 getterActive 注释）
    getterActive = false

    // 恢复 getter：仅当仍是本插件包装的函数时才恢复，
    // 避免多插件叠加包装时卸载顺序不当把后续插件的包装一并覆盖丢失
    if (storeProxy.getter === wrappedGetter) {
      storeProxy.getter = originalGetter as (...args: unknown[]) => unknown
    } else if (!isProduction()) {
      console.warn(`[GeomStore][analyzer] store.getter 已被后续插件重新包装，卸载时保留当前包装（不再恢复本插件安装前的原始实现），以免覆盖其他插件`)
    }

    // 清理全局引用（身份守卫：仅当条目仍属于本实例时才删除）
    unregisterAnalyzerGlobal()

    monitor.clear()
    // 清理实例上的 monitor 引用（与 timeTravel 插件的 __timeTravel__ 清理对齐）。
    // 身份守卫：同 store 后装的第二实例会覆盖该属性，只清理属于自己的
    if ((storeProxy as Record<string | symbol, unknown>).__performanceMonitor__ === monitor) {
      delete (storeProxy as Record<string | symbol, unknown>).__performanceMonitor__
    }
  }
}
