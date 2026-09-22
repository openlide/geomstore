/**
 * 企业级小程序集成（可选能力，经独立子路径按需引入）
 *
 * 聚合 `src/integrations/enterprise`：多账号隔离 Store、账号切换与 LRU 清理、
 * 离线队列与死信处理、热更新备份恢复、前后台状态同步，以及 `createEnterpriseApp` 门面。
 *
 * 「按需」是**引用按需**，不是惰性求值：本入口是一条静态 `export *`，import 它即同步
 * 求值整个 `integrations/enterprise` 依赖图（含模块级单例 `storeManager = new StoreManager()`），
 * 本库不提供延迟初始化的 helper。不进主包要靠小程序分包/动态 `import()` 由调用方在本子路径上做：
 * `const { createEnterpriseApp } = await import('@openlide/geomstore/extras/enterprise')`
 *
 * @example
 * ```ts
 * import { createEnterpriseApp } from '@openlide/geomstore/extras/enterprise'
 * ```
 *
 * @remarks 依赖小程序宿主环境的 `wx.*` API；测试环境需注入 mock（见 `tests/setup.ts`）。
 */
export * from '../integrations/enterprise/index.js'
