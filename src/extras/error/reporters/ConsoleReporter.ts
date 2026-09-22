/**
 * GeomStore - 控制台错误报告器
 *
 * 自 ErrorMonitoring.ts 拆出：将错误输出到控制台，用于开发环境。
 *
 * @module extras/error/reporters/ConsoleReporter
 */

import type { ErrorContext, ErrorReporter } from '../../../types/error.js'

/**
 * console.group/groupEnd 特性检测：
 * 微信小程序真机基础库的 console 不提供分组方法，
 * 直接调用会抛 TypeError 导致报告静默失败，需降级为平铺输出。
 * 延迟到调用时求值（而非模块加载时），兼容测试环境对 console 的动态 stub。
 *
 * 注意：typeof 判定只覆盖「API 缺失」，覆盖不到「API 存在但调用即抛」的占位实现，
 * 故调用点另有 try/catch 试探（见 `ConsoleReporter.runGrouped`）。
 */
function consoleSupportsGroup(): boolean {
  return typeof console.group === 'function' && typeof console.groupEnd === 'function'
}

/** 级别标签：字段缺失或不是字符串时给占位值，避免 `undefined.toUpperCase()` 抛错顶替被报告的错误 */
function levelLabel(level: unknown): string {
  return typeof level === 'string' && level.length > 0 ? level.toUpperCase() : 'UNKNOWN'
}

/**
 * 时间戳格式化为 ISO 串
 *
 * 缺省取当前时间；非有限值或超出 `Date` 可表示范围（`new Date(1e20)` 是
 * Invalid Date，`toISOString()` 会抛 RangeError）同样回退当前时间。
 */
function formatTimestamp(timestamp: unknown): string {
  const value = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : Date.now()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

/**
 * 控制台错误报告器（开发环境首选）
 *
 * 按级别将错误信息输出到 console；在缺少 `console.group` 的基础库上
 * 自动降级为平铺输出，保证报告不因 API 缺失而失败。
 *
 * 失败传播是有意为之：本报告的输出若抛错（自定义 console、被 stub 的
 * `console.error`），异常向上交给 `ErrorMonitoring.doFlushReports`，由其折成
 * 「该报告器 fail」并让整批重新入队重试。此处静默吞掉的话，管线会把
 * 「一条都没落地」判成上报成功并丢弃批次（见其 `anyReporterSucceeded` 分支）。
 */
export class ConsoleReporter implements ErrorReporter {
  /**
   * 分组能力是否已在本次运行中被证实不可用
   *
   * `console.group` 存在但调用即抛的运行时（占位实现）只试探一次，
   * 之后直接走平铺路径；按实例记录，避免一个报告器的探测结果污染其他实例。
   */
  private groupUnavailable = false

  /**
   * @param prefix 日志前缀，默认 `[ErrorMonitoring]`
   */
  constructor(private readonly prefix: string = '[ErrorMonitoring]') {}

  getName(): string {
    return 'console'
  }

  async report(context: ErrorContext): Promise<void> {
    const header = `${this.prefix} ${levelLabel(context?.level)}`
    this.runGrouped(
      header,
      (decorate) => this.printContext(context, decorate),
      () => this.printContext(context, (label) => `${header} ${label}`),
    )
  }

  async reportBatch(contexts: ErrorContext[]): Promise<void> {
    const list = Array.isArray(contexts) ? contexts : []
    const header = `${this.prefix} Batch Report (${list.length} errors)`
    this.runGrouped(
      header,
      () => list.forEach((ctx, index) => this.printBatchEntry(ctx, index)),
      () => {
        console.error(header)
        list.forEach((ctx, index) => this.printBatchEntry(ctx, index))
      },
    )
  }

  /**
   * 以分组方式执行 `grouped`，不具备分组能力（缺失或调用即抛）时执行 `flat`
   *
   * 组必须闭合：组内输出抛错时少一次 `groupEnd` 会让后续所有输出留在已打开的
   * 分组里，故闭合放在 finally；`grouped` 的异常本身继续向外传播（见类文档）。
   *
   * @param decorate 标签装饰器，分组路径原样输出（`'Error:'`），
   *        平铺路径由调用方加上头部信息（`'[prefix] ERROR Error:'`）
   * @private
   */
  private runGrouped(header: string, grouped: (decorate: (label: string) => string) => void, flat: () => void): void {
    if (!this.groupUnavailable && consoleSupportsGroup()) {
      let opened = false
      try {
        console.group(header)
        opened = true
      } catch {
        // 存在但不可用（占位实现）：记住结论，本次与后续都降级平铺
        this.groupUnavailable = true
      }
      if (opened) {
        try {
          grouped((label) => label)
        } finally {
          console.groupEnd()
        }
        return
      }
    }

    // 降级：无分组能力时平铺输出同样信息
    flat()
  }

  /**
   * 输出一条错误上下文的全部字段
   *
   * 分组与平铺两条路径共用同一份实现（此前复制了四遍，改格式要同步四处且已出现
   * 级别大小写漂移）。
   *
   * @private
   */
  private printContext(context: ErrorContext, decorate: (label: string) => string): void {
    console.error(decorate('Error:'), context?.error)
    console.error(decorate('Store:'), context?.storeName)
    console.error(decorate('Operation:'), context?.operation)
    if (context?.payload) {
      console.error(decorate('Payload:'), context.payload)
    }
    console.error(decorate('Timestamp:'), formatTimestamp(context?.timestamp))
  }

  /**
   * 输出批量报告中的一条（分组与平铺路径同格式）
   *
   * @private
   */
  private printBatchEntry(context: ErrorContext, index: number): void {
    console.error(`[${index + 1}] ${levelLabel(context?.level)} in ${String(context?.storeName)}:`, context?.error)
  }
}
