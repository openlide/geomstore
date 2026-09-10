/**
 * GeomStore - onlyOnChange 模式的脏跟踪代理
 *
 * 自 Store.ts 拆出：创建允许写入的脏跟踪代理（递归包装嵌套对象，
 * WeakMap 缓存保证引用稳定）；set / deleteProperty / defineProperty 三个写入陷阱
 * 统一经 onMutate 通知宿主递增变更计数。
 *
 * @module store/dirtyTracking
 */

import { isBuiltinObject } from './StateProxy.js'

/**
 * 创建允许写入的脏跟踪代理
 *
 * @param target - 被包装的对象
 * @param cache - 引用稳定性缓存（同一对象复用同一 Proxy；$replaceState 时由宿主重建）
 * @param onMutate - 任一写入发生时回调，宿主据此递增变更计数
 */
export function createDirtyTrackingProxy(target: object, cache: WeakMap<object, object>, onMutate: () => void): object {
  const cached = cache.get(target)
  if (cached) {
    return cached
  }

  const proxy = new Proxy(target, {
    get(obj: object, key: string | symbol): unknown {
      const value = (obj as Record<string | symbol, unknown>)[key]
      if (typeof value !== 'object' || value === null) {
        return value
      }
      // 内建对象（Date/Map/Set 等）不包装：其方法以内部槽位为 receiver，
      // 经 Proxy 调用会抛 "this is not a Date/Map object"（与 StateProxy 同契约：
      // 内建对象内部的变异不计入 mutationCount）
      if (isBuiltinObject(value)) {
        return value
      }
      return createDirtyTrackingProxy(value, cache, onMutate)
    },
    set(obj: object, key: string | symbol, value: unknown): boolean {
      (obj as Record<string | symbol, unknown>)[key] = value
      onMutate()
      return true
    },
    deleteProperty(obj: object, key: string | symbol): boolean {
      delete (obj as Record<string | symbol, unknown>)[key]
      onMutate()
      return true
    },
    defineProperty(obj: object, key: string | symbol, descriptor: PropertyDescriptor): boolean {
      // defineProperty 不经过 set 陷阱：缺此陷阱时 action 内经
      // Object.defineProperty 的写入不递增计数，onlyOnChange 模式漏通知
      Object.defineProperty(obj, key, descriptor)
      onMutate()
      return true
    },
  })

  cache.set(target, proxy)
  return proxy
}
