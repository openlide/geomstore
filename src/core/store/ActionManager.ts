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

import { type State, type Actions, type InferActionArgs, type InferActionReturn, type ActionContextBase } from '../../types/store.js'
import { createError, ErrorCode } from '../errors/GeomStoreError.js'
import type { IHookSystem } from '../../types/plugin.js'

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
  /**
   * 绑定后的 action 表，空原型（`Object.create(null)`）。
   *
   * action 名是业务任意取的字符串，`'__proto__'` 在普通对象字面量上赋值会命中
   * Object.prototype 的 setter：属性写不进去（`dispatch('__proto__')` 从此抛
   * ACTION_NOT_FOUND），原型却被换掉，之后所有 hasOwnProperty 判定的语义一起漂移。
   * 空原型让任意键名都只落自有属性，`constructor`/`toString` 也不再命中原型成员
   */
  private _boundActions: Record<string, (...args: unknown[]) => unknown> = Object.create(null) as Record<string, (...args: unknown[]) => unknown>
  /** dispatch 嵌套深度计数：嵌套 dispatch 内层结束不得提前复位 dispatching 状态 */
  private _dispatchDepth = 0

  /** 当前 dispatch 嵌套深度（Store 批收尾守卫使用：action 体内 batch 不提前通知） */
  get dispatchDepth(): number {
    return this._dispatchDepth
  }
  /**
   * 「仅在状态实际变化时通知」的判据源，两个模式共用一个字段。
   *
   * `undefined` = 未启用该模式（每次都通知）；存在 = 启用，且只有计数高于基线才通知。
   * 拆成 `notifyOnlyOnChange` + `getMutationCount` 两个字段的话，「开关为真但计数源缺失」
   * 是个编译期允许、运行期静默丢通知的非法组合，只能靠构造期守卫拦；合并后该组合
   * 根本不存在，开关与计数源在类型上就是同一件事（`ActionManagerOptions.notifyOnlyOnChange`
   * 仍要求成对提供 `getMutationCount`，见下方守卫）。
   */
  private readonly _mutationGate?: () => number
  private readonly _refreshCache?: () => void
  private readonly _getLastNotifiedMutationCount?: () => number
  private readonly _isInBatch?: () => boolean

  constructor(options: ActionManagerOptions) {
    this._storeName = options.storeName
    this._withInternalAccess = options.withInternalAccess
    this._setDispatching = options.setDispatching
    this._notifyListeners = options.notifyListeners
    this._hooks = options.hooks
    // 早失败而非给一个恒为 0 的兜底计数源：本类经 core/store 的 barrel 对外导出，
    // 非 Store 消费方也能构造它。计数恒 0 时 `_shouldNotifyNow` 的 `0 > baseline`
    // 永远判假，每一次 dispatch 的通知都被静默丢弃——症状（页面不更新）离误用点
    // 隔了整个 action，比在这里抛错难查得多
    if (options.notifyOnlyOnChange && options.getMutationCount === undefined) {
      throw new TypeError('[GeomStore] ActionManager: `getMutationCount` is required when `notifyOnlyOnChange` is enabled')
    }
    this._mutationGate = options.notifyOnlyOnChange ? options.getMutationCount : undefined
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
    // 空原型容器：见 _boundActions 的说明（'__proto__' 等键名会命中原型 setter）
    const boundActions: Record<string, (...args: unknown[]) => unknown> = Object.create(null) as Record<string, (...args: unknown[]) => unknown>

    // 创建 action 上下文代理，使 this.actionName() 可用
    const actionContext = new Proxy(contextBase as unknown as Record<string, unknown>, {
      get(target: Record<string, unknown>, prop: string | symbol) {
        // 优先返回绑定的 action（own property 判定：`in` 会命中原型链，
        // 使 this.toString()/this.hasOwnProperty() 等返回 undefined）
        if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(boundActions, prop)) {
          return boundActions[prop]
        }
        // symbol 一律透传给 target：boundActions 只按字符串键登记，上面的
        // hasOwnProperty 已排除全部 symbol，此前在这里短路 return undefined
        // 会把 context 自身的 symbol 成员一并抹掉，Symbol.toStringTag /
        // Symbol.iterator / Symbol.for('nodejs.util.inspect.custom') 等协议
        // 在 action 体内全部失效（console.log 与迭代都拿不到实现）
        return (target as Record<string | symbol, unknown>)[prop]
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

    // onlyOnChange 模式：基线必须在进入 dispatch 之前采集。dispatch 期间通知被抑制，
    // beforeDispatch 钩子里的写入同样属于本次 dispatch 事务；基线晚采会把钩子写入
    // 当成「无变化」，收尾时跳过通知，该变更对所有监听器永久不可见
    const mutationsBefore = this._mutationGate ? this._mutationGate() : 0
    // 先设置 dispatching 状态，再触发钩子，确保监听器能获取正确的状态
    this._enterDispatch()
    let result: unknown
    try {
      // beforeDispatch 与 action 调用同属「dispatch 事务」：hooks 是注入的 IHookSystem，
      // 接口不保证 emit 内部吞掉处理器异常。emit 放在 try 之外时，钩子抛错会让
      // _dispatchDepth 永不递减、dispatching 永为 true，此后该 Store 的所有通知都被守卫吞掉
      this._hooks.emit('beforeDispatch', name, args)
      // boundActions 在 initialize 时已经包装了 _withInternalAccess，此处无需再次包装
      result = this._boundActions[name](...args)
    } catch (error) {
      this._exitDispatch()
      // 走带兜底的上报通道：onError 处理器自身抛错时，裸 emit 会用「上报的异常」顶掉
      // 正要抛出的 ACTION_EXECUTION_ERROR，并跳过下面的收尾（补刷缓存 + 补发通知）。
      // 这条是全库唯一显式点名来源的 onError 发射：异常即将包装上抛、afterDispatch 不会
      // 再发射，只有 `dispatch` 这个键能让性能插件作废本次进行中计时（见 _reportSettledFailure）
      this._reportSettledFailure(error, 'dispatch')
      // 失败路径同样处理已发生的变更：action 抛错前的 setState/直接变异
      // 因 _dispatching 被抑制了通知，此处补刷缓存并在最外层补发，
      // 否则「先置 loading 再失败」的中间状态对监听器永久不可见。
      // 收尾异常同样归口上报，不得顶掉 action 的原始错误
      this._settleAfterDispatch(mutationsBefore)
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

    // action 已成功返回：dispatch 计数就此复位一次。其后的收尾步骤（afterDispatch 钩子、
    // 通知）若抛错，不得再走一遍 _exitDispatch——嵌套 dispatch 会多减一层深度，
    // 外层 action 仍在执行却提前复位 dispatching，其后续 setState 会以中间态通知监听器；
    // 那类失败也不该被重新包装成 ACTION_EXECUTION_ERROR（action 本身已经执行完成）
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
      this._settleAfterDispatch(this._getLastNotifiedMutationCount?.() ?? -1)
    }
    // 鸭子类型判定 thenable：instanceof Promise 跨 realm（iframe / node:vm）或另一份
    // bundle 里的 Promise 子类都会判假，被当作同步结果处理时，await 之后的状态变更
    // 永远等不到补发通知
    if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
      // 异步失败同样触发 onError 钩子：reject 是 action 最常见的失败形态
      // （网络请求等），监控/上报插件对其不可失明——与同步 catch 路径对称。
      // 拒绝值保持原始错误不包装，不改变调用方捕获到的异常类型。
      // 拒绝分支两步都不抛错（_reportSettledFailure 自带 console 兜底、onSettled 把收尾
      // 异常归口上报），所以顺序执行即可保证：onError 处理器抛错时通知照常补发，
      // 且一次失败只报一次（此前裸 emit 抛错会跳过补发、并由终端 catch 二次上报同一错误）。
      // 终端 catch 仍是最后一道闸门：宿主是自定义 thenable 时 .then(...) 的返回值由
      // thenable 自己给出，可能是个已 rejected 的 promise，不接就是 unhandledRejection
      // （Node 下可直接终止进程）。只给派生 promise 补接（而非把整条链改写成
      // Promise.resolve(result).then(...)）：补发回调仍直接挂在调用方 promise 上，
      // 微任务时序与原实现一致，被 Promise.resolve 延后一拍的只有错误分支。
      // 返回给调用方的仍是原始 result，异常语义不变
      const settled = (result as PromiseLike<unknown>).then(onSettled, (error) => {
        this._reportSettledFailure(error)
        onSettled()
      })
      Promise.resolve(settled).catch((error) => {
        this._reportSettledFailure(error)
      })
      return result
    }
    // 同步 action：仅最外层 dispatch 且不在 batch 中时通知——
    // 内层 dispatch 结束时深度仍大于 0，提前通知会让监听器收到
    // 外层 action 尚未完成的中间状态；batch 中则由收尾统一通知
    if (this._shouldNotifyNow(mutationsBefore)) {
      this._notifyListeners()
    }
    return result
  }

  /**
   * 本次 dispatch 收尾是否应补发通知（各收尾点共用同一判据）
   *
   * 判定同时依赖「是否最外层 dispatch / 是否在 batch 中」与 onlyOnChange 的变更计数，
   * 各处各写一遍字面量会在去重/重入规则调整时静默漂移，故收敛到此。
   *
   * @param baseline - 变更计数基线：同步与失败路径传 dispatch 进入前的计数，
   *   异步完成路径传「最近一次通知已覆盖的计数」
   *
   * @private
   */
  private _shouldNotifyNow(baseline: number): boolean {
    return this._dispatchDepth === 0 && !this._isInBatch?.() && (!this._mutationGate || this._mutationGate() > baseline)
  }

  /**
   * dispatch 收尾：按状态源回刷缓存，再按需补发一次通知
   *
   * 收尾自身抛错（通知链路、注入的计数提供者可由非 Store 消费方实现）就地归口，
   * 不外溢：两个调用点都在「另有错误要抛/要报」的线路上，让它逃出去会顶掉上游的
   * action 错误，并让补发通知整段被跳过。
   *
   * @param baseline - 见 {@link _shouldNotifyNow}
   *
   * @private
   */
  private _settleAfterDispatch(baseline: number): void {
    try {
      this._safeRefreshCache()
      if (this._shouldNotifyNow(baseline)) {
        this._notifyListeners()
      }
    } catch (error) {
      this._reportSettledFailure(error)
    }
  }

  /**
   * 收尾链路自身抛错的兜底上报：先走 onError 钩子，钩子也失败时退回 console.error
   *
   * 这是 dispatch 链上最后一个 catch，再无上游可接，故此处不允许抛错。
   *
   * @param source - 透传给 `onError` 的失败来源，只用于「本操作已中止」的信号
   *   （`HookArgsMap['onError']` 的第二参）。五个调用点里只有同步 dispatch 的 catch
   *   传 `'dispatch'`：那是唯一 `afterDispatch` 永不再来的路径，性能插件要靠这个键
   *   作废已入栈的进行中计时。其余四处（Promise 拒绝分支、派生 promise 的兜底 catch、
   *   {@link _settleAfterDispatch}、{@link _safeRefreshCache}）都发生在
   *   `afterDispatch` 已发射之后，或本身是中止路径上的**第二笔**失败——给它们同样的键
   *   会让插件多弹一层，把嵌套 dispatch 外层的配对项误当作已中止。
   *
   * @private
   */
  private _reportSettledFailure(error: unknown, source?: string): void {
    try {
      // 分两条发射而不是统一传 `source`：`emit` 直接把实参展开给处理器，
      // 统一传会让原本「只带错误」的四条路径多出第二个 `undefined` 实参，
      // 处理器侧 `arguments.length`/`toHaveBeenCalledWith(error)` 一类判定无谓改变
      if (source === undefined) {
        this._hooks.emit('onError', error)
      } else {
        this._hooks.emit('onError', error, source)
      }
    } catch {
      console.error('[GeomStore] Error while reporting action settle failure:', error)
    }
  }

  /**
   * 安全刷新缓存：缓存刷新失败不应影响 dispatch 主流程
   *
   * 失败只上报、不外溢（本方法不得抛错，否则「不影响主流程」只成立到 onError
   * 处理器不抛错为止），故走带 console 兜底的 {@link _reportSettledFailure}。
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
      this._reportSettledFailure(error)
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
   *
   * 初始化前返回空对象（与 ActionManager.actions 同口径）：直接把 null 断言成 G
   * 会让 store.getters.foo 在离成因很远的地方抛「Cannot read properties of null」
   */
  get getters(): G {
    return (this._getters ?? ({} as G)) as G
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
