/**
 * BatchManager - 批量更新管理器模块
 *
 * 职责：
 * - 管理批量更新状态
 * - 控制通知触发时机
 * - 支持嵌套批量更新
 *
 * @module BatchManager
 */

import type { BatchManagerInterface } from './types.js'
import { isProduction } from './utils.js'

/**
 * 批量更新管理器
 *
 * 在批量更新期间，状态变化不会触发监听器通知，
 * 只在批量更新结束时触发一次通知
 */
export class BatchManager implements BatchManagerInterface {
  private _depth = 0
  /** 只在构造期赋值、从不重指向，故 readonly */
  private readonly _onEnd: () => void

  /**
   * @param onEnd 批量更新结束时（深度归零）的回调，用于触发一次通知
   *
   * @throws {TypeError} onEnd 不是函数。本类经 `core/store/index.js` 对外导出，
   *   JS 调用方传 null/非函数此前会被静默接受，直到最外层 end() 才抛
   *   「this._onEnd is not a function」——离真正的误用点隔了整批写入，故就地早失败
   */
  constructor(onEnd: () => void) {
    if (typeof onEnd !== 'function') {
      throw new TypeError('[GeomStore] BatchManager requires an onEnd callback function')
    }
    this._onEnd = onEnd
  }

  /**
   * 是否在批量更新中
   */
  get isInBatch(): boolean {
    return this._depth > 0
  }

  /**
   * 开始批量更新
   */
  start(): void {
    this._depth++
  }

  /**
   * 结束批量更新
   *
   * 批量更新结束后，触发一次监听器通知
   */
  end(): void {
    // 精确判 0：_depth 只在 start() 递增、只在 >0 时递减、reset() 直接置 0，
    // 没有任何路径能把它带成负数——旧的 `<= 0` 里「负数」那一半是不可达死分支，
    // 留着会让人误以为存在负深度状态需要处理
    if (this._depth === 0) {
      // 生产环境静默（库口径：开发期提示类日志不进生产控制台）。
      // 失配的 end()/start() 会永久改变批量语义，故此处只告警不抛错：
      // 抛错会让「多调一次 end()」这种无害误用变成业务崩溃点
      if (!isProduction()) {
        console.warn('[GeomStore] BatchManager.end() called without matching start()')
      }
      return
    }
    this._depth--
    if (this._depth === 0) {
      this._onEnd()
    }
  }

  /**
   * 重置批量更新状态（**仅限 teardown 使用**）
   *
   * 直接把深度归零而不触发 `_onEnd`：批内已发生但被抑制的状态变更因此不会补发通知。
   * 这一取舍的前提是「重置即意味着宿主不再需要这批变更」——当前唯一调用点是
   * `Store.destroy()`。若在批进行中把它用作错误恢复/复用手段，
   * 监听器会永久停在批前的陈旧状态，故本方法不对外的职责边界在此写明：
   * 需要「结束并通知」请调 `end()` 配平 `start()`，不要用 `reset()`
   */
  reset(): void {
    // 与 end() 的未配对告警同一口径：本类对外导出，职责边界只写在注释里等于没写。
    // 批进行中调用 reset() 是误用（正解是配平地 end()），此处把「通知被丢弃」就地说明白
    if (!isProduction() && this._depth > 0) {
      console.warn('[GeomStore] BatchManager.reset() called during an active batch; suppressed notifications of this batch are dropped')
    }
    this._depth = 0
  }
}
