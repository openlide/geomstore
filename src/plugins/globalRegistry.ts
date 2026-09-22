/**
 * GeomStore - 插件全局调试入口注册工具
 *
 * 供 devtools / timeTravel / analyzer 等插件在 globalThis 上按 store.name 暴露调试入口，
 * 统一「覆盖 + 身份守卫清理」语义，避免各插件各写一份（历史上多次因守卫遗漏出 bug）。
 */

import { isProduction } from '../core/store/utils.js'

/** 注册令牌自增序号：标识「哪一次注册」当前持有 globalKey + storeName 键位 */
let latestRegistrationToken = 0

/**
 * 键位归属表：globalKey → storeName → 当前持有者的令牌。
 *
 * 不按 api 引用判定归属：devtools 插件注册的是 store 实例本身，同一 store 重复安装
 * 会复用同一引用，先装的卸载函数据此会把后装的条目删掉。
 *
 * 用嵌套 Map 而非 `${globalKey}\u0000${storeName}` 拼键：拼接键在任一成员含 NUL 时
 * 就会与另一对 (globalKey, storeName) 撞车，撞车的一方卸载时令牌判不等 → 条目永久留在
 * 全局表上。嵌套结构还让每个 globalKey 的归属可单独检视/清空
 */
const registrationOwners = new Map<string, Map<string, number>>()

/** 登记本次注册为该键位的当前持有者 */
function claimOwner(globalKey: string, storeName: string, token: number): void {
  let byStore = registrationOwners.get(globalKey)
  if (byStore === undefined) {
    byStore = new Map<string, number>()
    registrationOwners.set(globalKey, byStore)
  }
  byStore.set(storeName, token)
}

/**
 * 释放键位：仍由本次注册持有才返回 true。
 *
 * 内层表清空后一并摘掉，使本表规模正比于「当前在册的键位数」而不是「出现过的键位数」
 */
function releaseOwner(globalKey: string, storeName: string, token: number): boolean {
  const byStore = registrationOwners.get(globalKey)
  if (byStore === undefined || byStore.get(storeName) !== token) {
    return false
  }
  byStore.delete(storeName)
  if (byStore.size === 0) {
    registrationOwners.delete(globalKey)
  }

  return true
}

/**
 * 在 globalThis 指定全局表键下按 storeName 注册条目，返回卸载函数。
 *
 * 身份守卫：卸载按「本次注册的序号令牌」判定，只有仍由本次注册持有该键位时才删除，
 * 避免同键后装的第二实例被前一份卸载函数误删（同一 api 引用重复注册时，
 * 仅比对引用会把守卫降级成值比较）。
 *
 * 生产守卫内置（#366）：本 helper 是 fail-safe 的——`isProduction()` 为真时直接返回
 * no-op，绝不往 globalThis 写任何内部引用。调用方仍以 `if (!isProduction())` 早退
 * 为宜（省掉闭包构造与日志开销），但即使漏写也不会把 store/API 泄露到生产包。
 *
 * @param globalKey - globalThis 上的全局表键（如 '__GEOMSTORE_TIME_TRAVEL__'）
 * @param storeName - store 名（表内键）
 * @param api - 要暴露的调试入口对象
 * @returns 卸载函数（幂等；globalThis 缺失或生产环境时为 no-op）
 */
export function registerGlobalEntry(globalKey: string, storeName: string, api: unknown): () => void {
  if (typeof globalThis === 'undefined') {
    return () => {}
  }
  if (isProduction()) {
    return () => {}
  }
  const g = globalThis as unknown as Record<string, Record<string, unknown>>
  const existing = g[globalKey]
  // 容器可信性校验：globalKey 与同名全局表的内容都不受本库控制（旧版本残留、
  // 宿主或外部工具占用）。原始值/函数上写属性在 ESM 严格模式下直接抛 TypeError。
  // 判据用 Object.isExtensible 而非 Object.isFrozen：只 `seal` 而未 `freeze` 的表
  // isFrozen 为 false、自有属性也仍可写，但本函数要写的是一个**新键**，
  // 不可扩展的表上 defineProperty 照样抛错——按 isFrozen 判定会把它当成可用容器复用。
  // isExtensible / keys 两步都要读外部容器（可能是挂了 trap 的 Proxy），连同判定一起
  // 圈进 try：探测失败按「不可复用」处理（换新表），而不是放弃这次注册
  let table: Record<string, unknown> | undefined
  let discardedEntries = 0
  try {
    if (typeof existing === 'object' && existing !== null && Object.isExtensible(existing)) {
      table = existing as Record<string, unknown>
    } else if ((typeof existing === 'object' && existing !== null) || typeof existing === 'function') {
      // 只有 object-like 才挂得住条目：原始值上的属性写不上去，
      // 而 `Object.keys('abc')` 会读出字符下标，据此告警等于谎报丢了数据
      discardedEntries = Object.keys(existing).length
    }
  } catch (error) {
    console.warn(`[GeomStore] globalThis.${globalKey} 上的既有容器无法探测，按不可复用处理并换新表：`, error)
  }

  if (!table) {
    try {
      // 兜底建表同样可能抛：globalThis[globalKey] 可以是非可写数据属性或只读访问器属性
      table = (g[globalKey] = {}) as Record<string, unknown>
    } catch (error) {
      console.warn(`[GeomStore] 无法在 globalThis.${globalKey} 建立调试表，本次注册跳过：`, error)
      return () => {}
    }
    if (discardedEntries > 0) {
      // 换表等于抛弃同键位下其他 store 的调试入口：它们的卸载函数据自有属性判定会退化成
      // 空操作，条目连同入口无声消失。这一步必须出声，否则这类失配在现场几乎无法定位
      console.warn(
        `[GeomStore] globalThis.${globalKey} 上原有 ${discardedEntries} 个调试条目的容器不可复用` +
          `（不是对象或不可扩展），已换新表：这些条目的调试入口随即失效，其卸载函数也成为空操作`,
      )
    }
  }

  // 以 defineProperty 写入：storeName 取自 store.name（业务可控），普通赋值遇
  // '__proto__' 会命中 Object.prototype 的 setter 改坏共享表的原型链，
  // 之后所有 storeName 的查找都会穿过被换掉的原型。
  // 即使表可扩展，同名键也可能已被外部定义成不可配置属性 → 写入抛 TypeError，
  // 而本 helper 的承诺是 fail-safe（不抛错、不中断插件安装）
  try {
    Object.defineProperty(table, storeName, { value: api, writable: true, enumerable: true, configurable: true })
  } catch (error) {
    console.warn(`[GeomStore] globalThis.${globalKey}.${storeName} 不可写，本次注册跳过：`, error)
    return () => {}
  }

  // 令牌记在模块内而非共享表上：表可被外部枚举与改写，
  // 把归属信息放进表里等于让守卫依赖一个不受本库控制的容器
  const token = ++latestRegistrationToken
  claimOwner(globalKey, storeName, token)

  return () => {
    // 后一次注册已接管该键位：本次卸载不得再动条目
    if (!releaseOwner(globalKey, storeName, token)) {
      return
    }
    const current = g[globalKey]
    // 只删本次注册留下的自有条目：引用比对对原始值 api 会退化成值比较，
    // 加自有属性判定，避免沿原型链命中同名成员后误删/删不掉
    if (current && Object.prototype.hasOwnProperty.call(current, storeName) && current[storeName] === api) {
      delete current[storeName]
      // 表内已无条目时连容器一起摘掉（#365）：留着空表会让 globalThis 长期挂着
      // 本库的键位，外部读到空对象也分不清「没有插件活跃」还是「有插件但无 store」。
      // 必须先认 identity：条目也可能是外部在这之后换上的另一个对象，
      // 只看「空了」就会把别人正挂着的表从 globalThis 上删掉
      if (current === table && Object.keys(current).length === 0) {
        delete g[globalKey]
      }
    }
  }
}
