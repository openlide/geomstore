/**
 * 第五轮 extras-error 分片回归（报告器侧：R5-198 / R5-199 / R5-200 / R5-213 / R5-214 / R5-215 / R5-216）
 *
 * 覆盖的公开行为：
 * - ConsoleReporter 打印 falsy payload（0 / '' / false），只跳过 undefined 与 null
 * - console.groupEnd 抛错不再掩盖组内输出的原始失败；分组仍恰好闭合一次
 * - 批量行的 store 名缺失时给 UNKNOWN 占位，而不是模板里插进字面量 undefined
 * - 一条畸形 context（error 为 null/undefined/原始值）不再让整个 reportBatch 失败
 * - BigInt / 循环引用载荷在投影阶段降级为字符串，批次仍可发送
 * - 自定义 options 不再丢掉 JSON content-type（默认请求实现兜底，注入实现不受影响）
 * - 单条与批量共用同一条传输拼装（method/headers/字段投影不会各改一处）
 */

import { ConsoleReporter, HttpReporter } from '@/extras/error/index.js'
import type { HttpRequestImpl } from '@/extras/error/reporters/HttpReporter.js'
import type { ErrorContext } from '@/types/error.js'

const ENDPOINT = 'https://example.com/report'

function context(overrides: Partial<ErrorContext> = {}): ErrorContext {
  return {
    storeName: 'probe-store',
    operation: 'dispatch',
    error: new Error('probe'),
    level: 'error',
    timestamp: 1,
    ...overrides,
  }
}

/** 记录每次传输收到的实参，用于断言 body 文本与请求参数 */
function captureImpl(): { calls: { url: string; body: string; method: string; headers: Record<string, string> }[]; impl: HttpRequestImpl } {
  const calls: { url: string; body: string; method: string; headers: Record<string, string> }[] = []
  const impl: HttpRequestImpl = async (url, body, method, headers) => {
    calls.push({ url, body, method, headers })
  }
  return { calls, impl }
}

type BatchBody = { errors: { error: { message: string; stack: string; name: string }; storeName?: string; payload?: unknown }[] }

describe('R5-198 falsy payload 必须打印', () => {
  it.each([
    ['number 0', 0],
    ['空字符串', ''],
    ['boolean false', false],
    ['NaN', Number.NaN],
  ])('payload 为 %s 时仍输出一行 Payload:', async (_label, payload) => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = new ConsoleReporter()

    await reporter.report(context({ payload }))

    expect(errorSpy).toHaveBeenCalledWith('Payload:', payload)
    errorSpy.mockRestore()
  })

  it('只有 undefined 与显式 null 视为「没带 payload」', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = new ConsoleReporter()

    await reporter.report(context())
    await reporter.report(context({ payload: null }))

    const payloadLines = errorSpy.mock.calls.filter((call) => call[0] === 'Payload:')
    expect(payloadLines).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledWith('Timestamp:', expect.any(String))
    errorSpy.mockRestore()
  })
})

describe('R5-199 groupEnd 的异常不得顶替原始失败', () => {
  it('组内输出抛错且 groupEnd 也抛错时，向外传播的是组内那个异常', async () => {
    const primary = new Error('primary print failure')
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      throw primary
    })
    const closeSpy = jest.spyOn(console, 'groupEnd').mockImplementation(() => {
      throw new Error('groupEnd boom')
    })
    const reporter = new ConsoleReporter()

    // toBe 而非 toThrow('groupEnd boom')：断言的是「哪个异常」而不是「有没有异常」
    await expect(reporter.report(context())).rejects.toBe(primary)
    // 组仍必须恰好闭合一次，否则后续所有输出留在已打开的分组里
    expect(closeSpy).toHaveBeenCalledTimes(1)

    errorSpy.mockRestore()
    closeSpy.mockRestore()
  })

  it('组内输出成功而 groupEnd 抛错时，仍算本报告器一次真实失败', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'groupEnd').mockImplementation(() => {
      throw new Error('close boom')
    })
    const reporter = new ConsoleReporter()

    // 吞掉它会把「一条都没落地」判成上报成功并让监控层丢弃批次
    await expect(reporter.report(context())).rejects.toThrow('close boom')

    errorSpy.mockRestore()
    jest.restoreAllMocks()
  })

  it('console.group 自身调用即抛时降级平铺，且只试探一次', async () => {
    const groupSpy = jest.spyOn(console, 'group').mockImplementation(() => {
      throw new Error('group boom')
    })
    const closeSpy = jest.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = new ConsoleReporter()

    await reporter.report(context())
    await reporter.report(context())

    expect(groupSpy).toHaveBeenCalledTimes(1)
    expect(closeSpy).not.toHaveBeenCalled()
    // 平铺路径同样打全字段（带头部前缀），信息不因降级而少
    expect(errorSpy).toHaveBeenCalledWith('[ErrorMonitoring] ERROR Error:', expect.any(Error))
    expect(errorSpy).toHaveBeenCalledWith('[ErrorMonitoring] ERROR Timestamp:', expect.any(String))

    groupSpy.mockRestore()
    closeSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

describe('R5-200 批量行的 store 名占位', () => {
  it('缺失/空串时打 UNKNOWN，正常时原样', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = new ConsoleReporter()

    await reporter.reportBatch([context({ storeName: undefined as unknown as string }), context({ storeName: '' }), context({ storeName: 'user-store' })])

    expect(errorSpy).toHaveBeenCalledWith('[1] ERROR in UNKNOWN:', expect.any(Error))
    expect(errorSpy).toHaveBeenCalledWith('[2] ERROR in UNKNOWN:', expect.any(Error))
    expect(errorSpy).toHaveBeenCalledWith('[3] ERROR in user-store:', expect.any(Error))
    expect(errorSpy.mock.calls.flat().some((entry) => typeof entry === 'string' && entry.includes('in undefined'))).toBe(false)

    errorSpy.mockRestore()
  })
})

describe('R5-213 畸形 context.error 不再拖垮整批', () => {
  it.each([[null], [undefined], ['boom'], [42], [{}]])('error 为 %p：批次仍 resolve，其余上下文照常投递', async (rawError) => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)

    await expect(reporter.reportBatch([context({ error: rawError as unknown as Error }), context({ storeName: 'ok-store' })])).resolves.toBeUndefined()

    const body = JSON.parse(calls[0].body) as BatchBody
    expect(body.errors).toHaveLength(2)
    expect(body.errors[1].storeName).toBe('ok-store')
    expect(body.errors[1].error.message).toBe('probe')
  })

  it('非 Error 抛值收口为可读形态（与 defaultErrorHandler 的 String(error) 同口径）', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)

    await reporter.reportBatch([
      context({ error: null as unknown as Error }),
      context({ error: 'boom' as unknown as Error }),
      context({ error: 42 as unknown as Error }),
    ])

    const body = JSON.parse(calls[0].body) as BatchBody
    expect(body.errors[0].error).toEqual({ message: '', stack: '', name: 'Error' })
    expect(body.errors[1].error.message).toBe('boom')
    expect(body.errors[2].error.message).toBe('42')
  })
})

describe('R5-214 不可序列化载荷只影响它自己那一条', () => {
  it('BigInt / 循环引用降级为字符串标记，body 仍是合法 JSON', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)
    const circular: Record<string, unknown> = { name: 'loop' }
    circular.self = circular

    await expect(
      reporter.reportBatch([
        context({ storeName: 'a', payload: 10n }),
        context({ storeName: 'b', payload: circular }),
        context({ storeName: 'c', payload: { deep: { big: 1n } } }),
        context({ storeName: 'ok-store', payload: { keep: 1 } }),
      ]),
    ).resolves.toBeUndefined()

    const body = JSON.parse(calls[0].body) as BatchBody
    expect(body.errors[0].payload).toBe('[bigint 10]')
    expect(String(body.errors[1].payload)).toMatch(/^\[Unserializable payload: .*circular/i)
    expect(String(body.errors[2].payload)).toMatch(/^\[Unserializable payload: .*BigInt/)
    // 好载荷不被牵连：仍是原对象
    expect(body.errors[3].payload).toEqual({ keep: 1 })
  })

  it('symbol / function 载荷字符串化保留诊断信息（JSON 本会把它们静默丢弃）', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)

    await reporter.reportBatch([
      context({ storeName: 'a', payload: Symbol('tag') }),
      context({ storeName: 'b', payload: () => 1 }),
      context({ storeName: 'c', payload: 7 }),
    ])

    const body = JSON.parse(calls[0].body) as BatchBody
    // String(symbol) 而非模板串插值：后者对 symbol 会抛 TypeError
    expect(body.errors[0].payload).toBe('[symbol Symbol(tag)]')
    expect(String(body.errors[1].payload).startsWith('[function ')).toBe(true)
    // 其余原始类型原样保留
    expect(body.errors[2].payload).toBe(7)
  })

  it('payload 的 toJSON 返回 undefined 时 body 仍是合法 JSON 文本（JsonBody 前提成立）', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)

    await reporter.report(context({ payload: { toJSON: () => undefined } }))

    // 顶层恒是本模块构造的对象字面量（无 toJSON），故 stringify 不会整体返回 undefined；
    // 嵌套层 toJSON() → undefined 只是把 payload 键丢掉（数组元素才会被写成 null）
    expect(typeof calls[0].body).toBe('string')
    expect(calls[0].body.startsWith('{')).toBe(true)
    const parsed = JSON.parse(calls[0].body) as Record<string, unknown>
    expect('payload' in parsed).toBe(false)
    expect(parsed.storeName).toBe('probe-store')
  })
})

describe('R5-215 JSON content-type 是兜底而非默认参数', () => {
  let wxBackup: unknown
  let fetchBackup: unknown

  beforeEach(() => {
    wxBackup = (globalThis as Record<string, unknown>).wx
    fetchBackup = (globalThis as Record<string, unknown>).fetch
  })

  afterEach(() => {
    const host = globalThis as Record<string, unknown>
    if (wxBackup === undefined) delete host.wx
    else host.wx = wxBackup
    if (fetchBackup === undefined) delete host.fetch
    else host.fetch = fetchBackup
  })

  it('fetch 分支：调用方只传 method 时仍声明 application/json', async () => {
    delete (globalThis as Record<string, unknown>).wx
    const sent: { method?: string; headers?: Record<string, string> }[] = []
    Object.assign(globalThis, {
      fetch: async (_url: string, init: { method?: string; headers?: Record<string, string> }) => {
        sent.push(init)
        return { ok: true, status: 204 }
      },
    })
    // 默认参数对象被整体替换（里头不再有 headers），不兜底就会以 text/plain 发一份 JSON
    const reporter = new HttpReporter(ENDPOINT, { method: 'PUT' })

    await reporter.report(context())

    expect(sent[0].method).toBe('PUT')
    expect(sent[0].headers?.['Content-Type']).toBe('application/json')
  })

  it('调用方自带 content-type（任意大小写）时原样保留', async () => {
    delete (globalThis as Record<string, unknown>).wx
    const sent: { headers?: Record<string, string> }[] = []
    Object.assign(globalThis, {
      fetch: async (_url: string, init: { headers?: Record<string, string> }) => {
        sent.push(init)
        return { ok: true, status: 204 }
      },
    })
    const reporter = new HttpReporter(ENDPOINT, { headers: { 'content-type': 'application/vnd.api+json' } })

    await reporter.report(context())

    expect(sent[0].headers).toEqual({ 'content-type': 'application/vnd.api+json' })
  })

  it('wx 分支同样兜底 header', async () => {
    delete (globalThis as Record<string, unknown>).fetch
    let sent: { header?: Record<string, string>; data?: string } = {}
    Object.assign(globalThis, {
      wx: {
        request: (options: { header?: Record<string, string>; data?: string; success: (res: { statusCode: number }) => void }) => {
          sent = options
          options.success({ statusCode: 204 })
        },
      },
    })
    const reporter = new HttpReporter(ENDPOINT, { method: 'POST' })

    await reporter.report(context())

    expect(sent.header).toEqual({ 'Content-Type': 'application/json' })
    expect(() => JSON.parse(String(sent.data))).not.toThrow()
  })

  it('注入的请求实现收到的是归一化后的调用方请求头（不被兜底污染）', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, { headers: { Authorization: 'Bearer x' } }, impl)

    await reporter.report(context())

    expect(calls[0].headers).toEqual({ Authorization: 'Bearer x' })
  })
})

describe('R5-216 单条与批量共用同一条传输路径', () => {
  it('两个入口的 method/headers 完全一致，字段投影同源', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, { method: 'PATCH', headers: { 'X-Token': 'a' } }, impl)

    await reporter.report(context())
    await reporter.reportBatch([context()])

    expect(calls.map((call) => [call.url, call.method, call.headers])).toEqual([
      [ENDPOINT, 'PATCH', { 'X-Token': 'a' }],
      [ENDPOINT, 'PATCH', { 'X-Token': 'a' }],
    ])

    const single = JSON.parse(calls[0].body) as Record<string, unknown>
    const batch = JSON.parse(calls[1].body) as BatchBody
    expect(Object.keys(single).sort()).toEqual(Object.keys(batch.errors[0]).sort())
  })
})
