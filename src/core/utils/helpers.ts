/**
 * GeomStore v1.0.0 - 工具函数集合
 *
 * 提供常用的工具函数：
 * - 类型判断函数
 * - 对象操作函数
 * - 路径操作函数
 * - 克隆操作函数
 */

import { deepCloneState } from '../store/utils'

// ==================== 类型判断 ====================

/**
 * 判断是否是对象
 *
 * 注意：Map/Set 不是普通对象，深合并/克隆场景需单独处理，
 * 否则会被展开成空普通对象导致静默数据损坏。
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set)
}

/**
 * 判断是否是纯对象（plain object）
 */
export function isPlainObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const proto = Object.getPrototypeOf(value)
  return proto === null || proto === Object.prototype
}

/**
 * 判断是否是函数
 */
export function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function'
}

/**
 * 判断是否是数组
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

/**
 * 判断是否是Promise
 */
export function isPromise(value: unknown): value is Promise<unknown> {
  return value !== null && typeof value === 'object' && 'then' in value && typeof (value as { then: unknown }).then === 'function'
}

// ==================== 对象操作 ====================

/**
 * 浅比较两个值
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) {
    return false
  }

  const keysA = Object.keys(a as Record<string, unknown>)
  const keysB = Object.keys(b as Record<string, unknown>)

  if (keysA.length !== keysB.length) return false

  for (const key of keysA) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false
    }
  }

  return true
}

/**
 * 深度比较两个值（使用迭代实现避免栈溢出）
 *
 * 注意：超过 maxDepth 时本函数直接返回 false（并告警），而非抛错或视为相等。
 * 这是保守语义——深度未知/超限的结构按「不相等」处理，
 * 以避免误报相等导致缓存误命中。调用方如需比较超深结构，
 * 请显式传入更大的 maxDepth。
 *
 * @param a - 第一个值
 * @param b - 第二个值
 * @param maxDepth - 最大递归深度（默认1000），超限时返回 false
 * @returns 是否相等
 */
export function deepEqual(a: unknown, b: unknown, maxDepth: number = 1000): boolean {
  // 使用迭代实现，避免递归栈溢出
  const stack: Array<{ a: unknown; b: unknown; depth: number }> = [{ a, b, depth: 0 }]
  // 使用 Map 记录已比较过的对象配对，正确处理循环引用
  const seenPairs = new Map<object, object>()

  while (stack.length > 0) {
    const item = stack.pop()
    if (!item) {
      break
    }
    const { a: currentA, b: currentB, depth } = item

    // 检查最大深度
    if (depth >= maxDepth) {
      console.warn(`[deepEqual] Maximum depth ${maxDepth} exceeded`)
      return false
    }

    // 快速路径：SameValueZero（引用相等，含 NaN）
    if (currentA === currentB || Object.is(currentA, currentB)) continue

    // 类型不同
    if (typeof currentA !== typeof currentB) return false

    // null或undefined检查
    if (currentA === null || currentA === undefined || currentB === null || currentB === undefined) {
      return false
    }

    // 基本类型且不相等
    if (typeof currentA !== 'object') return false

    // 检查循环引用 - 使用 Map 记录 A→B 的配对关系
    const objA = currentA as object
    const objB = currentB as object
    if (seenPairs.get(objA) === objB) {
      // 已经比较过相同的配对，跳过以避免无限循环
      continue
    }
    seenPairs.set(objA, objB)

    // 内建对象按内容比较：Object.keys 对 Date/Map/Set/RegExp 恒为空，
    // 直接走通用对象比较会把内容不同的实例误判为相等
    if (currentA instanceof Date || currentB instanceof Date) {
      if (!(currentA instanceof Date && currentB instanceof Date) || currentA.getTime() !== currentB.getTime()) {
        return false
      }
      continue
    }

    if (currentA instanceof RegExp || currentB instanceof RegExp) {
      if (!(currentA instanceof RegExp && currentB instanceof RegExp) || currentA.source !== currentB.source || currentA.flags !== currentB.flags) {
        return false
      }
      continue
    }

    if (currentA instanceof Map || currentB instanceof Map) {
      if (!(currentA instanceof Map && currentB instanceof Map) || currentA.size !== currentB.size) {
        return false
      }
      for (const [key, value] of currentA) {
        // 键按引用相等匹配（对象键的深匹配超出本工具职责）；值递归比较
        if (!currentB.has(key)) {
          return false
        }
        stack.push({ a: value, b: currentB.get(key), depth: depth + 1 })
      }
      continue
    }

    if (currentA instanceof Set || currentB instanceof Set) {
      if (!(currentA instanceof Set && currentB instanceof Set) || currentA.size !== currentB.size) {
        return false
      }
      // Set 是集合，比较应与插入顺序无关
      if (!setsEqual(currentA, currentB, maxDepth, depth)) {
        return false
      }
      continue
    }

    // 数组检查
    if (Array.isArray(currentA) !== Array.isArray(currentB)) return false

    // 对象或数组
    const recA = currentA as Record<string, unknown>
    const recB = currentB as Record<string, unknown>

    const keysA = Object.keys(recA)
    const keysB = Object.keys(recB)

    if (keysA.length !== keysB.length) return false

    // 检查所有键
    for (const key of keysA) {
      if (!(key in recB)) return false

      stack.push({
        a: recA[key],
        b: recB[key],
        depth: depth + 1,
      })
    }
  }

  return true
}

/**
 * 判断两个 Set 的元素是否按「集合语义」相等（与插入顺序无关）。
 *
 * 对原始值元素按 SameValueZero 精确匹配（与 Set 内部判重语义一致）；
 * 对对象元素按深度相等做贪心配对。Set 内元素互异且 deepEqual 为等价关系，
 * 贪心配对在此场景下等价于完美匹配，故结果正确。
 */
function setsEqual(setA: Set<unknown>, setB: Set<unknown>, maxDepth: number, depth: number): boolean {
  const itemsA = [...setA]
  const remainingB: unknown[] = [...setB]

  for (const itemA of itemsA) {
    let matched = false

    for (let j = 0; j < remainingB.length; j++) {
      const itemB = remainingB[j]

      // 快速路径：SameValueZero（引用相等，含 NaN）
      if (itemA === itemB || (typeof itemA === 'number' && typeof itemB === 'number' && Object.is(itemA, itemB))) {
        matched = true
        remainingB.splice(j, 1)
        break
      }

      // 对象元素：深度比较（deepEqual 内部为迭代实现，不会栈溢出）
      if (typeof itemA === 'object' && typeof itemB === 'object' && itemA !== null && itemB !== null && deepEqual(itemA, itemB, maxDepth - depth - 1)) {
        matched = true
        remainingB.splice(j, 1)
        break
      }
    }

    if (!matched) {
      return false
    }
  }

  return true
}

/**
 * 原型链敏感键：作为普通自有属性覆盖写入，禁止递归合并进原型对象，
 * 防止 JSON.parse('{"__proto__": {...}}') 之类的输入污染 Object.prototype
 */
const PROTO_SENSITIVE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * 以 DefineOwnProperty 语义写入自有属性。
 *
 * Object.assign 走 [[Set]] 语义，键为 `__proto__` 时会触发原型 setter 改写对象原型；
 * defineProperty 只定义自有数据属性，不触发任何 setter，可安全承载任意键名。
 */
function defineOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

/**
 * 深度合并对象
 *
 * 注意：此函数会修改 target 对象。对于非纯对象值（如数组），
 * 会进行深拷贝以防止 source 和 target 之间共享引用。
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, ...sources: Partial<T>[]): T {
  for (const source of sources) {
    if (!source) continue
    if (isObject(target) && isObject(source)) {
      // Object.keys 仅取自有可枚举键，天然排除原型链属性
      for (const key of Object.keys(source)) {
        const sourceVal = source[key]

        if (PROTO_SENSITIVE_KEYS.has(key)) {
          // 原型链敏感键：深拷贝后作为普通自有属性覆盖，绝不递归合并
          defineOwnProperty(target, key, clone(sourceVal))
          continue
        }

        const existing = target[key]
        if (isObject(sourceVal)) {
          if (isObject(existing)) {
            // 纯对象 → 纯对象：递归合并
            deepMerge(existing as Record<string, unknown>, sourceVal as Record<string, unknown>)
          } else {
            // 目标位置为非纯对象（原语/null/数组/Map/Set）：类型冲突时整体替换为深拷贝，
            // 避免递归合并被静默跳过导致 source 数据丢失
            defineOwnProperty(target, key, clone(sourceVal))
          }
        } else if (Array.isArray(sourceVal)) {
          // 数组：深拷贝防止共享引用
          defineOwnProperty(target, key, clone(sourceVal))
        } else if (sourceVal instanceof Map || sourceVal instanceof Set) {
          // Map/Set：深拷贝为独立实例，避免误合并成空普通对象或共享引用
          defineOwnProperty(target, key, clone(sourceVal))
        } else {
          defineOwnProperty(target, key, sourceVal)
        }
      }
    }
  }

  return target
}

// ==================== 路径操作 ====================

/**
 * 通过路径获取对象值
 */
export function get<T = unknown>(obj: T, path: string, defaultValue?: unknown): unknown {
  try {
    if (typeof path !== 'string' || path.trim().length === 0) {
      console.warn('[get] Invalid path:', path)
      return defaultValue
    }

    const keys = path.split('.')
    let result: unknown = obj

    for (const key of keys) {
      // hasOwnProperty 排除原型链属性（如 toString/constructor），
      // 与同文件 set() 的原型链防护保持一致
      if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, key)) {
        result = (result as Record<string, unknown>)[key]
      } else {
        return defaultValue
      }
    }

    return result
  } catch (error) {
    console.error('[get] Error in get:', error)
    return defaultValue
  }
}

/**
 * 通过路径设置对象值
 */
export function set<T = unknown>(obj: T, path: string, value: unknown): void {
  try {
    if (typeof path !== 'string' || path.trim().length === 0) {
      console.warn('[set] Invalid path:', path)
      return
    }

    if (obj === null || typeof obj !== 'object') {
      console.warn('[set] Invalid object:', obj)
      return
    }

    const keys = path.split('.')
    let current: Record<string, unknown> = obj as Record<string, unknown>

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]
      // hasOwnProperty 排除原型链属性（如 __proto__/constructor），
      // 结合 defineOwnProperty 写入，防止路径段污染对象原型
      const existing = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : undefined
      if (existing !== null && existing !== undefined && typeof existing !== 'object') {
        // 中间路径已是原始值（如 'list.0.done' 而 list[0] 是数字）：
        // 原始值无法下钻，静默替换为 {} 会破坏既有数据（[5] → [{}]），放弃写入并告警
        console.warn(`[set] Cannot descend into primitive value at "${key}" (path: ${path})`)
        return
      }
      if (existing === null || existing === undefined) {
        defineOwnProperty(current, key, {})
      }
      current = current[key] as Record<string, unknown>
    }

    defineOwnProperty(current, keys[keys.length - 1], value)
  } catch (error) {
    console.error('[set] Error in set:', error)
  }
}

// ==================== 其他工具 ====================

/**
 * 空函数
 */
export function noop(): void {
  // Empty function
}

/**
 * 返回参数的函数
 */
export function identity<T>(value: T): T {
  return value
}

/**
 * 唯一 ID 生成器
 *
 * 结合递增计数器和随机数，避免在 HMR、多 bundle 或模块重载场景下产生重复 ID。
 */
let idCounter = 0
const randomSuffix = Math.random().toString(36).slice(2, 8)
export function uniqueId(prefix?: string): string {
  return `${prefix || ''}${idCounter++}_${randomSuffix}`
}

// ==================== 克隆函数 ====================

/** 克隆模式 */
export type CloneMode = 'deep' | 'shallow' | 'safe' | 'json'

/**
 * 统一的克隆函数
 *
 * @param obj 要克隆的对象
 * @param options.mode 克隆模式（默认 'deep'）：
 * - `deep`：递归深拷贝，支持 Date/RegExp/Map/Set 与循环引用（复用 deepCloneState）
 * - `shallow`：仅复制一层（数组/Map/Set 展开复制，对象浅拷贝）
 * - `safe`：尽力深拷贝且绝不抛错——结构保真与 deep 相同（Date/Map/Set 正确克隆），
 *   仅在克隆器真正失败时降级返回原引用并告警。旧版 safe 的 JSON 序列化语义
 *   （Date 变字符串、Map/Set 变 `{}`、丢 undefined/函数）已移至显式命名的 `json` 模式
 * - `json`：JSON 序列化往返，产出可结构化克隆的纯数据副本（有损），
 *   序列化失败（循环引用等）时返回原引用
 * @returns 克隆后的对象
 */
export function clone<T>(obj: T, options?: { mode?: CloneMode } & Record<string, unknown>): T {
  const rawOptions = (options || {}) as Record<string, unknown>
  // 旧选项（deep/safe）已废弃：JS 调用方传入时静默按默认 deep 处理会改变行为，显式告警
  if (('deep' in rawOptions || 'safe' in rawOptions) && !('mode' in rawOptions)) {
    console.warn("[clone] 选项 { deep, safe } 已废弃：请使用 { mode: 'deep' | 'shallow' | 'safe' | 'json' }，当前调用按 mode='deep' 处理")
  }
  const { mode = 'deep' } = rawOptions as { mode?: CloneMode }

  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  // 处理特殊对象类型
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T
  }
  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as T
  }

  if (mode === 'shallow') {
    // 浅克隆
    if (Array.isArray(obj)) {
      return [...obj] as T
    }
    if (obj instanceof Map) {
      return new Map(obj) as T
    }
    if (obj instanceof Set) {
      return new Set(obj) as T
    }
    return { ...obj }
  }

  if (mode === 'json') {
    try {
      return JSON.parse(JSON.stringify(obj))
    } catch {
      return obj
    }
  }

  // deep 与 safe 共用递归克隆器（支持 Map/Set 与循环引用）：
  // safe 仅多一层"绝不抛错"的降级契约
  if (mode === 'safe') {
    try {
      return deepCloneState(obj)
    } catch (error) {
      console.warn('[clone] safe 模式深拷贝失败，降级返回原引用（共享可变状态的风险由调用方承担）:', error)
      return obj
    }
  }

  // 深度克隆统一复用 deepCloneState：
  // 支持 Map/Set 实例与循环引用（WeakMap 守卫），与 Store 内部克隆语义一致，
  // 避免同一代码库两套克隆语义产生行为割裂
  return deepCloneState(obj)
}
