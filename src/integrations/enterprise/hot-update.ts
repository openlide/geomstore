/**
 * GeomStore - 微信小程序企业级方案：热更新状态恢复
 *
 * 自 wechat-enterprise.ts 拆出。小程序更新时备份状态，重启后按合并语义恢复。
 */

import type { Store, State } from '../../types/store.js'
import { isPlainObject } from '../../core/utils/helpers.js'
import { storage, logger, BACKUP_EXPIRY_MS, type WxApi } from './env.js'

// 本模块直接调用 wx（热更新管理器/弹窗/提示），故保留模块级 ambient 声明
declare const wx: WxApi

/**
 * 本库版本常量：用于热更新备份的版本比对（区别于宿主 app 版本）。
 *
 * 已知限制（#327）：手工维护，仓库内没有把它与 package.json 的 version **同步**的机制
 * （构建期注入 / 生成常量尚未做），但有一条**检测**：`tests/integration/enterprise.test.ts`
 * 用 `package.json` 的 version 断言写进备份的本常量，漏 bump 会让那条用例变红。
 * 漏 bump 的后果本身不严重——比对结果只用于 logger.warn，不拦截恢复，不影响备份/恢复；
 * 在收口之前请勿把它当作可信的版本门禁。
 * **发版时必须与 `package.json` 一起改**——清单见 CONTRIBUTING 的「构建与发布」
 */
const LIBRARY_VERSION = '0.8.0'

/**
 * 热更新前保存的状态备份
 */
export interface BackupData {
  /** 备份生成时间戳，用于过期判定（超过 `BACKUP_EXPIRY_MS` 即作废） */
  timestamp: number
  /** `store.$snapshot()` 经 {@link encodeForBackup} 编码后的状态（JSON 往返无损的中间形态） */
  state: unknown
  /** 备份时的库版本（`LIBRARY_VERSION`）；与当前不一致时仅告警，仍按合并语义恢复 */
  version: string
  /**
   * 本次备份中**无法完整还原**的成员路径与原因（类实例的原型、函数/symbol 成员）。
   * 容器（Date/RegExp/Map/Set）与 NaN/±Infinity/BigInt 已由编解码无损往返，不在此列。
   * 恢复侧读到非空列表时打一条「有损恢复」告警，让排障者不必去猜状态为什么缺了指纹
   */
  lossy?: string[]
}

// ==================== 备份编解码 ====================

/**
 * 类型标记键。解码只认下表列出的标记值，其余含该键的对象一律按用户数据原样处理，
 * 因此状态里恰好出现 `'#gs'` 键名的概率与后果都被压到最低（用户数据自身带该键时
 * 由 encode 的 `'raw'` 信封再套一层，见 needsEnvelope 分支——编码是单射的）
 */
const GS_TYPE = '#gs'

/**
 * 把 `store.$snapshot()` 的产物编码成「经 JSON 往返无损」的中间形态。
 *
 * 为什么必须有这一层：`storage.set` 用 `JSON.stringify` 落盘，而状态里允许出现
 * Date/RegExp/Map/Set 与类实例（`$snapshot` 的口径，core/utils/clone.ts 同口径支持）。
 * 直接 stringify 会把 `new Map([['a',1]])` / `new Set([1,2])` 折叠成 `{}`、
 * Date 变成 ISO 字符串、BigInt 直接抛错。恢复时那个 `{}` 是纯对象，而状态原位置是
 * Set/Map（非纯对象）→ deepMerge 走「整体替换为克隆副本」，容器被换成**空壳对象**；
 * Date 字段被换成字符串。之后 `state.selectedIds.has(x)` / `state.createdAt.getTime()`
 * 当场 TypeError，而 `$patch` 不抛错就会被记成「状态已从备份恢复」并删掉唯一数据源。
 *
 * 标记形态：`u`＝undefined、`n`＝非有限数字与 -0、`bi`＝BigInt、`d`＝Date、
 * `re`＝RegExp（[source, flags]）、`m`＝Map（[[k, v], …]）、`s`＝Set、
 * `raw`＝用户数据自带 `'#gs'` 键时的信封。symbol 键与非枚举属性本就不进 JSON，
 * 与 `clone` 的 json 模式同口径地不参与往返
 *
 * @param path 当前路径，只用于 lossy 列表里的人话定位
 * @param lossy 出参：本层及其下无法完整还原的成员
 * @param stack 当前递归路径上的对象集（不是「已编码集」：共享的 DAG 节点要各自编码一份）
 */
function encodeForBackup(value: unknown, path: string, lossy: string[], stack: WeakSet<object>): unknown {
  if (value === null) return null
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      // -0 与 0 的 String() 相同，必须用 Object.is 分流；非有限值经 stringify 会变 null
      if (Number.isFinite(value) && !Object.is(value, -0)) return value
      return { [GS_TYPE]: 'n', v: Object.is(value, -0) ? '-0' : String(value) }
    case 'bigint':
      return { [GS_TYPE]: 'bi', v: value.toString() }
    case 'undefined':
      return { [GS_TYPE]: 'u' }
    case 'function':
    case 'symbol':
      lossy.push(`${path}（${typeof value} 成员无法序列化，恢复后为 undefined）`)
      return { [GS_TYPE]: 'u' }
    default:
      break
  }

  const object = value as object
  if (stack.has(object)) {
    // $snapshot 已把循环折成 '[Circular Reference]' 占位串，正常到不了这里；
    // 走到时按 undefined 收，换一次 JSON.stringify 不抛错（而不是无限递归爆栈）
    lossy.push(`${path}（循环引用，恢复后为 undefined）`)
    return { [GS_TYPE]: 'u' }
  }
  stack.add(object)
  try {
    if (object instanceof Date) {
      const time = object.getTime()
      return { [GS_TYPE]: 'd', v: Number.isFinite(time) ? time : null }
    }
    if (object instanceof RegExp) {
      return { [GS_TYPE]: 're', v: [object.source, object.flags] }
    }
    if (object instanceof Map) {
      const entries: unknown[] = []
      for (const [k, v] of object) {
        // 键路径标 `.key[...]`：与快照 diff / 克隆引擎的键路径方言同形，便于人工对账
        entries.push([encodeForBackup(k, `${path}.key`, lossy, stack), encodeForBackup(v, `${path}[key]`, lossy, stack)])
      }
      return { [GS_TYPE]: 'm', v: entries }
    }
    if (object instanceof Set) {
      const items: unknown[] = []
      let i = 0
      for (const item of object) {
        items.push(encodeForBackup(item, `${path}[${i}]`, lossy, stack))
        i++
      }
      return { [GS_TYPE]: 's', v: items }
    }
    if (Array.isArray(object)) {
      return object.map((item, i) => encodeForBackup(item, `${path}[${i}]`, lossy, stack))
    }
    if (!isPlainObject(object)) {
      // 类实例：字段可往返，原型跨进程无法安全重建（构造器可能已随版本改变），
      // 按「有损但可用」处理——恢复成结构等价的普通对象
      lossy.push(`${path}（类实例 ${(object.constructor && object.constructor.name) || 'unknown'}，恢复后原型丢失）`)
    }
    const record = object as Record<string, unknown>
    const encoded: Record<string, unknown> = {}
    for (const key of Object.keys(record)) {
      encoded[key] = encodeForBackup(record[key], `${path}.${key}`, lossy, stack)
    }
    // 用户数据自带标记键：整层套信封，解码时对信封内容不再做标记判定，编码因此是单射
    return Object.prototype.hasOwnProperty.call(record, GS_TYPE) ? { [GS_TYPE]: 'raw', v: encoded } : encoded
  } finally {
    stack.delete(object)
  }
}

/** 已知的类型标记（解码只认这几个，其余含 `'#gs'` 的对象按用户数据处理） */
const GS_TAGS = new Set(['u', 'n', 'bi', 'd', 're', 'm', 's', 'raw'])

/**
 * encodeForBackup 的对称解码。
 *
 * 旧格式备份（本层编解码之前写下的、被 `JSON.stringify` 改写过的状态）里没有这些标记，
 * 因此原样透传——读到的是当年那副空壳，行为与改造前一致，不会额外丢数据
 *
 * @param skipTag 该层已是用户数据（`'raw'` 信封的内容），不做标记判定
 */
function decodeFromBackup(value: unknown, path: string, skipTag = false): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item, i) => decodeFromBackup(item, `${path}[${i}]`))

  const record = value as Record<string, unknown>
  if (!skipTag) {
    const tag = record[GS_TYPE]
    if (typeof tag === 'string' && GS_TAGS.has(tag) && Object.keys(record).every((k) => k === GS_TYPE || k === 'v')) {
      const payload = record.v
      switch (tag) {
        case 'u':
          return undefined
        case 'n':
          // encode 写的是 String(value)：'NaN' / 'Infinity' / '-Infinity' / '-0'
          // 都能被 Number() 原样读回（Number('-0') 保留负零）
          return Number(payload)
        case 'bi':
          try {
            return BigInt(String(payload))
          } catch {
            return undefined
          }
        case 'd':
          return new Date(payload === null ? Number.NaN : Number(payload))
        case 're': {
          const [source, flags] = Array.isArray(payload) ? (payload as [unknown, unknown]) : []
          try {
            return new RegExp(String(source), String(flags))
          } catch {
            return undefined
          }
        }
        case 'm': {
          const map = new Map<unknown, unknown>()
          if (Array.isArray(payload)) {
            for (const entry of payload) {
              if (!Array.isArray(entry) || entry.length !== 2) continue
              map.set(decodeFromBackup(entry[0], `${path}.key`), decodeFromBackup(entry[1], `${path}[key]`))
            }
          }
          return map
        }
        case 's': {
          const set = new Set<unknown>()
          if (Array.isArray(payload)) {
            let i = 0
            for (const item of payload) {
              set.add(decodeFromBackup(item, `${path}[${i}]`))
              i++
            }
          }
          return set
        }
        case 'raw':
          // 信封内容按用户数据处理：自身不再做标记判定，其下各层照常解码
          return decodeFromBackup(payload, path, true)
        default:
          break
      }
    }
  }

  const restored: Record<string, unknown> = {}
  for (const key of Object.keys(record)) {
    restored[key] = decodeFromBackup(record[key], `${path}.${key}`)
  }
  return restored
}

/**
 * `initHotUpdate` 的配置项
 */
export interface HotUpdateConfig<S extends State = State> {
  /** 需要保护状态的 Store */
  store: Store<S>
  /** 备份存储键；缺省按 store 名派生，保证多账号/多实例互不覆盖 */
  backupKey?: string
  /** 用户确认更新且备份成功后的回调（可用于落库或上报） */
  onBeforeUpdate?: () => void
}

const DEFAULT_BACKUP_KEY = 'store_backup_before_update'

/**
 * 派生备份存储键：initHotUpdate 与 restoreFromHotUpdate 必须同口径，
 * 两处各自内联字面量时任一侧独立改动会让写入与读取寻址不同键（静默无源恢复）
 */
function resolveBackupKey<S extends State>(store: Store<S>, backupKey?: string): string {
  // 默认按 store 名派生：多账号/多 Store 实例并存时热更新备份互不覆盖
  return backupKey ?? `${DEFAULT_BACKUP_KEY}_${store.name}`
}

/** 待更新重启标记键：确认更新时写入，用于区分「更新后首启」与「普通重启」 */
function pendingLaunchKey(backupKey: string): string {
  return `${backupKey}__pending_update_launch`
}

/**
 * 成对清理备份与待更新重启标记
 *
 * 两个键必须同进同出：只删标记会留下无人再读的备份，只删备份会让残留标记把之后的
 * 普通冷启动误判为「更新后首启」，凭空执行一次无源恢复并把持久化变更回滚到旧备份点。
 * 该不变量此前靠三处复制的 `remove(backup); remove(marker)` 维持，
 * 漏一侧即回到上述某个 bug，故收敛到本函数
 */
function clearBackup(backupKey: string): void {
  storage.remove(pendingLaunchKey(backupKey))
  storage.remove(backupKey)
}

/**
 * 备份当前状态
 */
function backupState<S extends State = State>(store: Store<S>, backupKey: string): void {
  const lossy: string[] = []
  const backupData: BackupData = {
    timestamp: Date.now(),
    // 编解码往返：状态里的 Date/RegExp/Map/Set/undefined/非有限数字/BigInt 都能无损落盘
    // （见 encodeForBackup 的理由说明）
    state: encodeForBackup(store.$snapshot(), 'state', lossy, new WeakSet<object>()),
    version: LIBRARY_VERSION,
  }
  if (lossy.length > 0) {
    // 备份时刻就要说清丢了什么：重启后再没有第二个观测点，
    // 恢复侧只能照着这个列表复述一遍（它存在 backup.lossy 里随备份一起落盘）
    logger.warn('HotUpdate', `备份中有 ${lossy.length} 处成员无法完整还原（类实例原型/函数/symbol/循环引用）`, lossy)
    backupData.lossy = lossy
  }
  // 写入失败（配额满等）必须抛错：调用方据此跳过标记写入，
  // 避免重启后凭空执行一次无源恢复（更新本身仍继续，损失的只是状态恢复）
  if (!storage.set(backupKey, backupData)) {
    throw new Error(`[HotUpdate] 备份写入 storage 失败: ${backupKey}`)
  }
}

/** 热更新当前保护的 store 配置：重复调用（账号切换）时切换保护目标 */
let hotUpdateRegistration: { store: Store<State>; backupKey: string; onBeforeUpdate?: () => void } | null = null
/** 已安装监听的 updateManager 实例集合：真实环境为全局单例（幂等安装防止监听累积），
 *  测试环境的每个 mock 实例各自安装。
 *  用 WeakSet 而非「最近安装的一个实例」单槽：单槽下宿主交替返回不同 manager 时，
 *  回到旧实例会被判定为「未安装」而再次注册——onUpdateReady 是累加式注册且无 off API，
 *  每个累积的监听都读同一个 hotUpdateRegistration，一次更新即弹出多个模态、备份多份。
 *  弱引用键不阻止实例回收，也不改变单例场景下的行为 */
const installedUpdateManagers = new WeakSet<object>()

/**
 * 初始化热更新处理
 * 在小程序更新时自动备份和恢复状态
 *
 * 重复调用（账号切换）会切换保护目标；对同一 `updateManager` 实例的监听安装是幂等的
 * （`onUpdateReady` 为累加式注册且无 off API，见 `installedUpdateManagers`）
 */
export function initHotUpdate<S extends State = State>(config: HotUpdateConfig<S>): void {
  const { store, backupKey, onBeforeUpdate } = config
  const resolvedBackupKey = resolveBackupKey(store, backupKey)
  hotUpdateRegistration = { store: store as unknown as Store<State>, backupKey: resolvedBackupKey, onBeforeUpdate }

  const updateManager = wx.getUpdateManager()
  // onUpdateReady 是累加式注册且无对应 off API：按 manager 实例幂等安装，
  // 否则每次 login 重新调用都会累积一个监听（多弹窗、多份备份、标记竞态）
  if (installedUpdateManagers.has(updateManager)) return
  installedUpdateManagers.add(updateManager)

  updateManager.onUpdateReady(() => {
    logger.log('HotUpdate', '新版本准备就绪')

    const registration = hotUpdateRegistration
    /* istanbul ignore next -- initHotUpdate 必先写入 registration 再安装本监听，故此处恒非空 */
    if (!registration) return
    // store 已被外部销毁（LRU 淘汰/logout）时 $snapshot 会抛错，
    // 异常发生在 wx 回调内无人捕获——跳过已销毁 store
    if (registration.store.destroyed) {
      logger.warn('HotUpdate', `store "${registration.store.name}" 已销毁，跳过备份`)
      return
    }

    wx.showModal({
      title: '更新提示',
      content: '新版本已准备好，是否重启应用？',
      success: (res) => {
        if (!res.confirm) return
        // 备份必须在用户确认时进行而非 onUpdateReady 时：弹窗期间业务仍在运行
        // （in-flight 请求回调照常 $patch 并经持久化插件落盘），若备份取自弹窗前，
        // 重启后恢复会把「备份点之前弹窗期间已持久化的变更」整体回滚。
        // 确认时刻的内存状态 ≥ 此刻任何已持久化数据；残余窗口仅剩
        // 「确认到进程终止之间」最后一段（受防抖落盘时机影响，无法完全消除）
        // 备份失败与宿主回调失败各自兜底：此前 onBeforeUpdate 与 backupState 共用一个
        // try，宿主上报/落库逻辑抛错既被误记成「备份状态失败」，又会 return 掉用户
        // 刚确认的更新且不给任何反馈（备份写不进只是失去恢复能力，不是不更新的理由）
        let backedUp = false
        try {
          backupState(registration.store, registration.backupKey)
          backedUp = true
        } catch (error) {
          logger.error('HotUpdate', '备份状态失败，本次更新不做状态恢复:', error)
        }
        try {
          registration.onBeforeUpdate?.()
        } catch (error) {
          logger.error('HotUpdate', 'onBeforeUpdate 回调执行失败:', error)
        }
        // 先写待更新重启标记再 applyUpdate：重启后凭标记区分「更新后首启」与
        // 「拒绝更新后的普通重启」，避免普通重启把备份点之后的持久化变更回滚。
        // 备份没落盘时不写标记：否则重启后是一次凭空执行的无源恢复。
        // 标记写入失败（storage.set 已尽力而为，仅配额满等异常）不阻断更新：
        // 损失的只是恢复语义
        if (backedUp) {
          storage.set(pendingLaunchKey(registration.backupKey), true)
        }
        // applyUpdate 抛错即更新未生效：刚写入的标记与备份必须成对清掉，
        // 否则下一次普通冷启动会被误判为「更新后首启」并把备份点之后的变更整体回滚
        // （与 onUpdateFailed 同口径，此前该出口只存在于「平台回调更新失败」一条路径上）
        try {
          updateManager.applyUpdate()
        } catch (error) {
          logger.error('HotUpdate', 'applyUpdate 失败，按更新未生效清理标记与备份:', error)
          clearBackup(registration.backupKey)
        }
      },
    })
  })

  updateManager.onUpdateFailed(() => {
    logger.error('HotUpdate', '更新失败')
    // 更新未生效时必须清理标记与备份：残留标记会让之后的普通冷启动被误判为
    // 「更新后首启」，把用户继续使用期间的持久化变更回滚到旧备份点
    /* istanbul ignore else -- initHotUpdate 必先写入 registration 再安装本监听，故此处恒为真 */
    if (hotUpdateRegistration) {
      clearBackup(hotUpdateRegistration.backupKey)
    }
    wx.showToast({ title: '更新失败，请重试', icon: 'none' })
  })
}

/**
 * 从热更新备份恢复状态
 */
export function restoreFromHotUpdate<S extends State = State>(store: Store<S>, backupKey?: string): boolean {
  const resolvedBackupKey = resolveBackupKey(store, backupKey)
  const markerKey = pendingLaunchKey(resolvedBackupKey)
  const backup = storage.get<BackupData>(resolvedBackupKey)
  if (!backup) {
    // 备份不存在时顺带清理可能残留的孤儿标记。刻意不走 clearBackup：本分支的前提是
    // 「读不到备份」，而读取抛错也会被归一为 null——此时备份可能仍在存储里，
    // 连它一起删会把一次瞬态读失败变成确定的数据丢失（只删标记最多让恢复能力作废）
    storage.remove(markerKey)
    return false
  }

  // payload 来自 storage，形状不可信：timestamp 缺失/非有限值时 age 为 NaN，
  // 而 NaN > BACKUP_EXPIRY_MS 为 false，过期门禁会被损坏备份静默绕过——
  // 按「无限旧」处理，与正常过期同路径清理
  const backupAge = Number.isFinite(backup.timestamp) ? Date.now() - backup.timestamp : Number.POSITIVE_INFINITY

  // 备份超过过期时间，清理并返回
  if (backupAge > BACKUP_EXPIRY_MS) {
    logger.warn('HotUpdate', '备份数据已过期或时间戳无效（视为过期）')
    clearBackup(resolvedBackupKey)
    return false
  }

  // 仅更新确认后的首次启动才恢复：用户在弹窗中拒绝更新后继续使用，
  // 期间的变更已持久化，普通冷启动时恢复会把状态回滚到备份点，
  // 备份点之后的所有变更静默丢失
  if (!storage.get<boolean>(markerKey)) {
    logger.log('HotUpdate', '存在备份但非更新后首启，跳过恢复')
    return false
  }

  // 结构预校验：$patch 走 deepMerge，而 deepMerge 对数组等非纯对象会静默跳过合并
  // （isObject 排除数组）却仍算成功——损坏备份会被当成「已恢复」并删除。
  // 这类备份永久不可用（不同于下方 catch 的瞬态失败），按过期路径同口径清理两个键，
  // 否则每次冷启动都会重复告警一遍
  if (!isPlainObject(backup.state)) {
    logger.warn('HotUpdate', '备份 state 不是纯对象，跳过恢复并清理')
    clearBackup(resolvedBackupKey)
    return false
  }

  // 版本比对：备份 version 与本库版本常量（而非宿主 app 版本）比对。
  // 硬门禁会在库升级时白丢用户数据，而合并语义本身已能容忍结构漂移，
  // 故版本不一致只告警、不拦截，仍按下方 $patch 合并语义恢复。
  // 声明类型上 version 非可选，但 payload 来自 storage 不可信：旧版本备份可能
  // 根本没有该字段（静态视角的「恒真」在运行时不成立），缺字段时按「版本未知」
  // 静默跳过，删掉此守卫会把缺字段误报成 "(undefined) 不一致"
  if (backup.version !== undefined && backup.version !== LIBRARY_VERSION) {
    logger.warn('HotUpdate', `备份版本(${backup.version})与当前库版本(${LIBRARY_VERSION})不一致，仍按合并语义恢复`)
  }

  try {
    // 与备份侧 encodeForBackup 对称解码：容器（Map/Set/Date/RegExp）在这里变回实例，
    // 才会被 deepMerge 的「非纯对象整体替换」分支正确落进状态，而不是留下一副
    // 由 `{}` 扮演的空壳（业务侧下一次 `.has()` / `.getTime()` 就是 TypeError）
    const restoredState = decodeFromBackup(backup.state, 'state')
    // 用 $patch 合并语义而非 $restore（= $replaceState 整树替换）：热更新备份取自
    // 更新前的旧版本，整树替换会把新版本新增的 state 键整体抹掉，新代码读这些键
    // 即得 undefined。plugins/builtin.ts 的持久化恢复也为此特意选用 $patch
    store.$patch(restoredState as Partial<S>)
    clearBackup(resolvedBackupKey)
    // 有损恢复必须留痕：备份侧已列出无法还原的成员，这里复述一遍，
    // 让「状态看起来缺了指纹」的排障者不必从头猜
    if (Array.isArray(backup.lossy) && backup.lossy.length > 0) {
      logger.warn('HotUpdate', `本次为有损恢复：${backup.lossy.length} 处成员未能完整还原`, backup.lossy)
    }
    logger.log('HotUpdate', '状态已从备份恢复')
    return true
  } catch (error) {
    logger.error('HotUpdate', '恢复状态失败:', error)
    // 刻意不清理：$patch 失败按瞬态故障处理（如 store 已被销毁），保留两个键让下一次
    // 冷启动还能重试恢复；这里成对删掉才是不可逆的丢状态
    return false
  }
}
