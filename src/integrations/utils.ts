/**
 * GeomStore - 微信小程序集成工具
 *
 * 提供 Store 与微信小程序集成的共享工具函数
 *
 */

import type { Store, State } from '../types/store.js'

/**
 * 解析映射配置，返回统一的键值对映射
 *
 * 支持数组形式和对象形式的映射配置：
 * - 数组: ['key1', 'key2'] → { key1: 'key1', key2: 'key2' }
 * - 对象: { local: 'store' } → { local: 'store' }
 *
 * 键与值均经 String() 归一（类型层面接受 PropertyKey，实际状态键均为字符串）
 *
 * @param mapping - 映射配置（数组或对象）
 * @returns 统一格式的键值对映射（新建对象，与入参不共享引用）
 *
 * @example
 * ```typescript
 * // 数组形式
 * parseMapping(['count', 'name'])
 * // → { count: 'count', name: 'name' }
 *
 * // 对象形式（别名映射）
 * parseMapping({ totalCount: 'count', userName: 'name' })
 * // → { totalCount: 'count', userName: 'name' }
 * ```
 */
export function parseMapping(mapping: ReadonlyArray<PropertyKey> | Record<string, PropertyKey>): Record<string, string> {
  // 两个分支统一走一次归一化后返回新对象：
  // 对象分支此前直接 `as Record<string, string>` 强转并返回入参本身，
  // 数字/符号值仍按原始类型流向 storeKey 查表（符号键查不到状态），
  // 且调用方对返回值的任何写入会回灌用户的配置对象
  const result: Record<string, string> = {}
  if (Array.isArray(mapping)) {
    // 赋值累积而非 `{ ...acc }` 展开：展开每次重建累积器，整体 O(n²)
    for (const key of mapping) {
      const normalized = String(key)
      setOwnEntry(result, normalized, normalized)
    }
    return result
  }
  for (const [key, value] of Object.entries(mapping)) {
    setOwnEntry(result, key, String(value))
  }
  return result
}

/**
 * 以自有数据属性写入映射项。
 *
 * 映射键来自调用方配置，`'__proto__'` 用普通赋值会命中 Object.prototype 的 setter
 * 改坏结果对象的原型链（而非落下该键），故统一用 defineProperty 写入
 */
function setOwnEntry(target: Record<string, string>, key: string, value: string): void {
  Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
}

/** ConnectOptions 中参与解析的四类映射字段（结构类型，避免耦合具体泛型） */
interface MappableOptions {
  mapState?: ReadonlyArray<PropertyKey> | Record<string, PropertyKey>
  mapGetters?: ReadonlyArray<PropertyKey> | Record<string, PropertyKey>
  mapActions?: ReadonlyArray<PropertyKey> | Record<string, PropertyKey>
  injectMapping?: Record<string, string>
}

/**
 * 解析 ConnectOptions 的四类映射（未提供则为空对象）。
 *
 * withPageStore / withComponentStore / withAppStore 三个集成入口共用，
 * 避免同一「mapState/mapGetters/mapActions/injectMapping 解析」块各写一遍。
 */
export function resolveMappings(options: MappableOptions): {
  stateMapping: Record<string, string>
  gettersMapping: Record<string, string>
  actionsMapping: Record<string, string>
  injectMapping: Record<string, string>
} {
  return {
    stateMapping: options.mapState ? parseMapping(options.mapState) : {},
    gettersMapping: options.mapGetters ? parseMapping(options.mapGetters) : {},
    actionsMapping: options.mapActions ? parseMapping(options.mapActions) : {},
    injectMapping: options.injectMapping || {},
  }
}

/** 生成绑定到 store 的订阅函数（readOnly 透传），供 Page/Component/App 集成共用 */
export function createStoreSubscriber<S extends State>(store: Store<S>): (callback: () => void, subscribeOptions?: { readOnly?: boolean }) => () => void {
  return (callback: () => void, subscribeOptions?: { readOnly?: boolean }) => store.subscribe(callback, subscribeOptions)
}

/**
 * 绑定状态映射到目标对象
 *
 * 将 Store 的状态或 getters 映射到 Page/Component/App 实例，
 * 并自动订阅变化以实现双向同步。
 *
 * 所有映射的更新合并为一次批量 setter 调用：小程序 setData 调用开销较大，
 * 逐键调用会引发 N 次视图更新，合并后仅需一次。
 *
 * @template S - 状态类型
 * @param _target - 目标对象（Page/Component/App 实例）
 * @param mappings - 映射关系（本地键 → Store键）
 * @param getValue - 获取 Store 值的函数
 * @param setter - 批量设置本地值的函数（接收全部映射键的更新对象）
 * @param subscribeStore - 订阅 Store 变化的函数
 * @returns 取消绑定函数数组
 *
 * @example
 * ```typescript
 * const unbinds = bindMappings(
 *   pageInstance,
 *   { count: 'counter', name: 'userName' },
 *   (storeKey) => store.state[storeKey],
 *   (updates) => pageInstance.setData(updates),
 *   (callback) => store.subscribe(callback)
 * )
 * ```
 */
export function bindMappings(
  _target: unknown,
  mappings: Record<string, string>,
  getValue: (storeKey: string) => unknown,
  setter: (updates: Record<string, unknown>) => void,
  subscribeStore: (callback: () => void, options?: { readOnly?: boolean }) => () => void,
  /** 判断某状态键自上次通知以来是否变更（仅 state 映射可传入；getters 不提供，缺失时对象值保持「宁多勿漏」始终发送） */
  changedKeys?: (storeKey: string) => boolean,
): Array<() => void> {
  const entries = Object.entries(mappings)
  const unbinds: Array<() => void> = []

  if (entries.length === 0) {
    return unbinds
  }

  // 记录上一次各映射键的值，用于跳过无变化的 setData。
  // 小程序 setData 开销较大，即使 store 变化与本地映射无关也应避免无谓的视图更新
  const prevValues: Record<string, unknown> = {}
  for (const [localKey, storeKey] of entries) {
    prevValues[localKey] = getValue(storeKey)
  }

  // 合并所有映射的更新为一次批量 setter 调用，仅在确有变化时才触发
  const updateAll = () => {
    const updates: Record<string, unknown> = {}
    let changed = false
    for (const [localKey, storeKey] of entries) {
      const next = getValue(storeKey)
      const isObjectValue = next !== null && typeof next === 'object'
      let include: boolean
      if (isObjectValue) {
        // 对象值：引用未变且本批次该键未被标记为变更 → 视为未变化，跳过该键的 setData，
        // 避免对大体量对象（如列表）在无关 state 变更时反复整包下发。
        // changedKeys 仅对 state 映射可用（getters 不提供），缺失时保持「宁多勿漏」始终发送；
        // 引用已变（如 setState/$replaceState 整体替换）必发送，覆盖整包替换场景。
        const dirty = changedKeys ? changedKeys(storeKey) : true
        include = !(next === prevValues[localKey] && !dirty)
      } else {
        // 原始值走引用/NaN 比较
        include = !safeEqual(next, prevValues[localKey])
      }
      if (include) {
        prevValues[localKey] = next
        // 过滤 undefined：微信 setData 不接受 undefined 值（报错且字段不生效），
        // 清除字段应使用 null
        if (next !== undefined) {
          updates[localKey] = next
          changed = true
        }
      }
    }
    if (changed) {
      setter(updates)
    }
  }

  // 立即设置初始值（过滤 undefined，理由同 updateAll）
  const initialValues: Record<string, unknown> = {}
  for (const [localKey] of entries) {
    if (prevValues[localKey] !== undefined) {
      initialValues[localKey] = prevValues[localKey]
    }
  }
  setter(initialValues)

  // 订阅 Store 变化（单个订阅覆盖全部映射，进一步减少回调数）
  // 标记只读：updateAll 只读取状态写入 data，从不修改载荷，
  // 使 Store 走零拷贝路径（传只读保护 Proxy），避免每次通知的整树深拷贝
  const unsubscribe = subscribeStore(() => updateAll(), { readOnly: true })
  unbinds.push(unsubscribe)

  return unbinds
}

/**
 * 原始值比较：处理 NaN 与引用相等。
 *
 * 仅用于原始值的脏检查；对象值在 updateAll 中不做比较、始终纳入更新
 * （$patch 原地深合并后引用不变，引用比较无法感知内部变化）。
 *
 * @param a - 旧值
 * @param b - 新值
 * @returns 是否相等
 */
function safeEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  // NaN !== NaN，但视为相等
  return typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)
}

/**
 * 绑定 Actions 到目标实例
 *
 * 将 Store 的 actions 绑定到 Page/Component/App 实例方法
 *
 * @template S - 状态类型
 * @param target - 目标实例
 * @param mappings - 映射关系（本地方法名 → Action名）
 * @param store - Store 实例
 * @returns 取消绑定函数数组
 */
export function bindActions<S extends State = State>(target: Record<string, unknown>, mappings: Record<string, string>, store: Store<S>): Array<() => void> {
  const unbinds: Array<() => void> = []

  Object.entries(mappings).forEach(([localName, actionName]) => {
    // 以自有属性写入而非 `target[localName] = ...`：后者遇到 '__proto__'/'constructor'
    // 这类键会沿原型链写入（污染宿主构造器），也无法在解绑时恢复被覆盖的原成员
    const hadExisting = Object.prototype.hasOwnProperty.call(target, localName)
    const original = hadExisting ? target[localName] : undefined
    if (hadExisting) {
      console.warn(`[bindActions] 宿主已有成员 "${localName}"，将被 action "${actionName}" 覆盖，解绑时恢复原值`)
    }

    Object.defineProperty(target, localName, {
      value: (...args: unknown[]) => store.dispatch(actionName, ...args),
      writable: true,
      enumerable: true,
      configurable: true,
    })

    unbinds.push(() => {
      if (hadExisting) {
        Object.defineProperty(target, localName, {
          value: original,
          writable: true,
          enumerable: true,
          configurable: true,
        })
      } else {
        delete target[localName]
      }
    })
  })

  return unbinds
}

/**
 * 自动注入 Store 值到目标对象
 *
 * 根据注入映射，将 Store 缓存的值自动注入到目标对象。
 * 无缓存（含值本身为 undefined）的源键不注入并汇总告警：Store 只暴露 getCached、
 * 未提供 hasCached，无法区分「未缓存」与「值确为 undefined」，
 * 静默跳过会让宿主数据与注入映射长期不一致且无从排查
 *
 * @template S - 状态类型
 * @param target - 目标对象
 * @param injectMapping - 注入映射（源键 → 目标键）
 * @param store - Store 实例
 * @param setter - 设置值的函数
 *
 * @example
 * ```typescript
 * performAutoInject(
 *   pageInstance,
 *   { userInfo: 'user', config: 'appConfig' },
 *   store,
 *   (key, value) => pageInstance.setData({ [key]: value })
 * )
 * ```
 */
export function performAutoInject<S extends State = State>(
  _target: unknown,
  injectMapping: Record<string, string>,
  store: Store<S>,
  setter: (updates: Record<string, unknown>) => void,
): void {
  if (!injectMapping || Object.keys(injectMapping).length === 0) {
    return
  }

  const updates: Record<string, unknown> = {}
  const skipped: string[] = []

  for (const [sourceKey, targetKey] of Object.entries(injectMapping)) {
    const value = store.getCached(sourceKey as keyof S)
    if (value === undefined) {
      skipped.push(sourceKey)
      continue
    }
    updates[targetKey] = value
  }

  if (skipped.length > 0) {
    console.warn(`[performAutoInject] 以下注入源无缓存值，已跳过注入: ${skipped.join(', ')}`)
  }

  // 批量调用 setter，避免多次触发更新
  if (Object.keys(updates).length > 0) {
    setter(updates)
  }
}

/**
 * 暴露 Store API 到目标实例
 *
 * 在 App 实例上暴露常用的 Store API 方法，同时挂一份到 `__store__` 调试入口。
 * 返回的清理函数只移除本次新增的成员，宿主同名自有成员按原值还原
 *
 * @template S - 状态类型
 * @param target - 目标实例（通常是 App 实例）
 * @param store - Store 实例
 * @returns 取消暴露函数
 *
 * @example
 * ```typescript
 * exposeStoreAPI(appInstance, store)
 * // 现在可以通过 appInstance.getStore() 访问 Store
 * ```
 */
export function exposeStoreAPI<S extends State = State>(target: Record<string, unknown>, store: Store<S>): () => void {
  // 五个调试方法只定义一次，同时挂到 target 与 target.__store__：
  // 此前两处各写一份字面量，后续改动极易只改一处导致两个入口行为分叉
  const api = {
    getStore: () => store,
    getState: () => store.getState(),
    getCached: (key: keyof S) => store.getCached(key),
    dispatch: (actionName: string, ...args: unknown[]) => {
      return store.dispatch(actionName, ...args)
    },
    // 默认按只读订阅注册：宿主侧 subscribe 用于观察状态、从不修改载荷。
    // 若以可写订阅登记，会翻转 Store 的全局 needsClone 判定，
    // 让 persistence/logger 等只读订阅者一并承担每次通知的整树深拷贝。
    // 确需就地改载荷的调用方显式传 { readOnly: false }
    subscribe: (callback: (state: S) => void, options?: { readOnly?: boolean }) => {
      return store.subscribe(callback, options ?? { readOnly: true })
    },
  }

  const exposedKeys = ['store', 'getStore', 'getState', 'getCached', 'dispatch', 'subscribe', '__store__'] as const
  // 记录调用前已存在的自有成员：一律 delete 会把宿主自己定义的 getState 等一并抹掉
  const originals = new Map<string, unknown>()
  for (const key of exposedKeys) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      originals.set(key, target[key])
    }
  }

  target.store = store
  Object.assign(target, api)
  target.__store__ = api

  // 返回取消暴露函数：本次新增的删除，宿主原有的还原
  return () => {
    for (const key of exposedKeys) {
      if (originals.has(key)) {
        target[key] = originals.get(key)
      } else {
        delete target[key]
      }
    }
  }
}

/**
 * 清理所有绑定
 *
 * 执行所有取消绑定函数，清理订阅和引用
 *
 * @param unbinds - 取消绑定函数数组
 */
export function cleanupBindings(unbinds: Array<() => void>): void {
  unbinds.forEach((unbind) => {
    try {
      unbind()
    } catch (error) {
      console.warn('[GeomStore] Error during cleanup:', error)
    }
  })
  unbinds.length = 0
}

// 原先的默认导出对象（parseMapping/bindMappings/…）全仓 0 使用，已删除；
// 需要的入口请使用具名导入（见 integrations/index.js）
