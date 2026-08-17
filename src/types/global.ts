/**
 * GeomStore v1.0 - 全局类型扩展
 */

/**
 * 全局对象扩展
 */
declare global {
  /**
   * 构建时定义的开发模式标志
   */
  const __DEV__: boolean | undefined

  /**
   * 微信小程序全局对象 wx 的最小声明
   *
   * 完整类型来自 miniprogram-api-typings，此处仅声明库内部使用到的 API，
   * 避免消费方未安装该类型包时出现 ts(2304)。
   */
  const wx: {
    getStorageSync(key: string): string | undefined
    setStorageSync(key: string, data: string): void
    removeStorageSync(key: string): void
    getUpdateManager(): {
      onUpdateReady(callback: () => void): void
      onUpdateFailed(callback: () => void): void
      applyUpdate(): void
    }
    showModal(options: { title?: string; content?: string; success?: (res: { confirm: boolean }) => void }): void
    showToast(options: { title: string; icon?: string }): void
    showLoading(options?: { title?: string }): void
    hideLoading(): void
    onNetworkStatusChange(callback: (res: { isConnected: boolean }) => void): void
    offNetworkStatusChange?(callback: (res: { isConnected: boolean }) => void): void
    getNetworkType(options: { success: (res: { networkType: string }) => void }): void
    request(options: { url: string; success: (res: unknown) => void; fail?: (err: unknown) => void }): void
    getPerformance(): { now(): number }
  }

  /**
   * 微信小程序全局 App 构造器的最小声明
   * （enterprise 集成通过 App.prototype 拦截前后台生命周期）
   */
  const App: {
    (options: unknown): void
    prototype: {
      onShow?: (...args: unknown[]) => void
      onHide?: (...args: unknown[]) => void
    }
  }
}

export {}
