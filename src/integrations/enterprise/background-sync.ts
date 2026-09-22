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
      // 防御：Store 被外部直接销毁而未注销时，跳过并自清理，
      // 避免 dispatch 因 destroyed 检查抛错中断 App.onShow 生命周期
      if (handler.store.destroyed) {
        const index = backgroundSyncHandlers.indexOf(handler)
        if (index !== -1) {
          backgroundSyncHandlers.splice(index, 1)
        }
        continue
      }

      const inactiveDuration = now - handler.lastActiveTime
      if (inactiveDuration > handler.maxInactiveTime) {
        logger.log('BackgroundSync', `非活跃时间过长(${inactiveDuration}ms)，刷新状态`)
        if ('refreshData' in handler.store.actions) {
          try {
            // 异步 action 的 rejection 不会被同步 try/catch 捕获，
            // 显式接住避免 unhandled rejection
            Promise.resolve(handler.store.dispatch('refreshData')).catch((error) => {
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
      handler.lastActiveTime = Date.now()
      try {
        handler.onBackground?.()
      } catch (error) {
        logger.error('BackgroundSync', 'onBackground 回调执行失败:', error)
      }
    }
  }

  const wrappedApp = function (this: unknown, options: Record<string, unknown> = {}): unknown {
    // 先按 typeof 校验再取用户回调：options 来自 App({...})，JS 调用方或 `as any`
    // 可传入非函数的真值（字符串/对象）。可选链 `userOnShow?.apply` 不校验可调用性，
    // 会抛 TypeError 并让本次 onShow 之后的生命周期逻辑一并中断
    const userOnShow = typeof options.onShow === 'function' ? (options.onShow as (this: unknown, ...args: unknown[]) => void) : undefined
    const userOnHide = typeof options.onHide === 'function' ? (options.onHide as (this: unknown, ...args: unknown[]) => void) : undefined

    // 先执行时效性检查再调用用户回调，保证切前台时状态刷新优先
    options.onShow = function (this: unknown, ...args: unknown[]): void {
      runForegroundChecks()
      userOnShow?.apply(this, args)
    }
    options.onHide = function (this: unknown, ...args: unknown[]): void {
      runBackgroundChecks()
      userOnHide?.apply(this, args)
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
 * 已有处理器注册表原样保留（新包装遍历同一注册表，清空只会丢弃其他调用方的注册）
 */
export function initBackgroundSync<S extends State = State>(config: BackgroundSyncConfig<S>): void {
  const { store, maxInactiveTime = DEFAULT_MAX_INACTIVE_MS, onForeground, onBackground } = config

  const globalObj = globalThis as { App?: unknown }
  if (typeof globalObj.App !== 'function') return

  if (globalObj.App !== installedAppWrapper) {
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
