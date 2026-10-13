/**
 * 快照系统（可选能力，按需动态引入）
 *
 * 实现位于同层 `./snapshot/`（v0.4.0 起由 `src/core/snapshot` 物理下沉至 extras）：
 * - `SnapshotManager` / `createSnapshot` / `createSnapshotAsync`：同步与异步快照
 * - `compareSnapshots`：快照差异比较
 * - 支持进度回调、循环引用检测、`onError` 降级/中止策略、最大深度与体积统计
 * - 类型：`SnapshotOptions` / `SnapshotResult` / `SnapshotMetadata` / `SnapshotStats` /
 *   `SnapshotDiff` / `SnapshotProgress` / `SnapshotError` / `SnapshotErrorContext` /
 *   `CloneContext` / `AsyncSnapshotOptions`
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
// 显式列举公开面：`export *` 会让 ./snapshot/index.js 的任何新增导出自动成为包 API，
// 其中可能包含仅内部使用的符号。此处与 ./snapshot/index.ts 的导出清单保持同步
export {
  SnapshotManager,
  createSnapshot,
  createSnapshotAsync,
  compareSnapshots,
} from './snapshot/index.js'
export type {
  SnapshotOptions,
  CloneContext,
  SnapshotProgress,
  SnapshotError,
  SnapshotErrorContext,
  SnapshotResult,
  SnapshotMetadata,
  SnapshotStats,
  AsyncSnapshotOptions,
  SnapshotDiff,
} from './snapshot/index.js'
// `export *` 不转发 default：显式再导出，避免 `import snapshot from '.../extras/snapshot'` 静默拿到 undefined
export { default } from './snapshot/index.js'
