/**
 * GeomStore - Store组合
 *
 * 优化：
 * - 使用类实例替代对象字面量，提升性能
 * - 订阅通知使用防抖机制，避免短时间内多次触发
 */

import type { Store, State, Actions, Getters, StateListener, CacheStats, InferGetterReturn } from '../../types/store.js'
import type { Plugin } from '../../types/plugin.js'
import type { ComposeOptions, StoreTreeNode, StoreLike, ExtractStates, ExtractActions, ExtractGetters } from '../../types/compose.js'
import { HookSystem } from '../hooks/index.js'
import { isProduction } from '../store/utils.js'
import { deepCloneState } from '../utils/clone.js'
import { getStateVersion } from '../store/stateVersion.js'
import { ALL_HOOK_NAMES, dispatchByNamespace, findTargetStoreWithKey, parseActionName } from './helpers.js'
import { mergeNamespaced, mergeStateMaps } from './merge.js'

/**
 * ComposedStore 类
 *
 * 组合多个 Store 为一个统一的 Store 实例
 * 使用类替代对象字面量，提供更好的性能和方法查找效率
 */
class ComposedStore<S extends State = State> implements Store<S> {
  readonly name: string
  /**
   * 合并后的 action 注册表：键与 dispatch 的命名规则一致（命名空间模式为
   * `storeName/actionName`，非命名空间模式为裸名，同名取第一个 store）。
   */
  readonly actions: Record<string, (...args: unknown[]) => unknown>

  /** 实例级钩子系统 - 组合 Store 透传到子 Store */
  public readonly hooks: HookSystem

  /** 销毁标记 */
  public destroyed: boolean = false

  /** 内部 Store 数组 */
  private _stores: Store[]
  /** 命名空间 */
  private _namespace: string | boolean
  /** 严格模式 */
  private _strict: boolean
  /** stores 引用（暴露给外部） */
  public stores: Record<string, Store> = {}

  /** 防抖相关：实例级统一调度，避免多个订阅者各自维护标志导致非首个订阅者丢通知 */
  private _notificationScheduled: boolean = false
  /** 当前活跃的订阅者：监听器 → 注册次数与其中可写份数。
   *  与 SubscriptionManager 同语义——同一函数注册 N 次通知 N 次，退订只减一，
   *  减到 0 才真正移除。此前用 Set 会使「退订其中一份」直接删除整个监听器，
   *  用户仍持有的另一份退订句柄静默失效、永不再收到通知。 */
  private _composedListeners: Map<StateListener<S>, { total: number; writable: number }> = new Map()
  /** 可写（非只读）注册总次数：>0 时通知载荷必须是深拷贝（见 _notifyListeners 的隔离说明） */
  private _composedWritableCount = 0
  /** 对子 Store 的订阅句柄（destroy 时统一退订，避免闭包残留） */
  private _storeUnsubscribers: Array<() => void> = []
  /** 子 store 单路合并订阅是否已建立（构造期为缓存失效建立，组合层订阅复用，避免重复占额度） */
  private _childSubscriptionsReady: boolean = false
  /** 已告警过的 state 键冲突组合（每个组合只告警一次，避免高频 getState 刷屏） */
  private _warnedStateKeyConflicts = new Set<string>()
  /** 子 Store 钩子桥接的退订函数（destroy 时统一移除，防止闭包残留） */
  private _hookUnsubscribers: Array<() => void> = []
  /** 自上次通知以来发生变更的子 store 名集合：命名空间模式下供 isStateKeyDirty 精确跳过 setData */
  private _dirtyStores: Set<string> = new Set()

  /**
   * 通知期间新产生的脏子 store（回调内的重入写入）：与 Store._deferredDirtyKeys 同语义，
   * 不能随本轮收尾一起清空，否则下一轮 isStateKeyDirty 会把已变更的子 store 判为未变化
   */
  private _deferredDirtyStores: Set<string> = new Set()

  /** 是否正在通知：决定脏子 store 标记是否需要同时留给下一轮 */
  private _notifying = false
  /** 合并状态缓存：非命名空间/命名空间两种读取形态各缓存一份，子 store 变化时失效 */
  private _mergedCache: Record<string, unknown> | null = null
  /** 只读冻结形态的合并状态缓存（对应 state getter），与 _mergedCache 独立以免冻结影响 getState 消费者 */
  private _mergedCacheFrozen: Record<string, unknown> | null = null
  /** 合并缓存是否启用：子 store 订阅失效回调建立失败时降级为每次读取重合并，保证不返回陈旧状态 */
  private _mergedCacheEnabled: boolean = true
  /**
   * 缓存建立时各子 store 的状态版本号快照：读取时逐一比对，不一致即失效。
   *
   * 子 store 的失效回调依赖「通知」，但批处理会推迟通知、notify:{async:true} 会
   * 延迟通知——仅靠通知失效会让批内的读改写读到缓存里的过期值（丢失更新）。
   * 版本号 getter 在子 store 的每条写入路径上同步递增，此处读取时校验
   * 不受通知时序影响。无版本号的子 store（含嵌套组合）每次读取时保守失效。
   */
  private _cachedChildVersions: Array<number | undefined> = []

  constructor(stores: Store[], options: ComposeOptions = {}) {
    this._stores = stores
    this._namespace = options.namespace ?? ''
    this._strict = options.strict ?? false
    this.name = typeof this._namespace === 'string' ? this._namespace || 'composed' : 'composed'

    // 初始化实例级钩子系统（组合 Store 使用独立的 HookSystem）
    this.hooks = new HookSystem()

    // 子 store 重名校验。
    // 命名空间模式下 store.name 同时是两套查找的键，但两者取值方向相反：
    // getState() 用 result[store.name] = …（后者覆盖前者），
    // findTargetStoreWithKey 用 stores.find(s => s.name === …)（取第一个）——
    // 重名会让读落到后一个 store、写落到前一个，读写分裂且全程无告警。
    // 这是无法正确工作的配置错误（与 composeStore([]) 同属构造期校验），故直接抛错。
    // 嵌套组合时内层 ComposedStore 的 name 默认同为 'composed'，最容易踩中
    const nameCounts = new Map<string, number>()
    for (const store of stores) {
      nameCounts.set(store.name, (nameCounts.get(store.name) ?? 0) + 1)
    }
    const duplicatedNames: string[] = []
    nameCounts.forEach((count, name) => {
      if (count > 1) duplicatedNames.push(name)
    })
    if (duplicatedNames.length > 0) {
      if (this._namespace) {
        throw new Error(
          `[composeStore] 命名空间模式下子 store 名称不得重复，否则读写会路由到不同 store: ${duplicatedNames.join(', ')}。` +
            '请为各子 store 设置唯一 name（嵌套组合时给内层传 namespace 字符串以区分）',
        )
      }
      // 非命名空间模式：state 按键平铺合并，重名只影响 stores 映射与歧义提示的可读性，
      // 按 _mergeStateMaps 的既有口径在开发模式告警而非抛错
      if (!isProduction()) {
        console.warn(`[composeStore] 子 store 名称重复 (${duplicatedNames.join(', ')})：stores 映射中后者覆盖前者，` + '建议设置唯一 name 或启用命名空间模式')
      }
    }

    // 构建 stores 引用
    for (const store of stores) {
      this.stores[store.name] = store
    }

    // 嵌套组合的写路径提示：非命名空间外层包含命名空间内层时，内层子 store 的键
    // 在合并状态里是「子 store 名/键」形式，写操作必须用完整斜杠路径（'leaf/n'）。
    // 裸键在非严格模式会被静默忽略，故构造期提示一次
    if (!this._namespace && !isProduction()) {
      for (const store of stores) {
        const nested = (store as { stores?: Record<string, unknown> }).stores
        if (!nested) continue
        // 仅命名空间内层需要提示：其子 store 的键在合并状态里是「子 store 名/键」，
        // 而平铺内层的键就是裸键（可直接按名访问），无需额外写法
        const nestedState = store.getState()
        const namespaced = Object.keys(nested).some((name) => Object.prototype.hasOwnProperty.call(nestedState, name))
        if (namespaced) {
          console.warn(
            `[composeStore] 非命名空间组合中包含命名空间子组合 "${store.name}"：` +
              '读写其内部 store 的键请使用「子 store 名/键」形式的完整斜杠路径（如 "leaf/count"），裸键会被忽略',
          )
          break
        }
      }
    }

    // 合并子 store 的 action 注册表，键与 dispatch 命名规则一致，
    // 使外层组合能按 child.actions 路由嵌套组合的裸名 dispatch
    const mergedActions: Record<string, (...args: unknown[]) => unknown> = {}
    for (const store of stores) {
      for (const actionName of Object.keys(store.actions ?? {})) {
        const mappedKey = this._namespace ? `${store.name}/${actionName}` : actionName
        if (!Object.prototype.hasOwnProperty.call(mergedActions, mappedKey)) {
          mergedActions[mappedKey] = (...args: unknown[]) => store.dispatch(actionName, ...args)
        }
      }
    }
    this.actions = mergedActions

    // 钩子桥接：子 store 触发的生命周期事件在组合层同步重发。
    // 此前 hooks 只在 destroy 时被 clear，从不接收任何事件——通过
    // composed.hooks.on 注册的监听器永远收不到回调（静默失效）
    for (const store of stores) {
      const childHooks = store.hooks
      if (!childHooks) continue
      for (const hookName of ALL_HOOK_NAMES) {
        // 箭头函数按 hookName 捕获，转发原始参数透传给组合层监听器
        const forward = (...args: unknown[]): void => {
          this.hooks.emit(hookName, ...args)
        }
        const off = childHooks.on(hookName, forward)
        this._hookUnsubscribers.push(off)
      }
    }

    // 合并状态缓存失效与组合层通知复用同一条「单路订阅」：构造期即建立（供缓存失效），
    // 组合层订阅时复用同一条，对每个子 store 只建一份订阅，其回调同时完成
    // 「缓存失效 + 调度通知」两件事。这样既保证子 store 变化能触发合并缓存重建，
    // 又不额外占用子 store 的订阅配额（此前多建一条缓存失效订阅会挤掉外部直连监听器）。
    // 构造期订阅失败（如子 store 已销毁/达上限）则优雅降级：放弃合并缓存，
    // 后续读取退回每次重合并，避免失效订阅缺失导致缓存返回陈旧状态
    try {
      this._ensureChildSubscriptions()
    } catch {
      this._mergedCacheEnabled = false
    }
  }

  /**
   * 建立（或复用）对子 store 的单路合并订阅：每个子 store 仅一份，
   * 回调同时完成「合并缓存失效 + 调度通知」。幂等：已建立则直接返回，
   * 保证构造期与组合层订阅期共用同一条订阅，不重复占用子 store 订阅额度。
   */
  private _ensureChildSubscriptions(): void {
    if (this._childSubscriptionsReady) {
      return
    }
    const established: Array<() => void> = []
    try {
      for (const store of this._stores) {
        established.push(
          // 标记为只读订阅：回调仅做缓存失效与通知调度，从不写入子 store 状态。
          // 使子 store 在「仅组合层订阅」场景下走零拷贝路径，省去每次通知的整树深拷贝；
          // 组合层自己的可写监听器由 _notifyListeners 单独深拷贝载荷做隔离
          store.subscribe(
            () => {
              this._invalidateMergedCache()
              this._markDirtyStore(store.name)
              this._scheduleNotify()
            },
            { readOnly: true },
          ),
        )
      }
      this._storeUnsubscribers.push(...established)
      this._childSubscriptionsReady = true
    } catch (error) {
      // 子 store 订阅失败（如已达上限并采用 throw 策略）：回滚已建句柄，
      // 重新抛出交给调用方处理——构造期优雅降级（放弃合并缓存），
      // 组合层订阅期触发监听器回滚，避免半订阅状态
      for (const unsubscribe of established) {
        unsubscribe()
      }
      throw error
    }
  }

  // ==================== 状态管理 ====================

  /**
   * 销毁状态守卫：在调用任何公开方法前检查 Store 是否已销毁
   */
  private _ensureAlive(methodName: string): void {
    if (this.destroyed) {
      throw new Error(`[GeomStore] Cannot call ${methodName} on a destroyed ComposedStore`)
    }
  }

  /** 使合并状态缓存失效：任一子 store 通知时调用（构造期订阅） */
  private _invalidateMergedCache(): void {
    this._mergedCache = null
    this._mergedCacheFrozen = null
  }

  /**
   * 读取前校验合并缓存新鲜度：逐一比对各子 store 当前状态版本号与缓存建立时的
   * 快照，任一不一致即失效。覆盖批处理推迟通知、异步通知未 flush 等窗口——
   * 这些场景下子 store 状态已变但失效回调尚未执行。
   */
  private _ensureMergedCacheFresh(): void {
    if (!this._mergedCache && !this._mergedCacheFrozen) {
      return
    }
    for (let i = 0; i < this._stores.length; i++) {
      const current = getStateVersion(this._stores[i].state)
      if (current === undefined || current !== this._cachedChildVersions[i]) {
        this._invalidateMergedCache()
        return
      }
    }
  }

  /**
   * 命名空间模式：按 store.name 归并各子 store 视图，语义与 getState/state/$snapshot 共用。
   *
   * 合并策略已拆至 ./merge.js
   */
  private _mergeNamespaced(pick: (store: Store) => Record<string, unknown>, freeze: boolean = false): Record<string, unknown> {
    return mergeNamespaced(this._stores, pick, freeze)
  }

  getState(): S {
    this._ensureAlive('getState')
    if (this._namespace) {
      if (!this._mergedCacheEnabled) {
        return this._mergeNamespaced((store) => store.getState() as Record<string, unknown>) as S
      }
      this._ensureMergedCacheFresh()
      if (!this._mergedCache) {
        this._mergedCache = this._mergeNamespaced((store) => store.getState() as Record<string, unknown>)
        this._recordChildVersions()
      }
      return this._mergedCache as S
    }
    if (!this._mergedCacheEnabled) {
      return this._mergeStateMaps((store) => store.getState() as Record<string, unknown>) as S
    }
    this._ensureMergedCacheFresh()
    if (!this._mergedCache) {
      this._mergedCache = this._mergeStateMaps((store) => store.getState() as Record<string, unknown>)
      this._recordChildVersions()
    }
    return this._mergedCache as S
  }

  /**
   * 非命名空间模式下平铺合并各 store 的 state 键。
   *
   * 合并策略与冲突告警已拆至 ./merge.js（warnedStateKeyConflicts 由实例持有以跨调用去重）
   */
  private _mergeStateMaps(pick: (store: Store) => Record<string, unknown>): Record<string, unknown> {
    return mergeStateMaps(this._stores, pick, this._warnedStateKeyConflicts)
  }

  get state(): S {
    this._ensureAlive('state')
    if (this._namespace) {
      if (!this._mergedCacheEnabled) {
        return this._mergeNamespaced((store) => store.state as unknown as Record<string, unknown>, true) as S
      }
      this._ensureMergedCacheFresh()
      if (!this._mergedCacheFrozen) {
        this._mergedCacheFrozen = this._mergeNamespaced((store) => store.state as unknown as Record<string, unknown>, true)
        this._recordChildVersions()
      }
      return this._mergedCacheFrozen as S
    }
    // 取值源用子 store 的保护视图（store.state）而非内部裸引用（getState）：
    // 顶层写入落在冻结容器上会抛错；嵌套写入被子 store 保护代理拦截。
    // 此前直接合并裸引用，composed.state.nested.x = 1 会静默穿透进子 store 内部状态
    if (!this._mergedCacheEnabled) {
      return Object.freeze(this._mergeStateMaps((store) => store.state as unknown as Record<string, unknown>)) as S
    }
    this._ensureMergedCacheFresh()
    if (!this._mergedCacheFrozen) {
      this._mergedCacheFrozen = Object.freeze(this._mergeStateMaps((store) => store.state as unknown as Record<string, unknown>))
      this._recordChildVersions()
    }
    return this._mergedCacheFrozen as S
  }

  /** 记录当前各子 store 的状态版本号，供读取时校验缓存新鲜度 */
  private _recordChildVersions(): void {
    this._cachedChildVersions = this._stores.map((store) => getStateVersion(store.state))
  }

  setState<K extends keyof S>(key: K, value: S[K]): void {
    this._ensureAlive('setState')
    const [targetStore, actualKey] = findTargetStoreWithKey(String(key), this._stores, this._namespace)
    if (!targetStore) {
      if (this._strict) {
        throw new Error(`[composeStore] Cannot find store for key: ${String(key)}`)
      }
      return
    }
    targetStore.setState(actualKey as keyof typeof targetStore.state, value as (typeof targetStore.state)[keyof typeof targetStore.state])
  }

  $patch(partialState: Partial<S>): void {
    this._ensureAlive('$patch')
    dispatchByNamespace(this._stores, this._namespace, partialState as Record<string, unknown>, this._strict, (store, value) =>
      store.$patch(value as Partial<S>),
    )
  }

  $replaceState(newState: S): void {
    this._ensureAlive('$replaceState')
    dispatchByNamespace(
      this._stores,
      this._namespace,
      newState as Record<string, unknown>,
      this._strict,
      (store, value) => store.$replaceState(value as S),
      // 仅开发模式下对非命名空间分组缺键发出告警
      { warnMissingKeys: !isProduction() && !this._namespace },
    )
  }

  // ==================== Action 和 Getter ====================

  dispatch(actionName: string, ...args: unknown[]): unknown {
    this._ensureAlive('dispatch')
    const [storeName, actualAction] = parseActionName(actionName, this._namespace)

    let targetStore: Store | undefined

    if (storeName) {
      targetStore = this._stores.find((s) => s.name === storeName)
    } else {
      // 裸名查找：多 store 命中同名 action 时提示冲突（仍取第一个，保持兼容）
      const matches = this._stores.filter((s) => s.actions && Object.prototype.hasOwnProperty.call(s.actions, actualAction))
      if (matches.length > 1) {
        console.warn(
          `[composeStore] Action "${actualAction}" 存在于多个 store（${matches.map((s) => s.name).join(', ')}），将调用第一个 store 的定义；建议启用命名空间消除歧义`,
        )
      }
      targetStore = matches[0]
    }

    if (!targetStore) {
      if (this._strict) {
        throw new Error(`[composeStore] Cannot find store for action: ${actionName}`)
      }
      return undefined
    }

    return targetStore.dispatch(actualAction, ...args)
  }

  /**
   * 合并后的 Getters 定义（只读）
   *
   * 键的合并规则与 getter() 的解析语义一致：命名空间模式下为 `storeName/getterName`，
   * 非命名空间模式为裸名（同名冲突取第一个 store 的定义）
   */
  get getters(): Getters<S> {
    const result: Record<string, (state: S) => unknown> = {}
    for (const store of this._stores) {
      const subGetters = store.getters
      for (const key of Object.keys(subGetters)) {
        const mappedKey = this._namespace ? `${store.name}/${key}` : key
        // own property 判定：`in` 会命中 Object 原型链（'toString' 等），
        // 原型链属性名会误判为已存在而跳过真实 getter 的合并
        if (!Object.prototype.hasOwnProperty.call(result, mappedKey)) {
          result[mappedKey] = subGetters[key] as (state: S) => unknown
        }
      }
    }
    return result
  }

  /** 类型安全 getter（与 Store 接口重载签名保持一致） */
  getter<K extends keyof Getters<S>>(getterName: K): InferGetterReturn<Getters<S>, K>
  getter(getterName: string): unknown {
    this._ensureAlive('getter')
    const [storeName, actualGetter] = parseActionName(getterName, this._namespace)

    let targetStore: Store | undefined

    if (storeName) {
      targetStore = this._stores.find((s) => s.name === storeName)
    } else {
      // 使用 getGetterNames() 查找，避免 try/catch 异常驱动控制流；
      // 多 store 命中同名 getter 时提示冲突（仍取第一个，保持兼容）
      const matches = this._stores.filter((s) => {
        return s.getGetterNames().includes(actualGetter)
      })
      if (matches.length > 1) {
        console.warn(
          `[composeStore] Getter "${actualGetter}" 存在于多个 store（${matches.map((s) => s.name).join(', ')}），将返回第一个 store 的定义；建议启用命名空间消除歧义`,
        )
      }
      targetStore = matches[0]
    }

    if (!targetStore) {
      if (this._strict) {
        throw new Error(`[composeStore] Cannot find store for getter: ${getterName}`)
      }
      return undefined
    }

    return targetStore.getter(actualGetter)
  }

  /**
   * 获取所有子 Store 的 getter 名称列表。
   *
   * 若存在命名空间前缀，返回 `${storeName}/${getterName}` 形式；否则返回去重后的裸名。
   */
  getGetterNames(): string[] {
    const names: string[] = []
    const seen = new Set<string>()
    for (const store of this._stores) {
      const subNames = store.getGetterNames ? store.getGetterNames() : []
      for (const n of subNames) {
        const full = this._namespace ? `${store.name}/${n}` : n
        if (!seen.has(full)) {
          seen.add(full)
          names.push(full)
        }
      }
    }
    return names
  }

  // ==================== 订阅（带防抖）====================

  /**
   * 向所有活跃订阅者广播当前状态
   */
  private _notifyListeners(): void {
    if (this.destroyed) return
    // 载荷隔离：子 store 是以 readOnly 订阅的（组合层回调本身从不写子 store），
    // 因此子 store 会跳过深拷贝、把活的内部状态对象交给组合层合并。
    // 组合层若把它原样广播给可写（用户）监听器，监听器就地改载荷就等于直接改子 store 状态，
    // 且绕过子 store 的通知/钩子——存在可写订阅者时由组合层自己做一次深拷贝，
    // 与 Store._notifyListeners 的 hasWritableListeners() 判据同口径
    const state = this._composedWritableCount > 0 ? deepCloneState(this.getState()) : this.getState()
    // 迭代前快照，防止订阅者在回调中退订导致集合变更
    const entries = [...this._composedListeners]
    this._notifying = true
    try {
      for (const [listener, entry] of entries) {
        // 按注册次数展开：重复注册的监听器每次通知收到多次回调（与 SubscriptionManager 同语义）
        for (let i = 0; i < entry.total; i++) {
          try {
            listener(state)
          } catch (error) {
            // 单个 listener 抛错不应中断其余监听器的通知，
            // 否则错误会冒泡进微任务回调成为 uncaught exception（与 SubscriptionManager 隔离语义一致）
            if (!isProduction()) {
              console.error('[GeomStore] Error in composed state listener:', error)
            }
          }
        }
      }
    } finally {
      this._notifying = false
    }
    // 通知结束只作废本轮已广播的脏标记（与 Store._dirtyKeys 语义对齐）：
    // 回调内重入写入产生的脏标记留给下一轮，否则集成层会跳过该子 store 的 setData
    this._dirtyStores = this._deferredDirtyStores
    this._deferredDirtyStores = new Set()
  }

  /**
   * 标记子 store 为脏；通知进行中（回调内的重入写入）同时记入下一轮集合
   */
  private _markDirtyStore(name: string): void {
    this._dirtyStores.add(name)
    if (this._notifying) {
      this._deferredDirtyStores.add(name)
    }
  }

  /**
   * 调度一次合并通知：同一微任务内的多次状态变化只触发一次广播
   */
  private _scheduleNotify(): void {
    if (this.destroyed) return
    // 已有待处理通知时直接返回：微任务里的 _notifyListeners() 读取实时
    // 合并状态，此刻到达的变化必然已被这次广播覆盖——补发只会让监听器
    // 收到两次完全相同的状态（小程序侧桥接 setData 的订阅者会双倍渲染）。
    // 通知回调期间的新变化在复位后走到下方重新入队，语义正确
    if (this._notificationScheduled) {
      return
    }

    this._notificationScheduled = true

    const runNotify = () => {
      this._notificationScheduled = false

      // 通知所有监听器（载荷为通知时刻的实时合并状态）
      this._notifyListeners()
    }

    // 使用微任务合并同一事件循环内的多次状态变化（基础库 3.15.0+ 原生支持 queueMicrotask）
    // 环境无 queueMicrotask 时降级为 Promise 微任务，保证通知仍能在微任务中执行
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(runNotify)
    } else {
      Promise.resolve().then(runNotify)
    }
  }

  subscribe(listener: StateListener<S>, options?: { readOnly?: boolean }): () => void {
    this._ensureAlive('subscribe')
    const readOnly = options?.readOnly ?? false

    // 重复订阅只递增计数：与 SubscriptionManager.add 一致，
    // 不参与子 store 订阅的建立（子 store 侧本就单路复用一份）
    const existing = this._composedListeners.get(listener)
    if (existing !== undefined) {
      existing.total += 1
      if (!readOnly) {
        existing.writable += 1
        this._composedWritableCount += 1
      }
      return this._createUnsubscribe(listener, readOnly)
    }
    this._composedListeners.set(listener, { total: 1, writable: readOnly ? 0 : 1 })
    if (!readOnly) {
      this._composedWritableCount += 1
    }

    // 单路复用：首个组合层监听器进入时对每个子 store 只建一份订阅（与构造期缓存失效
    // 订阅共用同一条，不重复占额度）。此前每个监听器都重复订阅全部子 store，N 个监听器
    // 占用 N 份/子store 的订阅额度，超出子 store maxSubscribers 时会静默驱逐应用直连的订阅者
    try {
      this._ensureChildSubscriptions()
    } catch (error) {
      // 子 store 订阅失败（如已被独立销毁）：回滚已入集合的监听器，
      // 避免监听器收不到通知、也无法退订的半订阅状态
      this._composedListeners.delete(listener)
      if (!readOnly) {
        this._composedWritableCount -= 1
      }
      throw error
    }

    // 与普通 Store.subscribe 保持一致：订阅时不立即回调，
    // 仅在子 store 状态变化时通知，避免带副作用的监听器在订阅时被意外执行

    return this._createUnsubscribe(listener, readOnly)
  }

  /**
   * 判断指定状态键自上次通知以来是否发生变更
   *
   * 组合 Store 将多个子 store 的状态按 store 名合并，键空间与子 store 不对应，
   * 无法精确映射到某个子 store 的脏键。这里保守返回 true（视为已变更），
   * 使绑定层在对象值上保持「宁多勿漏」行为，确保正确性；
   * 对象值的整体替换（引用变化）仍由引用比较兜底发送。
   *
   * @param _key - 组合层状态键（即子 store 名）
   * @returns 始终返回 true（保守：不跳过任何 setData）
   */
  isStateKeyDirty(key: string): boolean {
    // 合并缓存订阅未建立（降级场景）：无脏追踪，保守返回 true（不跳过 setData，避免丢失更新）
    if (!this._mergedCacheEnabled) {
      return true
    }
    // 命名空间模式：组合状态键即子 store 名，可精确追踪哪个子 store 变更，
    // 使集成层据此跳过未变化映射键的冗余 setData（恢复此前被恒 true 抑制的跳过优化）
    if (this._namespace) {
      return this._dirtyStores.has(key)
    }
    // 非命名空间模式：状态键为子 store 内部 key 平铺，无法精确映射到脏子 store，
    // 保守返回 true（不跳过 setData），对象值整体替换仍由引用比较兜底
    return true
  }

  /** 释放一份监听器注册：同一监听器减到 0 才真正移除。
   *
   *  注意：不再随「最后一个组合层监听器退订」撤销子 store 订阅——该订阅同时承担
   *  合并缓存失效（_invalidateMergedCache）职责，撤销后 getState() 会返回陈旧缓存，
   *  且 _childSubscriptionsReady 保持 true 使重新订阅无法重建通知（静默失效）。
   *  子 store 订阅与构造期建立对称，统一在 destroy() 释放。
   */
  private _createUnsubscribe(listener: StateListener<S>, readOnly: boolean): () => void {
    let active = true
    return () => {
      if (!active) return
      active = false
      this._releaseListener(listener, readOnly)
    }
  }

  /**
   * 释放一份监听器注册：同一监听器减到 0 才真正移除。
   *
   * 句柄捕获自己那一次注册的 readOnly 标记：同一函数可能既被只读注册（视图绑定）
   * 又被可写注册（用户订阅），退订时必须按各自的标记回收可写计数。
   */
  private _releaseListener(listener: StateListener<S>, readOnly: boolean): void {
    const entry = this._composedListeners.get(listener)
    if (entry === undefined) {
      return
    }
    if (!readOnly) {
      entry.writable -= 1
      this._composedWritableCount -= 1
    }
    if (entry.total > 1) {
      entry.total -= 1
      return
    }
    this._composedListeners.delete(listener)
  }

  // ==================== 插件管理 ====================

  use(plugin: Plugin<S> | Plugin<State>): () => void {
    this._ensureAlive('use')
    const uninstalls: Array<() => void> = []

    for (const store of this._stores) {
      let uninstall: unknown
      try {
        // 子 store 以各自的类型参数声明 use：组合状态类型的插件在结构上同时适用于各子 store
        // （插件仅通过 install 读取状态），故在此收窄为子 store 的插件类型
        uninstall = store.use(plugin as unknown as Plugin)
      } catch (error) {
        // 某个子 store 安装失败：回滚已完成安装的子 store，
        // 避免半安装插件残留（部分 store 有插件、部分没有）
        for (const fn of uninstalls) {
          fn()
        }
        throw error
      }
      // 运行时防御：接口约定 use 返回卸载函数，但 mock/异构实现可能返回其他值
      if (typeof uninstall === 'function') {
        uninstalls.push(uninstall as () => void)
      }
    }

    return () => {
      for (const uninstall of uninstalls) {
        uninstall()
      }
    }
  }

  // ==================== 生命周期 ====================

  /**
   * 销毁组合 Store
   *
   * @param destroyStores - 是否级联销毁子 Store（默认 true，保持向后兼容）。
   *  当子 Store 在组合之外被独立持有并继续使用时，应传入 false：
   *  仅退订组合层订阅并清理钩子，避免牵连外部持有的子 Store
   */
  destroy(destroyStores: boolean = true): void {
    if (this.destroyed) return
    // 先退订所有子 Store 订阅：组合层销毁后，残留回调无意义且会持有闭包引用
    // （退订函数幂等，重复调用安全）
    for (const unsubscribe of this._storeUnsubscribers) {
      unsubscribe()
    }
    this._storeUnsubscribers = []
    // 桥接退订：移除对子 store 钩子的监听（子 store 可能被保留时尤其重要）
    for (const off of this._hookUnsubscribers) {
      off()
    }
    this._hookUnsubscribers = []
    if (destroyStores) {
      for (const store of this._stores) {
        store.destroy()
      }
    }
    this._composedListeners.clear()
    this._composedWritableCount = 0
    this.hooks.clear()
    this.destroyed = true
  }

  // ==================== 缓存管理 ====================

  getCached<K extends keyof S>(key: K): S[K] {
    this._ensureAlive('getCached')
    const keyStr = String(key)
    const [targetStore, actualKey] = findTargetStoreWithKey(keyStr, this._stores, this._namespace)
    if (!targetStore) {
      if (this._strict) {
        throw new Error(`[composeStore] Cannot find store for key: ${keyStr}`)
      }
      return undefined as S[K]
    }
    return targetStore.getCached(actualKey as never) as S[K]
  }

  enableCache(keys?: Array<keyof S>): void {
    this._ensureAlive('enableCache')
    for (const store of this._stores) {
      // 子 store 的泛型与组合后的 S 不同构，键集合仅在运行时传递，此处断言安全
      store.enableCache(keys as Array<keyof State> | undefined)
    }
  }

  disableCache(): void {
    this._ensureAlive('disableCache')
    for (const store of this._stores) {
      store.disableCache()
    }
  }

  invalidateCache<K extends keyof S>(key?: K): void {
    this._ensureAlive('invalidateCache')
    if (key !== undefined) {
      const keyStr = String(key)
      const [targetStore, actualKey] = findTargetStoreWithKey(keyStr, this._stores, this._namespace)
      if (targetStore) {
        targetStore.invalidateCache(actualKey as never)
      } else if (this._strict) {
        throw new Error(`[composeStore] Cannot find store for key: ${keyStr}`)
      }
    } else {
      for (const store of this._stores) {
        store.invalidateCache()
      }
    }
  }

  getCacheStats(): CacheStats {
    this._ensureAlive('getCacheStats')
    const stats: CacheStats = {
      enabled: false,
      size: 0,
      keys: [],
      hits: 0,
      misses: 0,
    }

    for (const store of this._stores) {
      const storeStats = store.getCacheStats()
      stats.enabled = stats.enabled || storeStats.enabled
      stats.size += storeStats.size
      stats.keys.push(...storeStats.keys)
      stats.hits += storeStats.hits
      stats.misses += storeStats.misses
    }

    return stats
  }

  // ==================== 批量更新 ====================

  startBatch(): void {
    this._ensureAlive('startBatch')
    this._startBatchOnStores()
  }

  /** 对各子 store 开启批量：已被独立销毁的子 store 跳过。
   *
   *  必须与 _endBatchOnStores 对称容错：此前裸循环在某个子 store 已销毁时抛错中断，
   *  已成功 startBatch 的子 store 批量深度悬置为 1 且再无 endBatch 到达，
   *  通知被永久抑制——对仍健康的子 store 是静默失效。跳过已销毁子 store 后
   *  start/end 两侧深度始终配对（被跳过者从未 start，收尾时同样被跳过）。
   */
  private _startBatchOnStores(): void {
    for (const store of this._stores) {
      try {
        store.startBatch()
      } catch {
        // 子 store 已被独立销毁：其订阅与状态已清理，跳过开启
      }
    }
  }

  endBatch(): void {
    this._ensureAlive('endBatch')
    this._endBatchOnStores()
  }

  /** 对各子 store 收尾批量深度：已被独立销毁的子 store 跳过 */
  private _endBatchOnStores(): void {
    for (const store of this._stores) {
      try {
        store.endBatch()
      } catch {
        // 子 store 已被独立销毁：其订阅与状态已清理，跳过收尾
      }
    }
  }

  batch<T>(fn: () => T): T {
    this._ensureAlive('batch')
    this.startBatch()
    try {
      return fn()
    } finally {
      // fn 内可能已销毁组合 store：此时不能再走 endBatch 的销毁守卫
      // （守卫异常会掩盖 fn 的返回值/原始异常），但子 store 的批量深度
      // 仍需正确收尾（否则其通知被永久抑制）
      this._endBatchOnStores()
    }
  }

  // ==================== 快照管理 ====================

  $snapshot(): Readonly<S> {
    this._ensureAlive('$snapshot')
    if (this._namespace) {
      return this._mergeNamespaced((store) => store.$snapshot() as Record<string, unknown>) as Readonly<S>
    }
    // 非命名空间模式：与 getState 相同的冲突告警语义
    return this._mergeStateMaps((store) => store.$snapshot() as Record<string, unknown>) as Readonly<S>
  }

  $restore(snapshot: Readonly<S>): void {
    this._ensureAlive('$restore')
    dispatchByNamespace(this._stores, this._namespace, snapshot as Record<string, unknown>, this._strict, (store, value) =>
      store.$restore(value as Readonly<S>),
    )
  }
}

/**
 * Store组合函数 - 类型安全重载
 * 支持完整的类型推断，保留原始 Store 的类型信息
 */

// 类型推断版本：保留 Store 元组的完整类型信息
function composeStore<Stores extends readonly StoreLike[]>(
  stores: [...Stores],
  options?: ComposeOptions,
): Store<ExtractStates<Stores>, ExtractActions<Stores>, ExtractGetters<Stores>>

// 实现
// 注意：不提供第二个非泛型重载——多重重载下 TS 的推断会吸收 [...Stores] 的元素类型，
// 导致 ExtractStates 落回 Record<string, never>（返回类型退化为 never），仅保留泛型重载可完整提取
function composeStore(stores: StoreLike[], options: ComposeOptions = {}): Store<State, Actions, Getters<State>> {
  // 验证stores
  if (!Array.isArray(stores) || stores.length === 0) {
    throw new Error('[composeStore] stores must be a non-empty array')
  }

  // 创建 ComposedStore 类实例（性能优于对象字面量）
  const composedStore = new ComposedStore<State>(stores as Store[], options)

  return composedStore as unknown as Store<State, Actions, Getters<State>>
}

export { composeStore }

/**
 * 创建Store树
 */
export function createStoreTree(stores: Store[], options: ComposeOptions = {}): StoreTreeNode {
  const { namespace = '' } = options
  const children: Record<string, StoreTreeNode> = {}
  const root: StoreTreeNode = {
    name: typeof namespace === 'string' ? namespace || 'root' : 'root',
    store: null as Store | null,
    children,
  }

  for (const store of stores) {
    children[store.name] = {
      name: store.name,
      store,
      children: {},
    }
  }

  return root
}

/**
 * 导出 ComposedStore 类（供高级用户使用）
 */
export { ComposedStore }

/**
 * 默认导出
 */
export type { ComposeOptions, StoreTreeNode, NamespaceConfig } from '../../types/compose.js'
