/**
 * GeomStore v1.0.0 - App 集成
 *
 * 提供 Store 与微信小程序 App 的集成方案，包括：
 * - withAppStore: App 集成
 * - 自动状态同步到 globalData
 * - Action 绑定到 App 实例
 * - 调试 API 暴露
 * - 自动清理订阅
 *
 * @since 1.0.0
 */

import type { Store, State, Actions, Getters } from '../types/store'
import type { ConnectOptions } from '../types/integration'
import { parseMapping, bindMappings, cleanupBindings, exposeStoreAPI, performAutoInject } from './utils'

export type { ConnectOptions } from '../types/integration'

// ==================== 类型定义 ====================

interface AppOptions {
  globalData?: Record<string, unknown>
  onLaunch?(this: AppOptions, ...args: unknown[]): void
  onShow?(...args: unknown[]): void
  onHide?(): void
  onError?(error: unknown): void
  [key: string]: unknown
}

// ==================== App 集成 ====================

/**
 * App 集成函数
 *
 * 将 Store 连接到微信小程序 App，自动管理状态同步和订阅清理
 *
 * 类型推断：`S` / `A` / `G` 均从 store 参数自动推断，
 * mapState / mapGetters / mapActions 的键与值拼错时会在编译期报错；
 * 返回的装饰器保持传入 App 配置的原始类型（不擦除自定义方法/生命周期类型）
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns {(AppConfig: C) => C} App 装饰器（保持配置类型）
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { withAppStore } from '@openlide/geomstore/integrations'
 *
 * const store = createStore({
 *   name: 'app',
 *   state: { userInfo: null, config: {}, theme: 'light' },
 *   actions: {
 *     async initApp() {
 *       const config = await fetchConfig()
 *       this.setState('config', config)
 *     },
 *     setTheme(theme) {
 *       this.setState('theme', theme)
 *     }
 *   }
 * })
 *
 * // 简写：数组形式
 * App(withAppStore(store, {
 *   mapState: ['userInfo', 'config', 'theme'],
 *   mapActions: ['initApp', 'setTheme']
 * })({
 *   globalData: { otherData: '...' },
 *   onLaunch() {
 *     console.log(this.globalData.userInfo)
 *     this.initApp()
 *     this.setTheme('dark')
 *   }
 * }))
 *
 * // 高级用法：对象形式
 * App(withAppStore(store, {
 *   mapState: {
 *     user: 'userInfo',
 *     appConfig: 'config',
 *     currentTheme: 'theme'
 *   },
 *   mapActions: {
 *     doInit: 'initApp',
 *     changeTheme: 'setTheme'
 *   }
 * })({
 *   globalData: { otherData: '...' },
 *   onLaunch() {
 *     console.log(this.globalData.user)
 *     this.doInit()
 *     this.changeTheme('dark')
 *   }
 * }))
 *
 * // 调试 API
 * // 在其他 Page 或 Component 中访问：
 * const app = getApp()
 * app.getStore()           // 获取 store 实例
 * app.getState()           // 获取状态
 * app.dispatch('xxx')      // dispatch action
 * app.subscribe(callback)   // 订阅状态变化
 * ```
 */
export function withAppStore<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  store: Store<S, A, G>,
  options: ConnectOptions<S, A, G> = {},
) {
  // 解析映射配置
  const stateMapping: Record<string, string> = options.mapState ? parseMapping(options.mapState) : {}
  const gettersMapping = options.mapGetters ? parseMapping(options.mapGetters) : {}
  const actionsMapping = options.mapActions ? parseMapping(options.mapActions) : {}

  // 解析注入映射配置
  const injectMapping = options.injectMapping || {}

  return function <C extends AppOptions>(AppConfig: C): C {
    // 订阅清理列表：App 生命周期贯穿整个小程序运行期，
    // 仅在订阅建立前重置（防止重复绑定），不在 onHide 等生命周期中清理
    const unbindFunctions: Array<() => void> = []
    const enhancedConfig: AppOptions = { ...AppConfig }

    // 扩展 onLaunch
    const originalOnLaunch = enhancedConfig.onLaunch
    enhancedConfig.onLaunch = function (this: AppOptions, ...args: unknown[]) {
      // 防御重复绑定：若已存在订阅（极端情况下 onLaunch 被多次调用），先清理旧订阅
      if (unbindFunctions.length > 0) {
        cleanupBindings(unbindFunctions)
      }

      // 确保 globalData 存在
      if (!this.globalData) {
        this.globalData = {}
      }

      // 辅助函数：订阅 store 变化
      const subscribeStore = (callback: () => void) => store.subscribe(callback)

      // 绑定 state 到 globalData
      if (options.mapState) {
        const unbindState = bindMappings(
          this.globalData,
          stateMapping,
          (storeKey) => store.state[storeKey as keyof S],
          (updates) => {
            Object.assign(this.globalData as Record<string, unknown>, updates)
          },
          subscribeStore,
        )
        unbindFunctions.push(...unbindState)
      }

      // 绑定 getters 到 globalData
      if (options.mapGetters) {
        const unbindGetters = bindMappings(
          this.globalData,
          gettersMapping,
          (storeKey) => store.getter(storeKey),
          (updates) => {
            Object.assign(this.globalData as Record<string, unknown>, updates)
          },
          subscribeStore,
        )
        unbindFunctions.push(...unbindGetters)
      }

      // 绑定 actions 到 App 实例方法
      if (options.mapActions) {
        Object.entries(actionsMapping).forEach(([localName, actionName]) => {
          this[localName] = (...args: unknown[]) => {
            return store.dispatch(actionName, ...args)
          }
        })
      }

      // 自动注入（使用getCached）
      if (options.autoInject && injectMapping) {
        performAutoInject(this, injectMapping, store, (updates: Record<string, unknown>) => {
          Object.assign(this.globalData as Record<string, unknown>, updates)
        })
      }

      // 暴露 Store API 到 App 实例
      exposeStoreAPI(this, store)

      // 调用原始 onLaunch
      originalOnLaunch?.call(this, ...args)
    }

    // 注意：不在 onHide 中清理订阅。
    // App 切后台/回前台会在小程序运行期内反复发生，而订阅建立于 onLaunch，
    // 若在 onHide 清理且不重建，首次切后台后状态同步将永久失效。
    // App 级订阅的生命周期与小程序运行期一致，无需主动清理。

    return enhancedConfig as C
  }
}

/**
 * 创建 App 实例工厂
 *
 * 语义化别名，等同于 withAppStore，用于更直观的 API 调用
 *
 * 类型推断与 withAppStore 一致：`S` / `A` / `G` 从 store 参数自动推断，
 * 映射键拼错编译期报错；装饰器保持传入配置的原始类型
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns {(AppConfig: C) => C} App 装饰器（保持配置类型）
 *
 * @example
 * ```typescript
 * // 两种方式等价，选择更符合语义的即可
 * App(withAppStore(store, options))  // 明确表示"集成 Store"
 * App(createApp(store, options))     // 明确表示"创建 App"
 * ```
 */
export function createApp<S extends State = State, A extends Actions = Actions, G extends Getters<S> = Getters<S>>(
  store: Store<S, A, G>,
  options: ConnectOptions<S, A, G> = {},
) {
  return withAppStore(store, options)
}
