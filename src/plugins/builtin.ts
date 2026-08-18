/**
 * GeomStore v1.0 - 内置插件
 * @since 1.0.0
 */

import type { Store, State } from '../types/store'
import type { Plugin } from '../types/plugin'
import type { PersistenceOptions } from '../types/persistence'
import { isPlainObject } from '../core/utils/helpers'
import { isProduction } from '../core/store/utils'

/**
 * 同步存储后端接口（用于微信小程序等同步存储场景）
 */
interface SyncStorageBackend {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const loggerPlugin: Plugin = {
  name: 'logger',

  install(store: Store) {
    // 生产环境保护：不输出日志，避免性能损耗和信息泄露
    if (isProduction()) {
      return () => {}
    }

    console.log(`[GeomStore] Plugin "logger" installed`)

    const unsubscribe = store.subscribe((state) => {
      console.log('[GeomStore] State changed:', state)
    })

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
 *    store.use(persistencePlugin({ key: 'app-state', storage: wx }))
 *    ```
 * 此外 `persistencePlugin.install(store, options)` 也接受可选的第二参数 options，
 * 以兼容 `(persistencePlugin as any).install(store, {...})` 的调用方式。
 */
// 使用工厂函数创建"可调用 + 可安装"的插件：
// - 作为函数调用时：persistencePlugin(options) 返回新的带配置 Plugin
// - 作为 Plugin 对象使用时：具有 name / install 属性（使用默认选项）
const _persistencePluginFactory = <S extends State = State>(options?: PersistenceOptions<S>): Plugin => ({
  name: 'persistence',
  install: (store) => installPersistence(store as unknown as Store<S>, options),
})

// 附加 Plugin 属性（使用 defineProperty 避免 name 属性只读限制）
Object.defineProperty(_persistencePluginFactory, 'name', {
  value: 'persistence',
  writable: true,
  configurable: true,
})
;(_persistencePluginFactory as unknown as Plugin).install = <S extends State>(store: Store<S>, options?: PersistenceOptions<S>) =>
  installPersistence(store, options)

export const persistencePlugin: Plugin & {
  <S extends State = State>(options?: PersistenceOptions<S>): Plugin
} = _persistencePluginFactory as Plugin & {
  <S extends State = State>(options?: PersistenceOptions<S>): Plugin
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

  // 解析存储后端：优先使用传入的 storage（符合 getItem/setItem 接口），
  // 否则使用微信小程序的 wx.getStorageSync / setStorageSync / removeStorageSync；
  // 非微信环境（如测试/Node）wx 不存在，降级为内存存储避免 ReferenceError
  const userStorage = options.storage
  let storageAdapter: SyncStorageBackend
  if (userStorage && typeof userStorage === 'object' && 'getItem' in userStorage) {
    storageAdapter = userStorage as SyncStorageBackend
  } else {
    // 微信小程序 wx 为全局变量，经 globalThis 读取避免直接引用未声明标识符（TS2304）
    const wxGlobal = (
      globalThis as { wx?: { getStorageSync(k: string): unknown; setStorageSync(k: string, v: string): void; removeStorageSync(k: string): void } }
    ).wx
    if (wxGlobal && typeof wxGlobal.getStorageSync === 'function') {
      storageAdapter = {
        // 微信小程序同步存储
        getItem: (k: string) => {
          const v = wxGlobal.getStorageSync(k)
          return v === undefined || v === null ? null : (v as string)
        },
        setItem: (k: string, v: string) => wxGlobal.setStorageSync(k, v),
        removeItem: (k: string) => wxGlobal.removeStorageSync(k),
      }
    } else {
      // 降级：进程内存存储（重启即失，仅保证不抛错）
      if (!isProduction()) {
        console.warn('[GeomStore][persistence] 未检测到可用的 storage 后端（非微信环境且未传入 storage），降级为内存存储，持久化不生效')
      }
      const memoryMap = new Map<string, string>()
      storageAdapter = {
        getItem: (k: string) => memoryMap.get(k) ?? null,
        setItem: (k: string, v: string) => void memoryMap.set(k, v),
        removeItem: (k: string) => void memoryMap.delete(k),
      }
    }
  }

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

  const unsubscribe = store.subscribe((state) => {
    const stateToSave = filter ? filter(state) : state

    if (debounceMs > 0) {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(() => {
        // 卸载后不再执行保存操作
        if (isUninstalled) return
        saveState(stateToSave)
      }, debounceMs)
    } else {
      saveState(stateToSave)
    }
  })

  function saveState(state: Partial<S>): void {
    // 卸载后不再执行保存操作
    if (isUninstalled) return
    try {
      const serialized = JSON.stringify(state)
      storageAdapter.setItem(storageKey, serialized)
    } catch (error) {
      console.error('[GeomStore] Failed to persist state:', error)
      store.hooks.emit('onError', error as Error, 'persistence')
    }
  }

  return () => {
    isUninstalled = true
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    unsubscribe()
    // 仅在配置了 clearOnUninstall 时才清除存储数据
    if (clearOnUninstall) {
      try {
        storageAdapter.removeItem(storageKey)
      } catch {
        // 存储不可用时静默失败
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

    if (typeof globalThis !== 'undefined') {
      const globalObj = globalThis as unknown as Record<string, Record<string, unknown>>
      globalObj.__GEOMSTORE_STORES__ = globalObj.__GEOMSTORE_STORES__ || {}
      globalObj.__GEOMSTORE_STORES__[store.name] = store

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
        setState: (key: string, value: unknown) => {
          store.setState(key as never, value as never)
        },
        $patch: (partialState: unknown) => {
          store.$patch(partialState as never)
        },
        $replaceState: (newState: unknown) => {
          store.$replaceState(newState as never)
        },

        subscribe: (callback: (state: unknown) => void) => {
          return store.subscribe(callback)
        },

        use: (plugin: unknown) => {
          return store.use(plugin as never)
        },

        destroy: () => store.destroy(),
      }

      globalObj.__GEOMSTORE_DEVTOOLS__ = globalObj.__GEOMSTORE_DEVTOOLS__ || {}
      globalObj.__GEOMSTORE_DEVTOOLS__[store.name] = devtoolsAPI

      console.log(`[GeomStore][devtools] Access API at: globalThis.__GEOMSTORE_DEVTOOLS__["${store.name}"]`)
    }

    return () => {
      if (typeof globalThis !== 'undefined') {
        const globalObj = globalThis as unknown as Record<string, Record<string, unknown>>
        delete globalObj.__GEOMSTORE_STORES__?.[store.name]
        delete globalObj.__GEOMSTORE_DEVTOOLS__?.[store.name]
      }
    }
  },
}

export const builtinPlugins = [loggerPlugin, persistencePlugin, devtoolsPlugin]

export type { PersistenceOptions } from '../types/persistence'
