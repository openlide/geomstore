/** Writable action proxies: report mutations and every affected top-level key. */
import { isBuiltinObject } from './StateProxy.js'

export interface DirtyTrackingCache {
  proxies: WeakMap<object, object>
  targets: WeakMap<object, object>
}

export function createDirtyTrackingCache(): DirtyTrackingCache {
  return { proxies: new WeakMap(), targets: new WeakMap() }
}

/**
 * One proxy per object, not per access path: aliases retain reference identity.
 * Resolve ownership from the current root on nested writes, rather than caching
 * the first path read. This includes unread aliases and handles cycles, reparenting
 * and detached references (also after setState/$patch) without stale parent links.
 * Writes visit the reachable graph per top-level key to resolve current owners.
 * Accessors are not evaluated during ownership lookup, avoiding unrelated effects.
 */
export function createDirtyTrackingProxy(root: object, cache: DirtyTrackingCache, onMutate: (rootKeys: Iterable<string | symbol>) => void): object {
  const unwrap = (value: unknown): unknown => (value !== null && typeof value === 'object' ? (cache.targets.get(value) ?? value) : value)

  const contains = (value: unknown, target: object, seen: Set<object>): boolean => {
    value = unwrap(value)
    if (value === target) return true
    if (value === null || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    if (value instanceof Map) {
      for (const [key, child] of value) {
        if (contains(key, target, seen) || contains(child, target, seen)) return true
      }
    } else if (value instanceof Set) {
      for (const child of value) {
        if (contains(child, target, seen)) return true
      }
    } else if (isBuiltinObject(value)) {
      return false
    }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor && 'value' in descriptor && contains(descriptor.value, target, seen)) return true
    }
    return false
  }

  const report = (target: object, key?: string | symbol): void => {
    const keys = new Set<string | symbol>()
    if (target === root && key !== undefined) {
      keys.add(key)
    }
    // Even a root mutation can affect a top-level alias that points back to root.
    for (const rootKey of Reflect.ownKeys(root)) {
      const descriptor = Object.getOwnPropertyDescriptor(root, rootKey)
      if (descriptor && 'value' in descriptor && contains(descriptor.value, target, new Set())) keys.add(rootKey)
    }
    onMutate(keys)
  }

  const wrap = (value: unknown): unknown => {
    value = unwrap(value)
    if (value === null || typeof value !== 'object') return value
    const target = value
    const collection = target instanceof Map || target instanceof Set
    // These builtins still retain their existing raw-reference contract.
    if (!collection && isBuiltinObject(target)) return target
    const cached = cache.proxies.get(target)
    if (cached) return cached

    const methods = new Map<string | symbol, unknown>()
    const proxy = new Proxy(target, {
      get(obj, key) {
        const descriptor = Object.getOwnPropertyDescriptor(obj, key)
        // Proxy invariants require the exact value for locked data properties.
        if (descriptor && !descriptor.configurable && 'value' in descriptor && !descriptor.writable) return descriptor.value
        if (collection) {
          if (methods.has(key)) return methods.get(key)
          const method = collectionMethod(obj as Map<unknown, unknown> | Set<unknown>, key, proxy)
          if (method !== undefined) {
            methods.set(key, method)
            return method
          }
        }
        return wrap(Reflect.get(obj, key, obj))
      },
      set(obj, key, next) {
        const success = Reflect.set(obj, key, unwrap(next))
        if (success) report(obj, key)
        return success
      },
      deleteProperty(obj, key) {
        const success = Reflect.deleteProperty(obj, key)
        if (success) report(obj, key)
        return success
      },
      defineProperty(obj, key, descriptor) {
        const normalized = 'value' in descriptor ? { ...descriptor, value: unwrap(descriptor.value) } : descriptor
        const success = Reflect.defineProperty(obj, key, normalized)
        if (success) report(obj, key)
        return success
      },
    })
    cache.proxies.set(target, proxy)
    cache.targets.set(proxy, target)
    return proxy
  }

  // Collection methods need raw receivers for internal slots, but all values
  // returned to an action must be wrapped, including iterators and forEach.
  const collectionMethod = (obj: Map<unknown, unknown> | Set<unknown>, key: string | symbol, proxy: object): unknown => {
    if (key === 'set' && obj instanceof Map) {
      return (entryKey: unknown, value: unknown) => {
        obj.set(unwrap(entryKey), unwrap(value))
        report(obj)
        return proxy
      }
    }
    if (key === 'add' && obj instanceof Set) {
      return (value: unknown) => {
        obj.add(unwrap(value))
        report(obj)
        return proxy
      }
    }
    if (key === 'delete') {
      return (value: unknown) => {
        const deleted = obj.delete(unwrap(value))
        if (deleted) report(obj)
        return deleted
      }
    }
    if (key === 'clear') {
      return () => {
        const changed = obj.size > 0
        obj.clear()
        if (changed) report(obj)
      }
    }
    if (key === 'has') return (value: unknown) => obj.has(unwrap(value))
    if (key === 'get' && obj instanceof Map) return (value: unknown) => wrap(obj.get(unwrap(value)))
    if (key === 'forEach') {
      return (callback: (value: unknown, key: unknown, collection: object) => void, thisArg?: unknown) => {
        obj.forEach((value, entryKey) => callback.call(thisArg, wrap(value), wrap(entryKey), proxy))
      }
    }
    if (key === Symbol.iterator || key === 'entries' || key === 'keys' || key === 'values') {
      return function* () {
        const entries = key === 'entries' || (key === Symbol.iterator && obj instanceof Map)
        const iterator = key === 'keys' ? obj.keys() : entries ? obj.entries() : obj.values()
        for (const item of iterator) {
          yield entries ? (item as unknown[]).map(wrap) : wrap(item)
        }
      }
    }
    return undefined
  }

  return wrap(root) as object
}
