/**
 * 追踪与代理的分支补强
 *
 * 覆盖第三轮改动中尚未被走到的分支：`$patch` 别名扫描的 Map/Set/内建对象遍历、
 * 实例代理的 set/delete/defineProperty 陷阱、数组 length 直接赋值、
 * 空集合 clear、集合与实例方法的缓存命中、保护代理的方法绑定分支。
 */
import { createStore } from '@/core/store/index.js'
import { bindMappings } from '@/integrations/utils.js'

describe('$patch 别名扫描的分支', () => {
  it('目标对象位于 Map 值、Set 成员与更深一层时都能被标记', () => {
    const store = createStore({
      state: {
        a: { x: 0 },
        wrap: { inner: null as { x: number } | null },
        map: new Map<string, unknown>(),
        set: new Set<unknown>(),
        dated: { when: new Date(0) },
      },
      actions: {
        link() {
          this.state.wrap.inner = this.state.a
          this.state.map.set('k', this.state.a)
          this.state.set.add(this.state.a)
        },
        patchA() {
          this.$patch({ a: { x: 5 } })
        },
      },
    })
    const rounds: string[][] = []
    const unbinds = bindMappings(
      {},
      { A: 'a', Wrap: 'wrap', Map: 'map', Set: 'set' },
      (key) => (store.getState() as Record<string, unknown>)[key],
      (updates) => rounds.push(Object.keys(updates)),
      (callback, options) => store.subscribe(callback, options),
      (key) => store.isStateKeyDirty(key),
    )
    try {
      store.dispatch('link')
      rounds.length = 0
      store.dispatch('patchA')
      // wrap（深层容器）、map（Map 值）、set（Set 成员）都被就地改写，必须一并下发
      const sent = new Set(rounds.flat())
      expect(sent.has('Wrap')).toBe(true)
      expect(sent.has('Map')).toBe(true)
      expect(sent.has('Set')).toBe(true)
      // dated 子树里只有 Date（内建对象不进入遍历），不应被误标
      expect(sent.has('Dated')).toBe(false)
    } finally {
      unbinds.forEach((unbind) => unbind())
      store.destroy()
    }
  })

  it('补丁值为空对象时不触发别名扫描', () => {
    const store = createStore({ state: { a: { x: 0 }, b: { y: 1 } }, actions: {} })
    const rounds: string[][] = []
    store.subscribe(() => rounds.push(['a', 'b'].filter((key) => store.isStateKeyDirty(key))))
    try {
      store.$patch({ b: {} } as never)
      expect(rounds.flat()).toContain('b')
    } finally {
      store.destroy()
    }
  })
})

describe('实例代理的写入陷阱分支', () => {
  it('新增键、改写对象值、删除键与访问器描述符都被处理', () => {
    class Holder {
      count = 0
      child = { v: 0 }
    }
    const store = createStore({
      state: { holder: new Holder() },
      actions: {
        structural() {
          const holder = this.state.holder as unknown as Record<string, unknown>
          holder.added = { v: 1 } // 新键（此前无描述符）
          holder.child = { v: 2 } // 改写对象值
          delete holder.added // 删除对象值键
          delete holder.missing // 删除不存在的键
          Object.defineProperty(holder, 'computed', { get: () => 42, configurable: true }) // 访问器描述符
        },
      },
    })
    const rounds: boolean[] = []
    store.subscribe(() => rounds.push(store.isStateKeyDirty('holder')))
    try {
      store.dispatch('structural')
      expect(rounds).toEqual([true])
      expect((store.getState().holder as unknown as Record<string, unknown>).computed).toBe(42)
    } finally {
      store.destroy()
    }
  })

  it('数组 length 直接赋值与集合方法缓存命中', () => {
    const store = createStore({
      state: {
        list: [{ v: 0 }, { v: 1 }, { v: 2 }],
        map: new Map<string, number>([['k', 1]]),
        set: new Set<string>(['a']),
        empty: new Map<string, number>(),
      },
      actions: {
        truncate() {
          this.state.list.length = 1
        },
        readTwice() {
          // 同一集合方法读取两次：第二次走 methods 缓存
          const get = this.state.map.get
          get.call(this.state.map, 'k')
          this.state.map.get('k')
        },
        clearEmpty() {
          // 空集合 clear：changed 为 false，不应标记为脏
          this.state.empty.clear()
        },
      },
    })
    const rounds: string[][] = []
    store.subscribe(() => rounds.push(['list', 'map', 'empty'].filter((key) => store.isStateKeyDirty(key))))
    try {
      store.dispatch('truncate')
      expect(rounds[0]).toContain('list')
      expect(store.getState().list).toHaveLength(1)

      rounds.length = 0
      store.dispatch('readTwice')
      // 只读访问不改变内容：可以为脏（保守）也可以不脏，但不得抛出
      expect(store.getState().map.get('k')).toBe(1)

      rounds.length = 0
      store.dispatch('clearEmpty')
      expect(rounds[0]).toEqual([])
    } finally {
      store.destroy()
    }
  })

  it('实例方法重复读取走缓存且仍可调用', () => {
    class Calculator {
      #base: number
      constructor(base: number) {
        this.#base = base
      }
      add(value: number): number {
        return this.#base + value
      }
    }
    const store = createStore({
      state: { calc: new Calculator(10) },
      actions: {
        readTwice() {
          const calc = this.state.calc
          const first = calc.add
          const second = calc.add
          return first.call(calc, 1) + second.call(calc, 2)
        },
      },
    })
    try {
      expect(store.dispatch('readTwice')).toBe(23)
    } finally {
      store.destroy()
    }
  })
})

describe('保护代理的方法绑定分支', () => {
  it('普通对象上的函数与方法按原样返回，嵌套数组的方法可读', () => {
    const helper = { compute: (value: number) => value * 2 }
    const store = createStore({
      state: { helper, matrix: [[1, 2]], nested: { ta: new Int8Array([1]) } },
    })
    try {
      // 普通对象：方法不绑定（prototype 为 Object.prototype）
      expect(store.state.helper.compute(3)).toBe(6)
      // 嵌套数组：数组接收者的方法原样返回
      const inner = store.state.matrix[0]
      expect(typeof inner.filter).toBe('function')
      expect(inner.filter((v: number) => v > 1)).toEqual([2])
      // 类型化数组：方法绑定到原始接收者
      expect(Array.from(store.state.nested.ta.values())).toEqual([1])
    } finally {
      store.destroy()
    }
  })
})

describe('代理陷阱的失败分支与访问器', () => {
  it('锁定（不可写/不可配置）属性：读取放行，失败写入/删除不误标记', () => {
    class Locked {
      open = { v: 1 }
    }
    const store = createStore({
      state: { locked: new Locked() },
      actions: {
        lockIt() {
          const target = this.state.locked as unknown as Record<string, unknown>
          // 读取锁定属性：走「Proxy 不变量」放行分支（返回精确值）
          expect((target.open as { v: number }).v).toBe(1)
          Object.defineProperty(target, 'ro', { value: { v: 1 }, writable: false, configurable: false })
          // 非严格模式下 Reflect.set 返回 false；ESM 严格模式下经代理写入不可写属性会抛 TypeError
          expect(() => {
            target.ro = { v: 2 }
          }).toThrow(TypeError)
          // 删除不可配置属性同理
          expect(() => {
            Reflect.deleteProperty(target, 'ro')
          }).not.toThrow()
        },
      },
    })
    store.subscribe(() => void 0)
    try {
      store.dispatch('lockIt')
      expect(((store.getState().locked as unknown as Record<string, unknown>).ro as { v: number }).v).toBe(1)
    } finally {
      store.destroy()
    }
  })

  it('别名扫描跳过访问器属性（不求值 getter）', () => {
    const store = createStore({
      state: {
        target: { x: 0 },
        holder: {} as Record<string, unknown>,
        alias: null as { x: number } | null,
      },
      actions: {
        link() {
          this.state.alias = this.state.target
          // 运行期挂上会抛错的 getter：索引重建与别名扫描都不得求值它
          Object.defineProperty(this.state.holder, 'lazy', {
            get: () => {
              throw new Error('getter 不应被求值')
            },
            enumerable: true,
            configurable: true,
          })
        },
        patchTarget() {
          this.$patch({ target: { x: 3 } })
        },
      },
    })
    const dirty: string[] = []
    // 只读订阅：通知走只读代理（零拷贝），避免深拷贝按既有契约求值访问器
    store.subscribe(() => dirty.push(['target', 'alias', 'holder'].filter((key) => store.isStateKeyDirty(key)).join('+')), { readOnly: true })
    try {
      store.dispatch('link')
      expect(() => store.dispatch('patchTarget')).not.toThrow()
      expect(dirty).toContain('target+alias')
    } finally {
      store.destroy()
    }
  })
})
