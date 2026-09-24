/**
 * GeomStore - HTTP 错误报告器
 *
 * 自 ErrorMonitoring.ts 拆出：将错误通过 HTTP 发送到远程服务器，
 * 默认自动适配运行环境（小程序 wx.request / 浏览器 fetch），也可注入自定义请求实现。
 *
 * @module extras/error/reporters/HttpReporter
 */

import type { ErrorContext, ErrorReporter } from '../../../types/error.js'

/**
 * 上报请求体（品牌类型）。
 *
 * 产出方只有两个，且都在本类内：
 * - {@link HttpReporter.buildRequestBody}：单条投影（`report` 与批量条目共用同一条序列化）；
 * - {@link HttpReporter.buildBatchBody}：批量体，把已序列化的条目片段拼成
 *   `{"errors":[...]}`——每个片段都出自一次 `JSON.stringify`，故拼接结果必是合法 JSON。
 *
 * 两者的结果至少为 `'{}'`——`JSON.stringify` 只在顶层值为 undefined（含顶层自带 `toJSON`
 * 返回 undefined）时才返回 undefined，而这里顶层永远是对象，所以「body 恒为非空合法 JSON
 * 文本」这一前提由类型而非注释承载。嵌套层的 `toJSON` 返回 undefined 只会让那个键被丢掉
 * （数组元素则写成 `null`），body 仍是合法 JSON；会真正抛错的层（BigInt / 循环引用）在投影
 * 阶段就挡掉了（标量字段走 `toSerializableScalar`、payload 走 `toSerializablePayload`），
 * 兜底则是一条上下文序列化失败时它自己被换成标记片段（`serializeContextItem`），
 * 批次其余条目照常交付。
 * wx.request 分支直接把该 JSON 字符串作为 data 发送（wx 对字符串 data 原样发送），免去
 * parse→再序列化往返；content-type 由 `withJsonContentType` 兜底为 application/json。
 * HttpRequestImpl 保持 string 签名以便外部注入实现自行反序列化。
 */
type JsonBody = string & { readonly __jsonBodyBrand: 'JsonBody' }

/**
 * HttpReporter 构造配置：标准 RequestInit 之外增加 `timeout`。
 *
 * fetch 规范无请求超时字段，小程序 wx.request 却有原生 `timeout`；不显式建模的话
 * 调用方只能靠 as 断言传入、且 wx 分支透传与否无从谈起。fetch 分支由本实现翻译成
 * AbortController 中止（见 `createTimeoutSignal`），不再是「传了也没人管」的未知键
 */
export interface HttpReporterOptions extends RequestInit {
  /**
   * 请求超时毫秒数（两条默认请求路径均生效；`<= 0` 表示不超时）
   *
   * 未配置时 fetch 分支取 {@link DEFAULT_FETCH_TIMEOUT_MS}，与 ErrorMonitoring 的
   * `reportTimeout` 默认值同口径：监控层超时只会放行 flush 并重入队批次，**不会**取消
   * 底层请求（`Promise.race` 不终止输掉竞速的任务），故请求自身必须能真正结束，
   * 否则一次超时会变成「同一批错误再投一次」的重复投递
   */
  timeout?: number
}

/**
 * HTTP请求实现：适配不同运行环境（小程序 wx.request / 浏览器 fetch / 自定义注入）
 *
 * @remarks 注入实现收到的是**归一化后的调用方请求头**（不含默认 Content-Type 兜底，
 * 见 `withJsonContentType`）：默认实现会把 body 声明为 JSON，注入实现需自行决定
 * 请求形态（`body` 恒为 JSON 文本）
 */
export type HttpRequestImpl = (url: string, body: string, method: string, headers: Record<string, string>) => Promise<void>

/** JSON 请求体的默认 content-type：body 恒为 JSON 文本，未显式配置时按此声明 */
const JSON_CONTENT_TYPE = 'application/json'

/**
 * fetch 分支的默认请求超时，与 ErrorMonitoring 的 `reportTimeout` 默认值（10s）同口径
 *
 * 取同一数值不是为了「两层计时器对齐」，而是为了让两层在默认配置下先后落在同一刻：
 * 内层真正中止请求，外层判定超时并把批次留给下一轮重试，语义才自洽
 */
const DEFAULT_FETCH_TIMEOUT_MS = 10_000

/**
 * 为 fetch 拼出一个「到点真的会中止请求」的 signal
 *
 * fetch 规范没有 `timeout` 字段，原实现把 `options` 整个展开进 `RequestInit`，
 * `timeout` 作为未知键被静默忽略，请求没有任何中止路径：服务端接受连接却不响应时
 * 该 Promise 永久挂起，监控层每轮 flush 再挂一个，且超时后重入队的批次会在原请求
 * 迟到落地时造成重复投递。故这里用 AbortController 把超时翻译成真正的中止。
 *
 * 三条降级路径，保证「拿不到 AbortController」时退化成改动前的行为而不是抛错：
 * - 无 AbortController（极老运行时）：不设 signal，仅透传调用方的 signal；
 * - `timeout <= 0`：调用方显式要「不超时」，不起定时器；
 * - 调用方自带 `signal`：两条中止路径合并（任一中止即中止），取消时摘掉监听器，
 *   不在调用方的 signal 上留悬挂监听。
 */
function createTimeoutSignal(
  timeoutMs: number,
  externalSignal: AbortSignal | null | undefined,
): { signal: AbortSignal | null | undefined; cancel: () => void; didTimeout: () => boolean; effectiveTimeout: number } {
  if (typeof AbortController === 'undefined') {
    return { signal: externalSignal, cancel: () => {}, didTimeout: () => false, effectiveTimeout: timeoutMs }
  }

  // 非有限值必须先归一，否则这个函数会精确地退回它要修的那个 bug：
  // - `NaN > 0` 为 false → 定时器根本不起，挂起请求永远不结束（= 改动前）；
  // - `Infinity > 0` 为 true → setTimeout 按规范把 Infinity 钳到 1ms，
  //   于是每次上报都在 ~1ms 后自我中止，批次被反复重入队直到按 maxFlushRetries 丢弃。
  // 配置常来自 parseInt(untrustedConfig) 一类输入，NaN 并不罕见；本仓库的容量类
  // 入参（normalizeCapacity / normalizeMaxRetries / setMaxLogSize）都有同一道守卫。
  const effectiveTimeout = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_FETCH_TIMEOUT_MS

  const controller = new AbortController()
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let detachExternal: (() => void) | undefined

  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason)
    } else {
      const onExternalAbort = (): void => controller.abort(externalSignal.reason)
      externalSignal.addEventListener('abort', onExternalAbort)
      detachExternal = () => externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }

  if (effectiveTimeout > 0) {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error(`HTTP report request timed out after ${effectiveTimeout}ms`))
    }, effectiveTimeout)
    // 与 ErrorMonitoring.delay 同口径：超时定时器不应拖住 Node 进程/测试 worker 退出
    const timerWithUnref = timer as unknown as { unref?: () => void }
    if (typeof timerWithUnref.unref === 'function') {
      timerWithUnref.unref()
    }
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    // 实际生效的值（含归一结果）：调用方拼超时文案必须用它，
    // 否则会出现「文案写 NaNms、实际按 10s 中止」这种对不上的错报
    effectiveTimeout,
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      detachExternal?.()
      detachExternal = undefined
    },
  }
}

/**
 * 补上 JSON 内容类型（调用方已自带时原样保留）
 *
 * 只在**默认请求实现**里做：`Content-Type` 属于「这条请求怎么发」的一部分，
 * 而注入的 `HttpRequestImpl` 自行决定请求形态（它可能把 body 转投到别处）。
 * 不兜底的后果很实在：fetch 对字符串 body 的默认值是 `text/plain;charset=UTF-8`，
 * 调用方一旦传入自定义 options（默认对象被整体替换、里头不再有 headers），
 * 服务端就会按 text/plain 拒收一份合法 JSON
 */
function withJsonContentType(headers: Record<string, string>): Record<string, string> {
  // 头名大小写不敏感：调用方写 content-type / CONTENT-TYPE 都算已配置
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === 'content-type') {
      return headers
    }
  }
  return { ...headers, 'Content-Type': JSON_CONTENT_TYPE }
}

/**
 * 把 payload 收成 JSON 可表示的值
 *
 * `ErrorContext.payload` 是 `unknown`，而请求体由 `JSON.stringify` 产出：BigInt 与循环引用
 * 会让 stringify 抛 TypeError，该 rejection 与网络失败无从区分，监控层会按 maxFlushRetries
 * 把一份**永远发不出去**的批次反复重入队（重试风暴 + 长期占满队列，连带挤掉正常错误）。
 * 故在投影阶段就降级为字符串标记：坏载荷只影响它自己那一条上下文，不再让整个批次 reject。
 * 「只影响它自己那一条」如今还有第二层兜底——每条上下文各自序列化一次（见 `serializeContextItem`），
 * 这里挡不住的（例如只在第二次取值才抛的非幂等 getter）只会让那一条换成标记片段
 */
function toSerializablePayload(payload: unknown): unknown {
  if (payload === undefined || payload === null) {
    return payload
  }
  const type = typeof payload
  // bigint / symbol / function 在 JSON 里要么直接抛、要么被静默丢弃，
  // 统一字符串化以保留诊断信息（String(symbol) 合法，`'' + symbol` 才会抛）
  if (type === 'bigint' || type === 'symbol' || type === 'function') {
    return `[${type} ${String(payload)}]`
  }
  if (type !== 'object') {
    return payload
  }
  try {
    // 只验证可序列化性、不替换原值：先串一遍再 parse 回来等于把整棵子树复制两遍
    JSON.stringify(payload)
    return payload
  } catch (error) {
    return `[Unserializable payload: ${error instanceof Error ? error.message : String(error)}]`
  }
}

/**
 * 把「按契约是标量」的字段（storeName / operation / level / timestamp）收成 JSON 安全值
 *
 * 这四个字段此前原样透传，而 `ErrorContext` 可由调用方手搓（见 `serializeContext` 的注释）：
 * `timestamp` 写成 BigInt（`process.hrtime.bigint()` / `wx.getPerformance` 一类计时器的返回值）、
 * `level` 写成 Symbol 时，`toSerializablePayload` 管不到它们，外层 `JSON.stringify` 直接抛
 * TypeError——而这一次抛错在**批次**层面，同批其余上下文一起陪葬。
 *
 * 与 payload 的分工：payload 可能带真实诊断结构，故「能串就原样保留」；这四个字段只用于展示，
 * 对象值没有保留价值（还带 getter/toJSON 的不确定性），一律降级成类型标记。
 */
function toSerializableScalar(value: unknown): string | number | boolean | null | undefined {
  if (value === undefined || value === null) {
    return value
  }
  // 收窄判定必须直接落在 value 上（对预先存好的 typeof 结果做比较不会窄化值本身）
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  const type = typeof value
  // bigint / symbol 直接进 JSON 会抛，String() 对两者都合法（`'' + symbol` 才会抛）
  if (type === 'bigint' || type === 'symbol') {
    return String(value)
  }
  return `[${type}]`
}

/**
 * 把 wx.request `fail` 回调的载荷描述成一句原因
 *
 * 平台给的是 `{ errMsg, errno }` 普通对象（如 `request:fail url not in domain list`、
 * `request:fail timeout`、`ERR_INTERNET_DISCONNECTED`），**永远不是** `Error` 实例。
 * 属性读取保持保护式：调用方注入的假 wx、以及跨 realm 的异常对象都可能给出任意形状
 */
function describeWxFailure(err: unknown): string {
  if (typeof err === 'string') {
    return err
  }
  if (typeof err !== 'object' || err === null) {
    return ''
  }
  const { errMsg, errno } = err as { errMsg?: unknown; errno?: unknown }
  const message = typeof errMsg === 'string' ? errMsg : ''
  const code = typeof errno === 'number' || typeof errno === 'string' ? String(errno) : ''
  if (message && code) {
    return `${message} (errno: ${code})`
  }
  return message || code
}

/**
 * wx.request 失败 → Error
 *
 * 直接把非 Error 载荷换成常量 `'wx.request failed'` 会把最需要的分类信息（域名白名单未配置 /
 * 无网络 / 超时）整笔丢掉，监控层只能把它当随机网络抖动按 maxFlushRetries 重入队。
 * 这里把 `errMsg`/`errno` 拼进消息，并按本库既有口径把原始载荷挂到 `cause`
 * （target/lib 为 ES2020，`Error` 构造器无 `cause` 选项签名，用属性赋值补，
 * 与 `ErrorRecovery.ts` 的 `withCause` 同一做法）
 */
function toWxRequestError(err: unknown): Error {
  if (err instanceof Error) {
    return err
  }
  const detail = describeWxFailure(err)
  const error = new Error(detail ? `wx.request failed: ${detail}` : 'wx.request failed')
  ;(error as Error & { cause?: unknown }).cause = err
  return error
}

/**
 * 构建默认 HTTP 请求实现
 *
 * 微信小程序无全局 fetch，直接使用会导致错误上报静默失败（仅 console.error），
 * 因此优先检测并适配 wx.request，其次回退到全局 fetch。
 *
 * 环境能力差异：wx.request 无 credentials/mode/keepalive 等概念（cookie 由平台
 * 自动携带），故 wx 分支仅生效 method/header/data/timeout，其余 RequestInit 字段
 * 被忽略；fetch 分支透传完整 RequestInit，并把 `timeout` 翻译为 AbortController 中止
 * （fetch 本身不认这个字段）。需要精确控制请求行为时注入自定义 requestImpl——
 * 此时中止语义由注入实现负责，见 {@link HttpReporterOptions} 的 timeout 说明。
 *
 * @param options - 构造函数传入的 {@link HttpReporterOptions} 配置
 */
function createDefaultRequest(options: HttpReporterOptions): HttpRequestImpl {
  const wxApi = (globalThis as { wx?: { request?: (options: unknown) => void } }).wx
  const request = wxApi?.request
  if (typeof request === 'function') {
    return (url, body, method, headers) =>
      new Promise<void>((resolve, reject) => {
        request({
          url,
          method: method as 'POST',
          header: withJsonContentType(headers),
          // 透传 timeout：缺 timeout 的挂起请求只能靠监控层 race 释放 flush，
          // wx.request 本体永不终止（泄漏平台请求资源）；未配置时不加键，保持既有调用形态。
          // 注意这里**没有** fetch 分支那样的默认值：wx.request 的 timeout 是平台原生字段，
          // 平台自身另有默认上限（小程序侧通常 60s 量级），由平台兜底即可；
          // 需要与 fetch 分支同口径（默认 10s）请显式传 timeout。
          // 非有限值同样归一——Infinity 会被平台/宿主钳成极短值，NaN 的行为未定义
          ...(options.timeout !== undefined ? { timeout: Number.isFinite(options.timeout) ? options.timeout : DEFAULT_FETCH_TIMEOUT_MS } : {}),
          // body 恒为 buildRequestBody 产出的 JSON 文本（JsonBody 品牌），字符串
          // 原样发送即可，无需 parse 后让 wx 再序列化一次
          data: body,
          // wx.request 的 success 回调在任何 HTTP 状态（含 4xx/5xx）都会触发，
          // 必须校验 statusCode，否则上报失败（服务端拒绝/鉴权失效）被当作成功静默丢失
          success: (res: { statusCode: number }) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve()
            } else {
              reject(new Error(`wx.request failed with HTTP ${res.statusCode}`))
            }
          },
          // wx 的 fail 载荷是 `{errMsg, errno}` 而不是 Error，恒走 toWxRequestError：
          // 域名未配置 / 超时 / 断网这些最需要分类的原因不能被换成常量字符串
          fail: (err: unknown) => reject(toWxRequestError(err)),
        })
      })
  }

  return async (url, body, method, headers) => {
    // 透传全部 RequestInit 配置；method/headers/body 以归一化后的上报参数为准。
    // signal 必须排在展开之后：既覆盖调用方可能给出的同名字段，也与 createTimeoutSignal
    // 合并了外部 signal 的中止语义。必须校验 ok：fetch 对 4xx/5xx 不 reject，
    // 不校验会把服务端拒绝当作上报成功
    const timeoutSignal = createTimeoutSignal(options.timeout ?? DEFAULT_FETCH_TIMEOUT_MS, options.signal)
    try {
      const response = (await fetch(url, {
        ...options,
        signal: timeoutSignal.signal,
        method,
        headers: withJsonContentType(headers),
        body,
      })) as unknown as {
        ok: boolean
        status: number
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
    } catch (error) {
      // fetch 的中止 rejection 是无信息的 DOMException（"The operation was aborted"），
      // 换成本次超时值：监控层只能拿到 Error 消息，分类与排障全靠它。
      // cause 用属性赋值补（target/lib 为 ES2020，Error 构造器无 cause 选项签名），
      // 与本文件 toWxRequestError 同一做法
      if (timeoutSignal.didTimeout()) {
        const timeoutError = new Error(`HTTP report request timed out after ${timeoutSignal.effectiveTimeout}ms`)
        ;(timeoutError as Error & { cause?: unknown }).cause = error
        throw timeoutError
      }
      throw error
    } finally {
      // 请求先落地时清掉未到期的超时定时器与外部 signal 监听，否则每次上报都残留一份
      timeoutSignal.cancel()
    }
  }
}

/**
 * HTTP错误报告器
 *
 * @class HttpReporter
 * @implements ErrorReporter
 * @description
 * 将错误通过HTTP发送到远程服务器。
 * 默认自动适配运行环境（小程序 wx.request / 浏览器 fetch），
 * 也可通过构造参数注入自定义请求实现。
 * 注意：环境能力差异见 createDefaultRequest —— wx 分支仅 method/header/data/timeout 生效。
 */
export class HttpReporter implements ErrorReporter {
  private readonly requestImpl: HttpRequestImpl

  constructor(
    private readonly endpoint: string,
    private readonly options: HttpReporterOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    },
    requestImpl?: HttpRequestImpl,
  ) {
    this.requestImpl = requestImpl ?? createDefaultRequest(this.options)
  }

  getName(): string {
    return 'http'
  }

  async report(context: ErrorContext): Promise<void> {
    await this.send(this.serializeContextItem(context))
  }

  async reportBatch(contexts: ErrorContext[]): Promise<void> {
    await this.send(this.serializeErrorBatch(contexts))
  }

  /**
   * 发出一次上报请求（单条与批量共用同一条传输路径）
   *
   * 失败一律向上抛出：ErrorMonitoring 的「全部报告器失败则重新入队重试」依赖
   * reportBatch reject 判定失败，此处吞错会让重试机制成为死代码，网络抖动/服务端 5xx
   * 时上报数据被静默丢弃。直接使用本类的调用方需自行 catch；内部批量管线
   * （doFlushReports）已对 rejection 兜底。两个入口若各写一遍参数拼装，
   * 调用签名变更时只会改到一处（另一处静默漂移），故收在这里
   */
  private async send(body: JsonBody): Promise<void> {
    await this.requestImpl(this.endpoint, body, this.options.method ?? 'POST', this.normalizeHeaders())
  }

  /**
   * 由**对象**产出一份请求体 JSON 文本
   *
   * `JSON.stringify` 作用于对象字面量时结果至少为 `'{}'`，据此把返回值收窄为
   * {@link JsonBody}，使下游解析不必再做空串防御。批量体另有
   * {@link buildBatchBody}（拼接已序列化片段，不重新序列化）
   */
  private buildRequestBody(payload: object): JsonBody {
    return JSON.stringify(payload) as JsonBody
  }

  /**
   * 单个 ErrorContext 的上报投影（**未**序列化）
   *
   * 单条与批量两条路径共用：两处各写一份字段映射时，新增/改名字段只会落到其中一条，
   * 服务端收到的单条与批量负载就会静默漂移。
   *
   * 本方法**允许抛错**（例如某字段是只在第二次取值才失效的非幂等 getter），
   * 兜底在 {@link serializeContextItem}；序列化口径见 {@link toSerializableScalar}
   * 与 {@link toSerializablePayload}。
   *
   * @private
   */
  private serializeContext(context: ErrorContext) {
    // `ErrorContext.error` 只是契约上的 Error：JS 允许 `throw null` / `throw 'msg'` /
    // 抛普通对象，上下文也可由调用方手搓交进来。裸读 `.message` 会让一条畸形上下文抛
    // TypeError，从而整个 reportBatch 一起 reject——同批其余上下文全部陪葬，
    // 且该批次永远重试不成功（监控层把它当网络失败反复重入队）
    const error = context?.error as { message?: unknown; stack?: unknown; name?: unknown } | null | undefined
    return {
      error: {
        // 非字符串抛值兜底为字符串化（与 defaultErrorHandler 的 describeErrorProperty 同口径），
        // 至少服务端拿得到原始失败的可读形态
        message: typeof error?.message === 'string' ? error.message : String(error ?? ''),
        stack: typeof error?.stack === 'string' ? error.stack : '',
        name: typeof error?.name === 'string' ? error.name : 'Error',
      },
      storeName: toSerializableScalar(context?.storeName),
      operation: toSerializableScalar(context?.operation),
      level: toSerializableScalar(context?.level),
      payload: toSerializablePayload(context?.payload),
      timestamp: toSerializableScalar(context?.timestamp),
    }
  }

  /**
   * 一条上下文的完整序列化结果（单条上报的 body、批量上报的一个片段）
   *
   * 「不可序列化」的防线到这里才算闭合：投影阶段挡得住 BigInt / 循环引用，但挡不住
   * 只在**第二次**取值才失效的非幂等 getter / `toJSON`（先验证串一遍、再把原值交给外层
   * 重串，两次之间没有任何保证）。故每条上下文各自序列化**一次**，并单独兜底：
   * 本条导致整体不可序列化时只把这一条换成标记片段，批次其余条目照常交付，
   * `reportBatch` 不因单条畸形而 reject（那会被监控层判成网络失败并按 maxFlushRetries
   * 重入队，最终把整批丢弃，且丢弃原因显示为「报告器恒失败」而非「这条上下文畸形」）
   */
  private serializeContextItem(context: ErrorContext): JsonBody {
    try {
      return this.buildRequestBody(this.serializeContext(context))
    } catch (error) {
      const reason = error instanceof Error && typeof error.message === 'string' ? error.message : ''
      // 标记片段本身只含字符串字面量，不可能再抛；原始原因留在 message 里供排查
      return this.buildRequestBody({
        error: {
          message: `[Unserializable error context${reason ? `: ${reason}` : ''}]`,
          stack: '',
          name: 'Error',
        },
      })
    }
  }

  private serializeErrorBatch(contexts: ErrorContext[]): JsonBody {
    // 非数组兜底与 ConsoleReporter.reportBatch 同口径：`contexts.map` 抛 TypeError 同样是
    // 「一整批失败」，而调用方（监控层重入队路径、手写调用）拿到的只是一个网络错
    const list = Array.isArray(contexts) ? contexts : []
    return this.buildBatchBody(list.map((ctx) => this.serializeContextItem(ctx)))
  }

  /**
   * 由**已序列化的条目片段**拼出批量请求体
   *
   * 刻意不走 `JSON.stringify({ errors: [...] })`：那会把每个条目**再序列化一次**，
   * 于是投影阶段「验证一遍 + 外层重串」之间的空档又回来了，一条畸形上下文就足以让
   * 整个批次 reject。每个片段都出自一次成功的 `JSON.stringify`（失败者已被换成标记片段），
   * 拼接结果因此必是合法 JSON
   */
  private buildBatchBody(items: string[]): JsonBody {
    return `{"errors":[${items.join(',')}]}` as JsonBody
  }

  /**
   * 将 RequestInit.headers 归一化为普通键值对象，
   * 兼容 Headers / string[][] / Record 三种形式
   *
   * @remarks 本方法只做**形式归一**、不注入任何头：JSON content-type 的兜底发生在
   * 默认请求实现里（见 `withJsonContentType`），因为「发不发这个头」属于传输细节，
   * 而注入的 `HttpRequestImpl` 自行决定请求形态
   */
  private normalizeHeaders(): Record<string, string> {
    const headers = this.options.headers
    if (!headers) return {}

    // 数组分支必须先于鸭子类型判定：Array.prototype.forEach 同样是函数，
    // 后置会让 string[][] 被当成 Headers 走 (value, key) 回调
    if (Array.isArray(headers)) {
      const result: Record<string, string> = {}
      for (const [key, value] of headers) {
        result[key] = value
      }
      return result
    }

    // 鸭子类型识别 Headers，而非比对全局构造器：小程序运行时无全局 Headers，
    // 跨 realm / polyfill 实例也 instanceof 不中；Headers 无自有可枚举属性，
    // 落到末尾的展开分支只会得到 `{}`，把 Authorization / Content-Type 静默丢空
    if (typeof (headers as Headers).forEach === 'function') {
      const result: Record<string, string> = {}
      ;(headers as Headers).forEach((value, key) => {
        result[key] = value
      })
      return result
    }

    return { ...(headers as Record<string, string>) }
  }
}
