/**
 * GeomStore - 快照同步克隆引擎
 *
 * 自 SnapshotManager.ts 拆出：递归式深度克隆及其前置公共判定。
 * 全部为纯函数（不依赖管理器实例状态），由 SnapshotManager 的
 * createSnapshot / processNodeAsync 传入已解析的 options 与账本对象调用。
 *
 * @module SnapshotManager/clone
 */

import type { CloneContext, SnapshotError, SnapshotOptions, SnapshotStats } from './types.js'
// `isIndexKey` 的收敛（第六轮 f2-13）：三份同名私有谓词各写一遍，改一处就会漂移成
// 「同一份数组在克隆引擎与快照引擎里的附加键归属不同」。`extras/action/decorators/cache.ts`
// 那份属参数序列化域、与克隆键集无关，维持现状。
import { isExactly, isIndexKey, isSlotBearingBuiltin } from '../../core/utils/clone.js'

/**
 * 快照中止信号：onError 回调返回 false 时抛出。
 * processQueue 据此区分"单节点克隆失败（可兜底）"与"用户要求中止（须传播）"，
 * 否则中止意图会被兜底 catch 吞掉，异步快照错误地继续成功。
 */
export class SnapshotAbortError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Snapshot aborted by onError')
    this.name = 'SnapshotAbortError'
  }
}

/**
 * 安全读取属性值：读取本身可能抛错（访问器 getter 抛错、Proxy get 陷阱拒绝），
 * catch 载荷组装时必须避免二次触发同一个 getter
 */
export function safeReadProperty(target: Record<string | symbol, unknown>, key: string | symbol): unknown {
  try {
    return target[key]
  } catch {
    return undefined
  }
}

/**
 * 丢弃哨兵：自定义克隆器抛错且 onError 允许继续时，该节点无法产出安全克隆。
 *
 * 绝不能把原始活引用兜底进快照（否则后续对活状态的修改会穿透进快照，破坏隔离契约），
 * 因此在**同步路径**表现为「跳过该位置」（对象属性不写入、数组留洞、Map/Set 不落 entry），
 * 在**异步路径**（clone-async）表现为返回本哨兵、由 processQueue 跳过填充。
 *
 * 定义在同步引擎中（异步引擎依赖本模块，反向定义会造成循环依赖），
 * 两条路径各自 import 同一 Symbol；不提供跨模块再导出——CJS 下的再导出会生成
 * 永不被调用的 getter，既无必要又会拉低函数覆盖率。
 */
export const SKIP_CLONE_NODE = Symbol('SKIP_CLONE_NODE')

/**
 * 估算单个节点的字节占用（粗估：容器只计头部开销，子节点单独累加）。
 * 此前 estimatedSize 从未被累加，metadata.size 恒为 0。
 */
function estimateNodeSize(value: unknown): number {
  if (value === null || value === undefined) return 4
  switch (typeof value) {
    case 'string':
      return 16 + (value as string).length * 2
    case 'number':
      return 8
    case 'boolean':
      return 4
    default:
      // 对象/数组等容器：仅计引用与头部开销，内容由子节点任务累加
      return 8
  }
}

/**
 * 构造一条 cloneError 快照错误。
 *
 * 同一错误对象此前在「落账 errors.push」与「咨询 onError」两处各构造一份；
 * 抽为单一构造函数消除重复（sync/async 两条克隆路径共用）。
 */
export function makeCloneError(path: string, error: unknown): SnapshotError {
  return {
    type: 'cloneError',
    message: error instanceof Error ? error.message : 'Clone error',
    path,
    originalError: error instanceof Error ? error : undefined,
  }
}

/**
 * cloneError 的统一降级 / 中止处理（两条克隆路径的失败收尾都汇到此处）。
 *
 * 直接调用点是 customCloner 与属性循环两处 catch；节点级丢弃（类型判定 / 外壳构造 /
 * keys 枚举失败）先经 {@link dropFailedNode} 从 visited 除名再转来，两侧合计四处。
 *
 * 收敛四件事，避免同一策略在各处漂移：计一次克隆操作 → 落账 cloneError（静默丢弃会让
 * 隔离降级对调用方不可见，也让 success 判定认不出失败）→ 咨询 onError → 用户拒绝继续时
 * 抛 SnapshotAbortError。中止信号本身必须原样上抛：它是用户在更深层做出的决定，
 * 二次咨询 onError 会把「中止」被中途改答降级为静默丢子树且快照仍标记成功。
 *
 * @param error catch 到的原始抛出物
 * @param target 落账位置：path 为该节点的快照路径，value 为供 onError 判定的当前值
 * @throws {SnapshotAbortError} error 本身是中止信号，或 onError 返回 false
 */
export function handleCloneError(
  error: unknown,
  target: { path: string; depth: number; value: unknown },
  options: Pick<Required<SnapshotOptions>, 'onError'>,
  errors: SnapshotError[],
  stats: SnapshotStats,
): void {
  if (error instanceof SnapshotAbortError) {
    throw error
  }
  stats.cloneOperations++
  const snapshotError = makeCloneError(target.path, error)
  errors.push(snapshotError)
  const shouldContinue = options.onError(snapshotError, {
    path: target.path,
    depth: target.depth,
    value: target.value,
  })
  if (!shouldContinue) {
    throw new SnapshotAbortError(error)
  }
}

/**
 * 节点克隆失败时的统一收尾（同步两处 catch 与异步两处 catch 共用）：
 * 先把该节点从 visited 登记表上摘掉，再按 cloneError 落账并咨询 onError。
 *
 * 除名不是可选项：容器分支在建好壳后立刻登记（好让环上的多处引用指向同一克隆），
 * 而本节点随后被丢弃时若留着登记，同一源对象的后续兄弟引用会命中 visited 快路径、
 * 静默拿到这副被丢弃的半成品壳——按 SKIP 语义它本该在那些位置同样不出现
 *
 * @throws {SnapshotAbortError} error 是中止信号，或 onError 拒绝继续
 */
export function dropFailedNode(
  value: object,
  context: CloneContext,
  error: unknown,
  options: Pick<Required<SnapshotOptions>, 'onError'>,
  errors: SnapshotError[],
  stats: SnapshotStats,
): void {
  context.visited.delete(value)
  handleCloneError(error, { path: context.path, depth: context.depth, value }, options, errors, stats)
}

/**
 * 调用自定义克隆器的结果
 * - `value`：克隆器命中并返回了非 undefined 结果
 * - `skip`：克隆器抛错，但 onError 选择继续 → 调用方须丢弃该节点
 * - `passthrough`：克隆器未命中（返回 undefined），按类型继续克隆
 */
export type CustomCloneOutcome = { kind: 'value'; value: unknown } | { kind: 'skip' } | { kind: 'passthrough' }

/**
 * 调用用户自定义克隆器（同步 cloneDeep / 异步 processNodeAsync 共用）。
 *
 * 收敛两件事，避免两条路径行为漂移：
 * 1. **抛错语义**：克隆器抛错时交由 {@link handleCloneError} 统一落账 cloneError、咨询
 *    onError；继续则返回 `skip`，中止则抛 SnapshotAbortError（不再让原始异常直接冲出
 *    克隆过程、绕过降级契约）。
 * 2. **账本口径**：`stats.cloneOperations` 与 errors 的累加只在 handleCloneError 一处发生。
 *
 * @param value 当前节点原值
 * @param context 克隆上下文
 * @param options 需含 customCloner 与 onError 的配置
 * @param errors 错误账本
 * @param stats 统计账本
 * @returns 见 {@link CustomCloneOutcome}
 * @throws {SnapshotAbortError} onError 返回 false 时
 */
export function invokeCustomCloner(
  value: unknown,
  context: CloneContext,
  options: Pick<Required<SnapshotOptions>, 'customCloner' | 'onError'>,
  errors: SnapshotError[],
  stats: SnapshotStats,
): CustomCloneOutcome {
  let customResult: unknown
  try {
    customResult = options.customCloner(value, context)
  } catch (error) {
    // 抛错语义与账本口径统一走 handleCloneError：继续则丢弃该节点，中止则上抛
    handleCloneError(error, { path: context.path, depth: context.depth, value }, options, errors, stats)
    return { kind: 'skip' }
  }

  return customResult === undefined ? { kind: 'passthrough' } : { kind: 'value', value: customResult }
}

/**
 * 归一化源属性描述符的标志位（同步/异步两条克隆路径共用同一口径）。
 *
 * 取值统一走 ToBoolean（`Boolean(...)`），与 `Object.defineProperty` 的解释完全一致；
 * 此前同步路径传原始值、异步路径用 `=== true` 形成两套方言——对引擎产出的合法描述符
 * （`ToPropertyDescriptor` 已把三个标志转成布尔）二者等价，但同一份数据在两条路径下
 * 可能产出不同描述符，故统一到此处消除歧义。
 *
 * `enumerable` 是唯一**故意改写**的一位：`false` 一律提升为 `true`。能走到这里的不可枚举
 * 描述符只可能来自 `includeNonEnumerable: true` —— 该选项关闭时键集取自 `Object.keys`
 * （Proxy 的 ownKeys 陷阱也要过同一层可枚举过滤），不可枚举键根本不会被枚举到。保持原样
 * 会让这个选项名不副实：克隆品里的这类属性既不进 `Object.keys`、不进 `JSON.stringify`，
 * 也不进 `diff.ts` 的键集比对（它两侧都按 `Object.keys` 取键），于是「把状态上的不可枚举
 * 版本号/计数标记带进快照」这件事没有任何下游读者——两次快照之间只有该标记变了，
 * `compareSnapshots().changed` 仍是 false。该选项的语义因此定为「带进来并且读得到」，
 * writable / configurable 继续按源还原。
 *
 * @param descriptor 源属性描述符
 * @param isAccessor 是否为访问器属性（访问器不还原 get/set，一律落为可写数据属性）
 */
export function normalizeDescriptorFlags(
  descriptor: PropertyDescriptor,
  isAccessor: boolean,
): { writable: boolean; enumerable: boolean; configurable: boolean } {
  return {
    writable: isAccessor ? true : Boolean(descriptor.writable),
    // 唯一被故意改写的一位：见上方 enumerable 段。不可枚举只可能是 includeNonEnumerable
    // 拉进来的那一路，而它对下游唯一的读者就是可枚举键集，故一律落为可枚举
    enumerable: true,
    configurable: Boolean(descriptor.configurable),
  }
}

/**
 * 递归克隆的栈安全硬上限：与调用方的 `maxDepth` 取小后生效。
 *
 * 递归实现的栈深度等于数据深度，把上限完全交给调用方会让溢出（`RangeError: Maximum call
 * stack size exceeded`）落在任意一帧上，被那一层的属性 `try` 归因成一条 `cloneError`，
 * 快照在该处静默截断且 `success` 被判为 false。实测（Node 默认栈）单键链约 2000 层溢出，
 * 微信基础库的栈上限更低，故取 1000 留出一倍余量。
 * 超出部分按既有的 `maxDepth` 降级口径报告（计入 errors/stats、不影响 success），
 * 需要处理更深结构请走异步路径（clone-async：子值入队而非递归）
 */
export const HARD_MAX_CLONE_DEPTH = 1000

/**
 * 同步递归克隆的有效深度上限：调用方选项与栈安全硬上限取小
 *
 * 异步队列本身不递归、不受该上限约束（仅其 Map 键子树经 cloneDeep 时同样受保护）
 */
export function syncDepthLimit(requestedMaxDepth: number): number {
  // 用 `<` 而不是 Math.min：NaN / Infinity 一并落到硬上限——`depth > NaN` 恒为 false，
  // Math.min(NaN, 上限) 也是 NaN，那等于取消一切上限，本函数要堵的「溢出伪装成某属性的
  // cloneError」就回来了。负值仍原样返回：调用方要的就是「根节点即降级」，不该被抬高
  return requestedMaxDepth < HARD_MAX_CLONE_DEPTH ? requestedMaxDepth : HARD_MAX_CLONE_DEPTH
}

/**
 * 克隆前置公共判定（同步 cloneDeep / 异步 processNodeAsync 共用）：
 * 深度超限、节点计数、原语直返、循环引用检测与 onError 咨询。
 *
 * 深度上限由调用方以 `depthLimit` 显式传入而非在此读 options：两条路径的上限口径不同
 * （同步要叠加栈安全硬上限、异步不叠加），藏进选项就会让差异失去落点
 *
 * @returns `{ done: true, value }` 表示可直接返回该值；`{ done: false }` 表示需继续按类型克隆
 */
export function clonePrelude(
  value: unknown,
  context: CloneContext,
  depthLimit: number,
  options: Pick<Required<SnapshotOptions>, 'detectCircular' | 'onError'>,
  errors: SnapshotError[],
  stats: SnapshotStats,
  counters: { nodeCount: number; maxDepthReached: number; estimatedSize: number; hasCircular: boolean },
): { done: true; value: unknown } | { done: false } {
  // 检查最大深度
  if (context.depth > depthLimit) {
    stats.maxDepthHits++
    errors.push({
      type: 'maxDepth',
      message: `Maximum depth ${depthLimit} exceeded at ${context.path}`,
      path: context.path,
    })
    // 基本类型不可变，直接返回不影响隔离；对象若原样返回，
    // 后续对活状态的修改会穿透进快照，破坏快照隔离契约
    return { done: true, value: value !== null && typeof value === 'object' ? '[MaxDepth Exceeded]' : value }
  }

  counters.nodeCount++
  counters.estimatedSize += estimateNodeSize(value)
  counters.maxDepthReached = Math.max(counters.maxDepthReached, context.depth)

  // 原语与函数直返：null / string / number / boolean / symbol / bigint 不可变，共享无副作用。
  // 函数是唯一的例外取舍——typeof 为 'function' 而非 'object'，在此按引用放行：
  // 状态里挂回调/方法引用是常见用法，丢弃会让快照失去可调用性；这与全库统一口径一致
  // （见 core/utils/clone.ts「函数等不可克隆值保留原引用」）。代价是往快照中的函数挂属性
  // （fn.meta = …）会写到活状态上；函数属性不属于状态数据，不在快照隔离契约的覆盖范围内
  if (value === null || typeof value !== 'object') {
    return { done: true, value }
  }

  // 检测循环引用（始终启用，避免 detectCircular=false 时无限递归栈溢出）
  if (context.visited.has(value as object)) {
    counters.hasCircular = true
    stats.circularReferences++

    // detectCircular 只控制是否上报本条 circular 错误，检测本身始终生效；
    // 它同样不构成中止点：onError 拒绝继续时该位置写占位字符串并继续克隆，
    // 快照仍可按其它节点的降级结果交付（与 cloneError 的 SnapshotAbortError 分岔，
    // 理由见 types.ts 的 SnapshotOptions#onError）
    if (options.detectCircular) {
      const circularError: SnapshotError = {
        type: 'circular',
        message: `Circular reference detected at ${context.path}`,
        path: context.path,
      }
      // 先落账再咨询：errors 是「本次快照遇到了什么」的完整账本，
      // 只交给回调而不入账会让 result.errors 里看不到循环引用，
      // 而 stats.circularReferences 与 metadata.hasCircular 已经在报它
      errors.push(circularError)
      const shouldContinue = options.onError(circularError, {
        path: context.path,
        depth: context.depth,
        value,
      })

      if (!shouldContinue) {
        return { done: true, value: '[Circular Reference]' }
      }
    }

    return { done: true, value: context.visited.get(value as object) }
  }

  return { done: false }
}

/**
 * 克隆源对象的一个自有键并写入克隆品（对象分支与数组的附加键补趟共用）。
 *
 * 三条口径都在这一处：
 * - 访问器属性以描述符里捕获的 getter 求值，落成数据属性（回读 `value[key]` 在 Proxy 上
 *   会重跑 `get` 陷阱，取值可与刚拿到的描述符不是同一件事）；
 * - 标志位经 {@link normalizeDescriptorFlags} 归一化；
 * - 子值被丢弃（{@link SKIP_CLONE_NODE}）时该位置不写入，与异步路径 processQueue 删除
 *   prop 占位同语义；本键范围内的抛错按 `cloneError` 落账并咨询 onError，不外溢成整棵子树丢失。
 */
function copyOwnKey(
  value: object,
  cloned: object,
  key: string,
  context: CloneContext,
  options: Required<SnapshotOptions>,
  errors: SnapshotError[],
  stats: SnapshotStats,
  counters: { nodeCount: number; maxDepthReached: number; estimatedSize: number; hasCircular: boolean },
): void {
  let descriptor: PropertyDescriptor | undefined
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) {
      return
    }

    // 访问器属性（getter/setter）：descriptor.value 恒为 undefined，
    // 直接取值会静默丢失数据——以 getter 求值结果克隆为数据属性
    // （getter 抛错由下方 catch 走 onError 路径）
    //
    // 只有 setter 的访问器无值可读，落为 undefined，并经 normalizeDescriptorFlags
    // 还原成可写数据属性—— setter 本身不进快照（克隆品与活状态隔离，写回原对象既不可能也不应发生）
    const isAccessor = descriptor.get !== undefined || descriptor.set !== undefined
    const sourceValue = isAccessor ? (descriptor.get ? descriptor.get.call(value) : undefined) : descriptor.value

    const clonedValue = cloneDeep(
      sourceValue,
      {
        ...context,
        path: `${context.path}.${key}`,
        depth: context.depth + 1,
        parent: value,
        key,
      },
      options,
      errors,
      stats,
      counters,
    )

    if (clonedValue === SKIP_CLONE_NODE) {
      return
    }

    // defineProperty 而非赋值：`cloned.__proto__ = …` 走 [[Set]] 会触发 Object.prototype 的
    // __proto__ setter，键被丢弃且克隆品原型被换掉；定义自有数据属性才承载得住这个键名
    Object.defineProperty(cloned, key, {
      value: clonedValue,
      ...normalizeDescriptorFlags(descriptor, isAccessor),
    })
  } catch (error) {
    // 中止信号在 handleCloneError 内原样上抛：这是用户在更深层做出的决定，
    // 二次咨询 onError 会把「中止」被中途改答降级为静默丢子树且快照仍标记成功
    handleCloneError(
      error,
      {
        path: `${context.path}.${key}`,
        depth: context.depth,
        // 描述符可用时直接取 value：访问器描述符没有 value 字段、恒为 undefined，
        // 故无需再区分描述符种类；访问器 getter 已证明会抛错，不经 safeReadProperty
        // 二次触发；仅当描述符不可得（查询本身抛错）时才兜底读取
        value: descriptor ? descriptor.value : safeReadProperty(value as Record<string, unknown>, key),
      },
      options,
      errors,
      stats,
    )
  }
}

/**
 * 深度克隆（递归实现）
 *
 * 每遇到一个子容器就递归调用自身，故调用栈深度 = 数据深度。上限由
 * `syncDepthLimit(options.maxDepth)` 给出：它把调用方的 maxDepth 与栈安全硬上限
 * （HARD_MAX_CLONE_DEPTH）取小，超限处按 maxDepth 降级返回占位值。
 * 让硬上限参与判定而不是只信选项，是因为溢出（RangeError: Maximum call stack size
 * exceeded）总在递归深处的**任意一帧**落下，会被恰好包住它的那个属性 try 归因成一条
 * 该属性路径的 cloneError，快照因此静默截断且 success 被判 false——即「栈问题伪装成
 * 节点克隆失败」。需要处理超深结构时走异步路径
 * （clone-async：容器子值入队而非递归，单节点工作量与栈深度都无上限）。
 */
export function cloneDeep<T>(
  value: T,
  context: CloneContext,
  options: Required<SnapshotOptions>,
  errors: SnapshotError[],
  stats: SnapshotStats,
  counters: {
    nodeCount: number
    maxDepthReached: number
    estimatedSize: number
    hasCircular: boolean
  },
): unknown {
  // 前置公共判定（深度 / 计数器 / 原语 / 循环引用）：与异步克隆路径共用，
  // 差别只在同步路径要叠加栈安全硬上限
  const prelude = clonePrelude(value, context, syncDepthLimit(options.maxDepth), options, errors, stats, counters)
  if (prelude.done) {
    return prelude.value
  }
  // 前置判定已排除 null 与非对象；此处显式收窄，供后续 Object.keys / getPrototypeOf 使用
  /* istanbul ignore next -- clonePrelude 已对 null/非对象返回，此处仅为类型收窄 */
  if (value === null || typeof value !== 'object') {
    return value
  }

  // 自定义克隆（与异步路径共用 invokeCustomCloner，保证抛错语义与账本口径一致）
  const custom = invokeCustomCloner(value, context, options, errors, stats)
  if (custom.kind === 'value') {
    return custom.value
  }
  if (custom.kind === 'skip') {
    return SKIP_CLONE_NODE
  }

  // 类型判定与容器外壳构造纳入同一个 try（与异步路径 clone-async 的同名保护同口径）：
  // `value instanceof Date/RegExp/Map/Set` 与 Object.getPrototypeOf 都走 [[GetPrototypeOf]]，
  // Proxy 的 getPrototypeOf 陷阱抛错时这些探针会直接冲出 cloneDeep —— 顶层调用不会被记为
  // cloneError（只落到 SnapshotManager 的 unknown@root），嵌套时更被父级 catch 归因到父路径，
  // 路径信息失真。纳入本 try 后回到统一契约：落账 cloneError（path 为本节点）→ 咨询 onError
  // → 继续则丢该节点
  let objectShell: Record<string, unknown>
  try {
    // 与 core 的 deepCloneState 合流的三道门槛（缺一就会「同一份 state 在 deepCloneState
    // 与 createSnapshot 下口径分叉」）：
    // 1) 状态住在内部槽位的内建值一律保留原引用——重建出来的空壳 instanceof 仍为真，
    //    但 await / Number() / 交给宿主 API 的第一次消费就抛 TypeError，且 diff 侧两副
    //    空壳原型相同、Object.keys 同为空，恒报「无差异」；
    // 2) 内建容器只重建「恰好是该类型本身」的实例，子类保留原引用——`new Map()` 式的
    //    重建会丢掉子类的构造参数、自有字段与子类方法（`m.first()` 直接 TypeError）；
    // 3) 类实例仍按下方通用分支重建（快照的既有契约：类实例快照后仍是该类实例）。
    // 异步引擎 clone-async.ts 是同一段代码的第二份，三条要一起改。
    if (isSlotBearingBuiltin(value)) {
      return value
    }

    // 处理特殊类型
    // Date/RegExp 同样产出了一个新对象，故与下面的容器分支一样计一次克隆操作：
    // 只在容器处累加会让 stats.cloneOperations 按 Date/RegExp 节点数系统性偏小
    // （异步路径 clone-async 同口径，两条路径不要各自改）
    if (value instanceof Date) {
      if (!isExactly(value, Date.prototype)) return value
      stats.cloneOperations++
      return new Date(value.getTime())
    }

    if (value instanceof RegExp) {
      if (!isExactly(value, RegExp.prototype)) return value
      stats.cloneOperations++
      return new RegExp(value.source, value.flags)
    }

    if (value instanceof Map) {
      if (!isExactly(value, Map.prototype)) return value
      const cloned = new Map()
      context.visited.set(value as object, cloned)

      for (const [k, v] of value) {
        const clonedKey = cloneDeep(
          k,
          {
            ...context,
            // 键身份入路径：只写 `.key` 时同一 Map 的多个键失败会在 errors[] 里
            // 留下完全相同的路径，无法定位到条目（与下方值分支同一写法）
            path: `${context.path}.key[${String(k)}]`,
            depth: context.depth + 1,
          },
          options,
          errors,
          stats,
          counters,
        )

        // 键被丢弃时整条 entry 无法安全 set：语义上与「跳过该位置」一致
        if (clonedKey === SKIP_CLONE_NODE) {
          continue
        }

        const clonedValue = cloneDeep(
          v,
          {
            ...context,
            // String(k) 而非模板插值 Symbol 键：ToString(Symbol) 会抛 TypeError，
            // 让含 Symbol 键的 Map 克隆直接失败并越过 onError 降级契约
            path: `${context.path}[${String(k)}]`,
            depth: context.depth + 1,
          },
          options,
          errors,
          stats,
          counters,
        )

        if (clonedValue === SKIP_CLONE_NODE) {
          continue
        }

        cloned.set(clonedKey, clonedValue)
      }

      stats.cloneOperations++
      return cloned
    }

    if (value instanceof Set) {
      if (!isExactly(value, Set.prototype)) return value
      const cloned = new Set()
      context.visited.set(value as object, cloned)

      let index = 0
      for (const item of value) {
        const clonedItem = cloneDeep(
          item,
          {
            ...context,
            path: `${context.path}[${index}]`,
            depth: context.depth + 1,
          },
          options,
          errors,
          stats,
          counters,
        )
        if (clonedItem !== SKIP_CLONE_NODE) {
          cloned.add(clonedItem)
        }
        index++
      }

      stats.cloneOperations++
      return cloned
    }

    // 处理数组
    if (Array.isArray(value)) {
      if (!isExactly(value, Array.prototype)) return value
      const cloned: unknown[] = []
      context.visited.set(value as object, cloned)

      // 逐索引赋值：源数组的洞在此落成真实的 undefined 元素，元素描述符也不还原。
      // 与异步路径同口径，改动理由与代价见 clone-async 的数组分支注释（两条路径要改一起改）
      for (let i = 0; i < value.length; i++) {
        const clonedItem = cloneDeep(
          value[i],
          {
            ...context,
            path: `${context.path}[${i}]`,
            depth: context.depth + 1,
            parent: value,
            key: i,
          },
          options,
          errors,
          stats,
          counters,
        )
        // 被丢弃的元素保留位置（留洞），与异步路径不填充该索引同语义
        if (clonedItem !== SKIP_CLONE_NODE) {
          cloned[i] = clonedItem
        }
      }

      // 补一趟非下标的自有键（`arr.meta = 'v2'`、`arr.version = 3`）：只按下标克隆会让这类键
      // 整体丢失，而它们正是 deepEqual 数组分支比对的键集（length + Object.keys），后果是
      // 「副本与源恒不等」——把快照喂选择器缓存就是持续失配，回滚/回放则少字段；下方对象分支
      // 那句「仅复制自有可枚举属性」的口径本就涵盖这类键，数组分支却只按下标走，两边自相矛盾。
      // 判据与
      // core/utils/clone.ts 的 deepCloneState 合流（那边 R5-189 补的就是这一趟）。
      // 'length' 必须排除：它是每个数组的自有键，且**不可配置**——在克隆品上重新定义它会
      // 直接抛 TypeError。键集口径与对象分支一致（includeNonEnumerable 决定取哪一套键）；
      // 取键本身抛错（Proxy 的 ownKeys 陷阱）由包住本分支的外层 try 收尾，与对象分支的
      // keys catch 同样落到「丢该节点」。异步引擎 clone-async.ts 的数组分支是同一段代码的
      // 第二份，这一趟要一并补上（见 .ocr-fix/verdicts6/f2-13.md 的 NEEDS-MAIN）
      const extraKeys = (options.includeNonEnumerable ? Object.getOwnPropertyNames(value) : Object.keys(value)).filter(
        (key) => key !== 'length' && !isIndexKey(key),
      )
      for (const key of extraKeys) {
        copyOwnKey(value as object, cloned, key, context, options, errors, stats, counters)
      }

      stats.cloneOperations++
      return cloned
    }

    // 处理普通对象
    // 保留源对象原型：类实例快照后仍是该类实例（方法/继承链可用），
    // 仅复制自有可枚举属性，不触发任何构造器或 getter
    objectShell = Object.create(Object.getPrototypeOf(value) as object | null) as Record<string, unknown>
    context.visited.set(value as object, objectShell)
  } catch (error) {
    // 中止信号在 handleCloneError 内原样上抛：父级克隆已就「是否继续」做过决定，
    // 在此二次咨询 onError 会把「中止」降级为丢子树且快照仍标记成功
    dropFailedNode(value, context, error, options, errors, stats)
    return SKIP_CLONE_NODE
  }

  const cloned = objectShell

  // keys 计算纳入 try：Proxy 的 ownKeys/getOwnPropertyDescriptor 陷阱抛错时
  // 走 onError 降级，而非冲出整个快照
  let keys: string[]
  try {
    keys = options.includeNonEnumerable ? Object.getOwnPropertyNames(value) : Object.keys(value)
  } catch (error) {
    // 中止信号在 handleCloneError 内原样上抛：这是用户在更深层做出的决定，
    // 二次咨询 onError 会把「中止」被中途改答降级为静默丢子树且快照仍标记成功
    //
    // 与本节点外壳构造失败走同一条收尾（丢节点 + 从 visited 除名）：返回那副还没写入
    // 任何属性的壳等于把一个源数据里不存在的 `{}` 交进快照，而所有其它失败路径都是
    // 「该位置不出现」——两种形状对下游 diff / 序列化的结论并不相同
    dropFailedNode(value, context, error, options, errors, stats)
    return SKIP_CLONE_NODE
  }

  for (const key of keys) {
    // 单键的取描述符 / 求访问器值 / 深克隆子值 / 还原标志位 / 失败落账都在 copyOwnKey 一处，
    // 与数组的附加键补趟共用同一份判据（数组分支那条注释里写清了为什么要走同一套）
    copyOwnKey(value as object, cloned, key, context, options, errors, stats, counters)
  }

  stats.cloneOperations++
  return cloned
}
