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
 * 超时错误由 `async-core.ts` 的 `createTimeoutError` 统一构造：它是普通 `Error` 加一个
 * `code === TIMEOUT_ERROR_CODE`（`'ACTION_TIMEOUT'`），**跨入口识别按这个 code，不要按消息文本**。
 * 消息文本 `Timeout after <n>ms` 仍是既有契约的一部分（调用方与
 * `tests/unit/extras/action/utils.test.ts` 都按它匹配），改动即破坏性变更；其中 `<n>` 是
 * **实际生效**的毫秒数（超过 2^31-1 ms 的配置会先被截到该上限再写入消息，
 * 故消息里的数字一定等于真正等待的时间）。
 * 另注意 `ActionExecutor.executeWithTimeout` 的文案是 `Action timeout after <n>ms`，
 * 两个入口的**文本**并不相同，但两者都经由 `raceWithTimeout` 拿到同一个 `code`，
 * 所以「是不是超时」在跨入口维度上是可判定的。
 *
 * @param {number} [timeout=5000] - 超时时间（毫秒，必须为大于 0 的有限数值；
 *        超过 2^31-1 ms 的值按该上限生效，与宿主 `setTimeout` 的可表达区间一致）
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
 *   // 先收窄再取 message：strict + useUnknownInCatchVariables 下 catch 形参是 unknown
 *   if (error instanceof Error && error.message.includes('Timeout after')) {
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
      // 复用公共内核，与 AsyncActionSupport.executeWithTimeout 同一实现。
      // 消息里必须是归一化后的 delay：normalizeTimeout 会把超过 2^31-1 ms 的值截到该上限
      // （更大值会被宿主静默钳成 1ms），用原始 timeout 时「24.8 天后超时」会报成
      // `Timeout after 5000000000ms`，调用方按数字记日志/匹配就永远对不上真实生效值。
      // 区间内的输入 delay === timeout，`Timeout after <n>ms` 契约不变。
      return raceWithTimeout(Promise.resolve(originalMethod.apply(this, args)), delay, `Timeout after ${delay}ms`)
    }

    return descriptor
  }
}
