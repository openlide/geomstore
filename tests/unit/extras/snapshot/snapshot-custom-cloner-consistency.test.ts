/**
 * 自定义克隆器的抛错语义：同步 / 异步两条路径必须一致
 *
 * 覆盖「抛错 → 落账 cloneError → 咨询 onError → 继续则丢弃该节点（同步：跳过位置；
 * 异步：跳过填充）/ 中止则传播」的全部形态，含对象属性、数组元素、Set 项、
 * Map 键与值、以及根节点被丢弃时的占位语义。
 */

import { createSnapshot, createSnapshotAsync } from '@/extras/snapshot/index.js'

/** 触发自定义克隆器抛错的目标对象（按身份识别） */
const poison = { p: 1 }

interface PoisonedData {
  prop: unknown
  arr: unknown[]
  set: Set<unknown>
  map: Map<unknown, unknown>
}

function buildData(): PoisonedData {
  return {
    prop: poison,
    arr: [1, poison, 3],
    set: new Set<unknown>([poison, 'ok']),
    map: new Map<unknown, unknown>([
      ['dropValue', poison],
      [poison, 'dropEntry'],
      ['keep', 1],
    ]),
  }
}

function throwingCloner(value: unknown): unknown {
  if (value === poison) {
    throw new Error('custom cloner boom')
  }
  return undefined
}

const hasOwn = (target: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(target, key)

/**
 * 取「失败但仍有部分克隆」的 data（R5-238：`SnapshotResult.data` 的声明已含 undefined）。
 * 下面两条用例考察的是各容器里被丢弃的位置，前提是根节点确实产出了半成品，
 * 故在此显式排除 undefined，而不是用非空断言把判空责任糊掉
 */
function partialClone<T>(result: { data: T | undefined }): T {
  if (result.data === undefined) {
    throw new Error('预期失败结果仍带部分克隆，实际 data 为 undefined')
  }
  return result.data
}

describe('自定义克隆器抛错：两条路径语义一致', () => {
  it('同步路径：onError 允许继续时按位置丢弃被丢弃的节点', () => {
    const result = createSnapshot(buildData(), { customCloner: throwingCloner, onError: () => true })
    const cloned = partialClone(result)

    // 对象属性：不写入
    expect(hasOwn(cloned, 'prop')).toBe(false)
    // 数组：保留位置（留洞）
    expect(cloned.arr).toHaveLength(3)
    expect(1 in cloned.arr).toBe(false)
    // Set：不落 entry
    expect(cloned.set.size).toBe(1)
    expect(cloned.set.has('ok')).toBe(true)
    // Map：键或值被丢弃时整条 entry 跳过
    expect(cloned.map.size).toBe(1)
    expect(cloned.map.get('keep')).toBe(1)

    // 失败必须可见：全部落账为 cloneError，success 为 false
    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(4)
    expect(result.errors.every((error) => error.type === 'cloneError')).toBe(true)
  })

  it('异步路径：与同步路径产出完全一致的结构', async () => {
    const result = await createSnapshotAsync(buildData(), { customCloner: throwingCloner, onError: () => true })
    const cloned = partialClone(result)

    expect(hasOwn(cloned, 'prop')).toBe(false)
    expect(cloned.arr).toHaveLength(3)
    expect(1 in cloned.arr).toBe(false)
    expect(cloned.set.size).toBe(1)
    expect(cloned.set.has('ok')).toBe(true)
    expect(cloned.map.size).toBe(1)
    expect(cloned.map.get('keep')).toBe(1)

    expect(result.success).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(4)
  })

  it('根节点被丢弃时 data 为 undefined（同步）', () => {
    const result = createSnapshot(
      { a: 1 },
      {
        customCloner: () => {
          throw new Error('root boom')
        },
        onError: () => true,
      },
    )

    expect(result.data).toBeUndefined()
    expect(result.success).toBe(false)
    expect(result.errors.some((error) => error.message.includes('root boom'))).toBe(true)
  })

  it('根节点被丢弃时 data 为 undefined（异步，与同步同语义）', async () => {
    const result = await createSnapshotAsync(
      { a: 1 },
      {
        customCloner: () => {
          throw new Error('root boom')
        },
        onError: () => true,
      },
    )

    expect(result.data).toBeUndefined()
    expect(result.success).toBe(false)
  })

  it('onError 返回 false 时抛错中止，且保留原始错误信息', () => {
    const result = createSnapshot(buildData(), { customCloner: throwingCloner, onError: () => false })

    expect(result.success).toBe(false)
    // 中止信号携带原始错误消息（SnapshotAbortError 复制 cause 的 message）
    expect(result.errors.some((error) => error.message.includes('custom cloner boom'))).toBe(true)
  })

  it('onError 自身抛错时按 unknown 记录并返回空数据（不回传活引用）', () => {
    const source = { a: { b: 1 } }

    const result = createSnapshot(source, {
      customCloner: () => {
        throw new Error('cloner boom')
      },
      onError: () => {
        // 抛非 Error：覆盖外层 catch 中 `error instanceof Error` 的 false 侧
        throw 'onError boom'
      },
    })

    expect(result.success).toBe(false)
    expect(result.errors.some((error) => error.type === 'unknown' && error.message === 'Unknown error')).toBe(true)
    // 失败快照不得回传调用方的原始引用（隔离契约）：与 SKIP 降级路径同为 undefined，
    // 调用方须按 success:false 处理
    expect(result.data).toBeUndefined()
  })

  it('onError 抛非 Error 时逃逸到队列兜底记录（异步，覆盖 String(error) 侧）', async () => {
    const result = await createSnapshotAsync({ a: { b: 1 } }, {
      customCloner: () => {
        throw new Error('cloner boom')
      },
      // onError 自身抛非 Error：逃出单节点克隆，由队列的逐任务兜底 catch 记录
      onError: () => {
        throw 'queue boom'
      },
    } as any)

    expect(result.success).toBe(false)
    expect(result.errors.some((error) => String(error.message).includes('queue boom'))).toBe(true)
  })

  it('自定义克隆器命中时其结果原样进入快照（不再对命中的节点递归克隆）', () => {
    // 自定义克隆器只对「需继续按类型克隆」的节点调用（原语在 prelude 已直接返回），
    // 故此处以对象节点为命中目标
    const customCloner = (value: unknown): unknown => {
      if (value !== null && typeof value === 'object' && 'raw' in (value as Record<string, unknown>)) {
        return { replaced: true }
      }
      return undefined
    }

    const result = createSnapshot({ nested: { raw: 1 } }, { customCloner, onError: () => true })

    expect(result.data).toEqual({ nested: { replaced: true } })
    expect(result.success).toBe(true)
  })
})
