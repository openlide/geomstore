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
 * cloneError 的统一降级 / 中止处理（同步三处 catch 与异步两处 catch 共用）。
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
    recoverable: true,
  })
  if (!shouldContinue) {
    throw new SnapshotAbortError(error)
  }
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
 * @param descriptor 源属性描述符
 * @param isAccessor 是否为访问器属性（访问器不还原 get/set，一律落为可写数据属性）
 */
export function normalizeDescriptorFlags(
  descriptor: PropertyDescriptor,
  isAccessor: boolean,
): { writable: boolean; enumerable: boolean; configurable: boolean } {
  return {
    writable: isAccessor ? true : Boolean(descriptor.writable),
    enumerable: Boolean(descriptor.enumerable),
    configurable: Boolean(descriptor.configurable),
  }
}

/**
 * 克隆前置公共判定（同步 cloneDeep / 异步 processNodeAsync 共用）：
 * maxDepth 超限、节点计数、原语直返、循环引用检测与 onError 咨询。
 *
 * @returns `{ done: true, value }` 表示可直接返回该值；`{ done: false }` 表示需继续按类型克隆
 */
export function clonePrelude(
  value: unknown,
  context: CloneContext,
  options: Pick<Required<SnapshotOptions>, 'maxDepth' | 'detectCircular' | 'onError'>,
  errors: SnapshotError[],
  stats: SnapshotStats,
  counters: { nodeCount: number; maxDepthReached: number; estimatedSize: number; hasCircular: boolean },
): { done: true; value: unknown } | { done: false } {
  // 检查最大深度
  if (context.depth > options.maxDepth) {
    stats.maxDepthHits++
    errors.push({
      type: 'maxDepth',
      message: `Maximum depth ${options.maxDepth} exceeded at ${context.path}`,
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

    // detectCircular 仅控制是否上报错误与是否可中断，检测本身始终生效
    if (options.detectCircular) {
      const shouldContinue = options.onError(
        {
          type: 'circular',
          message: `Circular reference detected at ${context.path}`,
          path: context.path,
        },
        {
          path: context.path,
          depth: context.depth,
          value,
          recoverable: true,
        },
      )

      if (!shouldContinue) {
        return { done: true, value: '[Circular Reference]' }
      }
    }

    return { done: true, value: context.visited.get(value as object) }
  }

  return { done: false }
}

/**
 * 深度克隆（递归实现）
 *
 * 每遇到一个子容器就递归调用自身，故调用栈深度 = 数据深度。层数由 maxDepth 界定
 * （clonePrelude 在超限处直接返回占位值），默认 100 层远低于引擎栈上限；
 * 但把 maxDepth 抬到数千以上时深链结构仍会 RangeError: Maximum call stack size exceeded——
 * 溢出点总在递归深处，只有恰好落在某个属性的 try 内才会被记成一条 cloneError，
 * 快照因此在该层被静默截断（实测 3000 层输入约在 2000 层断掉，success 为 false），
 * 而非按 onError 的降级意愿继续。需要处理超深结构时走异步路径
 * （clone-async：容器子值入队而非递归，单节点工作量有界）。
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
  // 前置公共判定（maxDepth / 计数器 / 原语 / 循环引用）：与异步克隆路径共用
  const prelude = clonePrelude(value, context, options, errors, stats, counters)
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
    // 处理特殊类型
    if (value instanceof Date) {
      return new Date(value.getTime())
    }

    if (value instanceof RegExp) {
      return new RegExp(value.source, value.flags)
    }

    if (value instanceof Map) {
      const cloned = new Map()
      context.visited.set(value as object, cloned)

      for (const [k, v] of value) {
        const clonedKey = cloneDeep(
          k,
          {
            ...context,
            path: `${context.path}.key`,
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
    handleCloneError(error, { path: context.path, depth: context.depth, value }, options, errors, stats)
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
    handleCloneError(error, { path: context.path, depth: context.depth, value }, options, errors, stats)
    return cloned
  }

  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) {
        continue
      }

      // 访问器属性（getter/setter）：descriptor.value 恒为 undefined，
      // 直接取值会静默丢失数据——以 getter 求值结果克隆为数据属性
      // （getter 抛错由下方 catch 走 onError 路径）
      const isAccessor = descriptor.get !== undefined || descriptor.set !== undefined
      const sourceValue = isAccessor ? (descriptor.get ? (value as Record<string, unknown>)[key] : undefined) : descriptor.value

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

      // 自定义克隆器在该属性上失败且 onError 允许继续：不写入该属性，
      // 与异步路径 processQueue 删除 prop 占位保持同一语义
      if (clonedValue === SKIP_CLONE_NODE) {
        continue
      }

      Object.defineProperty(cloned, key, {
        value: clonedValue,
        ...normalizeDescriptorFlags(descriptor, isAccessor),
      })
    } catch (error) {
      // 中止信号在 handleCloneError 内原样上抛（见上方 keys catch 的说明）
      handleCloneError(
        error,
        {
          path: `${context.path}.${key}`,
          depth: context.depth,
          // 描述符可用时直接取 value：访问器描述符没有 value 字段、恒为 undefined，
          // 与原「识别访问器后显式返回 undefined」等价，故无需再区分描述符种类；
          // 访问器 getter 已证明会抛错，不经 safeReadProperty 二次触发；
          // 仅当描述符不可得（查询本身抛错）时才兜底读取
          value: descriptor ? descriptor.value : safeReadProperty(value as Record<string, unknown>, key),
        },
        options,
        errors,
        stats,
      )
    }
  }

  stats.cloneOperations++
  return cloned
}
