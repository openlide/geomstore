/**
 * GeomStore - 异步批量通知管理器
 *
 * 将同一 tick 内的多次状态更新合并为一次微任务通知，减少不必要的渲染与计算。
 *
 * 说明：此前本类与 StateFingerprint / debounce / throttle / scheduleIdle 等同处
 * `Optimizations.ts`；后几者无任何生产消费者（已在死代码清理中移除），本类独立成模块。
 */

/**
 * 异步批量通知管理器
 *
 * @class AsyncBatchNotifier
 * @description
 * 实现异步批量状态通知，将多次状态更新合并为一次通知，
 * 减少不必要的渲染和计算。
 *
 * @template S - 状态类型
 *
 * @example
 * ```typescript
 * const notifier = new AsyncBatchNotifier<MyState>()
 *
 * // 添加监听器
 * notifier.subscribe((state) => {
 *   console.log('State updated:', state)
 * })
 *
 * // 触发多次更新（会被批量处理）
 * notifier.notify(state1)
 * notifier.notify(state2)
 * notifier.notify(state3)
 *
 * // 在下一个微任务中，监听器只会被调用一次
 * ```
 */
export class AsyncBatchNotifier<S> {
  private listeners: Set<(state: S) => void> = new Set()
  private pending = false
  /** 是否存在待通知状态：以独立标志取代 latestState 的 null 哨兵，支持状态本身为 null 的场景 */
  private hasPendingState = false
  private latestState: S | null = null

  /**
   * 订阅状态变化
   *
   * @param {(state: S) => void} listener - 监听函数
   * @returns {() => void} 取消订阅的函数
   */
  subscribe(listener: (state: S) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 通知状态变化
   *
   * @param {S} state - 新状态
   *
   * @example
   * ```typescript
   * notifier.notify(newState)
   * ```
   */
  notify(state: S): void {
    this.latestState = state
    this.hasPendingState = true

    if (!this.pending) {
      this.pending = true

      // 使用微任务异步通知
      Promise.resolve().then(() => {
        this.flush()
      })
    }
  }

  /**
   * 立即刷新所有通知
   *
   * @private
   */
  private flush(): void {
    this.pending = false

    // 以 hasPendingState 判定是否有待通知，而非 latestState !== null
    if (!this.hasPendingState) {
      return
    }
    this.hasPendingState = false

    const state = this.latestState
    this.latestState = null

    // hasPendingState 为 true 时，latestState 必为 notify 写入的有效状态（即使 S 允许为 null）
    this.listeners.forEach((listener) => {
      try {
        listener(state as S)
      } catch (error) {
        console.error('[AsyncBatchNotifier] Error in listener:', error)
      }
    })
  }

  /**
   * 清空所有监听器
   */
  clear(): void {
    this.listeners.clear()
    this.latestState = null
    this.hasPendingState = false
  }

  /**
   * 获取监听器数量
   *
   * @returns {number} 监听器数量
   */
  size(): number {
    return this.listeners.size
  }
}
