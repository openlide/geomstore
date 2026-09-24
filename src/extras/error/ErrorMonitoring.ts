/**
 * GeomStore - 错误监控和报警系统
 *
 * 提供完整的错误监控功能，包括：
 * - 错误上报
 * - 错误聚合
 * - 错误报告生成
 * - 性能预警
 */

import type { ErrorContext, ErrorReporter, ErrorGroup, ErrorReport, MonitoringConfig } from '../../types/error.js'
import { DEFAULT_MAX_GROUPS, ErrorAggregator } from './ErrorAggregator.js'
import { ConsoleReporter } from './reporters/ConsoleReporter.js'

// 上报器与聚合器已拆至子模块；此处再导出以保持既有导入路径（extras/error/ErrorMonitoring.js）不变
export { ConsoleReporter } from './reporters/ConsoleReporter.js'
export { HttpReporter } from './reporters/HttpReporter.js'
export type { HttpRequestImpl } from './reporters/HttpReporter.js'
export { ErrorAggregator } from './ErrorAggregator.js'

/**
 * 队列容量与「全部报告器连续失败」重试次数的缺省值。
 *
 * 仅当 `MonitoringConfig` 的对应字段缺省或非有限值时使用（见 `normalizeCapacity`）。
 */
const DEFAULT_MAX_QUEUE_SIZE = 1000
const DEFAULT_MAX_FLUSH_RETRIES = 3

/**
 * 容量/次数类配置归一化：非有限值回退缺省，其余向下取整并夹到 `min` 以上
 *
 * `??` 只挡得住 `undefined`，`0` / 负数 / NaN 都会原样进到
 * `errorQueue.length >= this.maxQueueSize` 这类比较里：`maxQueueSize: 0` 时每条新错误
 * 都先把上一条 shift 掉（队列实际最多 1 条）、负值时重入队的
 * `slice(requeued.length - maxQueueSize)` 直接算出空数组（整批被清空）；
 * `maxFlushRetries` 取负则首个失败批次立即被丢弃。这些值没有可用语义，故按下限裁剪，
 * 而不是让整条上报链近乎静默失效
 */
function normalizeCapacity(value: number | undefined, fallback: number, min: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(min, Math.floor(value))
}

/**
 * 报告器列表归一化：非数组退回空数组并出声，数组则收一份**私有副本**
 *
 * 两点各挡一类事故：
 *
 * - **缺失/非数组**。`Partial<MonitoringConfig>` 允许显式写 `reporters: undefined`
 *   （本库未开 `exactOptionalPropertyTypes`），于是 `{ ...defaults, ...config }` 会用一个
 *   值为 undefined 的 own 键把默认的 `[new ConsoleReporter()]` 顶掉。不归一化的后果链是
 *   `doFlushReports` 里 `this.reporters.map(...)` 同步抛 TypeError：阈值触发的
 *   `await this.flushReports()` 让 `report()` 自身 reject（而它的典型调用点是 catch 块里
 *   不 await 的调用，直接成 unhandledRejection）、周期调度器每个 batchInterval 重复报错、
 *   队列永远排不空并涨到 maxQueueSize 后开始丢包。按「配置错不抛错但出声」的既有口径
 *   退回空数组（只留聚合与告警，不启动投递）并 warn 留痕。
 * - **别名**。直接把调用方的数组存下来，`addReporter()` 就是往**那个数组**里 push：同一份
 *   config 复用给两个实例时，一处注册会跨实例生效；调用方保留的那份数组也被库偷偷改了。
 *   而 `removeReporter()` 又重新赋值成新数组——同一个 API 在两种调用历史下有不同的可观察
 *   副作用。构造期复制一次，「谁持有报告器列表」从此固定为本模块。
 */
function normalizeReporters(reporters: ErrorReporter[] | undefined): ErrorReporter[] {
  if (Array.isArray(reporters)) {
    return [...reporters]
  }
  console.warn('[ErrorMonitoring] config.reporters 不是数组，已按「无报告器」处理：错误仍会聚合与告警，但不会投递到任何端')
  return []
}

/**
 * 错误监控系统
 *
 * @class ErrorMonitoring
 * @description
 * 统一的错误监控系统，支持多个报告器、批量上报和错误聚合
 *
 * @example
 * ```typescript
 * const monitoring = new ErrorMonitoring({
 *   reporters: [
 *     new ConsoleReporter(),
 *     new HttpReporter('https://api.example.com/errors')
 *   ],
 *   batchInterval: 5000,
 *   batchThreshold: 10,
 *   enableAggregation: true,
 *   enableConsoleLog: true
 * })
 *
 * // 上报错误
 * await monitoring.report(errorContext)
 *
 * // 获取错误报告
 * const report = monitoring.generateReport()
 * console.log(report)
 * ```
 */
export class ErrorMonitoring {
  /** 本模块私有的一份报告器列表（构造期复制，见 `normalizeReporters`） */
  private reporters: ErrorReporter[]
  private batchInterval: number
  private batchThreshold: number
  private enableAggregation: boolean
  private enableConsoleLog: boolean
  private reportTimeout: number

  private errorQueue: ErrorContext[] = []
  private aggregator: ErrorAggregator
  private batchTimer?: ReturnType<typeof setInterval>
  private isFlushing = false
  /** 在途 flush 的 Promise（shutdown 等待其完成后再做最终上报） */
  private inFlightFlush: Promise<void> | null = null
  private isShuttingDown = false
  private nonAggregatedErrorCount = 0 // 禁用聚合时记录的错误数
  /** 防止队列无限增长的最大大小（由 MonitoringConfig.maxQueueSize 经下限裁剪得到） */
  private readonly maxQueueSize: number
  /** 连续「全部报告器失败」的 flush 次数：用于给重入队加上限，见 doFlushReports */
  private consecutiveFlushFailures = 0
  /** 重入队重试上限：超过后丢弃该批并告警，避免永久失败批次无限空转 */
  private readonly maxFlushRetries: number
  /**
   * 数据代际：`clear()` 递增
   *
   * 用于作废 clear() 之前发起的在途 flush——它的批次属于上一代数据，
   * 全部报告器失败时不得再重新入队（见 doFlushReports 的判定）
   */
  private generation = 0
  /** 因队列溢出被丢弃的错误条数（含入队淘汰与重入队裁剪两条路径） */
  private droppedErrors = 0

  constructor(config: MonitoringConfig) {
    // 归一化 + 收私有副本：见 `normalizeReporters`（它同时堵上「显式 undefined 顶掉默认值」
    // 与「与调用方共享同一个数组」两个缺口）
    this.reporters = normalizeReporters(config.reporters)
    // 用 ?? 而非 ||：batchInterval / batchThreshold / reportTimeout 的 0 是合法语义
    // （立即/无延迟、立即上报、不超时），|| 会把显式传入的 0 静默替换为默认值
    this.batchInterval = config.batchInterval ?? 5000
    this.batchThreshold = config.batchThreshold ?? 10
    this.enableAggregation = config.enableAggregation ?? true
    this.enableConsoleLog = config.enableConsoleLog ?? true
    this.reportTimeout = config.reportTimeout ?? 10000
    // 容量类字段走归一化而非 ??：见 normalizeCapacity
    this.maxQueueSize = normalizeCapacity(config.maxQueueSize, DEFAULT_MAX_QUEUE_SIZE, 1)
    this.maxFlushRetries = normalizeCapacity(config.maxFlushRetries, DEFAULT_MAX_FLUSH_RETRIES, 0)

    // 聚合组上限同样走归一化：`maxGroups` 是「存活组数」的唯一约束（驱逐即丢组本体），
    // 传 0/负数/NaN 会让每次 record 都把刚建的组踢掉，账面变成「收得到错误但永远没有组」
    this.aggregator = new ErrorAggregator(normalizeCapacity(config.maxGroups, DEFAULT_MAX_GROUPS, 1))

    // 批量调度器延迟到首次 report 时启动：
    // 避免仅 import 本模块（或 re-export 它的入口）就产生常驻定时器
  }

  /**
   * 上报错误
   *
   * @param {ErrorContext} context - 错误上下文
   * @returns {Promise<void>}
   *
   * @example
   * ```typescript
   * await monitoring.report(errorContext)
   * ```
   */
  async report(context: ErrorContext): Promise<void> {
    if (this.isShuttingDown) {
      return
    }

    // 检查队列大小，防止无限增长
    if (this.errorQueue.length >= this.maxQueueSize) {
      console.warn('[ErrorMonitoring] Error queue full, dropping oldest error')
      this.errorQueue.shift()
      // 被丢的那条在它自己那次 report() 里已经计入聚合（或 nonAggregatedErrorCount），
      // 而 totalErrors 的口径是「观测到的错误」——不回退那份计数，而是把「其中有多少
      // 从未投递给任何 reporter」单独记账，两个口径才能同时成立
      this.droppedErrors++
    }

    // 聚合错误
    if (this.enableAggregation) {
      this.aggregator.addError(context)
    } else {
      // 禁用聚合时，计数但不分组
      this.nonAggregatedErrorCount++
    }

    // 控制台日志
    if (this.enableConsoleLog) {
      console.error('[ErrorMonitoring]', context)
    }

    // 加入批量队列
    this.errorQueue.push(context)

    // 惰性启动批量调度器（仅在首次上报时创建）
    if (!this.batchTimer) {
      this.startBatchScheduler()
    }

    // 检查是否达到批量阈值
    // 注意：这里的 await 只保证等到「在途那次 flush」结束，不保证本条错误已上报——
    // 每次 flush 只发送进入时快照的批次，快照后才入队的条目（含本条并发入队者）
    // 留给下一次（周期/shutdown）。需要即时排空应重复 await flushReports 直至不再返回在途
    if (this.errorQueue.length >= this.batchThreshold) {
      await this.flushReports()
    }
  }

  /**
   * 立即上报队列中的错误
   *
   * 语义边界：本次 flush 发送的是进入时快照的队列，flush 期间新入队的错误
   * 不在其中；已有 flush 在途时返回该 flush 的 Promise，resolve 仅代表那一批
   * 已处理完，当前队列可能仍有条目未发送。因此本方法**不是**「排空队列」的保证，
   * 需要排空语义请使用 shutdown()（它会等在途 flush 并做最终上报）
   *
   * @returns {Promise<void>}
   */
  async flushReports(): Promise<void> {
    if (this.errorQueue.length === 0 || this.isFlushing) {
      // 已有 flush 在途：返回其 Promise，调用方等待的是真实完成而非立即返回
      return this.inFlightFlush ?? undefined
    }

    this.isFlushing = true
    // 记录在途 flush 的 Promise：shutdown 需先等待它完成再做最终 flush，
    // 否则最终 flush 被入口守卫跳过，进程可能在报文发出前退出导致尾部错误丢失
    const flush = this.doFlushReports()
    this.inFlightFlush = flush
    return flush
  }

  /**
   * 执行批量上报（flushReports 已设置 isFlushing 与 inFlightFlush）
   *
   * @private
   */
  private async doFlushReports(): Promise<void> {
    const batch = [...this.errorQueue]
    this.errorQueue = []
    // 进入时所属的数据代际：clear() 之后本批即成为上一代数据，见其重入队处的判定
    const generation = this.generation

    // 注意：不清除周期调度器（batchTimer）。
    // flush 与周期调度是两个独立职责，若在 flush 中清除会导致
    // 阈值触发的 flush 永久杀死周期上报；调度器由 shutdown() 统一清理

    try {
      // 上报到所有报告器。reportBatch 仅类型约束返回 Promise，同步抛错完全合法：
      // 经 Promise.resolve().then 包装消除同步抛点，避免异常绕过 try/finally 使
      // isFlushing 永久为 true，之后所有 flush（周期/阈值/shutdown）静默失效。
      // 三态判定：只有任务真正 resolve 才算成功；超时不是成功——否则弱网/服务端
      // 黑洞（最需要重试的场景）下批次既不算失败也不确认送达，被直接丢弃。
      //
      // 超时后重入队的前提是**请求已真正结束**：Promise.race 只放行 flush，不终止
      // 输掉竞速的 reporter 任务，若底层请求仍在飞，迟到落地就会与重试形成重复投递。
      // 内置 HttpReporter 的 fetch 路径会自行到点结束（AbortController 中止，默认 10s）；
      // wx 路径只在调用方显式配了 timeout 时才自行结束，否则依赖平台自身的请求上限。
      // 注入自定义 ErrorReporter 时该责任在注入方，需由其自行保证请求可取消——
      // 这是本层 race 之外的约定，不在此处强制
      let anyReporterSucceeded = false
      const promises = this.reporters.map((reporter) => {
        const task = Promise.resolve()
          .then(() => reporter.reportBatch(batch))
          .then(
            () => 'ok' as const,
            (error) => {
              console.error('[ErrorMonitoring] Error in reportBatch:', error)
              return 'fail' as const
            },
          )
        // reportTimeout <= 0 表示「不超时」（见构造器注释）：此时不得创建定时器，
        // 否则 setTimeout(resolve, 0) 在下一个宏任务先到期，任何真实异步上报
        // （网络请求）都会被误判超时 → 重入队 → 按 maxFlushRetries 丢弃
        let settled: Promise<'ok' | 'fail' | 'timeout'>
        let cancelTimeout: () => void = () => {}
        if (this.reportTimeout > 0) {
          const timeout = this.delay(this.reportTimeout)
          cancelTimeout = timeout.cancel
          settled = Promise.race([task, timeout.promise.then(() => 'timeout' as const)])
        } else {
          settled = task
        }
        return (
          settled
            .then((outcome) => {
              if (outcome === 'ok') {
                anyReporterSucceeded = true
              } else if (outcome === 'timeout') {
                console.warn(`[ErrorMonitoring] Reporter "${reporter.getName()}" timed out after ${this.reportTimeout}ms`)
              }
            })
            // 上报先落地（成功/失败）时取消未到期的超时定时器，避免句柄残留
            .finally(cancelTimeout)
        )
      })
      await Promise.allSettled(promises)

      // 代际已切换（flush 在途期间调过 clear()）：本批是上一代数据，整批丢弃——
      // 重新入队会把 clear() 之前的旧错误交给周期调度器上报（等于 clear() 没生效），
      // 而 consecutiveFlushFailures++ 又把 clear() 刚归零的进度带回 1
      // （clear() 的文档承诺正是「不把进度泄漏到新周期」）
      if (generation !== this.generation) {
        return
      }

      // 关闭中不重试：shutdown 会用最终 flushReports 排空队列，
      // 若此处重新入队，最终 flush 会再次调用已失败的 reportBatch——
      // 对挂起/已退出的上报端无限等待，shutdown 永不返回
      if (this.isShuttingDown || batch.length === 0) {
        return
      }
      if (anyReporterSucceeded) {
        this.consecutiveFlushFailures = 0
        return
      }

      // 全部报告器失败：报文重新入队等待下次 flush 重试，否则网络抖动期间产生的
      // 错误会被静默丢弃。但重试必须有上限——reporters 为空数组（promises 为空，
      // anyReporterSucceeded 恒 false）、或唯一报告器恒失败（如某条 payload 含循环
      // 引用使 JSON.stringify 每次抛错）时，无上限的重入队会让该批每个 batchInterval
      // 空转一次：永不落地也永不丢弃，还会持续把队列顶到上限、连带淘汰掉正常错误
      this.consecutiveFlushFailures++
      if (this.consecutiveFlushFailures > this.maxFlushRetries) {
        console.warn(
          `[ErrorMonitoring] 连续 ${this.consecutiveFlushFailures} 次上报全部失败` +
            `（当前报告器数: ${this.reporters.length}），丢弃本批 ${batch.length} 条错误以避免无限重入队`,
        )
        this.consecutiveFlushFailures = 0
        return
      }

      // 置于队首保持时序：失败批次早于 flush 期间新入队的条目。
      // 超出容量时保留队尾、丢弃队首（即优先丢弃最旧），与 report() 中「队列满则
      // shift 丢弃最旧错误」同一口径——溢出已是过载降级状态，全类统一按最旧先淘汰，
      // 不为此处开「保旧」特例（那会与入队路径的淘汰方向相反，反而更难推理）
      const requeued = [...batch, ...this.errorQueue]
      if (requeued.length > this.maxQueueSize) {
        const dropped = requeued.length - this.maxQueueSize
        this.droppedErrors += dropped
        // 与入队路径同口径：丢弃必须可被统计消费，只留一行 warn 的话「丢了多少」
        // 在报告里查不到，容量持续吃紧时也就无人发现
        console.warn(`[ErrorMonitoring] Error queue full, dropped ${dropped} oldest error(s) while re-queueing failed batch`)
        this.errorQueue = requeued.slice(dropped)
      } else {
        this.errorQueue = requeued
      }
    } finally {
      this.isFlushing = false
      this.inFlightFlush = null
    }
  }

  /**
   * 生成错误报告
   *
   * `summary.totalErrors` 的口径是「**观测到的**错误数」（聚合启用时取
   * `ErrorAggregator.getStats().totalErrors`，禁用时取 nonAggregatedErrorCount），其中：
   * - 因队列溢出被丢弃的部分从未投递给任何 reporter 却仍然计入——它们是真实发生过的错误；
   *   被丢弃的量随报告给出（`summary.droppedErrors`），不必再取
   *   {@link ErrorMonitoring.getDroppedErrors}；`summary.queuedErrors` 只表示仍在队列里的。
   * - 聚合组被 `maxGroups` 驱逐**不会**让它倒退：账目按条独立累计，驱逐量见
   *   `getAggregationStats()` 的 `evictedErrors` / `evictedGroups`。
   *
   * 三个字段是三个互不重叠的口径，**不能相加核对**：`droppedErrors` 记的是「被从队列里挤出去」
   * 的次数（被挤掉的那条在它自己那次 `report()` 里已经计入 `totalErrors`），
   * 而成功投递过的错误既不在 `queuedErrors` 里也不在 `droppedErrors` 里。
   *
   * 注意 `summary.totalGroups` / `topErrors` / `recentErrors` 只反映**当前存活**的组，
   * 与 `totalErrors` 不是同一口径（前者会随驱逐变小）。
   *
   * @returns {ErrorReport} 错误报告
   *
   * @example
   * ```typescript
   * const report = monitoring.generateReport()
   * console.log('Total Errors:', report.summary.totalErrors)
   * console.log('Top Errors:', report.topErrors)
   * ```
   */
  generateReport(): ErrorReport {
    const stats = this.aggregator.getStats()
    const groups = this.aggregator.getGroups()

    // 计算总错误数
    const totalErrors = this.enableAggregation ? stats.totalErrors : this.nonAggregatedErrorCount

    return {
      generatedAt: Date.now(),
      summary: {
        totalGroups: stats.totalGroups,
        totalErrors,
        queuedErrors: this.errorQueue.length,
        // 丢包数进报告：只看 `getDroppedErrors()` 的话，拿到报告快照的下游（日志/上传/看板）
        // 读到的是一个「总数对得上」的报表，而上报链其实已经丢过数据
        droppedErrors: this.droppedErrors,
      },
      byCode: stats.byCode,
      byStore: stats.byStore,
      topErrors: groups.sort((a, b) => b.count - a.count).slice(0, 10),
      recentErrors: groups.sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 10),
    }
  }

  /**
   * 获取聚合统计
   *
   * 透传 `ErrorAggregator.getStats()`：除 `totalGroups`（存活组数）外的各项都是
   * 「自上次 clear() 以来观测到的」口径，另含驱逐留痕 `evictedGroups` / `evictedErrors`。
   *
   * @returns {object} 聚合统计
   */
  getAggregationStats() {
    return this.aggregator.getStats()
  }

  /**
   * 获取错误组
   *
   * 返回浅拷贝（`affectedStores` 与 `sampleError` 也各拷一层）：内部组长期驻留且仍会随
   * 新错误继续累计，直接交出引用等于让调用方一句 `group.count = 0` 就改坏
   * `getAggregationStats()`/`byStore`/`byCode` 的账目
   *
   * @returns {ErrorGroup[]} 错误组
   */
  getErrorGroups(): ErrorGroup[] {
    return this.aggregator.getGroups()
  }

  /**
   * 获取因队列溢出被丢弃的错误条数
   *
   * 两条路径都会累加：入队时容量已满（淘汰最旧一条）、失败批次重入队时超出容量
   * （裁掉队首）。`clear()` 会把它与其余数据一起归零，故该值表示「自上次 clear() 以来」
   * 的丢失量
   *
   * @returns {number} 被丢弃的错误条数
   *
   * @example
   * ```typescript
   * const dropped = monitoring.getDroppedErrors()
   * if (dropped > 0) console.warn(`上报链 overloaded, ${dropped} errors dropped`)
   * ```
   */
  getDroppedErrors(): number {
    return this.droppedErrors
  }

  /**
   * 清除所有数据
   *
   * 只清数据（队列、聚合统计、连续失败计数、丢弃计数），不停止周期调度器、也不影响在途
   * flush 的**网络请求本体**——但代际会切换，故在途 flush 不会再把它抓到的旧批次
   * 重新入队（见 doFlushReports）；调度器仍会到期 flush 清除后新入队的错误；
   * 需要「停止」语义请用 shutdown()
   */
  clear(): void {
    this.generation++
    this.errorQueue = []
    this.aggregator.clear()
    this.nonAggregatedErrorCount = 0
    // 连续失败计数属于「数据」而非「调度器状态」：不清零则 clear() 前接近
    // maxFlushRetries 的进度会泄漏到新周期，clear() 后首个新批次提前触发丢弃
    this.consecutiveFlushFailures = 0
    this.droppedErrors = 0
  }

  /**
   * 添加报告器
   *
   * 写的是本实例自己的那份数组（构造期已复制，见 `normalizeReporters`）：
   * 直接 push 进调用方传进来的数组会让同一份 config 复用给两个实例时一处注册跨实例生效
   *
   * @param {ErrorReporter} reporter - 错误报告器
   */
  addReporter(reporter: ErrorReporter): void {
    this.reporters.push(reporter)
  }

  /**
   * 移除报告器
   *
   * 与 {@link addReporter} 一样只作用于构造期收下的私有副本，不再出现
   * 「add 改到调用方数组、remove 另起新数组」的方向差异
   *
   * @param {string} name - 报告器名称
   */
  removeReporter(name: string): void {
    this.reporters = this.reporters.filter((r) => r.getName() !== name)
  }

  /**
   * 关闭监控系统
   *
   * @returns {Promise<void>}
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true

    // 清除周期调度器（用 clearInterval 明确语义，避免与 timeout 句柄混淆）
    if (this.batchTimer) {
      clearInterval(this.batchTimer)
      this.batchTimer = undefined
    }

    // 先等待在途 flush 完成：避免最终 flush 被 isFlushing 守卫跳过
    if (this.inFlightFlush) {
      await this.inFlightFlush.catch(() => {})
    }

    // 上报剩余错误
    await this.flushReports()
  }

  /**
   * 启动批量调度器
   *
   * @private
   */
  private startBatchScheduler(): void {
    const timer = setInterval(() => {
      this.flushReports().catch((error) => {
        console.error('[ErrorMonitoring] Error in batch scheduler:', error)
      })
    }, this.batchInterval)
    // 调用 unref() 让定时器不阻止 Node.js 进程退出（解决测试/小程序环境句柄泄漏）
    const timerWithUnref = timer as unknown as { unref?: () => void }
    if (timer && typeof timerWithUnref.unref === 'function') {
      timerWithUnref.unref()
    }
    this.batchTimer = timer
  }

  /**
   * 延迟执行
   *
   * @private
   * @param {number} ms - 延迟毫秒数
   * @returns {Promise<void>}
   */
  private delay(ms: number): { promise: Promise<void>; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined
    const promise = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms)
      // unref()：退避等待定时器不应阻止 Node.js 进程/测试 worker 退出
      // （与 batchTimer 的 unref 处理一致，小程序/浏览器环境无 unref 时跳过）
      const timerWithUnref = timer as unknown as { unref?: () => void }
      if (typeof timerWithUnref.unref === 'function') {
        timerWithUnref.unref()
      }
    })
    // 返回取消句柄：上报先落地时必须清掉未到期的超时定时器，
    // 否则每次 flush 都会为每个报告器残留一个（默认 10s 后才到期）的定时器
    return {
      promise,
      cancel: () => {
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
      },
    }
  }
}

/**
 * 创建默认的错误监控系统
 *
 * `reporters` 只在调用方真给出数组时才覆盖默认值：`config` 是 `Partial<MonitoringConfig>`，
 * 显式写成 undefined 的 `reporters` 键（本库未开 `exactOptionalPropertyTypes`）会把默认的
 * {@link ConsoleReporter} 顶掉，故这里按「缺省 === 未配置」处理而不是无条件展开。
 *
 * @param {Partial<MonitoringConfig>} [config] - 配置选项
 * @returns {ErrorMonitoring} 错误监控系统实例
 *
 * @example
 * ```typescript
 * const monitoring = createDefaultMonitoring({
 *   enableConsoleLog: true,
 *   batchInterval: 10000
 * })
 * ```
 */
export function createDefaultMonitoring(config?: Partial<MonitoringConfig>): ErrorMonitoring {
  const givenReporters = config?.reporters
  const defaultConfig: MonitoringConfig = {
    batchInterval: 5000,
    batchThreshold: 10,
    enableAggregation: true,
    enableConsoleLog: true,
    reportTimeout: 10000,
    ...config,
    // reporters 这一项必须落在展开**之后**：`Partial<MonitoringConfig>` 允许显式写
    // `reporters: undefined`（本库未开 exactOptionalPropertyTypes，「从应用配置拼装」时很常见），
    // 让 config 无条件覆盖就会把它顶成 undefined，于是每次 flush 在 `this.reporters.map`
    // 处同步抛 TypeError、整条投递链失效。缺省与显式 undefined 同义（回到默认 ConsoleReporter），
    // 真给了数组才尊重调用方的列表（`[]` 是「确实要不投递」的合法表达）；
    // 给了非数组的值原样透传，由构造器的 `normalizeReporters` 出声，与直接 new 同口径
    reporters: givenReporters === undefined ? [new ConsoleReporter()] : givenReporters,
  }

  return new ErrorMonitoring(defaultConfig)
}

/**
 * 导出全局默认实例（惰性创建）
 *
 * 注意：首次访问才创建实例并（在首次 report 时）启动批量调度器，
 * 避免仅 import 本模块就产生常驻定时器
 */
let _defaultMonitoring: ErrorMonitoring | undefined

/**
 * 获取全局默认的错误监控实例（惰性单例）
 *
 * @returns {ErrorMonitoring} 默认错误监控实例
 */
export function getDefaultMonitoring(): ErrorMonitoring {
  if (!_defaultMonitoring) {
    _defaultMonitoring = createDefaultMonitoring()
  }
  return _defaultMonitoring
}
