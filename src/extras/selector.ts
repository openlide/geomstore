/**
 * 状态选择器（可选能力，按需动态引入）
 *
 * 实现位于同层 `./selector/`（v0.4.0 起由 `src/core/selector` 物理下沉至 extras）：
 * - `createSelector` / `createMemoizedSelector` / `createStructuredSelector`
 * - `createParametricSelector`：带参数选择器
 * - `SelectorComposer`：异步、重试等组合形态
 *
 * @example
 * ```ts
 * import { createSelector } from '@openlide/geomstore/extras/selector'
 *
 * const selectDouble = createSelector(
 *   (s: State) => s.count,
 *   (count) => count * 2,
 * )
 * ```
 *
 * @remarks 选择器缓存的失效依据是 `core/store` 的 state 版本号（`getStateVersion`），
 * 故须与同一 Store 实例配合使用；跨实例复用会失去缓存意义。
 */
export * from './selector/index.js'
