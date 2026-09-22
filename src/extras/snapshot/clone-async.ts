/**
 * GeomStore - 快照异步克隆引擎
 *
 * 自 SnapshotManager.ts 拆出：异步模式单节点克隆。
 * 只克隆当前节点的容器外壳与叶子字段，对象子值经 enqueue 入队异步填充；
 * 相比同步递归，每个节点的工作量有界，大对象不会阻塞主线程。
 *
 * 本模块为纯函数（不依赖管理器实例状态），由 SnapshotManager.createSnapshotAsync
 * 的队列驱动逐个调用。
 *
 * @module SnapshotManager/clone-async
 */

import type { AsyncSnapshotOptions, CloneContext, SnapshotError, SnapshotStats } from './types.js'
import { SKIP_CLONE_NODE, cloneDeep, clonePrelude, handleCloneError, invokeCustomCloner, normalizeDescriptorFlags, safeReadProperty } from './clone.js'

/**
 * 异步克隆任务
 *
 * 每个任务表示需要克隆的单个节点；target 存在时，
 * 克隆结果填充到父容器对应位置（根任务无 target，作为整体结果返回）
 */
export interface AsyncCloneTask {
  /** 待克隆的值 */
  value: unknown
  /** 克隆上下文 */
  context: CloneContext
  /** 父容器填充目标 */
  target?: {
    kind: 'prop' | 'index' | 'mapValue' | 'setItem'
    container: Record<string, unknown> | unknown[] | Map<unknown, unknown> | Set<unknown>
    /** 填充位置（prop/index 为 key/index，mapValue 为克隆后的键，可为任意类型） */
    key?: unknown
    /** 源属性描述符（仅 prop）：填充时经 defineProperty 还原 writable/enumerable/configurable */
    descriptor?: { writable: boolean; enumerable: boolean; configurable: boolean }
  }
}

/**
 * 异步模式单节点克隆
 *
 * @returns 该节点的克隆结果；`SKIP_CLONE_NODE` 表示按 onError 语义丢弃该节点
 */
export function processNodeAsync(
  task: AsyncCloneTask,
  options: Required<AsyncSnapshotOptions>,
  errors: SnapshotError[],
  stats: SnapshotStats,
  counters: {
    nodeCount: number
    maxDepthReached: number
    estimatedSize: number
    hasCircular: boolean
  },
  enqueue: (task: AsyncCloneTask) => void,
): unknown {
  const { value, context } = task

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

  // 自定义克隆：与同步路径共用 invokeCustomCloner，保证「抛错 → 落账 cloneError →
  // 咨询 onError → 继续则丢子树（返回哨兵，禁止把原值兜底进快照）/ 中止则传播」两侧一致
  const custom = invokeCustomCloner(value, context, options, errors, stats)
  if (custom.kind === 'value') {
    return custom.value
  }
  if (custom.kind === 'skip') {
    return SKIP_CLONE_NODE
  }

  // 类型判定与容器外壳构造同样纳入 try（理由见 catch 前注释）。
  // 本区间只产出「该节点的外壳 + 待填充的子任务」，任何抛错都属于本节点克隆失败，
  // 与下方 keys / 属性循环走同一口径：落账 cloneError → 咨询 onError → 继续则丢子树。
  // objectShell 由 try 末尾赋值后交给属性循环使用
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
        // Map 键需要克隆完成后才能 set，且对象键罕见，同步克隆键
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

        // 键被丢弃（自定义克隆器抛错且 onError 允许继续）时整条 entry 跳过：
        // 把哨兵当键写入 Map 会让内部标记泄漏进用户数据
        if (clonedKey === SKIP_CLONE_NODE) {
          continue
        }

        // 所有值统一入队：原始值立即 set、对象值延后填充会打乱 Map 迭代序
        // （迭代序以 set 插入顺序为准，是 Map 语义的一部分）
        enqueue({
          value: v,
          context: {
            ...context,
            path: `${context.path}[${String(k)}]`,
            depth: context.depth + 1,
            parent: value,
            key: k,
          },
          target: { kind: 'mapValue', container: cloned, key: clonedKey },
        })
      }

      stats.cloneOperations++
      return cloned
    }

    if (value instanceof Set) {
      const cloned = new Set()
      context.visited.set(value as object, cloned)

      let index = 0
      for (const item of value) {
        // 所有条目统一入队：原始值立即 add、对象值延后填充会打乱 Set 迭代序
        enqueue({
          value: item,
          context: {
            ...context,
            path: `${context.path}[${index}]`,
            depth: context.depth + 1,
            parent: value,
            key: index,
          },
          target: { kind: 'setItem', container: cloned },
        })
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
        const item = value[i]
        if (item !== null && typeof item === 'object') {
          enqueue({
            value: item,
            context: {
              ...context,
              path: `${context.path}[${i}]`,
              depth: context.depth + 1,
              parent: value,
              key: i,
            },
            target: { kind: 'index', container: cloned, key: i },
          })
        } else {
          cloned[i] = item
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
    // 本区间的抛错此前会绕过 errors[] + options.onError：Proxy 包装的值上，
    // instanceof 走 getPrototypeOf 陷阱、Date/RegExp/Map/Set 的内建方法在代理接收者上
    // 抛 TypeError（"incompatible receiver"）、getOwnPropertyDescriptor 陷阱可返回非法值。
    // 让它们直达驱动层只会留下一条路径含糊的 cloneError 并剥夺调用方的降级决定权
    handleCloneError(error, { path: context.path, depth: context.depth, value }, options, errors, stats)
    return SKIP_CLONE_NODE
  }

  const cloned = objectShell

  // keys 计算纳入 try（与同步路径同语义：共用 handleCloneError，中止信号原样上抛）
  let keys: string[]
  try {
    keys = options.includeNonEnumerable ? Object.getOwnPropertyNames(value) : Object.keys(value)
  } catch (error) {
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

      // 访问器属性：以 getter 求值结果克隆为数据属性（与同步路径同语义）
      const isAccessor = descriptor.get !== undefined || descriptor.set !== undefined
      const sourceValue = isAccessor ? (descriptor.get ? (value as Record<string, unknown>)[key] : undefined) : descriptor.value
      // 与同步路径共用同一归一化口径（见 clone.ts 的 normalizeDescriptorFlags）：
      // 此前异步用 `=== true`、同步传原始值，同一份数据在两条路径会产出不同描述符
      const descriptorFlags = normalizeDescriptorFlags(descriptor, isAccessor)
      const targetWritable = descriptorFlags.writable

      if (sourceValue !== null && typeof sourceValue === 'object') {
        // 占位属性必须可写可配置：源属性可能不可写，占位若继承该标志，
        // 严格模式下的填充赋值会抛 TypeError 中断整个队列；
        // 源描述符随任务携带，填充时经 defineProperty 还原真实标志
        Object.defineProperty(cloned, key, {
          value: undefined,
          writable: true,
          enumerable: descriptor.enumerable,
          configurable: true,
        })

        enqueue({
          value: sourceValue,
          context: {
            ...context,
            path: `${context.path}.${key}`,
            depth: context.depth + 1,
            parent: value,
            key,
          },
          target: {
            kind: 'prop',
            container: cloned,
            key,
            descriptor: {
              writable: targetWritable,
              enumerable: descriptorFlags.enumerable,
              configurable: descriptorFlags.configurable,
            },
          },
        })
      } else {
        Object.defineProperty(cloned, key, {
          value: sourceValue,
          writable: targetWritable,
          enumerable: descriptor.enumerable,
          configurable: descriptor.configurable,
        })
      }
    } catch (error) {
      // 与同步路径共用 handleCloneError：中止信号原样上抛，其余按 cloneError 落账并咨询 onError
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
