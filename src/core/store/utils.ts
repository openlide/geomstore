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
 * 反向要求：读 `process.env.NODE_ENV` 时**不得**再加 `typeof process !== 'undefined'`
 * 门控（tests/unit/store/modules/utils.test.ts 锁定了函数体不含该门控）。
 * 打包器（webpack DefinePlugin / esbuild --define）只把这个成员表达式内联成字符串字面量，
 * 不会内联 `process` 全局本身；浏览器/小程序产物通常没有 process 垫片，届时 && 左侧恒为
 * false，已内联好的 "production" 被短路丢弃，判定退回 __DEV__ → 开发兜底，生产构建被识别
 * 成开发模式——StateProxy._handleIllegalMutation 在 isProduction() === false 时无条件 throw，
 * 直写状态由 warn/silent 变成崩溃点。真没有 process 时属性访问抛 ReferenceError，
 * 由下方 try/catch 吞掉并回退 __DEV__ 分支，不会外溢。
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
    // 这里刻意不做 process 全局存在性门控，理由见函数文档末段
    const nodeEnv = process.env.NODE_ENV
    if (nodeEnv) {
      cachedProductionState = nodeEnv === 'production'
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
 * 只冻结纯对象与数组。跳过内建对象的原因不是「怕改动被共享」，而是 Object.freeze
 * 根本拦不住它们：Date/RegExp/Map/Set 的 mutator（setTime / set / add / lastIndex）
 * 走内部槽位而非 [[Set]] 陷阱，冻结后照样能改，冻了等于没冻。
 * 循环引用用 WeakSet 守卫避免重复冻结枝；冻结失败（如 sealed 对象）不拖垮快照。
 *
 * @remarks **部分冻结**：返回值只在「纯对象与数组」这条链上是深度只读的。
 * 经 Date/RegExp/Map/Set 或非纯对象（class 实例/Promise/WeakMap…）触达的节点
 * 一律保持可变，`Readonly<S>` 因此只是类型层面的承诺，调用方不得据此认为
 * $snapshot() 的返回值整体深度不可变——要真不可变需自行再处理这些节点。
 *
 * 键的范围同样有界：只遍历自有**可枚举字符串键**（数组按下标），因此
 * symbol 键（如 `Symbol.for('geomstore.stateVersion')`）、非可枚举自有属性、
 * 数组上的非下标自有属性指向的子对象都不在冻结范围内（它们自身随父对象
 * 的 Object.freeze 变为不可写，但其值仍是活对象）。这不是遗漏而是与下一条
 * 不变量配套：这类键 deepCloneState 根本不会复制进快照，冻结它们等于
 * 经快照去改活状态。要按 `Reflect.ownKeys` 的口径全量冻结，请自行实现。
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
  // 非纯对象整体跳过，两条理由各自成立、不可合并成一句「共享引用」：
  // 1) class 实例 / Promise / WeakMap 等：deepCloneState 走「保留原引用」降级路径，
  //    副本与活状态共享同一实例。此前虽不冻结自身、却仍递归冻结其可枚举成员，
  //    等于经共享引用冻结了活状态——$snapshot() 之后 action 内写入这些成员会抛
  //    TypeError（生产 warn/silent 下静默丢写）。
  // 2) Date / RegExp / Map / Set：deepCloneState **会**新建实例（不与活状态共享），
  //    跳过它们的原因不是别名，而是 Object.freeze 拦不住内部槽位上的 mutator
  //    （map.set / date.setTime / 改 re.lastIndex 都不走 [[Set]] 陷阱），冻结只是装饰。
  //    这四类的自有可枚举键一般为空，所以「跳过」与原先的「递归零次 + 不冻结」等价，
  //    挂了扩展属性的 Date、Map/Set 子类的自有字段是例外——它们一并留为可变，
  //    见函数文档的「部分冻结」口径
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
    // JSON.stringify 对 undefined / 函数 / Symbol 不抛错而是返回 undefined，
    // 直接赋值会让消息渲染成 "Attempted value: undefined"，排查时无法区分
    // 「写入的就是 undefined」与「写入了函数/Symbol」。声明类型 string 是 @types 的
    // 简化，运行期确有空值，故先按真实返回类型收口再回退 String()
    const json = JSON.stringify(value) as string | undefined
    serialized = json ?? String(value)
  } catch {
    // String() 不是全函数：它会走 Symbol.toPrimitive / toString / valueOf，
    // 这些钩子自身可以抛（实测 `String(new Proxy(fn, {get(t){ if (t===Symbol.toPrimitive) throw new TypeError() }}))`
    // → "Cannot convert object to primitive value"）。此处再抛就会把 warn/silent
    // 的「放行不抛」契约变成崩溃点，故最后一道兜底只用 typeof 拼串（typeof 不会抛）
    try {
      serialized = String(value)
    } catch {
      serialized = `<unserializable ${typeof value}>`
    }
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
