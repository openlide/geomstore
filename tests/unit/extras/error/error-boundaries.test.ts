/**
 * 错误处理域的边界分支
 *
 * 覆盖：ErrorBoundary 的历史裁剪与函数型 fallback、ConsoleReporter 的
 * timestamp 缺省与无分组降级、HttpReporter 的 fail 非 Error 载荷 / fetch 分支
 * 非 2xx / method 缺省、ErrorMonitoring 的重入队容量判定与「定时器无 unref」
 * 环境、ErrorRecovery 的重试窗口容量清理。
 */

import { ErrorBoundary, ErrorMonitoring, ErrorRecovery, RecoveryStrategy } from '@/extras/error/index.js'
import { ConsoleReporter } from '@/extras/error/reporters/ConsoleReporter.js'
import { HttpReporter } from '@/extras/error/reporters/HttpReporter.js'
import { GeomStoreError } from '@/core/errors/GeomStoreError.js'

const MAX_ERROR_HISTORY = 100

function errorContext(overrides: Record<string, unknown> = {}): any {
  return {
    level: 'error',
    error: new Error('boundary probe'),
    storeName: 'probe-store',
    operation: 'probe-op',
    ...overrides,
  }
}

/**
 * 还原全局键：备份为 undefined 时删除键本身，避免留下 `wx: undefined`
 * 让 `'wx' in globalThis` 之类的存在性判断失真
 */
function restoreGlobal(key: 'wx' | 'fetch', backup: unknown): void {
  if (backup === undefined) {
    Reflect.deleteProperty(globalThis, key)
  } else {
    Object.assign(globalThis, { [key]: backup })
  }
}

describe('错误处理域边界分支', () => {
  describe('ErrorBoundary', () => {
    let warnSpy: jest.SpyInstance

    beforeEach(() => {
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    it('错误历史超过上限时裁剪最旧记录', () => {
      const boundary = new ErrorBoundary({ fallback: { count: 0 }, recoverable: true })

      for (let i = 0; i < MAX_ERROR_HISTORY + 1; i++) {
        expect(
          boundary.execute(() => {
            throw new Error(`e${i}`)
          }),
        ).toEqual({ count: 0 })
      }

      expect(boundary.getErrorHistory()).toHaveLength(MAX_ERROR_HISTORY)
    })

    it('函数型 fallback 下 getFallbackState 返回 undefined（需结合错误上下文求值）', () => {
      const boundary = new ErrorBoundary({ fallback: () => ({ count: 9 }), recoverable: true })

      expect(boundary.getFallbackState()).toBeUndefined()
      expect(
        boundary.execute(() => {
          throw new Error('boom')
        }),
      ).toEqual({ count: 9 })
    })
  })

  describe('ConsoleReporter 的 timestamp 缺省', () => {
    it('分组模式下 timestamp 缺省时回退 Date.now', async () => {
      const groupSpy = jest.spyOn(console, 'group').mockImplementation(() => {})
      const groupEndSpy = jest.spyOn(console, 'groupEnd').mockImplementation(() => {})
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const reporter = new ConsoleReporter()

      try {
        await reporter.report(errorContext())

        expect(groupSpy).toHaveBeenCalled()
        expect(errorSpy).toHaveBeenCalledWith('Timestamp:', expect.any(String))
        expect(groupEndSpy).toHaveBeenCalled()
      } finally {
        groupSpy.mockRestore()
        groupEndSpy.mockRestore()
        errorSpy.mockRestore()
      }
    })

    it('无分组能力时降级平铺输出，timestamp 缺省同样回退', async () => {
      // console.group 定义在原型上，需以自有属性遮蔽后再删除以还原
      Object.defineProperty(console, 'group', { value: undefined, configurable: true, writable: true })
      Object.defineProperty(console, 'groupEnd', { value: undefined, configurable: true, writable: true })
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
      const reporter = new ConsoleReporter()

      try {
        await reporter.report(errorContext({ level: 'warn' }))
        await reporter.reportBatch([errorContext()])

        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Timestamp:'), expect.any(String))
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Batch Report'))
      } finally {
        Reflect.deleteProperty(console, 'group')
        Reflect.deleteProperty(console, 'groupEnd')
        errorSpy.mockRestore()
      }
    })
  })

  describe('HttpReporter 的环境分支与参数缺省', () => {
    let wxBackup: unknown
    let fetchBackup: unknown

    beforeEach(() => {
      wxBackup = (globalThis as any).wx
      fetchBackup = (globalThis as any).fetch
    })

    afterEach(() => {
      restoreGlobal('wx', wxBackup)
      restoreGlobal('fetch', fetchBackup)
    })

    it('wx.request 的 fail 回调收到非 Error 载荷时包装为 Error', async () => {
      Object.assign(globalThis, {
        wx: {
          request: (options: { fail: (err: unknown) => void }) => {
            options.fail('plain string failure')
          },
        },
      })
      const reporter = new HttpReporter('https://example.com/report')

      await expect(reporter.report(errorContext())).rejects.toThrow('wx.request failed')
    })

    it('浏览器 fetch 分支：响应非 2xx 时抛出并带状态码', async () => {
      Reflect.deleteProperty(globalThis, 'wx')
      Object.assign(globalThis, { fetch: jest.fn(async () => ({ ok: false, status: 503 })) })
      const reporter = new HttpReporter('https://example.com/report')

      await expect(reporter.report(errorContext())).rejects.toThrow('HTTP 503')
    })

    it('未显式配置 method 时回退为 POST', async () => {
      const requestImpl = jest.fn(async () => {})
      const reporter = new HttpReporter('https://example.com/report', { headers: { 'Content-Type': 'application/json' } }, requestImpl)

      await reporter.report(errorContext())
      await reporter.reportBatch([errorContext()])

      expect(requestImpl).toHaveBeenNthCalledWith(1, 'https://example.com/report', expect.any(String), 'POST', expect.any(Object))
      expect(requestImpl).toHaveBeenNthCalledWith(2, 'https://example.com/report', expect.any(String), 'POST', expect.any(Object))
    })
  })

  describe('ErrorMonitoring 的重入队与定时器探测', () => {
    const failingReporter = {
      getName: () => 'failing',
      report: async () => {},
      reportBatch: async () => {
        throw new Error('report failed')
      },
    }

    it('本批错误重新入队且未超容量时直接拼接（不裁剪）', async () => {
      const monitoring = new ErrorMonitoring({
        reporters: [failingReporter],
        batchThreshold: 1,
        batchInterval: 1_000_000,
        enableConsoleLog: false,
      } as any)

      await monitoring.report(errorContext())
      await new Promise((resolve) => setTimeout(resolve, 0))

      // 报告器恒失败 → 批次被重新入队（须在 shutdown 之前断言：shutdown 会做最终 flush 并清空队列）
      expect((monitoring as unknown as { errorQueue: unknown[] }).errorQueue.length).toBeGreaterThan(0)

      await (monitoring as any).shutdown?.()
    })

    it('运行环境定时器不提供 unref 时不报错（小程序/浏览器兼容路径）', async () => {
      const realSetTimeout = globalThis.setTimeout
      // 桩返回的句柄不带 unref（覆盖探测分支），但底层仍是真实定时器：
      // 必须留存真实句柄，否则 clearTimeout 清不掉，遗留句柄会阻止 jest worker 退出
      const realTimers: Array<ReturnType<typeof setTimeout>> = []
      // 不创建真实 interval：本用例只验证「无 unref 时不报错」这一探测分支
      const setIntervalSpy = jest.spyOn(globalThis, 'setInterval').mockImplementation((() => {
        return { hasRef: () => false } as unknown as ReturnType<typeof setInterval>
      }) as unknown as typeof globalThis.setInterval)
      const setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: () => void, timeout?: number) => {
        realTimers.push(realSetTimeout(handler, timeout))
        return { hasRef: () => false } as unknown as ReturnType<typeof setTimeout>
      }) as typeof globalThis.setTimeout)

      try {
        const monitoring = new ErrorMonitoring({
          reporters: [failingReporter],
          batchThreshold: 1,
          batchInterval: 1_000_000,
          enableConsoleLog: false,
        } as any)

        await monitoring.report(errorContext())
        await new Promise((resolve) => setTimeout(resolve, 0))
        await monitoring.shutdown()

        expect(setIntervalSpy).toHaveBeenCalled()
        expect(setTimeoutSpy).toHaveBeenCalled()
      } finally {
        // 清理底层真实定时器（含尚未 fire 的退避等待），避免句柄泄漏
        realTimers.forEach((timer) => clearTimeout(timer))
        setIntervalSpy.mockRestore()
        setTimeoutSpy.mockRestore()
      }
    })
  })

  describe('ErrorRecovery 的重试窗口容量守卫', () => {
    it('键数超过上限时清理过期窗口并淘汰最旧键', async () => {
      const nowSpy = jest.spyOn(Date, 'now')
      const now = 1_000_000
      nowSpy.mockImplementation(() => now)
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        const recovery = new ErrorRecovery()
        recovery.configure({
          TEST_CODE: { strategy: RecoveryStrategy.RETRY, maxRetries: 3, retryDelay: 0, exponentialBackoff: false },
        })

        // 直接构造「超过 MAX_RETRY_KEYS(1000) 且全部到期」的周期表（值是**到期时刻**）：
        // 动态 operation id 场景下正是该状态触发容量守卫（逐次 recover 需千次调用，过慢）
        const internal = recovery as unknown as {
          retryCycleEnd: Map<string, number>
          retryCount: Map<string, number>
        }
        for (let i = 0; i <= 1000; i++) {
          internal.retryCycleEnd.set(`expired-${i}`, now - 120_000)
          internal.retryCount.set(`expired-${i}`, 1)
        }

        await expect(recovery.recover(new GeomStoreError('probe', 'TEST_CODE'), { operation: 'fresh' })).rejects.toThrow()

        // 过期窗口被清理，键数压回上限内
        expect(internal.retryCycleEnd.has('expired-0')).toBe(false)
        expect(internal.retryCycleEnd.size).toBeLessThanOrEqual(1000)
      } finally {
        nowSpy.mockRestore()
        warnSpy.mockRestore()
      }
    })
  })
})
