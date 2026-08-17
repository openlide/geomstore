/**
 * GeomStore v1.0 - 选择器组合
 *
 * 提供选择器组合、管道操作和高级选择器创建功能
 *
 * @since 1.0.0
 */

import type { Selector, SelectorComposerInput } from '../../types/selector'

/**
 * 选择器组合器类
 *
 * 提供静态方法用于组合、管道和创建高级选择器
 *
 * @class SelectorComposer
 * @since 1.0.0
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
   * @template R - 返回值类型
   * @param {SelectorComposerInput<S>} input - 选择器和组合器配置
   * @returns {Selector<S, R>} 组合后的选择器
   * @since 1.0.0
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.combine({
   *   selectors: [
   *     (s) => s.base,
   *     (s) => s.taxRate
   *     (s) => s.shipping
   *   ],
   *   combiner: (base, tax, shipping) => base * (1 + tax) + shipping
   * })
   *
   * const total = selector({ base: 100, taxRate: 0.1, shipping: 10 })
   * // 100 * 1.1 + 10 = 120
   * ```
   */
  static combine<S extends Record<string, unknown>, R = unknown, T extends readonly Selector<S, unknown>[] = readonly Selector<S, unknown>[]>(
    input: SelectorComposerInput<S, T>,
  ): Selector<S, R> {
    const { selectors, combiner } = input

    return (state: S): R => {
      // 执行所有选择器
      const results = selectors.map((selector) => selector(state)) as unknown as T

      // 组合结果
      return combiner(...results) as R
    }
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
   * @param {Selector<S, T1>} selector1 - 第一个选择器
   * @param {(input: T1) => T2} selector2 - 第二个选择器
   * @param {(input: T2) => T3} selector3 - 第三个选择器（可选）
   * @returns {Selector<S, T4 | T3 | T2 | T1>} 管道选择器
   * @since 1.0.0
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
  static pipe<S extends Record<string, unknown>, T1, T2, T3, T4>(
    selector1: Selector<S, T1>,
    selector2: (input: T1) => T2,
    selector3: (input: T2) => T3,
    selector4: (input: T3) => T4,
  ): Selector<S, T4>
  static pipe<S extends Record<string, unknown>, T1, T2, T3>(
    selector1: Selector<S, T1>,
    selector2: (input: T1) => T2,
    selector3: (input: T2) => T3,
  ): Selector<S, T3>
  static pipe<S extends Record<string, unknown>, T1, T2>(selector1: Selector<S, T1>, selector2: (input: T1) => T2): Selector<S, T2>
  static pipe<S extends Record<string, unknown>, T1>(selector1: Selector<S, T1>): Selector<S, T1>
  // 重载实现签名：对外类型安全由各重载保证，此处放宽为通用函数类型
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static pipe(...selectors: Array<(state: any) => any>): (state: any) => any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (state: any) => {
      return selectors.reduce((acc, selector) => selector(acc), state)
    }
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
   * @returns {Selector<S, R3 | R2 | R1>} 派生选择器
   * @since 1.0.0
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
  static createDerived<S extends Record<string, unknown>, R1, R2, R3>(
    selector1: Selector<S, R1>,
    selector2: (input: R1) => R2,
    selector3: (input: R2) => R3,
  ): Selector<S, R3>
  static createDerived<S extends Record<string, unknown>, R1, R2>(selector1: Selector<S, R1>, selector2: (input: R1) => R2): Selector<S, R2>
  // 重载实现签名：对外类型安全由各重载保证，此处放宽为通用函数类型
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static createDerived(...selectors: Array<(state: any) => any>): (state: any) => any {
    return SelectorComposer.pipe(...(selectors as [never]))
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
   * @since 1.0.0
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.createArraySelector(
   *   (item) => item.value * 2
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
   * 对对象的每个键应用选择器
   *
   * @template S - 状态类型
   * @template K - 键类型
   * @template R - 值类型
   * @param {(key: K) => Selector<S, R>} keySelector - 键选择器工厂
   * @returns {Selector<S, Record<K, R>>} 对象选择器
   * @since 1.0.0
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
  static createObjectSelector<S extends Record<string, unknown>, K extends keyof S, R>(keySelector: (key: K) => Selector<S, R>): Selector<S, Record<K, R>> {
    return (state: S): Record<K, R> => {
      const result = {} as Record<K, R>

      for (const key of Object.keys(state) as K[]) {
        result[key] = keySelector(key)(state)
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
   * @since 1.0.0
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
  static createConditionalSelector<S extends Record<string, unknown>, R>(
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
   * @since 1.0.0
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
  static createDefaultSelector<S extends Record<string, unknown>, R>(selector: Selector<S, R>, defaultValue: R): Selector<S, R> {
    return (state: S): R => {
      try {
        const value = selector(state)
        return value === undefined ? defaultValue : value
      } catch (error) {
        return defaultValue
      }
    }
  }

  /**
   * 创建重试选择器
   *
   * 选择器失败时自动重试
   *
   * @template S - 状态类型
   * @template R - 返回值类型
   * @param {Selector<S, R>} selector - 原始选择器
   * @param {number} [maxRetries=3] - 最大重试次数
   * @returns {Selector<S, R>} 重试选择器
   * @since 1.0.0
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.createRetrySelector(
   *   (s) => {
   *     if (!s.ready) throw new Error('Not ready')
   *     return s.value
   *   },
   *   3
   * )
   *
   * // 会重试最多3次
   * const result = selector(state)
   * ```
   */
  static createRetrySelector<S extends Record<string, unknown>, R>(selector: Selector<S, R>, maxRetries: number = 3): Selector<S, R> {
    return (state: S): R => {
      let lastError: Error | undefined

      for (let i = 0; i <= maxRetries; i++) {
        try {
          return selector(state)
        } catch (error) {
          lastError = error as Error
          if (i < maxRetries) {
            // 可以添加延迟
            continue
          }
        }
      }

      // maxRetries >= 0 时循环内必然赋过值；兜底仅防御未来逻辑变更
      if (lastError) {
        throw lastError
      }
      throw new Error('[SelectorComposer] Retry selector failed without error')
    }
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
   * @since 1.0.0
   *
   * @example
   * ```typescript
   * const selector = SelectorComposer.createDebouncedSelector(
   *   (s) => s.value * 2,
   *   300
   * )
   *
   * // 多次调用在300ms内只有最后一次会执行
   * selector(state)
   * selector(state)
   * selector(state)
   * // 只执行一次
   * ```
   */
  static createDebouncedSelector<S extends Record<string, unknown>, R>(selector: Selector<S, R>, delay: number = 300): Selector<S, Promise<R>> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let currentState: S | null = null
    let currentPromise: Promise<R> | null = null
    let currentResolve: ((value: R) => void) | null = null
    let currentReject: ((error: Error) => void) | null = null

    return (state: S): Promise<R> => {
      // 清除之前的定时器
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      // 保存当前状态
      currentState = state

      // 如果没有正在进行的Promise，创建一个新的
      if (!currentPromise) {
        currentPromise = new Promise<R>((resolve, reject) => {
          currentResolve = resolve
          currentReject = reject
        })
      }

      // 设置定时器
      timeoutId = setTimeout(() => {
        const state = currentState
        if (state === null) {
          // 防御：仅在未保存状态时不可能到达（每次调用前已赋值）
          currentReject?.(new Error('[SelectorComposer] Debounced selector state missing'))
          return
        }
        try {
          // 使用保存的最新状态执行选择器
          const value = selector(state)
          if (currentResolve) {
            currentResolve(value)
          }
        } catch (error) {
          if (currentReject) {
            currentReject(error as Error)
          }
        } finally {
          // 清理
          currentPromise = null
          currentResolve = null
          currentReject = null
          timeoutId = null
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
   * @since 1.0.0
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
  static createThrottledSelector<S extends Record<string, unknown>, R>(selector: Selector<S, R>, interval: number = 300): Selector<S, R> {
    let lastCall = 0
    let lastValue: R

    return (state: S): R => {
      const now = Date.now()

      if (lastCall === 0 || now - lastCall >= interval) {
        lastCall = now
        lastValue = selector(state)
      }

      return lastValue
    }
  }
}
