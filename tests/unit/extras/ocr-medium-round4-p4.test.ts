/**
 * OCR medium 第四轮 p4 分片（G2-extras · snapshot / selector）回归用例
 *
 * 覆盖：#304 onError 返回值按真值解释（void = 拒绝继续）与两条分岔口径、
 * #305 SnapshotResult 三条不变量（不做判别联合，改由用例锁定契约）、
 * #308 节流选择器的「首次调用」不再依赖时钟值哨兵、#314 深度护栏不再把等价子树判为变化、
 * #318 异步键枚举 catch 的中止信号不被二次咨询 onError（判定为 FP，此处补决定性锁定用例）、
 * #319 prop 占位在「本轮不会填充」的两类出口都被摘除、#320 类型判定/外壳构造抛错改走节点级降级。
 */
import { SelectorComposer } from '@/extras/selector/selectorComposer.js'
import { SKIP_CLONE_NODE, SnapshotAbortError } from '@/extras/snapshot/clone.js'
import { processNodeAsync, type AsyncCloneTask } from '@/extras/snapshot/clone-async.js'
import { SnapshotManager, createSnapshot, createSnapshotAsync } from '@/extras/snapshot/SnapshotManager.js'
import type { AsyncSnapshotOptions, CloneContext, SnapshotError, SnapshotOptions, SnapshotResult, SnapshotStats } from '@/extras/snapshot/types.js'

/**
 * 取出结果里被交付的 `data`。
 *
 * `SnapshotResult.data` 已按 R5-238 改为 `T | undefined`（三条失败来源交付的就是 undefined）。
 * 本文件多条用例的检查对象正是「交付出来的内容」（含失败时交付的半成品），
 * 所以在已断言过 success / toBeDefined 之后再经这道 narrowing 取值，
 * 而不是到处写 `data!` 或可选链——那样「本该有半成品却给了 undefined」的回归会被静默掉，
 * 这里改成抛一条写明 success/errors 现场的可读失败。
 */
function delivered<T>(result: SnapshotResult<T>): T {
  if (result.data === undefined) {
    throw new Error(`期望交付 data，实际为 undefined（success=${String(result.success)}，errors=${result.errors.length}）`)
  }
  return result.data
}

function makeContext(path = 'root'): CloneContext {
  return { path, depth: 0, parent: undefined, key: 'root', visited: new WeakMap() }
}

function makeStats(): SnapshotStats {
  return { duration: 0, cloneOperations: 0, circularReferences: 0, maxDepthHits: 0 }
}

function makeCounters(): { nodeCount: number; maxDepthReached: number; estimatedSize: number; hasCircular: boolean } {
  return { nodeCount: 0, maxDepthReached: 0, estimatedSize: 0, hasCircular: false }
}

type OnError = SnapshotOptions['onError']

function asyncOptions(onError: OnError = () => true): Required<AsyncSnapshotOptions> {
  return {
    maxDepth: 10,
    detectCircular: true,
    includeNonEnumerable: false,
    customCloner: () => undefined,
    async: true,
    batchSize: 100,
    onProgress: () => {},
    onError,
    batchInterval: 0,
    timeout: 0,
  }
}

/** 属性 getter 抛错的源对象：克隆该属性时必然进入 cloneError 降级路径 */
function throwingGetterHost(): Record<string, unknown> {
  const source: Record<string, unknown> = {}
  Object.defineProperty(source, 'boom', {
    get() {
      throw new Error('getter boom')
    },
    enumerable: true,
    configurable: true,
  })
  return source
}

/** 造一条 depth 层的嵌套链，叶子带标记值 */
function deepChain(depth: number, leaf: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf }
  for (let i = 0; i < depth; i++) {
    node = { child: node }
  }
  return node
}

describe('#304 onError 返回值按真值解释', () => {
  it('#304 回调不写 return（隐式 undefined）等同于拒绝继续：cloneError 中止整个快照', () => {
    const consulted: SnapshotError[] = []
    const result = createSnapshot(throwingGetterHost(), {
      onError: (error) => {
        consulted.push(error)
        // 只观测、不表态：箭头函数体无 return，返回值为 undefined
      },
    })

    expect(consulted).toHaveLength(1)
    expect(result.success).toBe(false)
    expect(result.data).toBeUndefined()
    // 中止信号在顶层 catch 落账为一条 unknown，其 originalError 即 SnapshotAbortError
    const top = result.errors.find((e) => e.type === 'unknown')
    expect(top?.originalError).toBeInstanceOf(SnapshotAbortError)
  })

  it('#304 同为「拒绝继续」，circular 只落占位字符串且快照仍成功（后果按错误种类分岔）', () => {
    const source: Record<string, unknown> = { n: 1 }
    source.self = source

    const result = createSnapshot(source, {
      onError: () => {
        // 隐式 undefined → 拒绝继续
      },
    })

    expect(result.success).toBe(true)
    // R5-254 起 `errors` 是完整账本：circular 先落账再咨询 onError，与相邻 maxDepth 分支同口径，
    // 于是 stats.circularReferences / metadata.hasCircular / errors 三处不再「两有一无」。
    // success 仍为 true——只有 cloneError 参与 success 判定（见 types.ts 的三条不变量）。
    expect(result.errors.map((e) => e.type)).toEqual(['circular'])
    expect(delivered(result).self).toBe('[Circular Reference]')
  })

  it('#304 显式 return true 才是「忽略并继续」：属性被丢弃但快照存活', () => {
    const result = createSnapshot(throwingGetterHost(), { onError: () => true })

    expect(result.success).toBe(false)
    expect(result.errors.some((e) => e.type === 'cloneError')).toBe(true)
    expect(result.data).toBeDefined()
    expect(delivered(result).boom).toBeUndefined()
  })
})

describe('#305 SnapshotResult 三条不变量', () => {
  it('#305 success:true 时 errors 可以非空（可恢复降级不参与 success 判定）', () => {
    const result = createSnapshot({ a: { b: { c: 1 } } }, { maxDepth: 1 })

    expect(result.success).toBe(true)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.every((e) => e.type === 'maxDepth')).toBe(true)
  })

  it('#305 success:false 时 errors 必非空（同步中止路径）', () => {
    const result = createSnapshot(throwingGetterHost(), { onError: () => false })

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('#305 success:false 时 errors 必非空（异步中止路径）', async () => {
    const result = await createSnapshotAsync(throwingGetterHost(), { onError: () => false })

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('#305 失败结果的 data 不得回传活的原始引用', () => {
    const source = throwingGetterHost()
    const result = createSnapshot(source, { onError: () => false })

    expect(result.data).not.toBe(source)
  })
})

describe('#308 节流选择器的首调用判定不依赖时钟值', () => {
  let nowSpy: jest.SpyInstance

  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now')
  })

  afterEach(() => {
    nowSpy.mockRestore()
  })

  it('#308 时钟被定为 epoch 0 时窗口内仍只计算一次（旧 0 哨兵会退化为每次重算）', () => {
    nowSpy.mockReturnValue(0)
    let calls = 0
    const selector = SelectorComposer.createThrottledSelector<{ v: number }, number>((s) => {
      calls++
      return s.v
    }, 300)

    expect(selector({ v: 1 })).toBe(1)
    expect(selector({ v: 2 })).toBe(1)
    expect(selector({ v: 3 })).toBe(1)
    expect(calls).toBe(1)

    // 仍在同一 0 起点窗口内：继续复用缓存值
    expect(selector({ v: 4 })).toBe(1)
    expect(calls).toBe(1)
  })

  it('#308 时钟从 0 起推进后按 interval 重新计算', () => {
    nowSpy.mockReturnValue(0)
    let calls = 0
    const selector = SelectorComposer.createThrottledSelector<{ v: number }, number>((s) => {
      calls++
      return s.v
    }, 300)

    expect(selector({ v: 1 })).toBe(1)
    nowSpy.mockReturnValue(299)
    expect(selector({ v: 2 })).toBe(1)
    nowSpy.mockReturnValue(300)
    expect(selector({ v: 2 })).toBe(2)
    expect(calls).toBe(2)
  })

  it('#308 interval 为 NaN 时保持「首次计算、此后复用」的既有表现', () => {
    nowSpy.mockReturnValue(1_700_000_000_000)
    let calls = 0
    const selector = SelectorComposer.createThrottledSelector<{ v: number }, number>((s) => {
      calls++
      return s.v
    }, Number.NaN)

    expect(selector({ v: 1 })).toBe(1)
    nowSpy.mockReturnValue(1_700_000_000_900)
    expect(selector({ v: 2 })).toBe(1)
    expect(calls).toBe(1)
  })
})

describe('#314 深度护栏退化为整体比较而非无条件报差异', () => {
  const manager = new SnapshotManager()

  it('#314 深过 100 层护栏但内容逐字节相同的两棵子树判为无变化', () => {
    const s1 = manager.createSnapshot(deepChain(130, 7), { maxDepth: 500 })
    const s2 = manager.createSnapshot(deepChain(130, 7), { maxDepth: 500 })

    expect(s1.success).toBe(true)
    expect(manager.compareSnapshots(s1, s2).changed).toBe(false)
  })

  it('#314 差异落在护栏之外时仍能报出（退化为 deepEqual 不漏报）', () => {
    const s1 = manager.createSnapshot(deepChain(130, 7), { maxDepth: 500 })
    const s2 = manager.createSnapshot(deepChain(130, 8), { maxDepth: 500 })
    const diff = manager.compareSnapshots(s1, s2)

    expect(diff.changed).toBe(true)
    expect(diff.changes.length).toBeGreaterThan(0)
  })

  it('#314 深链结构超过 deepEqual 默认 1000 层预算时仍按内容判定（不再二次截断）', () => {
    const s1 = manager.createSnapshot(deepChain(1200, 7), { maxDepth: 5000 })
    const s2 = manager.createSnapshot(deepChain(1200, 7), { maxDepth: 5000 })

    expect(manager.compareSnapshots(s1, s2).changed).toBe(false)
  })
})

describe('#318 异步键枚举 catch 的中止信号口径（报告判为 FP，锁定现行为）', () => {
  it('#318 ownKeys 陷阱抛出的中止信号原样上抛，且不二次咨询 onError', () => {
    const onError = jest.fn(() => true)
    const errors: SnapshotError[] = []
    const hostile = new Proxy(
      {},
      {
        ownKeys(): string[] {
          throw new SnapshotAbortError(new Error('user abort'))
        },
      },
    )
    const task: AsyncCloneTask = { value: hostile, context: makeContext() }

    expect(() => processNodeAsync(task, asyncOptions(onError), errors, makeStats(), makeCounters(), () => {})).toThrow(SnapshotAbortError)
    // 报告称该 catch「二次咨询 onError、把中止降级为静默丢子树」：实测咨询次数为 0
    expect(onError).not.toHaveBeenCalled()
    expect(errors).toHaveLength(0)
  })
})

describe('#319 prop 占位在不会填充的出口都被摘除', () => {
  it('#319 子任务抛出未预期异常时父容器的占位被删除（不再留 undefined）', async () => {
    const source: Record<string, unknown> = { name: 'x' }
    source.self = source

    const result = await createSnapshotAsync<Record<string, unknown>>(source, {
      onError: () => {
        // onError 自身抛错：异常冲出 processNodeAsync，落进驱动层的兜底 catch
        throw new Error('onError blew up')
      },
    })

    expect(result.success).toBe(false)
    expect(result.data).toBeDefined()
    expect(delivered(result).name).toBe('x')
    // 修复前：占位以 key: undefined 留在半成品里，读起来像「源数据里 self 就是 undefined」
    expect(Object.prototype.hasOwnProperty.call(delivered(result), 'self')).toBe(false)
  })

  it('#319 超时退出时未处理任务的占位不残留 undefined 值', async () => {
    const source: Record<string, { v: number }> = {}
    for (let i = 0; i < 4000; i++) {
      source[`k${i}`] = { v: i }
    }

    const result = await createSnapshotAsync(source, { timeout: 1, batchSize: 1 })

    expect(result.success).toBe(false)
    expect(result.errors.some((e) => e.type === 'timeout')).toBe(true)
    // 未填充的键（占位）全部摘除：交付的半成品里不出现值为 undefined 的键
    expect(Object.values(delivered(result)).every((v) => v !== undefined)).toBe(true)
    // 队列确有未处理任务（被超时截断），否则本用例锁不住清理逻辑
    expect(Object.keys(delivered(result)).length).toBeLessThan(4000)
  })
})

describe('#320 类型判定 / 外壳构造抛错走节点级降级', () => {
  /** getPrototypeOf 陷阱抛错：`value instanceof Date` 就会触发它 */
  function hostilePrototypeHost(): object {
    return new Proxy(
      { a: 1 },
      {
        getPrototypeOf(): never {
          throw new Error('getPrototypeOf boom')
        },
      },
    )
  }

  it('#320 单节点克隆落账 cloneError 并咨询 onError，返回丢弃哨兵', () => {
    const onError = jest.fn(() => true)
    const errors: SnapshotError[] = []
    const task: AsyncCloneTask = { value: hostilePrototypeHost(), context: makeContext() }

    const result = processNodeAsync(task, asyncOptions(onError), errors, makeStats(), makeCounters(), () => {})

    expect(result).toBe(SKIP_CLONE_NODE)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(errors).toEqual([expect.objectContaining({ type: 'cloneError', path: 'root' })])
  })

  it('#320 onError 拒绝继续时中止信号照样上抛（不被新 try 改答）', () => {
    const errors: SnapshotError[] = []
    const task: AsyncCloneTask = { value: hostilePrototypeHost(), context: makeContext() }

    expect(() =>
      processNodeAsync(
        task,
        asyncOptions(() => false),
        errors,
        makeStats(),
        makeCounters(),
        () => {},
      ),
    ).toThrow(SnapshotAbortError)
    // handleCloneError 的记账顺序：先落账 cloneError 再咨询 onError，故中止时该条已在账上
    expect(errors).toEqual([expect.objectContaining({ type: 'cloneError', path: 'root' })])
  })

  it('#320 Proxy 包装的 Date（内建方法在代理接收者上抛错）按节点降级且不留占位', async () => {
    const proxiedDate = new Proxy(new Date('2020-01-01T00:00:00.000Z'), {})
    const onError = jest.fn(() => true)

    const result = await createSnapshotAsync<Record<string, unknown>>({ d: proxiedDate, keep: { a: 1 } }, { onError })

    expect(result.success).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(result.errors.some((e) => e.type === 'cloneError' && e.path === 'root.d')).toBe(true)
    expect(delivered(result).keep).toEqual({ a: 1 })
    expect(Object.prototype.hasOwnProperty.call(delivered(result), 'd')).toBe(false)
  })
})
