/**
 * GeomStore - App 集成
 *
 * 提供 Store 与微信小程序 App 的集成方案，包括：
 * - withAppStore: App 集成
 * - 自动状态同步到 globalData
 * - Action 绑定到 App 实例
 * - 调试 API 暴露
 * - 自动清理订阅
 *
 */

import type { Store, State, Actions, Getters } from '../types/store.js'
import type { AppThis, ConnectOptions, WithPageThis } from '../types/integration.js'
import { resolveMappings, createStoreSubscriber, bindMappings, bindActions, cleanupBindings, exposeStoreAPI, performAutoInject } from './utils.js'

export type { ConnectOptions } from '../types/integration.js'

// ==================== 类型定义 ====================

/**
 * `withAppStore` 处理的 App 配置对象
 *
 * 保留微信原生 App 生命周期与自定义字段，集成层在此基础上注入 store 相关能力。
 */
export interface AppOptions {
  /** 全局数据对象（微信原生字段） */
  globalData?: Record<string, unknown>
  /**
   * 应用启动生命周期
   *
   * 这里**刻意不声明 `this`**：运行时传入的是增强后的 App 实例（globalData 上的映射状态、
   * 绑定的 action、调试 API），精确类型由 withAppStore 注入的 `AppThis` 提供。
   * 若在此写成 `this: AppOptions`，会覆盖注入结果，并使 `this.globalData` 退回可选。
   */
  onLaunch?(...args: unknown[]): void
  /** 应用切前台生命周期 */
  onShow?(...args: unknown[]): void
  /** 应用切后台生命周期 */
  onHide?(): void
  /** 全局错误回调 */
  onError?(error: unknown): void
  /** 允许业务扩展自定义字段 */
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
 * 返回的装饰器保持传入 App 配置的原始类型（不擦除自定义方法/生命周期类型）。
 *
 * 生命周期内的 `this` 自动获得注入后的实例类型（`AppThis`）：映射的 state/getters
 * 出现在 `globalData` 上、映射的 action 与调试 API 直接挂在实例上，**无需手写 this 标注**。
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns App 装饰器（保持配置类型，并注入方法 this）
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
 * // 简写：数组形式（this.globalData / 注入的 action 均有类型，无需手写 this）
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
  // 解析映射与注入配置（与 Page/Component 集成共用 resolveMappings）
  const { stateMapping, gettersMapping, actionsMapping, injectMapping } = resolveMappings(options)

  // 与 withPageStore 同款注入：WithPageThis 既为 C 提供推断位点（传入的字面量反向推断出 C，
  // 返回类型据此保留自定义生命周期/字段），又把顶层方法的 this 重写为注入后的实例类型；
  // AppThis 交叉 C，从而保留 globalData 的自定义字段
  return function <C extends AppOptions>(
    AppConfig: WithPageThis<C, AppThis<S, A, G, ConnectOptions<S, A, G>, C>> & ThisType<AppThis<S, A, G, ConnectOptions<S, A, G>, C>>,
  ): C {
    // 订阅清理列表：App 生命周期贯穿整个小程序运行期，
    // 仅在订阅建立前重置（防止重复绑定），不在 onHide 等生命周期中清理
    const unbindFunctions: Array<() => void> = []
    // 入参类型已被 WithPageThis 重写（方法 this 为注入后的实例类型），
    // 运行时取值与原配置一致，故此处显式收窄回 AppOptions
    const enhancedConfig = { ...AppConfig } as unknown as AppOptions

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

      // 辅助函数：订阅 store 变化（共用 createStoreSubscriber）
      const subscribeStore = createStoreSubscriber(store)

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
          (storeKey) => store.isStateKeyDirty(storeKey),
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

      // 绑定 actions 到 App 实例方法（复用 bindActions；App 生命周期贯穿整包，不登记退订）
      if (options.mapActions) {
        bindActions(this, actionsMapping, store)
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
