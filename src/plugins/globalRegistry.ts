/**
 * GeomStore - 插件全局调试入口注册工具
 *
 * 供 devtools / timeTravel / analyzer 等插件在 globalThis 上按 store.name 暴露调试入口，
 * 统一「覆盖 + 身份守卫清理」语义，避免各插件各写一份（历史上多次因守卫遗漏出 bug）。
 */

/** 注册令牌自增序号：标识「哪一次注册」当前持有 globalKey + storeName 键位 */
let latestRegistrationToken = 0

/**
 * 键位归属表（globalKey + storeName → 当前持有者的令牌）。
 *
 * 不按 api 引用判定归属：devtools 插件注册的是 store 实例本身，同一 store 重复安装
 * 会复用同一引用，先装的卸载函数据此会把后装的条目删掉
 */
const registrationOwners = new Map<string, number>()

/**
 * 在 globalThis 指定全局表键下按 storeName 注册条目，返回卸载函数。
 *
 * 身份守卫：卸载按「本次注册的序号令牌」判定，只有仍由本次注册持有该键位时才删除，
 * 避免同键后装的第二实例被前一份卸载函数误删（同一 api 引用重复注册时，
 * 仅比对引用会把守卫降级成值比较）。
 *
 * 调用方需自行处理生产守卫（生产环境不应注册）。
 *
 * @param globalKey - globalThis 上的全局表键（如 '__GEOMSTORE_TIME_TRAVEL__'）
 * @param storeName - store 名（表内键）
 * @param api - 要暴露的调试入口对象
 * @returns 卸载函数（幂等；globalThis 缺失时为 no-op）
 */
export function registerGlobalEntry(globalKey: string, storeName: string, api: unknown): () => void {
  if (typeof globalThis === 'undefined') {
    return () => {}
  }
  const g = globalThis as unknown as Record<string, Record<string, unknown>>
  const existing = g[globalKey]
  // 容器可信性校验：globalKey 与同名全局键的内容都不受本库控制（旧版本残留、
  // 宿主或外部工具占用）。原始值/函数上写属性在 ESM 严格模式下直接抛 TypeError，
  // 冻结表上的写入同样抛错，都会让整次插件安装失败——换用新表继续（旧表不可写，
  // 保留也没有可读的条目）
  const table =
    typeof existing === 'object' && existing !== null && !Object.isFrozen(existing)
      ? existing
      : ((g[globalKey] = {}) as Record<string, unknown>)

  // 以 defineProperty 写入：storeName 取自 store.name（业务可控），普通赋值遇
  // '__proto__' 会命中 Object.prototype 的 setter 改坏共享表的原型链，
  // 之后所有 storeName 的查找都会穿过被换掉的原型
  Object.defineProperty(table, storeName, { value: api, writable: true, enumerable: true, configurable: true })

  // 令牌记在模块内而非共享表上：表可被外部枚举与改写，
  // 把归属信息放进表里等于让守卫依赖一个不受本库控制的容器
  const ownerKey = `${globalKey}\u0000${storeName}`
  const token = ++latestRegistrationToken
  registrationOwners.set(ownerKey, token)

  return () => {
    // 后一次注册已接管该键位：本次卸载不得再动条目
    if (registrationOwners.get(ownerKey) !== token) {
      return
    }
    registrationOwners.delete(ownerKey)
    const current = g[globalKey]
    // 只删本次注册留下的自有条目：引用比对对原始值 api 会退化成值比较，
    // 加自有属性判定，避免沿原型链命中同名成员后误删/删不掉
    if (current && Object.prototype.hasOwnProperty.call(current, storeName) && current[storeName] === api) {
      delete current[storeName]
    }
  }
}
