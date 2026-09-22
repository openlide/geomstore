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
 *
 * @remarks 下方各方法的 `@example` 一律通过 `executor`（`AsyncActionSupport` 门面）调用：
 * 其 `getHistory`/`getStats`/`setMaxHistory` 与本类同名，`clearHistory(actionName)` 委托到
 * 本类的 {@link ActionHistoryTracker.clear}。直接持有本 tracker 的调用方把示例里的
 * `executor.clearHistory(...)` 换成 `tracker.clear(...)` 即可。
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
   * @returns {ActionResult[]} 执行历史数组的副本。传入 actionName 时按时间正序（最早在前，
   *   保持插入顺序）；未传时聚合所有 Action 并按 startTime 倒序（最新在前）
   *
   * @remarks 只有**数组容器**是副本（外部 push/splice 不会污染内部桶）；数组里的
   * `ActionResult` 条目仍与内部桶共享同一对象，改 `history[0].success` 之类会直接影响
   * 后续 `getHistory`/`getStats` 结果——请把返回的条目按只读值消费，需要改写就先自行拷贝。
   *
   * 判定「是否指定」用 `!== undefined` 而非真值：空串是合法 Action 名
   * （`String(actionName)` 对 `{'': fn}` 就会产出它），按真值会让该桶只写不读。
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
    if (actionName !== undefined) {
      // 返回副本：直接返回内部数组会让外部 push/splice 污染历史与 getStats 统计。
      // 只复制容器、不复制条目——逐条拷贝会让每次读历史都分配 N 个对象，而本方法是
      // 诊断/统计入口，读多写少；条目只读共享的代价已在 JSDoc 写明
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
   * @remarks 同 getHistory：以 `!== undefined` 区分「不传」与「传空串」，
   * 否则 `clear('')` 会清掉全部历史。
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
    if (actionName !== undefined) {
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
    // 非有限值/NaN 回退文档下限 1（否则 Math.max(1, NaN) === NaN，
    // 长度比较恒为 false 导致历史无界增长）；小数向下取整，使「最多 size 条」可判定
    this.maxHistory = Number.isFinite(size) ? Math.max(1, Math.floor(size)) : 1

    // 立即裁剪已有桶：只在 record 时 shift 无法收敛——缩容后每次 push 后 shift
    // 恰好相互抵消，桶长会永远钉死在旧上限
    for (const history of this.actionResults.values()) {
      if (history.length > this.maxHistory) {
        history.splice(0, history.length - this.maxHistory)
      }
    }
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
