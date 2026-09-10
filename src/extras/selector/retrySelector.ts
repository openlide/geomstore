/**
 * GeomStore - 重试选择器
 *
 * 自 selectorComposer.ts 拆出：同步/异步重试选择器与其选项类型。
 *
 * @module selector/retrySelector
 */

import type { Selector } from '../../types/selector.js'
import type { State } from '../../types/store.js'

/** 同步重试选择器选项 */
export interface RetrySelectorOptions {
  /**
   * 重试次数（不含首次执行，总尝试次数 = retries + 1），默认 3。
   * 仅适用于依赖外部可变状态的 selector——纯函数对相同输入重试必然得到相同结果
   */
  retries?: number
  /** 是否对该错误继续重试（attempt 为重试序号，从 1 开始） */
  shouldRetry?: (error: Error, attempt: number) => boolean
}

/** 异步重试选择器选项 */
export interface AsyncRetrySelectorOptions extends RetrySelectorOptions {
  /**
   * 重试间延迟（毫秒）或按重试序号的退避函数（attempt 从 1 开始）。
   * 默认 0（立即重试）；同步重试选择器无法承载延迟，需要延迟请用本异步变体
   */
  delay?: number | ((attempt: number) => number)
}

/** 在错误对象上以不可枚举属性标注总尝试次数，供调用方排障 */
function annotateAttempts(error: Error, attempts: number): Error {
  if (!(error as Error & { attempts?: number }).attempts) {
    Object.defineProperty(error, 'attempts', {
      value: attempts,
      enumerable: false,
      configurable: true,
      writable: true,
    })
  }
  return error
}

/**
 * 创建重试选择器
 *
 * 选择器失败时自动重试
 *
 * @template S - 状态类型
 * @template R - 返回值类型
 * @param {Selector<S, R>} selector - 原始选择器
 * @param {RetrySelectorOptions} [options] - 重试选项（默认 { retries: 3 }）
 * @returns {Selector<S, R>} 重试选择器
 *
 * @example
 * ```typescript
 * const selector = SelectorComposer.createRetrySelector(
 *   (s) => {
 *     if (!s.ready) throw new Error('Not ready')
 *     return s.value
 *   },
 *   { retries: 3 }
 * )
 *
 * // 会重试最多3次
 * const result = selector(state)
 * ```
 */
export function createRetrySelector<S extends State, R>(selector: Selector<S, R>, options: RetrySelectorOptions = {}): Selector<S, R> {
  const { retries = 3, shouldRetry } = options
  if (!Number.isInteger(retries) || retries < 0) {
    throw new TypeError(`[SelectorComposer] retries 必须是非负整数，收到: ${retries}`)
  }

  return (state: S): R => {
    let lastError: Error | undefined
    // 实际执行的尝试次数：shouldRetry 中途拒绝会提前退出，
    // error.attempts 必须记录真实次数而非上限 retries + 1
    let attemptCount = 0

    for (let attempt = 0; attempt <= retries; attempt++) {
      attemptCount = attempt + 1
      try {
        return selector(state)
      } catch (error) {
        lastError = error as Error
        const isRetryAttempt = attempt < retries
        if (isRetryAttempt && (!shouldRetry || shouldRetry(lastError, attempt + 1))) {
          continue
        }
        break
      }
    }

    // retries >= 0 时循环内必然赋过值；兜底仅防御未来逻辑变更
    throwRetryExhausted(lastError, attemptCount)
  }
}

/**
 * 重试额度耗尽时的统一收尾：有错误则标注真实尝试次数后抛出。
 *
 * 同步/异步两个重试选择器的收尾逻辑逐字相同，抽为单一实现；
 * `lastError` 为空是「未来逻辑变更」才可能出现的防御性死代码。
 *
 * @param lastError 最后一次失败的错误
 * @param attemptCount 实际执行的尝试次数（非上限）
 * @returns 永不返回（始终抛错）
 */
function throwRetryExhausted(lastError: Error | undefined, attemptCount: number): never {
  /* istanbul ignore else -- retries 已校验非负，循环必然至少执行一次并赋值 lastError */
  if (lastError) {
    throw annotateAttempts(lastError, attemptCount)
  }
  /* istanbul ignore next -- 防御性死代码：retries >= 0 时 lastError 必然已赋值 */
  throw new Error('[SelectorComposer] Retry selector failed without error')
}

/**
 * 创建可延迟重试的异步选择器
 *
 * 同步重试选择器无法在尝试之间让出（延迟意味着忙等），延迟/退避/中止
 * 能力由本异步变体承载。
 *
 * 注意：对相同 state 立即重试仅当 selector 依赖外部可变状态（时钟、随机、
 * 惰性加载的缓存）时才有意义——纯函数对相同输入重试必然得到相同结果。
 *
 * @template S - 状态类型
 * @template R - 返回值类型
 * @param {Selector<S, R>} selector - 原始选择器
 * @param {AsyncRetrySelectorOptions} [options] - 重试选项
 * @returns {(state: S) => Promise<R>} 异步选择器
 *
 * @example
 * ```typescript
 * const selector = SelectorComposer.createRetrySelectorAsync(
 *   (s) => externalCache.get(s.key),
 *   { retries: 3, delay: (attempt) => 100 * 2 ** (attempt - 1) }
 * )
 * ```
 */
export function createRetrySelectorAsync<S extends State, R>(
  selector: Selector<S, R>,
  options: AsyncRetrySelectorOptions = {},
): (state: S) => Promise<R> {
  const { retries = 3, delay = 0, shouldRetry } = options
  if (!Number.isInteger(retries) || retries < 0) {
    throw new TypeError(`[SelectorComposer] retries 必须是非负整数，收到: ${retries}`)
  }

  return async (state: S): Promise<R> => {
    let lastError: Error | undefined
    // 实际执行的尝试次数：shouldRetry 中途拒绝会提前退出，
    // error.attempts 必须记录真实次数而非上限 retries + 1
    let attemptCount = 0

    for (let attempt = 0; ; attempt++) {
      attemptCount = attempt + 1
      try {
        return selector(state)
      } catch (error) {
        lastError = error as Error
        const canRetry = attempt < retries && (!shouldRetry || shouldRetry(lastError, attempt + 1))
        if (!canRetry) {
          break
        }
        const waitMs = typeof delay === 'function' ? delay(attempt + 1) : delay
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs))
        }
      }
    }

    throwRetryExhausted(lastError, attemptCount)
  }
}
