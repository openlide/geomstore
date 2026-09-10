/**
 * GeomStore - 快照增量对比
 *
 * 自 SnapshotManager.ts 拆出：compareSnapshots 为纯函数（不依赖管理器实例状态），
 * 支持 Date/RegExp/Map/Set/数组/普通对象的深度差异，并对集合结构匹配设规模护栏。
 *
 * @module SnapshotManager/diff
 */

import { deepEqual } from '../../core/utils/helpers.js'
import type { SnapshotResult } from './types.js'

/** 集合差异结构匹配的规模护栏：超出后退化为整体/规模对比（防 O(n²) 放大） */
const MAX_STRUCTURAL_DIFF_MATCH = 1000

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
}

/**
 * 对比两个快照
 *
 * @param {SnapshotResult<T1>} snapshot1 - 第一个快照
 * @param {SnapshotResult<T2>} snapshot2 - 第二个快照（支持不同类型）
 * @returns {SnapshotDiff} 差异结果
 */
export function compareSnapshots<T1, T2>(snapshot1: SnapshotResult<T1>, snapshot2: SnapshotResult<T2>): SnapshotDiff {
  // 对比最大深度：超出后停止递归，防止深度嵌套导致栈溢出
  const MAX_COMPARE_DEPTH = 100
  const changes: Array<{ path: string; oldValue: unknown; newValue: unknown; kind?: 'changed' | 'added' | 'removed' }> = []

  const compare = (obj1: unknown, obj2: unknown, path: string, depth: number): void => {
    // 深度保护：超出最大深度后停止递归，避免深层嵌套导致栈溢出
    if (depth > MAX_COMPARE_DEPTH) {
      changes.push({ path, oldValue: obj1, newValue: obj2 })
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

    // 内建对象按内容比较：Object.keys 对 Date/Map/Set/RegExp 恒为空，
    // 直接走通用对象比较会把内容不同的实例误判为无差异
    if (obj1 instanceof Date || obj2 instanceof Date) {
      if (!(obj1 instanceof Date && obj2 instanceof Date) || obj1.getTime() !== obj2.getTime()) {
        changes.push({ path, oldValue: obj1, newValue: obj2 })
      }
      return
    }

    if (obj1 instanceof RegExp || obj2 instanceof RegExp) {
      if (!(obj1 instanceof RegExp && obj2 instanceof RegExp) || obj1.source !== obj2.source || obj1.flags !== obj2.flags) {
        changes.push({ path, oldValue: obj1, newValue: obj2 })
      }
      return
    }

    if (obj1 instanceof Map || obj2 instanceof Map) {
      const map1 = obj1 as Map<unknown, unknown>
      const map2 = obj2 as Map<unknown, unknown>
      if (!(obj1 instanceof Map && obj2 instanceof Map) || map1.size !== map2.size) {
        changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
        return
      }
      // 键匹配分两层：引用匹配（O(1) 快路径）后，未匹配的键做结构匹配——
      // Map 的语义是键值映射，结构等价的不同引用键应视为同一键，
      // 否则等价 Map 会因键对象重建而被误报为全量差异
      const unmatched1: Array<{ key: unknown; value: unknown; index: number }> = []
      let i = 0
      for (const [key, value] of map1) {
        if (map2.has(key)) {
          compare(value, map2.get(key), `${path}.key[${i}]`, depth + 1)
        } else {
          unmatched1.push({ key, value, index: i })
        }
        i++
      }
      const unmatched2: Array<{ key: unknown; value: unknown; index: number }> = []
      let j = 0
      for (const [key, value] of map2) {
        if (!map1.has(key)) {
          unmatched2.push({ key, value, index: j })
        }
        j++
      }

      if (unmatched1.length > MAX_STRUCTURAL_DIFF_MATCH || unmatched2.length > MAX_STRUCTURAL_DIFF_MATCH) {
        // 规模护栏：结构匹配 O(n×m)，超限退化为整体差异报告。
        // 进入本分支即存在未匹配键（数量相等但内容可能完全不同），
        // 且引用匹配此前已失败，无法进一步区分——按整体差异报告（宁多勿漏）
        changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
        return
      }

      const used2 = new Array<boolean>(unmatched2.length).fill(false)
      for (const entry1 of unmatched1) {
        let found = -1
        for (let k = 0; k < unmatched2.length; k++) {
          if (!used2[k] && (entry1.key === unmatched2[k].key || deepEqual(entry1.key, unmatched2[k].key))) {
            found = k
            break
          }
        }
        if (found === -1) {
          changes.push({ path: `${path}.key[${entry1.index}]`, oldValue: entry1.key, newValue: undefined, kind: 'removed' })
        } else {
          used2[found] = true
          compare(entry1.value, unmatched2[found].value, `${path}.key[${entry1.index}]`, depth + 1)
        }
      }
      unmatched2.forEach((entry2, k) => {
        if (!used2[k]) {
          changes.push({ path: `${path}.key[${entry2.index}]`, oldValue: undefined, newValue: entry2.key, kind: 'added' })
        }
      })
      return
    }

    if (obj1 instanceof Set || obj2 instanceof Set) {
      const set1 = obj1 as Set<unknown>
      const set2 = obj2 as Set<unknown>
      if (!(obj1 instanceof Set && obj2 instanceof Set)) {
        changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
        return
      }
      // Set 是无序集合：语义等价的集合不应因插入顺序不同被报告为差异。
      // 无序结构匹配（规模护栏内 O(n×m)，超限退化为引用粗匹配）
      const items1 = [...set1]
      const items2 = [...set2]
      if (items1.length !== items2.length) {
        changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
        return
      }
      if (items1.length > MAX_STRUCTURAL_DIFF_MATCH) {
        // 同规模但超限：仅能做引用级匹配，失败时报整体差异
        const remaining = new Set(items2)
        let refMatched = true
        for (const item of items1) {
          if (remaining.has(item)) {
            remaining.delete(item)
          } else {
            refMatched = false
            break
          }
        }
        if (!refMatched) {
          changes.push({ path, oldValue: obj1, newValue: obj2, kind: 'changed' })
        }
        return
      }
      const matched2 = new Array<boolean>(items2.length).fill(false)
      for (let i = 0; i < items1.length; i++) {
        let found = -1
        for (let k = 0; k < items2.length; k++) {
          if (!matched2[k] && (items1[i] === items2[k] || deepEqual(items1[i], items2[k]))) {
            found = k
            break
          }
        }
        if (found === -1) {
          changes.push({ path: `${path}[removed:${i}]`, oldValue: items1[i], newValue: undefined, kind: 'removed' })
        } else {
          matched2[found] = true
        }
      }
      items2.forEach((item, k) => {
        if (!matched2[k]) {
          changes.push({ path: `${path}[added:${k}]`, oldValue: undefined, newValue: item, kind: 'added' })
        }
      })
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
      compare((obj1 as Record<string, unknown>)[key], (obj2 as Record<string, unknown>)[key], newPath, depth + 1)
    }
  }

  compare(snapshot1.data, snapshot2.data, 'root', 0)

  return {
    changed: changes.length > 0,
    changes,
    timestamp1: snapshot1.metadata.timestamp,
    timestamp2: snapshot2.metadata.timestamp,
  }
}
