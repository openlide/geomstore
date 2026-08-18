/**
 * GeomStore v1.0.0 - 微信小程序集成
 *
 * 提供 Store 与微信小程序的集成方案，包括：
 * - withPageStore: Page 集成
 * - withComponentStore: Component 集成
 * - 自动状态同步
 * - Action 绑定
 * - 自动清理订阅
 *
 * @since 1.0.0
 */

import type { Store, State, Actions, Getters } from '../types/store'
import type { ConnectOptions, PageThis, PageOwnMethods, ComponentThis, ComponentOwnMethods, ExtractPageData, WithPageThis } from '../types/integration'
import { parseMapping, bindMappings, cleanupBindings, performAutoInject } from './utils'

export type { ConnectOptions } from '../types/integration'
export type { Actions } from '../types/store'

// ==================== 类型定义 ====================

interface PageOptions {
  data?: Record<string, unknown>
  setData?: (data: Record<string, unknown>, callback?: () => void) => void
  onLoad?(this: PageInstance, ...args: unknown[]): void
  onUnload?(): void
  onShow?(this: PageInstance, ...args: unknown[]): void
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
  lifetimes?: {
    attached?(this: ComponentInstance): void
    detached?(this: ComponentInstance): void
  }
  pageLifetimes?: {
    show?(this: ComponentInstance): void
    hide?(this: ComponentInstance): void
    [key: string]: unknown
  }
  setData?: (data: Record<string, unknown>, callback?: () => void) => void
  onShow?(this: ComponentInstance, ...args: unknown[]): void
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
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @template O - ConnectOptions 字面量类型（自动推断）
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns {(PageConfig: C) => WithPageThis<C, PageThis<...>>} Page 装饰器（方法 this 重写为精确类型）
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
  // 解析映射配置
  const stateMapping = options.mapState ? parseMapping(options.mapState) : {}
  const gettersMapping = options.mapGetters ? parseMapping(options.mapGetters) : {}
  const actionsMapping = options.mapActions ? parseMapping(options.mapActions) : {}

  // 解析注入映射配置
  const injectMapping = options.injectMapping || {}

  return function <C extends PageOptions>(
    // 入参使用具体类型（不依赖 C），使字面量方法内的 this 被统一注入为 PageThis：
    // - WithPageThis 显式重写已知生命周期方法的 this 参数
    // - ThisType<PageThis<...>> 标记让自定义方法（仅能命中 PageOptions 索引签名的 onInput 等）
    //   在 noImplicitThis 开启时也获得精确 this，避免退化为 unknown / object
    // C 仅用于返回类型，保留自定义方法 / data 的精确类型
    PageConfig: WithPageThis<Omit<PageOptions, 'data'>, PageThis<S, A, G, O>> & { data: object } & ThisType<PageThis<S, A, G, O>>,
  ): PageThis<S, A, G, O, PageOwnMethods<C>> & Omit<C, 'data'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> } {
    const enhancedConfig = { ...PageConfig } as PageOptions

    // 扩展 onLoad
    const originalOnLoad = enhancedConfig.onLoad
    enhancedConfig.onLoad = function (this: PageInstance, ...args: unknown[]) {
      // 订阅清理列表挂在页面实例上：同一 Page 配置可能存在多个页面实例
      // （如页面栈中的同名页面），实例级存储避免互相清除订阅
      if (!this.__geomUnbinds) {
        this.__geomUnbinds = []
      }
      const unbindFunctions = this.__geomUnbinds

      // 辅助函数：订阅 store 变化
      const subscribeStore = (callback: () => void) => store.subscribe(callback)

      // 绑定 state
      if (options.mapState) {
        const unbindState = bindMappings(
          this.data,
          stateMapping,
          (key) => store.state[key as keyof S],
          (updates) => this.setData(updates),
          subscribeStore,
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

      // 绑定 actions
      if (options.mapActions) {
        Object.entries(actionsMapping).forEach(([localName, actionName]) => {
          this[localName] = (...args: unknown[]) => {
            return store.dispatch(actionName, ...args)
          }
          unbindFunctions.push(() => {
            delete this[localName]
          })
        })
      }

      // 自动注入（使用getCached）
      if (options.autoInject && injectMapping) {
        performAutoInject(this, injectMapping, store, (updates: Record<string, unknown>) => this.setData(updates))
      }

      // 调用原始 onLoad
      originalOnLoad?.call(this, ...args)
    }

    // 如果启用 autoUpdateOnShow，扩展 onShow
    if (options.autoUpdateOnShow && options.autoInject) {
      const originalOnShow = enhancedConfig.onShow
      enhancedConfig.onShow = function (this: PageInstance, ...args: unknown[]) {
        performAutoInject(this, injectMapping, store, (updates: Record<string, unknown>) => this.setData(updates))
        if (typeof originalOnShow === 'function') {
          originalOnShow.call(this, ...args)
        }
      }
    }

    // 扩展 onUnload
    const originalOnUnload = enhancedConfig.onUnload
    enhancedConfig.onUnload = function (this: PageOptions) {
      // 清理当前页面实例的订阅
      cleanupBindings(this.__geomUnbinds || [])
      originalOnUnload?.call(this)
    }

    return enhancedConfig as unknown as PageThis<S, A, G, O, PageOwnMethods<C>> &
      Omit<C, 'data'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> }
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
 * @template S - 状态类型
 * @template A - Actions 类型
 * @template G - Getters 类型
 * @template O - ConnectOptions 字面量类型（自动推断）
 * @param {Store<S, A, G>} store - Store 实例
 * @param {ConnectOptions<S, A, G>} [options={}] - 连接选项
 * @returns {(ComponentConfig: C) => WithPageThis<C, ComponentThis<...>>} Component 装饰器（方法 this 重写为精确类型）
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
  ComponentConfig: C,
) => ComponentThis<S, A, G, O, ComponentOwnMethods<C>> &
  Omit<C, 'data' | 'methods'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> } {
  // 解析映射配置
  const stateMapping = options.mapState ? parseMapping(options.mapState) : {}
  const gettersMapping = options.mapGetters ? parseMapping(options.mapGetters) : {}
  const actionsMapping = options.mapActions ? parseMapping(options.mapActions) : {}

  // 解析注入映射配置
  const injectMapping = options.injectMapping || {}

  // 创建绑定后的 actions（作为 methods）
  const boundMethods: Record<string, (...args: unknown[]) => unknown> = {}
  Object.entries(actionsMapping).forEach(([localName, actionName]) => {
    boundMethods[localName] = (...args: unknown[]) => {
      return store.dispatch(actionName, ...args)
    }
  })

  return function <C extends ComponentOptions>(
    ComponentConfig: C,
  ): ComponentThis<S, A, G, O, ComponentOwnMethods<C>> &
    Omit<C, 'data' | 'methods'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> } {
    const enhancedConfig: ComponentOptions = { ...ComponentConfig }

    // 扩展 lifetimes
    const originalLifetimes = enhancedConfig.lifetimes || {}
    enhancedConfig.lifetimes = {
      ...originalLifetimes,
      attached: function (this: ComponentInstance) {
        // 订阅清理列表挂在组件实例上：同一 Component 配置可能存在多个实例
        // （如列表项组件），实例级存储避免互相清除订阅
        if (!this.__geomUnbinds) {
          this.__geomUnbinds = []
        }
        const unbindFunctions = this.__geomUnbinds

        // 将绑定的 methods 合并到实例上：
        // 先做实例级浅拷贝再合并，避免 this.methods 引用配置级共享对象时
        // 直接写入污染所有实例共用的 methods 定义
        if (this.methods) {
          this.methods = { ...this.methods, ...boundMethods }
        }

        // 辅助函数：订阅 store 变化
        const subscribeStore = (callback: () => void) => store.subscribe(callback)

        // 绑定 state
        if (options.mapState) {
          const unbindState = bindMappings(
            this.data,
            stateMapping,
            (key) => store.state[key as keyof S],
            (updates) => this.setData(updates),
            subscribeStore,
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
        if (options.autoInject && injectMapping) {
          performAutoInject(this, injectMapping, store, (updates: Record<string, unknown>) => this.setData(updates))
        }

        // 调用原始 attached
        originalLifetimes.attached?.call(this)
      },

      detached: function (this: ComponentInstance) {
        // 清理当前组件实例的订阅
        cleanupBindings(this.__geomUnbinds || [])
        // 移除实例上绑定的 action 方法：同样先做实例级拷贝再删除，
        // 避免 this.methods 仍指向配置级共享对象时误删其他实例仍在使用的方法
        if (this.methods) {
          this.methods = { ...this.methods }
          Object.keys(actionsMapping).forEach((localName) => {
            delete this.methods![localName]
          })
        }
        originalLifetimes.detached?.call(this)
      },
    }

    // 如果启用 autoUpdateOnShow，扩展 pageLifetimes.show（微信组件标准页面生命周期）：
    // 组件配置上的 onShow 不是组件生命周期，页面显示时不会被框架调用
    if (options.autoUpdateOnShow && options.autoInject) {
      const originalPageLifetimes = enhancedConfig.pageLifetimes || {}
      const originalShow = originalPageLifetimes.show
      enhancedConfig.pageLifetimes = {
        ...originalPageLifetimes,
        show: function (this: ComponentInstance) {
          performAutoInject(this, injectMapping, store, (updates: Record<string, unknown>) => this.setData(updates))
          originalShow?.call(this)
        },
      }
    }

    // 扩展 methods
    enhancedConfig.methods = {
      ...ComponentConfig.methods,
      ...boundMethods,
    }

    // 返回增强后的配置（lifetimes/pageLifetimes 结构已按微信组件 API 重写）
    return enhancedConfig as unknown as ComponentThis<S, A, G, O, ComponentOwnMethods<C>> &
      Omit<C, 'data' | 'methods'> & { data: (C extends { data: infer D } ? D : object) & ExtractPageData<S, O, G> }
  }
}
