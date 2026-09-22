/**
 * 第五轮 core-store-p1 分片：Store 的补丁别名、销毁收尾与脏键查询
 *
 * R5-130（就地改写的嵌套对象被别的顶层键引用时也要标脏）、
 * R5-131（setState 按引用保存是文档化契约）、R5-132（整体替换的补丁不再跑全图扫描）、
 * R5-133（清理过程中重入 use() 的插件同样要卸载）、R5-134（回调内销毁不得让 endBatch
 * 抛错顶掉原结果）、R5-135（脏键查询接受 symbol）。
 * R5-120 的数组分支在这里补一条「Store 构造器不拦，静默建出空 store」的事实锁。
 */
import { Store } from '@/core/store/Store.js'
import { createStore } from '@/core/store/factory.js'
import type { Plugin } from '@/types/plugin.js'
import type { State } from '@/types/store.js'

/** 订阅并在每次通知里记录指定键的脏位（脏键在通知结束时清空，只能在回调内观察） */
function trackDirty<S extends State>(
  store: { isStateKeyDirty(key: string | symbol): boolean; subscribe(listener: (state: S) => void): () => void },
  keys: Array<string | symbol>,
): boolean[][] {
  const rounds: boolean[][] = []
  store.subscribe(() => {
    rounds.push(keys.map((key) => store.isStateKeyDirty(key)))
  })
  return rounds
}

describe('R5-130 $patch 的别名脏键覆盖被就地改写的嵌套对象', () => {
  it('别名指向补丁深层的对象时，那个顶层键同样标脏', () => {
    const store = createStore({
      name: 'alias-nested',
      state: { a: { nested: { v: 0 } }, holder: { keep: 1 }, c: 0 },
    })
    try {
      // c 与 a.nested 是同一个对象：deepMerge 就地改写 a.nested 时 c 的内容也变了
      store.setState('c', store.getState().a.nested as never)
      const rounds = trackDirty(store, ['c', 'holder'])

      store.$patch({ a: { nested: { v: 7 } } })

      expect(store.getState().c).toEqual({ v: 7 })
      expect(rounds[rounds.length - 1]).toEqual([true, false])
    } finally {
      store.destroy()
    }
  })

  it('别名要经 Map 的值才可达时同样不漏', () => {
    const store = createStore({
      name: 'alias-via-map',
      state: { a: { shared: { v: 0 } }, holder: { m: new Map<string, unknown>() }, c: 0 },
    })
    try {
      // 深拷贝后状态里的那个对象才是别名目标，不能用测试自己的字面量
      const inState = store.getState().a.shared
      store.getState().holder.m.set('k', inState)
      store.setState('c', inState as never)
      const rounds = trackDirty(store, ['c', 'holder', 'a'])

      store.$patch({ a: { shared: { v: 4 } } })

      // holder 的值里挂着被改写的对象，可达性扫描必须走进 Map 的条目
      expect(rounds[rounds.length - 1]).toEqual([true, true, true])
      expect(store.getState().c).toEqual({ v: 4 })
    } finally {
      store.destroy()
    }
  })

  it('同一对象被两个补丁键命中时，两处子树的别名都收得全', () => {
    const shared = { m: { v: 0 }, n: { v: 0 } }
    const store = createStore({
      name: 'alias-pair',
      // 深拷贝会保留共享引用：state.a 与 state.b 是同一个对象
      state: { a: shared, b: shared, other: 1 },
    })
    try {
      const state = store.getState()
      expect(state.a).toBe(state.b)
      // c 只别名到「第二个补丁键才展开得到」的那层子对象
      store.setState('other', state.b.n as never)
      const rounds = trackDirty(store, ['other'])

      store.$patch({ a: { m: { v: 1 } }, b: { n: { v: 2 } } } as never)

      // 守卫按「目标对象最多下沉一次」去重时会漏掉 b.n ⇒ 别名键永久不标脏
      expect(rounds[rounds.length - 1]).toEqual([true])
      expect(store.getState().other).toEqual({ v: 2 })
    } finally {
      store.destroy()
    }
  })
})

describe('R5-131 setState 按引用保存（文档化契约）', () => {
  it('入参对象即状态本身，其后的外部写入不被追踪；$patch 不保留调用方引用', () => {
    const store = createStore({ name: 'set-by-ref', state: { k: { v: 0 } } })
    try {
      const obj = { v: 1 }
      store.setState('k', obj)
      expect(store.getState().k).toBe(obj)

      let notified = 0
      store.subscribe(() => {
        notified += 1
      })
      obj.v = 99
      expect(notified).toBe(0)

      const patch = { v: 3 }
      store.$patch({ k: patch })
      // 落进状态的是既有对象本身（就地合并），不是调用方给的那个补丁对象
      expect(store.getState().k).not.toBe(patch)
      expect(patch.v).toBe(3)
      expect(store.getState().k).toBe(obj)
      expect(notified).toBe(1)
    } finally {
      store.destroy()
    }
  })
})

describe('R5-132 整体替换的补丁不触发全图可达性扫描', () => {
  it('补丁值只被替换时跳过扫描，就地合并时才扫描', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ v: i, nested: { v: i } }))
    const store = createStore({
      name: 'scan-gate',
      state: { rows, cfg: { depth: { n: 1 } }, replaced: [] as number[] },
    })
    const ownKeys = jest.spyOn(Reflect, 'ownKeys')
    try {
      ownKeys.mockClear()
      store.$patch({ replaced: [1, 2, 3] })
      const replaceCalls = ownKeys.mock.calls.length

      ownKeys.mockClear()
      store.$patch({ cfg: { depth: { n: 2 } } })
      const inPlaceCalls = ownKeys.mock.calls.length

      // 数组/Map/Set/类实例等一律被整体替换的补丁值没有任何「被就地改写的对象」，
      // 扫描保证找不到别名 ⇒ 一次都不该走（Reflect.ownKeys 只出现在扫描里）
      expect(replaceCalls).toBe(0)
      // 纯对象 → 纯对象就地合并：扫描要遍历 rows 的 120 个元素 + 各自的 nested（≈2 × 120 + 3 次）
      expect(inPlaceCalls).toBeGreaterThan(200)
      expect(store.getState().cfg.depth.n).toBe(2)
      expect(store.getState().replaced).toEqual([1, 2, 3])
    } finally {
      ownKeys.mockRestore()
      store.destroy()
    }
  })
})

describe('R5-133 清理过程中重入 use() 的插件同样要卸载', () => {
  it('前一个插件的清理里装的插件，其卸载函数照样被调用（后装先卸）', () => {
    const order: string[] = []
    const store = createStore({ name: 'reentrant-plugin', state: { n: 0 } })
    const inner: Plugin<State> = {
      name: 'inner',
      install: () => () => {
        order.push('inner')
      },
    }
    const outer: Plugin<State> = {
      name: 'outer',
      install: () => () => {
        order.push('outer')
        store.use(inner)
      },
    }
    store.use(outer)
    store.use({ name: 'first', install: () => () => order.push('first') })

    store.destroy()

    // 修复前只快照一次在册插件，重入注册的 inner 被直接丢空容器吞掉
    expect(order).toEqual(['first', 'outer', 'inner'])
    expect(() => store.destroy()).not.toThrow()
  })

  it('卸载函数抛错不阻断其余插件卸载，也不阻断销毁', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const order: string[] = []
    const store = createStore({ name: 'throwing-plugin', state: { n: 0 } })
    store.use({
      name: 'bad',
      install: () => () => {
        order.push('bad')
        throw new Error('cleanup boom')
      },
    })
    store.use({ name: 'good', install: () => () => order.push('good') })

    expect(() => store.destroy()).not.toThrow()
    expect(order).toEqual(['good', 'bad'])
    expect(() => store.setState('n', 1)).toThrow(/destroyed Store/)
    errorSpy.mockRestore()
  })

  it('清理里不自收敛的重入按轮数上限止住并告警，destroy 不挂住', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createStore({ name: 'nonconverging-plugin', state: { n: 0 } })
    let installs = 0
    // 每个清理函数都再装一个「同样会再装一个」的插件：每轮恰好剩一个待卸载，永不收敛
    const grow = (round: number): Plugin<State> => ({
      name: `grow-${round}`,
      install: () => () => {
        installs += 1
        store.use(grow(round + 1))
      },
    })
    store.use(grow(0))

    store.destroy()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('未收敛'))
    expect(installs).toBeLessThan(20)
    warn.mockRestore()
  })
})

describe('R5-134 batch 回调销毁 Store 时收尾不得抛错', () => {
  it('回调正常返回：返回值不被 endBatch 的「已销毁」异常顶掉', () => {
    const store = createStore({ name: 'destroy-in-batch', state: { n: 0 } })
    expect(
      store.batch(() => {
        store.destroy()
        return 'kept'
      }),
    ).toBe('kept')
    expect(() => store.setState('n', 1)).toThrow(/destroyed Store/)
  })

  it('回调抛错：原始错误不被收尾异常替换', () => {
    const store = createStore({ name: 'destroy-in-batch-throw', state: { n: 0 } })
    expect(() =>
      store.batch(() => {
        store.destroy()
        throw new Error('original boom')
      }),
    ).toThrow('original boom')
  })

  it('未销毁时 batch 仍照常 endBatch（多调一次 end() 依旧告警）', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createStore({ name: 'plain-batch', state: { n: 0 } })
    try {
      const rounds: number[] = []
      store.subscribe(() => rounds.push(store.getState().n))
      const result = store.batch(() => {
        store.setState('n', 1)
        store.setState('n', 2)
        return 'sync'
      })
      expect(result).toBe('sync')
      expect(rounds).toEqual([2])
      // 收尾确实 endBatch 了：批外的写入立刻另起一轮通知
      store.setState('n', 3)
      expect(rounds).toEqual([2, 3])
    } finally {
      store.destroy()
      warn.mockRestore()
    }
  })
})

describe('R5-135 脏键查询接受 symbol', () => {
  it('symbol 顶层键的变更可被查询（与 _dirtyKeys 实际存的键型一致）', () => {
    const mapped = Symbol('mapped')
    const store = createStore({
      name: 'symbol-dirty',
      state: { plain: 0 } as Record<PropertyKey, number>,
      actions: {
        writeSymbol(this: { state: Record<PropertyKey, number> }) {
          this.state[mapped] = 1
        },
      },
    })
    try {
      const seen: Array<[string | symbol, boolean]> = []
      store.subscribe(() => {
        seen.push([mapped, store.isStateKeyDirty(mapped)])
        seen.push(['plain', store.isStateKeyDirty('plain')])
      })

      store.dispatch('writeSymbol')

      expect(store.getState()[mapped]).toBe(1)
      // 修复前签名只收 string，symbol 键根本查不到（脏跳过优化对它静默失效）
      expect(seen).toEqual([
        [mapped, true],
        ['plain', false],
      ])
    } finally {
      store.destroy()
    }
  })
})

describe('R5-120 的必要性：Store 构造器不拦数组配置', () => {
  it('数组 options 一路进入构造器，只会静默建出一个空 store', () => {
    const store = new Store([] as never)
    try {
      expect(store.getState()).toEqual({})
      expect(store.name).toMatch(/^store-/)
    } finally {
      store.destroy()
    }
  })
})
