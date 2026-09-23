/**
 * GeomStore - Store 插件生命周期支持
 *
 * 自 Store.ts 拆出：插件卸载句柄工厂与 Store 品牌标识。
 *
 * @module store/pluginSupport
 */

import type { Plugin as PluginType } from '../../types/plugin.js'
import type { State } from '../../types/store.js'

/**
 * Store 品牌标识：供 isGeomStore 精确识别，避免仅靠鸭子类型（属性存在性）误判。
 *
 * 刻意用 `Symbol.for` 而非模块级 `Symbol()`：小程序构建产物常出现同一包的重复
 * 副本（分包各自打包、插件把本库打进去），模块级 Symbol 会让副本 A 创建的 Store
 * 在副本 B 的 isGeomStore 下被判为非 GeomStore。键名带包名命名空间以降低与第三方
 * 符号的偶然碰撞——但不带版本号，加版本就重新制造了上述副本分裂。
 *
 * 可伪造性：全局注册表公开，任何人 `Symbol.for('@openlide/geomstore:brand')` 都能
 * 贴出同样的键。本标识**不是安全边界**，只服务对外导出的 isGeomStore 类型守卫
 * （核心内部无消费方），伪造它换不到任何内部访问通道——真正的写入保护来自
 * StateProxy 的陷阱与 `_withInternalAccess` 的代际令牌，与 isGeomStore 无关。
 */
export const GEOMSTORE_BRAND: unique symbol = Symbol.for('@openlide/geomstore:brand')

/**
 * 创建插件卸载句柄
 *
 * 句柄绑定创建它的那一次安装（代际令牌）：
 * - 重复调用只在首次生效；清理函数抛错时映射已消费，后续调用不再二次执行
 *   （异常不吞，由调用方处理，详见下方卸载段的注释）；
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
    // 清理函数的异常按原样向调用方抛出，本工厂不吞：句柄由插件作者/组件写在
    // 卸载链路里，静默失败会把「清理没跑完」变成不可见的资源泄漏。
    // 两条调用路径的口径不同，故不在这里统一兜底——
    // destroy() 自行 try/catch 并 console.error（保证后续订阅/钩子照常清理），
    // use() 返回的裸句柄则由调用方负责；映射此时已消费，重试无效
    if (typeof uninstallFn === 'function') {
      uninstallFn()
    }
  }
}
