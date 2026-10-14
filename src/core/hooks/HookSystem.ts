/**
 * HookSystem - 钩子系统实现
 *
 * 职责：
 * - 提供 Store 生命周期钩子的注册/触发/清理
 * - 提供插件安装辅助函数 usePlugin
 *
 * 类型契约来自 types/plugin.ts（IHookSystem），本模块是实现层。
 * 依赖方向：plugins → core/hooks → types，core 不再反向依赖 plugins。
 *
 * @module HookSystem
 */

import type { Actions, Getters, State, Store } from '../../types/store.js'
import type { HookName, HookHandler, IHookSystem, Plugin } from '../../types/plugin.js'
import { isProduction } from '../store/utils.js'

/** 每次 on() 产出一条注册记录。用对象身份而非 handler 本身作为 Set 成员，
 *  使同一 handler 的多次注册互相独立——clear() 后旧句柄 delete 的是已不存在的记录，
 *  不会误删重新建立的新注册 */
interface HookRegistration {
  handler: HookHandler
}

/** 钩子系统实现类，每个 Store 实例独立拥有一个 HookSystem 实例 */
export class HookSystem implements IHookSystem {
  private hooks: Map<HookName, Set<HookRegistration>> = new Map()
  // onError 重入守卫：防止 onError 处理器间接触发新的 onError 导致无限递归栈溢出
  // （直接递归由 hookName !== 'onError' 拦截，间接递归——如 onError 处理器 emit 另一个钩子、
  // 那个钩子的处理器又抛错——需要这面额外的旗帜）
  private isEmittingOnError = false

  on(hookName: HookName, handler: HookHandler): () => void {
    let handlers = this.hooks.get(hookName)
    if (!handlers) {
      handlers = new Set()
      this.hooks.set(hookName, handlers)
    }
    const registration: HookRegistration = { handler }
    handlers.add(registration)

    // 句柄持有注册记录的对象引用。delete 按身份匹配，只移除自己那次注册：
    // clear() 后记录已从 Set 中消失，旧句柄的 delete 是 no-op，
    // 同一 handler 重新注册产出的新记录不受影响
    let unsubscribed = false
    return () => {
      if (unsubscribed) return
      unsubscribed = true
      const current = this.hooks.get(hookName)
      if (!current) return
      current.delete(registration)
      if (current.size === 0) {
        this.hooks.delete(hookName)
      }
    }
  }

  emit(hookName: HookName, ...args: unknown[]): void {
    const handlers = this.hooks.get(hookName)
    if (!handlers || handlers.size === 0) return

    const snapshot = [...handlers]
    for (const reg of snapshot) {
      try {
        reg.handler(...args)
      } catch (error) {
        // 与 SubscriptionManager.notify 的监听器异常同口径：开发期打印定位来源，
        // 生产期控制台静默、只走下方 onError 转投。不门控的代价是实打实的——
        // 钩子挂在 setState / dispatch 的写路径热线上，一个持续抛错的处理器
        // （典型：接监控的 onError 处理器自身有 bug）会在生产每次写入都打印一遍
        if (!isProduction()) {
          console.error(`[GeomStore] Error in hook ${hookName}:`, error)
        }
        // 直接递归（onError 处理器自身抛错）与间接递归（onError 处理器触发的其他钩子抛错）
        // 都要拦截：isEmittingOnError 旗帜覆盖整个 onError 分发链
        if (hookName !== 'onError' && !this.isEmittingOnError) {
          this.isEmittingOnError = true
          try {
            this.emit('onError', error, hookName)
          } finally {
            this.isEmittingOnError = false
          }
        }
      }
    }
  }

  clear(hookName?: HookName): void {
    if (hookName) {
      this.hooks.delete(hookName)
    } else {
      this.hooks.clear()
    }
  }

  /**
   * 获取钩子数量
   *
   * 注意双语义：无参时返回已注册的钩子种类数；传入 hookName 时返回
   * 该钩子当前的监听器数量。如需语义明确，推荐使用 listenerCount()。
   */
  size(hookName?: HookName): number {
    if (hookName) {
      return this.hooks.get(hookName)?.size || 0
    }
    return this.hooks.size
  }

  /**
   * 获取指定钩子的监听器数量
   *
   * size() 的语义明确别名：避免无参/有参返回不同量纲导致的误用。
   */
  listenerCount(hookName: HookName): number {
    return this.hooks.get(hookName)?.size || 0
  }
}

/**
 * 安装插件到 Store（带日志与错误兜底）
 *
 * 泛型**只从 store 参数反推**（`plugin` 上的 S 用 `NoInfer` 排除）：该位置处于逆变，
 * 若参与推断会把 S 拉回约束 `State`，导致具体 Store 被判为不可赋值。
 *
 * 备选方案「独立类型参数 `P extends Plugin<S>`」已实测否决：宽插件（`Plugin<State>`）
 * 会在约束校验时因 `Store` 自身含 `use` 成员而递归比较失败。故保留 `NoInfer`，
 * 其最低 TS 版本要求（≥ 5.4）已在 README 与 CHANGELOG 中声明。
 *
 * `plugin` 需与 store 的状态类型匹配；状态无关的插件写作 `Plugin<State>`（如 `loggerPlugin`），
 * 对任意 Store 都适用。
 *
 * 失败语义分两类：插件安装自身失败（含 plugin 形状非法）按 PLUGIN-002 降级——
 * `console.error` 上报并返回空卸载函数，不拖垮 Store 初始化；
 * 而在**已销毁的 Store** 上安装属调用方误用，`store.use` 抛出的原始异常原样冒泡
 * （该异常不是「可选插件失败」，静默降级会让调用方拿到一个从未安装的插件还误以为成功）。
 */
export function usePlugin<S extends State, A extends Actions, G extends Getters<S>>(
  plugin: Plugin<NoInfer<S>> | Plugin<State>,
  store: Store<S, A, G>,
): () => void {
  let uninstall: () => void
  try {
    // 委托给 store.use：插件需登记进宿主，destroy() 才会执行清理、重复安装才会被识别。
    // 此前直接调 plugin.install，绕过登记：destroy() 不卸载、与 store.use 混用会双重安装、
    // 全局入口（如 timeTravelPlugin）在销毁后残留
    uninstall = store.use(plugin as Plugin<S>)
  } catch (error) {
    // 「对已销毁 Store 调用 use」是调用方误用，不是插件安装故障：Store.use 的 @throws
    // 已把它写进契约，PLUGIN-002 的静默降级只针对后者。一并吞掉会让调用方失去
    // 唯一的可编程信号（拿到一个空卸载函数，插件其实从未安装）
    if (store.destroyed) {
      throw error
    }
    // 兜底分支自身不得再抛：install 失败很可能源于 plugin 为 null/形状非法
    // （store.use 读取 plugin.install 时即抛 TypeError），直接取 plugin.name 会抛出
    // 第二个 TypeError 顶掉原始错误，调用方只看到「Cannot read properties of undefined」
    const pluginName = (plugin as { name?: string } | null | undefined)?.name ?? 'unknown'
    console.error(`[GeomStore] Failed to install plugin "${pluginName}":`, error)
    // 失败以 console.error 上报并返回空卸载函数（既有契约 PLUGIN-002）：
    // 此处不抛错是为了让「可选插件」失败不拖垮 Store 初始化
    return () => {}
  }

  if (!isProduction()) {
    console.debug(`[GeomStore] Plugin "${plugin.name}" installed`)
  }

  return () => {
    uninstall()
    if (!isProduction()) {
      console.debug(`[GeomStore] Plugin "${plugin.name}" uninstalled`)
    }
  }
}
