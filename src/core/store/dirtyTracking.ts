/** Writable action proxies: report mutations and every affected top-level key. */
import { isBuiltinObject, isMapLike, isSetLike } from './StateProxy.js'
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
 *   唯一的例外是「对象换对象且新值的归属已覆盖容器键」的同容器内置换（sort / reverse /
 *   splice 移动元素）：那条边对索引什么都没改，按 STABLE 处理，否则一次 O(n log n) 的
 *   原地排序要付 O(n² log n) 的重建代价。判定条件与安全性见 classifyWrite 的 isCoveredSwap。
 * 另外，Store 侧（setState / $patch / $replaceState）与 action 内的写入都会推进状态版本号，
 * 版本与索引记录的不一致时同样退化为全量重建。
 *
 * 增量依赖的前提：改变可达性的写入要么走这里的陷阱，要么会推进版本号。既不走陷阱也不推版本的
 * 裸写（拿到 store.getState() 的内部引用后直接改、状态保护代理「放行」分支的写入）本身就不在
 * 追踪契约内（不标脏、不通知，见 core/store/stateVersion.ts 与 StateProxy 的说明）；旧实现靠
 * 「每次结构性写入都重建」偶然把这类图变更一起捞回来，增量实现不再兜它——兜底代价由 report 的
 * 「解析不出归属即标记全部顶层键」承担，方向仍是多报而非漏报。
 *
 * onMutate 的契约：一次上报至多为本次写入推一格版本（Store 的接线就是固定一格 `_mutationCount++`）。
 * 回调里还要改图时，要么走本代理（重入的 report 自己把索引维护好），要么按 Store 侧口径再推一格
 * 版本号——多出来的那格 report 判得出来，会作废背书、留给下次全量重建；只改图不推版本则属上一段
 * 已声明的契约外裸写，不在追踪范围内。
 */
export function createDirtyTrackingProxy(root: object, cache: DirtyTrackingCache, onMutate: (rootKeys: Iterable<string | symbol>) => void): object {
  // 快路径：根代理已建过就直接返回，不必先把下面整套闭包（约 13 个）建出来再发现
  // `wrap(root)` 会在 cache.proxies 上命中。action 体内每次 `this.state` 访问都走这里，
  // 一个 action 读三次状态就是三轮闭包构造换回同一个代理。
  // 与 wrap 的判定等价：wrap 对内建对象（Date/RegExp/WeakMap/WeakSet）直接返回原引用、
  // 从不写进 proxies，故此处不会对内建值误命中；root 本身是代理时本快路径不命中、
  // 落回 wrap 的 unwrap 路径，结论不变
  const cachedRoot = cache.proxies.get(root)
  if (cachedRoot) return cachedRoot

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
      if (isMapLike(value)) {
        for (const [entryKey, entryValue] of value) pending.push(entryKey, entryValue)
      } else if (isSetLike(value)) {
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
   * 沿原型链找 key 的描述符，只看「自有属性缺席」时才会被用到的那一半。
   *
   * 自有查找（getOwnPropertyDescriptor）不足以判定写入对图的影响：`Reflect.set` 会调用
   * **原型上**的 setter，且以原始对象为接收者（正是 `bindMethods` 支持的类实例场景），
   * 陷阱完全看不到它改了哪些边。链长是个位数，且仅在自有属性不存在时走一次。
   */
  const inheritedDescriptor = (obj: object, key: string | symbol): PropertyDescriptor | undefined => {
    for (let proto = Object.getPrototypeOf(obj); proto !== null; proto = Object.getPrototypeOf(proto)) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key)
      if (descriptor) return descriptor
    }
    return undefined
  }

  /**
   * 「对象换对象」的写入能否免掉全量重建
   *
   * 旧值与新值都是对象时默认判 EDGE_REMOVED（删边 ⇒ 全量重建），但这一档里最常见的一种
   * 写入其实什么都没改：**同一容器内的置换**。`this.state.todos.sort(...)` / `reverse()` /
   * 中段 `splice` 移动元素时，被写进来的对象早已从该容器的顶层键可达，归属集合与容器一致
   * ⇒ 新增这条边不改索引；被写走的那个对象即便整棵脱落，留在索引里的旧归属只会让它此后
   * 的写入被**多报**（其真实归属是新指向它的容器键，而那条边同样是 STABLE 报的键），
   * 不会漏报。反之「新子树还没有这些键」时必须走重建，否则新增边漏登记 ⇒ 新子树此后
   * 的写入按旧键上报、真正的键被漏掉。
   *
   * 不这么做付的代价是数量级的：Array.prototype.sort 以数组代理为 this 运行，n 个元素
   * 是 O(n log n) 次 [[Set]]，每次一次 O(整图) 重建 ⇒ 整体 O(n² log n)。
   *
   * @param container - 被写入的容器（原始对象）
   * @param incoming - 写进来的那个对象（已解包）
   */
  const isCoveredSwap = (container: object, incoming: object): boolean => {
    const index = owners
    // 索引还没建（本次写入就要触发首次重建）时无从判断覆盖关系
    if (!index) return false
    const required = index.get(container)
    // 容器自身解析不出归属（挂在访问器取出的对象上、函数值上等索引刻意不覆盖的位置）：
    // 它连自己的键都给不出，新增这条边要靠 report 的「全部顶层键」兜底，不在本优化范围内。
    // root 也走这一档——report 对 root 会额外带上本次写入的键，那份覆盖这里判不出来
    if (required === undefined || required.size === 0) return false
    const incomingKeys = index.get(incoming)
    if (incomingKeys === undefined) return false
    for (const key of required) {
      if (!incomingKeys.has(key)) return false
    }
    return true
  }

  /**
   * 判定一次数据属性写入（set / defineProperty）对图的影响，必须在 Reflect 写入之前求值。
   *
   * 「旧值是对象」等于删掉一条被索引的边 → EDGE_REMOVED（无法廉价判断旧子树是否仍可达，
   * 猜错就是漏报）。旧值不是对象而新值是 → 纯新增边 → EDGE_ADDED。
   * 同对象自赋值、标量改写、数组 length 变长（只造空洞）→ 图不变 → EDGE_STABLE。
   * 对象换对象且新值的归属已覆盖容器键（同容器内置换：sort / reverse / splice 移动）
   * → EDGE_STABLE，理由见 {@link isCoveredSwap}。
   * 访问器写入一律 EDGE_REMOVED：它的 setter 会改哪些边不可知。自有访问器看 `previous`，
   * 原型链上的访问器由调用方经 `inherited` 补进来（set 陷阱传，见其注释；
   * defineProperty 走 [[DefineOwnProperty]]，不调用任何 setter，故不传）。
   * 这类写入在增量之前也是走全量重建的，不借此路径改口径。
   */
  const classifyWrite = (
    obj: object,
    key: string | symbol,
    previous: PropertyDescriptor | undefined,
    value: unknown,
    inherited?: PropertyDescriptor,
  ): EdgeChange => {
    if (Array.isArray(obj) && key === 'length') {
      return tailDropsIndexedEdge(obj, Number(value)) ? EDGE_REMOVED : EDGE_STABLE
    }
    const effective = previous ?? inherited
    if (effective && !('value' in effective)) return EDGE_REMOVED
    const previousValue = previous && 'value' in previous ? indexedObjectOf(previous.value) : undefined
    if (previousValue && previousValue !== value) {
      const incoming = indexedObjectOf(value)
      if (incoming && isCoveredSwap(obj, incoming)) return EDGE_STABLE
      return EDGE_REMOVED
    }
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
    // 此刻索引与图是一致的：记下这一格的版本号，回调返回后再读一次，差值即回调推进的格数
    const versionAtResolve = getStateVersion(root)
    onMutate(keys)
    const versionAfterCallback = getStateVersion(root)
    const bumpsDuringCallback = versionAtResolve === undefined || versionAfterCallback === undefined ? 0 : versionAfterCallback - versionAtResolve
    // 版本号必须在 onMutate **之后**取：回调（Store 的接线，见 Store._createDirtyTrackingProxy 的
    // `this._mutationCount++`）会为本次写入固定推一格，取回调之前的快照则 indexedVersion 恒落后
    // 一格，下一次上报必然判「版本已变」⇒ 每次写入都全量重建，增量索引永久失效。
    // 但一格之外的推进只能来自回调里的重入写入（setState / $patch 一类改图不走本代理陷阱、
    // 只推版本号的路径），索引对它无感知；这种情况不背书，留给下一次上报全量重建
    // （多一次重建的代价是常数，漏归因的代价是变更对页面永久不可见）
    indexedVersion = bumpsDuringCallback > 1 ? versionAtResolve : versionAfterCallback
    return keys
  }

  const wrap = (value: unknown): unknown => {
    value = unwrap(value)
    if (!isObject(value)) return value
    const target = value
    const collection = isMapLike(target) || isSetLike(target)
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
        //
        // 有意的追踪空洞（Proxy 不变量逼出来的，不是漏实现）：既不可配置也不可变写的
        // 自有数据属性上，陷阱必须原样返回那个值，代理不包装 ⇒ 调用方拿到**裸对象**，
        // 此后对它的写入既不走 set 也不走 defineProperty 陷阱，不标脏键、不推版本、不通知。
        // 该属性因此只能承载「不再被改的引用」；需要继续被追踪的状态请放在
        // 可配置或可变写的属性上，或经 setState / $patch 写入
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
        // 集合的白名单外成员（collectionMethod 覆盖 set/add/delete/clear/has/get/forEach/
        // Symbol.iterator/entries/keys/values 之外的函数值）以**原始集合**为接收者返回：
        // 裸函数经代理调用时 this 是代理而不是原始 Map/Set，内部槽位取不到 ⇒ 直接抛
        // TypeError（`Method Set.prototype.union called on incompatible receiver`）。
        // ES2025 给 Set 新增的 union / intersection / difference / symmetricDifference /
        // isSubsetOf / isSupersetOf / isDisjointFrom 全在这一档里，Map/Set 子类自定义方法
        // 读 #private 字段同样走这里——与下方 bindMethods 是同一个坑、同一手法。
        // 取舍与 bindMethods 一致：这类调用不计入追踪（白名单外的内置方法都不改图，
        // 子类自定义方法若改图则属本文件声明的契约外写入，其新增子树由 report 的
        // 「解析不出归属即标记全部顶层键」兜底），故不额外 report 一次，免得纯读方法
        // （union 一类）在渲染路径上被调用一次就把所属顶层键标脏、白刷一次 setData
        if (collection && typeof raw === 'function' && key !== 'constructor') {
          const bound = raw.bind(obj)
          methods.set(key, bound)
          return bound
        }
        // 有意以原始 target 作为接收者（而非 receiver/代理）：类实例的访问器与方法
        // 常读 #private 字段、类型化数组内部槽位，代理接收者会让它们直接抛错
        // （与下方 bindMethods 同一取舍）。代价是访问器内部对裸对象的写入不被归因，
        // 此类写入由 report 的「归属解析不出即标记全部顶层键」兜底
        if (bindMethods && typeof raw === 'function' && key !== 'constructor') {
          if (methods.has(key)) return methods.get(key)
          const invoke = (...args: unknown[]): unknown => {
            // 方法体直接改原始对象，索引看不到它写了哪些边，故调用前先按当前索引归因
            // 所属顶层键（宁多报）。此处不做全量重建：重建发生在 Reflect.apply 之前，
            // 看不到方法体新增的边，等于把整图原样再推一遍，是纯开销
            report(obj, undefined, EDGE_STABLE)
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
        // 自有属性存在时它决定写入落点，无需看链；缺席时才可能命中原型上的 setter
        const edge = classifyWrite(obj, key, previous, value, previous === undefined ? inheritedDescriptor(obj, key) : undefined)
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
    if (key === 'set' && isMapLike(obj)) {
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
    if (key === 'add' && isSetLike(obj)) {
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
    if (key === 'get' && isMapLike(obj)) return (value: unknown) => wrap(obj.get(unwrap(value)))
    if (key === 'forEach') {
      return (callback: (value: unknown, key: unknown, collection: object) => void, thisArg?: unknown) => {
        obj.forEach((value, entryKey) => callback.call(thisArg, wrap(value), wrap(entryKey), proxy))
      }
    }
    if (key === Symbol.iterator || key === 'entries' || key === 'keys' || key === 'values') {
      return function* () {
        const entries = key === 'entries' || (key === Symbol.iterator && isMapLike(obj))
        let iterator: Iterable<unknown>
        if (entries) {
          iterator = obj.entries()
        } else if (key === 'keys') {
          iterator = obj.keys()
        } else {
          iterator = obj.values()
        }
        for (const item of iterator) {
          yield entries ? (item as unknown[]).map(wrap) : wrap(item)
        }
      }
    }
    return undefined
  }

  return wrap(root) as object
}
