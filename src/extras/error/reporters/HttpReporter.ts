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
 * 唯一产出方是 `HttpReporter#buildRequestBody`，其入参恒是**本模块自己构造的对象字面量**
 * （`serializeContext` 的投影 + `{ errors: [...] }`），故 `JSON.stringify` 的结果至少为
 * `'{}'`——它只在顶层值为 undefined（含顶层自带 `toJSON` 返回 undefined）时才返回
 * undefined，而这里顶层永远是对象，所以「body 恒为非空合法 JSON 文本」这一前提由类型
 * 而非注释承载。嵌套层的 `toJSON` 返回 undefined 只会让那个键被丢掉（数组元素则写成
 * `null`），body 仍是合法 JSON；会真正抛错的层（BigInt / 循环引用）已由
 * `toSerializablePayload` 在投影阶段挡掉。
 * wx.request 分支直接把该 JSON 字符串作为 data 发送（wx 对字符串 data 原样发送），免去
 * parse→再序列化往返；content-type 由 `withJsonContentType` 兜底为 application/json。
 * HttpRequestImpl 保持 string 签名以便外部注入实现自行反序列化。
 */
type JsonBody = string & { readonly __jsonBodyBrand: 'JsonBody' }

/**
 * HttpReporter 构造配置：标准 RequestInit 之外增加 `timeout`。
 *
 * fetch 规范无请求超时字段，小程序 wx.request 却有原生 `timeout`；不显式建模的话
 * 调用方只能靠 as 断言传入、且 wx 分支透传与否无从谈起。非小程序环境下 timeout
 * 作为未知键随 `{ ...options }` 进入 fetch 初始化并被忽略，无副作用
 */
export interface HttpReporterOptions extends RequestInit {
  /** 请求超时毫秒数（仅 wx.request 分支生效；fetch 分支请用 AbortController/外部实现） */
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
 * 故在投影阶段就降级为字符串标记：坏载荷只影响它自己那一条上下文，不再让整个批次 reject
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
 * 构建默认 HTTP 请求实现
 *
 * 微信小程序无全局 fetch，直接使用会导致错误上报静默失败（仅 console.error），
 * 因此优先检测并适配 wx.request，其次回退到全局 fetch。
 *
 * 环境能力差异：wx.request 无 credentials/mode/keepalive 等概念（cookie 由平台
 * 自动携带），故 wx 分支仅生效 method/header/data/timeout，其余 RequestInit 字段
 * 被忽略；fetch 分支透传完整 RequestInit。需要精确控制请求行为时注入自定义 requestImpl。
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
          // wx.request 本体永不终止（泄漏平台请求资源）；未配置时不加键，
          // 保持既有调用形态
          ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
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
          fail: (err: unknown) => reject(err instanceof Error ? err : new Error('wx.request failed')),
        })
      })
  }

  return async (url, body, method, headers) => {
    // 透传全部 RequestInit 配置；method/headers/body 以归一化后的上报参数为准。
    // 必须校验 ok：fetch 对 4xx/5xx 不 reject，不校验会把服务端拒绝当作上报成功
    const response = (await fetch(url, { ...options, method, headers: withJsonContentType(headers), body })) as unknown as {
      ok: boolean
      status: number
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
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
    await this.send(this.serializeErrorMessage(context))
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
   * 构造上报请求体（唯一的 body 产出点）。
   *
   * `JSON.stringify` 作用于对象字面量时结果至少为 `'{}'`，据此把返回值收窄为
   * {@link JsonBody}，使下游解析不必再做空串防御。
   */
  private buildRequestBody(payload: object): JsonBody {
    return JSON.stringify(payload) as JsonBody
  }

  /**
   * 单个 ErrorContext 的上报投影
   *
   * 单条与批量两条路径共用：两处各写一份字段映射时，新增/改名字段只会落到其中一条，
   * 服务端收到的单条与批量负载就会静默漂移。
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
      storeName: context?.storeName,
      operation: context?.operation,
      level: context?.level,
      payload: toSerializablePayload(context?.payload),
      timestamp: context?.timestamp,
    }
  }

  private serializeErrorMessage(context: ErrorContext): JsonBody {
    return this.buildRequestBody(this.serializeContext(context))
  }

  private serializeErrorBatch(contexts: ErrorContext[]): JsonBody {
    return this.buildRequestBody({ errors: contexts.map((ctx) => this.serializeContext(ctx)) })
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
