/**
 * GeomStore - 装饰器公共函数
 *
 */

import { toError } from '../async-core.js'
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
 * 跨 realm（iframe/worker）创建的 async 函数与本 realm 的 `AsyncFunction.prototype`
 * 不是同一个对象，同样落回该兜底；误判代价只是被抑制的调用少返回一个 Promise，
 * 不会返回错误结果。（`asyncFn.bind(ctx)` **不**在此列：按规范 BoundFunctionCreate 取目标
 * realm 的 %AsyncFunction.prototype% 作原型，实测仍判为异步。）
 */
export function isAsyncFunction(fn: unknown): boolean {
  if (typeof fn !== 'function') {
    return false
  }
  // getPrototypeOf 本身可抛：`Proxy` 的 getPrototypeOf 陷阱可以随意抛错。
  // 本函数在装饰器求值与调用路径上被复用，为它崩掉整个方法不划算，
  // 抛错时按「判不出异步性」降级，交给上面的 observesPromise / assumeAsync 兜底
  try {
    return Object.getPrototypeOf(fn) === ASYNC_FUNCTION_PROTOTYPE
  } catch {
    return false
  }
}

/**
 * 装饰器选项
 *
 * @remarks 三个回调都可以写成 `async`（TS 允许 async 函数满足 `=> void` 签名）：
 * `before` 返回 Promise 时整次调用降级为异步，被装饰方法一定等它 settle 之后才执行，
 * 其 rejection 走 `onError`；`after` 返回 Promise 时只有在被装饰方法本身是异步时才会被
 * 等待（同步方法必须保持同步返回，此时该 Promise 的 rejection 记日志并按 `onError` 上报，
 * 不外抛）。任一回调抛错/拒绝都会先经 `onError` 再按原有语义传播。
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
 * 带 then 函数的对象：用户自带 thenable 同样要等，不能只认 Promise 实例
 *
 * 装饰器族（createDecorator / withThrottle / withCache ...）判定「这次调用是不是异步」
 * 的统一依据。`instanceof Promise` 会漏掉手写 thenable 与跨 realm（iframe / worker /
 * ESM+CJS 双实例）的 Promise，漏判的直接后果是 rejection 没人接、变成 unhandledRejection。
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return false
  }
  // 读 `.then` 本身就是用户代码可执行的入口：`Proxy` 的 get 陷阱、抛错的访问器都能让
  // 它炸掉。本函数在每次调用的路径上拿被装饰方法/回调的返回值来判定，为它崩掉业务调用
  // 不划算，故与 isAsyncFunction 同口径：抛错按「非 thenable」降级
  try {
    return typeof (value as PromiseLike<unknown>).then === 'function'
  } catch {
    return false
  }
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
 * 三个回调（`before`/`after`/被装饰方法）自身的失败都会先经 `onError` 再按原样传播，
 * 失败观测口径一致。`before`/`after` 返回 Promise 时按 {@link DecoratorOptions} 的约定
 * 接续，不会并发执行、也不会留下 unhandled rejection；`onError` 自身抛错不会顶替原始失败。
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

    /** 把抛出的值交给 onError，并保证回调自身的异常不顶替原始失败 */
    const reportError = (error: unknown): void => {
      if (!options.onError) {
        return
      }
      try {
        options.onError(toError(error))
      } catch (callbackError) {
        console.error('[Action] onError callback threw:', callbackError)
      }
    }

    /**
     * 触发 after 并处理其返回的 Promise
     *
     * @param awaitTail - 异步路径为 true（把尾随 Promise 接回返回值）；同步路径为 false，
     * 此时不能改判为 Promise 返回（会破坏同步契约），只能就地兜住 rejection
     */
    const callAfter = (result: unknown, awaitTail: boolean): unknown => {
      if (!options.after) {
        return result
      }

      let afterResult: unknown
      try {
        afterResult = options.after(result)
      } catch (error) {
        // after 的同步抛错此前绕过了 onError：与 before 抛错、方法本体抛错的口径不一致
        // （文档声明「同步抛错走 onError」）。补一次上报，抛出行为本身不变
        reportError(error)
        throw error
      }
      if (!isThenable(afterResult)) {
        return result
      }
      const tail = Promise.resolve(afterResult).then(() => result)
      // after 返回 rejected Promise 也要被 onError 观测到（此前完全静默）。挂在派生
      // promise 上的这个 catch 只负责上报与消除全局告警：awaitTail 时调用方拿到的
      // 仍是 tail 本身，拒绝语义原样保留
      void tail.catch((error) => {
        reportError(error)
        if (!awaitTail) {
          // 同步方法不能改判为 Promise 返回，这条拒绝无处传给调用方，只能就地留痕
          console.error('[Action] async after callback rejected:', error)
        }
      })

      return awaitTail ? tail : result
    }

    const wrapper = function (this: unknown, ...args: unknown[]): unknown {
      /** 执行被装饰方法并接上 after/onError */
      const invokeOriginal = (): unknown => {
        let result: unknown
        try {
          result = originalMethod.apply(this, args)
        } catch (error) {
          reportError(error)
          throw error
        }

        if (isThenable(result)) {
          // 异步结果：after/onError 挂到结算之后，返回值仍是 Promise（不吞 rejection）
          return Promise.resolve(result).then(
            (value) => callAfter(value, true),
            (error) => {
              reportError(error)
              throw error
            },
          )
        }

        // 同步结果原样返回：此前无条件用 async 包装，同步方法的返回值会被变成 Promise，
        // 破坏 `const v = obj.method()` 这类按同步契约取值的调用方
        return callAfter(result, false)
      }

      if (options.before) {
        let beforeResult: unknown
        try {
          beforeResult = options.before(...args)
        } catch (error) {
          reportError(error)
          throw error
        }

        // before 是 async 回调时，TS 的 `=> void` 签名挡不住它：不接续就会与被装饰方法
        // 并发执行（违背「执行前」语义），其 rejection 还会变成 unhandled rejection
        if (isThenable(beforeResult)) {
          return Promise.resolve(beforeResult).then(
            () => invokeOriginal(),
            (error) => {
              reportError(error)
              throw error
            },
          )
        }
      }

      return invokeOriginal()
    }

    // 保留原方法的 name/length：装饰器换实现时这两项元信息默认丢失，
    // 依赖 arity 或函数名的调用方（框架、日志、反射式装饰）会看到错误签名
    Object.defineProperty(wrapper, 'name', { value: originalMethod.name, configurable: true })
    Object.defineProperty(wrapper, 'length', { value: originalMethod.length, configurable: true })

    descriptor.value = wrapper

    return descriptor
  }
}
