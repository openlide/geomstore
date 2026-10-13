/**
 * 第七轮全库复审（open-code-review 委派模式）修复项的回归锁
 *
 * 本文件只锁「本轮真改过行为」的条目——每条都对应一次评审结论，不是覆盖率补齐：
 * - diff：数组附加属性漏比、槽位内建值恒判等（深Merge 链路的符号键支持一并锁住）；
 * - timeTravel：初始 filter 抛错时不得留下无法退订的监听器；
 * - SnapshotManager：显式 undefined 不得击穿默认 onError / customCloner；
 * - Store.$patch：符号键必须真的写进去并标脏；
 * - 杂项：isIndexKey 上界、装箱 -0 口径、getPercentile 的非有限耗时、装饰器误用守卫。
 *
 * 注释/文档类修复与「刻意不改」的项（持久化默认键）不在本文件。
 */

import { createStore } from '@/index.js'
import { compareSnapshots } from '@/extras/snapshot/diff.js'
import { createSnapshot, SnapshotManager } from '@/extras/snapshot/SnapshotManager.js'
import { timeTravelPlugin } from '@/plugins/devtools/index.js'
import { MetricsCollector } from '@/core/performance/metrics.js'
import { isIndexKey } from '@/core/utils/clone.js'
import { deepEqual } from '@/core/utils/helpers.js'
import { withLoading } from '@/extras/action/withLoading.js'
import { withTimeout } from '@/extras/action/decorators/timeout.js'
import type { MetricType } from '@/types/performance.js'

describe('R7 diff：数组附加属性与槽位内建值', () => {
  it('数组的非索引自有属性参与比较：version 1→2 必须报出差异', () => {
    const list: Array<number> & { version?: number } = [1, 2, 3]
    list.version = 1
    const before = createSnapshot({ list })
    const after = createSnapshot({ list: Object.assign([1, 2, 3], { version: 2 }) })

    const diff = compareSnapshots(before, after)

    expect(diff.changed).toBe(true)
    expect(diff.changes.some((c) => c.path === 'root.list.version')).toBe(true)
  })

  it('数组附加属性被删除时报 removed，且不影响下标比较', () => {
    const withMeta = Object.assign([1, 2], { meta: 'x' })
    const diff = compareSnapshots(createSnapshot({ list: withMeta }), createSnapshot({ list: [1, 2] }))

    expect(diff.changed).toBe(true)
    expect(diff.changes).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'root.list.meta', kind: 'removed' })]))
  })

  it('ArrayBuffer / Error 按引用判：换了实例就是一次 changed', () => {
    const diff = compareSnapshots(
      createSnapshot({ buf: new ArrayBuffer(8), err: new Error('a') }),
      createSnapshot({ buf: new ArrayBuffer(64), err: new Error('b') }),
    )

    expect(diff.changed).toBe(true)
    expect(diff.changes.map((c) => c.path).sort()).toEqual(['root.buf', 'root.err'])
  })

  it('同一引用不变时不算变化（缓冲原地改字节在快照层面本就无从分辨）', () => {
    const buf = new ArrayBuffer(8)
    const diff = compareSnapshots(createSnapshot({ buf }), createSnapshot({ buf }))

    expect(diff.changed).toBe(false)
  })

  it('装箱原语仍按内容判：两个等值 Number 不该被引用比较报成变化', () => {
    const diff = compareSnapshots(createSnapshot({ n: new Number(1) }), createSnapshot({ n: new Number(1) }))

    expect(diff.changed).toBe(false)
  })
})

describe('R7 Store.$patch：符号键不再被静默丢弃', () => {
  it('符号键补丁真的写入状态，并在通知轮次里被标脏', () => {
    const sym = Symbol('flag')
    type S = { plain: number } & Record<symbol, number | undefined>
    // 脏键表在通知轮次结束时清空，故断言必须落在监听器内部
    const store = createStore({ name: 'r7-symbol-patch', state: { plain: 0 } as S })
    const dirtyDuringNotify: Array<boolean> = []
    store.subscribe(() => {
      dirtyDuringNotify.push(store.isStateKeyDirty(sym))
    })

    store.$patch({ [sym]: 7 } as Partial<S>)

    expect(store.getState()[sym]).toBe(7)
    expect(dirtyDuringNotify).toEqual([true])
  })

  it('符号键上的补丁也会触发订阅通知', () => {
    const sym = Symbol('flag')
    type S = { plain: number } & Record<symbol, number | undefined>
    const store = createStore({ name: 'r7-symbol-patch-notify', state: { plain: 0 } as S })
    const listener = jest.fn()
    store.subscribe(listener)

    store.$patch({ [sym]: 1 } as Partial<S>)

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('可写订阅者拿到的深拷贝载荷里也有符号键（deepCloneState 曾整条漏掉）', () => {
    const sym = Symbol('flag')
    type S = { plain: number } & Record<symbol, number | undefined>
    const store = createStore({ name: 'r7-symbol-patch-payload', state: { plain: 0 } as S })
    // 可写（非 readOnly）订阅者才走深拷贝载荷；只读订阅者拿的是活的只读代理
    const payloads: Array<Record<PropertyKey, unknown>> = []
    store.subscribe((payload) => {
      payloads.push(payload as Record<PropertyKey, unknown>)
    })

    store.$patch({ [sym]: 5 } as Partial<S>)

    expect(payloads).toHaveLength(1)
    expect(payloads[0][sym]).toBe(5)
  })

  it('状态工厂与 $replaceState 里的符号键同样被保留', () => {
    const factorySym = Symbol('from-factory')
    const replaceSym = Symbol('from-replace')
    type S = { plain: number } & Record<symbol, number | undefined>

    const store = createStore({ name: 'r7-symbol-init', state: () => ({ plain: 0, [factorySym]: 1 }) as S })
    expect(store.getState()[factorySym]).toBe(1)

    store.$replaceState({ plain: 0, [replaceSym]: 2 } as S)
    expect(store.getState()[replaceSym]).toBe(2)
  })
})

describe('R7 timeTravel：初始记录失败不留死监听器', () => {
  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).__GEOMSTORE_TIME_TRAVEL__
    jest.restoreAllMocks()
  })

  it('filter 抛错导致安装失败后，store 上不残留订阅（额度未被占）', () => {
    // 订阅额度是「有没有残留监听器」的可观测信号：修复前订阅先于初始记录建立，
    // filter 抛错时 disposer 拿不到，那条死监听器永久占着额度
    const store = createStore({
      name: 'r7-tt-filter',
      state: { n: 0 },
      subscription: { maxSubscribers: 1, onLimit: 'evict-oldest' },
    })
    const throwing = timeTravelPlugin({
      filter: () => {
        throw new Error('filter boom')
      },
    })

    expect(() => store.use(throwing)).toThrow('filter boom')

    const warn = jest.spyOn(console, 'warn').mockImplementation()
    const dispose = store.subscribe(() => {})
    expect(warn).not.toHaveBeenCalled()
    dispose()
  })
})

describe('R7 SnapshotManager：显式 undefined 不击穿默认值', () => {
  it('onError: undefined 时错误路径仍走默认实现，不抛 TypeError', () => {
    // 抛错的 getter 是确定会走进 onError 咨询的输入（循环引用默认被 detectCircular 收编，不报错）
    const source: Record<string, unknown> = { ok: 1 }
    Object.defineProperty(source, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter boom')
      },
    })

    const result = createSnapshot(source, { onError: undefined })

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some((e) => /onError is not a function/.test(e.message))).toBe(false)
  })

  it('customCloner: undefined 不会让每个节点都落进 cloneError', () => {
    const result = createSnapshot({ a: { b: 1 } }, { customCloner: undefined })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ a: { b: 1 } })
  })

  it('构造期的显式 undefined 同样不击穿默认值', () => {
    const manager = new SnapshotManager({ onError: undefined })
    const source: Record<string, unknown> = { ok: 1 }
    Object.defineProperty(source, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter boom')
      },
    })

    const result = manager.createSnapshot(source)

    expect(result.errors.some((e) => /onError is not a function/.test(e.message))).toBe(false)
  })
})

describe('R7 杂项修复', () => {
  it('isIndexKey 拒绝超出最大合法下标的键（否则该属性在克隆里静默消失）', () => {
    expect(isIndexKey('0')).toBe(true)
    expect(isIndexKey(String(2 ** 32 - 2))).toBe(true)
    expect(isIndexKey(String(2 ** 32 - 1))).toBe(false)
    expect(isIndexKey('4294967295')).toBe(false)
  })

  it('超界下标上的属性能被克隆保留下来', () => {
    const source = [1] as unknown as Record<string, unknown>
    source['4294967295'] = 'big'

    const cloned = createSnapshot(source)

    expect((cloned.data as Record<string, unknown>)['4294967295']).toBe('big')
  })

  it('deepEqual 对装箱 -0 与未装箱 -0 口径一致', () => {
    expect(deepEqual(-0, 0)).toBe(true)
    expect(deepEqual(new Number(-0), new Number(0))).toBe(true)
    expect(deepEqual(new Number(1), new Number(2))).toBe(false)
  })

  it('getPercentile 忽略非有限耗时，不返回 NaN', () => {
    const collector = new MetricsCollector(10)
    const metric = (operation: string, duration: number): Parameters<MetricsCollector['collect']>[0] => ({
      operation,
      type: 'setState' as MetricType,
      duration,
      timestamp: Date.now(),
    })

    collector.collect(metric('a', 10))
    collector.collect(metric('b', 20))
    collector.collect(metric('c', 30))
    collector.collect(metric('d', Number.NaN))

    // 修复前 NaN 参与 `a - b` 排序，比较器返回 NaN 时元素位置不定，p100 可能读出 NaN
    expect(collector.getPercentile(100)).toBe(30)
    expect(Number.isNaN(collector.getPercentile(50))).toBe(false)
  })

  it('全是非有限耗时时 getPercentile 返回 0 而非 undefined', () => {
    const collector = new MetricsCollector(10)
    collector.collect({ operation: 'a', type: 'setState', duration: Number.NaN, timestamp: Date.now() })

    expect(collector.getPercentile(99)).toBe(0)
  })

  it('装饰器误用在 class field 上时给出指名错误的 TypeError', () => {
    const misuse = (decorator: MethodDecorator): unknown => decorator({}, 'key' as never, undefined as never)

    expect(() => misuse(withLoading())).toThrow(/withLoading.*can only decorate a method/)
    expect(() => misuse(withTimeout())).toThrow(/withTimeout.*can only decorate a method/)
  })
})
