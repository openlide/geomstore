/** Writable action proxies: report mutations and every affected top-level key. */
import { isBuiltinObject } from './StateProxy.js'
import { getStateVersion } from './stateVersion.js'

export interface DirtyTrackingCache {
  proxies: WeakMap<object, object>
  targets: WeakMap<object, object>
}

export function createDirtyTrackingCache(): DirtyTrackingCache {
  return { proxies: new WeakMap(), targets: new WeakMap() }
}

/**
 * Reuse one proxy per object. Ownership is indexed by top-level key, including
 * unread aliases and cycles. Scalar writes reuse the index; structural writes
 * and external Store version changes invalidate it. Accessors are not evaluated.
 */
export function createDirtyTrackingProxy(root: object, cache: DirtyTrackingCache, onMutate: (rootKeys: Iterable<string | symbol>) => void): object {
  const unwrap = (value: unknown): unknown => (value !== null && typeof value === 'object' ? (cache.targets.get(value) ?? value) : value)
  const isObject = (value: unknown): value is object => value !== null && typeof value === 'object'
  let owners: WeakMap<object, Set<string | symbol>> | undefined
  let indexedVersion = getStateVersion(root)

  const rebuildOwners = (): void => {
    owners = new WeakMap()
    for (const rootKey of Reflect.ownKeys(root)) {
      const descriptor = Object.getOwnPropertyDescriptor(root, rootKey)
      if (!descriptor || !('value' in descriptor)) continue
      const pending: unknown[] = [descriptor.value]
      const seen = new Set<object>()
      while (pending.length > 0) {
        const value = unwrap(pending.pop())
        if (!isObject(value) || seen.has(value)) continue
        seen.add(value)
        let keys = owners.get(value)
        if (!keys) {
          keys = new Set()
          owners.set(value, keys)
        }
        keys.add(rootKey)
        if (value instanceof Map) {
          for (const [key, child] of value) pending.push(key, child)
        } else if (value instanceof Set) {
          for (const child of value) pending.push(child)
        } else if (isBuiltinObject(value)) {
          continue
        }
        for (const key of Reflect.ownKeys(value)) {
          const child = Object.getOwnPropertyDescriptor(value, key)
          if (child && 'value' in child) pending.push(child.value)
        }
      }
    }
  }

  const report = (target: object, key?: string | symbol, structural = true): void => {
    if (structural || getStateVersion(root) !== indexedVersion) owners = undefined
    if (!owners) rebuildOwners()
    const keys = new Set(owners?.get(target))
    if (target === root && key !== undefined) keys.add(key)
    onMutate(keys)
    indexedVersion = getStateVersion(root)
  }

  const wrap = (value: unknown): unknown => {
    value = unwrap(value)
    if (!isObject(value)) return value
    const target = value
    const collection = target instanceof Map || target instanceof Set
    const prototype = Object.getPrototypeOf(target)
    // Opaque instances retain their raw receiver, including private-field brands.
    if (!collection && (isBuiltinObject(target) || (!Array.isArray(target) && prototype !== Object.prototype && prototype !== null))) return target
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
        const previous = Object.getOwnPropertyDescriptor(obj, key)
        const value = unwrap(next)
        const structural = !previous || !('value' in previous) || isObject(previous.value) || isObject(value) || (Array.isArray(obj) && key === 'length')
        const success = Reflect.set(obj, key, value)
        if (success) report(obj, key, structural)
        return success
      },
      deleteProperty(obj, key) {
        const previous = Object.getOwnPropertyDescriptor(obj, key)
        const success = Reflect.deleteProperty(obj, key)
        if (success) report(obj, key, !!previous && (!('value' in previous) || isObject(previous.value)))
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

  // Collection methods need raw receivers, but their returned values are wrapped.
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
