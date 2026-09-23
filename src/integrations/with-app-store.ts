/**
 * GeomStore - App 集成
 *
 * 提供 Store 与微信小程序 App 的集成方案，包括：
 * - withAppStore: App 集成
 * - 自动状态同步到 globalData（autoUpdateOnShow 时在 onShow 重新注入缓存值）
 * - Action 绑定到 App 实例
 * - 调试 API 暴露
 * - App 级订阅随小程序运行期常驻，不主动清理（onHide 不清理，见下方说明）
 *
 */

import type { Store, State, Actions, Getters } from '../types/store.js'
import type { AppThis, ConnectOptions, WithPageThis } from '../types/integration.js'
import {
  resolveMappings,
  createStoreSubscriber,
  bindMappings,
  bindActions,
  cleanupBindings,
  copyOwnEntries,
  exposeStoreAPI,
  performAutoInject,
} from './utils.js'

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
 * 将写入 `globalData` 的键与宿主已有成员同名时告警。
 *
 * 覆盖是设计行为（store 是这些键的唯一事实来源），但静默覆盖会让
 * 「globalData 里写的初始值为什么没生效」无从排查，口径与 bindActions 的覆盖告警一致。
 *
 * 传入的是**键集合**而非映射表：state/getters 落进 globalData 的是映射的键，
 * 而 `injectMapping` 是「源键 → 目标键」，落进去的是值——两者都写同一个 globalData，
 * 必须一起检查（此前只查 state/getters 的本地键，注入路径的覆盖一次告警都没有）。
 * 只在首次 onLaunch 检查：此后 globalData 里的这些键是本函数自己写入的
 */
function warnOnGlobalDataCollision(globalData: Record<string, unknown>, ...keyGroups: Array<Iterable<string>>): void {
  const collided: string[] = []
  for (const keys of keyGroups) {
    for (const localKey of keys) {
      if (!collided.includes(localKey) && Object.prototype.hasOwnProperty.call(globalData, localKey)) {
        collided.push(localKey)
      }
    }
  }
  if (collided.length > 0) {
    console.warn(`[withAppStore] globalData 已有成员 ${collided.map((key) => `"${key}"`).join(', ')} 将被 store 映射值覆盖（store 为唯一事实来源）`)
  }
}

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
 * 运行期行为（与 withPageStore / withComponentStore 同口径）：
 * - `autoInject` + `injectMapping` 在 onLaunch 注入一次；再开 `autoUpdateOnShow` 时
 *   每次 App `onShow` 重新注入，异步 action 之后才进缓存的键因此有补偿路径
 * - 映射键、`injectMapping` 的目标键与宿主 `globalData` 已有成员同名时告警后覆盖
 *   （store 是唯一事实来源）
 * - 绑定阶段抛错：回滚本次已登记的订阅、告警并把错误原样抛给框架，
 *   不在映射未就绪的实例上转发用户 `onLaunch`
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
export function withAppStore<S extends State, A extends Actions, G extends Getters<S>, O extends ConnectOptions<S, A, G>>(
  store: Store<S, A, G>,
  options: O = {} as O,
) {
  // 解析映射与注入配置（与 Page/Component 集成共用 resolveMappings）
  const { stateMapping, gettersMapping, actionsMapping, injectMapping } = resolveMappings(options)
  // resolveMappings 恒返回对象，只判真值等于没有判定：没有任何注入条目时不跑注入、
  // 也不安装 onShow 包装器
  const hasInjectMapping = Object.keys(injectMapping).length > 0
  // globalData 冲突告警只报一次（重复 onLaunch 时映射键已在 globalData 里）
  let collisionWarned = false

  // 与 withPageStore 同款注入：WithPageThis 既为 C 提供推断位点（传入的字面量反向推断出 C，
  // 返回类型据此保留自定义生命周期/字段），又把顶层方法的 this 重写为注入后的实例类型；
  // AppThis 交叉 C，从而保留 globalData 的自定义字段。
  // M 位点用推断出的 O（而非写死的 ConnectOptions）：写死时 AppThis 只能按「未声明映射」
  // 处理，要么把全部 state/action 都声称为已注入（编译通过、运行时 undefined），
  // 要么一个都不给——只有按调用实参推断才能给出精确的 this 成员
  return function <C extends AppOptions>(AppConfig: WithPageThis<C, AppThis<S, A, G, O, C>> & ThisType<AppThis<S, A, G, O, C>>): C {
    // 订阅清理列表：App 生命周期贯穿整个小程序运行期，
    // 仅在订阅建立前重置（防止重复绑定），不在 onHide 等生命周期中清理
    const unbindFunctions: Array<() => void> = []
    // 入参类型已被 WithPageThis 重写（方法 this 为注入后的实例类型），
    // 运行时取值与原配置一致，故此处收窄回 AppOptions（单层断言即可比较）
    const enhancedConfig = { ...AppConfig } as AppOptions

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

      if (!collisionWarned) {
        collisionWarned = true
        // 三类键都会写进 globalData：state/getters 映射的本地键，以及 autoInject 打开时
        // injectMapping 的**目标键**（映射是源键→目标键，落盘的是值）。
        // 未开 autoInject 时注入不会发生，不能提前报覆盖
        const injectedKeys = options.autoInject && hasInjectMapping ? Object.values(injectMapping) : []
        warnOnGlobalDataCollision(this.globalData, Object.keys(stateMapping), Object.keys(gettersMapping), injectedKeys)
      }

      // 辅助函数：订阅 store 变化（共用 createStoreSubscriber）
      const subscribeStore = createStoreSubscriber(store)
      // 载荷按自有属性写入：`Object.assign(globalData, updates)` 用 [[Set]] 落键，
      // updates 里的 `'__proto__'` 键会命中 globalData 原型链上的 setter 改坏其原型
      const writeGlobalData = (updates: Record<string, unknown>) => {
        copyOwnEntries(this.globalData as Record<string, unknown>, updates)
      }

      try {
        // 绑定 state 到 globalData
        if (options.mapState) {
          const unbindState = bindMappings(
            this.globalData,
            stateMapping,
            (storeKey) => store.state[storeKey as keyof S],
            writeGlobalData,
            subscribeStore,
            (storeKey) => store.isStateKeyDirty(storeKey),
          )
          unbindFunctions.push(...unbindState)
        }

        // 绑定 getters 到 globalData
        if (options.mapGetters) {
          const unbindGetters = bindMappings(this.globalData, gettersMapping, (storeKey) => store.getter(storeKey), writeGlobalData, subscribeStore)
          unbindFunctions.push(...unbindGetters)
        }

        // 绑定 actions 到 App 实例方法（复用 bindActions）。
        // 退订凭证一并登记：否则重复 onLaunch 会把自家上一轮绑定的 action 当成「宿主已有成员」
        // 再告警一次，且用户原方法的快照被覆盖成绑定函数、再也回不去
        if (options.mapActions) {
          unbindFunctions.push(...bindActions(this, actionsMapping, store))
        }

        // 自动注入（使用getCached）
        if (options.autoInject && hasInjectMapping) {
          performAutoInject(this, injectMapping, store, writeGlobalData)
        }

        // 暴露 Store API 到 App 实例
        exposeStoreAPI(this, store)
      } catch (error) {
        // 绑定中途抛错：已登记的订阅必须回滚，否则半初始化的 App 会带着仍在推送的订阅
        // 活到进程结束。错误原样抛回框架（由其 onError 归因），且不转发用户 onLaunch——
        // 映射尚未就绪的实例上跑用户逻辑只会产出第二个更难归因的错误
        cleanupBindings(unbindFunctions)
        console.warn('[withAppStore] 绑定映射失败，已回滚本次登记的订阅', error)
        throw error
      }

      // 调用原始 onLaunch
      originalOnLaunch?.call(this, ...args)
    }

    // 与 withPageStore / withComponentStore 对齐：autoUpdateOnShow + autoInject 时在 onShow
    // 重新注入。onLaunch 全程只跑一次，异步 action 之后才进缓存的键否则永远补不上
    if (options.autoUpdateOnShow && options.autoInject && hasInjectMapping) {
      const originalOnShow = enhancedConfig.onShow
      enhancedConfig.onShow = function (this: AppOptions, ...args: unknown[]) {
        try {
          // globalData 由 onLaunch 建立；直接调用 onShow（未经启动）时不注入，
          // 但也不能替用户把它吞掉
          if (this.globalData) {
            performAutoInject(this, injectMapping, store, (updates) => copyOwnEntries(this.globalData as Record<string, unknown>, updates))
          }
        } finally {
          // 注入抛错不得吞掉用户的 onShow（与 onUnload / detached 的 try/finally 同口径）
          originalOnShow?.call(this, ...args)
        }
      }
    }

    // 注意：不在 onHide 中清理订阅。
    // App 切后台/回前台会在小程序运行期内反复发生，而订阅建立于 onLaunch，
    // 若在 onHide 清理且不重建，首次切后台后状态同步将永久失效。
    // App 级订阅的生命周期与小程序运行期一致，无需主动清理。

    return enhancedConfig as C
  }
}
