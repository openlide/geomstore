/**
 * GeomStore - Action 异步能力公共内核
 *
 * 统一「指数退避重试」与「超时竞速」两份此前在装饰器（decorators/retry、decorators/timeout）
 * 与执行器（AsyncActionSupport）中各自实现的逻辑，避免同一语义多份拷贝长期漂移。
 */

/** setTimeout 上限（2^31-1 ms ≈ 24.8 天）：更大值会被宿主静默钳制为 1ms 并触发溢出告警 */
const MAX_TIMER_DELAY = 2 ** 31 - 1

/**
 * 把任意被抛出的值规范为 `Error`
 *
 * action 可以 `throw 'boom'` / `throw { code: 500 }` / `throw null`，而 `ActionResult.error`、
 * `shouldRetry`/`onRetry`/`onError` 回调与 errorData 的 `message`/`stack` 读取都按 `Error` 契约工作。
 * `error as Error` 只是编译期断言，运行时并不成立，故统一在入口处过一次本函数。
 *
 * @param value - 任意被抛出/拒绝的值
 * @returns 原样返回 `Error`；其余值包裹为带可辨识文本的新 Error
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value
  }
  if (typeof value === 'string') {
    return new Error(value)
  }
  // 对象走 JSON 而非 String()，否则得到无信息量的 [object Object]；
  // 循环引用等序列化失败场景回退 String()
  let text: string
  try {
    text = value === null || typeof value !== 'object' ? String(value) : (JSON.stringify(value) ?? String(value))
  } catch {
    text = String(value)
  }

  return new Error(text)
}

/**
 * 校验超时毫秒数并截断到宿主可表达的区间
 *
 * `0`/负数会让竞速立刻判负、`NaN` 被 setTimeout 当作 0、`Infinity` 触发溢出告警后按 1ms 处理，
 * 三种情况都是「方法瞬间失败且错误信息与真实原因无关」，因此直接拒绝该配置。
 */
export function normalizeTimeout(timeout: number, context: string): number {
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new RangeError(`${context} 的 timeout 必须是大于 0 的有限数值，收到: ${String(timeout)}`)
  }

  return Math.min(timeout, MAX_TIMER_DELAY)
}

/** 指数退避重试选项 */
interface RetryOptions {
  /** 最大重试次数（不含首次执行），默认 3 */
  retries?: number
  /** 基础退避延迟（毫秒），第 n 次重试等待 delay * 2^(n-1)，默认 100 */
  delay?: number
  /** 是否对某次错误继续重试（返回 false 立即抛出），默认全部重试 */
  shouldRetry?: (error: Error) => boolean
  /** 每次实际重试前的回调（attempt 从 1 开始） */
  onRetry?: (error: Error, attempt: number) => void
}

/**
 * 以指数退避重试执行异步函数。
 *
 * @param fn - 被执行的异步函数（每次重试重新调用）
 * @param options - 重试选项
 * @returns 首次成功的结果；重试耗尽/不满足 shouldRetry 时抛出最后一次错误
 *
 * @remarks `shouldRetry`/`onRetry` 收到的是规范化后的 `Error`（抛出的值不是 Error 时包裹），
 * 而向外抛出的始终是原始值。
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { retries = 3, delay = 100, shouldRetry, onRetry } = options
  // 非有限值/负数/小数统一归一到非负整数：retries 表示「首次执行之外的重试次数」，
  // 无论取何值首次调用都必须执行。此前 `i <= retries` 在 NaN/负数下整段循环不执行，
  // fn 一次都没跑却抛出「Retry failed without error」这种与真实原因无关的错误
  const maxRetries = Number.isFinite(retries) ? Math.max(0, Math.floor(retries)) : 0

  for (let i = 0; ; i++) {
    try {
      return await fn()
    } catch (error) {
      // 回调侧按 Error 契约取 message/stack，故传规范化的副本；
      // 对外抛出的仍是原始值，避免改写调用方 `catch (e) => e === thrown` 这类身份判断
      const normalizedError = toError(error)

      // 还有重试次数且满足重试条件才继续
      const canRetry = i < maxRetries && (shouldRetry ? shouldRetry(normalizedError) : true)
      if (!canRetry) {
        throw error
      }

      onRetry?.(normalizedError, i + 1)
      // 指数退避：NaN/负数会让 setTimeout 立即触发，Infinity/超 2^31-1 会被宿主钳制为 0/1ms，
      // 两者都会把「退避」静默变成「立即重试」，故归一到 [0, MAX_TIMER_DELAY]
      const baseDelay = Number.isFinite(delay) ? Math.max(0, delay) : 0
      const wait = Math.min(baseDelay * Math.pow(2, i), MAX_TIMER_DELAY)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }
}

/**
 * 为 Promise 增加超时竞速：超时先落地则以 timeoutMessage 对应的错误拒绝。
 *
 * Promise.race 会为两侧都附加处理器，故落败方（原 Promise）后续的 reject
 * 不会成为 unhandledRejection，无需额外兜底 catch。
 *
 * @param promise - 被竞速的 Promise
 * @param timeout - 超时时间（毫秒，必须为大于 0 的有限数值）
 * @param timeoutMessage - 超时错误消息
 * @returns 原 Promise 的结果；超时则抛出错错误
 * @throws {RangeError} timeout 为非有限值或 <= 0
 *
 * @remarks 不可取消：超时只是让本函数提前 reject，`promise` 仍会在后台继续执行到结束；
 * 需要真正中断请在 `promise` 内部实现 AbortController 等取消机制。
 */
export async function raceWithTimeout<T>(promise: Promise<T>, timeout: number, timeoutMessage: string): Promise<T> {
  const delay = normalizeTimeout(timeout, 'raceWithTimeout')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), delay)
      }),
    ])
  } finally {
    // 无论成功/失败/超时，都清除定时器，避免句柄泄漏
    /* istanbul ignore else -- Promise.race 必定同步求值第二项，timer 恒被赋值 */
    if (timer !== undefined) {
      clearTimeout(timer)
    }
  }
}
