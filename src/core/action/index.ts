/**
 * GeomStore v1.0 - Action增强模块导出
 *
 * 架构优化说明：
 * - 装饰器已迁移至 decorators 子目录，职责更清晰
 * - ActionUtils 支持依赖注入，便于测试和扩展
 * - 所有导出集中在入口文件管理
 *
 * @since 1.0.0
 */

// ==================== 类导出 ====================
export { ActionLoader, withLoading } from './ActionLoader'
export { ActionUtils } from './ActionUtils'
export { ActionExecutor } from './AsyncActionSupport'
export type { ActionUtilsOptions } from './ActionUtils'

// ==================== 装饰器导出 ====================
export { withLog, withDebounce, withThrottle, withCache, withRetry, withTimeout, createDecorator } from './decorators/index'

// ==================== 装饰器类型导出 ====================
export type { CacheDecoratorOptions } from './decorators/cache'
export type { DecoratorOptions } from './decorators/common'
export type { RetryDecoratorOptions } from './decorators/retry'

// ==================== 类型导出（集中管理） ====================
export type { AsyncActions, ActionResult, ActionLoaderOptions, ActionDecorator, ActionExecutionContext } from '../../types/action'
