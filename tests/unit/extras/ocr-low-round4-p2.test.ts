/**
 * G2-extras low 第 2 片（#288 / #296 / #307 / #309 / #311 / #315 / #322）的回归用例
 *
 * 只给「判定成立且改动可观察」与「FP 需要命令级证据」的条目立测：
 * - #288 同步克隆把类型判定纳入 onError 契约（行为变更）
 * - #309 防抖选择器重入后定时器不再失去句柄（行为变更）
 * - #296 / #311 两处纯重构的等价性护栏
 * - #315 证伪：Map/Set 结构匹配与原语比较在 0/-0、NaN 上口径一致
 * - #322 原语分支走归一化后的描述符标志
 * - #289 / #306 / #307 类型面：入口 barrel 从定义处再导出、batchSize 仍继承、visited 值可用
 * 纯文档/注释类判定（#283、#292、#295、#297、#301、#302、#312、#313、#316、#321、#323）
 * 不产生新行为，故不在本文件立测。
 */

import { SelectorComposer } from '@/extras/selector/selectorComposer.js'
import { createSelector, SelectorFactory } from '@/extras/selector/createSelector.js'
import {
  createSnapshot,
  createSnapshotAsync,
  type AsyncSnapshotOptions,
  type CloneContext,
  type SnapshotDiff,
  type SnapshotError,
  type SnapshotErrorContext,
} from '@/extras/snapshot/index.js'
import { compareSnapshots } from '@/extras/snapshot/diff.js'

type NumState = { value: number }

/** 只让 getPrototypeOf 陷阱抛错的 Proxy（其余陷阱一律透传） */
function proxyWithBrokenPrototype(tag: string): object {
  return new Proxy({ tag } as Record<string, unknown>, {
    getPrototypeOf() {
      throw new TypeError(`getPrototypeOf denied: ${tag}`)
    },
  })
}

describe('#288 同步克隆：getPrototypeOf 陷阱抛错必须走 cloneError + onError，而不是冲出克隆', () => {
  it('根节点上抛错时记为 cloneError@root（修复前落到 SnapshotManager 的 unknown@root）', () => {
    const seen: Array<{ error: SnapshotError; context: SnapshotErrorContext }> = []
    const result = createSnapshot(proxyWithBrokenPrototype('root'), {
      onError: (error, context) => {
        seen.push({ error, context })
        return true
      },
    })

    expect(result.success).toBe(false)
    expect(result.data).toBeUndefined()
    expect(seen).toHaveLength(1)
    expect(seen[0].error.type).toBe('cloneError')
    expect(seen[0].error.path).toBe('root')
    expect(result.errors.map((e) => e.type)).toEqual(['cloneError'])
  })

  it('嵌套在数组中间时按该元素自己的路径与深度记账，兄弟元素照常克隆（修复前整条数组被丢、路径归到父级）', () => {
    const seen: Array<{ error: SnapshotError; context: SnapshotErrorContext }> = []
    const result = createSnapshot(
      { list: [{ ok: 1 }, proxyWithBrokenPrototype('item1'), { ok: 3 }] },
      {
        onError: (error, context) => {
          seen.push({ error, context })
          return true
        },
      },
    )

    expect(seen).toHaveLength(1)
    expect(seen[0].error.type).toBe('cloneError')
    expect(seen[0].error.path).toBe('root.list[1]')
    // 深度按失败节点自身（root=0 / list=1 / 元素=2）；修复前由父级的属性 catch 记账，
    // 报的是 root.list 且 depth 少一层，兄弟元素也随整条数组一起丢失
    expect(seen[0].context.depth).toBe(2)
    const data = result.data as { list: unknown[] }
    expect(data.list[0]).toEqual({ ok: 1 })
    expect(data.list[2]).toEqual({ ok: 3 })
    expect(data.list[1]).toBeUndefined()
  })

  it('onError 拒绝继续时中止信号原样上抛，不在父级二次咨询', () => {
    let consulted = 0
    const result = createSnapshot(
      { nested: proxyWithBrokenPrototype('once') },
      {
        onError: () => {
          consulted++
          return false
        },
      },
    )

    expect(consulted).toBe(1)
    expect(result.success).toBe(false)
  })
})

describe('#309 防抖选择器：重入调用排定的定时器仍持有句柄', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('回调内同步重入后，下一次外部调用会清除重入定时器而不是让它重复执行选择器', async () => {
    const executed: number[] = []
    // eslint-disable-next-line prefer-const -- 循环引用：selector 闭包需引用 debounced，只能先声明后赋值
    let debounced: (state: NumState) => Promise<number>
    let reentered = false

    const selector = (state: NumState): number => {
      executed.push(state.value)
      if (!reentered) {
        reentered = true
        // 选择器执行期间同步重入：这次调用复用尚未清空的 currentPromise，
        // 并另起一个定时器覆盖 timeoutId——修复前 finally 又把它抹成 null
        void debounced({ value: 2 })
      }
      return state.value
    }

    debounced = SelectorComposer.createDebouncedSelector(selector, 50)

    const first = debounced({ value: 1 })
    jest.advanceTimersByTime(50)
    expect(await first).toBe(1)

    const third = debounced({ value: 3 })
    jest.advanceTimersByTime(60)
    expect(await third).toBe(3)

    // 修复前为 [1, 3, 3]：重入定时器失去句柄、无法被清除，多跑一次且结果被丢弃
    expect(executed).toEqual([1, 3])
  })

  it('非重入路径的防抖语义不变：窗口内多次调用只执行最后一次', async () => {
    const executed: number[] = []
    const debounced = SelectorComposer.createDebouncedSelector((state: NumState) => {
      executed.push(state.value)
      return state.value
    }, 50)

    const a = debounced({ value: 1 })
    const b = debounced({ value: 2 })
    jest.advanceTimersByTime(60)

    expect(await a).toBe(2)
    expect(await b).toBe(2)
    expect(executed).toEqual([2])
  })
})

describe('#296 execute 与 withCacheResult 共用一套缓存协议（重构等价性）', () => {
  it('命中缓存历史条目时两者给出同样的值与 fromCache=true', () => {
    const calls: number[] = []
    const fn = (state: NumState): number => {
      calls.push(state.value)
      return state.value * 10
    }
    // 比较器是引用相等，故须显式声明缓存活引用（snapshotState: false）：
    // 默认的内容快照会让克隆体与活引用永不相等，缓存永远命不中
    const options = { cache: true, cacheSize: 3, cacheTTL: 10000, equalityFn: (a: unknown, b: unknown) => a === b, snapshotState: false }

    const plain = new SelectorFactory(fn, options)
    const wrapped = new SelectorFactory(fn, options)
    const cacheResult = wrapped.withCacheResult()

    const s1 = { value: 1 }
    const s2 = { value: 2 }
    const sequence = [s1, s2, s1] as NumState[]

    const plainResults = sequence.map((s) => plain.execute(s))
    const wrappedResults = sequence.map((s) => cacheResult(s))

    expect(wrappedResults.map((r) => r.value)).toEqual(plainResults)
    // 第三次回到 s1：命中发生在 cacheHistory 上，两条路径都必须认它是命中
    expect(plainResults[2]).toBe(10)
    expect(wrappedResults[2]).toEqual({ value: 10, fromCache: true })
    // 两个 factory 各算 1、2 一次（同一 fn 共享计数），共 4 次；第三条命中历史不再计算
    expect(calls).toEqual([1, 2, 1, 2])
  })

  it('createSelector 的 cache: false 与 fromCache 标记仍按原口径', () => {
    const calls: number[] = []
    const factory = new SelectorFactory(
      (state: NumState) => {
        calls.push(state.value)
        return state.value
      },
      { cache: false },
    )
    const withResult = factory.withCacheResult()

    expect(withResult({ value: 1 })).toEqual({ value: 1, fromCache: false })
    expect(withResult({ value: 1 })).toEqual({ value: 1, fromCache: false })
    expect(calls).toEqual([1, 1])

    const cached = createSelector((state: NumState) => state.value * 2, { cache: true, equalityFn: (a: unknown, b: unknown) => a === b, snapshotState: false })
    const state = { value: 5 }
    expect(cached(state)).toBe(10)
    expect(cached(state)).toBe(10)
    // createSelector 的返回类型是裸 Selector，factory 由 Object.assign 附加（公开签名不含），
    // 故按实际形状收窄一次而不是 as any
    const exposed = (cached as unknown as { factory: SelectorFactory<NumState, number> }).factory
    expect(exposed.getCacheStatus()).toMatchObject({ hasCache: true, cacheSize: 1 })
  })
})

describe('#311 createDerived 与 pipe 共用实现（等价性 + 不再有 as [never]）', () => {
  it('同一串选择器两条入口结果一致，且保留逐段传值', () => {
    const state = { user: { profile: { avatar: 'a.png' } } }
    const readUser = (s: typeof state) => s.user
    const readProfile = (u: { profile: { avatar: string } }) => u.profile
    const readAvatar = (p: { avatar: string }) => p.avatar

    // 逐个传参而不是展开数组：pipe 的公开面是重载列表，rest 展开拿不到逐段类型
    const piped = SelectorComposer.pipe(readUser, readProfile, readAvatar)
    const derived = SelectorComposer.createDerived(readUser, readProfile, readAvatar)

    expect(derived(state)).toBe('a.png')
    expect(piped(state)).toBe(derived(state))
  })
})

describe('#315 差异比较的相等语义在两条链路一致（报告前提证伪）', () => {
  const snap = <T>(data: T) => createSnapshot(data)

  it('Map 键结构匹配对 0/-0 与 NaN 判等，与原语属性链路同样不报差异', () => {
    const asProps = compareSnapshots(snap({ v: 0 }), snap({ v: -0 }))
    expect(asProps.changed).toBe(false)

    // 键是对象时只能走结构匹配（deepEqual），结论必须与上面的 === 链路一致
    const map1 = new Map<unknown, string>()
    map1.set({ v: 0 }, 'x')
    const map2 = new Map<unknown, string>()
    map2.set({ v: -0 }, 'x')
    expect(compareSnapshots(snap(map1), snap(map2)).changes).toEqual([])

    const set1 = new Set<unknown>([{ v: Number.NaN }])
    const set2 = new Set<unknown>([{ v: Number.NaN }])
    expect(compareSnapshots(snap(set1), snap(set2)).changed).toBe(false)

    expect(compareSnapshots(snap({ v: Number.NaN }), snap({ v: Number.NaN })).changed).toBe(false)
  })

  it('真实差异仍按 added/removed 报出（上述判等没有吞掉护栏）', () => {
    const map1 = new Map<unknown, string>()
    map1.set({ v: 1 }, 'x')
    const map2 = new Map<unknown, string>()
    map2.set({ v: 2 }, 'y')
    const diff = compareSnapshots(snap(map1), snap(map2))

    expect(diff.changed).toBe(true)
    expect(diff.changes.map((c) => c.kind)).toEqual(expect.arrayContaining(['added', 'removed']))
  })
})

describe('#322 异步克隆的原语分支使用归一化后的描述符标志', () => {
  const flagsOf = (target: object, key: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key)
    return { writable: descriptor?.writable, enumerable: descriptor?.enumerable, configurable: descriptor?.configurable }
  }

  it('不可写 / 不可配置的源属性在两条路径都还原同样的标志', async () => {
    const source: Record<string, unknown> = { visible: 1, frozenFlag: 2 }
    Object.defineProperty(source, 'frozenFlag', { value: 2, writable: false, enumerable: true, configurable: false })

    const sync = createSnapshot(source).data as Record<string, unknown>
    const asyncResult = await createSnapshotAsync(source, { batchSize: 1 })

    expect(asyncResult.success).toBe(true)
    for (const cloned of [sync, asyncResult.data as Record<string, unknown>]) {
      expect(cloned.frozenFlag).toBe(2)
      expect(flagsOf(cloned, 'frozenFlag')).toEqual({ writable: false, enumerable: true, configurable: false })
      expect(flagsOf(cloned, 'visible')).toEqual({ writable: true, enumerable: true, configurable: true })
    }
  })

  it('includeNonEnumerable 下不可枚举的原语属性同样还原三个标志（两路径一致）', async () => {
    const source: Record<string, unknown> = { visible: 1 }
    Object.defineProperty(source, 'hidden', { value: 2, writable: false, enumerable: false, configurable: false })

    const sync = createSnapshot(source, { includeNonEnumerable: true }).data as Record<string, unknown>
    const asyncResult = await createSnapshotAsync(source, { includeNonEnumerable: true, batchSize: 1 })
    const cloned = asyncResult.data as Record<string, unknown>

    expect(cloned.hidden).toBe(2)
    expect(flagsOf(cloned, 'hidden')).toEqual({ writable: false, enumerable: false, configurable: false })
    expect(flagsOf(sync, 'hidden')).toEqual(flagsOf(cloned, 'hidden'))
  })
})

describe('#289 / #306 / #307 快照入口的类型面与 visited 契约', () => {
  it('入口 barrel 仍导出全部公开类型，AsyncSnapshotOptions 仍继承 batchSize', () => {
    const options: AsyncSnapshotOptions = { async: true, batchSize: 2, batchInterval: 0, maxDepth: 5 }
    const visited = new WeakMap<object, object>()
    const context: CloneContext = { path: 'root', depth: 0, parent: null, key: 'root', visited }
    const diff: SnapshotDiff = { changed: false, changes: [], timestamp1: 0, timestamp2: 0 }

    expect(options.batchSize).toBe(2)
    // visited 的值可读回为 object（无需再断言），循环引用因此共享同一实例
    const source: Record<string, unknown> = { self: null }
    source.self = source
    const result = createSnapshot(source)
    const cloned = result.data as Record<string, unknown>
    expect(cloned.self).toBe(cloned)
    expect(typeof context.path).toBe('string')
    expect(diff.changed).toBe(false)
  })
})
