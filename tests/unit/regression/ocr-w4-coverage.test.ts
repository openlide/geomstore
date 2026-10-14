/**
 * W4 P2 修复引入的分支的补测：把 diff.ts / async-core.ts / PerformanceMonitor.ts
 * 新增分支的语句/行覆盖率拉回 98% 门槛。
 *
 * 与旧回归测试分开的原因：这些用例是「新分支本身」的最小验证，不承担缺陷重现；
 * 混合进旧文件会让「回归 → 修复」的映射变糊。
 *
 * @file tests/unit/regression/ocr-w4-coverage.test.ts
 */

import { compareSnapshots, SnapshotManager } from '@/extras/snapshot.js'
import { retryWithBackoff } from '@/extras/action/async-core.js'
import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor.js'

const mgr = new SnapshotManager()
const snap = <T>(v: T) => mgr.createSnapshot(v)

describe('W4 diff.ts: 装箱原始值在深度护栏内的内容判等', () => {
  /**
   * 深度护栏 (`MAX_COMPARE_DEPTH = 100`) 之外的槽位内建值此前一律走引用判：
   * `new Number(1)` 与另一份 `new Number(1)` 引用不同即判 changed，与浅层走
   * deepEqual 内容比对口径相反。W4-3 修完后两者同口径。
   *
   * 快照克隆对 slot-bearing 内建保留原引用，因此这里必须每次新建装箱值。
   * **关键**：装箱值本身要落到 `depth > MAX_COMPARE_DEPTH` 的那一次 `compare` 调用里
   * 才走 `isSlotBearingBuiltin` 分支——不能藏在普通 `{lvl, child}` 容器里，
   * 因为那种情形下容器判 `isSlotBearingBuiltin` 为 false，走的是外层 deepEqual 兜底
   */
  function nestToDepth(inner: unknown, depth: number): unknown {
    let node: any = inner
    for (let i = 0; i < depth; i++) {
      node = { [`k${i}`]: node }
    }
    return node
  }

  it('两个内容相同的 new Number 在深护栏内不判为 changed（走 new 内容比分支）', () => {
    // 装箱值放在深度 105：compare 递归到该节点时 depth 已 > MAX_COMPARE_DEPTH
    const a = snap(nestToDepth(new Number(1), 105))
    const b = snap(nestToDepth(new Number(1), 105))
    const diff = compareSnapshots(a, b)
    // 此前深度护栏内一律走引用判，`new Number(1)` ≠ `new Number(1)`（引用）⇒ changed: true 假阳
    // 修完后走内容比对 ⇒ changed: false
    expect(diff.changed).toBe(false)
  })

  it('两个内容相同的 new String 深护栏内不判 changed', () => {
    const a = snap(nestToDepth(new String('hello'), 105))
    const b = snap(nestToDepth(new String('hello'), 105))
    expect(compareSnapshots(a, b).changed).toBe(false)
  })

  it('两个内容相同的装箱 BigInt 深护栏内不判 changed', () => {
    const a = snap(nestToDepth(Object(10n), 105))
    const b = snap(nestToDepth(Object(10n), 105))
    expect(compareSnapshots(a, b).changed).toBe(false)
  })

  it('装箱非 primitive 走引用判分岔（覆盖 else 分支）', () => {
    // WeakMap 是 slot-bearing 但不是装箱原始值；深护栏内走 obj1 === obj2 分支
    const wm = new WeakMap()
    const a = snap(nestToDepth(wm, 105))
    const b = snap(nestToDepth(wm, 105))
    // 同一个引用：两侧 leaf 都是 wm，走 obj1 === obj2 → 相等
    expect(compareSnapshots(a, b).changed).toBe(false)
  })
})

describe('W4 async-core.ts: shouldRetry 抛非 Error 时兜底保根因', () => {
  it('shouldRetry 抛字符串时不吞掉原始 error（走 console.error 分支）', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const originalError = new Error('primary failure')
    await expect(
      retryWithBackoff(() => Promise.reject(originalError), {
        retries: 2,
        baseDelay: 1,
        maxDelay: 2,
        shouldRetry: () => {
          throw 'boom'
        },
      }),
    ).rejects.toBe('boom')
    // 归口：非 Error 顶替时把原 error 走 console.error 兜住
    expect(consoleErrorSpy).toHaveBeenCalledWith('[retryWithBackoff] shouldRetry threw a non-Error, original failure attached:', originalError)
    consoleErrorSpy.mockRestore()
  })

  it('shouldRetry 抛 Error 时把原始 error 挂成 cause', async () => {
    const originalError = new Error('primary')
    const cbError = new Error('callback failed')
    await expect(
      retryWithBackoff(() => Promise.reject(originalError), {
        retries: 2,
        baseDelay: 1,
        maxDelay: 2,
        shouldRetry: () => {
          throw cbError
        },
      }),
    ).rejects.toBe(cbError)
    expect(cbError.cause).toBe(originalError)
  })
})

describe('W4 PerformanceMonitor.ts: setOptions 缺省参数（#102）', () => {
  it('不传参数时把选项恢复到默认，不炸', () => {
    const monitor = new PerformanceMonitor({ threshold: 100 })
    expect(() => monitor.setOptions()).not.toThrow()
  })

  it('显式空对象也走同一路径', () => {
    const monitor = new PerformanceMonitor({ threshold: 100 })
    expect(() => monitor.setOptions({})).not.toThrow()
  })
})
