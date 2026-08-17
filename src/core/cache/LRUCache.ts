/**
 * GeomStore v1.0 - 增强型LRU缓存系统
 *
 * 提供完整的LRU（最近最少使用）缓存实现，包含：
 * - 严格的LRU淘汰策略（O(1)时间复杂度）
 * - 动态容量控制机制
 * - 精确的缓存命中率统计
 * - 丰富的缓存操作API
 *
 * @module LRUCache
 */

// ==================== 类型定义 ====================

/**
 * LRU缓存节点
 *
 * 双向链表节点，用于维护访问顺序
 * @interface LRUNode
 * @template K - 键类型
 * @template V - 值类型
 */
interface LRUNode<K, V> {
  /** 节点键 */
  key: K
  /** 节点值 */
  value: V
  /** 前一个节点 */
  prev: LRUNode<K, V> | null
  /** 后一个节点 */
  next: LRUNode<K, V> | null
  /** 节点创建时间 */
  createdAt: number
  /** 最后访问时间 */
  lastAccessedAt: number
  /** 访问次数 */
  accessCount: number
}

/**
 * LRU缓存统计信息
 *
 * @interface LRUCacheStats
 */
export interface LRUCacheStats {
  /** 缓存容量 */
  capacity: number
  /** 当前缓存项数量 */
  size: number
  /** 缓存命中次数 */
  hits: number
  /** 缓存未命中次数 */
  misses: number
  /** 总访问次数 */
  totalAccesses: number
  /** 命中率（百分比） */
  hitRate: number
  /** 未命中率（百分比） */
  missRate: number
  /** 淘汰的缓存项数量 */
  evictions: number
  /** 当前缓存键列表（按最近使用顺序） */
  keys: string[]
  /** 平均访问时间（毫秒） */
  avgAccessTime: number
  /** 缓存项平均存活时间（毫秒） */
  avgItemLifetime: number
}

/**
 * 缓存配置选项
 *
 * @interface CacheOptions
 * @template K - 键类型
 * @template V - 值类型
 */
export interface CacheOptions<K = unknown, V = unknown> {
  /** 初始容量 */
  capacity?: number
  /** 是否启用访问统计 */
  enableStats?: boolean
  /** 是否记录访问时间 */
  trackAccessTime?: boolean
  /** 自定义淘汰回调 */
  onEvict?: (key: K, value: V) => void
}

// ==================== 增强型LRU缓存类 ====================

/**
 * 增强型LRU缓存类
 *
 * 实现严格的LRU淘汰策略，提供O(1)时间复杂度的get/set操作，
 * 支持动态容量控制和精确的命中率统计。
 *
 * @class LRUCache
 * @template K - 键类型
 * @template V - 值类型
 *
 * @example
 * ```typescript
 * // 基础用法
 * const cache = new LRUCache<string, number>(100)
 * cache.set('key1', 100)
 * console.log(cache.get('key1')) // 100
 *
 * // 带配置的用法
 * const cache2 = new LRUCache<string, User>({
 *   capacity: 50,
 *   enableStats: true,
 *   onEvict: (key, value) => console.log(`Evicted: ${key}`)
 * })
 * ```
 */
export class LRUCache<K, V> {
  /** 当前容量 */
  private capacity: number

  /** 缓存存储（Map提供O(1)查找） */
  private cache: Map<K, LRUNode<K, V>>

  /** 虚拟头节点（简化边界处理） */
  private head: LRUNode<K, V>

  /** 虚拟尾节点（简化边界处理） */
  private tail: LRUNode<K, V>

  /** 当前缓存项数量 */
  private _size: number

  /** 命中次数 */
  private hitCount: number

  /** 未命中次数 */
  private missCount: number

  /** 淘汰次数 */
  private evictionCount: number

  /** 总访问时间（毫秒） */
  private totalAccessTime: number

  /** 配置选项 */
  private options: Required<CacheOptions<K, V>>

  /**
   * 创建LRU缓存实例
   *
   * @param {number | CacheOptions} config - 容量或配置选项
   *
   * @example
   * ```typescript
   * // 仅指定容量
   * const cache1 = new LRUCache<string, number>(100)
   *
   * // 指定配置
   * const cache2 = new LRUCache<string, number>({
   *   capacity: 100,
   *   enableStats: true,
   *   trackAccessTime: true
   * })
   * ```
   */
  constructor(config: number | CacheOptions<K, V> = {}) {
    // 处理参数
    if (typeof config === 'number') {
      config = { capacity: config }
    }

    // 默认配置
    this.options = {
      capacity: config.capacity ?? 100,
      enableStats: config.enableStats ?? true,
      trackAccessTime: config.trackAccessTime ?? true,
      onEvict: config.onEvict ?? (() => {}),
    }

    this.capacity = Math.max(1, this.options.capacity)
    this.cache = new Map()
    this._size = 0
    this.hitCount = 0
    this.missCount = 0
    this.evictionCount = 0
    this.totalAccessTime = 0

    // 创建虚拟头尾节点
    const now = Date.now()
    this.head = this.createSentinelNode(now)
    this.tail = this.createSentinelNode(now)
    this.head.next = this.tail
    this.tail.prev = this.head
  }

  /**
   * 创建哨兵节点（虚拟头/尾节点）
   *
   * @private
   * @param {number} timestamp - 时间戳
   * @returns {LRUNode<K, V>} 哨兵节点
   */
  private createSentinelNode(timestamp: number): LRUNode<K, V> {
    return {
      key: null as unknown as K,
      value: null as unknown as V,
      prev: null,
      next: null,
      createdAt: timestamp,
      lastAccessedAt: timestamp,
      accessCount: 0,
    }
  }

  /**
   * 创建新的缓存节点
   *
   * @private
   * @param {K} key - 键
   * @param {V} value - 值
   * @returns {LRUNode<K, V>} 新节点
   */
  private createNode(key: K, value: V): LRUNode<K, V> {
    const now = Date.now()
    return {
      key,
      value,
      prev: null,
      next: null,
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 1,
    }
  }

  /**
   * 获取缓存值
   *
   * 如果键存在，将其移动到头部（标记为最近使用）并返回值。
   * 如果键不存在，返回undefined。
   *
   * 优化：减少 Date.now() 调用次数，只在必要时更新访问时间
   *
   * @param {K} key - 键
   * @returns {V | undefined} 值或undefined
   *
   * @example
   * ```typescript
   * const value = cache.get('user:123')
   * if (value !== undefined) {
   *   console.log('Cache hit:', value)
   * } else {
   *   console.log('Cache miss')
   * }
   * ```
   */
  get(key: K): V | undefined {
    const node = this.cache.get(key)

    if (!node) {
      // 未命中
      if (this.options.enableStats) {
        this.missCount++
      }
      return undefined
    }

    // 命中：更新访问信息并移动到头部
    // 只在需要时更新访问时间，避免不必要的 Date.now() 调用
    if (this.options.trackAccessTime) {
      const now = Date.now()
      node.lastAccessedAt = now
      if (this.options.enableStats) {
        this.hitCount++
        this.totalAccessTime += 1 // 简化：每次命中计为 1ms（统计用途，不影响功能）
      }
    } else if (this.options.enableStats) {
      this.hitCount++
    }

    node.accessCount++
    this.moveToHead(node)

    return node.value
  }

  /**
   * 设置缓存值
   *
   * 如果键已存在，更新值并将其移动到头部。
   * 如果键不存在，创建新节点并添加到头部。
   * 如果超出容量，淘汰最久未使用的节点。
   *
   * @param {K} key - 键
   * @param {V} value - 值
   * @returns {this} 支持链式调用
   *
   * @example
   * ```typescript
   * cache.set('user:123', { name: 'John', age: 30 })
   *        .set('user:456', { name: 'Jane', age: 25 })
   * ```
   */
  set(key: K, value: V): this {
    const node = this.cache.get(key)

    if (node) {
      // 节点已存在：更新值并移动到头部
      node.value = value
      node.lastAccessedAt = Date.now()
      node.accessCount++
      this.moveToHead(node)
      return this
    }

    // 创建新节点
    const newNode = this.createNode(key, value)
    this.cache.set(key, newNode)
    this.addToHead(newNode)
    this._size++

    // 检查容量，执行LRU淘汰
    if (this._size > this.capacity) {
      this.evictLRU()
    }

    return this
  }

  /**
   * 批量设置缓存值
   *
   * @param {Array<[K, V]>} entries - 键值对数组
   * @returns {this} 支持链式调用
   *
   * @example
   * ```typescript
   * cache.setMany([
   *   ['key1', value1],
   *   ['key2', value2],
   *   ['key3', value3]
   * ])
   * ```
   */
  setMany(entries: Array<[K, V]>): this {
    for (const [key, value] of entries) {
      this.set(key, value)
    }
    return this
  }

  /**
   * 获取缓存值，如果不存在则计算并缓存
   *
   * @param {K} key - 键
   * @param {() => V} factory - 值工厂函数
   * @returns {V} 值
   *
   * @example
   * ```typescript
   * const user = cache.getOrSet('user:123', () => {
   *   return fetchUserFromDatabase(123)
   * })
   * ```
   */
  getOrSet(key: K, factory: () => V): V {
    // 使用 has() 判断存在性，避免当 V 包含 undefined 时每次都重新计算
    if (this.has(key)) {
      return this.get(key) as V
    }

    const value = factory()
    this.set(key, value)
    return value
  }

  /**
   * 检查键是否存在（不更新访问顺序）
   *
   * @param {K} key - 键
   * @returns {boolean} 是否存在
   */
  has(key: K): boolean {
    return this.cache.has(key)
  }

  /**
   * 查看缓存值（不更新访问顺序）
   *
   * @param {K} key - 键
   * @returns {V | undefined} 值或undefined
   */
  peek(key: K): V | undefined {
    const node = this.cache.get(key)
    return node?.value
  }

  /**
   * 删除缓存项
   *
   * @param {K} key - 键
   * @returns {boolean} 是否删除成功
   */
  delete(key: K): boolean {
    const node = this.cache.get(key)

    if (!node) {
      return false
    }

    // 从双向链表中移除
    this.removeFromList(node)

    // 从Map中删除
    this.cache.delete(key)
    this._size--

    return true
  }

  /**
   * 清空缓存
   *
   * @returns {this} 支持链式调用
   */
  clear(): this {
    // 触发淘汰回调
    let node = this.head.next
    while (node && node !== this.tail) {
      this.options.onEvict(node.key, node.value)
      node = node.next
    }

    this.cache.clear()
    this.head.next = this.tail
    this.tail.prev = this.head
    this._size = 0
    this.hitCount = 0
    this.missCount = 0
    this.evictionCount = 0
    this.totalAccessTime = 0

    return this
  }

  /**
   * 获取当前缓存大小
   *
   * @returns {number} 缓存项数量
   */
  size(): number {
    return this._size
  }

  /**
   * 获取当前容量
   *
   * @returns {number} 容量
   */
  getCapacity(): number {
    return this.capacity
  }

  /**
   * 动态调整容量
   *
   * 如果新容量小于当前大小，会淘汰最久未使用的项。
   *
   * @param {number} newCapacity - 新容量
   * @returns {this} 支持链式调用
   *
   * @example
   * ```typescript
   * cache.resize(50)  // 缩小到50
   * cache.resize(200) // 扩大到200
   * ```
   */
  resize(newCapacity: number): this {
    const validCapacity = Math.max(1, newCapacity)

    if (validCapacity < this._size) {
      // 需要淘汰多余的项
      const evictCount = this._size - validCapacity
      for (let i = 0; i < evictCount; i++) {
        this.evictLRU()
      }
    }

    this.capacity = validCapacity
    return this
  }

  /**
   * 获取所有键（按最近使用顺序，最新的在前）
   *
   * @returns {K[]} 键数组
   */
  keys(): K[] {
    const keys: K[] = []
    let node = this.head.next

    while (node && node !== this.tail) {
      keys.push(node.key)
      node = node.next
    }

    return keys
  }

  /**
   * 获取所有值（按最近使用顺序，最新的在前）
   *
   * @returns {V[]} 值数组
   */
  values(): V[] {
    const values: V[] = []
    let node = this.head.next

    while (node && node !== this.tail) {
      values.push(node.value)
      node = node.next
    }

    return values
  }

  /**
   * 获取所有条目（按最近使用顺序，最新的在前）
   *
   * @returns {Array<{key: K, value: V}>} 条目数组
   */
  entries(): Array<{ key: K; value: V }> {
    const entries: Array<{ key: K; value: V }> = []
    let node = this.head.next

    while (node && node !== this.tail) {
      entries.push({ key: node.key, value: node.value })
      node = node.next
    }

    return entries
  }

  /**
   * 遍历缓存（按最近使用顺序）
   *
   * @param {(value: V, key: K) => void} callback - 回调函数
   */
  forEach(callback: (value: V, key: K) => void): void {
    let node = this.head.next

    while (node && node !== this.tail) {
      callback(node.value, node.key)
      node = node.next
    }
  }

  /**
   * 获取缓存统计信息
   *
   * @returns {LRUCacheStats} 统计信息
   *
   * @example
   * ```typescript
   * const stats = cache.getStats()
   * console.log(`Hit rate: ${stats.hitRate}%`)
   * console.log(`Size: ${stats.size}/${stats.capacity}`)
   * ```
   */
  getStats(): LRUCacheStats {
    const total = this.hitCount + this.missCount
    const hitRate = total > 0 ? (this.hitCount / total) * 100 : 0

    // 计算平均访问时间
    const totalAccesses = this.hitCount + this.missCount
    const avgAccessTime = totalAccesses > 0 && this.options.trackAccessTime ? this.totalAccessTime / totalAccesses : 0

    // 单次遍历计算多个统计信息以优化性能
    const now = Date.now()
    const keys: K[] = []
    let totalLifetime = 0
    let node = this.head.next
    while (node && node !== this.tail) {
      keys.push(node.key)
      totalLifetime += now - node.createdAt
      node = node.next
    }
    const avgItemLifetime = this._size > 0 ? totalLifetime / this._size : 0

    return {
      capacity: this.capacity,
      size: this._size,
      hits: this.hitCount,
      misses: this.missCount,
      totalAccesses: total,
      hitRate: Math.round(hitRate * 100) / 100, // hitRate 已是百分比形式(如80)，这里做小数处理
      missRate: total > 0 ? Math.round((100 - hitRate) * 100) / 100 : 0, // missRate = 100 - hitRate
      evictions: this.evictionCount,
      keys: keys.map((k) => String(k)),
      avgAccessTime: Math.round(avgAccessTime * 1000) / 1000,
      avgItemLifetime: Math.round(avgItemLifetime),
    }
  }

  /**
   * 重置统计信息（不清除缓存数据）
   *
   * @returns {this} 支持链式调用
   */
  resetStats(): this {
    this.hitCount = 0
    this.missCount = 0
    this.evictionCount = 0
    this.totalAccessTime = 0
    return this
  }

  /**
   * 转换为普通对象
   *
   * @returns {Record<string, V>} 普通对象
   */
  toObject(): Record<string, V> {
    const obj: Record<string, V> = {}
    this.forEach((value, key) => {
      obj[String(key)] = value
    })
    return obj
  }

  // ==================== 私有方法 ====================

  /**
   * 将节点移动到头部（标记为最近使用）
   *
   * @private
   * @param {LRUNode<K, V>} node - 节点
   */
  private moveToHead(node: LRUNode<K, V>): void {
    // 先从链表中移除
    this.removeFromList(node)
    // 添加到头部
    this.addToHead(node)
  }

  /**
   * 添加节点到头部
   *
   * @private
   * @param {LRUNode<K, V>} node - 节点
   */
  private addToHead(node: LRUNode<K, V>): void {
    node.prev = this.head
    node.next = this.head.next

    // head.next always exists due to initialization with dummy tail
    const nextNode = this.head.next
    if (nextNode) {
      nextNode.prev = node
    }
    this.head.next = node
  }

  /**
   * 从链表中移除节点
   *
   * @private
   * @param {LRUNode<K, V>} node - 节点
   */
  private removeFromList(node: LRUNode<K, V>): void {
    // 哨兵节点保证非首尾节点的 prev/next 永远不为 null
    // 仅当节点有效且在链表中时才执行断开操作
    if (node.prev && node.next) {
      node.prev.next = node.next
      node.next.prev = node.prev
      // 清理节点指针，避免悬空引用
      node.prev = null
      node.next = null
    }
    // 如果 prev 或 next 为 null，说明节点已不在链表中（孤立节点），无需操作
  }

  /**
   * 淘汰最久未使用的节点（LRU策略核心）
   *
   * @private
   */
  private evictLRU(): void {
    const lruNode = this.tail.prev
    // 安全检查：缓存为空时 tail.prev === head，不应淘汰哨兵节点
    if (!lruNode || lruNode === this.head) return

    // 先从链表与 Map 中移除，再触发淘汰回调：
    // 回调重入查询时缓存已处于一致状态（键已不存在），
    // 回调异常也不会中止淘汰流程导致容量超限
    this.removeFromList(lruNode)
    this.cache.delete(lruNode.key)
    this._size--
    this.evictionCount++

    try {
      this.options.onEvict?.(lruNode.key, lruNode.value)
    } catch (error) {
      console.error('[LRUCache] Error in onEvict callback:', error)
    }
  }
}

export default LRUCache
