/**
 * GeomStore - 状态选择器模块实现（v0.4.0 起由 `src/core/selector` 物理下沉）
 *
 * 目录构成：
 * - `createSelector.ts`：基础 / 记忆化 / 结构化选择器
 * - `parametricSelector.ts`：带参数选择器
 * - `selectorComposer.ts`：异步、重试等组合形态
 * - `retrySelector.ts`：重试策略支撑
 *
 * 公开面按「同一能力族的入口与选项一并导出」策展：重试工厂（`createRetrySelector` /
 * `createRetrySelectorAsync`）与它们的选项类型同源同出，消费方不必为了直接调用工厂
 * 去按深层路径 import `./retrySelector.js`；`SelectorComposer` 上的同名静态方法只是转调
 * 这两个工厂（见 `selectorComposer.ts`），两条路径等价。
 *
 * @remarks 缓存失效依赖 `core/store` 的 `getStateVersion`，须与同一 Store 实例配合使用。
 */

export { createSelector, createMemoizedSelector, createParametricSelector, createStructuredSelector, SelectorFactory } from './createSelector.js'
export { SelectorComposer } from './selectorComposer.js'
export { createRetrySelector, createRetrySelectorAsync } from './retrySelector.js'
export type { RetrySelectorOptions, AsyncRetrySelectorOptions } from './selectorComposer.js'
export type {
  Selector,
  SelectorOptions,
  SelectorCacheItem,
  SelectorResult,
  SelectorComposerInput,
  ParametricSelector,
  ParametricSelectorFactory,
} from '../../types/selector.js'
