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
 * 存活错误组的默认上限（`maxGroups` 缺省值）
 *
 * 上限本身可调（构造参数），但把它接进 `MonitoringConfig` 需要改契约层
 * `src/types/error.ts`，本轮未动（见 `ErrorMonitoring` 构造器）。
 */
export const DEFAULT_MAX_GROUPS = 100

/**
 * 单个错误组最多逐个列出的 Store 数，超出后并入 {@link OTHER_STORES_BUCKET}
 *
 * `maxGroups` 只约束「组的个数」，管不到「一组里有多少个 storeName」。storeName 在本库里
 * 是动态的（`integrations/enterprise/user-store.ts` 按 `userStoreKey(userId)` 逐账号建 Store），
 * 于是账号切换/注销会在进程级长寿单例的同一个高频错误组上不断追加字符串，组不被驱逐就永不释放；
 * 而「是否已登记」的判定在 `report()` 的错误高发路径上，逐个比对随长度线性增长。
 *
 * 上限只截断**列表**（`affectedStores` 是一份诊断视图），不截断**计数**：按 Store 的账目
 * 由 `observedByStore` 单独记，`sum(byStore) === totalErrors` 与截断无关。
 */
const MAX_STORES_PER_GROUP = 50

/**
 * 全局按 Store 账目最多逐个开键的 Store 数，超出后并入 {@link OTHER_STORES_BUCKET}
 *
 * 与 `MAX_STORES_PER_GROUP` 同一动机：这份账目如今随组驱逐而长期驻留，
 * 不给基数设上限就等于把「按组累积」换成「按进程累积」。
 */
const MAX_TRACKED_STORE_KEYS = 200

/**
 * Store 基数溢出后的归并桶键（保留字，不作为真实 Store 名参与逐个列出）
 *
 * 出现在 `ErrorGroup.affectedStores` 末尾与 `getStats().byStore` 里，表示「其余未逐个列出的
 * Store 合起来的量」。用保留字而非静默丢弃，是为了让读报表的人看得出这里被折叠过。
 */
const OTHER_STORES_BUCKET = '__others__'

/**
 * 一个错误组及其随组数据
 *
 * 组本体与指纹两者生命周期完全一致（建组时一起出现、驱逐/clear 时一起消失），
 * 分放多张表就是多处需要同步的删除点——漏一处即留下永久无人清理的孤儿条目。
 * 「Store → 次数」的账目不再随组存放（改由 `observedByStore` 按条累计）：
 * 随组存放会让 maxGroups 驱逐把已发生过的错误整笔抹掉，见 `getStats` 的口径说明。
 */
interface GroupEntry {
  /** 聚合体本体（对外读取时经 `copyGroup` 复制，见 `getGroups`） */
  group: ErrorGroup

  /** 建组时使用的指纹原文，驱逐时据此删掉反向索引条目 */
  fingerprint: string

  /**
   * 该组已逐个列出的 storeName 集合
   *
   * 只为 O(1) 去重而存在（此前是 `affectedStores.includes`，在错误高发路径上按数组长度线性扫描）。
   * 规模被 `MAX_STORES_PER_GROUP` 约束。
   */
  storeNames: Set<string>

  /** 该组的 Store 列表是否已溢出（溢出后不再逐个登记，见 `_recordGroupStore`） */
  storesOverflowed: boolean
}

/**
 * 复制一个错误组用于对外交付
 *
 * 内部组是可变对象且长期驻留：直接把引用交给调用方，则一句 `group.count = 0` 或
 * `group.affectedStores.push('x')` 就会让此后所有 `getGroups()`/`topErrors`/`recentErrors`
 * 失真（`getStats()` 的三条账不受影响——它们按条独立累计，正是这套账目不随组存放的理由）。
 * 两个容器字段各拷一层，`sampleError.error` 按约定是外部持有的不可变引用。
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
 *
 * 两套口径要分清（`getStats` 里同时给出）：
 * - **账目**（`totalErrors` / `byCode` / `byStore`）按条累计，自 `clear()` 起单调不减，
 *   与组是否被 `maxGroups` 驱逐无关；
 * - **分组视图**（`totalGroups` / `getGroups()` / `getGroupsByStore()`）只反映当前存活的组，
 *   会随驱逐变小，差额记在 `evictedGroups` / `evictedErrors` 里。
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

  /** 存活组数量上限（只约束「组本体驻留多少组」，不约束账目，见 `getStats`） */
  private readonly maxGroups: number

  /**
   * 自上次 `clear()` 以来观测到的错误条数（每次 `addError` 加一，驱逐不减）
   *
   * 这是 `totalErrors` 的唯一来源。此前它由「存活组的 count 求和」现算，于是 maxGroups
   * 驱逐会把已发生过的错误整笔抹掉：两次 `generateReport()` 之间 totalErrors 会**变小**，
   * 与它在 `ErrorMonitoring` 里被钉下的口径（「观测到的错误数」）相反。
   */
  private observedErrors = 0

  /** 按错误码的累计账目（键集合有限，无需上限） */
  private readonly observedByCode = new Map<string, number>()

  /** 按 Store 的累计账目，Store 基数超上限后并入 `OTHER_STORES_BUCKET` */
  private readonly observedByStore = new Map<string, number>()

  /** 因 maxGroups 驱逐而消失的组数（账目已转入 `observedByCode`/`observedByStore`，此处只是留痕） */
  private evictedGroups = 0

  /** 因 maxGroups 驱逐而消失的组内错误条数 */
  private evictedErrors = 0

  /** 首次驱逐时出声一次：之后再驱逐只累计计数，不在错误高发路径上重复刷屏 */
  private evictionWarned = false

  constructor(maxGroups: number = DEFAULT_MAX_GROUPS) {
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
    // 保护式读取）。这里裸读 error.name 会抛 TypeError，把一次「上报错误」变成调用方的异常，
    // 故先保护式取值（与 `copySample`/`serializeContext` 同一口径）
    const type = typeof error?.name === 'string' ? error.name : 'Error'
    const message = typeof error?.message === 'string' ? error.message : String(error)

    // 账目先于分组落定：三张账（总数 / byCode / byStore）在同一个调用点一起推进，
    // 因此 `sum(byCode) === sum(byStore) === totalErrors` 与「这条错误最终落进哪个组」
    // 「那个组有没有被驱逐」都无关
    this._account(context.storeName, code)

    // 检查是否已存在该组
    const existing = this.groups.get(groupId)
    if (existing) {
      const group = existing.group
      // 更新组信息
      group.count++
      group.lastSeen = now

      // 更新受影响的Store（基数有上限，溢出后并入 `__others__`，见 `_recordGroupStore`）
      this._recordGroupStore(existing, context.storeName)
      // 样本刷新为最近一次出现：首次 occurrence 往往是最不具代表性的一次，
      // 且组可能长期存活，冻结的样本会让诊断停留在过期状态
      group.sampleError = this.copySample(context, now)

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

    const entry: GroupEntry = { group: newGroup, fingerprint, storeNames: new Set([context.storeName]), storesOverflowed: false }
    this.groups.set(groupId, entry)
    this.groupIdByFingerprint.set(fingerprint, groupId)

    // 限制组数量：被驱逐那组的条数转入 evictedErrors（见 cleanupOldGroups），
    // 因此 totalErrors 只增不减，「聚合丢过数据」也从此有账可查
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
   * 口径限制：某组波及的 Store 数超过 `MAX_STORES_PER_GROUP` 后，后到的 Store 只以
   * `__others__` 桶计入该组的 `affectedStores`（计数照常累计，见 {@link getStats}），
   * 故对本方法而言「没返回某组」**不等于**该 Store 没在那组里报错。
   * 要按 Store 拿准确的错误条数请用 `getStats().byStore`。
   *
   * @param {string} storeName - Store名称
   * @returns {ErrorGroup[]} 错误组数组
   */
  getGroupsByStore(storeName: string): ErrorGroup[] {
    return this.getGroups().filter((group) => group.affectedStores.includes(storeName))
  }

  /**
   * 记一条错误的账：总数、按错误码、按 Store 三张表同时推进
   *
   * 三处必须一起改，否则 `sum(byCode) === sum(byStore) === totalErrors` 的账目不变量就会破。
   * 单独按条计数而非「把存活组的 count 求和」：错误组会把同一站点在不同 Store 的报错合并为一条，
   * 若把整组 count 记给每个受影响 Store，跨 Store 的组会重复计入（那正是此前
   * `sum(byStore) > totalErrors` 的来源）；而按组求和还会让 maxGroups 驱逐把已发生过的
   * 错误整笔抹掉（totalErrors 倒退）。求和口径与驱逐留痕由此分开。
   *
   * @private
   */
  private _account(storeName: string, code: string): void {
    this.observedErrors++
    this.observedByCode.set(code, (this.observedByCode.get(code) ?? 0) + 1)

    const seen = this.observedByStore.get(storeName)
    if (seen !== undefined) {
      this.observedByStore.set(storeName, seen + 1)
      return
    }
    if (this.observedByStore.size >= MAX_TRACKED_STORE_KEYS) {
      // 新 Store 不再逐个开键，并入溢出桶：桶键本身也是 byStore 的一项，求和不变量不破
      this.observedByStore.set(OTHER_STORES_BUCKET, (this.observedByStore.get(OTHER_STORES_BUCKET) ?? 0) + 1)
      return
    }
    this.observedByStore.set(storeName, 1)
  }

  /**
   * 把一个 Store 逐个登记进某个组的 `affectedStores`
   *
   * 去重走 `entry.storeNames`（Set），不再是 `affectedStores.includes` 的线性扫描——
   * 本方法在 `report()` 的错误高发路径上，数组越长每次聚合越贵。
   * 达到 `MAX_STORES_PER_GROUP` 后只留一个 `__others__` 桶标记并出声一次：
   * 截断的是「列得全不全」这份诊断视图，条数账目由 `_account` 独立负责，不受影响。
   *
   * @private
   */
  private _recordGroupStore(entry: GroupEntry, storeName: string): void {
    if (entry.storesOverflowed || entry.storeNames.has(storeName)) {
      return
    }
    if (entry.storeNames.size >= MAX_STORES_PER_GROUP) {
      entry.storesOverflowed = true
      entry.group.affectedStores.push(OTHER_STORES_BUCKET)
      console.warn(
        `[ErrorAggregator] 错误组 ${entry.group.groupId} 波及的 Store 已达 ${MAX_STORES_PER_GROUP} 个上限，后续并入 '${OTHER_STORES_BUCKET}' 桶（计数不受影响，见 getStats）`,
      )
      return
    }
    entry.storeNames.add(storeName)
    entry.group.affectedStores.push(storeName)
  }

  /**
   * 清理旧的错误组
   *
   * 只驱逐「最近最少出现」的一组，不复用 getGroups()：那会把整个 Map 复制成数组
   * 再排序（O(n log n) + n 个临时对象），而本方法在组数达到上限后的**每次** addError
   * 都会进入，属于错误高发期的热路径。线性扫描取最小 lastSeen 即可，不分配临时数组。
   * 新增一组最多越界一组，while 只是对 maxGroups 被改小等异常情形的兜底。
   *
   * 驱逐同时留痕（`evictedGroups` / `evictedErrors`）：组本体的 count 随组消失，
   * 但条数账目早在 `addError` 里按条落定，故 totalErrors 不因此倒退。
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
      if (!this.evictionWarned) {
        this.evictionWarned = true
        console.warn(
          `[ErrorAggregator] 存活错误组已达 maxGroups=${this.maxGroups} 上限，开始按「最近最少出现」驱逐旧组；组本体消失但条数仍随 getStats() 的 totalErrors/byStore/byCode 累计`,
        )
      }
      // 驱逐留痕：组本体（含其 count 与 affectedStores）就此消失，不记账的话
      // getStats() 只能对存活组求和，totalErrors 会随新错误的发生而倒退
      this.evictedGroups++
      this.evictedErrors += victim.group.count
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
   * 清空所有错误组与全部账目
   *
   * 驱逐留痕一并归零：`evictedErrors`/`evictedGroups` 与 `getStats()` 各项的口径都是
   * 「自上次 `clear()` 以来」（与 `ErrorMonitoring.getDroppedErrors()` 同一约定）
   */
  clear(): void {
    this.groups.clear()
    this.groupIdByFingerprint.clear()
    this.observedErrors = 0
    this.observedByCode.clear()
    this.observedByStore.clear()
    this.evictedGroups = 0
    this.evictedErrors = 0
    this.evictionWarned = false
  }

  /**
   * 获取统计信息
   *
   * 口径：`totalErrors` / `byCode` / `byStore` 是**自上次 `clear()` 以来观测到的全部错误**，
   * 与组是否被 maxGroups 驱逐无关，因此三者随时间单调不减，且恒有
   * `sum(byCode) === sum(byStore) === totalErrors`。
   * `totalGroups` 与 `getGroups()` 则只反映**当前存活**的组（驱逐后必然变小），
   * 两者的差额由 `evictedGroups` / `evictedErrors` 说明——聚合丢过数据在这里看得见。
   *
   * 返回的是新建对象，调用方改写不影响内部账目。
   *
   * @returns {object} 统计信息
   */
  getStats() {
    return {
      totalGroups: this.groups.size,
      totalErrors: this.observedErrors,
      byCode: Object.fromEntries(this.observedByCode),
      byStore: Object.fromEntries(this.observedByStore),
      evictedGroups: this.evictedGroups,
      evictedErrors: this.evictedErrors,
    }
  }
}
