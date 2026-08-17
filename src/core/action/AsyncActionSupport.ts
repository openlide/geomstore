/**
 * GeomStore v1.0 - 异步Action支持
 *
 * 提供高性能的Action执行和管理功能，包括：
 * - 异步Action执行
 * - 并行/串行执行
 * - 重试机制
 * - 超时控制
 * - 执行历史记录
 * - 性能统计
 *
 * @since 1.0.0
 */

import type { AsyncActions, ActionResult } from '../../types/action'

/**
 * Action执行器类
 *
 * 负责管理异步Action的执行、重试、超时和性能监控
 *
 * @class ActionExecutor
 * @template A - 异步Actions类型
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const executor = new ActionExecutor<MyActions>()
 *
 * // 定义异步Actions
 * const actions = {
 *   fetchData: async (id: string) => {
 *     const response = await fetch(`/api/data/${id}`)
 *     return response.json()
 *   },
 *   saveData: async (data: any) => {
 *     return await fetch('/api/data', {
 *       method: 'POST',
 *       body: JSON.stringify(data)
 *     }).then(r => r.json())
 *   }
 * }
 *
 * // 执行单个Action
 * const data = await executor.execute(actions, 'fetchData', '123')
 *
 * // 执行带重试的Action
 * const result = await executor.executeWithRetry(
 *   actions,
 *   'fetchData',
 *   ['123'],
 *   { retries: 3, delay: 1000, onRetry: (error, attempt) => {
 *     console.log(`Retry ${attempt}:`, error.message)
 *   }}
 * )
 *
 * // 执行带超时的Action
 * const fastResult = await executor.executeWithTimeout(
 *   actions,
 *   'fetchData',
 *   ['123'],
 *   5000 // 5秒超时
 * )
 *
 * // 获取执行统计
 * const stats = executor.getStats('fetchData')
 * console.log(`Success rate: ${stats.successRate}%`)
 * ```
 */
export class ActionExecutor<A extends AsyncActions = AsyncActions> {
  /**
   * Action执行历史记录
   * @private
   * @type {Map<string, ActionResult[]>}
   */
  private actionResults: Map<string, ActionResult[]> = new Map()

  /**
   * 最大历史记录数量
   * @private
   * @type {number}
   */
  private maxHistory: number = 100

  /**
   * 执行Action
   *
   * 异步执行指定的Action，并记录执行结果
   *
   * @template K - Action名称类型
   * @param {A} actions - Actions对象
   * @param {K} actionName - 要执行的Action名称
   * @param {Parameters<A[K]>} args - Action参数
   * @returns {Promise<ReturnType<A[K]>>} Action执行结果
   * @throws {Error} 如果Action执行失败
   *
   * @example
   * ```typescript
   * try {
   *   const result = await executor.execute(actions, 'fetchData', 'user-123')
   *   console.log('Action succeeded:', result)
   * } catch (error) {
   *   console.error('Action failed:', error)
   * }
   * ```
   */
  async execute<K extends keyof A>(actions: A, actionName: K, ...args: Parameters<A[K]>): Promise<ReturnType<A[K]>> {
    const startTime = Date.now()

    try {
      const result = await actions[actionName](...args)
      const endTime = Date.now()

      // 记录成功结果
      this.recordResult(
        {
          success: true,
          data: result,
          startTime,
          endTime,
          duration: endTime - startTime,
        },
        String(actionName),
      )

      return result as ReturnType<A[keyof A]>
    } catch (error) {
      const endTime = Date.now()

      // 记录失败结果
      this.recordResult(
        {
          success: false,
          error: error as Error,
          startTime,
          endTime,
          duration: endTime - startTime,
        },
        String(actionName),
      )

      throw error
    }
  }

  /**
   * 并行执行多个Action
   *
   * 同时执行多个独立的Action，返回所有结果（包括错误）
   *
   * @template K - Action名称类型
   * @param {A} actions - Actions对象
   * @param {Array<{action: K, args: Parameters<A[K]>}>} tasks - 任务列表
   * @returns {Promise<Array<ReturnType<A[K]> | Error>>} 执行结果数组（成功返回结果，失败返回Error）
   *
   * @example
   * ```typescript
   * const results = await executor.executeParallel(actions, [
   *   { action: 'fetchUser', args: ['user-1'] },
   *   { action: 'fetchPosts', args: ['user-1'] },
   *   { action: 'fetchProfile', args: ['user-1'] }
   * ])
   *
   * results.forEach((result, index) => {
   *   if (result instanceof Error) {
   *     console.error(`Task ${index} failed:`, result)
   *   } else {
   *     console.log(`Task ${index} succeeded:`, result)
   *   }
   * })
   * ```
   */
  async executeParallel<K extends keyof A>(actions: A, tasks: Array<{ action: K; args: Parameters<A[K]> }>): Promise<Array<ReturnType<A[K]> | Error>> {
    return Promise.all(tasks.map((task) => this.execute(actions, task.action, ...task.args).catch((error) => error)))
  }

  /**
   * 串行执行多个Action
   *
   * 依次执行多个Action，每个Action完成后才执行下一个
   *
   * @template K - Action名称类型
   * @param {A} actions - Actions对象
   * @param {Array<{action: K, args: Parameters<A[K]>}>} tasks - 任务列表
   * @returns {Promise<Array<ReturnType<A[K]> | Error>>} 执行结果数组
   *
   * @example
   * ```typescript
   * const results = await executor.executeSequential(actions, [
   *   { action: 'validateData', args: [data] },
   *   { action: 'transformData', args: [data] },
   *   { action: 'saveData', args: [data] }
   * ])
   *
   * // 检查是否有失败
   * const hasFailures = results.some(r => r instanceof Error)
   * if (hasFailures) {
   *   console.log('Some tasks failed, aborting...')
   * } else {
   *   console.log('All tasks completed successfully')
   * }
   * ```
   */
  async executeSequential<K extends keyof A>(actions: A, tasks: Array<{ action: K; args: Parameters<A[K]> }>): Promise<Array<ReturnType<A[K]> | Error>> {
    const results: Array<ReturnType<A[K]> | Error> = []

    for (const task of tasks) {
      try {
        const result = await this.execute(actions, task.action, ...task.args)
        results.push(result)
      } catch (error) {
        results.push(error as Error)
      }
    }

    return results
  }

  /**
   * 重试Action执行
   *
   * 在Action失败时自动重试，支持指数退避策略
   *
   * @template K - Action名称类型
   * @param {A} actions - Actions对象
   * @param {K} actionName - Action名称
   * @param {Parameters<A[K]>} args - Action参数
   * @param {{retries?: number, delay?: number, onRetry?: (error: Error, attempt: number) => void}} options - 重试选项
   * @param {number} [options.retries=3] - 最大重试次数
   * @param {number} [options.delay=100] - 基础重试延迟（毫秒）
   * @param {(error: Error, attempt: number) => void} [options.onRetry] - 重试回调
   * @returns {Promise<ReturnType<A[K]>>} Action执行结果
   * @throws {Error} 如果所有重试都失败
   *
   * @example
   * ```typescript
   * const result = await executor.executeWithRetry(
   *   actions,
   *   'fetchData',
   *   ['user-123'],
   *   {
   *     retries: 3,
   *     delay: 1000,
   *     onRetry: (error, attempt) => {
   *       console.log(`Attempt ${attempt} failed:`, error.message)
   *       if (attempt === 3) {
   *         // 最后一次重试，显示用户友好的错误
   *         showError('服务暂时不可用，请稍后重试')
   *       }
   *     }
   *   }
   * )
   * ```
   */
  async executeWithRetry<K extends keyof A>(
    actions: A,
    actionName: K,
    args: Parameters<A[K]>,
    options: {
      retries?: number
      delay?: number
      onRetry?: (error: Error, attempt: number) => void
    } = {},
  ): Promise<ReturnType<A[K]>> {
    const { retries = 3, delay = 100, onRetry } = options
    let lastError: Error | undefined

    for (let i = 0; i <= retries; i++) {
      try {
        return await this.execute(actions, actionName, ...args)
      } catch (error) {
        lastError = error as Error

        if (i < retries) {
          if (onRetry) {
            onRetry(lastError, i + 1)
          }

          // 指数退避
          await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)))
        }
      }
    }

    if (!lastError) {
      throw new Error('Retry failed without error')
    }
    throw lastError
  }

  /**
   * 执行Action并设置超时
   *
   * 在指定时间内完成Action执行，超时则抛出错误
   *
   * @template K - Action名称类型
   * @param {A} actions - Actions对象
   * @param {K} actionName - Action名称
   * @param {Parameters<A[K]>} args - Action参数
   * @param {number} timeout - 超时时间（毫秒）
   * @returns {Promise<ReturnType<A[K]>>} Action执行结果
   * @throws {Error} 如果超时或Action执行失败
   *
   * @example
   * ```typescript
   * try {
   *   const result = await executor.executeWithTimeout(
   *     actions,
   *     'fetchData',
   *     ['user-123'],
   *     5000 // 5秒超时
   *   )
   *   console.log('Data fetched:', result)
   * } catch (error) {
   *   if (error.message.includes('timeout')) {
   *     console.error('Request timed out')
   *     showTimeoutError()
   *   } else {
   *     console.error('Request failed:', error)
   *   }
   * }
   * ```
   */
  async executeWithTimeout<K extends keyof A>(actions: A, actionName: K, args: Parameters<A[K]>, timeout: number): Promise<ReturnType<A[K]>> {
    // execute 为 async 方法不会同步抛出，且 Promise 构造器同步执行，
    // 因此 finally 到达时 timer 必已赋值（确定赋值断言，避免死分支）
    let timer!: ReturnType<typeof setTimeout>

    try {
      // 超时后输掉的 execute Promise 仍可能稍后 reject，而 Promise.race 只消费先 settle 的一方：
      // 预挂 catch 兜底，避免其成为 unhandled rejection（execute 内部已记录失败结果，此处仅静默）
      const execution = this.execute(actions, actionName, ...args)
      execution.catch(() => {})

      return await Promise.race([
        execution,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Action timeout after ${timeout}ms`)), timeout)
        }),
      ])
    } finally {
      // 无论成功/失败/超时，都清除定时器，避免句柄泄漏
      clearTimeout(timer)
    }
  }

  /**
   * 记录执行结果
   *
   * @private
   * @param {ActionResult} result - 执行结果
   * @param {string} actionName - Action名称
   */
  private recordResult(result: ActionResult, actionName: string): void {
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
      return this.actionResults.get(actionName) || []
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
   * @returns {{total: number, success: number, failure: number, avgDuration: number, successRate: number}} 统计信息
   * @throws {Error} 如果Action不存在
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
  getStats(actionName: string): {
    total: number
    success: number
    failure: number
    avgDuration: number
    successRate: number
  } {
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
  clearHistory(actionName?: string): void {
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
   * @returns {Record<string, {total: number, success: number, failure: number, avgDuration: number, successRate: number}>} 统计对象
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
  getAllStats(): Record<
    string,
    {
      total: number
      success: number
      failure: number
      avgDuration: number
      successRate: number
    }
  > {
    const stats: Record<
      string,
      {
        total: number
        success: number
        failure: number
        avgDuration: number
        successRate: number
      }
    > = {}

    for (const actionName of this.actionResults.keys()) {
      stats[actionName] = this.getStats(actionName)
    }

    return stats
  }
}
