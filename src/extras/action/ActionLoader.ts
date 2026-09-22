/**
 * GeomStore - Action加载状态管理
 *
 * 提供自动管理Action执行时的loading状态、错误状态和错误数据的功能
 *
 */

import type { ActionLoaderOptions } from '../../types/action.js'
import { toError } from './async-core.js'

/**
 * 归一化后的完整选项形态
 *
 * `sharedLoadingCounts` 是注入项而非用户配置，因此不参与归一化，也不参与
 * `withLoading` 的选项签名（见 `withLoading.ts` 的注册表说明）。
 */
export type NormalizedActionLoaderOptions = Required<Omit<ActionLoaderOptions, 'sharedLoadingCounts'>>

/**
 * `ActionLoaderOptions` 各选项的缺省值 —— **全库唯一来源**
 *
 * `ActionLoader` 构造器与 `withLoading` 的选项签名都必须由它派生（两侧各自持有
 * 字面量时漂移过一次：一处用大写级别、一处用小写）。漂移的后果不是「值不好看」，
 * 而是分桶错配：签名桶决定同一宿主上哪些被装饰方法共用一个 loader / 同一份 loading
 * 引用计数，默认值不一致会让有效配置相同的装饰器被拆开（loading 互相提前翻转）、
 * 或让配置不同的装饰器落进同一个桶（状态键互相覆盖）。
 *
 * 仅供本模块与 `withLoading.ts` 复用，未经 `extras/action` barrel 再导出，不是公开 API。
 */
export const ACTION_LOADER_DEFAULTS: NormalizedActionLoaderOptions = {
  autoLoading: true,
  loadingKey: 'loading',
  errorKey: 'error',
  errorDataKey: 'errorData',
  // 默认 false：保持单键行为向后兼容；多 action 并发场景应启用 perActionKeys
  perActionKeys: false,
}

/**
 * 按 {@link ACTION_LOADER_DEFAULTS} 补齐缺省选项 —— **全库唯一归一化实现**
 *
 * 构造器与 `withLoading` 的签名计算共用本函数：只要两侧都写一遍 `options.x ?? 默认`，
 * 就仍然存在「一侧漏项 / 一侧改用别的默认值」的空间。
 */
export function normalizeActionLoaderOptions(options: ActionLoaderOptions): NormalizedActionLoaderOptions {
  return {
    autoLoading: options.autoLoading ?? ACTION_LOADER_DEFAULTS.autoLoading,
    loadingKey: options.loadingKey ?? ACTION_LOADER_DEFAULTS.loadingKey,
    errorKey: options.errorKey ?? ACTION_LOADER_DEFAULTS.errorKey,
    errorDataKey: options.errorDataKey ?? ACTION_LOADER_DEFAULTS.errorDataKey,
    perActionKeys: options.perActionKeys ?? ACTION_LOADER_DEFAULTS.perActionKeys,
  }
}

/**
 * `errorData` 状态键的内容形态（{@link ActionLoader.getErrorData} 的返回类型）
 *
 * 由 `setError` 单点构造，因此可以给出具体形状：此前 `getErrorData` 返回 `unknown`，
 * 而它自己的文档示例就读 `errorData.timestamp` / `errorData.stack`——那在 `unknown` 上
 * 过不了类型检查，等于强制每个调用方自行 cast（正是 `unknown` 想避免的事）。
 */
export interface ActionErrorData {
  /** 规范化后错误对象的 `message` */
  message: string
  /** 规范化后错误对象的 `stack`：无栈的实现下为 undefined */
  stack?: string
  /** 记录时刻（`Date.now()`） */
  timestamp: number
}

/**
 * 一次 `wrap` 调用的配置快照 + 记账凭证
 *
 * 见 `ActionLoader.wrap` 的用法说明：increment 与配对的 decrement 必须在同一份配置下
 * 决定，且必须能被「这次调用自己」识别（代际变更后作废）。
 */
interface CallScope {
  /** 调用开始时 {@link ActionLoader.stateGeneration} 的值 */
  generation: number
  autoLoading: boolean
  loadingKey: string
  errorKey: string
  errorDataKey: string
}

/**
 * Action加载状态管理器
 *
 * 用于包装异步Action，自动管理其执行状态（loading、error、errorData）
 *
 * @class ActionLoader
 *
 * @example
 * ```typescript
 * // 缺省键名即 loading / error / errorData，只在需要改名时才传
 * const loader = new ActionLoader({
 *   loadingKey: 'isBusy',
 *   perActionKeys: true
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
   * loading 引用计数（按 loading 键）：同一 action 重叠调用时，
   * 首个调用置 true、最后一个完成才置 false，避免共享布尔键的提前翻转。
   * 可注入共享存储（withLoading 场景）：同宿主上不同选项签名的装饰器
   * 对同一 loading 键的计数必须集中，否则仍会互相提前翻转。
   *
   * 该计数同时是 loading 状态的**唯一来源**：此前另有实例私有的布尔镜像，
   * 共享计数时另一实例的 increment 不会写本实例的镜像，本实例 decrement 到
   * 非零也不复位它，于是 `isLoading()` 会永久返回 true。
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
   * @type {Map<string, ActionErrorData>}
   */
  private errorData: Map<string, ActionErrorData> = new Map()

  /**
   * 记账代际：`clearInternalRecords()` 每次自增
   *
   * in-flight 调用在开始时捕获它的值，结算时比对：不一致就说明自己的 increment 记录
   * 已被丢弃（`clear()` 或换配置的 `setOptions()` 都已给旧键补写复位值），此时任何
   * 状态写入都只可能吞掉「重置之后新起的调用」的计数。见 {@link CallScope}
   * @private
   */
  private stateGeneration = 0

  /**
   * 最近一次 `wrap` 注入的 setState
   *
   * `clear()` 与换键的 `setOptions()` 据此给旧键补写复位值：内部记账被清空后已无
   * 在途调用来纠正 store，`loading: true` 会永久卡住。
   * 需要复位的键直接取自下面的几张表（键即状态键），无需另设登记表。
   * @private
   */
  private lastSetState: ((key: string, value: unknown) => void) | undefined

  /**
   * 配置选项（由 {@link normalizeActionLoaderOptions} 补齐，缺省值见 {@link ACTION_LOADER_DEFAULTS}）
   * @private
   * @type {NormalizedActionLoaderOptions}
   */
  private options: NormalizedActionLoaderOptions

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
    // 注入值的类型只有编译期效力：JS 调用方传非 Map（例如把两个 loader 的计数表跨进程序列化往返）
    // 会在第一次 `get`/`set` 才炸，且炸点在异步收尾里、看不出现场。构造期认一次就够——
    // 本字段本来也只在这里读一次（`setOptions()` 忽略它，运行期换表会让两本计数同时存在）。
    const injectedCounts = options.sharedLoadingCounts
    this.loadingRefCounts = injectedCounts instanceof Map ? injectedCounts : new Map()
    this.options = normalizeActionLoaderOptions(options)
  }

  /**
   * 包装Action，自动管理加载状态
   *
   * 执行时会自动设置loading状态，成功后清除loading和error，失败时设置error
   *
   * @template T - Action函数类型（参数类型不限，返回值须为 Promise）
   * @param {T} action - 要包装的异步Action函数
   * @param {string} actionName - Action名称（用于状态键）
   * @param {(key: string, value: unknown) => void} setState - 设置状态的函数
   * @returns {T} 包装后的Action（签名与被包装者一致）
   *
   * @remarks 约束用 `(...args: never[]) => Promise<unknown>` 而非 `unknown[]`：按参数逆变，
   * `unknown[]` 会拒掉类文档示例里 `(userId: string) => Promise<User>` 这类带具体参数类型的
   * action（调用方被迫写 `as any`），`never[]` 则放行且保留 T 的推导。
   *
   * 包装函数把自己的 receiver 原样转发给被包装的 action：本方法常被用来包一个**未绑定**的
   * 方法引用（`loader.wrap(store.fetchUser, 'fetchUser', store.setState.bind(store))`），
   * 那种写法下 `this` 就是宿主，丢掉它会让依赖 receiver 的 action 直接抛错。
   *
   * 派生状态（loading/error/errorData）的写入按「一次调用的配置快照 + 代际凭证」结算：
   * `autoLoading` 与三个状态键都在调用开始时求值一次，结算时只认这份快照，且只在
   * 代际未变时才写——见 {@link CallScope}。中途 `setOptions()`/`clear()` 之后进行的
   * 收尾写入既可能对错键、也会吞掉别人调用的计数，故一并跳过。
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
  wrap<T extends (...args: never[]) => Promise<unknown>>(action: T, actionName: string, setState: (key: string, value: unknown) => void): T {
    // 记住最近一次注入的 setState：clear() 与换键的 setOptions() 要靠它给旧键补写复位值
    this.lastSetState = setState
    // 包装函数是 function 表达式（要拿到调用方 receiver），故 loader 实例另存一份
    const loader = this

    const wrapped = async function (this: unknown, ...args: Parameters<T>): Promise<unknown> {
      const receiver = this
      // 本次调用的配置快照 + 代际凭证：increment 与配对的 decrement/settle 都按它决定，
      // 中途的 setOptions()/clear() 不会让两端跑到不同配置或不同记账上去
      const scope = loader.captureCallScope(actionName)

      // 设置 loading 状态（引用计数）。increment 在 try 之外且内部先计数再 setState：
      // setState 同步抛错（如 store 已销毁）时计数残留 +1，loading 永远无法回 false，
      // 失败时回滚计数
      if (scope.autoLoading) {
        try {
          loader.incrementLoading(scope.loadingKey, setState)
        } catch (error) {
          loader.releaseLoadingSlot(scope.loadingKey)
          throw error
        }
      }

      try {
        const result = await action.apply(receiver, args)
        // 清除 loading（引用计数归零才置 false）与陈旧错误
        loader.settleCall(scope, setState, null)

        return result
      } catch (error) {
        // 清除 loading，设置 error
        loader.settleCall(scope, setState, toError(error))

        throw error
      }
    }

    // 参数逆变让「具体参数类型的 action」无法直接赋给 unknown[] 形参，故按 Parameters<T>
    // 声明包装函数、返回 Promise<unknown>，最后经 unknown 转成 T：包装前后运行时是同一个
    // 函数对象，类型层面只是把返回值的 resolve 值收敛为 unknown
    return wrapped as unknown as T
  }

  /**
   * 取本次调用的配置快照与记账凭证
   *
   * @private
   */
  private captureCallScope(actionName: string): CallScope {
    return {
      generation: this.stateGeneration,
      autoLoading: this.options.autoLoading,
      loadingKey: this.getLoadingKey(actionName),
      errorKey: this.getErrorKey(actionName),
      errorDataKey: this.getErrorDataKey(actionName),
    }
  }

  /**
   * 一次调用的收尾：把派生状态写回宿主
   *
   * `error === null` 是成功路径（清错误），否则记录错误。错误状态管理独立于
   * `autoLoading` 开关：即使关闭也应清掉/写上陈旧错误。
   *
   * 代际变了就直接返回：本调用的 increment 记录已被 `clear()`/换配置的 `setOptions()`
   * 丢弃，而那两处都已给旧键补写复位值——再减一次只会把「重置之后新起的调用」的计数
   * 吞掉、并在它仍在飞行时把共享键翻成 false。
   *
   * @private
   */
  private settleCall(scope: CallScope, setState: (key: string, value: unknown) => void, error: Error | null): void {
    if (scope.generation !== this.stateGeneration) {
      return
    }
    if (scope.autoLoading) {
      this.safeRunStateEffect(() => this.decrementLoading(scope.loadingKey, setState))
    }
    this.safeRunStateEffect(() => this.writeError(scope, error, setState))
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
  private incrementLoading(key: string, setState: (key: string, value: unknown) => void): void {
    const count = (this.loadingRefCounts.get(key) ?? 0) + 1
    this.loadingRefCounts.set(key, count)
    if (count === 1) {
      setState(key, true)
    }
  }

  /**
   * 递减 loading 引用计数；最后一个完成的调用才将 loading 置为 false
   *
   * @private
   */
  private decrementLoading(key: string, setState: (key: string, value: unknown) => void): void {
    const current = this.loadingRefCounts.get(key)
    // 计数缺失 = 本次调用的 increment 记录已经不在（外部把注入的共享 Map 清了）。
    // 此前这里是 `?? 1` 兜底：键缺失时 `?? 1` 与 `?? 0` 同样落到 count === 0，
    // 它只掩盖了「这次调用没加过数」的事实，还会往一个本调用从没写过的键上补写 false
    if (current === undefined) {
      return
    }
    const count = Math.max(0, current - 1)
    this.loadingRefCounts.set(key, count)
    if (count === 0) {
      setState(key, false)
    }
  }

  /**
   * 回滚一次 increment（`setState` 抛错时），只退计数不写状态
   *
   * @private
   */
  private releaseLoadingSlot(key: string): void {
    const current = this.loadingRefCounts.get(key)
    if (current === undefined) {
      return
    }
    const count = current - 1
    if (count <= 0) {
      this.loadingRefCounts.delete(key)
    } else {
      this.loadingRefCounts.set(key, count)
    }
  }

  /**
   * 写 error / errorData
   *
   * 键取自调用开始时的快照（{@link CallScope}），不在这里重算：中途 `setOptions()`
   * 换过键名的话，重算会让「按旧键写的账」跑到新键上去补一笔，而新键属于切换之后的调用。
   *
   * @private
   */
  private writeError(scope: CallScope, error: Error | null, setState: (key: string, value: unknown) => void): void {
    this.errors.set(scope.errorKey, error)
    setState(scope.errorKey, error)

    if (error) {
      // 单次构建 errorData：避免双重构建产生两个内容相同但引用不同的对象，
      // 且两处 Date.now() 调用可能产生不一致的时间戳
      const errorData: ActionErrorData = {
        message: error.message,
        stack: error.stack,
        timestamp: Date.now(),
      }
      this.errorData.set(scope.errorDataKey, errorData)
      setState(scope.errorDataKey, errorData)
    } else {
      this.errorData.delete(scope.errorDataKey)
      setState(scope.errorDataKey, null)
    }
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
    // 直接以（可能是宿主共享的）引用计数为准：本实例只记自己的 increment 的话，
    // 同键的另一实例先加计数、本实例后减到非零时 isLoading() 会永久为 true
    return (this.loadingRefCounts.get(this.getLoadingKey(actionName)) ?? 0) > 0
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
   * @returns {ActionErrorData | undefined} 错误数据（message/stack/timestamp），无错误时 undefined
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
  getErrorData(actionName: string): ActionErrorData | undefined {
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
    const states: Record<string, boolean> = {}
    for (const [key, count] of this.loadingRefCounts) {
      states[key] = count > 0
    }

    return states
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
   * 既丢内部记账，也把宿主 store 里的派生状态复位（loading→false、error/errorData→null）：
   * 只清内部的话，store 会永久停在最后一次写入的值上（典型表现 `loading: true` 卡死），
   * 此后已没有在途调用来纠正它。
   *
   * 注意：注入的共享 loading 计数会被一并清零，同宿主上其他 loader 实例的进行中调用
   * 因此失去计数（与 `setOptions` 换选项时的处理口径一致）。
   *
   * @param {(key: string, value: unknown) => void} [setState] - 复位写入用的 setState，
   *   缺省复用最近一次 `wrap` 注入的那个
   *
   * @example
   * ```typescript
   * // 重置所有状态（含 store 侧）
   * loader.clear()
   * ```
   */
  clear(setState?: (key: string, value: unknown) => void): void {
    this.resetDerivedState(setState)
    this.clearInternalRecords()
    // 记账已空，无需再保留宿主侧的写入函数（它通常 bind 了 store，会拖住宿主不被回收）
    this.lastSetState = undefined
  }

  /**
   * 给本实例写过的状态键补写复位值
   *
   * @private
   */
  private resetDerivedState(setState?: (key: string, value: unknown) => void): void {
    const write = setState ?? this.lastSetState
    if (!write) {
      // 从未 wrap 过：没有 setState 可用，也就没写过宿主状态
      return
    }
    for (const [key, count] of this.loadingRefCounts) {
      if (count > 0) {
        this.safeRunStateEffect(() => write(key, false))
      }
    }
    for (const [key, error] of this.errors) {
      if (error !== null) {
        this.safeRunStateEffect(() => write(key, null))
      }
    }
    for (const key of this.errorData.keys()) {
      this.safeRunStateEffect(() => write(key, null))
    }
  }

  /**
   * 丢弃内部记账（store 侧的复位由 `resetDerivedState` 负责）
   *
   * 代际同时自增：进行中的调用据此认出自己的 increment 记录已不在，结算时不再改任何
   * 状态键（见 {@link CallScope}）。
   *
   * @private
   */
  private clearInternalRecords(): void {
    this.stateGeneration += 1
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
    const previousKeys = [this.options.loadingKey, this.options.errorKey, this.options.errorDataKey, this.options.perActionKeys].join('|')
    Object.assign(this.options, {
      loadingKey: options.loadingKey ?? this.options.loadingKey,
      errorKey: options.errorKey ?? this.options.errorKey,
      errorDataKey: options.errorDataKey ?? this.options.errorDataKey,
      autoLoading: options.autoLoading ?? this.options.autoLoading,
      perActionKeys: options.perActionKeys ?? this.options.perActionKeys,
    })
    const keysChanged = [this.options.loadingKey, this.options.errorKey, this.options.errorDataKey, this.options.perActionKeys].join('|') !== previousKeys

    // 中途切换 autoLoading、或改任何一个状态键名，都会让进行中的调用「按旧键 increment、
    // 按新键 decrement」：旧键的计数/错误条目既等不到归零写入，新键又走 `?? 1` 兜底，
    // 结果旧键在 store 里永久停在 true。故两种情况都先给旧键补写复位值，再丢弃旧记账。
    // 代价：切换瞬间进行中的调用不再参与计数（切换本身即行为变更点）
    if (keysChanged || previousAutoLoading !== this.options.autoLoading) {
      this.resetDerivedState()
      this.clearInternalRecords()
    }
  }
}

// withLoading 装饰器及其共享登记表已拆至 ./withLoading.js（由 extras/action/index.js 统一导出）
