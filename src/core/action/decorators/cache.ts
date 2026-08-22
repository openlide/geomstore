/**
 * GeomStore v1.0 - 缓存装饰器
 *
 * 缓存方法的执行结果，在TTL内重复调用时直接返回缓存结果
 *
 * 修复说明：原实现将 cache Map 声明在工厂函数作用域，导致同一装饰器装饰的
 * 所有方法/实例共享同一份缓存（闭包陷阱）。现改为按宿主对象（this）隔离缓存。
 *
 * @since 1.0.0
 */

import { isProduction } from '../../store/utils'

/**
 * 缓存装饰器选项
 */
export interface CacheDecoratorOptions {
  /** 缓存生存时间（毫秒） */
  ttl?: number
  /** 自定义缓存键函数（参数与被装饰方法一致） */
  keyFn?: (...args: unknown[]) => string
}

/** 单宿主缓存条目上限，防止参数空间大的方法导致 Map 无限增长 */
const MAX_CACHE_ENTRIES = 1000

/** Symbol 实例 → 唯一序号：同 description 的不同 Symbol 序列化后相同（symbol:Symbol(a)），
 *  不加区分会让依赖 Symbol 身份的方法串用缓存 */
// Map 而非 WeakMap：TS 的 WeakMap 键约束为 object（Symbol 键的 ES2023 扩展未反映到 lib）
const symbolIds = new Map<symbol, number>()
let nextSymbolId = 0

/**
 * async 函数原型引用：用于压缩安全的异步判定。
 * `fn.constructor.name === 'AsyncFunction'` 在压缩 mangle 后失效（name 被改写），
 * 改比较原型对象身份——压缩不会改变原型引用。
 * @private
 */
/* istanbul ignore next -- 空箭头函数体永不执行，仅用于获取原型引用 */
const ASYNC_FUNCTION_PROTOTYPE = Object.getPrototypeOf(async () => {})

/**
 * 递归排序对象键，保证属性声明顺序不同的等价参数生成相同的缓存键
 *
 * JSON.stringify 对属性顺序敏感：`{a:1,b:2}` 与 `{b:2,a:1}` 语义等价却生成
 * 不同键，导致缓存命中率下降。此函数仅处理普通对象与数组，其余类型原样返回。
 *
 * Map/Set 特殊处理：Object.keys(Map/Set) 恒为空，若落入通用对象分支会被折叠成 `{}`，
 * 导致内容不同的所有 Map/Set 参数生成同一缓存键而串用缓存。按插入序展开为数组参与序列化
 * （插入序不同的等价 Map 会生成不同键，仅损失命中率，不会串用错误结果——保守正确性优先）。
 *
 * @private
 */
function sortKeysDeep(value: unknown): unknown {
  // Symbol 会被 JSON.stringify 序列化为 null，导致互异 Symbol 参数串用缓存：
  // 带 description 标记区分
  if (typeof value === 'symbol') {
    let id = symbolIds.get(value)
    if (id === undefined) {
      id = ++nextSymbolId
      symbolIds.set(value, id)
    }
    return `symbol:${String(value)}#${id}`
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep)
  }
  if (value instanceof Map) {
    const entries: Array<[unknown, unknown]> = []
    for (const [key, val] of value) {
      entries.push([sortKeysDeep(key), sortKeysDeep(val)])
    }
    return { __map: entries }
  }
  if (value instanceof Set) {
    return { __set: [...value].map(sortKeysDeep) }
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date) && !(value instanceof RegExp)) {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

/**
 * 默认缓存键生成：稳定序列化参数（排序对象键）
 *
 * @private
 */
function defaultKeyFn(...args: unknown[]): string {
  try {
    return JSON.stringify(sortKeysDeep(args))
  } catch {
    // 序列化失败（如循环引用参数）：返回唯一键，等效跳过缓存直接执行原方法，
    // 避免被装饰方法因键生成失败而整体不可用
    return `__uncacheable__${Date.now()}_${Math.random()}`
  }
}

/**
 * 创建缓存装饰器
 *
 * 缓存方法的执行结果，在TTL内重复调用时直接返回缓存结果
 *
 * @param {CacheDecoratorOptions} [options={}] - 缓存选项
 * @param {number} [options.ttl=5000] - 缓存生存时间（毫秒）
 * @param {(...args: unknown[]) => string} [options.keyFn] - 自定义缓存键函数
 * @returns {MethodDecorator} 方法装饰器
 *
 * @example
 * ```typescript
 * class UserComponent {
 *   @withCache({ ttl: 60000 }) // 缓存1分钟
 *   async getUser(id: string) {
 *     return await fetch(`/api/users/${id}`).then(r => r.json())
 *   }
 *
 *   @withCache({
 *     ttl: 5000,
 *     keyFn: (id, includeProfile) => `user:${id}:${includeProfile}`
 *   })
 *   async getUserWithProfile(id: string, includeProfile: boolean) {
 *     return await fetchUserWithProfile(id, includeProfile)
 *   }
 * }
 *
 * // 第一次调用：执行请求并缓存
 * const user1 = await userComponent.getUser('user-123')
 *
 * // 第二次调用：直接从缓存返回（60秒内）
 * const user2 = await userComponent.getUser('user-123')
 * ```
 */
export function withCache(options: CacheDecoratorOptions = {}): MethodDecorator {
  const { ttl = 5000, keyFn } = options

  // 按宿主对象隔离缓存，避免多实例共享缓存条目。
  // entry.pending：异步方法进行中的 Promise（in-flight 去重标记），
  // 并发的同参调用复用同一 Promise，避免重复执行（如重复发请求）
  const store = new WeakMap<object, Map<string, { value: unknown; expiry: number; pending?: Promise<unknown> }>>()

  const getCache = (host: unknown): Map<string, { value: unknown; expiry: number; pending?: Promise<unknown> }> => {
    if (typeof host !== 'object' || host === null) {
      // 宿主不是对象时返回一次性 Map（不跨调用串扰）
      return new Map()
    }
    let cache = store.get(host)
    if (!cache) {
      cache = new Map()
      store.set(host, cache)
    }
    return cache
  }

  return function (_target: unknown, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value
    // 静态判别原方法异步性（原型比较，压缩安全）；运行时观测兜底非 async 但返回 Promise 的方法
    const isAsyncMethod = typeof originalMethod === 'function' && Object.getPrototypeOf(originalMethod) === ASYNC_FUNCTION_PROTOTYPE
    let observesPromise = false

    const writeCache = (
      cache: Map<string, { value: unknown; expiry: number; pending?: Promise<unknown> }>,
      key: string,
      value: unknown,
      at: number,
    ): unknown => {
      // 写入前回收过期条目，避免长生命周期宿主上 Map 持续累积
      for (const [entryKey, entry] of cache) {
        if (entry.expiry <= at) {
          cache.delete(entryKey)
        }
      }
      // 容量保护：仍超限时淘汰最早写入的条目（Map 保持插入顺序）
      for (const entryKey of cache.keys()) {
        if (cache.size < MAX_CACHE_ENTRIES) {
          break
        }
        cache.delete(entryKey)
      }

      cache.set(key, { value, expiry: at + ttl })
      return value
    }

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      const cache = getCache(this)
      // 缓存键携带方法名前缀：同一装饰器实例（工厂返回值复用）装饰多个方法时，
      // 仅按参数生成的键会让方法 B 命中方法 A 的缓存，静默返回错误数据
      const methodKey = `${String(propertyKey)}::`
      const key = `${methodKey}${keyFn ? keyFn(...args) : defaultKeyFn(...args)}`
      const now = Date.now()

      // 检查缓存
      const cached = cache.get(key)
      if (cached && cached.expiry > now) {
        // in-flight 命中：直接复用进行中的 Promise（失败时条目已被删除，后续调用重新执行）
        if (cached.pending) {
          if (!isProduction()) {
            console.log(`[Cache] In-flight dedup for ${String(propertyKey)}`)
          }
          return cached.pending
        }
        if (!isProduction()) {
          console.log(`[Cache] Hit for ${String(propertyKey)}`)
        }
        // 异步方法（或已观测到返回 Promise 的方法）命中时恢复 Promise 语义：
        // 保证两次调用返回类型一致，避免调用方 .then()/Promise.all 在第二次调用时崩溃
        return isAsyncMethod || observesPromise ? Promise.resolve(cached.value) : cached.value
      }

      // 执行方法：同步方法同步返回，异步方法保持 Promise 语义
      const result = originalMethod.apply(this, args)
      if (result instanceof Promise) {
        observesPromise = true
        const pending = result.then(
          (value) => {
            writeCache(cache, key, value, Date.now())
            return value
          },
          (error) => {
            // 失败不缓存：仅当条目仍是本次调用写入的 pending 时删除，
            // 避免误删期间已被重试调用覆盖的新条目
            const entry = cache.get(key)
            if (entry && entry.pending === pending) {
              cache.delete(key)
            }
            throw error
          },
        )
        // 先占位再返回：占位条目不过期（等待中的请求没有 TTL 语义），
        // 并发同参调用经 pending 分支复用同一 Promise
        cache.set(key, { value: undefined, expiry: Number.MAX_SAFE_INTEGER, pending })
        return pending
      }
      return writeCache(cache, key, result, now)
    }

    return descriptor
  }
}
