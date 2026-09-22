/**
 * GeomStore - 微信同步存储后端（内置 `StorageBackend` 实现）
 *
 * 契约（`StorageBackend` / `PersistenceOptions`）定义在 `src/types/persistence.ts`，
 * 本文件承载**带 `wx.*` I/O 的运行时实现**：`src/types/**` 只放类型与接口，
 * 运行时类住在那里会让「types 可被 `import type` 整体擦除」的目录假设失效
 * （开 `verbatimModuleSyntax` 的消费者无法把 `types/*` 当纯类型看）。
 * 与 `persistencePlugin`（`src/plugins/builtin.ts`）同层：它是文档推荐给小程序场景的显式后端。
 *
 * 注意：`persistencePlugin` 在**不传** `storage` 时并不实例化本类，而是走 `builtin.ts`
 * 内联的 wx 适配器（那条路径自带异步返回值守卫）；本类用于显式
 * `persistencePlugin({ storage: new WxStorageBackend() })` 或在插件体系之外直接读写。
 *
 * @module plugins/WxStorageBackend
 */

import type { StorageBackend } from '../types/persistence.js'

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
