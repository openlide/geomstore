/**
 * GeomStore v1.0 - Action工具类
 *
 * 提供Action执行功能
 *
 * 注意：装饰器已迁移至独立模块，请从以下位置导入：
 * - `geomstore` 主入口
 * - `geomstore/core/action/decorators`
 *
 * @since 1.0.0
 */

import type { AsyncActions } from '../../types/action'
import { ActionExecutor } from './AsyncActionSupport'

/**
 * ActionUtils 配置选项
 */
export interface ActionUtilsOptions<A extends AsyncActions = AsyncActions> {
  /** 自定义执行器实例 */
  executor?: ActionExecutor<A>
}

/**
 * Action工具类
 *
 * 提供Action执行功能
 *
 * @class ActionUtils
 * @template A - 异步Actions类型
 * @since 1.0.0
 *
 * @example
 * ```typescript
 * const utils = new ActionUtils<MyActions>(actions)
 *
 * // 执行Action
 * const result = await utils.execute(actions, 'fetchData', 'user-123')
 * ```
 */
export class ActionUtils<A extends AsyncActions = AsyncActions> {
  /**
   * Action执行器
   * @private
   * @type {ActionExecutor<A>}
   */
  private executor: ActionExecutor<A>

  /**
   * 创建Action工具实例
   *
   * @param {A} _actions - Actions对象（保留用于扩展）
   * @param {ActionUtilsOptions<A>} [options] - 配置选项（支持依赖注入）
   */
  constructor(_actions: A, options?: ActionUtilsOptions<A>) {
    // 支持依赖注入，便于测试和扩展
    this.executor = options?.executor ?? new ActionExecutor<A>()
  }

  /**
   * 执行Action（代理到executor）
   *
   * @template K - Action名称类型
   * @param {A} actions - Actions对象
   * @param {K} actionName - Action名称
   * @param {Parameters<A[K]>} args - Action参数
   * @returns {Promise<ReturnType<A[K]>>} Action执行结果
   *
   * @example
   * ```typescript
   * const result = await utils.execute(actions, 'fetchData', 'user-123')
   * ```
   */
  async execute<K extends keyof A>(actions: A, actionName: K, ...args: Parameters<A[K]>): Promise<ReturnType<A[K]>> {
    return this.executor.execute(actions, actionName, ...args)
  }
}
