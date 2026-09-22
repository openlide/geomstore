/**
 * GeomStore - 内置插件
 */

import type { Store, State } from '../types/store.js'
import type { Plugin } from '../types/plugin.js'
import type { PersistenceOptions, StorageBackend } from '../types/persistence.js'
import { isPlainObject } from '../core/utils/helpers.js'
import { isProduction } from '../core/store/utils.js'
import { assertSyncStorageResult, isWxStorageSyncAvailable, WxStorageBackend } from './WxStorageBackend.js'
import { registerGlobalEntry } from './globalRegistry.js'

/**
 * devtools 插件在 globalThis 上的两处键位。
 *
 * 抽成常量的理由与 timeTravel 一致：同一个键串在「注册」与「日志提示」里各写一遍，
 * 改一处就会让日志指向一个不存在的路径
 */
const STORES_GLOBAL_KEY = '__GEOMSTORE_STORES__'
const DEVTOOLS_GLOBAL_KEY = '__GEOMSTORE_DEVTOOLS__'

/**
 * 恢复入口的载荷准入判定。
 *
 * `isPlainObject` 只检查顶层原型，而 `JSON.parse('{"__proto__":{…}}')` 产出的是**自有的
 * `__proto__` 数据属性**（不触发 `Object.prototype` 的 setter），因此照样通过：恢复出来的
 * 状态上 `__proto__` 读起来不是原型，是个带怪键的对象。深层同名键由克隆/合并层
 * （core/utils/clone.ts 以 defineProperty 复刻）兜底，这里收的是**入口**这一道，
 * 与 devtools 插件 `isImportableObject` 对同一个「不可信 JSON」入口的口径对齐
 */
function isRestorablePayload(value: unknown): boolean {
  return isPlainObject(value) && !Object.prototype.hasOwnProperty.call(value, '__proto__')
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
  //
  // 默认后端就是同目录的 `WxStorageBackend`（与显式传 `storage: new WxStorageBackend()`
  // 同一个实现）：此前这里是一段内联适配器，把「wx 缺失键返回 ''」和「返回值是 Promise」
  // 两件事各判一遍口径，与类里的实现随时会漂移
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
    // 避免恢复/保存被静默丢弃。
    // 异步检测只在实际调用点进行、不在安装期预判 Promise 返回值：后端可以合法地
    // 「同步 getItem + 异步 setItem」（Promise 包装的 localStorage），安装期只探 getItem
    // 会把这种混合后端误判为同步；且后端可在运行期被换实现
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
  } else if (isWxStorageSyncAvailable()) {
    // 微信小程序 wx 为全局变量，读取与「可用性判定」都在 `WxStorageBackend.ts` 单点完成
    // （isWxStorageSyncAvailable 要求三个方法齐备，与本函数上方对用户后端的形状校验同口径）。
    // 本类自带两道防护，与旧内联适配器一致：异步返回值报错（wx.setStorageSync 等
    // 由兼容层 polyfill 成 Promise 时不再留下无人处理的 rejection 并静默丢数据）、
    // 缺失键的 `''` 与非字符串载荷归一为 null
    storageAdapter = new WxStorageBackend()
  } else {
    // 降级：进程内存存储（重启即失，仅保证不抛错）
    const degradeMessage =
      '[GeomStore][persistence] 未检测到可用的 storage 后端（非微信环境、wx 同步 API 不齐备，且未传入 storage），降级为内存存储，持久化不生效'
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

  // 恢复后「待吸收」的序列化载荷：notify.async 下 $patch 的合并通知是微任务，
  // 会打到下方安装后才注册的订阅上。该通知只承载「恢复本身」的内容，不应触发回写——
  // 否则安装后立即覆写同一 tick 内其他实例写入的新数据，且每次启动都重写磁盘
  // （lastSaved 去重被绕过）。仅在首次通知且内容与恢复结果一致时吸收一次
  let absorbedSerialized: string | null = null

  /**
   * 「恢复被主动跳过」的出口：控制台留痕 + 转投 `onError`。
   *
   * 与本函数其余持久化失败（saveState 的 catch、clearOnUninstall 的 removeItem catch）
   * 同口径。只写 console 的话，生产环境（docs/ARCHITECTURE.md 的监控口径只认 onError）
   * 对「存量数据读不出来」完全无感：状态从默认值起步，而下一次变更就会把磁盘上仍然
   * 有效的旧载荷整份覆盖掉——严重度不低于一次写入失败
   */
  function skipRestore(reason: string): void {
    console.error(reason)
    store.hooks.emit('onError', new Error(reason), 'persistence')
  }

  if (shouldRestore) {
    try {
      const savedState = storageAdapter.getItem(storageKey)
      if (savedState) {
        const parsedState = JSON.parse(savedState)
        // 入口准入：确保解析结果是「可信的纯对象」，挡掉非纯对象与自带 `__proto__`
        // 自有数据属性的载荷（判据见 isRestorablePayload）
        if (!isRestorablePayload(parsedState)) {
          skipRestore('[GeomStore] Restored state is not a plain object, skipping restore')
        } else if (validate && !validate(parsedState)) {
          // 数据验证：如果提供了 validate 函数，校验通过后才恢复
          skipRestore('[GeomStore] Restored state failed validation, skipping restore')
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
      // 抛出的失败（后端读取出错、JSON 语法错误、$patch 被核心拒绝）同样要转投 onError：
      // 这条路径连「跳过」的日志都没有，静默后果与 skipRestore 描述一致
      store.hooks.emit('onError', error as Error, 'persistence')
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
          // 先复位句柄再判卸载：定时器已经触发，`debounceTimer` 就必须回到 null，
          // 否则后面的 `if (debounceTimer)` 不再表示「确有落盘待触发」
          debounceTimer = null
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
    // 待触发的定时器与 clearOnUninstall 无关，一律摘掉：它会拽住安装闭包和
    // stateToSave/pendingState 快照直到 debounceMs 之后（小程序运行时里一个活定时器
    // 足以让逻辑层无法释放）。只有「补写」才依赖 clearOnUninstall——开启清理时这份
    // 数据本来就要连磁盘条目一起删掉
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (!clearOnUninstall) {
      // 防抖窗口内卸载：pendingState 尚未落盘，先同步补写最后一次变更
      if (pendingState !== null) {
        saveState(pendingState)
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
    const unregisterStores = registerGlobalEntry(STORES_GLOBAL_KEY, store.name, store)
    console.log(`[GeomStore] DevTools enabled. Access store at:`, `globalThis.${STORES_GLOBAL_KEY}["${store.name}"]`)

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

    const unregisterDevtools = registerGlobalEntry(DEVTOOLS_GLOBAL_KEY, store.name, devtoolsAPI)
    console.log(`[GeomStore][devtools] Access API at: globalThis.${DEVTOOLS_GLOBAL_KEY}["${store.name}"]`)

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
