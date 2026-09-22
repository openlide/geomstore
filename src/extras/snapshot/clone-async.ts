/**
 * GeomStore - 快照异步克隆引擎
 *
 * 自 SnapshotManager.ts 拆出：异步模式单节点克隆。
 * 只克隆当前节点的容器外壳与叶子字段，对象子值经 enqueue 入队异步填充；
 * 相比同步递归，每个节点的工作量有界，大对象不会阻塞主线程。
 * 该有界性有一处例外：Map 的键子树为保插入序按同步递归克隆（见 processNodeAsync 的
 * Map 分支），重键结构会把阻塞搬回当前批。
 *
 * 本模块为纯函数（不依赖管理器实例状态），由 SnapshotManager.createSnapshotAsync
 * 的队列驱动逐个调用。
 *
 * @module SnapshotManager/clone-async
 */

import type { AsyncSnapshotOptions, CloneContext, SnapshotError, SnapshotStats } from './types.js'
import {
  SKIP_CLONE_NODE,
  cloneDeep,
  clonePrelude,
  dropFailedNode,
  handleCloneError,
  invokeCustomCloner,
  normalizeDescriptorFlags,
  safeReadProperty,
} from './clone.js'

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

  // 前置公共判定（深度 / 计数器 / 原语 / 循环引用）：与同步克隆路径共用。
  // 深度上限直接取 options.maxDepth：本引擎按队列逐节点处理、栈深度与数据深度无关，
  // 故不叠加同步路径的栈安全硬上限（超深结构正是该引擎存在的理由）
  const prelude = clonePrelude(value, context, options.maxDepth, options, errors, stats, counters)
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
    // 处理特殊类型（与同步路径同口径：Date/RegExp 产出了新对象，计一次克隆操作）
    if (value instanceof Date) {
      stats.cloneOperations++
      return new Date(value.getTime())
    }

    if (value instanceof RegExp) {
      stats.cloneOperations++
      return new RegExp(value.source, value.flags)
    }

    if (value instanceof Map) {
      const cloned = new Map()
      context.visited.set(value as object, cloned)

      for (const [k, v] of value) {
        // Map 键需要克隆完成后才能 set，且对象键罕见，故同步克隆键（键一律入队的话，
        // entry 要等键与值都就绪才能写，Map 的插入序随之失真——迭代序是 Map 语义的一部分）。
        // 代价是「每个节点的工作量有界」只对**值**成立、对**键**不成立：本行的 cloneDeep 是
        // 同步递归，以大型对象为键（或以 Map 为键的链式 Map）时会一次性克隆整棵键子树、
        // 阻塞当前批。把大对象放在**值**的位置（值全部入队），必要时用 customCloner
        // 提前接管重键节点，让它在本引擎之外产出克隆
        const clonedKey = cloneDeep(
          k,
          {
            ...context,
            // 键身份入路径：只写 `.key` 时同一 Map 的多个键失败会在 errors[] 里
            // 留下完全相同的路径，无法定位到条目（与同步路径 clone.ts 同口径）
            path: `${context.path}.key[${String(k)}]`,
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

      // 稀疏数组口径（与同步路径 clone.ts 的数组分支同语义，两条路径不要各自改）：
      // 逐索引赋值会让源数组的「洞」（`[1, , 3]` 的索引 1）在克隆里落成真实的
      // `undefined` 自有属性，故 `i in clone` / `Object.keys(clone)` 比源多出键；
      // 元素自己的描述符标志同样不还原（index 目标只带位置，不像 prop 目标可携带 descriptor）。
      // 之所以按现状保留：克隆产物主要供 diff / 序列化消费，而 JSON 与 forEach/for-of 都把
      // 洞读成 undefined，两种形状在使用侧等价；要真正保洞需两条路径同步改成
      // hasOwnProperty 判定 + 显式写 length（否则尾部洞会缩短克隆：cloned 的长度只由实际
      // 写到的最大索引决定），并顺带决定元素描述符是否还原——超出 low 波次，需要时另开一条改动
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
    dropFailedNode(value, context, error, options, errors, stats)
    return SKIP_CLONE_NODE
  }

  const cloned = objectShell

  // keys 计算纳入 try（与同步路径同语义：按本节点落 cloneError 并咨询 onError，中止信号原样上抛）。
  // 收尾同样是「丢节点」而不是交出空壳：外壳此刻已登记进 visited，交出它等于在交付的 data 里
  // 留下源数据中不存在的 `{}`，且同一源对象的后续引用会命中登记、静默复用这副没有属性的壳。
  // 本分支不会有子任务悬在半路——对象子值的 enqueue 发生在下方的属性循环里
  let keys: string[]
  try {
    keys = options.includeNonEnumerable ? Object.getOwnPropertyNames(value) : Object.keys(value)
  } catch (error) {
    dropFailedNode(value, context, error, options, errors, stats)
    return SKIP_CLONE_NODE
  }

  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) {
        continue
      }

      // 访问器属性：以 getter 求值结果克隆为数据属性（与同步路径同语义）。
      // 调用描述符里捕获的 getter 而非回读 `value[key]`——后者在 Proxy 上会重跑 `get`
      // 陷阱，取值可与刚拿到的描述符不是同一件事；只有 setter 的访问器无值可读，
      // 落为 undefined 并还原成可写数据属性（理由见 clone.ts 的属性循环注释）
      const isAccessor = descriptor.get !== undefined || descriptor.set !== undefined
      const sourceValue = isAccessor ? (descriptor.get ? descriptor.get.call(value) : undefined) : descriptor.value
      // 与同步路径共用同一归一化口径（见 clone.ts 的 normalizeDescriptorFlags）：
      // 此前异步用 `=== true`、同步传原始值，同一份数据在两条路径会产出不同描述符。
      // 三个标志一律从这一个对象取（含下方的原语分支）——直接从 descriptor 读会把
      // 刚归一化的结果又绕开，重新造出两套方言
      const descriptorFlags = normalizeDescriptorFlags(descriptor, isAccessor)

      if (sourceValue !== null && typeof sourceValue === 'object') {
        // 占位属性必须可写可配置：源属性可能不可写，占位若继承该标志，
        // 严格模式下的填充赋值会抛 TypeError 中断整个队列；
        // 源描述符随任务携带，填充时经 defineProperty 还原真实标志
        Object.defineProperty(cloned, key, {
          value: undefined,
          writable: true,
          enumerable: descriptorFlags.enumerable,
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
              writable: descriptorFlags.writable,
              enumerable: descriptorFlags.enumerable,
              configurable: descriptorFlags.configurable,
            },
          },
        })
      } else {
        Object.defineProperty(cloned, key, {
          value: sourceValue,
          ...descriptorFlags,
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
