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
 * 公开面除装饰器本身外还含防抖/节流的宿主级收尾入口：`cancelDebouncedCalls` /
 * `flushDebouncedCalls` / `disposeDebouncedState` 与节流侧的
 * `cancelThrottledCalls` / `flushThrottledCalls` / `disposeThrottledState`
 * （窗口/等待期内挂起的调用有公开收尾口径，供 Page `onUnload` / Component `detached` 按宿主调用）。
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
  // LogDecoratorOptions 的 sink?: LogSink 与 redact?: (value, phase: LogPhase) => unknown
  // 引用这两个类型，而本入口是外部唯一引用点（见上方 remarks）：不在此再导出，
  // 调用方要给自定义 sink / 脱敏钩子标注类型就只能深链 decorators/log.js
  type LogSink,
  type LogPhase,
} from './decorators/index.js'

// ==================== 类型导出（集中管理） ====================
export type { AsyncActions, ActionResult, ActionLoaderOptions, ActionDecorator, ActionExecutionContext } from '../../types/action.js'
// `ActionLoader.getErrorData()` 的返回类型与 `ActionExecutor.executeWithRetry()` 的入参类型：
// 与上方 ActionStats / LogSink 同一口径——本入口是这些 API 的官方落点，
// 缺它们调用方就只能给统计/错误数据/重试选项手写形状，或深链叶子模块（头部 JSDoc 禁止）。
export type { ActionErrorData } from './ActionLoader.js'
export type { RetryOptions, TimeoutError } from './async-core.js'
// 超时错误的身份判据：`withTimeout` 与 `ActionExecutor.executeWithTimeout` 都经
// `raceWithTimeout` 产出 `code === TIMEOUT_ERROR_CODE` 的错误（两入口的消息文本并不相同），
// 不导出这个常量，调用方就只剩「匹配大小写敏感的文案」这一条脆判据可用。
export { TIMEOUT_ERROR_CODE } from './async-core.js'
