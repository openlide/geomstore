/**
 * GeomStore - Store 插件生命周期支持
 *
 * 自 Store.ts 拆出：插件卸载句柄工厂与 Store 品牌标识。
 *
 * @module store/pluginSupport
 */

import type { Plugin as PluginType } from '../../types/plugin.js'
import type { State } from '../../types/store.js'

/** Store 品牌标识：供 isGeomStore 精确识别，避免仅靠鸭子类型（属性存在性）误判 */
export const GEOMSTORE_BRAND: unique symbol = Symbol.for('__geomstore_brand__')

/**
 * 创建插件卸载句柄
 *
 * 句柄绑定创建它的那一次安装（代际令牌）：
 * - 重复调用只在首次生效；清理函数抛错时映射已消费，后续调用不再二次执行；
 * - 卸载后重新安装同一插件时，旧句柄不再影响新安装——否则旧 token 会移除新安装
 *   并执行新安装的清理函数，使重新安装静默失效。
 *
 * 以显式传参接收宿主的插件集合与映射（而非读取实例私有字段），
 * 使本工厂对 Store 实例无隐式依赖。
 *
 * @param plugin - 目标插件
 * @param plugins - 宿主持有的插件集合
 * @param uninstallFns - 宿主持有的「插件 → 卸载函数」映射
 * @param installations - 宿主持有的「插件 → 当前安装代际令牌」映射
 * @param installation - 本次安装的代际令牌
 */
export function createPluginUninstaller<S extends State>(
  plugin: PluginType<S>,
  plugins: PluginType<S>[],
  uninstallFns: Map<PluginType<S>, (() => void) | undefined>,
  installations: Map<PluginType<S>, object>,
  installation: object | undefined,
): () => void {
  let consumed = false
  return () => {
    if (consumed) {
      return
    }
    consumed = true
    // 代际校验：旧安装的句柄不得动到之后的重新安装。
    // 令牌必须非空且与映射一致——缺省参数（`installations.get(plugin)` 未命中时也是
    // undefined）会让 `undefined === undefined` 成立，句柄退化成「无校验卸载」
    const current = installations.get(plugin)
    if (installation === undefined || current !== installation) {
      return
    }

    const index = plugins.indexOf(plugin)
    if (index !== -1) {
      plugins.splice(index, 1)
    }

    const uninstallFn = uninstallFns.get(plugin)
    // 先消费映射再执行清理：清理函数抛错时映射不会被二次读取，
    // 同一句柄的后续调用（consumed）也不会二次执行
    uninstallFns.delete(plugin)
    installations.delete(plugin)
    if (typeof uninstallFn === 'function') {
      uninstallFn()
    }
  }
}
