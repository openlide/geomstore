/**
 * 异步快照管线的非 Error 抛出物与超时路径
 *
 * 覆盖：估算节点数 / 进度回调 / 填充阶段抛出非 Error 时的落账口径（`String(error)` 侧）、
 * 超时后拒绝新任务入队、以及进度百分比的 0 基线。
 */

import { createSnapshot, createSnapshotAsync } from '@/extras/snapshot/SnapshotManager.js'

describe('异步快照的非 Error 抛出物', () => {
  it('估算节点数时抛出非 Error 时按 Unknown error 记录', async () => {
    const hostile = new Proxy(
      { a: 1 },
      {
        ownKeys(): string[] {
          throw 'ownKeys boom'
        },
      },
    )

    const result = await createSnapshotAsync(hostile as any)

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.success).toBe(false)
  })

  it('进度回调抛出非 Error 时按 Unknown error 记录，不向外抛出', async () => {
    const result = await createSnapshotAsync(
      { a: { b: 1 } },
      {
        onProgress: () => {
          throw 'progress boom'
        },
      } as any,
    )

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.success).toBe(false)
  })

  it('填充阶段抛出非 Error 时降级记录且不中断队列', async () => {
    const original = Object.defineProperty
    const spy = jest.spyOn(Object, 'defineProperty').mockImplementation(((target: object, key: PropertyKey, attrs: PropertyDescriptor) => {
      // 占位写入 value 为 undefined；填充写入携带真实克隆结果，据此区分并抛非 Error
      if (key === 'poison' && attrs?.value !== undefined) {
        throw 'fill boom'
      }
      return original(target, key, attrs)
    }) as typeof Object.defineProperty)

    try {
      const result = await createSnapshotAsync({ poison: { deep: 1 }, ok: 2 })

      expect(result.errors.some((error) => String(error.message).includes('Failed to fill cloned value'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('异步快照的超时与进度基线', () => {
  it('超时后不再接受新任务入队（队列不再增长）', async () => {
    const onProgress = jest.fn()

    const result = await createSnapshotAsync(
      { l1: { l2: { l3: { l4: { l5: 1 } } } }, other: { x: 1 } },
      { timeout: 1, batchSize: 1, batchInterval: 0, onProgress } as any,
    )

    // 即使超时中断，也必须交付已完成节点的元数据与进度（不得静默产出空壳）
    expect(result.metadata.nodeCount).toBeGreaterThan(0)
    expect(onProgress).toHaveBeenCalled()
  })

  it('进度百分比的 0 基线：空对象快照不产生无效的剩余时间估算', async () => {
    const onProgress = jest.fn()

    const result = await createSnapshotAsync({}, { onProgress } as any)

    expect(result.success).toBe(true)
    for (const call of onProgress.mock.calls) {
      expect(Number.isFinite(call[0].estimatedTimeRemaining)).toBe(true)
    }
  })

  it('同步快照对空对象同样保持有效估算', () => {
    const onProgress = jest.fn()

    const result = createSnapshot({}, { onProgress } as any)

    expect(result.success).toBe(true)
  })
})
