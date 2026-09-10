/**
 * GeomStore - 插件全局调试入口注册工具
 *
 * 供 devtools / timeTravel / analyzer 等插件在 globalThis 上按 store.name 暴露调试入口，
 * 统一「覆盖 + 身份守卫清理」语义，避免各插件各写一份（历史上多次因守卫遗漏出 bug）。
 */

/**
 * 在 globalThis 指定全局表键下按 storeName 注册条目，返回卸载函数。
 *
 * 身份守卫：同一 storeName 后装的第二实例会覆盖该条目，卸载时仅当条目仍指向
 * 本次注册的 api 才删除，避免误删后来者注册的同名入口。
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
  const table = g[globalKey] ?? (g[globalKey] = {})
  table[storeName] = api
  return () => {
    const current = g[globalKey]
    if (current && current[storeName] === api) {
      delete current[storeName]
    }
  }
}
