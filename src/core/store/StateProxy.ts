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

/**
 * 内建对象判定：这些对象经 Proxy 包装后内部槽位语义被破坏——
 * Map/Set 的写操作（set/add/delete）走内部槽位、不触发 set 陷阱，写保护失效；
 * 且 Proxy 无法被 structuredClone 等序列化机制克隆。故不代理，直接返回原始引用。
 */
export function isBuiltinObject(value: object): boolean {
  return (
    value instanceof Date || value instanceof RegExp || value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet
  )
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

  constructor(options: StateProxyOptions) {
    this._protection = options.protection
    this._proxyCache = options.proxyCache
    this._isInternalAccess = options.isInternalAccess
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

    const proxy = this._createDeepProxy(target, path)
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
   */
  private _makeWriteTraps<T extends object>(formatPath: (key: string | symbol) => string): Pick<ProxyHandler<T>, 'set' | 'deleteProperty' | 'defineProperty'> {
    const self = this
    return {
      set(obj: T, key: string | symbol, value: unknown): boolean {
        if (!self._isInternalAccess()) {
          // 拒绝路径总是抛错；生产 warn/silent 处理后放行写入
          self._handleIllegalMutation(formatPath(key), value)
        }
        // Reflect.set 而非 `obj[key] = value`：写陷阱必须如实报告底层是否写成功。
        // 目标被 Object.freeze（deepFreezeState 的快照副本）或属性不可写时，
        // 模块级严格码里的裸赋值会直接抛 TypeError（与 warn/silent「放行不抛」的承诺相反），
        // 而非严格模式下静默失败却返回 true 又违反 Proxy [[Set]] 不变量
        return Reflect.set(obj, key, value)
      },
      deleteProperty(obj: T, key: string | symbol): boolean {
        if (!self._isInternalAccess()) {
          // 拒绝路径总是抛错；生产 warn/silent 处理后放行删除
          self._handleIllegalMutation(formatPath(key), undefined, 'delete')
        }
        // 不可配置属性上 `delete` 会失败，恒返回 true 违反 Proxy 不变量（引擎抛 TypeError）
        return Reflect.deleteProperty(obj, key)
      },
      defineProperty(obj: T, key: string | symbol, descriptor: PropertyDescriptor): boolean {
        if (!self._isInternalAccess()) {
          // 拒绝路径总是抛错；生产 warn/silent 处理后放行定义
          self._handleIllegalMutation(formatPath(key), descriptor.value, 'defineProperty')
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
      /** 读取拦截：递归创建嵌套 Proxy */
      get(obj: T, key: string | symbol): unknown {
        const value = (obj as Record<string | symbol, unknown>)[key]

        // 非对象或 null：函数可能是非普通实例的方法，需绑定原始接收者后返回
        if (typeof value !== 'object' || value === null) {
          return self._bindMethod(obj, value)
        }

        // 内建对象不代理（见 isBuiltinObject 注释）
        if (isBuiltinObject(value)) {
          return value
        }

        // 仅在需要递归保护时才拼接路径，避免原语访问的字符串分配开销
        const currentPath = self._joinPath(path, key)

        // 数组特殊处理（带缓存，避免每次访问创建新 Proxy）
        if (Array.isArray(value)) {
          const cachedArrayProxy = self._proxyCache.get(value)
          if (cachedArrayProxy) {
            return cachedArrayProxy
          }
          const arrayProxy = self._createArrayProxy(value, currentPath)
          self._proxyCache.set(value, arrayProxy)
          return arrayProxy
        }

        // 检查 Proxy 缓存
        const cachedProxy = self._proxyCache.get(value)
        if (cachedProxy) {
          return cachedProxy
        }

        // 递归创建嵌套 Proxy
        const nestedProxy = self._createDeepProxy(value, currentPath)
        self._proxyCache.set(value, nestedProxy)
        return nestedProxy
      },

      // 写入/删除/描述符拦截：与浅/数组代理共用同一组陷阱，仅路径拼接格式不同（点号路径）
      ...self._makeWriteTraps<T>((key) => self._joinPath(path, key)),
    })

    return proxy
  }

  /**
   * 拼接保护代理的路径（根路径为空串，不产生前导点）
   *
   * 深代理的 get 与写入陷阱总以非空 path 调用；浅代理只用于状态根、以空串调用。
   * 抽为共用方法既消除三处重复的字面量，也让两侧分支都被真实调用覆盖。
   *
   * 已知限制：Proxy 缓存按「对象身份」而非「对象+路径」建，嵌套 path 在创建时
   * 就固化进陷阱闭包。同一对象被多条路径引用（`state.a.child === state.b.child`）时，
   * 报错里的路径是按先访问到的那条拼的，可能与实际写入路径不同——仅影响告警文案。
   * 不按路径二级缓存是有意取舍：别名读取会每次 miss 重建代理，
   * 既让 `state.a.child === state.b.child` 的引用相等失效（选择器按引用做记忆化会失真），
   * 又把每次读取变成一次分配。
   */
  private _joinPath(path: string, key: string | symbol): string {
    return path === '' ? String(key) : `${path}.${String(key)}`
  }

  /**
   * 非普通实例（类实例、类型化数组等）的方法绑定到原始接收者。
   *
   * 保护代理作为 this 会让私有字段的品牌检查与类型化数组的内部槽位失效
   * （"Cannot read private member …" / "this is not a typed array"）。
   * 数组与普通对象的方法对代理接收者没有这类要求，保持原样返回，
   * 避免每次属性访问都产生一次绑定分配。
   *
   * 有意的保护豁免：绑定到裸对象后，方法内部的写入（`this.count++`）不经过
   * set/deleteProperty/defineProperty 陷阱，既不被拦截也不被计数。改绑代理接收者
   * 会把上述品牌检查场景直接抛错，代价更高；此类状态请通过 setState/$patch 修改。
   */
  private _bindMethod(owner: object | null, value: unknown): unknown {
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
    return (value as (...args: unknown[]) => unknown).bind(owner)
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
      ...self._makeWriteTraps<T>((key) => self._joinPath(path, key)),
    })
  }

  /**
   * 数组代理子值包装：对象值经缓存包装为保护代理，内建对象与原始值原样返回。
   * 索引键、symbol 键与自定义属性共用同一入口，避免任一路径裸返回对象绕过写保护
   */
  private _wrapArrayChild(value: unknown, path: string, keySuffix: string): unknown {
    if (value === null || typeof value !== 'object') {
      return value
    }
    // 内建对象不代理（见 isBuiltinObject 注释）
    if (isBuiltinObject(value as object)) {
      return value
    }
    const cached = this._proxyCache.get(value as object)
    if (cached) {
      return cached
    }
    const nestedProxy = this._createDeepProxy(value as object, `${path}${keySuffix}`)
    this._proxyCache.set(value as object, nestedProxy)
    return nestedProxy
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
          return self._wrapArrayChild((arr as Record<string | symbol, unknown>)[key], path, `[${String(key)}]`)
        }

        // 处理数字索引：严格规范十进制整数字符串判断（不允许前导零）。
        // Number(key) 会把 ''/空白串解析为 0、'1e2' 解析为 100、'0x10' 解析为 16，
        // '/^\d+$/' 会误匹配 '01'，均会导致非规范数字字符串键被误当作索引返回错误元素
        if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) {
          const numKey = Number(key)
          return self._wrapArrayChild(arr[numKey], path, `[${numKey}]`)
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
        // 裸返回会让挂在数组自定义属性上的对象绕过写保护
        return self._wrapArrayChild((arr as unknown as Record<string | symbol, unknown>)[key], path, `.${String(key)}`)
      },

      // 写入/删除/描述符拦截：与深/浅代理共用同一组陷阱（数组路径格式 path[key]）
      ...self._makeWriteTraps<T>((key) => `${path}[${String(key)}]`),
    })
  }

  /**
   * 处理非法状态修改
   *
   * 拒绝路径总是抛出错误（开发模式与生产 'error' 处理器）。
   * 生产 warn/silent 处理器不抛错，返回后由调用方放行操作，
   * 因此返回值为 void（此前返回 boolean 的 false 分支为不可达死代码，已移除）。
   */
  private _handleIllegalMutation(path: string, value: unknown, operation: string = 'set'): void {
    const message = createMutationErrorMessage(path, value, operation)

    if (isProduction()) {
      switch (this._protection.productionHandler) {
        case 'error':
          throw new Error(message)
        case 'warn':
          console.warn(message)
          return // 允许操作继续，避免 TypeError
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
