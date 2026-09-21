/**
 * GeomStore - 超时装饰器
 *
 * 在指定时间内完成方法执行，超时则抛出错误
 *
 */

import { raceWithTimeout, normalizeTimeout } from '../async-core.js'

/**
 * 创建超时装饰器
 *
 * 在指定时间内完成方法执行，超时则抛出错误
 *
 * 注意：使用 Promise.race 实现，超时后底层异步任务不会被真正取消（仍会继续执行），
 * 仅是调用方提前得到超时拒绝。如需真正中断，请在被装饰的方法内部实现 AbortController
 * 等取消机制。超时抛出的错误不保证底层任务已清理。
 *
 * @param {number} [timeout=5000] - 超时时间（毫秒，必须为大于 0 的有限数值）
 * @returns {MethodDecorator} 方法装饰器
 * @throws {RangeError} timeout 非法（在装饰器工厂调用时就抛出，而不是等到方法执行）
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
  // 装饰阶段即校验：0/负数会让被装饰方法必然超时，NaN 被 setTimeout 当作 0、
  // Infinity 被宿主钳制为 1ms，三者都会以「与真实原因无关的即时失败」暴露给调用方
  const delay = normalizeTimeout(timeout, 'withTimeout')

  return function (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value

    // 访问器描述符（get/set）的 value 是 undefined：晚到失败只会抛出
    // `originalMethod.apply is not a function`，故在装饰阶段拒绝
    if (typeof originalMethod !== 'function') {
      throw new TypeError('[withTimeout] can only decorate a method, but the descriptor.value is not a function')
    }

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      // 复用公共内核，与 AsyncActionSupport.executeWithTimeout 同一实现
      return raceWithTimeout(Promise.resolve(originalMethod.apply(this, args)), delay, `Timeout after ${timeout}ms`)
    }

    return descriptor
  }
}
