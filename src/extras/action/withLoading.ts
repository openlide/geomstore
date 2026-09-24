/**
 * GeomStore - withLoading 方法装饰器
 *
 * 自 ActionLoader.ts 拆出：自动管理方法执行期间的 loading / error 状态，
 * 并按宿主 + 选项签名共享 ActionLoader 与 loading 引用计数。
 *
 * @module action/withLoading
 */

import type { ActionLoaderOptions } from '../../types/action.js'
import { ActionLoader, normalizeActionLoaderOptions } from './ActionLoader.js'
import { isTrackableHost } from './decorators/common.js'

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
 * 宿主对被装饰方法提供的最小能力：`ActionLoader.wrap` 用它写 loading / error 键。
 *
 * 声明成结构化类型而不是 `any`：本模块对宿主的**全部**要求就是这一项，写出来即契约；
 * 至于宿主是否可作为 WeakMap 键（决定 loader 能否跨调用共享），见 `isTrackableHost`。
 */
type LoadingHost = { setState?: (key: string, value: unknown) => void }

/** 宿主能否作为 WeakMap 键（对象/函数且非 null）——判据与 throttle / debounce 共用 common 里那一份 */

/**
 * 计算选项签名（缺省值与 `ActionLoader` 构造器同源：都走
 * {@link normalizeActionLoaderOptions} + `ACTION_LOADER_DEFAULTS`），用于注册表按配置分桶。
 *
 * 签名桶决定「哪些装饰器共用同一个 loader / 同一份 loading 计数」，故归一化必须与
 * 构造器逐项一致——两侧各写一份字面量时漂移过一次，且类型层无法约束这种同步。
 *
 * 序列化用 `JSON.stringify` 而非按分隔符拼接：键名由调用方给定，`|` 这类分隔符会造出
 * 相同串（`{loadingKey:'x|y',errorKey:'z'}` 与 `{loadingKey:'x',errorKey:'y|z'}` 都拼成
 * `true|x|y|z|false`），撞桶的两个装饰器共用一个 loader，后一个会静默按前一个的
 * loadingKey/errorKey 写状态。JSON 数组带引号与括号边界，任意字符串都无歧义。
 */
function resolveLoaderSignature(options: ActionLoaderOptions): string {
  const normalized = normalizeActionLoaderOptions(options)

  return JSON.stringify([normalized.autoLoading, normalized.loadingKey, normalized.errorKey, normalized.errorDataKey, normalized.perActionKeys])
}

/**
 * 计算 loading 签名：仅包含决定 loading 状态键的选项
 *
 * 序列化口径与 {@link resolveLoaderSignature} 一致（`JSON.stringify`），理由同上。
 */
function resolveLoadingSignature(options: ActionLoaderOptions): string {
  const normalized = normalizeActionLoaderOptions(options)

  return JSON.stringify([normalized.autoLoading, normalized.loadingKey, normalized.perActionKeys])
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

  return function (_target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor | undefined): PropertyDescriptor {
    // 与 withRetry / withTimeout / withThrottle / withCache 同一形态的守卫：
    // 访问器描述符（get/set）的 value 是 undefined，误用在 class field 上则根本没有
    // descriptor（只传两个实参）。不判的话前者把 `Cannot read properties of undefined
    // (reading 'bind')` 推迟到首次调用、后者在类定义时就抛同名 TypeError，
    // 两处报错都指不到「用错装饰目标」这个真正原因
    if (descriptor === undefined || typeof descriptor.value !== 'function') {
      throw new TypeError('[withLoading] can only decorate a method whose descriptor.value is a function')
    }
    const originalMethod = descriptor.value

    descriptor.value = async function (this: LoadingHost | null | undefined, ...args: unknown[]) {
      const setState = this?.setState?.bind(this)

      if (!setState) {
        throw new Error('[withLoading] Method must be used in a Store instance')
      }

      // 「有 setState」推不出「宿主可跟踪」：setState 可能来自原型链上的基本类型包装
      // （`Number.prototype.setState = fn` 后以 `method.call(1)` 调用），此时 WeakMap
      // 无从按宿主存状态。两条路径的差别只在 loader 能否跨调用共享，故在此分流：
      // 可跟踪宿主用注册表里的共享 loader（引用计数集中，见模块头），
      // 否则每次调用给一份独立计数，保证不跨调用串扰。
      let loaderInstance: ActionLoader
      if (isTrackableHost(this)) {
        // 函数宿主（静态方法里 `this` 是类构造器）同样是合法的 WeakMap 键，
        // 必须与对象宿主走同一条共享路径：否则每次调用都新建 loader，
        // 各自的 loading 引用计数互不可见，先完成的 action 会把共享键提前置 false，
        // ErrorBoundary 一类的按宿主状态也会丢掉历史
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
        loaderInstance = new ActionLoader({ ...options, sharedLoadingCounts: new Map() })
      }

      // 只绑定 this，参数由 wrapped(...args) 传入，避免参数被应用两次
      const wrapped = loaderInstance.wrap(originalMethod.bind(this), String(propertyKey), setState)

      return await wrapped(...args)
    }

    return descriptor
  }
}
