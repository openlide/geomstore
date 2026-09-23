/**
 * 第六轮 f1-05 回归锁：脏跟踪索引的置换写入与集合代理的成员接收者
 *
 * R6-038：数组元素「对象换对象」一律判 EDGE_REMOVED ⇒ 每次写入一次 O(整图) 重建，
 * `todos.sort()` 这种 O(n log n) 次写入的调用变成 O(n² log n)。
 * R6-039：collectionMethod 白名单外的函数值被裸返回，调用时 this 是代理 ⇒ ES2025 的
 * `Set.prototype.union` 一类直接抛 `TypeError: ... called on incompatible receiver`。
 */

import { createDirtyTrackingCache, createDirtyTrackingProxy } from '@/core/store/dirtyTracking.js'

type Nested = Record<string | symbol, unknown>

function track(root: Nested) {
  const reports: string[][] = []
  const proxy = createDirtyTrackingProxy(root, createDirtyTrackingCache(), (keys) => {
    reports.push([...keys].map(String).sort())
  }) as Nested
  return { proxy, reports, last: () => reports[reports.length - 1] ?? [] }
}

/**
 * ES2025 的七个集合方法：TS 基线 lib（`tsconfig.json` 的 `lib: ["ES2020"]`，
 * `tsconfig.tests.json` 原样继承且本轮不动配置）里查不到这些名字，而本用例断言的
 * 正是「运行时白名单是否放行它们」——名字要在类型面写清楚，但既不改 lib、也不用
 * `any`/`as never` 把这一段检查抹平，故按宿主 Set 的最小局部形状声明后做一次
 * `as unknown as` 转换（集合运算返回新 Set，关系判断返回 boolean）。
 */
interface Es2025SetLike extends Set<string> {
  union(other: Set<string>): Set<string>
  intersection(other: Set<string>): Set<string>
  difference(other: Set<string>): Set<string>
  symmetricDifference(other: Set<string>): Set<string>
  isSubsetOf(other: Set<string>): boolean
  isSupersetOf(other: Set<string>): boolean
  isDisjointFrom(other: Set<string>): boolean
}

/** 把代理后的集合视图按上面的本地形状交给用例（唯一的 `as unknown as` 收口点） */
function asEs2025Set(view: unknown): Es2025SetLike {
  return view as unknown as Es2025SetLike
}

/**
 * 全图重建计数器：traverse 每访问一个节点都要 `Reflect.ownKeys` 一次，
 * 把一个自带 ownKeys 陷阱的代理挂进状态里，命中数即「走过整张图的次数」
 */
function walkingCounter(marker: object) {
  let walks = 0
  const proxy = new Proxy(marker, {
    ownKeys(target) {
      walks += 1
      return Reflect.ownKeys(target)
    },
  })
  return { proxy: proxy as unknown as object, reads: () => walks, reset: () => (walks = 0) }
}

describe('R6-038 同容器内置换不再触发全量重建', () => {
  /** 原地置换 n 个对象元素期间「重走整张图」的次数（旧实现随 n 增长，修复后是常数） */
  function walksDuringPermutation(n: number, mutate: (list: unknown[]) => void): number {
    const items = Array.from({ length: n }, (_, i) => ({ id: i, ts: (i * 7919) % n, deep: { v: i } }))
    const counter = walkingCounter({ marker: 1 })
    const { proxy } = track({ todos: items, marker: counter.proxy })

    // 首笔经代理的写入建立索引（这一步必然重走一次图），之后的置换才是本条要量的
    ;((proxy.todos as unknown as Nested[])[0].deep as Nested).v = 1
    counter.reset()

    mutate(proxy.todos as unknown as unknown[])
    return counter.reads()
  }

  it('对象数组原地 sort：重建次数与元素个数无关', () => {
    const byTs = (list: unknown[]): void => {
      list.sort((a, b) => (a as { ts: number }).ts - (b as { ts: number }).ts)
    }
    // 旧实现：TimSort 的写入是 O(n log n) ⇒ 50 个元素就上百次、400 个元素上千次全图重走
    expect(walksDuringPermutation(50, byTs)).toBeLessThanOrEqual(2)
    expect(walksDuringPermutation(400, byTs)).toBeLessThanOrEqual(2)
  })

  it('排序语义与置换后的归因都不回退', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: i, ts: (i * 7919) % 30, deep: { v: i } }))
    const { proxy, last } = track({ todos: items })

    const list = proxy.todos as unknown as Array<{ id: number; ts: number; deep: { v: number } }>
    list.sort((a, b) => a.ts - b.ts)
    // 排序结果正确（升序）且没有丢元素/造重复
    expect(list.map((item) => item.ts)).toEqual([...list].map((item) => item.ts).sort((a, b) => a - b))
    expect(new Set(list.map((item) => item.id)).size).toBe(30)

    const moved = list[5] as unknown as Nested
    ;(moved.deep as Nested).v = 99
    expect(last()).toEqual(['todos'])
  })

  it('reverse / splice 中段插入对象：置换部分不重建，新增边照旧登记', () => {
    const walks = walksDuringPermutation(20, (list) => {
      list.reverse()
      list.splice(3, 0, { id: 99, ts: 0, deep: { v: 99 } })
    })
    // reverse 的 10 次互换 + splice 的右移全是同容器内置换，只有那笔真新增边例外
    expect(walks).toBeLessThanOrEqual(2)
  })

  it('新值尚未覆盖容器归属时仍走全量重建（不得把跨键移动判成 STABLE 而漏报）', () => {
    const incoming = { deep: { v: 0 } }
    const { proxy, last } = track({ a: { slot: { old: 1 } }, b: incoming })

    // a.slot ← b 下的对象：incoming 的归属是 {b}，而容器 a 的归属是 {a} ⇒ 未覆盖
    ;(proxy.a as Nested).slot = proxy.b
    const moved = ((proxy.a as Nested).slot as Nested).deep as Nested
    moved.v = 1

    expect(last()).toEqual(['a', 'b'])
  })

  it('对象被标量覆盖（真删边）仍按重建口径给出精确归属', () => {
    const gone = { v: 0 }
    const { proxy, last } = track({ a: { slot: gone }, b: 1 })
    const goneView = (proxy.a as Nested).slot as Nested

    ;(proxy.a as Nested).slot = 0
    goneView.v = 1

    // gone 已不可达 ⇒ 归属解析不出，兜底标记全部顶层键（宁多报不漏报）
    expect(last()).toEqual(['a', 'b'])
  })
})

describe('R6-039 集合代理的白名单外成员以原始集合为接收者', () => {
  it('ES2025 Set 集合方法在代理上可用（此前抛 incompatible receiver）', () => {
    const { proxy, last } = track({ tags: new Set(['a', 'b']) })
    const tags = asEs2025Set(proxy.tags)

    expect([...tags.union(new Set(['b', 'c']))].sort()).toEqual(['a', 'b', 'c'])
    expect([...tags.intersection(new Set(['b', 'c']))]).toEqual(['b'])
    expect([...tags.difference(new Set(['a']))]).toEqual(['b'])
    expect([...tags.symmetricDifference(new Set(['b', 'c']))].sort()).toEqual(['a', 'c'])
    expect(tags.isSubsetOf(new Set(['a', 'b', 'z']))).toBe(true)
    expect(tags.isSupersetOf(new Set(['a']))).toBe(true)
    expect(tags.isDisjointFrom(new Set(['z']))).toBe(true)
    // 被代理包住的另一个 Set 作参数也不炸（union 内部走 has/keys，均已被拦截解包）
    const other = asEs2025Set(proxy.tags)
    expect(tags.isSubsetOf(other)).toBe(true)
    void last
  })

  it('集合的写入方法照旧被追踪，读方法不产生上报', () => {
    const { proxy, reports, last } = track({ tags: new Set(['a']) })
    const tags = asEs2025Set(proxy.tags)

    reports.length = 0
    tags.union(new Set(['x']))
    expect(reports).toHaveLength(0)

    tags.add('b')
    expect(last()).toEqual(['tags'])
    expect([...tags].sort()).toEqual(['a', 'b'])
  })

  it('Map/Set 子类的自定义方法能读到自己的私有字段', () => {
    class Bucket extends Set<string> {
      #limit = 3
      capacity(): number {
        return this.#limit + this.size
      }
    }
    const bucket = new Bucket(['a', 'b'])
    const { proxy } = track({ bucket })

    expect((proxy.bucket as unknown as Bucket).capacity()).toBe(5)
    // 仍是同一条链上的原始对象：新增成员照常从代理可见
    ;(proxy.bucket as unknown as Set<string>).add('c')
    expect((proxy.bucket as unknown as Bucket).capacity()).toBe(6)
  })

  it('constructor 不被绑定（仍可 new），函数型自有属性按原始对象取回', () => {
    const raw = new Set<number>([1])
    const holder = { raw }
    const { proxy } = track({ holder })
    const view = (proxy.holder as Nested).raw as unknown as Set<number> & { ctor: unknown }

    expect(typeof view.constructor).toBe('function')
    expect(new (view.constructor as SetConstructor)([7]).size).toBe(1)
    void holder
  })
})
