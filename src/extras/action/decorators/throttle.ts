/**
 * GeomStore - 节流装饰器
 *
 * 限制方法在指定时间间隔内只能执行一次，支持 leading / trailing 两种触发沿
 * （默认双开启，与 lodash throttle 语义对齐）：
 * - leading：新窗口的首次调用立即执行
 * - trailing：窗口内被抑制的调用在窗口结束时以最新参数补发（fire-and-forget，
 *   返回值不回传——节流场景调用方不应依赖被抑制调用的返回值）
 *
 * 宿主生命周期收尾：窗口内挂起的补发由 `setTimeout` 驱动，宿主（小程序 Page /
 * Component 实例）卸载后它仍会到期执行，最坏情况写入已销毁的 store。为此本模块
 * 提供三个语义互斥的公开入口（`cancelThrottledCalls` / `flushThrottledCalls` /
 * `disposeThrottledState`，见各自 JSDoc），在 `onUnload` / `detached` 里按宿主调用。
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
  /** 被装饰方法键（原样保留 Symbol 身份）：公开入口按方法名筛选槽位时用 */
  methodKey: string | symbol
  /** 宿主：补发时作为原方法的 `this`（WeakMap 的值引用自身键不阻止回收） */
  host: object
  /** 被装饰的原方法：`flushThrottledCalls` 需要在装饰闭包之外补发它 */
  originalMethod: (this: unknown, ...args: unknown[]) => unknown
}

/** interval 缺省值，同时是非法值（NaN/Infinity/<=0）的回退值 */
const DEFAULT_INTERVAL = 300

/** 尾随补发失败的统一日志前缀（就地兜错，见 `firePendingTrailing`） */
const TRAILING_FAILURE_LOG = '[withThrottle] trailing invocation failed:'

/**
 * 宿主 → 「装饰槽位 → 节流状态」
 *
 * 刻意放在模块级（而非此前的工厂闭包级）：`withThrottle(100)` 的产物是同类多实例
 * 共享的包装函数，宿主卸载点（`onUnload` / `detached`）手里只有 `this`，公开入口
 * 必须能**凭宿主**定位到状态，工厂私有闭包做不到这一点。
 *
 * 这不是跨用例的全局注册表：
 * - 键是宿主本身（WeakMap），宿主被回收时整条状态连带消失，无跨周期残留；
 * - 装饰器实例之间用各自的 `slotKey`（每个被装饰方法一个 Symbol）分桶，
 *   等价于旧「每工厂一个 WeakMap」的隔离度——同名方法被两层 `withThrottle`
 *   装饰、或描述名相同的两个 Symbol 方法共用宿主时，状态与定时器互不干涉；
 * - 已知代价：同一包的重复副本（分包各自打包）各持一份本表，副本 A 的入口
 *   清不掉副本 B 排程的定时器——与库内其它模块级状态同限制，非新增缺陷。
 */
const throttleStates = new WeakMap<object, Map<symbol, ThrottleState>>()

/**
 * 宿主能否作为 WeakMap 键（对象/函数且非 null）。
 *
 * 与 `withDebounce` 侧的同名判据同口径：宿主不可跟踪时三者一律降级而不是抛错
 * （节流直接放行、防抖各自定时、缓存一次性 Map），公开入口对这种宿主则是 no-op。
 */
function isTrackableHost(host: unknown): host is object {
  return (typeof host === 'object' || typeof host === 'function') && host !== null
}

/** 取（首次时创建）某宿主的状态表 */
function getSlotMap(host: object): Map<symbol, ThrottleState> {
  let slots = throttleStates.get(host)
  if (!slots) {
    slots = new Map()
    throttleStates.set(host, slots)
  }
  return slots
}

/**
 * 定位宿主上待处理的槽位：`method` 省略时覆盖该宿主的全部被装饰方法。
 *
 * 宿主为基本类型 / null、或该宿主上没有任何节流状态（从未调用过被装饰方法，
 * 或已 `disposeThrottledState`）时返回空数组——入口因此对任何入参都是安全的 no-op。
 */
function collectThrottleSlots(host: unknown, method: string | symbol | undefined): ThrottleState[] {
  if (!isTrackableHost(host)) {
    return []
  }
  const slots = throttleStates.get(host)
  if (!slots) {
    return []
  }
  const matched: ThrottleState[] = []
  for (const slot of slots.values()) {
    if (method === undefined || slot.methodKey === method) {
      matched.push(slot)
    }
  }
  return matched
}

/** 摘掉槽位上挂起的补发定时器（若有） */
function clearTrailingTimer(slot: ThrottleState): void {
  if (slot.timer !== null) {
    clearTimeout(slot.timer)
    slot.timer = null
  }
}

/** 丢弃槽位挂起的补发（不执行原方法）；幂等 */
function dropPendingTrailing(slot: ThrottleState): void {
  clearTrailingTimer(slot)
  slot.pendingArgs = null
}

/** 尾随补发的失败上报：见 `firePendingTrailing` 的兜错理由 */
function reportTrailingFailure(error: unknown): void {
  console.error(TRAILING_FAILURE_LOG, error)
}

/**
 * 以最新参数补发一次挂起的调用；无挂起参数时为 no-op
 *
 * fire-and-forget：返回值不回传，且调用方早已返回——补发的失败不可能再抛给调用方，
 * 必须就地兜住：同步抛错会变成 uncaughtException，异步 rejection 会变成
 * unhandledRejection。定时器路径与 `flushThrottledCalls` 共用本函数，故兜错口径一致。
 */
function firePendingTrailing(slot: ThrottleState): void {
  const trailingArgs = slot.pendingArgs
  if (trailingArgs === null) {
    // 无参数可补发：定时器路径上它由「新窗口 leading 分支已作废上一窗口定时器」保证
    // 几乎不发生，flush 路径上它是「无挂起调用时 flush」的正常形态（幂等要求）
    return
  }
  slot.pendingArgs = null
  slot.lastCallTime = Date.now()
  try {
    const result = slot.originalMethod.apply(slot.host, trailingArgs) as unknown
    if (result instanceof Promise) {
      slot.sawPromise = true
      result.catch((error) => {
        reportTrailingFailure(error)
      })
    }
  } catch (error) {
    reportTrailingFailure(error)
  }
}

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
 *
 *   detached() {
 *     // 卸载时丢弃窗口内尚未补发的调用（也可用 flushThrottledCalls 立即补发一次）
 *     cancelThrottledCalls(this)
 *   }
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

  return function (_target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value as (this: unknown, ...args: unknown[]) => unknown
    // 该 (装饰器实例, 方法) 的槽位身份：宿主状态表按它分桶（隔离度见 `throttleStates` 注释），
    // 公开入口按 `methodKey` 反向筛选出它
    const slotKey = Symbol('withThrottle')
    const methodKey = propertyKey
    const isAsyncMethod = isAsyncFunction(originalMethod)

    // 尾随补发的排程助手定义在装饰阶段（每个被装饰方法一份），而不是每次调用重建：
    // 节流跑在滚动、输入这类每事件路径上，闭包 per-call 分配是白付的开销。
    // 状态改为参数传入——同一份 ThrottleState 恒属于同一个宿主（它按宿主存于
    // throttleStates），因此与原实现里闭包捕获 `this` 完全等价
    const scheduleTrailingAt = (hostState: ThrottleState, delay: number): void => {
      clearTrailingTimer(hostState)
      // 已知取舍：排程中的定时器回调持有宿主与状态直到窗口结束，期间宿主不可被回收。
      // 宿主生命周期短于窗口（组件在窗口内被销毁）时，请在卸载点调用
      // `cancelThrottledCalls(this)`（丢弃）或 `flushThrottledCalls(this)`（补发一次）
      // 收尾，别让它在销毁之后仍调用被装饰方法
      const timer = setTimeout(() => {
        // 只清自己这次句柄：无条件置 null 会让「已被 scheduleTrailingAt 替换掉、
        // 但回调已入队」的旧定时器抹掉新定时器的引用，此后既 clearTimeout 不到
        // 真正的待发定时器，它还会在错误的时刻再补发一次。
        // 该 if 的 false 分支只在「同一批到期回调里，前一个回调把后一个定时器 clear 掉、
        // 但后者已从本批快照中出队」的场景成立（真实 Node 定时器相位下才可能出现，
        // jest fake timers 会跳过已 disposed 的定时器），因此测试里无法稳定复现，
        // HEAD 亦未覆盖；保留为对未来改动的防御，不写 istanbul ignore
        // （本文件分支门槛 85%，实测 98.4%，无需为一条防御分支做豁免）
        if (hostState.timer === timer) {
          hostState.timer = null
        }
        firePendingTrailing(hostState)
      }, Math.max(0, delay))
      hostState.timer = timer
    }

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const now = Date.now()
      const host = this

      // 宿主非对象/函数：状态无法持久化，直接放行执行（不跨调用串扰）
      if (!isTrackableHost(host)) {
        return originalMethod.apply(this, args)
      }

      const slots = getSlotMap(host)
      let state = slots.get(slotKey)
      if (!state) {
        state = { lastCallTime: 0, pendingArgs: null, timer: null, sawPromise: false, methodKey, host, originalMethod }
        slots.set(slotKey, state)
      }
      const hostState = state

      if (now - hostState.lastCallTime >= window) {
        // 新窗口
        if (leading) {
          // 上一窗口残留的尾调用必须作废：新窗口以本次参数为准（下方 pendingArgs = null
          // 已经丢弃旧参数），留着它只会抹掉新定时器引用并在窗口结束前空转一次
          clearTrailingTimer(hostState)
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
        scheduleTrailingAt(hostState, window)
        return isAsyncMethod || hostState.sawPromise || assumeAsync ? Promise.resolve(undefined) : undefined
      }

      // 窗口内被抑制
      if (trailing) {
        // 始终保存最新参数并保证窗口结束时有且仅有一次补发
        hostState.pendingArgs = args
        scheduleTrailingAt(hostState, hostState.lastCallTime + window - now)
      }
      return isAsyncMethod || hostState.sawPromise || assumeAsync ? Promise.resolve(undefined) : undefined
    }

    return descriptor
  }
}

/**
 * 取消宿主上挂起的节流补发（**不执行**原方法）
 *
 * 用于宿主卸载点：窗口内被抑制、正等着补发的调用就此丢弃。幂等——重复调用、
 * 对没有挂起调用的宿主调用都是 no-op；被抑制的那次调用当时返回的 Promise
 * （若有）已在调用时刻以 `undefined` 结算，不受影响。
 *
 * @param host - 宿主（Page / Component 实例、类对象等）。基本类型 / null 时无从
 *        定位状态，静默返回（与装饰器本身的降级口径一致）
 * @param method - 只取消该名字的被装饰方法；省略时取消该宿主上所有节流方法
 *
 * @example
 * ```typescript
 * class ScrollPage {
 *   @withThrottle(100)
 *   onScroll(position: number) { this.store.patch(position) }
 *
 *   onUnload() {
 *     cancelThrottledCalls(this) // 页面已销毁，挂起的补发不再执行
 *   }
 * }
 * ```
 */
export function cancelThrottledCalls(host: unknown, method?: string | symbol): void {
  for (const slot of collectThrottleSlots(host, method)) {
    dropPendingTrailing(slot)
  }
}

/**
 * 立即补发宿主上挂起的节流调用（**至多一次**）
 *
 * 与 `cancelThrottledCalls` 的区别是「执行」而不是「丢弃」：适用于卸载前还想把
 * 最后一次输入/滚动位置落盘的场合。语义与窗口自然到期完全一致，因此：
 * - 每个槽位只补发一次（补发后挂起参数即被清空，再次 flush 是 no-op）；
 * - 没有挂起调用时不凭空执行原方法（只有被抑制过的调用才有补发资格）；
 * - 补发是 fire-and-forget，其返回值不回传、失败就地 `console.error`，
 *   不会把 rejection 漏成 unhandledRejection。
 *
 * @param host - 宿主；基本类型 / null 时为 no-op
 * @param method - 只补发该名字的被装饰方法；省略时补发该宿主上所有挂起的节流调用
 */
export function flushThrottledCalls(host: unknown, method?: string | symbol): void {
  for (const slot of collectThrottleSlots(host, method)) {
    clearTrailingTimer(slot)
    firePendingTrailing(slot)
  }
}

/**
 * 释放宿主上的全部节流状态（取消挂起补发 + 清空窗口计时）
 *
 * 相当于 `cancelThrottledCalls(host)` 之后再删掉该宿主的整张状态表：窗口计时
 * （`lastCallTime`）、异步观测标记（`sawPromise`）一并归零，此后若还有代码持有
 * 该宿主并调用被装饰方法，会按「新窗口」重新计状态。卸载点上想「一切从简」可以
 * 只调本函数，它比 cancel 多出的正是这份状态释放。
 *
 * 与 `cancelThrottledCalls` 一样对任何入参安全：宿主为基本类型 / null、
 * 或本就没有节流状态时都是 no-op。
 *
 * @param host - 宿主
 */
export function disposeThrottledState(host: unknown): void {
  if (!isTrackableHost(host)) {
    return
  }
  for (const slot of collectThrottleSlots(host, undefined)) {
    dropPendingTrailing(slot)
  }
  throttleStates.delete(host)
}
