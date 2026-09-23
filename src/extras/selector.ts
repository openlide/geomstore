/**
 * 状态选择器（可选能力，按需动态引入）
 *
 * 实现位于同层 `./selector/`（v0.4.0 起由 `src/core/selector` 物理下沉至 extras），
 * 本文件是 `export * from './selector/index.js'` 的薄壳，公开面即该 index 的清单：
 *
 * - 值：`createSelector` / `createMemoizedSelector` / `createStructuredSelector`
 *   / `createParametricSelector` / `createRetrySelector` / `createRetrySelectorAsync`
 *   / `SelectorFactory` / `SelectorComposer`
 * - 类型：`RetrySelectorOptions` / `AsyncRetrySelectorOptions`（来自 `selectorComposer`），
 *   以及 `Selector` / `SelectorOptions` / `SelectorCacheItem` / `SelectorResult`
 *   / `SelectorComposerInput` / `ParametricSelector`（定义在 `src/types/selector.ts`）
 *
 * 本文件的增删以 `./selector/index.ts` 为准，不要在此另立一份口径。
 *
 * @example
 * ```ts
 * import { createSelector } from '@openlide/geomstore/extras/selector'
 *
 * // 签名是 createSelector(selectorFn, options?)：派生逻辑就写在 selectorFn 里，
 * // 这里**没有** reselect 那样的「输入选择器 + 组合函数」两参形态
 * const selectDouble = createSelector((s: State) => s.count * 2)
 *
 * // 需要控制缓存时走第二个参数（口径见 types/selector.ts 的 SelectorOptions）
 * const selectName = createSelector((s: State) => s.user.name, {
 *   cache: true,
 *   cacheTTL: 10000,
 * })
 * ```
 *
 * @remarks 选择器缓存的失效依据是 `core/store` 的 state 版本号（`getStateVersion`），
 * 故须与同一 Store 实例配合使用；跨实例复用会失去缓存意义。
 */
export * from './selector/index.js'
