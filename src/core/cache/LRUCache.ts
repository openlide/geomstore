/**
 * GeomStore - 增强型LRU缓存系统
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
// 类型已拆至 ./types.js；此处再导出以保持既有导入路径（core/cache/LRUCache.js）不变
export type { CacheOptions, LRUCacheStats } from './types.js'

import type { CacheOptions, LRUCacheStats, LRUNode } from './types.js'

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
/** 高精度时间戳（毫秒）：performance.now 具亚毫秒精度，访问耗时统计依赖它 */
function highResNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

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

  /**
   * 淘汰进行中：onEvict 回调重入 set()/resize() 时不再启动第二层淘汰循环。
   * 重入的写入交给外层循环消化（回调返回后外层 while 会重新核对容量），
   * 否则「回调内回填刚被逐出的键」会一层套一层递归，直到 RangeError 栈溢出。
   */
  private evicting = false

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

    // NaN/Infinity 容量会使 Math.max 产生 NaN，_size > NaN 恒为 false → 缓存无界；
    // 非有限值回退默认容量
    this.capacity = Number.isFinite(this.options.capacity) ? Math.max(1, this.options.capacity) : 100
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
    return {
      key,
      value,
      prev: null,
      next: null,
      createdAt: Date.now(),
    }
  }

  /**
   * 获取缓存值
   *
   * 如果键存在，将其移动到头部（标记为最近使用）并返回值。
   * 如果键不存在，返回undefined。
   *
   * 优化：时钟调用只在「开启统计且开启计时」的命中路径发生，未命中不取时钟
   *
   * @remarks `trackAccessTime` 只影响 `avgAccessTime` 的采样，不影响 LRU 顺序：
   * 顺序始终由 `moveToHead`（访问即最近使用）决定。
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

    // 计时起点在「确认命中之后」取：此前每次访问都先取一次高精度时钟，
    // 未命中路径把它整次丢弃（未命中也要付一次时钟调用）。
    // 测量区间随之变为命中相对未命中多做的收尾工作（计数 + 摘链/挂链）
    const measure = this.options.trackAccessTime && this.options.enableStats
    const timing = measure ? highResNow() : 0

    if (this.options.enableStats) {
      this.hitCount++
    }
    this.moveToHead(node)
    if (measure) {
      // 真实访问耗时（此前恒记 1ms，avgAccessTime 是无意义假数据）
      this.totalAccessTime += highResNow() - timing
    }

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
      // 节点已存在：更新值并移动到头部。
      // 不再写 lastAccessedAt/accessCount 元数据：二者在全库内无任何读取方
      // （LRU 顺序由链表决定，统计走 hitCount/totalAccessTime），
      // 且 set() 原本无条件盖时间戳，与 get() 的 trackAccessTime 门控互相矛盾
      node.value = value
      this.moveToHead(node)
      return this
    }

    // 创建新节点
    const newNode = this.createNode(key, value)
    this.cache.set(key, newNode)
    this.addToHead(newNode)
    this._size++

    // 检查容量，执行LRU淘汰。
    // 用循环而非单次 if：onEvict 回调可能重入 set()（回调里回填数据），
    // 单次淘汰后尺寸可能仍超限，容量不变量会永久失效。
    // 重入保护：淘汰进行中回调里再 set() 只写入、不开第二层淘汰循环（由本帧统一收敛），
    // 否则「回填被逐出的键」会一层套一层递归，几百次写入即 RangeError 栈溢出。
    // 预算取代「净尺寸没减少就 break」：回调回填会抵消淘汰带来的减量，按净尺寸判定会
    // 提前收手、把容量永久留在超限档位（回填有限时应收敛到新容量）；
    // 按「本轮至多淘汰 entrySize 个」判定则既收敛又有界。
    // 残余限制：回调每次都把被逐出的键原样填回来时，淘汰与回填互相抵消，尺寸会随写入缓增
    // ——这种回调本身就要了比容量更多的条目，库只保证不崩、不在单帧内无界循环
    const evictionBudget = this._size
    let evictions = 0
    while (!this.evicting && this._size > this.capacity && evictions < evictionBudget) {
      this.evictLRU()
      evictions++
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

    // 未命中同样计入统计：getOrSet 只在命中路径经 get 计 hit，
    // miss 不落账会让 hitRate 系统性偏高
    if (this.options.enableStats) {
      this.missCount++
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
   * @remarks 清空按「逐条淘汰」口径记账：每个条目触发一次 `onEvict`，
   * 并累计计入 `getStats().evictions`（该字段的契约是「onEvict 触发次数」，
   * 而非「因容量上限被挤出的条目数」）。因此把 `clear()` 用于配置性重建
   * （如 `StoreCacheManager.enable()`）时，`evictions` 会包含这部分非容量淘汰；
   * 需要区分两类淘汰的调用方，可在配置性清空前后各读一次 `evictions` 求差。
   *
   * @returns {this} 支持链式调用
   */
  clear(): this {
    // 先快照并整体摘链，再逐个触发回调：迭代中调用 onEvict 若回调内
    // 调用 delete()（淘汰回写场景的合理操作），removeFromList 会把 node.next
    // 置 null 导致遍历提前终止、剩余条目不触发回调
    const nodes: Array<{ key: unknown; value: unknown }> = []
    let node = this.head.next
    while (node && node !== this.tail) {
      nodes.push({ key: node.key, value: node.value })
      node = node.next
    }

    this.cache.clear()
    this.head.next = this.tail
    this.tail.prev = this.head
    this._size = 0

    // clear 触发的全量回调与 evictLRU 同口径计入淘汰统计；
    // 单个回调抛错不中断其余条目，错误上报也与 evictLRU 一致（不受 NODE_ENV 门控，
    // 否则同一类回调故障在两处的可见性不同）
    this.evictionCount += nodes.length
    for (const entry of nodes) {
      try {
        this.options.onEvict(entry.key as K, entry.value as V)
      } catch (error) {
        console.error('[LRUCache] Error in onEvict callback:', error)
      }
    }

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
    // 与构造器同守卫：NaN/Infinity 容量会让淘汰判定失效导致缓存无界
    const validCapacity = Number.isFinite(newCapacity) ? Math.max(1, newCapacity) : this.capacity

    // 先落定容量再淘汰：onEvict 回调可能重入 set()，只有容量已更新，
    // 重入写入才不会按旧上限继续扩容；循环条件也保证回调重入后仍收敛到新容量。
    // 淘汰预算与收敛判据同 set()：回调重入的写入由本帧继续淘汰
    this.capacity = validCapacity
    const evictionBudget = this._size
    let evictions = 0
    while (!this.evicting && this._size > this.capacity && evictions < evictionBudget) {
      this.evictLRU()
      evictions++
    }

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
      // 先取后继再回调：回调内删除当前节点会经 removeFromList 把 next 置空，
      // 活指针遍历会在下一步中断，剩余条目被静默跳过
      const next = node.next
      callback(node.value, node.key)
      node = next
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

    // totalAccessTime 仅在命中路径累加：按命中次数求平均，
    // 用 hit+miss 做分母会系统性稀释平均值
    const avgAccessTime = this.hitCount > 0 && this.options.trackAccessTime ? this.totalAccessTime / this.hitCount : 0

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
      // missRate 直接由计数计算，与 hitRate 同口径；经 100-hitRate 推导会累积舍入偏差
      missRate: total > 0 ? Math.round((this.missCount / total) * 10000) / 100 : 0,
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
      // 以 DefineOwnProperty 语义写入：缓存键可来自 state 的自有键，而 state 可合法
      // 含自有 __proto__ 键（helpers.ts 的 deepMerge/set 有意用 defineOwnProperty 写入）。
      // obj[key] = value 走 [[Set]]，会触发 Object.prototype 的 __proto__ setter——
      // 该键被静默丢弃且 obj 原型被换掉。defineProperty 只定义自有数据属性，不触发 setter
      Object.defineProperty(obj, String(key), {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      })
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
      // 标记本帧淘汰进行中：回调内重入的 set()/resize() 只写入、不再开启第二层
      // 淘汰循环（嵌套淘汰会在每次回填时再递归一层，capacity=1 时直接栈溢出）
      this.evicting = true
      this.options.onEvict?.(lruNode.key, lruNode.value)
    } catch (error) {
      console.error('[LRUCache] Error in onEvict callback:', error)
    } finally {
      this.evicting = false
    }
  }
}
