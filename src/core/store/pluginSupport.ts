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
 * 幂等：重复调用只在首次生效（移出 plugins、调用插件自身的卸载函数、清除映射），
 * 之后再调为安全 no-op。首次安装与重复安装返回的都是由本工厂生成的等价句柄，
 * 因此重复 use() 拿到的 token 与首个 token 行为一致。
 *
 * 以显式传参接收宿主的插件集合与卸载映射（而非读取实例私有字段），
 * 使本工厂对 Store 实例无隐式依赖。
 *
 * @param plugin - 目标插件
 * @param plugins - 宿主持有的插件集合
 * @param uninstallFns - 宿主持有的「插件 → 卸载函数」映射
 */
export function createPluginUninstaller<S extends State>(
  plugin: PluginType<S>,
  plugins: PluginType<S>[],
  uninstallFns: Map<PluginType<S>, (() => void) | undefined>,
): () => void {
  return () => {
    const index = plugins.indexOf(plugin)
    if (index !== -1) {
      plugins.splice(index, 1)
    }

    const uninstallFn = uninstallFns.get(plugin)
    if (typeof uninstallFn === 'function') {
      uninstallFn()
    }

    uninstallFns.delete(plugin)
  }
}
