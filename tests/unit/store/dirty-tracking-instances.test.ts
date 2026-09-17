/**
 * 类实例与类型化数组的脏追踪、保护代理的方法绑定、$patch 别名脏键
 *
 * 覆盖第三轮复审发现：非普通实例的内部变异此前完全不可见（脏键与变更计数都没有）；
 * 类型化数组经保护代理展开会抛 "this is not a typed array"；
 * $patch 就地改写被其他顶层键引用的对象时只标记补丁键。
 */
import { createStore } from '@/core/store/index.js'
import { bindMappings } from '@/integrations/utils.js'

describe('类实例与类型化数组的脏追踪', () => {
  it('实例属性直接赋值会被标记为脏', () => {
    class Service {
      count = 0
    }
    const store = createStore({
      state: { service: new Service() },
      actions: {
        direct() {
          this.state.service.count = 5
        },
      },
    })
    const rounds: boolean[] = []
    store.subscribe(() => rounds.push(store.isStateKeyDirty('service')))
    try {
      store.dispatch('direct')
      expect(rounds).toEqual([true])
      expect(store.getState().service.count).toBe(5)
    } finally {
      store.destroy()
    }
  })

  it('实例方法内部对自身的写入也会标记所属键（宁可多报）', () => {
    class Counter {
      value = 0
      inc() {
        this.value++
      }
    }
    const store = createStore({
      state: { counter: new Counter() },
      actions: {
        viaMethod() {
          this.state.counter.inc()
        },
      },
    })
    const rounds: boolean[] = []
    store.subscribe(() => rounds.push(store.isStateKeyDirty('counter')))
    try {
      store.dispatch('viaMethod')
      expect(rounds).toEqual([true])
      expect(store.getState().counter.value).toBe(1)
    } finally {
      store.destroy()
    }
  })

  it('带 #private 字段的方法可读且不抛错', () => {
    class Secret {
      #value = 7
      read() {
        return this.#value
      }
    }
    const store = createStore({
      state: { secret: new Secret() },
      actions: {
        read() {
          return this.state.secret.read()
        },
      },
    })
    try {
      expect(store.dispatch('read')).toBe(7)
    } finally {
      store.destroy()
    }
  })

  it('类型化数组的元素写入会被标记为脏', () => {
    const store = createStore({
      state: { buf: new Uint8Array([1, 2]) },
      actions: {
        write() {
          this.state.buf[0] = 9
        },
      },
    })
    const rounds: boolean[] = []
    store.subscribe(() => rounds.push(store.isStateKeyDirty('buf')))
    try {
      store.dispatch('write')
      expect(rounds).toEqual([true])
      expect(Array.from(store.getState().buf)).toEqual([9, 2])
    } finally {
      store.destroy()
    }
  })

  it('实例引用保持稳定（同一实例复用同一代理）', () => {
    class Holder {
      value = 1
    }
    const holder = new Holder()
    const store = createStore({ state: { holder } })
    try {
      expect(store.getState().holder).toBe(store.getState().holder)
    } finally {
      store.destroy()
    }
  })
})

describe('保护代理的方法绑定', () => {
  it('类型化数组可展开、切片与索引读取', () => {
    const store = createStore({ state: { buf: new Uint8Array([1, 2, 3]), nested: { ta: new Int8Array([4, 5]) } } })
    try {
      expect([...store.state.buf]).toEqual([1, 2, 3])
      expect(Array.from(store.state.buf.slice(1))).toEqual([2, 3])
      expect(store.state.buf[0]).toBe(1)
      expect(store.state.buf.length).toBe(3)
      expect([...store.state.nested.ta]).toEqual([4, 5])
    } finally {
      store.destroy()
    }
  })

  it('类实例方法经保护代理读取可用，非法写入仍被拒绝', () => {
    class Vec {
      #x = 7
      read() {
        return this.#x
      }
    }
    const store = createStore({ state: { vec: new Vec(), buf: new Uint8Array([1]) } })
    try {
      expect(store.state.vec.read()).toBe(7)
      expect(() => {
        store.state.buf[0] = 9
      }).toThrow(/Direct mutation/)
    } finally {
      store.destroy()
    }
  })
})

describe('$patch 的别名脏键', () => {
  it('补丁就地改写被其他顶层键引用的对象时一并标记', () => {
    const store = createStore({
      state: { a: { x: 0 }, b: null as { x: number } | null },
      actions: {
        link() {
          this.state.b = this.state.a
        },
        patchA() {
          this.$patch({ a: { x: 5 } })
        },
      },
    })
    const updates: Array<Record<string, unknown>> = []
    const unbinds = bindMappings(
      {},
      { B: 'b' },
      (key) => store.state[key as 'a' | 'b'],
      (u) => updates.push(JSON.parse(JSON.stringify(u))),
      (callback, options) => store.subscribe(callback, options),
      (key) => store.isStateKeyDirty(key),
    )
    try {
      store.dispatch('link')
      store.dispatch('patchA')
      // 只映射 b：若 b 未被标记为脏，视图永远停在旧值
      expect(updates[updates.length - 1]).toEqual({ B: { x: 5 } })
      expect(store.getState().b?.x).toBe(5)
    } finally {
      unbinds.forEach((unbind) => unbind())
      store.destroy()
    }
  })
})
