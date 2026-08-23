/**
 * GeomStore v1.0 - 性能优化工具
 *
 * 提供高性能的核心优化组件，包括：
 * - 异步批量通知
 * - 订阅管理优化
 * - 状态指纹算法
 * - 高效深度比较
 *
 * 注意：LRU缓存实现已移至 core/cache/LRUCache.ts
 */

// 从核心缓存模块导入并重新导出 LRUCache
import { LRUCache } from '../cache/LRUCache'
export { LRUCache }

/** hashNumber 的位视图缓冲（模块级复用避免每次调用分配；同步使用无重入问题） */
const FINGERPRINT_F64 = new Float64Array(1)
const FINGERPRINT_U32 = new Uint32Array(FINGERPRINT_F64.buffer)

// ==================== 异步批量通知 ====================

/**
 * 异步批量通知管理器
 *
 * @class AsyncBatchNotifier
 * @description
 * 实现异步批量状态通知，将多次状态更新合并为一次通知，
 * 减少不必要的渲染和计算。
 *
 * @template S - 状态类型
 *
 * @example
 * ```typescript
 * const notifier = new AsyncBatchNotifier<MyState>()
 *
 * // 添加监听器
 * notifier.subscribe((state) => {
 *   console.log('State updated:', state)
 * })
 *
 * // 触发多次更新（会被批量处理）
 * notifier.notify(state1)
 * notifier.notify(state2)
 * notifier.notify(state3)
 *
 * // 在下一个微任务中，监听器只会被调用一次
 * ```
 */
export class AsyncBatchNotifier<S> {
  private listeners: Set<(state: S) => void> = new Set()
  private pending = false
  /** 是否存在待通知状态：以独立标志取代 latestState 的 null 哨兵，支持状态本身为 null 的场景 */
  private hasPendingState = false
  private latestState: S | null = null

  /**
   * 订阅状态变化
   *
   * @param {(state: S) => void} listener - 监听函数
   * @returns {() => void} 取消订阅的函数
   */
  subscribe(listener: (state: S) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 通知状态变化
   *
   * @param {S} state - 新状态
   *
   * @example
   * ```typescript
   * notifier.notify(newState)
   * ```
   */
  notify(state: S): void {
    this.latestState = state
    this.hasPendingState = true

    if (!this.pending) {
      this.pending = true

      // 使用微任务异步通知
      Promise.resolve().then(() => {
        this.flush()
      })
    }
  }

  /**
   * 立即刷新所有通知
   *
   * @private
   */
  private flush(): void {
    this.pending = false

    // 以 hasPendingState 判定是否有待通知，而非 latestState !== null
    if (!this.hasPendingState) {
      return
    }
    this.hasPendingState = false

    const state = this.latestState
    this.latestState = null

    // hasPendingState 为 true 时，latestState 必为 notify 写入的有效状态（即使 S 允许为 null）
    this.listeners.forEach((listener) => {
      try {
        listener(state as S)
      } catch (error) {
        console.error('[AsyncBatchNotifier] Error in listener:', error)
      }
    })
  }

  /**
   * 清空所有监听器
   */
  clear(): void {
    this.listeners.clear()
    this.latestState = null
    this.hasPendingState = false
  }

  /**
   * 获取监听器数量
   *
   * @returns {number} 监听器数量
   */
  size(): number {
    return this.listeners.size
  }
}

// ==================== 高效深度比较 ====================

/**
 * 状态指纹生成器
 *
 * @class StateFingerprint
 * @description
 * 使用高效的哈希算法生成状态的唯一指纹，
 * 用于快速比较状态是否发生变化。
 *
 * @example
 * ```typescript
 * const fingerprint = new StateFingerprint()
 *
 * const hash1 = fingerprint.generate({ a: 1, b: 2 })
 * const hash2 = fingerprint.generate({ a: 1, b: 2 })
 * const hash3 = fingerprint.generate({ a: 2, b: 1 })
 *
 * console.log(hash1 === hash2) // true
 * console.log(hash1 === hash3) // false
 * ```
 */
export class StateFingerprint {
  /**
   * 生成状态的哈希指纹
   *
   * @param {unknown} state - 状态对象
   * @returns {number} 哈希值
   */
  generate(state: unknown): number {
    // 记忆化生命周期必须限于单次调用：跨调用缓存会因状态可变性产生过期指纹，
    // 且强持有旧状态引用阻碍 GC
    return this.hashValue(state, undefined, new Map())
  }

  /**
   * 哈希值
   *
   * 每种类型携带独立的类型标签种子参与组合，避免跨类型指纹碰撞：
   * 修复前 null / NaN / Infinity / 空字符串 / 空对象 / 空数组 / 空 Map / 空 Set 全部哈希为 0，
   * 内容无关的指纹相同会导致「状态未变化」误判。
   *
   * @private
   * @param {unknown} value - 要哈希的值
   * @param {WeakSet<object>} [seen] - 递归链上已访问的容器节点（循环引用守卫）
   * @param {Map<object, number>} [memo] - 单次调用内的子树哈希记忆化（DAG 共享引用去重）
   * @returns {number} 哈希值
   */
  private hashValue(value: unknown, seen?: WeakSet<object>, memo?: Map<object, number>): number {
    if (value === null) return this.hashString('[null]')
    if (value === undefined) return this.hashString('[undefined]')

    const type = typeof value

    switch (type) {
      case 'boolean':
        return this.hashString(value ? '[true]' : '[false]')
      case 'number':
        return this.hashCombine(this.hashString('[number]'), this.hashNumber(value as number))
      case 'string':
        return this.hashCombine(this.hashString('[string]'), this.hashString(value as string))
      case 'object':
        return this.hashObject(value as Record<string, unknown>, seen, memo)
      default:
        return this.hashCombine(this.hashString('[other]'), this.hashString(String(value)))
    }
  }

  /**
   * 哈希数字
   *
   * @private
   */
  private hashNumber(num: number): number {
    // 处理特殊情况：NaN 与 ±Infinity 需区分开，
    // 否则同一类型内不同值（NaN vs Infinity vs -Infinity）指纹相同
    if (isNaN(num)) return this.hashString('[nan]')
    if (!isFinite(num)) return this.hashString(num > 0 ? '[+infinity]' : '[-infinity]')

    // 位级精确混合：`num * 常数 | 0` 的乘法混合在常见量级（时间戳 ~1.7e12）
    // 就超出 int32/Float64 精度，小幅增量（实测 +4181）即产生相同指纹；
    // 且 |num|·常数 < 1 的小数全部 |0 归零。改为按 IEEE754 位模式取高低
    // 32 位分别经 Math.imul 混合：每个有限 number 的位模式唯一，不再塌缩
    FINGERPRINT_F64[0] = num
    const mixed = Math.imul(FINGERPRINT_U32[0], 0x9e3779b1) ^ Math.imul(FINGERPRINT_U32[1], 0x85ebca6b)
    return mixed ^ (mixed >>> 16)
  }

  /**
   * 哈希字符串
   *
   * @private
   */
  private hashString(str: string): number {
    let hash = 0

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }

    return hash
  }

  /**
   * 哈希对象
   *
   * 循环引用守卫：递归链上的容器节点记录到 seen，重访（回边）返回固定标记哈希，
   * 防止循环状态导致无限递归栈溢出；兄弟路径共享同一引用时正常重复哈希。
   *
   * @private
   */
  private hashObject(obj: Record<string, unknown>, seen?: WeakSet<object>, memo?: Map<object, number>): number {
    const visited = seen ?? new WeakSet<object>()
    // 记忆化命中：该子树在本调用内已完整哈希过，直接复用。
    // 递归栈上的节点（真回边）尚未写入 memo，不会误命中。
    // 无记忆化时 DAG 共享结构（如 2^n 路径的持久化数据结构）会被指数级重哈希。
    const memoized = memo?.get(obj as object)
    if (memoized !== undefined) {
      return memoized
    }
    if (visited.has(obj as object)) {
      return this.hashString('[circular]')
    }

    if (Array.isArray(obj)) {
      visited.add(obj as object)
      const hash = this.hashCombine(this.hashString('[array]'), this.hashArray(obj, visited, memo))
      // 递归返回后移除：仅守卫当前递归栈上的回边。
      // 若只加不删，兄弟路径共享同一引用（DAG，如 {a: x, b: x}）的第二次
      // 出现会被误判为循环，指纹误报「状态已变化」
      visited.delete(obj as object)
      memo?.set(obj as object, hash)
      return hash
    }

    // 内建类型：Object.keys 对 Date/Map/Set/RegExp 恒为空，
    // 需按内容参与哈希，否则内容不同的实例指纹相同
    if (obj instanceof Date) {
      return this.hashCombine(this.hashString('[date]'), this.hashNumber(obj.getTime()))
    }

    if (obj instanceof RegExp) {
      return this.hashCombine(this.hashString('[regexp]'), this.hashCombine(this.hashString(obj.source), this.hashString(obj.flags)))
    }

    if (obj instanceof Map) {
      visited.add(obj as object)
      let hash = this.hashString('[map]')
      for (const [key, val] of obj) {
        hash = this.hashCombine(hash, this.hashValue(key, visited, memo))
        hash = this.hashCombine(hash, this.hashValue(val, visited, memo))
      }
      visited.delete(obj as object)
      memo?.set(obj as object, hash)
      return hash
    }

    if (obj instanceof Set) {
      // Set 是集合，指纹应与插入顺序无关：先收集元素哈希再排序后组合，
      // 避免同一集合不同插入顺序产生不同指纹导致「状态已变化」误判
      visited.add(obj as object)
      const elementHashes: number[] = []
      for (const item of obj) {
        elementHashes.push(this.hashValue(item, visited, memo))
      }
      visited.delete(obj as object)
      elementHashes.sort((a, b) => a - b)
      let hash = this.hashString('[set]')
      for (const elementHash of elementHashes) {
        hash = this.hashCombine(hash, elementHash)
      }
      memo?.set(obj as object, hash)
      return hash
    }

    visited.add(obj as object)
    const keys = Object.keys(obj).sort()
    let hash = this.hashString('[object]')

    for (const key of keys) {
      const keyHash = this.hashString(key)
      const valueHash = this.hashValue(obj[key], visited, memo)
      hash = this.hashCombine(hash, keyHash)
      hash = this.hashCombine(hash, valueHash)
    }
    visited.delete(obj as object)
    memo?.set(obj as object, hash)

    return hash
  }

  /**
   * 哈希数组
   *
   * @private
   */
  private hashArray(arr: unknown[], seen?: WeakSet<object>, memo?: Map<object, number>): number {
    let hash = 0

    for (let i = 0; i < arr.length; i++) {
      const elementHash = this.hashValue(arr[i], seen, memo)
      hash = this.hashCombine(hash, elementHash)
    }

    return hash
  }

  /**
   * 组合哈希值
   *
   * @private
   */
  private hashCombine(hash1: number, hash2: number): number {
    return ((hash1 << 5) - hash1 + hash2) & 0xffffffff
  }
}

// ==================== 深度比较导出 ====================

// 从工具模块重新导出深度比较函数
export { deepEqual as iterativeDeepEqual } from '../utils/helpers'

// ==================== 订阅管理优化 ====================

/**
 * 订阅管理器（使用WeakMap优化）
 *
 * @class SubscriptionManager
 * @description
 * 高效的订阅管理实现，使用WeakMap自动清理不再使用的订阅，
 * 减少内存泄漏风险。
 *
 * @template S - 状态类型
 *
 * @example
 * ```typescript
 * const manager = new SubscriptionManager<MyState>()
 *
 * const listener = (state) => console.log(state)
 * const unsubscribe = manager.subscribe(listener)
 *
 * manager.notify(state) // 触发监听器
 *
 * unsubscribe() // 取消订阅
 * ```
 */
export class SubscriptionManager<S> {
  // 仅需去重监听器，无需记录顺序序号，使用 Set 更简洁
  private listeners = new Set<(state: S) => void>()

  /**
   * 订阅状态变化
   *
   * @param {(state: S) => void} listener - 监听函数
   * @returns {() => void} 取消订阅的函数
   */
  subscribe(listener: (state: S) => void): () => void {
    this.listeners.add(listener)

    return () => this.unsubscribe(listener)
  }

  /**
   * 取消订阅
   *
   * @param {(state: S) => void} listener - 监听函数
   * @returns {boolean} 是否成功取消
   */
  unsubscribe(listener: (state: S) => void): boolean {
    return this.listeners.delete(listener)
  }

  /**
   * 通知所有监听器
   *
   * @param {S} state - 状态
   */
  notify(state: S): void {
    for (const listener of this.listeners) {
      try {
        listener(state)
      } catch (error) {
        console.error('[SubscriptionManager] Error in listener:', error)
      }
    }
  }

  /**
   * 清空所有订阅
   */
  clear(): void {
    this.listeners.clear()
  }

  /**
   * 获取订阅者数量
   *
   * @returns {number} 订阅者数量
   */
  size(): number {
    return this.listeners.size
  }

  /**
   * 检查是否已订阅
   *
   * @param {(state: S) => void} listener - 监听函数
   * @returns {boolean} 是否已订阅
   */
  has(listener: (state: S) => void): boolean {
    return this.listeners.has(listener)
  }
}

// ==================== 调度工具 ====================

/**
 * 使用 setTimeout 调度任务（微信小程序环境无 requestIdleCallback，直接使用定时器）
 *
 * @param {() => void} task - 要执行的任务
 * @param {object} [options] - 选项
 * @returns {void}
 *
 * @example
 * ```typescript
 * scheduleIdle(() => {
 *   console.log('Task executed during idle time')
 * })
 * ```
 */
export function scheduleIdle(task: () => void, options?: { timeout?: number }): void {
  setTimeout(() => {
    try {
      task()
    } catch (error) {
      console.error('[scheduleIdle] Error in idle task:', error)
    }
  }, options?.timeout || 16)
}

/**
 * 防抖函数
 *
 * @param {(...args: unknown[]) => unknown} fn - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {(...args: unknown[]) => unknown} 防抖后的函数
 *
 * @example
 * ```typescript
 * const debouncedUpdate = debounce(() => {
 *   console.log('Update executed')
 * }, 300)
 *
 * debouncedUpdate()
 * debouncedUpdate() // 只会执行一次
 * ```
 */
// 泛型约束参数刻意保持 any[]：函数参数逆变下 unknown[] 会拒绝具体签名的
// 函数（如 (a: number, b: string) => R），any[] 是唯一可接受任意签名的约束写法
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => unknown>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout> | null = null

  return function (this: unknown, ...args: Parameters<T>) {
    if (timer) {
      clearTimeout(timer as ReturnType<typeof setTimeout>)
    }

    timer = setTimeout(() => {
      // 先复位再执行：fn 同步抛错时若保持 timer 引用，下次调用会 clearTimeout
      // 一个已触发的句柄（无害但语义混乱）；抛错本身经 try/catch 记录，
      // 避免定时器回调中的异常成为 uncaught exception
      timer = null
      try {
        fn.apply(this, args)
      } catch (error) {
        console.error('[GeomStore] debounced function threw:', error)
      }
    }, delay) as unknown as ReturnType<typeof setTimeout>
  }
}

/**
 * 节流函数
 *
 * @param {(...args: unknown[]) => unknown} fn - 要节流的函数
 * @param {number} interval - 间隔时间（毫秒）
 * @returns {(...args: unknown[]) => unknown} 节流后的函数
 *
 * @example
 * ```typescript
 * const throttledUpdate = throttle(() => {
 *   console.log('Update executed')
 * }, 300)
 *
 * throttledUpdate()
 * throttledUpdate() // 只会执行一次，300ms内不会再执行
 * ```
 */
// 约束说明同 debounce（函数参数逆变下 any[] 是唯一可接受任意签名的写法）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<T extends (...args: any[]) => unknown>(
  fn: T,
  interval: number,
  options: { leading?: boolean; trailing?: boolean } = {},
): (...args: Parameters<T>) => void {
  const trailing = options.trailing ?? true
  // 双 false 永不执行无意义：退化为纯 leading（与 lodash 处理一致）
  let leading = options.leading ?? true
  if (!leading && !trailing) {
    leading = true
  }
  let lastCall = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  // 窗口内最近一次被抑制调用的参数：trailing 补发必须用最新参数，
  // 此前用的是首次被抑制调用的参数（定时器只在无 timer 时调度，后续调用未更新）
  let pendingArgs: Parameters<T> | null = null

  return function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now()
    const host = this

    const fireTrailing = () => {
      timer = null
      if (pendingArgs !== null) {
        const trailingArgs = pendingArgs
        pendingArgs = null
        lastCall = Date.now()
        // 尾随补发运行在定时器回调中：同步抛错没有调用方栈可传播，
        // 会成为 uncaught exception；记录后保持节流器可用（与防抖同口径）
        try {
          fn.apply(host, trailingArgs)
        } catch (error) {
          console.error('[GeomStore] throttled function threw:', error)
        }
      }
    }

    if (now - lastCall >= interval) {
      if (leading) {
        lastCall = now
        pendingArgs = null
        fn.apply(this, args)
        return
      }
      lastCall = now
      pendingArgs = args
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(fireTrailing, interval) as unknown as ReturnType<typeof setTimeout>
      return
    }

    if (trailing) {
      pendingArgs = args
      const delay = Math.max(0, lastCall + interval - now)
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(fireTrailing, delay) as unknown as ReturnType<typeof setTimeout>
    }
  }
}

// ==================== 导出便捷函数 ====================

/**
 * 创建LRU缓存的便捷函数
 *
 * @param {number} capacity - 容量
 * @returns {LRUCache} 缓存实例
 */
export function createLRUCache<K, V>(capacity: number): LRUCache<K, V> {
  return new LRUCache<K, V>(capacity)
}

/**
 * 创建异步批量通知器的便捷函数
 *
 * @returns {AsyncBatchNotifier} 通知器实例
 */
export function createAsyncBatchNotifier<S>(): AsyncBatchNotifier<S> {
  return new AsyncBatchNotifier<S>()
}

/**
 * 创建状态指纹生成器的便捷函数
 *
 * @returns {StateFingerprint} 指纹生成器实例
 */
export function createStateFingerprint(): StateFingerprint {
  return new StateFingerprint()
}

/**
 * 创建订阅管理器的便捷函数
 *
 * @returns {SubscriptionManager} 订阅管理器实例
 */
export function createSubscriptionManager<S>(): SubscriptionManager<S> {
  return new SubscriptionManager<S>()
}
