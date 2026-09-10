/**
 * P0-5 回归：extras 子入口的导出完整性
 *
 * - extras/error 需导出 isComposeError（此前有 ComposeError 类却缺守卫）
 * - extras/snapshot 需转发 内部快照模块 的 default 导出（export * 不转发 default）
 */
import { ComposeError, isComposeError } from '@/extras/error/index.js'
import SnapshotDefault, { SnapshotManager } from '@/extras/snapshot.js'

describe('extras 子入口导出（P0-5 回归）', () => {
  it('isComposeError 应能窄化 ComposeError', () => {
    const err = new ComposeError('compose failed', 'COMPOSE_ERROR')
    expect(isComposeError(err)).toBe(true)
    expect(isComposeError(new Error('plain'))).toBe(false)
    expect(isComposeError(null)).toBe(false)
  })

  it('extras/snapshot 应转发 内部快照模块 的 default 导出', () => {
    expect(SnapshotDefault).toBe(SnapshotManager)
    expect(SnapshotDefault).toBeDefined()
  })
})
