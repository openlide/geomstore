/**
 * GeomStore - 微信小程序企业级方案：后台/前台状态同步
 *
 * 自 wechat-enterprise.ts 拆出。以「仅包装一次全局 App」的方式拦截 onShow/onHide，
 * 在切前台时按注册表逐个检查 store 时效性并触发 refreshData。
 */

import type { Store, State } from '../../types/store.js'
import { logger, DEFAULT_MAX_INACTIVE_MS } from './env.js'

/**
 * 单个 Store 的后台 / 前台同步配置
 */
export interface BackgroundSyncConfig<S extends State = State> {
  /** 需要做时效性检查的 Store */
  store: Store<S>
  /** 允许的最长非活跃时长（毫秒）：切前台时超过该时长会触发 `refreshData`；默认 5 分钟 */
  maxInactiveTime?: number
  /** 切前台回调（在时效性检查之后执行） */
  onForeground?: () => void
  /** 切后台回调 */
  onBackground?: () => void
}

/**
 * 单个后台同步注册项
 */
interface BackgroundSyncHandler {
  store: Store<State>
  maxInactiveTime: number
  onForeground?: () => void
  onBackground?: () => void
  lastActiveTime: number
}

/** 模块级注册表：多次 initBackgroundSync 共享同一份生命周期包装 */
const backgroundSyncHandlers: BackgroundSyncHandler[] = []

/** 已包装的 App 配置标记（#357）：包装就地改写 options.onShow/onHide，
 *  宿主缓存同一份 config 再次 App(config)（热重载、测试重复调用全局 App）时，
 *  若不识别已包装的入参就会二次包装——检查与 refreshData 随包装轮数成倍执行 */
const wrappedOptionsFlag = Symbol.for('geomstore.backgroundSync.wrappedOptions')

/** 前台刷新用的 action 名（#358）：守卫与 dispatch 共用同一常量，
 *  action 改名时只需改这里，否则 `'refreshData' in actions` 静默为 false、
 *  前台刷新变成无提示的空操作 */
const REFRESH_DATA_ACTION = 'refreshData'

/** 已安装的全局 App 构造器包装函数引用，用于检测是否需要重新安装 */
let installedAppWrapper: ((this: unknown, options?: Record<string, unknown>) => unknown) | null = null

/**
 * 包装全局 App 构造函数以拦截 options.onShow / options.onHide（仅安装一次）
 *
 * 微信小程序中用户生命周期回调通过 App({ onShow, onHide }) 的 options 注册，
 * 框架直接调用 options 上的回调；修改 App.prototype 既不会触发包装、也链不到用户回调。
 * 故改为替换全局 App 为包装函数：先包装 options 回调再调用原始 App，
 * 包装函数遍历注册表执行各 Store 的时效性检查，避免重复初始化时包装层层叠加。
 *
 * 注意：必须在 App(options) 被调用之前完成 initBackgroundSync（如在 app.js 顶层
 * import 后立即初始化），否则无法拦截已创建的 App 实例注册的回调。
 */
function installAppLifecycleHooks(): void {
  const globalObj = globalThis as { App?: (this: unknown, options?: Record<string, unknown>) => unknown }
  const originalApp = globalObj.App
  /* istanbul ignore next -- 调用方（ensureAppLifecycleHooks / initBackgroundSync）已先行校验，此处为二次防御 */
  if (typeof originalApp !== 'function') return

  const runForegroundChecks = (): void => {
    const now = Date.now()

    for (const handler of [...backgroundSyncHandlers]) {
      // 回调重入：上一个 handler 的 onForeground / refreshData 副作用可能注销掉
      // 快照里尚未遍历到的条目（如登出另一个账号）。快照不再反映现状，
      // 以注册表当前下标为准：-1 即已注销，本轮不得再回调
      const currentIndex = backgroundSyncHandlers.indexOf(handler)
      if (currentIndex === -1) continue
      // 防御：Store 被外部直接销毁而未注销时，跳过并自清理，
      // 避免 dispatch 因 destroyed 检查抛错中断 App.onShow 生命周期
      if (handler.store.destroyed) {
        // 上方取位已证明它仍在注册表中，且两次语句之间没有可重入的回调，
        // 再查一次并保留 -1 分支只会留下永远走不到的死代码
        backgroundSyncHandlers.splice(currentIndex, 1)
        continue
      }

      const inactiveDuration = now - handler.lastActiveTime
      if (inactiveDuration > handler.maxInactiveTime) {
        logger.log('BackgroundSync', `非活跃时间过长(${inactiveDuration}ms)，刷新状态`)
        // 自有属性判定而非 `in`（#358）：`in` 沿原型链查找，原型上挂着同名成员时
        // 守卫会为它放行，而核心 dispatch 只认自有 action（否则 ACTION_NOT_FOUND），
        // 结果是一次注定失败的 dispatch 被记成「刷新状态失败」；
        // 与 core dispatch、offline.executeAction 的校验口径对齐
        if (Object.prototype.hasOwnProperty.call(handler.store.actions, REFRESH_DATA_ACTION)) {
          try {
            // 异步 action 的 rejection 不会被同步 try/catch 捕获，
            // 显式接住避免 unhandled rejection
            Promise.resolve(handler.store.dispatch(REFRESH_DATA_ACTION)).catch((error) => {
              logger.error('BackgroundSync', '刷新状态失败:', error)
            })
          } catch (error) {
            // 单个 store 刷新失败不应沿 App.onShow 传播：
            // 否则后续 handler 被跳过、用户自己的 onShow 回调不再执行
            logger.error('BackgroundSync', '刷新状态失败:', error)
          }
        }
      }
      handler.lastActiveTime = now
      try {
        handler.onForeground?.()
      } catch (error) {
        logger.error('BackgroundSync', 'onForeground 回调执行失败:', error)
      }
    }
  }

  const runBackgroundChecks = (): void => {
    for (const handler of [...backgroundSyncHandlers]) {
      // 与前台同口径：onBackground 回调里注销的处理器不得在本轮继续被调用
      if (!backgroundSyncHandlers.includes(handler)) continue
      handler.lastActiveTime = Date.now()
      try {
        handler.onBackground?.()
      } catch (error) {
        logger.error('BackgroundSync', 'onBackground 回调执行失败:', error)
      }
    }
  }

  const wrappedApp = function (this: unknown, options: Record<string, unknown> = {}): unknown {
    // 默认参数只挡 `undefined`：`App(null)` / `App('x')` / `App(123)` 会让 options 非空但
    // 不是对象，下一行的属性读取即抛 TypeError，`options.onShow = ...` 与 defineProperty
    // 在严格模式（ESM）下同样抛错——包装器把一次本来会被基础库忽略的调用变成了
    // App 启动失败。非对象实参一律原样透传，不做任何包装。
    const rawOptions = options as unknown
    if (rawOptions === null || typeof rawOptions !== 'object') {
      return originalApp.call(this, rawOptions as Record<string, unknown>)
    }

    // 同一份配置二次进入（宿主缓存 config、热重载、测试重复调用全局 App）：
    // 回调已是本包装产物，直接透传，避免叠加包装导致检查按轮数翻倍执行
    // （symbol 键需显式走 Record<symbol, unknown> 视角：options 的声明类型只有字符串索引）
    if ((options as Record<symbol, unknown>)[wrappedOptionsFlag] === true) {
      return originalApp.call(this, options)
    }

    // 先按 typeof 校验再取用户回调：options 来自 App({...})，JS 调用方或 `as any`
    // 可传入非函数的真值（字符串/对象）。可选链 `userOnShow?.apply` 不校验可调用性，
    // 会抛 TypeError 并让本次 onShow 之后的生命周期逻辑一并中断
    const userOnShow = typeof options.onShow === 'function' ? (options.onShow as (this: unknown, ...args: unknown[]) => void) : undefined
    const userOnHide = typeof options.onHide === 'function' ? (options.onHide as (this: unknown, ...args: unknown[]) => void) : undefined

    // 先执行时效性检查再调用用户回调，保证切前台时状态刷新优先。
    // 注入与下方的标记写入必须同口径兜底：ESM 严格模式下给冻结对象、只读数据属性
    // 或无 setter 的访问器赋值会直接抛 TypeError，此前只有 defineProperty 有 try/catch，
    // 于是「不可写的 options」这一本已被容忍的场景反而让 App(options) 启动失败
    try {
      options.onShow = function (this: unknown, ...args: unknown[]): void {
        runForegroundChecks()
        userOnShow?.apply(this, args)
      }
      options.onHide = function (this: unknown, ...args: unknown[]): void {
        runBackgroundChecks()
        userOnHide?.apply(this, args)
      }
    } catch (error) {
      // 赋值抛错的那一侧未被改写（另一侧若已改写则保留，其检查照常生效）；
      // 这里只损失对应侧的时效性检查，配置本身照常交给宿主 App
      logger.warn('BackgroundSync', 'options 的生命周期属性不可写（已冻结或为只读访问器），跳过该侧后台同步包装:', error)
      return originalApp.call(this, options)
    }
    // 标记写入用 defineProperty + 不可枚举：options 会被框架与宿主 Object.keys/展开遍历，
    // 多出一个可枚举键会改变配置对象的可见形状。
    // 写入失败（宿主把 options 冻结前只 seal 了自有键等不可扩展场景）不阻断生命周期：
    // 少一个标记最多退化为「下次重复包装」（即修复前的行为），抛错却会让 App 起不来
    try {
      Object.defineProperty(options, wrappedOptionsFlag, { value: true, enumerable: false, configurable: true })
    } catch {
      /* 不可扩展的 options：放弃标记，其余包装逻辑照常生效 */
    }
    return originalApp.call(this, options)
  }

  // 保持原型链，使 instanceof / new 语义不受影响（基础库可能以构造器形式使用 App）
  try {
    Object.setPrototypeOf(wrappedApp, originalApp)
    ;(wrappedApp as { prototype?: unknown }).prototype = (originalApp as { prototype?: unknown }).prototype
  } catch {
    // setPrototypeOf 失败（极少见）时忽略，仅丢失静态属性继承
  }

  globalObj.App = wrappedApp
  installedAppWrapper = wrappedApp
}

/**
 * 确保全局 App 已被本模块包装（幂等，不触碰处理器注册表）
 *
 * 与 initBackgroundSync 的区别：后者在「全局 App 被外部替换」时还会为保留已有处理器
 * 给出告警；本函数只负责把包装就位，供 createEnterpriseApp 在返回配置前调用——包装通过
 * 替换全局 App 来拦截 options.onShow/onHide，必须早于 App(options) 执行，否则拦截不到
 * 任何回调。
 */
export function ensureAppLifecycleHooks(): void {
  const globalObj = globalThis as { App?: unknown }
  if (typeof globalObj.App !== 'function') return
  if (globalObj.App === installedAppWrapper) return
  installAppLifecycleHooks()
}

/**
 * 注销指定 Store 的后台同步处理器
 *
 * 账号切换/登出时应调用，避免已销毁 Store 的处理器残留在注册表中，
 * 导致下次 onShow 触发 dispatch 抛错中断生命周期。
 */
export function unregisterBackgroundSync<S extends State = State>(store: Store<S>): void {
  const target = store as unknown as Store<State>
  const index = backgroundSyncHandlers.findIndex((handler) => handler.store === target)
  if (index !== -1) {
    backgroundSyncHandlers.splice(index, 1)
  }
}

/**
 * 初始化后台/前台状态同步
 * 在小程序从后台返回前台时检查状态时效性
 *
 * 多次调用不会重复包装全局 App：
 * 若全局 App 仍为本模块安装的包装函数，则仅注册新的处理器；
 * 若全局 App 已被外部替换（如测试重置），则重新安装包装，
 * 已有处理器注册表原样保留（新包装遍历同一注册表，清空只会丢弃其他调用方的注册）；
 * 若全局 App 尚不存在，处理器仍登记（注册表与包装相互独立），并告警提示
 * 生命周期拦截要等 App 就位后安装
 */
export function initBackgroundSync<S extends State = State>(config: BackgroundSyncConfig<S>): void {
  const { store, maxInactiveTime = DEFAULT_MAX_INACTIVE_MS, onForeground, onBackground } = config

  const globalObj = globalThis as { App?: unknown }
  if (typeof globalObj.App !== 'function') {
    // 注册表独立于 App 包装：这里照常登记，等 App 就位后由 ensureAppLifecycleHooks
    // 或下一次 initBackgroundSync 安装包装即可生效。此前直接 return 会把处理器
    // 静默丢弃，调用方看不出任何差别（非小程序宿主/测试环境尤易触发）
    logger.warn('BackgroundSync', 'App 构造器当前不可用，处理器已登记但生命周期拦截要等 App 就位后安装')
  } else if (globalObj.App !== installedAppWrapper) {
    // 全局 App 被外部替换：重装后的新包装遍历的仍是同一个模块级注册表，
    // 旧条目照样会被调用。此前在此清空整表，会静默丢弃其他调用方
    // （另一处 initBackgroundSync）已注册的处理器，且无任何重新注册的机会
    if (backgroundSyncHandlers.length > 0) {
      logger.warn('BackgroundSync', `全局 App 构造器已被替换，已重新安装包装并保留 ${backgroundSyncHandlers.length} 个已注册的处理器`)
    }
    installAppLifecycleHooks()
  }

  // 幂等注册：同一 Store 重复 init 时替换旧处理器，避免重复刷新
  unregisterBackgroundSync(store)

  backgroundSyncHandlers.push({
    store: store as unknown as Store<State>,
    maxInactiveTime,
    onForeground,
    onBackground,
    lastActiveTime: Date.now(),
  })
}
