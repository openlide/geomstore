/**
 * GeomStore - 持久化类型定义
 */

import type { State } from './store.js'

/**
 * 存储后端接口
 *
 * 仅支持同步后端：persistencePlugin 的恢复与保存均为同步语义，
 * 异步后端（返回 Promise）会在运行时被检测并报错。
 * 如需异步持久化，请在外部自行订阅 store 并处理异步写入。
 *
 * 错误语义（三个方法一致，见 #390）：**存储失败一律抛错**，由调用方决定是否降级——
 * `getItem` 返回 `null` 只代表「键无数据」，不代表「读取失败」，两者不得混用，
 * 否则损坏的存储会被误判为空状态并随后被覆盖。
 * persistencePlugin 已按此契约为三条路径（恢复 / 落盘 / clearOnUninstall）各自 try/catch
 * 并记录日志（落盘失败还会 emit `onError`），自定义后端只要照此抛错即可。
 */
export interface StorageBackend {
  /** 获取值（必须同步返回；键不存在返回 null，读取失败抛错） */
  getItem(key: string): string | null
  /** 设置值（必须同步返回；失败抛错） */
  setItem(key: string, value: string): void
  /** 删除值（必须同步返回；失败抛错） */
  removeItem(key: string): void
}

/**
 * 持久化选项
 */
export interface PersistenceOptions<S extends State = State> {
  /** 存储key（字符串或函数） */
  key?: string | ((storeName: string) => string)
  /** 存储后端 */
  storage?: StorageBackend
  /** 状态过滤器 */
  filter?: (state: S) => Partial<S>
  /** 状态验证器（恢复前校验，返回 false 则拒绝恢复） */
  validate?: (state: unknown) => state is S
  /** 是否恢复状态 */
  restore?: boolean
  /**
   * 防抖延迟（毫秒），默认 0（每次变更立即落盘）。
   *
   * 默认立即写入可保证「变更即持久化」的可靠性，但每次通知都会执行一次
   * `JSON.stringify(整棵状态树)` + 同步 `wx.setStorageSync`（小程序内为阻塞 I/O）。
   * 高频更新场景（输入联想、拖拽、轮询）建议设为 300~500，或配合 `filter`
   * 只持久化必要子集；插件卸载时会自动补写防抖窗口内未落盘的最后一次变更。
   */
  debounce?: number
  /** 卸载插件时是否清除存储数据（默认 false，仅停止监听，保留已持久化的数据） */
  clearOnUninstall?: boolean
}

/**
 * 小程序 `wx` 同步存储 API 在本库视角下的最小形状
 *
 * 三个方法都可选：真机 / 开发者工具 / Node 测试环境下 `wx` 可能整体缺失或只缺单个方法，
 * 调用点统一用 `?.` 兜底。
 *
 * 单点声明（原先在 getter 签名与 `globalThis` 断言里各写一份内联字面量，改动时极易只改一处）：
 * 形状沿用小程序 API 的命名与返回类型（`getStorageSync` 返回 `unknown`——它会原样返回写入的
 * 非字符串载荷），因此**不等价于** `StorageBackend` 契约，不能用 `Pick<StorageBackend, …>` 派生；
 * 两侧的差异由 `getItem` 的类型守卫收口。
 */
type WxStorageApi = {
  getStorageSync?: (key: string) => unknown
  setStorageSync?: (key: string, value: string) => void
  removeStorageSync?: (key: string) => void
}

/**
 * 微信存储后端
 */
export class WxStorageBackend implements StorageBackend {
  /** 经 globalThis 读取 wx，避免直接引用未声明的小程序全局标识符 */
  private get wxApi(): WxStorageApi | undefined {
    return (globalThis as { wx?: WxStorageApi }).wx
  }

  getItem(key: string): string | null {
    try {
      const value = this.wxApi?.getStorageSync?.(key)
      // 微信 getStorageSync 对不存在的键返回空字符串（而非 undefined），且写入非字符串
      // 载荷时会原样返回该值：只把 undefined 当缺失会让下游 JSON.parse('') 抛错，
      // 并把非字符串值泄漏进 string | null 的返回契约
      return typeof value === 'string' && value !== '' ? value : null
    } catch (error) {
      console.error('[WxStorage] getItem error:', error)
      // 与 setItem/removeItem 同口径：记录后重抛。吞掉异常会让「存储读取失败」
      // 退化成「键无数据」，随后的一次落盘就把真实数据覆盖掉（#390）
      throw error
    }
  }

  setItem(key: string, value: string): void {
    try {
      this.wxApi?.setStorageSync?.(key, value)
    } catch (error) {
      console.error('[WxStorage] setItem error:', error)
      throw error
    }
  }

  removeItem(key: string): void {
    try {
      this.wxApi?.removeStorageSync?.(key)
    } catch (error) {
      console.error('[WxStorage] removeItem error:', error)
      // 删除失败必须让调用方看见：否则 clearOnUninstall 会报告「已清除」而数据仍在
      throw error
    }
  }
}
