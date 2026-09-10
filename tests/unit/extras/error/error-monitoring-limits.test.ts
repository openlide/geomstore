/**
 * ErrorMonitoring：队列容量与重入队上限（MonitoringConfig 可配置项）
 */

import { ErrorMonitoring } from '@/extras/error/index.js'

function errorContext(overrides: Record<string, unknown> = {}): any {
  return { level: 'error', error: new Error('probe'), storeName: 's', operation: 'op', ...overrides }
}

describe('ErrorMonitoring 的队列容量', () => {
  it('重新入队总长超过队列容量时按最旧优先裁剪', async () => {
    const failingReporter = {
      getName: () => 'failing',
      report: async () => {},
      reportBatch: async () => {
        throw new Error('report failed')
      },
    }
    const monitoring = new ErrorMonitoring({
      reporters: [failingReporter],
      batchThreshold: 1_000_000,
      batchInterval: 1_000_000,
      enableConsoleLog: false,
      // 小容量：无需灌上千条即可触发「重入队超容量」的裁剪分支
      maxQueueSize: 5,
    } as any)
    const internal = monitoring as unknown as { errorQueue: unknown[] }

    // 队列只能在此处直接构造：report() 入口会先把队列裁到容量内，无法造出超容量态
    for (let i = 0; i < 7; i++) {
      internal.errorQueue.push(errorContext({ operation: `op-${i}` }))
    }

    await monitoring.flushReports()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(internal.errorQueue.length).toBeLessThanOrEqual(5)

    await monitoring.shutdown()
  })
})
