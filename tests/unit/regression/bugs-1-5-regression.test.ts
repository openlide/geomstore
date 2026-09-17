import { createStore } from '@/core/store/index.js'
import { composeStore } from '@/core/compose/composeStore.js'
import { createSelector } from '@/extras/selector/createSelector.js'
import { getStateVersion } from '@/core/store/stateVersion.js'

// Keep these public-API regressions together: each warms the cache/registration
// before entering the window in which the original implementation went stale.
describe('store identity, cache invalidation and subscription regressions', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => {
    for (const destroy of cleanup.splice(0).reverse()) destroy()
  })
  function own<T extends { destroy(): void }>(store: T): T {
    cleanup.push(() => store.destroy())
    return store
  }

  it('isolates same-version selector entries across stores, including history hits', () => {
    const a = own(createStore({ name: 'selector-a', state: { value: 'A0' } }))
    const b = own(createStore({ name: 'selector-b', state: { value: 'B0' } }))
    const compute = jest.fn((s: { value: string }) => ({ value: s.value }))
    const select = createSelector(compute, { cacheTTL: Infinity, cacheSize: 4 })

    expect(getStateVersion(a.state)).toBeDefined()
    expect(getStateVersion(a.state)).toBe(getStateVersion(b.state))
    const firstA = select(a.state)
    const firstB = select(b.state)
    expect(firstA).toEqual({ value: 'A0' })
    expect(firstB).toEqual({ value: 'B0' })
    expect(firstB).not.toBe(firstA)
    expect(select(a.state)).toBe(firstA)
    expect(select(b.state)).toBe(firstB)
    expect(compute).toHaveBeenCalledTimes(2)

    a.$patch({ value: 'A1' })
    b.$patch({ value: 'B1' })
    expect(getStateVersion(a.state)).toBe(getStateVersion(b.state))
    const nextA = select(a.state)
    const nextB = select(b.state)
    expect(nextA).toEqual({ value: 'A1' })
    expect(nextB).toEqual({ value: 'B1' })
    expect(select(a.state)).toBe(nextA)
    expect(select(b.state)).toBe(nextB)
    expect(compute).toHaveBeenCalledTimes(4)
  })

  it.each([false, true])('removes action-deleted cached keys (explicit cache keys: %s)', (explicitKeys) => {
    const store = own(
      createStore({
        name: 'cache-delete',
        state: { tmp: 'pending', keep: 1 } as { tmp?: string; keep: number },
        enableCache: true,
        cacheConfig: { ttl: 0 },
        cacheKeys: explicitKeys ? ['tmp', 'keep'] : undefined,
        actions: {
          removeTmp() {
            delete this.state.tmp
          },
        },
      }),
    )
    expect(store.getCached('tmp')).toBe('pending')
    store.dispatch('removeTmp')
    expect(store.getState()).not.toHaveProperty('tmp')
    expect(store.getCacheStats().keys).not.toContain('tmp')
    expect(store.getCached('tmp')).toBeUndefined()
    expect(store.getCached('keep')).toBe(1)
    store.$patch({ tmp: 'new value' })
    expect(store.getCached('tmp')).toBe('new value')
  })

  it('$replaceState clears an orphan cache entry before action completion refresh', () => {
    // Delete and replace in ONE action: the deleted key is absent from the old
    // state key list, but still cached when replacement begins. Observe inside
    // the action so dispatch's final refresh cannot mask a broken replacement.
    let observed: { keys: string[]; orphan: string | undefined; kept: string } | undefined
    const store = own(
      createStore({
        name: 'cache-replace-orphan',
        state: { orphan: 'stale', kept: 'old' } as { orphan?: string; kept: string },
        enableCache: true,
        cacheConfig: { ttl: 0 },
        actions: {
          replaceAfterDelete() {
            delete this.state.orphan
            this.$replaceState({ kept: 'replaced' })
            observed = {
              keys: store.getCacheStats().keys,
              orphan: store.getCached('orphan'),
              kept: store.getCached('kept'),
            }
          },
        },
      }),
    )
    expect(store.getCached('orphan')).toBe('stale')
    store.dispatch('replaceAfterDelete')
    expect(observed).toEqual({ keys: ['kept'], orphan: undefined, kept: 'replaced' })
    expect(store.getState()).toEqual({ kept: 'replaced' })
  })

  it.each([false, true])('duplicate subscription handles are independently idempotent (readOnly: %s)', (readOnly) => {
    const store = own(createStore({ name: 'subscriptions', state: { count: 0 } }))
    const listener = jest.fn()
    const first = store.subscribe(listener, { readOnly })
    const second = store.subscribe(listener, { readOnly })
    store.$patch({ count: 1 })
    expect(listener).toHaveBeenCalledTimes(2)
    listener.mockClear()

    first()
    first()
    first()
    store.$patch({ count: 2 })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ count: 2 }))
    listener.mockClear()
    second()
    second()
    store.$patch({ count: 3 })
    expect(listener).not.toHaveBeenCalled()

    // A consumed handle must not cancel a new registration of the same callback.
    const third = store.subscribe(listener, { readOnly })
    first()
    second()
    store.$patch({ count: 4 })
    expect(listener).toHaveBeenCalledTimes(1)
    listener.mockClear()
    third()
    third()
    store.$patch({ count: 5 })
    expect(listener).not.toHaveBeenCalled()
  })

  describe.each([false, true])('composed read freshness (namespace: %s)', (namespace) => {
    it.each(['state', 'getState'] as const)('invalidates both warmed caches during a batch (%s read first)', (firstRead) => {
      const leaf = own(createStore({ name: 'leaf', state: { count: 1, extra: true } as { count: number; extra?: boolean } }))
      const composed = own(composeStore([leaf], { namespace }))
      const expected = (count: number, extra?: boolean) => {
        const state = extra === undefined ? { count } : { count, extra }
        return namespace ? { leaf: state } : state
      }
      const readBoth = (value: unknown) => {
        if (firstRead === 'state') {
          expect(composed.state).toEqual(value)
          expect(composed.getState()).toEqual(value)
        } else {
          expect(composed.getState()).toEqual(value)
          expect(composed.state).toEqual(value)
        }
      }
      const initial = composed.getState()
      const initialFrozen = composed.state
      expect(composed.getState()).toBe(initial)
      expect(composed.state).toBe(initialFrozen)
      const listener = jest.fn()
      leaf.subscribe(listener)

      leaf.batch(() => {
        leaf.setState('count', 5)
        readBoth(expected(5, true))
        leaf.$patch({ count: 6 })
        readBoth(expected(6, true))
        leaf.$replaceState({ count: 42 })
        readBoth(expected(42))
        expect(listener).not.toHaveBeenCalled()
      })
      expect(listener).toHaveBeenCalledTimes(1)
      readBoth(expected(42))
    })

    it('reads fresh before async notifications flush, without forcing notification', async () => {
      const leaf = own(createStore({ name: 'leaf', state: { count: 1 }, notify: { async: true } }))
      const composed = own(composeStore([leaf], { namespace }))
      const expected = (count: number) => (namespace ? { leaf: { count } } : { count })
      const listener = jest.fn()
      leaf.subscribe(listener)
      expect(composed.getState()).toEqual(expected(1))
      expect(composed.state).toEqual(expected(1))

      leaf.$patch({ count: 9 })
      expect(composed.state).toEqual(expected(9))
      expect(composed.getState()).toEqual(expected(9))
      leaf.$replaceState({ count: 10 })
      expect(composed.getState()).toEqual(expected(10))
      expect(composed.state).toEqual(expected(10))
      expect(listener).not.toHaveBeenCalled()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ count: 10 }))
      expect(composed.state).toEqual(expected(10))
    })
  })

  it('outer(inner(leaf)) stays fresh during leaf batch, including whole-tree replacement', () => {
    const leaf = own(createStore({ name: 'leaf', state: { count: 1, extra: true } as { count: number; extra?: boolean } }))
    const inner = own(composeStore([leaf]))
    const outer = own(composeStore([inner]))
    expect(outer.getState()).toEqual({ count: 1, extra: true })
    expect(outer.state).toEqual({ count: 1, extra: true })
    const listener = jest.fn()
    leaf.subscribe(listener)
    leaf.batch(() => {
      leaf.$patch({ count: 7 })
      expect(outer.getState()).toEqual({ count: 7, extra: true })
      expect(outer.state).toEqual({ count: 7, extra: true })
      leaf.$replaceState({ count: 42 })
      expect(outer.state).toEqual({ count: 42 })
      expect(outer.getState()).toEqual({ count: 42 })
      expect(listener).not.toHaveBeenCalled()
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(outer.state).toEqual({ count: 42 })
  })

  it.each([false, true])('nested bare dispatch reaches the right leaf and preserves args/result (strict: %s)', (strict) => {
    const leaf = own(
      createStore({
        name: 'leaf',
        state: { count: 0 },
        actions: {
          increment(step: number, multiplier: number) {
            this.state.count += step * multiplier
            return this.state.count
          },
        },
      }),
    )
    const unrelated = own(createStore({ name: 'unrelated', state: { untouched: true } }))
    const inner = own(composeStore([leaf], { strict }))
    const outer = own(composeStore([unrelated, inner], { strict }))
    expect(Object.keys(inner.actions)).toContain('increment')
    expect(Object.keys(outer.actions)).toContain('increment')
    expect(outer.dispatch('increment', 3, 2)).toBe(6)
    expect(leaf.state.count).toBe(6)
    expect(outer.getState()).toEqual({ untouched: true, count: 6 })
    expect(unrelated.state).toEqual({ untouched: true })
  })
})
