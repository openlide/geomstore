/**
 * 快照系统（可选能力，按需动态引入）
 *
 * 实现位于同层 `./snapshot/`（v0.5.0 起由 `src/core/snapshot` 物理下沉至 extras）：
 * - `SnapshotManager` / `createSnapshot` / `createSnapshotAsync`：同步与异步快照
 * - 支持进度回调、循环引用检测、`onError` 降级/中止策略、最大深度与体积统计
 *
 * @example
 * ```ts
 * import { createSnapshot } from '@openlide/geomstore/extras/snapshot'
 *
 * const snapshot = createSnapshot(store.state)
 * ```
 *
 * @remarks 也可用动态 `import()` 按需加载，避免进入小程序主包。
 */
export * from './snapshot/index.js'
// `export *` 不转发 default：显式再导出，避免 `import snapshot from '.../extras/snapshot'` 静默拿到 undefined
export { default } from './snapshot/index.js'
