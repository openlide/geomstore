/**
 * 第五轮审查（ocrreview.md）critical + high 修复的回归锁
 *
 * 每条用例在标题里标出对应的 R5 编号，断言的是**修复后的语义**而不是「代码跑通了」：
 * 修复前这些断言全部会失败（失败原因即报告描述的那条路径）。
 *
 * 未在本文件出现的 R5 编号由既有测试承接：
 * R5-192 → tests/unit/extras/error/*（按 store 汇总的账目自洽）、
 * R5-201 → tests/unit/core/error/ErrorRecovery.test.ts 的 BUG-13、
 * R5-279 → tests/unit/plugins/wx-storage-backend.test.ts（缺失即抛错）、
 * R5-018 / R5-022 → scripts/*.mjs 不在 jest 采集范围内，验证方式为命令级冒烟
 * （junction 目标文件不被删、main 含 "dist" 字样的真实目录不被递归删除）。
 */

import { PerformanceMonitor } from '@/core/performance/PerformanceMonitor.js'
import { composeStore } from '@/core/compose/composeStore.js'
import type { Store } from '@/types/store.js'
import { withLog } from '@/extras/action/decorators/log.js'
import { withThrottle } from '@/extras/action/decorators/throttle.js'
import { ErrorAggregator } from '@/extras/error/ErrorAggregator.js'
import { createRetrySelector, createRetrySelectorAsync } from '@/extras/selector/retrySelector.js'
import { createSelector } from '@/extras/selector/createSelector.js'
import { deepEqual } from '@/core/utils/helpers.js'
import { SnapshotManager } from '@/extras/snapshot/SnapshotManager.js'
import { ensureAppLifecycleHooks } from '@/integrations/enterprise/background-sync.js'
import { registerGlobalEntry } from '@/plugins/globalRegistry.js'

/** 取装饰后的方法并调用（host 是 Record<string|symbol, unknown>，直接点调用会判为 unknown） */
function callMethod(host: Record<string | symbol, unknown>, key: string, ...args: unknown[]): unknown {
  return (host[key] as (...callArgs: unknown[]) => unknown)(...args)
}

/** 以描述符手工装饰（对象字面量上的方法写不出装饰器语法） */
function decorate(host: Record<string | symbol, unknown>, key: string | symbol, decorator: MethodDecorator): void {
  const descriptor = Object.getOwnPropertyDescriptor(host, key) as PropertyDescriptor
  Object.defineProperty(host, key, decorator(host, key, descriptor) ?? descriptor)
}

const g = globalThis as unknown as Record<string, unknown>

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
  delete g.wx
})

// ==================== R5-089 时钟基准切换不得污染在途计时 ====================

describe('R5-089 PerformanceMonitor 时钟降级', () => {
  it('wx.now() 中途返回非有限值时作废在途条目，不写入跨基准的脏 duration', () => {
    let tick = 0
    g.wx = {
      getPerformance: () => ({
        // 首次读数（start）正常，第二次（end）不可信 → 降级到 Date.now
        now: () => (tick++ === 0 ? 100 : Number.NaN),
      }),
    }
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {})
    const monitor = new PerformanceMonitor({ threshold: 16 })

    const end = monitor.start('boot')
    end()

    // 修复前：Date.now() - 100 ≈ 1.7e12 被记成「超阈值」样本，永久污染 getStats
    expect(monitor.getMetrics()).toHaveLength(0)
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('时钟基准降级'))
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('计时条目缺失'))
  })

  it('无 wx 环境（始终 Date.now）照常计时，不误伤正常路径', () => {
    const monitor = new PerformanceMonitor({ threshold: -1 })
    const end = monitor.start('boot')
    end()
    expect(monitor.getMetrics()).toHaveLength(1)
  })
})

// ==================== R5-102 构造期订阅失败必须留痕 ====================

describe('R5-102 composeStore 订阅降级告警', () => {
  it('子 store.subscribe 抛错时禁用合并缓存并告警，读取仍可用', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = {
      name: 'broken',
      state: { a: 1 },
      actions: {},
      subscribe: () => {
        throw new Error('subscriber cap reached')
      },
    } as unknown as Store

    const composed = composeStore([broken])

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('子 store 订阅建立失败'), expect.any(Error))
    expect((composed.state as { a: number }).a).toBe(1)
  })
})

// ==================== R5-176 日志 sink 故障不得影响业务调用 ====================

describe('R5-176 withLog 的 sink / redact 隔离', () => {
  it('sink.log 抛错时 action 本体照常执行并返回结果', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const host: Record<string | symbol, unknown> = {
      fetch(id: string): string {
        return `user:${id}`
      },
    }
    decorate(
      host,
      'fetch',
      withLog('fetch', {
        sink: {
          log: () => {
            throw new Error('sink down')
          },
          error: () => {},
        },
      }),
    )

    // 修复前：before 抛错 → 方法体根本不执行，且 sink 的错误被当成 action 失败上报
    expect(callMethod(host, 'fetch', '1')).toBe('user:1')
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('日志输出失败'), 'sink down')
  })

  it('redact 抛错同样被兜住（after 路径不得把成功改判为失败）', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const host: Record<string | symbol, unknown> = {
      load(): number {
        return 42
      },
    }
    decorate(
      host,
      'load',
      withLog('load', {
        redact: () => {
          throw new Error('redact down')
        },
      }),
    )

    expect(callMethod(host, 'load')).toBe(42)
    // before 与 after 各兜住一次（两处都调用 redact）
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })
})

// ==================== R5-193 节流返回值判定要认 thenable ====================

describe('R5-193 withThrottle 对 thenable / 跨 realm Promise 的判定', () => {
  it('leading 调用返回手写 thenable 时，窗口内被抑制的调用仍返回 Promise', () => {
    jest.useFakeTimers()
    const thenable = { then: (resolve: (v: number) => void) => resolve(7) }
    const host: Record<string | symbol, unknown> = {
      calls: 0,
      fetch(): unknown {
        host.calls = (host.calls as number) + 1
        return thenable
      },
    }
    decorate(host, 'fetch', withThrottle(1000))

    expect(callMethod(host, 'fetch')).toBe(thenable)
    // 修复前：`result instanceof Promise` 判不出 thenable → 第二次调用返回 undefined，
    // 同一方法的返回类型随调用顺序翻转
    expect(callMethod(host, 'fetch')).toBeInstanceOf(Promise)
  })

  it('尾随补发返回 rejection 型 thenable 时就地兜住，不外抛', async () => {
    jest.useFakeTimers()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const failing = {
      then: (_resolve: (_v: unknown) => void, reject: (e: unknown) => void) => reject(new Error('thenable rejected')),
    }
    const host: Record<string | symbol, unknown> = {
      calls: 0,
      fetch(): unknown {
        host.calls = (host.calls as number) + 1
        if ((host.calls as number) > 1) return failing
        return undefined
      },
    }
    decorate(host, 'fetch', withThrottle(100))

    callMethod(host, 'fetch')
    callMethod(host, 'fetch')
    jest.advanceTimersByTime(150)
    // Promise.resolve(thenable).catch(...) 的判定在微任务里落地，fake timers 不会替它推进
    for (let i = 0; i < 5; i++) await Promise.resolve()

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[withThrottle] trailing invocation failed'), expect.any(Error))
  })
})

// ==================== R5-192 非 Error 抛出值不得破坏计数账目 ====================

describe('R5-192 ErrorAggregator 处理非 Error 抛出值', () => {
  it('context.error 为 null 时仍建组，byStore 合计与 totalErrors 一致', () => {
    const aggregator = new ErrorAggregator()

    const group = aggregator.addError({
      storeName: 's1',
      operation: 'dispatch',
      error: null as unknown as Error,
      level: 'error',
    })

    expect(group).toBeDefined()
    expect(group?.type).toBe('Error')
    expect(group?.message).toBe('null')
    const stats = aggregator.getStats()
    expect(stats.totalErrors).toBe(1)
    expect(Object.values(stats.byStore).reduce((sum, n) => sum + n, 0)).toBe(1)
  })
})

// ==================== R5-220 重试选择器不得丢弃 falsy 抛出值 ====================

describe('R5-220 createRetrySelector 保留 falsy 抛出值', () => {
  type NumState = { value: number }
  const throwing = (thrown: unknown) => {
    return (_state: NumState): number => {
      throw thrown
    }
  }

  it.each([[null], [0], [''], [false], [undefined]])('同步：throw %p 时原样抛出该值', (thrown) => {
    const selector = createRetrySelector(throwing(thrown), { retries: 1 })
    let caught: unknown = 'NOT_THROWN'
    try {
      selector({ value: 1 })
    } catch (error) {
      caught = error
    }
    // 修复前：falsy 抛出值被真值判定丢弃，调用方拿到合成的 "failed without error"
    expect(caught).toBe(thrown)
    expect(caught).not.toBeInstanceOf(Error)
  })

  it('异步：rejection 原因为 0 时同样原样抛出', async () => {
    const selector = createRetrySelectorAsync(throwing(0), { retries: 1 })
    await expect(selector({ value: 1 })).rejects.toBe(0)
  })
})

// ==================== R5-224 缓存失效凭证由 snapshotState 显式声明 ====================

describe('R5-224 createSelector 的 snapshotState', () => {
  type NumState = { list: number[] }

  it('自定义深比较器（非内置 deepEqual 引用）下就地变异不再返回陈旧值', () => {
    let calls = 0
    const selector = createSelector(
      (s: NumState) => {
        calls += 1
        return s.list.length
      },
      { cacheTTL: 60_000, equalityFn: (a, b) => deepEqual(a, b) },
    )
    const state: NumState = { list: [1, 2] }

    expect(selector(state)).toBe(2)
    state.list.push(3)
    // 修复前：`equalityFn === deepEqual` 判为假 → 缓存活引用 → 两个实参同一对象、
    // 深比较恒等 → 就地变异看不见，这里仍返回 2
    expect(selector(state)).toBe(3)
    expect(calls).toBe(2)
  })

  it('snapshotState: false 时缓存活引用，引用相等比较器照常命中', () => {
    let calls = 0
    const selector = createSelector(
      (s: NumState) => {
        calls += 1
        return s.list.length
      },
      { cacheTTL: 60_000, equalityFn: (a, b) => a === b, snapshotState: false },
    )
    const state: NumState = { list: [1, 2] }

    expect(selector(state)).toBe(2)
    expect(selector(state)).toBe(2)
    expect(calls).toBe(1)
  })

  it('引用相等比较器未关快照时不再命中（内容快照与活引用永不相等）', () => {
    let calls = 0
    const selector = createSelector(
      (s: NumState) => {
        calls += 1
        return s.list.length
      },
      { cacheTTL: 60_000, equalityFn: (a, b) => a === b },
    )
    const state: NumState = { list: [1] }

    selector(state)
    selector(state)
    expect(calls).toBe(2)
  })
})

// ==================== R5-258 构造期非法 batchSize 不得绕过守卫 ====================

describe('R5-258 SnapshotManager 的 batchSize 守卫', () => {
  it('构造期传 0 时不再交付「success 但 data 为空」的半成品', async () => {
    const manager = new SnapshotManager({ batchSize: 0 })
    const result = await manager.createSnapshotAsync({ a: 1, b: [2, 3] })

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ a: 1, b: [2, 3] })
  })

  it('逐次调用传非法值同样回落到合法批大小', async () => {
    const manager = new SnapshotManager({ batchSize: Number.NaN })
    const result = await manager.createSnapshotAsync({ deep: { x: 1 } }, { batchSize: -5 })

    expect(result.data).toEqual({ deep: { x: 1 } })
  })
})

// ==================== R5-247 App 的非对象实参原样透传 ====================

describe('R5-247 background-sync 的 App 包装实参校验', () => {
  let previousApp: unknown

  beforeEach(() => {
    previousApp = g.App
  })

  afterEach(() => {
    g.App = previousApp
  })

  it.each([[null], ['x'], [123]])('App(%p) 不抛错，且原样交给宿主 App', (value) => {
    const original = jest.fn()
    g.App = original
    ensureAppLifecycleHooks()
    const wrapped = g.App as (options: unknown) => unknown

    // 修复前：默认参数只挡 undefined，非对象实参在属性读取 / 赋值 / defineProperty 处抛 TypeError
    expect(() => wrapped(value)).not.toThrow()
    expect(original).toHaveBeenCalledWith(value)
  })

  it('正常配置仍被包装（onShow 被替换）', () => {
    const original = jest.fn()
    g.App = original
    ensureAppLifecycleHooks()
    const userOnShow = jest.fn()
    const wrapped = g.App as (options: unknown) => unknown

    wrapped({ onShow: userOnShow })

    const passed = original.mock.calls[0][0] as { onShow: () => void }
    expect(passed.onShow).not.toBe(userOnShow)
  })
})

// ==================== R5-305 全局表不可用时保持 fail-safe ====================

describe('R5-305 registerGlobalEntry 的容器可用性判定', () => {
  afterEach(() => {
    delete g.__R5_SEALED__
    delete g.__R5_NONCONF__
  })

  it('已 seal 的表（自有属性仍可写）不得复用，改换新表', () => {
    g.__R5_SEALED__ = Object.seal({ legacy: 1 })
    const api = { ping: 1 }

    const unregister = registerGlobalEntry('__R5_SEALED__', 'store-a', api)

    // 修复前：!isFrozen 判定放行 → defineProperty 写新键抛 TypeError，整次插件安装中断
    const table = g.__R5_SEALED__ as Record<string, unknown>
    expect(table['store-a']).toBe(api)
    expect(() => unregister()).not.toThrow()
  })

  it('同名键已被占为不可配置属性时降级为 no-op 并告警，不抛错', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const table: Record<string, unknown> = {}
    Object.defineProperty(table, 'store-b', { value: 'external', enumerable: true, configurable: false, writable: false })
    g.__R5_NONCONF__ = table

    const unregister = registerGlobalEntry('__R5_NONCONF__', 'store-b', { ping: 2 })

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('不可写'), expect.any(Error))
    expect(table['store-b']).toBe('external')
    expect(() => unregister()).not.toThrow()
  })
})
