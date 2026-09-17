/**
 * GeomStore - composeStore 模块级辅助函数
 *
 * 自 composeStore.ts 拆出：子 store 写入分发、目标 store/键查找与 action 名解析。
 * 均为模块级纯函数（不持有任何实例状态），供 ComposedStore 各方法调用。
 *
 * @module compose/helpers
 */

import type { Store } from '../../types/store.js'
import type { HookName } from '../../types/plugin.js'
import { isProduction } from '../store/utils.js'

/** 全部生命周期钩子名：组合层桥接子 Store 钩子时逐个转发 */
export const ALL_HOOK_NAMES: HookName[] = [
  'beforeSetState',
  'afterSetState',
  'beforePatch',
  'afterPatch',
  'beforeDispatch',
  'afterDispatch',
  'beforeReplaceState',
  'afterReplaceState',
  'onError',
]

/**
 * 对子 store 应用写入，跳过已被独立销毁的子 store
 *
 * 子 store 可在组合之外被独立销毁，此时 $patch/$replaceState 会抛
 * "Cannot call … on a destroyed Store"。此前该异常直接冒泡使循环中断在中间：
 * 已处理的 store 写入了、之后的 store 永不写入——既没保住一致性又抛了错，
 * 交付的是调用方无法解释的半更新状态。
 *
 * 跳过口径与 _startBatchOnStores / _endBatchOnStores / 企业版 runForegroundChecks
 * 三处一致（均为「子 store 可被独立销毁 → 跳过」）。不受 strict 影响：
 * strict 的既有语义是「访问不存在的 Store 报错」，而「存在但已销毁」是另一种故障，
 * 混进去会让 strict 模式重新产生半更新。
 */
function applyToStore<T>(store: Store, value: T, handler: (store: Store, value: T) => void): void {
  if (store.destroyed) {
    if (!isProduction()) {
      console.warn(`[composeStore] 子 store "${store.name}" 已销毁，跳过对它的写入（其余 store 不受影响）`)
    }
    return
  }
  try {
    handler(store, value)
  } catch (error) {
    // 只吞「判断之后才被销毁」的竞态；其他异常照常冒泡，不掩盖真实故障
    if (store.destroyed) {
      if (!isProduction()) {
        console.warn(`[composeStore] 子 store "${store.name}" 在写入期间被销毁，已跳过`)
      }
      return
    }
    throw error
  }
}

/**
 * 根据命名空间分发操作到对应 store
 */
export function dispatchByNamespace<T>(
  stores: Store[],
  namespace: string | boolean | undefined,
  data: Record<string, T>,
  strict: boolean,
  handler: (store: Store, value: T) => void,
  options?: { warnMissingKeys?: boolean },
): void {
  if (namespace) {
    // 命名空间模式：每个顶层键是一个 store
    for (const key in data) {
      const value = data[key]
      const targetStore = stores.find((s) => s.name === key)
      if (targetStore) {
        applyToStore(targetStore, value as T, handler)
      } else if (strict) {
        throw new Error(`[composeStore] Cannot find store for key: ${key}`)
      }
    }
  } else {
    // 非命名空间模式：需要先分组
    const storeGroups = new Map<Store, Record<string, T>>()
    // 命名空间内层的键需还原成内层期望的形状（{ 子store名: { 键: 值 } }），
    // 不能按原样透传——内层的命名空间查找以顶层键为 store 名
    const nestedGroups = new Map<Store, Record<string, Record<string, T>>>()

    for (const key in data) {
      const value = data[key]
      const targetStore = findTargetStore(key, stores, namespace)
      if (targetStore && !options?.warnMissingKeys) {
        const nested = (targetStore as { stores?: Record<string, unknown> }).stores
        const separator = key.indexOf('/')
        if (nested && separator > 0) {
          const head = key.slice(0, separator)
          if (Object.prototype.hasOwnProperty.call(nested, head)) {
            let payload = nestedGroups.get(targetStore)
            if (!payload) {
              payload = {}
              nestedGroups.set(targetStore, payload)
            }
            const bucket = (payload[head] ?? {}) as Record<string, T>
            bucket[key.slice(separator + 1)] = value
            payload[head] = bucket
            continue
          }
        }
      }
      if (targetStore) {
        let group = storeGroups.get(targetStore)
        if (!group) {
          group = {}
          storeGroups.set(targetStore, group)
        }
        group[key] = value
      } else if (strict) {
        throw new Error(`[composeStore] Cannot find store for key: ${key}`)
      }
    }

    // 先应用嵌套分组：内层组合自行按命名空间规则路由到具体子 store
    for (const [store, payload] of nestedGroups) {
      applyToStore(store, payload as T, handler)
    }

    // 一次性调用每个 store
    for (const [store, groupData] of storeGroups) {
      // $replaceState 整体替换语义下，分组数据缺失会丢失 store 中的既有键，
      // 开发模式下告警提示（保留替换语义不变，避免破坏既有行为）。
      // 已销毁的子 store 会被 applyToStore 跳过，为它输出该告警是误导性噪音
      if (!store.destroyed && options?.warnMissingKeys) {
        const stateKeys = Object.keys(store.getState())
        const providedKeys = Object.keys(groupData)
        const missing = stateKeys.filter((k) => !providedKeys.includes(k))
        if (missing.length > 0) {
          console.warn(`[composeStore] $replaceState 未包含 store "${store.name}" 的键 [${missing.join(', ')}]，整体替换后这些键将丢失；如需保留请使用 $patch`)
        }
      }
      applyToStore(store, groupData as T, handler)
    }
  }
}

/**
 * 查找目标store并提取实际的键
 *
 * 修复：非命名空间模式下，如果多个 store 包含相同的 key，
 * 抛出错误以避免非确定性行为
 */
export function findTargetStoreWithKey(key: string, stores: Store[], namespace?: string | boolean): [Store | undefined, string] {
  if (namespace) {
    // 命名空间模式：key = storeName/actualKey
    const parts = key.split('/')
    const storeName = parts[0]
    const actualKey = parts.slice(1).join('/') // 支持多级路径
    // key 不含 "/" 时视为未找到目标（由调用方按 strict 抛错或忽略），
    // 避免在子 store 上写入空字符串键
    if (!actualKey) {
      return [undefined, key]
    }
    const targetStore = stores.find((s) => s.name === storeName)
    return [targetStore, actualKey]
  } else {
    // 非命名空间模式：直接查找
    // 修复：检查是否有多个 store 包含相同的 key，避免非确定性行为
    const matchingStores = stores.filter((s) => {
      const state = s.getState()
      // own property 判定：`in` 会命中 Object 原型链（'toString'/'constructor' 等），
      // 导致原型链属性名被误判为所有 store 都匹配并写入第一个 store
      return Object.prototype.hasOwnProperty.call(state, key)
    })

    if (matchingStores.length > 1) {
      console.warn(
        `[composeStore] Ambiguous key "${key}" found in multiple stores: ${matchingStores.map((s) => s.name).join(', ')}. ` +
          `Consider using namespaced mode for disambiguation.`,
      )
    }

    if (matchingStores.length === 0) {
      // 嵌套组合：非命名空间外层可包含命名空间内层，此时内层的子 store 以
      // 「子 store 名/键」的形式出现在合并状态里（如 'leaf/n'）。整串键在此
      // 匹配不到顶层键，交给持有该子 store 的内层组合按其自身模式继续解析，
      // 避免「dispatch 能用、setState 静默失败」的读写能力不对称
      const separator = key.indexOf('/')
      if (separator > 0) {
        const head = key.slice(0, separator)
        for (const store of stores) {
          const nested = (store as { stores?: Record<string, unknown> }).stores
          if (nested && Object.prototype.hasOwnProperty.call(nested, head)) {
            return [store, key]
          }
        }
      }
    }

    return [matchingStores[0], key]
  }
}

/**
 * 查找目标store
 */
function findTargetStore(key: string, stores: Store[], namespace?: string | boolean): Store | undefined {
  const [store] = findTargetStoreWithKey(key, stores, namespace)
  return store
}

/**
 * 解析action名称
 */
export function parseActionName(fullName: string, namespace?: string | boolean): [string, string] {
  if (namespace) {
    const parts = fullName.split('/')
    // 支持多级路径（如 store/a/b）：首段为 store 名，其余段合并为成员名，
    // 避免三级及以上路径静默落入裸名查找而失败
    if (parts.length >= 2) {
      return [parts[0], parts.slice(1).join('/')]
    }
  }
  // 如果没有命名空间，尝试从stores中查找
  return ['', fullName]
}
