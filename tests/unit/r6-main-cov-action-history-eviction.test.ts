/**
 * 第六轮收口（main-cov）—— ActionHistory 桶数上限的淘汰路径与「空表」防御分支
 *
 * 对应 src/extras/action/ActionHistory.ts 的缺口（R6-089 新增代码）：
 * - `evictLeastRecentlyRecorded` 第 103-105 行的 `if (oldest.done === true) return`。
 *   它是「表已空却仍被判成桶数越限」的防御：公开路径上 `record` 只在
 *   `actionResults.size >= MAX_TRACKED_ACTIONS` 时才调它，此时表必然非空，故该分支
 *   在全量跑里始终为 0 —— 是 ActionHistory.ts 唯一未覆盖行（94/96 = 97.91% < 98%）。
 *   这里注入一只「只改 size 读数、其余行为全部沿用原生 Map」的表，把 record 推进这个
 *   退化状态，钉住它的可观察结果：不抛错、不打扰（无桶可点名，故不发 console.debug）、
 *   新桶照常写入。
 * - 越界后的**持续**不变量：连造到越界再连造一批，存活桶数不增、被淘汰的桶从统计里消失、
 *   同名重新记录会重开一个空桶（旧历史确已整桶丢弃，而不是被清空后又复活）。
 *
 * MAX_TRACKED_ACTIONS 是模块私有常量（不进公开 API、也不可注入），故越界用例按简报口径
 * 「在测试里连造到越界」，断言写成不变量而非具体实现细节。只补测试，不改实现。
 */

import { ActionHistoryTracker } from '@/extras/action/ActionHistory.js'
import type { ActionResult } from '@/types/action.js'

/** 与实现里的 MAX_TRACKED_ACTIONS 同值 */
const MAX_TRACKED_ACTIONS = 1000

function recorded(startTime: number): ActionResult {
  return { success: true, data: null, startTime, endTime: startTime + 1, duration: 1 }
}

function names(count: number, offset = 0): string[] {
  return Array.from({ length: count }, (_, i) => `action_${offset + i}`)
}

/**
 * 只把「这张表有多满」的读数放大，get/set/delete/迭代一律沿用原生 Map。
 *
 * 用它把 `record` 推进「判定越限但表里已无桶」这个退化状态：除此之外没有公开入口能同时
 * 满足 size 读数越限与表为空两个条件（这正是实现注释说的「对未来改动的防御」）。
 */
class InflatedSizeMap<K, V> extends Map<K, V> {
  reportedSize: number | undefined = undefined

  override get size(): number {
    return this.reportedSize ?? super.size
  }
}

/** 把 tracker 内部那张表换成读数被放大的空表（字段名与实现的私有字段同名） */
function installEmptyButFullSizedTable(tracker: ActionHistoryTracker): void {
  const injected = new InflatedSizeMap<string, ActionResult[]>()
  injected.reportedSize = MAX_TRACKED_ACTIONS
  Object.defineProperty(tracker, 'actionResults', {
    value: injected,
    writable: true,
    configurable: true,
    enumerable: true,
  })
}

beforeEach(() => {
  jest.spyOn(console, 'debug').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('R6-089 收口：桶数越界的淘汰路径', () => {
  it('越界后继续新增：存活桶数不再增长，被淘汰的桶从统计里消失', () => {
    const tracker = new ActionHistoryTracker()
    for (const name of names(MAX_TRACKED_ACTIONS)) {
      tracker.record(recorded(1), name)
    }
    expect(Object.keys(tracker.getAllStats())).toHaveLength(MAX_TRACKED_ACTIONS)

    const extra = names(50, MAX_TRACKED_ACTIONS)
    for (const name of extra) {
      tracker.record(recorded(2), name)
    }

    const stats = tracker.getAllStats()
    // 不变量：桶数封顶，越界的那 50 个名字各挤掉一个最久未记录的桶
    expect(Object.keys(stats)).toHaveLength(MAX_TRACKED_ACTIONS)
    for (const evicted of names(50)) {
      expect(stats[evicted]).toBeUndefined()
      expect(tracker.getHistory(evicted)).toEqual([])
      expect(tracker.getStats(evicted)).toMatchObject({ total: 0, success: 0, failure: 0 })
    }
    // 新桶与未被波及的旧桶都还在
    expect(stats[extra[49]]).toMatchObject({ total: 1 })
    expect(stats[`action_50`]).toMatchObject({ total: 1 })
  })

  it('整桶淘汰是「丢弃」而非「置空」：同名重新记录会重开一个只含新记录的桶', () => {
    const tracker = new ActionHistoryTracker()
    for (const name of names(MAX_TRACKED_ACTIONS)) {
      tracker.record(recorded(1), name)
    }
    tracker.record(recorded(7), 'action_3')
    tracker.record(recorded(8), 'action_3')
    // 触碰过的桶被挪到表尾，因此淘汰从 action_0 开始而不是 action_3
    tracker.record(recorded(9), 'fresh')
    expect(tracker.getStats('action_0').total).toBe(0)
    expect(tracker.getHistory('action_0')).toEqual([])

    tracker.record(recorded(10), 'action_0')
    expect(tracker.getStats('action_0')).toMatchObject({ total: 1, success: 1 })
    expect(tracker.getHistory('action_0')[0].startTime).toBe(10)
    // 淘汰不牵连其余桶：action_3 的三条记录（灌满时 1 条 + 触碰 2 条）原样保留
    expect(tracker.getHistory('action_3').map((r) => r.startTime)).toEqual([1, 7, 8])
    expect(tracker.getStats('fresh')).toMatchObject({ total: 1 })
  })

  it('淘汰会点名：每条越界记录各打一条 console.debug，且写出被淘汰的 Action 名', () => {
    const debug = jest.mocked(console.debug)
    const tracker = new ActionHistoryTracker()
    for (const name of names(MAX_TRACKED_ACTIONS)) {
      tracker.record(recorded(1), name)
    }
    expect(debug).not.toHaveBeenCalled()

    tracker.record(recorded(2), 'dynamic_a')
    tracker.record(recorded(3), 'dynamic_b')

    expect(debug).toHaveBeenCalledTimes(2)
    expect(debug).toHaveBeenNthCalledWith(1, expect.stringContaining('"action_0"'))
    expect(debug).toHaveBeenNthCalledWith(2, expect.stringContaining('"action_1"'))
    // 上限之内不产生任何噪音
    debug.mockClear()
    tracker.record(recorded(4), 'dynamic_a')
    expect(debug).not.toHaveBeenCalled()
  })
})

describe('R6-089 收口：空表却被判成越限时，淘汰入口直接返回', () => {
  it('record 在退化状态下仍写入新桶，且不点名（无桶可点名）', () => {
    const debug = jest.mocked(console.debug)
    const tracker = new ActionHistoryTracker()
    installEmptyButFullSizedTable(tracker)

    tracker.record(recorded(1), 'late_bloom')

    // 防御分支命中：没有桶被淘汰，也就不该有「点名被淘汰 Action」的提示
    expect(debug).not.toHaveBeenCalled()
    expect(tracker.getHistory('late_bloom')).toHaveLength(1)
    expect(tracker.getStats('late_bloom')).toMatchObject({ total: 1, success: 1, failure: 0 })
    expect(Object.keys(tracker.getAllStats())).toEqual(['late_bloom'])
  })

  it('退化状态连续记录：每次都走同一分支，历史按正常语义累积', () => {
    const debug = jest.mocked(console.debug)
    const tracker = new ActionHistoryTracker()
    installEmptyButFullSizedTable(tracker)

    for (let i = 0; i < 5; i++) {
      tracker.record(recorded(i), 'busy')
    }

    expect(debug).not.toHaveBeenCalled()
    expect(tracker.getHistory('busy').map((r) => r.startTime)).toEqual([0, 1, 2, 3, 4])
    expect(tracker.getStats('busy')).toMatchObject({ total: 5, success: 5 })
  })
})
