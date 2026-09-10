/**
 * GeomStore - 插件与钩子类型定义（契约层）
 *
 * 本文件是钩子/插件体系的类型契约源头：
 * - types 层定义接口，core/hooks 提供 HookSystem 实现，plugins 层依赖二者
 * - 依赖方向：plugins → core → types，禁止反向依赖
 */

import type { Actions, Getters, State, Store } from './store.js'

/**
 * 钩子名称枚举
 */
export type HookName =
  | 'beforeSetState'
  | 'afterSetState'
  | 'beforePatch'
  | 'afterPatch'
  | 'beforeDispatch'
  | 'afterDispatch'
  | 'beforeReplaceState'
  | 'afterReplaceState'
  | 'onError'

/**
 * 钩子处理函数
 */
export type HookHandler<TArgs extends unknown[] = unknown[], TResult = void> = (...args: TArgs) => TResult

/**
 * 钩子系统契约接口
 *
 * 由 core/hooks 的 HookSystem 类实现；类型层仅依赖此接口，
 * 避免 types 反向依赖实现类。
 */
export interface IHookSystem {
  /** 注册钩子处理器，返回取消注册函数 */
  on(hookName: HookName, handler: HookHandler): () => void
  /** 触发钩子 */
  emit(hookName: HookName, ...args: unknown[]): void
  /** 清除钩子（指定名称或全部） */
  clear(hookName?: HookName): void
  /** 查询钩子数量：传入 hookName 返回该钩子的 handler 数，不传返回已注册的钩子名称数 */
  size(hookName?: HookName): number
}

/**
 * 插件安装钩子 - 返回可选的卸载函数
 *
 * 泛型只开放**状态类型 S**：插件实现几乎只需要精确的 state 形状（如 `filter: (state) => …`），
 * actions / getters 使用其默认约束即可。若把 A / G 也开放，调用方传具体 Store 时会因
 * 参数逆变而在每个使用点被迫断言。
 *
 * 省略类型参数即得「适用于任意 Store」的插件（`Plugin` = `Plugin<State>`），
 * 例如 logger / analyzer 这类与状态形状无关的插件。
 */
export type PluginHook<S extends State = State> = (store: Store<S, Actions, Getters<S>>) => void | (() => void)

/**
 * 插件接口
 *
 * ```ts
 * const plugin: Plugin<UserState> = {
 *   name: 'user-analytics',
 *   install(store) {            // store: Store<UserState, …>，getState() 类型精确
 *     store.subscribe((state) => track(state.userInfo))
 *   },
 * }
 * const uninstall = store.use(plugin)   // 无需断言
 * ```
 */
export interface Plugin<S extends State = State> {
  name: string
  install: PluginHook<S>
}
