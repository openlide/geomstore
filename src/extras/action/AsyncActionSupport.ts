/**
 * GeomStore - 异步Action支持
 *
 * 提供高性能的Action执行和管理功能，包括：
 * - 异步Action执行
 * - 并行/串行执行
 * - 重试机制
 * - 超时控制
 * - 执行历史记录
 * - 性能统计
 *
 * 与 action 装饰器的边界（avoid 重复/漂移）：
 * - 本类面向「程序化/编排式」执行：并行 executeParallel、串行 executeSequential、
 *   跨多次调用统一收口 executeWithRetry / executeWithTimeout 与聚合统计 getStats，
 *   适合在 action 定义之外编排多个异步任务并做性能观测。
 * - 单方法维度的重试/超时/防抖/节流等横切关注点，优先使用 action 装饰器
 *   （withRetry / withTimeout / withDebounce / withThrottle / withCache）：
 *   它们直接作用于 Store action 定义、按宿主实例隔离、与 dispatch 生命周期一致。
 * - 二者在 retry/timeout 上能力重叠。以装饰器作为单方法场景的主导方案；
 *   仅在需要并行/串行编排或聚合统计时再用本执行器，避免同一逻辑两套实现长期漂移。
 * - 历史记录按「一次逻辑调用一条」记账：executeWithRetry 的逐次尝试、executeWithTimeout
 *   超时后底层 action 的迟到结算都不写入历史，故 getStats 统计的是调用而非尝试。
 *
 */

import type { AsyncActions, ActionResult } from '../../types/action.js'
import type { Actions } from '../../types/store.js'
import { retryWithBackoff, raceWithTimeout, toError } from './async-core.js'
import { ActionHistoryTracker, type ActionStats } from './ActionHistory.js'

/**
 * Action执行器类
 *
 * 负责管理异步Action的执行、重试、超时和性能监控
 *
 * @class ActionExecutor
 * @template A - Actions 类型（异步/同步均可；AsyncActions 仅作为默认值）
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
export class ActionExecutor<A extends Actions = AsyncActions> {
  /** 执行历史与统计（实现已拆至 ./ActionHistory.js） */
  private readonly history = new ActionHistoryTracker()

  /**
   * 执行Action
   *
   * 异步执行指定的Action，并记录执行结果
   *
   * @template K - Action名称类型
   * @param {A} actions - Actions对象
   * @param {K} actionName - 要执行的Action名称
   * @param {Parameters<A[K]>} args - Action参数
   * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果（异步 action 返回其 resolve 值，不会出现 Promise<Promise<T>>）
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
  async execute<K extends keyof A>(actions: A, actionName: K, ...args: Parameters<A[K]>): Promise<Awaited<ReturnType<A[K]>>> {
    return this.recordOutcome(actionName, () => this.run(actions, actionName, args))
  }

  /**
   * 执行 Action 但不写历史
   *
   * 重试/超时等「一次逻辑调用可能对应多次底层执行」的路径用它，再由 `recordOutcome`
   * 就整体结果记一条：若直接用 `execute`，3 次重试会落 4 条记录，`getStats().total`
   * 变成尝试次数、`successRate` 对最终成功的调用报出 25%，中间失败还会挤掉其他
   * Action 的真实记录（历史按 maxHistory 有界）。
   *
   * @private
   */
  private async run<K extends keyof A>(actions: A, actionName: K, args: Parameters<A[K]>): Promise<Awaited<ReturnType<A[K]>>> {
    return await actions[actionName](...args)
  }

  /**
   * 围绕一次「逻辑调用」记录恰好一条历史
   *
   * `run` 只负责执行、不记账，记账统一收口在这里：错误经 `toError` 规范化后写入
   * `ActionResult.error`，向外抛出的仍是原始错误值。
   *
   * @private
   */
  private async recordOutcome<K extends keyof A>(actionName: K, run: () => Promise<Awaited<ReturnType<A[K]>>>): Promise<Awaited<ReturnType<A[K]>>> {
    const startTime = Date.now()

    try {
      // await 已解开 Promise，result 即 Awaited<ReturnType<A[K]>>，无需断言
      const result = await run()
      const endTime = Date.now()

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

      return result
    } catch (error) {
      const endTime = Date.now()

      this.recordResult(
        {
          success: false,
          error: toError(error),
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
   * @returns {Promise<Array<Awaited<ReturnType<A[K]>> | Error>>} 执行结果数组（成功返回结果，失败返回Error）
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
  async executeParallel<K extends keyof A>(actions: A, tasks: Array<{ action: K; args: Parameters<A[K]> }>): Promise<Array<Awaited<ReturnType<A[K]>> | Error>> {
    return Promise.all(tasks.map((task) => this.execute(actions, task.action, ...task.args).catch((error) => toError(error))))
  }

  /**
   * 串行执行多个Action
   *
   * 依次执行多个Action，每个Action完成后才执行下一个
   *
   * @template K - Action名称类型
   * @param {A} actions - Actions对象
   * @param {Array<{action: K, args: Parameters<A[K]>}>} tasks - 任务列表
   * @returns {Promise<Array<Awaited<ReturnType<A[K]>> | Error>>} 执行结果数组
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
  async executeSequential<K extends keyof A>(
    actions: A,
    tasks: Array<{ action: K; args: Parameters<A[K]> }>,
  ): Promise<Array<Awaited<ReturnType<A[K]>> | Error>> {
    const results: Array<Awaited<ReturnType<A[K]>> | Error> = []

    for (const task of tasks) {
      try {
        const result = await this.execute(actions, task.action, ...task.args)
        results.push(result)
      } catch (error) {
        // 声明的失败侧类型是 Error，故规范化（抛出的可能字符串/普通对象）
        results.push(toError(error))
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
   * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果
   * @throws {Error} 如果所有重试都失败
   *
   * @remarks 历史按「一次逻辑调用」记账：逐次重试不单独入历史，`getStats()` 的 total
   * 与 `successRate` 因此反映调用结果而非单次尝试结果。
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
  ): Promise<Awaited<ReturnType<A[K]>>> {
    const { retries = 3, delay = 100, onRetry } = options
    // 复用公共内核，与 withRetry 装饰器同一实现，避免退避语义漂移。
    // 逐次尝试走不记账的 run()，整体结果只记一条历史
    return this.recordOutcome(actionName, () => retryWithBackoff(() => this.run(actions, actionName, args), { retries, delay, onRetry }))
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
   * @param {number} timeout - 超时时间（毫秒，必须为大于 0 的有限数值）
   * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果
   * @throws {Error} 如果超时或Action执行失败
   * @throws {RangeError} timeout 非法
   *
   * @remarks Promise 无法取消：超时只让本方法提前 reject，底层 action 仍会执行到结束，
   * 其迟到结果被丢弃且不写入历史（本方法按「一次调用一条记录」记为超时失败）。
   * 需要真正中断请在 action 内部使用 AbortController 等取消机制。
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
  async executeWithTimeout<K extends keyof A>(actions: A, actionName: K, args: Parameters<A[K]>, timeout: number): Promise<Awaited<ReturnType<A[K]>>> {
    // 复用公共内核，与 withTimeout 装饰器同一实现
    // （Promise.race 会消费落败方迟到 reject，无需额外兜底 catch）
    //
    // 记账挂在 race 之外：超时先落地时本次调用即以 timeout 失败入历史，底层 action
    // 稍后结算不会再写一条（Promise 无法取消，见 JSDoc）——否则 getHistory/getStats
    // 会报出调用方从未观察到的结果
    return this.recordOutcome(actionName, () => raceWithTimeout(this.run(actions, actionName, args), timeout, `Action timeout after ${timeout}ms`))
  }

  /**
   * 记录执行结果（实现已拆至 ./ActionHistory.js）
   *
   * @private
   */
  private recordResult(result: ActionResult, actionName: string): void {
    this.history.record(result, actionName)
  }

  /**
   * 获取Action执行历史
   *
   * 返回指定Action或所有Action的执行历史
   *
   * @param {string} [actionName] - Action名称，如果未指定则返回所有Action的历史
   * @returns {ActionResult[]} 执行历史数组（按时间倒序）
   */
  getHistory(actionName?: string): ActionResult[] {
    return this.history.getHistory(actionName)
  }

  /**
   * 获取Action执行统计
   *
   * 计算指定Action的执行统计信息
   *
   * @param {string} actionName - Action名称
   * @returns {ActionStats} 统计信息
   */
  getStats(actionName: string): ActionStats {
    return this.history.getStats(actionName)
  }

  /**
   * 清除执行历史
   *
   * 删除指定Action或所有Action的执行历史
   *
   * @param {string} [actionName] - Action名称，如果未指定则清除所有历史
   */
  clearHistory(actionName?: string): void {
    this.history.clear(actionName)
  }

  /**
   * 设置最大历史记录数
   *
   * 设置每个Action最多保留的历史记录数量
   *
   * @param {number} size - 最大历史记录数（必须 >= 1）
   */
  setMaxHistory(size: number): void {
    this.history.setMaxHistory(size)
  }

  /**
   * 获取所有Action的统计
   *
   * 返回所有已执行Action的统计信息
   *
   * @returns {Record<string, ActionStats>} 统计对象
   */
  getAllStats(): Record<string, ActionStats> {
    return this.history.getAllStats()
  }
}
