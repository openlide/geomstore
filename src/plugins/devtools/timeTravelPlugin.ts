/**
 * GeomStore - 时间旅行插件
 *
 * 提供时间旅行功能，可以：
 * - 记录状态快照
 * - 撤销/重做操作
 * - 跳转到任意历史状态
 * - 导出/导入历史
 *
 */

import type { Store, State } from '../../types/store.js'
import type { Plugin } from '../../types/plugin.js'
import { isProduction, deepCloneState } from '../../core/store/utils.js'
import { getStateVersion } from '../../core/store/stateVersion.js'
import { registerGlobalEntry } from '../globalRegistry.js'

/**
 * 循环引用安全的 JSON 序列化
 *
 * recordSnapshot 特意复用 deepCloneState 以支持循环引用（见其注释），因此 snapshots
 * 可以合法含环；直接 JSON.stringify 会抛 "Converting circular structure to JSON"，
 * 使 exportHistory 对该插件明确支持的状态形态失效。
 *
 * 采用祖先路径跟踪算法（json-stringify-safe 同款）：只把真正构成环的引用替换为
 * "[Circular]" 占位，不误伤菱形共享引用。此处不用更短的 WeakSet 方案——
 * deepCloneState 对不可克隆对象（类实例等）保留原引用，多个快照之间会真实共享
 * 同一实例，WeakSet 会把第二个快照里的该实例误标为环，导出结果失真。
 *
 * @private
 */
function jsonStringifySafe(value: unknown, space?: number): string {
  const stack: unknown[] = []
  return JSON.stringify(
    value,
    function (this: unknown, _key: string, val: unknown): unknown {
      if (stack.length > 0) {
        const thisPos = stack.indexOf(this)
        if (thisPos !== -1) {
          // 回到祖先层：截断该层之后的路径
          stack.splice(thisPos + 1)
        } else {
          stack.push(this)
        }
        if (stack.indexOf(val) !== -1) {
          return '[Circular]'
        }
      } else {
        stack.push(val)
      }
      return val
    },
    space,
  )
}

/**
 * 时间旅行选项
 *
 * @interface TimeTravelOptions
 * @template S - 状态类型
 * @property {number} [maxSize=50] - 最大快照数量
 * @property {(state: S) => boolean} [filter] - 过滤函数，决定是否记录快照
 * @property {boolean} [autoRecord=true] - 是否自动记录快照
 *
 * @example
 * ```typescript
 * const options: TimeTravelOptions<MyState> = {
 *   maxSize: 100,                      // 最多保留100个快照
 *   filter: (state) => {               // 只记录特定状态的快照
 *     return state.isDirty || state.hasChanges
 *   },
 *   autoRecord: true                   // 自动记录所有状态变化
 * }
 * ```
 */
export interface TimeTravelOptions<S extends State = State> {
  /** 最大快照数量 */
  maxSize?: number
  /** 过滤函数 */
  filter?: (state: S) => boolean
  /** 是否自动记录 */
  autoRecord?: boolean
}

/**
 * 外部输入对象的结构准入判断（importHistory 专用）
 *
 * 三条口径与 `Store.$replaceState` 的准入条件对齐（见 core/store/Store.ts）：
 * - 非 null 的 `typeof === 'object'`
 * - **排除数组**：数组同样过 `typeof === 'object'`，放行后 `goTo/undo/redo` 会打到
 *   核心的 `[GeomStore] $replaceState: newState must be a plain object`，
 *   与本文件「畸形数据直接跳过，避免污染历史」的注释自相矛盾
 * - 排除自带 `__proto__` 自有键的对象：`JSON.parse` 产出的是**数据属性**（不触发 setter），
 *   会一路通过校验，把 `state.__proto__` 读起来不是原型的怪对象塞进活状态。
 *   （core/utils/clone.ts 已在克隆处用 defineProperty 复刻该键、原型未被导入数据接管，
 *   实测全局原型也不受影响，故这里是「入口收紧」而非唯一防线；更深层的 `__proto__`
 *   键仍由克隆层的同一防护兜底）
 */
function isImportableObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !Object.prototype.hasOwnProperty.call(value as object, '__proto__')
}

/**
 * 时间旅行插件
 *
 * 提供状态历史记录和时间旅行功能
 *
 * @function
 * @template S - 状态类型
 * @param {TimeTravelOptions<S>} [options={}] - 配置选项
 * @returns {Plugin} 插件实例
 *
 * @example
 * ```typescript
 * import { createStore } from '@geomstore/core'
 * import { timeTravelPlugin } from '@geomstore/plugins'
 *
 * const store = createStore({
 *   name: 'todo',
 *   state: {
 *     items: [],
 *     filter: 'all'
 *   },
 *   actions: {
 *     addItem(text) {
 *       this.setState('items', [...this.state.items, { text, done: false }])
 *     },
 *     toggleItem(index) {
 *       const items = [...this.state.items]
 *       items[index].done = !items[index].done
 *       this.setState('items', items)
 *     },
 *     removeItem(index) {
 *       this.setState('items', this.state.items.filter((_, i) => i !== index))
 *     }
 *   }
 * })
 *
 * // 使用默认配置安装
 * store.use(timeTravelPlugin())
 *
 * // 使用自定义配置安装
 * store.use(timeTravelPlugin({
 *   maxSize: 100,                    // 保留100个快照
 *   autoRecord: true,                 // 自动记录
 *   filter: (state) => {              // 只记录有修改的状态
 *     return state.items.length > 0
 *   }
 * }))
 *
 * // 访问时间旅行API
 * const api = store.__timeTravel__
 * // 或
 * const api = globalThis.__GEOMSTORE_TIME_TRAVEL__['todo']
 *
 * // 获取所有快照
 * const snapshots = api.getSnapshots()
 * console.log(`Total snapshots: ${snapshots.length}`)
 *
 * // 撤销操作
 * if (api.canUndo()) {
 *   api.undo()
 * }
 *
 * // 重做操作
 * if (api.canRedo()) {
 *   api.redo()
 * }
 *
 * // 跳转到指定快照
 * api.goTo(5)  // 跳转到第6个快照（索引从0开始）
 *
 * // 手动记录快照
 * api.record()
 *
 * // 导出历史
 * const historyJSON = api.exportHistory()
 * console.log(historyJSON)
 *
 * // 导入历史
 * api.importHistory(historyJSON)
 *
 * // 清除历史
 * api.clear()
 * ```
 */
export const timeTravelPlugin = <S extends State = State>(options: TimeTravelOptions<S> = {}): Plugin => {
  const { maxSize = 50, filter, autoRecord = true } = options

  return {
    name: 'timeTravel',

    install(store: Store) {
      const snapshots: Array<{ state: S; timestamp: number }> = []
      let currentIndex = -1
      let traveling = false // 是否正在进行时间旅行（同步通知窗口内）
      /**
       * 时间旅行产生的待吞通知对应的状态版本号。
       *
       * notify.async 下 $replaceState 的通知在微任务里到达，届时 traveling 已复位；
       * 若照常记录，回放的状态会被当作新分支写入并删掉 redo 历史（undo 后无法 redo）。
       * 用状态版本号识别「这一次通知就是旅行回放」：版本未再前进才吞掉，真实变更照常记录。
       */
      let pendingTravelVersion: number | undefined

      // 记录快照（手动 record 与初始记录走此路径：不做回放吞并判断，
      // 用户显式要求记录时不应被启发式静默丢弃）
      const recordSnapshot = (state: S): void => {
        // 检查过滤函数
        if (filter && !filter(state)) {
          return
        }

        // 如果不在最新位置，删除当前位置之后的所有快照
        if (currentIndex < snapshots.length - 1) {
          snapshots.splice(currentIndex + 1)
        }

        // 添加快照（复用库内统一克隆：支持循环引用与 Date/RegExp/Map/Set，
        // 避免 JSON 往返在循环引用下抛错、非 JSON 类型退化的问题）
        snapshots.push({
          state: deepCloneState(state),
          timestamp: Date.now(),
        })

        // 更新索引
        currentIndex = snapshots.length - 1

        // 限制大小
        if (snapshots.length > maxSize) {
          snapshots.shift()
          currentIndex--
        }
      }

      /**
       * 通知路径的记录：先做回放吞并判断，再落到 recordSnapshot。
       *
       * 判断只在此路径生效——手动 api.record() 是用户的显式要求，不能被吞。
       * 标记按「状态版本未再前进」识别这一次通知就是旅行回放，真实变更照常记录。
       */
      const recordFromNotification = (state: S): void => {
        // 同步通知窗口内的回放：traveling 尚未复位
        if (traveling) {
          return
        }
        if (pendingTravelVersion !== undefined) {
          const isTravelEcho = getStateVersion(store.state) === pendingTravelVersion
          pendingTravelVersion = undefined
          if (isTravelEcho) {
            return
          }
        }
        recordSnapshot(state)
      }

      // 监控状态变化
      // 只读订阅：仅读取状态做快照，不修改载荷（快照自身仍需独立深拷贝，
      // 否则会与后续变更共享活引用），避免额外引入一份整树深拷贝
      const unsubscribe = store.subscribe(
        (state) => {
          if (autoRecord) {
            recordFromNotification(state as S)
          }
        },
        { readOnly: true },
      )

      // 立即记录初始状态
      recordSnapshot(store.getState() as S)

      // 时间旅行API
      const api = {
        // 获取快照列表（快照时间戳在前、状态字段展开在后：状态自身字段优先，
        // 避免用户状态中名为 timestamp 的键被快照元数据覆盖）
        // 与记录快照使用同一克隆策略：隔离支持的嵌套类型，保留不可安全克隆
        // 的类实例/WeakMap/Promise 等原引用，不用 JSON 或 structuredClone 改变兼容性。
        getSnapshots: () => snapshots.map((s) => ({ timestamp: s.timestamp, ...deepCloneState(s.state) })),

        // 获取快照数量
        getSnapshotCount: () => snapshots.length,

        // 获取当前索引
        getCurrentIndex: () => currentIndex,

        // 跳转到指定快照
        goTo: (index: number): void => {
          if (index < 0 || index >= snapshots.length) {
            throw new Error(`[timeTravel] Index ${index} out of bounds [0, ${snapshots.length})`)
          }

          const snapshot = snapshots[index]
          currentIndex = index
          traveling = true
          try {
            store.$replaceState(snapshot.state)
            // 同步通知下回放已在 traveling 窗口内被吞掉；这里为异步通知留下识别标记，
            // 版本号在本次回放后再未前进时，下一次通知即为该回放本身
            pendingTravelVersion = getStateVersion(store.state)
          } finally {
            traveling = false
          }
        },

        // 跳转到指定时间戳
        goToTime: (timestamp: number): void => {
          const index = snapshots.findIndex((s) => s.timestamp >= timestamp)
          if (index === -1) {
            throw new Error(`[timeTravel] No snapshot found at timestamp ${timestamp}`)
          }

          api.goTo(index)
        },

        // 撤销
        undo: (): void => {
          if (currentIndex > 0) {
            currentIndex--
            api.goTo(currentIndex)
          } else {
            console.warn('[timeTravel] Cannot undo: already at first snapshot')
          }
        },

        // 重做
        redo: (): void => {
          if (currentIndex < snapshots.length - 1) {
            currentIndex++
            api.goTo(currentIndex)
          } else {
            console.warn('[timeTravel] Cannot redo: already at latest snapshot')
          }
        },

        // 可以撤销
        canUndo: (): boolean => currentIndex > 0,

        // 可以重做
        canRedo: (): boolean => currentIndex < snapshots.length - 1,

        // 清除历史
        clear: (): void => {
          snapshots.length = 0
          currentIndex = -1
        },

        // 手动记录快照
        record: (state?: S): void => {
          recordSnapshot(state || (store.getState() as S))
        },

        // 导出历史（循环引用安全：snapshots 可含环，见 jsonStringifySafe 注释）
        exportHistory: () =>
          jsonStringifySafe(
            {
              snapshots,
              currentIndex,
            },
            2,
          ),

        // 导入历史
        importHistory: (json: string): void => {
          const data = JSON.parse(json)
          // JSON.parse('null') 合法但 data.snapshots 会抛 TypeError，与函数内
          // 其余畸形数据静默跳过的防御风格保持一致
          if (!data || typeof data !== 'object' || !Array.isArray(data.snapshots)) {
            return
          }
          // 结构校验：仅接受合法快照条目（state 为可导入对象、timestamp 为数字），
          // 畸形数据直接跳过，避免污染历史导致 goTo/undo 异常
          const valid = data.snapshots.filter(
            (s: unknown): s is { state: S; timestamp: number } =>
              isImportableObject(s) && isImportableObject((s as { state?: unknown }).state) && typeof (s as { timestamp?: unknown }).timestamp === 'number',
          )
          if (valid.length === 0) {
            return
          }
          snapshots.length = 0
          snapshots.push(...valid)
          // currentIndex 钳制到合法范围（缺省为最后一个）；小数向下取整，
          // 避免小数索引取 snapshots[1.5] 得 undefined 传入 $replaceState 抛错
          currentIndex =
            typeof data.currentIndex === 'number' ? Math.min(Math.max(Math.floor(data.currentIndex), 0), snapshots.length - 1) : snapshots.length - 1
          // 导入同样受 maxSize 限制：超出部分淘汰最旧快照并同步修正索引
          if (snapshots.length > maxSize) {
            const overflow = snapshots.length - maxSize
            snapshots.splice(0, overflow)
            currentIndex = Math.max(0, currentIndex - overflow)
          }
        },
      }

      // 暴露API（实例挂载字段为非正式接口，用交叉类型收敛，避免 any 断言）
      type TimeTravelStore = Store & { __timeTravel__?: unknown }
      ;(store as TimeTravelStore).__timeTravel__ = api

      // 设置全局访问（生产环境不暴露，防止内部结构泄露）
      let unregisterGlobal: () => void = () => {}
      if (!isProduction()) {
        unregisterGlobal = registerGlobalEntry('__GEOMSTORE_TIME_TRAVEL__', store.name, api)
        console.log(`[GeomStore][timeTravel] Time travel enabled for store "${store.name}"`)
        console.log(`[GeomStore][timeTravel] Access at: globalThis.__GEOMSTORE_TIME_TRAVEL__["${store.name}"]`)
      }

      return () => {
        unsubscribe()

        // 身份守卫：同 store 后装的第二实例会覆盖这些引用，卸载只清理仍属于
        // 本实例的条目，避免误删后续插件的接口（与 analyzer 插件的守卫模式对齐）
        if ((store as TimeTravelStore).__timeTravel__ === api) {
          delete (store as TimeTravelStore).__timeTravel__
        }

        // 清理全局引用（同样仅限仍是本实例注册的条目）
        unregisterGlobal()

        snapshots.length = 0
        currentIndex = -1
      }
    },
  }
}
