/**
 * OCR medium 第四轮 p3 分片（G2-extras）回归用例
 *
 * 覆盖：#274 Headers 鸭子类型归一化、#277 extras 总入口显式再导出、#286 cloneError
 * 降级逻辑统一后的中止信号口径、#287 函数按引用入快照的既有契约、#290 版本化缓存
 * 降级为无版本时的作废与快照重建、#293 cacheSize 归一化、#299 nodeCount 同步/异步
 * 同口径、#300 进度回调抛错不污染快照结果。
 */
import { HttpReporter } from '@/extras/error/index.js'
import * as extrasIndex from '@/extras/index.js'
import { defineStateVersion } from '@/core/store/stateVersion.js'
import { createParametricSelector } from '@/extras/selector/parametricSelector.js'
import { SelectorFactory } from '@/extras/selector/createSelector.js'
import { SnapshotAbortError, cloneDeep } from '@/extras/snapshot/clone.js'
import { createSnapshot, createSnapshotAsync } from '@/extras/snapshot/SnapshotManager.js'

/** 暂存/还原全局键（用例需自还原，避免污染同文件后续用例） */
async function withHiddenHeaders(run: () => Promise<void>): Promise<void> {
  const g = globalThis as Record<string, unknown>
  const backup = g.Headers
  g.Headers = undefined
  try {
    await run()
  } finally {
    g.Headers = backup
  }
}

describe('#274 HttpReporter 请求头归一化', () => {
  it('#274 全局 Headers 缺失时的 Headers 形实例仍被展开为键值对', async () => {
    const sent: Record<string, string>[] = []
    const reporter = new HttpReporter(
      'https://example.com/report',
      {
        // 小程序运行时/跨 realm 的 Headers 实现：无全局构造器可 instanceof，只有 forEach 协议
        headers: {
          forEach(fn: (value: string, key: string) => void) {
            fn('Bearer token', 'authorization')
            fn('application/json', 'content-type')
          },
        } as any,
      },
      async (_url, _body, _method, headers) => {
        sent.push(headers)
      },
    )

    await reporter.report({ error: new Error('boom'), storeName: 's', operation: 'op', level: 'error', timestamp: 1 } as any)

    expect(sent[0]).toEqual({ authorization: 'Bearer token', 'content-type': 'application/json' })
  })

  it('#274 全局 Headers 不可见时的真实 Headers 实例不被静默丢空', async () => {
    const real = new Headers({ 'X-Trace': '1' })
    const sent: Record<string, string>[] = []
    const reporter = new HttpReporter(
      'https://example.com/report',
      { headers: real as any },
      async (_url, _body, _method, headers) => {
        sent.push(headers)
      },
    )

    await withHiddenHeaders(async () => {
      await reporter.report({ error: new Error('boom'), storeName: 's', operation: 'op', level: 'error', timestamp: 1 } as any)
    })

    expect(sent[0]).toEqual({ 'x-trace': '1' })
  })

  it('#274 数组形式优先于鸭子类型判定（数组同样具备 forEach）', async () => {
    const sent: Record<string, string>[] = []
    const reporter = new HttpReporter(
      'https://example.com/report',
      { headers: [['x-pair', 'v']] as any },
      async (_url, _body, _method, headers) => {
        sent.push(headers)
      },
    )

    await reporter.report({ error: new Error('boom'), storeName: 's', operation: 'op', level: 'error', timestamp: 1 } as any)

    expect(sent[0]).toEqual({ 'x-pair': 'v' })
  })
})

describe('#277 extras 总入口的再导出清单', () => {
  it.each([
    'createUserStore',
    'StoreManager',
    'storeManager',
    'initHotUpdate',
    'restoreFromHotUpdate',
    'OfflineManager',
    'initBackgroundSync',
    'unregisterBackgroundSync',
    'createEnterpriseApp',
  ])('#277 显式再导出后企业能力 %s 仍可达', (name) => {
    expect((extrasIndex as Record<string, unknown>)[name]).toBeDefined()
  })
})

describe('#286/#287 克隆引擎的统一降级口径', () => {
  it('#286 customCloner 抛出中止信号时原样上抛，不再被 onError 改答', () => {
    const onError = jest.fn(() => true)

    const result = createSnapshot(
      { a: 1 },
      {
        customCloner: () => {
          throw new SnapshotAbortError(new Error('deep abort'))
        },
        onError,
      },
    )

    // 中止是用户在更深层做出的决定：降级咨询会把中止改写成「静默丢子树且快照仍算成功」
    expect(onError).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
  })

  it('#286 三处 catch 共用同一 helper：属性 getter 抛错仍按 cloneError 落账并咨询 onError', () => {
    const errors = [] as any[]
    const source: Record<string, unknown> = {}
    Object.defineProperty(source, 'boom', {
      get() {
        throw new Error('getter boom')
      },
      enumerable: true,
      configurable: true,
    })
    const onError = jest.fn(() => true)

    cloneDeep(
      source,
      { path: 'root', depth: 0, parent: undefined, key: 'root', visited: new WeakMap() },
      {
        maxDepth: 10,
        detectCircular: true,
        includeNonEnumerable: false,
        customCloner: () => undefined,
        async: false,
        batchSize: 100,
        onProgress: () => {},
        onError,
      } as any,
      errors,
      { duration: 0, cloneOperations: 0, circularReferences: 0, maxDepthHits: 0 },
      { nodeCount: 0, maxDepthReached: 0, estimatedSize: 0, hasCircular: false },
    )

    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('cloneError')
    expect(errors[0].path).toBe('root.boom')
    expect(onError).toHaveBeenCalledTimes(1)
    const context = (onError.mock.calls[0] as unknown[])[1] as Record<string, unknown>
    expect(context).toMatchObject({ path: 'root.boom', recoverable: true })
  })

  it('#287 函数按引用进入快照（与 core 克隆同口径：保留可调用性，不丢弃）', async () => {
    const fn = (): number => 1
    const source = { fn }

    expect((createSnapshot(source).data as typeof source).fn).toBe(fn)
    expect((await createSnapshotAsync(source)).data).toMatchObject({ fn })
  })
})

describe('#290 参数化选择器由版本化降级为无版本', () => {
  it('#290 状态失去版本标记时作废参数缓存并重建内容快照', () => {
    const state: any = { base: 1 }
    defineStateVersion(state, () => 1)
    const compute = jest.fn((s: { base: number }, factor: number) => s.base * factor)
    const byState = createParametricSelector<typeof state, number, number>(compute)(state)

    expect(byState(2)).toBe(2)
    expect(byState(2)).toBe(2)
    expect(compute).toHaveBeenCalledTimes(1)

    // 版本标记消失（getter 被移除）：此时 cache.snapshot 是活引用，deepEqual 恒判「未变化」
    delete state[Symbol.for('geomstore.stateVersion')]
    state.base = 99

    expect(byState(2)).toBe(198)
    // 降级后回落到快照 + deepEqual 口径：未变异时命中缓存（不得每次强制重算），变异后立刻失效
    expect(byState(2)).toBe(198)
    expect(compute).toHaveBeenCalledTimes(2)

    state.base = 100
    expect(byState(2)).toBe(200)
    expect(compute).toHaveBeenCalledTimes(3)
  })
})

describe('#293 SelectorFactory cacheSize 归一化', () => {
  it('#293 cacheSize 为 0 时热缓存仍被 history 跟踪（不再 hasCache:true + cacheSize:0）', () => {
    const factory = new SelectorFactory<{ value: number }, number>((s) => s.value * 2, { cacheSize: 0 })

    expect(factory.execute({ value: 1 })).toBe(2)

    const status = factory.getCacheStatus()
    expect(status.hasCache).toBe(true)
    expect(status.cacheSize).toBe(1)
    expect(status.cacheHit?.value).toBe(2)
  })

  it('#293 cacheSize 为 NaN 时回退默认容量，history 不再无界增长', () => {
    const factory = new SelectorFactory<{ value: number }, number>((s) => s.value, { cacheSize: Number.NaN })

    for (let i = 0; i < 50; i++) {
      factory.execute({ value: i })
    }

    expect(factory.getCacheStatus().cacheSize).toBeLessThanOrEqual(10)
  })
})

describe('#299 快照 nodeCount 口径', () => {
  it('#299 超出 maxDepth 的节点在同步/异步路径下计数一致', async () => {
    const data = { a: { b: { c: 1 } } }

    const sync = createSnapshot(data, { maxDepth: 1 })
    const async = await createSnapshotAsync(data, { maxDepth: 1 })

    expect(sync.metadata.nodeCount).toBe(2)
    expect(async.metadata.nodeCount).toBe(sync.metadata.nodeCount)
  })
})

describe('#300 进度回调异常与快照结果隔离', () => {
  it('#300 onProgress 抛错时快照结果不受影响，异常仅在 errors 中留痕一次', async () => {
    const data = { a: { b: 1 }, c: [1, 2, 3] }
    let calls = 0
    const result = await createSnapshotAsync(data, {
      batchSize: 1,
      onProgress: () => {
        calls++
        throw new Error('progress boom')
      },
    })

    expect(result.success).toBe(true)
    expect(result.data).toEqual(data)
    // 首个异常后被记一次并停止调用，避免同一回调异常刷爆错误账本
    expect(calls).toBe(1)
    expect(result.errors.filter((e) => e.type === 'unknown' && e.message.includes('progress boom'))).toHaveLength(1)
  })
})
