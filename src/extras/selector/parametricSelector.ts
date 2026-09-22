/**
 * GeomStore - 参数化选择器
 *
 * 自 createSelector.ts 拆出：接受参数的选择器工厂，对不同参数独立缓存。
 *
 * @module selector/parametricSelector
 */

import type { State } from '../../types/store.js'
import { deepEqual, clone } from '../../core/utils/helpers.js'
import { getStateVersion } from '../../core/store/stateVersion.js'

/**
 * 创建参数化选择器
 *
 * 创建一个接受参数的选择器，支持对不同参数的缓存
 *
 * @template S - 状态类型
 * @template P - 参数类型
 * @template R - 返回值类型
 * @param {(state: S, params: P) => R} selectorFn - 接受参数的选择器函数
 * @param {object} [options] - 缓存配置选项
 * @param {number} [options.ttl=5000] - 缓存生存时间（毫秒）。除 TTL 外，每次调用还会用
 *   deepEqual 校验 state 内容快照：Store 状态就地变异（引用不变）时立即作废该 state 下的
 *   全部参数缓存，不会在 TTL 内返回陈旧值
 * @param {number} [options.maxEntries=1000] - 单个 state 下原始类型参数的缓存条目上限
 * @returns {(state: S) => (params: P) => R} 参数化选择器工厂
 *
 * 限制：与 createSelector 相同——校验所用的 state 快照由 clone（deepCloneState）生成，
 * 它对不可克隆对象（类实例、Promise、WeakMap/WeakSet 等）保留原引用，因此这类对象被
 * 就地变异时校验会因引用相等判定「未变化」，TTL 内返回陈旧值。规避：用 setState/$patch
 * 整体替换该字段。
 *
 * 参数缓存两侧的形状**不对称**（有意保留，调用侧需知悉）：
 * - 原始类型参数走 Map：受 `maxEntries` 约束，写入接近上限时清扫过期项并按插入序淘汰。
 * - 对象参数走 WeakMap：过期条目只在读取侧按 TTL 判 miss（随后覆写），**没有后台清扫**，
 *   也**不受 `maxEntries` 约束**（该上限只作用于上面那条 Map）。因此对象的条目只在
 *   「参数对象自身被 GC」时释放——长寿命的参数对象会一直带着它最后一次算出的 value 与 timestamp。
 * - 复用同一个参数对象、原地改它的内容：WeakMap 的键引用不变，TTL 内命中的是改内容**之前**
 *   的结果（失效凭证只有 state 侧的版本/快照，参数侧没有）。规避：每次传新对象，
 *   或把参与派生的值作为原始类型参数传入。
 *
 * 不给对象侧补容量上限的原因：WeakMap 既无 size 也无法迭代，要计数就得另存一份键列表，
 * 那会把弱引用换成强引用、反而造成本要避免的泄漏。
 *
 * @example
 * ```typescript
 * const getUserById = createParametricSelector(
 *   (state, userId) => state.users[userId],
 *   { ttl: 10000 } // 自定义缓存有效期
 * )
 *
 * const getUser = getUserById(store.state)
 *
 * // 使用不同的参数
 * const user1 = getUser('user1')
 * const user2 = getUser('user2')
 * // 每个参数独立缓存
 * ```
 */
export function createParametricSelector<S extends State, P, R>(
  selectorFn: (state: S, params: P) => R,
  options: { ttl?: number; maxEntries?: number } = {},
): (state: S) => (params: P) => R {
  const { ttl = 5000, maxEntries = 1000 } = options

  // 使用 WeakMap 缓存，避免内存泄漏
  // 外层 WeakMap: state object -> 内层缓存
  // 对于对象参数使用 WeakMap，原始类型使用 Map
  //
  // snapshot 字段：Store 状态是就地变异的同一对象（getState 返回活动引用、
  // setState/$patch 原地写入），WeakMap 键引用恒定，仅靠 TTL 失效会在状态已变化时
  // 误命中并返回陈旧值（与 SelectorFactory.updateCache 缓存 clone 快照同理）。
  // 命中前用 deepEqual 校验快照，不等则整体作废内层缓存并刷新快照
  const stateCache = new WeakMap<
    object,
    {
      /** 状态版本号（Store 状态）；undefined 表示无版本标记，回退快照 + deepEqual 校验 */
      version?: number
      snapshot: S
      objectParamsCache: WeakMap<object, { value: R; timestamp: number }>
      primitiveParamsCache: Map<string | number | boolean | symbol | null | undefined, { value: R; timestamp: number }>
    }
  >()

  /**
   * 原始类型参数缓存写入前的维护：清理过期条目，
   * 超容量时淘汰最早插入条目（Map 保持插入顺序），
   * 避免高基数参数场景下 Map 无界增长
   */
  const maintainPrimitiveCache = (cacheMap: Map<string | number | boolean | symbol | null | undefined, { value: R; timestamp: number }>, now: number): void => {
    // 仅在接近容量上限时才做清理：过期条目在读取侧已按 timestamp + ttl 判定（不会命中），
    // 故无需每次写入都全表扫描（此前每次写入都遍历至多 maxEntries 条，高基数参数下开销显著）
    if (cacheMap.size < maxEntries) {
      return
    }
    if (ttl > 0) {
      for (const [key, entry] of cacheMap) {
        if (entry.timestamp + ttl <= now) {
          cacheMap.delete(key)
        }
      }
    }
    for (const key of cacheMap.keys()) {
      if (cacheMap.size < maxEntries) {
        break
      }
      cacheMap.delete(key)
    }
  }

  return (state: S) => {
    return (params: P): R => {
      const now = Date.now()

      // 获取或创建 state 对应的缓存
      const version = getStateVersion(state)
      let cache = stateCache.get(state as object)
      if (!cache) {
        cache = {
          version,
          // 有版本号时无需内容快照：命中校验改用版本比较
          snapshot: version === undefined ? clone(state) : state,
          objectParamsCache: new WeakMap(),
          primitiveParamsCache: new Map(),
        }
        stateCache.set(state as object, cache)
      } else if (version !== undefined) {
        // 版本化快路径：O(1) 整数比较判定状态是否变化，免去此前每次调用
        // 都要对整棵状态树做一次 deepEqual 的开销（长列表逐行取数时是 O(N×T)）
        if (cache.version !== version) {
          // 状态已就地变异（WeakMap 键引用不变）：两份参数缓存全部作废，
          // 否则 TTL 内会命中变异前的陈旧结果
          cache.objectParamsCache = new WeakMap()
          cache.primitiveParamsCache = new Map()
          cache.version = version
          cache.snapshot = state
        }
      } else if (cache.version !== undefined || !deepEqual(cache.snapshot, state)) {
        // 回退：无版本标记（普通对象），沿用快照 + deepEqual 校验；
        // 但「版本化缓存 vs 已失去版本标记的状态」必须按 miss 处理——版本化条目的 snapshot
        // 存的是活引用，deepEqual(自身, 自身) 恒相等，会把该 state 下的参数缓存钉在 TTL 内
        // 一直命中陈旧值（与 createSelector.isCacheHit 拒绝版本化条目匹配无版本输入同理）。
        // 此处一并把 version 降级为 undefined：否则该 state 之后每次调用都走本分支，
        // 反复重建快照、缓存形同虚设
        cache.objectParamsCache = new WeakMap()
        cache.primitiveParamsCache = new Map()
        cache.version = version
        cache.snapshot = clone(state)
      }

      // 根据参数类型选择不同的缓存策略
      const isObjectParam = typeof params === 'object' && params !== null

      if (isObjectParam) {
        // 对象参数：使用 WeakMap 避免内存泄漏
        const cached = cache.objectParamsCache.get(params as object)
        if (cached && cached.timestamp + ttl > now) {
          return cached.value
        }

        // 执行选择器
        const value = selectorFn(state, params)

        // 存入缓存
        cache.objectParamsCache.set(params as object, { value, timestamp: now })

        return value
      } else {
        // 原始类型参数：使用普通 Map
        const cacheKey = params as string | number | boolean | symbol | null | undefined
        const cached = cache.primitiveParamsCache.get(cacheKey)
        if (cached && cached.timestamp + ttl > now) {
          return cached.value
        }

        // 执行选择器
        const value = selectorFn(state, params)

        // 存入缓存（写入前维护容量与过期条目）
        maintainPrimitiveCache(cache.primitiveParamsCache, now)
        cache.primitiveParamsCache.set(cacheKey, { value, timestamp: now })

        return value
      }
    }
  }
}
