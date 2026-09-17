import { createStore } from '@/core/store/index.js'
import { bindMappings } from '@/integrations/utils.js'

describe('notification reentrancy keeps dirty keys for the next round', () => {
  it('marks keys written by a listener during async notifications', async () => {
    const store = createStore({
      state: { trigger: 0, obj: { n: 0 } },
      notify: { async: true },
    })
    // 视图侧模拟：setData 写入 JSON 副本，避免共享引用掩盖漏更新
    const view: Record<string, unknown> = {}
    const unbinds = bindMappings(
      {},
      { obj: 'obj' },
      (key) => store.getState()[key as 'obj'],
      (updates) => {
        for (const [key, value] of Object.entries(updates)) {
          view[key] = JSON.parse(JSON.stringify(value))
        }
      },
      (callback) => store.subscribe(callback, { readOnly: true }),
      (key) => store.isStateKeyDirty(key),
    )

    let patched = false
    const off = store.subscribe(() => {
      if (!patched) {
        patched = true
        store.$patch({ obj: { n: 1 } })
      }
    })

    try {
      store.setState('trigger', 1)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(store.getState().obj.n).toBe(1)
      expect(view.obj).toEqual({ n: 1 })
    } finally {
      off()
      unbinds.forEach((unbind) => unbind())
      store.destroy()
    }
  })

  it('does not announce stale keys after a notification', () => {
    const store = createStore({ state: { a: 0, b: 0 } })
    const dirtySnapshots: Array<[boolean, boolean]> = []
    const off = store.subscribe(() => {
      dirtySnapshots.push([store.isStateKeyDirty('a'), store.isStateKeyDirty('b')])
    })

    try {
      store.setState('a', 1)
      // 通知期间写入 b：a 已随本轮通知，b 归下一轮
      expect(dirtySnapshots).toEqual([[true, false]])
    } finally {
      off()
      store.destroy()
    }
  })
})
