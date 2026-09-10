/**
 * 组合 Store 的合并缓存降级与脏键追踪
 *
 * 构造期子 store 订阅建立失败（已销毁/订阅配额耗尽）时 `_mergedCacheEnabled`
 * 置为 false，此时每次读取都必须重合并（不得返回陈旧缓存），脏键查询保守返回 true。
 * 另覆盖：缓存可用时命名空间模式的精确脏键追踪、以及销毁后的调度短路。
 */
import { composeStore } from '@/core/compose/index.js'

interface FakeChildInit {
  name: string
  state: Record<string, unknown>
  /** 订阅建立失败（模拟子 store 已销毁或订阅配额耗尽） */
  subscribeThrows?: boolean
  /** 订阅成功时回传回调，供测试手动触发 */
  onSubscribe?: (callback: () => void) => void
}

/**
 * 构造最小可用子 store 桩件。
 *
 * 返回 any：`composeStore` 期望的 StoreLike 与 `Store` 类不完全同构，
 * 桩件只需覆盖被调用到的成员，故不做严格类型约束。
 */
function fakeChild(init: FakeChildInit): any {
  return {
    name: init.name,
    destroyed: false,
    state: init.state,
    getState: () => init.state,
    hooks: { on: () => () => {} },
    destroy: () => {},
    subscribe: (callback: () => void) => {
      if (init.subscribeThrows) {
        throw new Error('subscribe failed: quota exceeded')
      }
      init.onSubscribe?.(callback)
      return () => {}
    },
  }
}

describe('composeStore 合并缓存降级', () => {
  it('命名空间模式下降级：getState/state 每次重合并，脏键保守返回 true', () => {
    const child = fakeChild({ name: 'user', state: { name: 'Alice' }, subscribeThrows: true })
    const composed = composeStore([child], { namespace: true })

    expect(composed.getState()).toEqual({ user: { name: 'Alice' } })
    expect(composed.state).toEqual({ user: { name: 'Alice' } })
    expect(composed.isStateKeyDirty('user')).toBe(true)
  })

  it('非命名空间模式下降级：同样退回每次重合并', () => {
    const child = fakeChild({ name: 'user', state: { name: 'Alice' }, subscribeThrows: true })
    const composed = composeStore([child])

    expect(composed.getState()).toEqual({ name: 'Alice' })
    expect(composed.state).toEqual({ name: 'Alice' })
    expect(composed.isStateKeyDirty('name')).toBe(true)
  })

  it('缓存可用时命名空间模式精确追踪脏子 store', () => {
    const child = fakeChild({ name: 'user', state: { name: 'Alice' } })
    const composed = composeStore([child], { namespace: true })

    // 未发生任何子 store 变更 → 该子 store 不脏
    expect(composed.isStateKeyDirty('user')).toBe(false)
  })

  it('缓存可用时非命名空间模式无法精确映射，保守返回 true', () => {
    const child = fakeChild({ name: 'user', state: { name: 'Alice' } })
    const composed = composeStore([child])

    expect(composed.isStateKeyDirty('name')).toBe(true)
  })

  it('销毁后子 store 变更不再触发组合层调度', () => {
    let childCallback: (() => void) | undefined
    const child = fakeChild({
      name: 'user',
      state: { name: 'Alice' },
      onSubscribe: (callback) => {
        childCallback = callback
      },
    })
    const composed = composeStore([child])
    const listener = jest.fn()
    composed.subscribe(listener)

    composed.destroy()
    // 销毁后迟到的子 store 变更回调应被短路，不得抛出也不得广播
    expect(() => childCallback?.()).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
})
