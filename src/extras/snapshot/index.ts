/**
 * GeomStore - 快照模块实现（v0.5.0 起由 `src/core/snapshot` 物理下沉）
 *
 * 目录构成：
 * - `SnapshotManager.ts`：对外门面——`createSnapshot` / `createSnapshotAsync` 编排与便捷函数
 * - `clone.ts`：同步克隆引擎（迭代式深度克隆、循环引用检测、错误落账与中止）
 * - `clone-async.ts`：异步单节点克隆与任务队列
 * - `diff.ts`：快照差异比较（`compareSnapshots`）
 * - `types.ts`：公开类型
 *
 * 能力概览：
 * - 迭代式深度克隆（支持循环引用检测）
 * - 异步快照（分片执行，不阻塞主线程）
 * - 进度回调与 `onError` 降级 / 中止策略
 */

export { SnapshotManager, createSnapshot, createSnapshotAsync } from './SnapshotManager.js'

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
} from './SnapshotManager.js'

export { default } from './SnapshotManager.js'
