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
 * 以 DefineOwnProperty 语义写入合并结果的动态键。
 *
 * 键可能来自用户状态（`JSON.parse('{"__proto__":{...}}')` 的自有键）或 store 名：
 * `target[key] = value` 走 [[Set]]，'__proto__' 键会触发 Object.prototype 的 setter，
 * 该键被静默丢弃并把合并结果的原型换掉。仅该键走 defineProperty，
 * 普通键保持赋值写法（合并路径在 getState/通知热线上，避免每条键都做属性定义）。
 */
function assignMerged(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
    return
  }
  target[key] = value
}

/**
 * 命名空间模式：按 store.name 归并各子 store 视图。
 *
 * @param pick - 从子 store 取值的方法（getState / state / $snapshot）
 * @param freeze - 是否冻结合并结果（state getter 需冻结以阻止顶层写入）
 */
export function mergeNamespaced(stores: readonly Store[], pick: (store: Store) => Record<string, unknown>, freeze: boolean = false): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const store of stores) {
    assignMerged(result, store.name, pick(store))
  }
  return freeze ? (Object.freeze(result) as Record<string, unknown>) : result
}

/**
 * 非命名空间模式下平铺合并各 store 的 state 键。
 *
 * 同名键后者覆盖前者：**读取侧**（本函数）最终归属是最后一个含该键的 store，
 * 而**写入侧**（`store.setState` / `$patch` / `dispatch` / `getter`，见 helpers.ts 的
 * `findTargetStoreWithKey`）取第一个匹配的 store。这条读写分裂是平铺模式的既有语义，
 * 冲突时两边都可能与调用方预期不符，故至少在开发模式下给出冲突告警，
 * 避免覆盖关系静默发生、排查困难。需要确定性归属请改用命名空间模式。
 *
 * @param warnedConflicts - 已告警的冲突组合集合（实例级去重，避免高频读取刷屏）
 */
export function mergeStateMaps(
  stores: readonly Store[],
  // 返回类型放开 null/undefined：合并路径要能容忍未初始化/降级的子 store，
  // 而不是在渲染热路径上抛 TypeError（下方对空值按「无键可并」兜底）
  pick: (store: Store) => Record<string, unknown> | null | undefined,
  warnedConflicts: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  // 归属按 store **实例**记录：同名但不同的两个实例正是「静默覆盖」的真实场景，
  // 按名字比较会把它们判成同一所有者而漏报
  const keyOwners = isProduction() ? undefined : new Map<string, Store>()
  for (const store of stores) {
    // pick 的类型是「必返对象」，但子 store 可能处于未初始化/降级态而实际返回 null/undefined
    // （如被外部改写过 getState 的宿主、组合到一半的桩 store）：
    // 兜底空对象按「无键可并」处理，与 mergeNamespaced 直接挂原值不因空值抛错保持一致
    const source = pick(store) ?? {}
    for (const key of Object.keys(source)) {
      if (keyOwners) {
        const previousOwner = keyOwners.get(key)
        // 身份而非名字比较：同一实例在 stores 里出现两次（composeStore 不对入参去重）
        // 写入的是同一份值，没有「后者覆盖前者」可报；两个不同实例共用名字才是
        // 需要报出的静默覆盖，按名字比较恰好把它抑制掉
        if (previousOwner !== undefined && previousOwner !== store) {
          // 每个冲突组合只告警一次：getState/state 高频读取（渲染/computed）下
          // 重复告警会刷屏并带来每次调用的 Map 构建开销
          const conflictKey = `${key}(${previousOwner.name},${store.name})`
          if (!warnedConflicts.has(conflictKey)) {
            warnedConflicts.add(conflictKey)
            console.warn(
              `[composeStore] State key "${key}" exists in multiple stores (${previousOwner.name}, ${store.name}); ` +
                `"${store.name}" wins in merged state/snapshot（读取侧最终由最后一个含该键的 store 决定），` +
                `而写入（setState/$patch/dispatch/getter）路由到**第一个**含该键的 store：` +
                `两者可能不是同一个 store，故这类键上的写入在 getState() 里看不见；请使用命名空间模式消除歧义`,
            )
          }
        }
        // 冲突与否都要推进归属：告警要反映「上一个写入者 → 当前写入者」。
        // 只在非冲突分支记录会让所有者永远停在第一个 store，A/B/C 同名键时
        // 报成 (A,B) 与 (A,C)，真正被 C 覆盖的 B 从不出现在告警里
        keyOwners.set(key, store)
      }
      assignMerged(result, key, source[key])
    }
  }
  return result
}
