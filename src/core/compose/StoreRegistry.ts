/**
 * GeomStore - Store注册表
 *
 * 提供全局Store管理、注册、注销和批量操作功能
 *
 */

import type { Store, State } from '../../types/store.js'
import { deepCloneState } from '../utils/clone.js'

/**
 * Store注册表类
 *
 * 用于管理多个Store实例，提供统一的注册、访问和生命周期管理
 *
 * @class StoreRegistry
 *
 * @example
 * ```typescript
 * const registry = new StoreRegistry()
 *
 * // 注册Store
 * registry.register('user', userStore)
 * registry.register('product', productStore)
 *
 * // 批量注册
 * registry.registerAll({ cart, order, payment })
 *
 * // 获取Store
 * const store = registry.get('user')
 * const storeOrThrow = registry.getOrThrow('product')
 *
 * // 设置默认Store
 * registry.setDefault('user')
 * const default = registry.getDefault()
 * ```
 */
export class StoreRegistry {
  /**
   * Store映射
   * @private
   * @type {Map<string, Store>}
   */
  private stores: Map<string, Store> = new Map()

  /**
   * 默认Store
   * @private
   * @type {Store | undefined}
   */
  private defaultStore?: Store

  /**
   * 注册Store
   *
   * 将Store实例注册到注册表中，如果同名Store已存在会覆盖
   *
   * @param {string} name - Store名称
   * @param {Store} store - Store实例
   * @throws {Error} 如果名称无效或store无效
   *
   * @example
   * ```typescript
   * const registry = new StoreRegistry()
   * const store = createStore({ state: { count: 0 } })
   *
   * // 注册单个Store
   * registry.register('counter', store)
   *
   * // 覆盖已存在的Store
   * const newStore = createStore({ state: { count: 10 } })
   * registry.register('counter', newStore) // 会覆盖
   * ```
   */
  register(name: string, store: Store): void {
    if (!name || typeof name !== 'string') {
      throw new Error('[StoreRegistry] Store name must be a non-empty string')
    }

    if (!store || typeof store.getState !== 'function') {
      throw new Error('[StoreRegistry] Invalid store object')
    }

    const existingStore = this.stores.get(name)

    if (existingStore === store) {
      // 幂等重注册：同一实例重复注册是合法操作（如初始化脚本重复执行），
      // 不应销毁自身导致注册表持有已销毁实例；合法操作降级为 log 避免告警噪声
      console.log(`[StoreRegistry] Store "${name}" is already registered with the same instance, ignoring`)
      return
    }

    if (existingStore) {
      // 销毁旧 store，避免内存泄漏。与 unregister/clear 一致地加保护：
      // 旧实例 destroy() 抛出不得中断覆盖注册，否则注册表停留在半销毁实例上
      if (typeof existingStore.destroy === 'function' && !existingStore.destroyed) {
        console.warn(`[StoreRegistry] Store "${name}" already registered, destroying old store and overwriting`)
        try {
          existingStore.destroy()
        } catch (error) {
          console.error(`[StoreRegistry] Error destroying old store "${name}":`, error)
        }
      } else {
        console.warn(`[StoreRegistry] Store "${name}" already registered, overwriting`)
      }
    }

    this.stores.set(name, store)

    // 覆盖注册后旧实例已被销毁：若默认 store 指向旧实例，同步指向新实例避免悬空。
    // 必须排除「两者都为 undefined」——注册全新名字且从未 setDefault 时该等式同样成立，
    // 否则首个注册的 store 会隐式成为默认，违反 getDefault「未设置则返回 undefined」的契约
    if (existingStore !== undefined && this.defaultStore === existingStore) {
      this.defaultStore = store
    }
  }

  /**
   * 批量注册Store
   *
   * 将多个Store实例批量注册到注册表中。整体语义为「全成功或全不注册」：
   * 先整体校验再写入，任一条目非法都会在改动注册表之前抛出，不会留下半注册状态
   *
   * @param {Record<string, Store>} stores - Store名称到实例的映射
   * @throws {Error} 任一名称或 store 无效（此时注册表未被修改）
   *
   * @example
   * ```typescript
   * const registry = new StoreRegistry()
   *
   * registry.registerAll({
   *   user: userStore,
   *   product: productStore,
   *   cart: cartStore
   * })
   *
   * // 检查注册结果
   * console.log(registry.size()) // 3
   * ```
   */
  registerAll(stores: Record<string, Store>): void {
    // 预校验：逐条 register 时首条非法会让之前的条目已注册、之后的被静默跳过，
    // 调用方无法得知注册表停在哪一半（Object.entries 顺序也不保证与入参语义一致）
    for (const [name, store] of Object.entries(stores)) {
      if (!name || typeof name !== 'string') {
        throw new Error('[StoreRegistry] Store name must be a non-empty string')
      }
      if (!store || typeof store.getState !== 'function') {
        throw new Error(`[StoreRegistry] Invalid store object for name "${name}"`)
      }
    }

    for (const [name, store] of Object.entries(stores)) {
      this.register(name, store)
    }
  }

  /**
   * 注销Store
   *
   * 从注册表中移除Store并调用其destroy方法
   *
   * @param {string} name - Store名称
   *
   * @example
   * ```typescript
   * const registry = new StoreRegistry()
   * registry.register('user', store)
   *
   * // 注销Store
   * registry.unregister('user')
   * // store.destroy() 会被调用
   * ```
   */
  unregister(name: string): void {
    const store = this.stores.get(name)
    if (!store) {
      console.warn(`[StoreRegistry] Store "${name}" not found`)
      return
    }

    // 清理store：已在外部销毁的实例不再二次 destroy（与 register 的覆盖分支同口径），
    // 但无论如何都要从注册表摘除
    if (!store.destroyed) {
      try {
        store.destroy()
      } catch (error) {
        console.error(`[StoreRegistry] Error destroying store "${name}":`, error)
      }
    }

    this.stores.delete(name)

    // 如果是默认store，清除引用
    if (this.defaultStore === store) {
      this.defaultStore = undefined
    }
  }

  /**
   * 获取Store
   *
   * 根据名称获取Store实例
   *
   * @param {string} name - Store名称
   * @returns {Store | undefined} Store实例，不存在则返回undefined
   *
   * @example
   * ```typescript
   * const store = registry.get('user')
   * if (store) {
   *   console.log('Store found:', store.getState())
   * } else {
   *   console.log('Store not found')
   * }
   * ```
   */
  get(name: string): Store | undefined {
    return this.stores.get(name)
  }

  /**
   * 获取或抛出错误
   *
   * 根据名称获取Store，如果不存在则抛出错误
   *
   * @param {string} name - Store名称
   * @returns {Store} Store实例
   * @throws {Error} 如果Store不存在
   *
   * @example
   * ```typescript
   * try {
   *   const store = registry.getOrThrow('user')
   *   console.log(store.getState())
   * } catch (error) {
   *   console.error('Store not found:', error)
   * }
   * ```
   */
  getOrThrow(name: string): Store {
    const store = this.get(name)
    if (!store) {
      throw new Error(`[StoreRegistry] Store "${name}" not found`)
    }
    return store
  }

  /**
   * 检查Store是否存在
   *
   * @param {string} name - Store名称
   * @returns {boolean} 是否存在
   *
   * @example
   * ```typescript
   * if (registry.has('user')) {
   *   const store = registry.get('user')
   *   // 使用store
   * }
   * ```
   */
  has(name: string): boolean {
    return this.stores.has(name)
  }

  /**
   * 获取所有Store
   *
   * @returns {Record<string, Store>} 所有Store的映射
   *
   * @example
   * ```typescript
   * const allStores = registry.getAll()
   * Object.entries(allStores).forEach(([name, store]) => {
   *   console.log(`${name}:`, store.getState())
   * })
   * ```
   */
  getAll(): Record<string, Store> {
    return Object.fromEntries(this.stores.entries())
  }

  /**
   * 获取Store数量
   *
   * @returns {number} 注册的Store数量
   *
   * @example
   * ```typescript
   * console.log(`Total stores: ${registry.size()}`)
   * ```
   */
  size(): number {
    return this.stores.size
  }

  /**
   * 清空注册表
   *
   * 注销所有Store并清空注册表
   *
   *
   * @example
   * ```typescript
   * // 清空所有Store
   * registry.clear()
   * console.log(registry.size()) // 0
   * ```
   */
  clear(): void {
    // 先摘链再逐个销毁：destroy() 实现可能重入 unregister()/register()，
    // 实时迭代 this.stores 会让重入的写入被本循环再次访问（同一实例销毁两次、
    // 或新注册的实例被连带销毁）；清空后重入的注销只会命中空表，语义可预期
    const entries = Array.from(this.stores.entries())
    this.stores.clear()
    this.defaultStore = undefined

    for (const [name, store] of entries) {
      // 已在外部销毁的实例跳过：与 register() 的覆盖分支同口径，避免二次 destroy
      if (store.destroyed) {
        continue
      }
      try {
        store.destroy()
      } catch (error) {
        console.error(`[StoreRegistry] Error destroying store "${name}":`, error)
      }
    }
  }

  /**
   * 设置默认Store
   *
   * 设置默认Store，用于快速访问
   *
   * @param {string} name - Store名称
   * @throws {Error} 如果Store不存在
   *
   * @example
   * ```typescript
   * registry.register('user', userStore)
   * registry.register('product', productStore)
   *
   * // 设置默认Store
   * registry.setDefault('user')
   *
   * // 获取默认Store
   * const defaultStore = registry.getDefault()
   * ```
   */
  setDefault(name: string): void {
    const store = this.get(name)
    if (!store) {
      throw new Error(`[StoreRegistry] Store "${name}" not found`)
    }
    this.defaultStore = store
  }

  /**
   * 获取默认Store
   *
   * @returns {Store | undefined} 默认Store，未设置则返回undefined
   *
   * @example
   * ```typescript
   * const defaultStore = registry.getDefault()
   * if (defaultStore) {
   *   console.log('Default store:', defaultStore.getState())
   * }
   * ```
   */
  getDefault(): Store | undefined {
    return this.defaultStore
  }

  /**
   * 获取Store名称列表
   *
   * @returns {string[]} 所有Store名称的数组
   *
   * @example
   * ```typescript
   * const names = registry.getNames()
   * console.log('Available stores:', names.join(', '))
   * ```
   */
  getNames(): string[] {
    return Array.from(this.stores.keys())
  }

  /**
   * 遍历所有Store
   *
   * 对每个注册的Store执行回调函数
   *
   * @param {(name: string, store: Store) => void} callback - 回调函数
   *
   * @example
   * ```typescript
   * registry.forEach((name, store) => {
   *   console.log(`Store ${name}:`, store.getState())
   * })
   * ```
   */
  forEach(callback: (name: string, store: Store) => void): void {
    this.stores.forEach((store, name) => {
      callback(name, store)
    })
  }

  /**
   * 创建Store快照
   *
   * 创建所有Store的状态快照
   *
   * @returns {Record<string, unknown>} Store名称到状态的映射
   *
   * @example
   * ```typescript
   * const snapshot = registry.createSnapshot()
   * console.log('All states:', snapshot)
   *
   * // 稍后恢复
   * registry.restoreSnapshot(snapshot)
   * ```
   */
  createSnapshot(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {}

    this.stores.forEach((store, name) => {
      try {
        // 深拷贝状态，避免快照与原始状态共享引用。
        // 以 DefineOwnProperty 语义写入：store 名可合法为 '__proto__'，
        // snapshot[name] = ... 走 [[Set]] 会触发 Object.prototype 的 __proto__ setter，
        // 该条目被静默丢弃且快照原型被替换（getAll 用 Object.fromEntries 已规避同类问题）
        Object.defineProperty(snapshot, name, {
          value: deepCloneState(store.getState()),
          writable: true,
          enumerable: true,
          configurable: true,
        })
      } catch (error) {
        console.error(`[StoreRegistry] Error creating snapshot for store "${name}":`, error)
      }
    })

    return snapshot
  }

  /**
   * 从快照恢复所有Store
   *
   * 根据快照恢复所有Store的状态
   *
   * @param {Record<string, unknown>} snapshot - Store快照
   *
   * @example
   * ```typescript
   * const snapshot = registry.createSnapshot()
   * // ... 修改状态
   *
   * // 恢复到快照
   * registry.restoreSnapshot(snapshot)
   * ```
   */
  restoreSnapshot(snapshot: Record<string, unknown>): void {
    const restored = new Set<string>()

    for (const [name, state] of Object.entries(snapshot)) {
      const store = this.get(name)
      if (!store) {
        console.warn(`[StoreRegistry] Store "${name}" in snapshot is not registered, skipped`)
        continue
      }
      // 状态形状由 $replaceState 校验（非纯对象/数组直接抛错），此处不重复判定；
      // 抛错被捕获并记录，避免一个 store 的坏数据中断其余恢复
      try {
        store.$replaceState(state as State)
        restored.add(name)
      } catch (error) {
        console.error(`[StoreRegistry] Error restoring store "${name}":`, error)
      }
    }

    // 部分恢复显式化：快照未覆盖的注册 store 保持当前值，调用方需要知道
    // 这次恢复不是全量的（createSnapshot 抛错被跳过的 store 会落进这里）
    const skipped = this.getNames().filter((name) => !restored.has(name))
    if (skipped.length > 0) {
      console.warn(`[StoreRegistry] restoreSnapshot 未覆盖 ${skipped.length} 个已注册 store，其状态保持不变: [${skipped.join(', ')}]`)
    }
  }
}

/**
 * 全局注册表实例
 *
 * 提供全局访问的注册表实例
 *
 * @type {StoreRegistry}
 *
 * @example
 * ```typescript
 * import { globalRegistry } from '@openlide/geomstore'
 *
 * // 在任何地方访问
 * globalRegistry.register('my-store', myStore)
 * const store = globalRegistry.get('my-store')
 * ```
 */
export const globalRegistry = new StoreRegistry()
