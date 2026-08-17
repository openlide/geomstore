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

import type { State } from '../../types/store'
import type { InternalStateProtectionConfig, ProxyCache } from './types'
import { isProduction, createMutationErrorMessage } from './utils'

/** 需要拦截的数组变异方法（模块级常量，避免在 Proxy get 陷阱中重复分配） */
const ARRAY_MUTATING_METHODS = ['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']

/**
 * 内建对象判定：这些对象经 Proxy 包装后内部槽位语义被破坏——
 * Map/Set 的写操作（set/add/delete）走内部槽位、不触发 set 陷阱，写保护失效；
 * 且 Proxy 无法被 structuredClone 等序列化机制克隆。故不代理，直接返回原始引用。
 */
function isBuiltinObject(value: object): boolean {
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
   * 使 Proxy 缓存失效
   *
   * 注意：自 v1.0.0 起写入/删除不再清除缓存（引用稳定），Proxy 始终包装同一 target；
   * 同一对象被重新挂到状态树其他位置时，缓存 Proxy 闭包中的 path 可能保持旧值，
   * 仅影响直接变异报错消息中的路径展示，读写语义不受影响。
   */
  invalidateCache(obj?: object): void {
    if (obj) {
      this._proxyCache.delete(obj)
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

        // 非对象或 null 直接返回，无需拼接路径
        if (typeof value !== 'object' || value === null) {
          return value
        }

        // 内建对象不代理（见 isBuiltinObject 注释）
        if (isBuiltinObject(value)) {
          return value
        }

        // 仅在需要递归保护时才拼接路径，避免原语访问的字符串分配开销
        const currentPath = path ? `${path}.${String(key)}` : String(key)

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

      /** 写入拦截：阻止外部修改 */
      set(obj: T, key: string | symbol, value: unknown): boolean {
        const fullPath = path ? `${path}.${String(key)}` : String(key)

        if (!self._isInternalAccess()) {
          const allowed = self._handleIllegalMutation(fullPath, value)
          if (!allowed) {
            return false
          }
          // 允许操作继续（生产环境 warn/silent 模式）
          (obj as Record<string | symbol, unknown>)[key] = value
          return true
        }

        (obj as Record<string | symbol, unknown>)[key] = value
        return true
      },

      /** 删除拦截：阻止外部删除 */
      deleteProperty(obj: T, key: string | symbol): boolean {
        const fullPath = path ? `${path}.${String(key)}` : String(key)

        if (!self._isInternalAccess()) {
          const allowed = self._handleIllegalMutation(fullPath, undefined, 'delete')
          if (!allowed) {
            return false
          }
          // 允许操作继续（生产环境 warn/silent 模式）
          delete (obj as Record<string | symbol, unknown>)[key]
          return true
        }

        delete (obj as Record<string | symbol, unknown>)[key]
        return true
      },

      /** 属性描述符拦截 */
      defineProperty(obj: T, key: string | symbol, descriptor: PropertyDescriptor): boolean {
        const fullPath = path ? `${path}.${String(key)}` : String(key)

        if (!self._isInternalAccess()) {
          const allowed = self._handleIllegalMutation(fullPath, descriptor.value, 'defineProperty')
          if (!allowed) {
            return false
          }
          // 允许操作继续（生产环境 warn/silent 模式）
          Object.defineProperty(obj, key, descriptor)
          return true
        }

        Object.defineProperty(obj, key, descriptor)
        return true
      },
    })

    return proxy
  }

  /**
   * 创建浅层 Proxy（仅保护顶层）
   */
  private _createShallowProxy<T extends object>(target: T, path: string): T {
    const self = this

    return new Proxy(target, {
      get(obj: T, key: string | symbol): unknown {
        return (obj as Record<string | symbol, unknown>)[key]
      },

      set(obj: T, key: string | symbol, value: unknown): boolean {
        const fullPath = path ? `${path}.${String(key)}` : String(key)

        if (!self._isInternalAccess()) {
          const allowed = self._handleIllegalMutation(fullPath, value)
          if (!allowed) {
            return false
          }
          // 允许操作继续（生产环境 warn/silent 模式）
          (obj as Record<string | symbol, unknown>)[key] = value
          return true
        }

        (obj as Record<string | symbol, unknown>)[key] = value
        return true
      },

      deleteProperty(obj: T, key: string | symbol): boolean {
        const fullPath = path ? `${path}.${String(key)}` : String(key)

        if (!self._isInternalAccess()) {
          const allowed = self._handleIllegalMutation(fullPath, undefined, 'delete')
          if (!allowed) {
            return false
          }
          // 允许操作继续（生产环境 warn/silent 模式）
          delete (obj as Record<string | symbol, unknown>)[key]
          return true
        }

        delete (obj as Record<string | symbol, unknown>)[key]
        return true
      },
    })
  }

  /**
   * 创建数组 Proxy
   */
  private _createArrayProxy<T extends unknown[]>(target: T, path: string): T {
    const self = this
    const proxyCache = this._proxyCache

    return new Proxy(target, {
      get(arr: T, key: string | symbol): unknown {
        // Symbol 类型直接返回原始值
        if (typeof key === 'symbol') {
          return (arr as Record<string | symbol, unknown>)[key]
        }

        // 处理数字索引：严格规范十进制整数字符串判断（不允许前导零）。
        // Number(key) 会把 ''/空白串解析为 0、'1e2' 解析为 100、'0x10' 解析为 16，
        // '/^\d+$/' 会误匹配 '01'，均会导致非规范数字字符串键被误当作索引返回错误元素
        if (typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)) {
          const numKey = Number(key)
          const value = arr[numKey]
          if (typeof value === 'object' && value !== null) {
            // 内建对象不代理（见 isBuiltinObject 注释）
            if (isBuiltinObject(value)) {
              return value
            }
            const cached = proxyCache.get(value)
            if (cached) return cached

            const nestedProxy = self._createDeepProxy(value, `${path}[${numKey}]`)
            proxyCache.set(value, nestedProxy)
            return nestedProxy
          }
          return value
        }

        // 数组方法特殊处理
        if (key === 'length') {
          return arr.length
        }

        // 数组方法代理
        if (typeof key === 'string' && ARRAY_MUTATING_METHODS.includes(key)) {
          return function (...args: unknown[]) {
            if (!self._isInternalAccess()) {
              const allowed = self._handleIllegalMutation(path, args, key)
              if (!allowed) {
                return undefined
              }
              // 允许操作继续（生产环境 warn/silent 模式）
              const result = (arr as unknown as Record<string, (...args: unknown[]) => unknown>)[key](...args)
              return result
            }
            const result = (arr as unknown as Record<string, (...args: unknown[]) => unknown>)[key](...args)
            return result
          }
        }

        // 其他属性直接返回
        return (arr as unknown as Record<string | symbol, unknown>)[key]
      },

      set(arr: T, key: string | symbol, value: unknown): boolean {
        const fullPath = `${path}[${String(key)}]`

        if (!self._isInternalAccess()) {
          const allowed = self._handleIllegalMutation(fullPath, value)
          if (!allowed) {
            return false
          }
          // 允许操作继续（生产环境 warn/silent 模式）
          (arr as unknown as Record<string | symbol, unknown>)[key] = value
          return true
        }

        (arr as unknown as Record<string | symbol, unknown>)[key] = value
        return true
      },

      deleteProperty(arr: T, key: string | symbol): boolean {
        const fullPath = `${path}[${String(key)}]`

        if (!self._isInternalAccess()) {
          const allowed = self._handleIllegalMutation(fullPath, undefined, 'delete')
          if (!allowed) {
            return false
          }
          // 允许操作继续（生产环境 warn/silent 模式）
          delete (arr as unknown as Record<string | symbol, unknown>)[key]
          return true
        }

        delete (arr as unknown as Record<string | symbol, unknown>)[key]
        return true
      },
    })
  }

  /**
   * 处理非法状态修改
   * @returns {boolean} 是否应该允许操作继续（true: 允许, false: 拒绝）
   */
  private _handleIllegalMutation(path: string, value: unknown, operation: string = 'set'): boolean {
    const message = createMutationErrorMessage(path, value, operation)

    if (isProduction()) {
      switch (this._protection.productionHandler) {
        case 'error':
          throw new Error(message)
        case 'warn':
          console.warn(message)
          return true // 允许操作继续，避免 TypeError
        case 'silent':
          return true // 静默忽略，允许操作继续
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
