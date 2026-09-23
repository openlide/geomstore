/**
 * GeomStore - Action 装饰器（内部模块，经 `extras/action` 统一再导出）
 *
 * Action 相关装饰器集合：
 * - `withLog`：调用日志
 * - `withDebounce`：防抖 / `withThrottle`：节流
 * - `withCache`：结果缓存
 * - `withRetry`：失败重试 / `withTimeout`：超时中断
 * - `createDecorator`：自定义装饰器构造器
 *
 * 防抖/节流另有按宿主收尾的公开入口（`cancel*` 丢弃挂起调用、`flush*` 立即执行一次、
 * `dispose*` 取消并释放全部状态），供 Page `onUnload` / Component `detached` 调用。
 *
 * @remarks 装饰器依赖 `experimentalDecorators`；部分装饰器在生产构建下走轻量分支
 * （见各实现内的 `isProduction` 判断）。
 */

export { withLog } from './log.js'
export type { LogDecoratorOptions, LogSink, LogPhase } from './log.js'
// 防抖/节流窗口内挂起的调用有公开的收尾入口（cancel 丢弃 / flush 立即执行 / dispose 释放状态），
// 供宿主在 onUnload / detached 里按 `this` 调用
export { withDebounce, cancelDebouncedCalls, flushDebouncedCalls, disposeDebouncedState } from './debounce.js'
export { withThrottle, cancelThrottledCalls, flushThrottledCalls, disposeThrottledState } from './throttle.js'
export type { ThrottleDecoratorOptions } from './throttle.js'
export { withCache } from './cache.js'
export type { CacheDecoratorOptions } from './cache.js'
export { withRetry } from './retry.js'
export type { RetryDecoratorOptions } from './retry.js'
export { withTimeout } from './timeout.js'
export { createDecorator } from './common.js'
export type { DecoratorOptions } from './common.js'
