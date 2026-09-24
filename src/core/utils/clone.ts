/**
 * GeomStore - 状态克隆工具
 *
 * 将深拷贝实现从 `core/store/utils` 迁移至此，使 `core/utils` 成为自包含的
 * 工具层，消除 `utils → store` 的层级倒置（此前 helpers.clone 需从 store/utils
 * 引入 deepCloneState）。克隆语义与 Store 内部保持一致。
 */

/**
 * 深拷贝状态
 *
 * 统一使用递归克隆实现（不依赖 structuredClone），原因：
 * - structuredClone 对函数/Symbol/WeakMap/Promise 等值会抛 DataCloneError，
 *   而 State 类型允许此类值，崩溃会把故障面扩大到所有 createStore 调用；
 * - structuredClone 会剔除值为 undefined 的属性（结构化克隆算法语义），
 *   与旧基础库（无 structuredClone）的降级路径行为分叉，难以排查；
 *
 * 递归实现相比 JSON 往返：
 * - 支持循环引用（WeakMap 守卫，不会栈溢出）
 * - 保留 undefined 属性与 Date/RegExp/Map/Set 实例
 * - 数组的空洞与非下标自有属性一并保留（副本与源在 deepEqual 下等价）
 * - 不可克隆对象（WeakMap/Promise/Blob 等）保留原引用，避免崩溃
 *
 * 「保留原引用」的范围要说清，它是**不隔离**的降级路径：副本与活状态指向同一个对象，
 * 改写任一侧另一侧同步变化。除函数外，命中该路径的有——
 * - 非纯对象（class 实例、Error、URL、装箱原始值……），原型既非 Object.prototype 也非 null；
 * - **ArrayBuffer / TypedArray / DataView**：它们可变、structuredClone 本可克隆，
 *   但视图类型有 12 种且重建要处理 detach/resizable/SharedArrayBuffer 与别名共享的
 *   buffer，热路径（setState/$patch）上不划算，故一并归入共享引用节点。状态里放字节缓冲
 *   （如 wx.getFileSystemManager().readFile 的返回值）时，需要隔离请自行 `buf.slice(0)`
 *   或把它包在普通对象里由调用方负责；
 * - **Date/RegExp/Map/Set/Array 的子类实例**：只重建「恰好是该内建类型」的实例。
 *   子类的构造参数、内部槽位与自有字段都不可知，重建会得到丢方法与字段的基类副本
 *   （`class MyMap extends Map` 克隆后调子类方法直接 TypeError），故保留原引用。
 *
 * 还有一条与 deepEqual 相关的窄口径：**Map/Set 的键也被深克隆**，键的引用身份随之改变，
 * 而 deepEqual 的 Map 分支按键的引用（SameValueZero）匹配（见其 @remarks）。后果是状态里
 * 存在**对象键 Map** 时 `deepEqual(deepCloneState(state), state)` 恒为 false，
 * 表现同「反序列化后的等效键」：选择器缓存/变更检测持续失配而非报错。
 * 规避方式与 equality.ts 一致——Map 只用原始值或跨比较稳定的同一引用作键。
 *
 * 别名（同一对象被多处引用）的保留范围要说清：Map/Set/数组/纯对象在克隆前先把自己
 * 写进 visited，故多处引用共享同一副本；**Date/RegExp 每次调用都新建实例且不登记
 * visited**——`{ a: d, b: d }` 与 `[d, d]` 都会得到两个不同 Date（两条路径同样不共享，
 * 不存在对象/数组之间的口径差异）。这是有意取舍：
 * - Date/RegExp 无法承载循环引用，登记 visited 只为别名一致性，收益远小于多一次
 *   WeakMap 读写（克隆在 setState/$patch 热路径上）；
 * - 由此带来的第二个后果是**实例上的自有可枚举扩展属性会被丢弃**（`d.tag = 1` 不复制），
 *   RegExp 的 `lastIndex` 也不保留（`new RegExp(source, flags)` 重置为 0）。
 * State 语义上不该依赖这三者，若确有需求请改用普通对象承载。该窄口径**不改为行为**：
 * deepEqual 的 Date/RegExp 分支同样只看 getTime 与 source/flags、忽略扩展属性，
 * 两处的口径是配套的（只补一侧会让「克隆与源等价」这条不变量以另一种方式破功）
 */
export function deepCloneState<T>(state: T): T {
  return fallbackClone(state)
}

/**
 * 内建容器的准入门槛：只重建「恰好是该内建类型本身」的实例。
 * 子类实例走保留原引用的降级路径，理由见 deepCloneState 的文档。
 */
export function isExactly(value: object, proto: object): boolean {
  return Object.getPrototypeOf(value) === proto
}

/**
 * 「状态不住在自有可枚举属性上」的内建类型标签。
 *
 * 这类值若按 `Object.create(原型)` + 拷贝自有可枚举键的方式重建，产出的是一副
 * `instanceof` 仍为真、内部槽位却缺失的空壳：`await` 一个空壳 Promise（没有 then）、
 * `Number(new Number(1))`（valueOf 要求 [[NumberData]]）、把空壳字节缓冲交给宿主 API，
 * 都会在消费方第一次使用时抛 TypeError；`Error` 的 `message` 是不可枚举自有属性，
 * 空壳会连错误消息一起丢掉。克隆引擎对它们一律保留原引用。
 *
 * 判据用 `Object.prototype.toString` 的 tag 而非 `instanceof Promise`：前者跨 realm
 * （分包/多运行时下的 Promise 不是同一份构造器）仍然成立，后者会漏。
 *
 * 残留边界：状态不住在自有可枚举属性上、又没有内建 tag 的宿主对象（自定义 native 包装、
 * 部分 wx 宿主返回对象）识别不到，仍会被重建为空壳。这类值请用 `customCloner` 提前接管。
 */
const SLOT_BEARING_TAGS = new Set([
  'Promise',
  'WeakMap',
  'WeakSet',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'Number',
  'String',
  'Boolean',
  'Symbol',
  'Error',
  'Function',
  'Generator',
])

export function isSlotBearingBuiltin(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false
  }
  // ArrayBuffer.isView 覆盖全部 TypedArray 与 DataView，且不依赖 realm 一致的构造器
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) {
    return true
  }
  return SLOT_BEARING_TAGS.has(Object.prototype.toString.call(value).slice(8, -1))
}

/**
 * 数组的规范下标键（'0'、'1'…）：这类键由下标循环负责，附加属性循环需跳过
 *
 * 上界 2^32-2 是规范里的最大合法数组下标（2^32-1 是 length 的哨兵值，不是下标）。
 * 少了它，`a[4294967295] = 'x'` 会被当成下标交给下标循环——而循环只走到
 * `value.length`，该属性既没被下标循环复制、又被附加属性循环跳过，
 * 于是在克隆产物里静默消失
 */
export function isIndexKey(key: string): boolean {
  const index = Number(key)
  return Number.isInteger(index) && index >= 0 && index < 2 ** 32 - 1 && String(index) === key
}

/**
 * 对象自有可枚举键（字符串键 + 符号键）
 *
 * 不能用 `Object.keys`：它只给字符串键，符号键会被整条漏掉——而 Store 的写入链路
 * （setState / $patch / 脏键表）本就接受符号键，只在克隆、合并与遍历这几步用 Object.keys
 * 的话，符号键会「写进去了却没被克隆/合并/标脏」，退化成静默半途而废：
 * 最直观的一处是通知载荷——可写订阅者拿到的深拷贝里没有符号键，
 * 值在 `getState()` 里读得到、在通知里读不到。
 * 过滤不可枚举键，与 `Object.keys` 的口径一致（Object.assign / 展开也只搬可枚举自有键）
 *
 * 住在 clone.ts 而不是 helpers.ts：本模块是依赖链的叶子（helpers 反过来依赖它），
 * 判据族（isIndexKey / isSlotBearingBuiltin）也都在这一侧。
 */
export function ownEnumerableKeys(target: object): Array<string | symbol> {
  // Object.keys 已只给「自有可枚举字符串键」，符号键另取再按可枚举性过滤（两者拼起来的
  // 集合与 Reflect.ownKeys + 过滤逐项相同）。不用 Reflect.ownKeys 是因为它把不可枚举键
  // 也一并物化，而这里的调用方在热路径上（deepCloneState 的每个节点、deepMerge 的每层遍历）
  const symbols = Object.getOwnPropertySymbols(target)
  if (symbols.length === 0) {
    return Object.keys(target)
  }
  return [...Object.keys(target), ...symbols.filter((symbol) => Object.prototype.propertyIsEnumerable.call(target, symbol))]
}

/**
 * 以「自有数据属性」语义写入键。
 *
 * `target['__proto__'] = v` 走 [[Set]] 会触发原型上的 setter：键被丢弃、副本原型被换掉，
 * 注入的属性反而变成继承属性（deepMerge 的 defineProperty 防护也会因此失效）。
 * defineProperty 只定义自有数据属性，可安全承载任意键名。
 */
function assignOwn(target: object, key: string | symbol, value: unknown): void {
  // 符号键不可能与原型链上的 accessor 同名，`__proto__` 这条防护只对字符串键有意义
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, writable: true, enumerable: true, configurable: true })
  } else {
    const slot = target as Record<PropertyKey, unknown>
    slot[key] = value
  }
}

/** 带循环引用守卫的递归克隆 */
function fallbackClone<T>(value: T, seen?: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== 'object') {
    // 函数等不可克隆值保留原引用（函数无内部状态，共享无副作用）
    return value
  }

  const visited = seen ?? new WeakMap<object, unknown>()
  const cached = visited.get(value as object)
  if (cached !== undefined) {
    return cached as T
  }

  // 新建实例、不登记 visited（详见 deepCloneState 的别名/扩展属性口径）
  if (value instanceof Date) {
    if (!isExactly(value as object, Date.prototype)) return value
    return new Date(value.getTime()) as T
  }

  if (value instanceof RegExp) {
    if (!isExactly(value as object, RegExp.prototype)) return value
    return new RegExp(value.source, value.flags) as T
  }

  if (value instanceof Map) {
    if (!isExactly(value as object, Map.prototype)) return value
    const map = new Map()
    visited.set(value as object, map)
    value.forEach((mapValue, mapKey) => {
      map.set(fallbackClone(mapKey, visited), fallbackClone(mapValue, visited))
    })
    return map as unknown as T
  }

  if (value instanceof Set) {
    if (!isExactly(value as object, Set.prototype)) return value
    const set = new Set()
    visited.set(value as object, set)
    value.forEach((setValue) => {
      set.add(fallbackClone(setValue, visited))
    })
    return set as unknown as T
  }

  if (Array.isArray(value)) {
    if (!isExactly(value as object, Array.prototype)) return value
    // 预置 length 而非逐位 push：push 会把空洞补成值为 undefined 的实槽位，
    // 副本与源在 deepEqual 的「length 比对 + 空洞 ≠ undefined」口径下恒不等
    const arr: unknown[] = new Array(value.length)
    visited.set(value as object, arr)
    for (let i = 0; i < value.length; i++) {
      // hasOwnProperty 而非 `i in value`：只认自有键，语义上不依赖原型链上有没有数字键
      if (Object.prototype.hasOwnProperty.call(value, i)) {
        arr[i] = fallbackClone(value[i], visited)
      }
    }
    // 非下标的自有可枚举属性（`arr.meta = ...`）：deepEqual 比的是 Object.keys 键集，
    // 整体丢弃既是数据丢失也让副本与源恒不等。键数为 n 的数组多一趟 O(n) 遍历，
    // 换来的是「克隆与源在比较器下等价」这条被选择器/快照依赖的不变量。
    // 键集取 ownEnumerableKeys 而非 Object.keys：符号键同样是「非下标自有键」，
    // 漏掉它会让写进去的符号值在可写订阅者的载荷里凭空消失
    for (const key of ownEnumerableKeys(value as object)) {
      if (typeof key === 'string' && !isIndexKey(key)) {
        assignOwn(arr, key, fallbackClone((value as Record<PropertyKey, unknown>)[key], visited))
      }
    }
    return arr as unknown as T
  }

  // 非纯对象（WeakMap/Promise/Blob/class 实例等）无法安全克隆，保留原引用
  const proto = Object.getPrototypeOf(value as object)
  if (proto !== Object.prototype && proto !== null) {
    return value
  }

  // 克隆进同类原型：Object.create(null) 的状态映射若克隆成 {}，副本会白得一份
  // Object.prototype（'toString' in clone / clone.hasOwnProperty 行为与源不一致）
  const obj = Object.create(proto) as Record<PropertyKey, unknown>
  visited.set(value as object, obj)
  // 键集含符号键：通知载荷、可写订阅者的深拷贝都走这里，只认字符串键的话
  // 写进状态的符号值会在订阅者手里凭空消失（值在 getState() 里读得到、通知里读不到）
  const keys = ownEnumerableKeys(value as object)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    assignOwn(obj, key, fallbackClone((value as Record<PropertyKey, unknown>)[key], visited))
  }
  return obj as T
}
