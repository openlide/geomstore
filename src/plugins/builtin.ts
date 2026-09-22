/**
 * GeomStore - 内置插件
 */

import type { Store, State } from '../types/store.js'
import type { Plugin } from '../types/plugin.js'
import type { PersistenceOptions, StorageBackend } from '../types/persistence.js'
import { isPlainObject } from '../core/utils/helpers.js'
import { isProduction } from '../core/store/utils.js'
import { registerGlobalEntry } from './globalRegistry.js'

/**
 * 运行时检测异步存储后端。
 * JS 调用方仍可能传入异步实现（如 localStorage 的 Promise 封装），
 * 静默使用会导致恢复时 JSON.parse(Promise) 抛错、保存时异步 rejection 逃出
 * try/catch —— 数据丢失且无感知，因此必须显式报错。
 *
 * @param methodLabel 出错方法的完整定位串（`storage.getItem` / `wx.getStorageSync`）：
 * 用户后端与内置 wx 适配器共用本守卫，只写 `storage.xxx` 会让「压根没传 storage」的
 * 兼容层场景指向一个调用方并没有用的选项
 */
function assertSyncStorageResult(result: unknown, methodLabel: string): void {
  if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof (result as PromiseLike<unknown>).then === 'function') {
    throw new Error(
      `[GeomStore][persistence] ${methodLabel}() 返回了 Promise：persistencePlugin 仅支持同步存储后端` +
        `（如 wx.getStorageSync、WxStorageBackend 或同步封装的 localStorage）。` +
        `异步后端请在外部自行订阅 store 实现持久化。`,
    )
  }
}

/**
 * 日志插件：将 Action 调用（名称、参数、耗时、异常）输出到控制台
 */
export const loggerPlugin: Plugin = {
  name: 'logger',

  install(store: Store) {
    // 生产环境保护：不输出日志，避免性能损耗和信息泄露
    if (isProduction()) {
      return () => {}
    }

    console.log(`[GeomStore] Plugin "logger" installed`)

    // 只读订阅：仅打印日志，不修改载荷，避免为 logger 引入整树深拷贝
    const unsubscribe = store.subscribe(
      (state) => {
        console.log('[GeomStore] State changed:', state)
      },
      { readOnly: true },
    )

    const unhookBeforeSetState = store.hooks.on('beforeSetState', (key: unknown, value: unknown) => {
      console.log('[GeomStore] Setting state:', key, '=>', value)
    })

    const unhookAfterSetState = store.hooks.on('afterSetState', (key: unknown, value: unknown) => {
      console.log('[GeomStore] State set:', key, '=>', value)
    })

    const unhookBeforeDispatch = store.hooks.on('beforeDispatch', (actionName: unknown, args: unknown) => {
      console.log('[GeomStore] Dispatching action:', actionName, args)
    })

    const unhookAfterDispatch = store.hooks.on('afterDispatch', (actionName: unknown, _args: unknown, result: unknown) => {
      console.log('[GeomStore] Action dispatched:', actionName, result)
    })

    return () => {
      unsubscribe()
      unhookBeforeSetState()
      unhookAfterSetState()
      unhookBeforeDispatch()
      unhookAfterDispatch()
    }
  },
}

/**
 * 持久化插件。
 *
 * 支持以下两种用法：
 *
 * 1. 作为 Plugin 直接安装（使用默认选项）：
 *    ```ts
 *    store.use(persistencePlugin)
 *    ```
 * 2. 作为工厂函数传入选项：
 *    ```ts
 *    store.use(persistencePlugin({ key: 'app-state', storage: new WxStorageBackend() }))
 *    ```
 */
// 使用工厂函数创建"可调用 + 可安装"的插件：
// - 作为函数调用时：persistencePlugin(options) 返回新的带配置 Plugin
// - 作为 Plugin 对象使用时：具有 name / install 属性（使用默认选项）
// 返回类型保留 S：此前声明为 Plugin（即 Plugin<State>），显式传入的状态类型会被抹掉，
// 结果既无法赋给 store.use（其参数为 Plugin<自身状态类型>），也丢掉了 filter/validate
// 回调与状态类型的关联
const _persistencePluginFactory = <S extends State = State>(options?: PersistenceOptions<S>): Plugin<S> => ({
  name: 'persistence',
  install: (store) => installPersistence(store as unknown as Store<S>, options),
})

// 附加 Plugin 属性（使用 defineProperty 避免 name 属性只读限制）
Object.defineProperty(_persistencePluginFactory, 'name', {
  value: 'persistence',
  writable: true,
  configurable: true,
})
;(_persistencePluginFactory as unknown as Plugin).install = <S extends State>(store: Store<S>, pluginOptions?: PersistenceOptions<S>) =>
  installPersistence(store, pluginOptions)

/**
 * 持久化插件（可作工厂直接调用）
 *
 * - 直接使用：`store.use(persistencePlugin)` 采用默认配置
 * - 配置使用：`store.use(persistencePlugin({ key, filter, debounce }))`
 *
 * 仅支持**同步**存储后端（如 `wx.getStorageSync` 或 `WxStorageBackend`）：
 * 后端方法返回 Promise 时会显式抛错，避免异步写入静默丢数据。
 */
export const persistencePlugin: Plugin & {
  <S extends State = State>(options?: PersistenceOptions<S>): Plugin<S>
} = _persistencePluginFactory as Plugin & {
  <S extends State = State>(options?: PersistenceOptions<S>): Plugin<S>
}

/**
 * 持久化插件的安装实现。
 * 抽出为独立函数，便于工厂模式与直接安装模式复用同一份逻辑。
 */
function installPersistence<S extends State>(store: Store<S>, options: PersistenceOptions<S> = {}): () => void {
  if (!isProduction()) {
    console.log(`[GeomStore] Plugin "persistence" installed`)
  }

  const { key = `geomstore_${store.name}`, filter, validate, restore: shouldRestore = true, debounce: debounceMs = 0, clearOnUninstall = false } = options || {}

  const storageKey = typeof key === 'function' ? key(store.name) : key

  // 解析存储后端：传入 storage 时必须完整实现三个同步方法（缺一即在安装期抛错），
  // 否则使用微信小程序的 wx.getStorageSync / setStorageSync / removeStorageSync；
  // 非微信环境（如测试/Node）wx 不存在，降级为内存存储避免 ReferenceError
  const userStorage = options.storage
  let storageAdapter: StorageBackend
  if (userStorage !== undefined && userStorage !== null) {
    // 安装期一次性校验三个方法形状：只检查 getItem 时，缺 setItem / removeItem 的后端
    // （只读适配器、键名拼错的对象）会把错误推迟到首次落盘，抛出的
    // `backend.setItem is not a function` 又被 saveState 的 try/catch 吞成一条日志，
    // 卸载时的 removeItem 更是静默失败——调用方始终不知道用错了后端。
    // 也不能「校验不通过就悄悄改用 wx / 内存」：那会把数据写到另一个后端，
    // 比立刻报错更难排查，故此处直接抛错（与 assertSyncStorageResult 同一严格口径）
    const requiredMethods = ['getItem', 'setItem', 'removeItem'] as const
    const candidate = userStorage as Partial<StorageBackend>
    const missing = requiredMethods.filter((method) => typeof candidate[method] !== 'function')
    if (missing.length > 0) {
      throw new TypeError(
        `[GeomStore][persistence] storage 选项必须同时提供 ${requiredMethods.join(' / ')} 三个同步方法，` +
          `当前缺少或不是函数：${missing.join(' / ')}。` +
          `接入微信小程序存储请传 new WxStorageBackend()；不传 storage 时本插件会自动使用 wx 同步 API（无 wx 则降级为内存存储）。`,
      )
    }
    // 形状校验通过后按 StorageBackend 契约调用；再包一层用于拦截异步返回值，
    // 避免恢复/保存被静默丢弃
    const backend = userStorage
    storageAdapter = {
      getItem: (k: string) => {
        const value = backend.getItem(k)
        assertSyncStorageResult(value, 'storage.getItem')
        return value
      },
      setItem: (k: string, v: string) => {
        const result = backend.setItem(k, v)
        assertSyncStorageResult(result, 'storage.setItem')
      },
      removeItem: (k: string) => {
        const result = backend.removeItem(k)
        assertSyncStorageResult(result, 'storage.removeItem')
      },
    }
  } else {
    // 微信小程序 wx 为全局变量，经 globalThis 读取避免直接引用未声明标识符（TS2304）。
    // set/remove 的返回类型取 unknown（而非 void）：下方要把实际返回值交给异步守卫检查
    const wxGlobal = (
      globalThis as {
        wx?: { getStorageSync(k: string): unknown; setStorageSync(k: string, v: string): unknown; removeStorageSync(k: string): unknown }
      }
    ).wx
    if (wxGlobal && typeof wxGlobal.getStorageSync === 'function') {
      // wx 适配器同样逐方法过 assertSyncStorageResult：本文件的核心防护此前只包住
      // 用户传入的 storage，运行在提供 Promise 版同步存储 API 的兼容层（Taro / uni-app
      // 等 polyfill）下时，写入会变成一个无人处理的 Promise rejection —— 正是
      // 「数据丢失且无感知」的场景
      storageAdapter = {
        // 微信小程序同步存储
        getItem: (k: string) => {
          const v = wxGlobal.getStorageSync(k)
          assertSyncStorageResult(v, 'wx.getStorageSync')
          return v === undefined || v === null ? null : (v as string)
        },
        setItem: (k: string, v: string) => {
          const result = wxGlobal.setStorageSync(k, v)
          assertSyncStorageResult(result, 'wx.setStorageSync')
        },
        removeItem: (k: string) => {
          const result = wxGlobal.removeStorageSync(k)
          assertSyncStorageResult(result, 'wx.removeStorageSync')
        },
      }
    } else {
      // 降级：进程内存存储（重启即失，仅保证不抛错）
      const degradeMessage = '[GeomStore][persistence] 未检测到可用的 storage 后端（非微信环境且未传入 storage），降级为内存存储，持久化不生效'
      if (!isProduction()) {
        console.warn(degradeMessage)
      } else {
        // 生产环境不刷控制台，但必须留一个可编程感知的信号：否则持久化彻底静默失效
        // （恢复读不到数据、保存成功写进下面的 Map 并随进程消失），H5/SSR 与「被摇树
        // 丢掉 storage 配置」的场景调用方完全无从发现
        store.hooks.emit('onError', new Error(degradeMessage), 'persistence')
      }
      const memoryMap = new Map<string, string>()
      // 内存后端无需 assertSyncStorageResult：三个方法的返回值都由本闭包产出
      // （`?? null` / `void` 归一为 undefined），外部实现不可能在这里返回 Promise，
      // 包一层只是永不命中的死分支
      storageAdapter = {
        getItem: (k: string) => memoryMap.get(k) ?? null,
        setItem: (k: string, v: string) => void memoryMap.set(k, v),
        removeItem: (k: string) => void memoryMap.delete(k),
      }
    }
  }

  // 恢复后「待吸收」的序列化载荷：notify.async 下 $patch 的合并通知是微任务，
  // 会打到下方安装后才注册的订阅上。该通知只承载「恢复本身」的内容，不应触发回写——
  // 否则安装后立即覆写同一 tick 内其他实例写入的新数据，且每次启动都重写磁盘
  // （lastSaved 去重被绕过）。仅在首次通知且内容与恢复结果一致时吸收一次
  let absorbedSerialized: string | null = null

  if (shouldRestore) {
    try {
      const savedState = storageAdapter.getItem(storageKey)
      if (savedState) {
        const parsedState = JSON.parse(savedState)
        // 安全检查：确保解析结果是纯对象，防止原型链污染
        if (!isPlainObject(parsedState)) {
          console.error('[GeomStore] Restored state is not a plain object, skipping restore')
        } else if (validate && !validate(parsedState)) {
          // 数据验证：如果提供了 validate 函数，校验通过后才恢复
          console.error('[GeomStore] Restored state failed validation, skipping restore')
        } else {
          const filteredState = filter ? filter(parsedState) : parsedState
          // 恢复时使用 $patch 合并语义：filter 可能只持久化了部分键，
          // 若用 $replaceState 整体替换会丢失未持久化的运行时键（如 UI 态/临时态）
          store.$patch(filteredState)
          // 记下恢复后的序列化内容，供订阅回调吸收恢复自身的延迟通知。
          // 用序列化比较而非状态版本：克隆/只读代理等载荷形态下版本号不可见
          try {
            absorbedSerialized = JSON.stringify(filter ? filter(store.getState()) : store.getState())
          } catch {
            // 序列化失败（循环引用等）：放弃吸收，维持「通知即落盘」的原有行为
            absorbedSerialized = null
          }
          if (!isProduction()) {
            console.log('[GeomStore][persistence] State restored from storage:', storageKey)
          }
        }
      }
    } catch (error) {
      console.error('[GeomStore] Failed to restore state:', error)
    }
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let isUninstalled = false // 标记是否已卸载，防止卸载后定时器回调仍执行
  // 防抖窗口内最近一次待写入的状态：卸载时用于同步补写，避免最后一次变更丢失
  let pendingState: Partial<S> | null = null
  // 最近一次成功落盘的序列化结果：卸载补写时据此跳过无变化的重复写入。
  // 必须声明在下面的 subscribe 之前（#374）：saveState 是提升的函数声明并闭包引用它，
  // 一旦订阅改为同步回调（或在注册与声明之间插入任何会 notify 的逻辑），
  // 回调里的 saveState 就会读到 TDZ 中未初始化的 lastSaved 而直接抛 ReferenceError
  let lastSaved: string | null = null

  // 只读订阅：仅序列化后落盘，不修改载荷，避免为持久化引入整树深拷贝
  const unsubscribe = store.subscribe(
    (state) => {
      const stateToSave = filter ? filter(state) : state

      // 吸收恢复自身的延迟通知（仅首次通知生效，避免陈旧载荷误吞后续真实变更）：
      // 通知内容与恢复结果一致说明状态自恢复以来未变化，不产生任何写入
      if (absorbedSerialized !== null) {
        const restoredPayload = absorbedSerialized
        absorbedSerialized = null
        try {
          if (JSON.stringify(stateToSave) === restoredPayload) {
            return
          }
        } catch {
          // 序列化失败：继续走正常落盘路径，由 saveState 内部兜底
        }
      }

      if (debounceMs > 0) {
        if (debounceTimer) {
          clearTimeout(debounceTimer)
        }
        pendingState = stateToSave
        debounceTimer = setTimeout(() => {
          // 卸载后不再执行保存操作
          if (isUninstalled) return
          pendingState = null
          saveState(stateToSave)
        }, debounceMs)
      } else {
        saveState(stateToSave)
      }
    },
    { readOnly: true },
  )

  function saveState(state: Partial<S>): void {
    // 卸载后不再执行保存操作
    if (isUninstalled) return
    try {
      const serialized = JSON.stringify(state)
      if (serialized === lastSaved) {
        return
      }
      storageAdapter.setItem(storageKey, serialized)
      lastSaved = serialized
    } catch (error) {
      console.error('[GeomStore] Failed to persist state:', error)
      store.hooks.emit('onError', error as Error, 'persistence')
    }
  }

  return () => {
    if (!clearOnUninstall) {
      // 防抖窗口内卸载：pendingState 尚未落盘，先同步补写最后一次变更
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
        if (pendingState !== null) {
          saveState(pendingState)
        }
      }
      // 最终补写：notify.async 下最后一次写入可能尚未触发订阅回调（pendingState 为空），
      // 而 destroy 会取消待发通知，窗口期内的变更会既不通知也不落盘。
      // 直接读取当前状态落盘（与 lastSaved 比较，无变化时不产生写入）
      try {
        saveState(filter ? filter(store.getState()) : store.getState())
      } catch (error) {
        console.error('[GeomStore] Failed to persist state on uninstall:', error)
      }
    }
    pendingState = null
    isUninstalled = true
    unsubscribe()
    // 仅在配置了 clearOnUninstall 时才清除存储数据
    if (clearOnUninstall) {
      try {
        storageAdapter.removeItem(storageKey)
      } catch (error) {
        // 清理失败不得静默：磁盘上残留的旧数据会在下次启动恢复出「已卸载」的状态
        // （已清除却复活）。与 saveState 同口径上报，调用方才有机会介入
        console.error('[GeomStore] Failed to clear persisted state:', error)
        store.hooks.emit('onError', error as Error, 'persistence')
      }
    }
  }
}

export const devtoolsPlugin: Plugin = {
  name: 'devtools',

  install(store: Store) {
    // 生产环境保护：不暴露全局对象，防止内部结构泄露
    if (isProduction()) {
      return () => {}
    }

    console.log(`[GeomStore] Plugin "devtools" installed`)

    // 全局调试入口：STORES 注册 store 实例、DEVTOOLS 注册 API；
    // 卸载按身份守卫清理（registerGlobalEntry 内实现，与 timeTravel/analyzer 共用）
    const unregisterStores = registerGlobalEntry('__GEOMSTORE_STORES__', store.name, store)
    console.log(`[GeomStore] DevTools enabled. Access store at:`, `globalThis.__GEOMSTORE_STORES__["${store.name}"]`)

    const devtoolsAPI = {
      getStoreInfo: () => ({
        name: store.name,
        state: store.getState(),
        actions: Object.keys(store.actions),
        getters: store.getGetterNames ? store.getGetterNames() : [],
      }),

      dispatch: (actionName: string, ...args: unknown[]) => {
        return store.dispatch(actionName, ...args)
      },

      getter: (getterName: string) => {
        return store.getter(getterName)
      },

      getState: () => store.state,
      // 注意：状态保护开启时 store.state 为保护 Proxy，读取语义等价；
      // devtools 消费方如需序列化（JSON.stringify 可穿透），请自行拷贝副本
      //
      // 下面三处的 `as never` 是必要的、而非偷懒（#373）：本插件的 `store` 形参类型是
      // 无泛型的 `Store`，即 S = State，而 `State = object` → `keyof S` 为 never，
      // 于是 setState/$patch/$replaceState 的形参在类型层面只接受 never。
      // 调试入口按设计要能写任意键/值，只能在调用点收窄断言；键的合法性由核心
      // （setState 的只读代理校验、$replaceState 的纯对象准入）在运行时兜住。
      // 若哪天 Store 把这些方法的非泛型重载补上，这些断言应随之删除
      setState: (key: string, value: unknown) => {
        store.setState(key as never, value as never)
      },
      $patch: (partialState: unknown) => {
        store.$patch(partialState as never)
      },
      $replaceState: (newState: unknown) => {
        store.$replaceState(newState as never)
      },

      subscribe: (callback: (state: unknown) => void, options?: { readOnly?: boolean }) => {
        // 默认只读：调试入口的订阅只观察状态，以可写订阅登记会翻转 Store 的
        // needsClone 判定，让 persistence/logger 等只读订阅者一并承担整树深拷贝
        return store.subscribe(callback, options ?? { readOnly: true })
      },

      // 与上面几处不同，这里不需要断言：`Plugin`（默认泛型即 Plugin<State>）
      // 本就在 Store.use 的形参联合里，写成 `unknown` + `as never` 只会白丢类型检查
      use: (plugin: Plugin) => {
        return store.use(plugin)
      },

      destroy: () => store.destroy(),
    }

    const unregisterDevtools = registerGlobalEntry('__GEOMSTORE_DEVTOOLS__', store.name, devtoolsAPI)
    console.log(`[GeomStore][devtools] Access API at: globalThis.__GEOMSTORE_DEVTOOLS__["${store.name}"]`)

    return () => {
      unregisterStores()
      unregisterDevtools()
    }
  },
}

/**
 * 内置插件集合（按 logger → persistence → devtools 顺序注册）
 *
 * @example
 * ```ts
 * import { builtinPlugins } from '@openlide/geomstore/extras/plugins'
 *
 * builtinPlugins.forEach((plugin) => store.use(plugin))
 * ```
 */
export const builtinPlugins = [loggerPlugin, persistencePlugin, devtoolsPlugin]

export type { PersistenceOptions } from '../types/persistence.js'
