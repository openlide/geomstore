/**
 * 第七轮全库复审（open-code-review 委派模式）修复项的回归锁
 *
 * 本文件只锁「本轮真改过行为」的条目——每条都对应一次评审结论，不是覆盖率补齐：
 * - diff：数组附加属性漏比、槽位内建值恒判等（深Merge 链路的符号键支持一并锁住）；
 * - timeTravel：初始 filter 抛错时不得留下无法退订的监听器；
 * - ErrorRecovery：maxRetries 非有限值归一（NaN 曾让重试上限彻底失效）；
 * - ErrorHandler：byOperation 的原型链敏感键（__proto__ / constructor）；
 * - SnapshotManager：显式 undefined 不得击穿默认 onError / customCloner；
 * - Store.$patch：符号键必须真的写进去并标脏；
 * - HttpReporter：fetch 分支的 timeout 必须真正中止请求（重复投递的根因）；
 * - 杂项：isIndexKey 上界、装箱 -0 口径、getPercentile 的非有限耗时、装饰器误用守卫。
 *
 * 注释/文档类修复与「刻意不改」的项（持久化默认键）不在本文件，见评审报告。
 */

import { createStore } from '@/index.js'
import { compareSnapshots } from '@/extras/snapshot/diff.js'
import { createSnapshot, SnapshotManager } from '@/extras/snapshot/SnapshotManager.js'
import { timeTravelPlugin } from '@/plugins/devtools/index.js'
import { ErrorRecovery, RecoveryStrategy } from '@/extras/error/ErrorRecovery.js'
import { ErrorCode, createError } from '@/core/errors/GeomStoreError.js'
import { ErrorHandlerImpl } from '@/extras/error/ErrorHandler.js'
import { HttpReporter } from '@/extras/error/reporters/HttpReporter.js'
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

describe('R7 ErrorRecovery：maxRetries 归一', () => {
  it('NaN 不再让重试上限失效：额度用尽后按上限中止', async () => {
    const recovery = new ErrorRecovery()
    recovery.configure({
      [ErrorCode.ACTION_EXECUTION_ERROR]: {
        strategy: RecoveryStrategy.RETRY,
        maxRetries: Number.NaN,
        retryDelay: 0,
        exponentialBackoff: false,
      },
    })

    const error = createError(ErrorCode.ACTION_EXECUTION_ERROR, 'boom')
    for (let i = 0; i < 3; i++) {
      await expect(recovery.recover(error, { storeName: 's', operation: 'op' })).rejects.toThrow('boom')
    }
    // 归一后额度是默认 3：第 4 次不再是又一次普通重试，而是命中上限
    await expect(recovery.recover(error, { storeName: 's', operation: 'op' })).rejects.toThrow(/Max retries/)
  })

  it('Infinity 同样被归一到默认额度', () => {
    const recovery = new ErrorRecovery()
    recovery.configure({
      [ErrorCode.ACTION_EXECUTION_ERROR]: {
        strategy: RecoveryStrategy.RETRY,
        maxRetries: Number.POSITIVE_INFINITY,
      },
    })

    expect(recovery.getConfig(ErrorCode.ACTION_EXECUTION_ERROR)?.maxRetries).toBe(3)
  })

  it('小数向下取整，负数夹到 0', () => {
    const recovery = new ErrorRecovery()
    recovery.configure({
      [ErrorCode.ACTION_EXECUTION_ERROR]: { strategy: RecoveryStrategy.RETRY, maxRetries: 2.9 },
      [ErrorCode.ACTION_TIMEOUT]: { strategy: RecoveryStrategy.RETRY, maxRetries: -5 },
    })

    expect(recovery.getConfig(ErrorCode.ACTION_EXECUTION_ERROR)?.maxRetries).toBe(2)
    expect(recovery.getConfig(ErrorCode.ACTION_TIMEOUT)?.maxRetries).toBe(0)
  })
})

describe('R7 ErrorHandler：统计分组不受原型链键影响', () => {
  it("operation 为 '__proto__' / 'constructor' 时计数仍然正确", () => {
    const handler = new ErrorHandlerImpl()
    handler.handle('store', '__proto__' as never, new Error('a'))
    handler.handle('store', '__proto__' as never, new Error('b'))
    handler.handle('store', 'constructor' as never, new Error('c'))

    const stats = handler.getErrorStats()

    expect(stats.byOperation['__proto__']).toBe(2)
    expect(stats.byOperation['constructor']).toBe(1)
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

describe('R7 HttpReporter：fetch 分支的 timeout 真正中止请求', () => {
  const originalFetch = globalThis.fetch
  const originalWx = (globalThis as { wx?: unknown }).wx

  beforeEach(() => {
    // 测试环境注入了 wx，HttpReporter 会优先走 wx.request 分支；本组用例锁定的是 fetch 分支
    delete (globalThis as { wx?: unknown }).wx
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    ;(globalThis as { wx?: unknown }).wx = originalWx
    jest.useRealTimers()
  })

  it('服务端不响应时按 timeout 中止，并报出可分类的超时原因', async () => {
    jest.useFakeTimers()
    let aborted = false
    // 挂起的 fetch：只在 signal 中止时才 settle，复现「服务端接受连接但永不响应」
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })) as unknown as typeof fetch

    const reporter = new HttpReporter('https://example.test/report', { timeout: 1000 })
    const pending = reporter.reportBatch([{ error: new Error('x') } as never])
    const assertion = expect(pending).rejects.toThrow(/timed out after 1000ms/)
    await jest.advanceTimersByTimeAsync(1000)
    await assertion

    expect(aborted).toBe(true)
  })

  it('请求先落地时清掉超时定时器，不留下悬挂句柄', async () => {
    jest.useFakeTimers()
    globalThis.fetch = (() => Promise.resolve({ ok: true, status: 200 })) as unknown as typeof fetch

    const reporter = new HttpReporter('https://example.test/report', { timeout: 60_000 })
    await reporter.reportBatch([{ error: new Error('x') } as never])

    expect(jest.getTimerCount()).toBe(0)
  })

  it('外部 signal 仍能中止请求（不被内部 signal 覆盖）', async () => {
    const controller = new AbortController()
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch

    const reporter = new HttpReporter('https://example.test/report', { timeout: 0, signal: controller.signal })
    const pending = reporter.reportBatch([{ error: new Error('x') } as never])
    controller.abort()

    await expect(pending).rejects.toThrow()
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

describe('R7 二轮复审：修复自身引入的缺陷', () => {
  const originalFetch = globalThis.fetch
  const originalWx = (globalThis as { wx?: unknown }).wx

  beforeEach(() => {
    delete (globalThis as { wx?: unknown }).wx
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    ;(globalThis as { wx?: unknown }).wx = originalWx
    jest.useRealTimers()
  })

  /**
   * 第一版修复里 `if (timeoutMs > 0)` 不挡非有限值，等于把要修的 bug 原样留下：
   * `NaN > 0` 为 false → 定时器根本不起（挂起请求永不结束）；
   * `Infinity > 0` 为 true → setTimeout 按规范钳到 1ms → 每次上报瞬间自我中止。
   */
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('fetch timeout 为 %s 时归一到默认 10s，而不是退回挂起或 1ms 自杀', async (_label, timeout) => {
    jest.useFakeTimers()
    let abortedAt: number | null = null
    globalThis.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          abortedAt = Date.now()
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        })
      })) as unknown as typeof fetch

    const reporter = new HttpReporter('https://example.test/report', { timeout: timeout as number })
    const pending = reporter.reportBatch([{ error: new Error('x') } as never])
    const assertion = expect(pending).rejects.toThrow(/timed out after 10000ms/)
    await jest.advanceTimersByTimeAsync(9999)
    // 9999ms 时还活着：Infinity 会在此刻之前就被钳到 1ms 而中止
    expect(abortedAt).toBeNull()
    await jest.advanceTimersByTimeAsync(1)
    await assertion
  })

  it('getErrorStats 的返回值仍是普通对象：hasOwnProperty 不得抛错', () => {
    const handler = new ErrorHandlerImpl()
    handler.handle('store', 'action-execution', new Error('a'))

    const stats = handler.getErrorStats()

    // 累计阶段用无原型对象挡原型链敏感键，但对外交出普通对象：
    // 返回类型是 Record<string, number>，调用方按类型写 hasOwnProperty 完全合法。
    // 下面这行断言的就是「消费方能直接这么调」——改用 Object.hasOwn / call 形式
    // 会连无原型对象一起通过，锁不住这次回归，故对规则做局部豁免
    expect(stats.byOperation.hasOwnProperty('action-execution')).toBe(true) // eslint-disable-line no-prototype-builtins -- 见上
    expect(Object.getPrototypeOf(stats.byOperation)).toBe(Object.prototype)
  })

  it('原型链敏感键的计数在返回普通对象后依然正确（展开不触发 setter）', () => {
    const handler = new ErrorHandlerImpl()
    handler.handle('store', '__proto__' as never, new Error('a'))
    handler.handle('store', '__proto__' as never, new Error('b'))

    const stats = handler.getErrorStats()

    expect(stats.byOperation['__proto__']).toBe(2)
    expect(Object.getPrototypeOf(stats.byOperation)).toBe(Object.prototype)
  })
})
