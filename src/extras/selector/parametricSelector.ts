/**
 * GeomStore - 参数化选择器
 *
 * 自 createSelector.ts 拆出：接受参数的选择器工厂，对不同参数独立缓存。
 *
 * @module selector/parametricSelector
 */

import type { State } from '../../types/store.js'
import type { ParametricSelectorFactory } from '../../types/selector.js'
import { deepEqual, clone } from '../../core/utils/helpers.js'
import { getStateVersion } from '../../core/store/stateVersion.js'

/**
 * 能作 Map 键的参数值类型：非对象/非函数的全部 `typeof` 结果，含 `bigint`
 * （`bigint` 既不是 WeakMap 的合法键，也不在早先那份手写的联合里，
 *  补上它才能让「原始侧」的键类型与实际可能收到的参数一致，不再靠断言遮掩）
 */
type PrimitiveParamKey = string | number | boolean | symbol | bigint | null | undefined

/**
 * 能否作 WeakMap 的键：对象与函数皆可（`null` 除外，它不是任何意义上的引用型键）
 *
 * 函数必须与对象同侧：它既是合法的弱键，落到强引用的 Map 里还会连带钉住闭包捕获的作用域，
 * 与「对象参数走 WeakMap、随参数对象一起被 GC」的承诺相反
 */
function isWeakMapKey(value: unknown): value is object {
  return typeof value === 'function' || (typeof value === 'object' && value !== null)
}

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
 *   全部参数缓存，不会在 TTL 内返回陈旧值。
 *   `<= 0` / `NaN` 表示「条目立即过期」，即不缓存（与 `SelectorOptions.cacheTTL` 的归一化口径
 *   刻意不同：那里 `NaN` 会变成永不过期、属静默陈旧，故被拒绝；此处两种写法都退化为不缓存，
 *   不存在返回陈旧值的风险，也就没有归一化的必要）。`Infinity` 表示只由版本/快照失效
 * @param {number} [options.maxEntries=1000] - 单个 state 下原始类型参数的缓存条目上限。
 *   归一化口径同 `SelectorOptions.cacheSize`：`Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 1000`，
 *   即 0 / 负数夹到 1、`NaN` / `Infinity` / 未提供回到 1000（不夹会让上限形同虚设或表无界增长）
 * @returns {(state: S) => (params: P) => R} 参数化选择器工厂
 *
 * 限制：与 createSelector 相同——校验所用的 state 快照由 clone（deepCloneState）生成，
 * 它对不可克隆对象（类实例、Promise、WeakMap/WeakSet 等）保留原引用，因此这类对象被
 * 就地变异时校验会因引用相等判定「未变化」，TTL 内返回陈旧值。规避：用 setState/$patch
 * 整体替换该字段。
 *
 * 参数缓存两侧的形状**不对称**（有意保留，调用侧需知悉）：
 * - 原始类型参数走 Map：受 `maxEntries` 约束，写入接近上限时清扫过期项并按插入序淘汰。
 * - 对象**与函数**参数走 WeakMap（两者都是只能靠弱引用承载的键）：过期条目只在读取侧按 TTL
 *   判 miss（随后覆写），**没有后台清扫**，也**不受 `maxEntries` 约束**（该上限只作用于上面那条
 *   Map）。因此对象的条目只在「参数对象自身被 GC」时释放——长寿命的参数对象会一直带着它最后
 *   一次算出的 value 与 timestamp。
 * - 复用同一个参数对象、原地改它的内容：WeakMap 的键引用不变，TTL 内命中的是改内容**之前**
 *   的结果（失效凭证只有 state 侧的版本/快照，参数侧没有）。规避：每次传新对象，
 *   或把参与派生的值作为原始类型参数传入。
 *
 * 不给对象侧补容量上限的原因：WeakMap 既无 size 也无法迭代，要计数就得另存一份键列表，
 * 那会把弱引用换成强引用、反而造成本要避免的泄漏。
 *
 * 状态侧的降级：`state` 不是对象时（未类型化的 JS 调用方传 null / 原始值）WeakMap 无法作键，
 * 该 state 下的每次调用直接重算、不缓存——不是错误，也不抛错。
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
): ParametricSelectorFactory<S, P, R> {
  const { ttl = 5000 } = options
  // maxEntries 归一化，口径同 SelectorFactory 的 cacheSize（Number.isFinite 守卫 + 夹到 >= 1）：
  // 0 / 负数不夹的话 `cacheMap.size < maxEntries` 恒假 → 淘汰循环一路删到空表，随后的 set 仍
  // 写入一条，等于「上限为 0 却仍有缓存值可取」；NaN 同样让该比较恒假（同上），
  // `Infinity` 则让它恒真 → 提前 return，条目只增不减（上限形同虚设、表无界增长）；
  // 非整数按 floor 取整，避免「上限」与实存条目数不一致
  const maxEntries = Number.isFinite(options.maxEntries) ? Math.max(1, Math.floor(options.maxEntries as number)) : 1000

  // 使用 WeakMap 缓存，避免内存泄漏
  // 外层 WeakMap: state object -> 内层缓存
  // 对于对象参数使用 WeakMap，原始类型使用 Map
  //
  // snapshot 字段：Store 状态是就地变异的同一对象（getState 返回活动引用、
  // setState/$patch 原地写入），WeakMap 键引用恒定，仅靠 TTL 失效会在状态已变化时
  // 误命中并返回陈旧值（与 SelectorFactory.updateCache 缓存 clone 快照同理）。
  // 命中前用 deepEqual 校验快照，不等则整体作废内层缓存并刷新快照。
  //
  // 为什么这里没有 SelectorOptions.snapshotState 那一档开关（两处看似同一件事，实则不同轴）：
  // createSelector 的快照是为**用户传入的 equalityFn** 准备的失效凭证，用户可给引用相等
  // （`(a, b) => a === b`）的比较器，那时快照与活引用永不相等、必须允许关；
  // 本工厂的比较器写死是 deepEqual，关掉快照就得到 `deepEqual(state, state)` ≡ 恒真，
  // 等于把无版本路径上唯一的失效信号删掉（只剩 TTL 兜陈旧值），没有可用收益，故不提供该选项
  const stateCache = new WeakMap<
    object,
    {
      /** 状态版本号（Store 状态）；undefined 表示无版本标记，回退快照 + deepEqual 校验 */
      version?: number
      /**
       * 状态内容快照，**只在无版本标记的回退路径上存在**（此时它是唯一的失效凭证，
       * 缺了它 `deepEqual` 就会拿活引用跟自己比、恒等，就地变异永不被发现）。
       * 带版本号时不写此字段：版本比较已是失效凭证，快照既不被读又白留一份引用
       */
      snapshot?: S
      objectParamsCache: WeakMap<object, { value: R; timestamp: number }>
      primitiveParamsCache: Map<PrimitiveParamKey, { value: R; timestamp: number }>
    }
  >()

  /**
   * 原始类型参数缓存写入前的维护：清理过期条目，
   * 超容量时淘汰最早插入条目（Map 保持插入顺序），
   * 避免高基数参数场景下 Map 无界增长
   */
  const maintainPrimitiveCache = (cacheMap: Map<PrimitiveParamKey, { value: R; timestamp: number }>, now: number): void => {
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
    // 状态守卫与 getStateVersion 同口径：WeakMap.get 对非对象键恒返回 undefined，
    // 而 WeakMap.set 直接抛 `TypeError: Invalid value used as weak map key`。
    // 类型上 S extends State（即 object），但未类型化的 JS 调用方仍可传 null / 原始值，
    // 那是「没有缓存可用」的降级路径，不该变成崩溃路径：该 state 下每次直接重算、不缓存
    const stateKey: unknown = state
    if (stateKey === null || typeof stateKey !== 'object') {
      return (params: P): R => selectorFn(state, params)
    }

    return (params: P): R => {
      const now = Date.now()

      // 获取或创建 state 对应的缓存
      const version = getStateVersion(state)
      let cache = stateCache.get(stateKey)
      if (!cache) {
        cache = {
          version,
          // 有版本号时无需内容快照：命中校验改用版本比较（快照既不读又留一份强引用）
          snapshot: version === undefined ? clone(state) : undefined,
          objectParamsCache: new WeakMap(),
          primitiveParamsCache: new Map(),
        }
        stateCache.set(stateKey, cache)
      } else if (version !== undefined) {
        // 版本化快路径：O(1) 整数比较判定状态是否变化，免去此前每次调用
        // 都要对整棵状态树做一次 deepEqual 的开销（长列表逐行取数时是 O(N×T)）
        if (cache.version !== version) {
          // 状态已就地变异（WeakMap 键引用不变）：两份参数缓存全部作废，
          // 否则 TTL 内会命中变异前的陈旧结果。
          // 不写 snapshot：版本化条目下它没有任何读取方（见缓存条目形状处的说明）
          cache.objectParamsCache = new WeakMap()
          cache.primitiveParamsCache = new Map()
          cache.version = version
        }
      } else if (cache.version !== undefined || !deepEqual(cache.snapshot, state)) {
        // 回退：无版本标记（普通对象），沿用快照 + deepEqual 校验；
        // 但「版本化缓存 vs 已失去版本标记的状态」必须按 miss 处理——版本化条目不留快照
        // （`deepEqual(undefined, state)` 也判不等），它原先的参数缓存是在另一套失效凭证下
        // 攒起来的，与 createSelector.isCacheHit 拒绝版本化条目匹配无版本输入同理。
        // 此处一并把 version 降级为 undefined：否则该 state 之后每次调用都走本分支，
        // 反复重建快照、缓存形同虚设
        cache.objectParamsCache = new WeakMap()
        cache.primitiveParamsCache = new Map()
        cache.version = version
        cache.snapshot = clone(state)
      }

      // 参数分侧：可作 WeakMap 键的值（对象**与函数**）走弱引用侧，其余走 Map 侧。
      // 用类型谓词而不是 `isObjectParam` 布尔量 + `as object` 断言：断言正是此前
      // 「函数被静默判给原始侧」藏身的地方，谓词让编译器帮忙守住两侧键类型的完整性
      if (isWeakMapKey(params)) {
        // 对象参数：使用 WeakMap 避免内存泄漏
        const cached = cache.objectParamsCache.get(params)
        if (cached && cached.timestamp + ttl > now) {
          return cached.value
        }

        // 执行选择器
        const value = selectorFn(state, params)

        // 存入缓存
        cache.objectParamsCache.set(params, { value, timestamp: now })

        return value
      } else {
        // 原始类型参数：使用普通 Map。函数值已在上面被分走，这里的收窄与
        // PrimitiveParamKey 覆盖的 typeof 结果一一对应（含 bigint）
        const cacheKey = params as PrimitiveParamKey
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
