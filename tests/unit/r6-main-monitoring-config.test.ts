/**
 * 第六轮主会话代做项的回归锁：`MonitoringConfig.maxGroups` 打通到 ErrorAggregator
 * （f1-07 交回：实现在 ErrorAggregator 里已有，配置层缺字段，属「实现有、契约无」）
 */

import { ErrorMonitoring } from '@/extras/error/ErrorMonitoring.js'
import type { ErrorContext } from '@/types/error.js'

function ctx(message: string, storeName: string): ErrorContext {
  return {
    storeName,
    operation: 'dispatch',
    error: new Error(message),
    level: 'error',
    timestamp: Date.now(),
  }
}

describe('MonitoringConfig.maxGroups 可配（R6-048/R6-094 同族的契约补齐）', () => {
  it('按 maxGroups 驱逐存活组，但观测账目不受驱逐影响', async () => {
    const monitoring = new ErrorMonitoring({ reporters: [], maxGroups: 2 })

    await monitoring.report(ctx('boom-1', 'a'))
    await monitoring.report(ctx('boom-2', 'b'))
    await monitoring.report(ctx('boom-3', 'c'))

    const stats = monitoring.getAggregationStats()
    expect(stats.totalGroups).toBe(2)
    expect(stats.evictedGroups).toBeGreaterThanOrEqual(1)
    expect(stats.totalErrors).toBe(3)

    await monitoring.shutdown()
  })

  it('非有限值/小于 1 的 maxGroups 归回缺省值，不会把每组刚建的组立刻踢掉', async () => {
    const monitoring = new ErrorMonitoring({ reporters: [], maxGroups: 0 })

    await monitoring.report(ctx('only-one', 'a'))

    const stats = monitoring.getAggregationStats()
    expect(stats.totalGroups).toBe(1)
    expect(stats.evictedGroups).toBe(0)

    await monitoring.shutdown()
  })
})
