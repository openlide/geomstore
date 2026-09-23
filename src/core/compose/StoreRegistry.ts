/**
 * GeomStore - Store注册表
 *
 * 提供全局Store管理、注册、注销和批量操作功能
 *
 */

import type { Store, State } from '../../types/store.js'
import { deepCloneState } from '../utils/clone.js'
import { isProduction } from '../store/utils.js'

/**
 * 该实例是否需要（且能够）被销毁
 *
 * `register()` 只校验 `getState`，鸭子类型的 store 完全可以没有 `destroy`；
 * 裸调 `store.destroy()` 会抛 TypeError 并被清理路径吞成一条日志，
 * 于是「本该发生的清理」静默不发生时与「无需清理」同形
 */
function isDestroyable(store: Store): boolean {
  return typeof store.destroy === 'function' && !store.destroyed
}

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
   * 将Store实例注册到注册表中。返回后 `get(name)` 必等于本次传入的实例：
   * 同名（含 `destroy()` 期间重入注册的同名）旧实例一律走覆盖流程退场。
   * 被覆盖的旧实例会被销毁，且它在其它名字下的别名一并摘除（同 `unregister`）。
   * 同一实例重复注册同名是幂等操作，不触发销毁
   *
   * @param {string} name - Store名称
   * @param {Store} store - Store实例
   * @throws {Error} 如果名称无效或store无效（校验先于任何写入，注册表不会被改一半）
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
    this._assertValidEntry(name, store)

    const existingStore = this.stores.get(name)

    if (existingStore === store) {
      // 幂等重注册：同一实例重复注册是合法操作（如初始化脚本重复执行），
      // 不应销毁自身导致注册表持有已销毁实例；合法操作降级为 debug 避免告警噪声，
      // 且只在非生产构建里输出（口径同 composeStore/helpers 的歧义/配置类提示：
      // 生产刷屏只会淹没真实日志，初始化脚本每次重注册都会打一条）
      if (!isProduction()) {
        console.debug(`[StoreRegistry] Store "${name}" is already registered with the same instance, ignoring`)
      }
      return
    }

    const superseded: Store[] = []
    if (existingStore) {
      // 覆盖注册属于「配置歧义」级别（同名换了实例），与 composeStore 的重名告警同口径：
      // 生产构建里旧实例照样被销毁、新实例照样登记，行为不变，只是不再刷屏
      if (!isProduction()) {
        console.warn(`[StoreRegistry] Store "${name}" already registered, ${isDestroyable(existingStore) ? 'destroying old store and ' : ''}overwriting`)
      }
      this._detachInstance(name, existingStore)
      superseded.push(existingStore)

      // 重入保护：destroy() 回调可以再次 register 同名 store（clear() 为这类重入
      // 预留了「先摘链再销毁」的顺序，这里同样要显式处理）。上面的 set 若无条件执行，
      // 重入写入的实例会被顶掉且永不被销毁 —— 那是个没人持有、也没人清理的悬挂 store。
      // 本次调用是更外层的注册意图（其契约是「返回后 get(name) === store」），
      // 故让重入实例走同一条覆盖流程退场，两个实例都不被静默遗弃。
      // 例外：重入写入的正是本次要注册的实例（回调替调用方先行装好），摘毁它会让
      // 下面的 set 把一个已销毁的实例登记为在册 store
      const reentrant = this.stores.get(name)
      if (reentrant !== undefined && reentrant !== existingStore && reentrant !== store) {
        if (!isProduction()) {
          console.warn(`[StoreRegistry] Store "${name}" 在旧实例 destroy() 期间被重新注册，本次注册覆盖该重入实例`)
        }
        this._detachInstance(name, reentrant)
        superseded.push(reentrant)
      }
    }

    this.stores.set(name, store)

    // 覆盖注册后旧实例已被销毁：若默认 store 指向被顶掉的实例，同步指向新实例避免悬空。
    // 必须排除「没有实例被顶掉」的情况——注册全新名字且从未 setDefault 时
    // defaultStore 与 existingStore 同为 undefined，直接等值比较会让首个注册的 store
    // 隐式成为默认，违反 getDefault「未设置则返回 undefined」的契约
    if (this.defaultStore !== undefined && superseded.includes(this.defaultStore)) {
      this.defaultStore = store
    }
  }

  /**
   * 校验注册表条目的形状
   *
   * `register()` 与 `registerAll()` 的预校验共用此判据：两处各写一遍迟早会漂移成
   * 「一条路径接受、另一条拒绝」的 store 形状
   */
  private _assertValidEntry(name: string, store: Store): void {
    if (!name || typeof name !== 'string') {
      throw new Error('[StoreRegistry] Store name must be a non-empty string')
    }
    if (!store || typeof store.getState !== 'function') {
      throw new Error(`[StoreRegistry] Invalid store object for name "${name}"`)
    }
  }

  /**
   * 摘除某实例在注册表里的全部名字并销毁它
   *
   * 别名一并摘除：同一实例可以注册在多个名字下（`register('a', s)` + `register('b', s)`），
   * 而实例只有一个生命周期；只摘一个名字会让其余名字继续返回已销毁的 store。
   * 先摘链再销毁，销毁期间重入的 register/unregister 看到的都是已摘除的状态
   * （与 `clear()` 同序）
   */
  private _detachInstance(name: string, store: Store): void {
    for (const [key, candidate] of this.stores) {
      if (candidate === store) {
        this.stores.delete(key)
      }
    }
    this._destroyInstance(name, store)
  }

  /** 带形状守卫与异常兜底的销毁：register / unregister / clear 三条清理路径共用 */
  private _destroyInstance(name: string, store: Store): void {
    if (!isDestroyable(store)) {
      return
    }
    try {
      store.destroy()
    } catch (error) {
      console.error(`[StoreRegistry] Error destroying store "${name}":`, error)
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
      this._assertValidEntry(name, store)
    }

    for (const [name, store] of Object.entries(stores)) {
      this.register(name, store)
    }
  }

  /**
   * 注销Store
   *
   * 从注册表中移除该实例并调用其 destroy 方法。
   * 同一实例若还注册在其它名字下（别名），那些条目一并移除：实例只有一个生命周期，
   * 销毁后继续按别名返回它会交出已销毁的 store
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

    // 摘链（含该实例的其它别名）与销毁统一交给 _detachInstance：
    // 已在外部销毁的实例不再二次 destroy，缺 destroy 方法的实例照常从注册表摘除
    this._detachInstance(name, store)

    // 实例已被销毁且不再有名字指向它：默认引用必须清除，否则 getDefault()
    // 返回一个已销毁的 store
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
   * @remarks 契约是「进入本方法时在册的条目全部注销」，不是「调用后注册表为空」：
   * 某个 `destroy()` 回调里重入 `register()`/`registerAll()` 的条目**会保留下来**
   * （它们是在清空之后写入的，把它们连带销毁会白白牺牲仍被调用方持有的 store）。
   * 因此那种场景下 `size()` 不为 0；需要绝对为空的调用方应在无重入注册时清空，
   * 或清空后自行再清一次
   *
   * @example
   * ```typescript
   * // 清空所有Store（无 destroy 重入注册时）
   * registry.clear()
   * console.log(registry.size()) // 0
   * ```
   */
  clear(): void {
    // 先摘链再逐个销毁：destroy() 实现可能重入 unregister()/register()，
    // 实时迭代 this.stores 会让重入的写入被本循环再次访问（同一实例销毁两次、
    // 或新注册的实例被连带销毁）；清空后重入的注销只会命中空表，语义可预期。
    // 重入的 register() 则按 @remarks 的契约留在表内，不被本循环吞掉
    const entries = Array.from(this.stores.entries())
    this.stores.clear()
    this.defaultStore = undefined

    for (const [name, store] of entries) {
      // 守卫与异常兜底统一走 _destroyInstance：已在外部销毁的实例跳过、
      // 缺 destroy 的鸭子类型实例不会以 TypeError 收场
      this._destroyInstance(name, store)
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
 * 全局注册表在 globalThis 上的槽位键。
 *
 * 与 `stateVersion.ts` 的 STATE_VERSION、`pluginSupport.ts` 的 GEOMSTORE_BRAND 同一取舍：
 * 小程序构建产物里同一包常有重复副本（分包各自打包、宿主库把本库一起打进去），
 * 裸的模块级常量会让每个副本各持一个注册表——A 副本 `register` 的 store 在 B 副本
 * `get` 不到、`setDefault` 也不同步，而两侧都「成功」，属于静默丢引用。
 * `Symbol.for` 的符号注册表按进程共享，故键名带包名命名空间但**不带版本号**
 * （加版本就等于重新制造副本分裂）。
 */
const GLOBAL_REGISTRY_SLOT = Symbol.for('@openlide/geomstore:store-registry')

/**
 * 槽位里的值能否当作 StoreRegistry 复用
 *
 * 跨副本场景下 `instanceof StoreRegistry` 恒为 false（两个副本各有一份类对象），
 * 用它判定会把副本 A 已建好的注册表覆盖掉——那正是本条要修的故障。
 * 故按方法形状判定（与 `isGeomStore` 同为结构化守卫），且校验面覆盖注册表的
 * 全部写入/读取入口：只挂一两个同名方法的仿冒对象不会因为漏了 `getAll` 而通过。
 */
function isStoreRegistryLike(value: unknown): value is StoreRegistry {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.register === 'function' &&
    typeof candidate.unregister === 'function' &&
    typeof candidate.get === 'function' &&
    typeof candidate.getAll === 'function' &&
    typeof candidate.clear === 'function'
  )
}

/**
 * 取（并按需构造）进程级全局注册表
 *
 * 写入失败（globalThis 被冻结、同名键不可写）时退回「本模块副本私有的实例」并出声：
 * 宁可退回单副本语义也不抛错，否则这条 API 在受限宿主里直接不可用；
 * 但副本分裂的故障必须可见，否则又回到静默丢引用。
 */
function resolveGlobalRegistry(): StoreRegistry {
  const holder = globalThis as unknown as Record<symbol, unknown>
  const existing = holder[GLOBAL_REGISTRY_SLOT]
  if (isStoreRegistryLike(existing)) {
    return existing
  }

  const registry = new StoreRegistry()
  try {
    // defineProperty 而非直接赋值：键是 symbol，不会被 `Object.keys(globalThis)`
    // 与调试器枚举出来（内部实例不对外面可见性负责）；不可枚举也避免宿主按枚举
    // 复制 globalThis 时把整册 store 一起带走
    Object.defineProperty(globalThis, GLOBAL_REGISTRY_SLOT, {
      value: registry,
      writable: true,
      enumerable: false,
      configurable: true,
    })
  } catch (error) {
    if (!isProduction()) {
      console.warn('[StoreRegistry] globalThis 上的全局注册表槽位不可写，本模块副本各自持有一份注册表：', error)
    }
  }
  return registry
}

/**
 * 全局注册表实例
 *
 * 提供全局访问的注册表实例。作用域是**进程内唯一**：实例挂在
 * `globalThis[Symbol.for('@openlide/geomstore:store-registry')]` 上、首次取用时惰性构造，
 * 因此同一进程内的多个包副本（分包各自打包、宿主库把本库一起打进去）共享同一册，
 * 而不是各副本一份。宿主 globalThis 不可写时退化为「本副本一份」并告警。
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
export const globalRegistry: StoreRegistry = resolveGlobalRegistry()
