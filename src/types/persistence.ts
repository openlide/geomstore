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
 *
 * 内置实现见 `src/plugins/WxStorageBackend.ts`（`wx.*StorageSync` 适配器）：
 * 本文件只声明契约，带 I/O 的运行时实现与 `persistencePlugin` 同层。
 * `persistencePlugin` **不传** `storage` 时的默认后端同样是这个类（判定与归一化口径
 * 因此只有一处实现），仅在检测不到可用的 wx 同步 API 时降级为内存存储。
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
  /**
   * 状态过滤器：决定哪些键落盘。
   *
   * **保存与恢复两条路径都会套用**（`src/plugins/builtin.ts`：落盘前 `filter(state)`，
   * 恢复时对读出的状态再 `filter(parsedState)` 才 `$patch`），所以它同时是「写出的子集」
   * 和「允许被恢复回来的子集」——只在前一条路径生效的直觉是错的。
   */
  filter?: (state: S) => Partial<S>
  /** 状态验证器（恢复前校验，返回 false 则拒绝恢复） */
  validate?: (state: unknown) => state is S
  /** 是否在插件安装时恢复已持久化的状态（默认 `true`；置为 `false` 则只落盘、不回填状态） */
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
