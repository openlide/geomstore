/**
 * GeomStore - 快照增量对比
 *
 * 自 SnapshotManager.ts 拆出：compareSnapshots 为纯函数（不依赖管理器实例状态），
 * 支持 Date/RegExp/Map/Set/数组/普通对象的深度差异。
 * 对象一律先比原型再比内容，Map 的键与 Set 的元素共用同一套无序配对
 * （见 pairUnordered），其结构比较次数受规模护栏约束。
 *
 * 路径方言与克隆引擎（clone.ts / clone-async.ts）逐字对齐，使调用方可以把
 * `result.errors[].path` 与 `diff.changes[].path` 对到同一个条目：
 * 对象属性 `parent.key`、数组与 Map 的值节点 `parent[下标|String(键)]`、
 * Map 的键节点 `parent.key[String(键)]`。差异报告另有 added/removed 后缀形态
 * （`parent[added:3]` / `parent[removed:1]`），只在「该位置在本侧不存在」时出现，
 * 克隆引擎不会产出同形状的路径
 *
 * @module SnapshotManager/diff
 */

import { deepEqual } from '../../core/utils/helpers.js'
import { isSlotBearingBuiltin } from '../../core/utils/clone.js'
import type { SnapshotResult } from './types.js'

/**
 * 集合差异结构匹配的规模护栏：一次无序配对最多做多少次 deepEqual，超出即退化为
 * 整体差异报告（宁多勿漏）。
 *
 * 按**比较次数**而不是集合规模设限才是真上限：旧写法限到 1000 项，而配对是两侧互查，
 * 恰好 1000 项时仍会做满 1e6 次深度比较，每次都可能遍历一整棵对象图——护栏成了软顶。
 * 2000 次够约 44 个结构等价候选的全互查（√2000），更常见的「同序集合差几项」
 * 由下面的引用级索引与就近命中消化掉，超出的部分本来就属于粗粒度场景
 */
const MAX_STRUCTURAL_DIFF_COMPARISONS = 2000

/** 无序结构配对的结果 */
interface UnorderedPairing {
  /** pairs[i] 为 items1[i] 在 items2 中配到的下标，未配到为 -1 */
  pairs: number[]
  /** items2 中没被任何 items1 元素配走的下标 */
  unmatched2: number[]
  /** 比较预算耗尽导致配对未完成：结论不再可信，调用方应退化为整体差异报告 */
  aborted: boolean
}

/**
 * 无序结构（Map 的键 / Set 的元素）的两层配对，两条分支共用同一判等口径与同一护栏：
 *
 * 1. SameValueZero 索引匹配（O(n+m)，无预算限制）：与 Map/Set 自身的取键语义一致，
 *    原始值与同引用对象在此解决；
 * 2. 结构匹配：只对**两侧都是对象**的候选做 deepEqual，并受
 *    {@link MAX_STRUCTURAL_DIFF_COMPARISONS} 约束。原语在第 1 层已用完全部机会
 *    （deepEqual 对原语就是 === / Object.is），再调一次只会稳定拿到 false，故 items2 侧
 *    的候选槽位预先过滤成 structuralSlots，内层每次迭代只剩一次布尔读。
 *
 * 配走的槽位**不**从 structuralSlots 上摘除：两侧同序的等价集合（同一份数据两次快照的
 * 典型形状）靠「跳过大名单里已配走的格子、在自家下标上命中」把比较次数压到每元素一次，
 * 摘除后回填的槽位会把这条快路径打散成 n² 次 deepEqual，超限后把等价集合误报成整体差异
 * （r5-extras-snapshot-fixes.test.ts 用 260 个元素的同序等价集合锁住这一点）。留在预算外的
 * 只是 O(n²) 次布尔读，护栏要挡的是「每次都可能遍历一整棵对象图」的那些 deepEqual。
 *
 * deepEqual 的深度预算传 Infinity：本函数的调用方自己已有 MAX_COMPARE_DEPTH 护栏，
 * 沿用默认 1000 会让「深于 1000 层的等价键/元素」被判为不等，造出成对的
 * removed + added 误报，还要附带一条 [deepEqual] 深度超限告警。
 *
 * @param items1 第一侧待配对项（Map 分支传的是未命中引用的键，引用匹配在调用方已做过）
 * @param items2 第二侧待配对项
 */
function pairUnordered(items1: readonly unknown[], items2: readonly unknown[]): UnorderedPairing {
  const pairs = new Array<number>(items1.length).fill(-1)
  const taken = new Array<boolean>(items2.length).fill(false)
  /** items2 的 SameValueZero 索引：值 → 下标（两侧各自都无重复值，故一个下标足够） */
  const slotOfValue = new Map<unknown, number>()
  for (let k = 0; k < items2.length; k++) {
    slotOfValue.set(items2[k], k)
  }

  const pending: number[] = []
  for (let i = 0; i < items1.length; i++) {
    // 一个槽位至多被一个 items1 元素命中，故无需再判 taken：两侧各自都无重复值
    // （Set / Map 的键按 SameValueZero 去重），而 SameValueZero 是等价关系
    const slot = slotOfValue.get(items1[i])
    if (slot === undefined) {
      pending.push(i)
      continue
    }
    taken[slot] = true
    pairs[i] = slot
  }

  /** 第 1 层没被引用命中、且自身可做结构比较的 items2 槽位 */
  const structuralSlots: number[] = []
  for (let k = 0; k < items2.length; k++) {
    const item2 = items2[k]
    if (!taken[k] && item2 !== null && typeof item2 === 'object') {
      structuralSlots.push(k)
    }
  }

  let comparisons = 0
  let aborted = false
  for (const i of pending) {
    const item1 = items1[i]
    // 原语候选在第 1 层已尽力：留作未配对，不占结构比较预算
    if (item1 === null || typeof item1 !== 'object') continue
    for (const k of structuralSlots) {
      if (taken[k]) continue
      if (comparisons >= MAX_STRUCTURAL_DIFF_COMPARISONS) {
        aborted = true
        break
      }
      comparisons++
      if (deepEqual(item1, items2[k], Number.POSITIVE_INFINITY)) {
        taken[k] = true
        pairs[i] = k
        break
      }
    }
    if (aborted) break
  }

  const unmatched2: number[] = []
  for (let k = 0; k < items2.length; k++) {
    if (!taken[k]) unmatched2.push(k)
  }

  return { pairs, unmatched2, aborted }
}

/**
 * Map 键在路径里的标识写法：克隆引擎两侧（clone.ts 的 Map 分支、clone-async.ts 同名分支）
 * 都用 `String(key)`，diff 侧必须一致，否则 `errors[].path` 与 `changes[].path` 对不上条目。
 *
 * `String(symbol)` 合法（模板插值 symbol 会抛 TypeError），故 Symbol 键也走这一条。
 * 键对象自带抛错的 `toString` 时退回占位串：本函数被每个条目调用一次，
 * 让它抛出会把一个「读两份快照」的纯查询变成异常路径
 */
function keyToken(key: unknown): string {
  try {
    return String(key)
  } catch {
    return '<unstringifiable key>'
  }
}

/** Map 条目**值**节点的路径（与克隆引擎的值分支同形状） */
function mapValuePath(path: string, key: unknown): string {
  return `${path}[${keyToken(key)}]`
}

/** Map 条目**键**节点的路径（与克隆引擎的键分支同形状，added/removed 用它） */
function mapKeyPath(path: string, key: unknown): string {
  return `${path}.key[${keyToken(key)}]`
}

/**
 * 快照差异
 */
export interface SnapshotDiff {
  /** 是否发生变化 */
  changed: boolean
  /** 变化列表（kind 缺省为 'changed'；集合差异使用 'added' / 'removed'） */
  changes: Array<{ path: string; oldValue: unknown; newValue: unknown; kind?: 'changed' | 'added' | 'removed' }>
  /** 第一个快照时间戳 */
  timestamp1: number
  /** 第二个快照时间戳 */
  timestamp2: number
  /**
   * 两份输入是否都可作为比对依据：任一来源 `success: false` 即为 false。
   *
   * 失败快照的 `data` 按 types.ts 的契约可能是 `undefined` 或部分构建的半成品，
   * 而两份半成品之间的真实差异恰好落在「两侧都还没填上的键」上——逐路径比较会静默漏报。
   * 故本值为 false 时 `changed` 恒为 true（宁多勿漏的整树报告），
   * 它表达的是「输入不可信」而不是「内容确有差异」；要做回滚判定/去重，
   * 先判本值再读 `changes`
   */
  inputTrusted: boolean
}

/**
 * 对比两个快照
 *
 * 输入契约：`SnapshotResult` 的 `data` 只在 `success: true` 时是完整克隆
 * （见 types.ts 的「消费前必须先判 success」）。本函数不要求调用方先判，
 * 而是把这件事落到结果的 {@link SnapshotDiff#inputTrusted} 上——任一侧非 success 时
 * 不再逐路径比对（两份都失败的 `data` 同为 `undefined`，会短路成「无差异」的假阴性），
 * 改为交付一条 root 级整体差异并把 `inputTrusted` 置 false
 *
 * @param {SnapshotResult<T1>} snapshot1 - 第一个快照
 * @param {SnapshotResult<T2>} snapshot2 - 第二个快照（支持不同类型）
 * @returns {SnapshotDiff} 差异结果
 */
export function compareSnapshots<T1, T2>(snapshot1: SnapshotResult<T1>, snapshot2: SnapshotResult<T2>): SnapshotDiff {
  // 对比最大深度：超出后停止递归，防止深度嵌套导致栈溢出
  const MAX_COMPARE_DEPTH = 100
  // 差异项类型复用接口定义（SnapshotDiff['changes']）：另抄一份内联字面量会让 kind 枚举
  // 有两处定义，扩展时漏改一处即类型漂移
  const changes: SnapshotDiff['changes'] = []

  // 已对比过的「对象对」登记表：逐路径调用 compare 时，循环引用会让同一对对象
  // （如 root 与 root.self 克隆后互指）反复进入比较，原先仅靠深度护栏截断会把
  // 内容完全相同的循环快照误报为「有变化」。按「对象对」记忆而非单侧对象记忆，
  // 才不会把「同一对象 vs 不同伙伴」的合法二次比较误判为环。
  const comparedPairs = new WeakMap<object, WeakSet<object>>()

  const compare = (obj1: unknown, obj2: unknown, path: string, depth: number): void => {
    if (obj1 !== null && obj2 !== null && typeof obj1 === 'object' && typeof obj2 === 'object') {
      let partners = comparedPairs.get(obj1)
      if (partners?.has(obj2)) return
      if (!partners) {
        partners = new WeakSet<object>()
        comparedPairs.set(obj1, partners)
      }
      partners.add(obj2)
      try {
        compareValues(obj1, obj2, path, depth)
      } finally {
        // Only active ancestors are cycles; shared children still need diffs at each path.
        partners.delete(obj2)
      }
      return
    }
    compareValues(obj1, obj2, path, depth)
  }

  const compareValues = (obj1: unknown, obj2: unknown, path: string, depth: number): void => {
    // 深度保护：超出最大深度后停止递归，避免深层嵌套导致栈溢出。
    // 护栏只终止「逐路径展开」，不等于「判定有差异」：无条件 push 会让任何深过护栏的结构
    // 永远被报为 changed（两侧子树逐字节相同也一样），依赖该结果的缓存/去重随之全量失效。
    // 故此处退化为整体 deepEqual：它是迭代实现（栈安全）、按「对象对」登记循环引用，
    // 只有内容确实不同才记账。深度预算传 Infinity：本函数已在 100 层之外，deepEqual 的
    // 默认 1000 层预算从子树根重新起算，超深结构会二次触发它的告警并按「不相等」返回，
    // 等于把要消除的误报换个位置重新引入
    if (depth > MAX_COMPARE_DEPTH) {
      if (!deepEqual(obj1, obj2, Number.POSITIVE_INFINITY)) {
        changes.push({ path, oldValue: obj1, newValue: obj2 })
      }
      return
    }

    if (obj1 === obj2) return

    // NaN 与自身用 === 比较为 false，会落到下方非对象分支被 push 成一条差异，
    // 使两个含相同 NaN 字段的快照被误判为「有变化」（仓库自带 deepEqual 用 Object.is
    // 正确处理了这一点）。此处只补 NaN 短路而不整体改用 Object.is：
    // Object.is(0, -0) 为 false，那会让 0 与 -0 被判为差异，对数值状态引入新误报
    if (typeof obj1 === 'number' && typeof obj2 === 'number' && Number.isNaN(obj1) && Number.isNaN(obj2)) return

    if (typeof obj1 !== typeof obj2) {
      changes.push({ path, oldValue: obj1, newValue: obj2 })
      return
    }

    if (obj1 === null || obj2 === null || typeof obj1 !== 'object' || typeof obj2 !== 'object') {
      changes.push({ path, oldValue: obj1, newValue: obj2 })
      return
    }

    // 原型一致是所有对象分支的共同前提，与深度护栏回落用的 deepEqual 同判据：
    // 少了它，`class Foo` 实例与结构相同的普通对象在 100 层内被判为无变化、
    // 深过 100 层时被 deepEqual 判为有变化——同一对值的结论取决于嵌套深度。
    // 快照克隆保留源对象原型，故同一份数据两次快照的原型必然一致，本判据不会造出误报
    if (Object.getPrototypeOf(obj1) !== Object.getPrototypeOf(obj2)) {
      changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
      return
    }

    // 内建对象按内容比较：Object.keys 对 Date/Map/Set/RegExp 恒为空，
    // 直接走通用对象比较会把内容不同的实例误判为无差异。
    // 种类只判 obj1：instanceof 沿原型链找构造器的 prototype，上面的闸门既已保证两侧原型
    // 同一，obj1 是 Date 时 obj2 就不可能不是——再判一次两侧只会留下一条永不成立的分岔。
    // （数组是唯一的例外：Array.isArray 看的是内部槽而不是原型，同原型的一个「假数组」
    // Object.create(Array.prototype) 并不会被认作数组，故数组分支仍需自己判两侧）
    if (obj1 instanceof Date) {
      if (obj1.getTime() !== (obj2 as Date).getTime()) {
        changes.push({ path, oldValue: obj1, newValue: obj2 })
      }
      return
    }

    if (obj1 instanceof RegExp) {
      const re2 = obj2 as RegExp
      if (obj1.source !== re2.source || obj1.flags !== re2.flags) {
        changes.push({ path, oldValue: obj1, newValue: obj2 })
      }
      return
    }

    // 其余「内容不住在自有可枚举键上」的内建值一律单独判：`Object.keys` 对它们恒为空，
    // 落到下面的通用对象分支会把两份不同的值判成无差异——`new Number(1)` 与 `new Number(2)`
    // 原型相同、键集同为空，字面缓冲/`Error`/不同引用的 Promise 同理被吞。
    // 交 deepEqual 按各自语义判（装箱比 `valueOf`、字节缓冲比内容、其余按引用/身份），
    // 只有内容确实不同才记账，与 Date/RegExp/Map/Set 那几条同一写法。
    if (isSlotBearingBuiltin(obj1)) {
      if (!deepEqual(obj1, obj2, Number.POSITIVE_INFINITY)) {
        changes.push({ path, oldValue: obj1, newValue: obj2 })
      }
      return
    }

    if (obj1 instanceof Map) {
      const map1 = obj1
      const map2 = obj2 as Map<unknown, unknown>
      if (map1.size !== map2.size) {
        changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
        return
      }
      // 键匹配分两层：引用匹配（O(1) 快路径）后，未匹配的键做结构匹配——
      // Map 的语义是键值映射，结构等价的不同引用键应视为同一键，
      // 否则等价 Map 会因键对象重建而被误报为全量差异。
      // 条目路径按**键身份**而非迭代下标生成（见 mapValuePath / mapKeyPath）：
      // 下标随插入顺序漂移，同一逻辑键在两次快照里会落在不同路径上，
      // 且原写法把「值差异」「键被删」「键新增」三类事实压进同一个 `key[下标]` 形状，
      // 按 path 聚合/回放的消费方会把它们并成一格
      const unmatched1: Array<{ key: unknown; value: unknown }> = []
      for (const [key, value] of map1) {
        if (map2.has(key)) {
          compare(value, map2.get(key), mapValuePath(path, key), depth + 1)
        } else {
          unmatched1.push({ key, value })
        }
      }
      const unmatched2: Array<{ key: unknown; value: unknown }> = []
      for (const [key, value] of map2) {
        if (!map1.has(key)) {
          unmatched2.push({ key, value })
        }
      }

      // 两侧未匹配键的规模相等（map1.size === map2.size，且引用命中的键在两侧一一成对），
      // 故只需对其中一侧设护栏；配对逻辑与 Set 分支共用 pairUnordered
      const pairing = pairUnordered(
        unmatched1.map((entry) => entry.key),
        unmatched2.map((entry) => entry.key),
      )
      if (pairing.aborted) {
        // 预算耗尽：结构匹配给不出可信的配对结论，按整体差异报告（宁多勿漏）
        changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
        return
      }
      unmatched1.forEach((entry1, k) => {
        const slot = pairing.pairs[k]
        if (slot === -1) {
          changes.push({ path: mapKeyPath(path, entry1.key), oldValue: entry1.key, newValue: undefined, kind: 'removed' })
          return
        }
        // 配到同一逻辑键：值差异记在该键的值路径上，与上面引用命中分支同一形状
        compare(entry1.value, unmatched2[slot].value, mapValuePath(path, entry1.key), depth + 1)
      })
      for (const k of pairing.unmatched2) {
        const entry2 = unmatched2[k]
        changes.push({ path: mapKeyPath(path, entry2.key), oldValue: undefined, newValue: entry2.key, kind: 'added' })
      }
      return
    }

    if (obj1 instanceof Set) {
      const set1 = obj1
      const set2 = obj2 as Set<unknown>
      // Set 是无序集合：语义等价的集合不应因插入顺序不同被报告为差异。
      // 配对与 Map 的键共用同一套两层匹配（引用级索引 + 预算内的结构匹配）
      const items1 = [...set1]
      const items2 = [...set2]
      if (items1.length !== items2.length) {
        changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
        return
      }
      const pairing = pairUnordered(items1, items2)
      if (pairing.aborted) {
        changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
        return
      }
      // `[removed:i]` / `[added:k]` 里的 i/k 是**本侧迭代序**，不是条目身份：Set 无序，
      // 未配对元素也没有 Map 那样的键可拿来当路径标识（对象元素的 String() 恒为
      // '[object Object]'，比下标更没有区分度）。这两个下标只用于让同一轮报告里的
      // 两条增删互不撞名，跨快照聚合请以 oldValue / newValue 作条目身份。
      // Set 不存在 Map 那种「同一路径承载两类事实」的问题：集合元素没有值差异，
      // 未配对的只可能是整条增或整条删
      pairing.pairs.forEach((slot, i) => {
        if (slot === -1) {
          changes.push({ path: `${path}[removed:${i}]`, oldValue: items1[i], newValue: undefined, kind: 'removed' })
        }
      })
      for (const k of pairing.unmatched2) {
        changes.push({ path: `${path}[added:${k}]`, oldValue: undefined, newValue: items2[k], kind: 'added' })
      }
      return
    }

    // 数组分支与对象比较互斥：数组 vs 非数组直接报整体差异，
    // 数组 vs 数组按索引比较并区分 added/removed——此前数组落入
    // Object.keys 通用比较，长度差异被误报为键级 changed
    if (Array.isArray(obj1) || Array.isArray(obj2)) {
      if (!(Array.isArray(obj1) && Array.isArray(obj2))) {
        changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
        return
      }
      const arr1 = obj1 as unknown[]
      const arr2 = obj2 as unknown[]
      const maxLen = Math.max(arr1.length, arr2.length)
      for (let i = 0; i < maxLen; i++) {
        if (i >= arr1.length) {
          changes.push({ path: `${path}[added:${i}]`, oldValue: undefined, newValue: arr2[i], kind: 'added' })
        } else if (i >= arr2.length) {
          changes.push({ path: `${path}[removed:${i}]`, oldValue: arr1[i], newValue: undefined, kind: 'removed' })
        } else {
          compare(arr1[i], arr2[i], `${path}[${i}]`, depth + 1)
        }
      }
      return
    }

    const keys1 = Object.keys(obj1 as object)
    const keys2 = Object.keys(obj2 as object)
    const allKeys = new Set([...keys1, ...keys2])

    for (const key of allKeys) {
      /* istanbul ignore next -- path 自 compare(data, data, 'root') 起算，永不为空 */
      const newPath = path ? `${path}.${key}` : key
      const has1 = Object.prototype.hasOwnProperty.call(obj1, key)
      const has2 = Object.prototype.hasOwnProperty.call(obj2, key)
      if (!has1) {
        changes.push({ path: newPath, oldValue: undefined, newValue: (obj2 as Record<string, unknown>)[key], kind: 'added' })
      } else if (!has2) {
        changes.push({ path: newPath, oldValue: (obj1 as Record<string, unknown>)[key], newValue: undefined, kind: 'removed' })
      } else {
        compare((obj1 as Record<string, unknown>)[key], (obj2 as Record<string, unknown>)[key], newPath, depth + 1)
      }
    }
  }

  // 输入可信性闸门：types.ts 的「消费快照 data 前必须先判 success」在本函数的落点。
  // 少这一步会得到两个方向相反的假结论：
  // - 两侧都失败：data 同为 undefined，compare 走 `obj1 === obj2` 短路 → changed: false，
  //   「两份快照都不可用」被报成「两次快照无差异」，据此做回滚判定/去重的调用方跳过回滚；
  // - 两侧都是超时半成品：未填充的 prop 占位已被摘掉（SnapshotManager 的 discardPropPlaceholder），
  //   真实差异恰好落在「两侧都不存在的键」上 → 逐路径比较静默漏报，同样是 changed: false。
  // 故不逐路径比对，改交付一条 root 级整体差异（宁多勿漏，与结构匹配超预算时的口径一致）
  // 并由 inputTrusted 说明 changed 为真的是什么原因
  const inputTrusted = snapshot1.success === true && snapshot2.success === true
  if (inputTrusted) {
    compare(snapshot1.data, snapshot2.data, 'root', 0)
  } else {
    changes.push({ path: 'root', oldValue: snapshot1.data, newValue: snapshot2.data, kind: 'changed' })
  }

  return {
    changed: changes.length > 0,
    changes,
    timestamp1: snapshot1.metadata.timestamp,
    timestamp2: snapshot2.metadata.timestamp,
    inputTrusted,
  }
}
