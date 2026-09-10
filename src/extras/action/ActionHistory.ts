/**
 * GeomStore - Action 执行历史与统计
 *
 * 自 AsyncActionSupport.ts 拆出：按 Action 名维护有界执行历史，并派生统计指标。
 * 不持有执行器状态，供 ActionExecutor 组合使用。
 *
 * @module action/ActionHistory
 */

import type { ActionResult } from '../../types/action.js'

/** 单个 Action 的执行统计 */
export interface ActionStats {
  total: number
  success: number
  failure: number
  avgDuration: number
  successRate: number
}

/**
 * Action 执行历史与统计
 *
 * 历史按 Action 名分桶，每桶有界（超出淘汰最旧一条）。
 */
export class ActionHistoryTracker {
  /**
   * Action执行历史记录
   * @type {Map<string, ActionResult[]>}
   */
  private actionResults: Map<string, ActionResult[]> = new Map()

  /**
   * 最大历史记录数量
   * @type {number}
   */
  private maxHistory: number = 100

  /**
   * 记录执行结果
   *
   * @param {ActionResult} result - 执行结果
   * @param {string} actionName - Action名称
   */
  record(result: ActionResult, actionName: string): void {
    if (!this.actionResults.has(actionName)) {
      this.actionResults.set(actionName, [])
    }

    const history = this.actionResults.get(actionName)
    if (history) {
      history.push(result)

      // 限制历史大小
      if (history.length > this.maxHistory) {
        history.shift()
      }
    }
  }

  /**
   * 获取Action执行历史
   *
   * 返回指定Action或所有Action的执行历史
   *
   * @param {string} [actionName] - Action名称，如果未指定则返回所有Action的历史
   * @returns {ActionResult[]} 执行历史数组（按时间倒序）
   *
   * @example
   * ```typescript
   * // 获取特定Action的历史
   * const history = executor.getHistory('fetchData')
   * console.log(`Total executions: ${history.length}`)
   *
   * // 获取所有Action的历史
   * const allHistory = executor.getHistory()
   * allHistory.forEach(record => {
   *   console.log(`${record.success ? 'Success' : 'Failed'}: ${record.duration}ms`)
   * })
   * ```
   */
  getHistory(actionName?: string): ActionResult[] {
    if (actionName) {
      // 返回副本：直接返回内部数组会让外部 push/splice 污染历史与 getStats 统计
      return [...(this.actionResults.get(actionName) ?? [])]
    }

    // 返回所有action的历史
    const allResults: ActionResult[] = []
    for (const results of this.actionResults.values()) {
      allResults.push(...results)
    }

    return allResults.sort((a, b) => b.startTime - a.startTime)
  }

  /**
   * 获取Action执行统计
   *
   * 计算指定Action的执行统计信息
   *
   * @param {string} actionName - Action名称
   * @returns {ActionStats} 统计信息
   *
   * @example
   * ```typescript
   * const stats = executor.getStats('fetchData')
   * console.log(`Total executions: ${stats.total}`)
   * console.log(`Success rate: ${stats.successRate.toFixed(2)}%`)
   * console.log(`Average duration: ${stats.avgDuration.toFixed(2)}ms`)
   * console.log(`Failures: ${stats.failure}`)
   * ```
   */
  getStats(actionName: string): ActionStats {
    const history = this.actionResults.get(actionName) || []
    const total = history.length
    const success = history.filter((r) => r.success).length
    const failure = total - success
    const totalDuration = history.reduce((sum, r) => sum + r.duration, 0)
    const avgDuration = total > 0 ? totalDuration / total : 0
    const successRate = total > 0 ? (success / total) * 100 : 0

    return {
      total,
      success,
      failure,
      avgDuration,
      successRate,
    }
  }

  /**
   * 清除执行历史
   *
   * 删除指定Action或所有Action的执行历史
   *
   * @param {string} [actionName] - Action名称，如果未指定则清除所有历史
   *
   * @example
   * ```typescript
   * // 清除特定Action的历史
   * executor.clearHistory('fetchData')
   *
   * // 清除所有历史
   * executor.clearHistory()
   * ```
   */
  clear(actionName?: string): void {
    if (actionName) {
      this.actionResults.delete(actionName)
    } else {
      this.actionResults.clear()
    }
  }

  /**
   * 设置最大历史记录数
   *
   * 设置每个Action最多保留的历史记录数量
   *
   * @param {number} size - 最大历史记录数（必须 >= 1）
   *
   * @example
   * ```typescript
   * // 只保留最近50条记录
   * executor.setMaxHistory(50)
   * ```
   */
  setMaxHistory(size: number): void {
    this.maxHistory = Math.max(1, size)
  }

  /**
   * 获取所有Action的统计
   *
   * 返回所有已执行Action的统计信息
   *
   * @returns {Record<string, ActionStats>} 统计对象
   *
   * @example
   * ```typescript
   * const allStats = executor.getAllStats()
   *
   * for (const [actionName, stats] of Object.entries(allStats)) {
   *   console.log(`${actionName}:`)
   *   console.log(`  Total: ${stats.total}`)
   *   console.log(`  Success Rate: ${stats.successRate.toFixed(2)}%`)
   *   console.log(`  Avg Duration: ${stats.avgDuration.toFixed(2)}ms`)
   * }
   * ```
   */
  getAllStats(): Record<string, ActionStats> {
    const stats: Record<string, ActionStats> = {}

    for (const actionName of this.actionResults.keys()) {
      stats[actionName] = this.getStats(actionName)
    }

    return stats
  }
}
