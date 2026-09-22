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
  /**
   * 该 (宿主, 方法) 上是否观测到过 Promise 返回值
   *
   * 必须随状态按 (宿主, 方法) 存放：若放在装饰器作用域，任一实例的首次调用
   * 就会把标记锁给所有宿主，之后别的主机被抑制的调用会突然从 `undefined`
   * 变成 `Promise` —— 返回类型随调用顺序/实例而变，调用方无从依赖。
   */
  sawPromise: boolean
}

/** interval 缺省值，同时是非法值（NaN/Infinity/<=0）的回退值 */
const DEFAULT_INTERVAL = 300
/**
 * 创建节流装饰器
 *
 * @param {number} [interval=300] - 执行间隔（毫秒）；非有限值或 <=0 视为配置错误，
 *        回退为 300（NaN 会让窗口判断恒不成立、`Math.max(0, NaN)` 又被 `setTimeout`
 *        当作 0，节流形同失效）
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
export function withThrottle(interval: number = DEFAULT_INTERVAL, options: ThrottleDecoratorOptions = {}): MethodDecorator {
  // 双 false 永不执行无意义，退化为纯 leading（与 lodash 处理一致）
  const trailing = options.trailing ?? true
  const assumeAsync = options.assumeAsync ?? false
  // 双 false 永不执行无意义：退化为纯 leading（与 lodash 处理一致）
  let leading = options.leading ?? true
  if (!leading && !trailing) {
    leading = true
  }
  // 与 PerformanceMonitor.normalizeMaxSize 同一口径：非法配置回退默认值而非抛错，
  // 装饰器在类定义期求值，抛错会把一个参数笔误升级成模块加载失败
  const window = Number.isFinite(interval) && interval > 0 ? interval : DEFAULT_INTERVAL

  // 按宿主 + 方法键隔离状态：同一装饰器实例装饰多个方法时互不干扰。
  // 键保留原始 propertyKey（含 Symbol 身份）：String() 折叠会让同名 Symbol
  // 方法互吞调用。宿主包含函数（类/静态方法场景）。
  const stateMap = new WeakMap<object, Map<string | symbol, ThrottleState>>()

  return function (_target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value
    const methodKey = propertyKey
    const isAsyncMethod = isAsyncFunction(originalMethod)

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
        state = { lastCallTime: 0, pendingArgs: null, timer: null, sawPromise: false }
        byMethod.set(methodKey, state)
      }
      const hostState = state

      const fireTrailing = (handle: ReturnType<typeof setTimeout>): void => {
        // 只清自己这次句柄：无条件置 null 会让「已被 scheduleTrailingAt 替换掉、
        // 但回调已入队」的旧定时器抹掉新定时器的引用，此后既 clearTimeout 不到
        // 真正的待发定时器，它还会在错误的时刻再补发一次
        if (hostState.timer === handle) {
          hostState.timer = null
        }
        /* istanbul ignore if -- 新窗口 leading 分支已作废上一窗口的尾调用定时器，
           且 scheduleTrailingAt 保证同时只有一个活定时器，「无参数可补发」在
           正常时序下不可达，仅作为对未来改动的防御 */
        if (hostState.pendingArgs !== null) {
          const trailingArgs = hostState.pendingArgs
          hostState.pendingArgs = null
          hostState.lastCallTime = Date.now()
          // fire-and-forget：返回值不回传，且调用方早已返回——尾随执行的失败
          // 不可能再抛给调用方，必须就地兜住：同步抛错会变成 uncaughtException，
          // 异步 rejection 会变成 unhandledRejection
          try {
            const result = originalMethod.apply(this, trailingArgs) as unknown
            if (result instanceof Promise) {
              hostState.sawPromise = true
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
        if (hostState.timer !== null) {
          clearTimeout(hostState.timer)
        }
        const handle = setTimeout(() => fireTrailing(handle), Math.max(0, delay))
        hostState.timer = handle
      }

      if (now - hostState.lastCallTime >= window) {
        // 新窗口
        if (leading) {
          // 上一窗口残留的尾调用必须作废：新窗口以本次参数为准（下方 pendingArgs = null
          // 已经丢弃旧参数），留着它只会抹掉新定时器引用并在窗口结束前空转一次
          if (hostState.timer !== null) {
            clearTimeout(hostState.timer)
            hostState.timer = null
          }
          hostState.lastCallTime = now
          hostState.pendingArgs = null
          const result = originalMethod.apply(this, args)
          if (result instanceof Promise) {
            hostState.sawPromise = true
          }
          return result
        }
        // leading=false：首次调用延后到窗口结束执行
        hostState.lastCallTime = now
        hostState.pendingArgs = args
        scheduleTrailingAt(window)
        return isAsyncMethod || hostState.sawPromise || assumeAsync ? Promise.resolve(undefined) : undefined
      }

      // 窗口内被抑制
      if (trailing) {
        // 始终保存最新参数并保证窗口结束时有且仅有一次补发
        hostState.pendingArgs = args
        scheduleTrailingAt(hostState.lastCallTime + window - now)
      }
      return isAsyncMethod || hostState.sawPromise || assumeAsync ? Promise.resolve(undefined) : undefined
    }

    return descriptor
  }
}
