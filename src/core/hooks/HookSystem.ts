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
 * @since 1.0.0
 */

import type { Store } from '../../types/store'
import type { HookName, HookHandler, IHookSystem, Plugin } from '../../types/plugin'
import { isProduction } from '../store/utils'

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
      this.hooks.get(hookName)?.delete(handler)
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
        console.error('[GeomStore] Error in hook ' + hookName + ':', error)
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
 */
export function usePlugin(plugin: Plugin, store: Store): () => void {
  try {
    const uninstall = plugin.install(store)
    if (!isProduction()) {
      console.log(`[GeomStore] Plugin "${plugin.name}" installed`)
    }

    return () => {
      if (typeof uninstall === 'function') {
        uninstall()
      }
      if (!isProduction()) {
        console.log(`[GeomStore] Plugin "${plugin.name}" uninstalled`)
      }
    }
  } catch (error) {
    console.error(`[GeomStore] Failed to install plugin "${plugin.name}":`, error)
    return () => {}
  }
}
