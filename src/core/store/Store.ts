/**
 * GeomStore v1.0 - Store核心实现
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
} from '../../types/store'
import type { Plugin as PluginType } from '../../types/plugin'
import { HookSystem } from '../hooks/index'
import { deepMerge } from '../utils/helpers'
import { LRUCache } from '../cache/LRUCache'

// 子模块导入
import { StateProxyManager, createProxyCache } from './StateProxy'
import { SubscriptionManager, createSubscribeFunction } from './SubscriptionManager'
import { StoreCacheManager } from './StoreCache'
import { ActionManager, GetterManager } from './ActionManager'
import { BatchManager, createBatchFunction } from './BatchManager'
import type { ProxyCache, InternalStateProtectionConfig } from './types'
import { deepCloneState } from './utils'

// Plugin类型别名
type Plugin = PluginType

/**
 * Store实现类（模块化重构版）
 *
 * @class Store
 * @template S - 状态类型
 * @implements Store<S>
 */
/** Default maximum number of subscribers per store */
const DEFAULT_MAX_SUBSCRIBERS = 50

/** Store name prefix for auto-generated names */
const STORE_NAME_PREFIX = 'store-'

/** GeomStore 品牌标识，用于精确识别 Store 实例，避免鸭子类型误判 */
const GEOMSTORE_BRAND = Symbol.for('__geomstore_brand__')

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

  /** 通知前是否深拷贝（默认 true） */
  private _notifyClone: boolean

  /** 是否仅在状态实际变化时通知（默认 false） */
  private _notifyOnlyOnChange: boolean

  /** 状态变更计数器（脏跟踪：供 onlyOnChange 模式判断 dispatch 是否修改了状态） */
  private _mutationCount = 0

  /** 脏跟踪代理缓存（仅 onlyOnChange 模式使用，$replaceState 时重建） */
  private _dirtyProxyCache: WeakMap<object, object> = new WeakMap()

  /** Actions集合（公开） */
  public actions!: A

  /** 插件集合 */
  private _plugins: Plugin[] = []

  /** 插件卸载函数集合 */
  private _pluginUninstallFns: Map<Plugin, (() => void) | undefined> = new Map()

  /** dispatch跟踪标记 */
  private _dispatching = false

  /** 销毁标记 - 防止销毁后继续操作 */
  private _destroyed = false

  // ==================== 子模块实例 ====================

  /** Proxy缓存 */
  private _proxyCache: ProxyCache

  /** 状态保护代理管理器 */
  private _stateProxyManager: StateProxyManager<S>

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
    this._notifyOnlyOnChange = options.notify?.onlyOnChange ?? false

    // 初始化 Proxy 缓存和管理器
    this._proxyCache = createProxyCache()
    this._stateProxyManager = new StateProxyManager<S>({
      protection: this._stateProtection,
      proxyCache: this._proxyCache,
      isInternalAccess: () => this._isInternalAccess,
    })

    // 初始化订阅管理器
    this._subscriptionManager = new SubscriptionManager<S>({
      storeName: this.name,
      maxSubscribers: options.subscription?.maxSubscribers ?? DEFAULT_MAX_SUBSCRIBERS,
      onLimit: options.subscription?.onLimit,
      cloneOnNotify: this._notifyClone,
    })

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
    this._batchManager = new BatchManager(() => this._notifyListeners())

    // 初始化 Action 管理器
    this._actionManager = new ActionManager<S, A>({
      storeName: this.name,
      withInternalAccess: (fn) => this._withInternalAccess(fn),
      setDispatching: (value) => {
        this._dispatching = value
      },
      notifyListeners: () => this._notifyListeners(),
      hooks: this._hooks,
      notifyOnlyOnChange: this._notifyOnlyOnChange,
      getMutationCount: () => this._mutationCount,
      // dispatch 结束后从状态源刷新缓存，覆盖 action 直接变异 this.state 的路径
      refreshCache: () => this._cacheManager.refreshFromState((key) => this._state[key], Object.keys(this._state) as Array<keyof S>),
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

    // 相等性检查：值未变化时跳过写入和通知，避免无意义的订阅触发
    const oldValue = this._state[key]
    if (Object.is(oldValue, value)) {
      this._hooks.emit('afterSetState', key, value)
      return
    }

    this._withInternalAccess(() => {
      this._state[key] = value
    })

    this._mutationCount++
    this._cacheManager.set(key, value)

    if (!this._dispatching && !this._batchManager.isInBatch) {
      this._notifyListeners()
    }
    this._hooks.emit('afterSetState', key, value)
  }

  /**
   * 批量更新状态
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

    this._withInternalAccess(() => {
      deepMerge(this._state as Record<string, unknown>, partialState as Record<string, unknown>)
    })

    this._mutationCount++

    Object.keys(partialState).forEach((key) => {
      // 缓存应写入 deepMerge 后的最终状态值：嵌套对象被递归合并后，
      // this._state[key] 与 partialState[key] 可能不同（如 {a:{x:1}} patch {a:{y:2}}），
      // 写入 partial 值会导致缓存与状态不一致
      this._cacheManager.set(key as keyof S, this._state[key as keyof S])
    })

    if (!this._dispatching && !this._batchManager.isInBatch) {
      this._notifyListeners()
    }
    this._hooks.emit('afterPatch', partialState)
  }

  /**
   * 替换整个状态
   * @param newState - 新状态对象（不能为 null/undefined）
   */
  $replaceState(newState: S): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call $replaceState on a destroyed Store')
    }
    if (newState === undefined || newState === null) {
      throw new TypeError('[GeomStore] $replaceState: newState must be a valid state object')
    }
    // 安全检查：防止原型链污染，拒绝非对象类型和数组
    if (typeof newState !== 'object' || newState === null || Array.isArray(newState)) {
      throw new TypeError('[GeomStore] $replaceState: newState must be a plain object')
    }

    this._hooks.emit('beforeReplaceState', newState)

    this._withInternalAccess(() => {
      // 清理旧状态缓存
      if (this._cacheManager.enabled) {
        this._cacheManager.clearOldState(Object.keys(this._state) as Array<keyof S>)
      }

      // 深拷贝新状态，防止外部修改 newState 影响 Store 内部状态
      this._state = deepCloneState(newState)

      // 更新新状态缓存
      if (this._cacheManager.enabled) {
        Object.keys(this._state).forEach((key) => {
          this._cacheManager.set(key as keyof S, this._state[key as keyof S])
        })
      }
    })

    // 清除所有 Proxy 缓存
    this._proxyCache = createProxyCache()
    // 脏跟踪代理缓存指向旧状态对象树，一并重建
    this._dirtyProxyCache = new WeakMap()
    this._mutationCount++
    this._stateProxyManager = new StateProxyManager<S>({
      protection: this._stateProtection,
      proxyCache: this._proxyCache,
      isInternalAccess: () => this._isInternalAccess,
    })

    // 与 setState/$patch 一致：dispatch 或批量更新期间跳过通知，
    // 由 dispatch 收尾 / BatchManager.end 统一触发一次通知，避免破坏批量语义
    if (!this._dispatching && !this._batchManager.isInBatch) {
      this._notifyListeners()
    }
    this._hooks.emit('afterReplaceState', newState)
  }

  /**
   * 创建状态快照
   */
  $snapshot(): Readonly<S> {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call $snapshot on a destroyed Store')
    }
    return this._withInternalAccess(() => {
      return Object.freeze(deepCloneState(this._state)) as Readonly<S>
    })
  }

  /**
   * 从快照恢复状态
   */
  $restore(snapshot: Readonly<S>): void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call $restore on a destroyed Store')
    }
    this.$replaceState(deepCloneState(snapshot) as S)
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
   * 亦可用于调试与运行时检查。允许在销毁后调用（只读，返回空对象）。
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
   * @returns 取消订阅的函数
   * @throws 如果 Store 已销毁
   */
  subscribe(listener: StateListener<S>): () => void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call subscribe on a destroyed Store')
    }
    return createSubscribeFunction(this._subscriptionManager)(listener)
  }

  // ==================== 插件管理 ====================

  /**
   * 安装插件
   * @param plugin - 插件实例
   * @returns 卸载插件的函数
   * @throws 如果 Store 已销毁
   */
  use<T extends PluginType = PluginType>(plugin: T): () => void {
    if (this._destroyed) {
      throw new Error('[GeomStore] Cannot call use on a destroyed Store')
    }
    this._plugins.push(plugin)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uninstall = this._withInternalAccess(() => plugin.install?.(this as any))

    this._pluginUninstallFns.set(plugin, uninstall as (() => void) | undefined)

    return () => {
      const index = this._plugins.indexOf(plugin)
      if (index !== -1) {
        this._plugins.splice(index, 1)
      }

      const uninstallFn = this._pluginUninstallFns.get(plugin)
      if (typeof uninstallFn === 'function') {
        uninstallFn()
      }

      this._pluginUninstallFns.delete(plugin)
    }
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
   * 7. Proxy 缓存清空
   */
  destroy(): void {
    if (this._destroyed) {
      return // 幂等：重复销毁不报错
    }

    try {
      // 1. 反向卸载插件（后安装的先卸载）
      for (let i = this._plugins.length - 1; i >= 0; i--) {
        const plugin = this._plugins[i]
        const uninstallFn = this._pluginUninstallFns.get(plugin)
        if (typeof uninstallFn === 'function') {
          try {
            uninstallFn()
          } catch (error) {
            console.error(`[GeomStore] Error uninstalling plugin:`, error)
          }
        }
      }

      // 2. 清理订阅器
      this._subscriptionManager.clear()

      // 3. 禁用缓存
      this._cacheManager.disable()

      // 4. 清除钩子
      this._hooks.clear()

      // 5. 重置批量管理器（清理未配对 startBatch 残留的计数）
      this._batchManager.reset()

      // 6. 标记已销毁
      this._destroyed = true

      // 7. 清空集合引用
      this._plugins = []
      this._pluginUninstallFns.clear()
      this._proxyCache = createProxyCache()
    } catch (error) {
      console.error('[GeomStore] Error during Store destruction:', error)
      // 即使出错也标记为销毁，防止半销毁状态
      this._destroyed = true
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
   */
  setStateProtection(enabled: boolean): void {
    this._stateProtection.enabled = enabled
    this._stateProtectionEnabled = enabled
    if (!enabled) {
      this._proxyCache = createProxyCache()
      this._stateProxyManager = new StateProxyManager<S>({
        protection: this._stateProtection,
        proxyCache: this._proxyCache,
        isInternalAccess: () => this._isInternalAccess,
      })
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
    return createBatchFunction(this._batchManager)(fn)
  }

  // ==================== 私有方法 ====================

  /** 初始化状态 */
  private _initializeState(state?: S): void {
    // 深拷贝初始状态，防止外部修改 options.state 引用污染 Store 内部状态（与 $replaceState 行为一致）
    this._state = state ? deepCloneState(state) : ({} as S)
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

  /**
   * 获取 action 上下文使用的状态
   *
   * - 默认模式：返回原始状态引用（零开销，与历史行为一致）
   * - onlyOnChange 模式：返回脏跟踪代理，写入（含数组变异方法）会递增变更计数，
   *   供 ActionManager 判断是否需要通知
   */
  private _getActionState(): S {
    if (!this._notifyOnlyOnChange) {
      return this._state
    }
    return this._createDirtyTrackingProxy(this._state) as S
  }

  /** 创建允许写入的脏跟踪代理（递归包装嵌套对象，WeakMap 缓存保证引用稳定） */
  private _createDirtyTrackingProxy(target: object): object {
    const cached = this._dirtyProxyCache.get(target)
    if (cached) {
      return cached
    }

    const self = this
    const proxy = new Proxy(target, {
      get(obj: object, key: string | symbol): unknown {
        const value = (obj as Record<string | symbol, unknown>)[key]
        if (typeof value !== 'object' || value === null) {
          return value
        }
        return self._createDirtyTrackingProxy(value)
      },
      set(obj: object, key: string | symbol, value: unknown): boolean {
        (obj as Record<string | symbol, unknown>)[key] = value
        self._mutationCount++
        return true
      },
      deleteProperty(obj: object, key: string | symbol): boolean {
        delete (obj as Record<string | symbol, unknown>)[key]
        self._mutationCount++
        return true
      },
    })

    this._dirtyProxyCache.set(target, proxy)
    return proxy
  }

  /** 通知状态变化 */
  private _notifyListeners(): void {
    // 零拷贝模式下传入只读保护 Proxy（状态保护关闭时为原始引用，由用户自行保证不修改）
    const payload = this._notifyClone || !this._stateProtectionEnabled ? this._state : this._stateProxyManager.createStateProxy(this._state, '')
    this._subscriptionManager.notify(payload)
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
