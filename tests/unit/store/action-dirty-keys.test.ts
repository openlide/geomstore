import { createStore } from '@/core/store/index.js'
import type { ActionContextBase } from '@/types/store.js'

describe.each([false, true])('action dirty keys (onlyOnChange=%s)', (onlyOnChange) => {
  it('keeps mapped objects on the dirty-filter path through a batch', () => {
    const state = { profile: { nested: { name: 'before' } }, rows: [{ value: 0 }], untouched: { value: 0 } }
    const store = createStore({
      state,
      notify: { onlyOnChange },
      actions: {
        edit(this: ActionContextBase<typeof state>) {
          this.state.profile.nested.name = 'after'
          this.state.rows.push({ value: 1 })
        },
      },
    })
    const mapped: Record<string, unknown> = {}
    const listener = jest.fn(() => {
      for (const key of ['profile', 'rows', 'untouched']) {
        if (store.isStateKeyDirty(key)) mapped[key] = store.getState()[key as keyof typeof state]
      }
    })
    store.subscribe(listener, { readOnly: true })
    store.batch(() => {
      store.dispatch('edit')
      expect(listener).not.toHaveBeenCalled()
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(mapped).toEqual({ profile: { nested: { name: 'after' } }, rows: [{ value: 0 }, { value: 1 }] })
    expect(store.isStateKeyDirty('profile')).toBe(false)
    expect(store.isStateKeyDirty('rows')).toBe(false)
  })

  it('tracks assignment, deletion, descriptors and nested array items', () => {
    const state = { count: 0, removed: 1 as number | undefined, rows: [{ value: 0 }], defined: { value: 0 }, untouched: 0 }
    const store = createStore({
      state,
      notify: { onlyOnChange },
      actions: {
        edit(this: ActionContextBase<typeof state>) {
          this.state.count++
          delete this.state.removed
          this.state.rows[0].value++
          Object.defineProperty(this.state.defined, 'value', { value: 2 })
        },
      },
    })
    const dirty: string[][] = []
    store.subscribe(() => dirty.push(Object.keys(state).filter((key) => store.isStateKeyDirty(key))))
    store.batch(() => store.dispatch('edit'))
    expect(dirty).toEqual([['count', 'removed', 'rows', 'defined']])
  })

  it('tracks Map/Set mutators, chaining and raw identity for inserted proxies', () => {
    const state = { map: new Map<string, { value: number }>(), set: new Set<{ value: number }>(), item: { value: 1 }, untouched: 0 }
    const store = createStore({
      state,
      notify: { onlyOnChange },
      actions: {
        edit(this: ActionContextBase<typeof state>) {
          const { map, set, item } = this.state
          expect(map.set('a', item)).toBe(map)
          expect(set.add(item)).toBe(set)
          expect(map.get('a')).toBe(item)
          expect(set.has(item)).toBe(true)
          expect(map.size).toBe(1)
          expect(set.size).toBe(1)
        },
        remove(this: ActionContextBase<typeof state>) {
          expect(this.state.map.delete('a')).toBe(true)
          expect(this.state.set.delete(this.state.item)).toBe(true)
        },
        clear(this: ActionContextBase<typeof state>) {
          this.state.map.clear()
          this.state.set.clear()
        },
      },
    })
    const dirty: string[][] = []
    store.subscribe(() => dirty.push(Object.keys(state).filter((key) => store.isStateKeyDirty(key))))
    store.batch(() => store.dispatch('edit'))
    expect(store.getState().map.get('a')).toBe(store.getState().item)
    expect(store.getState().set.has(store.getState().item)).toBe(true)
    store.batch(() => store.dispatch('remove'))
    store.dispatch('edit')
    store.batch(() => store.dispatch('clear'))
    expect(dirty).toEqual(Array.from({ length: 4 }, () => ['map', 'set']))
  })

  it('tracks values and keys obtained through collection reads and iteration', () => {
    const state = { map: new Map([[{ value: 0 }, { value: 0 }]]), set: new Set([{ value: 0 }]), untouched: 0 }
    const store = createStore({
      state,
      notify: { onlyOnChange },
      actions: {
        edit(this: ActionContextBase<typeof state>) {
          const { map, set } = this.state
          const key = map.keys().next().value!
          map.get(key)!.value++
          for (const [k, v] of map) {
            k.value++
            v.value++
          }
          for (const v of map.values()) v.value++
          for (const [k, v] of map.entries()) {
            k.value++
            v.value++
          }
          map.forEach((v, k, collection) => {
            expect(collection).toBe(map)
            v.value++
            k.value++
          })
          for (const v of set) v.value++
          for (const v of set.keys()) v.value++
          for (const v of set.values()) v.value++
          for (const [a, b] of set.entries()) {
            expect(a).toBe(b)
            a.value++
          }
          set.forEach((v, k, collection) => {
            expect(v).toBe(k)
            expect(collection).toBe(set)
            v.value++
          })
        },
      },
    })
    const dirty: string[][] = []
    store.subscribe(() => dirty.push(Object.keys(state).filter((key) => store.isStateKeyDirty(key))))
    store.batch(() => store.dispatch('edit'))
    expect(dirty).toEqual([['map', 'set']])
  })

  it('marks unread aliases through objects, arrays, Map keys/values and Set, with cycles', () => {
    const shared = { value: 0, cycle: null as unknown }
    shared.cycle = shared
    const state = { first: shared, alias: { child: shared }, rows: [shared], map: new Map([[shared, shared]]), set: new Set([shared]), untouched: {} }
    const store = createStore({
      state,
      notify: { onlyOnChange },
      actions: {
        edit(this: ActionContextBase<typeof state>) {
          this.state.first.value++
        },
      },
    })
    const dirty: string[][] = []
    store.subscribe(() => dirty.push(Object.keys(state).filter((key) => store.isStateKeyDirty(key))), { readOnly: true })
    store.batch(() => store.dispatch('edit'))
    expect(dirty).toEqual([['first', 'alias', 'rows', 'map', 'set']])
  })

  it('preserves alias identity and resolves current ownership after reparenting and replacement', () => {
    const state = { first: { value: 0 }, second: { value: 0 }, untouched: {} }
    let saved: { value: number }
    const store = createStore({
      state,
      notify: { onlyOnChange },
      actions: {
        link(this: ActionContextBase<typeof state>) {
          saved = this.state.first
          this.state.second = saved
          expect(this.state.first).toBe(this.state.second)
        },
        edit(this: ActionContextBase<typeof state>) {
          saved.value++
          this.state.second.value++
        },
      },
    })
    const dirty: string[][] = []
    store.subscribe(() => dirty.push(Object.keys(state).filter((key) => store.isStateKeyDirty(key))))
    store.dispatch('link')
    expect(store.getState().first).toBe(store.getState().second)
    store.setState('first', { value: 10 })
    dirty.length = 0
    store.batch(() => store.dispatch('edit'))
    expect(dirty).toEqual([['second']])
    store.$replaceState(state)
    store.dispatch('link')
    dirty.length = 0
    store.batch(() => store.dispatch('edit'))
    expect(dirty).toEqual([['first', 'second']])
  })

  it('accumulates dirty keys across async actions and async notifications', async () => {
    const state = { first: { value: 0 }, second: { value: 0 }, untouched: {} }
    const store = createStore({
      state,
      notify: { onlyOnChange, async: true },
      actions: {
        async edit(this: ActionContextBase<typeof state>) {
          this.state.first.value++
          await Promise.resolve()
          this.state.second.value++
        },
      },
    })
    const dirty: string[][] = []
    store.subscribe(() => dirty.push(Object.keys(state).filter((key) => store.isStateKeyDirty(key))))
    await store.dispatch('edit')
    await new Promise((resolve) => setTimeout(resolve, 0))
    // R6-037 的预期行为变更：异步 action 的**同步段**现在当场补发一次通知，
    // `async: true` 的合并窗口下它与 settle 那一轮落在两个批次，两种模式表现不同：
    // - `onlyOnChange: false`：多出一个 dirty 为空的投递（脏键已在第一轮被消费掉）。
    //   集成层按脏键跳过 setData，空批次不产生额外渲染；替代做法（让 settle 轮跳过）
    //   会让 await 之后的裸写重新变成不可见，与 store.test.ts 钉住的「宁多勿漏」冲突。
    // - `onlyOnChange: true`：settle 轮按变更计数去重，仍只有一次投递。
    expect(dirty).toEqual(onlyOnChange ? [['first', 'second']] : [['first', 'second'], []])
    expect(dirty.filter((keys) => keys.length > 0)).toEqual([['first', 'second']])
    expect(store.isStateKeyDirty('first')).toBe(false)
  })
})
