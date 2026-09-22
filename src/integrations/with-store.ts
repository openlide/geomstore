/**
 * GeomStore - 微信小程序集成
 *
 * 提供 Store 与微信小程序的集成方案，包括：
 * - withPageStore: Page 集成
 * - withComponentStore: Component 集成
 * - 自动状态同步
 * - Action 绑定
 * - 自动清理订阅
 *
 */

import type { Store, State, Actions, Getters } from '../types/store.js'
import type {
  ConnectOptions,
  PageThis,
  PageConfig,
  ComponentThis,
  ComponentConfig,
  ComponentOwnMethods,
  ExtractPageData,
  WithPageThis,
  WithComponentThis,
} from '../types/integration.js'
import { resolveMappings, createStoreSubscriber, bindMappings, bindActions, cleanupBindings, performAutoInject } from './utils.js'

export type { ConnectOptions } from '../types/integration.js'
export type { Actions } from '../types/store.js'

// ==================== 类型定义 ====================

interface PageOptions {
  data?: Record<string, unknown>
  setData?: (data: Record<string, unknown>, callback?: () => void) => void
  onLoad?(...args: unknown[]): void
  onUnload?(): void
  onShow?(...args: unknown[]): void
  /** 实例级订阅清理列表（由 withPageStore 维护，避免多页面实例共享） */
  __geomUnbinds?: Array<() => void>
  [key: string]: unknown
}

/**
 * 页面实例类型：框架注入 setData 后，实例侧 setData 恒可用
 * （配置对象侧 setData 可选，故实例侧用交叉类型收敛为必选）
 */
type PageInstance = PageOptions & {
  setData: (data: Record<string, unknown>, callback?: () => void) => void
}

interface ComponentOptions {
  data?: Record<string, unknown>
  methods?: Record<string, unknown>
  /**
   * 组件生命周期（对应微信 Component 的 `lifetimes` 字段）
   *
   * 这里**刻意不声明 `this`**：运行时传入的是组件实例（其 `data` 含映射状态），
   * 精确类型由 withComponentStore 注入的 `ThisType<ComponentThis<…>>` 提供。
   * 若在此写成 `this: ComponentInstance`，会覆盖注入结果——`this.data` 退回可选
   * （`ComponentInstance.data?`），注入的方法被索引签名吞成 `unknown`。
   *
   * 键与微信官方一致（created / attached / ready / moved / detached / error）；
   * 不额外放开索引签名，以便生命周期名拼错时在编译期报错。
   */
  lifetimes?: {
    created?(): void
    attached?(): void
    ready?(): void
    moved?(): void
    detached?(): void
    error?(error: Error): void
  }
  /**
   * 组件所在页面的生命周期（对应微信 Component 的 `pageLifetimes` 字段）
   *
   * 与 `lifetimes` 同口径：不声明 `this`（由注入提供），并按微信官方键收严
   * （show / hide / resize），不再放开索引签名——此前写成 `[key: string]: unknown`
   * 会放过拼错的生命周期名，与 `lifetimes` 的处理也不一致。
   */
  pageLifetimes?: {
    show?(): void
    hide?(): void
    resize?(res: { size: { windowWidth: number; windowHeight: number } }): void
  }
  setData?: (data: Record<string, unknown>, callback?: () => void) => void
  onShow?(...args: unknown[]): void
  /** 实例级订阅清理列表（由 withComponentStore 维护，避免多组件实例共享） */
  __geomUnbinds?: Array<() => void>
  [key: string]: unknown
}

/**
 * 组件实例类型：框架注入 setData 后，实例侧 setData 恒可用
 */
type ComponentInstance = ComponentOptions & {
  setData: (data: Record<string, unknown>, callback?: () => void) => void
}

// ==================== Page 集成 ====================

/**
 * Page 混入函数
 *
 * 将 Store 连接到微信小程序 Page，自动管理状态同步和订阅清理
 *
 * 类型推断：
 * - `S` / `A` / `G` 均从 store 参数自动推断
 * - `O` 保留 options 字面量类型，用于精确推导方法内 this.data 与 actions
 * - mapState / mapGetters / mapActions 的键与值拼错时会在编译期报错
 * - 装饰器返回类型重写所有方法的 this 为 PageThis，使方法内 this.data / this.xxx 自动获得精确类型
 *
 * 订阅生命周期：绑定按页面实例登记在 `this.__geomUnbinds`，onUnload 统一清理；
 * onLoad 被重复调用时先清理旧订阅再重绑，绑定阶段抛错则回滚本次订阅并把错误抛回框架
 * （不转发用户 onLoad：映射未就绪的实例上跑用户逻辑只会产出第二个更难归因的错误）
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @template O - ConnectOptions 字面量类型（自动推断）
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns Page 装饰器：入参为「方法 `this` 已注入」（`ThisType<PageThis>`）的配置，返回增强后的配置（形状见 `PageConfig`）
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { withPageStore } from '@openlide/geomstore/integrations'
 *
 * const store = createStore({
 *   state: { count: 0, name: 'test' },
 *   actions: { increment() { this.state.count++ } }
 * })
 *
 * Page(withPageStore(store, {
 *   mapState: ['count', 'name'],
 *   mapActions: ['increment']
 * })({
 *   data: { localData: '...' },
 *   onLoad() {
 *     this.data.count // ✅ 自动推导为 number
 *     this.increment() // ✅ 精确签名
 *   }
 * }))
 * ```
 */
export function withPageStore<S extends State, A extends Actions, G extends Getters<S>, O extends ConnectOptions<S, A, G>>(
  store: Store<S, A, G>,
  options: O = {} as O,
) {
  // 解析映射与注入配置（与 Component/App 集成共用 resolveMappings）
  const { stateMapping, gettersMapping, actionsMapping, injectMapping } = resolveMappings(options)
  // resolveMappings 恒返回对象，只判真值等于没有判定：没有任何注入条目时不跑注入、
  // 也不安装 onShow 包装器
  const hasInjectMapping = Object.keys(injectMapping).length > 0

  return function <C extends PageOptions>(
    // WithPageThis 是同态映射类型，作为入参类型为 C 提供推断位点：
    // 传入的配置字面量（含自定义方法 / data）反向推断出 C，返回类型据此保留精确成员；
    // 修复前入参为具体类型（不含 C），C 只能回退到约束 PageOptions，
    // 自定义方法在返回值上退化为 unknown（编译期即报错）
    PageConfig: WithPageThis<C, PageThis<S, A, G, O>> & { data: object } & ThisType<PageThis<S, A, G, O>>,
  ): PageConfig<S, O, G> & Omit<C, 'data'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> } {
    const enhancedConfig = { ...PageConfig } as PageOptions

    // 扩展 onLoad
    const originalOnLoad = enhancedConfig.onLoad
    enhancedConfig.onLoad = function (this: PageInstance, ...args: unknown[]) {
      // 订阅清理列表挂在页面实例上：同一 Page 配置可能存在多个页面实例
      // （如页面栈中的同名页面），实例级存储避免互相清除订阅。
      // 同一实例重入 onLoad 时先清理旧订阅（cleanupBindings 会清空同一个数组、引用不变），
      // 否则旧订阅会一直叠加到 onUnload，每次通知都重复 setData
      if (this.__geomUnbinds) {
        cleanupBindings(this.__geomUnbinds)
      } else {
        this.__geomUnbinds = []
      }
      const unbindFunctions = this.__geomUnbinds

      // 辅助函数：订阅 store 变化（共用 createStoreSubscriber）
      // 绑定/注入的可复用部分（映射解析、订阅、脏检查、自动注入、批量清理）已全部
      // 下沉到 integrations/utils（resolveMappings / createStoreSubscriber /
      // bindMappings / performAutoInject / cleanupBindings）。这里保留的只是各入口的
      // 接线差异：宿主写入方式（setData vs 写 globalData）、变更键判定
      // 是否可用（state 传 isStateKeyDirty、getters 不传）、退订登记时机
      // （页面/组件按实例 __geomUnbinds 并在 onUnload/detached 清理，App 只在重复
      // onLaunch 前清理）、Component 的 action 走 methods 合并而非 bindActions
      // ——再抽一层只会把这些差异塞进回调参数里
      const subscribeStore = createStoreSubscriber(store)

      try {
        // 绑定 state
        if (options.mapState) {
          const unbindState = bindMappings(
            this.data,
            stateMapping,
            (key) => store.state[key as keyof S],
            (updates) => this.setData(updates),
            subscribeStore,
            (storeKey) => store.isStateKeyDirty(storeKey),
          )
          unbindFunctions.push(...unbindState)
        }

        // 绑定 getters
        if (options.mapGetters) {
          const unbindGetters = bindMappings(
            this.data,
            gettersMapping,
            (key) => store.getter(key),
            (updates) => this.setData(updates),
            subscribeStore,
          )
          unbindFunctions.push(...unbindGetters)
        }

        // 绑定 actions（复用 integrations/utils 的 bindActions，与 App 集成同一实现）
        if (options.mapActions) {
          unbindFunctions.push(...bindActions(this, actionsMapping, store))
        }

        // 自动注入（使用getCached）
        if (options.autoInject && hasInjectMapping) {
          performAutoInject(this, injectMapping, store, (updates: Record<string, unknown>) => this.setData(updates))
        }
      } catch (error) {
        // 绑定中途抛错：已登记的订阅必须回滚，否则半初始化的页面会带着仍在推送的订阅
        // 活到 onUnload。错误原样抛回框架（由宿主归因），且不转发用户 onLoad——
        // 映射尚未就绪的实例上跑用户逻辑只会产出第二个更难归因的错误
        cleanupBindings(unbindFunctions)
        console.warn('[withPageStore] 绑定映射失败，已回滚本次登记的订阅', error)
        throw error
      }

      // 调用原始 onLoad
      originalOnLoad?.call(this, ...args)
    }

    // 如果启用 autoUpdateOnShow，扩展 onShow
    if (options.autoUpdateOnShow && options.autoInject && hasInjectMapping) {
      const originalOnShow = enhancedConfig.onShow
      enhancedConfig.onShow = function (this: PageInstance, ...args: unknown[]) {
        try {
          performAutoInject(this, injectMapping, store, (updates: Record<string, unknown>) => this.setData(updates))
        } finally {
          // 注入抛错不得吞掉用户的 onShow（与 onUnload 的 try/finally 同口径）
          if (typeof originalOnShow === 'function') {
            originalOnShow.call(this, ...args)
          }
        }
      }
    }

    // 扩展 onUnload
    const originalOnUnload = enhancedConfig.onUnload
    enhancedConfig.onUnload = function (this: PageOptions) {
      try {
        // 用户卸载逻辑仍可调用映射的 actions、读取同步状态
        originalOnUnload?.call(this)
      } finally {
        // 即使用户生命周期抛错，也必须清理当前实例的绑定
        cleanupBindings(this.__geomUnbinds || [])
      }
    }

    return enhancedConfig as unknown as PageConfig<S, O, G> & Omit<C, 'data'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> }
  }
}

// ==================== Component 集成 ====================

/**
 * Component 混入函数
 *
 * 将 Store 连接到微信小程序 Component，自动管理状态同步和订阅清理
 *
 * 类型推断：与 withPageStore 一致，`S` / `A` / `G` 从 store 参数自动推断，
 * `O` 保留 options 字面量类型用于精确推导；
 * mapState / mapGetters / mapActions 的键与值拼错时编译期报错；
 * 装饰器返回类型重写所有方法的 this 为 ComponentThis，使方法内 this.data / this.xxx 自动获得精确类型
 *
 * 订阅生命周期与绑定失败的回滚口径同 withPageStore：按组件实例登记 `__geomUnbinds`、
 * detached 统一清理，attached 重入时先清理旧订阅
 *
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @template O - ConnectOptions 字面量类型（自动推断）
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns Component 装饰器：入参为「各命名空间内方法 `this` 已注入」（`WithComponentThis`）的配置，返回增强后的配置（形状见 `ComponentConfig`）
 *
 * @example
 * ```typescript
 * import { createStore } from '@openlide/geomstore'
 * import { withComponentStore } from '@openlide/geomstore/integrations'
 *
 * const store = createStore({
 *   state: { count: 0, name: 'test' },
 *   actions: { increment() { this.state.count++ } }
 * })
 *
 * Component(withComponentStore(store, {
 *   mapState: ['count', 'name'],
 *   mapActions: ['increment']
 * })({
 *   methods: {
 *     handleTap() {
 *       this.data.count // ✅ 自动推导为 number
 *       this.increment() // ✅ 精确签名
 *     }
 *   }
 * }))
 * ```
 */
export function withComponentStore<S extends State, A extends Actions, G extends Getters<S>, O extends ConnectOptions<S, A, G>>(
  store: Store<S, A, G>,
  options: O = {} as O,
): <C extends ComponentOptions>(
  // 外层声明必须与实现签名一致：否则调用方看到的仍是 `ComponentConfig: C`，
  // 命名空间级的 ThisType 不会生效（方法内 this 推导会落回配置字面量）
  ComponentConfig: WithComponentThis<C, ComponentThis<S, A, G, O, ComponentOwnMethods<C>>>,
) => ComponentConfig<S, A, G, O, ComponentOwnMethods<C>> &
  Omit<C, 'data' | 'methods'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> } {
  // 解析映射与注入配置（与 Page/App 集成共用 resolveMappings）
  const { stateMapping, gettersMapping, actionsMapping, injectMapping } = resolveMappings(options)
  // resolveMappings 恒返回对象，只判真值等于没有判定：没有任何注入条目时不跑注入、
  // 也不安装 pageLifetimes.show 包装器
  const hasInjectMapping = Object.keys(injectMapping).length > 0

  // 创建绑定后的 actions（作为 methods）
  const boundMethods: Record<string, (...args: unknown[]) => unknown> = {}
  Object.entries(actionsMapping).forEach(([localName, actionName]) => {
    // 按自有属性写入：`boundMethods['__proto__'] = fn` 会命中 Object.prototype 的 setter，
    // 该 action 既不报错也不会出现在 methods 里（与 integrations/utils 的 setOwnEntry 同口径）
    Object.defineProperty(boundMethods, localName, {
      value: (...args: unknown[]) => store.dispatch(actionName, ...args),
      writable: true,
      enumerable: true,
      configurable: true,
    })
  })

  return function <C extends ComponentOptions>(
    // 与 withPageStore 同理注入 this 类型；差别在于 Component 的方法与生命周期嵌套在
    // methods / lifetimes / pageLifetimes 命名空间内，故用 WithComponentThis 把 ThisType
    // 挂到各命名空间本身（ThisType 只作用于所标注的那个对象字面量，顶层挂载不会下传）
    ComponentConfig: WithComponentThis<C, ComponentThis<S, A, G, O, ComponentOwnMethods<C>>>,
  ): ComponentConfig<S, A, G, O, ComponentOwnMethods<C>> &
    Omit<C, 'data' | 'methods'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> } {
    const enhancedConfig: ComponentOptions = { ...ComponentConfig }

    // 扩展 lifetimes
    // 仅从 lifetimes 捕获原始 attached/detached：基础库 3.15.0+ 仅支持 lifetimes 写法，
    // 已移除对微信旧式顶层 attached/detached 的兼容
    const originalLifetimes = enhancedConfig.lifetimes || {}
    const originalAttached = originalLifetimes.attached
    const originalDetached = originalLifetimes.detached
    enhancedConfig.lifetimes = {
      ...originalLifetimes,
      attached: function (this: ComponentInstance) {
        // 订阅清理列表挂在组件实例上：同一 Component 配置可能存在多个实例
        // （如列表项组件），实例级存储避免互相清除订阅。
        // 同一实例重入 attached 时先清理旧订阅（cleanupBindings 清空同一个数组、引用不变），
        // 否则旧订阅会叠加到 detached，每次通知都重复 setData
        if (this.__geomUnbinds) {
          cleanupBindings(this.__geomUnbinds)
        } else {
          this.__geomUnbinds = []
        }
        const unbindFunctions = this.__geomUnbinds

        // 辅助函数：订阅 store 变化（共用 createStoreSubscriber）
        const subscribeStore = createStoreSubscriber(store)

        try {
          // 将绑定的 methods 合并到实例上：
          // 先做实例级浅拷贝再合并，避免 this.methods 引用配置级共享对象时
          // 直接写入污染所有实例共用的 methods 定义
          if (this.methods) {
            this.methods = { ...this.methods, ...boundMethods }
          }

          // 绑定 state
          if (options.mapState) {
            const unbindState = bindMappings(
              this.data,
              stateMapping,
              (key) => store.state[key as keyof S],
              (updates) => this.setData(updates),
              subscribeStore,
              (storeKey) => store.isStateKeyDirty(storeKey),
            )
            unbindFunctions.push(...unbindState)
          }

          // 绑定 getters
          if (options.mapGetters) {
            const unbindGetters = bindMappings(
              this.data,
              gettersMapping,
              (key) => store.getter(key),
              (updates) => this.setData(updates),
              subscribeStore,
            )
            unbindFunctions.push(...unbindGetters)
          }

          // 自动注入（使用getCached）
          if (options.autoInject && hasInjectMapping) {
            performAutoInject(this, injectMapping, store, (updates: Record<string, unknown>) => this.setData(updates))
          }
        } catch (error) {
          // 绑定中途抛错：已登记的订阅必须回滚，否则半初始化的组件会带着仍在推送的
          // 订阅活到 detached。错误原样抛回框架，且不转发用户 attached——映射尚未就绪
          // 的实例上跑用户逻辑只会产出第二个更难归因的错误
          cleanupBindings(unbindFunctions)
          console.warn('[withComponentStore] 绑定映射失败，已回滚本次登记的订阅', error)
          throw error
        }

        // 调用原始 attached（来自 lifetimes）
        originalAttached?.call(this)
      },

      detached: function (this: ComponentInstance) {
        try {
          // 与 Page 一致：用户生命周期结束前保留绑定
          originalDetached?.call(this)
        } finally {
          // 即使用户生命周期抛错，也必须清理当前实例的绑定
          cleanupBindings(this.__geomUnbinds || [])
          // 移除实例上绑定的 action 方法：同样先做实例级拷贝再删除，
          // 避免 this.methods 仍指向配置级共享对象时误删其他实例仍在使用的方法
          if (this.methods) {
            const methods = { ...this.methods }
            this.methods = methods
            Object.keys(actionsMapping).forEach((localName) => {
              delete methods[localName]
            })
          }
        }
      },
    }

    // 如果启用 autoUpdateOnShow，扩展 pageLifetimes.show（微信组件标准页面生命周期）：
    // 组件配置上的 onShow 不是组件生命周期，页面显示时不会被框架调用
    if (options.autoUpdateOnShow && options.autoInject && hasInjectMapping) {
      const originalPageLifetimes = enhancedConfig.pageLifetimes || {}
      const originalShow = originalPageLifetimes.show
      enhancedConfig.pageLifetimes = {
        ...originalPageLifetimes,
        show: function (this: ComponentInstance) {
          try {
            performAutoInject(this, injectMapping, store, (updates: Record<string, unknown>) => this.setData(updates))
          } finally {
            // 注入抛错不得吞掉用户的 show（与 detached 的 try/finally 同口径）
            originalShow?.call(this)
          }
        },
      }
    }

    // 扩展 methods
    enhancedConfig.methods = {
      ...ComponentConfig.methods,
      ...boundMethods,
    }

    // 返回增强后的配置（lifetimes/pageLifetimes 结构已按微信组件 API 重写）
    return enhancedConfig as unknown as ComponentConfig<S, A, G, O, ComponentOwnMethods<C>> &
      Omit<C, 'data' | 'methods'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> }
  }
}
