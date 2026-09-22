/**
 * Extras 示例：快照（隔离副本与异步分片）
 *
 * 覆盖：createSnapshot 的隔离语义与错误账本、createSnapshotAsync 的进度回调与 onError 策略。
 *
 * 发布包等价导入：`@openlide/geomstore/extras/snapshot`
 */

import { createStore } from '../../src/index.js'
import { createSnapshot, createSnapshotAsync } from '../../src/extras/snapshot.js'

// 先定义状态类型：嵌套的空数组同样无需 `as` 断言
interface EditorState {
  draft: { title: string; tags: string[] }
  dirty: boolean
}

const editorStore = createStore({
  name: 'editor',
  state: (): EditorState => ({
    draft: { title: '', tags: [] },
    dirty: false,
  }),
  actions: {
    // action 的 this 由 Store 自动注入，无需手写标注
    publish(): void {
      this.$patch({ dirty: false })
    },
  },
})

editorStore.$patch({ draft: { title: '初稿', tags: ['a'] }, dirty: true })

// 同步快照：返回隔离副本，后续修改活状态不会穿透进快照
const snapshot = createSnapshot(editorStore.getState())
editorStore.$patch({ draft: { title: '修改后', tags: ['a', 'b'] } })

console.log('快照是否成功:', snapshot.success, '节点数:', snapshot.metadata.nodeCount)
// data 只在 success 为 true 时保证是完整克隆，失败分支可能是 undefined 或半成品，所以用前先判 success
if (snapshot.success && snapshot.data) {
  console.log('快照内标题:', snapshot.data.draft.title) // 初稿
  console.log('活状态标题:', editorStore.getState().draft.title) // 修改后
}

// 异步快照：按批次让出控制权，适合大对象；onError 决定单节点失败后是否继续
createSnapshotAsync(
  { big: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`k${i}`, i])) },
  {
    batchSize: 10,
    onProgress: (progress) => console.log(`进度 ${progress.percentage}%（${progress.processed}/${progress.total}）`),
    // 返回 true 继续（丢弃该节点），false 中止整次快照
    onError: (error) => {
      console.warn('节点克隆失败:', error.path)
      return true
    },
  },
).then((result) => {
  console.log('异步快照成功:', result.success, '错误数:', result.errors.length)
})

console.log('\n✅ 快照样例完成')
