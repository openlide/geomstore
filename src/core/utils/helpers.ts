/**
 * GeomStore - 工具函数集合
 *
 * 提供常用的工具函数：
 * - 类型判断函数
 * - 对象操作函数
 * - 路径操作函数
 * - 克隆操作函数
 */

import { deepCloneState } from './clone.js'
import { deepEqual } from './equality.js'

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
 *
 * 语义边界：只有「双方都是纯对象」或「双方都是数组」时才按自有可枚举键逐项浅比较；
 * 其余对象（类实例、Error/URL/Promise/装箱原始值等）没有可信的浅层身份，
 * 要求引用相等。这类值本函数判不等（保守方向：最多让 createSelector 多做一次
 * 结果分发，不会把陈旧值当新值返回）。
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) {
    return false
  }

  // 内建对象（Date/RegExp/Map/Set）的自有可枚举键恒为空，只比 Object.keys
  // 会把内容不同的实例误判为相等（如 new Date(1) vs new Date(2)），
  // 且该函数是 createSelector 的默认比较器——误判相等会向用户返回陈旧值。
  // 按内容比较：Date/RegExp 直接比对，Map/Set 无「浅层」语义，复用 deepEqual
  if (
    a instanceof Date ||
    b instanceof Date ||
    a instanceof RegExp ||
    b instanceof RegExp ||
    a instanceof Map ||
    b instanceof Map ||
    a instanceof Set ||
    b instanceof Set
  ) {
    return deepEqual(a, b)
  }

  // 数组与普通对象键集可能一致（[] 与 {}、[1] 与 {0:1}）：
  // 不校验类别会误判浅相等，导致 createSelector 返回陈旧值
  const aIsArray = Array.isArray(a)
  if (aIsArray !== Array.isArray(b)) return false
  if (aIsArray && (a as unknown[]).length !== (b as unknown[]).length) return false

  // 结构判定取代类型白名单：白名单列不全（Error/URL/ArrayBuffer 视图/Promise 的
  // 自有可枚举键同样为空，两份不同实例会被键比较判为相等）。
  // 两侧同为纯对象或同为数组才按键比较，否则只认引用相等（上面已判过 !==）
  if (!aIsArray && !(isPlainObject(a) && isPlainObject(b))) return false

  const keysA = Object.keys(a as Record<string, unknown>)
  const keysB = Object.keys(b as Record<string, unknown>)

  if (keysA.length !== keysB.length) return false

  for (const key of keysA) {
    // hasOwnProperty 校验 b 侧键自有性：仅靠键数相等 + 原型链取值，
    // b 的同名键在原型上时会把两份键集不同的对象误判为浅相等
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false
    }
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false
    }
  }

  return true
}

// 深度相等比较已拆至 ./equality.js；此处再导出以保持既有导入路径
// （core/utils/helpers.js）不变；deepEqual 的 import 已移至文件顶部
export { deepEqual } from './equality.js'

/**
 * 原型链敏感键：作为普通自有属性覆盖写入，禁止递归合并进原型对象，
 * 防止 JSON.parse('{"__proto__": {...}}') 之类的输入污染 Object.prototype
 *
 * 导出：`Store.setState` 是核心侧唯一自行落键的公开写入路径，必须与这里同一份判据
 * （两处各写一遍就会漂移成「$patch 挡住了、setState 没挡」）。
 */
export const PROTO_SENSITIVE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * 以 DefineOwnProperty 语义写入自有属性。
 *
 * Object.assign 走 [[Set]] 语义，键为 `__proto__` 时会触发原型 setter 改写对象原型；
 * defineProperty 只定义自有数据属性，不触发任何 setter，可安全承载任意键名。
 */
export function defineOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
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
 * 注意：此函数会**修改 target** 对象（原地合并，返回值就是 target）。
 *
 * 逐类源的合并规则：
 * - 纯对象 → 纯对象：递归合并进 target 的既有纯对象（target 该位置不是纯对象时整体替换为克隆副本）；
 * - 数组 / Map / Set / Date / RegExp / 类实例等非纯对象：整体替换为 `clone()` 的副本，不做递归合并；
 * - 原始值：直接赋值。
 *
 * @remarks **合并后的 target 与 source 之间不保证不共享引用**——「深拷贝以防共享引用」只对
 *   可安全克隆的值成立。`clone()` 默认走 deepCloneState，其窄口径是「不可安全克隆的值保留原引用」，
 *   命中该路径的有：class 实例、Error/URL/装箱原始值等原型非 Object.prototype/null 的对象、
 *   ArrayBuffer/TypedArray/DataView，以及 Date/RegExp/Map/Set/Array 的**子类实例**
 *   （详见 core/utils/clone.ts 的文档）。因此
 *   `deepMerge(target, { p: new Point(1, 2) })` 之后 `target.p === source.p`，
 *   后续任一侧的改动都会串到另一侧。Store.$patch 走的就是本函数，
 *   需要隔离的载荷请自行构造副本再打补丁（或把它放进纯对象/普通数组里由克隆接管）。
 */
export function deepMerge<T extends Record<string, unknown>>(target: T, ...sources: Partial<T>[]): T {
  // 循环引用防护：同一对 (source, target) 只递归合并一次。source 自引用
  // （a.nested = a）或互相引用时，无守卫会无限递归栈溢出；
  // 以「源对象 → 目标对象集合」记录，菱形共享的源对象合并进不同目标不受影响
  const seenPairs = new WeakMap<object, Set<object>>()

  const mergeInto = (dst: Record<string, unknown>, src: Record<string, unknown>): void => {
    let dsts = seenPairs.get(src)
    if (!dsts) {
      dsts = new Set()
      seenPairs.set(src, dsts)
    } else if (dsts.has(dst)) {
      return
    }
    dsts.add(dst)

    for (const key of Object.keys(src)) {
      const sourceVal = src[key]

      if (PROTO_SENSITIVE_KEYS.has(key)) {
        // 原型链敏感键：深拷贝后作为普通自有属性覆盖，绝不递归合并
        defineOwnProperty(dst, key, clone(sourceVal))
        continue
      }

      const existing = dst[key]
      if (isPlainObject(sourceVal)) {
        if (isPlainObject(existing)) {
          // 纯对象 → 纯对象：递归合并
          mergeInto(existing as Record<string, unknown>, sourceVal as Record<string, unknown>)
        } else {
          // 目标位置为非纯对象（原语/null/数组/Map/Set/Date 等）：类型冲突时整体替换为深拷贝，
          // 避免递归合并被静默跳过导致 source 数据丢失
          defineOwnProperty(dst, key, clone(sourceVal))
        }
      } else if (typeof sourceVal === 'object' && sourceVal !== null) {
        // 非纯对象源值（数组/Map/Set/Date/RegExp/类实例等）一律整体替换为克隆副本，不递归合并：
        // - 数组/Map/Set：把补丁合并进既有容器会得到混合值（下标错位、键集叠加），谁都没承诺过这种语义；
        // - Date/RegExp：自有可枚举键恒为空，mergeInto 的零次循环会把补丁静默丢弃；
        // - 类实例：与纯对象合并语义不同，会把数据散落成旧实例上的杂散属性。
        // 克隆的覆盖面按 core/utils/clone.ts 的口径，见 deepMerge 的 @remarks
        defineOwnProperty(dst, key, clone(sourceVal))
      } else {
        defineOwnProperty(dst, key, sourceVal)
      }
    }
  }

  for (const source of sources) {
    if (!source) continue
    if (isObject(target) && isObject(source)) {
      // Object.keys 仅取自有可枚举键，天然排除原型链属性
      mergeInto(target as Record<string, unknown>, source as Record<string, unknown>)
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
 * 内建容器的准入门槛：只重建「恰好是该内建类型本身」的实例。
 *
 * 与 `clone.ts` 的 `isExactly` 是同一条判据——那份是 clone.ts 的模块私有函数（未导出），
 * 本模块因此各自复述一行，而不是把它做成 utils 间的隐式契约。两处必须一起漂移：
 * 想收敛就导出 `isExactly` 后删掉这里（改动跨 clone.ts，本轮分片未含该文件）。
 * 子类实例走「返回原引用」的降级路径，理由见 {@link clone} 与 deepCloneState 的文档。
 */
function isExactlyBuiltin(value: object, proto: object): boolean {
  return Object.getPrototypeOf(value) === proto
}

/**
 * 统一的克隆函数
 *
 * @param obj 要克隆的对象
 * @param options.mode 克隆模式（默认 'deep'）：
 * - `deep`：递归深拷贝，支持 Date/RegExp/Map/Set 与循环引用（复用 deepCloneState）
 * - `shallow`：仅复制一层，且只覆盖纯对象/Array/Map/Set（Date/RegExp 按类型新建）；
 *   其余非纯对象（类实例、Error、WeakMap、装箱原始值……）没有保类型的一层展开办法，
 *   按 deep/safe 的降级口径返回原引用，不返回被抽空的对象
 * - `safe`：尽力深拷贝且绝不抛错——结构保真与 deep 相同（Date/Map/Set 正确克隆），
 *   仅在克隆器真正失败时降级返回原引用并告警。旧版 safe 的 JSON 序列化语义
 *   （Date 变字符串、Map/Set 变 `{}`、丢 undefined/函数）已移至显式命名的 `json` 模式
 * - `json`：JSON 序列化往返，产出可结构化克隆的纯数据副本（有损），
 *   序列化失败（循环引用等）时返回原引用
 *
 * @remarks 内建容器的**子类实例**（`class MyMap extends Map`、`class MyDate extends Date`……）
 * 在 deep/shallow/safe 下都按原引用返回，不会被重建为基类副本：子类的构造参数、内部槽位与
 * 自有字段都不可知，重建只会得到丢方法与字段的基类副本（调用子类方法直接 TypeError）。
 * 该准入门槛与 clone.ts 的 `isExactly` 同口径，故五种内建容器（Date/RegExp/Map/Set/Array）
 * 在「顶层输入」与「嵌在对象里」两处得到同一结果——`clone(x, {mode:'deep'})` 与
 * `deepCloneState(x)` 对同一个顶层输入不再有两套口径，shallow 也不会把子类降级成基类副本。
 * `json` 模式不受影响：它的契约本就是有损的 JSON 往返（子类实例也只剩可枚举自有键）。
 *
 * @returns 克隆后的对象
 */
export function clone<T>(obj: T, options?: { mode?: CloneMode }): T {
  const { mode = 'deep' } = options ?? {}

  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  // json 模式先判：它的契约是「JSON 往返产出纯数据副本」，Date/RegExp 必须在
  // 顶层与嵌套处口径一致（此前 Date/RegExp 特判在前，顶层 Date 返回 Date 实例、
  // 嵌套 Date 序列化成字符串，同一模式两套结果）
  if (mode === 'json') {
    try {
      return JSON.parse(JSON.stringify(obj))
    } catch {
      return obj
    }
  }

  // 处理特殊对象类型：与 clone.ts 的 `isExactly` 同门槛——只重建「恰好是该内建类型本身」
  // 的实例。子类实例（`class MyDate extends Date`）不在这里截走，交给下方的降级口径：
  // deep/safe 走 deepCloneState（它自己也带同一道门槛，返回原引用），shallow 走
  // 「非纯对象返回原引用」分支。此前这里无条件 `new Date(obj.getTime())`，会让同一个
  // Date 子类在顶层被降级成基类副本、嵌在对象里却保留原引用（注释与实现相反）
  if (obj instanceof Date && isExactlyBuiltin(obj, Date.prototype)) {
    return new Date(obj.getTime()) as T
  }
  if (obj instanceof RegExp && isExactlyBuiltin(obj, RegExp.prototype)) {
    return new RegExp(obj.source, obj.flags) as T
  }

  if (mode === 'shallow') {
    // 浅克隆：只复制一层，且只对有「保类型的一层展开」办法的容器做展开
    // （Date/RegExp 已在上方按类型新建；内建类型的子类一律走下方的原引用降级）
    if (Array.isArray(obj) && isExactlyBuiltin(obj, Array.prototype)) {
      return [...obj] as T
    }
    if (obj instanceof Map && isExactlyBuiltin(obj, Map.prototype)) {
      return new Map(obj) as T
    }
    if (obj instanceof Set && isExactlyBuiltin(obj, Set.prototype)) {
      return new Set(obj) as T
    }
    // 其余对象只有纯对象可以展开：类实例/Error/WeakMap/Promise 的自有可枚举键一般为空，
    // { ...obj } 会得到一个连原型（连带全部方法）都丢掉的空壳，值整个消失。
    // 按 deep/safe 的降级口径返回原引用——宁可共享，也不交出一份被抽空的数据
    if (!isPlainObject(obj)) {
      return obj
    }
    // 展开运算按键 DefineDataProperty 写入（自有 '__proto__' 键不会被 [[Set]] 吞掉），
    // 再把原型复位：Object.create(null) 的状态映射展开成 {} 会白得一份 Object.prototype，
    // 与 deep 路径（deepCloneState）的原型保真口径分叉
    const copy = { ...obj }
    Object.setPrototypeOf(copy, Object.getPrototypeOf(obj))
    return copy as T
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
