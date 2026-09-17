/**
 * GeomStore - Action 异步能力公共内核
 *
 * 统一「指数退避重试」与「超时竞速」两份此前在装饰器（decorators/retry、decorators/timeout）
 * 与执行器（AsyncActionSupport）中各自实现的逻辑，避免同一语义多份拷贝长期漂移。
 */

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
      const lastError = error as Error

      // 还有重试次数且满足重试条件才继续
      const canRetry = i < maxRetries && (shouldRetry ? shouldRetry(lastError) : true)
      if (!canRetry) {
        throw lastError
      }

      onRetry?.(lastError, i + 1)
      // 指数退避
      await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)))
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
 * @param timeout - 超时时间（毫秒）
 * @param timeoutMessage - 超时错误消息
 * @returns 原 Promise 的结果；超时则抛出错错误
 */
export async function raceWithTimeout<T>(promise: Promise<T>, timeout: number, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeout)
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
