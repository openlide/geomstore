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

/**
 * `retries` 的统一校验：两个重试工厂共用，避免同一约束与报错文案在两处漂移
 *
 * @throws {TypeError} 非整数或负数
 */
function assertValidRetries(retries: number): void {
  if (!Number.isInteger(retries) || retries < 0) {
    throw new TypeError(`[SelectorComposer] retries 必须是非负整数，收到: ${retries}`)
  }
}

/**
 * 调用用户的 `shouldRetry`
 *
 * 它在 `catch` 块里被调用：不保护的话，回调自身的异常会顶替选择器的原始错误、
 * 并绕过 `throwRetryExhausted` 的 `attempts` 标注，使这条失败路径与本模块其它
 * 失败路径（都是「抛原错误 + 标注」）不一致。判不了就按「不再重试」处理，
 * 让收尾逻辑抛出真实的那个错误。
 */
function invokeShouldRetry(shouldRetry: ((error: Error, attempt: number) => boolean) | undefined, error: Error, attempt: number): boolean {
  if (!shouldRetry) {
    return true
  }
  try {
    return Boolean(shouldRetry(error, attempt))
  } catch (callbackError) {
    console.error('[SelectorComposer] shouldRetry threw, stop retrying and rethrow the original error:', callbackError)
    return false
  }
}

/** 在错误对象上以不可枚举属性标注总尝试次数，供调用方排障 */
function annotateAttempts(error: Error, attempts: number): Error {
  // 选择器可以合法地 `throw 'boom'` / `throw 42`，或重抛冻结的 Error：
  // 此时 defineProperty 抛 TypeError，会用标注失败顶替真正的原始错误
  const annotatable = typeof error === 'object' && error !== null && Object.isExtensible(error)
  if (annotatable && !(error as Error & { attempts?: number }).attempts) {
    try {
      Object.defineProperty(error, 'attempts', {
        value: attempts,
        enumerable: false,
        configurable: true,
        writable: true,
      })
    } catch {
      // 标注只是排障附加信息，失败不得掩盖原始错误
    }
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
 * @remarks `shouldRetry` 自身抛错按「不再重试」处理（原始错误照常带 `attempts` 标注抛出），
 * 不会让回调异常顶替选择器的真实失败。
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
  assertValidRetries(retries)

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
        if (isRetryAttempt && invokeShouldRetry(shouldRetry, lastError, attempt + 1)) {
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
 * 为什么不按「已知不可达」把参数收窄成 `Error` 并删掉兜底分支：收窄要靠 `lastError as Error`
 * 或 `!` 断言（`no-non-null-assertion` 为 warn），而断言一旦失真就会 `throw undefined`——
 * 调用方拿到的是 `undefined`，比现在这条明确报错难查得多。保留分支的代价只是一段
 * istanbul 已忽略的 5 行代码。
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
 * 同步重试选择器无法在尝试之间让出（延迟意味着忙等），延迟/退避
 * 能力由本异步变体承载。
 *
 * 本变体**不提供**取消信号（无 `signal`/`AbortSignal` 选项）：已在执行的
 * `selector(state)` 无法被打断，重试循环也只在两次尝试之间读 `shouldRetry`。
 * 需要提前停止就让 `shouldRetry` 返回 false（剩余尝试立即结束、原错误照常带
 * `attempts` 标注抛出），真正的取消须由被包装的选择器自己实现。
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
 * @remarks 与同步变体同口径：`shouldRetry` 抛错按「不再重试」处理、`delay` 函数抛错按 0 等待
 * 处理，两者都只留一条 `console.error`，不会顶替选择器的真实失败、也不会绕过 `attempts` 标注。
 *
 * @example
 * ```typescript
 * const selector = SelectorComposer.createRetrySelectorAsync(
 *   (s) => externalCache.get(s.key),
 *   { retries: 3, delay: (attempt) => 100 * 2 ** (attempt - 1) }
 * )
 * ```
 */
export function createRetrySelectorAsync<S extends State, R>(selector: Selector<S, R>, options: AsyncRetrySelectorOptions = {}): (state: S) => Promise<R> {
  const { retries = 3, delay = 0, shouldRetry } = options
  assertValidRetries(retries)

  return async (state: S): Promise<R> => {
    let lastError: Error | undefined
    // 实际执行的尝试次数：shouldRetry 中途拒绝会提前退出，
    // error.attempts 必须记录真实次数而非上限 retries + 1
    let attemptCount = 0

    for (let attempt = 0; ; attempt++) {
      attemptCount = attempt + 1
      try {
        // await 而非直接 return：异步选择器的 rejection 在 return 之后才落地，
        // 不 await 会让 catch 永远捕不到失败，重试与 error.attempts 标注全部失效
        return await selector(state)
      } catch (error) {
        lastError = error as Error
        const canRetry = attempt < retries && invokeShouldRetry(shouldRetry, lastError, attempt + 1)
        if (!canRetry) {
          break
        }
        // 退避函数也不能决定成败：抛错时按默认 0（立即重试）继续，
        // 既不丢掉 attempts 标注，也不改变「总尝试 = retries + 1」的契约
        let waitMs: number
        if (typeof delay === 'function') {
          try {
            waitMs = delay(attempt + 1)
          } catch (callbackError) {
            console.error('[SelectorComposer] delay threw, retrying without waiting:', callbackError)
            waitMs = 0
          }
        } else {
          waitMs = delay
        }
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs))
        }
      }
    }

    throwRetryExhausted(lastError, attemptCount)
  }
}
