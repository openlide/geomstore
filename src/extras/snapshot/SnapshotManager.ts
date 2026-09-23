/**
 * GeomStore - 增强型快照管理器
 *
 * 提供高性能的状态快照功能，支持：
 * - 同步深度克隆（递归实现，深度受 maxDepth 界定，支持循环引用检测）
 * - 异步快照（分节点入队、批间让出控制权，不阻塞主线程）
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

// ==================== 异步选项守卫 ====================

/** 异步快照的缺省批大小：取较大值会让单批同步工作量变大、削弱「批间让出控制权」的效果 */
const DEFAULT_BATCH_SIZE = 100

/** 缺省超时（毫秒） */
const DEFAULT_TIMEOUT_MS = 30000

/**
 * `batchSize` 的单点归一化（构造期默认值与逐次调用参数共用）。
 *
 * 0 / NaN / 负数会让 processQueue 里的 `batch.length < batchSize` 恒为 false，
 * 批永远为空 → 立即 break → 无任何克隆且 errors 为空，最终 success 判定为 true
 * 而 data 是占位空壳（静默交付半成品）。口径与 LRUCache 的容量守卫一致。
 */
function normalizeBatchSize(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(1, value as number) : DEFAULT_BATCH_SIZE
}

/**
 * `batchInterval` / `timeout` 的单点归一化：返回值 0 恒表示「这个定时器不该存在」。
 *
 * 非有限值（Infinity / NaN）与非正值一律落 0：
 * - `timeout` 的 0 是「不设超时」（调用方写 Infinity 表达的正是这个意图）。若把 Infinity
 *   原样交给 setTimeout，Node 会告 TimeoutOverflowWarning 并夹成约 1ms，
 *   于是「不超时」变成一次莫名立即超时；
 * - `batchInterval` 的 0 是「批间用 setTimeout(r, 0) 让出控制权」。
 * 有限正数原样交给宿主（超出宿主可靠区间的多大数值由宿主裁剪，本库不臆造语义）
 */
function normalizeDelay(value: number | undefined, fallback: number): number {
  const ms = value ?? fallback
  return Number.isFinite(ms) && ms > 0 ? ms : 0
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
      // 异步模式的批大小：合法值校验统一走 normalizeBatchSize（构造期与逐次调用同一口径）
      batchSize: DEFAULT_BATCH_SIZE,
      onProgress: () => {},
      onError: () => true,
      ...options,
    }
    // 兜底值本身必须先合法：createSnapshotAsync 在调用方传非法 batchSize 时回落到这里，
    // 构造期传 0/NaN/负数若原样留着，守卫就会把一个非法值当作「安全默认值」发出去
    this.defaultOptions.batchSize = normalizeBatchSize(this.defaultOptions.batchSize)
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
    const visited = new WeakMap<object, object>()

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
        data: clonedData === SKIP_CLONE_NODE ? undefined : (clonedData as T),
        metadata,
        // errors 为空时 some 必然为 false，无需先判 length（去掉冗余短路分支）
        success: !errors.some((e) => e.type === 'cloneError'),
        errors,
        stats,
      }
    } catch (error) {
      errors.push({
        type: 'unknown',
        message: error instanceof Error ? error.message : 'Unknown error',
        path: 'root',
        originalError: error instanceof Error ? error : undefined,
      })

      return this.buildFailureResult<T>(id, startTime, data, errors, stats)
    }
  }

  /**
   * 创建异步快照
   *
   * 非阻塞式快照创建，支持进度回调和取消。
   * 克隆按节点分片入队，每批次处理 batchSize 个节点，
   * 批间让出控制权，避免大对象同步递归阻塞主线程。
   *
   * 超时口径：`timeout` 翻位时只有「队列仍有未处理任务」或「超时后丢掉过入队任务」
   * 才使结果 `success: false` 并落一条 `timeout` 错误——完好克隆不因定时器晚到而判失败。
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
      // batchSize 守卫对**合并后**的值生效：只校验 options.batchSize 会让构造期传入的
      // 非法值经由回落分支绕过守卫。batchInterval / timeout 另走 normalizeDelay，
      // 其 0 是合法语义（无延迟 / 不设超时），不可抬高下限，但要挡掉非有限值
      batchSize: normalizeBatchSize(options.batchSize ?? this.defaultOptions.batchSize),
      batchInterval: normalizeDelay(options.batchInterval, 0),
      timeout: normalizeDelay(options.timeout, DEFAULT_TIMEOUT_MS),
    }

    const startTime = Date.now()
    const id = this.generateSnapshotId()
    const errors: SnapshotError[] = []

    // 创建任务队列：容器字段按节点入队，每批处理 batchSize 个节点。
    // 以 queueHead 游标消费而非 Array#shift（后者每次搬移整个尾部，大批量入队下整体退化为
    // O(n²)）。游标只解决「消费侧 O(1)」，底层数组的回收另见 shouldCompactQueue 的压缩条件——
    // 每批都裁剪会把这个洞原样搬回压缩那一步
    const queue: AsyncCloneTask[] = []
    let queueHead = 0
    /** 超时后入队守卫丢掉的任务数：>0 即证明交付的 data 缺少对应子树（见 deliveryIncomplete） */
    let droppedTasks = 0
    const visited = new WeakMap<object, object>()

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

    // 设置超时：opts.timeout 已过 normalizeDelay，非有限值与非正值都归成 0，
    // 故这里的 `> 0` 只需区分「武装定时器」与「不设超时」两件事
    const timeoutId =
      opts.timeout > 0
        ? setTimeout(() => {
            hasTimedOut = true
          }, opts.timeout)
        : null

    // 计算预估总节点数
    // 经属性描述符读取：直接求值会额外触发 getter（副作用双调用），
    // getter 抛错时整个异步快照在入口即失败，不走 onError 降级路径
    //
    // 估算深度上限（MAX_ESTIMATE_DEPTH）刻意不跟随 opts.maxDepth：本函数是入口处的一次
    // 额外前序遍历，抬到 maxDepth（默认 100）等于把「估算」做成与克隆同量级的第二遍扫描，
    // 而它的唯一用途是给进度条一个分母。代价写清楚：深于该上限的结构被按叶子截断计数，
    // totalCount 因此系统性偏小，percentage 会提前饱和到 100、estimatedTimeRemaining 随之
    // 归零 —— 进度只可作近似观测，完成判据始终是 promise 落定与 result.success
    const MAX_ESTIMATE_DEPTH = 10
    const estimateNodeCount = (obj: unknown, depth = 0): number => {
      if (depth > MAX_ESTIMATE_DEPTH || obj === null || typeof obj !== 'object') return 1
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
    // 进度回调抛过的标记：抛错即记一次并停用，避免同一上报异常按批次刷爆错误账本
    let progressFailed = false
    const reportProgress = (currentPath: string) => {
      if (progressFailed) return
      const elapsed = Date.now() - startTime
      const percentage = Math.min(100, (processedCount / totalCount) * 100)
      // 无分支的剩余时间估算，与原先 `percentage > 0 ? (elapsed / percentage) * (100 - percentage) : 0`
      // 等价：percentage 为 0 时 Math.sign 归零使分子为 0，故结果为 0（避免 0/0 产生 NaN）；
      // 分母取下限 Number.MIN_VALUE 以防除零。该守卫在所有可达输入下恒为 percentage > 0
      // （processedCount 在报告前必已自增），istanbul 无法为不可达单侧做行级忽略，故改为无分支写法
      const perPercent = (elapsed * Math.sign(percentage)) / Math.max(percentage, Number.MIN_VALUE)
      const estimatedRemaining = perPercent * (100 - percentage)

      try {
        opts.onProgress({
          processed: processedCount,
          total: totalCount,
          percentage: Math.round(percentage * 100) / 100,
          currentPath,
          elapsedTime: elapsed,
          estimatedTimeRemaining: Math.round(estimatedRemaining),
        })
      } catch (error) {
        // onProgress 是「上报」代码而非决策代码：它抛错若向外传播，会穿过 processQueue 的
        // finally 落到外层 catch，把一份完好克隆降级为失败结果（data 变 undefined）。
        // 故就地吞掉并记一条 unknown（不参与 success 判定），克隆结果不受影响
        progressFailed = true
        errors.push({
          type: 'unknown',
          message: `onProgress callback failed: ${error instanceof Error ? error.message : String(error)}`,
          path: currentPath,
          originalError: error instanceof Error ? error : undefined,
        })
      }
    }

    // 入队（超时后不再接受新任务，避免队列无限增长）
    const enqueue = (task: AsyncCloneTask): void => {
      // 守卫保留、不删：hasTimedOut 由 setTimeout 回调置位，回调只在调用栈空时执行，
      // 而 enqueue 的全部调用点都在 processNodeAsync 内部、每批的 for 循环里（该循环
      // 不含 await，唯一的 await 在批末且被外层 while 的 !hasTimedOut 重新判定），
      // 所以「入队时已超时」在**当下的调用形状**下走不到 —— 这是实现细节而非逻辑不变量：
      // 一旦 processNodeAsync 改成真异步（批内出现 await），定时器就能在批中途翻转
      // hasTimedOut，本分支随即成为「超时后丢弃剩余任务」的生效点。
      // 因此下面的 ignore 只声明「当前测试覆盖不到 else 单侧」，不是「else 是死代码」
      /* istanbul ignore else -- 依赖「批内无 await」的调用形状，见上；未来批内让出即生效 */
      if (!hasTimedOut) queue.push(task)
      // 丢掉一个任务 = 它的整棵子树不会出现在交付的 data 里。这个计数是「交付不完整」的
      // 直接证据：超时翻位但一个任务都没丢、队列也已排空时，交付的就是一份完好克隆，
      // 不能因为定时器恰好在收尾那次让出期间翻位就判为失败（见结果组装处的 deliveryIncomplete）
      else droppedTasks++
    }

    // prop 占位的统一清理
    // 对象子值的占位在子任务被填充前就以 `key: undefined` 挂在父容器上（挂它是为了保住
    // 源对象的键序：填充按队列顺序发生，不占位会让克隆结果的键序与源不一致）。
    // 因此凡「本轮不会填充」的出口都必须摘掉占位，否则交付的 data 里会出现源数据中
    // 并不存在的 undefined 值——与同步路径「丢弃该属性则不写入」的口径也对不上
    const discardPropPlaceholder = (target: AsyncCloneTask['target']): void => {
      if (target && target.kind === 'prop') {
        try {
          delete (target.container as Record<string, unknown>)[target.key as string]
        } catch {
          // 占位清理失败不影响整体流程
        }
      }
    }

    // 队列压缩：已消费前缀不少于剩余长度时才裁一次底层数组。
    // 每批都 `splice(0, queueHead)` 的搬移量是 O(queue.length)（删头部要把全部尾部元素前移），
    // n 个任务、批大小 b 时总计 ΣO(Lᵢ) ≈ O(n²/b)，与被它替换掉的 Array#shift 同一个量级
    // （只是常数小 b 倍），且搬移每批都发生在让出控制权之后、直接计入批耗时；
    // 按「消费/剩余 ≥ 1」压缩则是摊还 O(1)/任务：每次搬移的元素数不超过触发它的那段已消费任务数
    const shouldCompactQueue = (): boolean => queueHead > 0 && queueHead >= queue.length - queueHead

    // 处理队列：每批处理 batchSize 个节点，批间让出控制权
    const processQueue = async (): Promise<void> => {
      try {
        while (queueHead < queue.length && !hasTimedOut) {
          // 回收已消费前缀（见 shouldCompactQueue：不是每批一次）
          if (shouldCompactQueue()) {
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
              // 该节点不会被填充，占位同样要摘掉（与下方 SKIP 分支同一口径）
              discardPropPlaceholder(task.target)
              processedCount++
              continue
            }
            processedCount++
            if (result === SKIP_CLONE_NODE) {
              // onError 选择继续但节点被丢弃：跳过填充；prop 占位一并移除，
              // 与同步路径「丢弃该属性」的语义一致（Map/Set/数组位置本就无占位）
              discardPropPlaceholder(task.target)
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
                    const slot = t.container as Record<string, unknown>
                    slot[t.key as string] = result
                  }
                } else if (t.kind === 'index') {
                  const slot = t.container as unknown[]
                  slot[t.key as number] = result
                } else if (t.kind === 'mapValue') {
                  const map = t.container as Map<unknown, unknown>
                  map.set(t.key, result)
                } else {
                  const set = t.container as Set<unknown>
                  set.add(result)
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

        // 超时退出时队列里仍有未处理的任务：它们永远不会有填充那一步，挂在父容器上的
        // prop 占位就以 `key: undefined` 的形式留在交付的半成品 data 里。摘掉后调用方
        // 读到的是「该键缺失」（与节点被丢弃的口径一致），而不是源数据中并不存在的 undefined 值。
        // 队列正常排空时本循环体不执行（queueHead === queue.length）
        for (let i = queueHead; i < queue.length; i++) {
          discardPropPlaceholder(queue[i].target)
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

      // 与 null 比，不判真值：宿主/注入式时钟可以返回 0 作定时器句柄（selectorComposer.ts
      // 的同族口径），真值判定会让这条 clearTimeout 永不执行——超时定时器在快照已交付后
      // 仍存活整个窗口，闭包连同 errors/queue/整棵克隆产物被多留一次超时周期
      if (timeoutId !== null) clearTimeout(timeoutId)

      // 更新共享 stats 的持续时间
      stats.duration = Date.now() - startTime

      const metadata: SnapshotMetadata = {
        id,
        timestamp: startTime,
        dataType: this.getDataType(data),
        size: counters.estimatedSize,
        // 与同步路径同口径取 counters.nodeCount：此前用 processedCount，它按「处理过的任务数」
        // 计数，会把 maxDepth 截断（clonePrelude 在自增 nodeCount 之前返回）与克隆失败的节点
        // 一并算进来，同一份输入两条路径的 metadata.nodeCount 对不上
        nodeCount: counters.nodeCount,
        maxDepth: counters.maxDepthReached,
        hasCircular: counters.hasCircular,
      }

      // 超时只在「本轮确有未交付的工作」时成立：定时器在最后一个批次之后翻位时（例如 timeout
      // 给得接近实际耗时），队列已排空、一个任务都没被入队守卫丢掉，交付的是**完整**克隆，
      // 而占位清理循环（上方 for 循环）一次也没跑。把它判为失败会让按 types.ts「先判 success」
      // 契约消费快照的调用方整份丢掉可用数据
      const deliveryIncomplete = queueHead < queue.length || droppedTasks > 0
      const timedOut = hasTimedOut && deliveryIncomplete

      return {
        // rootResult 只在根任务产出非哨兵值时才不是 undefined：超时/根节点被丢弃时它是
        // undefined 或半成品，故断言只到 `T | undefined`，不冒充完整的 T
        data: clonedData as T | undefined,
        metadata,
        // 与同步路径同口径：仅 cloneError 视为失败，circular/maxDepth 属可恢复降级
        success: !timedOut && !errors.some((e) => e.type === 'cloneError'),
        errors: timedOut ? [...errors, { type: 'timeout', message: 'Snapshot creation timed out', path: 'root' }] : errors,
        stats,
      }
    } catch (error) {
      // 同成功路径：与 null 比而非判真值，句柄为 0 时也要撤销定时器
      if (timeoutId !== null) clearTimeout(timeoutId)

      errors.push({
        type: 'unknown',
        message: error instanceof Error ? error.message : 'Unknown error',
        path: 'root',
        originalError: error instanceof Error ? error : undefined,
      })

      return this.buildFailureResult<T>(id, startTime, data, errors, stats)
    }
  }

  /**
   * 对比两个快照
   *
   * 契约同 diff.ts 的 `compareSnapshots`（实现已拆至 ./diff.js，纯函数，不依赖管理器实例状态）：
   * 两侧 `success` 不必先判，但任一侧为 false 时结果里的 `inputTrusted` 会是 false，
   * 此时 `changed: true` 只是「输入不可信 → 宁多勿漏」的报告形状，不代表两份 data 真有差异
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
   * 失败结果的统一构造（同步 / 异步两条 catch 共用）
   *
   * 两条失败分支此前各写一份 metadata 与 stats：异步那份还把 stats 换成全零新对象，
   * 而引擎在抛出前已经往共享 stats 里累加过 cloneOperations / circularReferences /
   * maxDepthHits，于是同一份输入在两条路径上的失败统计对不上。现在两条都交出共享 stats
   * （数值与实际工作量一致），metadata 的规模项仍归零——失败结果的 data 不可信，
   * 按它统计出的 size / nodeCount / maxDepth 同样不可信
   *
   * @param source 调用方传入的原始数据：只用于 dataType，**不会**进 data
   */
  private buildFailureResult<T>(id: string, timestamp: number, source: unknown, errors: SnapshotError[], stats: SnapshotStats): SnapshotResult<T> {
    stats.duration = Date.now() - timestamp

    return {
      // 失败快照不得回传调用方的原始引用：那会打破快照隔离契约，让调用方
      // 经返回值改到宿主持有的活状态（与 SKIP 哨兵降级路径同语义）
      data: undefined,
      metadata: {
        id,
        timestamp,
        dataType: this.getDataType(source),
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
   * 原型不可探测的值（Proxy 的 getPrototypeOf 陷阱抛错、已 revoke 的 Proxy）按 `typeof`
   * 归类：本方法在结果组装阶段被调用（成功路径与失败路径各一次），抛出会把 cloneDeep
   * 已按 onError 契约降级好的结果整个变成异常，等于在出口处重新制造 #288 那个洞；
   * 失败路径上它还在 catch 里，抛出会让 createSnapshot 连失败结果都不交付、直接向调用方抛
   *
   * `Array.isArray` 也在兜范围内：它与 `instanceof` 同走 [[Get]] / [[Class]] 内部方法，
   * 对 revoked Proxy 一样抛 TypeError。`value === null` 与兜底的 `typeof` 永不抛，留在外面
   *
   * @private
   */
  private getDataType(value: unknown): string {
    if (value === null) return 'null'
    try {
      if (Array.isArray(value)) return 'array'
      if (value instanceof Date) return 'date'
      if (value instanceof RegExp) return 'regexp'
      if (value instanceof Map) return 'map'
      if (value instanceof Set) return 'set'
    } catch {
      return typeof value
    }
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
