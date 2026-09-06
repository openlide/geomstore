/**
 * GeomStore - Store组合
 *
 * 优化：
 * - 使用类实例替代对象字面量，提升性能
 * - 订阅通知使用防抖机制，避免短时间内多次触发
 */

import type { Store, State, Actions, Getters, StateListener, CacheStats, InferGetterReturn } from '../../types/store'
import type { Plugin, HookName } from '../../types/plugin'
import type { ComposeOptions, StoreTreeNode, StoreLike, ExtractStates, ExtractActions, ExtractGetters } from '../../types/compose'
import { HookSystem } from '../hooks/index'
import { isProduction } from '../store/utils'

/** 全部生命周期钩子名：组合层桥接子 Store 钩子时逐个转发 */
const ALL_HOOK_NAMES: HookName[] = [
  'beforeSetState',
  'afterSetState',
  'beforePatch',
  'afterPatch',
  'beforeDispatch',
  'afterDispatch',
  'beforeReplaceState',
  'afterReplaceState',
  'onError',
]

/**
 * 对子 store 应用写入，跳过已被独立销毁的子 store
 *
 * 子 store 可在组合之外被独立销毁，此时 $patch/$replaceState 会抛
 * "Cannot call … on a destroyed Store"。此前该异常直接冒泡使循环中断在中间：
 * 已处理的 store 写入了、之后的 store 永不写入——既没保住一致性又抛了错，
 * 交付的是调用方无法解释的半更新状态。
 *
 * 跳过口径与 _startBatchOnStores / _endBatchOnStores / 企业版 runForegroundChecks
 * 三处一致（均为「子 store 可被独立销毁 → 跳过」）。不受 strict 影响：
 * strict 的既有语义是「访问不存在的 Store 报错」，而「存在但已销毁」是另一种故障，
 * 混进去会让 strict 模式重新产生半更新。
 *
 * @private
 */
function applyToStore<T>(store: Store, value: T, handler: (store: Store, value: T) => void): void {
  if (store.destroyed) {
    if (!isProduction()) {
      console.warn(`[composeStore] 子 store "${store.name}" 已销毁，跳过对它的写入（其余 store 不受影响）`)
    }
    return
  }
  try {
    handler(store, value)
  } catch (error) {
    // 只吞「判断之后才被销毁」的竞态；其他异常照常冒泡，不掩盖真实故障
    if (store.destroyed) {
      if (!isProduction()) {
        console.warn(`[composeStore] 子 store "${store.name}" 在写入期间被销毁，已跳过`)
      }
      return
    }
    throw error
  }
}

/**
 * 根据命名空间分发操作到对应 store
 * @private
 */
function dispatchByNamespace<T>(
  stores: Store[],
  namespace: string | boolean | undefined,
  data: Record<string, T>,
  strict: boolean,
  handler: (store: Store, value: T) => void,
  options?: { warnMissingKeys?: boolean },
): void {
  if (namespace) {
    // 命名空间模式：每个顶层键是一个 store
    for (const key in data) {
      const value = data[key]
      const targetStore = stores.find((s) => s.name === key)
      if (targetStore) {
        applyToStore(targetStore, value as T, handler)
      } else if (strict) {
        throw new Error(`[composeStore] Cannot find store for key: ${key}`)
      }
    }
  } else {
    // 非命名空间模式：需要先分组
    const storeGroups = new Map<Store, Record<string, T>>()

    for (const key in data) {
      const value = data[key]
      const targetStore = findTargetStore(key, stores, namespace)
      if (targetStore) {
        let group = storeGroups.get(targetStore)
        if (!group) {
          group = {}
          storeGroups.set(targetStore, group)
        }
        group[key] = value
      } else if (strict) {
        throw new Error(`[composeStore] Cannot find store for key: ${key}`)
      }
    }

    // 一次性调用每个 store
    for (const [store, groupData] of storeGroups) {
      // $replaceState 整体替换语义下，分组数据缺失会丢失 store 中的既有键，
      // 开发模式下告警提示（保留替换语义不变，避免破坏既有行为）。
      // 已销毁的子 store 会被 applyToStore 跳过，为它输出该告警是误导性噪音
      if (!store.destroyed && options?.warnMissingKeys) {
        const stateKeys = Object.keys(store.getState())
        const providedKeys = Object.keys(groupData)
        const missing = stateKeys.filter((k) => !providedKeys.includes(k))
        if (missing.length > 0) {
          console.warn(`[composeStore] $replaceState 未包含 store "${store.name}" 的键 [${missing.join(', ')}]，整体替换后这些键将丢失；如需保留请使用 $patch`)
        }
      }
      applyToStore(store, groupData as T, handler)
    }
  }
}

/**
 * 查找目标store并提取实际的键
 *
 * 修复：非命名空间模式下，如果多个 store 包含相同的 key，
 * 抛出错误以避免非确定性行为
 */
function findTargetStoreWithKey(key: string, stores: Store[], namespace?: string | boolean): [Store | undefined, string] {
  if (namespace) {
    // 命名空间模式：key = storeName/actualKey
    const parts = key.split('/')
    const storeName = parts[0]
    const actualKey = parts.slice(1).join('/') // 支持多级路径
    // key 不含 "/" 时视为未找到目标（由调用方按 strict 抛错或忽略），
    // 避免在子 store 上写入空字符串键
    if (!actualKey) {
      return [undefined, key]
    }
    const targetStore = stores.find((s) => s.name === storeName)
    return [targetStore, actualKey]
  } else {
    // 非命名空间模式：直接查找
    // 修复：检查是否有多个 store 包含相同的 key，避免非确定性行为
    const matchingStores = stores.filter((s) => {
      const state = s.getState()
      // own property 判定：`in` 会命中 Object 原型链（'toString'/'constructor' 等），
      // 导致原型链属性名被误判为所有 store 都匹配并写入第一个 store
      return Object.prototype.hasOwnProperty.call(state, key)
    })

    if (matchingStores.length > 1) {
      console.warn(
        `[composeStore] Ambiguous key "${key}" found in multiple stores: ${matchingStores.map((s) => s.name).join(', ')}. ` +
          `Consider using namespaced mode for disambiguation.`,
      )
    }

    return [matchingStores[0], key]
  }
}

/**
 * 查找目标store
 */
function findTargetStore(key: string, stores: Store[], namespace?: string | boolean): Store | undefined {
  const [store] = findTargetStoreWithKey(key, stores, namespace)
  return store
}

/**
 * 解析action名称
 */
function parseActionName(fullName: string, namespace?: string | boolean): [string, string] {
  if (namespace) {
    const parts = fullName.split('/')
    // 支持多级路径（如 store/a/b）：首段为 store 名，其余段合并为成员名，
    // 避免三级及以上路径静默落入裸名查找而失败
    if (parts.length >= 2) {
      return [parts[0], parts.slice(1).join('/')]
    }
  }
  // 如果没有命名空间，尝试从stores中查找
  return ['', fullName]
}

/**
 * ComposedStore 类
 *
 * 组合多个 Store 为一个统一的 Store 实例
 * 使用类替代对象字面量，提供更好的性能和方法查找效率
 */
class ComposedStore<S extends State = State> implements Store<S> {
  readonly name: string
  readonly actions: Record<string, (...args: unknown[]) => unknown> = {}

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
   *  用户仍持有的另一份退订句柄静默失效、永不再收到通知。 */
  private _composedListeners: Map<StateListener<S>, number> = new Map()
  /** 对子 Store 的订阅句柄（destroy 时统一退订，避免闭包残留） */
  private _storeUnsubscribers: Array<() => void> = []
  /** 子 store 单路合并订阅是否已建立（构造期为缓存失效建立，组合层订阅复用，避免重复占额度） */
  private _childSubscriptionsReady: boolean = false
  /** 已告警过的 state 键冲突组合（每个组合只告警一次，避免高频 getState 刷屏） */
  private _warnedStateKeyConflicts = new Set<string>()
  /** 子 Store 钩子桥接的退订函数（destroy 时统一移除，防止闭包残留） */
  private _hookUnsubscribers: Array<() => void> = []
  /** 合并状态缓存：非命名空间/命名空间两种读取形态各缓存一份，子 store 变化时失效 */
  private _mergedCache: Record<string, unknown> | null = null
  /** 只读冻结形态的合并状态缓存（对应 state getter），与 _mergedCache 独立以免冻结影响 getState 消费者 */
  private _mergedCacheFrozen: Record<string, unknown> | null = null
  /** 合并缓存是否启用：子 store 订阅失效回调建立失败时降级为每次读取重合并，保证不返回陈旧状态 */
  private _mergedCacheEnabled: boolean = true
  /** 合并缓存失效订阅句柄（构造期对子 store 建立，destroy 时统一退订） */
  private _cacheInvalidateUnsubscribers: Array<() => void> = []

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
          store.subscribe(() => {
            this._invalidateMergedCache()
            this._scheduleNotify()
          }),
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

  getState(): S {
    this._ensureAlive('getState')
    if (this._namespace) {
      if (!this._mergedCacheEnabled) {
        const result: Record<string, unknown> = {}
        for (const store of this._stores) {
          result[store.name] = store.getState()
        }
        return result as S
      }
      if (!this._mergedCache) {
        const result: Record<string, unknown> = {}
        for (const store of this._stores) {
          result[store.name] = store.getState()
        }
        this._mergedCache = result
      }
      return this._mergedCache as S
    }
    if (!this._mergedCacheEnabled) {
      return this._mergeStateMaps((store) => store.getState() as Record<string, unknown>) as S
    }
    if (!this._mergedCache) {
      this._mergedCache = this._mergeStateMaps((store) => store.getState() as Record<string, unknown>)
    }
    return this._mergedCache as S
  }

  /**
   * 非命名空间模式下平铺合并各 store 的 state 键。
   *
   * 同名键后者覆盖前者，与 action/getter 冲突的处理一致（取第一个/最后一个并提示）：
   * 至少在开发模式下给出冲突告警，避免覆盖关系静默发生、排查困难。
   *
   * @private
   */
  private _mergeStateMaps(pick: (store: Store) => Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const keyOwners = isProduction() ? undefined : new Map<string, string>()
    for (const store of this._stores) {
      const source = pick(store)
      for (const key of Object.keys(source)) {
        if (keyOwners) {
          const previousOwner = keyOwners.get(key)
          if (previousOwner !== undefined && previousOwner !== store.name) {
            // 每个冲突组合只告警一次：getState/state 高频读取（渲染/computed）下
            // 重复告警会刷屏并带来每次调用的 Map 构建开销
            const conflictKey = `${key}(${previousOwner},${store.name})`
            if (!this._warnedStateKeyConflicts.has(conflictKey)) {
              this._warnedStateKeyConflicts.add(conflictKey)
              console.warn(
                `[composeStore] State key "${key}" exists in multiple stores (${previousOwner}, ${store.name}); ` +
                  `"${store.name}" wins in merged state/snapshot. Consider using namespaced mode for disambiguation.`,
              )
            }
          } else {
            keyOwners.set(key, store.name)
          }
        }
        result[key] = source[key]
      }
    }
    return result
  }

  get state(): S {
    this._ensureAlive('state')
    if (this._namespace) {
      if (!this._mergedCacheEnabled) {
        const result: Record<string, unknown> = {}
        for (const store of this._stores) {
          result[store.name] = store.state
        }
        return Object.freeze(result) as S
      }
      if (!this._mergedCacheFrozen) {
        const result: Record<string, unknown> = {}
        for (const store of this._stores) {
          result[store.name] = store.state
        }
        this._mergedCacheFrozen = Object.freeze(result)
      }
      return this._mergedCacheFrozen as S
    }
    // 取值源用子 store 的保护视图（store.state）而非内部裸引用（getState）：
    // 顶层写入落在冻结容器上会抛错；嵌套写入被子 store 保护代理拦截。
    // 此前直接合并裸引用，composed.state.nested.x = 1 会静默穿透进子 store 内部状态
    if (!this._mergedCacheEnabled) {
      return Object.freeze(this._mergeStateMaps((store) => store.state as unknown as Record<string, unknown>)) as S
    }
    if (!this._mergedCacheFrozen) {
      this._mergedCacheFrozen = Object.freeze(this._mergeStateMaps((store) => store.state as unknown as Record<string, unknown>))
    }
    return this._mergedCacheFrozen as S
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
    const state = this.getState()
    // 迭代前快照，防止订阅者在回调中退订导致集合变更
    const entries = [...this._composedListeners]
    for (const [listener, count] of entries) {
      // 按注册次数展开：重复注册的监听器每次通知收到多次回调（与 SubscriptionManager 同语义）
      for (let i = 0; i < count; i++) {
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

  subscribe(listener: StateListener<S>): () => void {
    this._ensureAlive('subscribe')

    // 重复订阅只递增计数：与 SubscriptionManager.add 一致，
    // 不参与子 store 订阅的建立（子 store 侧本就单路复用一份）
    const existingCount = this._composedListeners.get(listener)
    if (existingCount !== undefined) {
      this._composedListeners.set(listener, existingCount + 1)
      return () => this._releaseListener(listener)
    }
    this._composedListeners.set(listener, 1)

    // 单路复用：首个组合层监听器进入时对每个子 store 只建一份订阅（与构造期缓存失效
    // 订阅共用同一条，不重复占额度）。此前每个监听器都重复订阅全部子 store，N 个监听器
    // 占用 N 份/子store 的订阅额度，超出子 store maxSubscribers 时会静默驱逐应用直连的订阅者
    try {
      this._ensureChildSubscriptions()
    } catch (error) {
      // 子 store 订阅失败（如已被独立销毁）：回滚已入集合的监听器，
      // 避免监听器收不到通知、也无法退订的半订阅状态
      this._composedListeners.delete(listener)
      throw error
    }

    // 与普通 Store.subscribe 保持一致：订阅时不立即回调，
    // 仅在子 store 状态变化时通知，避免带副作用的监听器在订阅时被意外执行

    return () => this._releaseListener(listener)
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
  isStateKeyDirty(_key: string): boolean {
    return true
  }

  /** 释放一份监听器注册：减到 0 才移除，并在无剩余监听器时撤销子 store 订阅 */
  private _releaseListener(listener: StateListener<S>): void {
    const count = this._composedListeners.get(listener)
    if (count === undefined) {
      return
    }
    if (count > 1) {
      this._composedListeners.set(listener, count - 1)
      return
    }
    this._composedListeners.delete(listener)
    // 最后一个监听器退订时撤销对子 store 的订阅，释放子 store 的订阅额度
    if (this._composedListeners.size === 0 && this._storeUnsubscribers.length > 0) {
      for (const unsubscribe of this._storeUnsubscribers) {
        unsubscribe()
      }
      this._storeUnsubscribers = []
    }
  }

  // ==================== 插件管理 ====================

  use(plugin: Plugin): () => void {
    this._ensureAlive('use')
    const uninstalls: Array<() => void> = []

    for (const store of this._stores) {
      let uninstall: unknown
      try {
        uninstall = store.use(plugin)
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
    for (const off of this._cacheInvalidateUnsubscribers) {
      off()
    }
    this._cacheInvalidateUnsubscribers = []
    if (destroyStores) {
      for (const store of this._stores) {
        store.destroy()
      }
    }
    this._composedListeners.clear()
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
      const result: Record<string, unknown> = {}
      for (const store of this._stores) {
        result[store.name] = store.$snapshot()
      }
      return result as Readonly<S>
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
export type { ComposeOptions, StoreTreeNode, NamespaceConfig } from '../../types/compose'
