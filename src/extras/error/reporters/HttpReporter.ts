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
 * 唯一产出方是 `HttpReporter#buildRequestBody`，其实现为 `JSON.stringify(对象字面量)`，
 * 结果至少为 `'{}'` —— 因此「body 恒为非空合法 JSON 文本」这一前提由类型而非注释承载：
 * wx.request 分支直接把该 JSON 字符串作为 data 发送（wx 对字符串 data 原样发送，且
 * content-type 默认即 application/json），免去 parse→再序列化往返。HttpRequestImpl 保持
 * string 签名以便外部注入实现自行反序列化。
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
 */
export type HttpRequestImpl = (url: string, body: string, method: string, headers: Record<string, string>) => Promise<void>

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
          header: headers,
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
    const response = (await fetch(url, { ...options, method, headers, body })) as unknown as { ok: boolean; status: number }
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
    // 失败必须向上抛出：ErrorMonitoring 的「全部报告器失败则重新入队重试」
    // 依赖 reportBatch reject 判定失败，此处吞错会让重试机制成为死代码，
    // 网络抖动/服务端 5xx 时上报数据被静默丢弃。直接使用本类的调用方
    // 需自行 catch；内部批量管线（doFlushReports）已对 rejection 兜底
    await this.requestImpl(this.endpoint, this.serializeErrorMessage(context), this.options.method ?? 'POST', this.normalizeHeaders())
  }

  async reportBatch(contexts: ErrorContext[]): Promise<void> {
    // 同 report：失败向上抛出以驱动重试机制
    await this.requestImpl(this.endpoint, this.serializeErrorBatch(contexts), this.options.method ?? 'POST', this.normalizeHeaders())
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
    return {
      error: {
        message: context.error.message || '',
        stack: context.error.stack || '',
        name: context.error.name || '',
      },
      storeName: context.storeName,
      operation: context.operation,
      level: context.level,
      payload: context.payload,
      timestamp: context.timestamp,
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
