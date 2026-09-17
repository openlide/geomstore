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
})
