/**
 * ActionManager - Action 执行器模块
 *
 * 职责：
 * - 执行 Action 方法
 * - 处理 Action 错误
 * - 发送生命周期钩子
 *
 * @module ActionManager
 */

import { type State, type Actions, type InferActionArgs, type InferActionReturn, type ActionContextBase } from '../../types/store'
import { createError, ErrorCode } from '../error/GeomStoreError'
import type { IHookSystem } from '../../types/plugin'

/**
 * Action 执行器配置
 */
export interface ActionManagerOptions {
  /** Store 名称 */
  storeName: string
  /** 内部访问执行函数 */
  withInternalAccess: <T>(fn: () => T) => T
  /** 设置 dispatch 的状态 */
  setDispatching: (value: boolean) => void
  /** 触发通知 */
  notifyListeners: () => void
  /** 实例级钩子系统（必需） */
  hooks: IHookSystem
  /** 是否仅在状态实际变化时通知（默认 false） */
  notifyOnlyOnChange?: boolean
  /** 获取状态变更计数（仅 notifyOnlyOnChange 模式需要提供） */
  getMutationCount?: () => number
  /** dispatch 结束后刷新缓存（供 action 直接变异状态时同步缓存） */
  refreshCache?: () => void
  /** 获取最近一次通知已覆盖到的变更计数（用于补发去重，仅 onlyOnChange 需要） */
  getLastNotifiedMutationCount?: () => number
  /** 是否处于批量更新中（batch 进行中的补发由 batch 收尾统一通知） */
  isInBatch?: () => boolean
}

/**
 * Action 执行器
 *
 * 负责 Action 的初始化和执行
 */
export class ActionManager<S extends State = State, A extends Actions = Actions> {
  private readonly _storeName: string
  private readonly _withInternalAccess: <T>(fn: () => T) => T
  private readonly _setDispatching: (value: boolean) => void
  private readonly _notifyListeners: () => void
  /** 实例级钩子系统 */
  private _hooks: IHookSystem
  private _actions: A | null = null
  private _boundActions: Record<string, (...args: unknown[]) => unknown> = {}
  /** dispatch 嵌套深度计数：嵌套 dispatch 内层结束不得提前复位 dispatching 状态 */
  private _dispatchDepth = 0

  /** 当前 dispatch 嵌套深度（Store 批收尾守卫使用：action 体内 batch 不提前通知） */
  get dispatchDepth(): number {
    return this._dispatchDepth
  }
  private readonly _notifyOnlyOnChange: boolean
  private readonly _getMutationCount: () => number
  private readonly _refreshCache?: () => void
  private readonly _getLastNotifiedMutationCount?: () => number
  private readonly _isInBatch?: () => boolean

  constructor(options: ActionManagerOptions) {
    this._storeName = options.storeName
    this._withInternalAccess = options.withInternalAccess
    this._setDispatching = options.setDispatching
    this._notifyListeners = options.notifyListeners
    this._hooks = options.hooks
    this._notifyOnlyOnChange = options.notifyOnlyOnChange ?? false
    this._getMutationCount = options.getMutationCount ?? (() => 0)
    this._refreshCache = options.refreshCache
    this._getLastNotifiedMutationCount = options.getLastNotifiedMutationCount
    this._isInBatch = options.isInBatch
  }

  /**
   * 获取 Actions 对象
   * 注意：actions 在 initialize() 后才可用，调用前需确保已完成初始化
   */
  get actions(): A {
    if (!this._actions) {
      // 初始化前返回空对象，避免 null 导致运行时错误
      return {} as A
    }
    return this._actions
  }

  /**
   * 初始化 Actions
   *
   * 绑定 actions 的 this 到代理对象，使 this.actionName() 可用
   */
  initialize(actions: A | undefined, contextBase: ActionContextBase<S>): void {
    const actionObj = (actions || {}) as Record<string, (...args: unknown[]) => unknown>
    const boundActions: Record<string, (...args: unknown[]) => unknown> = {}

    // 创建 action 上下文代理，使 this.actionName() 可用
    const actionContext = new Proxy(contextBase as unknown as Record<string, unknown>, {
      get(target: Record<string, unknown>, prop: string | symbol) {
        // 优先返回绑定的 action（own property 判定：`in` 会命中原型链，
        // 使 this.toString()/this.hasOwnProperty() 等返回 undefined）
        if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(boundActions, prop)) {
          return boundActions[prop]
        }
        // 否则返回 Store 实例的属性
        if (typeof prop === 'symbol') {
          return undefined
        }
        return target[prop]
      },
    })

    // 绑定 actions 的 this 到代理对象
    Object.keys(actionObj).forEach((key) => {
      const originalAction = actionObj[key]
      boundActions[key] = (...args: unknown[]) => {
        return this._withInternalAccess(() => originalAction.call(actionContext, ...args))
      }
    })

    this._boundActions = boundActions
    // 动态绑定的 actions 结构与泛型 A 一致，但 TypeScript 无法静态推断
    // 使用类型断言将 Record<string, Fn> 映射为具体的 Actions 类型 A
    this._actions = boundActions as unknown as A
  }

  /**
   * 执行 Action - 类型安全实现
   */
  execute<K extends keyof A>(actionName: K, ...args: InferActionArgs<A, K>): InferActionReturn<A, K>
  execute(actionName: string, ...args: unknown[]): unknown
  execute(actionName: string | keyof A, ...args: unknown[]): unknown {
    const name = actionName as string
    // own property 判定：`in` 会命中原型链，dispatch('toString') 会绕过
    // 存在性检查后在调用 inherited 值时抛出误导性的 TypeError
    if (!Object.prototype.hasOwnProperty.call(this._boundActions, name)) {
      throw createError(ErrorCode.ACTION_NOT_FOUND, `Action "${name}" not found in store "${this._storeName}"`, {
        storeName: this._storeName,
        actionName: name,
        availableActions: Object.keys(this._boundActions),
      })
    }

    // 先设置 dispatching 状态，再触发钩子，确保监听器能获取正确的状态
    this._enterDispatch()
    this._hooks.emit('beforeDispatch', name, args)
    // onlyOnChange 模式：记录执行前的变更计数，未变化则跳过通知
    const mutationsBefore = this._notifyOnlyOnChange ? this._getMutationCount() : 0
    try {
      // boundActions 在 initialize 时已经包装了 _withInternalAccess，此处无需再次包装
      const result = this._boundActions[name](...args)
      this._exitDispatch()
      this._hooks.emit('afterDispatch', name, args, result)
      // 同步刷新缓存：action 可能通过 this.state.xxx = ... 直接变异状态，
      // 绕过 setState/$patch 导致缓存陈旧，此处按状态源强制回写
      this._safeRefreshCache()
      // 异步 action：通知统一延迟到 Promise 结束（fulfill 或 reject）时补发。
      // 同步段不单独通知——其变更会被完成时的补发覆盖，否则与续段 setState 的
      // 自发通知、完成补发叠加成三重通知。
      // await 之后的续段运行在内部访问作用域之外，对裸状态的直接写入既无通知也无计数：
      // - 默认模式无任何变更跟踪，完成时无条件补发（裸写入不可检测，宁多勿漏）
      // - onlyOnChange 模式按「计数 > 已通知覆盖计数」精确补发：
      //   续段 setState 已自发通知过的（计数已被覆盖）不再重复
      const onSettled = (): void => {
        this._safeRefreshCache()
        // 外层 dispatch 或 batch 进行中时跳过，由其收尾统一通知
        if (this._dispatchDepth > 0 || this._isInBatch?.()) return
        if (!this._notifyOnlyOnChange || this._getMutationCount() > (this._getLastNotifiedMutationCount?.() ?? -1)) {
          this._notifyListeners()
        }
      }
      if (result instanceof Promise) {
        // 异步失败同样触发 onError 钩子：reject 是 action 最常见的失败形态
        // （网络请求等），监控/上报插件对其不可失明——与同步 catch 路径对称。
        // 拒绝值保持原始错误不包装，不改变调用方捕获到的异常类型
        result.then(onSettled, (error) => {
          this._hooks.emit('onError', error)
          onSettled()
        })
        return result
      }
      // 同步 action：仅最外层 dispatch 且不在 batch 中时通知——
      // 内层 dispatch 结束时深度仍大于 0，提前通知会让监听器收到
      // 外层 action 尚未完成的中间状态；batch 中则由收尾统一通知
      if (this._dispatchDepth === 0 && !this._isInBatch?.() && (!this._notifyOnlyOnChange || this._getMutationCount() > mutationsBefore)) {
        this._notifyListeners()
      }
      return result
    } catch (error) {
      this._exitDispatch()
      this._hooks.emit('onError', error)
      // 失败路径同样处理已发生的变更：action 抛错前的 setState/直接变异
      // 因 _dispatching 被抑制了通知，此处补刷缓存并在最外层补发，
      // 否则「先置 loading 再失败」的中间状态对监听器永久不可见
      this._safeRefreshCache()
      // batch 进行中由 batch 收尾统一通知，不在中途泄漏
      if (this._dispatchDepth === 0 && !this._isInBatch?.() && (!this._notifyOnlyOnChange || this._getMutationCount() > mutationsBefore)) {
        this._notifyListeners()
      }
      throw createError(ErrorCode.ACTION_EXECUTION_ERROR, `Action "${name}" execution failed`, {
        storeName: this._storeName,
        actionName: name,
        args,
        originalError: error instanceof Error ? error.message : String(error),
        // 保留原始堆栈与错误对象，避免包装后丢失排障信息
        originalStack: error instanceof Error ? error.stack : undefined,
        originalErrorObject: error,
      })
    }
  }

  /**
   * 安全刷新缓存：缓存刷新失败不应影响 dispatch 主流程
   *
   * @private
   */
  private _safeRefreshCache(): void {
    if (!this._refreshCache) {
      return
    }
    try {
      this._refreshCache()
    } catch (error) {
      this._hooks.emit('onError', error)
    }
  }

  /**
   * 进入 dispatch：深度加一，共享 dispatching 状态
   *
   * @private
   */
  private _enterDispatch(): void {
    this._dispatchDepth++
    this._setDispatching(true)
  }

  /**
   * 退出 dispatch：深度减一，仅最外层结束时复位 dispatching 状态
   *
   * @private
   */
  private _exitDispatch(): void {
    if (this._dispatchDepth > 0) {
      this._dispatchDepth--
    }
    this._setDispatching(this._dispatchDepth > 0)
  }
}

/**
 * Getter 执行器
 */
export class GetterManager<S extends State = State, G extends Record<string, (state: S) => unknown> = Record<string, (state: S) => unknown>> {
  private readonly _storeName: string
  private readonly _getState: () => S
  private _getters: G | null = null

  constructor(storeName: string, getState: () => S) {
    this._storeName = storeName
    this._getState = getState
  }

  /**
   * 获取 Getters 对象
   */
  get getters(): G {
    return this._getters as G
  }

  /**
   * 获取所有 getter 名称列表
   */
  getGetterNames(): string[] {
    return this._getters ? Object.keys(this._getters) : []
  }

  /**
   * 初始化 Getters
   */
  initialize(getters: G | undefined): void {
    this._getters = (getters || {}) as G
  }

  /**
   * 执行 Getter
   */
  execute<K extends keyof G>(getterName: K): G[K] extends (state: S) => infer R ? R : unknown
  execute(getterName: string): unknown
  execute(getterName: string | keyof G): unknown {
    const name = getterName as string
    // own property 判定：`in` 会命中原型链，getter('toString') 会静默调用
    // 继承方法并把非 getter 结果返回给调用方
    if (!this._getters || !Object.prototype.hasOwnProperty.call(this._getters, name)) {
      throw createError(ErrorCode.SELECTOR_NOT_FOUND, `Getter "${name}" not found in store "${this._storeName}"`, {
        storeName: this._storeName,
        getterName: name,
        availableGetters: this._getters ? Object.keys(this._getters) : [],
      })
    }

    try {
      // getter 拿到的是 Store 传入的状态代理（只读保护），
      // 不在内部访问模式下执行，保证对状态的写入会被保护层拦截而非静默生效
      const result = (this._getters as Record<string, (state: S) => unknown>)[name](this._getState())
      return result
    } catch (error) {
      throw createError(ErrorCode.SELECTOR_EXECUTION_ERROR, `Getter "${name}" execution failed`, {
        storeName: this._storeName,
        getterName: name,
        originalError: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
