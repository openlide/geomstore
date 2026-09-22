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

/** 钩子系统实现类，每个 Store 实例独立拥有一个 HookSystem 实例 */
export class HookSystem implements IHookSystem {
  private hooks: Map<HookName, Set<HookHandler>> = new Map()

  on(hookName: HookName, handler: HookHandler): () => void {
    let handlers = this.hooks.get(hookName)
    if (!handlers) {
      handlers = new Set()
      this.hooks.set(hookName, handlers)
    }
    handlers.add(handler)

    return () => {
      const handlers = this.hooks.get(hookName)
      if (!handlers) return
      handlers.delete(handler)
      // 最后一个监听者退订即摘键：留下空 Set 会让无参 size()（「已注册钩子种类数」）
      // 在全部退订后仍把该钩子计为在册，观测值与真实状态永久背离
      if (handlers.size === 0) {
        this.hooks.delete(hookName)
      }
    }
  }

  emit(hookName: HookName, ...args: unknown[]): void {
    const handlers = this.hooks.get(hookName)
    if (!handlers || handlers.size === 0) return

    // 迭代前快照，防止 handler 内部调用 on()/unsubscribe() 修改 Set 导致意外行为
    const snapshot = [...handlers]
    for (const handler of snapshot) {
      try {
        handler(...args)
      } catch (error) {
        // 有意不加 isProduction() 门控（与 usePlugin 的 console.debug 不同）：
        // 这里抛出的是使用者 handler 的真实故障，且已同时转投 onError 钩子；
        // 钩子没有内建的失败上报通道，生产静默会让故障完全不可见。
        // 需要收敛输出请在 onError 里自行接监控（错误已被再次 emit 出来）
        console.error(`[GeomStore] Error in hook ${hookName}:`, error)
        if (hookName !== 'onError') {
          this.emit('onError', error, hookName)
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
 */
export function usePlugin<S extends State, A extends Actions, G extends Getters<S>>(plugin: Plugin<NoInfer<S>> | Plugin<State>, store: Store<S, A, G>): () => void {
  try {
    // 委托给 store.use：插件需登记进宿主，destroy() 才会执行清理、重复安装才会被识别。
    // 此前直接调 plugin.install，绕过登记：destroy() 不卸载、与 store.use 混用会双重安装、
    // 全局入口（如 timeTravelPlugin）在销毁后残留
    const uninstall = store.use(plugin as Plugin<S>)
    if (!isProduction()) {
      console.debug(`[GeomStore] Plugin "${plugin.name}" installed`)
    }

    return () => {
      uninstall()
      if (!isProduction()) {
        console.debug(`[GeomStore] Plugin "${plugin.name}" uninstalled`)
      }
    }
  } catch (error) {
    // 兜底分支自身不得再抛：install 失败很可能源于 plugin 为 null/形状非法
    // （store.use 读取 plugin.install 时即抛 TypeError），直接取 plugin.name 会抛出
    // 第二个 TypeError 顶掉原始错误，调用方只看到「Cannot read properties of undefined」
    const pluginName = (plugin as { name?: string } | null | undefined)?.name ?? 'unknown'
    console.error(`[GeomStore] Failed to install plugin "${pluginName}":`, error)
    // 失败以 console.error 上报并返回空卸载函数（既有契约 PLUGIN-002）：
    // 此处不抛错是为了让「可选插件」失败不拖垮 Store 初始化
    return () => {}
  }
}
