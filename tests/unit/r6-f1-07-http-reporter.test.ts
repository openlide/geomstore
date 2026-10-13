/**
 * 第六轮 f1-07 分片回归（R6-049 / R6-095）
 *
 * 覆盖的公开行为：
 * - 四个标量字段（storeName/operation/level/timestamp）按 payload 同一口径收成 JSON 安全值
 * - 一条上下文导致本条不可序列化时只降级它自己，批次其余条目照常交付（reportBatch 不 reject）
 * - `reportBatch` 收到非数组时按空批次处理
 * - wx.request 的 `fail` 载荷（`{errMsg, errno}`）进 Error 文本并挂到 `cause`
 */

import { HttpReporter, type HttpRequestImpl } from '@/extras/error/reporters/HttpReporter.js'
import type { ErrorContext, ErrorLevel } from '@/types/error.js'

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

function captureImpl(): { calls: { body: string }[]; impl: HttpRequestImpl } {
  const calls: { body: string }[] = []
  const impl: HttpRequestImpl = async (_url, body) => {
    calls.push({ body })
  }
  return { calls, impl }
}

type BatchBody = {
  errors: {
    error: { message: string }
    storeName?: string
    level?: string
    timestamp?: string | number
    payload?: unknown
  }[]
}

describe('R6-049 不可序列化的防线覆盖到标量字段与批次组装', () => {
  it('BigInt timestamp / Symbol level 收成字符串，整批不 reject', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)

    await expect(
      reporter.reportBatch([
        context({ storeName: 'bad-time', timestamp: 1234n as unknown as number }),
        context({ storeName: 'bad-level', level: Symbol('critical') as unknown as ErrorLevel }),
        context({ storeName: 'ok-store' }),
      ]),
    ).resolves.toBeUndefined()

    const body = JSON.parse(calls[0].body) as BatchBody
    expect(body.errors).toHaveLength(3)
    expect(body.errors[0].timestamp).toBe('1234')
    expect(body.errors[0].storeName).toBe('bad-time')
    expect(body.errors[1].level).toBe('Symbol(critical)')
    expect(body.errors[2].storeName).toBe('ok-store')
    expect(body.errors[2].error.message).toBe('probe')
  })

  it('对象值的标量字段降级为类型标记，不带着 getter 进入序列化', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)

    await reporter.report(context({ storeName: { nested: true } as unknown as string }))

    expect(JSON.parse(calls[0].body)).toMatchObject({ storeName: '[object]' })
  })

  it('非幂等 toJSON：首次取值即可序列化的条目照常交付（不再被自己的第二次取值拖垮）', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)
    let accesses = 0
    const flaky = {
      toJSON: () => {
        accesses++
        if (accesses > 1) {
          throw new TypeError('second pass boom')
        }
        return { ok: 1 }
      },
    }

    await expect(
      reporter.reportBatch([context({ storeName: 'first' }), context({ storeName: 'flaky-store', payload: flaky }), context({ storeName: 'third' })]),
    ).resolves.toBeUndefined()

    const body = JSON.parse(calls[0].body) as BatchBody
    expect(body.errors).toHaveLength(3)
    expect(body.errors[0].storeName).toBe('first')
    expect(body.errors[2].storeName).toBe('third')
    // 行为变更（快路径序列化，R6-049 第二层防线的触发条件随之改变）：此前投影阶段会先用
    // 一次试用 stringify 消耗掉「首次取值」，正式序列化撞上「第二次取值抛错」，该条被换成
    // `[Unserializable error context]` 标记片段——首过本就成功、可交付的上下文被白白降级。
    // 现在常见路径只序列化一次，首过成功即交付原值；慢路径（快路径串化失败才进入）仍保留
    // 逐字段降级，见下一条用例
    expect(body.errors[1].storeName).toBe('flaky-store')
    expect((body.errors[1].payload as { ok?: number }).ok).toBe(1)
    expect(accesses).toBe(1)
  })

  it('首次取值即抛的 toJSON 走慢路径降级，只影响它自己那一条', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)
    const thrower = {
      toJSON: () => {
        throw new TypeError('first pass boom')
      },
    }

    await expect(
      reporter.reportBatch([context({ storeName: 'first' }), context({ storeName: 'throw-store', payload: thrower }), context({ storeName: 'third' })]),
    ).resolves.toBeUndefined()

    const body = JSON.parse(calls[0].body) as BatchBody
    expect(body.errors).toHaveLength(3)
    expect(body.errors[0].storeName).toBe('first')
    expect(body.errors[2].storeName).toBe('third')
    // 出问题的那条被换成专名标记，原因仍可排查；批次不 reject（否则监控层会按网络失败
    // 反复重入队，最终整批丢弃且原因显示为「报告器恒失败」）
    expect(String(body.errors[1].payload)).toContain('[Unserializable payload:')
    expect(String(body.errors[1].payload)).toContain('first pass boom')
    expect(body.errors[1].storeName).toBe('throw-store')
  })

  it('reportBatch 收到非数组时按空批次处理（与 ConsoleReporter 同口径）', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)

    await expect(reporter.reportBatch(null as unknown as ErrorContext[])).resolves.toBeUndefined()
    expect(calls[0].body).toBe('{"errors":[]}')
  })

  it('单条 body 与批量条目仍是同一投影（键集合一致）', async () => {
    const { calls, impl } = captureImpl()
    const reporter = new HttpReporter(ENDPOINT, {}, impl)

    await reporter.report(context())
    await reporter.reportBatch([context()])

    const single = JSON.parse(calls[0].body) as Record<string, unknown>
    const batch = JSON.parse(calls[1].body) as BatchBody
    expect(Object.keys(single).sort()).toEqual(Object.keys(batch.errors[0]).sort())
  })
})

describe('R6-095 wx.request fail 载荷的原因不再被丢掉', () => {
  let wxBackup: unknown

  beforeEach(() => {
    wxBackup = (globalThis as { wx?: unknown }).wx
  })

  afterEach(() => {
    Object.assign(globalThis, { wx: wxBackup })
  })

  function stubWxRequest(fail: (options: { fail: (err: unknown) => void }) => void): void {
    Object.assign(globalThis, { wx: { request: (options: { fail: (err: unknown) => void }) => fail(options) } })
  }

  it('errMsg 与 errno 都进入 Error 文本，原始载荷挂在 cause 上', async () => {
    stubWxRequest((options) => options.fail({ errMsg: 'request:fail url not in domain list', errno: 600008 }))
    const reporter = new HttpReporter(ENDPOINT)

    const caught = (await reporter.report(context()).catch((reason: unknown) => reason)) as Error & { cause?: unknown }

    expect(caught).toBeInstanceOf(Error)
    expect(caught.message).toContain('wx.request failed')
    expect(caught.message).toContain('request:fail url not in domain list')
    expect(caught.message).toContain('600008')
    expect(caught.cause).toEqual({ errMsg: 'request:fail url not in domain list', errno: 600008 })
  })

  it('超时类失败可按原因区分，不再全是同一句常量', async () => {
    stubWxRequest((options) => options.fail({ errMsg: 'request:fail timeout' }))
    const timeoutReason = (await new HttpReporter(ENDPOINT).report(context()).catch((reason: unknown) => reason)) as Error
    expect(timeoutReason.message).toBe('wx.request failed: request:fail timeout')
    expect(timeoutReason.message).not.toBe('wx.request failed')
  })

  it('字符串载荷原样作为原因；空载荷与 Error 载荷保持既有行为', async () => {
    stubWxRequest((options) => options.fail('boom from wx'))
    await expect(new HttpReporter(ENDPOINT).report(context())).rejects.toThrow('wx.request failed: boom from wx')

    stubWxRequest((options) => options.fail(null))
    await expect(new HttpReporter(ENDPOINT).report(context())).rejects.toThrow('wx.request failed')

    const original = new Error('already an error')
    stubWxRequest((options) => options.fail(original))
    await expect(new HttpReporter(ENDPOINT).report(context())).rejects.toBe(original)
  })
})
