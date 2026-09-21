/**
 * GeomStore - 错误聚合器
 *
 * 自 ErrorMonitoring.ts 拆出：将相似的错误聚合成组，便于分析和报告。
 *
 * @module extras/error/ErrorAggregator
 */

import type { ErrorContext, ErrorGroup } from '../../types/error.js'
import { GeomStoreError, isGeomStoreError } from '../../core/errors/GeomStoreError.js'

/**
 * 错误聚合器
 *
 * 将相似的错误聚合成组，便于分析和报告
 */
export class ErrorAggregator {
  /**
   * 按错误组保存的「Store → 该组内该 Store 的次数」
   *
   * 单独按次计数而非按组求和：错误组会把同一站点在不同 Store 的报错合并为一条，
   * 若把组 count 累加给每个受影响 Store，跨 Store 的组会重复计入，byStore 之和超过 totalErrors。
   * 计数随组一起存放，组被 maxGroups 驱逐时同步消失，因此
   * `sum(byStore) === totalErrors` 在驱逐后依旧成立（此前独立累计的口径会永久偏离）。
   */
  private readonly storeHits: Map<string, Map<string, number>> = new Map()

  private groups = new Map<string, ErrorGroup>()
  private readonly maxGroups: number

  constructor(maxGroups: number = 100) {
    this.maxGroups = maxGroups
  }

  /**
   * 添加错误到聚合器
   *
   * @param {ErrorContext} context - 错误上下文
   * @returns {ErrorGroup | undefined} 错误组（如果是新创建的）
   */
  addError(context: ErrorContext): ErrorGroup | undefined {
    const groupId = this.generateGroupId(context)
    const error = context.error as GeomStoreError
    const code = isGeomStoreError(error) ? error.code : 'UNKNOWN'
    const now = context.timestamp || Date.now()
    this._countStoreHit(groupId, context.storeName)

    // 检查是否已存在该组
    const group = this.groups.get(groupId)
    if (group) {
      // 更新组信息
      group.count++
      group.lastSeen = now

      // 更新受影响的Store
      if (!group.affectedStores.includes(context.storeName)) {
        group.affectedStores.push(context.storeName)
      }

      return undefined
    }

    // 创建新的错误组
    const newGroup: ErrorGroup = {
      groupId,
      type: error.name,
      code,
      message: error.message,
      count: 1,
      firstSeen: now,
      lastSeen: now,
      affectedStores: [context.storeName],
      sampleError: context,
    }

    this.groups.set(groupId, newGroup)

    // 限制组数量
    if (this.groups.size > this.maxGroups) {
      this.cleanupOldGroups()
    }

    return newGroup
  }

  /**
   * 获取所有错误组
   *
   * @returns {ErrorGroup[]} 错误组数组
   */
  getGroups(): ErrorGroup[] {
    return Array.from(this.groups.values()).sort((a, b) => b.lastSeen - a.lastSeen)
  }

  /**
   * 获取指定Store的组
   *
   * @param {string} storeName - Store名称
   * @returns {ErrorGroup[]} 错误组数组
   */
  getGroupsByStore(storeName: string): ErrorGroup[] {
    return this.getGroups().filter((group) => group.affectedStores.includes(storeName))
  }

  /**
   * 记录一次「组内某 Store」的错误计数
   *
   * @private
   */
  private _countStoreHit(groupId: string, storeName: string): void {
    let perStore = this.storeHits.get(groupId)
    if (!perStore) {
      perStore = new Map()
      this.storeHits.set(groupId, perStore)
    }
    perStore.set(storeName, (perStore.get(storeName) ?? 0) + 1)
  }

  /**
   * 清理旧的错误组
   *
   * @private
   */
  private cleanupOldGroups(): void {
    const groups = this.getGroups()
    const toDelete = groups.slice(this.maxGroups)
    toDelete.forEach((group) => {
      this.groups.delete(group.groupId)
      // 组与其按 Store 的计数同生命周期：只删组会让 byStore 继续累计已消失的组
      this.storeHits.delete(group.groupId)
    })
  }

  /**
   * 生成错误组ID
   *
   * @private
   * @param {ErrorContext} context - 错误上下文
   * @returns {string} 组ID
   */
  private generateGroupId(context: ErrorContext): string {
    const error = context.error
    const stack = error.stack || ''
    const message = error.message

    // 使用简单的哈希算法
    let hash = 0
    const str = `${error.name}:${message}:${stack.slice(0, 100)}`

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32bit integer
    }

    return Math.abs(hash).toString(36)
  }

  /**
   * 清空所有错误组
   */
  clear(): void {
    this.groups.clear()
    this.storeHits.clear()
  }

  /**
   * 获取统计信息
   *
   * @returns {object} 统计信息
   */
  getStats() {
    const groups = this.getGroups()

    return {
      totalGroups: groups.length,
      totalErrors: groups.reduce((sum, g) => sum + g.count, 0),
      byCode: groups.reduce(
        (acc, g) => {
          acc[g.code] = (acc[g.code] || 0) + g.count
          return acc
        },
        {} as Record<string, number>,
      ),
      // 按 Store 汇总组内计数（而非把组 count 累加给每个受影响 Store），
      // 且组被驱逐时计数同步消失，保证 byStore 各项之和恒等于 totalErrors
      byStore: this._byStoreCounts(),
    }
  }

  /**
   * 汇总现存各组的按 Store 计数
   *
   * @private
   */
  private _byStoreCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const perStore of this.storeHits.values()) {
      for (const [storeName, count] of perStore) {
        counts[storeName] = (counts[storeName] || 0) + count
      }
    }
    return counts
  }
}
