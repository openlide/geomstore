/**
 * GeomStore - 深度相等比较
 *
 * 自 helpers.ts 拆出：深度比较两个值（迭代实现，含循环引用与 Set 无序语义）。
 *
 * @module utils/equality
 */

/**
 * 本次顶层比较是否已就深度超限告过警（去重用，语义见 deepEqual 的 JSDoc）
 */
let depthWarningEmitted = false

/**
 * 深度比较两个值（使用迭代实现避免栈溢出）
 *
 * 注意：超过 maxDepth 时本函数直接返回 false（并告警），而非抛错或视为相等。
 * 这是保守语义——深度未知/超限的结构按「不相等」处理，
 * 以避免误报相等导致缓存误命中。调用方如需比较超深结构，
 * 请显式传入更大的 maxDepth。
 * 超深结构下告警**每次顶层比较只出第一条**（见 `depthWarningEmitted` 的注释），
 * 后续命中静默按同样的 false 语义处理，别让日志噪音掩盖真正的问题。
 *
 * 深度累加口径：所有跨容器边界（对象键、数组元素、Map 值、Set 元素）都算一层，
 * 同一 maxDepth 预算在整棵树上连续消耗，不会因穿过 Set 而重新计数。
 *
 * @param a - 第一个值
 * @param b - 第二个值
 * @param maxDepth - 最大递归深度（默认1000），超限时返回 false
 * @returns 是否相等。比较范围：原型一致 + 自有可枚举字符串键逐项（数组含 length）；
 *   symbol 键与不可枚举属性不参与比较（状态上的版本号标记即属此类，不应影响相等判定）
 *
 * @remarks **Map 的键按引用（SameValueZero）匹配，只有值做深度比较**——这是有意的
 *   窄口径（键的深匹配要解「一个键配多个候选」的匹配问题，超出本工具职责），
 *   对调用方是硬约束：两个 Map 若键集「结构相同但引用不同」（典型来源是反序列化、
 *   跨 store 克隆、JSON 往返后的对象键），即便内容完全等价也会判为不相等，
 *   表现为选择器/缓存永不命中而非报错。规避方式：Map 只用原始值（string/number）
 *   或跨比较稳定的同一引用作键，或把这类映射改建为以 key 字符串索引的普通对象。
 *   Set 则相反，元素按深度相等做无序配对，不受引用影响。
 */
export function deepEqual(a: unknown, b: unknown, maxDepth: number = 1000): boolean {
  // 顶层入口复位告警标记：内部只调 compareWithSeenPairs / setsEqual，不再回调本函数，
  // 故模块级标记即可完成一次比较内的去重（极端情况下状态对象的 Proxy 陷阱里再调
  // deepEqual 会多警一次，只影响日志条数，不影响返回值）
  depthWarningEmitted = false
  // 使用「对象对」集合记录已比较过的组合，正确处理循环引用与别名图
  return compareWithSeenPairs(a, b, maxDepth, new Map<object, Set<object>>())
}

/** 一次配对记录：回滚时按逆序移除 */
interface PairRecord {
  key: object
  partner: object
}

/**
 * 以给定的配对表执行比较（迭代实现，避免栈溢出）
 *
 * 配对表由调用方传入：Set 元素候选配对需要跨多次比较共享同一份循环防护，
 * 否则各自新建配对表会让自引用元素无限递归直到深度上限，等价的循环 Set 被判为不等。
 * pairLog 非空时记录新增的配对，供候选匹配失败后回滚。
 *
 * baseDepth：本轮比较在**外层树**上的起始深度。Set 元素候选配对要以外层当前深度
 * 为基准重开一轮迭代比较（迭代实现的栈总从 0 计），否则 maxDepth 会在跨 Set 边界时
 * 重新计数，深层嵌套 Set 能绕过深度上限，且同一结构在不同嵌套层得到不同判定。
 */
function compareWithSeenPairs(
  a: unknown,
  b: unknown,
  maxDepth: number,
  seenPairs: Map<object, Set<object>>,
  pairLog?: PairRecord[],
  baseDepth: number = 0,
): boolean {
  // 使用迭代实现，避免递归栈溢出
  const stack: Array<{ a: unknown; b: unknown; depth: number }> = [{ a, b, depth: baseDepth }]

  while (stack.length > 0) {
    const item = stack.pop()
    /* istanbul ignore if -- 循环条件已保证栈非空，pop 必然有值，此处仅为类型收窄 */
    if (!item) {
      break
    }
    const { a: currentA, b: currentB, depth } = item

    // 检查最大深度：返回 false 会中止整轮比较（含外层栈上待处理的兄弟分支），
    // 这是 deepEqual 文档写明的保守语义。告警按顶层比较去重——本分支可能在
    // Set 候选匹配循环里被反复命中，逐候选刷日志会把真正的信号淹掉
    if (depth >= maxDepth) {
      if (!depthWarningEmitted) {
        depthWarningEmitted = true
        console.warn(`[deepEqual] Maximum depth ${maxDepth} exceeded (warned once per top-level comparison)`)
      }
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

    // 循环判定按「对象对」而非 A→B 单值映射：同一对象与不同伙伴的比较是两个独立事实。
    // 单值映射会挤掉先前的假设，等价图在重推中逐层加深直至耗尽深度上限（单向误判不等）
    const objA = currentA as object
    const objB = currentB as object
    let partners = seenPairs.get(objA)
    if (partners !== undefined && partners.has(objB)) {
      // 已经比较过相同的配对，跳过以避免无限循环。
      // 口径：先前那条比较若为 false，整轮早就 return false 了，所以能留在表里的
      // 配对必然是在「仍会继续比较」的前提下被接受的假设，跳过等价于按相等处理
      continue
    }
    if (partners === undefined) {
      partners = new Set<object>()
      seenPairs.set(objA, partners)
    }
    partners.add(objB)
    if (pairLog) {
      pairLog.push({ key: objA, partner: objB })
    }

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
        // 键按引用相等匹配（对象键的深匹配超出本工具职责，限制与规避方式见
        // deepEqual 的 @remarks——反序列化出来的等效对象键会造出永不命中的假不等）；
        // 值递归比较
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
      // Set 是集合，比较应与插入顺序无关；配对表共享以支持循环元素。
      // depth 必须透传：Set 元素是外层树的一层，不带上就会让深度预算在每个 Set
      // 边界重新计数，与上面 Map 分支的 depth + 1 语义分叉
      if (!setsEqual(currentA, currentB, maxDepth, depth, seenPairs, pairLog)) {
        return false
      }
      continue
    }

    // 数组检查
    if (Array.isArray(currentA) !== Array.isArray(currentB)) return false

    // 对象或数组
    const recA = currentA as Record<string, unknown>
    const recB = currentB as Record<string, unknown>

    // 原型必须一致：`class Foo { a = 1 }` 的实例与 `{ a: 1 }` 字面量自有键相同，
    // 但二者语义不同（前者带 Foo 的行为），作为缓存比较器时判等会让选择器返回陈旧值。
    // 注：本函数只比自有可枚举**字符串**键，symbol 键与不可枚举属性的差异不纳入比较
    if (Object.getPrototypeOf(currentA) !== Object.getPrototypeOf(currentB)) return false

    // 数组以 length 为准：稀疏数组的空洞索引不出现在 Object.keys 中，
    // 只比键集会让 deepEqual(new Array(3), []) 误判为相等
    if (Array.isArray(recA) && recA.length !== (recB as unknown as unknown[]).length) return false

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
 *
 * depth 为外层比较到达本 Set 时的深度，元素候选配对从 depth + 1 起算，
 * 使 maxDepth 在整棵树上连续消耗（迭代实现每次重开栈都从自己的 0 计，
 * 不带上基准就等于给每个 Set 发一份新的深度预算）。
 */
function setsEqual(
  setA: Set<unknown>,
  setB: Set<unknown>,
  maxDepth: number,
  depth: number,
  seenPairs: Map<object, Set<object>>,
  pairLog?: PairRecord[],
): boolean {
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

      // 对象元素：深度比较（迭代实现，不会栈溢出）。
      // 共享外层配对表（循环元素才能终止），并记录本次候选新增的配对——
      // 失败时回滚，避免失败候选的配对污染后续候选的比较结果
      if (typeof itemA === 'object' && typeof itemB === 'object' && itemA !== null && itemB !== null) {
        const candidateLog: PairRecord[] = []
        const candidatePairs = compareWithSeenPairs(itemA, itemB, maxDepth, seenPairs, candidateLog, depth + 1)
        if (candidatePairs) {
          if (pairLog) {
            pairLog.push(...candidateLog)
          }
          matched = true
          remainingB.splice(j, 1)
          break
        }
        for (let k = candidateLog.length - 1; k >= 0; k--) {
          const record = candidateLog[k]
          const partners = seenPairs.get(record.key)
          if (partners !== undefined) {
            partners.delete(record.partner)
            if (partners.size === 0) {
              seenPairs.delete(record.key)
            }
          }
        }
      }
    }

    if (!matched) {
      return false
    }
  }

  return true
}
