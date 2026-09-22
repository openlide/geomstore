/**
 * GeomStore - 错误聚合器
 *
 * 自 ErrorMonitoring.ts 拆出：将相似的错误聚合成组，便于分析和报告。
 *
 * @module extras/error/ErrorAggregator
 */

import type { ErrorContext, ErrorGroup } from '../../types/error.js'
import { isGeomStoreError } from '../../core/errors/GeomStoreError.js'

/** 参与组指纹的堆栈前缀长度（见 `ErrorAggregator#buildFingerprint` 的口径说明） */
const STACK_FINGERPRINT_CHARS = 100

/**
 * 一个错误组及其全部记账数据
 *
 * 组、按 Store 的次数、指纹三者生命周期完全一致（建组时一起出现、驱逐/clear 时一起消失），
 * 分放三张表就是三处需要同步的删除点——漏一处即留下永久无人清理的孤儿计数
 * （`sum(byStore) > totalErrors` 就是这么来的）。收进同一个对象后无从漏删。
 */
interface GroupEntry {
  /** 聚合体本体（对外读取时经 `copyGroup` 复制，见 `getGroups`） */
  group: ErrorGroup

  /** 建组时使用的指纹原文，驱逐时据此删掉反向索引条目 */
  fingerprint: string

  /** 「Store → 该组内该 Store 的次数」 */
  hits: Map<string, number>
}

/**
 * 复制一个错误组用于对外交付
 *
 * 内部组是可变对象且长期驻留：直接把引用交给调用方，则一句 `group.count = 0` 或
 * `group.affectedStores.push('x')` 就会让此后所有 `getStats()`/`byStore`/`byCode` 失真，
 * 且无从发现。两个容器字段各拷一层，`sampleError.error` 按约定是外部持有的不可变引用。
 */
function copyGroup(group: ErrorGroup): ErrorGroup {
  return {
    ...group,
    affectedStores: [...group.affectedStores],
    sampleError: { ...group.sampleError },
  }
}

/**
 * 错误聚合器
 *
 * 将相似的错误聚合成组，便于分析和报告
 */
export class ErrorAggregator {
  /** groupId → 组及其记账数据 */
  private readonly groups = new Map<string, GroupEntry>()

  /**
   * 指纹原文 → groupId 的反向索引
   *
   * 组 ID 只由 32 位哈希压缩而来，必然存在碰撞概率；这里保留「同一指纹 ⇒ 同一 ID」的
   * 映射，命中已有键时复用原 ID，未登记时才线性探测空闲槽位，避免无关错误被静默折叠成
   * 同一组（那会让 `count` 与 `affectedStores` 从此失真且无从发现）。
   *
   * 存**正向**表（groupId → 指纹）不足以保证该不变量：驱逐一组时只能删掉它的条目，
   * 于是排队探测到 `base~2` 的指纹会在占着 `base` 的邻居被驱逐后改判到 `base`，
   * 同一指纹从此分裂成两个组（旧组仍在 `base~2` 累计，新组从 count=1 重新起算）。
   * 反向表按指纹寻址，ID 一旦分配就不再改；条目与组同生命周期（建组时写入、驱逐/clear 时删除），
   * 故规模同样被 maxGroups 约束，不会单独增长。
   */
  private readonly groupIdByFingerprint = new Map<string, string>()

  private readonly maxGroups: number

  constructor(maxGroups: number = 100) {
    this.maxGroups = maxGroups
  }

  /**
   * 添加错误到聚合器
   *
   * @param {ErrorContext} context - 错误上下文
   * @returns {ErrorGroup | undefined} 错误组（如果是新创建的）
   */
  addError(context: ErrorContext): ErrorGroup | undefined {
    const fingerprint = this.buildFingerprint(context)
    const groupId = this.resolveGroupId(fingerprint)
    const error = context.error
    const code = isGeomStoreError(error) ? error.code : 'UNKNOWN'
    const now = context.timestamp || Date.now()

    // context.error 只是「契约上」的 Error：`throw null` / 抛非 Error 值都会流到这里
    // （defaultErrorHandler 与 describeErrorProperty 已按此设防，buildFingerprint 也做了
    // 保护式读取）。裸读 error.name 会抛 TypeError，而此刻该组的计数已写入，
    // 组却没建出来——清理只遍历已存在的组，这条孤儿计数永远留在表里，
    // sum(byStore) 自此永久大于 totalErrors。故先保护式取值、组建好之后再计数。
    const type = typeof error?.name === 'string' ? error.name : 'Error'
    const message = typeof error?.message === 'string' ? error.message : String(error)

    // 检查是否已存在该组
    const existing = this.groups.get(groupId)
    if (existing) {
      const group = existing.group
      // 更新组信息
      group.count++
      group.lastSeen = now

      // 更新受影响的Store
      if (!group.affectedStores.includes(context.storeName)) {
        group.affectedStores.push(context.storeName)
      }
      // 样本刷新为最近一次出现：首次 occurrence 往往是最不具代表性的一次，
      // 且组可能长期存活，冻结的样本会让诊断停留在过期状态
      group.sampleError = this.copySample(context, now)
      this._countStoreHit(existing, context.storeName)

      return undefined
    }

    // 创建新的错误组
    const newGroup: ErrorGroup = {
      groupId,
      type,
      code,
      message,
      count: 1,
      firstSeen: now,
      lastSeen: now,
      affectedStores: [context.storeName],
      sampleError: this.copySample(context, now),
    }

    const entry: GroupEntry = { group: newGroup, fingerprint, hits: new Map() }
    this.groups.set(groupId, entry)
    this.groupIdByFingerprint.set(fingerprint, groupId)
    this._countStoreHit(entry, context.storeName)

    // 限制组数量
    if (this.groups.size > this.maxGroups) {
      this.cleanupOldGroups()
    }

    // 交给调用方的是副本：返回内部引用的话，调用方（ErrorMonitoring 之外也有直接使用者）
    // 改写计数就会污染后续所有统计
    return copyGroup(newGroup)
  }

  /**
   * 获取所有错误组
   *
   * 按最近出现时间倒序，条目为浅拷贝（改返回值不影响内部状态）
   *
   * @returns {ErrorGroup[]} 错误组数组
   */
  getGroups(): ErrorGroup[] {
    return Array.from(this.groups.values(), (entry) => copyGroup(entry.group)).sort((a, b) => b.lastSeen - a.lastSeen)
  }

  /**
   * 获取指定Store的组
   *
   * @param {string} storeName - Store名称
   * @returns {ErrorGroup[]} 错误组数组
   */
  getGroupsByStore(storeName: string): ErrorGroup[] {
    return this.getGroups().filter((group) => group.affectedStores.includes(storeName))
  }

  /**
   * 记录一次「组内某 Store」的错误计数
   *
   * 单独按次计数而非按组求和：错误组会把同一站点在不同 Store 的报错合并为一条，
   * 若把组 count 累加给每个受影响 Store，跨 Store 的组会重复计入，byStore 之和超过 totalErrors。
   * 计数随组一起存放，组被 maxGroups 驱逐时同步消失，因此
   * `sum(byStore) === totalErrors` 在驱逐后依旧成立（此前独立累计的口径会永久偏离）。
   *
   * @private
   */
  private _countStoreHit(entry: GroupEntry, storeName: string): void {
    entry.hits.set(storeName, (entry.hits.get(storeName) ?? 0) + 1)
  }

  /**
   * 清理旧的错误组
   *
   * 只驱逐「最近最少出现」的一组，不复用 getGroups()：那会把整个 Map 复制成数组
   * 再排序（O(n log n) + n 个临时对象），而本方法在组数达到上限后的**每次** addError
   * 都会进入，属于错误高发期的热路径。线性扫描取最小 lastSeen 即可，不分配临时数组。
   * 新增一组最多越界一组，while 只是对 maxGroups 被改小等异常情形的兜底。
   *
   * @private
   */
  private cleanupOldGroups(): void {
    while (this.groups.size > this.maxGroups) {
      let victimId: string | undefined
      let victim: GroupEntry | undefined
      let oldest = Infinity
      for (const [groupId, entry] of this.groups) {
        // 严格小于：lastSeen 同分（同一毫秒内高发）时取 Map 迭代顺序里更早的一组，
        // 即「同样久未出现就先淘汰建组更早的那组」，方向确定且与插入顺序一致
        if (entry.group.lastSeen < oldest) {
          oldest = entry.group.lastSeen
          victimId = groupId
          victim = entry
        }
      }
      /* istanbul ignore if -- groups.size > maxGroups(>=1) 时循环体必然非空 */
      if (victimId === undefined || victim === undefined) {
        return
      }
      this.groups.delete(victimId)
      // 指纹索引与组同生命周期：留下条目会让该指纹此后一直解析到这个已释放的 ID，
      // 而删掉它则与「组已不存在、下次出现即新建一组」的语义一致
      this.groupIdByFingerprint.delete(victim.fingerprint)
    }
  }

  /**
   * 构造判定「同一错误」的指纹
   *
   * 归并粒度维持 name + message + 堆栈前 `STACK_FINGERPRINT_CHARS` 个字符：
   * 「同一逻辑错误的多次抛出跨调用点归为一组」是本库对外承诺的聚合口径
   * （ErrorMonitoring 的 MONITOR-008/014/015/062 用例即固化了它），堆栈头部长度
   * 恰好落在 file:line 之前，改成全文堆栈会把同一逻辑错误按行号打散。
   * 真正的缺陷不在此而在「哈希相同即并入」，由 resolveGroupId 的指纹→ID 反向索引兜住。
   *
   * @private
   */
  private buildFingerprint(context: ErrorContext): string {
    const error = context.error
    const stack = typeof error?.stack === 'string' ? error.stack.slice(0, STACK_FINGERPRINT_CHARS) : ''
    return `${String(error?.name)}:${String(error?.message)}:${stack}`
  }

  /**
   * 由指纹求出（无碰撞的）组 ID
   *
   * 哈希只用于压缩 Map 键长，不承担正确性：先在反向索引里复用该指纹既有的 ID，
   * 未登记时按 `base~n` 线性探测一个**当前空闲**的槽位（被别的组占着就继续探），
   * 因此不同指纹永不共享同一组。ID 的实际占用与索引由 `addError` 的建组分支一起写入。
   *
   * @private
   */
  private resolveGroupId(fingerprint: string): string {
    const known = this.groupIdByFingerprint.get(fingerprint)
    // 索引与组同增同删，故命中即该指纹的组仍存活；不存活时（已被驱逐）索引条目也已被删，
    // 走到下面重新分配一个 ID —— 与「新建一组」的语义一致，不会与旧组并行
    if (known !== undefined) {
      return known
    }

    let h = 0
    for (let i = 0; i < fingerprint.length; i++) {
      h = ((h << 5) - h + fingerprint.charCodeAt(i)) | 0
    }
    const base = Math.abs(h).toString(36)
    let candidate = base
    let probe = 1
    while (this.groups.has(candidate)) {
      probe++
      candidate = `${base}~${probe}`
    }
    return candidate
  }

  /**
   * 生成随组长期驻留的样本快照
   *
   * 组缓存可存活到进程结束，直接持有调用方交来的 ErrorContext 有两个后果：
   * `payload` 常引用 store 实例 / 页面节点，等于让缓存钉住整棵对象树；
   * 而 context 在报告链路上仍会被他人持有或改写，样本会随之漂移。
   * 故留一份只含标量字段 + error 引用的浅拷贝，时间戳取归一后的 `now`。
   * `error` 本体保留：它是诊断价值最高的部分，且 `ErrorGroup.sampleError` 的类型契约
   * 要求 Error 实例（GeomStoreError 的 code 等字段也挂在其上）。
   *
   * @private
   */
  private copySample(context: ErrorContext, timestamp: number): ErrorContext {
    return {
      storeName: context.storeName,
      operation: context.operation,
      level: context.level,
      error: context.error,
      timestamp,
    }
  }

  /**
   * 清空所有错误组
   */
  clear(): void {
    this.groups.clear()
    this.groupIdByFingerprint.clear()
  }

  /**
   * 获取统计信息
   *
   * @returns {object} 统计信息
   */
  getStats() {
    let totalErrors = 0
    const byCode: Record<string, number> = {}
    // 直接读内部组而非 getGroups()：后者为了对外安全会复制每个组，
    // 本方法只取标量字段，没必要为一组求和分配 n 个临时对象
    for (const { group } of this.groups.values()) {
      totalErrors += group.count
      byCode[group.code] = (byCode[group.code] || 0) + group.count
    }

    return {
      totalGroups: this.groups.size,
      totalErrors,
      byCode,
      // 按 Store 汇总组内计数（而非把组 count 累加给每个受影响 Store），
      // 且组被驱逐时计数同步消失，保证 byStore 各项之和恒等于 totalErrors
      byStore: this._byStoreCounts(),
    }
  }

  /**
   * 汇总现存各组的按 Store 计数
   *
   * @private
   */
  private _byStoreCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const { hits } of this.groups.values()) {
      for (const [storeName, count] of hits) {
        counts[storeName] = (counts[storeName] || 0) + count
      }
    }
    return counts
  }
}
