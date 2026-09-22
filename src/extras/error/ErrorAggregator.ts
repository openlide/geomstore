/**
 * GeomStore - 错误聚合器
 *
 * 自 ErrorMonitoring.ts 拆出：将相似的错误聚合成组，便于分析和报告。
 *
 * @module extras/error/ErrorAggregator
 */

import type { ErrorContext, ErrorGroup } from '../../types/error.js'
import { GeomStoreError, isGeomStoreError } from '../../core/errors/GeomStoreError.js'

/** 参与组指纹的堆栈前缀长度（见 `ErrorAggregator#buildFingerprint` 的口径说明） */
const STACK_FINGERPRINT_CHARS = 100

/**
 * 错误聚合器
 *
 * 将相似的错误聚合成组，便于分析和报告
 */
export class ErrorAggregator {
  /**
   * 按错误组保存的「Store → 该组内该 Store 的次数」
   *
   * 单独按次计数而非按组求和：错误组会把同一站点在不同 Store 的报错合并为一条，
   * 若把组 count 累加给每个受影响 Store，跨 Store 的组会重复计入，byStore 之和超过 totalErrors。
   * 计数随组一起存放，组被 maxGroups 驱逐时同步消失，因此
   * `sum(byStore) === totalErrors` 在驱逐后依旧成立（此前独立累计的口径会永久偏离）。
   */
  private readonly storeHits: Map<string, Map<string, number>> = new Map()

  /**
   * groupId → 指纹原文
   *
   * 组 ID 只由 32 位哈希压缩而来，必然存在碰撞概率；这里保留指纹原文，
   * 命中已有键时严格比对指纹，不同则向后探测新键，避免无关错误被静默折叠成
   * 同一组（那会让 `count` 与 `affectedStores` 从此失真且无从发现）。
   */
  private readonly fingerprints: Map<string, string> = new Map()

  private groups = new Map<string, ErrorGroup>()
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
    const error = context.error as GeomStoreError
    const code = isGeomStoreError(error) ? error.code : 'UNKNOWN'
    const now = context.timestamp || Date.now()
    this._countStoreHit(groupId, context.storeName)

    // 检查是否已存在该组
    const group = this.groups.get(groupId)
    if (group) {
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

      return undefined
    }

    // 创建新的错误组
    const newGroup: ErrorGroup = {
      groupId,
      type: error.name,
      code,
      message: error.message,
      count: 1,
      firstSeen: now,
      lastSeen: now,
      affectedStores: [context.storeName],
      sampleError: this.copySample(context, now),
    }

    this.groups.set(groupId, newGroup)
    this.fingerprints.set(groupId, fingerprint)

    // 限制组数量
    if (this.groups.size > this.maxGroups) {
      this.cleanupOldGroups()
    }

    return newGroup
  }

  /**
   * 获取所有错误组
   *
   * @returns {ErrorGroup[]} 错误组数组
   */
  getGroups(): ErrorGroup[] {
    return Array.from(this.groups.values()).sort((a, b) => b.lastSeen - a.lastSeen)
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
   * @private
   */
  private _countStoreHit(groupId: string, storeName: string): void {
    let perStore = this.storeHits.get(groupId)
    if (!perStore) {
      perStore = new Map()
      this.storeHits.set(groupId, perStore)
    }
    perStore.set(storeName, (perStore.get(storeName) ?? 0) + 1)
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
      let oldest = Infinity
      for (const [groupId, group] of this.groups) {
        // 严格小于：lastSeen 同分（同一毫秒内高发）时取 Map 迭代顺序里更早的一组，
        // 即「同样久未出现就先淘汰建组更早的那组」，方向确定且与插入顺序一致
        if (group.lastSeen < oldest) {
          oldest = group.lastSeen
          victimId = groupId
        }
      }
      /* istanbul ignore if -- groups.size > maxGroups(>=1) 时循环体必然非空 */
      if (victimId === undefined) {
        return
      }
      this.groups.delete(victimId)
      // 组与其按 Store 的计数同生命周期：只删组会让 byStore 继续累计已消失的组
      this.storeHits.delete(victimId)
      // 指纹与组同生命周期，否则探测链会被已驱逐组的残留指纹永久占位
      this.fingerprints.delete(victimId)
    }
  }

  /**
   * 构造判定「同一错误」的指纹
   *
   * 归并粒度维持 name + message + 堆栈前 `STACK_FINGERPRINT_CHARS` 个字符：
   * 「同一逻辑错误的多次抛出跨调用点归为一组」是本库对外承诺的聚合口径
   * （ErrorMonitoring 的 MONITOR-008/014/015/062 用例即固化了它），堆栈头部长度
   * 恰好落在 file:line 之前，改成全文堆栈会把同一逻辑错误按行号打散。
   * 真正的缺陷不在此而在「哈希相同即并入」，由 resolveGroupId 的指纹严格比对兜住。
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
   * 哈希只用于压缩 Map 键长，不承担正确性：同一哈希已被别的指纹占用时按
   * `base~n` 线性探测，命中同指纹则复用原键。
   *
   * @private
   */
  private resolveGroupId(fingerprint: string): string {
    let h = 0
    for (let i = 0; i < fingerprint.length; i++) {
      h = ((h << 5) - h + fingerprint.charCodeAt(i)) | 0
    }
    const base = Math.abs(h).toString(36)
    let candidate = base
    let probe = 1
    while (this.fingerprints.has(candidate) && this.fingerprints.get(candidate) !== fingerprint) {
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
    this.storeHits.clear()
    this.fingerprints.clear()
  }

  /**
   * 获取统计信息
   *
   * @returns {object} 统计信息
   */
  getStats() {
    const groups = this.getGroups()

    return {
      totalGroups: groups.length,
      totalErrors: groups.reduce((sum, g) => sum + g.count, 0),
      byCode: groups.reduce(
        (acc, g) => {
          acc[g.code] = (acc[g.code] || 0) + g.count
          return acc
        },
        {} as Record<string, number>,
      ),
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
    for (const perStore of this.storeHits.values()) {
      for (const [storeName, count] of perStore) {
        counts[storeName] = (counts[storeName] || 0) + count
      }
    }
    return counts
  }
}
