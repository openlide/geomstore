/**
 * Store 内部工具函数
 */

/** 缓存的生产环境检测结果 */
let cachedProductionState: boolean | undefined

/**
 * 检测当前运行环境是否为生产模式
 *
 * 判定优先级（自高到低）：
 * 1. Node.js / 小程序构建期注入的 `process.env.NODE_ENV`（最可靠）
 * 2. 构建期 `__DEV__` 全局标志（需打包器 DefinePlugin 等做字符串替换才有效）
 * 3. 兜底为开发模式（非生产），保证保护机制默认开启
 *
 * 注意：`__DEV__` 是构建期常量，tsc 不会替换它，运行时若未定义，
 * 不能直接 `!__DEV__`（在未声明全局时会 ReferenceError，且语义会被误判为生产）。
 * 因此使用 `typeof __DEV__ !== 'undefined'` 做存在性检查。
 *
 * @returns {boolean} 如果当前处于生产环境则返回 true，否则返回 false
 */
export function isProduction(): boolean {
  // 使用缓存结果避免重复计算
  if (cachedProductionState !== undefined) {
    return cachedProductionState
  }

  // 1. 优先检查标准 Node.js 环境变量
  try {
    if (typeof process !== 'undefined' && process?.env?.NODE_ENV) {
      cachedProductionState = process.env.NODE_ENV === 'production'
      return cachedProductionState
    }
  } catch {
    // Ignore access errors in restricted environments
  }

  // 2. 回退到构建期 __DEV__ 全局标志（需打包器替换；此处做存在性检查）
  if (typeof __DEV__ !== 'undefined') {
    cachedProductionState = !__DEV__
    return cachedProductionState
  }

  // 3. 兜底：无法判定时按开发模式处理，确保状态保护默认开启
  cachedProductionState = false
  return cachedProductionState
}

/**
 * 创建状态直接变异的错误消息
 * @param path - 被修改的状态路径
 * @param value - 尝试设置的新值
 * @param operation - 执行的操作类型
 * @returns 格式化的错误消息字符串
 */
export function createMutationErrorMessage(path: string, value: unknown, operation: string): string {
  return (
    `[GeomStore] Direct mutation of state "${path}" is prohibited. Use setState() or $patch() methods instead.\n` +
    `Operation: ${operation}\n` +
    `Attempted value: ${JSON.stringify(value)}`
  )
}

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

  const obj: Record<string, unknown> = {}
  visited.set(value as object, obj)
  const keys = Object.keys(value as object)
  for (let i = 0; i < keys.length; i++) {
    obj[keys[i]] = fallbackClone((value as Record<string, unknown>)[keys[i]], visited)
  }
  return obj as T
}
