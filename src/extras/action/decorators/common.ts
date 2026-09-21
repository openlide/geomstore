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
 * @remarks 返回值类型跟随被装饰方法：同步方法仍同步返回，异步（或返回 Promise）方法
 * 返回 Promise；`after` 在结果确定后触发，`onError` 在同步抛错或 Promise reject 时触发。
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

    // 访问器描述符（get/set）或 value 非函数：装饰无意义，早失败优于运行时
    // `originalMethod.apply is not a function`
    if (typeof originalMethod !== 'function') {
      throw new TypeError('[createDecorator] can only decorate a method whose descriptor.value is a function')
    }

    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      let result: unknown
      try {
        if (options.before) {
          options.before(...args)
        }
        result = originalMethod.apply(this, args)
      } catch (error) {
        if (options.onError) {
          options.onError(error as Error)
        }
        throw error
      }

      if (result instanceof Promise) {
        // 异步结果：after/onError 挂到结算之后，返回值仍是 Promise（不吞 rejection）
        return result.then(
          (value) => {
            if (options.after) {
              options.after(value)
            }
            return value
          },
          (error) => {
            if (options.onError) {
              options.onError(error as Error)
            }
            throw error
          },
        )
      }

      // 同步结果原样返回：此前无条件用 async 包装，同步方法的返回值会被变成 Promise，
      // 破坏 `const v = obj.method()` 这类按同步契约取值的调用方
      if (options.after) {
        options.after(result)
      }
      return result
    }

    // 保留原方法的 name/length：装饰器换实现时这两项元信息默认丢失，
    // 依赖 arity 或函数名的调用方（框架、日志、反射式装饰）会看到错误签名
    Object.defineProperty(wrapper, 'name', { value: originalMethod.name, configurable: true })
    Object.defineProperty(wrapper, 'length', { value: originalMethod.length, configurable: true })

    descriptor.value = wrapper

    return descriptor
  }
}
