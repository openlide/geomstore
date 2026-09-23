/**
 * GeomStore - 防抖装饰器
 *
 * 延迟执行方法，如果在延迟时间内再次调用，则重置定时器
 *
 * 修复说明：原实现将 timeoutId / pendingResolves 等状态声明在工厂函数作用域，
 * 导致同一装饰器装饰的所有方法/实例共享同一份状态（闭包陷阱）。
 * 现改为按宿主对象（this）隔离状态，每个实例拥有独立的定时器与 pending 队列。
 *
 * 宿主生命周期收尾：等待期由 `setTimeout` 驱动，宿主（小程序 Page / Component 实例）
 * 卸载后它仍会到期执行被装饰方法。为此本模块提供三个语义互斥的公开入口
 * （`cancelDebouncedCalls` / `flushDebouncedCalls` / `disposeDebouncedState`），
 * 在 `onUnload` / `detached` 里按宿主调用。
 *
 * 这三个入口定位的是**调用被装饰方法时的 `this`**（状态表 `debounceStates` 的键就是它），
 * 因此只对「`this` 可被业务侧拿到」的宿主有效：Page / Component 实例、类实例、普通对象。
 * **装饰 store action 时本组入口不可用**——`ActionManager` 把每个 action 包成
 * `originalAction.call(actionContext, ...)`，运行时的 `this` 是 store 内部的 action 上下文
 * 代理（只被那批箭头闭包捕获，不挂在任何公开成员上；`store.actions` 拿到的是另一个对象），
 * 在 Page/Component 的卸载点上传 `this` 会拿到空数组并**静默 no-op**，挂起的防抖 action
 * 照样到点执行并往（可能已销毁的）store 里写。装饰 store action 时请在业务侧自判存活标记
 * （action 体内先确认页面/store 仍存活再落状态），与「`withCache` / `withRetry` 没有对应的
 * 收尾入口」同一口径。`withThrottle` 的三个同名入口受同一条限制，见其模块头。
 *
 */

/**
 * 被装饰的原方法
 *
 * 防抖改的是**执行时刻**，不是返回值语义：原方法返回什么，最终那次执行就产出什么。
 * 但等待期必须有个可结算的替身，所以包装函数的返回值**恒为 Promise**（见 `withDebounce`
 * 的 remarks）——装饰同步方法时这一点无法在类型上表达，旧式方法装饰器改不了声明签名。
 */
type DecoratedMethod = (this: unknown, ...args: unknown[]) => unknown

/** 单个 (宿主, 方法) 的防抖状态 */
interface DebounceState {
  timeoutId: ReturnType<typeof setTimeout> | null
  pendingResolves: Array<(value: unknown) => void>
  pendingRejects: Array<(error: unknown) => void>
  /**
   * 与上面两个队列一一对应的挂起 Promise
   *
   * 只服务取消路径：`cancelDebouncedCalls` 要以「已取消」结算它们，而结算前必须先给
   * 每个 promise 补一个 catch 处理器，否则卸载点上 fire-and-forget 的调用会变成
   * unhandledRejection（见 `cancelPendingCalls` 的注释）。
   */
  pendingPromises: Array<Promise<unknown>>
  pendingArgs: unknown[]
  /** 被装饰方法键（原样保留 Symbol 身份）：公开入口按方法名筛选槽位时用 */
  methodKey: string | symbol
  /** 宿主：触发时作为原方法的 `this`；宿主不可跟踪（基本类型）时为本次调用的 receiver */
  host: unknown
  /** 被装饰的原方法：`flushDebouncedCalls` 需要在装饰闭包之外立即触发它 */
  originalMethod: DecoratedMethod
}

/** 被取消调用的 rejection 原因文案 */
const CANCELLED_MESSAGE = '[withDebounce] pending call was cancelled'

/** 默认防抖延迟（毫秒） */
const DEFAULT_DELAY = 300

/**
 * 宿主 → 「装饰槽位 → 防抖状态」
 *
 * 刻意放在模块级（而非此前的工厂闭包级）：`withDebounce(300)` 的产物是同类多实例
 * 共享的包装函数，宿主卸载点手里只有 `this`，公开入口必须**凭宿主**定位到状态。
 * 这不是造成跨用例串扰的那种全局表：
 * - 键是宿主本身（WeakMap），宿主被回收时整条状态连带消失；
 * - 装饰器实例之间用各自的 `slotKey`（每个被装饰方法一个 Symbol）分桶，隔离度与
 *   旧「每工厂一个 WeakMap + 方法键内层表」一致（历史上「共享一份 pending 队列」
 *   的缺陷不会因此回归，见 DECORATOR-BUG 用例）；
 * - 宿主不可跟踪（基本类型 / null）时**不进本表**：那次调用用一次性本地状态，
 *   公开入口对它无从下手（防抖本身在该场景也已失效，见 `getDebounceState`）。
 */
const debounceStates = new WeakMap<object, Map<symbol, DebounceState>>()

/**
 * 宿主能否作为 WeakMap 键（对象/函数且非 null）。
 *
 * 与 `withThrottle` 侧的同名判据同口径：宿主不可跟踪时装饰器一律降级而不是抛错。
 * 两处各自定义而不抽到 common.ts，是因为本波次只允许改 throttle/debounce 两个文件
 * （抽出后两者都要改 import，属于另一波次的整理）。
 */
function isTrackableHost(host: unknown): host is object {
  return (typeof host === 'object' || typeof host === 'function') && host !== null
}

/** 防抖状态的初始值：单一构造点避免形状漂移 */
function createDebounceState(host: unknown, methodKey: string | symbol, originalMethod: DecoratedMethod): DebounceState {
  return {
    timeoutId: null,
    pendingResolves: [],
    pendingRejects: [],
    pendingPromises: [],
    pendingArgs: [],
    methodKey,
    host,
    originalMethod,
  }
}

/**
 * 取该次调用所属 (宿主, 方法) 的防抖状态
 *
 * 宿主不是对象或函数（`this === undefined` / 基本类型 / null，如把方法解构下来 detached 调用）
 * 时给一次性本地状态：WeakMap 无从按宿主存状态，只能保证不跨调用串扰。
 * 已知代价（刻意保留，与 withThrottle「直接放行」、withCache「一次性 Map」同口径，
 * 三者都选择在宿主不可跟踪时降级而不是抛错）：这份状态每次调用都新建，
 * `timeoutId` 恒为 null → 既不 clearTimeout 也不合并调用，**防抖等于失效**：
 * 每次调用各自排一个定时器、各自结算自己的 resolver，原方法还会以 undefined
 * 之类的 receiver 执行。需要防抖语义就必须以方法调用的形式（带宿主）调用；
 * 也正因这份状态不进 `debounceStates`，`cancel/flush/dispose` 入口对它同样是 no-op。
 */
function getDebounceState(host: unknown, slotKey: symbol, methodKey: string | symbol, originalMethod: DecoratedMethod): DebounceState {
  if (!isTrackableHost(host)) {
    return createDebounceState(host, methodKey, originalMethod)
  }
  let slots = debounceStates.get(host)
  if (!slots) {
    slots = new Map()
    debounceStates.set(host, slots)
  }
  let state = slots.get(slotKey)
  if (!state) {
    state = createDebounceState(host, methodKey, originalMethod)
    slots.set(slotKey, state)
  }
  return state
}

/**
 * 定位宿主上待处理的槽位：`method` 省略时覆盖该宿主的全部被装饰方法。
 *
 * 宿主为基本类型 / null、或该宿主上没有任何防抖状态时返回空数组——入口因此对
 * 任何入参都是安全的 no-op。
 */
function collectDebounceSlots(host: unknown, method: string | symbol | undefined): DebounceState[] {
  if (!isTrackableHost(host)) {
    return []
  }
  const slots = debounceStates.get(host)
  if (!slots) {
    return []
  }
  const matched: DebounceState[] = []
  for (const slot of slots.values()) {
    if (method === undefined || slot.methodKey === method) {
      matched.push(slot)
    }
  }
  return matched
}

/** 摘掉槽位上挂起的等待定时器（若有） */
function clearDebounceTimer(slot: DebounceState): void {
  if (slot.timeoutId !== null) {
    clearTimeout(slot.timeoutId)
    slot.timeoutId = null
  }
}

/** 把挂起队列一次性摘走并清空状态，防止重复结算 */
function takePendingCalls(slot: DebounceState): Pick<DebounceState, 'pendingResolves' | 'pendingRejects' | 'pendingPromises' | 'pendingArgs'> {
  const taken = {
    pendingResolves: slot.pendingResolves,
    pendingRejects: slot.pendingRejects,
    pendingPromises: slot.pendingPromises,
    pendingArgs: slot.pendingArgs,
  }
  slot.pendingResolves = []
  slot.pendingRejects = []
  slot.pendingPromises = []
  slot.pendingArgs = []
  return taken
}

/**
 * 立即以最新参数执行一次并结算全部挂起调用（定时器到期与 `flushDebouncedCalls` 共用）
 *
 * 返回值不交给任何人：调用方的 Promise 由 `pendingResolves` / `pendingRejects` 结算，
 * 原方法的失败因此一定有归宿，本函数自身不会 reject（try 覆盖到唯一的 await）。
 */
async function runPendingCalls(slot: DebounceState): Promise<void> {
  clearDebounceTimer(slot)
  // 只有存活到现在的这一个定时器会触发，摘走的 pendingArgs 正是最后一次调用的参数
  // （每次调用都会先清掉上一个定时器再写入），不存在「pendingArgs 为空 → 回退旧 args」的分支
  const taken = takePendingCalls(slot)
  try {
    const result = await slot.originalMethod.apply(slot.host, taken.pendingArgs)
    taken.pendingResolves.forEach((r) => r(result))
  } catch (error) {
    // 与 `cancelPendingCalls` 同口径：reject 之前先给每个挂起 promise 补一个 catch。
    // 防抖的常态就是 fire-and-forget（`host.search(kw)` 不接返回值），到期/flush 时
    // 原方法失败会让那些无人接管的 promise 变成 unhandledRejection——卸载点上尤其如此。
    // 只消除全局未处理告警，不吞结果：真正 await/.then 了的调用方仍看得到这次失败
    for (const promise of taken.pendingPromises) {
      void promise.catch(() => undefined)
    }
    taken.pendingRejects.forEach((r) => r(error))
  }
}

/**
 * 丢弃槽位上挂起的调用，并以「已取消」结算其 Promise；幂等
 *
 * 不结算就会永久挂起（调用方 `await` 到一个永不落定的 Promise）；直接 reject 又会让
 * 卸载点上常见的 fire-and-forget 调用变成 unhandledRejection。故先给每个挂起的
 * promise 补一个 catch 处理器再 reject：那只消除全局未处理告警，不替调用方吞结果——
 * 真正 `await`/`.then` 了的调用方仍能看到这条「已取消」。
 */
function cancelPendingCalls(slot: DebounceState): void {
  clearDebounceTimer(slot)
  const taken = takePendingCalls(slot)
  if (taken.pendingRejects.length === 0) {
    return
  }
  for (const promise of taken.pendingPromises) {
    void promise.catch(() => undefined)
  }
  const error = new Error(CANCELLED_MESSAGE)
  taken.pendingRejects.forEach((r) => r(error))
}

/**
 * 创建防抖装饰器
 *
 * 延迟执行方法，如果在延迟时间内再次调用，则重置定时器
 * 适用于搜索、输入框等场景
 *
 * @param {number} [delay=300] - 延迟时间（毫秒）；非有限值或 <=0 视为配置错误，
 *        回退为 300（`setTimeout(fn, NaN)` 与负延迟都按 ~0ms 触发、`Infinity` 在 Node 下
 *        溢出告警后按 1ms 处理，静默把防抖退化成一个近无操作；与 `withThrottle` 同口径）
 * @returns {MethodDecorator} 方法装饰器
 *
 * @remarks 包装函数的返回值**恒为 Promise**：延迟期内不能同步产出结果，只能先给一个
 * 等待结算的替身。因此本装饰器适用于 async 方法。TS 的旧式方法装饰器改不了声明签名，
 * 装饰一个同步方法 `sync(): T` 时类型仍是 `(): T` 而运行时拿到 `Promise<unknown>`
 * （`const v: T = host.sync()` 编译通过却拿错值），调用方必须按 Promise 消费。
 *
 * @example
 * ```typescript
 * class SearchComponent {
 *   @withDebounce(500)
 *   async search(query: string) {
 *     return await searchAPI(query)
 *   }
 *
 *   detached() {
 *     // 组件销毁：等待中的 search 调用以「已取消」结算，不再打接口
 *     cancelDebouncedCalls(this)
 *   }
 * }
 *
 * // 用户快速输入，只会在最后一次输入后500ms执行一次搜索
 * searchComponent.search('a')
 * searchComponent.search('ap')
 * searchComponent.search('app') // 只执行这次
 * ```
 */
export function withDebounce(delay: number = DEFAULT_DELAY): MethodDecorator {
  // 与 withThrottle 的 interval 同一口径：非法配置回退默认值而不是抛错——装饰器在类
  // 定义期求值，抛错会把一个参数笔误升级成模块加载失败
  const wait = Number.isFinite(delay) && delay > 0 ? delay : DEFAULT_DELAY

  return function (_target: unknown, propertyKey: string | symbol, descriptor?: PropertyDescriptor): PropertyDescriptor {
    const methodKey = propertyKey

    // 访问器描述符 / 非函数属性：value 为 undefined，晚到失败会以
    // `Cannot read properties of undefined (reading 'apply')` 的形式出现在定时器回调里，
    // 还被下方的 catch 吞成「所有 pending 调用都 reject」，故在装饰阶段就报错。
    // 判据同时覆盖「没有描述符」：legacy 装饰器误用到类字段上时按 PropertyDecorator 调用，
    // 运行时只收到两个实参，此前在这里裸读 `descriptor.value` 抛的错误会把真实原因
    // （用错了地方）盖掉——与 withRetry / withTimeout / withThrottle / withCache 同一形态
    if (descriptor === undefined || typeof descriptor.value !== 'function') {
      throw new TypeError(`[withDebounce] can only decorate a method, but "${String(methodKey)}" is not a function`)
    }

    const originalMethod = descriptor.value as DecoratedMethod

    // 该 (装饰器实例, 方法) 的槽位身份：宿主状态表按它分桶（隔离度见 `debounceStates` 注释）
    const slotKey = Symbol('withDebounce')

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const state = getDebounceState(this, slotKey, methodKey, originalMethod)

      clearDebounceTimer(state)
      state.pendingArgs = args

      let resolveCall!: (value: unknown) => void
      let rejectCall!: (error: unknown) => void
      const promise = new Promise<unknown>((resolve, reject) => {
        resolveCall = resolve
        rejectCall = reject
      })
      // 三份队列必须同序：cancel 要靠 pendingPromises 给对应的 rejection 补 catch
      state.pendingResolves.push(resolveCall)
      state.pendingRejects.push(rejectCall)
      state.pendingPromises.push(promise)

      // 已知取舍：排程中的定时器回调持有状态（以及状态持有的宿主）直到延迟到期，
      // 期间宿主不可被回收；宿主生命周期短于延迟时，请在卸载点调用
      // `cancelDebouncedCalls(this)`（丢弃）或 `flushDebouncedCalls(this)`（立即执行一次）
      state.timeoutId = setTimeout(() => {
        void runPendingCalls(state)
      }, wait)

      return promise
    }

    return descriptor
  }
}

/**
 * 取消宿主上挂起的防抖调用（**不执行**原方法）
 *
 * 每个被取消的调用返回的 Promise 以 `Error('[withDebounce] pending call was cancelled')`
 * 拒绝（理由见 `cancelPendingCalls` 的注释：不结算会永久挂起调用方）。幂等——重复调用、
 * 对没有挂起调用的宿主调用都是 no-op。
 *
 * @param host - 宿主（Page / Component 实例、类对象等）。基本类型 / null 时无从定位
 *        状态，静默返回（与装饰器自身的降级口径一致）。装饰 store action 时传 Page 的
 *        `this` 同样定位不到状态（`this` 是 store 内部的 action 上下文代理），
 *        见模块头的「本组入口不可用于 store action」
 * @param method - 只取消该名字的被装饰方法；省略时取消该宿主上所有防抖方法
 *
 * @example
 * ```typescript
 * class SearchPage {
 *   @withDebounce(300)
 *   async search(keyword: string) { return fetchSearch(keyword) }
 *
 *   onUnload() {
 *     cancelDebouncedCalls(this) // 等待中的搜索不再发请求
 *   }
 * }
 * ```
 */
export function cancelDebouncedCalls(host: unknown, method?: string | symbol): void {
  for (const slot of collectDebounceSlots(host, method)) {
    cancelPendingCalls(slot)
  }
}

/**
 * 立即执行宿主上挂起的防抖调用（**至多一次**）
 *
 * 与 `cancelDebouncedCalls` 的区别是「现在就跑」而不是「丢弃」：适用于卸载前还想
 * 把最后一次输入提交出去的场合。语义与延迟自然到期一致：
 * - 一次调用只执行原方法一次，其挂起的全部 Promise 都按这次结果结算（合并语义不变）；
 * - 没有挂起调用时不凭空执行原方法（再次 flush 因队列已空而是 no-op）；
 * - 原方法失败仍按既有语义 reject 那些 Promise：`await` 了的调用方拿得到失败，
 *   fire-and-forget 的调用方也不会漏出 unhandledRejection（`runPendingCalls` 在 reject
 *   前给每个挂起 promise 补了 catch，与延迟自然到期完全同构）。
 *
 * @param host - 宿主；基本类型 / null 时为 no-op（装饰 store action 时同样定位不到状态，
 *        见模块头）
 * @param method - 只立即执行该名字的被装饰方法；省略时覆盖该宿主上所有防抖方法
 */
export function flushDebouncedCalls(host: unknown, method?: string | symbol): void {
  for (const slot of collectDebounceSlots(host, method)) {
    // 只认定时器：timeoutId 为 null 即「没有等待中的调用」，此时不得凭空执行原方法
    if (slot.timeoutId === null) {
      continue
    }
    void runPendingCalls(slot)
  }
}

/**
 * 释放宿主上的全部防抖状态（取消挂起调用 + 删除该宿主的状态表）
 *
 * 相当于 `cancelDebouncedCalls(host)` 之后再删掉该宿主的整张状态表：挂起队列、
 * 定时器引用、方法槽位一并释放，此后若还有代码持有该宿主并调用被装饰方法，
 * 会从零重新建状态。卸载点上想「一切从简」可以只调本函数。
 *
 * 与 `cancelDebouncedCalls` 一样对任何入参安全：宿主为基本类型 / null、
 * 或本就没有防抖状态时都是 no-op（被取消的 Promise 同样以「已取消」拒绝）。
 *
 * @param host - 宿主；基本类型 / null、以及装饰 store action 时的 action 上下文代理都定位不到
 *        状态（见模块头），此时本函数为 no-op
 */
export function disposeDebouncedState(host: unknown): void {
  if (!isTrackableHost(host)) {
    return
  }
  for (const slot of collectDebounceSlots(host, undefined)) {
    cancelPendingCalls(slot)
  }
  debounceStates.delete(host)
}
