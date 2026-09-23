/**
 * 异步克隆引擎：源属性描述符查询失败时的兜底读取
 *
 * 触发要点：`Object.keys` 走的是引擎内部的 [[GetOwnProperty]]，**不会**调用 JS 的
 * `Object.getOwnPropertyDescriptor`；因此 spy 该函数只拦截「逐键循环内的那一次查询」，
 * 从而精准构造「描述符不可得」的 catch 分支（此前用 Proxy 计数陷阱会先被键枚举 catch 接走）。
 */

import { processNodeAsync } from '@/extras/snapshot/clone-async.js'

function cloneContext(path = 'root'): any {
  return { path, depth: 0, parent: undefined, key: 'root', visited: new WeakMap() }
}

function asyncCloneOptions(onError: any = () => true): any {
  return {
    maxDepth: 10,
    detectCircular: true,
    includeNonEnumerable: false,
    customCloner: () => undefined,
    async: true,
    batchSize: 100,
    batchInterval: 0,
    onProgress: () => {},
    onError,
  }
}

function cloneStats(): any {
  return { duration: 0, cloneOperations: 0, circularReferences: 0, maxDepthHits: 0 }
}

function cloneCounters(): any {
  return { nodeCount: 0, maxDepthReached: 0, estimatedSize: 0, hasCircular: false }
}

/** 让指定键的描述符查询抛错（仅影响逐键循环内的调用） */
function failDescriptorLookupFor(key: string): jest.SpyInstance {
  const original = Object.getOwnPropertyDescriptor
  return jest.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation(((target: object, propertyKey: PropertyKey) => {
    if (propertyKey === key) {
      throw new Error('descriptor lookup failed')
    }
    return original(target, propertyKey)
  }) as typeof Object.getOwnPropertyDescriptor)
}

describe('异步克隆的访问器错误载荷', () => {
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
    const task: any = { value: host, context: cloneContext() }

    processNodeAsync(
      task,
      asyncCloneOptions(() => true),
      errors,
      cloneStats(),
      cloneCounters(),
      () => {},
    )

    // getter 仅在克隆取值时触发一次：错误载荷复用已取到的描述符，不再兜底读取
    expect(getterCalls).toBe(1)
    expect(errors.some((error) => String(error.message).includes('getter boom'))).toBe(true)
  })
})

describe('异步克隆的描述符兜底', () => {
  it('描述符查询抛错时回退到 safeReadProperty 兜底读取', () => {
    const errors: any[] = []
    const spy = failDescriptorLookupFor('poison')
    const task: any = { value: { poison: 1, ok: 2 }, context: cloneContext() }

    try {
      processNodeAsync(
        task,
        asyncCloneOptions(() => true),
        errors,
        cloneStats(),
        cloneCounters(),
        () => {},
      )

      // 描述符不可得 → 该节点以兜底读取落账；其余键不受影响
      expect(errors.some((error) => String(error.message).includes('descriptor lookup failed'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })
})
