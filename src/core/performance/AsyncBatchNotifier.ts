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
   * 同一函数重复订阅只登记一份（Set 按身份去重），任一退订句柄生效即不再收到通知；
   * 句柄本身幂等，重复调用只释放自己那一次订阅，不会误删之后重新建立的订阅。
   *
   * @param {(state: S) => void} listener - 监听函数
   * @returns {() => void} 取消订阅的函数
   */
  subscribe(listener: (state: S) => void): () => void {
    this.listeners.add(listener)

    // 句柄一次性：按身份 delete 会让旧句柄在「同一函数重新订阅」之后把新订阅一并删掉
    // （Set 只按身份去重，第二次订阅复用同一个成员，旧句柄的重复调用无从区分）
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      this.listeners.delete(listener)
    }
  }

  /**
   * 通知状态变化
   *
   * @remarks 投递集合的口径：批次在微任务里 flush 时按当时的在册名单逐个复核——
   * flush 之后（含某个监听器回调内）新增的订阅者不参与本批次，
   * 已在 flush 过程中退订或被 `clear()` 摘除的监听器同样不再收这一次回调。
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
    // 遍历快照：Set.forEach 会访问迭代期间新增的元素（删除后再加还可能重复访问），
    // 而本类是公开导出、监听器内重入 notify/subscribe/clear 是预期用法——
    // 直接在活集合上迭代会让新订阅者被同一批次以陈旧状态回调。
    // 快照的另一半也必须处理：迭代中已退订（或被 clear() 摘除）的监听器不再投递。
    // 本类的消费者是「状态变化 → 渲染/清理」一类的下游，在组件卸载等场景下
    // 退订即表示处理方已失效，多投一次会拿最后一次状态去跑已销毁的逻辑
    for (const listener of Array.from(this.listeners)) {
      if (!this.listeners.has(listener)) {
        continue
      }
      try {
        listener(state as S)
      } catch (error) {
        console.error('[AsyncBatchNotifier] Error in listener:', error)
      }
    }
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
