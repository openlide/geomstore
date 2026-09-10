/**
 * GeomStore - Action加载状态管理
 *
 * 提供自动管理Action执行时的loading状态、错误状态和错误数据的功能
 *
 */

import type { ActionLoaderOptions } from '../../types/action.js'

/**
 * Action加载状态管理器
 *
 * 用于包装异步Action，自动管理其执行状态（loading、error、errorData）
 *
 * @class ActionLoader
 *
 * @example
 * ```typescript
 * const loader = new ActionLoader({
 *   autoLoading: true,
 *   loadingKey: 'loading',
 *   errorKey: 'error',
 *   errorDataKey: 'errorData'
 * })
 *
 * // 包装Action
 * const wrappedAction = loader.wrap(
 *   async (userId: string) => {
 *     return await fetchUser(userId)
 *   },
 *   'fetchUser',
 *   store.setState.bind(store)
 * )
 *
 * // 执行时自动设置loading状态
 * await wrappedAction('user123')
 * // loading: false, error: null, errorData: null
 * ```
 */
export class ActionLoader {
  /**
   * 加载状态映射
   * @private
   * @type {Map<string, boolean>}
   */
  private loadingStates: Map<string, boolean> = new Map()

  /**
   * loading 引用计数（按 loading 键）：同一 action 重叠调用时，
   * 首个调用置 true、最后一个完成才置 false，避免共享布尔键的提前翻转。
   * 可注入共享存储（withLoading 场景）：同宿主上不同选项签名的装饰器
   * 对同一 loading 键的计数必须集中，否则仍会互相提前翻转
   * @private
   */
  private loadingRefCounts: Map<string, number>

  /**
   * 错误映射
   * @private
   * @type {Map<string, Error | null>}
   */
  private errors: Map<string, Error | null> = new Map()

  /**
   * 错误数据映射
   * @private
   * @type {Map<string, unknown>}
   */
  private errorData: Map<string, unknown> = new Map()

  /**
   * 配置选项
   * @private
   * @type {Required<ActionLoaderOptions>}
   */
  private options: Required<Omit<ActionLoaderOptions, 'sharedLoadingCounts'>>

  /**
   * 创建Action加载器实例
   *
   * @param {ActionLoaderOptions} [options={}] - 配置选项
   *
   * @example
   * ```typescript
   * // 使用默认选项
   * const loader = new ActionLoader()
   *
   * // 自定义选项
   * const customLoader = new ActionLoader({
   *   autoLoading: true,
   *   loadingKey: 'isLoading',
   *   errorKey: 'myError',
   *   errorDataKey: 'errorDetails'
   * })
   * ```
   */
  constructor(options: ActionLoaderOptions = {}) {
    this.loadingRefCounts = options.sharedLoadingCounts ?? new Map()
    this.options = {
      autoLoading: options.autoLoading ?? true,
      loadingKey: options.loadingKey ?? 'loading',
      errorKey: options.errorKey ?? 'error',
      errorDataKey: options.errorDataKey ?? 'errorData',
      // 默认 false：保持单键行为向后兼容；多 action 并发场景应启用 perActionKeys
      perActionKeys: options.perActionKeys ?? false,
    }
  }

  /**
   * 包装Action，自动管理加载状态
   *
   * 执行时会自动设置loading状态，成功后清除loading和error，失败时设置error
   *
   * @template T - Action函数类型
   * @param {T} action - 要包装的异步Action函数
   * @param {string} actionName - Action名称（用于状态键）
   * @param {(key: string, value: unknown) => void} setState - 设置状态的函数
   * @returns {T} 包装后的Action
   *
   * @example
   * ```typescript
   * const fetchUserAction = async (userId: string) => {
   *   const user = await api.getUser(userId)
   *   return user
   * }
   *
   * const wrapped = loader.wrap(
   *   fetchUserAction,
   *   'fetchUser',
   *   store.setState.bind(store)
   * )
   *
   * // 执行时自动管理状态
   * await wrapped('user123')
   * // state.loading = false (执行时为true)
   * // state.error = null
   * ```
   */
  wrap<T extends (...args: unknown[]) => Promise<unknown>>(action: T, actionName: string, setState: (key: string, value: unknown) => void): T {
    return (async (...args: unknown[]) => {
      // 设置loading状态（引用计数）。increment 在 try 之外且内部先计数再 setState：
      // setState 同步抛错（如 store 已销毁）时计数残留 +1，loading 永远无法回 false，
      // 失败时回滚计数
      if (this.options.autoLoading) {
        try {
          this.incrementLoading(actionName, setState)
        } catch (error) {
          this.decrementLoading(actionName, () => {})
          throw error
        }
      }

      try {
        const result = await action(...args)

        // 清除loading状态（引用计数归零才置 false）
        if (this.options.autoLoading) {
          this.safeRunStateEffect(() => this.decrementLoading(actionName, setState))
        }
        // 错误状态管理独立于 loading 开关：即使 autoLoading 关闭也应清除陈旧错误
        this.safeRunStateEffect(() => this.clearError(actionName, setState))

        return result
      } catch (error) {
        // 清除loading，设置error
        if (this.options.autoLoading) {
          this.safeRunStateEffect(() => this.decrementLoading(actionName, setState))
        }
        // 错误状态管理独立于 loading 开关：即使 autoLoading 关闭也应记录错误
        this.safeRunStateEffect(() => this.setError(actionName, error as Error, setState))

        throw error
      }
    }) as T
  }

  /**
   * 执行辅助状态写入（loading/error/errorData），失败不外泄
   *
   * 这些是派生的 UI 状态，写入失败（典型场景：action 执行期间 store 被销毁，
   * setState 抛 "Cannot call setState on a destroyed Store"）不得掩盖主流程结果：
   * 成功路径冒泡会用新异常替换掉 action 的返回值，失败路径冒泡会替换掉 action 的
   * 原始错误，两种情况调用方看到的都是与真实故障无关的异常。
   *
   * 注意 incrementLoading 不走此助手：wrap 依赖它抛错来回滚已递增的引用计数。
   *
   * @private
   */
  private safeRunStateEffect(effect: () => void): void {
    try {
      effect()
    } catch {
      // 辅助状态写入失败：忽略，保证 action 的返回值/原始错误如实传出。
      // 后果仅是 loading/error 状态未更新，本就可由调用方观察到
    }
  }

  /**
   * 递增 loading 引用计数；首个进行中的调用才将 loading 置为 true
   *
   * @private
   */
  private incrementLoading(actionName: string, setState: (key: string, value: unknown) => void): void {
    const key = this.getLoadingKey(actionName)
    const count = (this.loadingRefCounts.get(key) ?? 0) + 1
    this.loadingRefCounts.set(key, count)
    if (count === 1) {
      this.loadingStates.set(key, true)
      setState(key, true)
    }
  }

  /**
   * 递减 loading 引用计数；最后一个完成的调用才将 loading 置为 false
   *
   * @private
   */
  private decrementLoading(actionName: string, setState: (key: string, value: unknown) => void): void {
    const key = this.getLoadingKey(actionName)
    const count = Math.max(0, (this.loadingRefCounts.get(key) ?? 1) - 1)
    this.loadingRefCounts.set(key, count)
    if (count === 0) {
      this.loadingStates.set(key, false)
      setState(key, false)
    }
  }

  /**
   * 设置error
   *
   * @private
   * @param {string} actionName - Action名称
   * @param {Error | null} error - 错误对象或null
   * @param {(key: string, value: unknown) => void} setState - 设置状态的函数
   */
  private setError(actionName: string, error: Error | null, setState: (key: string, value: unknown) => void): void {
    const errorKey = this.getErrorKey(actionName)
    const errorDataKey = this.getErrorDataKey(actionName)

    this.errors.set(errorKey, error)
    setState(errorKey, error)

    if (error) {
      // 单次构建 errorData：避免双重构建产生两个内容相同但引用不同的对象，
      // 且两处 Date.now() 调用可能产生不一致的时间戳
      const errorData = {
        message: error.message,
        stack: error.stack,
        timestamp: Date.now(),
      }
      this.errorData.set(errorDataKey, errorData)
      setState(errorDataKey, errorData)
    } else {
      this.errorData.delete(errorDataKey)
      setState(errorDataKey, null)
    }
  }

  /**
   * 清除error
   *
   * @private
   * @param {string} actionName - Action名称
   * @param {(key: string, value: unknown) => void} setState - 设置状态的函数
   */
  private clearError(actionName: string, setState: (key: string, value: unknown) => void): void {
    this.setError(actionName, null, setState)
  }

  /**
   * 获取loading key
   *
   * @private
   * @param {string} actionName - Action名称
   * @returns {string} loading状态键（perActionKeys 模式下按 action 派生）
   */
  private getLoadingKey(actionName: string): string {
    return this.options.perActionKeys ? `${this.options.loadingKey}_${actionName}` : this.options.loadingKey
  }

  /**
   * 获取error key
   *
   * @private
   * @param {string} actionName - Action名称
   * @returns {string} error状态键（perActionKeys 模式下按 action 派生）
   */
  private getErrorKey(actionName: string): string {
    return this.options.perActionKeys ? `${this.options.errorKey}_${actionName}` : this.options.errorKey
  }

  /**
   * 获取error data key
   *
   * @private
   * @param {string} actionName - Action名称
   * @returns {string} error数据状态键（perActionKeys 模式下按 action 派生）
   */
  private getErrorDataKey(actionName: string): string {
    return this.options.perActionKeys ? `${this.options.errorDataKey}_${actionName}` : this.options.errorDataKey
  }

  /**
   * 检查是否loading
   *
   * @param {string} actionName - Action名称
   * @returns {boolean} 是否正在加载
   *
   * @example
   * ```typescript
   * if (loader.isLoading('fetchUser')) {
   *   console.log('Fetching user...')
   * }
   * ```
   */
  isLoading(actionName: string): boolean {
    return this.loadingStates.get(this.getLoadingKey(actionName)) ?? false
  }

  /**
   * 获取error
   *
   * @param {string} actionName - Action名称
   * @returns {Error | null} 错误对象，没有错误时返回null
   *
   * @example
   * ```typescript
   * const error = loader.getError('fetchUser')
   * if (error) {
   *   console.error('Failed to fetch user:', error.message)
   * }
   * ```
   */
  getError(actionName: string): Error | null {
    return this.errors.get(this.getErrorKey(actionName)) ?? null
  }

  /**
   * 获取error data
   *
   * @param {string} actionName - Action名称
   * @returns {unknown} 错误数据，包含message、stack、timestamp
   *
   * @example
   * ```typescript
   * const errorData = loader.getErrorData('fetchUser')
   * if (errorData) {
   *   console.log('Error occurred at:', new Date(errorData.timestamp))
   *   console.log('Stack trace:', errorData.stack)
   * }
   * ```
   */
  getErrorData(actionName: string): unknown {
    return this.errorData.get(this.getErrorDataKey(actionName))
  }

  /**
   * 获取所有loading状态
   *
   * @returns {Record<string, boolean>} 所有loading状态的对象
   *
   * @example
   * ```typescript
   * const loadingStates = loader.getAllLoading()
   * console.log('All loading states:', loadingStates)
   * ```
   */
  getAllLoading(): Record<string, boolean> {
    return Object.fromEntries(this.loadingStates.entries())
  }

  /**
   * 获取所有errors
   *
   * @returns {Record<string, Error | null>} 所有错误的对象
   *
   * @example
   * ```typescript
   * const errors = loader.getAllErrors()
   * Object.entries(errors).forEach(([key, error]) => {
   *   if (error) {
   *     console.error(`${key}:`, error.message)
   *   }
   * })
   * ```
   */
  getAllErrors(): Record<string, Error | null> {
    return Object.fromEntries(this.errors.entries())
  }

  /**
   * 清除所有状态
   *
   * 清除所有记录的loading、error和errorData状态
   *
   * @example
   * ```typescript
   * // 重置所有状态
   * loader.clear()
   * ```
   */
  clear(): void {
    this.loadingStates.clear()
    this.loadingRefCounts.clear()
    this.errors.clear()
    this.errorData.clear()
  }

  /**
   * 设置选项
   *
   * 更新配置选项，未提供的选项保持不变
   *
   * @param {Partial<ActionLoaderOptions>} options - 要更新的选项
   *
   * @example
   * ```typescript
   * loader.setOptions({
   *   loadingKey: 'isLoading',
   *   autoLoading: false
   * })
   * ```
   */
  setOptions(options: Partial<ActionLoaderOptions>): void {
    const previousAutoLoading = this.options.autoLoading
    Object.assign(this.options, {
      loadingKey: options.loadingKey ?? this.options.loadingKey,
      errorKey: options.errorKey ?? this.options.errorKey,
      errorDataKey: options.errorDataKey ?? this.options.errorDataKey,
      autoLoading: options.autoLoading ?? this.options.autoLoading,
      perActionKeys: options.perActionKeys ?? this.options.perActionKeys,
    })
    // 中途切换 autoLoading 会使进行中调用的 increment/decrement 不对称，
    // 残留计数会永久占用 loading 状态：切换时重置计数与状态，代价是
    // 切换瞬间进行中的调用不再参与计数（可接受，切换本身即行为变更点）
    if (previousAutoLoading !== this.options.autoLoading) {
      this.loadingRefCounts.clear()
      this.loadingStates.clear()
    }
  }
}

// withLoading 装饰器及其共享登记表已拆至 ./withLoading.js（由 extras/action/index.js 统一导出）
