/**
 * 第六轮 f2-12 分片回归锁：`$patch` 的「改没改」判据与 `setState` 合流
 *
 * `_mutationCount` 是 `notify.onlyOnChange` 的唯一依据（types/store.ts 的公开契约写着
 * 「未修改状态的 dispatch 不触发通知」），而 `$patch` 此前无条件 `this._mutationCount++`
 * 并把补丁触及的每个键标脏、写一遍缓存，于是「补丁值与当前状态逐字相同」甚至「补丁是空对象」
 * 都被记成一次真实变更——两个公开写入 API 对同一次写入给出相反答案。
 * 现在两侧共用同一判据（顶层键 `Object.is`，原型链敏感键读自有描述符）。
 */

import { createStore } from '@/index.js'

/**
 * `createStore` 的 A 形参约束是 `Actions = Record<string, (...args: any[]) => any>`
 * （src/types/store.ts:125）：只有**对象类型字面量**能推出隐式索引签名，`interface` 声明的
 * 成员形状推不出，于是整体不满足约束（TS2344）。改成 type 别名即可，成员与签名一律不动。
 */
type CountingActions = {
  viaPatch(): void
  viaPatchEmpty(): void
  viaSetState(): void
  viaRealPatch(): void
}

function makeStore(notify?: { onlyOnChange?: boolean }) {
  const state = { a: 1, b: 2, obj: { x: 1 } }
  return createStore<typeof state, CountingActions>({
    name: 'r6-086',
    state,
    notify,
    actions: {
      viaPatch() {
        this.$patch({ a: 1 })
      },
      viaPatchEmpty() {
        this.$patch({})
      },
      viaSetState() {
        this.setState('a', 1)
      },
      viaRealPatch() {
        this.$patch({ a: 3 })
      },
    },
  })
}

/** 统计订阅回调次数（只读订阅：回调本身不写状态） */
function countNotifications(store: { subscribe: (listener: () => void) => () => void }): () => number {
  let count = 0
  store.subscribe(() => {
    count++
  })
  return () => count
}

describe('R6-086 $patch 只在真的有变更时推进变更计数', () => {
  it('onlyOnChange 下等值补丁与空补丁都不触发通知，真补丁照常触发', () => {
    const store = makeStore({ onlyOnChange: true })
    const notified = countNotifications(store)

    store.dispatch('viaPatch')
    store.dispatch('viaPatchEmpty')
    expect(notified()).toBe(0)

    // 对照：setState 的既有口径一直是 0（两个 API 从此不再互相矛盾）
    store.dispatch('viaSetState')
    expect(notified()).toBe(0)

    store.dispatch('viaRealPatch')
    expect(notified()).toBe(1)

    store.destroy()
  })

  it('默认配置下等值补丁同样不再广播（与 setState 一致）', () => {
    const store = makeStore()
    const notified = countNotifications(store)

    store.$patch({ a: 1 })
    expect(notified()).toBe(0)
    store.setState('a', 1)
    expect(notified()).toBe(0)

    store.$patch({ a: 2 })
    expect(notified()).toBe(1)

    store.destroy()
  })

  it('逐键粒度：只有真正变化的键被标脏', () => {
    const store = makeStore()
    // 脏键在通知收尾时被清空，只能在监听器内读（与 tests/unit/store/action-dirty-keys 同一取法）
    const seen: Array<{ a: boolean; b: boolean; obj: boolean }> = []
    store.subscribe(() => {
      seen.push({
        a: store.isStateKeyDirty('a' as never),
        b: store.isStateKeyDirty('b' as never),
        obj: store.isStateKeyDirty('obj' as never),
      })
    })

    store.$patch({ a: 1, b: 99 })

    expect(seen).toEqual([{ a: false, b: true, obj: false }])

    store.destroy()
  })

  it('等值补丁不标脏也不通知；嵌套同内容仍是变更', () => {
    const store = makeStore()
    const dirtyFlags: Array<{ obj: boolean }> = []
    store.subscribe(() => {
      dirtyFlags.push({ obj: store.isStateKeyDirty('obj' as never) })
    })

    store.$patch({ a: 1 })
    expect(dirtyFlags).toHaveLength(0)
    expect(store.isStateKeyDirty('a' as never)).toBe(false)

    // 只比顶层、不下探：同内容不同引用的对象照常合并（deepMerge 可能补进目标没有的键）
    store.$patch({ obj: { x: 1 } })
    expect(dirtyFlags).toEqual([{ obj: true }])
    expect(store.getState().obj).toEqual({ x: 1 })

    store.destroy()
  })

  it('钩子成对触发：早退不吞掉 beforePatch / afterPatch', () => {
    const store = makeStore()
    const calls: string[] = []
    store.hooks.on('beforePatch', () => {
      calls.push('before')
    })
    store.hooks.on('afterPatch', () => {
      calls.push('after')
    })

    store.$patch({})
    expect(calls).toEqual(['before', 'after'])

    store.destroy()
  })

  it('新增键（当前值为 undefined）不会被等值早退误吞', () => {
    const store = createStore({ name: 'r6-086-new-key', state: { a: 1 } as Record<string, unknown> })
    const notified = countNotifications(store)

    store.$patch({ fresh: 'x' } as never)

    expect(notified()).toBe(1)
    expect(store.getState().fresh).toBe('x')

    store.destroy()
  })
})
