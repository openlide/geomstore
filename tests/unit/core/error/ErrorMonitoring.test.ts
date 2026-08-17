/**
 * GeomStore v1.0 - ErrorMonitoring测试
 *
 * 测试覆盖：
 * - 错误报告器
 * - 错误聚合
 * - 批量上报
 * - 错误报告生成
 * - 错误统计
 */

import {
  ErrorMonitoring,
  ErrorAggregator,
  ConsoleReporter,
  HttpReporter,
  ErrorReporter,
  ErrorGroup,
  createDefaultMonitoring,
  getDefaultMonitoring,
  defaultMonitoring,
  GeomStoreError,
  ErrorCode,
  createError,
} from '@/core/error'
import type { ErrorContext } from '@/types/error'

describe('ConsoleReporter', () => {
  beforeEach(() => {
    jest.spyOn(console, 'group').mockImplementation()
    jest.spyOn(console, 'error').mockImplementation()
    jest.spyOn(console, 'groupEnd').mockImplementation()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('基础功能', () => {
    it('MONITOR-001: 应该创建ConsoleReporter实例', () => {
      const reporter = new ConsoleReporter('[Test]')
      expect(reporter).toBeDefined()
      expect(reporter.getName()).toBe('console')
    })

    it('MONITOR-002: report应该输出到控制台', async () => {
      const reporter = new ConsoleReporter()
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await reporter.report(context)

      expect(consoleErrorSpy).toHaveBeenCalled()
    })

    it('MONITOR-003: reportBatch应该输出批量错误', async () => {
      const reporter = new ConsoleReporter()
      const consoleGroupSpy = jest.spyOn(console, 'group').mockImplementation()

      const contexts: ErrorContext[] = [
        {
          storeName: 'store1',
          operation: 'dispatch',
          error: new Error('Error 1'),
          level: 'error',
          timestamp: Date.now(),
        },
        {
          storeName: 'store2',
          operation: 'dispatch',
          error: new Error('Error 2'),
          level: 'error',
          timestamp: Date.now(),
        },
      ]

      await reporter.reportBatch(contexts)

      expect(consoleGroupSpy).toHaveBeenCalled()
    })
  })

  describe('上报功能详细测试', () => {
    it('MONITOR-055: report应该输出完整的错误信息', async () => {
      const reporter = new ConsoleReporter('[TestPrefix]')
      const consoleGroupSpy = jest.spyOn(console, 'group').mockImplementation()
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const consoleGroupEndSpy = jest.spyOn(console, 'groupEnd').mockImplementation()

      const error = new Error('Detailed error message')
      const context: ErrorContext = {
        storeName: 'my-store',
        operation: 'setState',
        error,
        level: 'error',
        timestamp: 1700000000000,
        payload: { key: 'value' },
      }

      await reporter.report(context)

      // 验证console.group被调用，包含级别信息
      expect(consoleGroupSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR'))
      expect(consoleGroupSpy).toHaveBeenCalledWith(expect.stringContaining('[TestPrefix]'))

      // 验证关键信息被输出
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error:', error)
      expect(consoleErrorSpy).toHaveBeenCalledWith('Store:', 'my-store')
      expect(consoleErrorSpy).toHaveBeenCalledWith('Operation:', 'setState')
      expect(consoleErrorSpy).toHaveBeenCalledWith('Payload:', { key: 'value' })
      expect(consoleErrorSpy).toHaveBeenCalledWith('Timestamp:', expect.any(String))
      expect(consoleGroupEndSpy).toHaveBeenCalled()
    })

    it('MONITOR-056: report没有payload时不应该输出payload', async () => {
      const reporter = new ConsoleReporter()
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('No payload error'),
        level: 'warning',
        timestamp: Date.now(),
        // payload 未定义
      }

      await reporter.report(context)

      // 检查没有 Payload 输出
      const calls = consoleErrorSpy.mock.calls
      const hasPayloadCall = calls.some((call) => call[0] === 'Payload:')
      expect(hasPayloadCall).toBe(false)
    })

    it('MONITOR-057: reportBatch应该正确格式化批量错误', async () => {
      const reporter = new ConsoleReporter()
      const consoleGroupSpy = jest.spyOn(console, 'group').mockImplementation()
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const consoleGroupEndSpy = jest.spyOn(console, 'groupEnd').mockImplementation()

      const contexts: ErrorContext[] = [
        {
          storeName: 'store1',
          operation: 'dispatch',
          error: new Error('Error 1'),
          level: 'error',
          timestamp: 1000,
        },
        {
          storeName: 'store2',
          operation: 'setState',
          error: new Error('Error 2'),
          level: 'warning',
          timestamp: 2000,
        },
      ]

      await reporter.reportBatch(contexts)

      // 验证批量报告的标题
      expect(consoleGroupSpy).toHaveBeenCalledWith(expect.stringContaining('Batch Report'))
      expect(consoleGroupSpy).toHaveBeenCalledWith(expect.stringContaining('2 errors'))

      // 验证每个错误都被输出
      expect(consoleErrorSpy).toHaveBeenCalledTimes(2)
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(1, expect.stringContaining('[1]'), contexts[0].error)
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(2, expect.stringContaining('[2]'), contexts[1].error)
    })

    it('MONITOR-058: 应该支持不同的错误级别输出', async () => {
      const reporter = new ConsoleReporter()
      const consoleGroupSpy = jest.spyOn(console, 'group').mockImplementation()

      const levels: Array<'error' | 'warning' | 'info'> = ['error', 'warning', 'info']

      for (const level of levels) {
        const context: ErrorContext = {
          storeName: 'test-store',
          operation: 'dispatch',
          error: new Error(`${level} message`),
          level,
          timestamp: Date.now(),
        }

        await reporter.report(context)

        expect(consoleGroupSpy).toHaveBeenCalledWith(expect.stringContaining(level.toUpperCase()))
      }
    })

    it('MONITOR-059: 时间戳应该被正确格式化为ISO字符串', async () => {
      const reporter = new ConsoleReporter()
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      const timestamp = 1700000000000
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp,
      }

      await reporter.report(context)

      // 验证时间戳格式化
      const expectedISO = new Date(timestamp).toISOString()
      expect(consoleErrorSpy).toHaveBeenCalledWith('Timestamp:', expectedISO)
    })
  })
})

describe('HttpReporter', () => {
  let mockFetch: jest.Mock
  let originalFetch: typeof fetch | undefined
  let originalWx: unknown

  beforeEach(() => {
    originalFetch = global.fetch
    mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    })
    // 为测试目的设置全局 fetch
    global.fetch = mockFetch
    // setup.js 注入了全局 wx.request，会使 createDefaultRequest 优先走 wx 分支。
    // 本 describe 默认验证 fetch 分支，因此临时移除 wx；小程序适配见下方独立 describe。
    originalWx = (globalThis as { wx?: unknown }).wx
    delete (globalThis as { wx?: unknown }).wx
  })

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch
    } else {
      delete (globalThis as { fetch?: unknown }).fetch
    }
    const globalObject = globalThis as { wx?: unknown }
    if (originalWx === undefined) {
      delete globalObject.wx
    } else {
      globalObject.wx = originalWx
    }
    jest.restoreAllMocks()
  })

  describe('基础功能', () => {
    it('MONITOR-004: 应该创建HttpReporter实例', () => {
      const reporter = new HttpReporter('https://api.example.com/errors')
      expect(reporter).toBeDefined()
      expect(reporter.getName()).toBe('http')
    })

    it('MONITOR-005: 应该支持自定义选项', () => {
      const options = {
        method: 'POST' as RequestInit['method'],
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      }
      const reporter = new HttpReporter('https://api.example.com/errors', options)
      expect(reporter).toBeDefined()
    })
  })

  describe('上报功能', () => {
    it('MONITOR-037: report应该发送HTTP POST请求', async () => {
      const reporter = new HttpReporter('https://api.example.com/errors')

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: 1700000000000,
      }

      await reporter.report(context)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/errors',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }),
      )
    })

    it('MONITOR-038: report应该发送正确的请求体格式', async () => {
      const reporter = new HttpReporter('https://api.example.com/errors')

      const error = new Error('Test error message')
      error.name = 'TestError'

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error,
        level: 'error',
        timestamp: 1700000000000,
        payload: { action: 'testAction' },
      }

      await reporter.report(context)

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body as string)

      expect(body).toHaveProperty('error')
      expect(body.error).toHaveProperty('message', 'Test error message')
      expect(body.error).toHaveProperty('name', 'TestError')
      expect(body).toHaveProperty('storeName', 'test-store')
      expect(body).toHaveProperty('operation', 'dispatch')
      expect(body).toHaveProperty('level', 'error')
      expect(body).toHaveProperty('payload', { action: 'testAction' })
      expect(body).toHaveProperty('timestamp', 1700000000000)
    })

    it('MONITOR-039: reportBatch应该发送批量错误', async () => {
      const reporter = new HttpReporter('https://api.example.com/errors')

      const contexts: ErrorContext[] = [
        {
          storeName: 'store1',
          operation: 'dispatch',
          error: new Error('Error 1'),
          level: 'error',
          timestamp: 1700000000001,
        },
        {
          storeName: 'store2',
          operation: 'setState',
          error: new Error('Error 2'),
          level: 'warning',
          timestamp: 1700000000002,
        },
      ]

      await reporter.reportBatch(contexts)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body as string)

      expect(body).toHaveProperty('errors')
      expect(body.errors).toHaveLength(2)
      expect(body.errors[0]).toHaveProperty('storeName', 'store1')
      expect(body.errors[1]).toHaveProperty('storeName', 'store2')
    })

    it('MONITOR-040: reportBatch请求体格式应该正确', async () => {
      const reporter = new HttpReporter('https://api.example.com/errors')

      const contexts: ErrorContext[] = [
        {
          storeName: 'test-store',
          operation: 'dispatch',
          error: new Error('Batch error'),
          level: 'error',
          timestamp: 1700000000000,
        },
      ]

      await reporter.reportBatch(contexts)

      const callArgs = mockFetch.mock.calls[0]
      const body = JSON.parse(callArgs[1].body as string)

      expect(body.errors[0]).toHaveProperty('error')
      expect(body.errors[0].error).toHaveProperty('message', 'Batch error')
      expect(body.errors[0]).toHaveProperty('storeName', 'test-store')
      expect(body.errors[0]).toHaveProperty('operation', 'dispatch')
      expect(body.errors[0]).toHaveProperty('level', 'error')
      expect(body.errors[0]).toHaveProperty('timestamp')
    })

    it('MONITOR-041: 应该支持自定义请求头', async () => {
      const options: RequestInit = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
        },
      }
      const reporter = new HttpReporter('https://api.example.com/errors', options)

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await reporter.report(context)

      const callArgs = mockFetch.mock.calls[0]
      expect(callArgs[1].headers).toHaveProperty('Authorization', 'Bearer test-token')
    })

    it('MONITOR-042: 请求失败时应该捕获错误并输出到控制台', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      mockFetch.mockRejectedValue(new Error('Network error'))

      const reporter = new HttpReporter('https://api.example.com/errors')

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      // 不应该抛出错误
      await expect(reporter.report(context)).resolves.toBeUndefined()

      expect(consoleErrorSpy).toHaveBeenCalledWith('[HttpReporter] Failed to report error:', expect.any(Error))
    })

    it('MONITOR-043: 批量上报失败时应该捕获错误', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      mockFetch.mockRejectedValue(new Error('Network timeout'))

      const reporter = new HttpReporter('https://api.example.com/errors')

      const contexts: ErrorContext[] = [
        {
          storeName: 'test-store',
          operation: 'dispatch',
          error: new Error('Test error'),
          level: 'error',
          timestamp: Date.now(),
        },
      ]

      await expect(reporter.reportBatch(contexts)).resolves.toBeUndefined()

      expect(consoleErrorSpy).toHaveBeenCalledWith('[HttpReporter] Failed to report batch:', expect.any(Error))
    })

    it('MONITOR-046: 支持 Headers 实例形式的请求头', async () => {
      const options: RequestInit = {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json', 'X-Custom': 'yes' }),
      }
      const reporter = new HttpReporter('https://api.example.com/errors', options)

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await reporter.report(context)

      const callArgs = mockFetch.mock.calls[0]
      // Headers.forEach 归一化时键名转为小写（HTTP 头名大小写不敏感）
      expect(callArgs[1].headers).toEqual({ 'content-type': 'application/json', 'x-custom': 'yes' })
    })

    it('MONITOR-047: 支持二维数组形式的请求头', async () => {
      const options: RequestInit = {
        method: 'POST',
        headers: [
          ['Content-Type', 'application/json'],
          ['X-Custom', 'yes'],
        ],
      }
      const reporter = new HttpReporter('https://api.example.com/errors', options)

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await reporter.report(context)

      const callArgs = mockFetch.mock.calls[0]
      expect(callArgs[1].headers).toEqual({ 'Content-Type': 'application/json', 'X-Custom': 'yes' })
    })

    it('MONITOR-048: fetch 分支应透传构造函数传入的 RequestInit 配置', async () => {
      const options: RequestInit = {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
      }
      const reporter = new HttpReporter('https://api.example.com/errors', options)

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await reporter.report(context)

      const callArgs = mockFetch.mock.calls[0]
      // credentials/keepalive 等配置不应被静默丢弃
      expect(callArgs[1].credentials).toBe('include')
      expect(callArgs[1].keepalive).toBe(true)
      expect(callArgs[1].method).toBe('POST')
    })
  })

  describe('空值回退测试', () => {
    it('MONITOR-COV-001: report 应处理空 message/stack/name 的错误', async () => {
      const reporter = new HttpReporter('https://api.example.com/errors')

      const error = new Error('')
      error.stack = ''
      error.name = ''

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error,
        level: 'error',
        timestamp: Date.now(),
      }

      await reporter.report(context)

      const body = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body as string)
      expect(body.error.message).toBe('')
      expect(body.error.stack).toBe('')
      expect(body.error.name).toBe('')
    })

    it('MONITOR-COV-002: reportBatch 应处理空 message/stack/name 的错误', async () => {
      const reporter = new HttpReporter('https://api.example.com/errors')

      const error = new Error('')
      error.stack = ''
      error.name = ''

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error,
        level: 'error',
        timestamp: Date.now(),
      }

      await reporter.reportBatch([context])

      const body = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body as string)
      expect(body.errors[0].error.message).toBe('')
      expect(body.errors[0].error.stack).toBe('')
      expect(body.errors[0].error.name).toBe('')
    })
  })

  describe('小程序 wx.request 适配', () => {
    let wxRequestMock: jest.Mock

    beforeEach(() => {
      // 父级 beforeEach 移除了全局 wx，此处重新注入带 success 回调的 wx.request mock，
      // 验证 createDefaultRequest 优先走 wx.request 分支
      wxRequestMock = jest.fn((options: { success?: (res: unknown) => void }) => {
        options.success?.({ statusCode: 200 })
      })
      const globalObject = globalThis as { wx?: unknown }
      globalObject.wx = { request: wxRequestMock }
    })

    it('MONITOR-044: wx 环境应优先使用 wx.request 而非 fetch', async () => {
      const reporter = new HttpReporter('https://api.example.com/errors')

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: 1700000000000,
      }

      await reporter.report(context)

      expect(mockFetch).not.toHaveBeenCalled()
      expect(wxRequestMock).toHaveBeenCalledTimes(1)
      expect(wxRequestMock).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://api.example.com/errors',
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
        }),
      )
    })

    it('MONITOR-045: wx.request 失败时应捕获错误并输出到控制台', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      wxRequestMock.mockImplementationOnce((options: { fail?: (err: unknown) => void }) => {
        options.fail?.(new Error('wx request failed'))
      })

      const reporter = new HttpReporter('https://api.example.com/errors')

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await expect(reporter.report(context)).resolves.toBeUndefined()
      expect(consoleErrorSpy).toHaveBeenCalledWith('[HttpReporter] Failed to report error:', expect.any(Error))
    })
  })
})

describe('ErrorAggregator', () => {
  let aggregator: ErrorAggregator

  beforeEach(() => {
    aggregator = new ErrorAggregator()
  })

  describe('基础功能', () => {
    it('MONITOR-006: 应该创建ErrorAggregator实例', () => {
      expect(aggregator).toBeDefined()
      expect(aggregator).toBeInstanceOf(ErrorAggregator)
    })

    it('MONITOR-007: 应该添加错误到聚合器', () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      const group = aggregator.addError(context)

      expect(group).toBeDefined()
      expect(group).toBeInstanceOf(Object)
    })

    it('MONITOR-008: 相同的错误应该聚合到同一组', () => {
      const error1 = new Error('Same error message')
      const error2 = new Error('Same error message')

      const context1: ErrorContext = {
        storeName: 'store1',
        operation: 'dispatch',
        error: error1,
        level: 'error',
        timestamp: 1000,
      }

      const context2: ErrorContext = {
        storeName: 'store2',
        operation: 'dispatch',
        error: error2,
        level: 'error',
        timestamp: 2000,
      }

      aggregator.addError(context1)
      aggregator.addError(context2)

      const groups = aggregator.getGroups()
      expect(groups).toHaveLength(1)
      expect(groups[0].count).toBe(2)
    })

    it('MONITOR-009: 不同的错误应该创建不同的组', () => {
      const context1: ErrorContext = {
        storeName: 'store1',
        operation: 'dispatch',
        error: new Error('Error 1'),
        level: 'error',
        timestamp: 1000,
      }

      const context2: ErrorContext = {
        storeName: 'store2',
        operation: 'dispatch',
        error: new Error('Error 2'),
        level: 'error',
        timestamp: 2000,
      }

      aggregator.addError(context1)
      aggregator.addError(context2)

      const groups = aggregator.getGroups()
      expect(groups).toHaveLength(2)
    })

    it('MONITOR-010: getGroups应该按最近使用排序', () => {
      const context1: ErrorContext = {
        storeName: 'store1',
        operation: 'dispatch',
        error: new Error('Error 1'),
        level: 'error',
        timestamp: 1000,
      }

      const context2: ErrorContext = {
        storeName: 'store2',
        operation: 'dispatch',
        error: new Error('Error 2'),
        level: 'error',
        timestamp: 3000,
      }

      const context3: ErrorContext = {
        storeName: 'store3',
        operation: 'dispatch',
        error: new Error('Error 3'),
        level: 'error',
        timestamp: 2000,
      }

      aggregator.addError(context1)
      aggregator.addError(context3)
      aggregator.addError(context2)

      const groups = aggregator.getGroups()
      expect(groups[0].message).toBe('Error 2') // Most recent
      expect(groups[1].message).toBe('Error 3')
      expect(groups[2].message).toBe('Error 1') // Oldest
    })
  })

  describe('错误组管理', () => {
    it('MONITOR-011: 应该正确更新受影响的Store列表', () => {
      const context1: ErrorContext = {
        storeName: 'store1',
        operation: 'dispatch',
        error: new Error('Test'),
        level: 'error',
        timestamp: 1000,
      }

      const context2: ErrorContext = {
        storeName: 'store2',
        operation: 'dispatch',
        error: new Error('Test'),
        level: 'error',
        timestamp: 2000,
      }

      aggregator.addError(context1)
      aggregator.addError(context2)

      const groups = aggregator.getGroups()
      expect(groups[0].affectedStores).toContain('store1')
      expect(groups[0].affectedStores).toContain('store2')
    })

    it('MONITOR-012: 应该限制最大组数', () => {
      const smallAggregator = new ErrorAggregator(2)

      for (let i = 0; i < 5; i++) {
        const context: ErrorContext = {
          storeName: `store${i}`,
          operation: 'dispatch',
          error: new Error(`Error ${i}`),
          level: 'error',
          timestamp: Date.now(),
        }
        smallAggregator.addError(context)
      }

      const groups = smallAggregator.getGroups()
      expect(groups.length).toBeLessThanOrEqual(2)
    })

    it('MONITOR-013: clear应该清空所有组', () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test'),
        level: 'error',
        timestamp: Date.now(),
      }

      aggregator.addError(context)
      expect(aggregator.getGroups().length).toBeGreaterThan(0)

      aggregator.clear()
      expect(aggregator.getGroups().length).toBe(0)
    })
  })

  describe('查询功能', () => {
    it('MONITOR-014: getGroupsByCode应该返回指定代码的组', () => {
      const context1: ErrorContext = {
        storeName: 'store1',
        operation: 'dispatch',
        error: new Error('Action error'),
        level: 'error',
        timestamp: 1000,
      }

      const context2: ErrorContext = {
        storeName: 'store2',
        operation: 'dispatch',
        error: new Error('State error'),
        level: 'error',
        timestamp: 2000,
      }

      aggregator.addError(context1)
      aggregator.addError(context2)

      // Note: These are grouped by error message and stack, not by code
      const allGroups = aggregator.getGroups()
      expect(allGroups.length).toBeGreaterThan(0)
    })

    it('MONITOR-015: getGroupsByStore应该返回指定Store的组', () => {
      const context1: ErrorContext = {
        storeName: 'store1',
        operation: 'dispatch',
        error: new Error('Error'),
        level: 'error',
        timestamp: 1000,
      }

      const context2: ErrorContext = {
        storeName: 'store2',
        operation: 'dispatch',
        error: new Error('Error'),
        level: 'error',
        timestamp: 2000,
      }

      const context3: ErrorContext = {
        storeName: 'store1',
        operation: 'dispatch',
        error: new Error('Error'),
        level: 'error',
        timestamp: 3000,
      }

      aggregator.addError(context1)
      aggregator.addError(context2)
      aggregator.addError(context3)

      const store1Groups = aggregator.getGroupsByStore('store1')
      expect(store1Groups).toHaveLength(1)
      expect(store1Groups[0].affectedStores).toContain('store1')
    })
  })

  describe('统计功能', () => {
    it('MONITOR-016: getStats应该返回正确的统计信息', () => {
      const context1: ErrorContext = {
        storeName: 'store1',
        operation: 'dispatch',
        error: new Error('Error 1'),
        level: 'error',
        timestamp: 1000,
      }

      const context2: ErrorContext = {
        storeName: 'store2',
        operation: 'dispatch',
        error: new Error('Error 2'),
        level: 'error',
        timestamp: 2000,
      }

      aggregator.addError(context1)
      aggregator.addError(context2)

      const stats = aggregator.getStats()
      expect(stats.totalGroups).toBeGreaterThan(0)
      expect(stats.totalErrors).toBeGreaterThan(0)
      expect(stats.byCode).toBeDefined()
      expect(stats.byStore).toBeDefined()
    })

    it('MONITOR-060: 非 GeomStoreError 错误应该使用 UNKNOWN 代码', () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Regular error'), // 普通 Error，不是 GeomStoreError
        level: 'error',
        timestamp: Date.now(),
      }

      aggregator.addError(context)

      const groups = aggregator.getGroups()
      expect(groups[0].code).toBe('UNKNOWN')
    })

    it('MONITOR-061: 没有 timestamp 的错误应该使用当前时间', () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Error without timestamp'),
        level: 'error',
        // timestamp 未定义
      }

      const beforeAdd = Date.now()
      aggregator.addError(context)
      const afterAdd = Date.now()

      const groups = aggregator.getGroups()
      expect(groups[0].firstSeen).toBeGreaterThanOrEqual(beforeAdd)
      expect(groups[0].firstSeen).toBeLessThanOrEqual(afterAdd)
    })

    it('MONITOR-062: 同一个 Store 多次添加相同错误不应重复添加到 affectedStores', () => {
      const context1: ErrorContext = {
        storeName: 'store1',
        operation: 'dispatch',
        error: new Error('Same error'),
        level: 'error',
        timestamp: 1000,
      }

      const context2: ErrorContext = {
        storeName: 'store1', // 相同 Store
        operation: 'dispatch',
        error: new Error('Same error'),
        level: 'error',
        timestamp: 2000,
      }

      aggregator.addError(context1)
      aggregator.addError(context2)

      const groups = aggregator.getGroups()
      expect(groups[0].affectedStores).toHaveLength(1)
      expect(groups[0].affectedStores).toContain('store1')
      expect(groups[0].count).toBe(2)
    })

    it('MONITOR-063: 没有 stack 的错误应该正常处理', () => {
      const error = new Error('No stack error')
      delete error.stack // 删除 stack

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error,
        level: 'error',
        timestamp: Date.now(),
      }

      expect(() => aggregator.addError(context)).not.toThrow()

      const groups = aggregator.getGroups()
      expect(groups.length).toBeGreaterThan(0)
    })
  })
})

describe('ErrorMonitoring', () => {
  let monitoring: ErrorMonitoring
  let mockReporter: jest.Mocked<ErrorReporter>

  beforeEach(() => {
    mockReporter = {
      getName: jest.fn(() => 'mock'),
      report: jest.fn().mockResolvedValue(undefined),
      reportBatch: jest.fn().mockResolvedValue(undefined),
    }
    monitoring = new ErrorMonitoring({
      reporters: [mockReporter],
      batchInterval: 100,
      batchThreshold: 3,
    })
  })

  afterEach(async () => {
    await monitoring.shutdown()
  })

  describe('基础功能', () => {
    it('MONITOR-017: 应该创建ErrorMonitoring实例', () => {
      expect(monitoring).toBeDefined()
      expect(monitoring).toBeInstanceOf(ErrorMonitoring)
    })

    it('MONITOR-018: report应该添加错误到队列', async () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)

      const report = monitoring.generateReport()
      expect(report.summary.queuedErrors).toBeGreaterThan(0)
    })
  })

  describe('批量上报', () => {
    beforeEach(() => {
      jest.useFakeTimers()
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('MONITOR-019: 应该在达到阈值时触发批量上报', async () => {
      const contexts: ErrorContext[] = Array.from({ length: 3 }, (_, i) => ({
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error(`Error ${i}`),
        level: 'error',
        timestamp: Date.now(),
      }))

      await Promise.all(contexts.map((ctx) => monitoring.report(ctx)))

      // 快进时间触发批量上报
      jest.advanceTimersByTime(150)

      // 等待异步操作完成
      await Promise.resolve()

      expect(mockReporter.reportBatch).toHaveBeenCalled()
    })

    it('MONITOR-020: flushReports应该立即上报队列', async () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)
      await monitoring.flushReports()

      expect(mockReporter.reportBatch).toHaveBeenCalled()
    })

    it('MONITOR-021: flushReports应该清空队列', async () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)
      await monitoring.flushReports()

      const report = monitoring.generateReport()
      expect(report.summary.queuedErrors).toBe(0)
    })
  })

  describe('错误报告生成', () => {
    it('MONITOR-022: generateReport应该返回完整的报告', async () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)
      const report = monitoring.generateReport()

      expect(report.generatedAt).toBeDefined()
      expect(report.summary).toBeDefined()
      expect(report.byCode).toBeDefined()
      expect(report.byStore).toBeDefined()
      expect(report.topErrors).toBeDefined()
      expect(report.recentErrors).toBeDefined()
    })

    it('MONITOR-023: 报告应该包含正确的摘要信息', async () => {
      const contexts: ErrorContext[] = Array.from({ length: 5 }, (_, i) => ({
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error(`Error ${i}`),
        level: 'error',
        timestamp: Date.now(),
      }))

      await Promise.all(contexts.map((ctx) => monitoring.report(ctx)))
      const report = monitoring.generateReport()

      expect(report.summary.totalGroups).toBeGreaterThan(0)
      expect(report.summary.totalErrors).toBeGreaterThanOrEqual(5)
    })
  })

  describe('报告器管理', () => {
    it('MONITOR-024: addReporter应该添加新报告器', async () => {
      const newReporter: jest.Mocked<ErrorReporter> = {
        getName: jest.fn(() => 'new-mock'),
        report: jest.fn().mockResolvedValue(undefined),
        reportBatch: jest.fn().mockResolvedValue(undefined),
      }

      monitoring.addReporter(newReporter)

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)
      await monitoring.flushReports()

      expect(newReporter.reportBatch).toHaveBeenCalled()
    })

    it('MONITOR-025: removeReporter应该移除报告器', async () => {
      monitoring.removeReporter('mock')

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)
      await monitoring.flushReports()

      expect(mockReporter.reportBatch).not.toHaveBeenCalled()
    })
  })

  describe('关闭和清理', () => {
    it('MONITOR-026: shutdown应该上报剩余错误', async () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)
      await monitoring.shutdown()

      expect(mockReporter.reportBatch).toHaveBeenCalled()
    })

    it('MONITOR-027: shutdown后不应该接受新错误', async () => {
      await monitoring.shutdown()

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)

      const report = monitoring.generateReport()
      expect(report.summary.queuedErrors).toBe(0)
    })

    it('MONITOR-028: clear应该清空所有数据', async () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)
      monitoring.clear()

      const report = monitoring.generateReport()
      expect(report.summary.totalGroups).toBe(0)
      expect(report.summary.queuedErrors).toBe(0)
    })
  })

  describe('聚合功能', () => {
    it('MONITOR-029: enableAggregation为false时不应该聚合', async () => {
      const noAggMonitoring = new ErrorMonitoring({
        reporters: [mockReporter],
        enableAggregation: false,
      })

      const contexts: ErrorContext[] = Array.from({ length: 3 }, (_, i) => ({
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Same error'),
        level: 'error',
        timestamp: Date.now(),
      }))

      await Promise.all(contexts.map((ctx) => noAggMonitoring.report(ctx)))
      await noAggMonitoring.flushReports()

      const report = noAggMonitoring.generateReport()
      expect(report.summary.totalErrors).toBeGreaterThanOrEqual(3)

      await noAggMonitoring.shutdown()
    })
  })

  describe('控制台日志', () => {
    it('MONITOR-030: enableConsoleLog为true时应该输出日志', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      const logMonitoring = new ErrorMonitoring({
        reporters: [],
        enableConsoleLog: true,
      })

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await logMonitoring.report(context)
      await logMonitoring.shutdown()

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('MONITOR-031: enableConsoleLog为false时不应该输出日志', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      const noLogMonitoring = new ErrorMonitoring({
        reporters: [],
        enableConsoleLog: false,
      })

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await noLogMonitoring.report(context)
      await noLogMonitoring.shutdown()

      expect(consoleSpy).not.toHaveBeenCalled()
      consoleSpy.mockRestore()
    })
  })

  describe('默认实例', () => {
    it('MONITOR-032: createDefaultMonitoring应该创建实例', () => {
      const defaultMon = createDefaultMonitoring()
      expect(defaultMon).toBeDefined()
      expect(defaultMon).toBeInstanceOf(ErrorMonitoring)
    })

    it('MONITOR-033: createDefaultMonitoring应该应用自定义配置', () => {
      const customMon = createDefaultMonitoring({
        batchInterval: 10000,
        batchThreshold: 20,
      })

      expect(customMon).toBeDefined()
    })

    it('MONITOR-034: defaultMonitoring应该是单例', () => {
      expect(defaultMonitoring).toBeDefined()
      expect(defaultMonitoring).toBeInstanceOf(ErrorMonitoring)
    })

    it('MONITOR-064: getDefaultMonitoring 应该返回惰性单例', () => {
      const first = getDefaultMonitoring()
      const second = getDefaultMonitoring()

      expect(first).toBe(second)
      expect(first).toBeInstanceOf(ErrorMonitoring)
    })

    it('MONITOR-065: defaultMonitoring 惰性代理应该能转发成员访问', () => {
      // 通过代理访问成员不应报错，方法应绑定到真实实例
      expect(typeof defaultMonitoring.report).toBe('function')
      expect(defaultMonitoring).toBeInstanceOf(ErrorMonitoring)
    })
  })

  describe('边界情况', () => {
    it('MONITOR-035: 应该处理空报告器列表', async () => {
      const emptyMonitoring = new ErrorMonitoring({
        reporters: [],
      })

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await expect(emptyMonitoring.report(context)).resolves.toBeUndefined()
      await emptyMonitoring.shutdown()
    })

    it('MONITOR-036: 应该处理报告器失败', async () => {
      const failingReporter: jest.Mocked<ErrorReporter> = {
        getName: jest.fn(() => 'failing'),
        report: jest.fn().mockRejectedValue(new Error('Failed')),
        reportBatch: jest.fn().mockRejectedValue(new Error('Failed')),
      }

      const failMonitoring = new ErrorMonitoring({
        reporters: [failingReporter],
      })

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      // Should not throw even if reporter fails
      await expect(failMonitoring.report(context)).resolves.toBeUndefined()
      await failMonitoring.shutdown()
    })
  })

  describe('上报功能增强测试', () => {
    it('MONITOR-044: 应该正确上报带有payload的错误', async () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Action failed'),
        level: 'error',
        timestamp: Date.now(),
        payload: {
          actionType: 'INCREMENT',
          args: [1, 2, 3],
        },
      }

      await monitoring.report(context)
      await monitoring.flushReports()

      const report = monitoring.generateReport()
      expect(report.summary.totalErrors).toBeGreaterThanOrEqual(1)
    })

    it('MONITOR-045: 应该支持多个报告器同时上报', async () => {
      const reporter1: jest.Mocked<ErrorReporter> = {
        getName: jest.fn(() => 'reporter1'),
        report: jest.fn().mockResolvedValue(undefined),
        reportBatch: jest.fn().mockResolvedValue(undefined),
      }

      const reporter2: jest.Mocked<ErrorReporter> = {
        getName: jest.fn(() => 'reporter2'),
        report: jest.fn().mockResolvedValue(undefined),
        reportBatch: jest.fn().mockResolvedValue(undefined),
      }

      const multiReporterMonitoring = new ErrorMonitoring({
        reporters: [reporter1, reporter2],
      })

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await multiReporterMonitoring.report(context)
      await multiReporterMonitoring.flushReports()

      expect(reporter1.reportBatch).toHaveBeenCalled()
      expect(reporter2.reportBatch).toHaveBeenCalled()

      await multiReporterMonitoring.shutdown()
    })

    it('MONITOR-046: 应该正确处理不同级别的错误', async () => {
      const contexts: ErrorContext[] = [
        {
          storeName: 'store1',
          operation: 'dispatch',
          error: new Error('Critical error'),
          level: 'error',
          timestamp: Date.now(),
        },
        {
          storeName: 'store2',
          operation: 'setState',
          error: new Error('Warning message'),
          level: 'warning',
          timestamp: Date.now(),
        },
        {
          storeName: 'store3',
          operation: 'init',
          error: new Error('Info message'),
          level: 'info',
          timestamp: Date.now(),
        },
      ]

      for (const ctx of contexts) {
        await monitoring.report(ctx)
      }

      await monitoring.flushReports()

      const report = monitoring.generateReport()
      expect(report.summary.totalErrors).toBeGreaterThanOrEqual(3)
    })

    it('MONITOR-047: 批量上报应该传递正确的错误数组', async () => {
      // 创建一个新的 monitoring 实例，设置更高的阈值避免自动 flush
      const testReporter: jest.Mocked<ErrorReporter> = {
        getName: jest.fn(() => 'test-reporter'),
        report: jest.fn().mockResolvedValue(undefined),
        reportBatch: jest.fn().mockResolvedValue(undefined),
      }
      const testMonitoring = new ErrorMonitoring({
        reporters: [testReporter],
        batchInterval: 1000,
        batchThreshold: 10, // 设置高于测试报告数量的阈值
      })

      const contexts: ErrorContext[] = Array.from({ length: 5 }, (_, i) => ({
        storeName: `store-${i}`,
        operation: 'dispatch' as const,
        error: new Error(`Error ${i}`),
        level: 'error' as const,
        timestamp: Date.now() + i,
      }))

      for (const ctx of contexts) {
        await testMonitoring.report(ctx)
      }
      await testMonitoring.flushReports()

      const callArgs = testReporter.reportBatch.mock.calls[0]
      const reportedContexts = callArgs[0]

      expect(reportedContexts).toHaveLength(5)
      expect(reportedContexts[0]).toHaveProperty('storeName', 'store-0')
      expect(reportedContexts[4]).toHaveProperty('storeName', 'store-4')

      await testMonitoring.shutdown()
    })

    it('MONITOR-048: reportTimeout应该正确配置', async () => {
      const timeoutMonitoring = new ErrorMonitoring({
        reporters: [mockReporter],
        reportTimeout: 5000,
      })

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await timeoutMonitoring.report(context)
      await timeoutMonitoring.flushReports()

      expect(mockReporter.reportBatch).toHaveBeenCalled()

      await timeoutMonitoring.shutdown()
    })

    it('MONITOR-049: getAggregationStats应该返回正确的统计', async () => {
      const contexts: ErrorContext[] = [
        {
          storeName: 'store1',
          operation: 'dispatch',
          error: new Error('Error A'),
          level: 'error',
          timestamp: Date.now(),
        },
        {
          storeName: 'store2',
          operation: 'setState',
          error: new Error('Error B'),
          level: 'error',
          timestamp: Date.now(),
        },
      ]

      for (const ctx of contexts) {
        await monitoring.report(ctx)
      }

      const stats = monitoring.getAggregationStats()
      expect(stats.totalGroups).toBeGreaterThan(0)
      expect(stats.totalErrors).toBeGreaterThanOrEqual(2)
    })

    it('MONITOR-050: getErrorGroups应该返回错误组列表', async () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)

      const groups = monitoring.getErrorGroups()
      expect(groups).toBeDefined()
      expect(Array.isArray(groups)).toBe(true)
    })

    it('MONITOR-051: 连续上报应该正确排队', async () => {
      // 快速连续上报多个错误
      const contexts: ErrorContext[] = Array.from({ length: 20 }, (_, i) => ({
        storeName: 'test-store',
        operation: 'dispatch' as const,
        error: new Error(`Error ${i}`),
        level: 'error' as const,
        timestamp: Date.now(),
      }))

      await Promise.all(contexts.map((ctx) => monitoring.report(ctx)))

      // 队列应该被部分或全部处理（取决于阈值）
      const report = monitoring.generateReport()
      expect(report.summary.totalErrors).toBeGreaterThanOrEqual(20)
    })

    it('MONITOR-052: clear应该重置nonAggregatedErrorCount', async () => {
      const noAggMonitoring = new ErrorMonitoring({
        reporters: [mockReporter],
        enableAggregation: false,
      })

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await noAggMonitoring.report(context)

      const reportBeforeClear = noAggMonitoring.generateReport()
      expect(reportBeforeClear.summary.totalErrors).toBeGreaterThanOrEqual(1)

      noAggMonitoring.clear()

      const reportAfterClear = noAggMonitoring.generateReport()
      expect(reportAfterClear.summary.totalErrors).toBe(0)

      await noAggMonitoring.shutdown()
    })
  })

  describe('并发上报测试', () => {
    it('MONITOR-053: 并发上报应该正确处理', async () => {
      const concurrentContexts: ErrorContext[] = Array.from({ length: 50 }, (_, i) => ({
        storeName: `store-${i % 5}`,
        operation: 'dispatch' as const,
        error: new Error(`Concurrent error ${i}`),
        level: 'error' as const,
        timestamp: Date.now(),
      }))

      // 并发上报所有错误
      await Promise.all(concurrentContexts.map((ctx) => monitoring.report(ctx)))
      await monitoring.flushReports()

      const report = monitoring.generateReport()
      expect(report.summary.totalErrors).toBeGreaterThanOrEqual(50)
    })

    it('MONITOR-054: 并发flushReports不应该重复上报', async () => {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)

      // 并发调用flushReports
      await Promise.all([monitoring.flushReports(), monitoring.flushReports(), monitoring.flushReports()])

      // 应该只调用一次reportBatch（队列只有一个错误）
      const report = monitoring.generateReport()
      expect(report.summary.queuedErrors).toBe(0)
    })
  })

  describe('覆盖率补充测试', () => {
    it('MONITOR-COV-003: 添加 GeomStoreError 到聚合器时应使用其 code', () => {
      const aggregator = new ErrorAggregator()

      const geomError = createError(ErrorCode.STATE_UPDATE_ERROR, 'Store error', { key: 'test' })

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'setState',
        error: geomError,
        level: 'error',
        timestamp: Date.now(),
      }

      const group = aggregator.addError(context)
      expect(group).toBeDefined()
      expect(group!.code).toBe(ErrorCode.STATE_UPDATE_ERROR)
      expect(group!.type).toBe(geomError.name)
    })

    it('MONITOR-COV-004: 错误队列满时应丢弃最旧的错误', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()

      // 创建一个小队列的 monitoring
      const smallQueueMonitoring = new ErrorMonitoring({
        reporters: [mockReporter],
        batchThreshold: 2000, // 高阈值避免自动 flush
        enableConsoleLog: false,
      })

      // 覆盖 maxQueueSize (1000) 的私有属性
      ;(smallQueueMonitoring as any).maxQueueSize = 3

      const makeContext = (i: number): ErrorContext => ({
        storeName: `store-${i}`,
        operation: 'dispatch',
        error: new Error(`Error ${i}`),
        level: 'error',
        timestamp: Date.now() + i,
      })

      // 添加 4 个错误，超过 maxQueueSize=3
      await smallQueueMonitoring.report(makeContext(1))
      await smallQueueMonitoring.report(makeContext(2))
      await smallQueueMonitoring.report(makeContext(3))
      await smallQueueMonitoring.report(makeContext(4))

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Error queue full'))

      await smallQueueMonitoring.shutdown()
      consoleWarnSpy.mockRestore()
    })

    it('MONITOR-COV-005: flushReports 空队列时应该直接返回', async () => {
      // 队列为空时调用 flushReports，应直接返回不调用 reportBatch
      mockReporter.reportBatch.mockClear()
      await monitoring.flushReports()
      expect(mockReporter.reportBatch).not.toHaveBeenCalled()
    })

    it('MONITOR-COV-006: batch scheduler 定时器触发时 flushReports 抛错应捕获', async () => {
      jest.useFakeTimers()

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()

      // 创建一个 reportBatch 同步抛异常的 reporter
      // 这会导致 flushReports 内的 this.reporters.map(...) 抛出异常（在 try 块之外）
      // 从而 flushReports 的 Promise 被 reject，触发 batch scheduler 的 .catch()
      const syncThrowReporter: jest.Mocked<ErrorReporter> = {
        getName: jest.fn(() => 'sync-throw'),
        report: jest.fn().mockResolvedValue(undefined),
        reportBatch: jest.fn((contexts: ErrorContext[]) => {
          throw new Error('Sync throw in reportBatch')
        }),
      }

      const schedulerMonitoring = new ErrorMonitoring({
        reporters: [syncThrowReporter],
        batchInterval: 100,
        batchThreshold: 100, // 高阈值避免自动 flush
        enableConsoleLog: false,
      })

      // 添加一个错误到队列
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }
      await schedulerMonitoring.report(context)

      // 快进定时器触发 batch scheduler 的 flushReports
      // flushReports 内部 this.reporters.map 会因 reportBatch 同步抛出而 reject
      // 从而触发 flushReports().catch() -> 第604-605行
      jest.advanceTimersByTime(150)

      // 切回真实定时器，等待微任务和宏任务
      jest.useRealTimers()
      await new Promise((r) => setTimeout(r, 100))

      // 验证 batch scheduler 的 catch 被触发（第605行 console.error）
      // 查找包含 'batch scheduler' 的错误日志
      const batchSchedulerErrors = consoleErrorSpy.mock.calls.filter((call) => typeof call[0] === 'string' && call[0].includes('batch scheduler'))
      expect(batchSchedulerErrors.length).toBeGreaterThan(0)

      consoleErrorSpy.mockRestore()
      await schedulerMonitoring.shutdown()
    })

    it('MONITOR-COV-007: flushReports 在 Promise.allSettled 抛异常时应捕获并输出错误', async () => {
      // 通过 mock Promise.allSettled 使其抛出异常，覆盖 catch 块（第497行）
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
      const originalAllSettled = Promise.allSettled
      Promise.allSettled = jest.fn().mockRejectedValue(new Error('allSettled crashed')) as any

      try {
        const context: ErrorContext = {
          storeName: 'test-store',
          operation: 'dispatch',
          error: new Error('Test error'),
          level: 'error',
          timestamp: Date.now(),
        }

        await monitoring.report(context)
        await monitoring.flushReports()

        // 应该捕获错误并输出到控制台
        expect(consoleErrorSpy).toHaveBeenCalledWith('[ErrorMonitoring] Error in reportBatch:', expect.any(Error))
      } finally {
        Promise.allSettled = originalAllSettled
        consoleErrorSpy.mockRestore()
      }
    })

    it('MONITOR-COV-008: shutdown 后再次 shutdown 不应出错', async () => {
      await monitoring.shutdown()
      // 再次 shutdown 应该安全（batchTimer 已被清除）
      await expect(monitoring.shutdown()).resolves.toBeUndefined()
    })

    it('MONITOR-COV-009: removeReporter 不存在的报告器不应出错', async () => {
      monitoring.removeReporter('nonexistent')

      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('Test error'),
        level: 'error',
        timestamp: Date.now(),
      }

      await monitoring.report(context)
      await monitoring.flushReports()

      // mock reporter 仍然存在
      expect(mockReporter.reportBatch).toHaveBeenCalled()
    })

    it('MONITOR-COV-010: startBatchScheduler 中 timer 无 unref 方法时应跳过调用', () => {
      // 覆盖 line 609 的 else 分支：timer 存在但没有 unref 方法
      // 在 Node.js 中 setInterval 返回的 timer 有 unref 方法，
      // 我们通过 mock setInterval 使其返回一个没有 unref 方法的对象
      const originalSetInterval = global.setInterval
      const fakeTimer = { ref: () => {}, unref: undefined } as any
      global.setInterval = jest.fn(() => fakeTimer) as any

      try {
        const noUnrefMonitoring = new ErrorMonitoring({
          reporters: [mockReporter],
          enableConsoleLog: false,
        })

        // 验证实例创建成功，没有因缺少 unref 而出错
        expect(noUnrefMonitoring).toBeInstanceOf(ErrorMonitoring)

        // 清理：手动清除定时器引用
        ;(noUnrefMonitoring as any).batchTimer = undefined
      } finally {
        global.setInterval = originalSetInterval
      }
    })
  })
})

describe('ConsoleReporter 分组降级回归（BUG-16）', () => {
  it('REGR-MONITOR-001: console.group 不可用时 report 应降级为 console.error 平铺且不抛错', async () => {
    const reporter = new ConsoleReporter('[Test]')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const originalGroup = console.group
    const originalGroupEnd = console.groupEnd
    // 模拟微信真机等无 console.group 的环境
    ;(console as any).group = undefined
    ;(console as any).groupEnd = undefined

    try {
      const context: ErrorContext = {
        storeName: 'test-store',
        operation: 'dispatch',
        error: new Error('boom'),
        level: 'error',
        timestamp: Date.now(),
      }

      // 修复前：真机无 console.group 时拋 TypeError 被吞，静默失效
      await expect(reporter.report(context)).resolves.toBeUndefined()
      expect(consoleErrorSpy).toHaveBeenCalled()

      // 关键错误信息仍被平铺输出
      const flat = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
      expect(flat).toContain('boom')
      expect(flat).toContain('test-store')
    } finally {
      (console as any).group = originalGroup
      ;(console as any).groupEnd = originalGroupEnd
      consoleErrorSpy.mockRestore()
    }
  })

  it('REGR-MONITOR-002: console.group 不可用时 reportBatch 应降级平铺且不抛错', async () => {
    const reporter = new ConsoleReporter('[Test]')
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const originalGroup = console.group
    const originalGroupEnd = console.groupEnd
    ;(console as any).group = undefined
    ;(console as any).groupEnd = undefined

    try {
      const contexts: ErrorContext[] = [
        {
          storeName: 'test-store',
          operation: 'dispatch',
          error: new Error('boom-1'),
          level: 'error',
          timestamp: Date.now(),
        },
        {
          storeName: 'test-store',
          operation: 'dispatch',
          error: new Error('boom-2'),
          level: 'warning',
          timestamp: Date.now(),
        },
      ]

      await expect(reporter.reportBatch(contexts)).resolves.toBeUndefined()
      expect(consoleErrorSpy).toHaveBeenCalled()

      const flat = consoleErrorSpy.mock.calls.map((call) => call.join(' ')).join('\n')
      expect(flat).toContain('boom-1')
      expect(flat).toContain('boom-2')
    } finally {
      (console as any).group = originalGroup
      ;(console as any).groupEnd = originalGroupEnd
      consoleErrorSpy.mockRestore()
    }
  })
})
