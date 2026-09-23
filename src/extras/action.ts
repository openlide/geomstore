/**
 * Action 增强（可选能力，按需动态引入）
 *
 * 实现位于同层 `./action/`（v0.4.0 起由 `src/core/action` 物理下沉至 extras）：
 * - `ActionLoader` / `withLoading`：异步 Action 的 loading 状态托管
 * - `ActionExecutor`：并发与批量执行
 * - `ActionUtils`：Action 元信息与依赖注入工具
 * - 装饰器族（`withLog` / `withDebounce` / `withThrottle` / `withCache` /
 *   `withRetry` / `withTimeout` / `createDecorator`）由本入口统一再导出
 * - 防抖/节流挂起调用的宿主级收尾入口（`cancelDebouncedCalls` / `flushDebouncedCalls` /
 *   `disposeDebouncedState` / `cancelThrottledCalls` / `flushThrottledCalls` /
 *   `disposeThrottledState`）
 *
 * @example
 * ```ts
 * import { withLoading } from '@openlide/geomstore/extras/action'
 * ```
 *
 * @remarks 装饰器依赖 `experimentalDecorators`；启用前请确认编译配置已开启。
 */
export { ActionExecutor, ActionLoader, withLoading, ActionUtils } from './action/index.js'
export type { ActionUtilsOptions } from './action/index.js'
export { withLog, withDebounce, withThrottle, withCache, withRetry, withTimeout, createDecorator } from './action/index.js'
// 防抖/节流挂起调用的宿主级收尾入口（cancel 丢弃 / flush 立即执行 / dispose 释放状态）
export {
  cancelDebouncedCalls,
  flushDebouncedCalls,
  disposeDebouncedState,
  cancelThrottledCalls,
  flushThrottledCalls,
  disposeThrottledState,
} from './action/index.js'
export type { DecoratorOptions, CacheDecoratorOptions, RetryDecoratorOptions, ThrottleDecoratorOptions, LogDecoratorOptions } from './action/index.js'
// LogDecoratorOptions 的 `sink?: LogSink` 与 `redact?: (value, phase: LogPhase) => unknown`
// 引用了这两个类型：本入口若只转发 LogDecoratorOptions，调用方仍要深链才能写出带类型的 sink
export type { LogSink, LogPhase } from './action/index.js'
// getStats()/getAllStats() 的返回类型：本入口是 `withLog` / `ActionExecutor` 的官方落点，
// 缺它就得深链子文件才能给统计结果标注类型（头部 JSDoc 明确禁止深链）
export type { ActionStats } from './action/index.js'
// 同理：getErrorData() 的返回类型、executeWithRetry() 的入参类型，以及超时错误的身份判据
// （`withTimeout` 与 `executeWithTimeout` 产出的错误都带 `code === TIMEOUT_ERROR_CODE`，
// 跨入口识别超时靠它，不靠消息文本）
export type { ActionErrorData, RetryOptions, TimeoutError } from './action/index.js'
export { TIMEOUT_ERROR_CODE } from './action/index.js'
export type { AsyncActions, ActionResult, ActionLoaderOptions, ActionDecorator, ActionExecutionContext } from '../types/action.js'
