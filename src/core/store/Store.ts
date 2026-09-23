/**
 * GeomStore - Store核心实现
 *
 * 核心特性：
 * - 简洁的状态管理API
 * - 高性能的状态更新机制
 * - 完整的Actions和Getters支持
 * - 灵活的插件系统
 * - 状态快照和恢复
 * - 完善的错误处理
 * - Proxy状态保护机制
 *
 * 模块结构：
 * - StateProxyManager: 状态保护代理
 * - SubscriptionManager: 订阅管理
 * - StoreCacheManager: 缓存管理
 * - ActionManager: Action 执行
 * - GetterManager: Getter 执行
 * - BatchManager: 批量更新
 */

import type {
  Store as StoreInterface,
  StoreOptions,
  State,
  Actions,
  Getters,
  StateListener,
  CacheStats,
  StateProtectionOptions,
  CacheConfig,
  InferActionArgs,
  InferActionReturn,
  InferGetterReturn,
  ActionContextBase,
} from '../../types/store.js'
import type { Plugin as PluginType } from '../../types/plugin.js'
import { HookSystem } from '../hooks/index.js'
import { deepMerge, isPlainObject, PROTO_SENSITIVE_KEYS, defineOwnProperty } from '../utils/helpers.js'
import { LRUCache } from '../cache/LRUCache.js'

// 子模块导入
import { StateProxyManager, createProxyCache, isBuiltinObject, isMapLike, isSetLike } from './StateProxy.js'
import { SubscriptionManager, createSubscribeFunction } from './SubscriptionManager.js'
import { StoreCacheManager } from './StoreCache.js'
import { ActionManager, GetterManager } from './ActionManager.js'
import { BatchManager } from './BatchManager.js'
import type { ProxyCache, InternalStateProtectionConfig } from './types.js'
import { deepCloneState, deepFreezeState, isProduction } from './utils.js'
import { defineStateVersion } from './stateVersion.js'
import { createDirtyTrackingProxy, createDirtyTrackingCache, type DirtyTrackingCache } from './dirtyTracking.js'
import { GEOMSTORE_BRAND, createPluginUninstaller } from './pluginSupport.js'
import { AsyncBatchNotifier } from '../performance/AsyncBatchNotifier.js'

/** 单个 Store 的默认最大订阅者数量 */
const DEFAULT_MAX_SUBSCRIBERS = 50

/** 自动生成 Store 名称时使用的前缀 */
const STORE_NAME_PREFIX = 'store-'

/**
 * 读取「一次按键写入将要写入/比对的那个值」，原型链敏感键按**自有属性描述符**取。
 *
 * `__proto__` / `constructor` / `prototype` 在 `Object.prototype` 上是 accessor：
 * `target['__proto__']` 拿到的是原型而不是写入值，拿它做等值比对会得出与合并结果相反的结论
 * （`setState` 与 `$patch` 共用这一条判据——两处各写一遍就会漂移成「一侧挡住、另一侧没挡」，
 * 与 deepMerge / defineOwnProperty 的既定口径同源，见 R6-007）。
 */
function readOwnValue(target: Record<string, unknown>, key: string): unknown {
  if (!PROTO_SENSITIVE_KEYS.has(key)) {
    return target[key]
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  return descriptor ? descriptor.value : undefined
}

/**
 * destroy() 排空插件卸载函数的最大轮数（见 _drainPluginUninstalls）：
 * 每轮都要求「清理中新注册的插件」比上一轮少，否则到上限即止，不无限排空
 */
const MAX_PLUGIN_UNINSTALL_ROUNDS = 10

/**
 * Store 实现类（模块化重构版）
 *
 * @class Store
 * @template S - 状态类型
 * @implements StoreInterface<S, A, G>
 */
export class Store<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>> implements StoreInterface<S, A, G> {
  // ==================== 核心属性 ====================

  /** Store名称 */
  readonly name: string

  /** 真实状态（私有） */
  private _state!: S

  /** 内部访问标记 */
  private _isInternalAccess = false

  /** 状态保护配置 */
  private _stateProtection: InternalStateProtectionConfig

  /** 状态保护启用标志（内联缓存） */
  private _stateProtectionEnabled: boolean

  /** 通知前是否深拷贝（显式配置；undefined 表示自动：仅当存在可写订阅者时拷贝） */
  private _notifyClone: boolean

  /** 是否显式配置了 notify.clone（用于区分「默认自动」与「用户显式关闭」） */
  private _notifyCloneExplicit: boolean

  /** 是否启用 notify 异步合并（微任务合并多次通知为一次，减少 setData 次数） */
  private _notifyAsyncEnabled: boolean

  /** 异步通知合并器（仅启用时创建） */
  private _asyncNotifier?: AsyncBatchNotifier<S>

  /** 脏键集合：记录自上次通知以来发生变更的状态键，供集成层精确跳过未变化的映射 */
  private _dirtyKeys: Set<keyof S> = new Set()

  /**
   * 通知期间新产生的脏键（重入写入）：回调内写入会触发下一轮通知，
   * 其脏键不能随本轮收尾一起清空，否则下一轮会被集成层当作「未变化」跳过
   */
  private _deferredDirtyKeys: Set<keyof S> = new Set()

  /** 是否正在通知：决定脏键写入是否需要同时记入下一轮 */
  private _notifying = false

  /** 是否仅在状态实际变化时通知（默认 false） */
  private _notifyOnlyOnChange: boolean

  /** 状态变更计数器（脏跟踪：供 onlyOnChange 模式判断 dispatch 是否修改了状态） */
  private _mutationCount = 0

  /** Action 脏跟踪缓存（代理与原对象的双向映射；$replaceState 时重建） */
  private _dirtyProxyCache: DirtyTrackingCache = createDirtyTrackingCache()

  /** Actions集合（公开） */
  public actions!: A

  /** 插件集合（按本 Store 的状态类型约束，状态无关插件以 Plugin<State> 兼容） */
  private _plugins: PluginType<S>[] = []

  /** 插件卸载函数集合 */
  private _pluginUninstallFns: Map<PluginType<S>, (() => void) | undefined> = new Map()

  /** 插件当前安装的代际令牌：卸载句柄据此识别自己是否仍对应最新一次安装 */
  private _pluginInstallations: Map<PluginType<S>, object> = new Map()

  /** dispatch跟踪标记 */
  private _dispatching = false

  /** batch 首层开始时的变更计数基线（onlyOnChange 模式判断批量期间是否发生变更） */
  private _batchMutationBaseline = 0

  /** 最近一次通知已覆盖到的变更计数：供 dispatch 补发通知去重（onlyOnChange） */
  private _lastNotifiedMutationCount = 0

  /** 销毁标记 - 防止销毁后继续操作 */
  private _destroyed = false

  // ==================== 子模块实例 ====================

  /** Proxy缓存（构造/重建时赋值，见 _rebuildStateProxyManager） */
  private _proxyCache!: ProxyCache

  /** 状态保护代理管理器（构造/重建时赋值，见 _rebuildStateProxyManager） */
  private _stateProxyManager!: StateProxyManager<S>

  /** 订阅管理器 */
  private _subscriptionManager: SubscriptionManager<S>

  /** 缓存管理器 */
  private _cacheManager: StoreCacheManager<S>

  /** Action执行器 */
  private _actionManager: ActionManager<S, A>

  /** Getter执行器 */
  private _getterManager: GetterManager<S, G>

  /** 批量更新管理器 */
  private _batchManager: BatchManager

  /** 实例级钩子系统（每个 Store 独立） */
  private _hooks: HookSystem

  /** 公开的钩子系统访问器，供插件使用 */
  public readonly hooks: HookSystem

  /** Store计数器 */
  private static _storeCounter = 0

  // ==================== 构造函数 ====================

  constructor(options: StoreOptions<S, A, G> = {}) {
    this.name = options.name || `${STORE_NAME_PREFIX}${Store._storeCounter++}`

    // 设置品牌标识，供 isGeomStore 精确识别
    ;(this as unknown as Record<symbol, boolean>)[GEOMSTORE_BRAND] = true

    // 初始化状态保护配置
    this._stateProtection = {
      enabled: options.stateProtection?.enabled ?? true,
      deep: options.stateProtection?.deep ?? true,
      productionHandler: options.stateProtection?.productionHandler ?? 'warn',
    }
    this._stateProtectionEnabled = this._stateProtection.enabled

    // 初始化通知行为配置
    this._notifyClone = options.notify?.clone ?? true
    this._notifyCloneExplicit = options.notify?.clone !== undefined
    this._notifyAsyncEnabled = options.notify?.async ?? false
    this._notifyOnlyOnChange = options.notify?.onlyOnChange ?? false

    // 初始化 Proxy 缓存和管理器
    this._rebuildStateProxyManager()

    // 初始化订阅管理器
    this._subscriptionManager = new SubscriptionManager<S>({
      storeName: this.name,
      maxSubscribers: options.subscription?.maxSubscribers ?? DEFAULT_MAX_SUBSCRIBERS,
      onLimit: options.subscription?.onLimit,
      // 监听器抛错走 onError 钩子：控制台在生产是静默的（库口径），没有这条通道
      // 一个坏订阅者的异常就彻底丢失。_hooks 在下一段才赋值，此处的箭头函数
      // 首次被调用时（notify）早已就绪
      onListenerError: (error) => this._hooks.emit('onError', error),
      // 驱逐事件的同理：`_enforceLimit` 的开发期 console.warn 在生产不响，被挤掉那份注册的
      // 监听器从此不再收到任何更新，而现场没有任何指标可指认「丢了一次订阅」。
      // 与 onListenerError 同口径挂到 onError 钩子上，监控/上报插件即可见。
      // 第二参给 `'subscribe'` 而不是 `'dispatch'`：注册动作可能发生在 action 体内
      // （嵌套 dispatch 的中途），点名任何操作配对键都会让 analyzerPlugin 弹掉与本次
      // 驱逐无关的进行中计时；`'subscribe'` 不是配对键，只作来源标识
      onSubscriberEvicted: (info) =>
        this._hooks.emit(
          'onError',
          new Error(
            `[GeomStore][${this.name}] 订阅者达到上限(${info.maxSubscribers})，evict-oldest 驱逐了一份注册` +
              `（监听器：${info.listener.name || '(匿名函数)'}，驱逐后在册注册数：${info.size}，不含本次新注册）`,
          ),
          'subscribe',
        ),
    })

    // 初始化异步通知合并器（仅启用时）：将同一 tick 内的多次 notify 合并为一次微任务通知，
    // 脏键跨批次累积，最终通知仍能精确反映全部变更（与集成层对象值跳过天然兼容）
    if (this._notifyAsyncEnabled) {
      this._asyncNotifier = new AsyncBatchNotifier<S>()
      this._asyncNotifier.subscribe(() => this._notifyListeners())
    }

    // 初始化缓存
    const cacheConfig: CacheConfig = options.cacheConfig || {}
    const lruCache = new LRUCache<keyof S, S[keyof S]>({
      capacity: cacheConfig.capacity ?? 100,
      enableStats: cacheConfig.enableStats ?? true,
      trackAccessTime: cacheConfig.trackAccessTime ?? false,
    })
    this._cacheManager = new StoreCacheManager<S>({
      cache: lruCache,
      ttl: cacheConfig.ttl ?? 0,
    })

    // 初始化实例级钩子系统（每个 Store 独立，避免全局单例跨 Store 干扰）
    this._hooks = new HookSystem()
    this.hooks = this._hooks

    // 初始化批量更新管理器
    this._batchManager = new BatchManager(() => this._onBatchEnd())

    // 初始化 Action 管理器
    this._actionManager = new ActionManager<S, A>({
      storeName: this.name,
      withInternalAccess: (fn) => this._withInternalAccess(fn),
      setDispatching: (value) => {
        this._dispatching = value
      },
      notifyListeners: () => this._scheduleNotify(),
      hooks: this._hooks,
      notifyOnlyOnChange: this._notifyOnlyOnChange,
      getMutationCount: () => this._mutationCount,
      // dispatch 结束后从状态源刷新缓存，覆盖 action 直接变异 this.state 的路径
      refreshCache: () => this._cacheManager.refreshFromState((key) => this._state[key], Object.keys(this._state) as Array<keyof S>),
      getLastNotifiedMutationCount: () => this._lastNotifiedMutationCount,
      isInBatch: () => this._batchManager.isInBatch,
    })

    // 初始化 Getter 管理器
    // 传入 state getter（保护代理）：getter 函数拿到的是只读代理而非裸状态，
    // 避免 getter 内部意外变异状态绕过通知/钩子；保护关闭时 state getter 返回裸状态，行为与旧版一致
    this._getterManager = new GetterManager<S, G>(this.name, () => this.state)

    // 初始化状态
    this._initializeState(options.state)

    // 初始化 Actions 和 Getters
    this._initializeActionsAndGetters(options.actions, options.getters)

    // 初始化缓存
    this._initializeCache(options.enableCache, options.cacheKeys)
  }

  // ==================== 状态访问器 ====================

  /**
   * 状态访问器 - 返回受保护的Proxy
   * 注意：state 是只读访问器，不支持直接赋值。请使用 setState()/$patch()/$replaceState() 来修改状态。
   */
  public get state(): S {
    if (!this._stateProtectionEnabled || this._isInternalAccess) {
      return this._state
    }
    return this._stateProxyManager.createStateProxy(this._state, '')
  }

  // ==================== 状态管理方法 ====================

  /** 获取当前状态的原始引用（内部使用）。
   *
   *  ⚠️ 注意：此方法返回的是内部状态的直接引用，修改返回值会直接影响 Store 状态，
   *  且不会触发订阅通知、钩子或缓存更新。
   *
   *  如果需要安全地读取状态，请使用 `store.state` getter（返回受保护的 Proxy）。
   *  此方法主要供高级场景和内部模块使用。
   */
  getState(): S {
    return this._state
  }

  /**
   * 设置单个状态值
   *
   * 值按**引用**保存（与 `_initializeState` / `$replaceState` 的深拷贝不同，与 `$patch`
   * 的合并结果同口径）：Store 不接管调用方对象的归属。这是别名脏键
   * （`_markAliasedKeys`）与脏追踪索引成立的前提——它们都按对象身份做可达性判定，
   * 写入时换一份克隆就等于把「同一对象被多个顶层键引用」这条关系从状态图里抹掉。
   *
   * 由此带来的两条边界要清楚：
   * - 调用方在 setState 之后再改它传进来的那个对象，Store 不会察觉：没有变更计数、
   *   没有脏键、没有钩子、缓存里就是同一个引用，读到的是被外部改过的值；
   * - 要交出可安全持有的副本，请读 `$snapshot()`，别把传入引用的所有权当已转移。
   * 需要「写入即定格」的语义就用 `$patch`：deepMerge 从不把调用方的对象引用落进状态
   * （补丁里的纯对象只在目标位置也是纯对象时逐层就地合并，其余分支一律换成克隆），
   * 之后改补丁对象不会影响 Store。
   *
   * @param key - 状态键名（不能为空）
   * @param value - 状态值
   */
  setState<K extends keyof S>(key: K, value: S[K]): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call setState on a destroyed Store')
    }
    if (key === null || key === undefined) {
      throw new TypeError('[GeomStore] setState: key must not be null or undefined')
    }

    this._hooks.emit('beforeSetState', key, value)

    // 原型链敏感键与 deepMerge 同口径：Object.prototype 上的 `__proto__` 是 accessor，
    // 裸 [[Set]] 会改写状态对象的原型（值非对象时按规范静默丢弃却仍被记成一次变更）。
    // defineProperty 只定义自有数据属性，不触发任何 setter。
    const protoSensitive = typeof key === 'string' && PROTO_SENSITIVE_KEYS.has(key)

    // 相等性检查：值未变化时跳过写入和通知，避免无意义的订阅触发。
    // 敏感键的取值经 `readOwnValue`（读自有描述符而不是 [[Get]]），与 $patch 同一判据
    const oldValue = readOwnValue(this._state as unknown as Record<string, unknown>, key as string)
    if (Object.is(oldValue, value)) {
      this._hooks.emit('afterSetState', key, value)
      return
    }

    this._withInternalAccess(() => {
      if (protoSensitive) {
        defineOwnProperty(this._state as unknown as Record<string, unknown>, key as string, value)
      } else {
        this._state[key] = value
      }
    })

    this._mutationCount++
    this._markDirtyKey(key)
    this._cacheManager.set(key, value)

    if (!this._dispatching && !this._batchManager.isInBatch) {
      this._scheduleNotify()
    }
    this._hooks.emit('afterSetState', key, value)
  }

  /**
   * 批量更新状态
   *
   * 「改没改」的判据与 `setState` 同一条（顶层键 `Object.is` 比对，命中的键整键跳过）：
   * `_mutationCount` 是 `notify.onlyOnChange` 的唯一依据（见 `_onBatchEnd` 与 ActionManager
   * 的 dispatch 收尾），此前 `$patch` 无条件推进它、并无条件把补丁触及的每个键标脏 + 写缓存，
   * 于是 `$patch({})` 与「补丁值与当前状态逐字相同」都被记成一次真实变更——
   * 两个公开写入 API 对同一次写入给出相反答案，onlyOnChange 想省的 setData
   * 在最常用的补丁路径上省不掉。现在两侧一样：没有任何键发生变化 ⟹ 不计数、不标脏、
   * 不写缓存、不调度通知，钩子照常成对触发（与 setState 的等值早退同形）。
   *
   * 只比顶层键，不下探：嵌套对象即便内容相同也是不同引用，deepMerge 仍会逐层合并
   * （可能补进目标里原本没有的键），所以那种补丁照常计 —— 早退只覆盖
   * 「合并后不可能产生任何差异」的键（同引用或等值原始值）。
   *
   * @param partialState - 部分状态对象（不能为 null/undefined）
   */
  $patch(partialState: Partial<S>): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call $patch on a destroyed Store')
    }
    if (!partialState || typeof partialState !== 'object') {
      throw new TypeError('[GeomStore] $patch: partialState must be a valid object')
    }

    this._hooks.emit('beforePatch', partialState)

    // 逐键取出「真正要合并的键」。两侧都经 `readOwnValue`：原型链敏感键
    // （`state.__proto__` / `partial.__proto__`）按 [[Get]] 拿到的是原型而不是写入值，
    // 拿它做等值比对会得出与合并结果相反的结论（与 setState 同一份判据）
    const stateRecord = this._state as unknown as Record<string, unknown>
    const patchRecord = partialState as unknown as Record<string, unknown>
    const effective: Record<string, unknown> = {}
    for (const key of Object.keys(patchRecord)) {
      const patchValue = readOwnValue(patchRecord, key)
      if (Object.is(readOwnValue(stateRecord, key), patchValue)) {
        continue
      }
      const protoSensitive = PROTO_SENSITIVE_KEYS.has(key)
      // 敏感键以 defineProperty 承载：`effective['__proto__'] = value` 走 [[Set]]，
      // 会把这份中间对象的原型换掉并把该键整条丢掉，补丁就静默不生效了
      if (protoSensitive) {
        defineOwnProperty(effective, key, patchValue)
      } else {
        effective[key] = patchValue
      }
    }

    if (Object.keys(effective).length === 0) {
      this._hooks.emit('afterPatch', partialState)
      return
    }

    // 别名脏键的目标集必须在合并**之前**采集：deepMerge 之后「被就地改写的对象」
    // 和「被换成新克隆的值」在状态里长得一模一样，事后无法区分
    const mergedInPlace = this._collectInPlaceMergedObjects(stateRecord, effective)

    this._withInternalAccess(() => {
      deepMerge(stateRecord, effective)
    })

    this._mutationCount++

    const changedKeys = Object.keys(effective) as Array<keyof S>
    changedKeys.forEach((key) => {
      // 缓存应写入 deepMerge 后的最终状态值：嵌套对象被递归合并后，
      // this._state[key] 与 partialState[key] 可能不同（如 {a:{x:1}} patch {a:{y:2}}），
      // 写入 partial 值会导致缓存与状态不一致
      this._cacheManager.set(key as keyof S, this._state[key as keyof S])
      // 记录脏键：deepMerge 可能就地改写该键下的嵌套对象，故整键标记为已变更
      this._markDirtyKey(key as keyof S)
    })
    // deepMerge 就地改写的对象可能同时被其他顶层键引用，那些键的内容也变了
    this._markAliasedKeys(mergedInPlace, new Set(changedKeys))

    if (!this._dispatching && !this._batchManager.isInBatch) {
      this._scheduleNotify()
    }
    this._hooks.emit('afterPatch', partialState)
  }

  /**
   * 替换整个状态
   * @param newState - 新状态对象或状态工厂函数（工厂函数写法：`() => ({...})`，返回值不能为 null/undefined）
   */
  $replaceState(newState: S | (() => S)): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call $replaceState on a destroyed Store')
    }
    // 支持 state 工厂函数写法（Pinia 同款），先解析再校验/深拷贝
    const resolvedState = typeof newState === 'function' ? (newState as () => S)() : newState
    if (resolvedState === undefined || resolvedState === null) {
      throw new TypeError('[GeomStore] $replaceState: newState must be a valid state object')
    }
    // 安全检查：防止原型链污染，拒绝非对象类型和数组
    if (typeof resolvedState !== 'object' || resolvedState === null || Array.isArray(resolvedState)) {
      throw new TypeError('[GeomStore] $replaceState: newState must be a plain object')
    }

    this._hooks.emit('beforeReplaceState', resolvedState)

    // 旧键集必须在替换前取：只标新状态的键，被这次替换删掉的键就永远
    // 不被标记为脏，isStateKeyDirty 对它是 false——集成层据此跳过 setData，
    // 视图会一直留着已消失键的值
    const previousKeys = Object.keys(this._state) as Array<keyof S>

    this._withInternalAccess(() => {
      // 整树替换：旧状态的键（含 action 内已 delete 的键）不再存在于新状态，
      // 直接整表清空再由下方按新状态回填。仅按旧状态键清理会漏掉
      // 「已从状态删除但仍在缓存中」的键，TTL=0 时过期值会被永久读到
      if (this._cacheManager.enabled) {
        this._cacheManager.invalidate()
      }

      // 深拷贝新状态，防止外部修改 newState 影响 Store 内部状态
      this._state = deepCloneState(resolvedState)
      // 整树替换后 state 是新对象，需重新挂版本号 getter
      defineStateVersion(this._state, () => this._mutationCount)

      // 更新新状态缓存
      if (this._cacheManager.enabled) {
        Object.keys(this._state).forEach((key) => {
          this._cacheManager.set(key as keyof S, this._state[key as keyof S])
        })
      }
    })

    // 清除所有 Proxy 缓存（状态保护 + 脏跟踪均需重建）
    this._rebuildStateProxyManager()
    // 脏跟踪代理缓存指向旧状态对象树，一并重建
    this._dirtyProxyCache = createDirtyTrackingCache()
    this._mutationCount++
    // 整树替换：新键与「被替换掉的旧键」都视为已变更（后者是消失型变更）
    for (const key of previousKeys) {
      this._markDirtyKey(key)
    }
    Object.keys(this._state).forEach((key) => {
      this._markDirtyKey(key as keyof S)
    })

    // 与 setState/$patch 一致：dispatch 或批量更新期间跳过通知，
    // 由 dispatch 收尾 / BatchManager.end 统一触发一次通知，避免破坏批量语义
    if (!this._dispatching && !this._batchManager.isInBatch) {
      this._scheduleNotify()
    }
    this._hooks.emit('afterReplaceState', resolvedState)
  }

  /**
   * 判断指定状态键自上次通知以来是否发生变更
   *
   * 供集成层（withPageStore / withComponentStore）在同步通知回调内精确判断某个映射键是否变化，
   * 从而跳过未变化对象值的冗余 setData。脏键在每次通知结束时清空。
   *
   * 键型是 `string | symbol` 而非 `string`：脏键集合按 `Reflect.ownKeys` 收集
   * （`_markAliasedKeys` 与 action 侧的脏追踪代理都会给出 symbol 根键），
   * 只收 string 会让 symbol 键的顶层状态查不到脏位，脏跳过优化对它静默失效。
   *
   * @param key - 状态键名
   * @returns 该键自上次通知后是否发生过变更
   */
  isStateKeyDirty(key: string | symbol): boolean {
    return this._dirtyKeys.has(key as keyof S)
  }

  /**
   * 创建状态快照
   *
   * @returns 深克隆后**部分冻结**的副本：纯对象与数组链上为深度只读，
   *   但经 Date/RegExp/Map/Set 或非纯对象（class 实例等）触达的节点仍是活的
   *   可变对象——`Readonly<S>` 只到类型层面，别把它当作深度不可变的保证。
   *   另注意 Date/RegExp 在克隆时总新建实例，别名关系不保留
   *   （详见 core/utils/clone.ts 的 deepCloneState 文档）
   */
  $snapshot(): Readonly<S> {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call $snapshot on a destroyed Store')
    }
    return this._withInternalAccess(() => {
      // 深克隆后递归冻结纯对象/数组，使 Readonly<S> 的只读承诺在嵌套层级也成立
      // （Date/RegExp/Map/Set 的 mutator 不走 [[Set]] 陷阱，冻结拦不住故连同其子节点
      //  一并留为可变，这就是上面「部分冻结」口径的来源）
      return deepFreezeState(deepCloneState(this._state)) as Readonly<S>
    })
  }

  /**
   * 从快照恢复状态
   */
  $restore(snapshot: Readonly<S>): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call $restore on a destroyed Store')
    }
    // 克隆职责收敛到 $replaceState（其内部已 deepCloneState）：此处不再重复深拷贝整树
    this.$replaceState(snapshot as S)
  }

  // ==================== Action 和 Getter 方法 ====================

  /**
   * 执行action - 类型安全实现
   * @throws 如果 Store 已销毁
   */
  dispatch<K extends keyof A>(actionName: K, ...args: InferActionArgs<A, K>): InferActionReturn<A, K>
  dispatch(actionName: string, ...args: unknown[]): unknown
  dispatch(actionName: string | keyof A, ...args: unknown[]): unknown {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call dispatch on a destroyed Store')
    }
    return this._actionManager.execute(actionName as string, ...args)
  }

  /**
   * 使用 getter - 类型安全实现
   * @throws 如果 Store 已销毁
   */
  getter<K extends keyof G>(getterName: K): InferGetterReturn<G, K>
  getter(getterName: string): unknown
  getter(getterName: string | keyof G): unknown {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call getter on a destroyed Store')
    }
    return this._getterManager.execute(getterName as string)
  }

  /**
   * Getters 定义对象（只读）
   *
   * 供类型系统推断 Getters 键集合（如 withPageStore 的 mapGetters 约束），
   * 亦可用于调试与运行时检查。允许在销毁后调用（只读，不抛错）。
   *
   * @remarks 销毁后返回的**不是空对象**：destroy() 不注销 getter 定义，
   *   这里给出的是初始化时登记的那份（`getter(name)` 则会在销毁后抛错，
   *   两者对「已销毁」的严格程度不同）。销毁后仍调用返回对象里的函数时，
   *   它会经 `store.state` 读到保留未释放的 `_state`——需要「销毁即失联」
   *   的语义请显式判 `store.destroyed`
   */
  get getters(): G {
    return this._getterManager.getters
  }

  /**
   * 获取所有 getter 的名称列表
   *
   * 用于 DevTools、调试与运行时反射。允许在销毁后调用（只读，返回空数组）。
   */
  getGetterNames(): string[] {
    if (this._destroyed) {
      return []
    }
    return this._getterManager.getGetterNames()
  }

  // ==================== 订阅方法 ====================

  /**
   * 订阅状态变化
   * @param listener - 状态变化回调函数
   * @param options.readOnly 标记为只读订阅（仅读取状态、不修改）。当 Store 仅有只读订阅者时，
   *   通知路径会跳过整棵状态树的深拷贝，显著降低大状态下的通知开销。
   * @returns 取消订阅的函数
   * @throws 如果 Store 已销毁
   */
  subscribe(listener: StateListener<S>, options?: { readOnly?: boolean }): () => void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call subscribe on a destroyed Store')
    }
    return createSubscribeFunction(this._subscriptionManager)(listener, options)
  }

  // ==================== 插件管理 ====================

  /**
   * 安装插件
   * @param plugin - 插件实例
   * @returns 卸载插件的函数
   * @throws 如果 Store 已销毁
   */
  use(plugin: PluginType<NoInfer<S>> | PluginType<State>): () => void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call use on a destroyed Store')
    }

    // 同一插件实例重复安装：_pluginUninstallFns 以 plugin 对象为键，第二次 use 会覆盖
    // 首条映射使第一个 uninstall 永久丢失；且返回的 token 用 indexOf 只移除一个数组槽位
    // 却删除共享映射，_plugins 里残留的那份在 destroy() 时再也拿不到卸载函数——
    // 第二份安装永不卸载。对本仓库全部内置插件（loggerPlugin/devtoolsPlugin/
    // analyzerPlugin/persistencePlugin 都是共享单例对象）而言，同 store 二次安装只有害处
    // （重复订阅、重复 hooks、重复全局注册），无合法用途，故告警并幂等返回既有卸载函数。
    // 不抛错：与仓库既有「歧义→开发模式告警」口径一致（_mergeStateMaps、
    // findTargetStoreWithKey、子 store 重名的非命名空间分支）。
    // 不引入按实例计数：插件不同于监听器（后者「注册 N 次通知 N 次」是正当语义），
    // 需要多份独立副作用时应使用插件工厂（如 timeTravelPlugin()）产生不同实例
    //
    // 收窄为 PluginType<S> 再入内部结构：状态无关插件（Plugin<State>）在结构上满足
    // 「可安装到本 Store」（install 只读取状态），内部集合与映射统一按自身状态类型存储
    const target = plugin as PluginType<S>
    if (this._plugins.indexOf(target) !== -1) {
      if (!isProduction()) {
        console.warn(
          `[GeomStore][${this.name}] 插件 "${target.name}" 已安装，忽略重复的 use() 调用。` +
            '同一实例重复安装会丢失卸载函数；如需多份独立副作用，请用插件工厂产生不同实例',
        )
      }
      return this._createPluginUninstaller(target)
    }

    this._plugins.push(target)
    const installation = {}
    this._pluginInstallations.set(target, installation)

    let uninstall: unknown
    try {
      uninstall = this._withInternalAccess(() => target.install?.(this))
    } catch (error) {
      // 安装失败回滚入列：否则半安装插件常驻列表，捕获后重试 use() 会累积重复条目
      const index = this._plugins.indexOf(target)
      if (index !== -1) {
        this._plugins.splice(index, 1)
      }
      this._pluginInstallations.delete(target)
      throw error
    }

    this._pluginUninstallFns.set(target, uninstall as (() => void) | undefined)

    return this._createPluginUninstaller(target, installation)
  }

  /** 创建插件卸载句柄（实现已拆至 ./pluginSupport.js） */
  private _createPluginUninstaller(plugin: PluginType<S>, installation: object | undefined = this._pluginInstallations.get(plugin)): () => void {
    return createPluginUninstaller(plugin, this._plugins, this._pluginUninstallFns, this._pluginInstallations, installation)
  }

  // ==================== 生命周期管理 ====================

  /**
   * 销毁Store - 释放所有资源
   *
   * 清理顺序（反向依赖）：
   * 1. 插件卸载（依赖 hooks/state）
   * 2. 订阅器清除
   * 3. 缓存禁用
   * 4. 钩子清除
   * 5. 批量管理器重置
   * 6. 销毁标记
   * 7. 兜底闸门（finally）：再排空一次插件 + 清空集合引用 + 重建 Proxy 管理器
   */
  destroy(): void {
    if (this._destroyed) {
      return // 幂等：重复销毁不报错
    }

    try {
      // 1. 反向卸载插件（后安装的先卸载），含清理过程中重入 use() 新装的那批
      this._drainPluginUninstalls()

      // 2. 清理订阅器
      this._subscriptionManager.clear()
      // 2.1 取消待发的异步通知（避免销毁后微任务仍回调已销毁的 Store）
      this._asyncNotifier?.clear()

      // 3. 禁用缓存
      this._cacheManager.disable()

      // 4. 清除钩子
      this._hooks.clear()

      // 5. 重置批量管理器（清理未配对 startBatch 残留的计数）
      this._batchManager.reset()

      // 6. 标记已销毁
      this._destroyed = true
    } catch (error) {
      console.error('[GeomStore] Error during Store destruction:', error)
      // 即使出错也标记为销毁，防止半销毁状态
      this._destroyed = true
    } finally {
      // 7. 「teardown 结束前必须全空」的最后一道闸门，放在 finally 而不是 try 尾部：
      //    2~6 任一步抛错都会跳到 catch，写在 try 尾部的收尾会被整段跳过，闸门若也在 try 里
      //    就等于没有。它同时兜住重入注册：2~6（订阅清除的清理回调、钩子清除）都可能
      //    再 use() 一个插件，此时步骤 1 的排空已经收敛、_destroyed 也才在第 6 步置位，
      //    直接丢空容器会让这些插件的卸载函数永不执行（其 install() 注册的订阅与
      //    全局副作用就此泄漏），所以要先再排空一次、只清掉确实排不尽的残余
      this._drainPluginUninstalls()
      this._plugins = []
      this._pluginUninstallFns.clear()
      this._pluginInstallations.clear()
      // 走重建而非直接换 _proxyCache：StateProxyManager 在构造时就把缓存捕获成
      // readonly 字段，只替换 this._proxyCache 清不掉管理器实际使用的那份，
      // 旧状态树的 Proxy 仍可通过 _stateProxyManager 被引用
      this._rebuildStateProxyManager()
    }
  }

  /**
   * 排空全部在册插件的卸载函数（后装先卸），并接住清理过程中的重入注册
   *
   * 逐轮从「插件 → 卸载函数」映射消费而不是按 `_plugins` 的实时下标迭代：
   * 下标迭代既会因 splice 移位重复执行同一个清理，也会打乱反向顺序。
   * 代际令牌先删，被删插件自己的卸载句柄随即失效（清理里再调它不会二次执行）。
   *
   * 轮数上限只是防「清理函数一被调用就再装一个插件」这种不自收敛的病态实现：
   * 正常重入一轮就排空（新条目由下一轮接住），超出上限说明剩下的永远排不完，
   * 告警后丢弃，destroy 不得因此挂住。
   */
  private _drainPluginUninstalls(): void {
    for (let round = 0; this._pluginUninstallFns.size > 0; round++) {
      if (round >= MAX_PLUGIN_UNINSTALL_ROUNDS) {
        if (!isProduction()) {
          console.warn(
            `[GeomStore][${this.name}] 插件清理在 ${MAX_PLUGIN_UNINSTALL_ROUNDS} 轮内未收敛，` +
              `剩余 ${this._pluginUninstallFns.size} 个卸载函数被丢弃；请在 install() 的返回函数里做幂等清理，不要在清理中重新 use()`,
          )
        }
        return
      }
      for (const plugin of [...this._pluginUninstallFns.keys()].reverse()) {
        const uninstallFn = this._pluginUninstallFns.get(plugin)
        this._pluginUninstallFns.delete(plugin)
        this._pluginInstallations.delete(plugin)
        if (typeof uninstallFn === 'function') {
          try {
            uninstallFn()
          } catch (error) {
            console.error('[GeomStore] Error uninstalling plugin:', error)
          }
        }
      }
    }
  }

  /**
   * 检查 Store 是否已被销毁
   */
  get destroyed(): boolean {
    return this._destroyed
  }

  // ==================== 缓存管理方法 ====================

  /**
   * 从缓存获取状态值
   * @param key - 状态键名
   * @returns 缓存的值或当前状态值
   * @throws 如果 Store 已销毁
   */
  getCached<K extends keyof S>(key: K): S[K] {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call getCached on a destroyed Store')
    }
    return this._cacheManager.get(key, () => this._state[key])
  }

  /**
   * 启用缓存
   * @param keys - 需要缓存的键（可选，默认全部）
   * @throws 如果 Store 已销毁
   */
  enableCache(keys?: Array<keyof S>): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call enableCache on a destroyed Store')
    }
    const stateKeys = Object.keys(this._state) as Array<keyof S>
    this._cacheManager.enable(keys, (key) => this._state[key], stateKeys)
  }

  /**
   * 禁用缓存
   * @throws 如果 Store 已销毁
   */
  disableCache(): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call disableCache on a destroyed Store')
    }
    this._cacheManager.disable()
  }

  /**
   * 清除缓存
   * @param key - 要清除的键（可选，不传则清除全部）
   * @throws 如果 Store 已销毁
   */
  invalidateCache<K extends keyof S>(key?: K): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call invalidateCache on a destroyed Store')
    }
    this._cacheManager.invalidate(key)
  }

  /**
   * 获取缓存统计信息
   * @returns 缓存统计对象
   */
  getCacheStats(): CacheStats {
    // 允许在销毁后查询统计（只读操作，用于调试）
    return this._cacheManager.getStats()
  }

  // ==================== 状态保护扩展接口 ====================

  /**
   * 检查状态保护是否启用
   */
  isStateProtectionEnabled(): boolean {
    return this._stateProtection.enabled
  }

  /**
   * 动态启用/禁用状态保护
   *
   * 与其他写接口同口径拒绝销毁后调用：destroy() 已经重建过 Proxy 管理器，
   * 这里再改配置会把「已销毁」的 Store 拉回可变状态并白造一个新管理器。
   * 只读侧（isStateProtectionEnabled / getStateProtectionConfig）不在此列
   * @throws 如果 Store 已销毁
   */
  setStateProtection(enabled: boolean): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call setStateProtection on a destroyed Store')
    }
    this._stateProtection.enabled = enabled
    this._stateProtectionEnabled = enabled
    if (!enabled) {
      this._rebuildStateProxyManager()
    }
  }

  /**
   * 获取状态保护配置
   */
  getStateProtectionConfig(): Readonly<StateProtectionOptions> {
    return { ...this._stateProtection }
  }

  // ==================== 批量更新接口 ====================

  /**
   * 开始批量更新
   */
  startBatch(): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call startBatch on a destroyed Store')
    }
    if (!this._batchManager.isInBatch) {
      this._batchMutationBaseline = this._mutationCount
    }
    this._batchManager.start()
  }

  /**
   * 结束批量更新
   */
  endBatch(): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call endBatch on a destroyed Store')
    }
    this._batchManager.end()
  }

  /**
   * 在批量更新上下文中执行操作
   * @param fn - 要执行的函数
   * @returns 函数返回值
   */
  batch<T>(fn: () => T): T {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call batch on a destroyed Store')
    }
    // 走 startBatch/endBatch 而非 createBatchFunction：
    // 只有 startBatch 会记录变更计数基线，绕过它会让 onlyOnChange 的
    // 「无变更 batch 不通知」判定用上陈旧基线而失效
    this.startBatch()
    try {
      const result = fn()
      // 异步回调的批语义无法维持：endBatch 在返回 Promise 时立即执行，
      // await 之后的写入脱离批保护逐条通知。开发期显式告警，避免静默误解
      if (!isProduction() && result instanceof Promise) {
        console.warn(
          `[GeomStore][${this.name}] batch() 收到异步回调：批保护仅覆盖同步段，` +
            'await 之后的变更将逐条通知。请在异步完成后再调用 endBatch()，或把异步段移出 batch',
        )
      }
      return result
    } finally {
      // 回调把 Store 销毁掉了（组件在 batch 里卸载是可达路径）：endBatch 会抛
      // 「Cannot call endBatch on a destroyed Store」，那笔异常会顶掉回调的返回值
      // 或回调自身的原始错误，真实故障就此消失。销毁已经把批量语义作废
      // （BatchManager 深度归零、监听器全部退订），收尾无事可做
      if (!this._destroyed) {
        this.endBatch()
      }
    }
  }

  // ==================== 私有方法 ====================

  /** 初始化状态 */
  private _initializeState(state?: S | (() => S)): void {
    // 支持 state 工厂函数写法（Pinia 同款）：`state: () => ({...})`
    const resolvedState = typeof state === 'function' ? (state as () => S)() : state
    // 深拷贝初始状态，防止外部修改 options.state 引用污染 Store 内部状态（与 $replaceState 行为一致）
    this._state = resolvedState ? deepCloneState(resolvedState) : ({} as S)
    // 挂状态版本号 getter：供选择器以 O(1) 判定状态是否变化（见 core/store/stateVersion.ts）
    defineStateVersion(this._state, () => this._mutationCount)
  }

  /** 初始化Actions和Getters */
  private _initializeActionsAndGetters(actions?: A, getters?: G): void {
    // 使用箭头函数绑定 Store 实例，避免 this 指向 contextBase 对象本身
    const self = this

    // 创建 Action 上下文基础
    const contextBase: ActionContextBase<S> = {
      name: this.name,
      get state() {
        return self._getActionState()
      },
      setState: this.setState.bind(this),
      $patch: this.$patch.bind(this),
      $replaceState: this.$replaceState.bind(this),
      getState: this.getState.bind(this),
      dispatch: (actionName: string, ...args: unknown[]) => this.dispatch(actionName, ...args),
    }

    // 初始化 Action 管理器
    this._actionManager.initialize(actions, contextBase)
    this.actions = this._actionManager.actions

    // 初始化 Getter 管理器
    this._getterManager.initialize(getters)
  }

  /** 初始化缓存 */
  private _initializeCache(enableCache?: boolean, cacheKeys?: Array<keyof S>): void {
    if (enableCache) {
      this.enableCache(cacheKeys)
    }
  }

  /** 在内部访问模式下执行操作 */
  private _withInternalAccess<T>(fn: () => T): T {
    const prev = this._isInternalAccess
    this._isInternalAccess = true
    try {
      return fn()
    } finally {
      this._isInternalAccess = prev
    }
  }

  /** Action 写入始终跟踪脏键；onlyOnChange 额外使用变更计数决定是否通知。 */
  private _getActionState(): S {
    return this._createDirtyTrackingProxy(this._state) as S
  }

  /**
   * 重建状态保护 Proxy 管理器（构造、$replaceState、setStateProtection 共用）。
   *
   * 强制新建 proxyCache：旧缓存中的 Proxy 闭包绑定旧状态对象树/旧 path，
   * 复用会让保护层指向已过期对象。
   */
  private _rebuildStateProxyManager(): void {
    this._proxyCache = createProxyCache()
    this._stateProxyManager = new StateProxyManager<S>({
      protection: this._stateProtection,
      proxyCache: this._proxyCache,
      isInternalAccess: () => this._isInternalAccess,
    })
  }

  /** 创建允许写入的脏跟踪代理（实现已拆至 ./dirtyTracking.js）
   *
   *  onMutate 回调同时做两件事：
   *  1. 递增变更计数（onlyOnChange 判断 dispatch/batch 是否修改了状态）
   *  2. 标记受影响的顶层状态键（dirtyKeys）——action 直接变异嵌套对象/数组/Map/Set
   *     时不再只有计数、没有脏键，集成层的批量/脏过滤路径（isStateKeyDirty）才能跳过未变化映射
   */
  private _createDirtyTrackingProxy(target: object): object {
    return createDirtyTrackingProxy(target, this._dirtyProxyCache, (rootKeys) => {
      this._mutationCount++
      for (const rootKey of rootKeys) {
        this._markDirtyKey(rootKey as keyof S)
      }
    })
  }

  /** 批量结束通知：onlyOnChange 模式下批量期间无任何变更则跳过（与 dispatch 收尾语义一致） */
  private _onBatchEnd(): void {
    // dispatch 进行中（action 体内使用 store.batch）：批收尾不提前通知——
    // 否则中间态在 action 未完成时外泄，且与 dispatch 收尾补发重复。
    // 完成后的统一通知已覆盖：默认模式无条件补发，onlyOnChange 按计数差值补发
    if (this._actionManager.dispatchDepth > 0) {
      return
    }
    if (this._notifyOnlyOnChange && this._mutationCount <= this._batchMutationBaseline) {
      return
    }
    this._scheduleNotify()
  }

  /** 调度一次状态通知（同步或异步合并，取决于 notify.async 配置） */
  private _scheduleNotify(): void {
    if (this._notifyAsyncEnabled && this._asyncNotifier) {
      // 微任务合并：同一 tick 内的多次 setState/$patch/$replaceState 合并为一次通知。
      // 脏键跨批次累积，最终通知时仍能精确反映全部变更（与集成层对象值跳过天然兼容）
      this._asyncNotifier.notify(this._state)
    } else {
      this._notifyListeners()
    }
  }

  /**
   * 收集一次 `$patch` 里会被 deepMerge **就地改写**的状态对象
   *
   * 判据与 deepMerge 的递归分支同一条（core/utils/helpers.ts：仅当「补丁值与目标位置
   * 同为纯对象」时才 mergeInto 就地改写；其余分支一律 defineOwnProperty 换成新克隆，
   * 新对象不可能被别的顶层键提前引用）：
   * - 只被替换的键（数组 / Map / Set / Date / 类实例、以及类型冲突位）不进目标集 ⇒
   *   常见「整体替换」补丁路径直接跳过 O(顶层键数 × 全图) 的可达性扫描；
   * - 漏收才是真问题（别名键永久不标脏、视图停在旧值），所以宁可多收：
   *   deepMerge 对 `__proto__` / `constructor` / `prototype` 一律换成克隆，
   *   这些位置可能被多收一个，后果只是别名键多标一次脏、多一次 setData。
   *
   * 本方法是那条判据在 Store 侧的镜像，改 deepMerge 的合并条件时必须同步改这里。
   */
  private _collectInPlaceMergedObjects(dst: Record<string, unknown>, src: Record<string, unknown>): object[] {
    const out: object[] = []
    // 守卫与 deepMerge 的 seenPairs 逐字同构（键=补丁节点，值=已合并进该补丁的目标节点集），
    // 目的有二：状态与补丁各自成环时（`state.a.self === state.a` 且补丁写了 `a.self`）递归必须终止；
    // 以及「同一目标被两个补丁键命中」时两边都得展开。
    // 按「目标节点最多下沉一次」去重会漏收：`state.a === state.b`（别名）且补丁同时写了 a、b 时，
    // 第二个补丁键的子树被整段跳过，那段子树里的嵌套别名就永久不标脏——漏收的方向是漏报
    const mergedPairs = new WeakMap<object, Set<object>>()
    const walk = (target: Record<string, unknown>, patch: Record<string, unknown>): void => {
      let mergedInto = mergedPairs.get(patch)
      if (!mergedInto) {
        mergedInto = new Set()
        mergedPairs.set(patch, mergedInto)
      } else if (mergedInto.has(target)) {
        return
      }
      mergedInto.add(target)
      for (const key of Object.keys(patch)) {
        const patchValue = patch[key]
        if (!isPlainObject(patchValue)) {
          continue
        }
        const targetValue = target[key]
        if (!isPlainObject(targetValue)) {
          continue
        }
        const nested = targetValue as Record<string, unknown>
        out.push(nested)
        walk(nested, patchValue as Record<string, unknown>)
      }
    }
    walk(dst, src)
    return out
  }

  /**
   * 标记与本次补丁共享对象引用的其他顶层键
   *
   * `$patch` 的 deepMerge 会就地改写 `mergedInPlace` 里的对象；若其中一个同时被别的
   * 顶层键引用（`state.current = state.a.nested` 这种嵌套别名也算），那些键的内容
   * 同样变了却没有被补丁键覆盖，只映射它们的页面将永远看不到更新。
   * 因此对每个非补丁键做一次可达性扫描。与 `$replaceState` 的
   * 「整树所有键视为已变更」相比，这里只覆盖确实受影响的部分。
   *
   * @param mergedInPlace - 见 {@link _collectInPlaceMergedObjects}，空集直接跳过扫描
   * @param patched - 已按补丁键标过脏的顶层键，跳过
   */
  private _markAliasedKeys(mergedInPlace: readonly object[], patched: ReadonlySet<keyof S>): void {
    if (mergedInPlace.length === 0) {
      return
    }

    // 目标集合在扫描前一次性建好：_reachesAny 每个顶层键调用一次，
    // 在函数内 new Set 会把 O(N × graph) 的扫描再叠上 O(N × K) 的构建与分配
    const targetSet = new Set(mergedInPlace)

    for (const rootKey of Reflect.ownKeys(this._state) as Array<keyof S>) {
      if (patched.has(rootKey)) {
        continue
      }
      const descriptor = Object.getOwnPropertyDescriptor(this._state, rootKey)
      if (!descriptor || !('value' in descriptor)) {
        continue
      }
      if (this._reachesAny(descriptor.value, targetSet)) {
        this._markDirtyKey(rootKey)
      }
    }
  }

  /**
   * 判断某值可达对象中是否包含任一目标对象
   *
   * 迭代实现（与脏追踪代理的归属解析同口径）：不进入内建对象、不求值访问器，
   * 命中即提前返回。
   */
  private _reachesAny(value: unknown, targets: ReadonlySet<object>): boolean {
    if (targets.has(value as object)) {
      return true
    }
    if (value === null || typeof value !== 'object') {
      return false
    }
    const pending: unknown[] = [value]
    const seen = new Set<object>()
    while (pending.length > 0) {
      const current = pending.pop()
      if (current === null || typeof current !== 'object' || seen.has(current)) {
        continue
      }
      seen.add(current)
      if (targets.has(current)) {
        return true
      }
      if (isMapLike(current)) {
        for (const [key, child] of current) {
          pending.push(key, child)
        }
      } else if (isSetLike(current)) {
        for (const child of current) {
          pending.push(child)
        }
      } else if (isBuiltinObject(current)) {
        continue
      }
      for (const key of Reflect.ownKeys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key)
        if (descriptor && 'value' in descriptor) {
          pending.push(descriptor.value)
        }
      }
    }
    return false
  }

  /**
   * 标记状态键为脏
   *
   * 通知进行中（含回调内的重入写入）同时记入下一轮：那部分变更会触发新一轮通知，
   * 若只写当前集合，本轮收尾就会把它清掉，下一轮被集成层当作「未变化」跳过
   */
  private _markDirtyKey(key: keyof S): void {
    this._dirtyKeys.add(key)
    if (this._notifying) {
      this._deferredDirtyKeys.add(key)
    }
  }

  /** 通知状态变化 */
  private _notifyListeners(): void {
    // 深拷贝隔离仅在有「可写（用户）订阅者」时必要：页面/组件绑定均为只读订阅，
    // 不会修改载荷，可直接复用只读保护 Proxy（零拷贝），省去整棵状态树的深拷贝开销。
    // 用户显式 notify.clone=true 时强制拷贝（兼容既有显式配置语义）。
    const needsClone = (this._notifyCloneExplicit && this._notifyClone) || this._subscriptionManager.hasWritableListeners()
    // 拷贝归属只有管理器一处知道「哪些注册可写」，所以判定为需要隔离时把**原始状态**
    // 连同 `cloneOnNotify=true` 一起交下去：可写注册各拿一份独立深拷贝（先执行的可写回调
    // 改入参，不会让同一轮里后面的监听器读到半成品），只读注册共用一份。
    // 此前这里自备一份克隆再以 `false` 下发，等于替管理器处置好载荷，按注册分配的隔离
    // 在公开 `store.subscribe(fn)` 路径上整个失效（所有回调共用同一份），
    // 并且每轮 dispatch 都会触发管理器那条「cloneOnNotify=false 与可写订阅者共存」的 dev 告警
    const payload: S = needsClone || !this._stateProtectionEnabled ? this._state : this._stateProxyManager.createStateProxy(this._state, '')
    // 本轮已通知的脏键与「通知期间新产生的脏键」分离：回调内的写入（重入）会被
    // 调度为下一轮通知，其脏键必须留给下一轮。若在收尾统一 clear，重入写入的脏键
    // 会连同一轮的脏键一起被清掉，集成层对稳定引用对象值的跳过判定（isStateKeyDirty）
    // 就会把下一轮更新当作「未变化」，视图永久漏更新
    // 重入（回调内的写入触发了新一轮通知）：先把通知期间累积的脏键提升为本轮可见集合，
    // 本轮回调才能看到那些键；最外层通知的收尾则把可见集合换成「通知期间新产生的脏键」
    const reentrant = this._notifying
    if (reentrant) {
      for (const key of this._deferredDirtyKeys) {
        this._dirtyKeys.add(key)
      }
      this._deferredDirtyKeys = new Set()
    }

    this._notifying = true
    try {
      // needsClone 时载荷尚未处置，拷贝交给管理器按注册可写性分配；否则传已备好的零拷贝载荷
      this._subscriptionManager.notify(payload, needsClone)
    } finally {
      this._notifying = reentrant
    }
    // 记录本次通知已覆盖到的变更计数：后续 dispatch 补发按此去重，
    // 避免「续段 setState 已自发通知 + 完成补发」的重复通知
    this._lastNotifiedMutationCount = this._mutationCount
    if (!reentrant) {
      // 最外层通知收尾：已通知的脏键作废，只保留通知期间新产生的脏键（留给下一轮）
      this._dirtyKeys = this._deferredDirtyKeys
      this._deferredDirtyKeys = new Set()
    }
  }
}

/**
 * 检查是否是 GeomStore 实例
 *
 * 通过品牌 Symbol 精确识别，避免仅通过鸭子类型（属性存在性）误判。
 * @param value - 待检查的值
 */
export function isGeomStore<S extends State = State>(value: unknown): value is Store<S> {
  return !!value && typeof value === 'object' && GEOMSTORE_BRAND in value && (value as Record<symbol, unknown>)[GEOMSTORE_BRAND] === true
}
