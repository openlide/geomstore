/**
 * 企业级小程序集成（可选能力，按需动态引入）
 *
 * 聚合 `src/integrations/enterprise`：多账号隔离 Store、账号切换与 LRU 清理、
 * 离线队列与死信处理、热更新备份恢复、前后台状态同步，以及 `createEnterpriseApp` 门面。
 *
 * @example
 * ```ts
 * import { createEnterpriseApp } from '@openlide/geomstore/extras/enterprise'
 * ```
 *
 * @remarks 依赖小程序宿主环境的 `wx.*` API；测试环境需注入 mock（见 `tests/setup.ts`）。
 */
export * from '../integrations/enterprise/index.js'
