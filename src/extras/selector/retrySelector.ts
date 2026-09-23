/**
 * GeomStore - 重试选择器
 *
 * 自 selectorComposer.ts 拆出：同步/异步重试选择器与其选项类型。
 *
 * @module selector/retrySelector
 */

import type { Selector } from '../../types/selector.js'
import type { State } from '../../types/store.js'

/** `shouldRetry` 的函数形状，供选项契约与共用的 `shouldRetryMore` 同源引用 */
type RetryPredicate = (error: Error, attempt: number) => boolean

/** 同步重试选择器选项 */
export interface RetrySelectorOptions {
  /**
   * 重试次数（不含首次执行，总尝试次数 = retries + 1），默认 3。
   * 仅适用于依赖外部可变状态的 selector——纯函数对相同输入重试必然得到相同结果
   */
  retries?: number
  /**
   * 是否对该错误继续重试（attempt 为重试序号，从 1 开始）
   *
   * 形参按 `Error` 契约给出：选择器抛出的若不是 Error（`throw 'boom'` / `throw { code: 500 }`），
   * 调用本回调前先规范成同等信息量的 Error，否则回调里的 `error.message` 恒为 undefined，
   * 会把「该重试」误判成「不该重试」。抛给调用方的仍是原值
   */
  shouldRetry?: RetryPredicate
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
 * 把任意被抛出的值规范为 `Error`，**只用于喂给 `shouldRetry` 回调**
 *
 * 选择器可以合法地 `throw 'boom'` / `throw { code: 500 }` / `throw null`，而 `shouldRetry`
 * 的签名承诺 `Error`：用户实现普遍读 `error.message` / `error.name`，原始值上的这两个属性
 * 一律是 undefined，于是回调在自己没做错任何事的情况下判成「不该重试」——静默砍掉整个重试额度。
 * 交给调用方的仍是原值（`throwRetryExhausted` 只标注不改写，兑现「向外抛出的仍是原值」的契约）。
 *
 * 与 `extras/action/async-core.ts` 的 `toError` 同语义：那份实现属 Action 能力包，
 * 选择器不该为它引入跨能力包依赖（`@openlide/geomstore/extras/selector` 会因此连带装载
 * 整个 action 侧文件），故此处保持独立实现。**两者语义需同步演进**。
 */
function toRetryError(value: unknown): Error {
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
 * 「本轮失败后还要不要再来一次」的唯一判据（同步与异步重试选择器共用）
 *
 * 两处此前各写一遍、且写法不同（`if (isRetryAttempt && invokeShouldRetry(...)) continue`
 * vs `const canRetry = attempt < retries && invokeShouldRetry(...)`），同一约束有两种写法
 * 就会漂移；额度判定与用户回调的短路顺序（先判额度，额度用尽不再打扰回调）合并在此处。
 *
 * 回调在 `catch` 块里被调用：不保护的话，回调自身的异常会顶替选择器的原始错误、
 * 并绕过 `throwRetryExhausted` 的 `attempts` 标注，使这条失败路径与本模块其它
 * 失败路径（都是「抛原错误 + 标注」）不一致。判不了就按「不再重试」处理，
 * 让收尾逻辑抛出真实的那个错误。
 */
function shouldRetryMore(error: unknown, attempt: number, retries: number, shouldRetry: RetryPredicate | undefined): boolean {
  if (attempt >= retries) {
    return false
  }
  if (!shouldRetry) {
    return true
  }
  try {
    return Boolean(shouldRetry(toRetryError(error), attempt + 1))
  } catch (callbackError) {
    console.error('[SelectorComposer] shouldRetry threw, stop retrying and rethrow the original error:', callbackError)
    return false
  }
}

/**
 * 解析两次尝试之间的等待毫秒数（异步变体专用）
 *
 * 退避函数也不能决定成败：抛错时按默认 0（立即重试）继续，既不丢掉 `attempts` 标注，
 * 也不改变「总尝试 = retries + 1」的契约。返回非正数 / `NaN` 时调用侧按 0 处理（不排定时器）。
 */
function resolveDelayMs(delay: NonNullable<AsyncRetrySelectorOptions['delay']>, attempt: number): number {
  if (typeof delay !== 'function') {
    return delay
  }
  try {
    return delay(attempt)
  } catch (callbackError) {
    console.error('[SelectorComposer] delay threw, retrying without waiting:', callbackError)
    return 0
  }
}

/**
 * 「未捕获到任何抛出值」的哨兵。
 *
 * 用真值性判定错误是否存在是不成立的：选择器可以合法地 `throw null` / `throw 0` /
 * `throw ''` / `throw false` / `throw undefined`，这些值都是 falsy，会被当成「没捕到错」
 * 丢弃，调用方拿到的反而是合成的 "failed without error"，既丢了原始抛出值也丢了
 * `attempts` 标注。故显式区分「没捕到」与「捕到 falsy 值」。
 */
const NO_ERROR = Symbol('noError')

/**
 * 在错误对象上以不可枚举属性标注总尝试次数，供调用方排障
 *
 * 已有标注时取 `Math.max`，而不是「先到先得」：嵌套重试下内层标注的是**内层自己**的尝试数，
 * 外层又跑了 5 次时真实总数不小于 5，因为内层留了个 `2` 就停手只会报出偏小的数字。
 * 既有值只认有限数值参与合并——`attempts: 0` 这类 falsy 值同样被覆盖，
 * 不再出现「falsy 被覆盖、truthy 被保留」的分裂判定（非数值无从比较，按未标注处理）。
 */
function annotateAttempts(error: unknown, attempts: number): unknown {
  // 选择器可以合法地 `throw 'boom'` / `throw 42`，或重抛冻结的 Error：
  // 此时 defineProperty 抛 TypeError，会用标注失败顶替真正的原始错误
  const annotatable = typeof error === 'object' && error !== null && Object.isExtensible(error)
  if (annotatable) {
    const existing = (error as { attempts?: unknown }).attempts
    const previous = typeof existing === 'number' && Number.isFinite(existing) ? existing : 0
    if (previous < attempts) {
      try {
        Object.defineProperty(error, 'attempts', {
          value: attempts,
          enumerable: false,
          configurable: true,
          writable: true,
        })
      } catch {
        // attempts 可能是宿主/调用方留下的不可配置属性：标注只是排障附加信息，
        // 失败不得掩盖原始错误
      }
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
 * @remarks `shouldRetry` 收到的是规范化后的 `Error`（选择器 `throw 'boom'` / `throw { code: 500 }`
 * 时被包成同等文本的 Error，回调里的 `error.message` 不再恒为 undefined），而**抛给调用方的仍是
 * 原值**。`shouldRetry` 自身抛错按「不再重试」处理（原始错误照常带 `attempts` 标注抛出），
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
    let lastError: unknown = NO_ERROR
    // 实际执行的尝试次数：shouldRetry 中途拒绝会提前退出，
    // error.attempts 必须记录真实次数而非上限 retries + 1
    let attemptCount = 0

    for (let attempt = 0; ; attempt++) {
      attemptCount = attempt + 1
      try {
        return selector(state)
      } catch (error) {
        lastError = error
        if (!shouldRetryMore(error, attempt, retries, shouldRetry)) {
          break
        }
      }
    }

    // 走到这里只可能来自 catch 分支的 break（成功路径已 return），
    // 即 lastError 必已赋值；兜底仅防御未来逻辑变更
    throwRetryExhausted(lastError, attemptCount)
  }
}

/**
 * 重试额度耗尽时的统一收尾：捕获到任何抛出值（含 falsy）都标注真实尝试次数后原样抛出。
 *
 * 同步/异步两个重试选择器共用三个决策件——本函数（收尾）、`shouldRetryMore`（是否再来一次）、
 * `resolveDelayMs`（间隔多久），两条循环骨架因而逐字同构，只差异步侧多一个 `await` 与一次等待。
 * 之所以不把循环本身也合成一个 driver：driver 要 `await` 就得返回 Promise，
 * 同步变体（契约是 `Selector<S, R>`，直接返回值）就无法复用它——要么把同步 API 变成异步，
 * 要么在 driver 里同时写同步与异步两条路径，重复又回来了
 * 「完全没捕获到值」由 `NO_ERROR` 哨兵表示，与 `throw null` / `throw 0` 等合法抛出值区分开；
 * 该哨兵状态在现有循环结构下不可达（retries 已校验非负，循环至少执行一次），
 * 保留它是因为把它判为「已知不可达」并收窄参数要靠断言，而断言一旦失真就会
 * `throw undefined`——调用方拿到的是 `undefined`，比这条明确报错难查得多。
 *
 * @param lastError 最后一次失败的抛出值（任何类型，含 falsy）
 * @param attemptCount 实际执行的尝试次数（非上限）
 * @returns 永不返回（始终抛错）
 */
function throwRetryExhausted(lastError: unknown, attemptCount: number): never {
  if (lastError !== NO_ERROR) {
    throw annotateAttempts(lastError, attemptCount)
  }
  /* istanbul ignore next -- 防御性死代码：retries 已校验非负，循环必然至少执行一次；退出循环只可能来自 catch 赋值 */
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
 * @remarks 与同步变体同口径：`shouldRetry` 收到规范化后的 `Error`（抛给调用方的仍是原值）、
 * 其自身抛错按「不再重试」处理、`delay` 函数抛错按 0 等待处理，后两者都只留一条 `console.error`，
 * 不会顶替选择器的真实失败、也不会绕过 `attempts` 标注。
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
    let lastError: unknown = NO_ERROR
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
        lastError = error
        if (!shouldRetryMore(error, attempt, retries, shouldRetry)) {
          break
        }
        const waitMs = resolveDelayMs(delay, attempt + 1)
        if (waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitMs))
        }
      }
    }

    // 与同步变体同理：走到这里只可能来自 catch 分支的 break，lastError 必已赋值
    throwRetryExhausted(lastError, attemptCount)
  }
}
