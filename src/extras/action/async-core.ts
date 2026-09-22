/**
 * GeomStore - Action 异步能力公共内核
 *
 * 统一「指数退避重试」与「超时竞速」两份此前在装饰器（decorators/retry、decorators/timeout）
 * 与执行器（AsyncActionSupport）中各自实现的逻辑，避免同一语义多份拷贝长期漂移。
 */

/** setTimeout 上限（2^31-1 ms ≈ 24.8 天）：更大值会被宿主静默钳制为 1ms 并触发溢出告警 */
const MAX_TIMER_DELAY = 2 ** 31 - 1

/** 抛出的对象里非原始值字段的占位文本（内容不外泄） */
const ELIDED_PLACEHOLDER = '[details omitted]'

/**
 * 抛出的对象 → 一层「原始值字段」投影
 *
 * 不用 `JSON.stringify`，三个理由：
 * 1. 它会递归展开整棵对象树。这些文本落在 `ActionResult.error.message` 与 errorData 上，
 *    进而进日志/上报通道——一个请求/配置对象就能把 token、请求体、用户 PII 整体搬进
 *    用户可见输出；
 * 2. 它会执行用户代码：`toJSON` 与 getter 都在**错误路径**上被调用，可能抛错也可能有副作用；
 * 3. 循环引用还会让它直接抛 TypeError。
 *
 * 代价是消息里只剩一层可辨识的原始字段（`{"code":500}` 仍然完整），嵌套结构以
 * {@link ELIDED_PLACEHOLDER} 占位。顶层原始字段依旧会进消息：真要严格脱敏，
 * 依据只能是「被抛的值里本来就不放凭证」。
 */
function describeThrownObject(value: object): string {
  const projection: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    // 只取数据描述符：读访问器属性本身就是执行用户代码
    if (descriptor === undefined || !('value' in descriptor)) {
      continue
    }
    const field: unknown = descriptor.value
    const type = typeof field
    if (field === null || type === 'string' || type === 'boolean' || type === 'number') {
      projection[key] = field
    } else if (type === 'bigint') {
      // JSON.stringify 遇到 BigInt 会直接抛 TypeError，故转文本（带 n 后缀与字符串区分）
      projection[key] = `${String(field)}n`
    } else if (type === 'object') {
      projection[key] = ELIDED_PLACEHOLDER
    }
    // function / symbol / undefined：既不承载内容也不承载结构，与 JSON.stringify 一样省略
  }

  return JSON.stringify(projection)
}

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
  if (typeof value !== 'object' || value === null) {
    return new Error(String(value))
  }
  try {
    return new Error(describeThrownObject(value))
  } catch {
    // 连 ownKeys / getOwnPropertyDescriptor 都会被异常（典型是 Proxy 陷阱）打断：
    // 此时只剩「抛出了一个对象」这个事实，且不再尝试读取它的任何内容
    return new Error('[thrown object could not be inspected]')
  }
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

/**
 * 超时错误的稳定身份标识
 *
 * 调用方此前只能按 message 文本 (`Timeout after <n>ms` / `Action timeout after <n>ms`)
 * 判定超时，两个入口的文本又不一致——底层 action 只要抛出一条恰好含 `Timeout after`
 * 的字符串就能骗过判定，反过来真实超时也可能因为文案演进被漏判。挂 `code` 之后
 * 识别改按 `error.code === TIMEOUT_ERROR_CODE`，文案继续由各调用方自拼、只作展示。
 */
export const TIMEOUT_ERROR_CODE = 'ACTION_TIMEOUT' as const

/** 附带 `code` 的超时错误形状（`Error` + {@link TIMEOUT_ERROR_CODE}） */
export interface TimeoutError extends Error {
  code: typeof TIMEOUT_ERROR_CODE
}

/**
 * 超时错误的唯一构造点
 *
 * `raceWithTimeout` 用它替换此前直接 `new Error(timeoutMessage)` 的写法，`decorators/timeout.ts`
 * 与 `AsyncActionSupport.executeWithTimeout` 都经由 `raceWithTimeout` 走到这里，
 * 于是「超时的身份」在一处定义、跨入口一致（详见 {@link TIMEOUT_ERROR_CODE}）。
 */
export function createTimeoutError(message: string): TimeoutError {
  const error = new Error(message) as TimeoutError
  error.code = TIMEOUT_ERROR_CODE

  return error
}

/**
 * 指数退避重试选项
 *
 * `retryWithBackoff` 的入参契约，也是全库重试语义的唯一定义处：装饰器侧的
 * `RetryDecoratorOptions`（`decorators/retry.ts`）与 `ActionExecutor.executeWithRetry`
 * 的 options 都是它的子集/复用者，各写一份字段声明迟早与内核漂移。
 */
export interface RetryOptions {
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
 * 把被回调异常顶掉的真实失败挂到该异常的 `cause` 上
 *
 * target/lib 为 ES2020，`Error` 构造器没有 `cause` 选项签名，按 `ErrorRecovery` 同口径
 * 用属性赋值补齐。已有 cause 的不覆盖（那是更精确的一条链），冻结/只读的对象挂不上也
 * 就此作罢——为了附加信息再顶替一次失败是本末倒置。
 */
function attachCause(error: Error, original: unknown): void {
  const tagged = error as Error & { cause?: unknown }
  if (tagged.cause !== undefined) {
    return
  }
  try {
    tagged.cause = original
  } catch {
    // 只读/冻结：放弃附加信息
  }
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
 *
 * 两者对回调异常的处理不同，是刻意的：`shouldRetry` 决定「要不要再来一次」，抛错即视为
 * 该判断不可用、按原样向上抛（不擅自替调用方决定重试），但被它顶掉的真实失败会挂成
 * `cause`（见 {@link attachCause}），根因不至于整个丢失；`onRetry` 只是通知，抛错被隔离
 * 成一条 `console.error`，不中断重试、也不顶替真实失败。
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
      let canRetry: boolean
      try {
        canRetry = i < maxRetries && (shouldRetry ? shouldRetry(normalizedError) : true)
      } catch (callbackError) {
        // shouldRetry 抛错 = 该判断不可用，不擅自替调用方决定重试，按原样向上抛。
        // 但它会把 fn 的真实失败整个顶掉（调用方只看到一个与故障无关的回调异常），
        // 故先把原始抛出值挂成 cause 保留根因，再抛回调异常本身
        if (callbackError instanceof Error) {
          attachCause(callbackError, error)
        }
        throw callbackError
      }
      if (!canRetry) {
        throw error
      }

      // 通知回调的异常不得改变重试结果：与 ErrorRecovery.executeRetryStrategy 的
      // onRetry 处理同口径（否则一个只用于打日志的回调能让重试提前中断、
      // 并让调用方看到与真实失败无关的报错）
      if (onRetry) {
        try {
          onRetry(normalizedError, i + 1)
        } catch (callbackError) {
          console.error('[retryWithBackoff] Error in onRetry callback:', callbackError)
        }
      }

      // 指数退避：NaN/负数归零（本就无从等待），正的 Infinity 与超界值钳到 MAX_TIMER_DELAY。
      // 此前 `Number.isFinite(delay) ? max(0, delay) : 0` 把 Infinity（「能等多久等多久」的
      // 常见写法）也折成 0，退避反而静默变成紧贴重试，与上一行的意图自相矛盾
      const baseDelay = typeof delay === 'number' && !Number.isNaN(delay) && delay > 0 ? Math.min(delay, MAX_TIMER_DELAY) : 0
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
 * @param timeoutMessage - 超时错误消息（仅用于展示，识别请用 {@link TIMEOUT_ERROR_CODE}）
 * @returns 原 Promise 的结果；超时则抛出错错误
 * @throws {RangeError} timeout 为非有限值或 <= 0
 *
 * @remarks 不可取消：超时只是让本函数提前 reject，`promise` 仍会在后台继续执行到结束；
 * 需要真正中断请在 `promise` 内部实现 AbortController 等取消机制。
 *
 * 超时错误由 {@link createTimeoutError} 统一构造并带 `code === TIMEOUT_ERROR_CODE`：
 * `timeoutMessage` 只决定人读到的文案，判定超时应按 code 而非匹配文本。
 */
export async function raceWithTimeout<T>(promise: Promise<T>, timeout: number, timeoutMessage: string): Promise<T> {
  const delay = normalizeTimeout(timeout, 'raceWithTimeout')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(createTimeoutError(timeoutMessage)), delay)
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
