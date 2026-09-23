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
import { defineOwnProperty } from '../utils/helpers.js'
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
  /** 当前活跃的订阅者：监听器 → 注册次数。
   *  与 SubscriptionManager 同语义——同一函数注册 N 次通知 N 次，退订只减一，
   *  减到 0 才真正移除。此前用 Set 会使「退订其中一份」直接删除整个监听器，
   *  用户仍持有的另一份退订句柄静默失效、永不再收到通知。
   *  值只存注册次数：可写份数由 _composedWritableCount 单点记账，
   *  按监听器再存一份既无读取方又要人工同步（原 writable 字段全库只写不读） */
  private _composedListeners: Map<StateListener<S>, number> = new Map()
  /** 可写（非只读）注册总次数：>0 时通知载荷必须是深拷贝（见 _notifyListeners 的隔离说明） */
  private _composedWritableCount = 0
  /** 对子 Store 的订阅句柄（destroy 时统一退订，避免闭包残留） */
  private _storeUnsubscribers: Array<() => void> = []
  /** 子 store 单路合并订阅是否已建立（构造期为缓存失效建立，组合层订阅复用，避免重复占额度） */
  private _childSubscriptionsReady: boolean = false
  /** 已告警过的 state 键冲突组合（每个组合只告警一次，避免高频 getState 刷屏） */
  private _warnedStateKeyConflicts = new Set<string>()
  /** 已按「空视图」读过的销毁子 store：每个子 store 只告警一次（WeakSet 不驻留死店） */
  private _warnedDestroyedChildren = new WeakSet<object>()
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

    // 路由键合法性校验：store.name 不只是个展示名，命名空间模式下它同时是
    // '/' 分隔路径的第一段（helpers.ts 的 findTargetStoreWithKey / parseActionName 都按
    // key.split('/') 取首段当 store 名）和普通对象键。Store.name 完全由用户传入
    // （Store.ts 只兜了「空值 → 自增名」，没有字符集校验），于是两类取值会静默出错：
    // - 含 '/'（如 createStore({ name: 'user/info' })）：路径 'user/info/count' 被解析成
    //   store 'user' + 键 'info/count'，该子店在 setState/getCached/dispatch/getter 上
    //   **永远路由不到**（非 strict 静默忽略、strict 抛「Cannot find store for key」），
    //   而 mergeNamespaced 又把整名当键写进合并视图 ⟹ 读得到、写不进；
    //   actions/getters 的映射键 `${store.name}/${actionName}` 同样解不开。
    // - 空串：路由首段为空，同理解析不出归属。
    // 判据与上面的重名校验同一条：命名空间模式下这属于「无法正确工作的配置错误」，直接抛；
    // 平铺模式 name 只是 stores 映射的键与告警文案、不参与路由，按 _mergeStateMaps 的既有
    // 口径在开发模式告警而非抛错。
    // 刻意**不**拒绝 '__proto__'：本仓既定判例是「store 名可合法为 '__proto__'」
    // （merge.ts 的 assignMerged 与 StoreRegistry.createSnapshot 都专门为此键写了
    // DefineOwnProperty 守卫），下面两处映射改用同一语义承载，而不是把这个名字判成非法。
    const unroutableNames: string[] = []
    for (const store of stores) {
      const storeName = store.name
      if (typeof storeName !== 'string' || storeName.length === 0 || storeName.includes('/')) {
        unroutableNames.push(String(storeName))
      }
    }
    if (unroutableNames.length > 0) {
      if (this._namespace) {
        throw new Error(
          `[composeStore] 命名空间模式下子 store 名称必须是「非空且不含 '/'」的路由键段，否则该子店永远无法被路由到: ${unroutableNames.join(', ')}。` +
            '请去掉名字里的斜杠（"storeName/key" 形式的路径按首段解析目标 store）',
        )
      }
      if (!isProduction()) {
        console.warn(
          `[composeStore] 子 store 名称不适合作为命名空间路由键 (${unroutableNames.join(', ')})：当前为平铺模式，name 只用于 stores 映射；` +
            '一旦启用 namespace，这些子 store 将无法被路由到',
        )
      }
    }

    // 构建 stores 引用。
    // 以 DefineOwnProperty 语义写入：`this.stores[store.name] = store` 走 [[Set]]，
    // name 为 '__proto__' 时触发 Object.prototype 的 setter —— 该条目不会成为自有键，
    // 而 this.stores 的原型被换成那个 Store 实例，于是 composed.stores.getState/destroy/state
    // 全部变成可调用（对外泄漏一整套 Store 方法），ownsNestedStore 的 hasOwnProperty 判定
    // （helpers.ts）同时为 false，嵌套路由静默失效
    for (const store of stores) {
      defineOwnProperty(this.stores as Record<string, Store>, store.name, store)
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
    // 后续读取退回每次重合并，避免失效订阅缺失导致缓存返回陈旧状态。
    // 降级必须留痕：吞掉异常后「订阅建立失败」与「本来就没建缓存」在外部完全同形，
    // 且该状态终身不可恢复（_mergedCacheEnabled 不会再置回 true），
    // 排查性能问题的人会看到一个没有任何解释的每次重合并
    try {
      this._ensureChildSubscriptions()
    } catch (error) {
      this._mergedCacheEnabled = false
      if (!isProduction()) {
        console.warn('[composeStore] 子 store 订阅建立失败，合并状态缓存已禁用，后续读取将退化为每次重合并：', error)
      }
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
      const current = this._childVersion(this._stores[i])
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
    return mergeNamespaced(this._stores, this._readablePick(pick), freeze)
  }

  /**
   * 「子 store 已被独立销毁」的统一判据：命中即按 store 去重告警一次，返回 true 表示调用方应跳过它。
   *
   * 读路径（`_readablePick`）与缓存 API（`enableCache` / `getCacheStats`）共用这一条，
   * 避免各处再各写一份 `store.destroyed` + WeakSet 而漂移成不同文案、不同次数。
   * 告警按 store 去重：这些调用点都在渲染 / setData 热线上被反复触发。
   */
  private _skipDestroyedChild(store: Store, note: string): boolean {
    if (!store.destroyed) {
      return false
    }
    if (!this._warnedDestroyedChildren.has(store)) {
      this._warnedDestroyedChildren.add(store)
      if (!isProduction()) {
        console.warn(`[composeStore] 子 store "${store.name}" 已销毁，${note}（其余子 store 不受影响）`)
      }
    }
    return true
  }

  /**
   * 读路径取值前的容错包装：子 store 可在组合之外被独立销毁，此时它的 `getState()` 会抛，
   * 于是**一个死店就让整棵组合读不出来**（集成层渲染/computed 热线直接崩），而同一时刻
   * `$patch` 却按「已销毁 → 跳过」正常写入其余子店——读写一侧崩一侧静默通过。
   *
   * 读侧采取与写侧相同的判据：该子 store 记为**空视图**并一次性告警，其余子 store 照常可读。
   * 三条读路径（`getState` 的裸引用 / `state` 的保护视图 / `$snapshot` 的深拷贝）都经此处，
   * 消除此前「getState 抛、state 返回死店视图（Store.state 无守卫）、$snapshot 又抛」的三方分叉。
   */
  private _readablePick(pick: (store: Store) => Record<string, unknown>): (store: Store) => Record<string, unknown> {
    return (store: Store) => {
      if (this._skipDestroyedChild(store, '读取按空视图处理')) {
        return {}
      }
      return pick(store)
    }
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
    return mergeStateMaps(this._stores, this._readablePick(pick), this._warnedStateKeyConflicts)
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
    this._cachedChildVersions = this._stores.map((store) => this._childVersion(store))
  }

  /**
   * 子 store 的合并缓存新鲜度判据：状态版本号，外加「是否已被独立销毁」这一维度。
   *
   * 销毁本身不推进版本号，只比版本号会让死店此前合并进缓存的键一直被当作新鲜数据读出来。
   * 哨兵取 -1：`getStateVersion` 返回的是单调非负计数，不会与它相等，故「活着 → 销毁」
   * 必然失配并触发重算（重算后该店按空视图并入）。
   */
  private _childVersion(store: Store): number | undefined {
    if (store.destroyed) {
      return -1
    }
    return getStateVersion(store.state)
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
      if (matches.length > 1 && !isProduction()) {
        // 歧义属配置问题，只在开发模式提示：dispatch 是业务热线，生产刷屏只会淹没真实日志
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
      // 鸭子类型兜底：接口把 getters 声明为必选，但组合层接受桩 store / 未实现该成员的
      // 同构 store（本文件 getter() 与 getGetterNames() 都按「无 getter」降级，构造期也用
      // `store.actions ?? {}`、`if (!childHooks) continue` 容错）。
      // 此前这里直接 Object.keys(store.getters) ⟹ getters 缺席时抛 TypeError，
      // 而 composed.getters 是 devtools / analyzer 的只读反射面（plugins/builtin.ts 同口径读形状），
      // 一条读取路径比写入路径更容易被一个桩 store 打崩
      const subGetters = store.getters
      if (!subGetters) {
        continue
      }
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
      // 接口把它声明为必选，但组合层接受鸭子类型/桩 store（同 getGetterNames() 与
      // plugins/builtin.ts 的口径），未实现时按「无 getter」降级，不让这条只读路径抛 TypeError
      const matches = this._stores.filter((s) => {
        const names = s.getGetterNames ? s.getGetterNames() : []
        return names.includes(actualGetter)
      })
      if (matches.length > 1 && !isProduction()) {
        // 歧义属配置问题，只在开发模式提示：命中路径在渲染/读取热线上，生产刷屏无处置价值
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
    // 迭代前快照「监听器 + 本轮投递次数」：既防止订阅者在回调中退订导致集合变更，
    // 也保证投递次数取的是进入本轮通知时的在册值——存数字而非可变的 entry 对象，
    // 回调内退订只会改写 Map，不会截断同一轮剩余的投递（与 SubscriptionManager.notify 的扁平快照同语义）
    const entries = [...this._composedListeners]
    this._notifying = true
    try {
      for (const [listener, times] of entries) {
        // 按注册次数展开：重复注册的监听器每次通知收到多次回调（与 SubscriptionManager 同语义）
        for (let i = 0; i < times; i++) {
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
      this._composedListeners.set(listener, existing + 1)
      if (!readOnly) {
        this._composedWritableCount += 1
      }
      return this._createUnsubscribe(listener, readOnly)
    }
    this._composedListeners.set(listener, 1)
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
   * 三个分支的口径不同，逐条说明（旧注释写着「始终返回 true」，与实现不符已有几轮）：
   * - 合并缓存订阅未建立（构造期订阅失败的降级态）：没有任何脏追踪可用，保守返回 true；
   * - 命名空间模式：组合状态键即子 store 名，`_dirtyStores` 能精确指出哪个子 store 变过，
   *   据此返回真/假——集成层因此可跳过未变化的映射键，省掉一次冗余 setData（含符号键：
   *   脏键表只按字符串子 store 名索引，符号键不可能命中，保守返回 true）；
   * - 非命名空间模式：状态键是各子 store 内部 key 的平铺，无法反查归属，保守返回 true。
   *
   * 「保守」的方向性始终是**宁多勿漏**：返回 true 只是多写一次 setData，
   * 误返回 false 会让变更对所有监听器永久不可见。对象值的整体替换另有引用比较兜底。
   *
   * @param key - 组合层状态键（命名空间模式下即子 store 名；集成层也可能传符号键）
   * @returns 该键自上次通知以来是否可能发生变更
   */
  isStateKeyDirty(key: string | symbol): boolean {
    // 合并缓存订阅未建立（降级场景）：无脏追踪，保守返回 true（不跳过 setData，避免丢失更新）
    if (!this._mergedCacheEnabled) {
      return true
    }
    // 命名空间模式：组合状态键即子 store 名，可精确追踪哪个子 store 变更，
    // 使集成层据此跳过未变化映射键的冗余 setData（恢复此前被恒 true 抑制的跳过优化）
    if (this._namespace) {
      // 脏键表按子 store 名（字符串）索引；命名空间模式下能被集成层传入的符号键
      // 不可能对应到某个子 store，落到「保守返回 true」这一侧，即不跳过任何 setData，
      // 与下面非命名空间分支同一取向
      return typeof key === 'string' ? this._dirtyStores.has(key) : true
    }
    // 非命名空间模式：状态键为子 store 内部 key 平铺，无法精确映射到脏子 store，
    // 保守返回 true（不跳过 setData），对象值整体替换仍由引用比较兜底
    return true
  }

  /** 创建幂等退订句柄：同一句柄重复调用只释放一次注册。
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
    const total = this._composedListeners.get(listener)
    if (total === undefined) {
      return
    }
    if (!readOnly) {
      this._composedWritableCount -= 1
    }
    if (total > 1) {
      this._composedListeners.set(listener, total - 1)
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

  /**
   * 为子 store 启用缓存：命名空间模式下按键前缀路由到归属 store
   *
   * 这组缓存 API 原先是组合层里唯一不做命名空间路由的一组，与同类方法自相矛盾：
   * `setState` / `getCached` / `invalidateCache` 都先过 `findTargetStoreWithKey` 解析
   * `storeName/key`，而 `enableCache` 把收到的键原样透传给**每一个**子 store，于是
   * 命名空间模式下 `enableCache(['user/profile'])` 在子 store 上匹配不到任何键
   * （子店只认裸键 `profile`）⟹ 缓存静默不生效；不写前缀的 `enableCache(['profile'])`
   * 又会在所有含 `profile` 键的子 store 上同时开启 ⟹ 越权开启调用方从未点名的 store。
   * 现在解析方向与读侧一致：带前缀的键只投递给归属 store，无归属键按 strict 口径处理。
   * 平铺模式保持「广播给各子店」——子 store 只缓存自己拥有的键，多店同名键的歧义
   * 由 `mergeStateMaps` / `findTargetStoreWithKey` 的既有开发模式告警覆盖。
   */
  enableCache(keys?: Array<keyof S>): void {
    this._ensureAlive('enableCache')

    // 未指定键 = 「每个子 store 缓存它自己的全部顶层键」，没有需要路由的键
    if (!this._namespace || keys === undefined) {
      for (const store of this._stores) {
        if (this._skipDestroyedChild(store, '跳过对它的缓存启用')) {
          continue
        }
        // 子 store 的泛型与组合后的 S 不同构，键集合仅在运行时传递，此处断言安全
        store.enableCache(keys as Array<keyof State> | undefined)
      }
      return
    }

    const grouped = new Map<Store, Array<keyof State>>()
    const unowned: string[] = []
    for (const key of keys) {
      const keyStr = String(key)
      const [targetStore, actualKey] = findTargetStoreWithKey(keyStr, this._stores, this._namespace)
      if (!targetStore) {
        unowned.push(keyStr)
        continue
      }
      const bucket = grouped.get(targetStore)
      if (bucket) {
        bucket.push(actualKey as keyof State)
      } else {
        grouped.set(targetStore, [actualKey as keyof State])
      }
    }

    if (unowned.length > 0) {
      if (this._strict) {
        throw new Error(`[composeStore] Cannot find store for key: ${unowned.join(', ')}`)
      }
      if (!isProduction()) {
        console.warn(`[composeStore] enableCache 收到不属于任何子 store 的键 [${unowned.join(', ')}]（命名空间模式需要 "storeName/key" 形式），已忽略`)
      }
    }

    for (const [store, storeKeys] of grouped) {
      if (this._skipDestroyedChild(store, '跳过对它的缓存启用')) {
        continue
      }
      store.enableCache(storeKeys)
    }
  }

  disableCache(): void {
    this._ensureAlive('disableCache')
    for (const store of this._stores) {
      if (this._skipDestroyedChild(store, '跳过对它的缓存关闭')) {
        continue
      }
      store.disableCache()
    }
  }

  invalidateCache<K extends keyof S>(key?: K): void {
    this._ensureAlive('invalidateCache')
    if (key !== undefined) {
      const keyStr = String(key)
      const [targetStore, actualKey] = findTargetStoreWithKey(keyStr, this._stores, this._namespace)
      if (targetStore) {
        if (this._skipDestroyedChild(targetStore, '跳过对它的缓存失效')) {
          return
        }
        targetStore.invalidateCache(actualKey as never)
      } else if (this._strict) {
        throw new Error(`[composeStore] Cannot find store for key: ${keyStr}`)
      }
    } else {
      for (const store of this._stores) {
        if (this._skipDestroyedChild(store, '跳过对它的缓存失效')) {
          continue
        }
        store.invalidateCache()
      }
    }
  }

  /**
   * 聚合各子 store 的缓存统计。
   *
   * `keys` 是**组合层可直接使用**的键列表（拿它去调 `getCached` / `invalidateCache` 必须能打中），
   * 因此命名空间模式下回填 `storeName/key` 形式：此前这里把各子店的本地裸键原样拼进来，
   * 与 `getCached` 的入参形状不同构，于是
   * `composed.getCached(composed.getCacheStats().keys[0])` 在命名空间模式下恒为 undefined。
   * 平铺模式下多店同名键会在子店列表里重复，而合并视图只有这一个键 ⟹ 按键去重
   * （命中数属于哪个店仍看不出来，这是平铺模式歧义配置的既有代价，与 hits/misses 的累加口径一致）。
   */
  getCacheStats(): CacheStats {
    this._ensureAlive('getCacheStats')
    const stats: CacheStats = {
      enabled: false,
      size: 0,
      keys: [],
      hits: 0,
      misses: 0,
    }
    const seenKeys = new Set<string>()

    for (const store of this._stores) {
      // 已销毁的子店 getCacheStats() 会抛：与三条读路径同口径跳过并告警一次
      if (this._skipDestroyedChild(store, '跳过它的缓存统计')) {
        continue
      }
      const storeStats = store.getCacheStats()
      stats.enabled = stats.enabled || storeStats.enabled
      stats.size += storeStats.size
      for (const key of storeStats.keys) {
        const composedKey = this._namespace ? `${store.name}/${key}` : key
        if (seenKeys.has(composedKey)) {
          continue
        }
        seenKeys.add(composedKey)
        stats.keys.push(composedKey)
      }
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
    // DefineOwnProperty 语义（与本文件 stores 映射、merge.ts 的 assignMerged 同一判据）：
    // `children[store.name] = …` 走 [[Set]]，name 为 '__proto__' 时不会成为自有键，
    // 却把 children 的原型换成那个 Store 实例 —— 树节点因此对外泄漏一整套 Store 方法
    defineOwnProperty(children, store.name, {
      name: store.name,
      store,
      children: {},
    })
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
