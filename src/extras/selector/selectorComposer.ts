/**
 * GeomStore - 选择器组合
 *
 * 提供选择器组合、管道操作和高级选择器创建功能
 *
 */

import type { Selector, SelectorComposerInput } from '../../types/selector.js'
import type { State } from '../../types/store.js'

import { createRetrySelector, createRetrySelectorAsync, type AsyncRetrySelectorOptions, type RetrySelectorOptions } from './retrySelector.js'

// 重试选择器与其选项类型已拆至 ./retrySelector.js；此处再导出以保持既有导入路径不变
export type { AsyncRetrySelectorOptions, RetrySelectorOptions } from './retrySelector.js'

/**
 * 选择器组合器类
 *
 * 提供静态方法用于组合、管道和创建高级选择器
 *
 * @class SelectorComposer
 *
 * @example
 * ```typescript
 * // 组合多个选择器
 * const selector = SelectorComposer.combine({
 *   selectors: [
 *     (s) => s.value,
 *     (s) => s.multiplier
 *   ],
 *   combiner: (value, multiplier) => value * multiplier
 * })
 *
 * const result = selector(state) // value * multiplier
 * ```
 */
export class SelectorComposer {
  /**
   * 组合多个选择器
   *
   * 将多个选择器的结果组合成单个值
   *
   * @template S - 状态类型
   * @template R - 返回值类型（未显式给出时由 `combiner` 的返回类型反推）
   * @template T - selectors 的元组类型（未显式给出时取 `Selector<S, unknown>[]`）
   * @param {SelectorComposerInput<S, T, R>} input - 选择器和组合器配置。R 一路透传到
   *   `combiner` 的返回位：组合器返回了与 `R` 不符的东西（拼错的属性名、多包一层）在编译期
   *   就报错，而不是被实现里的一句断言静默成 `R`
   * @returns {Selector<S, R>} 组合后的选择器
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.combine({
   *   selectors: [
   *     (s) => s.base,
   *     (s) => s.taxRate,
   *     (s) => s.shipping
   *   ],
   *   combiner: (base, tax, shipping) => base * (1 + tax) + shipping
   * })
   *
   * const total = selector({ base: 100, taxRate: 0.1, shipping: 10 })
   * // 100 * 1.1 + 10 = 120
   * ```
   */
  static combine<S extends State, R = unknown, T extends readonly Selector<S, unknown>[] = readonly Selector<S, unknown>[]>(
    input: SelectorComposerInput<S, T, R>,
  ): Selector<S, R> {
    const { selectors, combiner } = input

    return (state: S): R => {
      // 执行所有选择器：结果按 unknown[] 交给组合器即可——每个元素的类型由调用方在站点上
      // 写死的 combiner 形参保证（其形参刻意是 `any[]`，见 SelectorComposerInput 的注释），
      // 这里再断言成 T 只会把「selectors 与 combiner 对不上」这类真实错误静默掉
      const results: unknown[] = selectors.map((selector) => selector(state))

      // 组合结果
      return combiner(...results)
    }
  }

  /**
   * pipe / createDerived 共用的管道实现
   *
   * 两个公开入口只有重载签名不同、运行期行为逐字相同，故各自委托到这里：
   * 此前 createDerived 写作 `pipe(...(selectors as [never]))`，那个断言把重载契约整个丢掉
   * （`[never]` 可赋给任意 rest 形参，连第一个参数不是「接受 state 的选择器」都查不出来，
   * 错误只在运行期暴露）。改为共用实现后两侧都只面对自己的 rest 类型，无需断言。
   *
   * @private
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static runPipe(selectors: Array<(state: any) => any>): (state: any) => any {
    // 空数组合法：reduce 带初值 state，直接返回该 state（与两个入口的重载 T1 单参形态一致）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (state: any) => selectors.reduce((acc, selector) => selector(acc), state)
  }

  /**
   * 管道操作
   *
   * 将一个选择器的结果作为下一个选择器的输入
   *
   * @template S - 状态类型
   * @template T1 - 第一个选择器的返回类型
   * @template T2 - 第二个选择器的返回类型
   * @template T3 - 第三个选择器的返回类型（可选）
   * @template T4 - 第四个选择器的返回类型（可选）
   * @param {Selector<S, T1>} selector1 - 第一个选择器
   * @param {(input: T1) => T2} selector2 - 第二个选择器
   * @param {(input: T2) => T3} selector3 - 第三个选择器（可选）
   * @param {(input: T3) => T4} selector4 - 第四个选择器（可选）
   * @returns {Selector<S, T4>} 管道选择器。返回类型即**最后一棒**的输出，随传入的个数取
   *   T2 / T3 / T4（只传一个时是 T1）——重载签名不会给出 `T4 | T3 | T2 | T1` 这种联合类型，
   *   调用侧按具体重载直接拿到窄类型
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.pipe(
   *   (s) => s.user,
   *   (user) => user.profile,
   *   (profile) => profile.avatar
   * )
   *
   * const avatar = selector(state)
   * // 相当于: state.user.profile.avatar
   * ```
   */
  static pipe<S extends State, T1, T2, T3, T4>(
    selector1: Selector<S, T1>,
    selector2: (input: T1) => T2,
    selector3: (input: T2) => T3,
    selector4: (input: T3) => T4,
  ): Selector<S, T4>
  static pipe<S extends State, T1, T2, T3>(selector1: Selector<S, T1>, selector2: (input: T1) => T2, selector3: (input: T2) => T3): Selector<S, T3>
  static pipe<S extends State, T1, T2>(selector1: Selector<S, T1>, selector2: (input: T1) => T2): Selector<S, T2>
  static pipe<S extends State, T1>(selector1: Selector<S, T1>): Selector<S, T1>
  // 重载实现签名：对外类型安全由各重载保证，此处放宽为通用函数类型
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static pipe(...selectors: Array<(state: any) => any>): (state: any) => any {
    return SelectorComposer.runPipe(selectors)
  }

  /**
   * 创建派生选择器
   *
   * 通过管道操作创建派生选择器，pipe的别名
   *
   * @template S - 状态类型
   * @template R1 - 第一个返回类型
   * @template R2 - 第二个返回类型
   * @template R3 - 第三个返回类型（可选）
   * @param {Selector<S, R1>} selector1 - 第一个选择器
   * @param {(input: R1) => R2} selector2 - 第二个选择器
   * @param {(input: R2) => R3} selector3 - 第三个选择器（可选）
   * @returns {Selector<S, R3>} 派生选择器。与 pipe 同：返回类型即最后一棒的输出
   *   （两棒时是 R2），不是 `R3 | R2 | R1` 联合
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.createDerived(
   *   (s) => s.items,
   *   (items) => items.filter(i => i.active),
   *   (activeItems) => activeItems.length
   * )
   *
   * const count = selector(state)
   * // 计算活跃项目数量
   * ```
   */
  static createDerived<S extends State, R1, R2, R3>(selector1: Selector<S, R1>, selector2: (input: R1) => R2, selector3: (input: R2) => R3): Selector<S, R3>
  static createDerived<S extends State, R1, R2>(selector1: Selector<S, R1>, selector2: (input: R1) => R2): Selector<S, R2>
  // 重载实现签名：对外类型安全由各重载保证，此处放宽为通用函数类型
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static createDerived(...selectors: Array<(state: any) => any>): (state: any) => any {
    // 与 pipe 共用 runPipe：不再借 `pipe(...(selectors as [never]))` 转调
    // （那个断言会让任意调用形状通过类型检查，见 runPipe 的说明）
    return SelectorComposer.runPipe(selectors)
  }

  /**
   * 创建数组选择器
   *
   * 对数组的每个元素应用选择器
   *
   * @template T - 数组元素类型
   * @template R - 返回元素类型
   * @param {(item: T) => R} itemSelector - 元素选择器
   * @returns {(array: T[]) => R[]} 数组选择器（输入为数组，不满足 Selector 的对象约束，故用函数类型）
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.createArraySelector(
   *   (item: number) => item * 2
   * )
   *
   * const doubled = selector([1, 2, 3])
   * console.log(doubled) // [2, 4, 6]
   * ```
   */
  static createArraySelector<T, R>(itemSelector: (item: T) => R): (array: T[]) => R[] {
    return (array: T[]): R[] => {
      return array.map((item) => itemSelector(item))
    }
  }

  /**
   * 创建对象选择器
   *
   * 对状态的**每个自有可枚举字符串键**应用选择器，返回同键名的对象。
   *
   * ⚠️ `K` 必须是 `keyof S` 中除 Symbol 外的全部键（即 `K = Extract<keyof S, string>`），
   * 不能只填其中一部分：实现的键集来自运行期的 `Object.keys(state)`，与类型参数无关。
   * 把 `K` 声明成子集（如 `createObjectSelector<S, 'a', R>((key: 'a') => ...)`）会让
   * `keySelector` 收到它声明域之外的键、返回对象多出 `Record<K, R>` 之外的键——类型不会报错，
   * 只表现为结果比预期多键。之所以不把签名改成 `(key: keyof S) => Selector<S, R>`
   * （`keyof S` / `keyof S & string` / `Extract<keyof S, string>` 三种写法均已实测）：
   * 键参数的类型一旦依赖 `S`，`(key) => (s: MyState) => s[key]` 这一最常见写法就会因
   * 循环推断把 `S` 退回约束 `object`、`key` 退化成 `never` 而直接编译失败，
   * 为了一个不产生错误数据的宽松性牺牲全部调用点的类型推断不值得。
   * 确实只想派生固定子集时请改用 {@link SelectorComposer#combine}（键集由 selectors 显式列出）
   *
   * @template S - 状态类型
   * @template K - 键类型，须为 `keyof S` 的非 Symbol 全部键（见上）
   * @template R - 值类型
   * @param {(key: K) => Selector<S, R>} keySelector - 键选择器工厂
   * @returns {Selector<S, Record<K, R>>} 对象选择器
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.createObjectSelector(
   *   (key) => (s) => s[key].toUpperCase()
   * )
   *
   * const result = selector({ name: 'alice', city: 'beijing' })
   * console.log(result) // { name: 'ALICE', city: 'BEIJING' }
   * ```
   */
  static createObjectSelector<S extends State, K extends keyof S, R>(keySelector: (key: K) => Selector<S, R>): Selector<S, Record<K, R>> {
    return (state: S): Record<K, R> => {
      const result = {} as Record<K, R>

      for (const key of Object.keys(state) as K[]) {
        const value = keySelector(key)(state)

        if (key === '__proto__') {
          // 只有 __proto__ 需要 DefineOwnProperty 语义：state 可合法含自有 __proto__ 键
          // （helpers.ts 的 deepMerge/set 有意如此写入），result[key] = … 走 [[Set]]
          // 会触发 Object.prototype 的 __proto__ setter——该键的派生结果被静默丢弃
          // 且 result 原型被换掉
          Object.defineProperty(result, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
          })
        } else {
          // 其余键走普通赋值：本循环对状态的**每个**自有键跑一次，完整描述符要付
          // DefineOwnProperty 的慢路径开销，而 [[Set]] 在这些键上语义完全等价
          result[key] = value
        }
      }

      return result
    }
  }

  /**
   * 创建条件选择器
   *
   * 根据条件选择执行哪个选择器
   *
   * @template S - 状态类型
   * @template R - 返回值类型
   * @param {(state: S) => boolean} condition - 条件函数
   * @param {Selector<S, R>} trueSelector - 条件为true时执行的选择器
   * @param {Selector<S, R>} falseSelector - 条件为false时执行的选择器
   * @returns {Selector<S, R>} 条件选择器
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.createConditionalSelector(
   *   (s) => s.userType === 'admin',
   *   (s) => s.adminPermissions,
   *   (s) => s.userPermissions
   * )
   *
   * const permissions = selector({ userType: 'admin', adminPermissions: [...], userPermissions: [...] })
   * // 返回 adminPermissions
   * ```
   */
  static createConditionalSelector<S extends State, R>(
    condition: (state: S) => boolean,
    trueSelector: Selector<S, R>,
    falseSelector: Selector<S, R>,
  ): Selector<S, R> {
    return (state: S): R => {
      return condition(state) ? trueSelector(state) : falseSelector(state)
    }
  }

  /**
   * 创建默认值选择器
   *
   * 选择器失败或返回undefined时使用默认值
   *
   * @template S - 状态类型
   * @template R - 返回值类型
   * @param {Selector<S, R>} selector - 原始选择器
   * @param {R} defaultValue - 默认值
   * @returns {Selector<S, R>} 带默认值的选择器
   *
   * @remarks 只有「选择器抛错」这条兜底会留一条 `console.error`；「合法返回 undefined」不记日志。
   *   否则两种情形在结果上同形，拼错的属性名会长期伪装成「正常的空值」（`R` 的声明给不出信号：
   *   undefined 并非 `R` 的合法取值，判定只能靠运行期）。
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.createDefaultSelector(
   *   (s) => s.optionalField,
   *   'N/A'
   * )
   *
   * const value1 = selector({ optionalField: 'exists' })
   * console.log(value1) // 'exists'
   *
   * const value2 = selector({ optionalField: undefined })
   * console.log(value2) // 'N/A'
   * ```
   */
  static createDefaultSelector<S extends State, R>(selector: Selector<S, R>, defaultValue: R): Selector<S, R> {
    return (state: S): R => {
      try {
        const value = selector(state)
        return value === undefined ? defaultValue : value
      } catch (error) {
        // 兜底不等于静默：本家族（retrySelector 的 shouldRetry / delay 异常）都留一条
        // console.error。不记的话「selector 抛了 TypeError（属性名拼错）」与
        // 「selector 合法返回 undefined」在结果上完全同形，都只看到 defaultValue
        console.error('[SelectorComposer] Default selector failed, falling back to defaultValue:', error)
        return defaultValue
      }
    }
  }

  // 重试族实现已拆至 ./retrySelector.js；保留同名静态方法以维持 SelectorComposer.createRetrySelector*
  // 的既有调用方式与文档位置
  static createRetrySelector<S extends State, R>(selector: Selector<S, R>, options: RetrySelectorOptions = {}): Selector<S, R> {
    return createRetrySelector(selector, options)
  }

  static createRetrySelectorAsync<S extends State, R>(selector: Selector<S, R>, options: AsyncRetrySelectorOptions = {}): (state: S) => Promise<R> {
    return createRetrySelectorAsync(selector, options)
  }

  /**
   * 创建防抖选择器
   *
   * 延迟执行选择器，在延迟期间多次调用只执行最后一次
   *
   * @template S - 状态类型
   * @template R - 返回值类型
   * @param {Selector<S, R>} selector - 原始选择器
   * @param {number} [delay=300] - 防抖延迟（毫秒）
   * @returns {Selector<S, Promise<R>>} 防抖选择器（返回Promise）
   *
   * @remarks **每次调用的返回 Promise 都必须被处理**（await 或挂 `.catch`）：防抖窗口内的
   * 前几次调用共享最后那一个 Promise，选择器抛错时它以 rejection 收尾；若那次调用丢弃了
   * 返回值，Node/小程序运行时就把这次 rejection 报成 unhandledRejection（本库不代为
   * `.catch(noop)` 吞掉——那会让真实失败彻底不可见）。
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.createDebouncedSelector(
   *   (s) => s.value * 2,
   *   300
   * )
   *
   * // 多次调用在300ms内只有最后一次会执行，且所有调用拿到同一个结果
   * await Promise.all([selector(state), selector(state), selector(state).catch(onError)])
   * // 选择器抛错时：await selector(state).catch((error) => reportError(error))
   * ```
   */
  static createDebouncedSelector<S extends State, R>(selector: Selector<S, R>, delay: number = 300): Selector<S, Promise<R>> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let currentState: S | null = null
    let currentPromise: Promise<R> | null = null
    let currentResolve: ((value: R) => void) | null = null
    // reject 的形参是 unknown 而非 Error：`throw 'boom'` / `throw 42` 都是合法抛出值，
    // 声明成 Error 只是编译期断言，Promise 实际会带非 Error 原因落地
    let currentReject: ((error: unknown) => void) | null = null

    return (state: S): Promise<R> => {
      // 清除之前的定时器。与 null 比，**不能**判真值：宿主/注入式时钟（本模块的用例就跑在
      // fake timers 下）可以返回 0 作定时器句柄，真值判定会让这条 clearTimeout 永不执行，
      // 防抖窗口静默失效、同一轮里多次执行选择器
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }

      // 保存当前状态
      currentState = state

      // 如果没有正在进行的Promise，创建一个新的
      // 残余口径：回调执行 selector(state) 期间的同步重入调用会复用这个尚未清空的
      // currentPromise，因而拿到上一轮结果而非自己的结果。要消除它就得在回调开头先认领
      // promise/resolve/reject 槽位，代价是重入调用的返回值若无人 await，其 rejection 会
      // 变成 unhandled rejection——超出 low 波次的改动幅度，故此处只恢复定时器可清除性
      // （见 finally 的 firedTimer 比对）
      if (!currentPromise) {
        currentPromise = new Promise<R>((resolve, reject) => {
          currentResolve = resolve
          currentReject = reject
        })
      }

      // 设置定时器
      timeoutId = setTimeout(() => {
        // 记下触发本次回调的定时器 id：回调里的 selector(state) 可能经宿主副作用（store
        // 订阅等）同步重入本选择器，那次调用会另起一个定时器并覆盖 timeoutId。
        // 不加这层比对就会把它抹成 null：重入调用的定时器从此失去句柄，后续调用既
        // clearTimeout 不掉它（防抖窗口失效），它又会在已结算的槽位上空跑一次回调
        const firedTimer = timeoutId
        try {
          const state = currentState
          if (state === null) {
            // 防御：仅在未保存状态时不可能到达（每次调用前已赋值）
            currentReject?.(new Error('[SelectorComposer] Debounced selector state missing'))
            return
          }

          // 使用保存的最新状态执行选择器
          const value = selector(state)
          currentResolve?.(value)
        } catch (error) {
          // 原样转成 rejection 原因：非 Error 的抛出值（`throw 'boom'`）不做包装、不做断言，
          // 调用方 catch 到的就是选择器抛出的那个值
          currentReject?.(error)
        } finally {
          // 清理必须在所有出口执行（含 state 缺失的防御分支）：否则一个 null state
          // 会把已结算的 Promise 与 resolve/reject/timer 留在共享槽位，后续调用永远
          // 复用同一个已拒绝的 Promise，选择器结果全部被丢弃
          currentPromise = null
          currentResolve = null
          currentReject = null
          // 只在自己仍是「最后一次排定的定时器」时才清空槽位（见上方 firedTimer）
          if (timeoutId === firedTimer) {
            timeoutId = null
          }
        }
      }, delay)

      return currentPromise
    }
  }

  /**
   * 创建节流选择器
   *
   * 限制选择器执行频率，在指定间隔内只执行一次
   *
   * @template S - 状态类型
   * @template R - 返回值类型
   * @param {Selector<S, R>} selector - 原始选择器
   * @param {number} [interval=300] - 节流间隔（毫秒）
   * @returns {Selector<S, R>} 节流选择器
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.createThrottledSelector(
   *   (s) => s.value * 2,
   *   300
   * )
   *
   * // 在300ms内多次调用只执行一次
   * selector(state)
   * selector(state)
   * selector(state)
   * // 第一次执行，后两次返回缓存值
   * ```
   */
  static createThrottledSelector<S extends State, R>(selector: Selector<S, R>, interval: number = 300): Selector<S, R> {
    // 「是否已算过一次」必须是显式标记，不能借时钟值当哨兵：旧写法 `lastCall === 0` 在注入式
    // 时钟 / fake timers 把 Date.now 定为 epoch 0 时永远成立不了（赋值回去还是 0），
    // 节流会静默退化成每次调用都重算。不用 -Infinity 作初值是为了保住 interval 为 NaN 时
    // 「首次仍计算、此后长期复用」的既有表现（负初值会让 Inf >= NaN 为 false，首调用直接返回 undefined）
    let computed = false
    let lastCall = 0
    let lastValue!: R

    return (state: S): R => {
      const now = Date.now()

      if (!computed || now - lastCall >= interval) {
        // 取值成功后才提交节流状态：若 selector 抛错，lastCall 保持旧值，
        // 窗口内的重试仍会走到重算分支——否则首次抛错会把 lastCall 推进到
        // 当前时刻，窗口内后续调用全部静默返回 undefined（比抛错难排查得多）
        const value = selector(state)
        computed = true
        lastCall = now
        lastValue = value
        return value
      }

      return lastValue
    }
  }
}
