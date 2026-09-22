/**
 * 第五轮 core-store-p1 分片：脏追踪索引的回归锁
 *
 * 覆盖 R5-155（原型链 setter 的写入分类）、R5-157（类实例方法调用不再整体重建）、
 * R5-158（锁定数据属性的追踪空洞）、R5-159（版本背书：既不能早于本次写入，也不能吞掉回调里的重入改图）。
 *
 * 「是否触发了全量重建」用一层计数代理观测：`rebuildOwners` 每次重建都会对 root 走一次
 * `Reflect.ownKeys`，增量路径不会。计数代理只实现 ownKeys 陷阱，其余全部转发原始对象。
 * 用计数作断言的用例都先把索引建起来再取基线，因此计数里不含 report 的
 * 「解析不出归属即标记全部顶层键」兜底（那条兜底也读一次 root 的 ownKeys）。
 */
import { createDirtyTrackingCache, createDirtyTrackingProxy } from '@/core/store/dirtyTracking.js'
import { defineStateVersion } from '@/core/store/stateVersion.js'

type Nested = Record<string | symbol, unknown>

/** 直连脏追踪代理，收集每次上报的顶层键（排序便于精确断言） */
function track(root: Nested) {
  const reports: string[][] = []
  const proxy = createDirtyTrackingProxy(root, createDirtyTrackingCache(), (keys) => {
    reports.push([...keys].map(String).sort())
  }) as Nested
  return { proxy, reports, last: () => reports[reports.length - 1] ?? [] }
}

/**
 * 带状态版本号的脏追踪代理 + 全量重建计数器
 *
 * onMutate 里推一次版本模拟 Store 的接线（每次被追踪的写入 `_mutationCount++`）：
 * 版本号取值与递增同源，测的才是 report 与索引之间的一致性。
 */
function trackVersioned(root: Nested) {
  let mutationCount = 0
  defineStateVersion(root, () => mutationCount)
  const reports: string[][] = []
  let rootKeyReads = 0
  const counted = new Proxy(root, {
    ownKeys(target): ArrayLike<string | symbol> {
      rootKeyReads++
      return Reflect.ownKeys(target)
    },
  })
  const proxy = createDirtyTrackingProxy(counted, createDirtyTrackingCache(), (keys) => {
    mutationCount++
    reports.push([...keys].map(String).sort())
  }) as Nested
  return { proxy, reports, rebuilds: () => rootKeyReads }
}

describe('R5-155 原型链上的访问器参与写入分类', () => {
  it('类实例的原型 setter 摘掉被索引的边时按全量重建归因，不留幻影边', () => {
    class Holder {
      payload: Nested | null = null
      // 只有 setter、且写在原型链上：Reflect.set 以原始对象为 this 调用它，
      // set 陷阱看不到它把 payload 这条边摘掉
      set release(_value: unknown) {
        this.payload = null
      }
    }
    const detached = { v: 0 }
    const holder = new Holder()
    holder.payload = detached
    const root: Nested = { a: holder, b: { keep: 1 } }
    const { proxy, last } = track(root)
    const held = (proxy.a as Nested).payload as Nested

    // 先把索引建起来（首次上报是惰性建索引，不是分类结果），否则「摘边」发生在
    // 索引存在之前，两种分类口径给出同一个答案，用例就测不到幻影边了
    ;(proxy.b as Nested).keep = 2
    ;(proxy.a as Nested).release = true
    held.v = 1

    // 该对象已从图里脱落、解析不出归属 ⇒ 兜底标记全部顶层键。
    // 分类只看自有属性时（修复前）索引仍以为它挂在 a 下，只报 ['a']——漏报
    expect(last()).toEqual(['a', 'b'])
  })

  it('原型链上只有数据属性（继承方法）时不改判：新增对象值仍走增量登记', () => {
    const root: Nested = { a: { slot: 0 }, b: {} }
    const { proxy, last } = track(root)
    // 先建索引；'toString' 之类在 Object.prototype 上是数据属性，不该被当成访问器
    ;(proxy.b as Nested).touched = 1
    ;(proxy.a as Nested).slot = { deep: { v: 0 } }
    const deep = ((proxy.a as Nested).slot as Nested).deep as Nested
    deep.v = 1

    // 增量登记生效：新子树按容器归属归因，没有牵连 b
    expect(last()).toEqual(['a'])
  })
})

describe('R5-157 类实例方法调用不再无条件全量重建', () => {
  it('连续调用绑定方法只按当前索引归因，不重推整图', () => {
    class Counter {
      value = 0
      inc(): void {
        this.value++
      }
    }
    const root: Nested = { svc: new Counter(), other: { v: 0 } }
    const { proxy, rebuilds, reports } = trackVersioned(root)

    // 索引在首次上报时才惰性建：先做一次普通写入把它建起来并以此作基线
    ;(proxy.other as Nested).v = 1
    const baseline = rebuilds()
    expect(baseline).toBe(1)

    const svc = proxy.svc as Counter
    svc.inc()
    svc.inc()
    svc.inc()

    // 修复前每次方法调用都强制一次全量重建（report 默认 EDGE_REMOVED）⇒ 这里是 4
    expect(rebuilds()).toBe(baseline)
    expect(reports.map((keys) => keys.join())).toEqual(['other', 'svc', 'svc', 'svc'])
    expect((root.svc as Counter).value).toBe(3)
  })
})

describe('R5-158 锁定数据属性是已文档化的追踪空洞', () => {
  it('不可配置且不可写的数据属性原样返回裸对象，其后的写入不被追踪', () => {
    const locked = { v: 0 }
    const root: Nested = { other: 1 }
    Object.defineProperty(root, 'locked', { value: locked, writable: false, enumerable: true, configurable: false })
    const { proxy, reports } = track(root)

    const got = proxy.locked
    // Proxy 不变量要求原样返回值，包装会直接抛 TypeError
    expect(got).toBe(locked)
    ;(got as Nested).v = 5
    expect(reports).toEqual([])
    expect(locked.v).toBe(5)
  })
})

describe('R5-159 版本标记时点', () => {
  it('连续写入复用同一份索引：onMutate 自身的版本递增不得让索引永久判陈旧', () => {
    const root: Nested = { a: { v: 0 }, b: { v: 0 } }
    const { proxy, rebuilds } = trackVersioned(root)
    const a = proxy.a as Nested
    const b = proxy.b as Nested

    a.v = 1
    const baseline = rebuilds()
    for (let i = 2; i <= 6; i++) {
      a.v = i
      b.v = i
    }
    // report 在 onMutate 之后取版本号是必须的：把标记点提到回调之前会让版本号恒落后
    // 一次递增，下一次写入必然判为「版本已变」⇒ 每次写入都全量重建，增量索引失效
    expect(rebuilds()).toBe(baseline)
  })

  it('回调多推一格（重入的 Store 侧写入）时作废背书，新增的别名边不致漏归因', () => {
    const shared = { v: 0 }
    const root: Nested = { a: { child: shared }, b: { touched: 0 } }
    let mutationCount = 0
    let injectAlias = false
    const reports: string[][] = []
    defineStateVersion(root, () => mutationCount)
    const proxy = createDirtyTrackingProxy(root, createDirtyTrackingCache(), (keys) => {
      reports.push([...keys].map(String).sort())
      // 本次写入的记账一格（Store 接线固定这么多做）
      mutationCount++
      if (injectAlias) {
        // 模拟监听器里调 store.setState：直写原始对象、不经过本代理的陷阱，
        // 但 Store 侧会为那次改图再推一格版本号
        const b = root.b as Nested
        b.child = shared
        mutationCount++
        injectAlias = false
      }
    }) as Nested

    injectAlias = true
    ;(proxy.b as Nested).touched = 1
    expect(reports.length).toBe(1)

    // 别名边由回调建立，索引只有重建后才认它：写 shared 必须同时报 a 与 b
    // （回调前取版本号并原样背书时索引判「已是最新」，这里只会报 ['a'] ⇒ b 的视图永久陈旧）
    injectAlias = false
    ;((proxy.a as Nested).child as Nested).v = 2
    expect(reports[reports.length - 1]).toEqual(['a', 'b'])
  })
})
