/**
 * 快照克隆的容错与中止信号传播
 *
 * 针对引擎内部三条防御路径（此前仅被间接覆盖）直接调用克隆引擎：
 * - safeReadProperty：getter 抛错时不得二次触发读取
 * - 同步/异步克隆中「中止信号必须上抛」，不得被 onError 二次降级或静默吞掉
 * - 异步队列单点填充失败只降级记错误，不中断整个队列
 */
import { SnapshotAbortError, cloneDeep, safeReadProperty } from '@/extras/snapshot/clone.js'
import { processNodeAsync, type AsyncCloneTask } from '@/extras/snapshot/clone-async.js'
import { createSnapshotAsync } from '@/extras/snapshot/SnapshotManager.js'
import type { AsyncSnapshotOptions, CloneContext, SnapshotError, SnapshotOptions, SnapshotStats } from '@/extras/snapshot/types.js'

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

function syncOptions(onError: OnError = () => true): Required<SnapshotOptions> {
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

function asyncOptions(onError: OnError = () => true): Required<AsyncSnapshotOptions> {
  return { ...syncOptions(onError), async: true, batchInterval: 0, timeout: 0 }
}

/** 构造一个在枚举自有键时抛出中止信号的宿主 */
function abortingOwnKeysHost(): object {
  return new Proxy(
    {},
    {
      ownKeys(): string[] {
        throw new SnapshotAbortError(new Error('user abort'))
      },
    },
  )
}

/** 构造一个属性 getter 抛错的源对象 */
function throwingGetterHost(): object {
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

describe('extras/snapshot 容错与中止传播', () => {
  describe('safeReadProperty', () => {
    it('属性 getter 抛错时返回 undefined（catch 载荷组装不得二次触发 getter）', () => {
      expect(safeReadProperty(throwingGetterHost() as Record<string, unknown>, 'boom')).toBeUndefined()
    })

    it('正常属性按值返回', () => {
      expect(safeReadProperty({ ok: 1 }, 'ok')).toBe(1)
    })

    it('不存在的属性返回 undefined', () => {
      expect(safeReadProperty({}, 'missing')).toBeUndefined()
    })
  })

  describe('同步克隆', () => {
    it('ownKeys 陷阱抛出 SnapshotAbortError 时原样上抛（不被 onError 改答）', () => {
      const errors: SnapshotError[] = []

      expect(() => cloneDeep(abortingOwnKeysHost(), makeContext(), syncOptions(), errors, makeStats(), makeCounters())).toThrow(
        SnapshotAbortError,
      )
      expect(errors).toHaveLength(0)
    })

    it('属性 getter 抛错、onError 返回 false 时抛出 SnapshotAbortError', () => {
      expect(() => cloneDeep(throwingGetterHost(), makeContext(), syncOptions(() => false), [], makeStats(), makeCounters())).toThrow(
        SnapshotAbortError,
      )
    })

    it('属性 getter 抛错、onError 允许继续时降级记录错误', () => {
      const errors: SnapshotError[] = []
      const result = cloneDeep(throwingGetterHost(), makeContext(), syncOptions(() => true), errors, makeStats(), makeCounters())

      expect(result).toBeDefined()
      expect(errors).toHaveLength(1)
      expect(errors[0].type).toBe('cloneError')
    })
  })

  describe('异步单节点克隆', () => {
    it('属性 getter 抛出 SnapshotAbortError 时原样上抛（中止信号不被兜底吞掉）', () => {
      const source: Record<string, unknown> = {}
      Object.defineProperty(source, 'boom', {
        get() {
          throw new SnapshotAbortError(new Error('user abort'))
        },
        enumerable: true,
        configurable: true,
      })
      const task: AsyncCloneTask = { value: source, context: makeContext() }

      expect(() => processNodeAsync(task, asyncOptions(), [], makeStats(), makeCounters(), () => {})).toThrow(SnapshotAbortError)
    })

    it('ownKeys 陷阱抛错时降级为记录错误并继续（异步键枚举路径不识别中止信号）', () => {
      const errors: SnapshotError[] = []
      const task: AsyncCloneTask = { value: abortingOwnKeysHost(), context: makeContext() }

      const result = processNodeAsync(task, asyncOptions(), errors, makeStats(), makeCounters(), () => {})

      expect(result).toBeDefined()
      expect(errors).toHaveLength(1)
      expect(errors[0].type).toBe('cloneError')
    })

    it('属性 getter 抛错、onError 返回 false 时抛出 SnapshotAbortError', () => {
      const task: AsyncCloneTask = { value: throwingGetterHost(), context: makeContext() }

      expect(() => processNodeAsync(task, asyncOptions(() => false), [], makeStats(), makeCounters(), () => {})).toThrow(SnapshotAbortError)
    })

    it('属性 getter 抛错、onError 允许继续时降级记录错误', () => {
      const errors: SnapshotError[] = []
      const task: AsyncCloneTask = { value: throwingGetterHost(), context: makeContext() }

      processNodeAsync(task, asyncOptions(() => true), errors, makeStats(), makeCounters(), () => {})

      expect(errors).toHaveLength(1)
      expect(errors[0].type).toBe('cloneError')
    })

    it('对象子值入队而非同步克隆（保证单节点工作量有界）', () => {
      const enqueued: AsyncCloneTask[] = []
      const task: AsyncCloneTask = { value: { nested: { deep: 1 } }, context: makeContext() }

      processNodeAsync(task, asyncOptions(), [], makeStats(), makeCounters(), (t) => enqueued.push(t))

      expect(enqueued).toHaveLength(1)
      expect(enqueued[0].target?.kind).toBe('prop')
    })
  })

  describe('异步队列单点填充失败', () => {
    it('填充抛错时只记录错误、不中断队列也不抛出', async () => {
      const original = Object.defineProperty
      const spy = jest.spyOn(Object, 'defineProperty').mockImplementation(((
        target: object,
        key: PropertyKey,
        attrs: PropertyDescriptor,
      ) => {
        // 占位写入的 value 为 undefined；填充写入携带真实克隆结果，据此区分二者
        if (key === 'poison' && attrs?.value !== undefined) {
          throw new Error('fill boom')
        }
        return original(target, key, attrs)
      }) as typeof Object.defineProperty)

      try {
        const result = await createSnapshotAsync({ poison: { deep: 1 }, ok: 2 })

        expect(result.errors.some((e) => e.message.includes('Failed to fill cloned value'))).toBe(true)
        expect(result.data).toBeDefined()
      } finally {
        spy.mockRestore()
      }
    })
  })
})
