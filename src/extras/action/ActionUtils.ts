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
   * @param {Parameters<A[K]>} args - Action 参数
   * @returns {Promise<Awaited<ReturnType<A[K]>>>} Action执行结果
   * @throws {TypeError} 入参形态不对（缺 actionName、actionName 在该 actions 上不存在或不是
   *   函数）时**就地**抛出：不经过执行器，因此不会在 `getStats`/`getHistory` 里留下记录
   * @throws 被装饰 action 自身抛出的错误会**原样**向上抛出（同 `ActionExecutor.execute`）：
   *   本方法只是门面，不做包装、也不转成「失败结果」。executor 已把该次执行按失败记入历史
   *   （`getStats`/`getHistory` 可见），随后 rethrow 原始值——调用方 `catch (e) => e === thrown`
   *   的身份判断成立
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
    // 两种入参形态靠首参形状区分：Actions 只能是对象，Action 名可以是 string / symbol /
    // number（`keyof A` 对 `{ 0: fn }` 会推出 number）。此前用「非 string 且非 symbol」判定
    // 显式 actions，于是 (1) `execute()` / `execute(undefined)` 让 actions 与 actionName
    // 双双变成 undefined，(2) 数字键的合法调用被误投到显式 actions 分支
    const first = params[0]
    if (first === undefined || first === null) {
      throw new TypeError('ActionUtils.execute: 缺少 actionName（或 actions + actionName）参数')
    }
    const withExplicitActions = typeof first === 'object'
    const actions = (withExplicitActions ? first : this.actions) as A
    const actionName = (withExplicitActions ? params[1] : first) as keyof A
    const args = params.slice(withExplicitActions ? 2 : 1)

    // 执行前就地校验：名字打错（或传错 actions 实例、构造期传进非对象）时
    // ActionExecutor.run 抛的是 `actions[actionName] is not a function`，
    // 且这次失败还会被写进 executor 历史（getStats/getHistory 多出一条并非 action 执行的记录）
    const target: unknown = actions
    if (target === null || target === undefined || typeof (target as A)[actionName] !== 'function') {
      throw new TypeError(`ActionUtils.execute: action "${String(actionName)}" 不存在或不是函数`)
    }

    return this.executor.execute(actions, actionName, ...(args as Parameters<A[keyof A]>))
  }
}
