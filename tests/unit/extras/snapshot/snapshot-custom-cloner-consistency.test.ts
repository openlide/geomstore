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

describe('自定义克隆器抛错：两条路径语义一致', () => {
  it('同步路径：onError 允许继续时按位置丢弃被丢弃的节点', () => {
    const result = createSnapshot(buildData(), { customCloner: throwingCloner, onError: () => true })
    const cloned = result.data

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
    const cloned = result.data

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

  it('onError 自身抛错时按 unknown 记录并兜底返回原始入参（含非 Error 抛出物）', () => {
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
    // 兜底路径返回原始入参（不做隔离降级承诺）
    expect(result.data).toEqual(source)
  })

  it('onError 抛非 Error 时逃逸到队列兜底记录（异步，覆盖 String(error) 侧）', async () => {
    const result = await createSnapshotAsync(
      { a: { b: 1 } },
      {
        customCloner: () => {
          throw new Error('cloner boom')
        },
        // onError 自身抛非 Error：逃出单节点克隆，由队列的逐任务兜底 catch 记录
        onError: () => {
          throw 'queue boom'
        },
      } as any,
    )

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
