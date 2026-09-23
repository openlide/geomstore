/**
 * 第六轮 f1-08 分片的回归锁（快照 diff / SnapshotManager）
 *
 * 覆盖 R6-050（compareSnapshots 的输入可信性）、R6-051（队列压缩的摊还口径）、
 * R6-052（超时只在交付不完整时成立）、R6-101（Map 条目路径按键身份生成）、
 * R6-102（定时器句柄按 null 比较）。
 */

import { compareSnapshots } from '@/extras/snapshot/diff.js'
import { SnapshotManager } from '@/extras/snapshot/SnapshotManager.js'
import type { SnapshotMetadata, SnapshotResult } from '@/extras/snapshot/types.js'

/** 按 success 造一份快照结果：diff 的可信性闸门读的就是这个字段 */
function resultWith<T>(data: T, success: boolean): SnapshotResult<T> {
  const metadata = { id: 'probe', timestamp: 0, dataType: 'object', size: 0, nodeCount: 0, maxDepth: 0, hasCircular: false } as SnapshotMetadata
  return {
    data,
    metadata,
    success,
    errors: success ? [] : [{ type: 'timeout', message: 'probe', path: 'root' }],
    stats: { duration: 0, cloneOperations: 0, circularReferences: 0, maxDepthHits: 0 },
  } as SnapshotResult<T>
}

/** 只带 diff 需要字段的「可信」快照 */
function snap<T>(data: T): SnapshotResult<T> {
  return resultWith(data, true)
}

/** 把 changes 压成 `kind@path` 串，让断言一次看全「哪类事实落在哪条路径」 */
function tag(diff: { changes: Array<{ path: string; kind?: string }> }): string[] {
  return diff.changes.map((c) => `${c.kind ?? 'changed'}@${c.path}`)
}

describe('R6-050 compareSnapshots 的输入可信性闸门', () => {
  it('两份都失败的快照不再被报成「两次快照无差异」', () => {
    // 修复前：data 同为 undefined → compare 走 obj1 === obj2 短路 → changed: false，
    // 据此做回滚判定/去重的调用方会跳过回滚
    const failed = resultWith(undefined, false)
    const diff = compareSnapshots(failed, failed)

    expect(diff.inputTrusted).toBe(false)
    expect(diff.changed).toBe(true)
    expect(diff.changes).toEqual([{ path: 'root', oldValue: undefined, newValue: undefined, kind: 'changed' }])
  })

  it('两份超时半成品之间的真实差异不再被静默漏报', () => {
    // 超时交付的部分构建壳：未填充的 prop 占位已被摘掉，两侧都不存在的键上
    // 逐路径比较什么也报不出来，而它们其实对应不同的源数据
    const shell1 = resultWith({ kept: 1 }, false)
    const shell2 = resultWith({ kept: 2 }, false)
    const diff = compareSnapshots(shell1, shell2)

    expect(diff.inputTrusted).toBe(false)
    // root 级整体差异只记一条，不按不可信的子路径展开
    expect(diff.changes).toHaveLength(1)
    expect(diff.changes[0].path).toBe('root')
  })

  it('只有一侧失败同样标记为不可信', () => {
    const diff = compareSnapshots(snap({ a: 1 }), resultWith({ a: 1 }, false))
    expect(diff.inputTrusted).toBe(false)
    expect(diff.changed).toBe(true)
  })

  it('两侧都可信时结论与改动前一致（不加闸门外的噪声）', () => {
    const same = compareSnapshots(snap({ a: 1, b: { c: [1, 2] } }), snap({ a: 1, b: { c: [1, 2] } }))
    expect(same.inputTrusted).toBe(true)
    expect(same.changed).toBe(false)
    expect(same.changes).toEqual([])

    const different = compareSnapshots(snap({ a: 1 }), snap({ a: 2 }))
    expect(different.inputTrusted).toBe(true)
    expect(different.changed).toBe(true)
    expect(tag(different)).toEqual(['changed@root.a'])
  })

  it('成功快照的 data 本身是 undefined 时仍算可信（闸门只看 success）', () => {
    const diff = compareSnapshots(snap(undefined), snap(undefined))
    expect(diff.inputTrusted).toBe(true)
    expect(diff.changed).toBe(false)
  })

  it('manager 实例方法与导出的纯函数同口径', () => {
    const manager = new SnapshotManager()
    const failed = resultWith(undefined, false)
    expect(manager.compareSnapshots(failed, failed).inputTrusted).toBe(false)
  })
})

describe('R6-101 Map 条目路径按键身份生成，并与克隆引擎同一套方言', () => {
  it('值差异 / 键删除 / 键新增三类事实落在三种不同形状上', () => {
    const map1 = new Map([
      ['a', 1],
      ['b', 2],
    ])
    const map2 = new Map([
      ['a', 9],
      ['c', 2],
    ])

    expect(tag(compareSnapshots(snap(map1), snap(map2))).sort()).toEqual(['added@root.key[c]', 'changed@root[a]', 'removed@root.key[b]'].sort())
  })

  it('逻辑键的路径不随插入位置漂移（旧写法按迭代下标，插一个键就全体改道）', () => {
    const map1 = new Map([
      ['x', 1],
      ['y', 1],
    ])
    const map2 = new Map([
      ['w', 0],
      ['x', 2],
    ])

    // x 在 map1 是 0 号、在 map2 是 1 号：旧写法两侧给出 root.key[0] 与 root.key[1]，
    // 同一个逻辑键在两份报告里换了身份；新写法一律 root[x]
    expect(tag(compareSnapshots(snap(map1), snap(map2))).sort()).toEqual(['added@root.key[w]', 'changed@root[x]', 'removed@root.key[y]'].sort())

    // 同一对键值在两个调用方向上必须给出同一条路径：旧写法按下标取自 map1，
    // 换个方向传参 root.key[0] 就变成 root.key[1]，按 path 聚合的消费方接不上
    const forward = new Map([
      ['x', 2],
      ['w', 0],
    ])
    const backward = new Map([
      ['w', 0],
      ['x', 3],
    ])
    expect(compareSnapshots(snap(forward), snap(backward)).changes.map((c) => c.path)).toEqual(['root[x]'])
    expect(compareSnapshots(snap(backward), snap(forward)).changes.map((c) => c.path)).toEqual(['root[x]'])
  })

  it('嵌套值的子路径沿用克隆引擎的形状（root[k].prop，不再是 root.key[i].prop）', () => {
    const map1 = new Map([['a', { deep: { v: 1 } }]])
    const map2 = new Map([['a', { deep: { v: 2 } }]])
    expect(tag(compareSnapshots(snap(map1), snap(map2)))).toEqual(['changed@root[a].deep.v'])
  })

  it('diff 给条目记的路径与克隆引擎给同一条目记下的 errors[].path 逐字相同', () => {
    const manager = new SnapshotManager()
    const poison = { doomed: true }
    const cloned = manager.createSnapshot(new Map([['a', poison]]), {
      customCloner: (value) => {
        if (value === poison) throw new Error('cloner boom')
        return undefined
      },
    })
    expect(cloned.success).toBe(false)
    expect(cloned.errors.map((e) => e.path)).toEqual(['root[a]'])

    // 同一位置的值差异在 diff 侧就是这个串（旧写法是 root.key[0]，与 errors 对不上）
    const diff = compareSnapshots(snap(new Map([['a', 1]])), snap(new Map([['a', 2]])))
    expect(diff.changes.map((c) => c.path)).toEqual(['root[a]'])

    // 值节点继续往下展开时沿用同一条前缀：root[a].doomed
    const nested = compareSnapshots(snap(new Map([['a', { doomed: true }]])), snap(new Map([['a', { doomed: false }]])))
    expect(nested.changes.map((c) => c.path)).toEqual(['root[a].doomed'])
  })

  it('Symbol 键与自定义 toString 的键都有可读路径，抛错键不再让整个 diff 失败', () => {
    const sym = Symbol('tag')
    const diff = compareSnapshots(snap(new Map([[sym, 1]])), snap(new Map([[sym, 2]])))
    expect(diff.changes.map((c) => c.path)).toEqual(['root[Symbol(tag)]'])

    const hostile = {
      toString(): string {
        throw new Error('no toString for you')
      },
    }
    const hostileDiff = compareSnapshots(snap(new Map([[hostile, 1]])), snap(new Map([[hostile, 2]])))
    expect(hostileDiff.changes.map((c) => c.path)).toEqual(['root[<unstringifiable key>]'])
  })

  it('Set 的增删条目仍按本侧下标记路径，条目身份由 oldValue/newValue 承载', () => {
    const set1 = new Set([{ id: 'a' }, { id: 'b' }])
    const set2 = new Set([{ id: 'a' }, { id: 'c' }])
    const diff = compareSnapshots(snap(set1), snap(set2))

    expect(tag(diff).sort()).toEqual(['added@root[added:1]', 'removed@root[removed:1]'].sort())
    const removed = diff.changes.find((c) => c.kind === 'removed')
    const added = diff.changes.find((c) => c.kind === 'added')
    expect(removed?.oldValue).toEqual({ id: 'b' })
    expect(added?.newValue).toEqual({ id: 'c' })
  })
})

describe('R6-051 队列压缩按摊还口径执行，而不是每批搬移整个尾部', () => {
  /** 只统计「被裁的是任务数组」的 splice，避免把被测代码之外的搬移算进来 */
  function watchQueueSplices(): { calls: () => number; moved: () => number; restore: () => void } {
    const original = Array.prototype.splice
    let calls = 0
    let moved = 0
    // 被裁的那批走的是 ARRAY_MUTATING_METHODS 里的 'splice'（StateProxy 的数组变更白名单），
    // 调用点固定是 SnapshotManager 队列压缩那句 `queue.splice(0, queueHead)`：
    // 故形参按 splice 的 [start, deleteCount, ...items] 元组声明，原样转发给原生实现，
    // 不再拿 `as []` 这个空元组去糊 apply 的形参检查
    Array.prototype.splice = function (this: unknown[], ...args: [start: number, deleteCount: number, ...items: unknown[]]) {
      const first = (this as unknown[])[0] as { context?: { path?: unknown } } | undefined
      if (first && typeof first.context?.path === 'string') {
        calls++
        moved += Math.max(0, (this as unknown[]).length - Number(args[1] ?? 0))
      }
      return original.apply(this, args)
    } as typeof Array.prototype.splice
    return {
      calls: () => calls,
      moved: () => moved,
      restore: () => {
        Array.prototype.splice = original
      },
    }
  }

  it('2001 个任务、批大小 20 时总搬移量是线性而不是 O(n²/b)', async () => {
    const manager = new SnapshotManager()
    const source: Record<string, { v: number }> = {}
    for (let i = 0; i < 2000; i++) source[`k${i}`] = { v: i }

    const watch = watchQueueSplices()
    try {
      const result = await manager.createSnapshotAsync(source, { batchSize: 20, timeout: 0 })
      // root + 2000 个内层对象（原语不入队、不计数）
      expect(result.success).toBe(true)
      expect(result.metadata.nodeCount).toBe(2001)
      // 压缩确实发生了（否则「从不裁剪」也能过这条），但次数远低于批次数（~101 批）
      expect(watch.calls()).toBeGreaterThan(0)
      expect(watch.calls()).toBeLessThan(40)
      // 修复前：每批裁一次，总搬移 ≈ n²/(2b) ≈ 10 万次；摊还后与 n 同量级
      expect(watch.moved()).toBeLessThan(2001 * 10)
    } finally {
      watch.restore()
    }
  })

  it('压缩改变占位清理的起点后，超时交付的半成品里依然不留源数据没有的 undefined 键', async () => {
    const manager = new SnapshotManager()
    const source: Record<string, { deep: { v: number } }> = {}
    for (let i = 0; i < 500; i++) source[`k${i}`] = { deep: { v: i } }

    const result = await manager.createSnapshotAsync(source, { batchSize: 4, timeout: 1, batchInterval: 1 })
    expect(result.success).toBe(false)
    const data = result.data as Record<string, { deep?: { v: number } }>
    // 队列里被裁掉的那段永远轮不到填充：对应 prop 必须整个缺失而不是留成 undefined
    for (const key of Object.keys(data)) {
      const node = data[key]
      if (Object.prototype.hasOwnProperty.call(node, 'deep')) {
        expect(node.deep).not.toBeUndefined()
      }
    }
  })
})

describe('R6-052 / R6-102 超时状态机与定时器句柄', () => {
  const TIMEOUT_PROBE_MS = 7

  /**
   * 把「超时定时器」换成可手动翻位的回调，把「批间让出」的 setTimeout 换成
   * 真实 0 延时定时器，并在第 fireOnYield 次让出前先翻一次超时标志——
   * 用来复现「队列已排空后定时器才翻位」这个收尾竞态（延时的具体数值不重要，
   * 只用来把超时定时器与批间让出区分开）
   */
  function armManualTimeout(fireOnYield: number): { firedAt: () => number; restore: () => void } {
    const realSetTimeout = globalThis.setTimeout
    let timeoutCallback: (() => void) | null = null
    let yields = 0
    let firedAt = 0
    const spy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: (...args: unknown[]) => void, delay?: number) => {
      if (delay === TIMEOUT_PROBE_MS) {
        timeoutCallback = callback
        // 句柄刻意返回 0：宿主/注入式时钟可以给出 0，真值判定会让 clearTimeout 永不执行
        return 0 as unknown as ReturnType<typeof setTimeout>
      }
      return realSetTimeout(() => {
        yields++
        if (yields === fireOnYield) {
          timeoutCallback?.()
          timeoutCallback = null
          firedAt = yields
        }
        callback()
      }, 0)
    }) as unknown as typeof setTimeout)
    return {
      firedAt: () => firedAt,
      restore: () => spy.mockRestore(),
    }
  }

  it('队列已排空后定时器才翻位：完好克隆仍判成功，不落 timeout 错误', async () => {
    const manager = new SnapshotManager()
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout')
    // 默认批大小 100：第 1 批是 root（同时入队 b 的子任务），第 2 批把它填完 → 队列排空，
    // 于是「让出 #2」正是收尾竞态发生的位置
    const probe = armManualTimeout(2)
    try {
      const result = await manager.createSnapshotAsync({ a: 1, b: { c: 2 } }, { timeout: TIMEOUT_PROBE_MS })

      // 超时标志确实在收尾那次让出处翻了位（旧口径 success: !hasTimedOut 在此必判 false）
      expect(probe.firedAt()).toBe(2)
      expect(result.success).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.data).toEqual({ a: 1, b: { c: 2 } })
      // R6-102：句柄为 0 也必须撤销定时器（旧写法 if (timeoutId) 直接跳过）
      expect(clearSpy).toHaveBeenCalledWith(0)
    } finally {
      clearSpy.mockRestore()
      probe.restore()
    }
  })

  it('超时确实留下未处理任务时仍按失败交付（收尾判定没被放宽成永不为真）', async () => {
    const manager = new SnapshotManager()
    const source: Record<string, { deep: { v: number } }> = {}
    for (let i = 0; i < 300; i++) source[`k${i}`] = { deep: { v: i } }

    // 让出 #1 就翻位：此刻 300 个子任务仍在队列里，交付的是半成品
    const probe = armManualTimeout(1)
    try {
      const result = await manager.createSnapshotAsync(source, { timeout: TIMEOUT_PROBE_MS, batchSize: 2 })
      expect(result.success).toBe(false)
      expect(result.errors.map((e) => e.type)).toContain('timeout')
    } finally {
      probe.restore()
    }
  })
})
