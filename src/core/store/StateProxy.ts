/**
 * StateProxy - 状态保护代理模块
 *
 * 职责：
 * - 创建状态 Proxy 保护层
 * - 拦截非法状态修改
 * - 支持深层/浅层保护模式
 * - 数组特殊处理
 *
 * @module StateProxy
 */

import type { State } from '../../types/store.js'
import type { InternalStateProtectionConfig, ProxyCache } from './types.js'
import { isProduction, createMutationErrorMessage } from './utils.js'

/** 需要拦截的数组变异方法（模块级 Set：get 陷阱 O(1) 命中，避免 includes 线性扫描） */
const ARRAY_MUTATING_METHODS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])

/** `Object.prototype.toString` 的标签部分：`[object Map]` → `'Map'` */
function builtinTagOf(value: object): string {
  return Object.prototype.toString.call(value).slice(8, -1)
}

/** 与 `isBuiltinObject` 同一套标签；跨 realm 副本的内建对象在这里补上 */
const BUILTIN_TAGS = new Set(['Date', 'RegExp', 'Map', 'Set', 'WeakMap', 'WeakSet'])

/**
 * 内建对象判定：这些对象经 Proxy 包装后内部槽位语义被破坏——
 * Map/Set 的写操作（set/add/delete）走内部槽位、不触发 set 陷阱，写保护失效；
 * 且 Proxy 无法被 structuredClone 等序列化机制克隆。故不代理，直接返回原始引用。
 *
 * `instanceof` 是 realm 绑定的：iframe / node:vm / 被打包进两个分包的本库副本造出的
 * Map/Date/RegExp 都会判假，判假的直接后果是这些对象被当成普通对象代理——
 * `proxy.set(k, v)` 会以「Method Map.prototype.set called on incompatible receiver」抛错。
 * `Object.prototype.toString` 的标签读的是内部槽位 / `Symbol.toStringTag`，跨 realm 一致，
 * 故两判据取并集：保留 `instanceof` 是为了子类覆写 `[Symbol.toStringTag]` 的合法实现
 * 仍被判为内建（只看标签会把这类 Map 子类改成代理，反而制造上面那条 receiver 抛错）。
 */
export function isBuiltinObject(value: object): boolean {
  return (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    BUILTIN_TAGS.has(builtinTagOf(value))
  )
}

/**
 * Map/Set 的跨 realm 判定（`'Map' | 'Set' | undefined`，模块内唯一的口径来源）
 *
 * 脏追踪的索引遍历与 Store 侧的别名可达性扫描都要按「键+值 / 成员」这些**内部槽位**
 * 取边，而 `instanceof` 只对同 realm 成立：判假时会退化成「按自有属性遍历」，
 * Map/Set 的自有属性恒为空 ⇒ 挂在集合里的子树整棵不在索引内，别名键就此漏标脏（漏报）。
 * 与 `isBuiltinObject` 同样的两判据并集。
 */
function collectionKindOf(value: object): 'Map' | 'Set' | undefined {
  if (value instanceof Map) {
    return 'Map'
  }
  if (value instanceof Set) {
    return 'Set'
  }
  const tag = builtinTagOf(value)
  return tag === 'Map' || tag === 'Set' ? tag : undefined
}

/** 跨 realm 成立的 Map 判定（供类型收窄用，见 collectionKindOf） */
export function isMapLike(value: object): value is Map<unknown, unknown> {
  return collectionKindOf(value) === 'Map'
}

/** 跨 realm 成立的 Set 判定（供类型收窄用，见 collectionKindOf） */
export function isSetLike(value: object): value is Set<unknown> {
  return collectionKindOf(value) === 'Set'
}

/**
 * StateProxy 配置选项
 */
export interface StateProxyOptions {
  /** 状态保护配置 */
  protection: InternalStateProtectionConfig
  /** Proxy 缓存 */
  proxyCache: ProxyCache
  /** 内部访问检查函数 */
  isInternalAccess: () => boolean
}

/**
 * StateProxy 管理器
 *
 * 负责创建和管理状态 Proxy，提供状态保护机制
 */
export class StateProxyManager<S extends State = State> {
  private readonly _protection: InternalStateProtectionConfig
  private readonly _proxyCache: ProxyCache
  private readonly _isInternalAccess: () => boolean
  /**
   * 已绑定到原始接收者的方法，按 (owner, key) 复用，见 _bindMethod。
   * 连同被绑的那个函数一起存：方法可被替换，缓存必须认得出来（见 _bindMethod 注释）。
   */
  private readonly _boundMethods = new WeakMap<object, Map<string | symbol, { raw: unknown; bound: unknown }>>()

  constructor(options: StateProxyOptions) {
    this._protection = options.protection
    this._proxyCache = options.proxyCache
    this._isInternalAccess = options.isInternalAccess
    // 处理器取值就地校验：`InternalStateProtectionConfig` 在类型层已限定三值，
    // 但配置可来自未类型化的 JS 调用方。落到默认分支会被静默升级为最严格模式
    // （生产里抛错），而误用的真实位置在这里，不在很远的一次状态写入上
    const handler = options.protection.productionHandler
    if (handler !== 'error' && handler !== 'warn' && handler !== 'silent') {
      throw new TypeError(`[GeomStore] StateProxyManager: productionHandler must be 'error' | 'warn' | 'silent', got ${String(handler)}`)
    }
  }

  /**
   * 创建状态 Proxy（顶层入口）
   */
  createStateProxy(target: S, path: string): S {
    if (typeof target !== 'object' || target === null) {
      return target
    }

    // 内建对象不代理（见 isBuiltinObject 注释）
    if (isBuiltinObject(target)) {
      return target
    }

    // 检查缓存
    const cached = this._proxyCache.get(target)
    if (cached) {
      return cached as S
    }

    // 根数组也走数组代理，与 _wrapChild 的「数组只有一种代理」同口径：
    // 交给 _createDeepProxy 会让同一棵树里出现两套数组行为——根数组的报错路径拼成
    // `push` / `0`，而它下面的嵌套数组是 `[push]` / `[0]`，且 ARRAY_MUTATING_METHODS
    // 的专用拦截分支被整体绕过。浅保护模式不改道：它的契约就是「只保护顶层」
    const proxy =
      Array.isArray(target) && this._protection.deep ? this._createArrayProxy(target as unknown as unknown[], path) : this._createDeepProxy(target, path)
    this._proxyCache.set(target, proxy)
    return proxy as S
  }

  /**
   * 生成一组写保护陷阱（set / deleteProperty / defineProperty）。
   *
   * deep / shallow / array 三种代理的写语义完全一致（内部访问放行；外部访问经
   * _handleIllegalMutation 校验后抛错或放行），仅「非法写路径」的拼接格式不同，
   * 故以 formatPath 参数化，三处复用同一组陷阱而非各写 9 份。
   *
   * 路径仅在「外部访问」分支内拼接：绝大多数写入是内部访问（setState / $patch /
   * $replaceState），避免每次写入都做无谓的字符串分配。
   *
   * 「warn / silent 放行」的准确边界（不要按「一定不抛」编码）：处理器本身只负责打印
   * 或沉默，之后陷阱如实返回底层结果。底层写不进时——目标被 `Object.freeze`
   * （如 deepFreezeState 的快照副本被再次代理）、属性不可写或不可配置——
   * 严格模式（ESM / class）下引擎仍会就那次赋值抛 TypeError，且这是 Proxy 不变量
   * （不可配置又不可写的属性上，陷阱连「谎报成功」都不被允许），保护层无法代为吞掉。
   * 也就是说 warn/silent 只保证**保护层自己**不抛，不保证调用方的写一定落成功；
   * 要把状态改成不可写快照，请显式判 `Object.isFrozen`，别依赖此处不抛。
   */
  private _makeWriteTraps<T extends object>(formatPath: (key: string | symbol) => string): Pick<ProxyHandler<T>, 'set' | 'deleteProperty' | 'defineProperty'> {
    const self = this
    return {
      set(obj: T, key: string | symbol, value: unknown): boolean {
        if (!self._isInternalAccess()) {
          // 拒绝路径总是抛错；生产 warn/silent 处理后交给底层去写（能否写进见类注释）
          self._handleIllegalMutation(formatPath(key), value)
        }
        // Reflect.set 而非 `obj[key] = value`：写陷阱必须如实报告底层是否写成功。
        // 目标被 Object.freeze（deepFreezeState 的快照副本）或属性不可写时，
        // 模块级严格码里的裸赋值会直接抛 TypeError（连告警之外再多一笔看不懂的错），
        // 而非严格模式下静默失败却返回 true 又违反 Proxy [[Set]] 不变量
        return Reflect.set(obj, key, value)
      },
      deleteProperty(obj: T, key: string | symbol): boolean {
        if (!self._isInternalAccess()) {
          // 拒绝路径总是抛错；生产 warn/silent 处理后交给底层去删（同上）
          self._handleIllegalMutation(formatPath(key), undefined, 'delete')
        }
        // 不可配置属性上 `delete` 会失败，恒返回 true 违反 Proxy 不变量（引擎抛 TypeError）
        return Reflect.deleteProperty(obj, key)
      },
      defineProperty(obj: T, key: string | symbol, descriptor: PropertyDescriptor): boolean {
        if (!self._isInternalAccess()) {
          // 拒绝路径总是抛错；生产 warn/silent 处理后交给底层去定义（同上）
          // 访问器描述符（get/set）没有 value 字段，直接取 descriptor.value 会让
          // 报错恒显示 undefined、丢掉真实写入内容，故按描述符种类给出可辨识的占位说明
          const attempted =
            'value' in descriptor
              ? descriptor.value
              : `[accessor descriptor: get=${typeof descriptor.get === 'function'}, set=${typeof descriptor.set === 'function'}]`
          self._handleIllegalMutation(formatPath(key), attempted, 'defineProperty')
        }
        return Reflect.defineProperty(obj, key, descriptor)
      },
    }
  }

  /**
   * 创建深层 Proxy（递归保护嵌套对象）
   */
  private _createDeepProxy<T extends object>(target: T, path: string): T {
    if (!this._protection.deep) {
      // 浅层保护：仅保护顶层属性
      return this._createShallowProxy(target, path)
    }

    const self = this

    const proxy = new Proxy(target, {
      /** 读取拦截：对象子值统一交 _wrapChild 分流，函数按需要绑定原始接收者 */
      get(obj: T, key: string | symbol): unknown {
        const value = (obj as Record<string | symbol, unknown>)[key]

        // 非对象或 null：函数可能是非普通实例的方法，需绑定原始接收者后返回
        if (typeof value !== 'object' || value === null) {
          return self._bindMethod(obj, key, value)
        }

        // 点号路径与 _makeWriteTraps 的 set 侧同口径（根路径空串不产生前导点）
        return self._wrapChild(value, path, key, false)
      },

      // 写入/删除/描述符拦截：与浅/数组代理共用同一组陷阱，仅路径拼接格式不同（点号路径）
      ...self._makeWriteTraps<T>((key) => self._joinChildPath(path, key, false)),
    })

    return proxy
  }

  /**
   * 拼接保护代理的子路径：`bracket` 决定数组口径（`path[key]`）还是对象口径
   * （`path.key`，根路径为空串时不产生前导点）。
   *
   * 写陷阱的路径格式化与子值包装共用此函数，两种拼接格式各只有一处定义。
   *
   * 已知限制：Proxy 缓存按「对象身份」而非「对象+路径」建，嵌套 path 在创建时
   * 就固化进陷阱闭包。同一对象被多条路径引用（`state.a.child === state.b.child`）时，
   * 报错里的路径是按先访问到的那条拼的，可能与实际写入路径不同——仅影响告警文案。
   * 不按路径二级缓存是有意取舍：别名读取会每次 miss 重建代理，
   * 既让 `state.a.child === state.b.child` 的引用相等失效（选择器按引用做记忆化会失真），
   * 又把每次读取变成一次分配。
   */
  private _joinChildPath(path: string, key: string | symbol, bracket: boolean): string {
    const name = String(key)
    if (bracket) {
      return `${path}[${name}]`
    }
    return path === '' ? name : `${path}.${name}`
  }

  /**
   * 子值包装的唯一入口：原始值与内建对象原样返回 → 缓存复用 → 数组 / 深代理分流。
   *
   * 深代理的每个键、数组代理的索引 / symbol 键 / 自定义属性都走这里，分流口径只有一份：
   * 任一处各写一遍（此前是深代理与数组包装两份）都会在改动时漏改一侧，
   * 让同一对象在不同访问路径下行为分叉。数组一律交 _createArrayProxy——
   * 「数组只有一种代理」既让报错口径唯一，也保证 ARRAY_MUTATING_METHODS 的专用拦截
   * 分支不会被索引路径绕过（否则 push/splice 会以「给属性 'push' 赋值」的文案抛出）。
   *
   * 路径拼接推迟到确实要建代理时再做：原始值、内建对象与缓存命中都不产生字符串分配。
   */
  private _wrapChild(value: unknown, path: string, key: string | symbol, bracket: boolean): unknown {
    if (value === null || typeof value !== 'object') {
      return value
    }
    // 内建对象不代理（见 isBuiltinObject 注释）
    if (isBuiltinObject(value)) {
      return value
    }
    const cached = this._proxyCache.get(value)
    if (cached) {
      return cached
    }
    const childPath = this._joinChildPath(path, key, bracket)
    const proxy = Array.isArray(value) ? this._createArrayProxy(value as unknown[], childPath) : this._createDeepProxy(value, childPath)
    this._proxyCache.set(value, proxy)
    return proxy
  }

  /**
   * 非普通实例（类实例、类型化数组等）的方法绑定到原始接收者。
   *
   * 保护代理作为 this 会让私有字段的品牌检查与类型化数组的内部槽位失效
   * （"Cannot read private member …" / "this is not a typed array"）。
   * 数组与普通对象的方法对代理接收者没有这类要求，保持原样返回。
   *
   * 绑定结果按 (owner, key) 缓存：不缓存则每次属性读取都 `bind` 一个新函数，
   * `state.method !== state.method` 会让按引用相等做记忆化/依赖比较的调用方
   * （选择器 memo、框架依赖数组）每次读取都判为「换了实现」，热路径上还多一笔分配。
   * 缓存挂在管理器上而非全局表：`$replaceState` / `destroy` 会重建管理器，
   * 旧状态树的方法引用随之整体释放，不会跨代驻留。
   * 条目额外记下被绑的那个函数：缓存命中只在它仍等于当前属性值时生效，
   * 否则（方法被整体替换）重新绑定，避免返回旧实现的绑定。
   *
   * 有意的保护豁免：绑定到裸对象后，方法内部的写入（`this.count++`）不经过
   * set/deleteProperty/defineProperty 陷阱，既不被拦截也不被计数。改绑代理接收者
   * 会把上述品牌检查场景直接抛错，代价更高；此类状态请通过 setState/$patch 修改。
   */
  private _bindMethod(owner: object | null, key: string | symbol, value: unknown): unknown {
    if (typeof value !== 'function' || owner === null) {
      return value
    }
    if (Array.isArray(owner)) {
      return value
    }
    const prototype = Object.getPrototypeOf(owner)
    if (prototype === Object.prototype || prototype === null) {
      return value
    }
    let byKey = this._boundMethods.get(owner)
    if (!byKey) {
      byKey = new Map()
      this._boundMethods.set(owner, byKey)
    }
    const cached = byKey.get(key)
    // 只在底层函数没换时复用：内部访问可以把方法整个换掉（`this.state.svc.bump = fn`），
    // 无条件复用旧条目会让代理返回已被替换掉的实现的绑定
    if (cached !== undefined && cached.raw === value) {
      return cached.bound
    }
    const bound = (value as (...args: unknown[]) => unknown).bind(owner)
    byKey.set(key, { raw: value, bound })
    return bound
  }

  /**
   * 创建浅层 Proxy（仅保护顶层属性）
   */
  private _createShallowProxy<T extends object>(target: T, path: string): T {
    const self = this

    return new Proxy(target, {
      get(obj: T, key: string | symbol): unknown {
        return (obj as Record<string | symbol, unknown>)[key]
      },
      // 写入/删除/描述符拦截：与深/数组代理共用同一组陷阱（点号路径）
      ...self._makeWriteTraps<T>((key) => self._joinChildPath(path, key, false)),
    })
  }

  /**
   * 创建数组 Proxy
   */
  private _createArrayProxy<T extends unknown[]>(target: T, path: string): T {
    const self = this

    return new Proxy(target, {
      get(arr: T, key: string | symbol): unknown {
        // Symbol 键：函数值原样返回（Symbol.iterator 等内部方法需要原始 this 语义）；
        // 对象值必须走与索引键一致的包装逻辑——裸返回会让挂在 symbol 键上的
        // 对象绕过全部写保护
        if (typeof key === 'symbol') {
          return self._wrapChild((arr as Record<string | symbol, unknown>)[key], path, key, true)
        }

        // 处理数字索引：严格规范十进制整数字符串判断（不允许前导零）。
        // Number(key) 会把 ''/空白串解析为 0、'1e2' 解析为 100、'0x10' 解析为 16，
        // '/^\d+$/' 会误匹配 '01'，均会导致非规范数字字符串键被误当作索引返回错误元素
        if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) {
          // 路径用键原样（上面的正则已保证是规范十进制串），取值才转数字
          return self._wrapChild(arr[Number(key)], path, key, true)
        }

        // 数组方法特殊处理
        if (key === 'length') {
          return arr.length
        }

        // 数组方法代理
        if (typeof key === 'string' && ARRAY_MUTATING_METHODS.has(key)) {
          return function (...args: unknown[]) {
            if (!self._isInternalAccess()) {
              // 拒绝路径总是抛错；生产 warn/silent 处理后放行执行
              self._handleIllegalMutation(path, args, key)
            }
            return (arr as unknown as Record<string, (...args: unknown[]) => unknown>)[key](...args)
          }
        }

        // 其他属性（非索引/length/变异方法）：对象值同样需要包装保护，
        // 裸返回会让挂在数组自定义属性上的对象绕过写保护。自定义属性按对象口径拼路径
        return self._wrapChild((arr as unknown as Record<string | symbol, unknown>)[key], path, key, false)
      },

      // 写入/删除/描述符拦截：与深/浅代理共用同一组陷阱（数组路径格式 path[key]）
      ...self._makeWriteTraps<T>((key) => self._joinChildPath(path, key, true)),
    })
  }

  /**
   * 处理非法状态修改
   *
   * 拒绝路径总是抛出错误（开发模式与生产 'error' 处理器）。
   * 生产 warn/silent 处理器不抛错、返回 void，由写陷阱把操作交给底层去做——
   * 「放行」指的是保护层不再拦你，不代表底层一定写得进去（见 _makeWriteTraps 的说明）。
   * productionHandler 的取值在构造期已校验，switch 覆盖全部三种取值，无兜底分支。
   */
  private _handleIllegalMutation(path: string, value: unknown, operation: string = 'set'): void {
    const message = createMutationErrorMessage(path, value, operation)

    if (isProduction()) {
      switch (this._protection.productionHandler) {
        case 'error':
          throw new Error(message)
        case 'warn':
          console.warn(message)
          return // 允许操作继续，避免保护层自己抛
        case 'silent':
          return // 静默忽略，允许操作继续
      }
    }
    // 开发模式总是抛出错误
    throw new Error(message)
  }
}

/**
 * 创建 Proxy 缓存实例
 *
 * 基于 WeakMap 实现，不支持 clear()。
 * 如需清空缓存，请重新调用 createProxyCache() 创建新实例。
 */
export function createProxyCache(): ProxyCache {
  const weakMap = new WeakMap<object, unknown>()
  return {
    get: (target: object) => weakMap.get(target),
    set: (target: object, proxy: unknown) => {
      weakMap.set(target, proxy)
    },
    delete: (target: object) => weakMap.delete(target),
  }
}
