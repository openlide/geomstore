/**
 * GeomStore v1.0 - Store注册表
 *
 * 提供全局Store管理、注册、注销和批量操作功能
 *
 * @since 1.0.0
 */

import type { Store, State } from '../../types/store'
import { deepCloneState } from '../store/utils'

/**
 * Store注册表类
 *
 * 用于管理多个Store实例，提供统一的注册、访问和生命周期管理
 *
 * @class StoreRegistry
 * @since 1.0.0
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
   * @since 1.0.0
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
      // 销毁旧 store，避免内存泄漏
      if (typeof existingStore.destroy === 'function' && !existingStore.destroyed) {
        console.warn(`[StoreRegistry] Store "${name}" already registered, destroying old store and overwriting`)
        existingStore.destroy()
      } else {
        console.warn(`[StoreRegistry] Store "${name}" already registered, overwriting`)
      }
    }

    this.stores.set(name, store)

    // 覆盖注册后旧实例已被销毁：若默认 store 指向旧实例，同步指向新实例避免悬空
    if (this.defaultStore === existingStore) {
      this.defaultStore = store
    }
  }

  /**
   * 批量注册Store
   *
   * 将多个Store实例批量注册到注册表中
   *
   * @param {Record<string, Store>} stores - Store名称到实例的映射
   * @since 1.0.0
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
   * @since 1.0.0
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

    // 清理store
    try {
      store.destroy()
    } catch (error) {
      console.error(`[StoreRegistry] Error destroying store "${name}":`, error)
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
   * @since 1.0.0
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
   * @since 1.0.0
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
   * @since 1.0.0
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
   * @since 1.0.0
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
   * @since 1.0.0
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
   * @since 1.0.0
   *
   * @example
   * ```typescript
   * // 清空所有Store
   * registry.clear()
   * console.log(registry.size()) // 0
   * ```
   */
  clear(): void {
    for (const [name, store] of this.stores.entries()) {
      try {
        store.destroy()
      } catch (error) {
        console.error(`[StoreRegistry] Error destroying store "${name}":`, error)
      }
    }

    this.stores.clear()
    this.defaultStore = undefined
  }

  /**
   * 设置默认Store
   *
   * 设置默认Store，用于快速访问
   *
   * @param {string} name - Store名称
   * @throws {Error} 如果Store不存在
   * @since 1.0.0
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
   * @since 1.0.0
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
   * @since 1.0.0
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
   * @since 1.0.0
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
   * @since 1.0.0
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
        // 深拷贝状态，避免快照与原始状态共享引用
        snapshot[name] = deepCloneState(store.getState())
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
   * @since 1.0.0
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
    for (const [name, state] of Object.entries(snapshot)) {
      const store = this.get(name)
      if (store) {
        try {
          store.$replaceState(state as State)
        } catch (error) {
          console.error(`[StoreRegistry] Error restoring store "${name}":`, error)
        }
      } else {
        console.warn(`[StoreRegistry] Store "${name}" not found in snapshot`)
      }
    }
  }
}

/**
 * 全局注册表实例
 *
 * 提供全局访问的注册表实例
 *
 * @type {StoreRegistry}
 * @since 1.0.0
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
