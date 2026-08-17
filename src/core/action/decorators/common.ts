/**
 * GeomStore v1.0 - 装饰器公共函数
 *
 * @since 1.0.0
 */

/**
 * 装饰器选项
 */
export interface DecoratorOptions {
  /** 执行前的回调 */
  before?: (...args: unknown[]) => void
  /** 执行成功后的回调 */
  after?: (result: unknown) => void
  /** 执行失败的回调 */
  onError?: (error: Error) => void
}

/**
 * 创建Action装饰器
 *
 * 创建一个通用装饰器，可以在Action执行前后执行自定义逻辑
 *
 * @static
 * @param {DecoratorOptions} [options={}] - 装饰器选项
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * const auditDecorator = createDecorator({
 *   before: (...args) => {
 *     console.log('[Audit] Action called with:', args)
 *   },
 *   after: (result) => {
 *     console.log('[Audit] Action completed:', result)
 *   },
 *   onError: (error) => {
 *     console.error('[Audit] Action failed:', error)
 *   }
 * })
 *
 * class MyComponent {
 *   @auditDecorator
 *   async loadData(id: string) {
 *     return await fetchData(id)
 *   }
 * }
 * ```
 */
export function createDecorator(options: DecoratorOptions = {}): MethodDecorator {
  return function (_target: unknown, _propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      try {
        if (options.before) {
          options.before(...args)
        }

        const result = await originalMethod.apply(this, args)

        if (options.after) {
          options.after(result)
        }

        return result
      } catch (error) {
        if (options.onError) {
          options.onError(error as Error)
        }
        throw error
      }
    }

    return descriptor
  }
}
