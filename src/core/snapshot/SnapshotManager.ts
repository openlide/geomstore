/**
 * GeomStore v1.0 - 增强型快照管理器
 *
 * 提供高性能的状态快照功能，支持：
 * - 迭代式深度克隆（支持循环引用检测）
 * - 异步快照（非阻塞操作）
 * - 进度回调与错误处理
 * - 增量快照对比
 *
 * @module SnapshotManager
 */

// ==================== 类型定义 ====================

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
  /** 自定义克隆函数 */
  customCloner?: (value: unknown, context: CloneContext) => unknown | undefined
  /** 是否异步执行 */
  async?: boolean
  /** 异步批次大小 */
  batchSize?: number
  /** 进度回调 */
  onProgress?: (progress: SnapshotProgress) => void
  /** 错误回调 */
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
  /** 节点数量 */
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

/**
 * 异步克隆任务
 *
 * 每个任务表示需要克隆的单个节点；target 存在时，
 * 克隆结果填充到父容器对应位置（根任务无 target，作为整体结果返回）
 */
interface AsyncCloneTask {
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
  }
}

// ==================== 快照管理器 ====================

/**
 * 增强型快照管理器
 *
 * 提供高性能、可配置的状态快照功能。
 *
 * @class SnapshotManager
 *
 * @example
 * ```typescript
 * const manager = new SnapshotManager()
 *
 * // 基础快照
 * const result = manager.createSnapshot(state)
 *
 * // 异步快照
 * const asyncResult = await manager.createSnapshotAsync(state, {
 *   onProgress: (p) => console.log(`${p.percentage}%`)
 * })
 * ```
 */
export class SnapshotManager {
  private defaultOptions: Required<SnapshotOptions>
  private snapshotIdCounter: number
  // 实例级随机后缀：便捷函数（如 createSnapshot）每次调用都会 new 一个 SnapshotManager，
  // 计数器随之归零，仅靠 Date.now() + 计数器在同一毫秒内会跨实例产生重复 ID
  private readonly snapshotIdSuffix: string

  constructor(options: Partial<SnapshotOptions> = {}) {
    this.snapshotIdCounter = 0
    this.snapshotIdSuffix = Math.random().toString(36).slice(2, 8)
    this.defaultOptions = {
      maxDepth: 100,
      detectCircular: true,
      includeNonEnumerable: false,
      customCloner: () => undefined,
      async: false,
      batchSize: 1000,
      onProgress: () => {},
      onError: () => true,
      ...options,
    }
  }

  /**
   * 创建同步快照
   *
   * @param {T} data - 要快照的数据
   * @param {SnapshotOptions} options - 配置选项
   * @returns {SnapshotResult<T>} 快照结果
   *
   * @example
   * ```typescript
   * const result = manager.createSnapshot(state)
   * console.log(result.metadata.nodeCount)
   * ```
   */
  createSnapshot<T>(data: T, options: SnapshotOptions = {}): SnapshotResult<T> {
    const opts = { ...this.defaultOptions, ...options }
    const startTime = Date.now()
    const id = this.generateSnapshotId()

    const errors: SnapshotError[] = []
    const stats: SnapshotStats = {
      duration: 0,
      cloneOperations: 0,
      circularReferences: 0,
      maxDepthHits: 0,
    }

    // 循环引用检测始终启用（成本极低）：detectCircular 选项仅控制是否上报错误，
    // 关闭时发现循环直接复用已克隆引用，避免无限递归栈溢出破坏快照隔离契约
    const visited = new WeakMap<object, unknown>()

    // 节点计数器 - 使用闭包共享状态
    const counters = {
      nodeCount: 0,
      maxDepthReached: 0,
      estimatedSize: 0,
      hasCircular: false,
    }

    try {
      const clonedData = this.cloneDeep(
        data,
        {
          path: 'root',
          depth: 0,
          parent: null,
          key: 'root',
          visited: visited,
        },
        opts,
        errors,
        stats,
        counters,
      )

      stats.duration = Date.now() - startTime

      const metadata: SnapshotMetadata = {
        id,
        timestamp: startTime,
        dataType: this.getDataType(data),
        size: counters.estimatedSize,
        nodeCount: counters.nodeCount,
        maxDepth: counters.maxDepthReached,
        hasCircular: counters.hasCircular,
      }

      return {
        data: clonedData as T,
        metadata,
        success: errors.length === 0 || !errors.some((e) => e.type === 'cloneError'),
        errors,
        stats,
      }
    } catch (error) {
      stats.duration = Date.now() - startTime

      errors.push({
        type: 'unknown',
        message: error instanceof Error ? error.message : 'Unknown error',
        path: 'root',
        originalError: error instanceof Error ? error : undefined,
      })

      return {
        data: data as T,
        metadata: {
          id,
          timestamp: startTime,
          dataType: this.getDataType(data),
          size: 0,
          nodeCount: 0,
          maxDepth: 0,
          hasCircular: false,
        },
        success: false,
        errors,
        stats,
      }
    }
  }

  /**
   * 创建异步快照
   *
   * 非阻塞式快照创建，支持进度回调和取消。
   * 克隆按节点分片入队，每批次处理 batchSize 个节点，
   * 批间让出控制权，避免大对象同步递归阻塞主线程。
   *
   * @param {T} data - 要快照的数据
   * @param {AsyncSnapshotOptions} options - 异步配置选项
   * @returns {Promise<SnapshotResult<T>>} 快照结果Promise
   *
   * @example
   * ```typescript
   * const result = await manager.createSnapshotAsync(largeState, {
   *   batchSize: 100,
   *   onProgress: (p) => updateProgressBar(p.percentage)
   * })
   * ```
   */
  async createSnapshotAsync<T>(data: T, options: Partial<AsyncSnapshotOptions> = {}): Promise<SnapshotResult<T>> {
    const opts: Required<AsyncSnapshotOptions> = {
      ...this.defaultOptions,
      ...options,
      async: true,
      batchSize: options.batchSize ?? 100,
      batchInterval: options.batchInterval ?? 0,
      timeout: options.timeout ?? 30000,
    }

    const startTime = Date.now()
    const id = this.generateSnapshotId()
    const errors: SnapshotError[] = []

    // 创建任务队列：容器字段按节点入队，每批处理 batchSize 个节点
    const queue: AsyncCloneTask[] = []
    const visited = new WeakMap<object, unknown>()

    let processedCount = 0
    let hasTimedOut = false
    let rootResult: unknown
    let rootResolve!: (value: unknown) => void

    // 节点计数器 - 整个异步过程共享，保证统计真实
    const counters = {
      nodeCount: 0,
      maxDepthReached: 0,
      estimatedSize: 0,
      hasCircular: false,
    }

    // 创建共享的 stats 对象，在整个异步快照过程中累积统计
    const stats: SnapshotStats = {
      duration: 0,
      cloneOperations: 0,
      circularReferences: 0,
      maxDepthHits: 0,
    }

    // 设置超时
    const timeoutId =
      opts.timeout > 0
        ? setTimeout(() => {
            hasTimedOut = true
          }, opts.timeout)
        : null

    // 计算预估总节点数
    const estimateNodeCount = (obj: unknown, depth = 0): number => {
      if (depth > 10 || obj === null || typeof obj !== 'object') return 1
      if (Array.isArray(obj)) {
        return obj.reduce((sum, item) => sum + estimateNodeCount(item, depth + 1), 1)
      }
      return Object.keys(obj).reduce((sum, key) => sum + estimateNodeCount((obj as Record<string, unknown>)[key], depth + 1), 1)
    }
    const totalCount = estimateNodeCount(data)

    // 报告进度
    const reportProgress = (currentPath: string) => {
      const elapsed = Date.now() - startTime
      const percentage = Math.min(100, (processedCount / totalCount) * 100)
      const estimatedRemaining = percentage > 0 ? (elapsed / percentage) * (100 - percentage) : 0

      opts.onProgress({
        processed: processedCount,
        total: totalCount,
        percentage: Math.round(percentage * 100) / 100,
        currentPath,
        elapsedTime: elapsed,
        estimatedTimeRemaining: Math.round(estimatedRemaining),
      })
    }

    // 入队（超时后不再接受新任务，避免队列无限增长）
    const enqueue = (task: AsyncCloneTask): void => {
      if (!hasTimedOut) queue.push(task)
    }

    // 处理队列：每批处理 batchSize 个节点，批间让出控制权
    const processQueue = async (): Promise<void> => {
      while (queue.length > 0 && !hasTimedOut) {
        const batch: AsyncCloneTask[] = []

        while (queue.length > 0 && batch.length < opts.batchSize) {
          const task = queue.shift()
          if (task) {
            batch.push(task)
          }
        }

        if (batch.length === 0) break

        // 处理批次
        for (const task of batch) {
          let result: unknown
          try {
            result = this.processNodeAsync(task, opts, errors, stats, counters, enqueue)
          } catch {
            // 单节点克隆失败时用原值兜底，保证整个快照不中断
            result = task.value
          }
          processedCount++
          // stats.cloneOperations 由 processNodeAsync 内部按克隆节点累加
          // （与同步路径同口径），此处不可用任务数覆盖，否则统计口径错乱

          // 填充到父容器（根任务无 target，作为整体结果返回）
          if (task.target) {
            const t = task.target
            if (t.kind === 'prop') {
              (t.container as Record<string, unknown>)[t.key as string] = result
            } else if (t.kind === 'index') {
              (t.container as unknown[])[t.key as number] = result
            } else if (t.kind === 'mapValue') {
              (t.container as Map<unknown, unknown>).set(t.key, result)
            } else {
              (t.container as Set<unknown>).add(result)
            }
          } else {
            rootResult = result
          }
        }

        // 报告进度（每批一次）
        reportProgress(batch[batch.length - 1].context.path)

        // 让出控制权
        if (opts.batchInterval > 0) {
          await new Promise((r) => setTimeout(r, opts.batchInterval))
        } else {
          await new Promise((r) => setTimeout(r, 0))
        }
      }

      // 队列处理完毕（或超时中断），交付根结果
      rootResolve(rootResult)
    }

    try {
      // 根任务入队，启动队列处理
      enqueue({
        value: data,
        context: {
          path: 'root',
          depth: 0,
          parent: null,
          key: 'root',
          visited,
        },
      })
      const resultPromise = new Promise<unknown>((resolve) => {
        rootResolve = resolve
      })
      const queuePromise = processQueue()

      // 等待整个克隆完成（rootResolve 在所有批次处理完后被调用）
      const clonedData = await resultPromise
      await queuePromise

      if (timeoutId) clearTimeout(timeoutId)

      // 更新共享 stats 的持续时间
      stats.duration = Date.now() - startTime

      const metadata: SnapshotMetadata = {
        id,
        timestamp: startTime,
        dataType: this.getDataType(data),
        size: counters.estimatedSize,
        nodeCount: processedCount,
        maxDepth: counters.maxDepthReached,
        hasCircular: counters.hasCircular,
      }

      return {
        data: clonedData as T,
        metadata,
        success: !hasTimedOut && errors.length === 0,
        errors: hasTimedOut ? [...errors, { type: 'timeout', message: 'Snapshot creation timed out', path: 'root' }] : errors,
        stats,
      }
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId)

      errors.push({
        type: 'unknown',
        message: error instanceof Error ? error.message : 'Unknown error',
        path: 'root',
        originalError: error instanceof Error ? error : undefined,
      })

      return {
        data: data as T,
        metadata: {
          id,
          timestamp: startTime,
          dataType: this.getDataType(data),
          size: 0,
          nodeCount: 0,
          maxDepth: 0,
          hasCircular: false,
        },
        success: false,
        errors,
        stats: {
          duration: Date.now() - startTime,
          cloneOperations: 0,
          circularReferences: 0,
          maxDepthHits: 0,
        },
      }
    }
  }

  /**
   * 对比两个快照
   *
   * @param {SnapshotResult<T1>} snapshot1 - 第一个快照
   * @param {SnapshotResult<T2>} snapshot2 - 第二个快照（支持不同类型）
   * @returns {SnapshotDiff} 差异结果
   */
  compareSnapshots<T1, T2>(snapshot1: SnapshotResult<T1>, snapshot2: SnapshotResult<T2>): SnapshotDiff {
    // 对比最大深度：超出后停止递归，防止深度嵌套导致栈溢出
    const MAX_COMPARE_DEPTH = 100
    const changes: Array<{ path: string; oldValue: unknown; newValue: unknown }> = []

    const compare = (obj1: unknown, obj2: unknown, path: string, depth: number): void => {
      // 深度保护：超出最大深度后停止递归，避免深层嵌套导致栈溢出
      if (depth > MAX_COMPARE_DEPTH) {
        changes.push({ path, oldValue: obj1, newValue: obj2 })
        return
      }

      if (obj1 === obj2) return

      if (typeof obj1 !== typeof obj2) {
        changes.push({ path, oldValue: obj1, newValue: obj2 })
        return
      }

      if (obj1 === null || obj2 === null || typeof obj1 !== 'object' || typeof obj2 !== 'object') {
        changes.push({ path, oldValue: obj1, newValue: obj2 })
        return
      }

      // 内建对象按内容比较：Object.keys 对 Date/Map/Set/RegExp 恒为空，
      // 直接走通用对象比较会把内容不同的实例误判为无差异
      if (obj1 instanceof Date || obj2 instanceof Date) {
        if (!(obj1 instanceof Date && obj2 instanceof Date) || obj1.getTime() !== obj2.getTime()) {
          changes.push({ path, oldValue: obj1, newValue: obj2 })
        }
        return
      }

      if (obj1 instanceof RegExp || obj2 instanceof RegExp) {
        if (!(obj1 instanceof RegExp && obj2 instanceof RegExp) || obj1.source !== obj2.source || obj1.flags !== obj2.flags) {
          changes.push({ path, oldValue: obj1, newValue: obj2 })
        }
        return
      }

      if (obj1 instanceof Map || obj2 instanceof Map) {
        const map1 = obj1 as Map<unknown, unknown>
        const map2 = obj2 as Map<unknown, unknown>
        if (!(obj1 instanceof Map && obj2 instanceof Map) || map1.size !== map2.size) {
          changes.push({ path, oldValue: obj1, newValue: obj2 })
          return
        }
        let i = 0
        for (const [key, value] of map1) {
          // 键按引用相等匹配（对象键的深匹配超出本工具职责）；值递归比较
          if (!map2.has(key)) {
            changes.push({ path: `${path}.key[${i}]`, oldValue: key, newValue: undefined })
          } else {
            compare(value, map2.get(key), `${path}.key[${i}]`, depth + 1)
          }
          i++
        }
        return
      }

      if (obj1 instanceof Set || obj2 instanceof Set) {
        const set1 = obj1 as Set<unknown>
        const set2 = obj2 as Set<unknown>
        if (!(obj1 instanceof Set && obj2 instanceof Set) || set1.size !== set2.size) {
          changes.push({ path, oldValue: obj1, newValue: obj2 })
          return
        }
        // Set 迭代顺序即插入顺序，按序配对比较元素
        const items1 = [...set1]
        const items2 = [...set2]
        for (let i = 0; i < items1.length; i++) {
          compare(items1[i], items2[i], `${path}[${i}]`, depth + 1)
        }
        return
      }

      const keys1 = Object.keys(obj1 as object)
      const keys2 = Object.keys(obj2 as object)
      const allKeys = new Set([...keys1, ...keys2])

      for (const key of allKeys) {
        const newPath = path ? `${path}.${key}` : key
        compare((obj1 as Record<string, unknown>)[key], (obj2 as Record<string, unknown>)[key], newPath, depth + 1)
      }
    }

    compare(snapshot1.data, snapshot2.data, 'root', 0)

    return {
      changed: changes.length > 0,
      changes,
      timestamp1: snapshot1.metadata.timestamp,
      timestamp2: snapshot2.metadata.timestamp,
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 深度克隆（迭代实现）
   *
   * @private
   */
  private cloneDeep<T>(
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
    // 检查最大深度
    if (context.depth > options.maxDepth) {
      stats.maxDepthHits++
      errors.push({
        type: 'maxDepth',
        message: `Maximum depth ${options.maxDepth} exceeded at ${context.path}`,
        path: context.path,
      })
      return value
    }

    counters.nodeCount++
    counters.maxDepthReached = Math.max(counters.maxDepthReached, context.depth)

    // 基本类型直接返回
    if (value === null || typeof value !== 'object') {
      return value
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
          return '[Circular Reference]'
        }
      }

      return context.visited.get(value as object)
    }

    // 自定义克隆
    const customResult = options.customCloner(value, context)
    if (customResult !== undefined) {
      return customResult
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
        const clonedKey = this.cloneDeep(
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

        const clonedValue = this.cloneDeep(
          v,
          {
            ...context,
            path: `${context.path}[${k}]`,
            depth: context.depth + 1,
          },
          options,
          errors,
          stats,
          counters,
        )

        cloned.set(clonedKey, clonedValue)
      }

      return cloned
    }

    if (value instanceof Set) {
      const cloned = new Set()
      context.visited.set(value as object, cloned)

      let index = 0
      for (const item of value) {
        cloned.add(
          this.cloneDeep(
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
          ),
        )
        index++
      }

      return cloned
    }

    // 处理数组
    if (Array.isArray(value)) {
      const cloned: unknown[] = []
      context.visited.set(value as object, cloned)

      for (let i = 0; i < value.length; i++) {
        cloned[i] = this.cloneDeep(
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
      }

      return cloned
    }

    // 处理普通对象
    const cloned: Record<string, unknown> = {}
    context.visited.set(value as object, cloned)

    const keys = options.includeNonEnumerable ? Object.getOwnPropertyNames(value) : Object.keys(value)

    for (const key of keys) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor) {
          continue
        }

        const clonedValue = this.cloneDeep(
          descriptor.value,
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

        Object.defineProperty(cloned, key, {
          value: clonedValue,
          writable: descriptor.writable,
          enumerable: descriptor.enumerable,
          configurable: descriptor.configurable,
        })
      } catch (error) {
        stats.cloneOperations++
        const shouldContinue = options.onError(
          {
            type: 'cloneError',
            message: error instanceof Error ? error.message : 'Clone error',
            path: `${context.path}.${key}`,
            originalError: error instanceof Error ? error : undefined,
          },
          {
            path: `${context.path}.${key}`,
            depth: context.depth,
            value: (value as Record<string, unknown>)[key],
            recoverable: true,
          },
        )

        if (!shouldContinue) {
          throw error
        }
      }
    }

    stats.cloneOperations++
    return cloned
  }

  /**
   * 异步模式单节点克隆
   *
   * 只克隆当前节点的容器外壳与叶子字段，对象子值入队异步填充；
   * 相比同步递归，每个节点的工作量有界，大对象不会阻塞主线程。
   *
   * @private
   */
  private processNodeAsync(
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

    // 检查最大深度
    if (context.depth > options.maxDepth) {
      stats.maxDepthHits++
      errors.push({
        type: 'maxDepth',
        message: `Maximum depth ${options.maxDepth} exceeded at ${context.path}`,
        path: context.path,
      })
      return value
    }

    counters.nodeCount++
    counters.maxDepthReached = Math.max(counters.maxDepthReached, context.depth)

    // 基本类型直接返回
    if (value === null || typeof value !== 'object') {
      return value
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
          return '[Circular Reference]'
        }
      }

      return context.visited.get(value as object)
    }

    // 自定义克隆
    const customResult = options.customCloner(value, context)
    if (customResult !== undefined) {
      return customResult
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
        // Map 键需要克隆完成后才能 set，且对象键罕见，同步克隆键
        const clonedKey = this.cloneDeep(
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

        if (v !== null && typeof v === 'object') {
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
        } else {
          cloned.set(clonedKey, v)
        }
      }

      stats.cloneOperations++
      return cloned
    }

    if (value instanceof Set) {
      const cloned = new Set()
      context.visited.set(value as object, cloned)

      let index = 0
      for (const item of value) {
        if (item !== null && typeof item === 'object') {
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
        } else {
          cloned.add(item)
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
    const cloned: Record<string, unknown> = {}
    context.visited.set(value as object, cloned)

    const keys = options.includeNonEnumerable ? Object.getOwnPropertyNames(value) : Object.keys(value)

    for (const key of keys) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor) {
          continue
        }

        if (descriptor.value !== null && typeof descriptor.value === 'object') {
          // 先占位（保留属性描述符），子任务完成后赋值填充
          Object.defineProperty(cloned, key, {
            value: undefined,
            writable: descriptor.writable,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
          })

          enqueue({
            value: descriptor.value,
            context: {
              ...context,
              path: `${context.path}.${key}`,
              depth: context.depth + 1,
              parent: value,
              key,
            },
            target: { kind: 'prop', container: cloned, key },
          })
        } else {
          Object.defineProperty(cloned, key, {
            value: descriptor.value,
            writable: descriptor.writable,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable,
          })
        }
      } catch (error) {
        stats.cloneOperations++
        const shouldContinue = options.onError(
          {
            type: 'cloneError',
            message: error instanceof Error ? error.message : 'Clone error',
            path: `${context.path}.${key}`,
            originalError: error instanceof Error ? error : undefined,
          },
          {
            path: `${context.path}.${key}`,
            depth: context.depth,
            value: (value as Record<string, unknown>)[key],
            recoverable: true,
          },
        )

        if (!shouldContinue) {
          throw error
        }
      }
    }

    stats.cloneOperations++
    return cloned
  }

  /**
   * 生成快照ID
   *
   * @private
   */
  private generateSnapshotId(): string {
    return `snapshot-${Date.now()}-${++this.snapshotIdCounter}-${this.snapshotIdSuffix}`
  }

  /**
   * 获取数据类型
   *
   * @private
   */
  private getDataType(value: unknown): string {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (value instanceof Date) return 'date'
    if (value instanceof RegExp) return 'regexp'
    if (value instanceof Map) return 'map'
    if (value instanceof Set) return 'set'
    return typeof value
  }
}

/**
 * 快照差异
 */
export interface SnapshotDiff {
  /** 是否发生变化 */
  changed: boolean
  /** 变化列表 */
  changes: Array<{ path: string; oldValue: unknown; newValue: unknown }>
  /** 第一个快照时间戳 */
  timestamp1: number
  /** 第二个快照时间戳 */
  timestamp2: number
}

// ==================== 便捷函数 ====================

/**
 * 创建快照（便捷函数）
 */
export function createSnapshot<T>(data: T, options?: SnapshotOptions): SnapshotResult<T> {
  const manager = new SnapshotManager()
  return manager.createSnapshot(data, options)
}

/**
 * 创建异步快照（便捷函数）
 */
export function createSnapshotAsync<T>(data: T, options?: Partial<AsyncSnapshotOptions>): Promise<SnapshotResult<T>> {
  const manager = new SnapshotManager()
  return manager.createSnapshotAsync(data, options)
}

export default SnapshotManager
