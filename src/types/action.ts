/**
 * GeomStore v1.0 - Action类型定义
 */

import type { Actions } from './store'

/**
 * 异步Actions类型（继承Actions）
 */
export interface AsyncActions extends Actions {
  [key: string]: (...args: unknown[]) => Promise<unknown>
}

/**
 * Action加载状态选项
 */
export interface ActionLoaderOptions {
  /** 自动管理loading状态 */
  autoLoading?: boolean
  /** loading状态字段名 */
  loadingKey?: string
  /** error状态字段名 */
  errorKey?: string
  /** error数据字段名 */
  errorDataKey?: string
  /**
   * 是否按 action 名称派生独立状态键（默认 false）
   *
   * 启用后状态键为 `${baseKey}_${actionName}`（如 `loading_fetchUser`），
   * 解决同一 ActionLoader 包装多个异步 action 并发执行时
   * loading/error 状态互相覆盖的问题；单个异步 action 场景可保持默认
   */
  perActionKeys?: boolean
}

/**
 * Action执行上下文
 */
export interface ActionExecutionContext<S = unknown, A = unknown> {
  /** 当前state */
  state: S
  /** 所有actions */
  actions: A
  /** Action名称 */
  actionName: string
  /** Action参数 */
  args: unknown[]
}

/**
 * Action执行结果
 */
export interface ActionResult<T = unknown> {
  /** 返回值 */
  data?: T
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: Error
  /** 开始时间 */
  startTime: number
  /** 结束时间 */
  endTime: number
  /** 执行时长 */
  duration: number
}

/**
 * Action装饰器类型
 */
export type ActionDecorator = (target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor) => PropertyDescriptor | void
