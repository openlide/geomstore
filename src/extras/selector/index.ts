/**
 * GeomStore - 状态选择器模块实现（v0.4.0 起由 `src/core/selector` 物理下沉）
 *
 * 目录构成：
 * - `createSelector.ts`：基础 / 记忆化 / 结构化选择器
 * - `parametricSelector.ts`：带参数选择器
 * - `selectorComposer.ts`：异步、重试等组合形态
 * - `retrySelector.ts`：重试策略支撑
 *
 * @remarks 缓存失效依赖 `core/store` 的 `getStateVersion`，须与同一 Store 实例配合使用。
 */

export { createSelector, createMemoizedSelector, createParametricSelector, createStructuredSelector, SelectorFactory } from './createSelector.js'
export { SelectorComposer } from './selectorComposer.js'
export type { RetrySelectorOptions, AsyncRetrySelectorOptions } from './selectorComposer.js'
export type { Selector, SelectorOptions, SelectorCacheItem, SelectorResult, SelectorComposerInput, ParametricSelector } from '../../types/selector.js'
