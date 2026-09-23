/**
 * GeomStore - 缓存模块类型定义
 *
 * 自 LRUCache.ts 拆出：LRU 链表节点、统计信息与配置选项。
 *
 * @module cache/types
 */

/**
 * LRU缓存节点
 *
 * 双向链表节点，用于维护访问顺序
 * @interface LRUNode
 * @template K - 键类型
 * @template V - 值类型
 */
export interface LRUNode<K, V> {
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
}

/**
 * LRU缓存统计信息
 *
 * @interface LRUCacheStats
 */
export interface LRUCacheStats {
  /**
   * 缓存容量：实现保证的是「有限值且 >= 1」，**不保证整数**。
   *
   * 规范化只发生在写入 capacity 的两处（构造器与 `resize()`）：非有限值（NaN/±Infinity）
   * 分别回退默认 100 与保持旧值，小于 1 的值夹到 1；小数上限不会被取整，
   * 淘汰判定 `size > capacity` 因而等价于「最多容纳 floor(capacity) 个条目」。
   * 这里读到的是生效容量，不是用户传入的原值。
   */
  capacity: number
  /** 当前缓存项数量 */
  size: number
  /** 缓存命中次数 */
  hits: number
  /** 缓存未命中次数 */
  misses: number
  /** 总访问次数 */
  totalAccesses: number
  /**
   * 命中率：**0–100 的百分比数值**（非 0–1 比例），保留两位小数。
   *
   * 哨兵语义：`totalAccesses === 0` 时返回 `0`，表示「无访问数据」而非「0% 命中」。
   * 调用方需区分两者时请按 `totalAccesses > 0` 判定，不要用 `hitRate === 0` 判「全未命中」。
   */
  hitRate: number
  /**
   * 未命中率：**0–100 的百分比数值**，保留两位小数，口径与 `hitRate` 一致
   * （两者按各自计数独立求值，和为 100，仅有两位小数的舍入误差）。
   *
   * 哨兵语义：`totalAccesses === 0` 时返回 `0`，表示「无访问数据」而非「0% 未命中」。
   */
  missRate: number
  /**
   * 淘汰次数：契约是 `onEvict` 回调的触发次数（`clear()` 等配置性清空亦逐条计入），
   * **并非**「因容量上限被挤出的条目数」。
   *
   * 因此把 `clear()` 用于配置性重建（如 `StoreCacheManager.enable()`）时，
   * 该计数会包含这部分非容量淘汰；需区分两类淘汰的调用方，
   * 可在配置性清空前后各读一次 `evictions` 求差。
   */
  evictions: number
  /**
   * 当前缓存键列表（按最近使用顺序）
   *
   * 键经 `String(key)` 序列化：非字符串键会丢失类型信息，对象键会塌缩为
   * `[object Object]`、数字 1 与字符串 '1' 不可区分。仅用于调试展示，
   * 不得用作键的身份判定（需要原始键请用 `LRUCache.keys()`）。
   */
  keys: string[]
  /**
   * 平均访问时间（毫秒，保留三位小数）：仅统计命中路径的收尾成本。
   *
   * 哨兵语义：`0` 有两种来源——「无命中」（hits === 0）与「未开启计时/统计」
   * （`trackAccessTime` 或 `enableStats` 为 false），**不表示访问耗时真是 0ms**。
   * 展示前请先确认 `hits > 0` 且构造时开启了计时。
   */
  avgAccessTime: number
  /**
   * 缓存项平均存活时间（毫秒，四舍五入到整数）：`now - createdAt` 的均值。
   *
   * 哨兵语义：空缓存（`size === 0`）返回 `0`，表示「无条目」而非「存活 0ms」。
   */
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
  /**
   * 初始容量（默认 100）
   *
   * 规范化规则与 `LRUCacheStats.capacity` 一致：非有限值（NaN/±Infinity）回退默认 100，
   * 小于 1 的值夹到 1，小数不取整（等效上限为 `floor(capacity)` 条）。
   * 构造后改动此字段不会生效——实例只保留归一化后的单一份容量（见 `getCapacity()`）。
   */
  capacity?: number
  /** 是否启用访问统计 */
  enableStats?: boolean
  /** 是否记录访问时间 */
  trackAccessTime?: boolean
  /** 自定义淘汰回调 */
  onEvict?: (key: K, value: V) => void
}
