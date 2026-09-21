/**
 * GeomStore - 快照类型定义
 *
 * 自 SnapshotManager.ts 拆出（纯类型，无运行期代码）。
 */

/**
 * 快照配置选项
 */
export interface SnapshotOptions {
  /** 最大递归深度 */
  maxDepth?: number
  /** 是否检测循环引用 */
  detectCircular?: boolean
  /** 是否包含不可枚举属性 */
  includeNonEnumerable?: boolean
  /**
   * 自定义克隆函数：命中该节点时返回其克隆结果。
   *
   * 「已处理 / 交回默认克隆」的契约以**返回值与抛错**表达，而非返回类型（返回 undefined
   * 同样落在 `unknown` 内）：
   * - 返回 `undefined`：视为未命中，按 Date/RegExp/Map/Set/数组/对象的默认规则继续克隆；
   * - 返回其他值：作为该节点的克隆结果直接使用；
   * - 抛错：落账一条 `cloneError` 并咨询 {@link SnapshotOptions#onError}——
   *   返回 true 则丢弃该节点（**不会**把活引用兜底进快照），返回 false 则整个快照以
   *   SnapshotAbortError 中止、交付失败结果。
   */
  customCloner?: (value: unknown, context: CloneContext) => unknown
  /** 是否异步执行 */
  async?: boolean
  /** 异步批次大小 */
  batchSize?: number
  /**
   * 进度回调（仅异步路径）。抛错不会污染快照结果：异常被就地记为一条 `unknown`
   * 错误（不影响 `success`）并停止后续上报
   */
  onProgress?: (progress: SnapshotProgress) => void
  /**
   * 错误回调：返回 true 继续克隆、false 中止。
   * 与 onProgress 不同，它是降级决策的作出方而非上报方，故不对其抛错做静默兜底：
   * 同步路径下异常冲出克隆、整个快照以失败结果交付；异步路径下该节点被记为 cloneError，
   * `success` 随之为 false
   */
  onError?: (error: SnapshotError, context: SnapshotErrorContext) => boolean | void
}

/**
 * 克隆上下文
 */
export interface CloneContext {
  /** 当前路径 */
  path: string
  /** 当前深度 */
  depth: number
  /** 父对象 */
  parent: unknown
  /** 属性键 */
  key: string | number
  /** 已访问的弱引用集合（用于循环检测） */
  visited: WeakMap<object, unknown>
}

/**
 * 快照进度
 */
export interface SnapshotProgress {
  /** 已处理节点数 */
  processed: number
  /** 总节点数（预估） */
  total: number
  /** 进度百分比 */
  percentage: number
  /** 当前处理路径 */
  currentPath: string
  /** 已用时间（毫秒） */
  elapsedTime: number
  /** 预计剩余时间（毫秒） */
  estimatedTimeRemaining: number
}

/**
 * 快照错误
 */
export interface SnapshotError {
  /** 错误类型 */
  type: 'circular' | 'maxDepth' | 'cloneError' | 'timeout' | 'unknown'
  /** 错误消息 */
  message: string
  /** 发生错误的路径 */
  path: string
  /** 原始错误 */
  originalError?: Error
}

/**
 * 快照错误上下文
 */
export interface SnapshotErrorContext {
  /** 当前路径 */
  path: string
  /** 当前深度 */
  depth: number
  /** 当前值 */
  value: unknown
  /** 是否可恢复 */
  recoverable: boolean
}

/**
 * 快照结果
 */
export interface SnapshotResult<T = unknown> {
  /** 快照数据 */
  data: T
  /** 快照元数据 */
  metadata: SnapshotMetadata
  /** 是否成功 */
  success: boolean
  /** 错误列表 */
  errors: SnapshotError[]
  /** 性能统计 */
  stats: SnapshotStats
}

/**
 * 快照元数据
 */
export interface SnapshotMetadata {
  /** 快照ID */
  id: string
  /** 创建时间戳 */
  timestamp: number
  /** 原始数据类型 */
  dataType: string
  /** 数据大小（字节，估算） */
  size: number
  /**
   * 节点数量：本次实际进入克隆的节点数（同步 / 异步两条路径同口径）。
   * 不含因超出 maxDepth 而在计数前返回的节点。
   */
  nodeCount: number
  /** 最大深度 */
  maxDepth: number
  /** 是否包含循环引用 */
  hasCircular: boolean
}

/**
 * 快照统计
 */
export interface SnapshotStats {
  /** 总耗时（毫秒） */
  duration: number
  /** 克隆操作次数 */
  cloneOperations: number
  /** 遇到的循环引用数 */
  circularReferences: number
  /** 达到最大深度的节点数 */
  maxDepthHits: number
}

/**
 * 异步快照配置
 */
export interface AsyncSnapshotOptions extends SnapshotOptions {
  /** 异步模式 */
  async: true
  /** 每批次处理节点数 */
  batchSize?: number
  /** 每批次间隔（毫秒） */
  batchInterval?: number
  /** 超时时间（毫秒） */
  timeout?: number
}
