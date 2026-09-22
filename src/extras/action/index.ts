/**
 * GeomStore - Action 增强模块实现（v0.4.0 起由 `src/core/action` 物理下沉）
 *
 * 目录构成（`ActionHistory.ts` 是 `ActionExecutor` 的内部记账层，不对外导出）：
 * - `ActionLoader.ts` / `withLoading.ts`：异步 Action 的 loading 状态托管
 * - `AsyncActionSupport.ts`：`ActionExecutor` 并发与批量执行
 * - `ActionUtils.ts`：Action 元信息与依赖注入工具
 * - `ActionHistory.ts`：Action 执行历史（仅其统计类型 `ActionStats` 对外）
 * - `decorators/`：日志 / 防抖 / 节流 / 缓存 / 重试 / 超时装饰器
 *
 * @remarks 所有导出集中由本入口统一管理，外部请勿深链子文件，以免后续重构破坏引用。
 */

// ==================== 类导出 ====================
export { ActionLoader } from './ActionLoader.js'
export { withLoading } from './withLoading.js'
export { ActionUtils } from './ActionUtils.js'
export { ActionExecutor } from './AsyncActionSupport.js'
export type { ActionUtilsOptions } from './ActionUtils.js'
// getStats()/getAllStats() 的返回类型：不外泄调用方就无法给统计结果标注类型
export type { ActionStats } from './ActionHistory.js'

// ==================== 装饰器导出（含选项类型，统一经 decorators 桶再导出） ====================
export {
  withLog,
  withDebounce,
  withThrottle,
  withCache,
  withRetry,
  withTimeout,
  createDecorator,
  cancelDebouncedCalls,
  flushDebouncedCalls,
  disposeDebouncedState,
  cancelThrottledCalls,
  flushThrottledCalls,
  disposeThrottledState,
  type DecoratorOptions,
  type CacheDecoratorOptions,
  type RetryDecoratorOptions,
  type ThrottleDecoratorOptions,
  type LogDecoratorOptions,
} from './decorators/index.js'

// ==================== 类型导出（集中管理） ====================
export type { AsyncActions, ActionResult, ActionLoaderOptions, ActionDecorator, ActionExecutionContext } from '../../types/action.js'
