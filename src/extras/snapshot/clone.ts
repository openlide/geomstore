/**
 * GeomStore - 快照同步克隆引擎
 *
 * 自 SnapshotManager.ts 拆出：迭代式深度克隆及其前置公共判定。
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
 * 1. **抛错语义**：克隆器抛错时统一落账 cloneError、咨询 onError；继续则返回 `skip`，
 *    中止则抛 SnapshotAbortError（不再让原始异常直接冲出克隆过程、绕过降级契约）。
 * 2. **账本口径**：`stats.cloneOperations` 与 errors 的累加位置唯一。
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
    stats.cloneOperations++
    // 错误必须落账：静默丢弃会让隔离降级对调用方不可见
    const snapshotError = makeCloneError(context.path, error)
    errors.push(snapshotError)
    const shouldContinue = options.onError(snapshotError, {
      path: context.path,
      depth: context.depth,
      value,
      recoverable: true,
    })
    if (!shouldContinue) {
      throw new SnapshotAbortError(error)
    }
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

  // 基本类型直接返回
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
 * 深度克隆（迭代实现）
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
  const cloned: Record<string, unknown> = Object.create(Object.getPrototypeOf(value) as object | null) as Record<string, unknown>
  context.visited.set(value as object, cloned)

  // keys 计算纳入 try：Proxy 的 ownKeys/getOwnPropertyDescriptor 陷阱抛错时
  // 走 onError 降级，而非冲出整个快照
  let keys: string[]
  try {
    keys = options.includeNonEnumerable ? Object.getOwnPropertyNames(value) : Object.keys(value)
  } catch (error) {
    // 中止信号直接上抛：这是用户在更深层做出的决定，二次咨询 onError
    // 会把「中止」被中途改答降级为静默丢子树且快照仍标记成功
    if (error instanceof SnapshotAbortError) {
      throw error
    }
    stats.cloneOperations++
    // 错误必须落账：静默丢弃会让克隆降级对调用方不可见（与异步路径同口径）
    const snapshotError = makeCloneError(context.path, error)
    errors.push(snapshotError)
    const shouldContinue = options.onError(snapshotError, { path: context.path, depth: context.depth, value, recoverable: true })
    if (!shouldContinue) {
      throw new SnapshotAbortError(error)
    }
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
      // 中止信号直接上抛（见上方 keys catch 的说明）
      if (error instanceof SnapshotAbortError) {
        throw error
      }
      stats.cloneOperations++
      // 错误必须落账：静默丢弃会让克隆降级对调用方不可见（与异步路径同口径），
      // 也让 success 判定能识别 cloneError
      const snapshotError = makeCloneError(`${context.path}.${key}`, error)
      errors.push(snapshotError)
      const shouldContinue = options.onError(snapshotError, {
        path: `${context.path}.${key}`,
        depth: context.depth,
        // 描述符可用时直接取 value：访问器描述符没有 value 字段、恒为 undefined，
        // 与原「识别访问器后显式返回 undefined」等价，故无需再区分描述符种类；
        // 访问器 getter 已证明会抛错，不经 safeReadProperty 二次触发；
        // 仅当描述符不可得（查询本身抛错）时才兜底读取
        value: descriptor ? descriptor.value : safeReadProperty(value as Record<string, unknown>, key),
        recoverable: true,
      })

      if (!shouldContinue) {
        throw new SnapshotAbortError(error)
      }
    }
  }

  stats.cloneOperations++
  return cloned
}
