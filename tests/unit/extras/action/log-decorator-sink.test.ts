/**
 * withLog 的输出目标与脱敏策略回归（第四轮 medium 波次）
 *
 * 覆盖三条此前没有测试的分支：自定义 sink、调用方自带 redact、
 * 以及生产构建下的缺省摘要（不输出内容，避免 token/PII 随日志外泄）。
 */

import { withLog, type LogPhase } from '@/extras/action/decorators/log.js'

/** 手工套用方法装饰器，避免在测试里依赖装饰器语法糖 */
function apply<M extends (...args: never[]) => unknown>(method: M, decorator: MethodDecorator): M {
  const descriptor: PropertyDescriptor = { value: method, writable: true, configurable: true, enumerable: true }
  decorator({}, 'decorated', descriptor)
  return descriptor.value as M
}

describe('withLog 的 sink 与 redact', () => {
  it('缺省输出到 console，并原样带上 args / result', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
    const decorated = apply((n: number) => n * 2, withLog('double'))

    expect(decorated(3)).toBe(6)
    expect(logSpy).toHaveBeenNthCalledWith(1, '[Action] double started with args:', [3])
    expect(logSpy).toHaveBeenNthCalledWith(2, '[Action] double completed with result:', 6)
    logSpy.mockRestore()
  })

  it('自定义 sink 接管输出，redact 按阶段生效且能改写内容', () => {
    const out: Array<[string, unknown]> = []
    const phases: LogPhase[] = []
    const sink = {
      log: (message: string, data: unknown) => out.push(['log:' + message, data]),
      error: (message: string, data: unknown) => out.push(['error:' + message, data]),
    }
    const decorated = apply((): number => {
      throw new Error('secret-token')
    }, withLog('login', {
      sink,
      redact: (value, phase) => {
        phases.push(phase)
        return phase === 'error' ? '[redacted]' : value
      },
    }))

    expect(() => decorated()).toThrow('secret-token')
    expect(out[0][1]).toEqual([])
    expect(out[1]).toEqual(['error:[Action] login failed:', '[redacted]'])
    expect(phases).toEqual(['args', 'error'])
  })
})

describe('withLog 生产构建下的缺省摘要', () => {
  const prevNodeEnv = process.env.NODE_ENV

  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv
    jest.resetModules()
  })

  /** 生产判定按模块实例缓存，因此必须在隔离的模块注册表里重新加载 log 模块 */
  const loadInProduction = () => {
    process.env.NODE_ENV = 'production'
    let loaded: typeof import('@/extras/action/decorators/log.js') | undefined
    jest.isolateModules(() => {
      loaded = require('@/extras/action/decorators/log.js') as typeof import('@/extras/action/decorators/log.js')
    })
    return loaded as typeof import('@/extras/action/decorators/log.js')
  }

  it('未显式传 redact 时按结构摘要，不输出内容', () => {
    const resultSummaries: unknown[] = []
    const { withLog: prodWithLog } = loadInProduction()
    const sink = {
      log: (message: string, data: unknown) => {
        if (message.includes('completed with result')) resultSummaries.push(data)
      },
      error: jest.fn(),
    }

    const decorated = apply((value: unknown) => value, prodWithLog('mix', { sink }))

    for (const value of [1, [1, 2, 3], { a: 1, b: 2 }, new TypeError('inner'), null, undefined]) {
      decorated(value)
    }

    expect(resultSummaries).toEqual([
      'number',
      'Array(3)',
      'Object{2 keys}',
      'TypeError: inner',
      'null',
      'undefined',
    ])
  })

  it('显式 redact 覆盖生产缺省策略（调用方自行评估过脱敏口径）', () => {
    const out: unknown[] = []
    const { withLog: prodWithLog } = loadInProduction()
    const sink = { log: (_message: string, data: unknown) => out.push(data), error: jest.fn() }

    const decorated = apply((n: number) => n, prodWithLog('raw', { sink, redact: (value) => value }))
    decorated(7)

    expect(out).toEqual([[7], 7])
  })
})
