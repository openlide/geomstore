/**
 * GeomStore - 微信同步存储后端（内置 `StorageBackend` 实现 + 「同步存储」契约的运行时守卫）
 *
 * 契约（`StorageBackend` / `PersistenceOptions`）定义在 `src/types/persistence.ts`，
 * 本文件承载**带 `wx.*` I/O 的运行时实现**与运行时守卫：`src/types/**` 只放类型与接口，
 * 运行时类住在那里会让「types 可被 `import type` 整体擦除」的目录假设失效
 * （开 `verbatimModuleSyntax` 的消费者无法把 `types/*` 当纯类型看）。
 *
 * `persistencePlugin`（`src/plugins/builtin.ts`）的三条后端路径都以本文件为单一来源：
 * - **不传 `storage`** 且 `isWxStorageSyncAvailable()` 为真 → 默认后端就是本类的一个实例。
 *   （曾经是内联适配器各写一份归一化与守卫，与显式 `new WxStorageBackend()` 语义不一致：
 *   微信对缺失键返回的 `''` 只有本类归一为 `null`）
 * - 传 `storage` → `builtin.ts` 用同一个 `assertSyncStorageResult` 校验后端返回值
 * - 检测不到可用的 wx → 降级为内存存储（`builtin.ts`）
 *
 * @module plugins/WxStorageBackend
 */

import type { StorageBackend } from '../types/persistence.js'

/**
 * 小程序 `wx` 同步存储 API 在本库视角下的最小形状
 *
 * 三个方法都可选：真机 / 开发者工具 / Node 测试环境下 `wx` 可能整体缺失或只缺单个方法。
 * 可选只是**类型层面**承认这种残缺环境存在，调用点并不因此短路——`WxStorageBackend` 取用
 * 前逐个校验，缺失即抛错（理由见类注释）。set/remove 的返回类型取 `unknown`（而非 `void`）：
 * 实际返回值要交给 {@link assertSyncStorageResult} 检查——Promise 版 polyfill 正是在这里返回 Promise。
 *
 * 单点声明（原先在 getter 签名、`globalThis` 断言、以及 `builtin.ts` 内联适配器里各写一份
 * 字面量，改动时极易只改一处）：形状沿用小程序 API 的命名与返回类型（`getStorageSync` 返回
 * `unknown`——它会原样返回写入的非字符串载荷），因此**不等价于** `StorageBackend` 契约，
 * 不能用 `Pick<StorageBackend, …>` 派生；两侧的差异由 {@link normalizeWxStoredValue}
 * 与 {@link assertSyncStorageResult} 收口。
 */
export type WxStorageApi = {
  getStorageSync?: (key: string) => unknown
  setStorageSync?: (key: string, value: string) => unknown
  removeStorageSync?: (key: string) => unknown
}

/**
 * 运行时检测异步存储后端。
 * JS 调用方仍可能传入异步实现（如 localStorage 的 Promise 封装），
 * 静默使用会导致恢复时 JSON.parse(Promise) 抛错、保存时异步 rejection 逃出
 * try/catch —— 数据丢失且无感知，因此必须显式报错。
 *
 * @param result 待检的返回值
 * @param methodLabel 出错方法的完整定位串（`storage.getItem` / `wx.getStorageSync`）：
 * 用户后端与内置 wx 适配器共用本守卫，只写 `storage.xxx` 会让「压根没传 storage」的
 * 兼容层场景指向一个调用方并没有用的选项
 */
export function assertSyncStorageResult(result: unknown, methodLabel: string): void {
  if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof (result as PromiseLike<unknown>).then === 'function') {
    throw new Error(
      `[GeomStore][persistence] ${methodLabel}() 返回了 Promise：persistencePlugin 仅支持同步存储后端` +
        `（如 wx.getStorageSync、WxStorageBackend 或同步封装的 localStorage）。` +
        `异步后端请在外部自行订阅 store 实现持久化。`,
    )
  }
}

/** 读取 `globalThis.wx` 的同步存储 API —— 全库唯一读取点（未声明的全局标识符只能经 globalThis 取，TS2304） */
export function readWxStorageSyncApi(): WxStorageApi | undefined {
  return (globalThis as { wx?: WxStorageApi }).wx
}

/**
 * 「本环境是否具备可用的 wx 同步存储」——判定口径的唯一来源。
 *
 * 三个方法齐备才算可用，与 `builtin.ts` 校验用户后端时同一严格度：只探测
 * `getStorageSync` 会让「有读、无写」的残缺环境被判定为可用，而写入侧的 `?.` 短路
 * 又把落盘变成静默 no-op —— 数据一条都没存下、调用方看到的却是成功。判定为不可用
 * 至少会走降级分支（开发模式 `console.warn`、生产模式 `onError`）。
 */
export function isWxStorageSyncAvailable(): boolean {
  const api = readWxStorageSyncApi()

  return typeof api?.getStorageSync === 'function' && typeof api?.setStorageSync === 'function' && typeof api?.removeStorageSync === 'function'
}

/**
 * wx 存储值 → `StorageBackend.getItem` 要求的 `string | null`（「键无数据」的唯一口径）
 *
 * 微信 `getStorageSync` 对不存在的键返回空字符串（而非 undefined），且写入非字符串载荷时
 * 会原样返回该值：只把 undefined 当缺失会让下游 `JSON.parse('')` 抛错，并把非字符串值
 * 泄漏进 `string | null` 的返回契约。
 */
export function normalizeWxStoredValue(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * 微信存储后端
 *
 * 三个方法都要求 `wx` 与对应 API 真实存在：缺失时**抛错**，绝不 `?.` 短路成 no-op。
 * no-op 的代价是静默的数据损失——`setStorageSync`/`removeStorageSync` 缺失会让写入与删除
 * 「看起来成功」（卸载时 `clearOnUninstall` 因此误报已清除），`getStorageSync` 缺失会被
 * {@link normalizeWxStoredValue} 洗成「键无数据」，随后一次落盘即覆盖真实数据。
 *
 * 环境整体不具备可用 wx 同步存储时应走 `persistencePlugin` 的降级分支（判定见
 * {@link isWxStorageSyncAvailable}），而不是把本类当内存存储用。
 */
export class WxStorageBackend implements StorageBackend {
  /** 经 globalThis 读取 wx，避免直接引用未声明的小程序全局标识符 */
  private get wxApi(): WxStorageApi | undefined {
    return readWxStorageSyncApi()
  }

  /**
   * 取出 `wx.<name>` 方法本体及其宿主，缺失或不 callable 时抛错。
   *
   * 返回 `{ api, fn }` 而不是只返回函数：`fn.call(api, …)` 保留 wx 的接收者，
   * 部分基础库实现依赖它。
   */
  private resolve<K extends keyof WxStorageApi>(name: K): { api: WxStorageApi; fn: NonNullable<WxStorageApi[K]> } {
    const api = this.wxApi
    const fn = api?.[name]
    if (!api || typeof fn !== 'function') {
      throw new Error(
        `[GeomStore][persistence] wx.${name} 不可用：WxStorageBackend 需要小程序同步存储 API，` +
          `静默跳过会让写入丢失而调用方看到成功。请改用自建 storage 后端（persistencePlugin 的 storage 选项），` +
          `或确认运行环境已注入 wx。`,
      )
    }
    // indexed access 收窄不到具体签名，运行时已校验过 callable
    return { api, fn: fn as NonNullable<WxStorageApi[K]> }
  }

  /**
   * 统一「记录 + 重抛」口径：三个方法的失败都必须让调用方看见。
   *
   * 读失败不得退化成「键无数据」（随后一次落盘即覆盖真实数据），写/删失败不得静默成功
   * （`clearOnUninstall` 会据此报告「已清除」而数据仍在）。抽成一个方法是为了新增操作时
   * 不会只补上一半行为（只 log 不抛、或只抛不 log），错误文案也只需改一处
   */
  private run<T>(method: string, fn: () => T): T {
    try {
      return fn()
    } catch (error) {
      console.error(`[WxStorage] ${method} error:`, error)
      throw error
    }
  }

  getItem(key: string): string | null {
    return this.run('getItem', () => {
      const { api, fn } = this.resolve('getStorageSync')
      const value = fn.call(api, key)
      // 守卫必须在归一化之前：Promise 不是字符串，先归一化就会把「异步后端」洗成
      // 「键无数据」，随后的一次落盘即覆盖真实数据。本类同时是 `persistencePlugin`
      // 未传 `storage` 时的默认后端，那条路径就靠这里报错
      assertSyncStorageResult(value, 'wx.getStorageSync')

      return normalizeWxStoredValue(value)
    })
  }

  setItem(key: string, value: string): void {
    this.run('setItem', () => {
      const { api, fn } = this.resolve('setStorageSync')
      assertSyncStorageResult(fn.call(api, key, value), 'wx.setStorageSync')
    })
  }

  removeItem(key: string): void {
    this.run('removeItem', () => {
      const { api, fn } = this.resolve('removeStorageSync')
      assertSyncStorageResult(fn.call(api, key), 'wx.removeStorageSync')
    })
  }
}
