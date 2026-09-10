/**
 * GeomStore - 增强型快照管理器
 *
 * 提供高性能的状态快照功能，支持：
 * - 迭代式深度克隆（支持循环引用检测）
 * - 异步快照（非阻塞操作）
 * - 进度回调与错误处理
 * - 增量快照对比
 *
 * @module SnapshotManager
 */

import { SKIP_CLONE_NODE, SnapshotAbortError, cloneDeep } from './clone.js'
import { processNodeAsync, type AsyncCloneTask } from './clone-async.js'
import { compareSnapshots as compareSnapshotsImpl, type SnapshotDiff } from './diff.js'
import type { AsyncSnapshotOptions, SnapshotError, SnapshotMetadata, SnapshotOptions, SnapshotResult, SnapshotStats } from './types.js'

// ==================== 类型定义 ====================
// 类型已拆至 ./types.js：此处再导出以保持既有导入路径（SnapshotManager.js）不变
export type {
  AsyncSnapshotOptions,
  CloneContext,
  SnapshotError,
  SnapshotErrorContext,
  SnapshotMetadata,
  SnapshotOptions,
  SnapshotProgress,
  SnapshotResult,
  SnapshotStats,
} from './types.js'

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
      // 异步模式的批大小：取较大值会让单批同步工作量变大、削弱「批间让出控制权」的效果，
      // 故与 createSnapshotAsync 的回落值（options.batchSize 非法时）保持同一口径
      batchSize: 100,
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
      const clonedData = cloneDeep(
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
        // 根节点的自定义克隆器失败且 onError 允许继续时，cloneDeep 返回丢弃哨兵：
        // 与异步路径（哨兵被 processQueue 跳过、rootResult 保持 undefined）保持同一语义
        data: (clonedData === SKIP_CLONE_NODE ? undefined : clonedData) as T,
        metadata,
        // errors 为空时 some 必然为 false，无需先判 length（去掉冗余短路分支）
        success: !errors.some((e) => e.type === 'cloneError'),
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
      // batchSize 必须为正数：0 或 NaN 会让 processQueue 里的 `batch.length < batchSize`
      // 恒为 false，批永远为空 → 立即 break → 无任何克隆且 errors 为空，
      // 最终 success 判定为 true 而 data 是占位空壳（静默交付半成品）。
      // 口径与 LRUCache 的容量守卫一致；batchInterval/timeout 的 0 是合法语义
      // （无延迟 / 立即超时），不可一并抬高下限
      batchSize: Number.isFinite(options.batchSize) ? Math.max(1, options.batchSize as number) : this.defaultOptions.batchSize,
      batchInterval: options.batchInterval ?? 0,
      timeout: options.timeout ?? 30000,
    }

    const startTime = Date.now()
    const id = this.generateSnapshotId()
    const errors: SnapshotError[] = []

    // 创建任务队列：容器字段按节点入队，每批处理 batchSize 个节点。
    // 以 queueHead 游标消费而非 Array#shift（后者 O(n)，大批量入队下整体退化为 O(n²)）
    const queue: AsyncCloneTask[] = []
    let queueHead = 0
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
    // 经属性描述符读取：直接求值会额外触发 getter（副作用双调用），
    // getter 抛错时整个异步快照在入口即失败，不走 onError 降级路径
    const estimateNodeCount = (obj: unknown, depth = 0): number => {
      if (depth > 10 || obj === null || typeof obj !== 'object') return 1
      if (Array.isArray(obj)) {
        // 数组元素读取同样可能触发 Proxy 陷阱抛错：与对象分支同口径按叶子计数
        try {
          return obj.reduce((sum, item) => sum + estimateNodeCount(item, depth + 1), 1)
        } catch {
          return 1
        }
      }
      try {
        // Object.keys 与描述符读取都可能触发 Proxy 陷阱抛错，估算失败按叶子计数
        return Object.keys(obj).reduce((sum, key) => {
          try {
            const descriptor = Object.getOwnPropertyDescriptor(obj, key)
            // 访问器属性按叶子计数（不触发 getter）
            const child = descriptor && 'value' in descriptor ? descriptor.value : undefined
            return sum + estimateNodeCount(child, depth + 1)
          } catch {
            // 单键描述符读取失败按叶子计数，其余键继续估算
            return sum + 1
          }
        }, 1)
      } catch {
        // ownKeys/枚举验证阶段失败：整个对象按叶子计数
        return 1
      }
    }
    const totalCount = estimateNodeCount(data)

    // 报告进度
    const reportProgress = (currentPath: string) => {
      const elapsed = Date.now() - startTime
      const percentage = Math.min(100, (processedCount / totalCount) * 100)
      // 无分支的剩余时间估算，与原先 `percentage > 0 ? (elapsed / percentage) * (100 - percentage) : 0`
      // 等价：percentage 为 0 时 Math.sign 归零使分子为 0，故结果为 0（避免 0/0 产生 NaN）；
      // 分母取下限 Number.MIN_VALUE 以防除零。该守卫在所有可达输入下恒为 percentage > 0
      // （processedCount 在报告前必已自增），istanbul 无法为不可达单侧做行级忽略，故改为无分支写法
      const perPercent = (elapsed * Math.sign(percentage)) / Math.max(percentage, Number.MIN_VALUE)
      const estimatedRemaining = perPercent * (100 - percentage)

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
      /* istanbul ignore else -- 任务处理是同步的：hasTimedOut 为真时外层循环已退出，不会再走到入队 */
      if (!hasTimedOut) queue.push(task)
    }

    // 处理队列：每批处理 batchSize 个节点，批间让出控制权
    const processQueue = async (): Promise<void> => {
      try {
        while (queueHead < queue.length && !hasTimedOut) {
          // 裁剪已消费前缀：保持底层数组紧凑，splice 的搬移量受批大小约束
          if (queueHead > 0) {
            queue.splice(0, queueHead)
            queueHead = 0
          }
          const batch: AsyncCloneTask[] = []

          while (queueHead < queue.length && batch.length < opts.batchSize) {
            batch.push(queue[queueHead++])
          }

          /* istanbul ignore if -- 外层循环条件已保证队列非空，此处为防御性双检 */
          if (batch.length === 0) break

          // 处理批次
          for (const task of batch) {
            let result: unknown
            try {
              result = processNodeAsync(task, opts, errors, stats, counters, enqueue)
            } catch (error) {
              if (error instanceof SnapshotAbortError) {
                // onError 返回 false 要求中止：向上传播，整个快照以失败结果交付
                throw error
              }
              // 未预期的内部异常：记录错误并跳过该节点。绝不能把原始活引用
              // 兜底填入快照——后续对活状态的修改会穿透进快照，破坏隔离契约
              errors.push({
                type: 'cloneError',
                message: `Failed to clone node at ${task.context.path}: ${error instanceof Error ? error.message : String(error)}`,
                path: task.context.path,
                originalError: error instanceof Error ? error : undefined,
              })
              processedCount++
              continue
            }
            processedCount++
            if (result === SKIP_CLONE_NODE) {
              // onError 选择继续但节点被丢弃：跳过填充；prop 占位一并移除，
              // 与同步路径「丢弃该属性」的语义一致（Map/Set/数组位置本就无占位）
              const skipped = task.target
              if (skipped && skipped.kind === 'prop') {
                try {
                  delete (skipped.container as Record<string, unknown>)[skipped.key as string]
                } catch {
                  // 占位清理失败不影响整体流程
                }
              }
              continue
            }
            // stats.cloneOperations 由 processNodeAsync 内部按克隆节点累加
            // （与同步路径同口径），此处不可用任务数覆盖，否则统计口径错乱

            // 填充到父容器（根任务无 target，作为整体结果返回）
            if (task.target) {
              const t = task.target
              try {
                if (t.kind === 'prop') {
                  /* istanbul ignore else -- prop 任务必携带 descriptor（见 clone-async 的 enqueue），此处恒为真 */
                  if (t.descriptor) {
                    Object.defineProperty(t.container as object, t.key as string, {
                      value: result,
                      writable: t.descriptor.writable,
                      enumerable: t.descriptor.enumerable,
                      configurable: t.descriptor.configurable,
                    })
                  } else {
                    (t.container as Record<string, unknown>)[t.key as string] = result
                  }
                } else if (t.kind === 'index') {
                  (t.container as unknown[])[t.key as number] = result
                } else if (t.kind === 'mapValue') {
                  (t.container as Map<unknown, unknown>).set(t.key, result)
                } else {
                  (t.container as Set<unknown>).add(result)
                }
              } catch (error) {
                // 单个位置填充失败只降级记录错误，不中断队列：
                // 此处抛出的异常会绕过 rootResolve，导致外层 await 永久挂起
                errors.push({
                  type: 'cloneError',
                  message: `Failed to fill cloned value at ${task.context.path}: ${error instanceof Error ? error.message : String(error)}`,
                  path: task.context.path,
                  originalError: error instanceof Error ? error : undefined,
                })
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
      } finally {
        // 无论正常结束还是中途异常都交付根结果，防止外层 await 永久挂起
        rootResolve(rootResult)
      }
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
        // 与同步路径同口径：仅 cloneError 视为失败，circular/maxDepth 属可恢复降级
        success: !hasTimedOut && !errors.some((e) => e.type === 'cloneError'),
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
    // 实现已拆至 ./diff.js（纯函数，不依赖管理器实例状态）
    return compareSnapshotsImpl(snapshot1, snapshot2)
  }

  // ==================== 私有方法 ====================

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
 * 快照差异（定义已拆至 ./diff.js；此处再导出以保持既有导入路径不变）
 */
export type { SnapshotDiff } from './diff.js'

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
