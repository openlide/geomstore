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
 * 解析端（wx.request 适配器的 data 字段）可直接 `JSON.parse`，无需空串兜底分支。
 */
type JsonBody = string & { readonly __jsonBodyBrand: 'JsonBody' }

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
 * @param options - 构造函数传入的 RequestInit 配置（fetch 分支需完整透传，
 *   避免 credentials/mode/keepalive 等配置被静默丢弃）
 */
function createDefaultRequest(options: RequestInit): HttpRequestImpl {
  const wxApi = (globalThis as { wx?: { request?: (options: unknown) => void } }).wx
  const request = wxApi?.request
  if (typeof request === 'function') {
    return (url, body, method, headers) =>
      new Promise<void>((resolve, reject) => {
        request({
          url,
          method: method as 'POST',
          header: headers,
          // body 只可能来自 HttpReporter#buildRequestBody（JsonBody：非空合法 JSON），
          // 故此处直接解析；HttpRequestImpl 保持 string 以便外部注入实现
          data: JSON.parse(body),
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
 */
export class HttpReporter implements ErrorReporter {
  private readonly requestImpl: HttpRequestImpl

  constructor(
    private readonly endpoint: string,
    private readonly options: RequestInit = {
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

  private serializeErrorMessage(context: ErrorContext): JsonBody {
    return this.buildRequestBody({
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
    })
  }

  private serializeErrorBatch(contexts: ErrorContext[]): JsonBody {
    return this.buildRequestBody({
      errors: contexts.map((ctx) => ({
        error: {
          message: ctx.error.message || '',
          stack: ctx.error.stack || '',
          name: ctx.error.name || '',
        },
        storeName: ctx.storeName,
        operation: ctx.operation,
        level: ctx.level,
        payload: ctx.payload,
        timestamp: ctx.timestamp,
      })),
    })
  }

  /**
   * 将 RequestInit.headers 归一化为普通键值对象，
   * 兼容 Headers / string[][] / Record 三种形式
   */
  private normalizeHeaders(): Record<string, string> {
    const headers = this.options.headers
    if (!headers) return {}

    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      const result: Record<string, string> = {}
      headers.forEach((value, key) => {
        result[key] = value
      })
      return result
    }

    if (Array.isArray(headers)) {
      const result: Record<string, string> = {}
      for (const [key, value] of headers) {
        result[key] = value
      }
      return result
    }

    return { ...(headers as Record<string, string>) }
  }
}
