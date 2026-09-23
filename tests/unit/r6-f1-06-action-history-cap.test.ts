/**
 * 第六轮分片 f1-06 回归锁 —— ActionHistory 的桶数上限（R6-089）
 *
 * 类注释承诺「每桶有界」，修复前桶数（`actionResults` 的键数）无任何上限：以运行期拼出来
 * 的动作名派发不存在的 action 时，每次失败都新开一个桶，`actionResults` 随调用次数线性增长。
 * 修复后按「最近记录序」淘汰整桶，dev 期点名原因。
 */

import { ActionHistoryTracker } from '@/extras/action/ActionHistory.js'
import type { ActionResult } from '@/types/action.js'

/** 与实现里的 MAX_TRACKED_ACTIONS 同值：常量刻意不导出（非公开 API），这里以「上限行为」锁定 */
const MAX_TRACKED_ACTIONS = 1000

function failedRecord(startTime = 1): ActionResult {
  return { success: false, error: new Error('boom'), startTime, endTime: startTime, duration: 0 }
}

function fillNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `action_${i}`)
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('R6-089 ActionHistory 桶数有界', () => {
  it('超过上限后桶数不再增长，最久未被记录的整桶被淘汰', () => {
    const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined)
    const tracker = new ActionHistoryTracker()
    const names = fillNames(MAX_TRACKED_ACTIONS)

    for (const name of names) {
      tracker.record(failedRecord(), name)
    }
    expect(Object.keys(tracker.getAllStats())).toHaveLength(MAX_TRACKED_ACTIONS)

    tracker.record(failedRecord(), 'dynamically_named')
    const stats = tracker.getAllStats()
    expect(Object.keys(stats)).toHaveLength(MAX_TRACKED_ACTIONS)
    // 最先记录的那个桶被淘汰，新桶与其余桶都在
    expect(stats['action_0']).toBeUndefined()
    expect(stats['dynamically_named']).toMatchObject({ total: 1, failure: 1 })
    expect(stats['action_999']).toMatchObject({ total: 1 })
    // 淘汰不是静默的：dev 期给出可定位的提示（NODE_ENV=test → isProduction() 为 false）
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('[ActionHistory]'))
  })

  it('淘汰按「最近记录序」而非插入序：反复记录的热点桶不会先被丢掉', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined)
    const tracker = new ActionHistoryTracker()
    for (const name of fillNames(MAX_TRACKED_ACTIONS)) {
      tracker.record(failedRecord(), name)
    }
    // 触碰 action_0：它不再是「最久未被记录」的那个，action_1 才是
    tracker.record(failedRecord(), 'action_0')
    tracker.record(failedRecord(), 'newcomer')

    const stats = tracker.getAllStats()
    expect(stats['action_0']).toMatchObject({ total: 2 })
    expect(stats['action_1']).toBeUndefined()
    expect(stats['newcomer']).toMatchObject({ total: 1 })
    expect(debugSpy).toHaveBeenCalledTimes(1)
  })

  it('正常规模的使用不受影响：全部桶与桶内记录都保留', () => {
    const tracker = new ActionHistoryTracker()
    tracker.setMaxHistory(3)
    for (let i = 0; i < 30; i++) {
      tracker.record(failedRecord(i), 'flaky')
      tracker.record(failedRecord(i), 'other')
    }

    expect(Object.keys(tracker.getAllStats())).toHaveLength(2)
    expect(tracker.getHistory('flaky')).toHaveLength(3)
    expect(tracker.getStats('other').total).toBe(3)
  })
})
