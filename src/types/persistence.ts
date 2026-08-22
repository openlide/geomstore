/**
 * GeomStore v1.0 - 持久化类型定义
 */

import type { State } from './store'

/**
 * 存储后端接口
 *
 * 仅支持同步后端：persistencePlugin 的恢复与保存均为同步语义，
 * 异步后端（返回 Promise）会在运行时被检测并报错。
 * 如需异步持久化，请在外部自行订阅 store 并处理异步写入。
 */
export interface StorageBackend {
  /** 获取值（必须同步返回） */
  getItem(key: string): string | null
  /** 设置值（必须同步返回） */
  setItem(key: string, value: string): void
  /** 删除值（必须同步返回） */
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
  /** 防抖延迟（毫秒） */
  debounce?: number
  /** 卸载插件时是否清除存储数据（默认 false，仅停止监听，保留已持久化的数据） */
  clearOnUninstall?: boolean
}

/**
 * 微信存储后端
 */
export class WxStorageBackend implements StorageBackend {
  /** 经 globalThis 读取 wx，避免直接引用未声明的小程序全局标识符 */
  private get wxApi():
    | { getStorageSync?: (k: string) => string | undefined; setStorageSync?: (k: string, v: string) => void; removeStorageSync?: (k: string) => void }
    | undefined {
    return (
      globalThis as {
        wx?: { getStorageSync?: (k: string) => string | undefined; setStorageSync?: (k: string, v: string) => void; removeStorageSync?: (k: string) => void }
      }
    ).wx
  }

  getItem(key: string): string | null {
    try {
      const value = this.wxApi?.getStorageSync?.(key)
      return value === undefined ? null : value
    } catch (error) {
      console.error('[WxStorage] getItem error:', error)
      return null
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
    }
  }
}
