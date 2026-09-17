/**
 * ActionHistoryTracker 单元测试
 *
 * 聚焦 setMaxHistory 的边界：缩容时立即裁剪已有桶、NaN/非有限值回退文档下限 1、
 * 小数向下取整并收敛；以及 getHistory 返回顺序与 JSDoc 对齐（命名桶按时间正序）。
 */

import { ActionHistoryTracker } from '@/extras/action/ActionHistory.js'
import type { ActionResult } from '@/types/action.js'

const makeResult = (startTime: number): ActionResult => ({
  data: startTime,
  success: true,
  startTime,
  endTime: startTime + 1,
  duration: 1,
})

describe('ActionHistoryTracker.setMaxHistory', () => {
  it('缩容时立即裁剪已有桶，并将后续记录收敛到新上限', () => {
    const tracker = new ActionHistoryTracker()

    // 默认上限 100：先灌满一个桶
    for (let i = 0; i < 100; i++) {
      tracker.record(makeResult(i), 'fetch')
    }
    expect(tracker.getHistory('fetch')).toHaveLength(100)

    tracker.setMaxHistory(10)

    // 修复前：已有桶保持 100，且 push+shift 每次抵消，永远钉死在 100
    const trimmed = tracker.getHistory('fetch')
    expect(trimmed).toHaveLength(10)
    // 保留的是最新 10 条（最早的 90 条被裁剪）
    expect(trimmed[0].startTime).toBe(90)
    expect(trimmed[9].startTime).toBe(99)

    // 继续记录：不再越过上限
    for (let i = 100; i < 130; i++) {
      tracker.record(makeResult(i), 'fetch')
    }
    expect(tracker.getHistory('fetch')).toHaveLength(10)
    expect(tracker.getHistory('fetch')[9].startTime).toBe(129)
  })

  it('NaN 回退到文档下限 1，不会导致无界保留', () => {
    const tracker = new ActionHistoryTracker()
    tracker.record(makeResult(1), 'fetch')
    tracker.record(makeResult(2), 'fetch')

    tracker.setMaxHistory(Number.NaN)

    // 修复前：Math.max(1, NaN) === NaN，长度比较恒 false，历史无界增长
    expect(tracker.getHistory('fetch')).toHaveLength(1)

    for (let i = 0; i < 500; i++) {
      tracker.record(makeResult(10 + i), 'fetch')
    }
    const history = tracker.getHistory('fetch')
    expect(history).toHaveLength(1)
    expect(history[0].startTime).toBe(509)
  })

  it('非有限值（Infinity / -Infinity）回退到下限 1', () => {
    const infinity = new ActionHistoryTracker()
    infinity.record(makeResult(1), 'a')
    infinity.record(makeResult(2), 'a')
    infinity.setMaxHistory(Number.POSITIVE_INFINITY)
    expect(infinity.getHistory('a')).toHaveLength(1)

    const negativeInfinity = new ActionHistoryTracker()
    negativeInfinity.record(makeResult(1), 'b')
    negativeInfinity.record(makeResult(2), 'b')
    negativeInfinity.setMaxHistory(Number.NEGATIVE_INFINITY)
    expect(negativeInfinity.getHistory('b')).toHaveLength(1)
  })

  it('小数向下取整：已有桶按 floor(size) 裁剪并收敛', () => {
    const tracker = new ActionHistoryTracker()
    for (let i = 0; i < 5; i++) {
      tracker.record(makeResult(i), 'fetch')
    }

    tracker.setMaxHistory(2.5)

    // floor(2.5) = 2：已有 5 条应立即裁到 2 条
    expect(tracker.getHistory('fetch')).toHaveLength(2)

    for (let i = 5; i < 9; i++) {
      tracker.record(makeResult(i), 'fetch')
    }
    expect(tracker.getHistory('fetch')).toHaveLength(2)
    expect(tracker.getHistory('fetch')[1].startTime).toBe(8)
  })

  it('小于 1 的输入（0 / 负数）钳制为 1', () => {
    const zero = new ActionHistoryTracker()
    zero.record(makeResult(1), 'a')
    zero.record(makeResult(2), 'a')
    zero.setMaxHistory(0)
    expect(zero.getHistory('a')).toHaveLength(1)

    const negative = new ActionHistoryTracker()
    negative.record(makeResult(1), 'b')
    negative.record(makeResult(2), 'b')
    negative.setMaxHistory(-5)
    expect(negative.getHistory('b')).toHaveLength(1)
  })
})

describe('ActionHistoryTracker.getHistory 返回顺序', () => {
  it('命名桶按时间正序（最早在前），无参聚合按 startTime 倒序', () => {
    const tracker = new ActionHistoryTracker()
    tracker.record(makeResult(1), 'a')
    tracker.record(makeResult(3), 'a')
    tracker.record(makeResult(2), 'b')

    // 与 JSDoc 对齐：命名桶为插入顺序（正序）
    const named = tracker.getHistory('a')
    expect(named.map((r) => r.startTime)).toEqual([1, 3])

    // 无参聚合仍按 startTime 倒序（最新在前）
    const all = tracker.getHistory()
    expect(all.map((r) => r.startTime)).toEqual([3, 2, 1])
  })
})

describe('ActionHistoryTracker.setMaxHistory 的扩容量分支', () => {
  it('放宽上限不打乱既有桶', () => {
    const tracker = new ActionHistoryTracker()
    for (let i = 0; i < 5; i++) {
      tracker.record(makeResult(i), 'c')
    }
    // 缩小再放宽：缩容裁剪生效，放宽时既有桶原样保留
    tracker.setMaxHistory(2)
    expect(tracker.getHistory('c').map((r) => r.startTime)).toEqual([3, 4])
    tracker.setMaxHistory(10)
    expect(tracker.getHistory('c').map((r) => r.startTime)).toEqual([3, 4])
  })
})
