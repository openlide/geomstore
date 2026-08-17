/**
 * GeomStore v1.0.0 - 插件与钩子类型定义（契约层）
 *
 * 本文件是钩子/插件体系的类型契约源头：
 * - types 层定义接口，core/hooks 提供 HookSystem 实现，plugins 层依赖二者
 * - 依赖方向：plugins → core → types，禁止反向依赖
 */

import type { Store } from './store'

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
 */
export type PluginHook = (store: Store) => void | (() => void)

/**
 * 插件接口
 */
export interface Plugin {
  name: string
  install: PluginHook
}
