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
 * 已知限制（#327）：手工维护，仓库内没有任何机制把它与 package.json 的 version 同步，
 * 漏 bump 只会让版本告警静默失效（比对结果仅用于 logger.warn，不拦截恢复），
 * 不影响备份/恢复本身。真正的单一来源需要构建期注入或生成常量（scripts/ 侧改造），
 * 在收口之前请勿把它当作可信的版本门禁
 */
const LIBRARY_VERSION = '1.0.0'

/**
 * 热更新前保存的状态备份
 */
export interface BackupData {
  /** 备份生成时间戳，用于过期判定（超过 `BACKUP_EXPIRY_MS` 即作废） */
  timestamp: number
  /** `store.$snapshot()` 产出的状态快照 */
  state: unknown
  /** 备份时的库版本（`LIBRARY_VERSION`）；与当前不一致时仅告警，仍按合并语义恢复 */
  version: string
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
 * 备份当前状态
 */
function backupState<S extends State = State>(store: Store<S>, backupKey: string): void {
  const backupData: BackupData = {
    timestamp: Date.now(),
    state: store.$snapshot(),
    version: LIBRARY_VERSION,
  }
  // 写入失败（配额满等）必须抛错：调用方据此跳过标记写入与 applyUpdate，
  // 避免重启后凭空执行一次无源恢复
  if (!storage.set(backupKey, backupData)) {
    throw new Error(`[HotUpdate] 备份写入 storage 失败: ${backupKey}`)
  }
}

/**
 * 初始化热更新处理
 * 在小程序更新时自动备份和恢复状态
 */
/** 热更新当前保护的 store 配置：重复调用（账号切换）时切换保护目标 */
let hotUpdateRegistration: { store: Store<State>; backupKey: string; onBeforeUpdate?: () => void } | null = null
/** 已安装监听的 updateManager 实例集合：真实环境为全局单例（幂等安装防止监听累积），
 *  测试环境的每个 mock 实例各自安装。
 *  用 WeakSet 而非「最近安装的一个实例」单槽：单槽下宿主交替返回不同 manager 时，
 *  回到旧实例会被判定为「未安装」而再次注册——onUpdateReady 是累加式注册且无 off API，
 *  每个累积的监听都读同一个 hotUpdateRegistration，一次更新即弹出多个模态、备份多份。
 *  弱引用键不阻止实例回收，也不改变单例场景下的行为 */
const installedUpdateManagers = new WeakSet<object>()

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
        try {
          backupState(registration.store, registration.backupKey)
          registration.onBeforeUpdate?.()
        } catch (error) {
          logger.error('HotUpdate', '备份状态失败:', error)
          // 备份失败不阻断更新，但标记不能写：否则重启后会凭空执行一次无源恢复
          return
        }
        // 先写待更新重启标记再 applyUpdate：重启后凭标记区分「更新后首启」与
        // 「拒绝更新后的普通重启」，避免普通重启把备份点之后的持久化变更回滚。
        // 标记写入失败（storage.set 已尽力而为，仅配额满等异常）不阻断更新：
        // 损失的只是恢复语义
        storage.set(pendingLaunchKey(registration.backupKey), true)
        updateManager.applyUpdate()
      },
    })
  })

  updateManager.onUpdateFailed(() => {
    logger.error('HotUpdate', '更新失败')
    // 更新未生效时必须清理标记与备份：残留标记会让之后的普通冷启动被误判为
    // 「更新后首启」，把用户继续使用期间的持久化变更回滚到旧备份点
    /* istanbul ignore else -- initHotUpdate 必先写入 registration 再安装本监听，故此处恒为真 */
    if (hotUpdateRegistration) {
      storage.remove(pendingLaunchKey(hotUpdateRegistration.backupKey))
      storage.remove(hotUpdateRegistration.backupKey)
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
    // 备份不存在时顺带清理可能残留的孤儿标记
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
    storage.remove(resolvedBackupKey)
    storage.remove(markerKey)
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
    storage.remove(resolvedBackupKey)
    storage.remove(markerKey)
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
    // 用 $patch 合并语义而非 $restore（= $replaceState 整树替换）：热更新备份取自
    // 更新前的旧版本，整树替换会把新版本新增的 state 键整体抹掉，新代码读这些键
    // 即得 undefined。plugins/builtin.ts 的持久化恢复也为此特意选用 $patch
    store.$patch(backup.state as Partial<S>)
    storage.remove(resolvedBackupKey)
    storage.remove(markerKey)
    logger.log('HotUpdate', '状态已从备份恢复')
    return true
  } catch (error) {
    logger.error('HotUpdate', '恢复状态失败:', error)
    return false
  }
}
