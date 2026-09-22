/**
 * 第五轮 extras-snapshot 分片的回归锁
 *
 * 覆盖 R5-238 / R5-239 / R5-243 / R5-244 / R5-245 / R5-246 / R5-251 / R5-252 / R5-253 /
 * R5-254 / R5-255 / R5-256 / R5-257 / R5-259 / R5-260 / R5-261 / R5-262。
 */

import { HARD_MAX_CLONE_DEPTH, SKIP_CLONE_NODE, cloneDeep } from '@/extras/snapshot/clone.js'
import { processNodeAsync } from '@/extras/snapshot/clone-async.js'
import { compareSnapshots } from '@/extras/snapshot/diff.js'
import { SnapshotManager, createSnapshot, createSnapshotAsync } from '@/extras/snapshot/SnapshotManager.js'
import type { SnapshotError, SnapshotErrorContext, SnapshotMetadata, SnapshotResult } from '@/extras/snapshot/types.js'

/** 只带 diff 需要的字段：compareSnapshots 是纯函数，读 data 与两个 timestamp */
function snap<T>(data: T): SnapshotResult<T> {
  const metadata = { id: 'probe', timestamp: 0, dataType: 'object', size: 0, nodeCount: 0, maxDepth: 0, hasCircular: false } as SnapshotMetadata
  return { data, metadata, success: true, errors: [], stats: { duration: 0, cloneOperations: 0, circularReferences: 0, maxDepthHits: 0 } } as SnapshotResult<T>
}

/** 迭代造出 depth 层的嵌套链（不用递归，避免造数据自身溢出） */
function deepChain(depth: number, leaf: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf }
  for (let i = 0; i < depth; i++) node = { child: node }
  return node
}

/** ownKeys 陷阱抛错的 Proxy：键枚举阶段失败 */
function brokenOwnKeysHost(): object {
  return new Proxy(
    { a: 1 },
    {
      ownKeys() {
        throw new Error('ownKeys boom')
      },
    },
  )
}

/** n 个自有属性的宽对象：异步路径按批处理它只需 n/100 个宏任务（链式结构要 n 个） */
function wideObject(n: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (let i = 0; i < n; i++) obj[`k${i}`] = { v: i }
  return obj
}

describe('R5-238 失败结果的 data 在类型面上就允许 undefined', () => {
  it('组装失败结果不再需要 `undefined as T`，而不判空取属性是编译错误', () => {
    const failed = createSnapshot(
      { a: 1 },
      {
        customCloner: () => {
          throw new Error('cloner boom')
        },
        onError: () => {
          // onError 自身抛错 → 顶层 catch → buildFailureResult 交出 data: undefined
          throw new Error('onError boom')
        },
      },
    )

    expect(failed.success).toBe(false)
    expect(failed.data).toBeUndefined()

    // ① `undefined` 直接是合法的 data 值（此前要靠 `undefined as T` 断言把类型圆回来）
    const failure: SnapshotResult<number> = {
      data: undefined,
      metadata: failed.metadata,
      success: false,
      errors: failed.errors,
      stats: failed.stats,
    }
    expect(failure.data).toBeUndefined()

    // ② 反向锁定：data 的声明含 undefined，绕过判空取属性必须编译不过
    // （类型检查由 `tsc -p tsconfig.tests.json` 执行，ts-jest 是 transpile-only，
    //   故这里给运行期备了一个真实值，@ts-expect-error 那行仍可执行）
    const halfBuilt: SnapshotResult<Record<string, unknown>> = {
      data: { a: 1 },
      metadata: failed.metadata,
      success: false,
      errors: failed.errors,
      stats: failed.stats,
    }
    /* @ts-expect-error 未判空的 `halfBuilt.data.a`：success 为 false 时 data 可能真是 undefined */
    expect(halfBuilt.data.a).toBe(1)
  })
})

describe('R5-239 错误上下文不再有恒真的 recoverable 标记', () => {
  it('onError 收到的 context 只有 path / depth / value', () => {
    let keys: string[] = []
    const source: Record<string, unknown> = {}
    Object.defineProperty(source, 'boom', {
      get() {
        throw new Error('getter boom')
      },
      enumerable: true,
      configurable: true,
    })

    createSnapshot(source, {
      onError: (error, context: SnapshotErrorContext) => {
        keys = Object.keys(context)
        return true
      },
    })

    expect(keys).toEqual(['path', 'depth', 'value'])
  })
})

describe('R5-251/R5-252 克隆失败的节点一律丢弃并从 visited 除名', () => {
  it('同步：ownKeys 抛错时不交出空壳，同一源的兄弟引用同样被丢弃', () => {
    const hostile = brokenOwnKeysHost()
    const result = createSnapshot({ first: hostile, second: hostile, ok: 1 }, { onError: () => true })

    expect(result.success).toBe(false)
    const data = result.data as Record<string, unknown>
    // 修复前：keys 枚举的 catch 返回已登记的空壳 → data 里冒出源数据不存在的 {}，
    // 第二处引用还命中 visited 快路径拿到同一副空壳
    expect(Object.prototype.hasOwnProperty.call(data, 'first')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(data, 'second')).toBe(false)
    expect(data.ok).toBe(1)
    expect(result.errors.filter((e) => e.type === 'cloneError')).toHaveLength(2)
  })

  it('异步：ownKeys 抛错时两处引用都被丢弃，而不是留下一个空壳加一个复用壳', async () => {
    const hostile = brokenOwnKeysHost()
    const result = await createSnapshotAsync({ first: hostile, second: hostile, ok: 1 }, { onError: () => true })

    expect(result.success).toBe(false)
    const data = result.data as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(data, 'first')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(data, 'second')).toBe(false)
    expect(data.ok).toBe(1)
    expect(result.errors.filter((e) => e.type === 'cloneError')).toHaveLength(2)
  })

  it('同步：容器登记后才抛错时，半成品容器从 visited 上撤销', () => {
    class HostileMap extends Map<unknown, unknown> {}
    const source = new HostileMap([['k', 1]])
    // Map 分支先 `visited.set(value, cloned)` 再迭代；迭代器抛错即落在登记之后
    Object.defineProperty(source, Symbol.iterator, {
      get() {
        throw new Error('iterator boom')
      },
    })
    const visited = new WeakMap<object, object>()
    const errors: SnapshotError[] = []
    const stats = { duration: 0, cloneOperations: 0, circularReferences: 0, maxDepthHits: 0 }
    const counters = { nodeCount: 0, maxDepthReached: 0, estimatedSize: 0, hasCircular: false }
    const options = {
      maxDepth: 10,
      detectCircular: true,
      includeNonEnumerable: false,
      customCloner: () => undefined,
      async: false,
      batchSize: 100,
      onProgress: () => {},
      onError: () => true,
    } as never

    const dropped = cloneDeep(source, { path: 'root', depth: 0, parent: null, key: 'root', visited }, options, errors, stats, counters)

    expect(dropped).toBe(SKIP_CLONE_NODE)
    // 修复前：登记留在表上，后续对同一源的引用会静默拿到这副被丢弃的 Map
    expect(visited.has(source)).toBe(false)
  })
})

describe('R5-253/R5-254 circular 落账且不中止', () => {
  it('循环引用既进 stats 也进 errors，快照仍算成功且写占位字符串', () => {
    const source: Record<string, unknown> = { name: 'circular' }
    source.self = source

    const result = createSnapshot(source, { onError: () => false })

    expect(result.success).toBe(true)
    expect(result.errors.map((e) => e.type)).toEqual(['circular'])
    expect(result.errors[0].path).toBe('root.self')
    expect((result.data as Record<string, unknown>).self).toBe('[Circular Reference]')
  })

  it('detectCircular=false 时不落账（检测仍生效，只是不上报）', () => {
    const source: Record<string, unknown> = { name: 'circular' }
    source.self = source

    const result = createSnapshot(source, { detectCircular: false })

    expect(result.errors).toEqual([])
    expect(result.metadata.hasCircular).toBe(true)
    expect((result.data as Record<string, unknown>).self).toBe(result.data)
  })
})

describe('R5-255 Date/RegExp 计入 cloneOperations', () => {
  it('同步与异步同口径，且与容器节点一起计数', async () => {
    const manager = new SnapshotManager()
    const data = { when: new Date(0), pattern: /x/g, nested: { list: [1] } }

    const sync = manager.createSnapshot(data)
    const async = await manager.createSnapshotAsync(data)

    // root + nested + list + Date + RegExp
    expect(sync.stats.cloneOperations).toBe(5)
    expect(async.stats.cloneOperations).toBe(5)
  })
})

describe('R5-256 访问器按捕获到的 getter 取值', () => {
  it('Proxy 的 get 陷阱不参与取值：克隆的是描述符里 getter 的结果', async () => {
    const target: Record<string, unknown> = {}
    Object.defineProperty(target, 'lazy', {
      get: () => 'from-getter',
      enumerable: true,
      configurable: true,
    })
    const host = new Proxy(target, {
      get: () => 'from-get-trap',
    })

    expect((createSnapshot({ host }).data as { host: { lazy: string } }).host.lazy).toBe('from-getter')
    const async = await createSnapshotAsync({ host })
    expect((async.data as { host: { lazy: string } }).host.lazy).toBe('from-getter')
  })

  it('getter 抛错仍按该属性路径落 cloneError', () => {
    const target: Record<string, unknown> = { ok: 1 }
    Object.defineProperty(target, 'boom', {
      get() {
        throw new Error('getter boom')
      },
      enumerable: true,
      configurable: true,
    })

    const consulted: SnapshotError[] = []
    const errors: SnapshotError[] = []
    const stats = { duration: 0, cloneOperations: 0, circularReferences: 0, maxDepthHits: 0 }
    cloneDeep(
      target,
      { path: 'root', depth: 0, parent: null, key: 'root', visited: new WeakMap() },
      {
        maxDepth: 10,
        detectCircular: true,
        includeNonEnumerable: false,
        customCloner: () => undefined,
        async: false,
        batchSize: 100,
        onProgress: () => {},
        onError: (error) => {
          consulted.push(error)
          return true
        },
      } as never,
      errors,
      stats,
      { nodeCount: 0, maxDepthReached: 0, estimatedSize: 0, hasCircular: false },
    )

    expect(consulted.map((e) => ({ type: e.type, path: e.path, message: e.message }))).toEqual([
      { type: 'cloneError', path: 'root.boom', message: 'getter boom' },
    ])
    expect(errors.map((e) => e.path)).toEqual(['root.boom'])
  })
})

describe('R5-257 递归克隆有与选项无关的栈安全硬上限', () => {
  it('深过硬上限的链按 maxDepth 降级报告，而不是伪装成某层的 cloneError', () => {
    // 修复前：溢出落在递归深处的任意一帧上，被那个属性的 try 记成 cloneError，
    // 整次快照 success 被判 false（实测约 2000 层）
    const result = createSnapshot(deepChain(2500, 7), { maxDepth: Number.MAX_SAFE_INTEGER })

    expect(result.success).toBe(true)
    expect(result.errors.map((e) => e.type)).toEqual(['maxDepth'])
    expect(result.metadata.maxDepth).toBe(HARD_MAX_CLONE_DEPTH)
    expect(result.errors[0].message).toContain(`Maximum depth ${HARD_MAX_CLONE_DEPTH} exceeded`)
  })

  it('异步队列按迭代处理，不叠加硬上限（超深结构的支持方式）', () => {
    // 直接调引擎而不是跑整次异步快照：链式结构每个节点只产出 1 个子任务，
    // 队列永远一批一个节点，整趟要走 深度 × 一次 setTimeout(0) 的宏任务
    const stats = { duration: 0, cloneOperations: 0, circularReferences: 0, maxDepthHits: 0 }
    const counters = { nodeCount: 0, maxDepthReached: 0, estimatedSize: 0, hasCircular: false }
    const context = { path: 'root', depth: 1500, parent: null, key: 'root', visited: new WeakMap<object, object>() }
    const options = {
      maxDepth: 5000,
      detectCircular: true,
      includeNonEnumerable: false,
      customCloner: () => undefined,
      async: true,
      batchSize: 100,
      onProgress: () => {},
      onError: () => true,
      batchInterval: 0,
      timeout: 0,
    } as never

    const asyncNode = processNodeAsync({ value: { child: { deep: 1 } }, context }, options, [], stats, counters, () => {})
    expect(stats.maxDepthHits).toBe(0)
    expect(asyncNode).toEqual({})

    const syncNode = cloneDeep({ child: { deep: 1 } }, context, options, [], stats, counters)
    // 同一深度、同一 maxDepth：同步路径已被硬上限截断
    expect(stats.maxDepthHits).toBe(1)
    expect(syncNode).toBe('[MaxDepth Exceeded]')
  })

  it('低于硬上限的 maxDepth 仍按调用方设定生效', () => {
    const result = createSnapshot(deepChain(10, 7), { maxDepth: 3 })

    expect(result.errors.map((e) => e.type)).toEqual(['maxDepth'])
    expect(result.errors[0].message).toContain('Maximum depth 3 exceeded')
  })

  it('maxDepth 是 NaN / Infinity 时由硬上限接管，而不是取消一切上限', () => {
    // `depth > NaN` 恒为 false：NaN 若原样参与判定就等于没有上限，
    // 溢出又会落在递归深处的任意一帧上、被那个属性的 try 记成 cloneError
    for (const maxDepth of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = createSnapshot(deepChain(2500, 7), { maxDepth })

      expect(result.success).toBe(true)
      expect(result.errors.map((e) => e.type)).toEqual(['maxDepth'])
      expect(result.metadata.maxDepth).toBe(HARD_MAX_CLONE_DEPTH)
    }
  })
})

describe('R5-259 结果组装阶段的原型探针不得抛出', () => {
  it('revoked Proxy 作为快照数据时仍交付失败结果，而不是把异常抛给调用方', () => {
    const revocable = Proxy.revocable<{ a: number }>({ a: 1 }, {})
    revocable.revoke()
    const manager = new SnapshotManager()

    // Array.isArray 此前在 try 之外：它同样走 [[GetPrototypeOf]]/[[IsArray]]，
    // 对 revoked 代理抛 TypeError，而这次抛错发生在 catch 内部（组装 dataType）
    expect(() => manager.createSnapshot(revocable.proxy)).not.toThrow()
    const result = manager.createSnapshot(revocable.proxy)
    expect(result.success).toBe(false)
    expect(result.metadata.dataType).toBe('object')
  })

  it('普通数组的 dataType 仍按 array 归类', () => {
    expect(createSnapshot([1, 2]).metadata.dataType).toBe('array')
  })
})

describe('R5-260 非有限延时不得交给 setTimeout', () => {
  it('timeout: Infinity 表达「不超时」，而不是被宿主夹成一次立即超时', async () => {
    const spy = jest.spyOn(globalThis, 'setTimeout')
    const manager = new SnapshotManager()

    // 400 个节点要跑满 4 批（每批一次 setTimeout(0) 让出）：修复前 Infinity 被宿主夹到
    // 约 1ms，第一个让出点就判超时，交付的是半成品
    const result = await manager.createSnapshotAsync(wideObject(400), { timeout: Number.POSITIVE_INFINITY })

    expect(result.success).toBe(true)
    expect(result.errors.map((e) => e.type)).not.toContain('timeout')
    expect(result.metadata.nodeCount).toBe(401)
    const delays = spy.mock.calls.map((call) => call[1])
    expect(delays.some((delay) => !Number.isFinite(delay))).toBe(false)
    spy.mockRestore()
  })

  it('timeout 为 0 / 负值、batchInterval 为 NaN 时都不武装异常定时器', async () => {
    const spy = jest.spyOn(globalThis, 'setTimeout')
    const manager = new SnapshotManager()

    const zero = await manager.createSnapshotAsync(wideObject(300), { timeout: 0 })
    expect(zero.success).toBe(true)
    expect(zero.errors.map((e) => e.type)).not.toContain('timeout')

    const huge = await manager.createSnapshotAsync(wideObject(120), { batchInterval: Number.NaN, timeout: -5 })
    expect(huge.success).toBe(true)
    expect(huge.errors.map((e) => e.type)).not.toContain('timeout')
    const delays = spy.mock.calls.map((call) => call[1]).filter((delay): delay is number => typeof delay === 'number')
    expect(delays.length).toBeGreaterThan(0)
    expect(delays.every((delay) => Number.isFinite(delay) && delay >= 0)).toBe(true)
    spy.mockRestore()
  })

  it('有限正数 timeout 仍会超时并落一条 timeout 错误', async () => {
    const manager = new SnapshotManager()

    const result = await manager.createSnapshotAsync(wideObject(500), { timeout: 1, batchInterval: 20 })

    expect(result.success).toBe(false)
    expect(result.errors.map((e) => e.type)).toContain('timeout')
  })
})

describe('R5-261 失败结果交出共享 stats', () => {
  it('异步中止路径保留中止前已累加的操作数', async () => {
    const source: Record<string, unknown> = { a: { b: 1 } }
    Object.defineProperty(source, 'evil', {
      get() {
        throw new Error('getter boom')
      },
      enumerable: true,
      configurable: true,
    })
    const manager = new SnapshotManager()

    const result = await manager.createSnapshotAsync(source, { onError: () => false })

    expect(result.success).toBe(false)
    // 修复前：异步 catch 换一个全零新对象，cloneOperations 归零，
    // 同一份输入两条路径的失败统计对不上
    expect(result.stats.cloneOperations).toBeGreaterThan(0)
    expect(result.metadata.size).toBe(0)
    expect(result.metadata.nodeCount).toBe(0)
  })

  it('同步中止路径的 stats 与成功路径同口径累加', () => {
    const source: Record<string, unknown> = { a: { b: 1 } }
    Object.defineProperty(source, 'evil', {
      get() {
        throw new Error('getter boom')
      },
      enumerable: true,
      configurable: true,
    })

    const failed = new SnapshotManager().createSnapshot(source, { onError: () => false })

    expect(failed.success).toBe(false)
    expect(failed.stats.cloneOperations).toBeGreaterThan(0)
    // cloneError 由引擎落账，unknown 由 createSnapshot 的顶层 catch 补记（中止信号）
    expect(failed.errors.map((e) => e.type)).toEqual(['cloneError', 'unknown'])
  })
})

describe('R5-262 Map 键失败的路径带键身份', () => {
  /** 两个可区分的对象键（toString 决定路径里的身份标记） */
  function keyedMap(): { map: Map<unknown, number>; keys: unknown[] } {
    const keyA = { id: 'A', toString: () => 'A' }
    const keyB = { id: 'B', toString: () => 'B' }
    return {
      map: new Map<unknown, number>([
        [keyA, 1],
        [keyB, 2],
      ]),
      keys: [keyA, keyB],
    }
  }

  it('同步：同一 Map 的两个键失败时 errors 路径可区分', () => {
    const { map, keys } = keyedMap()

    const result = createSnapshot(
      { m: map },
      {
        customCloner: (value) => {
          if (keys.includes(value)) throw new Error('key boom')
          return undefined
        },
        onError: () => true,
      },
    )

    expect(result.errors.map((e) => e.path)).toEqual(['root.m.key[A]', 'root.m.key[B]'])
  })

  it('异步：与同步同一路径口径', async () => {
    const { map, keys } = keyedMap()

    const result = await createSnapshotAsync(
      { m: map },
      {
        customCloner: (value) => {
          if (keys.includes(value)) throw new Error('key boom')
          return undefined
        },
        onError: () => true,
      },
    )

    expect(result.errors.map((e) => e.path)).toEqual(['root.m.key[A]', 'root.m.key[B]'])
  })
})

describe('R5-243/R5-244/R5-245 无序配对共用一套护栏', () => {
  it('深过 deepEqual 默认预算的等价 Map 键判为同一键（不再成对误报）', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const key1 = { k: deepChain(1100, 7) }
    const key2 = { k: deepChain(1100, 7) }

    const diff = compareSnapshots(snap(new Map([[key1, 'v']])), snap(new Map([[key2, 'v']])))

    expect(diff.changes).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('配到同一键之后值仍按该键路径继续比（不漏报值差异）', () => {
    // toString 走原型：deepEqual 只比自有可枚举字符串键，实例上的 `toString: () => …`
    // 会被当成两个不同的函数属性而判不等
    class Key {
      constructor(readonly id: string) {}

      toString(): string {
        return this.id
      }
    }
    const key1 = new Key('A')
    const key2 = new Key('A')

    const diff = compareSnapshots(snap(new Map([[key1, 1]])), snap(new Map([[key2, 2]])))

    expect(diff.changes).toEqual([{ path: 'root.key[0]', oldValue: 1, newValue: 2 }])
  })

  it('结构匹配受比较次数预算约束：超预算退化为一条整体差异而非逐项增删', () => {
    // 60 个互不相同的对象：全互查要 3600 次 deepEqual，超出预算
    const set1 = new Set(Array.from({ length: 60 }, (_, i) => ({ a: i })))
    const set2 = new Set(Array.from({ length: 60 }, (_, i) => ({ b: i })))

    const diff = compareSnapshots(snap(set1), snap(set2))

    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0]).toMatchObject({ path: 'root', kind: 'changed' })
  })

  it('预算内的对象集合仍给出逐项增删', () => {
    const set1 = new Set(Array.from({ length: 20 }, (_, i) => ({ a: i })))
    const set2 = new Set(Array.from({ length: 20 }, (_, i) => ({ b: i })))

    const diff = compareSnapshots(snap(set1), snap(set2))

    expect(diff.changes).toHaveLength(40)
    expect(diff.changes.filter((c) => c.kind === 'removed')).toHaveLength(20)
    expect(diff.changes.filter((c) => c.kind === 'added')).toHaveLength(20)
  })

  it('原始值元素走引用级索引：超大集合里的一个不同值仍报成精确增删', () => {
    const values = Array.from({ length: 3000 }, (_, i) => i)
    const set1 = new Set(values)
    const set2 = new Set([...values.slice(0, 1500), 999_999, ...values.slice(1501)])

    const diff = compareSnapshots(snap(set1), snap(set2))

    expect(diff.changes.map((c) => c.kind)).toEqual(['removed', 'added'])
    expect(diff.changes[0].oldValue).toBe(1500)
    expect(diff.changes[1].newValue).toBe(999_999)
  })

  it('对象与原语混排时不对原语做结构比较', () => {
    const set1 = new Set<unknown>([{ a: 1 }, 5])
    const set2 = new Set<unknown>([{ b: 1 }, 6])

    const diff = compareSnapshots(snap(set1), snap(set2))

    expect(diff.changes.map((c) => c.kind)).toEqual(['removed', 'removed', 'added', 'added'])
  })

  it('一侧全对象、一侧全原语的大集合：逐元素报增删，不因互查规模被判为「结论不可信」', () => {
    // 旧写法的内层互查在这里要做 3000×3000 次 deepEqual（每次都只在 typeof 上失败），
    // 现在原语槽位根本不进结构候选：0 次 deepEqual，结论仍按逐项增删给出
    const objects = Array.from({ length: 3000 }, (_, i) => ({ a: i }))
    const numbers = Array.from({ length: 3000 }, (_, i) => i + 100000)

    const diff = compareSnapshots(snap(new Set<unknown>(objects)), snap(new Set<unknown>(numbers)))

    expect(diff.changes.filter((c) => c.kind === 'removed')).toHaveLength(3000)
    expect(diff.changes.filter((c) => c.kind === 'added')).toHaveLength(3000)
  })

  it('同序等价的对象集合：簿记开销不是退化的理由，仍判为无差异', () => {
    // 260 个结构等价、引用不同的元素按同一顺序排列：每个元素只需一次 deepEqual
    // （自家下标即命中，配走的格子只是 O(1) 跳过）。任何按「扫过的格数」而不是
    // 「比较次数」设限的写法都会在这里 ~200 个元素处误判超限、退化成一条整体差异，
    // 也就是把无害的簿记当成了报告要挡的规模问题
    const items = Array.from({ length: 260 }, (_, i) => ({ id: i }))

    expect(compareSnapshots(snap(new Set(items)), snap(new Set(items.map((o) => ({ ...o }))))).changed).toBe(false)
  })

  it('同规模但内容完全不同的 Map 键超限后退化为整体差异', () => {
    const m1 = new Map(Array.from({ length: 1001 }, (_, i) => [{ k: i }, i]))
    const m2 = new Map(Array.from({ length: 1001 }, (_, i) => [{ j: i }, i]))

    const diff = compareSnapshots(snap(m1), snap(m2))

    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0]).toMatchObject({ path: 'root', kind: 'changed' })
  })
})

describe('R5-246 差异判定不再随嵌套深度分岔', () => {
  class Point {
    x = 1

    y = 2
  }

  const plain = () => ({ x: 1, y: 2 })

  it('类实例与结构相同的普通对象：浅层即判为有变化', () => {
    const diff = compareSnapshots(snap({ v: new Point() }), snap({ v: plain() }))

    expect(diff.changes).toEqual([{ path: 'root.v', oldValue: expect.any(Point), newValue: plain(), kind: 'changed' }])
  })

  it('同一对值深过 100 层护栏时结论一致（都由原型判据决定）', () => {
    // 把待比较的值塞到 150 层之下：该处的判定来自深度护栏回落的 deepEqual
    const wrap = (value: unknown): Record<string, unknown> => {
      let node: Record<string, unknown> = { v: value }
      for (let i = 0; i < 150; i++) node = { next: node }
      return node
    }

    const shallow = compareSnapshots(snap({ v: new Point() }), snap({ v: plain() }))
    const deep = compareSnapshots(snap(wrap(new Point())), snap(wrap(plain())))

    expect(shallow.changed).toBe(true)
    expect(deep.changed).toBe(true)
    // 深链上只在护栏处记一条（护栏本就退化为整体比较），路径停在第 101 层附近
    expect(deep.changes).toHaveLength(1)
    expect(deep.changes[0].path.split('.')).toHaveLength(102)
    // 修复前这条链路要落到 150 层之外才被判为有变化，浅层的同一对值却判为无变化
    expect(compareSnapshots(snap(wrap(new Point())), snap(wrap(new Point()))).changed).toBe(false)
  })

  it('原型一致但一个有数组内部槽、一个没有时仍报整体差异（Array.isArray 不看原型）', () => {
    const arrayLike = Object.create(Array.prototype)

    expect(compareSnapshots(snap([1, 2]), snap(arrayLike)).changes).toEqual([{ path: 'root', oldValue: [1, 2], newValue: arrayLike, kind: 'changed' }])
    expect(compareSnapshots(snap(arrayLike), snap([1, 2])).changes).toHaveLength(1)
  })

  it('原型一致时不误报，且自有键差异仍按 added 报出', () => {
    const proto = { inherited: 1 }
    const bare = Object.create(proto)
    const withOwn = Object.create(proto)
    Object.defineProperty(withOwn, 'own', { value: 2, enumerable: true, configurable: true, writable: true })

    expect(compareSnapshots(snap(bare), snap(Object.create(proto))).changed).toBe(false)
    expect(compareSnapshots(snap(bare), snap(withOwn)).changes).toEqual([{ path: 'root.own', oldValue: undefined, newValue: 2, kind: 'added' }])
  })
})
