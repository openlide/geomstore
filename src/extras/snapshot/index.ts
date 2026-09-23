/**
 * GeomStore - 快照模块实现（v0.4.0 起由 `src/core/snapshot` 物理下沉）
 *
 * 目录构成：
 * - `SnapshotManager.ts`：对外门面——`createSnapshot` / `createSnapshotAsync` 编排与便捷函数
 * - `clone.ts`：同步克隆引擎（递归深度克隆、循环引用检测、错误落账与中止）
 * - `clone-async.ts`：异步单节点克隆与任务队列
 * - `diff.ts`：快照差异比较（`compareSnapshots`）
 * - `types.ts`：公开类型
 *
 * 能力概览：
 * - 递归深度克隆（深度由 `maxDepth` 与栈安全硬上限 `HARD_MAX_CLONE_DEPTH` 共同界定；
 *   需要更深的结构请走异步快照，`clone-async` 以任务队列代替调用栈）
 * - 异步快照（分片执行，不阻塞主线程）
 * - 进度回调与 `onError` 降级 / 中止策略
 */

export { SnapshotManager, createSnapshot, createSnapshotAsync } from './SnapshotManager.js'

// 公开类型直接从定义处再导出：不经 SnapshotManager.js 的过渡性再导出中转
// （那份中转只为兼容既有导入路径），否则它哪天删掉某个名字，本入口的类型面
// 会静默缺项、发布的 extras/snapshot 声明随之破裂
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
} from './types.js'

export type { SnapshotDiff } from './diff.js'

export { default } from './SnapshotManager.js'
