/**
 * GeomStore v1.0.0 - 微信小程序集成工具
 *
 * 提供 Store 与微信小程序集成的共享工具函数
 *
 * @since 1.0.0
 */

import type { Store, State } from '../types/store'

/**
 * 解析映射配置，返回统一的键值对映射
 *
 * 支持数组形式和对象形式的映射配置：
 * - 数组: ['key1', 'key2'] → { key1: 'key1', key2: 'key2' }
 * - 对象: { local: 'store' } → { local: 'store' }
 *
 * 键经 String() 归一（类型层面接受 PropertyKey，实际状态键均为字符串）
 *
 * @param mapping - 映射配置（数组或对象）
 * @returns 统一格式的键值对映射
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
  if (Array.isArray(mapping)) {
    return mapping.reduce<Record<string, string>>((acc, key) => ({ ...acc, [String(key)]: String(key) }), {})
  }
  return mapping as Record<string, string>
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
  subscribeStore: (callback: () => void) => () => void,
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
      if (!safeEqual(next, prevValues[localKey])) {
        prevValues[localKey] = next
        updates[localKey] = next
        changed = true
      }
    }
    if (changed) {
      setter(updates)
    }
  }

  // 立即设置初始值
  setter(prevValues)

  // 订阅 Store 变化（单个订阅覆盖全部映射，进一步减少回调数）
  const unsubscribe = subscribeStore(() => updateAll())
  unbinds.push(unsubscribe)

  return unbinds
}

/**
 * 浅比较：处理 NaN 与引用相等，足以判断映射值是否发生变化。
 *
 * 不深比较对象，避免大对象 diff 开销；引用变化即视为变化（符合 store 不可变更新语义）。
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
    target[localName] = (...args: unknown[]) => {
      return store.dispatch(actionName, ...args)
    }

    unbinds.push(() => {
      delete target[localName]
    })
  })

  return unbinds
}

/**
 * 自动注入 Store 值到目标对象
 *
 * 根据注入映射，将 Store 缓存的值自动注入到目标对象
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

  for (const [sourceKey, targetKey] of Object.entries(injectMapping)) {
    const value = store.getCached(sourceKey as keyof S)
    if (value !== undefined) {
      updates[targetKey] = value
    }
  }

  // 批量调用 setter，避免多次触发更新
  if (Object.keys(updates).length > 0) {
    setter(updates)
  }
}

/**
 * 暴露 Store API 到目标实例
 *
 * 在 App 实例上暴露常用的 Store API 方法
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
  // 暴露 Store 实例
  target.store = store

  // 暴露常用 API 方法
  target.getStore = () => store
  target.getState = () => store.getState()
  target.getCached = (key: keyof S) => store.getCached(key)
  target.dispatch = (actionName: string, ...args: unknown[]) => {
    return store.dispatch(actionName, ...args)
  }
  target.subscribe = (callback: (state: S) => void) => {
    return store.subscribe(callback)
  }

  // 暴露调试 API 对象
  target.__store__ = {
    getStore: () => store,
    getState: () => store.getState(),
    getCached: (key: keyof S) => store.getCached(key),
    dispatch: (actionName: string, ...args: unknown[]) => {
      return store.dispatch(actionName, ...args)
    },
    subscribe: (callback: (state: S) => void) => {
      return store.subscribe(callback)
    },
  }

  // 返回取消暴露函数
  return () => {
    delete target.store
    delete target.getStore
    delete target.getState
    delete target.getCached
    delete target.dispatch
    delete target.subscribe
    delete target.__store__
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

/**
 * 默认导出
 */
export default {
  parseMapping,
  bindMappings,
  bindActions,
  performAutoInject,
  exposeStoreAPI,
  cleanupBindings,
}
