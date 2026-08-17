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

import type { BatchManagerInterface } from './types'
import { isProduction } from './utils'

/**
 * 批量更新管理器
 *
 * 在批量更新期间，状态变化不会触发监听器通知，
 * 只在批量更新结束时触发一次通知
 */
export class BatchManager implements BatchManagerInterface {
  private _depth = 0
  private _onEnd: () => void

  /**
   * @param onEnd 批量更新结束时的回调函数（用于触发通知）
   */
  constructor(onEnd: () => void) {
    this._onEnd = onEnd
  }

  /**
   * 是否在批量更新中
   */
  get isInBatch(): boolean {
    return this._depth > 0
  }

  /**
   * 获取批量更新深度
   */
  get depth(): number {
    return this._depth
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
   * 修复：添加深度为负数时的警告
   */
  end(): void {
    if (this._depth <= 0) {
      // 生产环境静默，避免控制台噪声
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
   * 重置批量更新状态
   */
  reset(): void {
    this._depth = 0
  }
}

/**
 * 创建批量执行函数
 * 在批量更新上下文中执行操作
 */
export function createBatchFunction(manager: BatchManager): <T>(fn: () => T) => T {
  return <T>(fn: () => T): T => {
    manager.start()
    try {
      return fn()
    } finally {
      manager.end()
    }
  }
}
