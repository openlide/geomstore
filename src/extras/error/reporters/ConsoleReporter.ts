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
 */
function consoleSupportsGroup(): boolean {
  return typeof console.group === 'function' && typeof console.groupEnd === 'function'
}

/**
 * 控制台错误报告器（开发环境首选）
 *
 * 按级别将错误信息输出到 console；在缺少 `console.group` 的基础库上
 * 自动降级为平铺输出，保证报告不因 API 缺失而失败。
 */
export class ConsoleReporter implements ErrorReporter {
  /**
   * @param prefix 日志前缀，默认 `[ErrorMonitoring]`
   */
  constructor(private readonly prefix: string = '[ErrorMonitoring]') {}

  getName(): string {
    return 'console'
  }

  async report(context: ErrorContext): Promise<void> {
    if (consoleSupportsGroup()) {
      console.group(`${this.prefix} ${context.level.toUpperCase()}`)
      try {
        console.error('Error:', context.error)
        console.error('Store:', context.storeName)
        console.error('Operation:', context.operation)
        if (context.payload) {
          console.error('Payload:', context.payload)
        }
        console.error('Timestamp:', new Date(context.timestamp ?? Date.now()).toISOString())
      } finally {
        // 组必须闭合：console.error 抛错（自定义 console/被 stub 的测试环境）时
        // 少一次 groupEnd 会让后续所有输出留在已打开的分组里
        console.groupEnd()
      }
      return
    }

    // 降级：无分组能力时平铺输出同样信息
    const header = `${this.prefix} ${context.level.toUpperCase()}`
    console.error(`${header} Error:`, context.error)
    console.error(`${header} Store:`, context.storeName)
    console.error(`${header} Operation:`, context.operation)
    if (context.payload) {
      console.error(`${header} Payload:`, context.payload)
    }
    console.error(`${header} Timestamp:`, new Date(context.timestamp ?? Date.now()).toISOString())
  }

  async reportBatch(contexts: ErrorContext[]): Promise<void> {
    if (consoleSupportsGroup()) {
      console.group(`${this.prefix} Batch Report (${contexts.length} errors)`)
      try {
        contexts.forEach((ctx, index) => {
          console.error(`[${index + 1}] ${ctx.level} in ${ctx.storeName}:`, ctx.error)
        })
      } finally {
        console.groupEnd()
      }
      return
    }

    // 降级：无分组能力时平铺输出同样信息
    console.error(`${this.prefix} Batch Report (${contexts.length} errors)`)
    contexts.forEach((ctx, index) => {
      console.error(`[${index + 1}] ${ctx.level} in ${ctx.storeName}:`, ctx.error)
    })
  }
}
