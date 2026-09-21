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
