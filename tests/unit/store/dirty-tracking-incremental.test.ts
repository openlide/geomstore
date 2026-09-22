/**
 * #178 脏键归属索引的增量化
 *
 * 归属口径与既有实现逐字一致：某次写入上报的顶层键 = 「沿被索引的边（数据属性值 / 数组元素 /
 * Map 键值 / Set 成员）能走到被写对象的那些顶层键」；解析不出归属时兜底为全部顶层键
 * （宁多报不漏报）。差别只在维护方式：新增边只把容器归属并入选中新子树，删边（覆盖对象值、
 * delete、集合删除、整棵子树脱落）才退化全量重建。
 *
 * 这里盯住增量最容易走偏的边界：新增 / 删除 / 移动 / 共享引用 / 环 / 集合 / 整树替换。
 */
import { createStore } from '@/core/store/index.js'
import { createDirtyTrackingCache, createDirtyTrackingProxy } from '@/core/store/dirtyTracking.js'

type Nested = Record<string | symbol, unknown>

/** 直接驱动脏跟踪代理，逐次收集上报的顶层键（排序后便于精确断言） */
function track(root: Nested) {
  const reports: string[][] = []
  const proxy = createDirtyTrackingProxy(root, createDirtyTrackingCache(), (keys) => {
    reports.push([...keys].map(String).sort())
  }) as Nested
  return { proxy, reports, last: () => reports[reports.length - 1] ?? [] }
}

describe('#178 增量登记新增的边', () => {
  it('#178 新增嵌套对象后，其子树的写入按所属顶层键归因', () => {
    const root: Nested = { a: { keep: 1 }, b: { keep: 1 } }
    const { proxy, last } = track(root)

    ;(proxy.a as Nested).fresh = { deep: { v: 0 } }
    expect(last()).toEqual(['a'])
    const fresh = (proxy.a as Nested).fresh as Nested
    ;(fresh.deep as Nested).v = 7

    expect(last()).toEqual(['a'])
  })

  it('#178 标量位改写为对象只并入新子树，不牵连其他顶层键', () => {
    const root: Nested = { a: { slot: 0 }, b: { slot: 0 } }
    const { proxy, last } = track(root)

    ;(proxy.a as Nested).slot = { inner: { v: 0 } }
    const inner = (((proxy.a as Nested).slot) as Nested).inner as Nested
    inner.v = 1

    expect(last()).toEqual(['a'])
    // 另一个键的同名结构不受影响
    ;(proxy.b as Nested).slot = { inner: { v: 1 } }
    expect(last()).toEqual(['b'])
  })

  it('#178 同对象自赋值不改图：索引原样复用', () => {
    const root: Nested = { a: { v: 0 }, b: 1 }
    const { proxy, last } = track(root)

    const same = proxy.a
    proxy.a = same
    ;(proxy.a as Nested).v = 1

    expect(last()).toEqual(['a'])
  })

  it('#178 环上的新增按重建口径给出同一批键', () => {
    const root: Nested = { a: { v: 0 } }
    const { proxy, last } = track(root)

    proxy.self = proxy
    proxy.fresh = { n: 0 }
    ;(proxy.fresh as Nested).n = 1

    // root 挂在 self 下 ⇒ root 的全部子孙都同时属于 self 与各自的顶层键
    expect(last()).toEqual(['fresh', 'self'])
  })
})

describe('#178 删边退化全量重建', () => {
  it('#178 删除子树后，写入不再被误归因到已消失的键', () => {
    const shared = { v: 0 }
    const root: Nested = { a: { shared }, b: { shared }, untouched: {} }
    const { proxy, reports, last } = track(root)

    delete (proxy.a as Nested).shared
    expect(last()).toEqual(['a'])
    ;((proxy.b as Nested).shared as Nested).v = 1

    expect(last()).toEqual(['b'])
    // 兜底没有把无关键牵连进来
    expect(reports.flat()).not.toContain('untouched')
  })

  it('#178 整棵子树脱落后仍兜底标记全部顶层键', () => {
    const detached = { v: 0 }
    const root: Nested = { a: { held: detached }, b: 1 }
    const { proxy, last } = track(root)
    const held = (proxy.a as Nested).held as Nested

    proxy.a = { other: 1 }
    held.v = 1

    // 旧实现（每次结构性写入都重建）同样解析不出它的归属 ⇒ 标全部顶层键，口径未变
    expect(last()).toEqual(['a', 'b'])
  })

  it('#178 对象在顶层键之间移动后只归因新键', () => {
    const root: Nested = { first: { v: 0 }, second: { v: 99 }, untouched: {} }
    const { proxy, reports, last } = track(root)

    proxy.second = proxy.first
    delete proxy.first
    ;(proxy.second as Nested).v = 1

    expect(last()).toEqual(['second'])
    expect(reports.flat()).not.toContain('untouched')
  })

  it('#178 数组 length 缩短只删标量位时不重建，删到对象元素时重建', () => {
    const detached = { v: 0 }
    const root: Nested = { objects: [detached, { v: 1 }], scalars: [1, 2, 3], other: {} }
    const { proxy, last } = track(root)
    const held = (proxy.objects as unknown as Nested[])[0]

    ;(proxy.scalars as unknown as unknown[]).length = 1
    ;(proxy.other as Nested).v = 1
    expect(last()).toEqual(['other'])

    ;(proxy.objects as unknown as unknown[]).length = 0
    ;(held as Nested).v = 2
    expect(last()).toEqual(['objects', 'other', 'scalars'])
  })
})

describe('#178 共享引用与集合', () => {
  it('#178 同一对象挂在两个顶层键下时两键一起标脏', () => {
    const root: Nested = { a: { v: 0 }, b: 1 }
    const { proxy, last } = track(root)

    proxy.b = proxy.a
    ;(proxy.a as Nested).v = 1

    expect(last()).toEqual(['a', 'b'])
  })

  it('#178 深层容器间的共享引用同样双键标记', () => {
    const root: Nested = { a: { holder: { v: 0 } }, b: { holder: null } }
    const { proxy, last } = track(root)

    ;(proxy.b as Nested).holder = (proxy.a as Nested).holder
    ;((proxy.a as Nested).holder as Nested).v = 1

    expect(last()).toEqual(['a', 'b'])
  })

  it('#178 Map 新增键值只并入新子树，覆盖已有对象值才退化重建', () => {
    const value = { v: 0 }
    const root: Nested = { map: new Map<string, unknown>(), other: { v: 0 } }
    const { proxy, last } = track(root)
    const map = proxy.map as unknown as Map<string, unknown>
    const held = map.get('k') as Nested | undefined
    expect(held).toBeUndefined()

    map.set('k', value)
    expect(last()).toEqual(['map'])
    const inserted = map.get('k') as Nested
    inserted.v = 1
    expect(last()).toEqual(['map'])

    map.set('k', { v: 2 })
    expect(last()).toEqual(['map'])
    // 被顶掉的旧值已不可达：兜底标全部顶层键，与全量重建的口径一致
    inserted.v = 3
    expect(last()).toEqual(['map', 'other'])
  })

  it('#178 Set 成员与 Map 键作为别名被增量索引', () => {
    const other = { v: 0 }
    const asKey = { k: 0 }
    const root: Nested = { set: new Set<unknown>(), map: new Map<unknown, number>(), other, untouched: {} }
    const { proxy, reports, last } = track(root)

    ;(proxy.set as unknown as Set<unknown>).add(other)
    ;(proxy.other as Nested).v = 1
    expect(last()).toEqual(['other', 'set'])

    const map = proxy.map as unknown as Map<unknown, number>
    map.set(asKey, 1)
    expect(last()).toEqual(['map'])
    const keyed = [...(proxy.map as unknown as Map<unknown, number>).keys()][0] as Nested
    keyed.k = 1
    expect(last()).toEqual(['map'])

    ;(proxy.other as Nested).v = 2
    expect(last()).toEqual(['other', 'set'])
    expect(reports.flat()).not.toContain('untouched')
  })

  it('#178 Map/Set 删除后别名标记随之消失', () => {
    const item = { v: 0 }
    const root: Nested = { set: new Set<unknown>(), item }
    const { proxy, last } = track(root)
    const set = proxy.set as unknown as Set<unknown>

    set.add(item)
    ;(proxy.item as Nested).v = 1
    expect(last()).toEqual(['item', 'set'])

    set.delete(item)
    ;(proxy.item as Nested).v = 2
    expect(last()).toEqual(['item'])
  })
})

describe('#178 与 Store 的集成点', () => {
  it('#178 $replaceState 后索引随新状态树重建', () => {
    const store = createStore({
      state: { a: { v: 0 }, b: { v: 0 } },
      actions: {
        link(this: { state: { a: { v: number }; b: { v: number } } }) {
          this.state.b = this.state.a
        },
        write(this: { state: { a: { v: number }; b: { v: number } } }) {
          this.state.b.v = 1
        },
      },
    })
    const dirty: string[][] = []
    store.subscribe(() => dirty.push(['a', 'b'].filter((key) => store.isStateKeyDirty(key))))
    try {
      store.dispatch('link')
      store.$replaceState({ a: { v: 0 }, b: { v: 0 } })
      dirty.length = 0
      store.dispatch('write')

      // 旧树里 b 与 a 指向同一对象；新树是两棵独立克隆。
      // 索引若未随整树替换作废，新 b 就解析不出归属而兜底标全部键
      expect(dirty).toEqual([['b']])
    } finally {
      store.destroy()
    }
  })

  it('#178 action 内的新增-写入序列在 onlyOnChange 下照常送达', () => {
    const store = createStore({
      state: { rows: [] as Array<{ v: number }>, other: { v: 0 } },
      notify: { onlyOnChange: true },
      actions: {
        append(this: { state: { rows: Array<{ v: number }>; other: { v: number } } }, times: number) {
          for (let i = 0; i < times; i++) this.state.rows.push({ v: i })
          this.state.rows[0].v = 99
        },
      },
    })
    const dirty: string[][] = []
    store.subscribe(() => dirty.push(['rows', 'other'].filter((key) => store.isStateKeyDirty(key))), { readOnly: true })
    try {
      store.batch(() => store.dispatch('append', 5))
      expect(dirty).toEqual([['rows']])
      expect(store.getState().rows).toEqual([{ v: 99 }, { v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }])
    } finally {
      store.destroy()
    }
  })

})

describe('#178 索引覆盖不到的位置与不递归的遍历', () => {
  it('#178 归属解析不出的容器里新增对象：新子树同样落到「全部顶层键」兜底', () => {
    const holder: Nested = { child: null }
    const root: Nested = { a: 1, b: 1 }
    Object.defineProperty(root, 'lazy', { get: () => holder, enumerable: true, configurable: true })
    const { proxy, last } = track(root)
    const lazy = proxy.lazy as Nested

    lazy.child = { v: 0 }
    expect(last()).toEqual(['a', 'b', 'lazy'])
    ;(lazy.child as Nested).v = 1

    // 与「每次结构性写入都重建」的口径一致：这些位置本来就索引不到，只能整体兜底
    expect(last()).toEqual(['a', 'b', 'lazy'])
  })

  it('#178 覆盖自有访问器属性按保守口径退化重建，不误标访问器里的对象', () => {
    const hidden = { v: 0 }
    const root: Nested = { a: { v: 0 }, b: 1 }
    Object.defineProperty(root.a as Nested, 'lazy', { get: () => hidden, set(_value: unknown) {}, enumerable: true, configurable: true })
    const { proxy, last } = track(root)

    ;(proxy.a as Nested).lazy = { v: 2 }
    expect(last()).toEqual(['a'])
  })

  it('#178 非扩展对象上的 defineProperty 失败时不产生上报', () => {
    const root: Nested = { holder: Object.preventExtensions({ v: 0 }), other: 1 }
    const { proxy, reports } = track(root)

    const ok = Reflect.defineProperty(proxy.holder as Nested, 'added', { value: { v: 1 }, configurable: true })

    expect(ok).toBe(false)
    expect(reports).toEqual([])
  })

  it('#178 空状态与极深结构：增量与退化重建都不递归', () => {
    const root: Nested = {}
    const { proxy, last } = track(root)

    proxy.only = { v: 0 }
    expect(last()).toEqual(['only'])

    let cursor = proxy.only as Nested
    for (let depth = 0; depth < 3000; depth++) {
      cursor.child = { depth }
      cursor = cursor.child as Nested
    }
    cursor.leaf = 1
    expect(last()).toEqual(['only'])

    // 顶层新增 + 删除 ⇒ 强制一次全量重建，沿 3000 层链迭代走完不得栈溢出
    proxy.marker = { deep: true }
    delete proxy.marker
    cursor.leaf = 2
    expect(last()).toEqual(['only'])
  })
})
