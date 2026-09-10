/**
 * GeomStore - composeStore 的 state 合并策略
 *
 * 自 composeStore.ts 拆出：命名空间归并与非命名空间平铺合并。
 * 两者均为不持有实例状态的纯函数，由 ComposedStore 的
 * getState / state / $snapshot 共用（pick 决定取值源：getState / state / $snapshot）。
 *
 * @module compose/merge
 */

import type { Store } from '../../types/store.js'
import { isProduction } from '../store/utils.js'

/**
 * 命名空间模式：按 store.name 归并各子 store 视图。
 *
 * @param pick - 从子 store 取值的方法（getState / state / $snapshot）
 * @param freeze - 是否冻结合并结果（state getter 需冻结以阻止顶层写入）
 */
export function mergeNamespaced(stores: readonly Store[], pick: (store: Store) => Record<string, unknown>, freeze: boolean = false): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const store of stores) {
    result[store.name] = pick(store)
  }
  return freeze ? (Object.freeze(result) as Record<string, unknown>) : result
}

/**
 * 非命名空间模式下平铺合并各 store 的 state 键。
 *
 * 同名键后者覆盖前者，与 action/getter 冲突的处理一致（取第一个/最后一个并提示）：
 * 至少在开发模式下给出冲突告警，避免覆盖关系静默发生、排查困难。
 *
 * @param warnedConflicts - 已告警的冲突组合集合（实例级去重，避免高频读取刷屏）
 */
export function mergeStateMaps(
  stores: readonly Store[],
  pick: (store: Store) => Record<string, unknown>,
  warnedConflicts: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const keyOwners = isProduction() ? undefined : new Map<string, string>()
  for (const store of stores) {
    const source = pick(store)
    for (const key of Object.keys(source)) {
      if (keyOwners) {
        const previousOwner = keyOwners.get(key)
        if (previousOwner !== undefined && previousOwner !== store.name) {
          // 每个冲突组合只告警一次：getState/state 高频读取（渲染/computed）下
          // 重复告警会刷屏并带来每次调用的 Map 构建开销
          const conflictKey = `${key}(${previousOwner},${store.name})`
          if (!warnedConflicts.has(conflictKey)) {
            warnedConflicts.add(conflictKey)
            console.warn(
              `[composeStore] State key "${key}" exists in multiple stores (${previousOwner}, ${store.name}); ` +
                `"${store.name}" wins in merged state/snapshot. Consider using namespaced mode for disambiguation.`,
            )
          }
        } else {
          keyOwners.set(key, store.name)
        }
      }
      result[key] = source[key]
    }
  }
  return result
}
