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
  /**
   * 首次执行之外的最大重试次数（总尝试次数 = retries + 1），默认 3
   *
   * 非有限值/负数/小数在内核里归一到非负整数（即「只执行一次」），不会是无限重试
   */
  retries?: number
  /** 基础重试延迟（毫秒） */
  delay?: number
  /**
   * 判断是否应该重试的函数
   *
   * 入参恒为 `Error`：非 Error 的抛出值（`throw 'boom'` / `throw { code }`）在传给本函数前
   * 已由内核 `toError` 规范化，可安全读 `error.message`/`stack`；向外抛出的仍是原始值
   */
  shouldRetry?: (error: Error) => boolean
}

/**
 * 创建重试装饰器
 *
 * 在方法失败时自动重试，支持指数退避和条件重试
 *
 * @param {RetryDecoratorOptions} [options={}] - 重试选项
 * @param {number} [options.retries=3] - 首次执行之外的最大重试次数（总尝试 = retries + 1）
 * @param {number} [options.delay=100] - 基础重试延迟（毫秒），第 n 次重试等待 `delay * 2^(n-1)`
 * @param {(error: Error) => boolean} [options.shouldRetry] - 判断是否应该重试的函数
 * @returns {MethodDecorator} 方法装饰器
 *
 * @remarks 与 `ActionExecutor.executeWithRetry` 共用 `retryWithBackoff` 内核，退避与
 * 错误规范化语义一致；选项面**不**等价：本装饰器只暴露 retries/delay/shouldRetry，
 * 内核的 `onRetry`（每次重试前回调）目前只由 `ActionExecutor.executeWithRetry` 入口提供。
 * 需要逐次重试的通知，请在 `shouldRetry` 里自行计数或改用执行器入口。
 *
 * @remarks **返回类型会变**：包装函数是 `async`，原本同步返回 `T` 的方法装饰后返回
 * `Promise<T>`，原本同步抛出的失败也变成 rejection。这是退避的固有代价——重试之间要
 * `await setTimeout`，同步路径无法在不阻塞事件循环的前提下等待。因此调用方必须
 * `await`/`.then` 取结果，原先靠同步返回值或 `try/catch` 接结果的写法都要改写；
 * 不想改调用方就不要给同步方法加本装饰器。
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

  return function (_target: unknown, _propertyKey: string | symbol, descriptor?: PropertyDescriptor): PropertyDescriptor {
    // `descriptor` 声明为可选：legacy 装饰器误用到**类字段**上时按 PropertyDecorator 调用，
    // 运行时只收到两个实参，第三个是 undefined。此时裸读 `descriptor.value` 抛的是
    // `Cannot read properties of undefined (reading 'value')`——一条与装饰器无关的
    // 属性访问错误，会把真实原因（用错了地方）盖掉，故把「没有描述符」与「value 不是函数」
    // 并成同一条装饰阶段判据（后者含访问器描述符 get/set，不留
    // `originalMethod.apply is not a function` 这种晚到失败）。
    if (descriptor === undefined || typeof descriptor.value !== 'function') {
      throw new TypeError('[withRetry] can only decorate a method, but the descriptor.value is not a function')
    }

    const originalMethod = descriptor.value as (...args: unknown[]) => unknown

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      // 复用公共内核，与 AsyncActionSupport.executeWithRetry 同一实现，避免退避语义漂移
      return retryWithBackoff(async () => await originalMethod.apply(this, args), { retries, delay, shouldRetry })
    }

    return descriptor
  }
}
