/**
 * GeomStore v1.0 - 快照模块
 *
 * 提供高性能的状态快照功能，包括：
 * - 迭代式深度克隆（支持循环引用检测）
 * - 异步快照（非阻塞操作）
 * - 进度回调与错误处理
 */

export { SnapshotManager, createSnapshot, createSnapshotAsync } from './SnapshotManager'

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
} from './SnapshotManager'

export { default } from './SnapshotManager'
