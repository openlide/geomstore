/**
 * G2-extras medium 第 1 片（#235 / #239-#242 / #246-#252）的审计回归用例
 *
 * 逐条锁定「报告成立后新固化的行为」：统计稀疏键、聚合器驱逐与指纹校验、
 * 样本脱敏刷新、函数宿主共享 loader、控制台降级/防御/单一格式、
 * 节流器的按宿主 Promise 标记、新窗口作废尾调用定时器、interval 规范化。
 */

import { ErrorAggregator, ConsoleReporter } from '@/extras/error/index.js'
import { ErrorHandlerImpl } from '@/extras/error/ErrorHandler.js'
import { withThrottle } from '@/extras/action/decorators/throttle.js'
import type { ErrorContext } from '@/types/error.js'

/** 遮蔽 console.group/groupEnd 以走平铺降级路径（定义在原型上，需自有属性遮蔽） */
function hideConsoleGroup(): void {
  Object.defineProperty(console, 'group', { value: undefined, configurable: true, writable: true })
  Object.defineProperty(console, 'groupEnd', { value: undefined, configurable: true, writable: true })
}

function restoreConsoleGroup(): void {
  Reflect.deleteProperty(console, 'group')
  Reflect.deleteProperty(console, 'groupEnd')
}

function context(overrides: Partial<ErrorContext> = {}): ErrorContext {
  return {
    storeName: 'store1',
    operation: 'dispatch',
    error: new Error('boom'),
    level: 'error',
    timestamp: 1700000000000,
    ...overrides,
  }
}

describe('#235 getErrorStats 的稀疏键与 Partial 口径', () => {
  it('未出现过的级别/操作不给 0 键，读取侧按 ?? 兜底', () => {
    const handler = new ErrorHandlerImpl()
    handler.handle('user-store', 'action-execution', new Error('e1'), 'error')

    const stats = handler.getErrorStats()
    expect(Object.keys(stats.byLevel)).toEqual(['error'])
    expect(Object.keys(stats.byOperation)).toEqual(['action-execution'])
    expect(stats.byLevel.warn).toBeUndefined()
    expect(stats.byLevel.critical).toBeUndefined()

    // 类型口径：Partial 暴露后调用方必须显式兜底，这里同时验证可消费性
    const warn: number = stats.byLevel.warn ?? 0
    const critical: number = stats.byLevel.critical ?? 0
    expect([warn, critical]).toEqual([0, 0])
  })
})

describe('#239 聚合器驱逐改为线性扫描', () => {
  it('驱逐 lastSeen 最小的一组，指纹与计数随组释放', () => {
    const aggregator = new ErrorAggregator(2)
    const add = (message: string, timestamp: number, storeName: string) => aggregator.addError(context({ error: new Error(message), timestamp, storeName }))

    add('a', 1000, 's1')
    add('b', 2000, 's2')
    add('c', 3000, 's1')
    add('d', 4000, 's2')

    expect(aggregator.getGroups().map((g) => g.message)).toEqual(['d', 'c'])

    // 被驱逐组的指纹已释放：同站点再来一次是新建组（count 1），而不是并到旧组
    add('a', 5000, 's1')
    const groups = aggregator.getGroups()
    expect(groups.map((g) => g.message)).toEqual(['a', 'd'])
    expect(groups[0].count).toBe(1)

    const stats = aggregator.getStats()
    expect(Object.values(stats.byStore).reduce((sum, n) => sum + n, 0)).toBe(stats.totalErrors)
  })
})

describe('#240 组身份校验', () => {
  it('堆栈头部不同即判为不同组，不会被静默并组', () => {
    const aggregator = new ErrorAggregator()
    const at = (stack: string) => context({ error: Object.assign(new Error('boom'), { stack }) })

    aggregator.addError(at('Error: boom\n at helper(a.ts:1:1)'))
    aggregator.addError(at('Error: boom\n at helper(b.ts:9:9)'))
    aggregator.addError(at('Error: boom\n at helper(a.ts:1:1)'))

    const groups = aggregator.getGroups()
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.count)).toEqual([2, 1])
    expect(new Set(groups.map((g) => g.groupId)).size).toBe(2)
  })

  it('归并口径仍为 name+message+堆栈前缀（更深层帧不同仍同组）', () => {
    const aggregator = new ErrorAggregator()
    const head = 'Error: boom\n at helper(a.ts:1:1)'
    const at = (tail: string) => context({ error: Object.assign(new Error('boom'), { stack: head + 'x'.repeat(100) + tail }) })

    aggregator.addError(at('#first'))
    aggregator.addError(at('#second'))

    expect(aggregator.getGroups()).toHaveLength(1)
    expect(aggregator.getGroups()[0].count).toBe(2)
  })
})

describe('#241 组内样本为脱敏副本并随最新出现刷新', () => {
  it('不持有 payload、不被调用方改写污染、命中时刷新', () => {
    const aggregator = new ErrorAggregator()
    const retained = { node: '页面节点/store 实例' }
    const live = context({ payload: { retained }, storeName: 'A', timestamp: 1000 })

    aggregator.addError(live)
    const group = aggregator.getGroups()[0]

    // 调用方随后复用/改写同一个 context，不得回头改诊断样本
    live.storeName = 'tampered'
    live.level = 'critical'
    delete live.payload
    expect(group.sampleError.storeName).toBe('A')
    expect(group.sampleError.level).toBe('error')
    // payload 是「缓存钉住整棵对象树」的主要来源，不随组长期驻留
    expect(Object.prototype.hasOwnProperty.call(group.sampleError, 'payload')).toBe(false)
    expect(JSON.stringify(group.sampleError)).not.toContain('页面节点')

    aggregator.addError({ ...group.sampleError, storeName: 'B', timestamp: 2000 })
    const updated = aggregator.getGroups()[0]
    expect(updated.count).toBe(2)
    expect(updated.sampleError.storeName).toBe('B')
    expect(updated.sampleError.timestamp).toBe(2000)
  })
})

describe('#246 控制台分组能力试探', () => {
  it('console.group 存在但调用即抛时降级平铺，且只试探一次', async () => {
    const group = jest.spyOn(console, 'group').mockImplementation(() => {
      throw new Error('group boom')
    })
    const groupEnd = jest.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = new ConsoleReporter('[P1]')

    try {
      await expect(reporter.report(context())).resolves.toBeUndefined()

      expect(group).toHaveBeenCalledTimes(1)
      // group 没开成功就不该 groupEnd（否则会把一个未打开的组「关」成噪声）
      expect(groupEnd).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith('[P1] ERROR Error:', expect.any(Error))
      expect(errorSpy).toHaveBeenCalledWith('[P1] ERROR Store:', 'store1')

      await reporter.report(context())
      expect(group).toHaveBeenCalledTimes(1)
    } finally {
      group.mockRestore()
      groupEnd.mockRestore()
      errorSpy.mockRestore()
    }
  })
})

describe('#248 字段打印只有一份实现', () => {
  const labelsOf = (spy: jest.SpyInstance, stripHeader: RegExp) =>
    spy.mock.calls.map((call: unknown[]) => (typeof call[0] === 'string' ? call[0].replace(stripHeader, '') : call[0]))

  it('report 的分组与平铺路径输出同一组标签（仅前缀差异）', async () => {
    const group = jest.spyOn(console, 'group').mockImplementation(() => {})
    const groupEnd = jest.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = new ConsoleReporter('[P1]')
    const withPayload = context({ payload: { a: 1 } })

    let grouped: unknown[] = []
    let flat: unknown[] = []
    try {
      await reporter.report(withPayload)
      grouped = labelsOf(errorSpy, /^\[P1\] ERROR /)
      errorSpy.mockClear()
      hideConsoleGroup()
      await reporter.report(withPayload)
      flat = labelsOf(errorSpy, /^\[P1\] ERROR /)
    } finally {
      restoreConsoleGroup()
      group.mockRestore()
      groupEnd.mockRestore()
      errorSpy.mockRestore()
    }

    expect(flat).toEqual(grouped)
    expect(grouped).toEqual(['Error:', 'Store:', 'Operation:', 'Payload:', 'Timestamp:'])
  })

  it('reportBatch 的分组与平铺路径逐条格式一致且级别大写', async () => {
    const group = jest.spyOn(console, 'group').mockImplementation(() => {})
    const groupEnd = jest.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = new ConsoleReporter('[P1]')
    const batch = [context({ level: 'warning' }), context({ level: 'critical', storeName: 'store2' })]

    let grouped: unknown[][] = []
    let flat: unknown[][] = []
    try {
      await reporter.reportBatch(batch)
      grouped = errorSpy.mock.calls.slice()
      errorSpy.mockClear()
      hideConsoleGroup()
      await reporter.reportBatch(batch)
      flat = errorSpy.mock.calls.slice()
    } finally {
      restoreConsoleGroup()
      group.mockRestore()
      groupEnd.mockRestore()
      errorSpy.mockRestore()
    }

    // 平铺只多一行标题，逐条内容与分组路径完全相同（此前批量走小写级别，已漂移）
    expect(flat.slice(1)).toEqual(grouped)
    expect(grouped.map((call) => call[0])).toEqual(['[1] WARNING in store1:', '[2] CRITICAL in store2:'])
    expect(String(flat[0][0])).toContain('Batch Report (2 errors)')
  })
})

describe('#249 残缺上下文不得让报告器抛错', () => {
  it('缺 level / error / 非法 timestamp 时仍能输出，不顶替被报告的错误', async () => {
    const group = jest.spyOn(console, 'group').mockImplementation(() => {})
    const groupEnd = jest.spyOn(console, 'groupEnd').mockImplementation(() => {})
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const reporter = new ConsoleReporter()
    let headers: unknown[] = []
    let stamps: unknown[] = []

    try {
      await expect(reporter.report({} as never)).resolves.toBeUndefined()
      await expect(reporter.report(context({ level: undefined as never, timestamp: 'nope' as never }))).resolves.toBeUndefined()
      // new Date(1e30) 是 Invalid Date，toISOString() 会抛 RangeError
      await expect(reporter.report(context({ timestamp: 1e30 }))).resolves.toBeUndefined()
      await expect(reporter.report(undefined as never)).resolves.toBeUndefined()
      await expect(reporter.reportBatch([{}, undefined] as never)).resolves.toBeUndefined()
      await expect(reporter.reportBatch(undefined as never)).resolves.toBeUndefined()

      headers = group.mock.calls.map((call: unknown[]) => call[0])
      stamps = errorSpy.mock.calls
        .filter((call: unknown[]) => typeof call[0] === 'string' && String(call[0]).includes('Timestamp:'))
        .map((call: unknown[]) => call[1])
    } finally {
      group.mockRestore()
      groupEnd.mockRestore()
      errorSpy.mockRestore()
    }

    expect(headers).toContain('[ErrorMonitoring] UNKNOWN')
    // 非法时间戳回退为当前时间的合法 ISO 串
    expect(stamps.length).toBeGreaterThan(0)
    for (const stamp of stamps) {
      expect(Number.isNaN(Date.parse(String(stamp)))).toBe(false)
    }
  })
})

describe('#250 返回形态按 (宿主, 方法) 判定', () => {
  it('一个实例返回 Promise 不会把其他实例的抑制调用也变成 Promise', () => {
    jest.useFakeTimers()
    jest.setSystemTime(10_000)
    // 同一装饰器实例装饰两个宿主：非 async 语法但返回 Promise 的方法会置起标记
    const decorator = withThrottle(1000, { leading: true, trailing: false })

    class PromiseHost {
      run(): Promise<number> {
        return Promise.resolve(1)
      }
    }
    class SyncHost {
      run(): number {
        return 2
      }
    }

    const asyncDescriptor = Object.getOwnPropertyDescriptor(PromiseHost.prototype, 'run') as PropertyDescriptor
    const syncDescriptor = Object.getOwnPropertyDescriptor(SyncHost.prototype, 'run') as PropertyDescriptor
    decorator(PromiseHost.prototype, 'run', asyncDescriptor)
    decorator(SyncHost.prototype, 'run', syncDescriptor)

    const asyncHost = new PromiseHost()
    const syncHost = new SyncHost()
    const callAsync = () => (asyncDescriptor.value as (this: unknown) => unknown).call(asyncHost)
    const callSync = () => (syncDescriptor.value as (this: unknown) => unknown).call(syncHost)

    expect(callAsync()).toBeInstanceOf(Promise)
    // 同宿主被抑制的调用返回 Promise：调用方 await 不会崩
    expect(callAsync()).toBeInstanceOf(Promise)
    expect(callSync()).toBe(2)
    // 另一宿主从未观测到 Promise，被抑制的调用仍必须是 undefined 而不是 Promise
    expect(callSync()).toBeUndefined()

    jest.useRealTimers()
  })
})

describe('#251 新窗口作废上一窗口的尾调用定时器', () => {
  it('残留定时器被清除，尾调用只在正确时刻补发一次', () => {
    jest.useFakeTimers()
    jest.setSystemTime(10_000)
    const calls: number[] = []
    class Demo {
      run(value: number): number {
        calls.push(value)
        return value
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'run') as PropertyDescriptor
    withThrottle(100, { leading: true, trailing: true })(Demo.prototype, 'run', descriptor)
    const host = new Demo()
    const invoke = (value: number) => (descriptor.value as (this: unknown, v: number) => unknown).call(host, value)

    invoke(1) // t=10000：leading
    jest.setSystemTime(10_010)
    invoke(2) // 窗口内被抑制 → 尾定时器到期于 10100
    expect(jest.getTimerCount()).toBe(1)

    jest.setSystemTime(10_100)
    invoke(3) // 恰为窗口末尾 → 新窗口 leading
    // 修复前此处仍挂着 1 个「参数已被清空、但仍会抹掉新定时器引用」的空转定时器
    expect(jest.getTimerCount()).toBe(0)

    jest.setSystemTime(10_110)
    invoke(4) // 新窗口内被抑制 → 到期于 10200
    jest.advanceTimersByTime(89) // t=10199
    expect(calls).toEqual([1, 3])
    jest.advanceTimersByTime(1) // t=10200：有且仅有一次补发
    expect(calls).toEqual([1, 3, 4])
    expect(jest.getTimerCount()).toBe(0)

    jest.useRealTimers()
  })
})

describe('#252 interval 规范化', () => {
  it.each([0, -100, Number.NaN, Number.POSITIVE_INFINITY])('interval=%p 回退为 300ms 窗口', (interval) => {
    jest.useFakeTimers()
    jest.setSystemTime(1000)
    const calls: number[] = []
    class Demo {
      run(value: number): number {
        calls.push(value)
        return value
      }
    }
    const descriptor = Object.getOwnPropertyDescriptor(Demo.prototype, 'run') as PropertyDescriptor
    withThrottle(interval, { leading: true, trailing: true })(Demo.prototype, 'run', descriptor)
    const host = new Demo()
    const invoke = (value: number) => (descriptor.value as (this: unknown, v: number) => unknown).call(host, value)

    invoke(1) // t=1000：新窗口 leading
    jest.setSystemTime(1010)
    invoke(2) // 窗口内 → 尾调用到期于 1300
    // 修复前：窗口判断恒不成立，且 `setTimeout(fn, NaN|Infinity)` 退化为立即执行
    jest.advanceTimersByTime(289) // t=1299
    expect(calls).toEqual([1])
    jest.advanceTimersByTime(1) // t=1300
    expect(calls).toEqual([1, 2])

    jest.useRealTimers()
  })
})
