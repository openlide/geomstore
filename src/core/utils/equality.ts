/**
 * GeomStore - 深度相等比较
 *
 * 自 helpers.ts 拆出：深度比较两个值（迭代实现，含循环引用与 Set 无序语义）。
 *
 * @module utils/equality
 */

/**
 * 一次顶层比较的可变状态
 *
 * 随 deepEqual 调用创建、在 compareWithSeenPairs / setsEqual 之间逐层传递，
 * 不用模块级变量：模块级标记会让 deepEqual 带状态且不可重入——比较过程中被
 * 状态的 Proxy 陷阱/getter 里的内层 deepEqual 复位后，外层「一次比较只警一条」
 * 的保证就作废（告警重复或被静默吞掉）。
 */
interface Comparison {
  /** 深度预算，即 deepEqual 的 maxDepth 入参 */
  readonly maxDepth: number
  /**
   * 已比较过的「对象对」：循环防护与别名图复用，Set 元素候选比较跨多次调用共享同一份
   */
  readonly seenPairs: Map<object, Set<object>>
  /** 本轮比较是否已就深度超限告过警 */
  warnedAtMaxDepth: boolean
}

/**
 * [[Class]] 标签读取器：装箱值、ArrayBuffer / SharedArrayBuffer、Promise / WeakMap / WeakSet
 * 的判定都走它——跨 realm 安全，且不依赖任何全局构造器是否存在
 */
const optionalBoxedTagOf = (value: object): string => Object.prototype.toString.call(value)

/**
 * 是否为装箱原始值（`new Number(1)` / `Object(Symbol('x'))` / `Object(10n)` 等）
 *
 * 一律按 `Object.prototype.toString` 的 [[Class]] tag 判定，不用 `instanceof`、也不做
 *「原型 ∈ 五个包装原型」的白名单：前者对跨 realm 的装箱值会落空（分包 / 多运行时下的构造器
 * 不是同一份），后者会漏掉 `class MyNum extends Number`——它的 [[NumberData]] 同样是身份的
 * 一部分。tag 判定天然跨 realm，也无需探测 `BigInt` / `Symbol` 这两个全局是否存在
 *（裸读未声明的全局标识符抛的是 ReferenceError 而非 false，会从这个比较器外溢到
 * createSelector / notify 去重 / 快照 diff 等全部调用方）。
 */
const isBoxedPrimitive = (value: object): boolean => {
  // #126: instanceof 对跨 realm 的装箱值会落空（分包/多运行时下的构造器不是同一份）。
  // 改用 [[Class]] tag 判定，天然跨 realm。Number/String/Boolean 自 ES1 起必在，
  // 但 tag 判定与 instanceof 语义等价且统一口径，故一律走 tag
  const tag = optionalBoxedTagOf(value)
  return tag === '[object Number]' || tag === '[object String]' || tag === '[object Boolean]' || tag === '[object BigInt]' || tag === '[object Symbol]'
}

/**
 * 深度比较两个值（使用迭代实现避免栈溢出）
 *
 * 注意：超过 maxDepth 时本函数直接返回 false（并告警），而非抛错或视为相等。
 * 这是保守语义——深度未知/超限的结构按「不相等」处理，
 * 以避免误报相等导致缓存误命中。调用方如需比较超深结构，
 * 请显式传入更大的 maxDepth。
 * 该保守语义只对**需要继续下钻**的结构生效：同一引用/同一原始值在任何深度上都判相等
 * （否则自反性会在恰好落在 maxDepth 的那一层被破坏，见循环里的快速路径）。
 * 超深结构下告警**每次顶层比较只出第一条**（见 `Comparison.warnedAtMaxDepth`），
 * 后续命中静默按同样的 false 语义处理，别让日志噪音掩盖真正的问题。
 *
 * 深度累加口径：所有跨容器边界（对象键、数组元素、Map 值、Set 元素）都算一层，
 * 同一 maxDepth 预算在整棵树上连续消耗，不会因穿过 Set 而重新计数。
 *
 * @param a - 第一个值
 * @param b - 第二个值
 * @param maxDepth - 最大递归深度（默认1000），超限时返回 false
 * @returns 是否相等。比较范围：**原型一致**（前置条件，故 `class MyMap extends Map` 的
 *   空实例与空 `Map` 判不等、`Foo` 实例与同键字面量判不等）+ 自有可枚举字符串键逐项
 *   （数组含 length）；内建类型按内容比——Date 比时间值、RegExp 比 source+flags、
 *   Map 比键集与值、Set 比无序元素、装箱原始值（`new Number(1)` 一类）比 `valueOf()`、
 *   Error 比 name+message、ArrayBuffer/TypedArray 比字节内容。Promise/WeakMap/WeakSet
 *   无法按内容比较，只按引用判等（引用不同即判不等）。
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
  // 比较状态随本次调用创建：内层再入的 deepEqual 有自己的状态，互不复位对方的告警标记
  const comparison: Comparison = { maxDepth, seenPairs: new Map<object, Set<object>>(), warnedAtMaxDepth: false }
  // 使用「对象对」集合记录已比较过的组合，正确处理循环引用与别名图
  return compareWithSeenPairs(a, b, comparison)
}

/** 一次配对记录：回滚时按逆序移除 */
interface PairRecord {
  key: object
  partner: object
}

/**
 * 以给定的比较状态执行比较（迭代实现，避免栈溢出）
 *
 * 配对表由调用方传入：Set 元素候选配对需要跨多次比较共享同一份循环防护，
 * 否则各自新建配对表会让自引用元素无限递归直到深度上限，等价的循环 Set 被判为不等。
 * pairLog 非空时记录新增的配对，供候选匹配失败后回滚。
 *
 * baseDepth：本轮比较在**外层树**上的起始深度。Set 元素候选配对要以外层当前深度
 * 为基准重开一轮迭代比较（迭代实现的栈总从 0 计），否则 maxDepth 会在跨 Set 边界时
 * 重新计数，深层嵌套 Set 能绕过深度上限，且同一结构在不同嵌套层得到不同判定。
 */
function compareWithSeenPairs(a: unknown, b: unknown, comparison: Comparison, pairLog?: PairRecord[], baseDepth: number = 0): boolean {
  const { maxDepth, seenPairs } = comparison
  // 使用迭代实现，避免递归栈溢出
  const stack: Array<{ a: unknown; b: unknown; depth: number }> = [{ a, b, depth: baseDepth }]

  while (stack.length > 0) {
    const item = stack.pop()
    /* istanbul ignore if -- 循环条件已保证栈非空，pop 必然有值，此处仅为类型收窄 */
    if (!item) {
      break
    }
    const { a: currentA, b: currentB, depth } = item

    // 快速路径：SameValueZero（引用相等，含 NaN）。必须先于深度检查——
    // 否则恰好落在 maxDepth 上的同一引用（或同一原始值）也会被判不等，自反性被破坏；
    // 而该分支是 return 而非 continue，还会连带取消栈上其余兄弟分支的比较
    if (currentA === currentB || Object.is(currentA, currentB)) continue

    // 检查最大深度：返回 false 会中止整轮比较（含外层栈上待处理的兄弟分支），
    // 这是 deepEqual 文档写明的保守语义。告警按本次顶层比较去重——本分支可能在
    // Set 候选匹配循环里被反复命中，逐候选刷日志会把真正的信号淹掉
    if (depth >= maxDepth) {
      if (!comparison.warnedAtMaxDepth) {
        comparison.warnedAtMaxDepth = true
        console.warn(`[deepEqual] Maximum depth ${maxDepth} exceeded (warned once per top-level comparison)`)
      }
      return false
    }

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

    // 原型必须一致，且**必须先于下面所有内建分支**判定：
    // `class Foo { a = 1 }` 的实例与 `{ a: 1 }` 字面量自有键相同，但二者语义不同
    // （前者带 Foo 的行为），作为缓存比较器时判等会让选择器返回陈旧值。
    // Date/RegExp/Map/Set 的按内容分支若在原型检查之后，空 `MyMap` 与空 `Map` 会因
    // 「两侧都 instanceof Map 且 size 相等」直接 continue 而漏掉这条检查。
    // 注：本函数只比自有可枚举**字符串**键，symbol 键与不可枚举属性的差异不纳入比较。
    if (Object.getPrototypeOf(currentA) !== Object.getPrototypeOf(currentB)) return false

    // 装箱原始值（`new Number(1)` / `Object(10n)` / `Object(Symbol())` 等）：
    // Object.keys 对它们恒为空（String 只有索引键），只比键集会把
    // `new Number(1)` 与 `new Number(2)` 判等。先比内部的原始值；**不 continue**——
    // 装箱类的子类实例可以另带自有属性，那些仍要走下面的通用键比较。
    // 判定本身（含 BigInt/Symbol 的能力探测）见 {@link isBoxedPrimitive}。
    // 比较口径必须是 SameValueZero（`===` 兜 NaN），与本函数快速路径的
    // `a === b || Object.is(a, b)` 逐字一致：直接用 Object.is 会让
    // `deepEqual(new Number(-0), new Number(0))` 为 false，而未装箱的
    // `deepEqual(-0, 0)` 为 true——同一个值只因有没有装箱就得出相反结论
    if (isBoxedPrimitive(currentA)) {
      const other = currentB as { valueOf(): unknown }
      const valueA = currentA.valueOf()
      const valueB = other.valueOf()
      if (!(valueA === valueB || Object.is(valueA, valueB))) {
        return false
      }
    }

    // 内建对象按内容比较：Object.keys 对 Date/Map/Set/RegExp 恒为空，
    // 直接走通用对象比较会把内容不同的实例误判为相等。
    // 双方原型已在上面判等，故按 A 侧分派即覆盖 B 侧（instanceof 沿 getPrototypeOf 走，
    // 同原型 ⇒ 同一条链 ⇒ 同结论）；下面的 as 只是把这条不变量转交给类型系统。
    if (currentA instanceof Date) {
      // 使用 Object.is 处理 NaN（无效 Date 的 getTime() 返回 NaN），
      // 保证两个无效 Date 被判为相等，与 SameValueZero 一致性原则一致
      if (!Object.is(currentA.getTime(), (currentB as Date).getTime())) {
        return false
      }
      continue
    }

    if (currentA instanceof RegExp) {
      const other = currentB as RegExp
      if (currentA.source !== other.source || currentA.flags !== other.flags) {
        return false
      }
      continue
    }

    if (currentA instanceof Map) {
      const other = currentB as Map<unknown, unknown>
      if (currentA.size !== other.size) {
        return false
      }
      for (const [key, value] of currentA) {
        // 键按引用相等匹配（对象键的深匹配超出本工具职责，限制与规避方式见
        // deepEqual 的 @remarks——反序列化出来的等效对象键会造出永不命中的假不等）；
        // 值递归比较
        if (!other.has(key)) {
          return false
        }
        stack.push({ a: value, b: other.get(key), depth: depth + 1 })
      }
      continue
    }

    if (currentA instanceof Set) {
      const other = currentB as Set<unknown>
      if (currentA.size !== other.size) {
        return false
      }
      // Set 是集合，比较应与插入顺序无关；配对表共享以支持循环元素。
      // depth 必须透传：Set 元素是外层树的一层，不带上就会让深度预算在每个 Set
      // 边界重新计数，与上面 Map 分支的 depth + 1 语义分叉
      if (!setsEqual(currentA, other, comparison, depth, pairLog)) {
        return false
      }
      continue
    }

    // Error 按 name + message 比较：Object.keys 对 Error 实例恒为空（name/message
    // 是自有但不可枚举），只比键集会把 `new Error('a')` 与 `new Error('b')` 判等。
    // 不比 stack（每次 new 都不同，且属于调试信息而非语义内容）；子类若加了自有属性
    // 仍会走下面的通用键比较，那些属性会被正常纳入比较
    if (currentA instanceof Error) {
      const other = currentB as Error
      if (currentA.name !== other.name || currentA.message !== other.message) {
        return false
      }
      // 不 continue：Error 子类可能带自有属性，仍需走通用键比较
    }

    // ArrayBuffer 按字节内容比较：Object.keys 对 ArrayBuffer 恒为空（byteLength 是
    // 原型上的访问器，实例上没有自有键），只比键集会把不同大小的缓冲区判等。
    // 用 Uint8Array 视图逐字节读：DataView 也可以但 Uint8Array 的逐元素访问在 V8 上
    // 更快；byteLength 不同直接判不等，避免无谓的字节遍历。
    // 用 [[Class]] tag 而非 instanceof：跨 realm 的 ArrayBuffer（分包/多运行时）
    // instanceof 会落空，落入通用键比较会把字节不同的两个缓冲区判等
    if (optionalBoxedTagOf(currentA) === '[object ArrayBuffer]') {
      const buf = currentA as ArrayBuffer
      const other = currentB as ArrayBuffer
      if (buf.byteLength !== other.byteLength) {
        return false
      }
      const viewA = new Uint8Array(buf)
      const viewB = new Uint8Array(other)
      for (let i = 0; i < viewA.length; i++) {
        if (viewA[i] !== viewB[i]) {
          return false
        }
      }
      continue
    }

    // SharedArrayBuffer 与 ArrayBuffer 的构造器/原型链不同（`instanceof ArrayBuffer` 判假），
    // 而它的自有可枚举键同样恒空、byteLength 也在原型上 ⇒ 落到通用键比较会把**字节不同、
    // 甚至大小不同**的两个 SAB 判等（假相等 → 选择器返回陈旧值、变更检测漏报，且无任何报错）。
    // 克隆侧已把 SAB 当一等内建（clone.ts 的 SLOT_BEARING_TAGS），比较侧不能缺这一支。
    // 用 [[Class]] tag 判定，与 ArrayBuffer 分支同口径（跨 realm 安全）
    if (optionalBoxedTagOf(currentA) === '[object SharedArrayBuffer]') {
      const buf = currentA as SharedArrayBuffer
      const other = currentB as SharedArrayBuffer
      if (buf.byteLength !== other.byteLength) {
        return false
      }
      const viewA = new Uint8Array(buf)
      const viewB = new Uint8Array(other)
      for (let i = 0; i < viewA.length; i++) {
        if (viewA[i] !== viewB[i]) {
          return false
        }
      }
      continue
    }

    // TypedArray（Int8Array / Uint8Array / Float32Array 等）按字节内容比较：
    // 与 ArrayBuffer 同理，Object.keys 只返回下标键，但 length 已在数组分支比过，
    // 这里用 buffer 的字节视图逐字节比较（同 buffer 同 byteOffset 同 length 的
    // TypedArray 共享同一份字节，比逐元素更快且语义等价）。
    // ArrayBuffer.isView 覆盖全部 TypedArray 与 DataView，且不依赖 realm 一致的构造器
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(currentA)) {
      const viewA = currentA as ArrayBufferView
      const viewB = currentB as ArrayBufferView
      // byteLength 不同直接判不等（length 已在数组分支比过，但 byteLength 更底层）
      if (viewA.byteLength !== viewB.byteLength) {
        return false
      }
      // 用 Uint8Array 视图统一按字节比较：不同 TypedArray 类型（Int16Array vs Uint16Array）
      // 只要字节内容相同就判等（这与「原型已判等」的前提一致——同原型必同类型，
      // 但子类可能覆写 byteOffset/byteLength，逐字节比是最稳的口径）
      const byteViewA = new Uint8Array(viewA.buffer, viewA.byteOffset, viewA.byteLength)
      const byteViewB = new Uint8Array(viewB.buffer, viewB.byteOffset, viewB.byteLength)
      for (let i = 0; i < byteViewA.length; i++) {
        if (byteViewA[i] !== byteViewB[i]) {
          return false
        }
      }
      continue
    }

    // Promise / WeakMap / WeakSet 无法按内容比较（内部槽位不暴露，Object.keys 恒为空），
    // 只能按引用判等。快速路径 `currentA === currentB` 已处理了引用相同的情况，
    // 走到这里说明引用不同，直接判不等。
    // 用 Object.prototype.toString 的 tag 判而非 instanceof：跨 realm 的 Promise 等
    // instanceof 会落空（用本模块 realm 的构造器），落入通用对象比较会把两个不同的
    // Promise 判等（Object.keys 恒空 ⇒ 零次循环 ⇒ return true）
    const boxedTag = optionalBoxedTagOf(currentA)
    if (boxedTag === '[object Promise]' || boxedTag === '[object WeakMap]' || boxedTag === '[object WeakSet]') {
      return false
    }

    // 数组检查：原型一致仍可能一侧是数组、另一侧是 Object.create(Array.prototype)，
    // 后者没有 [[Length]] 语义，isArray 判的是对象本身而非原型链
    if (Array.isArray(currentA) !== Array.isArray(currentB)) return false

    // 对象或数组
    const recA = currentA as Record<string, unknown>
    const recB = currentB as Record<string, unknown>

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
function setsEqual(setA: Set<unknown>, setB: Set<unknown>, comparison: Comparison, depth: number, pairLog?: PairRecord[]): boolean {
  const itemsA = [...setA]
  const remainingB: unknown[] = [...setB]
  const { seenPairs } = comparison

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
        const candidatePairs = compareWithSeenPairs(itemA, itemB, comparison, candidateLog, depth + 1)
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
