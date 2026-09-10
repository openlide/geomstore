/**
 * GeomStore - 装饰器公共函数
 *
 */

/**
 * async 函数原型引用
 *
 * 判别异步性的依据：`fn.constructor.name === 'AsyncFunction'` 在压缩 mangle 后失效
 * （name 被改写），改比较原型对象身份——压缩不会改变原型引用。
 * @private
 */
/* istanbul ignore next -- 空箭头函数体永不执行，仅用于获取原型引用 */
const ASYNC_FUNCTION_PROTOTYPE = Object.getPrototypeOf(async () => {})

/**
 * 判断方法是否为 `async` 语法声明的函数（压缩安全）
 *
 * 由 withThrottle / withCache 等需要「保持返回类型一致」的装饰器共用，
 * 避免各文件重复定义同一原型常量。
 *
 * @param fn 待判定的函数
 * @returns 是 `async` 语法函数时为 true
 *
 * @remarks 本判定只看**语法**：非 async 但返回 Promise 的方法（包装函数、手写 thenable）
 * 会判为 false。装饰器另以「运行时观测首次调用结果」兜底（observesPromise），
 * 并对「首次调用即被抑制、无从观测」的场景提供 `assumeAsync` 选项显式声明。
 */
export function isAsyncFunction(fn: unknown): boolean {
  return typeof fn === 'function' && Object.getPrototypeOf(fn) === ASYNC_FUNCTION_PROTOTYPE
}

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
 *     console.log('[Audit] Action completed with result:', result)
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
