/**
 * GeomStore - 全局类型扩展
 */

/**
 * 全局对象扩展
 */
declare global {
  /**
   * 构建时定义的开发模式标志
   *
   * 由打包器在构建期做字符串替换注入（webpack DefinePlugin / rollup replace /
   * 小程序构建工具的常量定义等），本库自身与仓库内的任何构建配置都不注入它——
   * 目前唯一的赋值方是 `tests/setup.ts`（测试运行时挂到 globalThis 上）。
   *
   * `declare const` 只向类型系统声明「这个名字一定可解析」，运行时并不存在这个绑定：
   * 未被替换/未注入时裸读 `__DEV__` 抛的是 `ReferenceError`，而**不是**得到 `undefined`，
   * 所以 `boolean | undefined` 描述的只是「注入后可能显式置为 undefined」。
   * 读取方必须先做存在性检查（`typeof __DEV__ !== 'undefined'` 再取值），切勿裸读；
   * 库内的正确示范见 `core/store/utils.ts` 的 `isProduction()`
   */
  const __DEV__: boolean | undefined
}

export {}
