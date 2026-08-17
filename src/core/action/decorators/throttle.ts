/**
 * GeomStore v1.0 - 节流装饰器
 *
 * 限制方法在指定时间间隔内只能执行一次
 *
 * 修复说明：原实现将 lastCall 声明在工厂函数作用域，导致同一装饰器装饰的
 * 所有方法/实例共享同一份状态（闭包陷阱）。现改为按宿主对象（this）隔离。
 *
 * @since 1.0.0
 */

/**
 * 创建节流装饰器
 *
 * 限制方法在指定时间间隔内只能执行一次
 * 适用于滚动、resize等高频触发事件
 *
 * @param {number} [interval=300] - 执行间隔（毫秒）
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class ScrollComponent {
 *   @withThrottle(100)
 *   async handleScroll() {
 *     return await updateScrollPosition()
 *   }
 * }
 *
 * // 即使滚动事件高频触发，每100ms最多执行一次handleScroll
 * ```
 */
export function withThrottle(interval: number = 300): MethodDecorator {
  // 按宿主对象隔离上次调用时间，避免多实例共享。
  const lastCallMap = new WeakMap<object, number>()

  return function (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value
    // 静态判别原方法异步性（tsc 产物可靠）；首次实际执行后以运行时观测为准，
    // 兜底非 async 但返回 Promise 的方法（如 `return fetch(...)`）被节流跳过的语义
    const isAsyncMethod = originalMethod.constructor.name === 'AsyncFunction'
    let observesPromise = false

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const now = Date.now()

      // 宿主不是对象时，使用本地变量兜底（不跨调用串扰）
      let lastCall = 0
      if (typeof this === 'object' && this !== null) {
        lastCall = lastCallMap.get(this) ?? 0
      }

      if (now - lastCall >= interval) {
        if (typeof this === 'object' && this !== null) {
          lastCallMap.set(this, now)
        }
        const result = originalMethod.apply(this, args)
        if (result instanceof Promise) {
          observesPromise = true
        }
        return result
      } else {
        // 节流跳过：不执行原方法，按方法实际语义返回空值
        return isAsyncMethod || observesPromise ? Promise.resolve(undefined) : undefined
      }
    }

    return descriptor
  }
}
