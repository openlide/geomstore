/**
 * 克隆引擎的边界：访问器属性、中止信号消息、非 Error 抛出物
 */

import { SnapshotAbortError, cloneDeep } from '@/extras/snapshot/clone.js'
import { processNodeAsync } from '@/extras/snapshot/clone-async.js'
import { createSnapshot, createSnapshotAsync } from '@/extras/snapshot/SnapshotManager.js'

function syncOptions(onError: any = () => true): any {
  return {
    maxDepth: 10,
    detectCircular: true,
    includeNonEnumerable: false,
    customCloner: () => undefined,
    async: false,
    batchSize: 100,
    onProgress: () => {},
    onError,
  }
}

function asyncOptions(onError: any = () => true): any {
  return { ...syncOptions(onError), async: true, batchInterval: 0 }
}

function makeContext(path = 'root'): any {
  return { path, depth: 0, parent: undefined, key: 'root', visited: new WeakMap() }
}

function makeStats(): any {
  return { duration: 0, cloneOperations: 0, circularReferences: 0, maxDepthHits: 0 }
}

function makeCounters(): any {
  return { nodeCount: 0, maxDepthReached: 0, estimatedSize: 0, hasCircular: false }
}

/** 构造一个「仅 setter」的访问器属性对象 */
function setterOnlyHost(): any {
  const source: any = { plain: 1 }
  Object.defineProperty(source, 'setterOnly', {
    set() {},
    enumerable: true,
    configurable: true,
  })
  return source
}

describe('中止信号与访问器属性', () => {
  it('以非 Error 构造 SnapshotAbortError 时使用兜底消息', () => {
    expect(new SnapshotAbortError('not an error').message).toBe('Snapshot aborted by onError')
  })

  it('仅 setter 的访问器属性在同步克隆中落为 undefined', () => {
    const cloned: any = cloneDeep(setterOnlyHost(), makeContext(), syncOptions(), [], makeStats(), makeCounters())

    expect(Object.prototype.hasOwnProperty.call(cloned, 'setterOnly')).toBe(true)
    expect(cloned.setterOnly).toBeUndefined()
  })

  it('仅 setter 的访问器属性在异步克隆中落为 undefined', () => {
    const task: any = { value: setterOnlyHost(), context: makeContext() }
    const cloned: any = processNodeAsync(task, asyncOptions(), [], makeStats(), makeCounters(), () => {})

    expect(cloned.setterOnly).toBeUndefined()
  })

  it('访问器返回对象时异步克隆经占位+描述符还原填充', () => {
    const source: any = {}
    const payload = { deep: 1 }
    Object.defineProperty(source, 'lazy', {
      get: () => payload,
      enumerable: true,
      configurable: true,
    })
    const enqueued: any[] = []
    const task: any = { value: source, context: makeContext() }

    const cloned: any = processNodeAsync(task, asyncOptions(), [], makeStats(), makeCounters(), (t) => enqueued.push(t))

    expect(enqueued).toHaveLength(1)
    expect(cloned.lazy).toBeUndefined()
  })
})

/** 让指定键的描述符查询抛错（仅影响逐键循环内的调用：Object.keys 走引擎内部方法，不经此函数） */
function failDescriptorLookupFor(key: string): jest.SpyInstance {
  const original = Object.getOwnPropertyDescriptor
  return jest.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation(((target: object, propertyKey: PropertyKey) => {
    if (propertyKey === key) {
      throw new Error('descriptor lookup failed')
    }
    return original(target, propertyKey)
  }) as typeof Object.getOwnPropertyDescriptor)
}

describe('描述符查询失败的兜底', () => {
  it('描述符不可得时回退到 safeReadProperty 兜底读取（同步）', () => {
    const errors: any[] = []
    const spy = failDescriptorLookupFor('poison')

    try {
      const cloned: any = cloneDeep({ poison: 1, ok: 2 }, makeContext(), syncOptions(), errors, makeStats(), makeCounters())

      // 该属性描述符不可得 → 走兜底读取仍写入快照，且错误落账
      expect(cloned.ok).toBe(2)
      expect(errors.some((error) => String(error.message).includes('descriptor lookup failed'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('访问器 getter 抛错时的错误载荷', () => {
  it('访问器描述符下不二次触发 getter（走 descriptor 判定而非兜底读取）', () => {
    const errors: any[] = []
    let getterCalls = 0
    const host: any = {}
    Object.defineProperty(host, 'boom', {
      get() {
        getterCalls += 1
        throw new Error('getter boom')
      },
      enumerable: true,
      configurable: true,
    })

    cloneDeep(host, makeContext(), syncOptions(), errors, makeStats(), makeCounters())

    // getter 仅在克隆取值时触发一次：错误载荷复用已取到的描述符，不再兜底读取
    expect(getterCalls).toBe(1)
    expect(errors.some((error) => String(error.message).includes('getter boom'))).toBe(true)
  })
})

describe('自定义克隆器的非 Error 抛出物', () => {
  it('customCloner 抛错时同步引擎落账并返回丢弃哨兵（不再让原始异常冲出克隆过程）', () => {
    const errors: any[] = []
    const options = syncOptions(() => true)
    options.customCloner = () => {
      throw 'string boom'
    }

    const cloned = cloneDeep({ a: 1 }, makeContext(), options, errors, makeStats(), makeCounters())

    // 与异步路径同语义：错误必须落账（不可静默丢弃），节点以内部哨兵标记丢弃
    expect(errors).toHaveLength(1)
    expect(errors[0].type).toBe('cloneError')
    expect(typeof cloned).toBe('symbol')
  })

  it('customCloner 抛错且 onError 拒绝时抛 SnapshotAbortError（同步）', () => {
    const options = syncOptions(() => false)
    options.customCloner = () => {
      throw 'string boom'
    }

    expect(() => cloneDeep({ a: 1 }, makeContext(), options, [], makeStats(), makeCounters())).toThrow(SnapshotAbortError)
  })

  it('customCloner 抛字符串时异步快照落账且不抛出（非 Error 抛出物按兜底文案记录）', async () => {
    const result = await createSnapshotAsync({ a: { b: 1 } }, {
      customCloner: (() => {
        throw 'oops'
      }) as any,
      onError: () => true,
    } as any)

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].message).toBeDefined()
  })

  it('同步快照门面同样把非 Error 抛出物转为失败结果', () => {
    const result = createSnapshot({ a: { b: 1 } }, {
      customCloner: (() => {
        throw 'sync oops'
      }) as any,
      onError: () => true,
    } as any)

    expect(result.success).toBe(false)
  })
})
