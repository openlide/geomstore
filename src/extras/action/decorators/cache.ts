/**
 * GeomStore - 缓存装饰器
 *
 * 缓存方法的执行结果，在TTL内重复调用时直接返回缓存结果
 *
 * 修复说明：原实现将 cache Map 声明在工厂函数作用域，导致同一装饰器装饰的
 * 所有方法/实例共享同一份缓存（闭包陷阱）。现改为按宿主对象（this）隔离缓存。
 *
 */

import { isProduction } from '../../../core/store/utils.js'
import { isAsyncFunction } from './common.js'

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

/** symbolIds 表上限：动态创建的 Symbol 参数（请求令牌等）不可 GC，强引用表会无限增长 */
const MAX_SYMBOL_IDS = 1000

/** Symbol 实例 → 唯一序号：同 description 的不同 Symbol 序列化后相同（symbol:Symbol(a)），
 *  不加区分会让依赖 Symbol 身份的方法串用缓存 */
// Map 而非 WeakMap：TS 的 WeakMap 键约束为 object（Symbol 键的 ES2023 扩展未反映到 lib）
const symbolIds = new Map<symbol, number>()
let nextSymbolId = 0

/** 按身份编号的对象 → 唯一序号：覆盖函数参数与「无可枚举键的不透明对象」
 *  （Promise/WeakMap/WeakSet/无状态类实例）。前者经 JSON.stringify 折叠为 null
 *  （与真实 null 参数撞键），后者恒为 `{}`（与普通空对象及彼此撞键）。
 *  WeakMap 可随参数回收，无需像 symbolIds 那样设上限 */
const identityIds = new WeakMap<object, number>()
let nextIdentityId = 0

/** 取得（或分配）某个按身份标记对象的唯一序号 */
function identityId(value: object): number {
  let id = identityIds.get(value)
  if (id === undefined) {
    id = ++nextIdentityId
    identityIds.set(value, id)
  }
  return id
}

/**
 * 递归排序对象键并给每个叶子打上类型标记
 *
 * 保证两条性质：属性声明顺序不同的等价参数生成相同键；互异参数生成互异键。
 *
 * 第二条此前不成立：JSON.stringify 跨类型不注入，直接用它会**串用缓存**
 * （返回错误结果，而非仅损失命中率）——
 * - undefined / 函数 / NaN / Infinity 序列化为 null，与真实 null 参数撞键
 * - 对象里值为 undefined 的属性被整键丢弃，`{a: undefined}` 与 `{}` 撞键
 * - RegExp 序列化为 `{}`，所有正则互相撞键且与普通空对象撞键
 * - Date 序列化为 ISO 字符串，与同文本的字符串参数撞键
 * - Promise/WeakMap 等无可枚举键的对象恒为 `{}`，互相撞键
 *
 * 故所有叶子统一映射为「类型前缀 + 文本」。字符串叶子经 JSON.stringify 转义，
 * 无法伪造其他类型的前缀（字符串 `"n:5"` 标记为 `s:"n:5"`，与数字 5 的 `n:5` 不同），
 * 因此标记后的结构再经 JSON.stringify 仍是注入的。
 *
 * Map/Set 保留 `__map`/`__set` 包装与插入序（插入序不同的等价 Map 生成不同键，
 * 仅损失命中率不会串用结果——保守正确性优先）；叶子已带类型标记，
 * 用户自带的 `__map`/`__set` 键也无法伪造这两种包装。
 *
 * @private
 */
function sortKeysDeep(value: unknown): unknown {
  if (value === undefined) return 'u:'
  if (value === null) return 'z:'

  const type = typeof value
  if (type === 'boolean') return `b:${String(value)}`
  if (type === 'number') {
    const num = value as number
    // NaN/Infinity 经 JSON.stringify 变 null；-0 与 0 经 String 同为 '0' 但 Object.is 下不等
    if (!Number.isFinite(num)) return `n:${String(num)}`
    return `n:${Object.is(num, -0) ? '-0' : String(num)}`
  }
  // BigInt 会让 JSON.stringify 直接抛 TypeError（此前落入 defaultKeyFn 的 catch
  // 退化为「每次都 miss」），标记后可正常缓存
  if (type === 'bigint') return `i:${String(value)}`
  if (type === 'string') return `s:${JSON.stringify(value)}`
  if (type === 'function') return `f:${identityId(value as object)}`
  if (type === 'symbol') {
    const sym = value as symbol
    let id = symbolIds.get(sym)
    if (id === undefined) {
      // 整表清空而非逐条淘汰：nextSymbolId 保持单调递增，被清空 Symbol 的
      // 旧缓存键（含旧 id）只会自然失配为 miss（损失命中率），不会与新 id 撞键串用
      if (symbolIds.size >= MAX_SYMBOL_IDS) {
        symbolIds.clear()
      }
      id = ++nextSymbolId
      symbolIds.set(sym, id)
    }
    return `symbol:${String(sym)}#${id}`
  }

  if (value instanceof Date) return `d:${String(value.getTime())}`
  if (value instanceof RegExp) return `r:${JSON.stringify([value.source, value.flags])}`

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

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  // 无可枚举键的非纯对象按身份标记：Object.keys 恒为空，按值序列化会让
  // 互异的 Promise/WeakMap/无状态类实例全部折叠为 {} 而串用缓存
  const proto = Object.getPrototypeOf(value)
  if (keys.length === 0 && proto !== Object.prototype && proto !== null) {
    return `o:${identityId(value as object)}`
  }

  // 纯对象与带可枚举状态的类实例：按键排序后递归，保持值语义
  // Object.create(null) 承载：参数可合法含自有 __proto__ 键，普通对象上赋值会触发
  // 原型 setter（键被静默丢弃且容器原型被换）；null 原型对象无该 setter
  const sorted: Record<string, unknown> = Object.create(null) as Record<string, unknown>
  for (const key of keys.sort()) {
    sorted[key] = sortKeysDeep(record[key])
  }
  return sorted
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

  // 按宿主对象隔离缓存，避免多实例共享缓存条目。宿主包含函数（类/静态方法场景）。
  // entry.pending：异步方法进行中的 Promise（in-flight 去重标记），
  // 并发的同参调用复用同一 Promise，避免重复执行（如重复发请求）
  const store = new WeakMap<object, Map<string, { value: unknown; expiry: number; pending?: Promise<unknown> }>>()
  let nextMethodId = 0

  const getCache = (host: unknown): Map<string, { value: unknown; expiry: number; pending?: Promise<unknown> }> => {
    if ((typeof host !== 'object' && typeof host !== 'function') || host === null) {
      // 宿主不是对象或函数时返回一次性 Map（不跨调用串扰）
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
    // 每次装饰独立编号，避免复用工厂时不同方法（含同描述 Symbol）共享参数缓存。
    const methodKey = `${++nextMethodId}::`
    // 静态判别原方法异步性（原型比较，压缩安全）；运行时观测兜底非 async 但返回 Promise 的方法
    const isAsyncMethod = isAsyncFunction(originalMethod)
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
      const key = `${methodKey}${keyFn ? keyFn(...args) : defaultKeyFn(...args)}`
      const now = Date.now()

      // 检查缓存
      const cached = cache.get(key)
      if (cached && cached.expiry > now) {
        // in-flight 命中：直接复用进行中的 Promise（失败时条目已被删除，后续调用重新执行）
        if (cached.pending) {
          if (!isProduction()) {
            console.debug(`[Cache] In-flight dedup for ${String(propertyKey)}`)
          }
          return cached.pending
        }
        if (!isProduction()) {
          console.debug(`[Cache] Hit for ${String(propertyKey)}`)
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
            // 可选链替代 `entry && entry.pending === pending`：语义等价（entry 缺失时
            // 比较结果为 false，同样不删除）
            /* istanbul ignore else -- 并发同参调用复用同一 pending、无逐出路径，
               条目不可能在结算前被替换或删除，故该 false 侧不可达 */
            if (cache.get(key)?.pending === pending) {
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
