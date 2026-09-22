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
import type { Plugin, HookName } from '../../types/plugin.js'
import type { PerformanceOptions, MetricType } from '../../types/performance.js'
import { PerformanceMonitor } from '../../core/performance/PerformanceMonitor.js'
import { PerformanceAnalyzer } from '../../core/performance/metrics.js'
import { registerGlobalEntry } from '../globalRegistry.js'
import { isProduction } from '../../core/store/utils.js'

/** 全局调试表的键名：注册与日志提示必须同源，否则日志会指向一个不存在的路径 */
const ANALYZER_GLOBAL_KEY = '__GEOMSTORE_ANALYZER__'

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
 * // 访问全局API（仅在非生产环境注册；未安装插件或 store 名不符时为 undefined）
 * const api = globalThis.__GEOMSTORE_ANALYZER__?.['user']
 *
 * // 获取指标
 * const allMetrics = api?.getMetrics()
 * const allStats = api?.getStats()
 *
 * // 分析性能瓶颈
 * const bottlenecks = api?.analyzeBottlenecks(16) ?? []
 * bottlenecks.forEach(b => {
 *   console.log(`${b.operation}:`)
 *   console.log(`  Severity: ${b.severity}`)
 *   console.log(`  Avg: ${b.avgDuration.toFixed(2)}ms`)
 *   console.log(`  Max: ${b.maxDuration.toFixed(2)}ms`)
 * })
 *
 * // 清除指标
 * api?.clear()
 *
 * // 在控制台直接访问（自行判空）
 * // globalThis.__GEOMSTORE_ANALYZER__?.['user']?.getStats()
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
export const analyzerPlugin: Plugin = createAnalyzerPlugin()

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

  /**
   * 单类操作配对栈的最大深度。
   *
   * 栈里正常情况下只有「进行中」的那几层；但 `discardPendingEnd` 不再据 onError 弹栈之后，
   * 一次被中止的 dispatch 会留下一条永不 pop 的栈项（它的 end 闭包连同 monitor 侧的在途条目
   * 都要等到卸载才释放）。数量正比于「本次安装周期内操作中止的次数」——重试风暴下这是实打实
   * 的持续增长，故设上限。取栈底（最旧）淘汰：中止的帧总是当时最内层的开帧，因此栈底就是那批
   * 永不复用的残留项，pop 仍从栈顶取，配对关系不受影响；被淘汰的那条计时不产出指标，
   * monitor 侧条目由其 TTL 清扫兜底。上限与 `PerformanceMonitor.DEFAULT_MAX_SIZE` 同量级
   */
  const MAX_PENDING_DEPTH = 1000

  const pushEnd = (key: string, end: () => void): void => {
    let stack = pendingEnds.get(key)
    if (!stack) {
      stack = []
      pendingEnds.set(key, stack)
    }
    stack.push(end)
    if (stack.length > MAX_PENDING_DEPTH) {
      // 出声解释这批操作为何在指标里查无此处（与 PerformanceMonitor 计时条目缺失时的
      // console.debug 同口径）：静默淘汰会让监控数据的缺口无从解释
      console.debug(`[GeomStore][analyzer] ${key} 的未完成配对计时已达上限 ${MAX_PENDING_DEPTH}，淘汰最早一条（该次操作不产出指标）`)
      stack.shift()
    }
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
   * onError 的清理范围：只认「显式点名配对键」的来源。
   *
   * 弹栈的前提是「这次操作的 after* 钩子再也不会来了」——只有操作被真正中止时才成立。
   * 全库现有的三类 onError 发射点都给不出这个前提：
   * - `core/hooks/HookSystem.ts` 以出错的 hookName 作第二参转发。`emit` 捕获处理器异常后
   *   继续迭代其余处理器，该操作的 after* 照常触发 → 据此弹栈等于提前结束一条进行中的计时
   * - `core/store/ActionManager.ts` 的 `_reportSettledFailure` 被 5 条失败路径共用，
   *   其中只有同步 dispatch 的那个 catch 之后 `afterDispatch` 永不触发，
   *   Promise 拒绝分支与 settled 兜底 catch 发生在 afterDispatch 已弹过自己的栈项之后
   *   （此时栈顶是**外层**那次 dispatch），`_settleAfterDispatch`／`_safeRefreshCache` 的 catch
   *   同理发生在别的操作帧内。同一发射点上的这几种情形无法互相区分，
   *   故只有**同步 dispatch 中止**那一路显式点名 `'dispatch'`（`_reportSettledFailure(error, 'dispatch')`），
   *   其余四条仍是不带来源的调用
   * - `core/store/Store.ts` 的 `onListenerError`（同样不带来源）：监听器抛错与被计时的操作是否
   *   中止没有因果关系（通知可以在操作帧之外的一帧里到达），据此弹栈同样会掐断进行中的计时
   *
   * 误弹的代价不是「少一条指标」而是**配错 span**：提前弹掉内层后，随后到来的 after* 会弹到
   * 外层配对项上，两条计时同时失真。
   *
   * 因此只处理来源字符串恰好等于配对键的情形——那是发射方为「本操作已中止」显式给出的信号。
   * 库内目前恰好有一个这样的发射点：ActionManager 的同步 dispatch 中止路径。
   * 该路径被弹掉的那条计时会照常产出一条指标（`popEnd` 即调用 `end()`，记的是「到抛错为止」的
   * 耗时）——与 setState/patch/replaceState 正常收尾时同一套语义，中止帧因此在指标里
   * 不是「查无此条」而是「有一笔短耗时」，看监控的人需要知道这一点。
   *
   * 除该路径外的失败发射一律不弹栈，故仍可能存在永不 pop 的栈项（例如未来新增的、
   * 在 after* 之前中止的操作类型），数量由中止次数决定 → 由 `MAX_PENDING_DEPTH` 兜住；
   * monitor 侧的在途条目由 `PerformanceMonitor` 的 `pruneStaleOperations` 按 TTL 清扫
   */
  const discardPendingEnd = (source?: string): void => {
    if (source !== undefined && pendingEnds.has(source)) {
      popEnd(source)
    }
  }

  /**
   * 为一对 before/after 钩子装上计时配对，返回这一对被注册出来的钩子的退订函数。
   *
   * `type` 是必填参数而非可选：`monitor.start` 的第二参默认 'dispatch'，四处各写一遍时
   * 漏传一处就会把 setState/patch/replaceState 的指标全标成 dispatch，
   * `getMetricsByType('getter')` 之类恒返回空数组、瓶颈分析失去类型维度。
   * 收敛成一个函数后，新增被计时操作在签名上就无法避开 MetricType。
   *
   * 形参类型取 `HookName` 联合而非字面量：`HookHandlerFor<K>` 对联合走的是擦除分支
   * （见 types/plugin.ts 的说明），处理器按 `unknown` 收实参、由 `operationOf` 归一为操作名。
   *
   * @param type - 指标类型，同时是 `pendingEnds` 的配对键
   */
  const instrument = (type: MetricType, beforeHook: HookName, afterHook: HookName, operationOf: (firstArg: unknown) => string): (() => void) => {
    const unsubscribeBefore = store.hooks.on(beforeHook, (firstArg: unknown) => {
      pushEnd(type, monitor.start(operationOf(firstArg), type))
    })
    const unsubscribeAfter = store.hooks.on(afterHook, () => {
      popEnd(type)
    })

    return () => {
      unsubscribeBefore()
      unsubscribeAfter()
    }
  }

  // 使用钩子系统替代 monkey-patching，避免多插件冲突。
  // 操作名带上首参（状态键 / action 名）：同名操作嵌套时指标仍可区分；
  // $patch 与 $replaceState 的载荷不具名，只记操作本身
  const uninstrument = [
    instrument('setState', 'beforeSetState', 'afterSetState', (key) => `setState:${String(key)}`),
    instrument('patch', 'beforePatch', 'afterPatch', () => 'patch'),
    instrument('replaceState', 'beforeReplaceState', 'afterReplaceState', () => 'replaceState'),
    instrument('dispatch', 'beforeDispatch', 'afterDispatch', (actionName) => `dispatch:${String(actionName)}`),
  ]

  // getter 没有钩子，使用包装方式（仅监控，不修改原型）
  const originalGetter = store.getter.bind(store)
  const storeProxy = store as unknown as Record<string, unknown>
  // 打补丁前先记下 `getter` 是否为实例自有属性：`getter` 定义在 Store 原型上，
  // 下面的赋值会凭空造出一个**可枚举自有属性**。卸载时若把它还原成自有属性，
  // 实例上就永久留了一份 shadow 原型的绑定函数（`Object.keys(store)`／展开里都会出现，
  // `store.getter === Store.prototype.getter` 也永远不再成立），所以没有自有属性时
  // 必须 `delete`，让查找回到原型。业务侧提前自己挂过自有 getter 属性的场景同理还原原值
  const hadOwnGetter = Object.prototype.hasOwnProperty.call(storeProxy, 'getter')
  const ownGetterBeforeInstall = hadOwnGetter ? storeProxy.getter : undefined
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
    unregisterAnalyzerGlobal = registerGlobalEntry(ANALYZER_GLOBAL_KEY, store.name, analyzerAPI)

    console.log(`[GeomStore][analyzer] Performance monitoring enabled for store "${store.name}"`)
    console.log(`[GeomStore][analyzer] Access at: globalThis.${ANALYZER_GLOBAL_KEY}["${store.name}"]`)
  }

  // 错误时结束「确已中止」那次操作的配对计时（范围判据见 discardPendingEnd 注释）
  const unsubOnError = store.hooks.on('onError', (_error: unknown, source?: string) => {
    discardPendingEnd(source)
  })

  return () => {
    // 清理钩子订阅
    uninstrument.forEach((unsubscribe) => unsubscribe())
    unsubOnError()

    // 关闭 getter 计时开关：即使本插件的包装被后续插件继续持有，卸载后也不再写入
    // 下面即将 clear() 的 monitor（见 wrappedGetter 处的 getterActive 注释）。
    // 先取旧值：disposer 应可重复调用，第二次进来时包装早已停用，
    // 下面的身份判断必然失败，不记这一步就会谎报「被后续插件重新包装」
    const wasActive = getterActive
    getterActive = false

    // 恢复 getter：仅当仍是本插件包装的函数时才恢复，
    // 避免多插件叠加包装时卸载顺序不当把后续插件的包装一并覆盖丢失
    if (storeProxy.getter === wrappedGetter) {
      if (hadOwnGetter) {
        // 安装前实例上就有自有 `getter`：原样还回去
        storeProxy.getter = ownGetterBeforeInstall
      } else {
        // 原型方法被本次安装遮蔽：删掉自有属性让查找回到 Store.prototype，
        // 而不是把 bind 副本写成自有属性（那会永久留下一个可枚举的实例方法）
        delete storeProxy.getter
      }
    } else if (wasActive && !isProduction()) {
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
