/**
 * GeomStore - 节流装饰器
 *
 * 限制方法在指定时间间隔内只能执行一次，支持 leading / trailing 两种触发沿
 * （默认双开启，与 lodash throttle 语义对齐）：
 * - leading：新窗口的首次调用立即执行
 * - trailing：窗口内被抑制的调用在窗口结束时以最新参数补发（fire-and-forget，
 *   返回值不回传——节流场景调用方不应依赖被抑制调用的返回值）
 *
 */

import { isAsyncFunction } from './common.js'

/**
 * 节流选项
 */
export interface ThrottleDecoratorOptions {
  /** 新窗口首次调用是否立即执行（默认 true） */
  leading?: boolean
  /** 窗口结束时是否以最新参数补发被抑制的调用（默认 true） */
  trailing?: boolean
  /**
   * 是否按异步方法处理返回值（默认 false）
   *
   * 用于「非 async 语法但返回 Promise」的方法（包装函数、手写 thenable）：这类方法
   * 首次调用若被抑制（leading=false），装饰器无从观测返回值，会按同步方法返回 undefined。
   * 置为 true 可强制被抑制的调用也返回 Promise，保证调用方 await/.then 不崩。
   */
  assumeAsync?: boolean
}

/** 单个 (宿主, 方法) 的节流状态 */
interface ThrottleState {
  lastCallTime: number
  /** 窗口内最近一次被抑制调用的参数（trailing 补发用） */
  pendingArgs: unknown[] | null
  timer: ReturnType<typeof setTimeout> | null
}
/**
 * 创建节流装饰器
 *
 * @param {number} [interval=300] - 执行间隔（毫秒）
 * @param {ThrottleDecoratorOptions} [options] - leading/trailing 配置（默认双开启）
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class ScrollComponent {
 *   // 默认 leading+trailing：首调立即执行，窗口尾最后一次调用以最新参数补发
 *   @withThrottle(100)
 *   handleScroll(position: number) {
 *     updateScrollPosition(position)
 *   }
 *
 *   // 纯 leading（旧行为）：窗口内的后续调用全部丢弃
 *   @withThrottle(100, { trailing: false })
 *   trackFirstHit(position: number) {}
 * }
 * ```
 */
export function withThrottle(interval: number = 300, options: ThrottleDecoratorOptions = {}): MethodDecorator {
  // 双 false 永不执行无意义，退化为纯 leading（与 lodash 处理一致）
  const trailing = options.trailing ?? true
  const assumeAsync = options.assumeAsync ?? false
  // 双 false 永不执行无意义：退化为纯 leading（与 lodash 处理一致）
  let leading = options.leading ?? true
  if (!leading && !trailing) {
    leading = true
  }

  // 按宿主 + 方法键隔离状态：同一装饰器实例装饰多个方法时互不干扰。
  // 键保留原始 propertyKey（含 Symbol 身份）：String() 折叠会让同名 Symbol
  // 方法互吞调用。宿主包含函数（类/静态方法场景）。
  const stateMap = new WeakMap<object, Map<string | symbol, ThrottleState>>()

  return function (_target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value
    const methodKey = propertyKey
    const isAsyncMethod = isAsyncFunction(originalMethod)
    let observesPromise = false

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const now = Date.now()

      // 宿主非对象/函数：状态无法持久化，直接放行执行（不跨调用串扰）
      if ((typeof this !== 'object' && typeof this !== 'function') || this === null) {
        return originalMethod.apply(this, args)
      }

      let byMethod = stateMap.get(this)
      if (!byMethod) {
        byMethod = new Map()
        stateMap.set(this, byMethod)
      }
      let state = byMethod.get(methodKey)
      if (!state) {
        state = { lastCallTime: 0, pendingArgs: null, timer: null }
        byMethod.set(methodKey, state)
      }

      const fireTrailing = (): void => {
        state.timer = null
        /* istanbul ignore else -- 空参数侧要求「微任务先于同刻到期的定时器执行」这一竞态：
           trailing 定时器恰在窗口结束时到期，而清空 pendingArgs 的 leading 调用最早也只能
           发生在窗口结束时刻，fake timers 无法确定性地让微任务抢在已到期定时器之前（见
           throttle-leading-trailing 用例注释），故该侧在测试环境不可稳定复现 */
        if (state.pendingArgs !== null) {
          const trailingArgs = state.pendingArgs
          state.pendingArgs = null
          state.lastCallTime = Date.now()
          // fire-and-forget：返回值不回传，且调用方早已返回——尾随执行的失败
          // 不可能再抛给调用方，必须就地兜住：同步抛错会变成 uncaughtException，
          // 异步 rejection 会变成 unhandledRejection
          try {
            const result = originalMethod.apply(this, trailingArgs) as unknown
            if (result instanceof Promise) {
              observesPromise = true
              result.catch((error) => {
                console.error('[withThrottle] trailing invocation failed:', error)
              })
            }
          } catch (error) {
            console.error('[withThrottle] trailing invocation failed:', error)
          }
        }
      }
      const scheduleTrailingAt = (delay: number): void => {
        if (state.timer !== null) {
          clearTimeout(state.timer)
        }
        state.timer = setTimeout(fireTrailing, Math.max(0, delay))
      }

      if (now - state.lastCallTime >= interval) {
        // 新窗口
        if (leading) {
          state.lastCallTime = now
          state.pendingArgs = null
          const result = originalMethod.apply(this, args)
          if (result instanceof Promise) {
            observesPromise = true
          }
          return result
        }
        // leading=false：首次调用延后到窗口结束执行
        state.lastCallTime = now
        state.pendingArgs = args
        scheduleTrailingAt(interval)
        return isAsyncMethod || observesPromise || assumeAsync ? Promise.resolve(undefined) : undefined
      }

      // 窗口内被抑制
      if (trailing) {
        // 始终保存最新参数并保证窗口结束时有且仅有一次补发
        state.pendingArgs = args
        scheduleTrailingAt(state.lastCallTime + interval - now)
      }
      return isAsyncMethod || observesPromise || assumeAsync ? Promise.resolve(undefined) : undefined
    }

    return descriptor
  }
}
