/**
 * GeomStore - 深度相等比较
 *
 * 自 helpers.ts 拆出：深度比较两个值（迭代实现，含循环引用与 Set 无序语义）。
 *
 * @module utils/equality
 */

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
    /* istanbul ignore if -- 循环条件已保证栈非空，pop 必然有值，此处仅为类型收窄 */
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

    // 检查所有键（hasOwnProperty 限定自有属性，`in` 会沿原型链命中导致假相等）
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(recB, key)) return false

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
