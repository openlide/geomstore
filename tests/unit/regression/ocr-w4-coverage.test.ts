/**
 * W4 P2 修复引入的分支的补测：把 diff.ts / async-core.ts / PerformanceMonitor.ts
 * 新增分支的语句/行覆盖率拉回 98% 门槛。
 *
 * 与旧回归测试分开的原因：这些用例是「新分支本身」的最小验证，不承担缺陷重现；
 * 混合进旧文件会让「回归 → 修复」的映射变糊。
 *
 * @file tests/unit/regression/ocr-w4-coverage.test.ts
 */

import { compareSnapshots, SnapshotManager, type SnapshotOptions } from '@/extras/snapshot.js'
import { retryWithBackoff } from '@/extras/action/async-core.js'
import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor.js'

const mgr = new SnapshotManager()
// maxDepth 必须显式大于嵌套深度：快照克隆的默认 maxDepth=100 会把更深的节点
// 替换成 "[MaxDepth Exceeded]" 占位符，叶值根本进不了 compare 的深护栏分支
// （那会让「相同内容判 unchanged」因为占位符相同而恒真——为错的原因通过）
const snap = <T>(v: T, options?: SnapshotOptions) => mgr.createSnapshot(v, options)
// 嵌套深度的算术：compare 从 root（depth 0）逐层 +1，护栏在**第一个 depth > 100 的节点**
// 触发。要让「叶子本身」成为越护栏节点（从而走到 isSlotBearingBuiltin 分支），
// 叶子必须恰好在 depth 101——即 101 层包装、叶在第 102 层位置。
// 少一层（100）叶子到不了护栏，多一层（如 105）则 depth 101 的包装对象先触发护栏，
// 走的是 generic deepEqual，slot-bearing 分支依旧不执行
const DEEP = 101
const DEEP_OPTS: SnapshotOptions = { maxDepth: 2 * DEEP }

describe('W4 diff.ts: 装箱原始值在深度护栏内的内容判等', () => {
  /**
   * 深度护栏 (`MAX_COMPARE_DEPTH = 100`) 之外的槽位内建值此前一律走引用判：
   * `new Number(1)` 与另一份 `new Number(1)` 引用不同即判 changed，与浅层走
   * deepEqual 内容比对口径相反。W4-3 修完后两者同口径。
   *
   * 快照克隆对 slot-bearing 内建保留原引用，因此这里必须每次新建装箱值。
   * **关键**：装箱值本身要落到 `depth > MAX_COMPARE_DEPTH` 的那一次 `compare` 调用里
   * 才走 `isSlotBearingBuiltin` 分支——不能藏在普通 `{lvl, child}` 容器里，
   * 因为那种情形下容器判 `isSlotBearingBuiltin` 为 false，走的是外层 deepEqual 兜底。
   * 且快照的 `maxDepth` 必须大于嵌套深度，否则叶在克隆阶段就被截断成占位符，
   * 比较的两侧是同一个占位符串——" unchanged " 恒真但分支从未执行。
   */
  function nestToDepth(inner: unknown, depth: number): unknown {
    let node: any = inner
    for (let i = 0; i < depth; i++) {
      node = { [`k${i}`]: node }
    }
    return node
  }

  /** 深护栏内的叶确实是活的装箱值（而不是 maxDepth 占位符）——防「为错的原因通过」 */
  function leafOf(data: unknown): unknown {
    // 只沿「有自有键的容器」下潜：装箱原始值自身零键，到它即停
    // （不停会把 new Number(1) 当成容器继续 descend，最终拿到 undefined）
    let node: unknown = data
    while (node !== null && typeof node === 'object' && Object.keys(node as object).length > 0) {
      node = (node as Record<string, unknown>)[Object.keys(node as object)[0]]
    }
    return node
  }

  it('前置条件：深护栏内的叶是活的装箱值而非 maxDepth 占位符', () => {
    const a = snap(nestToDepth(new Number(1), DEEP), DEEP_OPTS)
    expect(a.success).toBe(true)
    expect(a.errors).toEqual([])
    const leaf = leafOf(a.data)
    expect(typeof leaf).toBe('object')
    expect(Object.prototype.toString.call(leaf)).toBe('[object Number]')
    expect(Number(leaf)).toBe(1)
  })

  it('两个内容相同的 new Number 在深护栏内不判为 changed（走 new 内容比分支）', () => {
    // 装箱叶放在 depth 101（101 层包装）：compare 递归到该叶时 depth 已 > MAX_COMPARE_DEPTH
    const a = snap(nestToDepth(new Number(1), DEEP), DEEP_OPTS)
    const b = snap(nestToDepth(new Number(1), DEEP), DEEP_OPTS)
    const diff = compareSnapshots(a, b)
    // 此前深度护栏内一律走引用判，`new Number(1)` ≠ `new Number(1)`（引用）⇒ changed: true 假阳
    // 修完后走内容比对 ⇒ changed: false
    expect(diff.changed).toBe(false)
  })

  it('反向断言：内容不同的 new Number 在深护栏内必须判 changed（占位符截断会让它恒假）', () => {
    // 这条是上一行的结构性对偶：只断言「相等」无法区分「分支正确」与「输入被预处理掉」。
    // 若快照 maxDepth 忘了放大，两侧叶都是 "[MaxDepth Exceeded]" 字符串，本用例会红
    const a = snap(nestToDepth(new Number(1), DEEP), DEEP_OPTS)
    const b = snap(nestToDepth(new Number(2), DEEP), DEEP_OPTS)
    expect(compareSnapshots(a, b).changed).toBe(true)
  })

  it('两个内容相同的 new String 深护栏内不判 changed', () => {
    const a = snap(nestToDepth(new String('hello'), DEEP), DEEP_OPTS)
    const b = snap(nestToDepth(new String('hello'), DEEP), DEEP_OPTS)
    expect(compareSnapshots(a, b).changed).toBe(false)
  })

  it('两个内容相同的装箱 BigInt 深护栏内不判 changed', () => {
    const a = snap(nestToDepth(Object(10n), DEEP), DEEP_OPTS)
    const b = snap(nestToDepth(Object(10n), DEEP), DEEP_OPTS)
    expect(compareSnapshots(a, b).changed).toBe(false)
  })

  it('装箱非 primitive 走引用判分岔（覆盖 else 分支）', () => {
    // WeakMap 是 slot-bearing 但不是装箱原始值；深护栏内走 obj1 === obj2 分支。
    // 同一引用两侧共享（克隆对 WeakMap 保留原引用），判 unchanged
    const wm = new WeakMap()
    const a = snap(nestToDepth(wm, DEEP), DEEP_OPTS)
    const b = snap(nestToDepth(wm, DEEP), DEEP_OPTS)
    // 同一个引用：两侧 leaf 都是 wm，走 obj1 === obj2 → 相等
    expect(compareSnapshots(a, b).changed).toBe(false)
  })

  it('槽位值引用不同时深护栏内判 changed（覆盖 else 分支的记账侧）', () => {
    // 与上一条对偶：换一个 WeakMap 实例即被替换过，必须记一条差异
    const a = snap(nestToDepth(new WeakMap(), DEEP), DEEP_OPTS)
    const b = snap(nestToDepth(new WeakMap(), DEEP), DEEP_OPTS)
    expect(compareSnapshots(a, b).changed).toBe(true)
  })
})

describe('W4 async-core.ts: shouldRetry 抛非 Error 时兜底保根因', () => {
  it('shouldRetry 抛字符串时不吞掉原始 error（走 console.error 分支）', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const originalError = new Error('primary failure')
    await expect(
      retryWithBackoff(() => Promise.reject(originalError), {
        retries: 2,
        // 字段名是 delay（指数退避基长）：baseDelay/maxDelay 不是 RetryOptions 的成员，
        // 写错名字 TS 超额属性检查报错、运行期被静默忽略（按默认 100ms 退避）
        delay: 1,
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
        delay: 1,
        shouldRetry: () => {
          throw cbError
        },
      }),
    ).rejects.toBe(cbError)
    // cause 是 ES2022 的 Error 成员，仓库基线 lib 为 ES2020：按带注解读取，
    // 不为此把 tests 的 lib 抬到 ES2022（那会顺带放开一大批 API 的类型面）
    expect((cbError as Error & { cause?: unknown }).cause).toBe(originalError)
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
