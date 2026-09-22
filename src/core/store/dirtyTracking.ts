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

/** 「对象 → 可达它的顶层状态键」归属索引 */
type OwnersIndex = WeakMap<object, Set<string | symbol>>

/**
 * 一次写入对被索引图的影响，report 据此决定索引怎么处理：
 * STABLE 原样复用、ADDED 增量并入、REMOVED 退化全量重建。
 */
const EDGE_STABLE = 0
const EDGE_ADDED = 1
const EDGE_REMOVED = 2
type EdgeChange = typeof EDGE_STABLE | typeof EDGE_ADDED | typeof EDGE_REMOVED

/**
 * 复用同一对象的代理。归属按顶层键索引，覆盖未读取过的别名与环。
 *
 * 索引不变量：`owners(X)` 恒等于「沿被索引的边（数据属性值 / Map 键值 / Set 成员）能走到 X
 * 的那些顶层键」。访问器一律不求值，故经访问器取出的对象天然不在索引内。
 * 由该不变量推出两条维持规则：
 * - 新增一条边 container→value：只需把 container 的归属键并入 value 的整棵子树；子树里某节点
 *   已含全部这些键时，它的子树在上一次同样操作里就已含这些键，可以剪枝（增量，O(新增子树)）。
 * - 删掉一条边：旧子树可能仍从别的顶层键可达，也可能整棵脱落，正向索引无法判定，只能整体重建
 *   （全量，O(整图)）。判错的代价是漏报，而漏报等于变更对页面永久不可见，故宁可多花一次重建。
 * 另外，Store 侧（setState / $patch / $replaceState）与 action 内的写入都会推进状态版本号，
 * 版本与索引记录的不一致时同样退化为全量重建。
 *
 * 增量依赖的前提：改变可达性的写入要么走这里的陷阱，要么会推进版本号。既不走陷阱也不推版本的
 * 裸写（拿到 store.getState() 的内部引用后直接改、状态保护代理「放行」分支的写入）本身就不在
 * 追踪契约内（不标脏、不通知，见 core/store/stateVersion.ts 与 StateProxy 的说明）；旧实现靠
 * 「每次结构性写入都重建」偶然把这类图变更一起捞回来，增量实现不再兜它——兜底代价由 report 的
 * 「解析不出归属即标记全部顶层键」承担，方向仍是多报而非漏报。
 */
export function createDirtyTrackingProxy(root: object, cache: DirtyTrackingCache, onMutate: (rootKeys: Iterable<string | symbol>) => void): object {
  const unwrap = (value: unknown): unknown => (value !== null && typeof value === 'object' ? (cache.targets.get(value) ?? value) : value)
  const isObject = (value: unknown): value is object => value !== null && typeof value === 'object'
  /** 属性/集合成员当前实际存着的对象（存的是代理时解包），非对象返回 undefined */
  const indexedObjectOf = (value: unknown): object | undefined => {
    const raw = unwrap(value)
    return isObject(raw) ? raw : undefined
  }
  let owners: OwnersIndex | undefined
  let indexedVersion = getStateVersion(root)

  /**
   * 索引遍历：只沿数据属性值 / Map 键值 / Set 成员下沉，不求值访问器，
   * 也不进 Date/RegExp/WeakMap/WeakSet 的内部槽位（Map/Set 已按上面的口径单独走完）。
   * visit 返回 false 表示剪枝：该节点的子树已被同一批顶层键覆盖。
   */
  const traverse = (from: unknown, visit: (node: object) => boolean): void => {
    const pending: unknown[] = [from]
    while (pending.length > 0) {
      const value = unwrap(pending.pop())
      if (!isObject(value) || !visit(value)) continue
      if (value instanceof Map) {
        for (const [entryKey, entryValue] of value) pending.push(entryKey, entryValue)
      } else if (value instanceof Set) {
        for (const member of value) pending.push(member)
      } else if (isBuiltinObject(value)) {
        continue
      }
      for (const key of Reflect.ownKeys(value)) {
        const child = Object.getOwnPropertyDescriptor(value, key)
        if (child && 'value' in child) pending.push(child.value)
      }
    }
  }

  const rebuildOwners = (): OwnersIndex => {
    const index: OwnersIndex = new WeakMap()
    owners = index
    for (const rootKey of Reflect.ownKeys(root)) {
      const descriptor = Object.getOwnPropertyDescriptor(root, rootKey)
      if (!descriptor || !('value' in descriptor)) continue
      // 索引自身就是「本根键已访问过」的标记，无需再为每个根键单独分配 seen：
      // 被 K 个顶层键共享的子树此前要被重走 K 次
      traverse(descriptor.value, (node) => {
        const keys = index.get(node)
        if (keys) {
          if (keys.has(rootKey)) return false
          keys.add(rootKey)
        } else {
          index.set(node, new Set<string | symbol>([rootKey]))
        }
        return true
      })
    }
    return index
  }

  /** 把容器的归属键增量并入新增子树；keys 只被读取，写入目标是节点自己的集合 */
  const indexAddedEdge = (keys: ReadonlySet<string | symbol>, value: unknown): void => {
    const index = owners
    const raw = indexedObjectOf(value)
    // 容器自身解析不出归属（经访问器取出、挂在函数值上）时无键可并，新增的子树保持「不在索引内」，
    // 后续写入由 report 的全顶层键兜底
    if (!index || !raw || keys.size === 0) return
    traverse(raw, (node) => {
      const existing = index.get(node)
      if (!existing) {
        index.set(node, new Set(keys))
        return true
      }
      let added = false
      for (const key of keys) {
        if (!existing.has(key)) {
          existing.add(key)
          added = true
        }
      }
      return added
    })
  }

  /**
   * 判定一次数据属性写入（set / defineProperty）对图的影响，必须在 Reflect 写入之前求值。
   *
   * 「旧值是对象」等于删掉一条被索引的边 → EDGE_REMOVED（无法廉价判断旧子树是否仍可达，
   * 猜错就是漏报）。旧值不是对象而新值是 → 纯新增边 → EDGE_ADDED。
   * 同对象自赋值、标量改写、数组 length 变长（只造空洞）→ 图不变 → EDGE_STABLE。
   * 覆盖自有访问器同样按 EDGE_REMOVED 处理：它的 setter 会改哪些边不可知，
   * 且这类写入在增量之前也是走全量重建的，不借此路径改口径。
   */
  const classifyWrite = (obj: object, key: string | symbol, previous: PropertyDescriptor | undefined, value: unknown): EdgeChange => {
    if (Array.isArray(obj) && key === 'length') {
      return tailDropsIndexedEdge(obj, Number(value)) ? EDGE_REMOVED : EDGE_STABLE
    }
    if (previous && !('value' in previous)) return EDGE_REMOVED
    const previousValue = previous && 'value' in previous ? indexedObjectOf(previous.value) : undefined
    if (previousValue && previousValue !== value) return EDGE_REMOVED
    return isObject(value) && value !== previousValue ? EDGE_ADDED : EDGE_STABLE
  }

  /** 数组 length 缩短一次删掉尾部全部边；尾部没有对象时其实什么都没删，可继续复用索引 */
  const tailDropsIndexedEdge = (list: unknown[], nextLength: number): boolean => {
    const from = Number.isFinite(nextLength) && nextLength > 0 ? Math.trunc(nextLength) : 0
    for (let index = from; index < list.length; index++) {
      if (indexedObjectOf(list[index])) return true
    }
    return false
  }

  const report = (target: object, key?: string | symbol, edge: EdgeChange = EDGE_REMOVED, addedValue?: unknown): Set<string | symbol> => {
    if (edge === EDGE_REMOVED || getStateVersion(root) !== indexedVersion) owners = undefined
    const index = owners ?? rebuildOwners()
    const keys = new Set(index.get(target))
    if (target === root && key !== undefined) keys.add(key)
    // 新增边带来的归属就是容器此刻的归属，先定下来再并入子树；刚重建过的索引已经含这条边，
    // 传播会被剪枝成空操作
    if (edge === EDGE_ADDED) indexAddedEdge(keys, addedValue)
    // 归属解析不出来（对象经访问器取出、挂在函数值上等索引刻意不覆盖的位置）时
    // 保守标记全部顶层键：只 bump 计数而不标脏键会让集成层按「未变化」跳过 setData，
    // 变更对所有页面永久不可见——宁可多报也不能漏报
    if (keys.size === 0) {
      for (const rootKey of Reflect.ownKeys(root)) keys.add(rootKey)
    }
    onMutate(keys)
    indexedVersion = getStateVersion(root)
    return keys
  }

  const wrap = (value: unknown): unknown => {
    value = unwrap(value)
    if (!isObject(value)) return value
    const target = value
    const collection = target instanceof Map || target instanceof Set
    // 内部槽位语义在代理下必然失效的内建对象（Date/RegExp/WeakMap/WeakSet）保持原引用，
    // 内部变异不计入（既有契约）。Map/Set 由 collectionMethod 单独处理
    if (!collection && isBuiltinObject(target)) return target
    const cached = cache.proxies.get(target)
    if (cached) return cached

    const array = Array.isArray(target)
    const prototype = Object.getPrototypeOf(target)
    // 非普通实例（类实例、类型化数组）：方法必须绑定到原始接收者，否则 #private 字段
    // 与类型化数组的内部槽位会因 this 是代理而抛错。实例属性的写入仍经 set 陷阱可追踪；
    // 方法内部对原始对象自身的写入无法精细归因，故调用时保守标记所属顶层键（宁可多报）
    const bindMethods = !collection && !array && prototype !== Object.prototype && prototype !== null

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
        const raw = Reflect.get(obj, key, obj)
        // 有意以原始 target 作为接收者（而非 receiver/代理）：类实例的访问器与方法
        // 常读 #private 字段、类型化数组内部槽位，代理接收者会让它们直接抛错
        // （与下方 bindMethods 同一取舍）。代价是访问器内部对裸对象的写入不被归因，
        // 此类写入由 report 的「归属解析不出即标记全部顶层键」兜底
        if (bindMethods && typeof raw === 'function' && key !== 'constructor') {
          if (methods.has(key)) return methods.get(key)
          const invoke = (...args: unknown[]): unknown => {
            // 方法体直接改原始对象，索引看不到它写了哪些边：只能整体重建后再归因
            report(obj)
            return Reflect.apply(raw as (...a: unknown[]) => unknown, obj, args)
          }
          methods.set(key, invoke)
          return invoke
        }
        return wrap(raw)
      },
      set(obj, key, next) {
        const previous = Object.getOwnPropertyDescriptor(obj, key)
        const value = unwrap(next)
        const edge = classifyWrite(obj, key, previous, value)
        const success = Reflect.set(obj, key, value)
        if (success) report(obj, key, edge, value)
        return success
      },
      deleteProperty(obj, key) {
        const previous = Object.getOwnPropertyDescriptor(obj, key)
        const success = Reflect.deleteProperty(obj, key)
        if (success) {
          // 访问器与不存在的键都没被索引过，删掉它们不动图；只有对象值键是真删除
          const removed = previous && 'value' in previous ? indexedObjectOf(previous.value) : undefined
          report(obj, key, removed ? EDGE_REMOVED : EDGE_STABLE)
        }
        return success
      },
      defineProperty(obj, key, descriptor) {
        const previous = Object.getOwnPropertyDescriptor(obj, key)
        const value = 'value' in descriptor ? unwrap(descriptor.value) : undefined
        const normalized = 'value' in descriptor ? { ...descriptor, value } : descriptor
        const success = Reflect.defineProperty(obj, key, normalized)
        if (success) report(obj, key, classifyWrite(obj, key, previous, value), value)
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
        const rawKey = unwrap(entryKey)
        const rawValue = unwrap(value)
        // Map 的键与值都是被索引的边：覆盖已有键等于删一条旧边，只能整体重建；
        // 新键只增边，可增量登记
        const previous = obj.has(rawKey) ? indexedObjectOf(obj.get(rawKey)) : undefined
        const removedEdge = !!previous && previous !== rawValue
        obj.set(rawKey, rawValue)
        const attributed = report(obj, undefined, removedEdge ? EDGE_REMOVED : EDGE_STABLE)
        if (!removedEdge) {
          indexAddedEdge(attributed, rawKey)
          indexAddedEdge(attributed, rawValue)
        }
        return proxy
      }
    }
    if (key === 'add' && obj instanceof Set) {
      return (value: unknown) => {
        const raw = unwrap(value)
        obj.add(raw)
        // 重复 add 不新增边，indexAddedEdge 的剪枝会让它直接停在这一步
        indexAddedEdge(report(obj, undefined, EDGE_STABLE), raw)
        return proxy
      }
    }
    if (key === 'delete') {
      return (value: unknown) => {
        const deleted = obj.delete(unwrap(value))
        if (deleted) report(obj, undefined, EDGE_REMOVED)
        return deleted
      }
    }
    if (key === 'clear') {
      return () => {
        const changed = obj.size > 0
        obj.clear()
        if (changed) report(obj, undefined, EDGE_REMOVED)
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
