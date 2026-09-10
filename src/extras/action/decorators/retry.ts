/**
 * GeomStore - 重试装饰器
 *
 * 在方法失败时自动重试，支持指数退避和条件重试
 *
 */

import { retryWithBackoff } from '../async-core.js'

/**
 * 重试装饰器选项
 */
export interface RetryDecoratorOptions {
  /** 最大重试次数 */
  retries?: number
  /** 基础重试延迟（毫秒） */
  delay?: number
  /** 判断是否应该重试的函数 */
  shouldRetry?: (error: Error) => boolean
}

/**
 * 创建重试装饰器
 *
 * 在方法失败时自动重试，支持指数退避和条件重试
 *
 * @param {RetryDecoratorOptions} [options={}] - 重试选项
 * @param {number} [options.retries=3] - 最大重试次数
 * @param {number} [options.delay=100] - 基础重试延迟（毫秒）
 * @param {(error: Error) => boolean} [options.shouldRetry] - 判断是否应该重试的函数
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class NetworkComponent {
 *   // 网络错误时重试，最多3次
 *   @withRetry({
 *     retries: 3,
 *     delay: 1000,
 *     shouldRetry: (error) => {
 *       // 只重试网络错误和超时错误
 *       return (
 *         error.message.includes('network') ||
 *         error.message.includes('timeout')
 *       )
 *     }
 *   })
 *   async fetchData(url: string) {
 *     return await fetch(url).then(r => r.json())
 *   }
 * }
 * ```
 */
export function withRetry(options: RetryDecoratorOptions = {}): MethodDecorator {
  const { retries = 3, delay = 100, shouldRetry } = options

  return function (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      // 复用公共内核，与 AsyncActionSupport.executeWithRetry 同一实现，避免退避语义漂移
      return retryWithBackoff(() => originalMethod.apply(this, args), { retries, delay, shouldRetry })
    }

    return descriptor
  }
}
