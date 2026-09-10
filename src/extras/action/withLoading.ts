/**
 * GeomStore - withLoading 方法装饰器
 *
 * 自 ActionLoader.ts 拆出：自动管理方法执行期间的 loading / error 状态，
 * 并按宿主 + 选项签名共享 ActionLoader 与 loading 引用计数。
 *
 * @module action/withLoading
 */

import type { ActionLoaderOptions } from '../../types/action.js'
import { ActionLoader } from './ActionLoader.js'

/**
 * 模块级 loader 注册表：宿主 → 选项签名 → ActionLoader。
 *
 * 每次 `@withLoading(...)` 装饰器应用都是一次独立的工厂调用，若各自按宿主持有
 * 独立 loader，同一宿主上多个被装饰方法的引用计数互相不可见：默认单键模式下
 * 两个方法并发时，先完成的方法会把共享的 loading 键提前置 false。
 * 按宿主 + 选项签名共享 loader 使计数集中。
 */
const loaderRegistry = new WeakMap<object, Map<string, ActionLoader>>()

/**
 * 模块级 loading 引用计数注册表：宿主 → loading 签名 → 计数 Map。
 *
 * loader 注册表按完整选项签名分桶，但 loading 键只由
 * (autoLoading, loadingKey, perActionKeys) 决定——相同 loading 键、不同
 * errorKey 的两个装饰器仍会分到独立 loader，各自的计数写同一个状态键。
 * 引用计数必须按 loading 签名（而非完整签名）集中，注入各 loader 共享。
 */
const loadingCountRegistry = new WeakMap<object, Map<string, Map<string, number>>>()

/**
 * 计算选项签名（与 ActionLoader 默认值同口径归一），用于注册表按配置分桶
 */
function resolveLoaderSignature(options: ActionLoaderOptions): string {
  return [
    options.autoLoading ?? true,
    options.loadingKey ?? 'loading',
    options.errorKey ?? 'error',
    options.errorDataKey ?? 'errorData',
    options.perActionKeys ?? false,
  ].join('|')
}

/**
 * 计算 loading 签名：仅包含决定 loading 状态键的选项
 */
function resolveLoadingSignature(options: ActionLoaderOptions): string {
  return [options.autoLoading ?? true, options.loadingKey ?? 'loading', options.perActionKeys ?? false].join('|')
}

/** 获取（或创建）宿主上按 loading 签名集中共享的引用计数存储 */
function getSharedLoadingCounts(host: object, options: ActionLoaderOptions): Map<string, number> {
  let byLoading = loadingCountRegistry.get(host)
  if (!byLoading) {
    byLoading = new Map()
    loadingCountRegistry.set(host, byLoading)
  }
  const loadingSignature = resolveLoadingSignature(options)
  let counts = byLoading.get(loadingSignature)
  if (!counts) {
    counts = new Map()
    byLoading.set(loadingSignature, counts)
  }
  return counts
}

/**
 * 创建withLoading装饰器
 *
 * 用于装饰类方法，自动管理方法执行时的loading状态
 *
 * @param {ActionLoaderOptions} [options={}] - 配置选项
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class UserStore {
 *   state = {
 *     loading: false,
 *     error: null,
 *     errorData: null
 *   }
 *
 *   @withLoading({ loadingKey: 'loading' })
 *   async fetchUser(userId: string) {
 *     const user = await api.getUser(userId)
 *     return user
 *   }
 * }
 *
 * const store = new UserStore()
 * await store.fetchUser('user123')
 * // store.state.loading = false (执行时为true)
 * ```
 */
export function withLoading(options: ActionLoaderOptions = {}): MethodDecorator {
  const signature = resolveLoaderSignature(options)

  return function (_target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor.value = async function (this: any, ...args: unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const setState = (this as any)?.setState?.bind(this)

      if (!setState) {
        throw new Error('[withLoading] Method must be used in a Store instance')
      }

      let loaderInstance: ActionLoader
      if (typeof this === 'object' && this !== null) {
        let byOptions = loaderRegistry.get(this)
        if (!byOptions) {
          byOptions = new Map()
          loaderRegistry.set(this, byOptions)
        }
        let loader = byOptions.get(signature)
        if (!loader) {
          loader = new ActionLoader({ ...options, sharedLoadingCounts: getSharedLoadingCounts(this, options) })
          byOptions.set(signature, loader)
        }
        loaderInstance = loader
      } else {
        // 宿主非对象（罕见）：一次性实例，不跨调用串扰
        loaderInstance = new ActionLoader(options)
      }

      // 只绑定 this，参数由 wrapped(...args) 传入，避免参数被应用两次
      const wrapped = loaderInstance.wrap(originalMethod.bind(this), String(propertyKey), setState)

      return await wrapped(...args)
    }

    return descriptor
  }
}
