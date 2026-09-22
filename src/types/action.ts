/**
 * GeomStore - Action类型定义
 */

import type { Actions, State } from './store.js'

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
  /**
   * 共享的 loading 引用计数存储
   *
   * @internal 供 withLoading 装饰器按宿主 + loading 键注入：
   * 同一宿主上不同选项签名（如不同 errorKey）的装饰器实例各自持有计数时，
   * 对同一 loading 键的并发计数互不可见，先完成的调用会提前翻转共享布尔键。
   * 直接构造 ActionLoader 的调用方无需提供。
   *
   * 注意：本字段只在 `ActionLoader` 构造函数被读取一次（`options.sharedLoadingCounts ?? new Map()`），
   * `setOptions()` 会忽略它——运行期换 Map 会让新旧两本计数同时存在。
   * 调用方自造/复用同一 Map 给多个 loader 时，「首个调用置 true、末个完成置 false」的
   * 不变量由注入方负责，除非确有必要否则不要传本字段。
   */
  sharedLoadingCounts?: Map<string, number>
}

/**
 * Action执行上下文
 *
 * 默认值约束到项目类型（而非 `unknown`）：`A = unknown` 会让 `ctx.actions.someAction()`
 * 退化为不可调用的 `unknown`、强制调用方断言，与本模块其余公开泛型的口径
 * （`ActionExecutor<A extends Actions = AsyncActions>`、`ActionUtils<A extends Actions = AsyncActions>`、
 * `Store<S, A extends Actions>`）不一致。
 *
 * 与上述类型相同的已知代价：`Actions` 带 `Record` 索引签名，以 `interface` 声明的 action 集合
 * 没有隐式索引签名、不满足约束，显式传类型实参时用 type alias（或对象字面量推断结果）。
 */
export interface ActionExecutionContext<S extends State = State, A extends Actions = Actions> {
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
 *
 * 以 `success` 判别的联合类型：`success: true` 只带 `data`、`success: false` 只带 `error`，
 * 非法组合（成功却带 error / 失败却带 data）不可表示。
 *
 * 两个分支都显式声明对方的键为可选 `undefined`（而非直接缺省），这样未收窄时
 * `result.data` / `result.error` 仍是 `T | undefined` / `Error | undefined` 可直接读取——
 * 历史消费方（含 `getHistory()` 的结果遍历）大多不做判别收窄。
 *
 * `duration` 与 `endTime - startTime` 由构造方同时给出（本类型无法强制二者一致），
 * 库内 `AsyncActionSupport` 的两条路径均以 `duration: endTime - startTime` 写入。
 *
 * 对按 `success` 收窄的调用方而言这是一次向更精确方向的收敛；对外部手工构造结果的
 * 调用方则是轻微破坏性变更（少给一个对方的键反而报错），故按 minor 版本对待。
 */
export type ActionResult<T = unknown> =
  | {
      /** 是否成功 */
      success: true
      /** 返回值 */
      data: T
      /** 失败时才有值：成功分支上恒为 undefined */
      error?: undefined
      /** 开始时间 */
      startTime: number
      /** 结束时间 */
      endTime: number
      /** 执行时长（= endTime - startTime） */
      duration: number
    }
  | {
      /** 是否成功 */
      success: false
      /** 成功时才有值：失败分支上恒为 undefined */
      data?: undefined
      /** 错误信息（已由 `toError` 归一化为 Error） */
      error: Error
      /** 开始时间 */
      startTime: number
      /** 结束时间 */
      endTime: number
      /** 执行时长（= endTime - startTime） */
      duration: number
    }

/**
 * Action装饰器类型
 *
 * 直接等同 lib 的 `MethodDecorator`：本项目所有公开装饰器的返回类型都是它
 * （`withLoading` / `withRetry` / `withCache` / `withDebounce` / `withThrottle` /
 * `withTimeout` / `withLog` / `createDecorator` 显式标注 `: MethodDecorator`，
 * `withErrorBoundary` 的 JSDoc 同口径）。此前自定义的 `(target: unknown, …)` 签名因参数逆变
 * 而**拒绝**这些装饰器的返回值（`const d: ActionDecorator = withRetry()` 编译不过），
 * 对外等于一个不可用的重复类型。
 */
export type ActionDecorator = MethodDecorator
