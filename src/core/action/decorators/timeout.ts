/**
 * GeomStore v1.0 - 超时装饰器
 *
 * 在指定时间内完成方法执行，超时则抛出错误
 *
 * @since 1.0.0
 */

/**
 * 创建超时装饰器
 *
 * 在指定时间内完成方法执行，超时则抛出错误
 *
 * 注意：使用 Promise.race 实现，超时后底层异步任务不会被真正取消（仍会继续执行），
 * 仅是调用方提前得到超时拒绝。如需真正中断，请在被装饰的方法内部实现 AbortController
 * 等取消机制。超时抛出的错误不保证底层任务已清理。
 *
 * @param {number} [timeout=5000] - 超时时间（毫秒）
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class NetworkComponent {
 *   @withTimeout(5000) // 5秒超时
 *   async fetchData(url: string) {
 *     return await fetch(url).then(r => r.json())
 *   }
 * }
 *
 * try {
 *   const data = await networkComponent.fetchData('/api/data')
 * } catch (error) {
 *   if (error.message.includes('Timeout')) {
 *     console.error('Request timed out')
 *     showTimeoutMessage()
 *   }
 * }
 * ```
 */
export function withTimeout(timeout: number = 5000): MethodDecorator {
  return function (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          originalMethod.apply(this, args),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
          }),
        ])
      } finally {
        // 无论方法先完成还是超时，都清除定时器，
        // 避免高频调用 + 长超时场景下定时器句柄积压
        if (timer !== undefined) {
          clearTimeout(timer)
        }
      }
    }

    return descriptor
  }
}
