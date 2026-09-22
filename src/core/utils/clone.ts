/**
 * GeomStore - 状态克隆工具
 *
 * 将深拷贝实现从 `core/store/utils` 迁移至此，使 `core/utils` 成为自包含的
 * 工具层，消除 `utils → store` 的层级倒置（此前 helpers.clone 需从 store/utils
 * 引入 deepCloneState）。克隆语义与 Store 内部保持一致。
 */

/**
 * 深拷贝状态
 *
 * 统一使用递归克隆实现（不依赖 structuredClone），原因：
 * - structuredClone 对函数/Symbol/WeakMap/Promise 等值会抛 DataCloneError，
 *   而 State 类型允许此类值，崩溃会把故障面扩大到所有 createStore 调用；
 * - structuredClone 会剔除值为 undefined 的属性（结构化克隆算法语义），
 *   与旧基础库（无 structuredClone）的降级路径行为分叉，难以排查；
 *
 * 递归实现相比 JSON 往返：
 * - 支持循环引用（WeakMap 守卫，不会栈溢出）
 * - 保留 undefined 属性与 Date/RegExp/Map/Set 实例
 * - 不可克隆对象（WeakMap/Promise/Blob 等）保留原引用，避免崩溃
 *
 * 别名（同一对象被多处引用）的保留范围要说清：Map/Set/数组/纯对象在克隆前先把自己
 * 写进 visited，故多处引用共享同一副本；**Date/RegExp 每次调用都新建实例且不登记
 * visited**——`{ a: d, b: d }` 与 `[d, d]` 都会得到两个不同 Date（两条路径同样不共享，
 * 不存在对象/数组之间的口径差异）。这是有意取舍：
 * - Date/RegExp 无法承载循环引用，登记 visited 只为别名一致性，收益远小于多一次
 *   WeakMap 读写（克隆在 setState/$patch 热路径上）；
 * - 由此带来的第二个后果是**实例上的自有可枚举扩展属性会被丢弃**（`d.tag = 1` 不复制），
 *   RegExp 的 `lastIndex` 也不保留（`new RegExp(source, flags)` 重置为 0）。
 * State 语义上不该依赖这三者，若确有需求请改用普通对象承载；本轮不改为行为，
 * 避免让既有快照/比较结果在版本间漂移（deepEqual 的 Date/RegExp 分支同样只看
 * getTime 与 source/flags，忽略扩展属性，两处的窄口径是一致的）
 */
export function deepCloneState<T>(state: T): T {
  return fallbackClone(state)
}

/** 带循环引用守卫的递归克隆 */
function fallbackClone<T>(value: T, seen?: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== 'object') {
    // 函数等不可克隆值保留原引用（函数无内部状态，共享无副作用）
    return value
  }

  const visited = seen ?? new WeakMap<object, unknown>()
  const cached = visited.get(value as object)
  if (cached !== undefined) {
    return cached as T
  }

  // 新建实例、不登记 visited（详见 deepCloneState 的别名/扩展属性口径）
  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }

  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T
  }

  if (value instanceof Map) {
    const map = new Map()
    visited.set(value as object, map)
    value.forEach((mapValue, mapKey) => {
      map.set(fallbackClone(mapKey, visited), fallbackClone(mapValue, visited))
    })
    return map as unknown as T
  }

  if (value instanceof Set) {
    const set = new Set()
    visited.set(value as object, set)
    value.forEach((setValue) => {
      set.add(fallbackClone(setValue, visited))
    })
    return set as unknown as T
  }

  if (Array.isArray(value)) {
    const arr: unknown[] = []
    visited.set(value as object, arr)
    for (let i = 0; i < value.length; i++) {
      arr.push(fallbackClone(value[i], visited))
    }
    return arr as unknown as T
  }

  // 非纯对象（WeakMap/Promise/Blob/class 实例等）无法安全克隆，保留原引用
  const proto = Object.getPrototypeOf(value as object)
  if (proto !== Object.prototype && proto !== null) {
    return value
  }

  // 克隆进同类原型：Object.create(null) 的状态映射若克隆成 {}，副本会白得一份
  // Object.prototype（'toString' in clone / clone.hasOwnProperty 行为与源不一致）
  const obj = Object.create(proto) as Record<string, unknown>
  visited.set(value as object, obj)
  const keys = Object.keys(value as object)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const child = fallbackClone((value as Record<string, unknown>)[key], visited)
    if (key === '__proto__') {
      // 自有 '__proto__' 键（JSON.parse 产出）必须复刻为自有属性：
      // obj[key] = child 走 [[Set]] 会触发原型 setter，键被丢弃、副本原型被换掉，
      // 注入的属性反而变成继承属性（deepMerge 的 defineProperty 防护也会因此失效）
      Object.defineProperty(obj, key, { value: child, writable: true, enumerable: true, configurable: true })
    } else {
      obj[key] = child
    }
  }
  return obj as T
}
