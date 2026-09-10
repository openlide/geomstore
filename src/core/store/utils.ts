/**
 * Store 内部工具函数
 */

import { deepCloneState } from '../utils/clone.js'

/** 缓存的生产环境检测结果 */
let cachedProductionState: boolean | undefined

/**
 * 检测当前运行环境是否为生产模式
 *
 * 判定优先级（自高到低）：
 * 1. Node.js / 小程序构建期注入的 `process.env.NODE_ENV`（最可靠）
 * 2. 构建期 `__DEV__` 全局标志（需打包器 DefinePlugin 等做字符串替换才有效）
 * 3. 兜底为开发模式（非生产），保证保护机制默认开启
 *
 * 注意：`__DEV__` 是构建期常量，tsc 不会替换它，运行时若未定义，
 * 不能直接 `!__DEV__`（在未声明全局时会 ReferenceError，且语义会被误判为生产）。
 * 因此使用 `typeof __DEV__ !== 'undefined'` 做存在性检查。
 *
 * @returns {boolean} 如果当前处于生产环境则返回 true，否则返回 false
 */
export function isProduction(): boolean {
  // 使用缓存结果避免重复计算。
  // 注意：首次判定后结果在当前模块实例内永久缓存：
  // - 构建产物中 NODE_ENV / __DEV__ 均为构建期常量，运行时不会变化，缓存是安全的；
  // - 仅 HMR/运行时篡改环境变量场景下缓存会陈旧——这是有意为之的性能取舍
  //   （避免热路径重复检测），需要重新判定时应重新加载本模块。
  if (cachedProductionState !== undefined) {
    return cachedProductionState
  }

  // 1. 优先检查标准 Node.js 环境变量
  try {
    if (typeof process !== 'undefined' && process?.env?.NODE_ENV) {
      cachedProductionState = process.env.NODE_ENV === 'production'
      return cachedProductionState
    }
  } catch {
    // Ignore access errors in restricted environments
  }

  // 2. 回退到构建期 __DEV__ 全局标志（需打包器替换；此处做存在性检查）
  if (typeof __DEV__ !== 'undefined') {
    cachedProductionState = !__DEV__
    return cachedProductionState
  }

  // 3. 兜底：无法判定时按开发模式处理，确保状态保护默认开启
  cachedProductionState = false
  return cachedProductionState
}

/**
 * 递归冻结状态（用于 $snapshot 等对外暴露的只读副本）
 *
 * 仅冻结纯对象与数组（Date/RegExp/Map/Set 等内建对象的 mutator 方法
 * 不走 [[Set]] 陷阱，Object.freeze 无法阻止，冻结无意义故跳过）；
 * 循环引用用 WeakSet 守卫避免重复冻结枝；冻结失败（如 sealed 对象）不拖垮快照。
 *
 * 不变量：冻结范围必须 ⊆ deepCloneState 的隔离范围。
 * 非纯对象（class 实例/Promise/WeakMap 等）在 deepCloneState 中走「保留原引用」
 * 降级路径，副本与源共享同一实例，故整体跳过——详见下方分支注释。
 */
export function deepFreezeState<T>(value: T, seen?: WeakSet<object>): T {
  if (value === null || typeof value !== 'object') {
    return value
  }

  const visited = seen ?? new WeakSet<object>()
  if (visited.has(value as object)) {
    return value
  }
  visited.add(value as object)

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      deepFreezeState(value[i], visited)
    }
    try {
      Object.freeze(value)
    } catch {
      // 非可扩展对象冻结会抛错：跳过，不影响其余枝的冻结
    }
    return value
  }

  const proto = Object.getPrototypeOf(value as object)
  const isPlain = proto === Object.prototype || proto === null
  // 非纯对象整体跳过：deepCloneState 对它们保留原引用（不可安全克隆的降级路径），
  // 副本与活状态共享同一实例。此前虽不冻结自身、却仍递归冻结其可枚举成员，
  // 等于经共享引用冻结了活状态——$snapshot() 之后 action 内写入这些成员会抛
  // TypeError（生产 warn/silent 下静默丢写）。Date/RegExp/Map/Set 的自有可枚举键
  // 恒为空，跳过与原先「递归零次 + 不冻结」等价，行为不变
  if (!isPlain) {
    return value
  }

  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    deepFreezeState(record[key], visited)
  }
  try {
    Object.freeze(value)
  } catch {
    // 同上：冻结失败时保留可变引用，不拖垮快照
  }
  return value
}

/**
 * 创建状态直接变异的错误消息
 * @param path - 被修改的状态路径
 * @param value - 尝试设置的新值
 * @param operation - 执行的操作类型
 * @returns 格式化的错误消息字符串
 */
export function createMutationErrorMessage(path: string, value: unknown, operation: string): string {
  // BigInt / 循环引用等会让 stringify 抛 TypeError，掩盖真正的保护错误；
  // 生产 warn/silent 处理器依赖此函数不抛错（放行写入），必须兜底
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    serialized = String(value)
  }
  return (
    `[GeomStore] Direct mutation of state "${path}" is prohibited. Use setState() or $patch() methods instead.\n` +
    `Operation: ${operation}\n` +
    `Attempted value: ${serialized}`
  )
}

/**
 * 深拷贝状态
 *
 * 实现已迁移至 `core/utils/clone.ts`（消除 utils → store 层级倒置）。
 * 此处保留转发导出，兼容 `core/store` 内部既有导入路径（如 SubscriptionManager）。
 */
export { deepCloneState }
