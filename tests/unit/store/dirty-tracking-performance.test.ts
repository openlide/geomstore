import { createStore } from '@/core/store/index.js'

describe('action ownership indexing', () => {
  it('does not walk the state graph for every scalar write', () => {
    const store = createStore({
      state: { items: Array.from({ length: 600 }, () => ({ value: 0, nested: { value: 0 } })) },
      actions: {
        update() {
          for (const item of this.state.items) item.value++
        },
      },
    })
    const ownKeys = jest.spyOn(Reflect, 'ownKeys')
    try {
      store.dispatch('update')
      expect(ownKeys.mock.calls.length).toBeLessThan(4000)
      expect(store.getState().items.every((item) => item.value === 1)).toBe(true)
    } finally {
      ownKeys.mockRestore()
      store.destroy()
    }
  })

  it('preserves opaque class receivers inside actions', () => {
    class Counter {
      #value = 2
      read() {
        return this.#value
      }
    }
    const store = createStore({
      state: { counter: new Counter() },
      actions: {
        read() {
          return this.state.counter.read()
        },
      },
    })
    expect(store.dispatch('read')).toBe(2)
    store.destroy()
  })

  it('#178 结构性写入（数组 push）不再每次全图重建归属索引', () => {
    const store = createStore({
      state: { items: Array.from({ length: 300 }, (_, i) => ({ value: i, nested: { value: i } })), other: { keep: 1 } },
      actions: {
        appendAll(this: { state: { items: Array<{ value: number; nested: { value: number } }>; other: { keep: number } } }) {
          for (let i = 0; i < 300; i++) this.state.items.push({ value: i, nested: { value: i } })
        },
      },
    })
    const ownKeys = jest.spyOn(Reflect, 'ownKeys')
    try {
      ownKeys.mockClear()
      store.dispatch('appendAll')
      // 每次 push 都触发 index+length 两次全图重建的话：300 × 2 × ~900 个被索引节点 ≈ 54 万次 ownKeys；
      // 增量登记后只剩「一次建索引 + 每个新元素一次子树遍历」
      expect(ownKeys.mock.calls.length).toBeLessThan(20000)
      expect(store.getState().items).toHaveLength(600)
      expect(store.getState().items[599].nested.value).toBe(299)
    } finally {
      ownKeys.mockRestore()
      store.destroy()
    }
  })
})
