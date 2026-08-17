/**
 * GeomStore v1.0 - 时间旅行插件
 *
 * 提供时间旅行功能，可以：
 * - 记录状态快照
 * - 撤销/重做操作
 * - 跳转到任意历史状态
 * - 导出/导入历史
 *
 * @since 1.0.0
 */

import type { Store, State } from '../../types/store'
import type { Plugin } from '../../types/plugin'
import { isProduction, deepCloneState } from '../../core/store/utils'

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
      let traveling = false // 是否正在进行时间旅行

      // 记录快照
      const recordSnapshot = (state: S): void => {
        // 如果正在时间旅行，不记录快照
        if (traveling) {
          return
        }
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

      // 监控状态变化
      const unsubscribe = store.subscribe((state) => {
        if (autoRecord) {
          recordSnapshot(state as S)
        }
      })

      // 立即记录初始状态
      recordSnapshot(store.getState() as S)

      // 时间旅行API
      const api = {
        // 获取快照列表（快照时间戳在前、状态字段展开在后：状态自身字段优先，
        // 避免用户状态中名为 timestamp 的键被快照元数据覆盖）
        getSnapshots: () => snapshots.map((s) => ({ timestamp: s.timestamp, ...s.state })),

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

        // 导出历史
        exportHistory: () =>
          JSON.stringify(
            {
              snapshots,
              currentIndex,
            },
            null,
            2,
          ),

        // 导入历史
        importHistory: (json: string): void => {
          const data = JSON.parse(json)
          if (!Array.isArray(data.snapshots)) {
            return
          }
          // 结构校验：仅接受合法快照条目（state 为对象、timestamp 为数字），
          // 畸形数据直接跳过，避免污染历史导致 goTo/undo 异常
          const valid = data.snapshots.filter(
            (s: unknown): s is { state: S; timestamp: number } =>
              s !== null &&
              typeof s === 'object' &&
              (s as { state?: unknown }).state !== null &&
              typeof (s as { state?: unknown }).state === 'object' &&
              typeof (s as { timestamp?: unknown }).timestamp === 'number',
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
      type TimeTravelGlobal = typeof globalThis & { __GEOMSTORE_TIME_TRAVEL__?: Record<string, typeof api> }
      ;(store as TimeTravelStore).__timeTravel__ = api

      // 设置全局访问（生产环境不暴露，防止内部结构泄露）
      if (typeof globalThis !== 'undefined' && !isProduction()) {
        const g = globalThis as TimeTravelGlobal
        g.__GEOMSTORE_TIME_TRAVEL__ = g.__GEOMSTORE_TIME_TRAVEL__ || {}
        g.__GEOMSTORE_TIME_TRAVEL__[store.name] = api

        console.log(`[GeomStore][timeTravel] Time travel enabled for store "${store.name}"`)
        console.log(`[GeomStore][timeTravel] Access at: globalThis.__GEOMSTORE_TIME_TRAVEL__["${store.name}"]`)
      }

      return () => {
        unsubscribe()

        // 清理实例挂载的 API 引用，避免卸载后残留失效接口
        delete (store as TimeTravelStore).__timeTravel__

        // 清理全局引用
        if (typeof globalThis !== 'undefined') {
          delete (globalThis as TimeTravelGlobal).__GEOMSTORE_TIME_TRAVEL__?.[store.name]
        }

        snapshots.length = 0
        currentIndex = -1
      }
    },
  }
}
