/**
 * Action 增强（可选能力，按需动态引入）
 *
 * 实现位于同层 `./action/`（v0.5.0 起由 `src/core/action` 物理下沉至 extras）：
 * - `ActionLoader` / `withLoading`：异步 Action 的 loading 状态托管
 * - `ActionExecutor`：并发与批量执行
 * - `ActionUtils`：Action 元信息与依赖注入工具
 * - 装饰器族（`withLog` / `withDebounce` / `withThrottle` / `withCache` /
 *   `withRetry` / `withTimeout` / `createDecorator`）由本入口统一再导出
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
export type { DecoratorOptions, CacheDecoratorOptions, RetryDecoratorOptions, ThrottleDecoratorOptions } from './action/index.js'
export type { AsyncActions, ActionResult, ActionLoaderOptions, ActionDecorator, ActionExecutionContext } from '../types/action.js'
