/**
 * GeomStore - Action工具类
 *
 * 提供Action执行功能
 *
 * 注意：装饰器已迁移至独立模块，请从以下位置导入：
 * - `geomstore` 主入口
 * - `geomstore/extras/action/decorators`
 *
 */

import type { AsyncActions } from '../../types/action.js'
import type { Actions } from '../../types/store.js'
import { ActionExecutor } from './AsyncActionSupport.js'

/**
 * ActionUtils 配置选项
 */
export interface ActionUtilsOptions<A extends Actions = AsyncActions> {
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
 *
 * @example
 * ```typescript
 * const utils = new ActionUtils<MyActions>(actions)
 *
 * // 执行Action（复用构造时绑定的 actions）
 * const result = await utils.execute('fetchData', 'user-123')
 *
 * // 也可显式传入另一份 actions（如运行时才拿到的实例）
 * const other = await utils.execute(otherActions, 'fetchData', 'user-123')
 * ```
 */
export class ActionUtils<A extends Actions = AsyncActions> {
  /**
   * Action执行器
   * @private
   * @type {ActionExecutor<A>}
   */
  private executor: ActionExecutor<A>

  /**
   * 构造时绑定的 Actions 对象，供 `execute` 省略首参时使用
   * @private
   */
  private readonly actions: A

  /**
   * 创建Action工具实例
   *
   * @param {A} actions - Actions对象：绑定为本实例的默认执行目标
   * @param {ActionUtilsOptions<A>} [options] - 配置选项（支持依赖注入）
   */
  constructor(actions: A, options?: ActionUtilsOptions<A>) {
    this.actions = actions
    // 支持依赖注入，便于测试和扩展
    this.executor = options?.executor ?? new ActionExecutor<A>()
  }

  /**
   * 执行Action（代理到executor）
   *
   * @template K - Action名称类型
   * @param {A} actions - Actions对象（省略时使用构造时绑定的 actions）
   * @param {K} actionName - Action名称
   * @param {Parameters<A[K]>} args - Action参数
   * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果
   *
   * @example
   * ```typescript
   * const result = await utils.execute(actions, 'fetchData', 'user-123')
   * const same = await utils.execute('fetchData', 'user-123')
   * ```
   */
  async execute<K extends keyof A>(actionName: K, ...args: Parameters<A[K]>): Promise<Awaited<ReturnType<A[K]>>>
  async execute<K extends keyof A>(actions: A, actionName: K, ...args: Parameters<A[K]>): Promise<Awaited<ReturnType<A[K]>>>
  async execute(...params: unknown[]): Promise<unknown> {
    // 两种入参形态靠首参类型区分：Actions 只能是对象，Action 名只会是 string / symbol
    const withExplicitActions = typeof params[0] !== 'string' && typeof params[0] !== 'symbol'
    const actions = (withExplicitActions ? params[0] : this.actions) as A
    const actionName = (withExplicitActions ? params[1] : params[0]) as keyof A
    const args = params.slice(withExplicitActions ? 2 : 1)

    return this.executor.execute(actions, actionName, ...(args as Parameters<A[keyof A]>))
  }
}
