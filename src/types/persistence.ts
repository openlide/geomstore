/**
 * GeomStore v1.0 - 持久化类型定义
 */

import type { State } from './store'

/**
 * 存储后端接口
 */
export interface StorageBackend {
  /** 获取值 */
  getItem(key: string): Promise<string | null> | string | null
  /** 设置值 */
  setItem(key: string, value: string): Promise<void> | void
  /** 删除值 */
  removeItem(key: string): Promise<void> | void
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
  getItem(key: string): string | null {
    try {
      // wx 是微信小程序全局变量，由宿主环境提供
      const value = (wx as { getStorageSync: (k: string) => string | undefined }).getStorageSync(key)
      return value === undefined ? null : value
    } catch (error) {
      console.error('[WxStorage] getItem error:', error)
      return null
    }
  }

  setItem(key: string, value: string): void {
    try {
      (wx as { setStorageSync: (k: string, v: string) => void }).setStorageSync(key, value)
    } catch (error) {
      console.error('[WxStorage] setItem error:', error)
      throw error
    }
  }

  removeItem(key: string): void {
    try {
      (wx as { removeStorageSync: (k: string) => void }).removeStorageSync(key)
    } catch (error) {
      console.error('[WxStorage] removeItem error:', error)
    }
  }
}
